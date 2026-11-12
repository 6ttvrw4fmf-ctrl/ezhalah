// A TINY PRICE IS JUDGED BY ITS NEIGHBOURS (owner 2026-11-11: «check the displayed price … land price … the ones beside
// it», then «make it a guard and rule applies to properties … it's a must»).
//
// «1,350 ﷼» for a whole 750 m² plot in الأحساء is either 1,350 a metre or 1,350 thousand. When the price band could not
// tell (both readings inside it) and the ad said nothing, the two price rules stood aside and the card showed the raw
// figure. The tie-breaker compares both readings with the SAME neighbourhood's median price and picks one only when it
// is within ½×–2× of it AND clearly closer (log distance ≥ 0.2); otherwise the source figure stays (migration
// 20261111233000).
//
// Hermetic (committed SQL only, no DB). Auto-discovered by `npm test` (scripts/verify-*.ts).
//   1. the judge keeps its window, its margin and its «no neighbours, no verdict» guard — with mutation proofs;
//   2. the judge, run with the constants READ FROM THE SQL, on the real ads that defined it (a changed threshold flips a
//      real verdict here, not on a customer's card);
//   3. it is asked only where the band cannot decide, and the ad's own words always win — mutation proofs;
//   4. both price rules ask the SAME verdict (they can never both fire), and homes are read per metre only on it;
//   5. the neighbours are the source's own prices (bands exclude every row a rule rewrote) and the median exists;
//   6. the daily detector watches every sale and alarms when the medians are missing;
//   7. the core land rules are not redefined here, and no later migration drops the neighbour step.
// The migration's own $proof$ block executes the REAL SQL judge on the same ads at apply time.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const MIG = join(ROOT, 'supabase', 'migrations');
const FILE = readdirSync(MIG).find((f) => /^\d{14}_price_unit_by_neighbours\.sql$/.test(f)) ?? '';
const SQL = FILE ? readFileSync(join(MIG, FILE), 'utf8') : '';

