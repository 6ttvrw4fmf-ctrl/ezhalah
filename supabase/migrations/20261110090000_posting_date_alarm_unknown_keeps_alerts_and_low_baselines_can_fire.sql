-- THE POSTING-DATE ALARM: AN UNJUDGEABLE SITE KEEPS ITS ALERT, AND A LOW BASELINE CAN STILL FIRE.
--
-- Review of 20261110083000 (CodeRabbit, PR #11606), three findings, all fixed here:
--   1. Too few live ads to judge is UNKNOWN, never a recovery. The detector skipped such a site but left its key
--      out of `live`, so mon_resolve_stale_keys() closed an open alert with no evidence the date came back —
--      counting live ads only (083000) makes small samples likelier. Unknown now keeps whatever is open.
--   2. A low baseline must still be able to fire. The rule was «fill below baseline − 20»: aljassim's measured 9 %
--      gave −11 %, so 0 % could never alarm. The threshold is now greatest(baseline − 20, baseline ÷ 2) — every
--      existing threshold is unchanged or stricter (90 → 70, 46 → 26, 30 → 15) and aljassim fires below 4.5 %.
--   3. The decision lives in ONE pure function, public.source_posting_date_fill_verdict(), executed below against a
--      truth table at apply; scripts/verify-posting-date-alarm-judges-live-ads.ts keeps the detector on it (live
--      ads, unknown keeps the alert, the threshold) on every PR.
-- The detector is re-created whole from the committed original (20261109211500) plus 20261110063000 (the literal
-- resolver) and 20261110083000 (live ads only), so the definition below is the whole function.

create or replace function public.source_posting_date_fill_verdict(
  p_n14 bigint, p_d14 bigint, p_n62 bigint, p_d62 bigint, p_baseline numeric,
  out verdict text, out window_days int, out new_rows bigint, out with_date bigint,
  out fill_pct numeric, out threshold_pct numeric)
 language plpgsql
 immutable
 set search_path = public
as $function$
declare
  min_rows constant int     := 20;   -- fewer live ads first stored in the window than this: too few to judge
  drop_pts constant numeric := 20;   -- «well below»: this many points under the platform's baseline …
begin
  if coalesce(p_n14, 0) >= min_rows then
    window_days := 14; new_rows := p_n14; with_date := coalesce(p_d14, 0);
  elsif coalesce(p_n62, 0) >= min_rows then
    window_days := 62; new_rows := p_n62; with_date := coalesce(p_d62, 0);
  else
    verdict := 'unknown';
    return;
  end if;
  fill_pct := round(100.0 * with_date / new_rows, 1);
  if p_baseline is null then
    verdict := 'unknown';
    return;
  end if;
  -- … or under half of it, whichever is higher, so a low baseline (aljassim 9 %) can still fire.
  threshold_pct := greatest(p_baseline - drop_pts, p_baseline / 2.0);
  verdict := case when fill_pct < threshold_pct then 'regressed' else 'ok' end;
end $function$;
revoke all on function public.source_posting_date_fill_verdict(bigint, bigint, bigint, bigint, numeric) from public, anon, authenticated;
grant execute on function public.source_posting_date_fill_verdict(bigint, bigint, bigint, bigint, numeric) to service_role;

create or replace function public.mon_detect_source_posting_date_fill_regressed()
 returns integer
 language plpgsql
 security definer
 set search_path = public
as $function$
declare
  k  constant text := 'source_posting_date_fill_regressed';
  n int := 0; r record; v record; sfx text; t text; live text[] := '{}';
  a14 bigint; b14 bigint; a62 bigint; b62 bigint;
  n14 bigint; d14 bigint; n62 bigint; d62 bigint;
  v_tables int;
begin
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
      -- LIVE ads only: a row switched off before its site was fixed is never crawled again and can never gain a date.
      execute format(
        'select count(*) filter (where scraped_at >= now() - interval ''14 days''),
                count(*) filter (where scraped_at >= now() - interval ''14 days''
                                   and public.source_posted_at(date_added) is not null),
                count(*),
                count(*) filter (where public.source_posted_at(date_added) is not null)
           from public.%I
          where active and scraped_at >= now() - interval ''62 days''', t)
        into a14, b14, a62, b62;
      n14 := n14 + a14; d14 := d14 + b14; n62 := n62 + a62; d62 := d62 + b62;
    end loop;

    if v_tables = 0 then
      live := live || (k || ':' || r.platform);
      n := n + public.mon_raise('P2', k, r.platform, k || ':' || r.platform, jsonb_build_object(
        'platform', r.platform, 'problem', 'no listing table',
        'why', 'ops_source_posting_date_policy says this platform publishes a posting date, but neither '
            || r.platform || '_residential_listings nor ' || r.platform || '_commercial_listings exists, so nothing is being watched.',
        'action', 'Correct the platform name in ops_source_posting_date_policy.'));
      continue;
    end if;

    select * into v from public.source_posting_date_fill_verdict(n14, d14, n62, d62, r.baseline_fill_pct);

    if v.verdict = 'unknown' then
      -- Too few live ads to judge: UNKNOWN keeps whatever is open. It is never evidence that the date came back.
      live := live || (k || ':' || r.platform);
      continue;
    end if;

    if v.verdict = 'regressed' then
      live := live || (k || ':' || r.platform);
      -- Called on every run while it holds (20261108134701): mon_raise answers 0 for an alert that is already open.
      n := n + public.mon_raise('P2', k, r.platform, k || ':' || r.platform, jsonb_build_object(
        'platform', r.platform, 'window_days', v.window_days, 'new_rows', v.new_rows, 'with_readable_date', v.with_date,
        'fill_pct', v.fill_pct, 'threshold_pct', v.threshold_pct,
        'baseline_fill_pct', r.baseline_fill_pct, 'baseline_basis', r.baseline_basis,
        'read_from', r.read_from,
        'why', 'This site publishes a posting date and its newly stored live ads used to carry it in date_added; now far '
            || 'fewer do. Every time-window welcome fact counts by that date (public.source_posted_at), so these ads '
            || 'are silently in NO window. Old rows keep their date, which is why only new rows show the break.',
        'action', 'Scraping lane: open ONE real ad page of this site and find its posting date (it may have been '
            || 'renamed — aqarcity moved datePublished to datePosted). Write it through '
            || 'scrapers/common/posting_date.py site_posting_date(). Never substitute first_seen_at, a licence date, '
            || 'a bump / «last updated» date or a sitemap lastmod. If the page is proven to publish no date any more, '
            || 'set publishes = ''no'' in ops_source_posting_date_policy with the page URL in proof_url.'));
    end if;
  end loop;

  perform public.mon_resolve_stale_keys('source_posting_date_fill_regressed', live);
  insert into public.ops_detector_last_full_run (detector, last_run_at, last_result)
  select k, now(), n
   where not exists (select 1 from public.ops_detector_last_full_run where detector = k);
  update public.ops_detector_last_full_run set last_run_at = now(), last_result = n where detector = k;
  return n;
end $function$;
revoke all on function public.mon_detect_source_posting_date_fill_regressed() from public, anon, authenticated;
grant execute on function public.mon_detect_source_posting_date_fill_regressed() to service_role;

-- PROOF at apply, against the real functions.
-- (a) The verdict's truth table: windows, unknown, the old threshold where it was already stricter, the new floor.
do $$
declare c record; v record;
begin
  for c in select * from (values
      -- n14, d14, n62, d62, baseline, expected
      (0::bigint,   0::bigint, 10::bigint,  0::bigint, 90::numeric, 'unknown'),    -- too few in both windows
      (100, 95, 100, 95, 90, 'ok'),          -- 95 ≥ 70
      (100, 60, 100, 60, 90, 'regressed'),   -- 60 < 70 (the old rule, unchanged)
      (100,  4, 100,  4,  9, 'regressed'),   -- 4 < 4.5 — the old rule (−11) could never fire here
      (100,  5, 100,  5,  9, 'ok'),
      (10,   0,  98,  9,  9, 'ok'),          -- 62-day window: 9.2 ≥ 4.5 (aljassim on 2026-11-10)
      (39,  18,  39, 18, 46, 'ok'),          -- 46.2 ≥ 26 (aqarmonthly on 2026-11-10)
      (39,   9,  39,  9, 46, 'regressed'),   -- 23.1 < 26
      (50,  50,  50, 50, null, 'unknown')    -- no baseline: nothing to compare with
    ) x(n14, d14, n62, d62, base, want)
  loop
    select * into v from public.source_posting_date_fill_verdict(c.n14, c.d14, c.n62, c.d62, c.base);
    if v.verdict is distinct from c.want then
      raise exception 'PROOF: verdict(%,%,%,%,%) = %, expected %', c.n14, c.d14, c.n62, c.d62, c.base, v.verdict, c.want;
    end if;
  end loop;
end $$;

-- (b) An open alert on a site too small to judge stays open (planted, then rolled back). hasaad has 12 live ads.
do $$
declare v_open boolean;
begin
  begin
    if (select publishes from public.ops_source_posting_date_policy where platform = 'hasaad') is distinct from 'yes' then
      raise exception 'PROOF setup: hasaad is not a ''yes'' site any more — pick another site under 20 live ads';
    end if;
    perform public.mon_raise('P2', 'source_posting_date_fill_regressed', 'hasaad',
                             'source_posting_date_fill_regressed:hasaad', jsonb_build_object('selftest', true));
    delete from public.ops_detector_last_full_run where detector = 'source_posting_date_fill_regressed';
    perform public.mon_detect_source_posting_date_fill_regressed();
    select exists (select 1 from public.alert_event
                    where dedup_key = 'source_posting_date_fill_regressed:hasaad' and resolved_at is null) into v_open;
    if not v_open then
      raise exception 'PROOF: an unjudgeable site''s open alert was closed';
    end if;
    raise exception '__posting_date_unknown_selftest_rollback__';
  exception when raise_exception then
    if sqlerrm <> '__posting_date_unknown_selftest_rollback__' then raise; end if;
  end;
end $$;

-- (c) Still on the literal resolver the stale-alert watcher reads, and still counting live ads only.
do $$
declare d text := pg_get_functiondef('public.mon_detect_source_posting_date_fill_regressed()'::regprocedure);
begin
  if d !~ 'mon_resolve_stale_keys\s*\(\s*''source_posting_date_fill_regressed'''
  or position('where active and scraped_at' in d) = 0
  or position('source_posting_date_fill_verdict' in d) = 0 then
    raise exception 'PROOF: the detector lost its literal resolver, its live-ads filter or its verdict function';
  end if;
end $$;
