// RENT PERIOD "BOTH" — a user may ask for monthly AND annual in one search (owner feature 2026-08-14).
//
// The feature is only correct if FOUR things hold together. Each has a way of silently breaking:
//
//  1. 'both' is the UNION OF TWO KNOWN PERIODS, never "no period filter". `p_rent_period IS NULL` already
//     meant "don't filter", and that also sweeps in the rent rows whose SOURCE PUBLISHED NO PERIOD (510
//     live on 2026-08-14). Those are neither monthly nor annual; claiming them would be a derived answer.
//     So the client must send a distinct token ('كلاهما'), never null, and the RPC branch must be exactly
//     monthly-predicate OR annual-predicate.
//  2. The two MONTHLY-ONLY platforms (Gathern, Aqar Monthly) must be in scope. They are the only sources
//     that are wholly monthly, and `resTables` used to add them for `rentPeriod === 'monthly'` ALONE — so
//     a both-search would have quietly returned an annual-dominated pool while claiming to cover both.
//  3. A typed price must be read on ONE basis. Monthly scales the budget ×12 to compare price_annual;
//     annual doesn't. 'both' spans the two, so it takes the ANNUAL basis (the canonical stored unit) —
//     and must NOT fall through to the agent's ×12 magnitude heuristic, which would halve the ceiling.
//  4. Results must actually MIX. Annual outnumbers monthly ~43k:32k fleet-wide, so an un-mixed list can
//     open all-annual and the feature reads as broken. MATCH FIRST, DIVERSIFY SECOND: the period key only
//     re-orders rows the filter already matched, and stays nested INSIDE platform (owner's permanent
//     platform-outermost rule, 2026-07-13).
//
//   node --experimental-strip-types scripts/verify-rent-period-both.ts     (wired into `npm test`)

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { liftSearchScope } from './lib/liftSearchScope.ts';
import { orderByScope, type RankedRow } from '../src/lib/platformDiversity.ts';

const root = join(import.meta.dirname, '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');
// Strip comments so prose describing a rule can never satisfy the check for it.
const codeOnly = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (ok) { console.log(`PASS  ${label}`); return; }
  failures++;
  console.error(`FAIL  ${label}${detail ? `\n      ${detail}` : ''}`);
};

console.log('\nRent period «both» — union-of-known-periods, monthly sources in scope, one price basis, real mix\n');

const search = codeOnly(read('src/data/search.ts'));
const remote = codeOnly(read('src/data/remote.ts'));
const diversity = codeOnly(read('src/lib/platformDiversity.ts'));
const index = codeOnly(read('src/app/index.tsx'));
const i18n = read('src/i18n.tsx');   // dictionary keys live in a plain object; comments are irrelevant
// The migration must carry the union branch: the both-branch reuses BOTH existing predicates
// (payment_monthly for monthly, rent_period_ar/RNPL for annual) rather than inventing a third rule.
const migrations = readFileSync(join(root, 'supabase/migrations/20260815012506_rent_period_both_monthly_and_annual.sql'), 'utf8');

const SRC: Sources = { search, remote, diversity, index, i18n, migrations };

// The LOAD-BEARING text predicates, named and pure, so the mutation proofs at the bottom can feed
// them broken sources (added 2026-09-14, routine #10 / R1 — ops_incident #129). Every one of these
// guards a silent inventory or token loss: no error, no empty state, and until today a green suite.
//
// WHAT THE #129 SWEEP FOUND IN THIS FILE. The incident routed the CLASS because "the same file may
// hold more assertions of the same shape" — an assertion pinning one SPELLING that would go RED on
// its own correct repair. Swept 2026-09-14, all ~30 assertions: the two known instances are already
// repaired (line 190 now accepts any identifier as `rentPeriodParam`'s argument rather than pinning
// `(query)`, and the hand-written period ternary is now asserted ABSENT rather than required), and
// no third instance remains. What remained was that NONE of it had ever been watched to fail.
export type Sources = { search: string; remote: string; diversity: string; index: string; i18n: string; migrations: string };

