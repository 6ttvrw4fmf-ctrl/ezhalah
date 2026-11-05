// SAME HOUSE, POSTED TWICE ON ONE SITE → ONE PIN, SEPARATE CARDS (owner 2026-11-04: «they become like 2 … but same pin
// … do it for everything they basically merge but show separately of course»).
//
// The merge lives in SQL (map_pin_snap + map_pin_snap_refresh_ar + map_pins_ar's exact branch), so this check reads the
// LATEST committed definition of each piece and holds the rules that make it safe:
//   1. every exact-point read in map_pins_ar draws at the snapped spot (all three street-zoom paths, not one of them);
//   2. a snap is ignored when the listing has since moved (~1 km), so a stale snap never misplaces a pin;
//   3. the box filter stays on the listing's OWN coordinates (the index keeps serving it — the 2026-11-03 slow-zoom fix);
//   4. twins are only ever grouped INSIDE one site and one deal/price/area/type/bedrooms (two sites are two ads);
//   5. placeholder pins never take part, the refresh is scheduled, and nothing is removed — the pin keeps every id.
// Each rule has a mutation that must be caught. The live half of the claim (the aqar pair 6797149/6834756 returns one
// spot with n = 2) is production state, measured when the change shipped, not something an offline suite can see.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname ?? '.', '..');
let failed = 0;
const check = (label: string, ok: boolean) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`); if (!ok) failed++; };
const mustCatch = (label: string, caught: boolean) => check(`(mutation) catches ${label}`, caught);

const dir = join(root, 'supabase/migrations');
const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
const latestDefining = (re: RegExp) => { for (const f of [...files].reverse()) { const sql = readFileSync(join(dir, f), 'utf8'); const m = re.exec(sql); if (m) return { f, body: sql.slice(m.index) }; } return null; };
const fnBody = (body: string) => { const a = body.indexOf('$$'); const b = body.indexOf('$$', a + 2); return a < 0 || b < 0 ? '' : body.slice(a, b); };

const pins = latestDefining(/create or replace function public\.map_pins_ar\(/i);
const refresh = latestDefining(/create or replace function public\.map_pin_snap_refresh_ar\(/i);
check('a committed migration defines map_pins_ar and map_pin_snap_refresh_ar', !!pins && !!refresh);
if (!pins || !refresh) process.exit(1);

// ── map_pins_ar: the street-zoom (exact) branch ──────────────────────────────────────────────────────────────────────
const pinsFn = fnBody(pins.body);
// The exact branch is the `else` of `if p_cell > 0 then` (the live-grid read above it is unchanged).
const exactBranch = (() => { const g = pinsFn.indexOf('if p_cell > 0 then', pinsFn.indexOf('v_geom :=')); const e = g < 0 ? -1 : pinsFn.indexOf('\n  else\n', g); return e < 0 ? '' : pinsFn.slice(e); })();
const snapsDrawn = (sql: string) => (sql.match(/coalesce\(snap\.lat, s\.latitude::double precision\) la, coalesce\(snap\.lng, s\.longitude::double precision\) lo/g) ?? []).length;
const exactReads = (sql: string) => (sql.match(/from public\.search_listings_ar s\b/g) ?? []).length;
const staleGuard = (sql: string) => (sql.match(/abs\(snap\.lat - s\.latitude::double precision\) < 0\.01 and abs\(snap\.lng - s\.longitude::double precision\) < 0\.01/g) ?? []).length;
const boxOnOwn = (sql: string) => (sql.match(/s\.latitude between p_s::numeric and p_n::numeric and s\.longitude between p_w::numeric and p_e::numeric/g) ?? []).length;
const keepsEveryId = (sql: string) => /array_agg\(jsonb_build_object\('t', k\.source_table, 'i', k\.listing_id\)/.test(sql) && /group by k\.la, k\.lo/.test(sql);

const rule1 = (sql: string) => exactReads(sql) > 0 && snapsDrawn(sql) === exactReads(sql);
const rule2 = (sql: string) => staleGuard(sql) === exactReads(sql);
const rule3 = (sql: string) => boxOnOwn(sql) === exactReads(sql);
check(`every street-zoom read draws at the snapped spot (${snapsDrawn(exactBranch)}/${exactReads(exactBranch)}) — ${pins.f}`, rule1(exactBranch));
check('every snap is ignored once the listing has moved ~1 km (a stale snap never misplaces a pin)', rule2(exactBranch));
check('the box filter stays on the listing\'s own numeric coordinates (index-served)', rule3(exactBranch));
check('one pin keeps every ad\'s id (each shows as its own card) and pins group by the drawn spot', keepsEveryId(exactBranch));
const oneDropped = exactBranch.replace('coalesce(snap.lat, s.latitude::double precision) la, coalesce(snap.lng, s.longitude::double precision) lo', 's.latitude::double precision la, s.longitude::double precision lo');
mustCatch('one of the three street-zoom paths still drawing at the raw spot (the crowded probe and the pins would disagree)', !rule1(oneDropped));
mustCatch('the stale-snap distance check removed', !rule2(exactBranch.replace(/\n\s*and abs\(snap\.lat - s\.latitude::double precision\) < 0\.01 and abs\(snap\.lng - s\.longitude::double precision\) < 0\.01/, '')));
mustCatch('the box filter moved onto the snapped spot (casts the column, loses the index)', !rule3(exactBranch.replace('s.latitude between p_s::numeric and p_n::numeric', 'snap.lat between p_s and p_n')));
mustCatch('a pin that folds its ads into one card (ids dropped)', !keepsEveryId(exactBranch.replace("jsonb_build_object('t', k.source_table, 'i', k.listing_id)", 'null')));

// ── map_pin_snap_refresh_ar: who counts as a twin ───────────────────────────────────────────────────────────────────
const refreshFn = fnBody(refresh.body);
const sameSiteOnly = (sql: string) => /partition by s\.source_table, s\.deal_ar, s\.price, s\.area_m2, s\.type_ar, s\.bedrooms\)/.test(sql)
  && /group by 1, 2, 3, 4, 5, 6 having count\(distinct \(la, lo\)\) > 1/.test(sql) && /select source_table, deal_ar, price, area_m2, type_ar, bedrooms\s/.test(sql);
const nearOnly = (sql: string) => { const m = /ST_ClusterDBSCAN\([^,]+\([^)]*\), ([0-9.]+), 2\)/.exec(sql); return !!m && Number(m[1]) > 0 && Number(m[1]) <= 0.001; };
const noPlaceholders = (sql: string) => /not exists \(select 1 from public\.ops_default_pin_register r/.test(sql);
check('twins are grouped only inside ONE site with the same deal, price, area, type and bedrooms', sameSiteOnly(refreshFn));
check('twins must be within ~100 m of each other (DBSCAN eps ≤ 0.001°)', nearOnly(refreshFn));
check('placeholder/default pins never take part', noPlaceholders(refreshFn));
mustCatch('two different sites merged into one pin (source_table dropped from the partition)', !sameSiteOnly(refreshFn.replace('partition by s.source_table, s.deal_ar', 'partition by s.deal_ar')));
mustCatch('a different price merged (price dropped from the partition)', !sameSiteOnly(refreshFn.replace('s.deal_ar, s.price, s.area_m2', 's.deal_ar, s.area_m2')));
mustCatch('a 1 km radius (whole neighbourhoods would collapse into one pin)', !nearOnly(refreshFn.replace(/(ST_ClusterDBSCAN\([^,]+\([^)]*\), )[0-9.]+/, '$10.009')));
mustCatch('placeholder pins allowed to anchor a group', !noPlaceholders(refreshFn.replace('not exists (select 1 from public.ops_default_pin_register r', 'true or exists (select 1 from public.ops_default_pin_register r')));

// ── scheduled ────────────────────────────────────────────────────────────────────────────────────────────────────────
const scheduled = files.some((f) => /cron\.schedule\('map_pin_snap_refresh_ar',\s*'\d+ \* \* \* \*'/.test(readFileSync(join(dir, f), 'utf8')));
check('the snap refresh is scheduled hourly', scheduled);

if (failed) { console.error(`\n❌ verify-map-twins-share-one-pin: ${failed} check(s) failed`); process.exit(1); }
console.log('\nverify-map-twins-share-one-pin: same-site twins share one pin, every ad keeps its card');
