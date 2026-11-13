// The map pill's second line can't be wrong — THE SERVER HALF (owner 2026-11-12: «we need proper guards … it can't be
// wrong»). Checks the committed SQL keeps its promises: the facts count exactly the ads the pill counts (the «نشر خلال»
// counter's filter word for word, the Filter's sale price), «new» is the site's own date, «gone» is a confirmed removal
// only and only on a full 30-day log, «last month» is the map as it stood 28–34 days ago, a guest never receives a
// number, and the nightly checker recounts another way and can switch the facts off. The screen half (what the line may
// SAY) is scripts/verify-map-view-facts-line.ts.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
let failed = 0;
const check = (name: string, ok: boolean, info = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? ' — ' + info : ''}`); if (!ok) failed++; };
const mustCatch = (name: string, mutantPasses: () => boolean) => check(`(mutation) catches ${name}`, !mutantPasses());

// 3. the server keeps its promises (latest committed definition of each function)
const migDir = join(root, 'supabase/migrations');
const files = readdirSync(migDir).filter((f) => f.endsWith('.sql')).sort();
// The newest committed definition of a function, read up to ITS OWN closing dollar tag ('' when there is none — never
// the rest of the file: scripts/verify-function-body-windows-fail-closed.ts).
const latestDef = (fn: string): string => {
  for (let i = files.length - 1; i >= 0; i--) {
    const src = readFileSync(join(migDir, files[i]), 'utf8');
    const at = src.search(new RegExp(`create or replace function public\\.${fn}\\(`));
    if (at < 0) continue;
    const open = /\bas\s+(\$[A-Za-z_]*\$)/.exec(src.slice(at));
    if (!open) return '';
    const bodyAt = at + open.index + open[0].length;
    const end = src.indexOf(open[1], bodyAt);
    return end < 0 ? '' : src.slice(at, end);
  }
  return '';
};
const core = latestDef('map_view_facts_core');
// 20261112184000 rewrote this counter's sale price IN PLACE (replace() on its live text, no new definition), so the
// committed definition is the pre-fix text plus that one substitution — applied here so the comparison is with what runs.
const PRICE_BARE = "then s.price_total else s.price_annual end as price";
const PRICE_FILTER = "then coalesce(s.price_total_effective, s.price_total) else s.price_annual end as price";
const windows = files.includes('20261112184000_map_pin_reads_the_filters_price_and_one_spot_is_one_pin.sql')
  ? latestDef('map_posted_window_counts_ar').split(PRICE_BARE).join(PRICE_FILTER) : latestDef('map_posted_window_counts_ar');
const rpc = latestDef('map_view_facts_ar');
const capture = latestDef('map_fact_capture_removals');
const ready = latestDef('map_view_facts_gone_ready');
const audit = latestDef('audit_map_view_facts');
const filterBlock = (src: string) => { const a = src.indexOf('from public.map_listing_points_ar s'); const b = src.indexOf('), f as (', a); const c = src.indexOf('\n  )', b); return a > 0 && b > a && c > b ? src.slice(a, c).replace(/^\s*select k\.\* from kept k|^\s*select k\.posted_at from kept k/m, '').replace(/\s+/g, ' ').replace(/select k\.(\*|posted_at) from kept k/, 'select K from kept k') : ''; };
const same = (a: string, b: string) => filterBlock(a) !== '' && filterBlock(a) === filterBlock(b);
check('the facts filter is the «نشر خلال» counter\'s filter, word for word (so `any` is the pill\'s count)', same(core, windows));
check('the facts price a sale by the Filter\'s column, like every map read', core.includes(PRICE_FILTER) && !core.includes(PRICE_BARE));
mustCatch('facts left on the bare sale price', () => { const c2 = core.split(PRICE_FILTER).join(PRICE_BARE); return c2.includes(PRICE_FILTER) && !c2.includes(PRICE_BARE); });
mustCatch('a facts filter that drifted from the counter', () => same(core.replace("s.area_m2 >= p_area_min", "s.area_m2 > p_area_min"), windows));
const newsBySiteDate = (src: string) => /'new30', \(select count\(\*\) from fd where fd\.own and fd\.posted_at >= now\(\) - make_interval\(days => 30\)/.test(src) && !/first_seen_at|scraped_at|last_seen_at/.test(src);
check('«new» counts the SITE\'s posting date, never first-seen', newsBySiteDate(core));
mustCatch('«new» by first-seen', () => newsBySiteDate(core.replace("fd.posted_at >= now() - make_interval(days => 30)", "fd.first_seen_at >= now() - make_interval(days => 30)")));
const area = latestDef('map_view_facts_area');
const neighbors = latestDef('map_fact_build_neighbors');
const AREA_LINE = 'and s.city_ar = p_city and (p_districts is null or s.district_ar = any (p_districts))';
const areaAsCore = (src: string) => src.split(AREA_LINE).join('');
check('the neighbours\' facts use the pill\'s filter word for word, plus only the line naming the districts', area.includes(AREA_LINE) && same(areaAsCore(area), core));
mustCatch('a neighbours\' filter that dropped one of the map\'s filters', () => same(areaAsCore(area.replace('and (p_beds is null or s.bedrooms = any (p_beds)) ', '')), core));
const goneFiltered = (src: string) => /'gone30', case when v_ready then \(select count\(\*\) from gd where gd\.own\) end/.test(src)
  && /where v_ready and r\.left_at >= now\(\) - interval '30 days'/.test(src)
  && src.includes('(p_beds is null or r.bedrooms = any (p_beds)) and (p_furnished is null or r.furnished = p_furnished)')
  && src.includes('(p_price_min is null or r.price >= p_price_min) and (p_price_max is null or r.price <= p_price_max)')
  && src.includes('(p_area_min is null or r.area_m2 >= p_area_min) and (p_area_max is null or r.area_m2 <= p_area_max)');
check('«gone» follows every map filter, and only on a full, fresh log', goneFiltered(core));
const goneSkipsDefaultPins = (src: string) => /from public\.map_fact_removal r\s+where v_ready[\s\S]*?and not exists \(select 1 from public\.ops_default_pin_register d\s+where d\.source_table = r\.source_table/.test(src);
check('«gone» skips ads on a site\'s default pin, exactly as the pill\'s count does', goneSkipsDefaultPins(core));
mustCatch('«gone» counting ads the pill never showed (default pins)', () => goneSkipsDefaultPins(core.replace(/(from public\.map_fact_removal r\s+where v_ready[^\n]*\n[^\n]*\n)\s*and not exists \(select 1 from public\.ops_default_pin_register d[^\n]*\n[^\n]*\n/, '$1')));
mustCatch('«gone» shown before the log is ready', () => goneFiltered(core.replace("'gone30', case when v_ready then", "'gone30', case when true then")));
mustCatch('«gone» ignoring the rooms filter', () => goneFiltered(core.replace('(p_beds is null or r.bedrooms = any (p_beds)) and ', '')));
const keepsRooms = (src: string) => /posted_at, deactivated_at, left_at,\s*bedrooms, furnished\)/.test(src) && /posted_at, taken_at, bedrooms, furnished\)/.test(src);
check('the removal log and the snapshot keep rooms and furnished (so «gone» can be filtered)', keepsRooms(capture));
const priceRule = (src: string) => /'ppm', case when p_deals = array\['buy'\]::text\[\] and \(p_types is not null or p_types2 is not null\)\s*and \(select place\.one_type from place\) and \(select count\(\*\) from ppmc\) >= 10/.test(src);
check('price per metre: sale only, one picked type, never mixed, at least 10 ads', priceRule(core) && /'ppm', case when \(select count\(\*\) from ppmc\) >= 10/.test(area));
mustCatch('a price from 3 ads', () => priceRule(core.replace('(select count(*) from ppmc) >= 10', '(select count(*) from ppmc) >= 3')));
mustCatch('a price that mixes property types', () => priceRule(core.replace("and (select place.one_type from place) and (select count(*) from ppmc)", "and (select count(*) from ppmc)")));
const nearRule = (src: string) => /having count\(\*\) >= 30/.test(src) && /join d b on b\.city_ar = a\.city_ar and b\.district_ar <> a\.district_ar/.test(src) && /where nb\.rk <= 4/.test(src);
check('«أحياء قريبة» = the 4 nearest districts of the SAME city, each with at least 30 ads', nearRule(neighbors));
mustCatch('neighbours from another city', () => nearRule(neighbors.replace('on b.city_ar = a.city_ar and', 'on')));
mustCatch('ten «nearest» districts', () => nearRule(neighbors.replace('where nb.rk <= 4', 'where nb.rk <= 10')));
const fallback = (src: string) => /v_kind := 'near';/.test(src) && /v_kind := 'city';/.test(src) && /case when v_kind = 'near' then to_jsonb\(v_nb\.neighbors\) else to_jsonb\(array\[v_city\]\) end/.test(src);
check('with no usable neighbours the comparison falls back to the city, and names the city', fallback(core));
const freshNeighbours = (src: string) => /v_fresh_nb := exists \(select 1 from public\.map_district_neighbors nbt where nbt\.built_at >= now\(\) - interval '36 hours'\)/.test(src)
  && /if \(v ->> 'ppm'\) is not null and v_city is not null and v_fresh_nb then/.test(src);
check('a neighbours table older than 36 h hides the comparison (never yesterday\'s districts)', freshNeighbours(core));
mustCatch('a comparison read from a stale neighbours table', () => freshNeighbours(core.replace('and v_city is not null and v_fresh_nb then', 'and v_city is not null then')));
const detector = latestDef('mon_detect_map_view_facts');
const watchesNeighbours = (src: string) => /select max\(built_at\) into nb_at from public\.map_district_neighbors;/.test(src) && /nb_at is null or nb_at < now\(\) - interval '36 hours'/.test(src) && /'map_view_facts:neighbors_stale'/.test(src);
check('the alarm pages when the neighbours table is empty or older than 36 h', watchesNeighbours(detector));
mustCatch('an alarm blind to an empty neighbours table', () => watchesNeighbours(detector.replace('nb_at is null or ', '')));
check('the facts carry the time of the last nightly run (for «آخر تحديث»)', /'updated_at', \(select max\(cr\.run_at\) from public\.map_fact_capture_run cr where cr\.ok\)/.test(core));
const sane = (src: string) => /and \(select percentile_cont\(0\.5\) within group \(order by ppmc\.ppm\) from ppmc\) between 10 and 200000/.test(src)
  && /and \(v_area ->> 'ppm'\)::numeric between 10 and 200000/.test(src)
  && /and abs\(\(v ->> 'ppm'\)::numeric - \(v_area ->> 'ppm'\)::numeric\) <= 2 \* \(v_area ->> 'ppm'\)::numeric then/.test(src);
check('nothing impossible is served: price per metre 10–200,000 SAR, a comparison gap of at most 200%', sane(core));
mustCatch('a price per metre of 3 million served', () => sane(core.replace('from ppmc) between 10 and 200000', 'from ppmc) between 10 and 9999999999')));
mustCatch('a 500% «cheaper than nearby» served', () => sane(core.replace('<= 2 * (v_area ->> \'ppm\')::numeric then', '<= 99 * (v_area ->> \'ppm\')::numeric then')));
const auditSane = (src: string) => /order by random\(\) limit 40/.test(src) && /'ppm_out_of_bounds'/.test(src) && /'new30_over_any'/.test(src) && /'ppm_n_over_any'/.test(src);
check('the nightly checker samples 40 views and fails on any impossible number', auditSane(audit));
mustCatch('a checker back to 5 samples', () => auditSane(audit.replace('limit 40', 'limit 5')));
const cutsRule = (src: string) => src.includes('h.price_total < h.old_price_total and h.price_total >= h.old_price_total * 0.5') && /ss\.source = 'price_diary' and ss\.started_at <= now\(\) - interval '30 days'/.test(src);
check('«خفضوا السعر»: a real drop (not a page re-read), shown once the diary covers 30 days', cutsRule(core));
mustCatch('a 90% «cut» counted (a page re-read)', () => cutsRule(core.replace(' and h.price_total >= h.old_price_total * 0.5', '')));
const readyRule = (src: string) => /prev_taken_at is null and run_at <= now\(\) - interval '30 days'/.test(src) && /run_at >= now\(\) - interval '36 hours'/.test(src);
check('the log is «ready» only 30 days after its first night and while fresh', readyRule(ready));
mustCatch('a log called ready after a week', () => readyRule(ready.replace("interval '30 days'", "interval '7 days'")));
const confirmedOnly = (src: string) => /r\.active = false and r\.deactivated_at is not null/.test(src) && /lr\.strategy in \('DIRECT_REVISIT', 'CANDIDATE_PLUS_DIRECT'\)/.test(src) && /not exists \(select 1 from public\.ops_adjudicated_listing j/.test(src) && /delete from public\.map_fact_removal m using public\.%I r where m\.source_table = %L and r\.id = m\.listing_id and r\.active/.test(src);
check('«gone» = page re-opened and removed: inactive, direct-check site, not an owner withdrawal, dropped if it comes back', confirmedOnly(capture));
mustCatch('a removal log that trusts crawl absence (any strategy)', () => confirmedOnly(capture.replace("lr.strategy in ('DIRECT_REVISIT', 'CANDIDATE_PLUS_DIRECT')", "lr.strategy is not null")));
const guestBranch = (src: string) => { const m = src.match(/if auth\.uid\(\) is null then([\s\S]*?)end if;/); return m ? m[1] : ''; };
const guestNoNumbers = (src: string) => { const g = guestBranch(src); return g !== '' && /'locked', true/.test(g) && !/'(new30|gone30|median|ppm|nb_ppm|cuts30)',/.test(g) && !/return v;/.test(g); };
check('a guest gets {locked, any, has_*} — never a number', guestNoNumbers(rpc));
mustCatch('a guest branch that leaks the price per metre', () => guestNoNumbers(rpc.replace("'has_ppm', (v ->> 'ppm') is not null", "'ppm', v -> 'ppm'")));
const switchable = (src: string) => /if not coalesce\(\(select ff\.enabled from public\.ops_feature_flags ff where ff\.name = 'map_view_facts'\), false\) then\s*return null;/.test(src);
check('the facts have an off switch the checker uses', switchable(rpc) && /update public\.ops_feature_flags set enabled = false/.test(audit));
mustCatch('an RPC that ignores the off switch', () => switchable(rpc.replace("ff.name = 'map_view_facts'", "ff.name = 'something_else'")));
check('the checker compares with the «نشر خلال» counter and recounts the median, price per metre and the neighbours\' another way',
  /map_posted_window_counts_ar\(/.test(audit) && /with box as materialized/.test(audit) && /with nbox as materialized/.test(audit) && /'any'\) is distinct from \(w ->> 'any'\)/.test(audit) && /why := why \|\| 'nb_ppm'/.test(audit));


// the prepared city/district facts (area-label zoom): same rules, built hourly, served only fresh and checked
const place = latestDef('map_fact_build_place_facts');
const placeRpc = latestDef('map_place_facts_ar');
const placeRules = (src: string) => /from public\.map_listing_points_ar s/.test(src)
  && /not exists \(select 1 from public\.ops_default_pin_register d/.test(src)
  && /min\(y\.platform\) over \(partition by y\.deal, y\.type_ar, y\.price, y\.area_m2, y\.city_ar, y\.district_ar\)\) as own/.test(src)
  && /b\.own and b\.posted_at >= now\(\) - interval '30 days'/.test(src)
  && /from types t where t\.n >= 10/.test(src)
  && /t\.ppm between 10 and 200000/.test(src)
  && /and x\.n >= 10 and x\.ppm between 10 and 200000 and abs\(p\.top_ppm - x\.ppm\) <= 2 \* x\.ppm/.test(src)
  && /for chk in select \* from public\.map_place_facts where level = 'district'/.test(src);
check('prepared place facts: same sources and rules as live (default pins out, copies once, site date, ≥ 10 ads, sane bounds, self-check)', placeRules(place));
mustCatch('a prepared price from 3 ads', () => placeRules(place.replace('from types t where t.n >= 10', 'from types t where t.n >= 3')));
mustCatch('prepared facts without their self-check', () => placeRules(place.replace("for chk in select * from public.map_place_facts where level = 'district'", 'for chk in select 1')));
const placeServed = (src: string) => /b\.built_at < now\(\) - interval '3 hours' or b\.failed > 0 then return null;/.test(src)
  && /cardinality\(p_deals\) <> 1 then return null;/.test(src);
check('prepared facts are served only fresh (≤ 3 h), after a clean self-check, for exactly one deal', placeServed(placeRpc));
mustCatch('stale prepared facts served', () => placeServed(placeRpc.replace("interval '3 hours'", "interval '300 hours'")));
mustCatch('prepared facts served after a failed check', () => placeServed(placeRpc.replace(' or b.failed > 0 then return null;', ' then return null;')));
const placeGuest = (src: string) => { const g = guestBranch(src); const keys = guestKeys(g); return g !== '' && keys.includes('locked') && keys.every((k) => GUEST_KEYS.has(k) || k === 'place') && !/return jsonb_build_object\('any', r\.n_ads, 'place', true, 'new30'/.test(g); };
check('a guest gets only yes/no flags from the prepared facts too', placeGuest(placeRpc));
mustCatch('a prepared guest branch that leaks the price', () => placeGuest(placeRpc.replace("'has_ppm', r.top_ppm is not null", "'top_ppm', r.top_ppm")));

console.log(failed ? `\n${failed} check(s) FAILED` : '\nverify-map-view-facts: all checks passed');
process.exit(failed ? 1 : 0);