export const TEXT = {
  admitsBoth: (s: Sources) => /rentPeriod\?:\s*'monthly'\s*\|\s*'annual'\s*\|\s*'both'/.test(s.search),
  bothIsARealToken: (s: Sources) => /q\.rentPeriod\s*===\s*'both'\s*\)?\s*return\s*'كلاهما'/.test(s.remote),
  migrationUnionsBothPredicates: (s: Sources) =>
    /p_rent_period\s*=\s*''كلاهما''\s*and\s*\(\s*s\.payment_monthly\s*=\s*true\s*or\s*s\.rent_period_ar\s*=\s*''سنوي''/.test(s.migrations),
  combinedWantsMonthly: (s: Sources) => /wantsMonthly\s*=\s*q\.dealCombined\s*\|\|/.test(s.remote),
  combinedPassesTheDealGate: (s: Sources) => /\(\s*q\.deal\s*===\s*'Rent'\s*\|\|\s*q\.dealCombined\s*\)\s*&&\s*wantsMonthly/.test(s.remote),
  // COUNTED, not merely matched (repaired 2026-09-14, routine #10). `src/data/search.ts` has TWO
  // independent price paths that each derive `explicitBoth` (priceFilter ~L887 and the agent cap
  // ~L1253), and the previous predicate — a bare `.test()` on each half — was satisfied by EITHER
  // one. It would have stayed GREEN with one of the two paths silently reverted to the ×12
  // magnitude heuristic. Found by a mutation that failed to bite: gutting the first declaration
  // left the check green because the second still matched. That is ops_incident #218's shape — a
  // check whose success sentence ("a 'both' budget is read on the annual basis") is broader than
  // the set it actually inspects. The invariant is that EVERY path deriving explicitBoth also
  // consumes it on the annual basis, so count both and require them to agree.
  budgetStaysOnTheAnnualBasis: (s: Sources) => {
    const declares = (s.search.match(/explicitBoth\s*=\s*q\.rentPeriod\s*===\s*'both'/g) ?? []).length;
    const consumes = (s.search.match(/explicitMonthly\s*\|\|\s*explicitAnnual\s*\|\|\s*explicitBoth\s*\?\s*amount/g) ?? []).length;
    return declares > 0 && declares === consumes;
  },
  // ONE derivation of the token: the count path imports it and calls it, and does NOT keep a second
  // hand-written ternary of its own. The argument's NAME is deliberately not pinned — pinning it is
  // the defect this very file was routed for (ops_incident #129/#136).
  countPathHasOneDerivation: (s: Sources) =>
    /import \{[^}]*\brentPeriodParam\b[^}]*\} from '@\/data\/remote'/.test(s.index)
    && /const rentPeriodTok: string \| null = rentPeriodParam\([A-Za-z_$][\w$.]*\);/.test(s.index)
    && !/rentPeriod\s*===\s*'(?:monthly|annual|both)'\s*\?\s*'(?:شهري|سنوي|كلاهما)'/.test(s.index),
  noBothToNullTrendingGap: (s: Sources) =>
    !/rentPeriod\s*===\s*'both'\s*\?\s*null\s*:\s*rentPeriod\s*===\s*'monthly'/.test(s.index),
  mixingOnlyForABothSearch: (s: Sources) =>
    /mixPeriods\s*=\s*!q\.bothDeals\s*&&\s*q\.deal\s*===\s*'Rent'\s*&&\s*q\.rentPeriod\s*===\s*'both'/.test(s.remote),
};

// ── 1. the type admits 'both', and the client sends a DISTINCT token (never null) ────────────────
check("SearchQuery.rentPeriod admits 'both'", TEXT.admitsBoth(SRC));

check("rentPeriodParam maps 'both' → 'كلاهما' (a real token, NOT null)",
  TEXT.bothIsARealToken(SRC),
  "returning null here would silently include rows whose source published no period at all");

check('migration defines the كلاهما branch as monthly-OR-annual (a true union)',
  TEXT.migrationUnionsBothPredicates(SRC),
  'the both-branch must reuse BOTH existing predicates verbatim, not invent a third rule');

check('migration excludes كلاهما from the passthrough branch (no double-match)',
  /not\s+in\s*\(''شهري'',''سنوي'',''كلاهما''\)/.test(migrations));

