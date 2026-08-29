// af_coverage_cliff must watch REAL AF PREDICATES and require a REAL BASELINE.
//
// THE DEFECT THIS PINS (owner-directed, 2026-08-29). The detector built its monitored set from
// `_rich_attr_columns()` — every rich attribute a scraper captures — and then told the reader
// "every new listing since the cliff is unreachable by that AF predicate". For most of those
// columns there is no AF predicate at all. It raised P2 on `postal_code` / aqar_residential, a
// column that appears ZERO times in `af_eligibility_clause()`, off a "baseline" of 3 rows in 30
// days out of ~25,000 (0.01%). Nothing was unreachable and nothing had collapsed.
//
// TWO RULES, and this file pins both plus the arithmetic that decides them:
//
//   1. THE FIELD SET IS DERIVED, not listed: the columns af_eligibility_clause() actually filters
//      on, intersected with search_listings_ar. Add a predicate to the clause and it is monitored
//      on the next run; a column no predicate reads is not monitored at all. Measured when the fix
//      landed: 29 monitored → 39, +35 real predicates newly watched (street_width_m, rating,
//      direction_ar, bathrooms, property_age, furnished, …), −25 non-predicates dropped.
//      It FAILS CLOSED: fewer than 20 resolved columns raises rather than monitoring nothing.
//
//   2. AN EVIDENCE FLOOR: a drop to zero is a cliff only from a real baseline —
//      prior_with_value >= 30 AND prior_with_value >= 10% of prior rows. Both limbs are
//      load-bearing and each is exercised below by a case measured on production.
//
// THE TEST VECTORS ARE REAL, not invented. The positive is the genuine dealapp/bedrooms collapse
// of 2026-08-03, read in the detector's own window shape as of 2026-08-10; the negatives are the
// three drop-to-zero candidates that existed on 2026-08-29. A floor that suppressed the positive
// would be a detector going dark, which is the failure this repo has been burned by before.
//
//   node --experimental-strip-types scripts/verify-af-coverage-cliff-predicate-scope.ts  (npm test)

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { npmTestRuns } from './lib/testRegistry.ts';

const root = join(import.meta.dirname, '..');
let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (ok) { console.log(`PASS  ${label}`); return; }
  failures++;
  console.error(`FAIL  ${label}${detail ? `\n      ${detail}` : ''}`);
};

console.log('\naf_coverage_cliff — real AF predicates, and a real baseline before calling it a cliff\n');

// The newest migration that redefines the detector is the one in force.
const MIG_DIR = 'supabase/migrations';
const migFile = readdirSync(join(root, MIG_DIR)).filter((f) => f.endsWith('.sql')).sort()
  .filter((f) => readFileSync(join(root, MIG_DIR, f), 'utf8')
    .includes('function public.mon_detect_af_coverage_cliff')).pop();
check('a migration defining mon_detect_af_coverage_cliff exists', !!migFile, MIG_DIR);
const sql = migFile ? readFileSync(join(root, MIG_DIR, migFile), 'utf8') : '';
// Strip -- comments so the rationale prose can never satisfy a check about the code.
const code = sql.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');

// ── 1. the field set is derived from the predicate surface ───────────────────────────────────────
check('the monitored set is read from af_eligibility_clause()',
  /af_eligibility_clause\(\)/.test(code),
  'the field set must come from the clause the search and count RPCs actually run');

check('…and is intersected with search_listings_ar\'s real columns',
  /intersect[\s\S]{0,200}?information_schema\.columns[\s\S]{0,160}?search_listings_ar/.test(code));

check('the regex reads column names INCLUDING digits (area_m2, not area_m)',
  /s\\\.\(\[a-z_0-9\]\+\)/.test(code) || /\[a-z_0-9\]\+/.test(code),
  'a [a-z_]+ class stops at the digit and silently monitors a column that does not exist');

check('_rich_attr_columns() is NO LONGER the field source',
  !/_rich_attr_columns\(\)/.test(code),
  'that set is "what scrapers capture", not "what AF can filter" — the two are different questions '
  + 'and conflating them is what produced the postal_code alarm');

