// THE COUNT AND THE SEARCH MUST BE HANDED THE SAME QUERY — SHARING THE FUNCTION IS ONLY HALF OF PARITY.
// Auto-discovered barrier (scripts/verify-*.ts), offline, EXECUTES the REAL shipped expressions.
//
// THE CLASS THIS PINS (found 2026-09-06, production red team, auditing the SAME-DAY fix 4a36ef8).
//
// 4a36ef8 removed a hand-written period→token ternary from src/app/index.tsx and made the count
// surfaces call remote.ts's exported rentPeriodParam() — one derivation instead of two. That was the
// right repair and it is kept. But parity has TWO halves: one FUNCTION, and one INPUT. The ternary it
// replaced read the component's NORMALISED local
//
//     const rentPeriod = validRentPeriod(query.rentPeriod) ?? 'annual';
//
// while `rentPeriodParam(query)` reads `query.rentPeriod` RAW. The store holds `undefined` there for
// every Rent search until the user taps a period button:
//
//   • HOME_DEFAULT_QUERY() = { ...emptyQuery(), deal: 'Buy' } never sets rentPeriod, and
//     sanitizeForFilterRestore() restores `validRentPeriod(q.rentPeriod) ?? base.rentPeriod`, i.e. undefined;
//   • tapping «إيجار» writes only { deal, dealCombined } — it never sets a period;
//   • tapping «سنوي» is a documented no-op there (`if ((q.rentPeriod ?? 'annual') === next) return q;`).
//
// So the DEFAULT state of every Rent search — the one the screen renders with «سنوي» VISIBLY SELECTED —
// sent, from 4a36ef8 until this file:
//
//     COUNT surfaces (top_cities_by_deal_ar / district_options_ar and every locations.ts pool):  null
//     RESULTS RPC    (buildFilterBaseQuery → `query.rentPeriod ?? 'annual'` → rentPeriodParam):  'سنوي'
//
// null means "apply NO period filter", which also admits monthly rows and rent rows whose source
// published no period at all — a strictly BROADER set. The advertised Trending/city/district number
// therefore described a WIDER set than the search returned: the 2026-09-03 Trending-vs-results scope
// class again, in the opposite direction from the one 4a36ef8 fixed, and on the one state every Rent
// search starts in rather than on a state a guard in a third file made unreachable.
//
// It never shipped — the live bundle still carried the pre-4a36ef8 ternary when this was found, so
// production was never wrong. It was latent in main, one deploy away.
//
// THE INVARIANT, and why it is stated this way. Not "both call rentPeriodParam" (4a36ef8 satisfied
// that and still diverged) and not "the two expressions look alike" (a shape can be right and still
// be a second opinion). The invariant is a VALUE equality over every reachable store state:
//
//     for every store state S:  rentPeriodParam(what the COUNT path sends)
//                            === rentPeriodParam(what the SEARCH path sends)
//
// established by EXECUTING the real shipped expressions — lifted out of src/app/index.tsx and
// src/data/remote.ts by anchor, never transcribed. A transcription would be a second, unshipped
// program, which is the very defect this file exists for (feedback_never-test-a-copy-of-production-code).
//
// WHY A NEW FILE RATHER THAN EXTENDING verify-rent-period-token-has-one-derivation.ts: that barrier
// owns the shared FUNCTION's truth table and it was GREEN for the whole time this divergence existed —
// it could not see it, because it executes rentPeriodParam against query objects IT builds
// (`rentPeriodParam({ deal: 'Rent' })`) rather than against the object the screen actually threads.
// Worse, its check "an UNRECOGNISED period is null, never a guessed 'سنوي'" ASSERTS the divergent
// value as correct, and its own mutation proof requires the pre-fix (agreeing) behaviour to be
// flagged as the mutant. That is PART 3.3 shapes 2 and 3 of docs/ops/PRODUCTION_RED_TEAM_ENGINEER.md.
// It is not wrong about the FUNCTION — unknown is never annual is the right rule for a token derived
// from a period value — so it is left as it is. This file owns the INPUT: whatever the function does,
// both paths must hand it the same thing. Neither subsumes the other.
//
//   node --experimental-strip-types scripts/verify-count-and-search-share-one-query.ts

import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { liftSymbols } from './lib/liftSymbols.ts';

const ROOT = new URL('..', import.meta.url).pathname;
const INDEX_TSX = `${ROOT}src/app/index.tsx`;
const REMOTE_TS = `${ROOT}src/data/remote.ts`;

