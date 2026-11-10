-- AN ALARM FOR «A SITE PUBLISHES A POSTING DATE AND WE STOPPED STORING IT» (owner 2026-11-09).
-- Applied after the backfill in 20261109210500, so the platforms whose captured date was only just written to
-- date_added are not named for work already done. aqarcity and sakan hold no captured date on their stored rows:
-- they are named, truthfully, until the fixed scrapers (same PR) have crawled them once.
--
-- WHY
-- Every time-window welcome fact counts an ad by the date its SITE says it was posted: date_added, read by
-- public.source_posted_at() (owner 2026-10-26, docs/ARCHITECTURE.md §20). An ad with no readable date is in NO window.
-- So when a site renames its date field, or a scraper stops writing it, nothing breaks loudly — that site's new ads
-- just silently stop being counted. Measured 2026-11-09: aqarcity renamed JSON-LD datePublished → datePosted, and
-- from then on 0 of 177 newly stored rows carried a date while all 1,534 older rows did; dealapp captured the date on
-- 58,197 of 58,197 new rows and wrote it to date_added on none. No detector saw either.
--
-- welcome_posting_date_check (20261028033700) asks «can this table's dates be TRUSTED?». This asks the other
-- question: «is a site that publishes a date still getting it STORED?».
--
-- WHAT IT WATCHES
-- NEW rows only (first stored — scraped_at — in the last 14 days, or 62 days when a site adds fewer than 20 rows in 14).
-- The upsert never overwrites a known value with an unknown one (scrapers/common/db.py), so old rows keep their date
-- when a scraper breaks: a whole-table fill rate would stay high for months. Only the new rows show the break.
-- A platform is named when its new-row fill rate is more than 20 points under its measured baseline.
--
-- A platform that publishes NO date is DECLARED ('no') and never alarmed. A platform nobody has been able to read
-- ('unknown') is declared too, and never alarmed — it is an open question, not a regression. A platform that is not in
-- the table at all is not watched: add its row when its scraper starts writing date_added.

create table if not exists public.ops_source_posting_date_policy (
  platform          text primary key,
  publishes         text not null check (publishes in ('yes', 'no', 'unknown')),
  read_from         text,              -- the site's own field the scraper reads
  baseline_fill_pct numeric,           -- % of newly stored rows with a readable date_added
  baseline_basis    text check (baseline_basis in ('measured', 'expected')),
  measured_on       date not null,
  evidence          text not null,     -- the numbers behind the row, or why it is 'no' / 'unknown'
  proof_url         text,              -- for 'no': the ad page that was read and shows no posting date
  constraint posting_date_policy_yes_is_complete check (
    publishes <> 'yes'
    or (read_from is not null and baseline_basis is not null and baseline_fill_pct between 1 and 100))
);
comment on table public.ops_source_posting_date_policy is
  'Per listing site: does it publish a posting date, which field we read, and the measured share of newly stored rows that carry a readable date_added. mon_detect_source_posting_date_fill_regressed() alarms a ''yes'' platform that falls well under its baseline; ''no'' (publishes none) and ''unknown'' (not yet readable) are declared and never alarmed. A missing captured field is not evidence that the source omits it (owner 2026-08-13): a ''no'' row should carry the URL of the page that was read. Mirror of the table in docs/ARCHITECTURE.md §20.';
revoke all on table public.ops_source_posting_date_policy from public, anon, authenticated;
grant select, insert, update on table public.ops_source_posting_date_policy to service_role;

-- Baselines: rows first stored in the 62 days to 2026-11-09, both tables of the platform together, read-only.
insert into public.ops_source_posting_date_policy
  (platform, publishes, read_from, baseline_fill_pct, baseline_basis, measured_on, evidence, proof_url)
