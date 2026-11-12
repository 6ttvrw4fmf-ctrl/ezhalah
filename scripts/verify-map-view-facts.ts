// The map pill's second line can't be wrong (owner 2026-11-12: «we need proper guards … it can't be wrong»).
// Executes the rules that decide what the line may SAY (src/lib/mapViewFacts.ts), then checks the committed SQL keeps
// the server-side promises: the facts count exactly the ads the pill counts, «new» is the site's own date, «gone» is a
// confirmed removal only and only on a full 30-day log, and a guest never receives a number.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { factLine, lockedLine, newAdsAr, goneAr, parseViewFacts, FACTS_MIN_ADS, type ViewFacts } from '../src/lib/mapViewFacts.ts';

const root = join(import.meta.dirname, '..');
let failed = 0;
const check = (name: string, ok: boolean, info = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? ' — ' + info : ''}`); if (!ok) failed++; };
const mustCatch = (name: string, mutantPasses: () => boolean) => check(`(mutation) catches ${name}`, !mutantPasses());
const MARKS = /[ً-ْ]/;

const full: ViewFacts = { any: 1081, locked: false, new30: 123, gone30: 85, median: 1_350_000 };
const text = (f: ViewFacts | null, shown: number | null, loc: 'ar' | 'en' = 'ar') => { const l = factLine(f, shown, loc); return l.kind === 'facts' ? l.text : l.kind; };

// 1. what the line says
check('the full line reads as agreed', text(full, 1081) === 'آخر 30 يوما: 🆕 123 إعلان جديد · ⚡ 85 اختفى · 💰 متوسط السعر 1.4 مليون', text(full, 1081));
check('a failed read (null) says nothing — never «0»', text(null, 1081) === 'none');
check('facts for OTHER ads than the pill counts say nothing (any ≠ shown)', text(full, 1080) === 'none' && text(full, null) === 'none');
check(`a view under ${FACTS_MIN_ADS} ads says nothing`, text({ ...full, any: FACTS_MIN_ADS - 1 }, FACTS_MIN_ADS - 1) === 'none');
check('no ⚡ before the 30-day removal log exists (gone null)', !String(text({ ...full, gone30: null }, 1081)).includes('⚡'));
check('no 💰 without a single picked type (median null)', !String(text({ ...full, median: null }, 1081)).includes('💰'));
check('a zero part is left out, and all-zero says nothing', !String(text({ ...full, new30: 0 }, 1081)).includes('🆕') && text({ ...full, new30: 0, gone30: 0, median: null }, 1081) === 'none');
check('«إعلان جديد», never «جديد» alone (the Filter\'s «جديد» means newly built)', /إعلان(ات)? جديد(ة)?|إعلانان جديدان/.test(String(text(full, 1081))));
check('Arabic words follow the count: 1, 2, 3, 11, 103', newAdsAr(1) === 'إعلان جديد واحد' && newAdsAr(2) === 'إعلانان جديدان' && newAdsAr(3) === '3 إعلانات جديدة' && newAdsAr(11) === '11 إعلان جديد' && newAdsAr(103) === '103 إعلانات جديدة' && goneAr(5) === '5 اختفت' && goneAr(85) === '85 اختفى');
check('no Arabic diacritics anywhere in the line', [text(full, 1081), lockedLine({ ...full, locked: true, has: { new: true, gone: true, median: true } }, 'ar').ask].every((x) => !MARKS.test(String(x))));
check('English reads too', text(full, 1081, 'en') === 'Last 30 days: 🆕 123 new listings · ⚡ 85 gone · 💰 avg price 1.4M', text(full, 1081, 'en'));

// 2. the guest
const guest = parseViewFacts({ data: { locked: true, any: 1081, has_new: true, has_gone: false, has_median: true, new30: 123, median: 1_350_000 }, error: null });
check('a guest\'s facts carry no numbers, even if the server sent some', !!guest && guest.locked && guest.new30 === null && guest.median === null && guest.gone30 === null);
check('a guest sees the locked line, blurred shapes only for parts that exist', factLine(guest, 1081, 'ar').kind === 'locked' && !!guest && lockedLine(guest, 'ar').blurred === '🆕 888 · 💰 8.8');
check('a guest view with nothing to show says nothing', factLine({ any: 1081, locked: true, new30: null, gone30: null, median: null, has: { new: false, gone: false, median: false } }, 1081, 'ar').kind === 'none');
check('parse: an error or no data is null', parseViewFacts({ data: null, error: null }) === null && parseViewFacts({ data: full, error: { message: 'x' } }) === null);
mustCatch('a line that ignores the pill\'s count', () => { const ignoresPill = (f: ViewFacts, _shown: number) => factLine(f, f.any, 'ar'); return ignoresPill(full, 1080).kind === 'none'; });

// 3. the server keeps its promises (latest committed definition of each function)
const migDir = join(root, 'supabase/migrations');
const files = readdirSync(migDir).filter((f) => f.endsWith('.sql')).sort();
const latestDef = (fn: string): string => {
  for (let i = files.length - 1; i >= 0; i--) {
    const src = readFileSync(join(migDir, files[i]), 'utf8');
    const at = src.search(new RegExp(`create or replace function public\\.${fn}\\(`));
    if (at >= 0) { const end = src.indexOf('$function$;', at); return src.slice(at, end > 0 ? end : undefined); }
  }
  return '';
};
const core = latestDef('map_view_facts_core');
const windows = latestDef('map_posted_window_counts_ar');
const rpc = latestDef('map_view_facts_ar');
const capture = latestDef('map_fact_capture_removals');
const ready = latestDef('map_view_facts_gone_ready');
const audit = latestDef('audit_map_view_facts');
const filterBlock = (src: string) => { const a = src.indexOf('from public.map_listing_points_ar s'); const b = src.indexOf('), f as (', a); const c = src.indexOf('\n  )', b); return a > 0 && b > a && c > b ? src.slice(a, c).replace(/^\s*select k\.\* from kept k|^\s*select k\.posted_at from kept k/m, '').replace(/\s+/g, ' ').replace(/select k\.(\*|posted_at) from kept k/, 'select K from kept k') : ''; };
const same = (a: string, b: string) => filterBlock(a) !== '' && filterBlock(a) === filterBlock(b);
check('the facts filter is the «نشر خلال» counter\'s filter, word for word (so `any` is the pill\'s count)', same(core, windows));
mustCatch('a facts filter that drifted from the counter', () => same(core.replace("s.area_m2 >= p_area_min", "s.area_m2 > p_area_min"), windows));
const newsBySiteDate = (src: string) => /'new30', \(select count\(\*\) from fd where fd\.own and fd\.posted_at >= now\(\) - make_interval\(days => 30\)/.test(src) && !/first_seen_at|scraped_at|last_seen_at/.test(src);
check('«new» counts the SITE\'s posting date, never first-seen', newsBySiteDate(core));
mustCatch('«new» by first-seen', () => newsBySiteDate(core.replace("fd.posted_at >= now() - make_interval(days => 30)", "fd.first_seen_at >= now() - make_interval(days => 30)")));
const goneGated = (src: string) => /'gone30', case when v_plain and v_ready then/.test(src) && /where v_plain and v_ready and r\.left_at >= now\(\) - interval '30 days'/.test(src);
check('«gone» only on a full, fresh log and an unfiltered view', goneGated(core));
mustCatch('«gone» shown before the log is ready', () => goneGated(core.replace("'gone30', case when v_plain and v_ready then", "'gone30', case when true then")));
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

// 4. the screen asks for the box the count was read over, and compares with the number it shows
const web = readFileSync(join(root, 'src/components/AppleMap.web.tsx'), 'utf8');
const wired = (src: string) => /setPinCount\(pillCount\(rows\)\); setFactsBox\(paddedBox\(center, span\)\);/.test(src)
  && (src.match(/setFactsBox\(paddedBox/g) ?? []).length === 1
  && /factLine\(viewFacts, hasShape \? null : placeCount \?\? pinCount,/.test(src)
  && /fetchViewFacts\(box, pinFilter, !!user\)/.test(src);
check('the map asks for the counted box and shows the line only against the number it shows', wired(web));
mustCatch('a line compared with a different number than the pill shows', () => wired(web.replace('factLine(viewFacts, hasShape ? null : placeCount ?? pinCount,', 'factLine(viewFacts, viewFacts?.any ?? null,')));
mustCatch('facts asked for an area total (a box the count was not read over)', () => wired(web.replace('setFactsBox(null); setPinCount(areasTotal(areas));', 'setFactsBox(paddedBox(center, span)); setPinCount(areasTotal(areas));')));

console.log(failed ? `\n${failed} check(s) FAILED` : '\nverify-map-view-facts: all checks passed');
process.exit(failed ? 1 : 0);