let failed = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${!ok && detail ? `\n      ${detail}` : ''}`);
};

// ── lifting the REAL expressions out of the component body ────────────────────────────────────────
// index.tsx's period logic lives inside `export default function Home()`, so liftSymbols' top-level
// declaration lift cannot reach it. These anchors take the SHIPPED lines verbatim and fail LOUDLY if
// the shape moved — a barrier that silently lifted nothing would be the "empty check is a broken
// check" failure, so `anchor()` throws rather than returning ''.
const indexSrc = readFileSync(INDEX_TSX, 'utf8');
const indexLines = indexSrc.split('\n');

function anchor(startsWith: string, endRe = /;\s*$/): string {
  const start = indexLines.findIndex((l) => l.startsWith(startsWith));
  if (start < 0) {
    throw new Error(
      `no line in src/app/index.tsx starts with ${JSON.stringify(startsWith)}.\n`
      + '      The shipped expression this barrier executes has moved or been renamed. Re-anchor it —\n'
      + '      do NOT transcribe it, or this file becomes a second unshipped program.');
  }
  for (let i = start; i < indexLines.length; i++) {
    if (endRe.test(indexLines[i])) return indexLines.slice(start, i + 1).join('\n');
  }
  throw new Error(`no terminator ${endRe} after ${JSON.stringify(startsWith)} in src/app/index.tsx`);
}

// The shipped lines that decide the period on each path.
const L_RENT_PERIOD = anchor("  const rentPeriod: 'monthly' | 'annual' | 'both' =");
const L_EFF_DEAL = anchor('  const effDeal = ');
const L_RENT_PERIOD_TOK = anchor('  const rentPeriodTok');
const L_BUILD_BASE = anchor('  const buildFilterBaseQuery = ', /^ {2}\};$/);
// The COUNT surfaces' parameter object (Trending cities/districts and every locations.ts pool wrap
// this). Section 4 executes it: whatever index.tsx hands the shared builder here is the count path's
// input, and it must be the same object the search path runs on.
const L_CITY_AF = anchor('  const cityAfRaw = ');

// queryForPeriod — the ONE normalised object both paths read — is the repair itself, so its absence is
// the regression rather than a re-anchoring problem. Falling back to `= query` reproduces exactly what
// the code did before it existed (each path reading the raw store query and defaulting on its own),
// so a revert is caught BY VALUE, with the real divergence printed, instead of by a missing-anchor
// stack trace that says nothing about what broke.
const HAS_SHARED_INPUT = indexLines.some((l) => l.startsWith('  const queryForPeriod'));
const L_QUERY_FOR_PERIOD = HAS_SHARED_INPUT
  ? anchor('  const queryForPeriod')
  : '  const queryForPeriod: SearchQuery = query;';
check('src/app/index.tsx normalises the period ONCE, into a shared object both paths read',
  HAS_SHARED_INPUT,
  'queryForPeriod is gone — the count token and buildFilterBaseQuery each read the raw store query '
  + 'and default separately, which is the 4a36ef8 divergence. The value checks below print it.');

check('the four shipped period expressions were lifted from src/app/index.tsx (not transcribed)',
  [L_RENT_PERIOD, L_EFF_DEAL, L_QUERY_FOR_PERIOD, L_RENT_PERIOD_TOK, L_BUILD_BASE].every((s) => s.length > 0));

// The REAL shared derivation, lifted from remote.ts exactly as verify-rent-period-token-has-one-
// derivation.ts does. Lifting it by its `export` header is itself an assertion: if it were made
// private again the count path could not call it and would have to re-derive.
const lifted = await liftSymbols(
  REMOTE_TS, [{ header: 'export function rentPeriodParam(' }], ['rentPeriodParam'], 'type SearchQuery = any;',
).catch((e: unknown) => {
  check('remote.ts still EXPORTS rentPeriodParam (the one derivation both paths share)', false,
    `could not lift it: ${e instanceof Error ? e.message : String(e)}`);
  console.log(`\n❌ ${failed} check(s) failed.`);
  process.exit(1);
});
const realRentPeriodParam = lifted.rentPeriodParam as (q: Record<string, unknown>) => string | null;

// The REAL narrowing builder and its whole price chain, lifted the same way. agentPriceCapAnnual is
// the one that makes this section necessary: it reads q.rentPeriod DIRECTLY and falls back to a
// magnitude heuristic when it is unset, so "which query object did this path get" is worth 12x on
// p_price_max. cohortTypesAr/bedroomTokens are shimmed — they carry NO period logic (p_types is
// dropped by rpcAllNarrowingParams anyway), and section 5 covers what a shim cannot execute.
const liftedNarrow = await liftSymbols(
  REMOTE_TS,
  [
    { header: 'const pnum = ', endsWith: /;\s*$/ },
    { header: 'function agentPriceCapAnnual(' },
    { header: 'export function rentPeriodParam(' },
    { header: 'export function rpcAdvancedFilterParams(' },
    { header: 'function rpcFilterParams(' },
    { header: 'export function rpcAllNarrowingParams(' },
  ],
  ['rpcAllNarrowingParams'],
  `type SearchQuery = any;
