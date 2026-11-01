// A served SALE plot priced under its city's own floor is OUR claim until a page read says the source shows it
// (owner 2026-10-18, P1 «we can get sued»).
//
// THE GAP. rate_served_as_total only fires when the listing's own text states a total, so wasalt 5813546 sat at «6,500»
// for 467 m² in حي النرجس while it read 0 — and 473 plots fleet-wide were served under 2% of their city's median SAR/m²
// (a rate typed as the total, a view counter stored as the price, a 1-SAR placeholder × area …).
//
// THE RULE (migration *_mon_detect_served_total_below_city_floor.sql): floor = 2% of the median served SAR/m² of the city's
// own priced sale plots (200–5,000 m²), only where the city has ≥ 100 of them (a small place has no floor). Below it: a
// row with a page read in ops_price_source_verified → owner list (P3, number never changed); every other row → P1 to 🔧.
//
// This barrier LIFTS the constants from the committed SQL and EXECUTES the rule on a recorded-shape fixture; each
// loosening below must turn it red.   node --experimental-strip-types scripts/verify-served-total-below-city-floor.ts
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const dir = join(import.meta.dirname, '..', 'supabase', 'migrations');
const file = readdirSync(dir).filter((f) => /^\d{14}_mon_detect_served_total_below_city_floor\.sql$/.test(f)).sort().at(-1);
if (!file) { console.log('FAIL  migration *_mon_detect_served_total_below_city_floor.sql is missing'); process.exit(1); }
const sql = readFileSync(join(dir, file), 'utf8');

