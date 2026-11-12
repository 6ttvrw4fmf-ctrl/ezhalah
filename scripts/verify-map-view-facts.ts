// The map pill's second line can't be wrong — THE SERVER HALF (owner 2026-11-12: «we need proper guards … it can't be
// wrong»). Checks the committed SQL keeps its promises: the facts count exactly the ads the pill counts (the «نشر خلال»
// counter's filter word for word, the Filter's sale price), «new» is the site's own date, «gone» is a confirmed removal
// only and only on a full 30-day log, «last month» is the map as it stood 28–34 days ago, a guest never receives a
// number, and the nightly checker recounts another way and can switch the line off. The screen half (what the line may
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
const goneGated = (src: string) => /'gone30', case when v_plain and v_ready then \(select count\(\*\) from gd where gd\.own and gd\.left_at >= now\(\) - interval '30 days'\)/.test(src)
  && /'prev_gone30', case when v_plain and v_prev_ready/.test(src)
  && /v_prev_ready := v_base is not null\s+and exists \(select 1 from public\.map_fact_capture_run cr where cr\.ok and cr\.prev_taken_at is null and cr\.run_at::date <= v_base - 30\)/.test(src);
check('«gone» only on a full, fresh log and an unfiltered view', goneGated(core));
mustCatch('«gone» shown before the log is ready', () => goneGated(core.replace("'gone30', case when v_plain and v_ready then", "'gone30', case when true then")));
mustCatch('last month\'s «gone» compared before the log covers that month', () => goneGated(core.replace('cr.run_at::date <= v_base - 30', 'cr.run_at::date <= v_base')));
const baseline = (src: string) => /where w\.taken_on between current_date - 34 and current_date - 28;/.test(src) && /'prev_median', case when v_plain and v_base is not null and p_deals = array\['buy'\]::text\[\]/.test(src);
check('«last month» is the map as it stood 28–34 days ago, unfiltered views only', baseline(core));
mustCatch('a «last month» taken from last week', () => baseline(core.replace('current_date - 34 and current_date - 28', 'current_date - 10 and current_date - 4')));
check('the checker recounts last month\'s new ads and median another way', /if \(c ->> 'prev_new30_raw'\)::bigint is distinct from pn then/.test(audit) && /with pbox as materialized/.test(audit));
const readyRule = (src: string) => /prev_taken_at is null and run_at <= now\(\) - interval '30 days'/.test(src) && /run_at >= now\(\) - interval '36 hours'/.test(src);
check('the log is «ready» only 30 days after its first night and while fresh', readyRule(ready));
mustCatch('a log called ready after a week', () => readyRule(ready.replace("interval '30 days'", "interval '7 days'")));
const confirmedOnly = (src: string) => /r\.active = false and r\.deactivated_at is not null/.test(src) && /lr\.strategy in \('DIRECT_REVISIT', 'CANDIDATE_PLUS_DIRECT'\)/.test(src) && /not exists \(select 1 from public\.ops_adjudicated_listing j/.test(src) && /delete from public\.map_fact_removal m using public\.%I r where m\.source_table = %L and r\.id = m\.listing_id and r\.active/.test(src);
check('«gone» = page re-opened and removed: inactive, direct-check site, not an owner withdrawal, dropped if it comes back', confirmedOnly(capture));
mustCatch('a removal log that trusts crawl absence (any strategy)', () => confirmedOnly(capture.replace("lr.strategy in ('DIRECT_REVISIT', 'CANDIDATE_PLUS_DIRECT')", "lr.strategy is not null")));
const guestBranch = (src: string) => { const m = src.match(/if auth\.uid\(\) is null then([\s\S]*?)end if;/); return m ? m[1] : ''; };
const guestNoNumbers = (src: string) => { const g = guestBranch(src); return g !== '' && /'locked', true/.test(g) && !/'(new30|gone30|median)',/.test(g) && !/return v;/.test(g); };
check('a guest gets {locked, any, has_*} — never new30, gone30 or the median', guestNoNumbers(rpc));
mustCatch('a guest branch that leaks the numbers', () => guestNoNumbers(rpc.replace("'has_median', (v ->> 'median') is not null", "'median', v -> 'median'")));
const switchable = (src: string) => /if not coalesce\(\(select ff\.enabled from public\.ops_feature_flags ff where ff\.name = 'map_view_facts'\), false\) then\s*return null;/.test(src);
check('the line has an off switch the checker uses', switchable(rpc) && /update public\.ops_feature_flags set enabled = false/.test(audit));
mustCatch('an RPC that ignores the off switch', () => switchable(rpc.replace("ff.name = 'map_view_facts'", "ff.name = 'something_else'")));
check('the checker compares with the «نشر خلال» counter and recounts the median separately', /map_posted_window_counts_ar\(/.test(audit) && /with box as materialized/.test(audit) && /'any'\) is distinct from \(w ->> 'any'\)/.test(audit));


console.log(failed ? `\n${failed} check(s) FAILED` : '\nverify-map-view-facts: all checks passed');
process.exit(failed ? 1 : 0);
