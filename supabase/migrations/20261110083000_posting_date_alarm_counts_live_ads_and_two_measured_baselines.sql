-- THE POSTING-DATE ALARM COUNTS LIVE ADS ONLY, AND TWO SITES GET THEIR MEASURED FILL.
--
-- mon_detect_source_posting_date_fill_regressed() compares the share of a site's newly stored ads that carry a
-- readable date_added with the fill recorded in ops_source_posting_date_policy. It counted switched-off rows too.
-- A row switched off before its site's scraper was fixed is never crawled again, so it can never gain a date: the
-- alarm would then fire for weeks on a site whose live ads are all dated. Measured 2026-11-10 08:20Z, after the
-- night's crawl: dwelleo 61 of 61 live ads dated, yet 818 rows first stored in the last 14 days were switched off
-- on 2026-11-03 → «6.9 % against 90» and an alarm at the next full run; ego likewise (17 of 43 with switched-off
-- rows, every live one dated). Counting live ads (`active`) asks the question the alarm exists for — do the ads
-- users see carry a date — and a scraper that stops writing it still shows at once, on the new live rows.
--
-- Two baselines were recorded as EXPECTED (an estimate, «re-measure after the fix has stored some»). The night's
-- crawl is that measurement, live ads first stored in the window:
--   aljassim     9 of 98 (62 days) = 9 %. Its Drupal feed lists the 10 most recently changed ads and ignores the
--                ?nid= filter (read 2026-11-10: rss.xml?nid=4512 answered the same 10 items); the ad page carries
--                no created date at all. Only ads that pass through the feed get one.
--   aqarmonthly  18 of 39 (14 days) = 46 %. create_time is read from every unit the crawl prices; a unit with no
--                free 30-day window is not priced that night and keeps no date until a night it has one.
-- Spot-check of the stored values against the source the same morning: alshawaf 22416, sqcc 215, hasaad 8519,
-- rakez 72526 and aqarmonthly 6350367 (create_time 1756142824) all equal what the site published.

do $$
declare src text; out_def text;
begin
  src := pg_get_functiondef('public.mon_detect_source_posting_date_fill_regressed()'::regprocedure);
  if position('where active and scraped_at' in src) > 0 then
    raise notice 'fill-regressed already counts live ads only';
    return;
  end if;
  out_def := replace(src,
    $a$where scraped_at >= now() - interval ''62 days''', t)$a$,
    $b$where active and scraped_at >= now() - interval ''62 days''', t)$b$);
  if out_def = src then
    raise exception 'fill-regressed: row-filter anchor not found — refusing to guess';
  end if;
  execute out_def;
end $$;

update public.ops_source_posting_date_policy
   set baseline_fill_pct = 9, baseline_basis = 'measured', measured_on = '2026-11-10',
       evidence = evidence || ' MEASURED 2026-11-10 after the first crawl with the fix: 9 of 98 live ads first stored in 62 days dated; the feed holds the 10 latest-changed ads and ignores ?nid= (rss.xml?nid=4512 → the same 10 items), and the ad page carries no created date.'
 where platform = 'aljassim' and baseline_basis = 'expected';

update public.ops_source_posting_date_policy
   set baseline_fill_pct = 46, baseline_basis = 'measured', measured_on = '2026-11-10',
       evidence = evidence || ' MEASURED 2026-11-10 after the first crawl with the fix: 18 of 39 live ads first stored in 14 days dated; a unit with no free 30-day window is not priced that night, so it keeps no date until it is. Stored 6350367 = create_time 1756142824 on the live page.'
 where platform = 'aqarmonthly' and baseline_basis = 'expected';

do $$
begin
  if pg_get_functiondef('public.mon_detect_source_posting_date_fill_regressed()'::regprocedure)
       !~ 'mon_resolve_stale_keys\s*\(\s*''source_posting_date_fill_regressed'''
  or position('where active and scraped_at' in pg_get_functiondef('public.mon_detect_source_posting_date_fill_regressed()'::regprocedure)) = 0
  then
    raise exception 'fill-regressed: live-ads filter or literal resolver missing after the change';
  end if;
end $$;
