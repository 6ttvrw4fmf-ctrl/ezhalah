// A wasalt ad whose seller typed the per-m² RATE into the price field must never be stored or served as that total
// (owner 2026-10-18, P1 «we can get sued»).
//
// THE DEFECT. wasalt 5848132 (1,225 m², حي النرجس) shows «8,000 ﷼» as its headline and «7 ﷼/متر مربع» under it — wasalt
// divides the rate by the area again — while the listing's own REGA description says «سعرها 9800000 ر.س» = 8,000 × 1,225.
// We stored price_total = 8,000 and it matched every «under 10,000» budget. 128 live sale rows had the same shape.
//
// THE RULE (migration *_wasalt_rate_is_not_the_total.sql): a SALE row whose description total T differs from the price and
// equals price × area within 1% holds a rate → price_per_meter := price, price_total := NULL (the search layer then shows
// ≈ rate × area, labelled). Anything else is left as the source shows it — never a plausibility fix.
//
// This barrier LIFTS the two description regexes and the trigger's condition from the committed SQL and EXECUTES them
// on the recorded pages and controls; each loosening below must turn it red.
//   node --experimental-strip-types scripts/verify-wasalt-rate-is-not-the-total.ts   (discovered by `npm test`)
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const dir = join(import.meta.dirname, '..', 'supabase', 'migrations');
const file = readdirSync(dir).filter((f) => /^\d{14}_wasalt_rate_is_not_the_total\.sql$/.test(f)).sort().at(-1);
if (!file) { console.log('FAIL  migration *_wasalt_rate_is_not_the_total.sql is missing'); process.exit(1); }
const sql = readFileSync(join(dir, file), 'utf8');
// The description READER is redefined later (20261018135052: both texts, three shapes); the newest definition is live.
const readerFile = readdirSync(dir).filter((f) => /^\d{14}_.*\.sql$/.test(f))
  .filter((f) => readFileSync(join(dir, f), 'utf8').includes('create or replace function public.wasalt_description_total(')).sort().at(-1)!;
const readerSql = readFileSync(join(dir, readerFile), 'utf8');

