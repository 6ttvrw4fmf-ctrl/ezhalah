// Advanced-Filter certification must judge every filter against the cohort the search will actually
// run in — the MERGED conversation state — and must say out loud whatever it refuses.
//
// Four defects, one root cause, all live on production 2026-09-01, all with GREEN text barriers over
// them at the time. This file EXECUTES the real certification instead of grepping it, which is why it
// can fail where those could not. src/lib/afCertify.ts is a leaf module for exactly this reason.
//
//  1. amenities and furnished were certified in queryFromBackend against THIS turn's payload alone.
//     A follow-up carries no type (the model is told not to restate), so scopeCleanTypes() === [] and
//     a legitimately certified filter was refused. Live: «أبغى عمارة للبيع في الرياض فيها مصعد» then
//     «مدينة الرياض» → elevator rejected on a cohort that certifies it.
//  2. …and the same pass could APPLY a token the merged cohort refuses, so the merged verdict has to
//     replace the fresh one in BOTH directions, not union with it.
//  3. carried state was never re-certified: a sticky answer survived into a cohort that never
//     certified it. Live counts: Apartment/Buy + streetWidthMin 20 → 38,540 becomes 585;
//     Apartment/RentAnnual + ratingMin 9.5 → 23,953 becomes 0; Villa/Buy + rnpl → 27,505 becomes 0.
//  4. a rejection from the first pass survived the second, so the reply announced «that option is not
//     available in this search» for a filter that HAD been applied.
//
// The rule the sweep must not break: refusing to APPLY is not the same as erasing. merge keeps the
// state (verify-clarification-never-loses-state.ts owns that); this layer decides what may run, and
// every drop is pushed onto the rejection list so rejectionNotice() can speak it.

import { readFileSync } from 'node:fs';
import { certifyAfOnMergedState } from '../src/lib/afCertify.ts';
import { AF_INTENTS, GENERIC_INTENT_IDS } from '../src/lib/afIntents.ts';
import { cohortAllows } from '../src/lib/afCohorts.ts';
import { emptyQuery } from '../src/lib/searchDefaults.ts';
import type { SearchQuery } from '../src/data/search.ts';

let failed = 0;
const check = (ok: boolean, msg: string, extra = '') => {
  if (ok) console.log(`  PASS  ${msg}`);
  else { console.log(`  FAIL  ${msg}${extra ? ` — ${extra}` : ''}`); failed++; }
};
const q = (o: Partial<SearchQuery>): SearchQuery => ({ ...emptyQuery(), ...o } as SearchQuery);

// ── 1. THIS TURN'S FILTERS ARE JUDGED ON THE MERGED COHORT ────────────────────────────────────
{
  // The merged state is a certified cohort; the turn itself restated nothing.
  const merged = q({ type: 'Apartment', category: 'Residential', deal: 'Rent', rentPeriod: 'annual', location: 'الرياض' });
  check(cohortAllows(merged, 'furnished'), 'fixture precondition: Apartment/RentAnnual certifies furnished');

  const f = certifyAfOnMergedState(merged, { furnished: 'yes' });
  check(f.q.furnishedPref === true, 'furnished stated on a bare follow-up is APPLIED on the merged cohort',
    `got ${String(f.q.furnishedPref)}`);
  check(!f.rejected.includes('furnished'), 'and is NOT announced as unavailable', JSON.stringify(f.rejected));

  const a = certifyAfOnMergedState(merged, { amenities: ['elevator'] });
  check(a.q.amenities?.includes('elevator') === true, 'an amenity stated on a bare follow-up is APPLIED',
    JSON.stringify(a.q.amenities));
  check(a.rejected.length === 0, 'and nothing is announced as unavailable', JSON.stringify(a.rejected));

  // rating is MONTHLY-only (Gathern is the only rated inventory; annual apartments carry no rating at
  // all), so it needs its own merged fixture — using the annual one above would assert the opposite
  // of the product rule.
  const monthlyMerged = q({ type: 'Apartment', category: 'Residential', deal: 'Rent',
    rentPeriod: 'monthly', location: 'الرياض' });
  check(cohortAllows(monthlyMerged, 'rating'), 'fixture precondition: Apartment/RentMonthly certifies rating');
  const r = certifyAfOnMergedState(monthlyMerged, { af: { rating: '9.5' } });
  check(r.q.ratingMin === 9.5, 'an af intent stated on a bare follow-up is APPLIED on the merged cohort',
    String(r.q.ratingMin));
  check(!r.rejected.includes('rating'), 'and is not announced as unavailable', JSON.stringify(r.rejected));
}