let failed = 0;
const check = (label: string, ok: boolean) => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`); };
const mustCatch = (label: string, caught: boolean) => check(`catches: ${label}`, caught);
const norm = (s: string) => s.replace(/\s+/g, ' ');
// The LAST definition in the file, through its own closing dollar tag ($function$, $$, …); '' when the tag never closes,
// so a body written with another tag can never read as healthy (verify-function-body-windows-fail-closed.ts).
const fnBody = (sql: string, name: string): string => {
  const re = new RegExp(`create\\s+or\\s+replace\\s+function\\s+public\\.${name}\\s*\\(`, 'gi');
  let start = -1, m: RegExpExecArray | null;
  while ((m = re.exec(sql))) start = m.index;
  if (start < 0) return '';
  const tagM = /\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(start));
  if (!tagM) return '';
  const openAt = start + tagM.index;
  const closeAt = sql.indexOf(tagM[0], openAt + tagM[0].length);
  return closeAt < 0 ? '' : sql.slice(start, closeAt + tagM[0].length);
};

check('the migration exists', FILE !== '' && SQL.length > 0);

// ── 1. the judge ────────────────────────────────────────────────────────────────────────────────────────────────────
const JUDGE = fnBody(SQL, 'price_unit_by_neighbours_ar');
export function judgeGuardsOk(body: string): boolean {
  const b = norm(body);
  return /when neighbour_median is null or neighbour_median <= 0 then null/.test(b)
    && (b.match(/between 0\.5 \* neighbour_median and 2 \* neighbour_median/g) ?? []).length === 2
    && (b.match(/\+ 0\.2 <= abs\(ln\(/g) ?? []).length === 2
    && /then 'per_meter'/.test(b) && /then 'thousands'/.test(b);
}
check('the judge exists', JUDGE.length > 0);
check('the judge keeps its window (½×–2×), its margin (0.2) and its no-neighbours guard', judgeGuardsOk(JUDGE));
mustCatch('a judge without the margin (a coin flip would be decided)', !judgeGuardsOk(JUDGE.replaceAll('+ 0.2 ', '')));
mustCatch('a judge with a wider window (a far-off reading could win)', !judgeGuardsOk(JUDGE.replaceAll('0.5 * neighbour_median', '0.1 * neighbour_median')));
mustCatch('a judge that answers without neighbours', !judgeGuardsOk(JUDGE.replace('when neighbour_median is null or neighbour_median <= 0 then null', '')));

// ── 2. the judge on real ads, with the constants read from the SQL ─────────────────────────────────────────────────
type K = { lo: number; hi: number; margin: number };
export function constantsOf(body: string): K | null {
  const b = norm(body);
  const w = b.match(/between ([0-9.]+) \* neighbour_median and ([0-9.]+) \* neighbour_median/);
  const m = b.match(/\+ ([0-9.]+) <= abs\(ln\(/);
  return w && m ? { lo: Number(w[1]), hi: Number(w[2]), margin: Number(m[1]) } : null;
}
export function judge(k: K, pm: number | null, th: number | null, med: number | null): 'per_meter' | 'thousands' | null {
  if (med == null || !(med > 0)) return null;
  const d = (x: number) => Math.abs(Math.log(x / med));
  const inWin = (x: number | null) => x != null && x > 0 && x >= k.lo * med && x <= k.hi * med;
  if (inWin(pm) && (th == null || !(th > 0) || d(pm as number) + k.margin <= d(th))) return 'per_meter';
  if (inWin(th) && (pm == null || !(pm > 0) || d(th as number) + k.margin <= d(pm))) return 'thousands';
  return null;
}
// Measured 2026-11-11 on the review list (figure, area, neighbourhood median per m² — or a whole-price median for homes).
const REAL: { what: string; pm: number; th: number; med: number; want: 'per_meter' | 'thousands' | null }[] = [
  { what: 'abwbna الأحساء اليمامة «1,350», 750 m², neighbours 1,400/m²', pm: 1350, th: 1350000 / 750, med: 1400, want: 'per_meter' },
  { what: 'wasalt الرياض النرجس «6,700», 848 m², neighbours 6,694/m² — thousands is only 18 % off too: too close', pm: 6700, th: 6700000 / 848, med: 6694, want: null },
  { what: 'abralosol الهفوف الراشدية «614», 307 m², neighbours 1,900/m²', pm: 614, th: 614000 / 307, med: 1900, want: 'thousands' },
  { what: 'dealapp محايل الضرس «280», 401 m², neighbours 1,000/m² (reading 698/m², ½× floor 500)', pm: 280, th: 280000 / 401, med: 1000, want: 'thousands' },
  { what: 'wasalt الرياض الملقا «9,100», 816 m², neighbours 10,000/m² — too close', pm: 9100, th: 9100000 / 816, med: 10000, want: null },
  { what: 'haraj الطائف الجال «300», 450 m², neighbours 1,597/m² — both readings far off', pm: 300, th: 300000 / 450, med: 1597, want: null },
  { what: 'a plot with no neighbourhood median', pm: 1350, th: 1800, med: NaN, want: null },
  { what: 'a home read as a whole price: muhaysini نمار floor «3,300», 182 m² → 600,600 vs 3.3 M (illustrative median 750,000)', pm: 3300 * 182, th: 3300000, med: 750000, want: 'per_meter' },
];
const K0 = constantsOf(JUDGE);
check('the judge\'s constants are readable from the SQL', K0 != null);
if (K0) {
  for (const r of REAL) check(`real ad: ${r.what} → ${r.want ?? 'stays as the site shows'}`, judge(K0, r.pm, r.th, Number.isNaN(r.med) ? null : r.med) === r.want);
  const flips = (k: K) => REAL.some((r) => judge(k, r.pm, r.th, Number.isNaN(r.med) ? null : r.med) !== r.want);
  mustCatch('a margin of 0 (the الملقا coin flip would be decided)', flips({ ...K0, margin: 0 }));
  mustCatch('a window of ⅓×–3× (الجال «300» would be read in thousands)', flips({ ...K0, lo: 1 / 3, hi: 3 }));
}

// ── 3. asked only where the band cannot decide; the ad's own words win ──────────────────────────────────────────────
const VERDICT = fnBody(SQL, 'price_unit_neighbour_verdict_ar');
export function verdictGatesOk(body: string): boolean {
  const b = norm(body);
  return /if v_lo is null or not \(v_pm between v_lo and v_hi and v_k between v_lo and v_hi\) then return null; end if;/.test(b)
    && /if v_k between v_lo and v_hi then if not \(v_pm between v_lo and v_hi\) then return null; end if;/.test(b)
    && /elsif not \(p_deal = 'بيع' and v_pm between v_lo and v_hi\) then return null;/.test(b)
    && /return public\.price_unit_by_neighbours_ar\(v_pm, v_k, v_med\);/.test(b)
    && /v_pm := p; .*v_k := p \* 1000 \/ area;/.test(b)
    && /v_pm := p \* area; .*v_k := p \* 1000;/.test(b);
}
check('the verdict asks the neighbours only where the band cannot decide (land: both readings in band; homes: both, or a sale\'s per-m² only)', verdictGatesOk(VERDICT));
mustCatch('a verdict that overrides a land band that already decided',
  !verdictGatesOk(VERDICT.replace('or not (v_pm between v_lo and v_hi and v_k between v_lo and v_hi)', '')));
mustCatch('a verdict that overrides a home band that already said «thousands»',
  !verdictGatesOk(VERDICT.replace('if not (v_pm between v_lo and v_hi) then return null; end if;', '')));

const LAND_SERVED = fnBody(SQL, 'land_ppm_typed_as_total_served_ar');
const K_SERVED = fnBody(SQL, 'price_in_thousands_served_ar');
const WORDS_FIRST = /if not coalesce\(v_pm, false\) and not coalesce\(v_k, false\) then v_nb := public\.price_unit_neighbour_verdict_ar\([^;]*\); v_pm := v_nb = 'per_meter'; v_k := v_nb = 'thousands'; end if;/;
export function wordsFirstOk(body: string): boolean { return WORDS_FIRST.test(norm(body)); }
check('the per-metre rule asks the neighbours only when the ad\'s words are silent', wordsFirstOk(LAND_SERVED));
check('the thousands rule asks the neighbours only when the ad\'s words are silent', wordsFirstOk(K_SERVED));
mustCatch('a rule where the neighbours outvote the ad\'s own words',
  !wordsFirstOk(LAND_SERVED.replace('if not coalesce(v_pm, false) and not coalesce(v_k, false) then', 'if true then')));

// ── 4. one verdict for both rules; homes per metre only on it ───────────────────────────────────────────────────────
check('both rules call the same verdict with the same deal/figure/area/type/city/district',
  /price_unit_neighbour_verdict_ar\('بيع', p, area, p_type, p_city, p_district\)/.test(LAND_SERVED)
  && /price_unit_neighbour_verdict_ar\(p_deal, p, area, p_type, p_city, p_district\)/.test(K_SERVED));
export function homePerMetreOk(body: string): boolean {
  const b = norm(body);
  return /if not public\.price_in_thousands_type_ok_ar\(p_type\) or p >= 10000 or abs\(p - area\) <= 1 or p \* area > 500000000 or \(ppm is not null and abs\(ppm \* area - p\) <= 0\.05 \* p\) or coalesce\(v_k, false\) then return null; end if;/.test(b)
    && /if public\.price_unit_neighbour_verdict_ar\('بيع', p, area, p_type, p_city, p_district\) = 'per_meter' then return p \* area; end if; return null;/.test(b);
}
check('a home is read per metre ONLY on the neighbours\' clear verdict, never when its words say «ألف», never on a real rate', homePerMetreOk(LAND_SERVED));
mustCatch('a home read per metre although the ad says «ألف»', !homePerMetreOk(LAND_SERVED.replace(' or coalesce(v_k, false) then', ' then')));
mustCatch('a home read per metre although its own per-m² box already explains the price',
  !homePerMetreOk(LAND_SERVED.replace(' or (ppm is not null and abs(ppm * area - p) <= 0.05 * p)', '')));
check('the land rule still hands the core land guard its band and verdict', /return public\.land_ppm_typed_as_total_ar\(p, area, ppm, v_lo, v_hi, v_pm, v_k\);/.test(LAND_SERVED));
check('the thousands rule still hands the core thousands guard its band and verdict', /return public\.price_in_thousands_ar\(p, v_land, v_rent, area, ppm, v_lo, v_hi, v_pm, v_k\);/.test(K_SERVED));

// ── 5. the neighbours are the source's own prices, and their median exists ──────────────────────────────────────────
const LAND_BAND = fnBody(SQL, 'refresh_land_sale_ppm_band');
const K_BAND = fnBody(SQL, 'refresh_price_thousands_band');
export function bandOk(body: string): boolean {
  const b = norm(body);
  return /percentile_cont\(0\.5\) within group \(order by h\.(ppm|p)\) med/.test(b)
    && /lo, hi, med, (cnt|n)/.test(b)
    && /not s\.(ppm_typed_as_total|price_in_thousands) and not s\.(ppm_typed_as_total|price_in_thousands)/.test(b);
}
check('the land band carries the neighbours\' median and leaves out every rewritten row', bandOk(LAND_BAND));
check('the home band carries the neighbours\' median and leaves out every rewritten row', bandOk(K_BAND));
mustCatch('a land band fed by prices a rule already multiplied (a feedback loop)', !bandOk(LAND_BAND.replace(' and not s.price_in_thousands', '')));
mustCatch('a band without its median (the judge would be blind)', !bandOk(K_BAND.replace('percentile_cont(0.5) within group (order by h.p) med', 'null::numeric med')));
check('both band tables gain the median column', /alter table public\.land_sale_ppm_band add column if not exists med numeric;/.test(SQL)
  && /alter table public\.price_thousands_band add column if not exists med numeric;/.test(SQL));

// ── 6. the daily detector ───────────────────────────────────────────────────────────────────────────────────────────
const DET = fnBody(SQL, 'mon_detect_land_ppm_typed_as_total');
export function detectorOk(body: string): boolean {
  const b = norm(body);
  return /'price_unit_neighbour_median_missing'/.test(b) && /count\(\*\) filter \(where med is null\)/.test(b)
    && !/type_ar like 'أرض%'/.test(b)
    && (b.match(/land_ppm_typed_as_total_served_ar\(s\.source_table/g) ?? []).length === 2
    && /REPAIR FIRST/.test(body);
}
check('the detector re-judges every sale and alarms when the medians are missing', detectorOk(DET));
mustCatch('a detector that only watches land again', !detectorOk(DET.replace("where s.deal_ar = 'بيع' and not s.ppm_typed_as_total", "where s.deal_ar = 'بيع' and s.type_ar like 'أرض%' and not s.ppm_typed_as_total")));
mustCatch('a detector without the missing-median alarm', !detectorOk(DET.replaceAll('price_unit_neighbour_median_missing', 'x')));

// ── 7. the core rules stay untouched; the proof block runs the real judge; no later migration drops the step ─────────
check('the core land guards are NOT redefined here (land_ppm_typed_as_total_ar, price_in_thousands_ar)',
  !/create or replace function public\.land_ppm_typed_as_total_ar\(/.test(SQL) && !/create or replace function public\.price_in_thousands_ar\(/.test(SQL));
check('the apply-time proof runs the real judge on the same real ads (per metre, thousands, too close, no neighbours, far off)',
  /do \$proof\$/.test(SQL)
  && /price_unit_by_neighbours_ar\(1350, 1350000\.0 \/ 750, 1400\) is distinct from 'per_meter'/.test(SQL)
  && /price_unit_by_neighbours_ar\(614, 614000\.0 \/ 307, 1900\) is distinct from 'thousands'/.test(SQL)
  && /price_unit_by_neighbours_ar\(9100, 9100000\.0 \/ 816, 10000\) is not null/.test(SQL)
  && /price_unit_by_neighbours_ar\(1350, 1800, null\) is not null/.test(SQL));
const later = readdirSync(MIG).filter((f) => f.endsWith('.sql') && FILE && f > FILE);
for (const [name, ok] of [
  ['price_unit_by_neighbours_ar', judgeGuardsOk], ['price_unit_neighbour_verdict_ar', verdictGatesOk],
  ['land_ppm_typed_as_total_served_ar', (b: string) => wordsFirstOk(b) && homePerMetreOk(b)],
  ['price_in_thousands_served_ar', wordsFirstOk], ['refresh_land_sale_ppm_band', bandOk], ['refresh_price_thousands_band', bandOk],
  ['mon_detect_land_ppm_typed_as_total', detectorOk],
] as [string, (b: string) => boolean][]) {
  check(`no later migration redefines ${name} without the neighbour rule`,
    later.every((f) => { const b = fnBody(readFileSync(join(MIG, f), 'utf8'), name); return !b || ok(b); }));
}

console.log(failed === 0 ? '\n✓ price unit by neighbours: judge guarded, asked only when the band and the words are silent, watched daily'
                         : `\n✗ ${failed} check(s) failed`);
process.exit(failed === 0 ? 0 : 1);
