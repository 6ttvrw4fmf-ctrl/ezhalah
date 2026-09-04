// THE DAILY COVERAGE PLAN MUST BE STALE-FIRST AND BUDGETED — not population-first, and not bigger.
//
// OWNER RULE, 2026-08-28 (docs/ops/SEARCH_MATCH_QA_ENGINEER.md §43):
//   «Do not increase production traffic merely to make the search count larger. The objective is
//    coverage and defect detection, not request volume. For the daily heartbeat, use a bounded
//    production budget and prioritize coverage stalest-first and risk-first.»
//
// This barrier exists because the failure it prevents ALREADY HAPPENED. The 2026-08-28 daily run
// fired 446 RPC searches ordered by POPULATION — biggest cell first — so it re-tested الرياض
// apartments while «سكن عمال» and dozens of small cities stayed untouched for weeks. The search
// count looked impressive; coverage did not move. A count is not a coverage claim, and nothing in
// the suite could tell the difference until this file.
//
//   node --experimental-strip-types scripts/verify-qa-coverage-planner.ts

import { planCells, score, DAILY_BUDGET, RISK, SHAPES } from '../e2e/qa-coverage/plan.mjs';
import { buildRequest, cohortKey, PAGE_LIMIT } from '../e2e/qa-coverage/request.mjs';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (ok) { console.log(`PASS  ${label}`); return; }
  failures++;
  console.error(`FAIL  ${label}${detail ? `\n      ${detail}` : ''}`);
};

console.log('\nThe daily coverage plan is chosen by staleness and risk, inside a fixed budget\n');

// A grid where population and staleness point in OPPOSITE directions — the whole question.
const cells = [
  { uiType: 'شقة', deal: 'إيجار', period: 'سنوي', city: 'الرياض', regionId: 1, n: 21862, macro: 'Residential', hasOverlay: true },
  { uiType: 'شقة', deal: 'بيع', period: null, city: 'جدة', regionId: 2, n: 9000, macro: 'Residential', hasOverlay: true },
  { uiType: 'فيلا', deal: 'بيع', period: null, city: 'الرياض', regionId: 1, n: 8000, macro: 'Residential', hasOverlay: true },
  { uiType: 'سكن عمال', deal: 'إيجار', period: 'سنوي', city: 'الطائف', regionId: 2, n: 1, macro: 'Commercial', hasOverlay: false },
  { uiType: 'مخيم', deal: 'إيجار', period: 'شهري', city: 'المزاحمية', regionId: 1, n: 4, macro: 'Residential', hasOverlay: true },
  { uiType: 'مرافق خدمية', deal: 'بيع', period: null, city: 'أبها', regionId: 6, n: 1, macro: 'Commercial', hasOverlay: false },
];
// الرياض apartments were tested YESTERDAY; the small cells are old or have never been tested at all.
const seen = new Map<string, number>([
  [cohortKey(cells[0]), 0.2],
  [cohortKey(cells[1]), 1.0],
  [cohortKey(cells[2]), 30.0],
  // cells[3], cells[4], cells[5] deliberately absent → never tested
]);

// ── 1. never-tested cells outrank everything ────────────────────────────────────────────────────
const plan = planCells(cells, seen, 3, 99);
const keys = plan.map(cohortKey);
check('a never-tested cohort is planned before ANY previously-tested one',
  plan.slice(0, 3).every((c) => !seen.has(cohortKey(c))),
  `planned: ${keys.join('  ·  ')}`);
check('the 21,862-row الرياض cohort tested yesterday is NOT in a 3-search plan',
  !keys.includes(cohortKey(cells[0])),
  'population must not buy a slot — that is the 2026-08-28 failure this file exists for');

// ── 2. among tested cells, the stalest wins ─────────────────────────────────────────────────────
const tested = [cells[0], cells[1], cells[2]];
const p2 = planCells(tested, seen, 1, 99);
check('among previously-tested cohorts, the stalest (30d) is chosen over the largest (21,862 rows)',
  cohortKey(p2[0]) === cohortKey(cells[2]),
  `chose ${cohortKey(p2[0])}`);

// ── 3. the budget is a CEILING ──────────────────────────────────────────────────────────────────
check('the plan never exceeds the budget', planCells(cells, seen, 2, 99).length === 2);
check('the plan cannot exceed the number of real cells',
  planCells(cells, seen, 500, 99).length === cells.length,
  'padding a run with repeats to hit a number is exactly what the owner forbade');