// ── 2. THE MERGED VERDICT REPLACES A NARROWER ONE — IN BOTH DIRECTIONS ────────────────────────
{
  // Monthly apartments do NOT certify furnished (0.0% known). A value already sitting on the query
  // must be REMOVED, not merely left un-reapplied.
  const monthly = q({ type: 'Apartment', category: 'Residential', deal: 'Rent', rentPeriod: 'monthly',
    location: 'الرياض', furnishedPref: true });
  check(!cohortAllows(monthly, 'furnished'), 'fixture precondition: Apartment/RentMonthly does NOT certify furnished');
  const out = certifyAfOnMergedState(monthly, { furnished: 'yes' });
  check(out.q.furnishedPref == null, 'a furnished value the merged cohort refuses is CLEARED, not left applied',
    `got ${String(out.q.furnishedPref)}`);
  check(out.rejected.includes('furnished'), 'and the refusal is announced', JSON.stringify(out.rejected));
}

// ── 3. CARRIED STATE IS RE-CERTIFIED WHEN THE COHORT MOVES ────────────────────────────────────
// Each case is a measured production collapse, not a hypothetical.
{
  const cases: Array<{ name: string; before: Partial<SearchQuery>; id: string; gone: (x: SearchQuery) => boolean; live: string }> = [
    { name: 'streetWidthMin into Apartment/Buy', live: '38,540 → 585',
      before: { type: 'Apartment', category: 'Residential', deal: 'Buy', streetWidthMin: 20 },
      id: 'street_width', gone: (x) => x.streetWidthMin == null },
    { name: 'ratingMin into Apartment/RentAnnual', live: '23,953 → 0',
      before: { type: 'Apartment', category: 'Residential', deal: 'Rent', rentPeriod: 'annual', ratingMin: 9.5 },
      id: 'rating', gone: (x) => x.ratingMin == null },
    { name: 'unitSubtypes into Apartment/Buy', live: '→ 0',
      before: { type: 'Apartment', category: 'Residential', deal: 'Buy', unitSubtypes: ['شقق مخدومة'] },
      id: 'unit_subtype', gone: (x) => !x.unitSubtypes?.length },
    { name: 'rnpl into Villa/Buy', live: '27,505 → 0',
      before: { type: 'Villa', category: 'Residential', deal: 'Buy', amenities: ['rnpl'] },
      id: 'rnpl', gone: (x) => !(x.amenities ?? []).includes('rnpl') },
  ];
  for (const c of cases) {
    const before = q(c.before);
    check(!cohortAllows(before, c.id), `fixture precondition: ${c.name} is NOT certified`);
    const out = certifyAfOnMergedState(before, {});
    check(c.gone(out.q), `carried ${c.name} is dropped (live ${c.live})`, JSON.stringify(out.q));
    check(out.rejected.includes(c.id), `…and "${c.id}" is announced, never silently binned`, JSON.stringify(out.rejected));
  }
}

// ── 3b. AMENITY CERTIFICATION IS PER-TOKEN, NOT PER-QUESTION ──────────────────────────────────
// Villa ads carry مدخل سيارة / صرف صحي checkboxes apartment forms do not, so those tokens are
// villa-only even where 'amenities' as a question is certified. A carried one must go when the scope
// stops being pure-Villa — the question-level sweep above cannot see this, because it passes.
{
  const moved = q({ type: 'Apartment', category: 'Residential', deal: 'Rent', rentPeriod: 'annual',
    location: 'الرياض', amenities: ['elevator', 'car_entrance'] });
  check(cohortAllows(moved, 'amenities'), 'fixture precondition: the question itself is still certified here');
  const out = certifyAfOnMergedState(moved, {});
  check(!(out.q.amenities ?? []).includes('car_entrance'),
    'a villa-only token carried into an Apartment scope is dropped', JSON.stringify(out.q.amenities));
  check((out.q.amenities ?? []).includes('elevator'),
    '…while the certified token beside it survives', JSON.stringify(out.q.amenities));
  check(out.rejected.includes('car_entrance'), '…and the dropped token is announced', JSON.stringify(out.rejected));
}

// ── 3c. A REFUSED AMENITY IS ANNOUNCED EVEN THOUGH IT NEVER REACHED THE QUERY ─────────────────
// The token is refused before it is ever written, so no sweep can find it later. If this push is
// lost the user is simply never told — a silent drop, which is the failure mode this whole file is
// about. (Buy never certifies furnished-style monthly amenities; use a cohort with no amenity list.)
{
  const uncertified = q({ type: 'Room', category: 'Residential', deal: 'Buy' });
  check(!cohortAllows(uncertified, 'amenities'), 'fixture precondition: this cohort certifies no amenities');
  const out = certifyAfOnMergedState(uncertified, { amenities: ['elevator'] });
  check(!(out.q.amenities ?? []).includes('elevator'), 'the refused amenity is not applied', JSON.stringify(out.q.amenities));
  check(out.rejected.includes('elevator'), 'and IS announced, though it never reached the query',
    JSON.stringify(out.rejected));
}