type Plot = { id: string; city: string; total: number; area: number; read?: boolean };
function problems(s: string): string[] {
  const fail: string[] = [];
  const scope = s.match(/from public\.search_listings_ar s\s+where s\.production_ready and s\.deal_ar = 'بيع' and s\.type_ar ~ 'أرض'\s+and s\.area_m2 between (\d+) and (\d+) and s\.price_total_effective > 0\)/);
  const floor = s.match(/select city_id, ([0-9.]+) \* percentile_cont\(0\.5\) within group \(order by ppm\) as floor_ppm\s+from land group by city_id having count\(\*\) >= (\d+)\)/);
  const below = /where l\.ppm < f\.floor_ppm/.test(s);
  const read = /exists \(select 1 from public\.ops_price_source_verified v\s+where v\.source_table = l\.source_table and v\.listing_id = l\.listing_id\)/.test(s);
  if (!scope) fail.push('the detector no longer reads what we SERVE (production_ready sale plots in search_listings_ar, by served total)');
  if (!floor) fail.push('the per-city floor (fraction × the city median, only with enough plots) is missing or reshaped');
  if (!below) fail.push('the comparison to the city floor is missing');
  if (!read) fail.push('a page read in ops_price_source_verified no longer separates case (b) from our claim');
  if (!/mon_raise\('P1', 'served_total_below_city_floor'/.test(s)) fail.push('an unverified plot below the floor no longer raises P1');
  if (!/count\(\*\) filter \(where not x\.source_shows_it\), count\(\*\) filter \(where x\.source_shows_it\)/.test(s)) fail.push('P1 must count only rows WITHOUT a page read (and the owner list only rows WITH one)');
  if (!/mon_raise\('P3', 'source_shows_small_total'/.test(s) || !/create or replace view public\.owner_price_source_shows_small_total/.test(s)) fail.push('case (b) is no longer listed for the owner (it would pass silently)');
  if (!/position\('''mon_detect_served_total_below_city_floor''' in d\) = 0 then raise exception 'roster edit did not land'/.test(s)) fail.push('the detector is not rostered');
  if (fail.length) return fail;
  const [lo, hi] = [Number(scope![1]), Number(scope![2])];
  const [frac, minN] = [Number(floor![1]), Number(floor![2])];
  // fixture: a big city of 120 plots at 2,500–3,700 SAR/m² plus the recorded shapes; a small place of 20 plots
  const plots: Plot[] = [];
  for (let i = 0; i < 120; i++) plots.push({ id: `r${i}`, city: 'الرياض', total: (2500 + i * 10) * 500, area: 500 });
  for (let i = 0; i < 20; i++) plots.push({ id: `q${i}`, city: 'قرية', total: 200 * 600, area: 600 });
  plots.push({ id: '5813546 «6,500» for 467 m²', city: 'الرياض', total: 6500, area: 467 });
  plots.push({ id: '5948262 «6,200» shown by wasalt (page read)', city: 'الرياض', total: 6200, area: 796, read: true });
  plots.push({ id: 'cheap but real (300 SAR/m², ~10% of median)', city: 'الرياض', total: 300 * 600, area: 600 });
  plots.push({ id: 'small place, «900» for 600 m²', city: 'قرية', total: 900, area: 600 });
  plots.push({ id: 'out of scope: 6,000 m² farm', city: 'الرياض', total: 6000, area: 6000 });
  const inScope = plots.filter((p) => p.area >= lo && p.area <= hi && p.total > 0);
  const byCity = new Map<string, number[]>();
  for (const p of inScope) byCity.set(p.city, [...(byCity.get(p.city) ?? []), p.total / p.area]);
  const floorOf = new Map<string, number>();
  for (const [c, v] of byCity) {
    if (v.length < minN) continue;
    const a = [...v].sort((x, y) => x - y); const m = a.length % 2 ? a[(a.length - 1) / 2] : (a[a.length / 2 - 1] + a[a.length / 2]) / 2;
    floorOf.set(c, frac * m);
  }
  const flagged = inScope.filter((p) => floorOf.has(p.city) && p.total / p.area < floorOf.get(p.city)!);
  const p1 = new Set(flagged.filter((p) => !p.read).map((p) => p.id));
  const owner = new Set(flagged.filter((p) => p.read).map((p) => p.id));
  const want: Array<[string, 'p1' | 'owner' | 'none']> = [
    ['5813546 «6,500» for 467 m²', 'p1'],
    ['5948262 «6,200» shown by wasalt (page read)', 'owner'],
    ['cheap but real (300 SAR/m², ~10% of median)', 'none'],
    ['small place, «900» for 600 m²', 'none'],
    ['out of scope: 6,000 m² farm', 'none'],
  ];
  for (const [id, w] of want) {
    const got = p1.has(id) ? 'p1' : owner.has(id) ? 'owner' : 'none';
    if (got !== w) fail.push(`${id}: ${got}, want ${w}`);
  }
  if (p1.size !== 1) fail.push(`ordinary priced plots were flagged (${p1.size - 1} extra)`);
  return fail;
}

let failed = 0;
const check = (label: string, ok: boolean, why = '') => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok || !why ? '' : ` — ${why}`}`); };
const mustCatch = (label: string, caught: boolean, why = '') => check(`mutant caught: ${label}`, caught, why);

const live = problems(sql);
check(`committed migration ${file} holds the rule`, live.length === 0, live.join('; '));
const mutants: Array<[string, (s: string) => string]> = [
  ['floor raised to 20% of the median (real cheap plots flagged)', (s) => s.replace('select city_id, 0.02 * percentile_cont', 'select city_id, 0.2 * percentile_cont')],
  ['floor lowered to 0.01% (the rate shape slips under it)', (s) => s.replace('select city_id, 0.02 * percentile_cont', 'select city_id, 0.0001 * percentile_cont')],
  ['every place gets a floor (rural land flagged)', (s) => s.replace('having count(*) >= 100)', 'having count(*) >= 1)')],
  ['reads the source table instead of what we serve', (s) => s.replace('from public.search_listings_ar s\n     where s.production_ready', 'from public.wasalt_residential_listings s\n     where s.production_ready')],
  ['a page read no longer exempts case (b) from P1', (s) => s.replace('count(*) filter (where not x.source_shows_it), count(*) filter (where x.source_shows_it)', 'count(*), count(*) filter (where x.source_shows_it)')],
  ['downgraded to P3', (s) => s.replace("mon_raise('P1', 'served_total_below_city_floor'", "mon_raise('P3', 'served_total_below_city_floor'")],
  ['owner list dropped', (s) => s.replace("mon_raise('P3', 'source_shows_small_total'", "mon_raise('P4', 'nothing'")],
  ['roster block removed', (s) => s.replace(/do \$roster\$[\s\S]*?\$roster\$;/, '')],
];
for (const [label, mutate] of mutants) {
  const m = mutate(sql);
  mustCatch(label, m !== sql && problems(m).length > 0, m === sql ? 'mutation did not apply (pattern drifted)' : 'verdict stayed green');
}
console.log(failed === 0 ? 'OK: a served plot under its city floor is never our silent claim' : `${failed} check(s) failed`);
process.exit(failed === 0 ? 0 : 1);
