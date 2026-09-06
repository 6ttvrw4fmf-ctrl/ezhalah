// THE COUNT AND THE SEARCH MUST SPEAK THE SAME RENT PERIOD — FROM ONE DERIVATION, NOT TWO COPIES.
// Auto-discovered barrier (scripts/verify-*.ts), offline, executes the REAL shipped function.
//
// THE CLASS THIS PINS (found 2026-09-06, regression hunter, composing #5's count surfaces with #4's
// results scope across the mixed-period axis — an axis the live sweep's own deal list and
// journeys.mjs's truthFilter() have no branch for, so no single-surface owner walks it).
//
// The Arabic rent-period token ('شهري' / 'سنوي' / 'كلاهما' / null) reaches production down TWO paths:
//
//   • the RESULTS path — remote.ts rentPeriodParam(q) → location_search_candidates_ar.p_rent_period;
//   • the COUNT path   — index.tsx rentPeriodTok → top_cities_by_deal_ar / district_options_ar and
//     every locations.ts pool wrapping them (Trending cities, Trending districts, the typed city and
//     district suggestions, and the caches keyed on it).
//
// Until 2026-09-06 the count path RE-DERIVED the token with a hand-written ternary whose comment
// called it "the SAME token remote.ts's rentPeriodParam() sends". That was a claim, not a shared
// function, and the two expressions disagreed on exactly one input:
//
//     bothDeals === true && deal === 'Rent'   →  results: null   ·  counts: 'سنوي'/'شهري'/'كلاهما'
//
// null means "apply NO period filter", which also admits rent rows whose source published no period
// at all — a strictly BROADER set than any of the three tokens. So the advertised Trending number
// would describe a different set than the search returns: the 2026-09-03 Trending-vs-results scope
// defect (recorded verbatim above searchTableScope() in remote.ts), on the period parameter instead
// of the table scope.
//
// It was unreachable — but only because sanitizeForFilterRestore()'s allowlist, in a THIRD file,
// strips bothDeals from every write into the store index.tsx binds to. §4 below EXECUTES that guard
// to keep the record honest, and then proves the parity no longer depends on it. Parity that rests
// on an unrelated guard in an unrelated file is not parity; it is a coincidence with a good track
// record.
//
// WHY A NEW FILE RATHER THAN EXTENDING verify-count-scope-parity.ts: that barrier pins that the token
// is THREADED to every pool call. It is a source-text tripwire over the plumbing and it stayed green
// for the entire time the two derivations could disagree — it has no opinion about how either one is
// COMPUTED. This file owns the VALUE; that one owns the wiring. Neither subsumes the other.
//
//   node --experimental-strip-types scripts/verify-rent-period-token-has-one-derivation.ts

import { readFileSync } from 'node:fs';
import { liftSymbols } from './lib/liftSymbols.ts';
import { sanitizeForFilterRestore } from '../src/lib/searchDefaults.ts';

const ROOT = new URL('..', import.meta.url).pathname;
const REMOTE_TS = `${ROOT}src/data/remote.ts`;
const INDEX_TSX = `${ROOT}src/app/index.tsx`;

