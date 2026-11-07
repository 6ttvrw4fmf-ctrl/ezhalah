// THE SAME FIGURE IN BOTH PRICE BOXES (owner 2026-11-07: «Fix it all make sure it never ever happens»).
// aqargate's 11-05 rebuild copied each land ad's per-metre rate into the total box: 20 shown cards read «40 ﷼» for
// 106,474 m² in الدلم. 15 more on abaad / haraj / aqar / aqarcity carried the copy one way or the other. The migration
// *_price_box_equals_rate_guard.sql adds price_box_equals_rate_ar() as the last price rule of enforce_price_size_sanity(),
// teaches price_fidelity() the rule, and schedules mon_detect_price_box_equals_rate() (repair first, P1 for the residue).
// This barrier parses that migration, executes its bands on the real shapes, and proves each guard fails on its defect.
//   node --experimental-strip-types scripts/verify-price-box-equals-rate.ts   (in `npm test`)
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const DIR = join(import.meta.dirname, '..', 'supabase', 'migrations');
const file = readdirSync(DIR).filter((f) => f.endsWith('_price_box_equals_rate_guard.sql')).sort().pop();
let failed = 0;
const check = (label: string, ok: boolean, detail = '') => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok || !detail ? '' : `\n      ${detail}`}`); };
const mustCatch = (label: string, caught: boolean) => check(`MUTATION — ${label}`, caught);
if (!file) { console.error('FAIL  no *_price_box_equals_rate_guard.sql migration'); process.exit(1); }
const SQL = readFileSync(join(DIR, file), 'utf8');

// ── the bands, read from the SQL and executed on the real shapes ──
type Verdict = 'rate' | 'total' | null;
const bands = (sql: string) => {
  const t = /when p_figure >= (\d+) then 'total'/.exec(sql);
  const r = /when p_figure < (\d+) and p_figure \* p_area <= (\d+) and \(p_deal = 'بيع' or p_area >= (\d+)\) then 'rate'/.exec(sql);
  const g = /or p_area <= 1 or p_figure <= 0 or p_figure <> p_ppm then null/.test(sql) && /p_deal is null or p_deal not in \('بيع', 'إيجار'\)/.test(sql);
  return t && r && g ? { total: +t[1], rate: +r[1], cap: +r[2], rentArea: +r[3] } : null;
};
const judge = (b: NonNullable<ReturnType<typeof bands>>, deal: string | null, fig: number, ppm: number, area: number): Verdict => {
  if (!deal || !['بيع', 'إيجار'].includes(deal) || area <= 1 || fig <= 0 || fig !== ppm) return null;
  if (fig >= b.total) return 'total';
  if (fig < b.rate && fig * area <= b.cap && (deal === 'بيع' || area >= b.rentArea)) return 'rate';
  return null;
};
const CASES: Array<[string, string | null, number, number, number, Verdict]> = [
  ['aqargate 583449 الدلم land 106,474 m² «40» → rate', 'بيع', 40, 40, 106474, 'rate'],
  ['aqargate 24802225 الطائف land 180 m² «4,500» → rate', 'بيع', 4500, 4500, 180, 'rate'],
  ['aqar 14955334 farm 10,000 m² «600» → rate', 'بيع', 600, 600, 10000, 'rate'],
  ['aqar 1924571 workshop 20,105 m² rented «200» → rate', 'إيجار', 200, 200, 20105, 'rate'],
  ['abaad 17060146 land 710 m² «355,000» → total', 'بيع', 355000, 355000, 710, 'total'],
  ['aqar 293824 farm 3,482 m² rented «100,000» → total', 'إيجار', 100000, 100000, 3482, 'total'],
  ['an unclear 30,000 → untouched', 'بيع', 30000, 30000, 500, null],
  ['a small flat rented 5,000 on 120 m² → untouched (never loses its yearly price)', 'إيجار', 5000, 5000, 120, null],
  ['two different boxes → untouched', 'بيع', 1500, 1400, 437, null],
  ['1 m² → untouched', 'بيع', 5000, 5000, 1, null],
  ['no deal → untouched', null, 40, 40, 106474, null],
  ['a > 500,000,000 product → untouched', 'بيع', 9000, 9000, 100000, null],
];
const runCases = (sql: string) => { const b = bands(sql); return !!b && CASES.every(([, d, f, p, a, want]) => judge(b, d, f, p, a) === want); };
const b0 = bands(SQL);
check('price_box_equals_rate_ar() bands are readable from the migration', !!b0, 'the CASE in price_box_equals_rate_ar changed shape');
if (b0) for (const [label, d, f, p, a, want] of CASES) check(label, judge(b0, d, f, p, a) === want, `got ${judge(b0, d, f, p, a)}`);

// ── the wiring ──
const wired = (sql: string) =>
  sql.includes("a_trig text := E'    NEW.price_in_thousands := false;\\n  end if;\\n';")
  && /\|\| E'    when ''rate'' then\\n'\s*\|\| E'      if NEW\.deal_ar = ''إيجار'' then NEW\.price_annual := null; else NEW\.price_total := null; end if;\\n'\s*\|\| E'    when ''total'' then\\n'\s*\|\| E'      NEW\.price_per_meter := null;\\n'/.test(sql)
  && /if k <> 1 then raise exception 'enforce_price_size_sanity: expected exactly 1 anchor/.test(sql)
  && !/create\s+or\s+replace\s+function\s+public\.(enforce_price_size_sanity|price_fidelity)\b/i.test(sql);
const fidelity = (sql: string) =>
  sql.includes("and not (s.price_total is null and public.price_box_equals_rate_ar(s.deal_ar, x.src_total, s.price_per_meter, s.area_m2) = ''rate''))")
  && sql.includes("and not (s.price_annual is null and public.price_box_equals_rate_ar(s.deal_ar, x.src_annual, s.price_per_meter, s.area_m2) = ''rate''))");
const watched = (sql: string) =>
  /create or replace function public\.mon_detect_price_box_equals_rate\(\)[\s\S]*update public\.search_listings_ar s set price_per_meter = s\.price_per_meter[\s\S]*mon_raise\('P1', 'price_box_equals_rate'/.test(sql)
  && /select cron\.schedule\('mon-price-box-equals-rate', '9 6 \* \* \*'/.test(sql)
  && /select public\.mon_detect_price_box_equals_rate\(\);\n\ndo \$proof\$/.test(sql)
  && /if v_left <> 0 then raise exception 'PROOF: % shown rows still carry one figure in both boxes'/.test(sql);
check('the trigger empties exactly the copied box, spliced once after the thousands rule (never a full replace)', wired(SQL));
check('price_fidelity() reads an emptied copy as the rule at work, not drift', fidelity(SQL));
check('a daily detector repairs first, raises P1 for any shown residue, and the migration proved 0 left', watched(SQL));

mustCatch('the per-metre ceiling lowered to 10,000 (a real 50,000 rate would lose its box)', !runCases(SQL.replace("p_figure >= 100000 then 'total'", "p_figure >= 10000 then 'total'")));
mustCatch('the rent area floor dropped (a small flat would lose its yearly price)', !runCases(SQL.replace("or p_area >= 1000) then 'rate'", "or p_area >= 1) then 'rate'")));
mustCatch('the 500,000,000 cap dropped', !runCases(SQL.replace('p_figure * p_area <= 500000000', 'p_figure * p_area <= 5000000000000')));
mustCatch('the equality test dropped (different boxes judged)', !bands(SQL.replace(' or p_figure <> p_ppm then null', ' then null')));
mustCatch('the trigger empties the wrong box on a rate', !wired(SQL.replace("then NEW.price_annual := null; else NEW.price_total := null;", "then NEW.price_annual := null; else NEW.price_per_meter := null;")));
mustCatch('a full CREATE OR REPLACE of the trigger', !wired(`${SQL}\ncreate or replace function public.enforce_price_size_sanity() returns trigger as $$ $$;`));
mustCatch('price_fidelity left unaware of the rule', !fidelity(SQL.replace("x.src_total, s.price_per_meter, s.area_m2) = ''rate''))", "x.src_total, s.price_per_meter, s.area_m2) = ''nope''))")));
mustCatch('the detector raising without repairing first', !watched(SQL.replace('update public.search_listings_ar s set price_per_meter = s.price_per_meter', 'select 1')));

if (failed) { console.error(`\n❌ verify-price-box-equals-rate: ${failed} check(s) failed`); process.exit(1); }
console.log('\n✓ one figure in both price boxes: the copy is emptied, nothing invented, and a daily detector watches the residue');