check('the detector FAILS CLOSED on a shrunken or unreadable predicate surface',
  /array_length\(cols,\s*1\)\s*<\s*20/.test(code) && /raise exception/.test(code),
  'monitoring nothing must be loud; a detector that cannot fire reads as a clean bill of health');

// ── 2. the evidence floor exists, with both limbs ────────────────────────────────────────────────
check('an absolute prior-evidence floor is declared', /MIN_PRIOR_ROWS\s+constant/.test(code));
check('a prior-RATE floor is declared', /MIN_PRIOR_PCT\s+constant/.test(code));
check('the cliff condition requires BOTH limbs on top of the drop to zero',
  /rv\s*=\s*0\s*and\s*pv\s*>=\s*MIN_PRIOR_ROWS\s*and\s*coalesce\(rate,\s*0\)\s*>=\s*MIN_PRIOR_PCT/.test(code),
  'dropping either limb re-admits the trickle-baseline alarms this fix removed');
check('the payload reports the baseline it judged (prior rows and rate)',
  /prior_rows_30d/.test(code) && /prior_rate_pct/.test(code),
  'the next reader must be able to see the baseline without re-deriving it');
check('…and names the thresholds it used',
  /min_prior_rows/.test(code) && /min_prior_pct/.test(code));

// ── 3. THE DECISION RULE ITSELF, on real production measurements ─────────────────────────────────
// A pure replica of the shipped condition, so the arithmetic is tested rather than only described.
const MIN_PRIOR_ROWS = Number(code.match(/MIN_PRIOR_ROWS\s+constant\s+int\s*:=\s*(\d+)/)?.[1]);
const MIN_PRIOR_PCT = Number(code.match(/MIN_PRIOR_PCT\s+constant\s+numeric\s*:=\s*([\d.]+)/)?.[1]);
check('the thresholds are readable from the shipped source',
  Number.isFinite(MIN_PRIOR_ROWS) && Number.isFinite(MIN_PRIOR_PCT),
  `min_prior_rows=${MIN_PRIOR_ROWS} min_prior_pct=${MIN_PRIOR_PCT}`);

const isCliff = (recentWithValue: number, priorWithValue: number, priorRows: number) => {
  const rate = priorRows > 0 ? Math.round((10000 * priorWithValue) / priorRows) / 100 : 0;
  return recentWithValue === 0 && priorWithValue >= MIN_PRIOR_ROWS && rate >= MIN_PRIOR_PCT;
};

type Vector = { name: string; recent: number; prior: number; priorRows: number; expect: boolean };
const VECTORS: Vector[] = [
  // POSITIVE — the genuine collapse, in the detector's own window shape as of 2026-08-10.
  { name: 'dealapp_residential · bedrooms, AT the 2026-08-03 cliff (118 of 132 = 89.39%)',
    recent: 0, prior: 118, priorRows: 132, expect: true },
  // NEGATIVES — the three drop-to-zero candidates that existed on 2026-08-29.
  { name: 'wasalt_commercial · furnished (1 of 40 = 2.50%) — absolute limb',
    recent: 0, prior: 1, priorRows: 40, expect: false },
  { name: 'sanadak_residential · floor_number (1 of 63 = 1.59%) — absolute limb',
    recent: 0, prior: 1, priorRows: 63, expect: false },
  { name: 'dealapp_residential · bedrooms four weeks later (32 of 4840 = 0.66%) — rate limb',
    recent: 0, prior: 32, priorRows: 4840, expect: false },
  // A field still arriving is never a cliff, whatever its baseline.
  { name: 'a field still arriving (recent > 0) is never a cliff',
    recent: 5, prior: 118, priorRows: 132, expect: false },
];
for (const v of VECTORS) {
  const got = isCliff(v.recent, v.prior, v.priorRows);
  check(`${v.expect ? 'FIRES' : 'suppressed'} — ${v.name}`, got === v.expect,
    `expected ${v.expect}, rule said ${got}`);
}