check('DAILY_BUDGET is a bounded daily heartbeat, not certification scale',
  DAILY_BUDGET > 0 && DAILY_BUDGET <= 1000,
  `DAILY_BUDGET=${DAILY_BUDGET}; ~5,000 belongs to a MAJOR certification (§40), never the heartbeat`);

// ── 4. one نوع cannot eat the whole run ─────────────────────────────────────────────────────────
const many = Array.from({ length: 40 }, (_, i) => ({
  uiType: 'شقة', deal: 'بيع', period: null, city: `مدينة${i}`, regionId: 1, n: 100,
  macro: 'Residential', hasOverlay: true,
}));
const spread = planCells([...many, cells[3], cells[5]], new Map(), 12);
check('a per-نوع cap keeps one type from taking every slot',
  new Set(spread.map((c) => c.uiType)).size > 1,
  `types in plan: ${[...new Set(spread.map((c) => c.uiType))].join(', ')}`);

// ── 5. risk weights are real bug classes, and each one moves the score ───────────────────────────
const base = { uiType: 'شقة', deal: 'بيع', period: null, city: 'الرياض', regionId: 1, n: 5000, macro: 'Residential', hasOverlay: false };
const s0 = score(base, new Map([[cohortKey(base), 1]]));
for (const [label, mut] of [
  ['Buy+Rent combined (§41.17)', { combined: true }],
  ['«شهري» monthly scope (§41.6)', { period: 'شهري', deal: 'إيجار' }],
  ['«كلاهما» period union', { period: 'كلاهما', deal: 'إيجار' }],
  ['scope2 overlay cohort (§41.14)', { hasOverlay: true }],
  ['Commercial macro (category purity)', { macro: 'Commercial' }],
  ['small cohort (boundary bugs)', { n: 3 }],
  ['non-Riyadh rotation', { city: 'صبيا' }],
] as [string, Record<string, unknown>][]) {
  const c = { ...base, ...mut };
  const m = new Map([[cohortKey(c), 1]]);
  check(`risk weight raises priority: ${label}`, score(c, m) > s0, `${score(c, m)} vs baseline ${s0}`);
}
check('never-tested outweighs every other single risk weight',
  RISK.neverTested > Math.max(RISK.combinedDeal, RISK.monthlyPeriod, RISK.periodBoth,
                              RISK.overlayCohort, RISK.commercialMacro, RISK.smallCohort, RISK.nonRiyadh));

// ── 6. MUTATION PROOF — a population-first planner FAILS check 1 ─────────────────────────────────
// The 2026-08-28 planner, in one line. If this ever passes, the fixtures stopped exercising the
// defect and everything above proves nothing.
const populationFirst = (cs: typeof cells, budget: number) =>
  [...cs].sort((a, b) => (b.n ?? 0) - (a.n ?? 0)).slice(0, budget);
const legacy = populationFirst(cells, 3).map(cohortKey);
check('MUTATION: the population-first planner DOES pick الرياض/شقة first (so the fix is load-bearing)',
  legacy[0] === cohortKey(cells[0]) && !legacy.includes(cohortKey(cells[3])),
  `legacy plan: ${legacy.join('  ·  ')}`);

// ── 7. the request serializer still carries the §41 rules the traps cost us ──────────────────────
const resCohort = {
  ui_type: 'عمارة سكنية', macro: 'Residential', scope: 'res', scope2: 'com',
  types_ar: ['عمارة', 'مجمع سكني', 'مجمع', 'برج'],
  scope_tables: ['aqar_residential_listings', 'wasalt_residential_listings'],
  scope_monthly_tables: ['aqar_residential_listings', 'wasalt_residential_listings',
                         'gathern_residential_listings', 'aqarmonthly_residential_listings'],
  scope2_tables: ['aqar_commercial_listings', 'wasalt_commercial_listings'],
};
const buy = buildRequest(resCohort, { deal: 'بيع', city: 'الرياض', regionId: 1 });
check('§41.14 p_types2 EXCLUDES «عمارة» (in a commercial table it is a Commercial Building)',
  !buy.p_types2.includes('عمارة') && buy.p_types2.length === 3, JSON.stringify(buy.p_types2));
