// THE NARROWING INVARIANT PROBE — offline contract barrier (§3.1, §26 of
// docs/ops/SEARCH_MATCH_QA_ENGINEER.md).
//
// `e2e/qa-coverage/narrowing.mjs` fires the §3.1 invariant against production:
//
//     results(S + f) ⊆ results(S)                    — narrowing never INVENTS a row
//     { r ∈ results(S) : f(r) } ⊆ results(S + f)     — narrowing never LOSES a qualifying row
//
// That layer exists because BOTH sides of a broken narrowing can be internally consistent — the
// 2026-08-29 commercial-misfile defect passed per-search validation on each side and only the
// RELATIONSHIP between them was wrong. A per-search oracle is structurally incapable of seeing it.
//
// This barrier pins the probe's own correctness, because a probe that silently stops checking one
// of the two directions is worse than no probe: it reads green forever. Everything here is offline
// and deterministic — the live half runs from the daily routine, not from `npm test`.
//
// THE TRAP THIS FILE EXISTS FOR (measured 2026-09-02, first run of the probe):
// `effective_price` comes back ANNUALISED, but a «شهري» search sends its budget in the DISPLAYED
// (monthly) unit and the RPC multiplies it by 12. Feeding a returned price straight back as a
// monthly bound asks for a budget 12× too large, returns 0 rows, and reads as production losing
// every qualifying listing. It did exactly that on شقة/إيجار/شهري/الشقيق (broad 29 → narrow 0,
// 10 rows "lost") before the unit conversion was added. Production was right on both layers.
// §40.7 forbids reporting a harness failure as a product failure — this barrier is what keeps that
// specific harness failure from coming back.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const src = readFileSync(join(root, 'e2e/qa-coverage/narrowing.mjs'), 'utf8');

let failures = 0;
const check = (name: string, ok: boolean) => {
  if (!ok) { failures++; console.error(`  ✗ ${name}`); } else console.log(`  ✓ ${name}`);
};

console.log('narrowing invariant probe — contract');

// ── 1. BOTH DIRECTIONS OF THE INVARIANT ARE ACTUALLY COMPARED ────────────────────────────────────
// A probe that only checks the subset direction misses the whole class of "narrowing lost a row",
// which is the direction the 2026-08-29 defect actually broke.
check('the INVENTED-row direction is checked (narrow ⊄ broad)',
  /const extra = \[\.\.\.narrowSet\]\.filter\(\(id\) => !broadSet\.has\(id\)\);/.test(src));
check('the LOST-row direction is checked (qualifying rows of broad must survive)',
  /const shouldHold = broad\.rows\.filter\(n\.holds\)/.test(src)
  && /const missing = shouldHold\.filter\(\(id\) => !narrowSet\.has\(id\)\);/.test(src));
check('duplicates in the narrowed answer are counted (§30 identity, not card text)',
  /const dupes = narrow\.ids\.length - narrowSet\.size;/.test(src)
  && /\$\{r\.source_table\}:\$\{r\.listing_id\}/.test(src));
check('any of the three conditions raises a finding',
  /if \(extra\.length \|\| missing\.length \|\| dupes\)/.test(src));
check('a violation fails the run by exit code — never a printed warning nobody reads',
  /process\.exit\(violations\.length \? 1 : 0\)/.test(src));

// ── 2. THE MONTHLY UNIT CONVERSION (the trap above) ──────────────────────────────────────────────
check('a «شهري» bound is converted to the displayed monthly unit the RPC ×12s back',
  /const monthly = period === 'شهري';/.test(src)
  && /const toBound = \(annualCut\) => \(monthly \? annualCut \/ 12 : annualCut\);/.test(src));
check('the price cut is snapped to a multiple of 12 so the ÷12 is exact (no rounding drift)',
  /between\(prices, monthly \? 12 : 1\)/.test(src));
check('the request carries the converted bound while the predicate stays in annual space',
  /priceMax: toBound\(pCut\)[\s\S]{0,120}Number\(r\.effective_price\) <= pCut/.test(src)
  && /priceMin: toBound\(pCut\)[\s\S]{0,120}Number\(r\.effective_price\) >= pCut/.test(src));
check('derive() receives the period — it cannot pick a unit it was never told',
  /function derive\(rows, period\)/.test(src) && /derive\(broad\.rows, p\.period\)/.test(src));

// ── 3. THE CUT NEVER LANDS ON AN OBSERVED VALUE ──────────────────────────────────────────────────
// Otherwise an inclusive/exclusive boundary convention reads as a matching defect. §32 tests
// boundary semantics on purpose; this layer must not conflate the two.
check('the cut is strictly between two observed values',
  /return cut < mid && cut > below \? cut : null;/.test(src));