check('migration needle-edits from the LIVE body and aborts rather than rewriting blind',
  /pg_get_functiondef/.test(migrations) && /raise exception/i.test(migrations),
  'a full-body CREATE OR REPLACE from a stale copy is how predicates get silently reverted');

check('migration patches all THREE readers (counts must match results)',
  /location_search_candidates_ar/.test(migrations)
  && /apartment_guided_counts_ar/.test(migrations)
  && /property_age_option_counts_ar/.test(migrations));

// ── 2. monthly-only platforms are in scope whenever the period scope includes monthly ────────────
// EXECUTED, not text-matched (2026-09-03). This used to require the two table names to appear
// ADJACENT in the source — `'gathern_residential_listings', 'aqarmonthly_residential_listings'` —
// which was true only while resTables spliced them in by hand. They now live in the generated
// SEARCHABLE_TABLES inventory (alphabetical, so not adjacent) and are folded in generically by
// MONTHLY_ONLY_TABLE. A regex pinned to yesterday's LAYOUT cannot see today's BEHAVIOUR, in either
// direction: it went red on a correct refactor, and it would have gone green on a filter that
// returned the wrong set as long as the two strings stayed next to each other. So run the function.
const bothScope = await liftSearchScope(root);
const resTablesFn = bothScope.resTables as (q: { deal?: string; rentPeriod?: string; dealCombined?: boolean }) => string[];
const monthlyIn = (q: { deal?: string; rentPeriod?: string; dealCombined?: boolean }) =>
  resTablesFn(q).filter((t) => /^(gathern|aqarmonthly)_/.test(t)).sort();

check("resTables adds the monthly-only sources for 'both', not just 'monthly'",
  monthlyIn({ deal: 'Rent', rentPeriod: 'both' }).length >= 2
  && monthlyIn({ deal: 'Rent', rentPeriod: 'monthly' }).length >= 2,
  `both → [${monthlyIn({ deal: 'Rent', rentPeriod: 'both' }).join(', ')}] — without this a both-search `
  + 'returns an annual-only pool while claiming to cover both periods');

// The other side of the same rule, and the one an over-eager "just always include them" fix breaks:
// Gathern is monthly-only AND rent-only, so it must never reach a Buy or an ANNUAL rent result.
check('the monthly-only sources stay OUT of Buy and of an annual Rent search',
  monthlyIn({ deal: 'Buy' }).length === 0
  && monthlyIn({ deal: 'Rent', rentPeriod: 'annual' }).length === 0,
  `Buy → [${monthlyIn({ deal: 'Buy' }).join(', ')}], annual → [${monthlyIn({ deal: 'Rent', rentPeriod: 'annual' }).join(', ')}]`);

check("candidate-level period filter has an explicit 'both' branch",
  /rentPeriod\s*===\s*'both'\s*\)\s*\{[\s\S]{0,220}?\.in\(\s*'rent_period',\s*\[\s*'monthly',\s*'annual'\s*\]/.test(remote),
  "mixed platforms must still require a PUBLISHED monthly|annual period — a null one is neither");

// Buy+Rent COMBINED (owner feature 2026-08-20) is the THIRD way into the monthly pool, and until
// 2026-08-27 nothing pinned it — the two checks above only cover 'monthly'/'both', so deleting the
// dealCombined half of either clause left `npm test` fully green while every combined-mode search
// silently collapsed to an annual-only pool. Measured live that day against the production RPC:
// شقة/الرياض combined 30,632 → 21,862 (−8,770, −29%), شقة/جدة 25,242 → 20,063, غرفة/الخبر 53 → 40.
// Combined mode has NO period selector, so its Rent side accepts Monthly unconditionally and the
// two monthly-only sources must always be reachable — there is no user action that can re-add them.
check("resTables treats Buy+Rent COMBINED as wanting monthly (no period selector to ask with)",
  TEXT.combinedWantsMonthly(SRC),
  'dropping dealCombined here returns an annual-only pool for every combined search: ~29% of the '
  + 'matching inventory vanishes with no error, no empty state, and a green test suite');

check("resTables' deal gate admits dealCombined, not only a single-deal Rent search",
  TEXT.combinedPassesTheDealGate(SRC),
  'combined mode sends deal=null, so a gate testing only deal===Rent skips the monthly sources '
  + 'even while wantsMonthly is true — the same silent annual-only collapse by the other clause');

// ── 3. one price basis ───────────────────────────────────────────────────────────────────────────
check("priceFilter reads a 'both' budget on the annual basis (no ×12 heuristic fallthrough)",
  TEXT.budgetStaysOnTheAnnualBasis(SRC),
  'falling through to the magnitude heuristic would ×12 a ≤25k budget and silently shrink the ceiling');

check("agentPriceCapAnnual returns a 'both' budget unscaled (already annual)",
  /q\.rentPeriod\s*===\s*'both'\s*\)\s*return\s+amount\s*;/.test(remote));