check('§41.14 p_category is ALWAYS sent', buy.p_category === 'Residential');
check('§41.14 p_types is the FULL cohort list (only the overlay is trimmed)', buy.p_types.length === 4);
check('§41.11/16 p_cities and p_region_ids come from the same catalog row',
  JSON.stringify(buy.p_cities) === '["الرياض"]' && JSON.stringify(buy.p_region_ids) === '[1]');
check('§41.6 a Buy search does NOT attach the monthly-only sources',
  !buy.p_tables.includes('gathern_residential_listings'));
check('§41.6 an «إيجار»+«شهري» search DOES attach them',
  buildRequest(resCohort, { deal: 'إيجار', period: 'شهري' }).p_tables.includes('aqarmonthly_residential_listings'));
check('§41.6 «كلاهما» attaches them too (a monthly+annual union must not be annual-only)',
  buildRequest(resCohort, { deal: 'إيجار', period: 'كلاهما' }).p_tables.includes('gathern_residential_listings'));
check('§41.6 «سنوي» does NOT attach them',
  !buildRequest(resCohort, { deal: 'إيجار', period: 'سنوي' }).p_tables.includes('gathern_residential_listings'));
const comb = buildRequest(resCohort, { combined: true, city: 'جدة', regionId: 2 });
check('§41.17 Buy+Rent combined sends p_deal:null AND p_rent_period:null',
  comb.p_deal === null && comb.p_rent_period === null);
check('§41.17 …and still reaches the monthly pool (its Rent side has no period selector)',
  comb.p_tables.includes('gathern_residential_listings') && comb.p_tables.includes('aqarmonthly_residential_listings'),
  'sending 31 tables where the client sends 33 under-counts by the whole monthly-only inventory');
check('§41.10 the serialized deal is passed through, never a UI label',
  buildRequest(resCohort, { deal: 'بيع' }).p_deal === 'بيع'
  && buildRequest(resCohort, { deal: 'إيجار', period: 'سنوي' }).p_rent_period === 'سنوي');
check('a Buy search sends no rent period', buildRequest(resCohort, { deal: 'بيع', period: 'سنوي' }).p_rent_period === null);
check('the page limit matches the client\'s own', PAGE_LIMIT === 1500);
check('buildRequest REFUSES an unknown cohort rather than inventing a scope',
  (() => { try { buildRequest(undefined as never, { deal: 'بيع' }); return false; } catch { return true; } })());

// ── 8. the shapes cover the dimensions §5–§7 and §32 require daily ──────────────────────────────
for (const need of ['priceMin', 'priceMax', 'areaMin', 'areaMax', 'beds', 'bedsMin'])
  check(`daily filter shapes still exercise ${need}`, SHAPES.some((s) => need in s));
check('a deliberate honest-zero probe is still in the daily shapes',
  SHAPES.some((s) => s.tag === 'zero-probe'));

// ── 9. the runner reports the six numbers separately, and never merges layers ────────────────────
const runner = readFileSync(join(root, 'e2e/qa-coverage/run.mjs'), 'utf8');
for (const line of ['PRODUCTION API SEARCHES', 'UNIQUE COHORTS COVERED', 'STALE COHORTS REVISITED',
                    'NEVER-TESTED COHORTS REMAIN', 'HARNESS ERRORS'])
  check(`the run reports «${line}» as its own number`, runner.includes(line));
check('the run states it is a heartbeat, NOT a major certification',
  /NOT a major certification/i.test(runner),
  'calling a heartbeat a certification is the misreport the owner explicitly forbade');
check('the run holds the measured safety envelope (concurrency 2, ≤1.5/s)',
  /CONCURRENCY = 2/.test(runner) && /MIN_GAP_MS = 700/.test(runner));
check('the run writes coverage BACK to the ledger (otherwise stale-first cannot work tomorrow)',
  /ops_qa_record_coverage/.test(runner));
check('the run reads its plan from the ledger, stalest-first',
  /ops_qa_sweep_plan/.test(runner) && /planCells/.test(runner));
check('the cohort/table mapping is HARVESTED, never hardcoded in the harness (§1, §41.6)',
  /ops_qa_cohort_catalog/.test(runner) && !/aqar_residential_listings/.test(runner),
  'a table list pasted into the harness rots the moment a platform is added');

console.log(failures === 0
  ? '\n✓ the daily plan is stale-first, risk-first and budgeted — coverage, not request volume'
  : `\n✗ ${failures} check(s) FAILED`);
process.exit(failures ? 1 : 0);