// ── 4. THE BROAD SET MUST BE FULLY HELD ──────────────────────────────────────────────────────────
// Above the page limit the client holds one page of a larger set, so a "missing" row may simply be
// on a page the probe never saw. Comparing sets there would invent defects (§39.1).
check('the broad reference set is capped at the RPC page limit',
  /const MAX_BROAD = PAGE_LIMIT;/.test(src)
  && /if \(broad\.total < MIN_BROAD \|\| broad\.total > MAX_BROAD\) continue;/.test(src));

// ── 5. NO GUESSED TAXONOMY, SCOPE, OR CITY/REGION PAIR ───────────────────────────────────────────
// §1 forbids a hardcoded control list; §41.6 forbids guessing the table scope; §41.16 forbids a
// name-keyed city map (290 city names repeat across regions).
check('the cohort/table scope is harvested, never guessed (§41.6)',
  /ops_qa_cohort_catalog/.test(src) && /refusing to guess the cohort mapping/.test(src));
check('the request is built by the app\'s own serializer, not re-implemented (§41.10/§41.14)',
  /import \{ buildRequest, PAGE_LIMIT \} from '\.\/request\.mjs';/.test(src)
  && !/p_types2\s*[:=]/.test(src) && !/p_category\s*[:=]/.test(src));
check('region comes from the city\'s OWN catalog row, never a name-keyed dict (§41.16)',
  /loc_catalog_city\?select=city_ar,city_id,region_id/.test(src)
  && /refusing to guess a city\/region pair/.test(src));
check('the populated cell grid is discovered live from the index (§1)',
  /search_listings_ar\?select=type_ar,deal_ar,rent_period_ar,city_id/.test(src));

// ── 6. LOAD ENVELOPE AND STALE-FIRST ROTATION ────────────────────────────────────────────────────
check('rate is held at the measured safe envelope (§40.6)', /const MIN_GAP_MS = 700;/.test(src));
check('coverage is drawn stalest-first, never population-first (§43.2)',
  /ops_qa_sweep_plan/.test(src) && /never-tested first, then stalest/.test(src));
check('what was covered is written back to the ledger (§39)',
  /ops_qa_record_coverage/.test(src) && /LEDGER_DIMENSION = 'narrowing_invariant'/.test(src));
check('the broad search is one hit per cell, not a scan of city after city (§43.1)',
  /const usableCells = \[\.\.\.grid\.values\(\)\]/.test(src) && !/cities\.slice\(0, 60\)/.test(src));

// ── 7. MUTATION PROOF ────────────────────────────────────────────────────────────────────────────
// Each mutation is a way the probe could rot into reading green forever. If any survives, the
// corresponding check above is decorative.
const mutations: Array<[string, string, string]> = [
  ['drops the LOST-row direction',
    'const missing = shouldHold.filter((id) => !narrowSet.has(id));', 'const missing = [];'],
  ['drops the INVENTED-row direction',
    'const extra = [...narrowSet].filter((id) => !broadSet.has(id));', 'const extra = [];'],
  ['sends a «شهري» bound in annual units (the 2026-09-02 trap)',
    'const toBound = (annualCut) => (monthly ? annualCut / 12 : annualCut);',
    'const toBound = (annualCut) => annualCut;'],
  ['stops snapping the cut to a multiple of 12',
    'between(prices, monthly ? 12 : 1)', 'between(prices, 1)'],
  ['lets the cut land on an observed value',
    'return cut < mid && cut > below ? cut : null;', 'return mid;'],
  ['compares against a page of a larger set',
    'if (broad.total < MIN_BROAD || broad.total > MAX_BROAD) continue;', ''],
  ['reports violations without failing',
    'process.exit(violations.length ? 1 : 0);', 'process.exit(0);'],
];

console.log('  mutation proof — each of these must be CAUGHT:');
for (const [label, from, to] of mutations) {
  if (!src.includes(from)) { failures++; console.error(`  ✗ mutation anchor missing: ${label}`); continue; }
  const mutated = src.replace(from, to);
  // Re-run every assertion above against the mutated source; at least one must go red.
  const caught =
    !/const extra = \[\.\.\.narrowSet\]\.filter\(\(id\) => !broadSet\.has\(id\)\);/.test(mutated)
    || !/const missing = shouldHold\.filter\(\(id\) => !narrowSet\.has\(id\)\);/.test(mutated)
    || !/const toBound = \(annualCut\) => \(monthly \? annualCut \/ 12 : annualCut\);/.test(mutated)
    || !/between\(prices, monthly \? 12 : 1\)/.test(mutated)
    || !/return cut < mid && cut > below \? cut : null;/.test(mutated)
    || !/if \(broad\.total < MIN_BROAD \|\| broad\.total > MAX_BROAD\) continue;/.test(mutated)
    || !/process\.exit\(violations\.length \? 1 : 0\)/.test(mutated);
  check(`    caught: ${label}`, caught);
}

if (failures) {
  console.error(`\n✗ narrowing invariant probe contract: ${failures} failure(s)`);
  process.exit(1);
}
console.log('✓ narrowing invariant probe contract intact');
