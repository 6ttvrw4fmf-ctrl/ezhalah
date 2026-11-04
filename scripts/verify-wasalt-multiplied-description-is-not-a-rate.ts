// A wasalt description total that is the seller's TOTAL multiplied by the area is not proof of a per-m² rate
// (2026-11-04, migration *_wasalt_multiplied_description_is_not_a_rate.sql).
//
// THE DEFECT. wasalt's REGA template prints «سعرها T ر.س». A seller who types the TOTAL into the per-m² box makes wasalt
// print T = price × area — the exact shape the rate trigger and its detector read as «the price is a rate». So the P1
// rate_served_as_total flagged 13 served totals that were the seller's own figure (13746443: 2,430,000 for 405 m², T =
// 984,150,000 = 2.43 M SAR/m²), and the trigger (bounded only by «price ≤ 2,000,000») turned two real totals into rates
// (14700765: salePrice 1,000,000 for 312 m² served «≈ 312,000,000»).
//
// THE RULE. T is the multiplied typo when T itself is impossible for the area — price_size_impossible(T), or outside
// مكة/المدينة and outside commercial T / area ≥ 100,000 SAR/m² (the owner-approved meter-box bar, 2026-10-28). ONE
// predicate, wasalt_description_total_is_multiplied(), called by BOTH the trigger and the detector's two arms.
//
// This barrier LIFTS the predicate's constants from the committed SQL and EXECUTES it on the recorded rows; each
// loosening below must turn it red.   node --experimental-strip-types scripts/verify-wasalt-multiplied-description-is-not-a-rate.ts
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const dir = join(import.meta.dirname, '..', 'supabase', 'migrations');
const file = readdirSync(dir).filter((f) => /^\d{14}_wasalt_multiplied_description_is_not_a_rate\.sql$/.test(f)).sort().at(-1);
if (!file) { console.log('FAIL  migration *_wasalt_multiplied_description_is_not_a_rate.sql is missing'); process.exit(1); }
const sql = readFileSync(join(dir, file), 'utf8');
const psiFile = readdirSync(dir).filter((f) => /^\d{14}_.*\.sql$/.test(f))
  .filter((f) => /create or replace function public\.price_size_impossible\(/i.test(readFileSync(join(dir, f), 'utf8'))).sort().at(-1)!;
const psiSql = readFileSync(join(dir, psiFile), 'utf8');

const psiM = psiSql.match(/select coalesce\(pt,0\) > (\d+)\s+or coalesce\(pa,0\) > \d+\s+or coalesce\(area,0\) > (\d+)\s+or \(area is not null and area > 0\s+and greatest\(coalesce\(pt,0\), coalesce\(pa,0\)\) \/ area > (\d+)\);/);
if (!psiM) { console.log(`FAIL  price_size_impossible in ${psiFile} is reshaped — re-derive this barrier`); process.exit(1); }
const [PSI_TOTAL, PSI_AREA, PSI_PPM] = psiM.slice(1).map(Number);
const impossible = (t: number, area: number) => t > PSI_TOTAL || area > PSI_AREA || (area > 0 && t / area > PSI_PPM);

type Row = { label: string; t: number; area: number; holy?: boolean; commercial?: boolean; want: boolean };
const rows: Row[] = [
  { label: '13746443 (recorded): 2,430,000 × 405 = «سعرها 984150000» — multiplied', t: 984150000, area: 405, want: true },
  { label: '15925545 (recorded): salePrice 4,500,000, «سعرها 4500000000» — multiplied', t: 4500000000, area: 1000, want: true },
  { label: '14700765 (recorded): salePrice 1,000,000, «سعرها 312500000» on 312 m² — multiplied', t: 312500000, area: 312, want: true },
  { label: '14619626 (recorded): salePrice 150,000, «سعرها 24000000» on 160 m² — multiplied', t: 24000000, area: 160, want: true },
  { label: '5848132 (recorded): a REAL rate 8,000 × 1,225 = «سعرها 9800000» — not multiplied', t: 9800000, area: 1225, want: false },
  { label: '16532378 (recorded): 28,000 × 2,152 = 60,272,800 — a plausible prime rate, not multiplied', t: 60272800, area: 2152, want: false },
  { label: 'holy city: 150,000 SAR/m² near the Haram is a real total, not multiplied', t: 24000000, area: 160, holy: true, want: false },
  { label: 'commercial: 150,000 SAR/m² is left to the rate rule', t: 24000000, area: 160, commercial: true, want: false },
  { label: 'commercial but truly impossible (> PSI ppm) — multiplied', t: 6000000000, area: 1000, commercial: true, want: true },
  { label: 'no area — never', t: 984150000, area: 0, want: false },
];

function problems(s: string): string[] {
  const fail: string[] = [];
  const fn = s.match(/create or replace function public\.wasalt_description_total_is_multiplied\(p_total numeric, p_area integer, p_holy boolean, p_commercial boolean\)[\s\S]*?select coalesce\(p_total > 0 and p_area > 0\s+and \(public\.price_size_impossible\(p_total, null, p_area\)\s+or \(not coalesce\(p_commercial, false\) and not coalesce\(p_holy, false\) and p_total \/ p_area >= (\d+)\)\), false\)\s*\$function\$;/);
  if (!fn) return ['the predicate wasalt_description_total_is_multiplied() is missing or reshaped'];
  const bar = Number(fn[1]);
  const multiplied = (r: Row) => r.t > 0 && r.area > 0 && (impossible(r.t, r.area) || (!r.commercial && !r.holy && r.t / r.area >= bar));
  for (const r of rows) if (multiplied(r) !== r.want) fail.push(`${r.label}: multiplied=${multiplied(r)}, want ${r.want}`);
  // the trigger calls it, inside its rate predicate
  if (!/and abs\(t - NEW\.price_total::numeric \* NEW\.area_m2\) <= 0\.01 \* NEW\.price_total::numeric \* NEW\.area_m2\s+and not public\.wasalt_description_total_is_multiplied\(t, NEW\.area_m2, NEW\.city in \('Mecca', 'Medina'\), TG_TABLE_NAME like '%commercial%'\) then/.test(s)) {
    fail.push('the rate TRIGGER no longer excludes a multiplied description (14700765 would be served «≈ 312,000,000» again)');
  }
  if (!/raise exception 'wasalt_rate_is_not_the_total: predicate line not found/.test(s)) fail.push('the trigger edit is no longer anchored fail-closed');
  // the detector's two arms apply the SAME predicate as the trigger
  const res = /join public\.wasalt_residential_listings w[\s\S]*?and s\.price_total <= 2000000\s+and not public\.wasalt_description_total_is_multiplied\(t\.total, s\.area_m2, s\.city_ar in \('مكة المكرمة', 'المدينة المنورة'\), false\)/.test(s);
  const com = /join public\.wasalt_commercial_listings w[\s\S]*?and s\.price_total <= 2000000\s+and not public\.wasalt_description_total_is_multiplied\(t\.total, s\.area_m2, s\.city_ar in \('مكة المكرمة', 'المدينة المنورة'\), true\)/.test(s);
  if (!res || !com) fail.push('the DETECTOR arms no longer apply the trigger\'s exclusions (13 seller totals would read as served rates again)');
  if (!/from public\.search_listings_ar s/.test(s)) fail.push('the detector no longer reads what we SERVE');
  if (!/select public\.mon_detect_rate_served_as_total\(\);/.test(s)) fail.push('the repair no longer names its watching detector');
  return fail;
}

let failed = 0;
const check = (label: string, ok: boolean, why = '') => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok || !why ? '' : ` — ${why}`}`); };
const mustCatch = (label: string, caught: boolean, why = '') => check(`mutant caught: ${label}`, caught, why);
const live = problems(sql);
check(`${file} holds the rule (price_size_impossible from ${psiFile})`, live.length === 0, live.join('; '));

const mutants: Array<[string, (s: string) => string]> = [
  ['bar raised to 10,000,000 SAR/m² (14700765 relabelled again)', (s) => s.replace('p_total / p_area >= 100000', 'p_total / p_area >= 10000000')],
  ['bar lowered to 5,000 SAR/m² (a real 8,000 rate read as a typo)', (s) => s.replace('p_total / p_area >= 100000', 'p_total / p_area >= 5000')],
  ['holy-city exemption dropped', (s) => s.replace('and not coalesce(p_holy, false) ', '')],
  ['trigger no longer calls the predicate', (s) => s.replace(/\n\s+and not public\.wasalt_description_total_is_multiplied\(t, NEW\.area_m2[^\n]*\) then/, ' then')],
  ['detector residential arm drops the predicate', (s) => s.replace(/(\s+and not public\.wasalt_description_total_is_multiplied\(t\.total[^\n]*, false\))/, '')],
  ['detector commercial arm drops the predicate', (s) => s.replace(/(\s+and not public\.wasalt_description_total_is_multiplied\(t\.total[^\n]*, true\))/, '')],
  ['detector drops the trigger\'s 2,000,000 bound', (s) => s.replace('and s.price_total <= 2000000\n', '\n')],
  ['trigger edit loses its anchor', (s) => s.replace("raise exception 'wasalt_rate_is_not_the_total: predicate line not found", "raise notice 'x")],
];
for (const [label, mutate] of mutants) {
  const m = mutate(sql);
  mustCatch(label, m !== sql && problems(m).length > 0, m === sql ? 'mutation did not apply (pattern drifted)' : 'verdict stayed green');
}
console.log(failed === 0 ? 'OK: a multiplied wasalt description is never read as a rate, by the trigger or by its detector' : `${failed} check(s) failed`);
process.exit(failed === 0 ? 0 : 1);