const RPC_SORT_KEYS = new Set(['oldest','price_asc','price_desc','area_asc','area_desc','beds_desc']);
function cohortTypesAr(_q: any) { return null; }
function bedroomTokens(_q: any) { return []; }`,
).catch((e: unknown) => {
  check('remote.ts still exposes rpcAllNarrowingParams and its price chain', false,
    `could not lift it: ${e instanceof Error ? e.message : String(e)}`);
  console.log(`\n❌ ${failed} check(s) failed.`);
  process.exit(1);
});
const realNarrowing = liftedNarrow.rpcAllNarrowingParams as (q: Record<string, unknown>) => Record<string, unknown>;

// ── build an executable module out of those real lines ────────────────────────────────────────────
// The shims (`citySelected`, `resolveCitySelection`) carry NO period logic — buildFilterBaseQuery uses
// them only for location/locationMatch. Everything that touches the period is the shipped text.
type Pair = { countToken: (q: Record<string, unknown>) => string | null;
              searchToken: (q: Record<string, unknown>) => string | null;
              uiSelectedPeriod: (q: Record<string, unknown>) => string | null };

async function buildPair(parts: {
  rentPeriod?: string; effDeal?: string; queryForPeriod?: string; rentPeriodTok?: string; buildBase?: string;
} = {}): Promise<Pair> {
  const src = `