// ── 4. A CERTIFIED CARRIED ANSWER IS NEVER TOUCHED ────────────────────────────────────────────
// The sweep must only remove what the cohort refuses. If this fails, narrowing inside one cohort
// would lose the user's answers every turn — a far worse bug than the one being fixed.
{
  const keep = q({ type: 'Apartment', category: 'Residential', deal: 'Rent', rentPeriod: 'annual',
    location: 'الرياض', bathMin: 3, amenities: ['elevator'], furnishedPref: true });
  const out = certifyAfOnMergedState(keep, {});
  check(out.q.bathMin === 3, 'a certified carried bathMin survives', String(out.q.bathMin));
  check(out.q.amenities?.includes('elevator') === true, 'a certified carried amenity survives', JSON.stringify(out.q.amenities));
  check(out.q.furnishedPref === true, 'a certified carried furnishedPref survives', String(out.q.furnishedPref));
  check(out.rejected.length === 0, 'and nothing is announced', JSON.stringify(out.rejected));
}

// ── 5. NOTHING IS ANNOUNCED FOR A FILTER THE USER NEVER HAD ───────────────────────────────────
// clear() returns the SAME REFERENCE when there is nothing set; that identity is what separates
// "cleared something" from "nothing to clear". A clear() that always copied would make every
// uncertified cohort announce all nine ids on every turn.
{
  const bare = q({ type: 'Apartment', category: 'Residential', deal: 'Buy' });
  const out = certifyAfOnMergedState(bare, {});
  check(out.rejected.length === 0, 'an untouched query announces no rejections at all', JSON.stringify(out.rejected));
  for (const id of GENERIC_INTENT_IDS) {
    check(AF_INTENTS[id].clear(bare) === bare, `${id}.clear() returns the same reference when nothing is set`);
  }
}

// ── 6. EVERY INTENT'S clear() ACTUALLY UNDOES ITS apply() ─────────────────────────────────────
// Derived from the registry, so a new AF question cannot ship with a half-written inverse.
{
  const base = q({ type: 'Apartment', category: 'Residential', deal: 'Rent', rentPeriod: 'annual', location: 'الرياض' });
  const sample: Record<string, string> = {
    property_age: '3_5', street_width: '20', direction: 'شمال', bathrooms: '3',
    rating: '9.5', rnpl: 'rnpl', unit_subtype: 'شقة', furnished: 'yes',
  };
  for (const id of GENERIC_INTENT_IDS) {
    const key = AF_INTENTS[id].canonicalize(sample[id] ?? '');
    check(key !== null, `fixture: a canonical value exists for ${id}`);
    if (key === null) continue;
    const applied = AF_INTENTS[id].apply(base, key);
    check(applied !== base, `${id}.apply() changed something`);
    const cleared = AF_INTENTS[id].clear(applied);
    check(cleared !== applied, `${id}.clear() undid it`);
    // Round-trip: clearing an applied value must land back on a query that clear() calls untouched.
    check(AF_INTENTS[id].clear(cleared) === cleared, `${id}.clear() is idempotent`);
  }
}

// ── 7. SINGLE WRITER — no second place may edit the rejection list ────────────────────────────
// The defect this closes was two passes writing the same list. Assert structurally that only the
// per-turn reset and the one assignment remain. Comments stripped: prose is not a code path.
{
  const agent = readFileSync(new URL('../src/data/agent.ts', import.meta.url), 'utf8')
    .replace(/^\s*\/\/.*$/gm, '').replace(/^\s*\*.*$/gm, '');
  const writes = [...agent.matchAll(/lastRejectedFilters\s*(=|\.push\(|\.splice\()/g)].map((m) => m[0]);
  check(writes.length === 2, `exactly two writers to lastRejectedFilters remain (reset + assign), found ${writes.length}`,
    JSON.stringify(writes));
  check(!/lastRejectedFilters\s*\.push\(/.test(agent), 'nothing pushes onto lastRejectedFilters any more');
  check(/lastRejectedFilters = \[\];/.test(agent), 'the per-turn reset is still there');
  check(/lastRejectedFilters = res\.rejected;/.test(agent), 'the certification pass assigns the whole list');
  // And certification must still be reached from both turn kinds.
  check((agent.match(/certifyAfOnMergedState\(/g) ?? []).length >= 3,
    'listings AND message turns both route through certification');
}

console.log(failed === 0
  ? '\n✅ verify-af-certified-on-merged-state: all checks passed.'
  : `\n❌ verify-af-certified-on-merged-state: ${failed} check(s) failed.`);
process.exit(failed === 0 ? 0 : 1);