// ── 4. results actually mix, without displacing platform as the outermost key ────────────────────
// EXECUTED, not grepped (the source-text form of this check broke when the diversity key order was
// restructured on 2026-09-14 even though the INVARIANT held). Two platforms × two periods, evenly
// split. With mixPeriods on: periods must alternate (both visibly present, nested), AND platform must
// stay the outermost key — the period sequence must NOT be a clean AAAA…BBBB that would mean platform
// got displaced. Runs the REAL orderByScope.
{
  type PL = { cleanType?: string | null; rentPeriod?: string | null };
  const mk = (id: number, platform: string, period: string): RankedRow<PL> => ({
    l: { cleanType: 'Apartment', rentPeriod: period }, platform,
    city: 'الرياض', region: 'منطقة الرياض', district: 'حي النرجس', source_table: `${platform}_res`, rank: id,
  });
  const rows: RankedRow<PL>[] = [];
  let id = 1;
  for (const p of ['aqar', 'wasalt']) for (const per of ['شهري', 'سنوي']) for (let k = 0; k < 4; k++) rows.push(mk(id++, p, per));
  const mixed = orderByScope(rows, 'city', false, /* mixPeriods */ true);
  const worst = <T,>(seq: T[]) => { let w = 1, c = 1; for (let i = 1; i < seq.length; i++) { if (seq[i] === seq[i - 1]) c++; else c = 1; if (c > w) w = c; } return w; };
  check("mixPeriods=true actually alternates periods (both present, nested — not annual-only)",
    worst(mixed.map((r) => r.l.rentPeriod)) < rows.length,
    `period streak=${worst(mixed.map((r) => r.l.rentPeriod))}, seq=${mixed.map((r) => r.l.rentPeriod).join('|')}`);
  check("platform stays the OUTERMOST key — period never displaces it (PERMANENT owner rule 2026-07-13)",
    worst(mixed.map((r) => r.platform)) === 1,
    `platform streak=${worst(mixed.map((r) => r.platform))}, seq=${mixed.map((r) => r.platform).join('|')}`);
}

check("the diversity key reads the listing's own rentPeriod",
  /k\s*===\s*'period'\s*\?\s*\(r\.l\.rentPeriod\s*\?\?\s*''\)/.test(diversity));

check("remote.ts turns mixing on only for an actual both-search",
  TEXT.mixingOnlyForABothSearch(SRC));

// ── UI + copy (owner 2026-08-19: كلاهما button REMOVED — سنوي/شهري are independent toggles) ────────
check("the Filter offers ONLY two period buttons (سنوي/شهري) — no third «Both» button in the UI",
  /\(\['annual',\s*'monthly'\]\s*as const\)\.map/.test(index)
  && !/options=\{\['Monthly',\s*'Yearly',\s*'Both'\]\}/.test(index),
  'a third visible Both button was explicitly banned by the owner — both periods reach the same query value via independent toggles instead');

check("both toggle buttons route through togglePeriodButton (one canonical transition function)",
  /togglePeriodButton\(rentPeriod,\s*which\)/.test(index));