type SearchQuery = any;
import { validRentPeriod } from '${ROOT}src/lib/searchDefaults.ts';
${(parts.rentPeriod ?? L_RENT_PERIOD).replace(/^ {2}/gm, '')}
${''}
export function countToken(query: any, rentPeriodParam: any): string | null {
${parts.rentPeriod ?? L_RENT_PERIOD}
${parts.effDeal ?? L_EFF_DEAL}
${parts.queryForPeriod ?? L_QUERY_FOR_PERIOD}
${parts.rentPeriodTok ?? L_RENT_PERIOD_TOK}
  return rentPeriodTok;
}
export function searchToken(query: any, rentPeriodParam: any): string | null {
${parts.rentPeriod ?? L_RENT_PERIOD}
${parts.effDeal ?? L_EFF_DEAL}
${parts.queryForPeriod ?? L_QUERY_FOR_PERIOD}
  const citySelected = { cityId: 1 } as any;
  const resolveCitySelection = (_c: any) => ({ label: 'x' } as any);
${parts.buildBase ?? L_BUILD_BASE}
  return rentPeriodParam(buildFilterBaseQuery());
}
// What the SCREEN RENDERS as the selected period button. The OptionBox 'selected' props read this
// same local (\`rentPeriod === 'monthly' || rentPeriod === 'both'\` / annual), so this IS the visible
// state — L1 in docs/ops/PRODUCTION_RED_TEAM_ENGINEER.md's chain, read from the shipped expression.
export function uiSelectedPeriod(query: any): string | null {
${parts.rentPeriod ?? L_RENT_PERIOD}
${parts.effDeal ?? L_EFF_DEAL}
  return effDeal === 'Rent' ? rentPeriod : null;
}
`;
  // The top-level copy of the rentPeriod line above is dead weight for the module scope; drop it by
  // rebuilding without it (kept out of the template to avoid a duplicate-declaration parse error).
  const clean = src.split('\n').filter((l, i, a) => !(i > 2 && i < 5 && a[i].startsWith('const rentPeriod'))).join('\n');
  const dir = mkdtempSync(join(tmpdir(), 'ezhalah-redteam-'));
  const out = join(dir, 'pair.mts');
  writeFileSync(out, clean);
  const mod = await import(out);
  return {
    countToken: (q) => mod.countToken(q, realRentPeriodParam),
    searchToken: (q) => mod.searchToken(q, realRentPeriodParam),
    uiSelectedPeriod: (q) => mod.uiSelectedPeriod(q),
  };
}

/** The Arabic token a given VISIBLE period selection must produce. */
const TOKEN_FOR = { monthly: 'شهري', annual: 'سنوي', both: 'كلاهما' } as Record<string, string>;

// ── the store states, as a PRODUCT ────────────────────────────────────────────────────────────────
// `undefined` is in the rentPeriod axis because that is what the store ACTUALLY holds for a fresh Rent
// search — the state this defect lived on. 'garbage' is there because a barrier must not assume the
// store only ever holds values the type says it holds.
const DEALS = ['Rent', 'Buy'];
const PERIODS = ['monthly', 'annual', 'both', undefined, 'garbage'];
const BOOLS = [true, false, undefined];
const SHAPES: Array<Record<string, unknown>> = [];
for (const deal of DEALS) for (const rentPeriod of PERIODS)
  for (const bothDeals of BOOLS) for (const dealCombined of BOOLS)
    SHAPES.push({ deal, rentPeriod, bothDeals, dealCombined, location: '', category: 'Residential' });

check('the product is not empty (an empty sweep is a broken sweep, never a clean one)',
  SHAPES.length === DEALS.length * PERIODS.length * BOOLS.length * BOOLS.length && SHAPES.length > 50,
  `built ${SHAPES.length} shapes`);

const label = (s: Record<string, unknown>) =>
  `deal=${s.deal} period=${String(s.rentPeriod)} bothDeals=${String(s.bothDeals)} dealCombined=${String(s.dealCombined)}`;

/** Every store state on which the two paths send a different p_rent_period. */
function divergences(p: Pair): Array<{ s: Record<string, unknown>; c: string | null; r: string | null }> {
  const out: Array<{ s: Record<string, unknown>; c: string | null; r: string | null }> = [];
  for (const s of SHAPES) {
    const c = p.countToken(s), r = p.searchToken(s);
    if (c !== r) out.push({ s, c, r });
  }
  return out;
}

// ── 1. THE INVARIANT, on the shipped code ─────────────────────────────────────────────────────────
console.log(`\n── the two paths, executed over all ${SHAPES.length} store states ──`);
const shipped = await buildPair();
const shippedDiv = divergences(shipped);
check('the COUNT surfaces and the RESULTS RPC send the same p_rent_period for every store state',
  shippedDiv.length === 0,
  shippedDiv.map(({ s, c, r }) =>
    `${label(s)}\n        counts send ${c === null ? 'NULL (no period filter)' : c}`
    + `, search sends ${r === null ? 'NULL' : r}`).join('\n      '));

// The one state the defect lived on, named so a failure says WHICH state broke.
const DEFAULT_RENT = { deal: 'Rent', rentPeriod: undefined, bothDeals: false, dealCombined: false };
check("the DEFAULT Rent search (user taps «إيجار» and nothing else — «سنوي» is what the screen shows selected)",
  shipped.countToken(DEFAULT_RENT) === shipped.searchToken(DEFAULT_RENT)
  && shipped.countToken(DEFAULT_RENT) === 'سنوي',
  `counts=${JSON.stringify(shipped.countToken(DEFAULT_RENT))} search=${JSON.stringify(shipped.searchToken(DEFAULT_RENT))}`
  + ' — the screen renders «سنوي» selected here, so anything else advertises a set the search will not return');

// bothDeals/dealCombined must still be null on BOTH paths — 4a36ef8's own win, kept.
check("bothDeals + Rent is NULL on both paths (4a36ef8's repair is preserved, not undone)",
  shipped.countToken({ deal: 'Rent', rentPeriod: 'annual', bothDeals: true }) === null
  && shipped.searchToken({ deal: 'Rent', rentPeriod: 'annual', bothDeals: true }) === null);
check('dealCombined + Rent is NULL on both paths (its Rent side has no period selector)',
  shipped.countToken({ deal: 'Rent', rentPeriod: 'monthly', dealCombined: true }) === null
  && shipped.searchToken({ deal: 'Rent', rentPeriod: 'monthly', dealCombined: true }) === null);

// ── 1b. AND BOTH MUST MATCH WHAT THE SCREEN SHOWS SELECTED ────────────────────────────────────────
// Parity between two requests is not enough: they could agree with each other and both contradict the
// user. This is the L1↔L2/L3 link — the visible period button vs the p_rent_period actually sent —
// and it is what makes "the counts and the search both stopped filtering" a FAILURE here rather than
// a consistent pair. A single-deal Rent search always shows exactly one period state selected.
console.log('\n── and both agree with the period the screen shows selected ──');
function uiMismatches(p: Pair) {
  return SHAPES.filter((s) => {
    const ui = p.uiSelectedPeriod(s);
    if (ui === null) return false;                    // Buy / combined: no period control is shown
    if (s.bothDeals === true) return false;           // not reachable through the Filter store (allowlist)
    return p.countToken(s) !== TOKEN_FOR[ui] || p.searchToken(s) !== TOKEN_FOR[ui];
  });
}
const shippedUi = uiMismatches(shipped);
check('every visible period selection is the period both requests actually carry',
  shippedUi.length === 0,
  shippedUi.map((s) => `${label(s)}\n        screen shows ${shipped.uiSelectedPeriod(s)}`
    + `, counts send ${JSON.stringify(shipped.countToken(s))}, search sends ${JSON.stringify(shipped.searchToken(s))}`)
    .join('\n      '));

// ── 2. ONE NORMALISATION, not two ─────────────────────────────────────────────────────────────────
// The structural half of the same fact: buildFilterBaseQuery must READ queryForPeriod, never re-apply
// a default of its own. Two normalisations that agree today are the shape this defect had.
console.log('\n── one normalisation ──');
// CODE ONLY. These lines carry long explanatory comments that quote the very expressions being
// forbidden — a naive regex over the raw text matches the PROSE and reports the defect as present.
// (Observed while writing this file: the first draft failed on its own comment.)
const codeOf = (s: string) => s.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
const BUILD_CODE = codeOf(L_BUILD_BASE), TOK_CODE = codeOf(L_RENT_PERIOD_TOK);
check('buildFilterBaseQuery spreads queryForPeriod (it does not re-derive the period)',
  /\.\.\.queryForPeriod,/.test(BUILD_CODE));
check('buildFilterBaseQuery applies NO second period default of its own',
  !/rentPeriod\s*:/.test(BUILD_CODE),
  'a second period normalisation is back beside the one at the top of the component — that is the '
  + 'two-normalisation shape, and the two can drift apart exactly as the two derivations did');
check('the count token is derived from queryForPeriod, not from the raw store query',
  /rentPeriodParam\(queryForPeriod\)/.test(TOK_CODE),
  'rentPeriodParam(query) reads query.rentPeriod RAW, which is undefined for every fresh Rent search');

// ── 3. MUTATION PROOF ─────────────────────────────────────────────────────────────────────────────
// EXECUTED, not grepped. Each mutant is a REAL previous or plausible version of the shipped line,
// compiled and run through the same product. Each must be CAUGHT, and the real shape must still pass
// (a predicate that is vacuously red proves as little as one that is vacuously green).
console.log('\n── mutation ──');
const mustCatch = async (
  what: string,
  parts: Parameters<typeof buildPair>[0],
  onlyIf?: (d: ReturnType<typeof divergences>, ui: Record<string, unknown>[], p: Pair) => boolean,
) => {
  const mutant = await buildPair(parts);
  const d = divergences(mutant);
  const ui = uiMismatches(mutant);
  const caught = (d.length > 0 || ui.length > 0) && (onlyIf ? onlyIf(d, ui, mutant) : true);
  check(`(mutation) catches ${what}`, caught,
    d.length === 0 && ui.length === 0
      ? 'MUTANT SURVIVED — the invariants above are blind to the defect this file exists for'
      : `caught ${d.length} count/search + ${ui.length} ui divergence(s), but not of the expected shape`);
};

// THE INCIDENT, transcribed as 4a36ef8 ACTUALLY merged it — BOTH halves. The count token came off the
// raw store query AND buildFilterBaseQuery still carried its own `?? 'annual'`. Mutating only the
// first half moves both paths together and the mutant survives (observed while writing this file):
// that is not a weakness in the invariant, it is the repair working — one input cannot disagree with
// itself. The defect needed the two separate readings, so the mutant must restore both.
await mustCatch('THE INCIDENT: the count token off the RAW store query while the search defaulted separately (4a36ef8 as merged)',
  {
    queryForPeriod: '  const queryForPeriod: SearchQuery = query;',
    buildBase: L_BUILD_BASE.replace('...queryForPeriod,',
      "...query,\n      rentPeriod: effDeal === 'Rent' ? (query.rentPeriod ?? 'annual') : query.rentPeriod,"),
  },
  (d) => d.some(({ s, c, r }) => s.deal === 'Rent' && s.rentPeriod === undefined
    && !s.bothDeals && !s.dealCombined && c === null && r === 'سنوي'));

// The second normalisation coming back in buildFilterBaseQuery, agreeing today, free to drift tomorrow.
await mustCatch("a SECOND normalisation in buildFilterBaseQuery that disagrees ('annual' vs the local)",
  { buildBase: L_BUILD_BASE.replace('...queryForPeriod,', "...query,\n      rentPeriod: effDeal === 'Rent' ? (query.rentPeriod ?? 'monthly') : query.rentPeriod,") });

// The component-level normalisation losing its default. Both paths still AGREE (they read one input),
// so this is invisible to the count/search invariant alone — it is caught by 1b: the screen still
// renders «سنوي» selected while both requests stop filtering by period. Two layers agreeing on the
// wrong value is exactly what a second, independent reading exists to find.
await mustCatch('the component-level normalisation losing its default (both requests agree — and both contradict the screen)',
  { rentPeriod: '  const rentPeriod: any = validRentPeriod(query.rentPeriod);' },
  (_d, ui) => ui.some((s) => s.deal === 'Rent' && s.rentPeriod === undefined && !s.dealCombined));

// The pre-4a36ef8 hand-written ternary returning — a second derivation, whatever it agrees on today.
await mustCatch('the pre-4a36ef8 hand-written ternary returning as a second derivation',
  { rentPeriodTok: "  const rentPeriodTok: string | null = effDeal !== 'Rent' ? null"
      + " : rentPeriod === 'monthly' ? 'شهري' : rentPeriod === 'both' ? 'كلاهما' : 'شهري';" });

// NOT VACUOUSLY RED: the real shipped shape must still pass through the same machinery, on BOTH
// invariants. A predicate that is vacuously red proves as little as one that is vacuously green.
const reshipped = await buildPair();
check('(mutation) …while the REAL shipped shape still passes both invariants (not vacuously red)',
  divergences(reshipped).length === 0 && uiMismatches(reshipped).length === 0);

// ── 4. THE SAME QUERY MEANS EVERY PARAMETER, NOT JUST THE PERIOD ──────────────────────────────────
// Found 2026-09-11 (regression hunter) by re-attacking this file's OWN class one level up. Sections
// 1-3 pin p_rent_period and were green for the whole time the defect below existed, because the
// invariant they execute compares ONE parameter. The repair they guard states its own scope wider
// than that — index.tsx: "Normalise ONCE, here, and let both the count token and buildFilterBaseQuery
// read that one object, so a query the counts describe and a query the search runs cannot differ by
// construction." That held for rentPeriodTok alone. The narrowing params and the table scope still
// read the RAW store query:
//
//     counts   const cityAfRaw = { ...rpcAllNarrowingParams(query), ... }        rentPeriod undefined
//     results  buildFilterBaseQuery() → { ...queryForPeriod }                    rentPeriod 'annual'
//
// and rpcFilterParams → agentPriceCapAnnual() reads q.rentPeriod directly, falling back to a
// MAGNITUDE HEURISTIC when unset (`amount <= 25_000 ? amount * 12 : amount`). Measured by executing
// the real builder on the two objects: budget 5,000 → counts 60,000 vs search 5,000; 12,000 →
// 144,000 vs 12,000; 20,000 → 240,000 vs 20,000; 25,000 → 300,000 vs 25,000. A 12x overstatement on
// every rent budget at or below 25,000, on the one state every Rent search starts in — the
// 2026-09-03 Trending-vs-results scope class, on the price parameter.
//
// LATENT, never shipped: sanitizeForFilterRestore()'s allowlist (a THIRD file) drops priceInput from
// every write into the Filter store, so query.priceInput is always ''. That is the same accident that
// kept the bothDeals divergence off production, and this file's own header already refuses it as a
// defence: parity that depends on an unrelated guard is not parity.
//
// So the invariant is stated over the WHOLE object, and priceInput is in the product:
//
//     for every store state S:  rpcAllNarrowingParams(what the COUNT path is handed)
//                            === rpcAllNarrowingParams(what the SEARCH path runs)
console.log('\n── every parameter, over every store state ──');

type NarrowPair = { countParams: (q: Record<string, unknown>) => Record<string, unknown>;
                    searchParams: (q: Record<string, unknown>) => Record<string, unknown> };

async function buildNarrowing(parts: { queryForPeriod?: string; cityAf?: string; buildBase?: string } = {}): Promise<NarrowPair> {
  // cityTableScope is shimmed to {}: searchTableScope reads deal/category/types/platforms, never the
  // period, so it cannot differ between the two objects — proven by construction, and section 5 pins
  // that it is nonetheless handed the same one. What is NOT shimmed is the call under test: the real
  // rpcAllNarrowingParams, applied to whatever argument the shipped line actually passes it.
  const src = `
