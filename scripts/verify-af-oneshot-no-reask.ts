// AI CHAT ONE-SHOT: state it once, we apply it — and we never ask again.
// Owner ruling 2026-08-30: "Tell me everything you want once, and I'll understand Normal Filter +
// Advanced Filter together." Not "tell me everything, then I'll ask you the same questions again."
//
// WHAT THIS ADDS beyond verify-agent-af-intent-coverage.ts (which proves every certified AF question
// is REACHABLE from chat and gated by the real certification). This file proves the three behaviours
// the owner actually complained about, by EXECUTING the real registry against the real cohorts:
//
//   1. an explicit certified value APPLIES immediately — no questionnaire, no confirmation
//   2. a value the user did NOT state is never treated as stated (and never reported as rejected)
//   3. an uncertified value FAILS HONESTLY — surfaced as rejected, never silently applied
//
// plus the no-re-ask rule for the question whose re-asking prompted the complaint (rating).
//
// THE INVARIANT BEHIND ALL OF IT: DeepSeek may UNDERSTAND and PROPOSE; cohortAllows() decides what
// may be APPLIED. The model never invents AF semantics.
import { readFileSync } from 'node:fs';
import { cohortAllows } from '../src/lib/afCohorts.ts';
import { AF_INTENTS, GENERIC_INTENT_IDS, applyAfIntents } from '../src/lib/afIntents.ts';

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok || !detail ? '' : ` — ${detail}`}`);
  if (!ok) failures++;
};

const RES = { category: 'Residential', platforms: [], amenities: [] } as Record<string, unknown>;
const MONTHLY_APT = { ...RES, type: 'Apartment', deal: 'Rent', rentPeriod: 'monthly', location: 'منطقة الرياض' } as any;
const ANNUAL_APT  = { ...RES, type: 'Apartment', deal: 'Rent', rentPeriod: 'annual',  location: 'الرياض' } as any;
const BUY_VILLA   = { ...RES, type: 'Villa',     deal: 'Buy',                          location: 'الرياض' } as any;

// ── 1. THE OWNER'S EXACT SENTENCE ───────────────────────────────────────────────
// «أبي شقة شهرية في منطقة الرياض تقييمها ٩.٥ وفوق» — production returns
// {type: Apartment, rentPeriod: monthly, location: منطقة الرياض, af: {rating: "9.5"}}.
// The AF half must land in canonical state with no further question.
{
  const r = applyAfIntents(MONTHLY_APT, { rating: '9.5' });
  check('the owner case: explicit rating 9.5 is APPLIED, not asked about',
    (r.q as any).ratingMin === 9.5, `ratingMin=${(r.q as any).ratingMin}`);
  check('the owner case: nothing is reported as rejected', r.rejected.length === 0,
    JSON.stringify(r.rejected));
  check('the owner case: rating is certified for monthly apartments', cohortAllows(MONTHLY_APT, 'rating'));
}

// ── 2. EVERY INTENT: an explicit value applies on a cohort that certifies it ─────
// Derived from the registry, not hand-listed, so a new intent cannot quietly skip this proof.
const SAMPLES: Record<string, { value: unknown; cohort: any }> = {
  rating:        { value: '9.5',    cohort: MONTHLY_APT },
  bathrooms:     { value: 3,        cohort: ANNUAL_APT  },
  unit_subtype:  { value: 'استديو', cohort: MONTHLY_APT },
  property_age:  { value: '1_2',    cohort: ANNUAL_APT  },
  rnpl:          { value: 'rnpl',   cohort: ANNUAL_APT  },
  direction:     { value: ['شمال'], cohort: BUY_VILLA   },
  street_width:  { value: '20',     cohort: BUY_VILLA   },
  furnished:     { value: 'yes',    cohort: ANNUAL_APT  },
};
for (const id of GENERIC_INTENT_IDS) {
  const sample = SAMPLES[id];
  if (!sample) { check(`every intent has a one-shot sample (${id})`, false, 'add it to SAMPLES'); continue; }
  if (!cohortAllows(sample.cohort, id)) {
    check(`${id}: the chosen sample cohort certifies it`, false, 'sample cohort is wrong for this intent');
    continue;
  }
  const r = applyAfIntents(sample.cohort, { [id]: sample.value });
  const changed = JSON.stringify(r.q) !== JSON.stringify(sample.cohort);
  check(`${id}: an explicit value applies immediately (no questionnaire)`,
    changed && r.rejected.length === 0,
    `changed=${changed} rejected=${JSON.stringify(r.rejected)}`);
}

// ── 3. UNSTATED IS NOT STATED ───────────────────────────────────────────────────
// A live turn for «فيها مصعد وموقف» came back carrying every UNSTATED af key as "" or [].
// Neither may apply a filter, and neither may be reported to the user as something we failed to
// apply — apologising for a direction nobody asked for is a lie about what we did.
{
  const empties = { property_age: '', street_width: '', direction: [], bathrooms: '', rating: '', rnpl: '', unit_subtype: '' };
  const r = applyAfIntents(ANNUAL_APT, empties);
  check('unstated AF keys ("" / []) apply nothing', JSON.stringify(r.q) === JSON.stringify(ANNUAL_APT));
  check('unstated AF keys are NOT reported as rejected', r.rejected.length === 0, JSON.stringify(r.rejected));
}

// ── 4. UNCERTIFIED FAILS HONESTLY ───────────────────────────────────────────────
// rating is a Gathern/monthly signal: it must NOT apply to an annual-rent scope. The user is told,
// never silently filtered — and never silently ignored either.
{
  check('rating is NOT certified for annual rent', !cohortAllows(ANNUAL_APT, 'rating'));
  const r = applyAfIntents(ANNUAL_APT, { rating: '9.5' });
  check('an uncertified rating is NOT applied', (r.q as any).ratingMin === undefined);
  check('an uncertified rating IS surfaced as rejected (honest, not silent)',
    r.rejected.includes('rating'), JSON.stringify(r.rejected));
}

// ── 5. MULTI-TURN: changing one field preserves every unrelated field ────────────
{
  const turn1 = applyAfIntents(MONTHLY_APT, { rating: '9.5', bathrooms: 2 }).q as any;
  const turn2 = applyAfIntents(turn1, { unit_subtype: 'استديو' }).q as any;
  check('a follow-up preserves rating from the earlier turn', turn2.ratingMin === 9.5);
  check('a follow-up preserves bathrooms from the earlier turn', turn2.bathMin === 2);
  check('a follow-up preserves the normal-filter fields',
    turn2.type === 'Apartment' && turn2.deal === 'Rent' && turn2.rentPeriod === 'monthly'
    && turn2.location === 'منطقة الرياض');
}

// ── 6. NEVER RE-ASK A KNOWN VALUE ───────────────────────────────────────────────
// The rating question offers only rungs that can still NARROW the current floor, so once the user
// has said 9.5 there is nothing left to offer and the question cannot be re-asked. That monotone
// filter IS the no-re-ask guarantee for this question — pin it.
{
  const af = readFileSync('src/data/advancedFilters.ts', 'utf8');
  const ratingBlock = af.slice(af.indexOf('const RATING_QUESTION'), af.indexOf('const RATING_QUESTION') + 2000);
  check('the rating question only offers rungs that NARROW the current answer',
    /rungs\.filter\(\(d\) => parseFloat\(d\.key\) > floor/.test(ratingBlock),
    'without this, a user who said 9.5 is asked about 9.5 again');
  check('the rating floor is read from the query the user already filled',
    /const floor = q\.ratingMin \?\? 0/.test(ratingBlock));
  check('the bathrooms question is monotone too (same no-re-ask rule)',
    /bathMin/.test(af) && /Monotone/i.test(af));
}

// ── 7. THE MODEL MAY NOT INVENT AF SEMANTICS ────────────────────────────────────
{
  const r = applyAfIntents(MONTHLY_APT, { rating: 'ممتاز' });      // praise, not a number
  check('a vague word is never canonicalised into a rating number',
    (r.q as any).ratingMin === undefined, `ratingMin=${(r.q as any).ratingMin}`);
  const r2 = applyAfIntents(BUY_VILLA, { direction: ['northeast-ish'] });
  check('an unknown vocabulary value is rejected, not guessed',
    ((r2.q as any).directions ?? []).length === 0 && r2.rejected.length > 0);
  // Strip comments first: the edge DOCUMENTS cohortAllows in prose (it explains that the client owns
  // certification). Matching that comment would be the same "a comment is not a code path" trap this
  // repo keeps hitting — assert on code.
  const edge = readFileSync('supabase/functions/agent/index.ts', 'utf8')
    .split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');
  check('the edge never CALLS a certification predicate (certification is client-side, one gate)',
    !/cohortAllows\s*\(/.test(edge));
}

console.log(
  failures === 0
    ? `\n✓ one-shot AF understanding holds: ${GENERIC_INTENT_IDS.length} intents apply on sight, nothing re-asked, uncertified fails honestly`
    : `\n✗ ${failures} one-shot AF check(s) failed`,
);
process.exit(failures === 0 ? 0 : 1);