// 2026-09-06 (regression hunter): this assertion used to match the literal hand-written ternary
//     rentPeriod === 'monthly' ? 'شهري' … rentPeriod === 'both' ? 'كلاهما'
// in index.tsx — that is, it REQUIRED the count path to keep its own second derivation of the token,
// and would have gone red on the very repair that removes the divergence. It stayed green for the
// whole time the two derivations could disagree (on bothDeals + deal 'Rent', where the results RPC
// sends null and the copy sent a period token). The invariant was never "the ternary is spelled this
// way"; it is "the pools speak the token the results RPC speaks". There is now ONE derivation, so
// state THAT — strictly stronger than matching a shape, because a shape can be right and still be a
// second opinion. The executable proof (the real function run over all 180 query shapes, mutation-
// proven both ways) lives in scripts/verify-rent-period-token-has-one-derivation.ts.
check("city/district pools use the SAME 'شهري'/'سنوي'/'كلاهما' token as the results RPC, never a bare boolean",
  TEXT.countPathHasOneDerivation(SRC),
  "a combined search must send the EXACT كلاهما token to Trending too — null would wrongly include "
  + "unpublished-period rows (docs/ARCHITECTURE.md §17). The count path must take that token from "
  + "remote.ts's exported rentPeriodParam(), not re-derive it: two expressions that agree today are "
  + 'a coincidence, not a guarantee.');

check("the old boolean-scoped 'both → null' Trending gap is gone",
  TEXT.noBothToNullTrendingGap(SRC),
  'this shape sent a broader, wrong-scope pool to Trending for a combined search — the exact gap this fix closes');

// The owner's copy rule: state the price BASIS, never assert a lease length no source publishes.
// 'both' wording trimmed 2026-08-22 (owner feedback): dropped the "this means you want both, so
// you get both" framing — selecting both buttons is already self-explanatory. Kept only the one
// genuinely non-obvious fact: mixed results carry mixed price units.
for (const [label, key] of [
  ['monthly', 'Monthly: the displayed price is the monthly price.'],
  ['yearly', 'Yearly: the displayed price is the yearly price.'],
  ['both', 'Each listing shows its own price basis (monthly or yearly).'],
] as const) {
  check(`${label} period hint has an Arabic translation (no English key leak)`, i18n.includes(`'${key}'`));
}
check("the 'both' hint no longer re-explains what selecting both buttons already means (owner feedback 2026-08-22)",
  !index.includes('Both: monthly and yearly listings together'));
// Comment-stripped: a NEGATIVE check must not be tripped by prose that merely QUOTES the banned copy
// (the comment above these keys explains what was removed and why — that is documentation, not a claim).
check("period hints never assert a contract/lease length (owner 2026-08-14)",
  !/عقد لمدة 12 شهر|عقد من 1 إلى 11 شهر|من شهر إلى 11/.test(codeOnly(i18n)),
  'no source publishes the lease term — say what the displayed price means instead');

check('the Monthly note is the OWNER-EXACT wording (2026-08-18): «الأسعار معروضة بالشهر» — price basis only, never a contract-length claim',
  /'الأسعار معروضة بالشهر'/.test(i18n));
check("'Both' and the both-verb are translated", /'Both':\s*'كلاهما'/.test(i18n) && /'to rent monthly or yearly':/.test(i18n));

// ─────────────────────────────────────────────────────────────────────────────
// MUTATION PROOFS (2026-09-14, routine #10 / R1 — ops_incident #129). Each re-introduces a real,
// measured regression into a COPY of the REAL source and watches the predicate above go red. Every
// one of these defects loses inventory or sends the wrong token SILENTLY — no error, no empty state
// — which is exactly why "the suite is green" was never evidence here.
//
// The two EXECUTED blocks above (resTables via liftSearchScope, orderByScope run on real rows) carry
// their own proof by construction: they run the shipped function and compare its output, so a broken
// implementation fails them directly. These proofs cover the TEXT half, which had none.
// ─────────────────────────────────────────────────────────────────────────────
let mutFail = 0;
const mustCatch = (label: string, caught: boolean) => {
  if (caught) { console.log(`PASS  (mutation) catches ${label}`); return; }
  mutFail++;
  console.error(`FAIL  (mutation) BLIND to ${label}`);
};
const withSrc = (patch: Partial<Sources>): Sources => ({ ...SRC, ...patch });

mustCatch("'both' sending NULL instead of the كلاهما token — which stops filtering entirely and sweeps in the 510 rows whose source published NO period",
  !TEXT.bothIsARealToken(withSrc({ remote: remote.replace(/return\s*'كلاهما'/, 'return null') })));