values
  -- already writing date_added before this change
  ('muhaysini',      'yes', 'createdAt',                              100,  'measured', '2026-11-09', '47,285 of 47,285 rows stored in 62 days are dated', null),
  ('haraj',          'yes', 'date_posted / JSON-LD datePosted',       100,  'measured', '2026-11-09', '20,839 of 20,839', null),
  ('aqar',           'yes', 'page «تاريخ الإعلان» / «تاريخ الإضافة»',   100,  'measured', '2026-11-09', 'commercial 5,857 of 5,859; residential 6,960 of 6,962 on a 5 % page sample', null),
  ('propertyfinder', 'yes', 'listed_date',                            100,  'measured', '2026-11-09', '4,710 of 4,710', null),
  ('tuba',           'yes', 'created_at',                             99.3, 'measured', '2026-11-09', '4,500 of 4,531', null),
  ('nofodh',         'yes', 'overview «تاريخ النشر»',                  100,  'measured', '2026-11-09', '2,556 of 2,556; none stored in the last 14 days', null),
  ('muktamel',       'yes', 'offer.createDate',                       100,  'measured', '2026-11-09', '1,610 of 1,610', null),
  ('reinvest',       'yes', 'published_at, else created_at',          100,  'measured', '2026-11-09', '1,185 of 1,185', null),
  ('abaad',          'yes', 'creation_date',                          100,  'measured', '2026-11-09', '630 of 630', null),
  ('sukna',          'yes', 'created_at',                             100,  'measured', '2026-11-09', '295 of 295', null),
  ('ibaax',          'yes', 'feature «Creation Date»',                100,  'measured', '2026-11-09', '224 of 224', null),
  ('vmksa',          'yes', 'created_at',                             100,  'measured', '2026-11-09', '216 of 216', null),
  ('kellerwilliams', 'yes', 'list_dt',                                100,  'measured', '2026-11-09', '190 of 190', null),
  ('macsaib',        'yes', 'createdAt',                              100,  'measured', '2026-11-09', '76 of 76', null),
  ('earthapp',       'yes', 'created_at',                             100,  'measured', '2026-11-09', '70 of 70', null),
  ('mrajhi',         'yes', 'JSON-LD datePosted',                     100,  'measured', '2026-11-09', '39 of 39', null),
  ('eaqartabuk',     'yes', 'item.date',                              100,  'measured', '2026-11-09', '27 of 27', null),
  ('squares',        'yes', 'date',                                   100,  'measured', '2026-11-09', '16 of 16 — under 20 rows, so not judged until it adds more', null),
  ('remaxsa',        'yes', 'FirstUpdatedToWeb',                      100,  'measured', '2026-11-09', '7 of 7 — under 20 rows, not judged until it adds more', null),
  ('qmra',           'yes', 'date',                                   100,  'measured', '2026-11-09', '6 of 6 — under 20 rows, not judged until it adds more', null),
  ('eastabha',       'yes', 'p.date',                                 100,  'measured', '2026-11-09', '236 of 236 rows in the whole table; none stored in 62 days, so not judged until it adds more', null),
  -- fixed by the scraper change on branch data/source-posting-date-fill: the site date was captured, never written
  ('dealapp',        'yes', 'JSON-LD datePosted',                     100,  'measured', '2026-11-09', 'the site date was captured on 58,197 of 58,197 rows stored in 62 days (additional_info.date_posted); date_added held 0 of them before the fix', null),
  ('arkaan',         'yes', 'JSON-LD datePosted',                     100,  'measured', '2026-11-09', 'captured on 940 of 940 (additional_info.date_posted); date_added 0 before the fix', null),
  ('mustqr',         'yes', 'API created_at',                         100,  'measured', '2026-11-09', 'captured on 305 of 305 (additional_info.mustqr_created_at); date_added 0 before the fix', null),
  ('therc',          'yes', 'JSON-LD datePosted',                     100,  'measured', '2026-11-09', 'captured on 60 of 60 (source_capture.date_posted); date_added 0 before the fix', null),
  ('aqarcity',       'yes', 'JSON-LD datePublished, else datePosted, else the page «تاريخ النشر» cell', 100, 'measured', '2026-11-09', '1,534 of 1,534 rows stored before the site renamed datePublished → datePosted; 0 of 177 in the last 14 days, which is the break this detector is for', null),
  ('tawia',          'yes', 'JSON-LD datePosted',                     100,  'measured', '2026-11-09', 'captured on 10 of 10 rows in the whole table — under 20, not judged until it adds more', null),
  ('eydah',          'yes', 'JSON-LD datePosted',                     100,  'measured', '2026-11-09', 'captured on 2 of 2 rows in the whole table — under 20, not judged until it adds more', null),
  ('sakan',          'yes', 'JSON-LD datePosted',                     100,  'expected', '2026-11-09', 'EXPECTED, not measured: 2 of 2 ad pages read carry datePosted (ad 100553: 2026-11-08). The scraper never captured it, so no row holds it yet. Re-measure after the first crawl and correct this row.', null),
  -- publishes no posting date: declared, never alarmed
  ('gathern',        'no',  null, null, null, '2026-11-09', 'Declared from the 2026-11-09 survey of the scrapers; the ad page was NOT re-read for this row. Record the page URL in proof_url when it is.', null),
  ('aqarmonthly',    'no',  null, null, null, '2026-11-09', 'Declared from the 2026-11-09 survey; page not re-read for this row.', null),
  ('rakez',          'no',  null, null, null, '2026-11-09', 'Declared from the 2026-11-09 survey; page not re-read for this row.', null),
  ('sakani',         'no',  null, null, null, '2026-11-09', 'Declared from the 2026-11-09 survey; page not re-read for this row.', null),
  -- not readable yet: an open question, never alarmed
  ('wasalt',         'unknown', null, null, null, '2026-11-09', 'The only date the scraper sees is regaAdvLicDate — the REGA LICENCE date, never a posting date. Needs a live probe from CI egress (the site answers 403 elsewhere). 91,993 active residential rows have no date.', null),
  ('ego',            'unknown', 'createdAt', null, null, '2026-11-09', 'Stored as «01 Aug 2026 - 03:27:59 AM» on 43 of 43 rows: text is there but source_posted_at() reads none of it, and the stamp''s time zone is not verified.', null),
  ('almotmkenah',    'unknown', 'page «تاريخ الادخال»', null, null, '2026-11-09', 'The scraper has a line that reads it, yet 0 of 22 rows carry a date. Not investigated.', null)