type Row = { deal: string; price: number; area: number; arDesc?: string; enDesc?: string };
function problems(s: string, r: string): string[] {
  const fail: string[] = [];
  // one text: the Arabic payload's description AND the English column, commas stripped, read in a FIXED order
  const both = /regexp_replace\(coalesce\(p_ar_data #>> '\{propertyInfo,description\}', ''\) \|\| ' ' \|\| coalesce\(p_description, ''\),\s*'\[,٬\]', '', 'g'\) as t/.test(r);
  const shapes = [...r.matchAll(/\(regexp_match\(x\.t, '([^']+)'\)\)\[1\]::numeric/g)].map((m) => m[1]);
  const [ar, en, seller] = shapes;
  if (!both) fail.push('the reader no longer searches BOTH texts (wasalt\'s /ar payload carries «Price: N SAR»; 5813546)');
  if (shapes.length !== 3) fail.push(`the reader must try exactly three shapes in order (found ${shapes.length})`);
  const cond = s.match(/if NEW\.transaction_type = '(\w+)' and NEW\.price_total > 0 and NEW\.area_m2 > 0 then[\s\S]*?if t is not null and t <> NEW\.price_total\s*and abs\(t - NEW\.price_total::numeric \* NEW\.area_m2\) <= ([0-9.]+) \* NEW\.price_total::numeric \* NEW\.area_m2 then\s*NEW\.price_per_meter := NEW\.price_total;\s*NEW\.price_total := null;/);
  if (!ar || !/^سعرها/.test(ar)) fail.push('the REGA template «سعرها N ر.س» is not read FIRST');
  if (!en || !/^Price/.test(en)) fail.push('the English template «Price: N SAR» is not read second');
  if (!seller || !/^السعر/.test(seller)) fail.push('the seller\'s own «السعر: N ﷼» is not read third');
  if (!cond) fail.push('the trigger condition (sale · T ≠ price · |T − price×area| ≤ tol · rate → price_per_meter, total → NULL) is missing or reshaped');
  if (!/before insert or update on public\.wasalt_residential_listings/.test(s) || !/before insert or update on public\.wasalt_commercial_listings/.test(s)) fail.push('the trigger no longer guards BOTH wasalt tables on insert AND update (a sweep would revert the repair)');
  if (!/create trigger trg_wrm_rate_is_not_the_total/.test(s)) fail.push('the trigger name no longer sorts after trg_wrl_preserve_detail (the stored detail payload must already be in NEW)');
  if (fail.length) return fail;
  const total = (row: Row): number | null => {
    const t = `${row.arDesc ?? ''} ${row.enDesc ?? ''}`.replace(/[,٬]/g, '');
    for (const re of shapes) { const m = t.match(new RegExp(re, 'u')); if (m) return Number(m[1]); }
    return null;
  };
  const tol = Number(cond![2]);
  const isRate = (r: Row) => {
    if (r.deal !== cond![1] || !(r.price > 0) || !(r.area > 0)) return false;
    const t = total(r);
    return t !== null && t !== r.price && Math.abs(t - r.price * r.area) <= tol * r.price * r.area;
  };
  const cases: Array<[string, Row, boolean]> = [
    ['5848132 (recorded /ar): 8,000 × 1,225 = «سعرها 9800000 ر.س»', { deal: 'Buy', price: 8000, area: 1225, arDesc: '<p>سعرها 9800000 ر.س</p>' }, true],
    ['5867449 (recorded): 9,200 × 2,000 = «سعرها 18,400,000 ر.س»', { deal: 'Buy', price: 9200, area: 2000, arDesc: 'سعرها 18,400,000 ر.س' }, true],
    ['5813546 (recorded /en): 6,500 × 467 ≈ «Price: 3041220 SAR» (0.2%)', { deal: 'Buy', price: 6500, area: 467, enDesc: 'Land Area: 467 SQM Price: 3041220 SAR' }, true],
    ['5813546 (stored /ar payload, 10-18): the English template inside the Arabic description', { deal: 'Buy', price: 6500, area: 467, arDesc: '<p>Land has electricity and water Connections Price: 3041220 SAR</p>' }, true],
    ['5857797 (live 10-18): the seller\'s «💰 السعر : 2200000 ﷼» = 5,500 × 400', { deal: 'Buy', price: 5500, area: 400, arDesc: '<p>💰 السعر : 2200000 ﷼</p>' }, true],
    ['control 9431470: template «سعرها 2000700» beats the seller line «السعر: 2000000» (template = price)', { deal: 'Buy', price: 2000700, area: 900, arDesc: '<p>💰 السعر: 2000000 ريال</p><p>سعرها 2000700 ر.س</p>' }, false],
    ['control: «سعر المتر 5500 ريال» is a rate line, not a total', { deal: 'Buy', price: 5500, area: 400, arDesc: 'سعر المتر 5500 ريال' }, false],
    ['control: description total = the price (40,269 live rows)', { deal: 'Buy', price: 9800000, area: 1225, arDesc: 'سعرها 9800000 ر.س' }, false],
    ['control: no description total — never a plausibility fix', { deal: 'Buy', price: 6500, area: 467 }, false],
    ['control: description total matches nothing (5% off)', { deal: 'Buy', price: 8000, area: 1225, arDesc: 'سعرها 10290000 ر.س' }, false],
    ['control: a rent row', { deal: 'Rent', price: 8000, area: 1225, arDesc: 'سعرها 9800000 ر.س' }, false],
    ['control: no area', { deal: 'Buy', price: 8000, area: 0, arDesc: 'سعرها 9800000 ر.س' }, false],
  ];
  for (const [label, row, want] of cases) if (isRate(row) !== want) fail.push(`${label}: rate=${isRate(row)}, want ${want}`);
  return fail;
}

// The companion detector flags OUR claim with the SAME predicate as the trigger, and is rostered.
const detFile = readdirSync(dir).filter((f) => /^\d{14}_mon_detect_rate_served_as_total\.sql$/.test(f)).sort().at(-1);
const detSql = detFile ? readFileSync(join(dir, detFile), 'utf8') : '';
function detProblems(s: string): string[] {
  const fail: string[] = [];
  if (!s) return ['companion detector migration *_mon_detect_rate_served_as_total.sql is missing'];
  const arms = s.match(/t\.total is not null and t\.total <> s\.price_total\s*and abs\(t\.total - s\.price_total::numeric \* s\.area_m2\) <= 0\.01 \* s\.price_total::numeric \* s\.area_m2/g) || [];
  if (arms.length !== 2) fail.push(`the detector must apply the trigger's predicate to the SERVED rows of both wasalt tables (found ${arms.length} arms)`);
  if (!/from public\.search_listings_ar s/.test(s)) fail.push('the detector no longer reads what we SERVE (search_listings_ar) — it would flag the source, not our claim');
  if (!/mon_raise\('P1', 'rate_served_as_total'/.test(s)) fail.push('a served rate no longer raises P1');
  if (!/position\('''mon_detect_rate_served_as_total''' in d\) = 0 then raise exception 'roster edit did not land'/.test(s)) fail.push('the detector is not rostered');
  return fail;
}

let failed = 0;
const check = (label: string, ok: boolean, why = '') => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok || !why ? '' : ` — ${why}`}`); };
const mustCatch = (label: string, caught: boolean, why = '') => check(`mutant caught: ${label}`, caught, why);

const live = problems(sql, readerSql);
check(`committed migrations ${file} + reader ${readerFile} hold the rule`, live.length === 0, live.join('; '));
const mutants: Array<[string, (s: string) => string]> = [
  ['any total accepted (tolerance 100%)', (s) => s.replace('<= 0.01 * NEW.price_total::numeric', '<= 1.0 * NEW.price_total::numeric')],
  ['T = price no longer excluded', (s) => s.replace('if t is not null and t <> NEW.price_total\n', 'if t is not null\n')],
  ['rent rows reclassified too', (s) => s.replace("if NEW.transaction_type = 'Buy' and NEW.price_total > 0", "if NEW.transaction_type = 'Rent' and NEW.price_total > 0")],
  ['update-only trigger (a fresh insert keeps the rate)', (s) => s.replaceAll('before insert or update on', 'before update on')],
];
for (const [label, mutate] of mutants) {
  const m = mutate(sql);
  mustCatch(label, m !== sql && problems(m, readerSql).length > 0, m === sql ? 'mutation did not apply (pattern drifted)' : 'verdict stayed green');
}
const readerMutants: Array<[string, (s: string) => string]> = [
  ['English template no longer read', (s) => s.replace("'Price\\s*:\\s*([0-9]+(\\.[0-9]+)?)\\s*SAR'", "'Prix\\s*:\\s*([0-9]+)'")],
  ['only the English column searched (the /ar payload\'s «Price:» missed again)', (s) => s.replace("coalesce(p_ar_data #>> '{propertyInfo,description}', '') || ' ' || ", '')],
  ['seller line read BEFORE the template (9431470 would flip)', (s) => s.replace(/(\(regexp_match\(x\.t, 'سعرها[^\n]+\n)([\s\S]*?)(\s*\(regexp_match\(x\.t, 'السعر[^\n]+)\)/, (_m, a, b, c) => `${c.trim()},\n    ${a.trim().replace(/,$/, '')}${b.replace(/,\s*$/, '')})`)],
  ['﷼ dropped from the seller line', (s) => s.replace("'السعر\\s*:?\\s*([0-9]+(\\.[0-9]+)?)\\s*(ر\\.س|ريال|﷼)'", "'السعر\\s*:?\\s*([0-9]+(\\.[0-9]+)?)\\s*(ر\\.س|ريال)'")],
];
for (const [label, mutate] of readerMutants) {
  const m = mutate(readerSql);
  mustCatch(label, m !== readerSql && problems(sql, m).length > 0, m === readerSql ? 'mutation did not apply (pattern drifted)' : 'verdict stayed green');
}
const dLive = detProblems(detSql);
check(`companion detector ${detFile ?? '(missing)'} flags our claim`, dLive.length === 0, dLive.join('; '));
mustCatch('detector reads the base table instead of what we serve', detProblems(detSql.replaceAll('from public.search_listings_ar s', 'from public.wasalt_residential_listings s')).length > 0);
mustCatch('detector downgraded to P3', detProblems(detSql.replace("mon_raise('P1', 'rate_served_as_total'", "mon_raise('P3', 'rate_served_as_total'")).length > 0);
mustCatch('detector roster block removed', detProblems(detSql.replace(/do \$roster\$[\s\S]*?\$roster\$;/, '')).length > 0);

console.log(failed === 0 ? 'OK: a wasalt per-m² rate can never be stored or served as the total again' : `${failed} check(s) failed`);
process.exit(failed === 0 ? 0 : 1);