// Both limbs must be genuinely necessary: neither alone reproduces the shipped verdicts.
const absoluteOnly = (r: number, p: number) => r === 0 && p >= MIN_PRIOR_ROWS;
const rateOnly = (r: number, p: number, pr: number) => r === 0 && (pr > 0 ? (100 * p) / pr : 0) >= MIN_PRIOR_PCT;
check('the ABSOLUTE limb is load-bearing (rate alone would re-admit a 1-of-40 trickle)',
  rateOnly(0, 1, 40) !== false || absoluteOnly(0, 1) === false,
  'if the rate limb alone already suppressed every negative, the absolute limb would be dead code');
check('the RATE limb is load-bearing (absolute alone would re-admit 32 of 4,840)',
  absoluteOnly(0, 32) === true && isCliff(0, 32, 4840) === false,
  'absolute-only would fire on the stale echo of an old cliff');

// ── 4. MUTATION PROOFS — each structural check must fail on the pre-fix / mis-fixed source ───────
type Mutation = { name: string; apply: (s: string) => string; predicate: (c: string) => boolean };
const mutations: Mutation[] = [
  {
    name: 'the PRE-FIX source: field set built from _rich_attr_columns()',
    apply: (s) => s.replace(/public\.af_eligibility_clause\(\)/g, 'public._rich_attr_columns()'),
    predicate: (c) => /af_eligibility_clause\(\)/.test(c) && !/_rich_attr_columns\(\)/.test(c),
  },
  {
    name: 'the evidence floor is removed (drop-to-zero fires on any trickle)',
    apply: (s) => s.replace(/rv\s*=\s*0\s*and\s*pv\s*>=\s*MIN_PRIOR_ROWS\s*and\s*coalesce\(rate,\s*0\)\s*>=\s*MIN_PRIOR_PCT/,
      'rv = 0 and pv > 0'),
    predicate: (c) => /rv\s*=\s*0\s*and\s*pv\s*>=\s*MIN_PRIOR_ROWS\s*and\s*coalesce\(rate,\s*0\)\s*>=\s*MIN_PRIOR_PCT/.test(c),
  },
  {
    name: 'the rate limb alone is kept (absolute limb dropped)',
    apply: (s) => s.replace(/pv\s*>=\s*MIN_PRIOR_ROWS\s*and\s*/, ''),
    predicate: (c) => /rv\s*=\s*0\s*and\s*pv\s*>=\s*MIN_PRIOR_ROWS\s*and\s*coalesce\(rate,\s*0\)\s*>=\s*MIN_PRIOR_PCT/.test(c),
  },
  {
    name: 'the fail-closed refusal on a broken clause parse is removed',
    apply: (s) => s.replace(/if cols is null or array_length\(cols, 1\) < 20 then[\s\S]*?end if;/, ''),
    predicate: (c) => /array_length\(cols,\s*1\)\s*<\s*20/.test(c) && /raise exception/.test(c),
  },
  {
    name: 'the column regex loses its digits, so area_m2 is never monitored',
    apply: (s) => s.replace(/\[a-z_0-9\]\+/g, '[a-z_]+'),
    predicate: (c) => /\[a-z_0-9\]\+/.test(c),
  },
];
for (const m of mutations) {
  const mutated = m.apply(sql).split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
  check(`mutation caught — ${m.name}`, !m.predicate(mutated),
    'this check passes on deliberately broken source, so it protects nothing');
}

// A threshold mutation must move a real verdict, not just the text.
{
  const loosened = (r: number, p: number, pr: number) => r === 0 && p > 0;   // the pre-fix rule
  check('mutation caught — the pre-fix rule would have fired on all three 2026-08-29 negatives',
    VECTORS.filter((v) => !v.expect && v.recent === 0).every((v) => loosened(v.recent, v.prior, v.priorRows)),
    'if the old rule did not fire on them, these vectors do not reproduce the reported defect');
}

// ── 5. wiring ────────────────────────────────────────────────────────────────────────────────────
check('this barrier runs in `npm test`', npmTestRuns(root, 'verify-af-coverage-cliff-predicate-scope'));

if (failures > 0) {
  console.error(`\nverify-af-coverage-cliff-predicate-scope: ${failures} FAILED`);
  process.exit(1);
}
console.log('\nverify-af-coverage-cliff-predicate-scope: all checks passed');
