-- A source-confirmed withdrawal that is about to be auto-resurrected (routine-3, 2026-09-19).
--
-- THE CLASS. auto_recover_false_inactive() recovers a row on
--     active=false AND coalesce(missing_count,0)=0 AND deactivated_at >= now()-24h
--     AND not exists (<an ops_adjudicated_listing row>)
-- A kill made from POSITIVE source evidence -- the ad's own page says sold/withdrawn -- never
-- involves the ad being ABSENT from the crawl, so nothing increments missing_count and the row
-- matches those first three clauses EXACTLY as an accidental flip does. The adjudication ledger is
-- the only clause that can tell a decision from an accident.
--
-- Three measured instances: sadin supersession (2026-09-02, got a dedicated clause), rakez
-- off-plan (2026-09-14, registered by hand three days late), suwar «غير متاح» (2026-09-19, this
-- run: 54 ads killed and revived EVERY day 09-16..09-19, leaving 54 sold ads active=true and one
-- full sync pass away from being served).
--
-- WHY TWO HALVES, AND WHY BOTH ARE REQUIRED. The historical signature alone (crawl_stats showing
-- marked_inactive ~= reactivated for days) stays true for days after a fix and would keep a
-- repaired platform lit. The live half alone is not enough either: a nonzero pending-recovery
-- count is NORMAL -- recovering genuinely false inactivations is exactly what that job is for.
-- The defect is the two together: a repeating kill/revive cycle that STILL has unregistered rows
-- queued for tomorrow's 05:20 pass.

create or replace function public.mon_source_retraction_flap()
returns table(platform text, flap_days int, pending_resurrection bigint,
              worst_marked int, worst_reactivated int, last_day date)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  floor_n  int := 20;   -- below this a day's churn is noise, not a cohort
  rec      record;
  t        text;
  cnt      bigint;
  total    bigint;
begin
  for rec in
    select d.platform as p,
           count(*) filter (
             where d.marked_inactive >= floor_n
               and d.reactivated     >= floor_n
               -- killed and revived in near-equal volume: an oscillation, not a trend
               and abs(d.marked_inactive - d.reactivated)
                   <= greatest(2, (d.marked_inactive * 10) / 100)
           )::int                      as fdays,
           max(d.marked_inactive)::int as worst_m,
           max(d.reactivated)::int     as worst_r,
           max(d.day)                  as lday
      from public.crawl_stats_platform_daily d
     where d.day >= current_date - 4
     group by d.platform
  loop
    if rec.fdays < 2 then
      continue;                        -- one bad day is not a cycle
    end if;

    -- LIVE HALF: rows this platform will hand to the next recovery pass, unregistered.
    total := 0;
    for t in
      select tablename from pg_tables
       where schemaname='public'
         and tablename ~ '_(residential|commercial)_listings$'
         and split_part(tablename,'_',1) = rec.p
    loop
      execute format($f$
        select count(*) from public.%I t
         where t.active = false
           and coalesce(t.missing_count,0) = 0
           and (t.deactivated_at >= now() - interval '24 hours'
                or (t.deactivated_at is null and t.last_seen_at >= now() - interval '24 hours'))
           and not exists (select 1 from public.ops_adjudicated_listing j
                            where j.tbl = %L and j.listing_id = t.id)
      $f$, t, t) into cnt;
      total := total + coalesce(cnt,0);
    end loop;

    if total >= floor_n then
      platform := rec.p; flap_days := rec.fdays; pending_resurrection := total;
      worst_marked := rec.worst_m; worst_reactivated := rec.worst_r;
      last_day := rec.lday;
      return next;
    end if;
  end loop;
end $function$;

comment on function public.mon_source_retraction_flap() is
  'Decides; does not alert. Split out so the predicate can be EXECUTED against injected state '
  'without writing an alert_event (the mon_orphaned_detectors pattern, ops_incident #72).';