mustCatch('the RPC both-branch narrowed from a true union to the monthly predicate alone (every annual row silently lost)',
  !TEXT.migrationUnionsBothPredicates(withSrc({
    migrations: migrations.replace(/or\s*s\.rent_period_ar\s*=\s*''سنوي''/, '') })));

mustCatch('the dealCombined half of wantsMonthly being dropped — the measured 2026-08-27 collapse: شقة/الرياض 30,632 → 21,862 (−29%) with a green suite',
  !TEXT.combinedWantsMonthly(withSrc({ remote: remote.replace(/wantsMonthly\s*=\s*q\.dealCombined\s*\|\|/, 'wantsMonthly =') })));

mustCatch("…and the same collapse through the other clause: a deal gate testing only deal==='Rent', which combined mode (deal=null) never satisfies",
  !TEXT.combinedPassesTheDealGate(withSrc({
    remote: remote.replace(/\(\s*q\.deal\s*===\s*'Rent'\s*\|\|\s*q\.dealCombined\s*\)\s*&&\s*wantsMonthly/, "q.deal === 'Rent' && wantsMonthly") })));

mustCatch("a 'both' budget falling through to the ×12 magnitude heuristic, halving the user's ceiling — in EITHER of the two price paths, not just the first",
  !TEXT.budgetStaysOnTheAnnualBasis(withSrc({
    search: search.replace(/explicitBoth\s*=\s*q\.rentPeriod\s*===\s*'both'/, 'explicitBoth = false') })));

mustCatch('…and the SECOND price path being the one reverted (the case the un-counted predicate was blind to — ops_incident #218 shape)',
  !TEXT.budgetStaysOnTheAnnualBasis(withSrc({
    search: search.replace(/(explicitBoth\s*=\s*q\.rentPeriod\s*===\s*'both'[\s\S]*)explicitBoth\s*=\s*q\.rentPeriod\s*===\s*'both'/, '$1explicitBoth = false') })));

mustCatch('…and a THIRD price path arriving that derives explicitBoth but never consumes it on the annual basis',
  !TEXT.budgetStaysOnTheAnnualBasis(withSrc({
    search: `${search}\n    const explicitBoth = q.rentPeriod === 'both';\n    return amount * 12;` })));

mustCatch('the count path re-growing a SECOND hand-written derivation of the period token (the ops_incident #129 defect itself)',
  !TEXT.countPathHasOneDerivation(withSrc({
    index: `${index}\nconst tok = rentPeriod === 'monthly' ? 'شهري' : rentPeriod === 'both' ? 'كلاهما' : 'سنوي';` })));

mustCatch('…and the count path dropping the shared import so it derives the token alone',
  !TEXT.countPathHasOneDerivation(withSrc({
    index: index.replace(/import \{([^}]*)\brentPeriodParam\b([^}]*)\} from '@\/data\/remote'/, "import {$1$2} from '@/data/remote'") })));

mustCatch("the old boolean-scoped 'both → null' Trending gap coming back",
  !TEXT.noBothToNullTrendingGap(withSrc({
    index: `${index}\nconst p = rentPeriod === 'both' ? null : rentPeriod === 'monthly' ? 'شهري' : 'سنوي';` })));

mustCatch('period mixing being turned on for searches that never asked for both periods',
  !TEXT.mixingOnlyForABothSearch(withSrc({
    remote: remote.replace(/mixPeriods\s*=\s*!q\.bothDeals\s*&&\s*q\.deal\s*===\s*'Rent'\s*&&\s*q\.rentPeriod\s*===\s*'both'/, 'mixPeriods = true') })));

// NEGATIVE CONTROL. A predicate red for everything is as useless as one green for everything, and
// this is the line that catches an over-broad repair.
mustCatch('…while the sources as they actually ship pass EVERY one of these predicates (none is vacuously red)',
  Object.values(TEXT).every((p) => p(SRC)));

if (failures || mutFail) {
  if (failures) console.error(`\n✗ ${failures} check(s) FAILED — the both-period feature is not intact\n`);
  if (mutFail) console.error(`✗ ${mutFail} mutation(s) went UNCAUGHT — this guard cannot see the defects it exists for\n`);
  process.exit(1);
}
console.log('\n✓ rent-period «both» intact: true union, monthly sources in scope, annual price basis, mixed output — and proven to fail on each\n');
