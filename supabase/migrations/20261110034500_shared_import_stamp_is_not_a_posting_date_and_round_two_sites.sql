-- ONE STAMP SHARED BY A WHOLE SITE IS NOT A POSTING DATE — nofodh, and an alarm for the shape anywhere.
--
-- Owner 2026-11-10: «Only 90 we need more and more please check all» — and a wrong date is worse than none.
-- The round-2 correctness check (20 stored dates compared with 16 live sources, 19 agree) found nofodh's
-- «تاريخ النشر» is the platform's IMPORT timestamp, not when each ad was posted: 2,542 of its 2,556 active
-- ads carry the same value (2026-05-15; five distinct values across the whole catalogue — the scraper's own
-- trap 8), and the page has since re-printed it as «2026-05-14 03:26:16». scrapers/nofodh/run.py now stores
-- no posting date; this clears the stored copies. The printed text stays verbatim in
-- source_capture.overview["تاريخ النشر"] on every one of the 2,556 rows (checked before writing: 2,556 of
-- 2,556 identical to date_added), so nothing the source said is lost.
--
-- mon_detect_shared_posting_stamp() watches EVERY listing table for the shape: one date_added value on half
-- or more of a table's dated active rows (at least 50 of them). Measured 2026-11-10 before this migration:
-- only nofodh came within sight of it (99.5 %); no other table has any single value above 30 %.
--
-- Also recorded here, from the round-2 re-check of every «no» / «unknown» site (2026-11-10, every place:
-- page, embedded JSON, the site's own APIs, feeds, sitemap noted but never used): three more sites publish
-- a real posting date in a public feed round 1 did not try — alshawaf (each district's Drupal feed: the
-- node's created pubDate, while the page prints the bump date), sqcc and hasaad (WordPress RSS). Their
-- scrapers now read it; no stored row holds it, so their first crawl fills them. gathern stays 'no' with the
-- endpoints that were read.

-- 1. nofodh: the printed stamp leaves date_added; the verbatim text stays in source_capture.
update public.nofodh_residential_listings
   set date_added = null
 where date_added is not null
   and source_capture -> 'overview' ->> 'تاريخ النشر' = date_added;
update public.nofodh_commercial_listings
   set date_added = null
 where date_added is not null
   and source_capture -> 'overview' ->> 'تاريخ النشر' = date_added;

-- 2. The alarm, for any table.
create or replace function public.mon_detect_shared_posting_stamp()
 returns integer
 language plpgsql
 security definer
 set search_path = public
as $function$
declare
  k        constant text    := 'shared_posting_stamp';
  min_rows constant int     := 50;     -- fewer dated rows than this: too few to call a value «shared»
  share    constant numeric := 0.5;    -- one value on at least half of them
  n int := 0; r record; live text[] := '{}';
  v_total bigint; v_top bigint; v_val text;
begin
  if exists (select 1 from public.ops_detector_last_full_run
              where detector = k and last_run_at > now() - interval '20 hours') then
    return 0;
  end if;

  for r in
    select c.relname
      from pg_class c join pg_namespace s on s.oid = c.relnamespace
     where s.nspname = 'public' and c.relkind = 'r'
       and c.relname ~ '_(residential|commercial)_listings$'
       and exists (select 1 from information_schema.columns col
                    where col.table_schema = 'public' and col.table_name = c.relname and col.column_name = 'date_added')
     order by c.relname
  loop
    execute format(
      'select coalesce(sum(n), 0), coalesce(max(n), 0), (array_agg(v order by n desc))[1]
         from (select date_added v, count(*) n from public.%I
                where active and date_added is not null group by 1) z', r.relname)
      into v_total, v_top, v_val;
    if v_total >= min_rows and v_top >= share * v_total then
      live := live || (k || ':' || r.relname);
      n := n + public.mon_raise('P2', k, r.relname, k || ':' || r.relname, jsonb_build_object(
        'table', r.relname, 'shared_value', v_val, 'rows_with_it', v_top, 'dated_rows', v_total,
        'why', 'One date_added value is carried by at least half of this table''s dated active ads. That is a site-wide '
            || 'import / migration stamp, not the day each ad was posted (nofodh 2026-11-10: 2,542 of 2,556 on one '
            || 'value). Every «new today / last 7 days» fact counts by date_added, so a stamp like this either '
            || 'hides real posting days or, on the stamp''s own day, makes a whole site look new.',
        'action', 'Scraping lane: open two ads of this site. If the printed date is the same import stamp, make the '
            || 'scraper store NULL (keep the printed text in source_capture), clear the stored copies in a migration, '
            || 'and set the site to ''no'' in ops_source_posting_date_policy with the page in proof_url. If the ads '
            || 'really were posted that day (a one-off bulk upload), record that here instead of silencing the alarm.'));
    end if;
  end loop;

  perform public.mon_resolve_stale_keys(k, live);
  insert into public.ops_detector_last_full_run (detector, last_run_at, last_result)
  select k, now(), n
   where not exists (select 1 from public.ops_detector_last_full_run where detector = k);
  update public.ops_detector_last_full_run set last_run_at = now(), last_result = n where detector = k;
  return n;
end $function$;
revoke all on function public.mon_detect_shared_posting_stamp() from public, anon, authenticated;
grant execute on function public.mon_detect_shared_posting_stamp() to service_role;

do $$
declare src text; out_def text;
begin
  src := pg_get_functiondef('public.mon_run_all_detectors()'::regprocedure);
  if position('mon_detect_shared_posting_stamp' in src) > 0 then
    raise notice 'mon_detect_shared_posting_stamp already on the roster';
    return;
  end if;
  out_def := replace(src,
    E'    ''mon_detect_source_posting_date_fill_regressed'',',
    E'    ''mon_detect_source_posting_date_fill_regressed'',\n    ''mon_detect_shared_posting_stamp'',');
  if out_def = src then
    raise exception 'roster anchor not found — refusing to guess where the entry belongs';
  end if;
  execute out_def;
end $$;

do $$
declare src text; out_def text;
begin
  src := pg_get_functiondef('public.ops_engineer_for_alert(text,text)'::regprocedure);
  if position('shared_posting_stamp' in src) > 0 then
    raise notice 'ops_engineer_for_alert already routes shared_posting_stamp';
    return;
  end if;
  out_def := replace(src, '^(source_posting_date_fill_regressed|', '^(source_posting_date_fill_regressed|shared_posting_stamp|');
  if out_def = src then
    raise exception 'routing anchor not found — refusing to guess where the kind belongs';
  end if;
  execute out_def;
end $$;

-- 3. The policy rows.
insert into public.ops_source_posting_date_policy
  (platform, publishes, read_from, baseline_fill_pct, baseline_basis, measured_on, evidence, proof_url)
values
  ('nofodh', 'no', null, null, null, '2026-11-10',
   'Its «تاريخ النشر» is the platform''s IMPORT timestamp, not a posting date: 2,542 of 2,556 active ads print one value (2026-05-15; five values across the catalogue, scraper trap 8), and ad 844107 now prints it as «2026-05-14 03:26:16». Stored text kept in source_capture.overview; date_added cleared 2026-11-10.',
   'https://www.nofodh.sa/listings/844107'),
  ('alshawaf', 'yes', 'the district feed /taxonomy/term/<tid>/feed <pubDate> (the node''s created date) — never the page «التاريخ», which is the bump date', 60, 'expected', '2026-11-10',
   'Read live 2026-11-10: node 22416 pubDate «Thu, 05 Nov 2026 04:46:14 +0000» = 2026-11-05T07:46:14+03:00, first seen 05:47Z; created ≠ changed on 22226, 21788, 21808, 22153. Each feed lists its district''s 10 newest ads, so ~772 of 1,023 active ads (all new ones) get a date. EXPECTED until the scraper fix has stored some.',
   null),
  ('sqcc', 'yes', 'WordPress RSS /feed/?post_type=realestate <pubDate>', 90, 'expected', '2026-11-10',
   'Read live 2026-11-10: p=215 pubDate «Tue, 16 Jul 2024 08:05:11 +0000»; the 4 feed pages hold all 33 posts, every one before first seen. EXPECTED until the scraper fix has stored some.',
   null),
  ('hasaad', 'yes', 'WordPress one-item RSS (?feed=rss2&post_type=units&p=<id>) <pubDate> — never lastBuildDate', 90, 'expected', '2026-11-10',
   'Read live 2026-11-10: unit 8519 pubDate «Mon, 03 Nov 2025 14:09:16 +0000», first seen 2026-09-24. EXPECTED until the scraper fix has stored some.',
   null),
  ('gathern', 'no', null, null, null, '2026-11-10',
   'Round 2 (2026-11-10), every place: the unit page (VacationRental ld+json, ~150 __NEXT_DATA__ keys), api.gathern.co/v1/web/chalet/unit (asked for created_at / published_at / approved_at: ignored), chalet/calendar, reviews, and the msapi search feed carry no listing date — only booking dates, instalment dates and the HOST''s join month. is_new («جديد») does not follow age (260706 has it, 283173 does not). No feed, no relative text.',
   'https://gathern.co/view/192604/unit/283193')
on conflict (platform) do update set
  publishes = excluded.publishes, read_from = excluded.read_from, baseline_fill_pct = excluded.baseline_fill_pct,
  baseline_basis = excluded.baseline_basis, measured_on = excluded.measured_on, evidence = excluded.evidence,
  proof_url = excluded.proof_url;

-- Named so the repair guard sees what watches the clear; returns 0 inside its 20 h gate on a re-run.
select public.mon_detect_shared_posting_stamp();
