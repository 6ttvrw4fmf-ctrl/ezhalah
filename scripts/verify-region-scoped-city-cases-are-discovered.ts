// THE REGION+CITY LIVE CHECK DISCOVERS ITS AMBIGUOUS CITIES — it cannot go stale on a catalog cleanup.
//
// Measured 2026-11-03: region-scoped-city-live-check.yml had failed every scheduled run since
// 2026-10-30 (alert_event 12242, search_live_check_failed) with «total_count -1 … the corpus went
// empty». Nothing was wrong with search: the 2026-10-26 catalog cleanup retired three of its six
// hardcoded (name, region) pairs as duplicate cities (القويعية/المدينة, البدائع/حائل, بيش/عسير — 0.1 to
// 7.7 km from the surviving city). The fix is scripts/lib/ambiguousCityCases.ts: cases come from the
// unscoped search's own rows. This file EXECUTES that discovery (hermetic, no network) and proves each
// assertion fails on the defect it exists for, then pins that the live check really uses it.
//
//   node --experimental-strip-types scripts/verify-region-scoped-city-cases-are-discovered.ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { discoverAmbiguousCityCases, type Discovery } from './lib/ambiguousCityCases.ts';

const root = join(import.meta.dirname, '..');
let failed = 0;
const check = (label: string, ok: boolean, extra = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${!ok && extra ? `\n      ${extra}` : ''}`);
};

type Impl = (rows: Record<string, any[] | null>, min?: number) => Discovery;
const R = (city: string, region: string) => ({ city_ar: city, region_ar: region });

// The world after the 2026-10-26 cleanup: القويعية only in الرياض now, الشيحية/الذيبية/الشقيق in two regions.
const AFTER_CLEANUP: Record<string, any[] | null> = {
  'القويعية': [R('القويعية', 'منطقة الرياض'), R('القويعية', 'منطقة الرياض')],
  'الشيحية': [R('الشيحية', 'منطقة حائل'), R('الشيحية', 'منطقة القصيم')],
  'الذيبية': [R('الذيبية', 'منطقة القصيم'), R('الذيبية', 'منطقة الرياض')],
  'الشقيق': [R('الشقيق', 'منطقة عسير'), R('الشقيق', 'منطقة جازان')],
};

function assertions(impl: Impl): string[] {
  const bad: string[] = [];
  const d = impl(AFTER_CLEANUP);
  // 1. a name now in ONE region yields no case — it would only ever read "corpus went empty".
  if (d.cases.some((c) => c.city === 'القويعية')) bad.push('a single-region name still produced cases');
  // 2. every region that really holds a two-region name is a case, with its real region id.
  const keys = new Set(d.cases.map((c) => `${c.city}@${c.regionId}`));
  for (const k of ['الشيحية@8', 'الشيحية@4', 'الذيبية@4', 'الذيبية@1', 'الشقيق@6', 'الشقيق@10']) {
    if (!keys.has(k)) bad.push(`missing case ${k}`);
  }
  if (d.problems.length !== 0) bad.push(`clean input raised problems: ${d.problems.join('; ')}`);
  // 3. a FAILED unscoped call is a problem, never "this name is not ambiguous".
  const withFailure = impl({ ...AFTER_CLEANUP, 'بيش': null });
  if (!withFailure.problems.some((p) => p.includes('بيش'))) bad.push('a failed fetch read as an empty answer');
  // 4. too few ambiguous names left is RED — the honest form of "proves nothing".
  const thin = impl({ 'القويعية': AFTER_CLEANUP['القويعية'], 'الشيحية': AFTER_CLEANUP['الشيحية'] });
  if (thin.problems.length === 0) bad.push('one ambiguous name was accepted as enough');
  // 5. a row for a different city name (a broad match) never makes a name ambiguous.
  const foreign = impl({ ...AFTER_CLEANUP, 'بيش': [R('بيش', 'منطقة جازان'), R('غير بيش', 'منطقة عسير')] });
  if (foreign.cases.some((c) => c.city === 'بيش')) bad.push('another city\'s row made a name ambiguous');
  return bad;
}

const real = assertions(discoverAmbiguousCityCases);
check('discoverAmbiguousCityCases derives cases from live rows (5 assertions)', real.length === 0, real.join('; '));

// MUTATION PROOFS — each mutant is the defect one assertion exists for.
const HARDCODED: Impl = () => ({
  ambiguousNames: ['القويعية', 'البدائع', 'بيش'], problems: [],
  cases: [{ city: 'القويعية', regionId: 1, regionAr: 'منطقة الرياض', label: 'a' }, { city: 'القويعية', regionId: 3, regionAr: 'منطقة المدينة المنورة', label: 'b' }],
});
const NULL_IS_EMPTY: Impl = (rows, min) => discoverAmbiguousCityCases(
  Object.fromEntries(Object.entries(rows).map(([k, v]) => [k, v ?? []])), min);
const NO_MINIMUM: Impl = (rows) => discoverAmbiguousCityCases(rows, 0);
const IGNORES_CITY: Impl = (rows, min) => discoverAmbiguousCityCases(
  Object.fromEntries(Object.entries(rows).map(([k, v]) => [k, v === null ? null : v.map((r) => ({ ...r, city_ar: k }))])), min);
for (const [name, impl] of [['the old hardcoded pairs', HARDCODED], ['a failed fetch treated as no rows', NULL_IS_EMPTY],
  ['no minimum of ambiguous names', NO_MINIMUM], ['rows of another city counted', IGNORES_CITY]] as const) {
  check(`(mutation) catches: ${name}`, assertions(impl).length > 0);
}

// WIRING — the live check uses the discovery and no longer carries a hardcoded case table.
const live = readFileSync(join(root, 'scripts/verify-region-scoped-city-live.ts'), 'utf8');
check('the live check imports discoverAmbiguousCityCases', /from '\.\/lib\/ambiguousCityCases\.ts'/.test(live) && live.includes('discoverAmbiguousCityCases('));
check('the live check carries no hardcoded (city, regionId) case literal', !/\{\s*city:\s*'[^']+',\s*regionId:\s*\d+/.test(live));

if (failed) { console.error(`\nverify-region-scoped-city-cases-are-discovered: ${failed} FAILED`); process.exit(1); }
console.log('\nverify-region-scoped-city-cases-are-discovered: all checks passed');