type SearchQuery = any;
import { validRentPeriod } from '${ROOT}src/lib/searchDefaults.ts';
export function countParams(query: any, rpcAllNarrowingParams: any): any {
${L_RENT_PERIOD}
${L_EFF_DEAL}
${parts.queryForPeriod ?? L_QUERY_FOR_PERIOD}
  const cityTableScope = {};
${parts.cityAf ?? L_CITY_AF}
  return cityAfRaw;
}
export function searchParams(query: any, rpcAllNarrowingParams: any): any {
${L_RENT_PERIOD}
${L_EFF_DEAL}
${parts.queryForPeriod ?? L_QUERY_FOR_PERIOD}
  const citySelected = { cityId: 1 } as any;
  const resolveCitySelection = (_c: any) => ({ label: 'x' } as any);
${parts.buildBase ?? L_BUILD_BASE}
  return rpcAllNarrowingParams(buildFilterBaseQuery());
}
`;
  const dir = mkdtempSync(join(tmpdir(), 'ezhalah-redteam-'));
  const out = join(dir, 'narrow.mts');
  writeFileSync(out, src);
  const mod = await import(out);
  return {
    countParams: (q) => mod.countParams(q, realNarrowing),
    searchParams: (q) => mod.searchParams(q, realNarrowing),
  };
}

// The same product as section 1, crossed with the budgets that separate the heuristic from the
// normalised basis. 25_001 and above are ABOVE the heuristic's threshold and must agree on both
// paths either way — they are here so a mutant cannot pass by breaking everything uniformly.
const BUDGETS = ['', '5000', '12000', '20000', '25000', '25001', '150000'];
const NARROW_SHAPES: Array<Record<string, unknown>> = [];
for (const s of SHAPES) for (const priceInput of BUDGETS)
  NARROW_SHAPES.push({ ...s, priceInput, priceMin: null, priceMax: null, areaMin: null, areaMax: null });

check('the narrowing product is not empty (an empty sweep is a broken sweep)',
  NARROW_SHAPES.length === SHAPES.length * BUDGETS.length && NARROW_SHAPES.length > 300,
  `built ${NARROW_SHAPES.length} shapes`);

const keysOf = (o: Record<string, unknown>) => Object.keys(o).sort();
/** Every store state on which the two paths send a different narrowing parameter set. */
function paramDivergences(p: NarrowPair) {
  const out: Array<{ s: Record<string, unknown>; key: string; c: unknown; r: unknown }> = [];
  for (const s of NARROW_SHAPES) {
    const c = p.countParams(s), r = p.searchParams(s);
    for (const k of new Set([...keysOf(c), ...keysOf(r)])) {
      if (JSON.stringify(c[k]) !== JSON.stringify(r[k])) out.push({ s, key: k, c: c[k], r: r[k] });
    }
  }
  return out;
}

const shippedNarrow = await buildNarrowing();
const narrowDiv = paramDivergences(shippedNarrow);
check('the COUNT surfaces and the RESULTS RPC send the same value for EVERY narrowing parameter',
  narrowDiv.length === 0,
  narrowDiv.slice(0, 8).map(({ s, key, c, r }) =>
    `${label(s)} priceInput=${JSON.stringify(s.priceInput)}\n        ${key}: counts send ${JSON.stringify(c)}, search sends ${JSON.stringify(r)}`)
    .join('\n      ') + (narrowDiv.length > 8 ? `\n      …and ${narrowDiv.length - 8} more` : ''));

// The exact state the defect lived on, named so a failure says WHICH one broke.
const DEFAULT_RENT_BUDGET = { deal: 'Rent', rentPeriod: undefined, bothDeals: false, dealCombined: false,
                              priceInput: '20000', priceMin: null, priceMax: null, category: 'Residential', location: '' };
check('a fresh Rent search carrying a 20,000 budget: both paths cap at the SAME figure',
  JSON.stringify(shippedNarrow.countParams(DEFAULT_RENT_BUDGET).p_price_max)
  === JSON.stringify(shippedNarrow.searchParams(DEFAULT_RENT_BUDGET).p_price_max),
  `counts p_price_max=${JSON.stringify(shippedNarrow.countParams(DEFAULT_RENT_BUDGET).p_price_max)}, `
  + `search p_price_max=${JSON.stringify(shippedNarrow.searchParams(DEFAULT_RENT_BUDGET).p_price_max)}`
  + ' — agentPriceCapAnnual()\'s unset-period heuristic against the normalised annual basis: the counts '
  + 'advertise a set 12x wider than the search returns');

// ── 5. EVERY COUNT-PATH BUILDER READS THE NORMALISED OBJECT ───────────────────────────────────────
// The structural half, and it is NOT redundant with section 4. Section 4 executes one builder; the
// count path also calls searchTableScope() and cohortTypesAr(), whose full chains are shimmed there.
// Neither reads the period TODAY, so a value check cannot see them re-acquire a second input — and
// "it agrees today" is precisely the shape this whole file exists to refuse. Enumerated from the
// shipped lines, so a new count-path builder added tomorrow is covered the moment it appears here.
console.log('\n── every count-path builder reads queryForPeriod ──');
for (const [name, line] of [['rpcAllNarrowingParams', L_CITY_AF],
                            ['searchTableScope', anchor('  const { isBroadCommercial:')],
                            ['cohortTypesAr', anchor('  const cohortTypes = ')]] as const) {
  const code = codeOf(line);
  check(`the count path passes queryForPeriod to ${name}() (not the raw store query)`,
    new RegExp(`${name}\\(queryForPeriod\\)`).test(code),
    `${name}(query) reads the RAW store query — rentPeriod is undefined there for every fresh Rent `
    + 'search, so this builder is deriving from a different object than the search runs on');
}

// ── 6. MUTATION PROOF for sections 4 and 5 ────────────────────────────────────────────────────────
console.log('\n── mutation (every parameter) ──');
const mustCatchNarrow = async (
  what: string, parts: Parameters<typeof buildNarrowing>[0],
  onlyIf?: (d: ReturnType<typeof paramDivergences>) => boolean,
) => {
  const mutant = await buildNarrowing(parts);
  const d = paramDivergences(mutant);
  check(`(mutation) catches ${what}`, d.length > 0 && (onlyIf ? onlyIf(d) : true),
    d.length === 0
      ? 'MUTANT SURVIVED — section 4 is blind to the defect it exists for'
      : `caught ${d.length} divergence(s), but not of the expected shape`);
};

// THE DEFECT, exactly as it stood until 2026-09-11: the count path handed the RAW store query.
await mustCatchNarrow('THE DEFECT: the count params derived from the RAW store query while the search ran the normalised one',
  { cityAf: L_CITY_AF.replace('rpcAllNarrowingParams(queryForPeriod)', 'rpcAllNarrowingParams(query)') },
  (d) => d.some(({ s, key, c, r }) => key === 'p_price_max' && s.deal === 'Rent'
    && s.rentPeriod === undefined && s.priceInput === '20000' && c === 240000 && r === 20000));

// THE MIRROR: the SEARCH side losing the normalisation while the counts keep it. The defect above
// runs in the other direction, and a one-sided invariant would catch only the direction it was
// written for. (Collapsing queryForPeriod on BOTH sides is deliberately NOT a mutant here: the two
// paths then read one raw object and agree with each other — one input cannot disagree with itself,
// which is the repair working, exactly as this file's section-3 note already records. Section 1b's
// screen check is what catches that shape, by a second and independent reading.)
await mustCatchNarrow('THE MIRROR: buildFilterBaseQuery spreading the raw query while the counts normalise',
  { buildBase: L_BUILD_BASE.replace('...queryForPeriod,', '...query,') },
  (d) => d.some(({ s, key, c, r }) => key === 'p_price_max' && s.deal === 'Rent'
    && s.rentPeriod === undefined && s.priceInput === '20000' && c === 20000 && r === 240000));

// NOT VACUOUSLY RED: the real shipped shape must still pass through the same machinery.
const reNarrow = await buildNarrowing();
check('(mutation) …while the REAL shipped shape still agrees on every parameter (not vacuously red)',
  paramDivergences(reNarrow).length === 0);

console.log(failed === 0
  ? '\n✅ one derivation over one input: the count surfaces and the search cannot describe different periods,\n   budgets, or any other narrowing parameter.'
  : `\n❌ ${failed} check(s) failed.`);
process.exit(failed === 0 ? 0 : 1);