on conflict (platform) do nothing;

create or replace function public.mon_detect_source_posting_date_fill_regressed()
 returns integer
 language plpgsql
 security definer
 set search_path = public
as $function$
declare
  k         constant text    := 'source_posting_date_fill_regressed';
  min_rows  constant int     := 20;   -- fewer newly stored rows than this: too few to say anything
  drop_pts  constant numeric := 20;   -- «well below»: this many points under the platform's baseline
  n int := 0; r record; sfx text; t text; live text[] := '{}';
  a14 bigint; b14 bigint; a62 bigint; b62 bigint;
  n14 bigint; d14 bigint; n62 bigint; d62 bigint;
  v_tables int; v_days int; v_rows bigint; v_dated bigint; v_fill numeric;
begin
  -- Daily: it reads every watched listing table, and none has an index on scraped_at.
  if exists (select 1 from public.ops_detector_last_full_run
              where detector = k and last_run_at > now() - interval '20 hours') then
    return 0;
  end if;

  for r in select * from public.ops_source_posting_date_policy where publishes = 'yes' order by platform
  loop
    n14 := 0; d14 := 0; n62 := 0; d62 := 0; v_tables := 0;
    foreach sfx in array array['residential', 'commercial']
    loop
      t := r.platform || '_' || sfx || '_listings';
      continue when to_regclass(format('public.%I', t)) is null;
      v_tables := v_tables + 1;
      execute format(
        'select count(*) filter (where scraped_at >= now() - interval ''14 days''),
                count(*) filter (where scraped_at >= now() - interval ''14 days''
                                   and public.source_posted_at(date_added) is not null),
                count(*),
                count(*) filter (where public.source_posted_at(date_added) is not null)
           from public.%I
          where scraped_at >= now() - interval ''62 days''', t)
        into a14, b14, a62, b62;
      n14 := n14 + a14; d14 := d14 + b14; n62 := n62 + a62; d62 := d62 + b62;
    end loop;

    if v_tables = 0 then
      -- A 'yes' row that points at no table watches nothing: say so instead of reading it as healthy.
      live := live || (k || ':' || r.platform);
      n := n + public.mon_raise('P2', k, r.platform, k || ':' || r.platform, jsonb_build_object(
        'platform', r.platform, 'problem', 'no listing table',
        'why', 'ops_source_posting_date_policy says this platform publishes a posting date, but neither '
            || r.platform || '_residential_listings nor ' || r.platform || '_commercial_listings exists, so nothing is being watched.',
        'action', 'Correct the platform name in ops_source_posting_date_policy.'));
      continue;
    end if;

    if    n14 >= min_rows then v_days := 14; v_rows := n14; v_dated := d14;
    elsif n62 >= min_rows then v_days := 62; v_rows := n62; v_dated := d62;
    else  continue;                       -- too few new rows: UNKNOWN, not healthy and not broken
    end if;

    v_fill := round(100.0 * v_dated / v_rows, 1);
    if v_fill < r.baseline_fill_pct - drop_pts then
      live := live || (k || ':' || r.platform);
      -- Called on every run while it holds (20261108134701): mon_raise answers 0 for an alert that is already open.
      n := n + public.mon_raise('P2', k, r.platform, k || ':' || r.platform, jsonb_build_object(
        'platform', r.platform, 'window_days', v_days, 'new_rows', v_rows, 'with_readable_date', v_dated,
        'fill_pct', v_fill, 'baseline_fill_pct', r.baseline_fill_pct, 'baseline_basis', r.baseline_basis,
        'read_from', r.read_from,
        'why', 'This site publishes a posting date and its newly stored ads used to carry it in date_added; now far '
            || 'fewer do. Every time-window welcome fact counts by that date (public.source_posted_at), so these ads '
            || 'are silently in NO window. Old rows keep their date, which is why only new rows show the break.',
        'action', 'Scraping lane: open ONE real ad page of this site and find its posting date (it may have been '
            || 'renamed — aqarcity moved datePublished to datePosted). Write it through '
            || 'scrapers/common/posting_date.py site_posting_date(). Never substitute first_seen_at, a licence date, '
            || 'a bump / «last updated» date or a sitemap lastmod. If the page is proven to publish no date any more, '
            || 'set publishes = ''no'' in ops_source_posting_date_policy with the page URL in proof_url.'));
    end if;
  end loop;

  perform public.mon_resolve_stale_keys(k, live);
  insert into public.ops_detector_last_full_run (detector, last_run_at, last_result)
  select k, now(), n
   where not exists (select 1 from public.ops_detector_last_full_run where detector = k);
  update public.ops_detector_last_full_run set last_run_at = now(), last_result = n where detector = k;
  return n;
end $function$;
revoke all on function public.mon_detect_source_posting_date_fill_regressed() from public, anon, authenticated;
grant execute on function public.mon_detect_source_posting_date_fill_regressed() to service_role;

-- Roster: needle-inserted into the LIVE definition (a full copy would clobber a peer's entry).
-- Anchor read on production 2026-11-09. If it has moved by apply day this stops; pick the new neighbour, never guess.
do $$
declare src text; out_def text;
begin
  src := pg_get_functiondef('public.mon_run_all_detectors()'::regprocedure);
  if position('mon_detect_source_posting_date_fill_regressed' in src) > 0 then
    raise notice 'mon_detect_source_posting_date_fill_regressed already on the roster';
    return;
  end if;
  out_def := replace(src,
    E'    ''mon_detect_bedrooms_not_captured'',',
    E'    ''mon_detect_bedrooms_not_captured'',\n    ''mon_detect_source_posting_date_fill_regressed'',');
  if out_def = src then
    raise exception 'roster anchor not found — refusing to guess where the entry belongs';
  end if;
  execute out_def;
end $$;

-- Lane: a date the site publishes and the scraper does not store is the Scraping Engineer's.
do $$
declare src text; out_def text;
begin
  src := pg_get_functiondef('public.ops_engineer_for_alert(text,text)'::regprocedure);
  if position('source_posting_date_fill_regressed' in src) > 0 then
    raise notice 'ops_engineer_for_alert already routes source_posting_date_fill_regressed';
    return;
  end if;
  out_def := replace(src,
    $n$when p_kind ~ '^(bedrooms_not_captured_fleet|scrape_suspect|source_shows_small_total|quarantine_growth)$'$n$,
    $n$when p_kind ~ '^(source_posting_date_fill_regressed|bedrooms_not_captured_fleet|scrape_suspect|source_shows_small_total|quarantine_growth)$'$n$);
  if out_def = src then
    raise exception 'ops_engineer_for_alert anchor not found — refusing to guess';
  end if;
  execute out_def;
end $$;

-- PROOF at apply. A site declared 'no' is not named; the same site declared 'yes' IS named (planted, then rolled
-- back); the alert is routed to the scraping lane; the detector is on the roster.
-- gathern is the plant: 9,349 rows stored in the 62 days to 2026-11-09, none with a date.
do $$
declare v_hit int; d jsonb;
begin
  delete from public.ops_detector_last_full_run where detector = 'source_posting_date_fill_regressed';
  perform public.mon_detect_source_posting_date_fill_regressed();

  if exists (select 1 from public.alert_event a
              join public.ops_source_posting_date_policy p
                on a.dedup_key = 'source_posting_date_fill_regressed:' || p.platform
             where a.resolved_at is null and p.publishes <> 'yes') then
    raise exception 'PROOF: a platform declared ''no'' or ''unknown'' was alarmed';
  end if;

  begin
    update public.ops_source_posting_date_policy
       set publishes = 'yes', read_from = '__selftest__', baseline_fill_pct = 100, baseline_basis = 'expected'
     where platform = 'gathern';
    delete from public.ops_detector_last_full_run where detector = 'source_posting_date_fill_regressed';
    perform public.mon_detect_source_posting_date_fill_regressed();
    select detail into d from public.alert_event
     where dedup_key = 'source_posting_date_fill_regressed:gathern' and resolved_at is null;
    if d is null then
      raise exception 'PROOF: a platform that publishes a date and stores none was not caught';
    end if;
    if (d->>'fill_pct')::numeric > 80 then
      raise exception 'PROOF: the planted platform was raised with a healthy fill rate: %', d;
    end if;
    raise exception '__posting_date_selftest_rollback__';
  exception when raise_exception then
    if sqlerrm <> '__posting_date_selftest_rollback__' then raise; end if;
  end;

  if exists (select 1 from public.ops_source_posting_date_policy where read_from = '__selftest__') then
    raise exception 'PROOF: the selftest policy row was not rolled back';
  end if;
  if public.ops_engineer_for_alert('source_posting_date_fill_regressed', null) <> 'scraping-engineer' then
    raise exception 'PROOF: source_posting_date_fill_regressed is not routed to the scraping lane';
  end if;
  if position('mon_detect_source_posting_date_fill_regressed'
              in pg_get_functiondef('public.mon_run_all_detectors()'::regprocedure)) = 0 then
    raise exception 'PROOF: the detector is not on the roster';
  end if;

  select count(*) into v_hit from public.alert_event
   where kind = 'source_posting_date_fill_regressed' and resolved_at is null;
  raise notice 'PROOF: declared platforms stay quiet, a planted break is caught and rolled back, routed, on the roster. Open alerts of this kind right now: %', v_hit;
end $$;