// Lift the REAL function. Never a copy: a barrier made of a copy passes while production breaks
// (feedback_never-test-a-copy-of-production-code) — and a copy is the very defect this file exists
// for, so a copied assertion would be self-defeating.
// The header deliberately includes `export`: lifting a PRIVATE rentPeriodParam would mean the count
// path has been cut off from it and must be re-deriving the token somewhere — the defect itself. The
// lift is wrapped so that case reports a readable FAIL instead of a bare module-loader stack trace.
let failed = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${!ok && detail ? `\n      ${detail}` : ''}`);
};

const lifted = await liftSymbols(
  REMOTE_TS,
  [{ header: 'export function rentPeriodParam(' }],
  ['rentPeriodParam'],
  'type SearchQuery = any;',
).catch((e: unknown) => {
  check('remote.ts still EXPORTS rentPeriodParam so the count path can share it', false,
    `could not lift it: ${e instanceof Error ? e.message : String(e)}\n      `
    + 'If it was made private again, the count surfaces have no shared derivation to call — which is '
    + 'exactly how the two-copy defect returns.');
  console.log(`\n❌ ${failed} check(s) failed.`);
  process.exit(1);
});
const rentPeriodParam = lifted.rentPeriodParam as (q: Record<string, unknown>) => string | null;

// ── the query shapes, as a PRODUCT — not a handful of cases someone thought of ────────────────────
// Every combination of the four fields either derivation reads. 'garbage' and undefined are in the
// rentPeriod axis on purpose: a token derivation must never GUESS a period for a value it does not
// recognise (owner rule: period = source; unknown is never annual).
const DEALS = ['Rent', 'Buy', null, undefined];
const PERIODS = ['monthly', 'annual', 'both', 'garbage', undefined];
const BOOLS = [true, false, undefined];
const SHAPES: Array<Record<string, unknown>> = [];
for (const deal of DEALS) {
  for (const rentPeriod of PERIODS) {
    for (const bothDeals of BOOLS) {
      for (const dealCombined of BOOLS) SHAPES.push({ deal, rentPeriod, bothDeals, dealCombined });
    }
  }
}
const shapeLabel = (s: Record<string, unknown>) =>
  `deal=${s.deal} period=${s.rentPeriod} bothDeals=${s.bothDeals} dealCombined=${s.dealCombined}`;

console.log(`\n── the shared derivation, executed over all ${SHAPES.length} query shapes ──`);
check('the product is not empty (an empty sweep is a broken sweep, never a clean one)',
  SHAPES.length === DEALS.length * PERIODS.length * BOOLS.length * BOOLS.length && SHAPES.length > 100,
  `built ${SHAPES.length} shapes`);

// ── 1. THE TRUTH TABLE the one derivation must satisfy ────────────────────────────────────────────
// Stated as properties over the whole product, so a new query field cannot quietly escape them.
for (const s of SHAPES) {
  const tok = rentPeriodParam(s);
  const expectNull = s.bothDeals === true || s.dealCombined === true || s.deal !== 'Rent'
    || !['monthly', 'annual', 'both'].includes(String(s.rentPeriod));
  const expected = expectNull ? null
    : s.rentPeriod === 'monthly' ? 'شهري' : s.rentPeriod === 'annual' ? 'سنوي' : 'كلاهما';
  if (tok !== expected) {
    check(`token for ${shapeLabel(s)}`, false, `expected ${expected}, got ${tok}`);
    break;
  }
}
check('every shape maps to the documented token', failed === 0);
// The three facts a future edit is most likely to break, named so a failure says WHICH one broke.
check("bothDeals + Rent is null — 'apply no period filter', not a period",
  rentPeriodParam({ deal: 'Rent', rentPeriod: 'annual', bothDeals: true }) === null);
check('dealCombined + Rent is null (its Rent side has no period selector)',
  rentPeriodParam({ deal: 'Rent', rentPeriod: 'monthly', dealCombined: true }) === null);
check("an UNRECOGNISED period is null, never a guessed 'سنوي' (unknown is never annual)",
  rentPeriodParam({ deal: 'Rent', rentPeriod: 'garbage' }) === null
  && rentPeriodParam({ deal: 'Rent' }) === null);
check("'كلاهما' is its own token and is NOT null (null would sweep in unpublished-period rows)",
  rentPeriodParam({ deal: 'Rent', rentPeriod: 'both' }) === 'كلاهما');

// ── 2. THE COUNT PATH READS THAT FUNCTION — it does not re-derive the token ───────────────────────
console.log('\n── the count surfaces derive the token from the same function ──');
const remoteSrc = readFileSync(REMOTE_TS, 'utf8');
const indexSrc = readFileSync(INDEX_TSX, 'utf8');
check('remote.ts EXPORTS the one derivation (re-privatising it would force a second copy)',
  /^export function rentPeriodParam\(q: SearchQuery\): string \| null \{$/m.test(remoteSrc));
check('index.tsx imports it from remote.ts',
  /import \{[^}]*\brentPeriodParam\b[^}]*\} from '@\/data\/remote'/.test(indexSrc));
// WHAT THIS CHECK USED TO ASSERT, and why it was changed (2026-09-06, production red team).
// It matched the literal `= rentPeriodParam(query);` — pinning ONE ARGUMENT NAME as correct. That
// argument was the defect: `query` is the raw store object, whose `rentPeriod` is undefined for every
// fresh Rent search, so the count surfaces sent null while buildFilterBaseQuery defaulted to 'annual'
// and the search sent 'سنوي'. This check would have gone RED on the repair that fixes it, while
// staying GREEN for the whole time the two could disagree — PART 3.3 shape 2 of
// docs/ops/PRODUCTION_RED_TEAM_ENGINEER.md ("it asserts the defect"), the shape recorded there under
// verify-chat-persistence.ts:117. It now states the invariant it was always about: the token comes
// from the shared derivation and is not re-derived locally, whatever the input expression is NAMED.
// WHICH input is correct is a different invariant, owned by
// scripts/verify-count-and-search-share-one-query.ts — that file executes both paths and compares
// values, where this one owns the function. Neither subsumes the other.
check('index.tsx derives the count-surface token BY CALLING it (any input expression, never a local re-derivation)',
  /const rentPeriodTok: string \| null = rentPeriodParam\([A-Za-z_$][\w$.]*\);/.test(indexSrc),
  'the count token is no longer a plain call to the shared derivation — a second derivation is back');
// DISCOVERY, not a checklist: any surviving hand-written mapping from a period word to an Arabic
// token in index.tsx is a second derivation, whatever it is called. The period BUTTONS' own labels
// are plain literals in JSX and never sit next to a 'monthly'/'both' comparison, so they do not trip.
const SECOND_DERIVATION = /rentPeriod\s*===\s*'(?:monthly|annual|both)'\s*\?\s*'(?:شهري|سنوي|كلاهما)'/;
check('no second period→token mapping survives anywhere in index.tsx',
  !SECOND_DERIVATION.test(indexSrc),
  'a hand-written period→token ternary is back — that is the defect this file exists for');

// ── 3. MUTATION PROOF ─────────────────────────────────────────────────────────────────────────────
// EXECUTED, not grepped. The mutant is the PRE-2026-09-06 count-path derivation, transcribed exactly
// as index.tsx carried it, run over the SAME product as the real function. It must be caught — and
// caught on the shape production would actually have hit, not merely "somewhere".
console.log('\n── mutation ──');
const mustCatch = (what: string, caught: boolean, detail = '') =>
  check(`(mutation) catches ${what}`, caught,
    detail || 'MUTANT SURVIVED — the assertions above are blind to the defect this file exists for');

// index.tsx, pre-fix:
//   const rentPeriod = validRentPeriod(query.rentPeriod) ?? 'annual';
//   const effDeal    = query.dealCombined ? null : query.deal;
//   const rentPeriodTok = effDeal !== 'Rent' ? null
//     : rentPeriod === 'monthly' ? 'شهري' : rentPeriod === 'both' ? 'كلاهما' : 'سنوي';
const preFixCountToken = (q: Record<string, unknown>): string | null => {
  const valid = ['monthly', 'annual', 'both'].includes(String(q.rentPeriod)) ? String(q.rentPeriod) : undefined;
  const rentPeriod = valid ?? 'annual';
  const effDeal = q.dealCombined ? null : q.deal;
  return effDeal !== 'Rent' ? null
    : rentPeriod === 'monthly' ? 'شهري' : rentPeriod === 'both' ? 'كلاهما' : 'سنوي';
};

const divergences = SHAPES.filter((s) => preFixCountToken(s) !== rentPeriodParam(s));
mustCatch('the pre-2026-09-06 hand-written count-path derivation',
  divergences.length > 0,
  'MUTANT SURVIVED — the product sweep cannot see the two derivations disagree, so §1 proves nothing');
// And it is wrong in the exact way production would have been: the count claims a period where the
// search applies none. Every divergence must be of that shape — a mutant that differed some OTHER
// way would mean this file is catching the wrong thing.
mustCatch('…on bothDeals + Rent specifically — counts claim a period the search does not apply',
  divergences.some((s) => s.bothDeals === true && s.deal === 'Rent'
    && rentPeriodParam(s) === null && preFixCountToken(s) !== null),
  `divergences found on ${divergences.length} shapes, none of them the bothDeals+Rent one`);
mustCatch("…and on an unrecognised period, where the copy GUESSED 'سنوي'",
  divergences.some((s) => s.deal === 'Rent' && s.bothDeals !== true && s.dealCombined !== true
    && !['monthly', 'annual', 'both'].includes(String(s.rentPeriod))
    && rentPeriodParam(s) === null && preFixCountToken(s) === 'سنوي'),
  'the copy no longer guesses a period for an unrecognised value — check the mutant transcription');

// ── 4. THE PARITY NO LONGER RESTS ON A GUARD IN A THIRD FILE ──────────────────────────────────────
// sanitizeForFilterRestore()'s allowlist is what kept the divergence unreachable: it strips bothDeals
// from every write into the shared store the Filter home binds to. EXECUTE it, so this claim is a
// measurement rather than a reading — and so the record says plainly that the guard is real.
console.log('\n── the old reachability guard, executed (it is no longer load-bearing here) ──');
const restored = sanitizeForFilterRestore({
  deal: 'Rent', rentPeriod: 'annual', bothDeals: true, location: '', category: 'Residential',
  type: null, detail: null, priceInput: '', priceBand: null,
} as never) as Record<string, unknown>;
check('sanitizeForFilterRestore still strips bothDeals (the guard that made the old copy safe)',
  !restored.bothDeals,
  `bothDeals survived the allowlist as ${JSON.stringify(restored.bothDeals)} — the divergence this `
  + 'file removed would have been LIVE, not latent');
// The point of the repair: even if that guard were removed tomorrow, the count and the search would
// still agree, because there is only one derivation left to agree with.
check('and the two paths agree even for a query that DOES carry bothDeals (parity without the guard)',
  rentPeriodParam({ deal: 'Rent', rentPeriod: 'both', bothDeals: true }) === null);

console.log(failed === 0
  ? '\n✅ one derivation: the count surfaces and the results RPC cannot disagree about the rent period.'
  : `\n❌ ${failed} check(s) failed.`);
process.exit(failed === 0 ? 0 : 1);