create or replace function public.mon_detect_source_retraction_flap()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare rec record; n int := 0; seen text[] := '{}';
begin
  for rec in select * from public.mon_source_retraction_flap() loop
    seen := seen || rec.platform;
    n := n + public.mon_raise('P1','source_retraction_flap', rec.platform,
      'source_retraction_flap:'||rec.platform,
      jsonb_build_object(
        'flap_days', rec.flap_days,
        'window_days', 5,
        'pending_resurrection', rec.pending_resurrection,
        'worst_marked_inactive', rec.worst_marked,
        'worst_reactivated', rec.worst_reactivated,
        'last_day', rec.last_day,
        'why','This platform kills and revives nearly the same number of listings every day, AND '
            ||'it still holds unregistered rows that the next auto_recover_false_inactive() pass '
            ||'will switch back on. That is the signature of a kill made from POSITIVE source '
            ||'evidence being undone: positive evidence never increments missing_count, so the row '
            ||'matches the recovery predicate exactly as an accidental flip does, and only an '
            ||'ops_adjudicated_retraction row can distinguish a decision from an accident.',
        'fix','Do NOT silence this, and do NOT bulk-deactivate on the count alone. Establish WHY '
            ||'the crawl killed the rows. If the verdict is POSITIVE and direct (the ad''s own page '
            ||'says sold/withdrawn), have the scraper call db.register_source_retraction() in the '
            ||'same run that makes the decision -- scrapers/suwar/run.py is the reference '
            ||'implementation. If the kill came from ABSENCE, it is a prune question and this flap '
            ||'is a different bug: absence is never evidence (docs/ops/LISTING_LIVENESS.md).'));
  end loop;

  -- Clear any platform that no longer qualifies, so a repaired one does not stay lit.
  update public.alert_event
     set resolved_at = now()
   where kind = 'source_retraction_flap'
     and resolved_at is null
     and not (platform = any(seen));

  return n;
end $function$;

-- ---------------------------------------------------------------------------
-- APPLY-TIME SELF-TESTS. These EXECUTE the predicate against real state; a failure rolls the
-- whole migration back, so the detector cannot be installed in a shape that does not work.
-- ---------------------------------------------------------------------------
do $$
declare v_rows int;
begin
  -- T1: the live half must EXCLUDE adjudicated rows. suwar was repaired earlier in this run
  -- (54 rows registered in ops_adjudicated_retraction + active=false), and its 09-16..09-19 flap
  -- history is still in crawl_stats. It must therefore NOT be reported: history alone never fires.
  select count(*) into v_rows from public.mon_source_retraction_flap() where platform = 'suwar';
  if v_rows <> 0 then
    raise exception 'T1 FAILED: suwar is repaired (54 adjudicated) but still reported - the live '
                    'half is not reading ops_adjudicated_listing, so a fixed platform stays lit';
  end if;

  -- T2: the fixture T1 relies on must actually exist, or T1 proved nothing.
  select count(*) into v_rows
    from public.crawl_stats_platform_daily d
   where d.day >= current_date - 4 and d.marked_inactive >= 20 and d.reactivated >= 20
     and abs(d.marked_inactive - d.reactivated) <= greatest(2,(d.marked_inactive*10)/100);
  if v_rows = 0 then
    raise exception 'T2 FAILED: no flap-shaped day exists in the last 5 days, so T1 proved nothing';
  end if;

  -- T3: one bad day is not a cycle. A single flap day must never qualify.
  if exists (
    select 1 from (
      select d.platform as p,
             count(*) filter (where d.marked_inactive >= 20 and d.reactivated >= 20
               and abs(d.marked_inactive - d.reactivated) <= greatest(2,(d.marked_inactive*10)/100)) as fd
        from public.crawl_stats_platform_daily d
       where d.day >= current_date - 4 group by d.platform) x
     join public.mon_source_retraction_flap() f on f.platform = x.p
    where x.fd < 2)
  then
    raise exception 'T3 FAILED: a platform with fewer than 2 flap days was reported';
  end if;

  -- T4: the detector must be callable and must not throw on real production data.
  perform public.mon_detect_source_retraction_flap();

  raise notice 'source_retraction_flap self-tests T1-T4 PASSED';
end $$;

-- Roster entry, in the SAME migration as the detector (AGENTS.md): a detector nothing reaches is
-- decoration, and mon_detect_orphaned_detectors() fires on it. Done as a textual splice of the
-- live definition rather than by retyping ~200 names (token-efficiency rule, AGENTS.md).
do $$
declare def text;
begin
  select pg_get_functiondef(oid) into def
    from pg_proc where proname = 'mon_run_all_detectors' and pronamespace = 'public'::regnamespace;
  if def is null then
    raise exception 'mon_run_all_detectors() not found - cannot roster the new detector';
  end if;
  if position('mon_detect_source_retraction_flap' in def) > 0 then
    raise notice 'already rostered'; return;
  end if;
  if position('''mon_detect_zero_new_stall''' in def) = 0 then
    raise exception 'roster anchor mon_detect_zero_new_stall not found - refusing to splice blind';
  end if;
  def := replace(def, '''mon_detect_zero_new_stall''',
                      '''mon_detect_zero_new_stall'', ''mon_detect_source_retraction_flap''');
  execute def;
end $$;

do $$
begin
  if position('mon_detect_source_retraction_flap' in
      (select pg_get_functiondef(oid) from pg_proc
        where proname='mon_run_all_detectors' and pronamespace='public'::regnamespace)) = 0 then
    raise exception 'ROSTER FAILED: the detector is not reachable from mon_run_all_detectors()';
  end if;
  raise notice 'rostered OK';
end $$;