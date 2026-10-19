// Never serve a map pin outside Saudi Arabia (owner rule 2026-10-18: a location fix includes the map).
//
// THE DEFECT. 134 served rows carried lat/lng outside the kingdom — (0,0), ~(0.0002, 0.0004) off West Africa, swapped
// pairs, metres, Cairo, England — and the ad page drew them as the map. The sites publish those values themselves (the
// extractors copy them faithfully), so the stored value stays the source's; the index serves NULL and the page falls back
// to the district/city border.
//
// THE RULE (migration *_never_serve_a_pin_outside_ksa.sql): point_in_ksa(lat, lng) = 16–32.5 N and 34–56 E; the only
// writer of search_listings_ar.latitude/longitude (sync_listing_rich_attrs) wraps BOTH its SET and DIFF in it; a P1
// detector (rostered) flags any served pin outside. This barrier lifts the box and EXECUTES it on recorded points.
//   node --experimental-strip-types scripts/verify-served-pin-inside-ksa.ts   (discovered by `npm test`)
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const dir = join(import.meta.dirname, '..', 'supabase', 'migrations');
const file = readdirSync(dir).filter((f) => /^\d{14}_never_serve_a_pin_outside_ksa\.sql$/.test(f)).sort().at(-1);
if (!file) { console.log('FAIL  migration *_never_serve_a_pin_outside_ksa.sql is missing'); process.exit(1); }
const sql = readFileSync(join(dir, file), 'utf8');

function problems(s: string): string[] {
  const fail: string[] = [];
  const box = s.match(/create or replace function public\.point_in_ksa\(p_lat numeric, p_lng numeric\) returns boolean[\s\S]*?select p_lat between ([0-9.]+) and ([0-9.]+) and p_lng between ([0-9.]+) and ([0-9.]+)/);
  if (!box) return ['point_in_ksa() is missing or reshaped'];
  const [la0, la1, lo0, lo1] = box.slice(1, 5).map(Number);
  const inKsa = (lat: number, lng: number) => lat >= la0 && lat <= la1 && lng >= lo0 && lng <= lo1;
  const outside: Array<[string, number, number]> = [
    ['(0,0) sirdab/eaqartabuk/dealapp', 0, 0], ['West-Africa pin 0.000219/0.000356 (wasalt 5883987)', 0.000219, 0.000356],
    ['swapped wasalt 5792032', 46.837, 24.85], ['Cairo gomenassat', 30.0443, 31.2357], ['England gathern 733460', 51.18, -1.83],
    ['metres jurash', 182454, 424144], ['wasalt 5803420', 11.2477, 25.9967],
  ];
  // ponytail: a rectangle, so Amman / Kuwait City / Doha read as inside; a KSA polygon is the upgrade if a pin there appears.
  const inside: Array<[string, number, number]> = [
    ['Riyadh', 24.7136, 46.6753], ['Jeddah', 21.4858, 39.1925], ['Dammam', 26.4207, 50.0888], ['Najran', 17.4924, 44.1277],
    ['Qurayyat', 31.3318, 37.3428], ['Haql', 29.2894, 34.9395], ['Jazan', 16.8892, 42.5511], ['Batha border', 24.13, 51.6],
  ];
  for (const [n, a, b] of outside) if (inKsa(a, b)) fail.push(`${n} is judged inside the kingdom`);
  for (const [n, a, b] of inside) if (!inKsa(a, b)) fail.push(`${n} is judged outside the kingdom`);
  if (!/then format\('%I = case when public\.point_in_ksa\(d\.latitude, d\.longitude\) then d\.%I end', c, c\)/.test(s)) fail.push('the SET list no longer serves the pin only inside KSA');
  if (!/then format\('s\.%I is distinct from \(case when public\.point_in_ksa\(r\.latitude, r\.longitude\) then r\.%I end\)', c, c\)/.test(s)) fail.push('the DIFF list no longer uses the same expression (a served NULL would be rewritten every hour, or a leak missed)');
  if (!/case when c in \('latitude', 'longitude'\)[\s\S]*?case when c in \('latitude', 'longitude'\)/.test(s)) fail.push('the wrap no longer covers BOTH latitude and longitude in SET and DIFF');
  if (!/mon_raise\('P1', 'served_pin_outside_ksa'/.test(s)) fail.push('a served pin outside KSA no longer raises P1');
  const det = s.match(/create or replace function public\.mon_detect_served_pin_outside_ksa\(\)[\s\S]*?end \$function\$;/)?.[0] ?? '';
  if (!/from public\.search_listings_ar\s+where \(latitude is not null or longitude is not null\)\s+and not coalesce\(public\.point_in_ksa\(latitude, longitude\), false\)/.test(det)) fail.push('the detector no longer reads what we SERVE, or lets a half-null pair through');
  if (!/position\('''mon_detect_served_pin_outside_ksa''' in d\) = 0 then raise exception 'roster edit did not land'/.test(s)) fail.push('the detector is not rostered');
  return fail;
}

let failed = 0;
const check = (label: string, ok: boolean, why = '') => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok || !why ? '' : ` — ${why}`}`); };
const mustCatch = (label: string, caught: boolean, why = '') => check(`mutant caught: ${label}`, caught, why);

const live = problems(sql);
check(`committed ${file} keeps every served pin inside Saudi Arabia`, live.length === 0, live.join('; '));
const mutants: Array<[string, (s: string) => string]> = [
  ['box widened to the whole world', (s) => s.replace('select p_lat between 16 and 32.5 and p_lng between 34 and 56', 'select p_lat between -90 and 90 and p_lng between -180 and 180')],
  ['box shrunk to Riyadh only (Jeddah judged outside)', (s) => s.replace('select p_lat between 16 and 32.5 and p_lng between 34 and 56', 'select p_lat between 24 and 25.5 and p_lng between 46 and 47.5')],
  ['SET serves the raw pin again', (s) => s.replace("then format('%I = case when public.point_in_ksa(d.latitude, d.longitude) then d.%I end', c, c)", "then format('%I = d.%I', c, c)")],
  ['DIFF compares the raw pin (hourly rewrite / missed leak)', (s) => s.replace("then format('s.%I is distinct from (case when public.point_in_ksa(r.latitude, r.longitude) then r.%I end)', c, c)", "then format('s.%I is distinct from r.%I', c, c)")],
  ['detector downgraded to P3', (s) => s.replace("mon_raise('P1', 'served_pin_outside_ksa'", "mon_raise('P3', 'served_pin_outside_ksa'")],
  ['detector lets a (lat, NULL) pair through', (s) => s.replace("where (latitude is not null or longitude is not null)\n             and not coalesce", "where (latitude is not null and longitude is not null)\n             and not coalesce")],
  ['roster block removed', (s) => s.replace(/do \$roster\$[\s\S]*?\$roster\$;/, '')],
];
for (const [label, mutate] of mutants) {
  const m = mutate(sql);
  mustCatch(label, m !== sql && problems(m).length > 0, m === sql ? 'mutation did not apply (pattern drifted)' : 'verdict stayed green');
}
console.log(failed === 0 ? 'OK: no map pin outside Saudi Arabia is ever served' : `${failed} check(s) failed`);
process.exit(failed === 0 ? 0 : 1);
