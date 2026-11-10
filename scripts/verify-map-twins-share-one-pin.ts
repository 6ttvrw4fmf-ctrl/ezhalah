// SAME HOUSE, POSTED TWICE ON ONE SITE → ONE PIN, SEPARATE CARDS (owner 2026-11-04: «they become like 2 … but same pin
// … do it for everything they basically merge but show separately of course»).
//
// The merge lives in SQL (map_pin_snap + map_pin_snap_refresh_ar + map_pins_ar's exact branch), so this check reads the
// LATEST committed definition of each piece and holds the rules that make it safe:
//   1. every exact-point read in map_pins_ar draws at the snapped spot (all three street-zoom paths, not one of them);
//   2. a snap is ignored when the listing has since moved (~1 km), so a stale snap never misplaces a pin;
//   3. the box filter stays on the listing's OWN coordinates (the index keeps serving it — the 2026-11-03 slow-zoom fix);
//   4. twins are only ever grouped INSIDE one site and one deal/price/area/type/bedrooms (two sites are two ads —
//      unless they carry the same government licence: the final pin rule's second pass, owner 2026-11-10, held in
//      verify-map-same-property-is-one-card.ts);
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
const sameSiteOnly = (sql: string) => /partition by s\.source_table, s\.deal_ar, s\.price, s\.area_m2, s\.type_ar, s\.bedrooms, s\.ppm\)/.test(sql)
  && /group by 1, 2, 3, 4, 5, 6, 7 having count\(distinct \(la, lo\)\) > 1/.test(sql) && /select source_table, deal_ar, price, area_m2, type_ar, bedrooms, ppm\s/.test(sql);
const nearOnly = (sql: string) => { const m = /ST_ClusterDBSCAN\([^,]+\([^)]*\), ([0-9.]+), 2\)/.exec(sql); return !!m && Number(m[1]) > 0 && Number(m[1]) <= 0.001; };
// EVERY read of the listings (the same-site pass and the licence pass) leaves the placeholder pins out — counted, so a
// second pass cannot slip in without the exclusion.
const count = (sql: string, re: RegExp) => (sql.match(re) ?? []).length;
const noPlaceholders = (sql: string) => count(sql, /from public\.search_listings_ar x\b/g) > 0
  && count(sql, /not exists \(select 1 from public\.ops_default_pin_register r/g) === count(sql, /from public\.search_listings_ar x\b/g);
check('twins are grouped only inside ONE site with the same deal, price, area, type and bedrooms', sameSiteOnly(refreshFn));
check('twins must be within ~100 m of each other (DBSCAN eps ≤ 0.001°)', nearOnly(refreshFn));
check('placeholder/default pins never take part', noPlaceholders(refreshFn));
mustCatch('two different sites merged into one pin (source_table dropped from the partition)', !sameSiteOnly(refreshFn.replace('partition by s.source_table, s.deal_ar', 'partition by s.deal_ar')));
mustCatch('a different price merged (price dropped from the partition)', !sameSiteOnly(refreshFn.replace('s.deal_ar, s.price, s.area_m2', 's.deal_ar, s.area_m2')));
mustCatch('a 1 km radius (whole neighbourhoods would collapse into one pin)', !nearOnly(refreshFn.replace(/(ST_ClusterDBSCAN\([^,]+\([^)]*\), )[0-9.]+/, '$10.009')));
mustCatch('placeholder pins allowed to anchor a group', !noPlaceholders(refreshFn.replace('not exists (select 1 from public.ops_default_pin_register r', 'true or exists (select 1 from public.ops_default_pin_register r')));

// Haraj prices land per metre only: 13 neighbouring 504 m² plots (6,944 / 6,250 / 5,952 SAR/m²) shared one pin (2026-11-05).
const perMetreDecides = (sql: string) => /case when coalesce\(x\.price_total, x\.price_annual\) is null then coalesce\(x\.price_per_meter, -1\) else -1 end ppm/.test(sql) && sameSiteOnly(sql);
check('an ad with no total price is matched on its price per metre too (neighbouring plots stay apart)', perMetreDecides(refreshFn));
mustCatch('per-metre price dropped from the twin key (13 different haraj plots on one pin)', !perMetreDecides(refreshFn.replace('s.bedrooms, s.ppm) cid', 's.bedrooms) cid')));

// ── refreshed every hour, inside the grid refresh (no free cron minute of its own — 20261105063813) ─────────────────
const grid = latestDefining(/create or replace function public\.map_grid_refresh_ar\(/i);
const gridFn = grid ? fnBody(grid.body) : '';
const runsWithGrid = (sql: string) => /perform public\.map_pin_snap_refresh_ar\(\);/.test(sql);
const failureKeepsGrid = (sql: string) => /begin\s+perform public\.map_pin_snap_refresh_ar\(\);\s+exception when others then/.test(sql);
const gridScheduled = files.some((f) => /cron\.schedule\('map_grid_refresh_ar',\s*'\d+ \* \* \* \*'/.test(readFileSync(join(dir, f), 'utf8')));
check(`the hourly grid refresh runs the snap refresh (${grid?.f ?? 'none'})`, gridScheduled && runsWithGrid(gridFn));
check('a failed snap refresh never costs the map its grid refresh (own exception block)', failureKeepsGrid(gridFn));
mustCatch('the snap call dropped from the grid refresh (twins stop merging for new ads)', !runsWithGrid(gridFn.replace('perform public.map_pin_snap_refresh_ar();', '')));
mustCatch('the snap call outside an exception block', !failureKeepsGrid(gridFn.replace(/begin\s+perform public\.map_pin_snap_refresh_ar\(\);\s+exception when others then/, 'perform public.map_pin_snap_refresh_ar(); begin null; exception when others then')));

// ── «price on request» copies are twins too: a blank matches a blank, never a number ───────────────────────────────
const blanksMatch = (sql: string) => /coalesce\(x\.price_total, x\.price_annual, -1\) price, coalesce\(x\.area_m2, -1\) area_m2/.test(sql)
  && /from s join multi m using \(source_table, deal_ar, price, area_m2, type_ar, bedrooms, ppm\)/.test(sql) && !/x\.area_m2 is not null/.test(sql);
check('ads with no price or no size still pair with their twin (a blank is a sentinel key, matched by a hashable join)', blanksMatch(refreshFn));
mustCatch('a «price on request» pair left as two pins (the blank stays NULL, and NULL = NULL is never true)', !blanksMatch(refreshFn.replace('coalesce(x.price_total, x.price_annual, -1) price', 'coalesce(x.price_total, x.price_annual) price')));
// 20261105063813 compared the keys with IS NOT DISTINCT FROM: correct, but unhashable — minutes per refresh.
const hashable = (sql: string) => !/m\.(price|area_m2|type_ar|bedrooms|deal_ar) is not distinct from s\./.test(sql);
check('the twin join stays hashable (the minutes-long IS NOT DISTINCT FROM join is gone)', hashable(refreshFn));
mustCatch('the unhashable IS NOT DISTINCT FROM join brought back', !hashable(refreshFn.replace('from s join multi m using (source_table, deal_ar, price, area_m2, type_ar, bedrooms, ppm)', 'from s join multi m on m.source_table = s.source_table and m.price is not distinct from s.price')));

if (failed) { console.error(`\n❌ verify-map-twins-share-one-pin: ${failed} check(s) failed`); process.exit(1); }
console.log('\nverify-map-twins-share-one-pin: same-site twins share one pin, every ad keeps its card');
