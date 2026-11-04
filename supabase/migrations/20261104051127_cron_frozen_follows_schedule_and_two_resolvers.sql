-- Monitoring-meta, 2026-11-04 (owner: "fix the root of each bug so they don't pop up").
--
-- 1. cron_scheduler_frozen judged a job against the cadence it USED to have.
--    mon_cron_frozen_jobs() took the median gap of 7 days of runs. On 2026-11-04 the cron rebalance
--    moved mon-search-latency-sample (jobid 105) from every 4 minutes to "13,41,49,57 * * * *". Its
--    history median stayed 240 s, so every hour the honest 28-minute gap :13 -> :41 read as
--    "6.8 periods missed" and a P1 cron_scheduler_frozen opened at :31 and closed at :42 — five
--    flaps by 04:42 (alert_flapping). Any schedule change, and the approved cron consolidation is
--    changing many, raised the same false P1.
--    ROOT FIX, both halves:
--      a. history is read only from the moment the CURRENT schedule existed
--         (ops_cron_job_first_seen.schedule_changed_at, the stamp cron_health limb 5 already uses);
--      b. the overdue line is never shorter than the schedule's own longest honest gap plus three
--         periods (mon_cron_max_gap_s). A regular schedule has max gap = period, so its line stays
--         exactly 4 x period: a genuinely frozen job still raises.
--
-- 2. mon_detect_rent_tiny_gate_reverted could open monitor_integrity:rent_tiny_gate_reverted and
--    never close it (unresolvable_detector). It now resolves the key when the selftest PASSES — the
--    only evaluated clean path.
--
-- 3. duplicate_card_surface_routed (alert 502) was a hand-routed copy of url_collision_res_vs_com for
--    dealapp and sadin, with no resolver anywhere (unresolvable_alert_kind). The url-collision
--    detector, which re-measures every platform each sweep, now closes a routed copy once NONE of the
--    platforms the copy names still collides, and holds it while any named platform does.

do $guard$
begin
  if to_regprocedure('public.mon_cron_frozen_jobs()') is null
     or to_regprocedure('public.mon_detect_rent_tiny_gate_reverted()') is null
     or to_regprocedure('public.mon_detect_url_collisions_res_vs_com()') is null
     or to_regclass('public.ops_cron_job_first_seen') is null then
    raise exception 'monitoring-meta: an anchor object is missing; refusing to patch blind';
  end if;
  if position('percentile_cont' in pg_get_functiondef('public.mon_cron_frozen_jobs()'::regprocedure)) = 0
     or position('iv.med_s * 4' in pg_get_functiondef('public.mon_cron_frozen_jobs()'::regprocedure)) = 0 then
    raise exception 'monitoring-meta: mon_cron_frozen_jobs is not the version this patch was written against';
  end if;
  if position('mon_selftest_rent_tiny_gate' in pg_get_functiondef('public.mon_detect_rent_tiny_gate_reverted()'::regprocedure)) = 0 then
    raise exception 'monitoring-meta: mon_detect_rent_tiny_gate_reverted changed under us';
  end if;
  if position('url_collision_res_vs_com:' in pg_get_functiondef('public.mon_detect_url_collisions_res_vs_com()'::regprocedure)) = 0 then
    raise exception 'monitoring-meta: mon_detect_url_collisions_res_vs_com changed under us';
  end if;
end
$guard$;

-- The longest gap, in seconds, between consecutive firings of an hourly-cycle schedule
-- ("<minutes> * * * *"). NULL when the schedule is anything else or cannot be parsed exactly: the
-- caller then falls back to the observed cadence alone (old behaviour), never to a guess.
create or replace function public.mon_cron_max_gap_s(p_schedule text)
returns integer
language plpgsql
immutable
set search_path to 'public'
as $function$
declare
  v_parts text[];
  v_min   text;
  v_item  text;
  v_base  text;
  v_start int;
  v_end   int;
  v_step  int;
  v_hits  int[] := '{}';
  v_gap   int := 0;
  m       int;
  i       int;
begin
  if p_schedule is null then return null; end if;
  v_parts := regexp_split_to_array(btrim(p_schedule), '\s+');
  if array_length(v_parts, 1) <> 5
     or v_parts[2] <> '*' or v_parts[3] <> '*' or v_parts[4] <> '*' or v_parts[5] <> '*' then
    return null;
  end if;
  v_min := v_parts[1];
  if v_min !~ '^(\*|[0-9]+)(-[0-9]+)?(/[0-9]+)?(,(\*|[0-9]+)(-[0-9]+)?(/[0-9]+)?)*$' then
    return null;
  end if;

  for m in 0..59 loop
    foreach v_item in array string_to_array(v_min, ',') loop
      v_base := split_part(v_item, '/', 1);
      v_step := case when position('/' in v_item) > 0
                     then nullif(split_part(v_item, '/', 2), '')::int else 1 end;
      if v_step is null or v_step < 1 then return null; end if;
      if v_base = '*' then
        v_start := 0; v_end := 59;
      elsif position('-' in v_base) > 0 then
        v_start := split_part(v_base, '-', 1)::int;
        v_end   := split_part(v_base, '-', 2)::int;
      else
        v_start := v_base::int;
        v_end   := case when position('/' in v_item) > 0 then 59 else v_start end;
      end if;
      if v_start between 0 and 59 and v_end between 0 and 59 and v_start <= v_end
         and m between v_start and v_end and (m - v_start) % v_step = 0 then
        v_hits := v_hits || m;
        exit;
      end if;
    end loop;
  end loop;

  if coalesce(array_length(v_hits, 1), 0) = 0 then return null; end if;
  -- the wrap-around gap: last firing of the hour to the first firing of the next hour
  v_gap := v_hits[1] + 60 - v_hits[array_length(v_hits, 1)];
  for i in 2..coalesce(array_length(v_hits, 1), 1) loop
    v_gap := greatest(v_gap, v_hits[i] - v_hits[i - 1]);
  end loop;
  return v_gap * 60;
end
$function$;

create or replace function public.mon_cron_frozen_jobs()
returns table(jobid bigint, jobname text, median_interval_s double precision, runs_observed bigint,
              last_start timestamp with time zone, overdue_factor numeric)
language sql
stable
set search_path to 'public'
as $function$
  -- 2026-11-04: the cadence is read only from runs made under the CURRENT schedule. A job whose
  -- schedule changed is judged by what it has done since, never by the cadence it used to have.
  with since as (
    select j.jobid,
           greatest(now() - interval '7 days', coalesce(fs.schedule_changed_at, '-infinity'::timestamptz)) as t0,
           public.mon_cron_max_gap_s(j.schedule) as max_gap_s
      from cron.job j
      left join public.ops_cron_job_first_seen fs on fs.jobid = j.jobid
     where j.active
  ), hist as (
    select d.jobid, d.start_time,
           lag(d.start_time) over (partition by d.jobid order by d.start_time) as prev
      from cron.job_run_details d
      join since s on s.jobid = d.jobid
     where d.start_time > s.t0
  ), iv as (
    select h.jobid,
           percentile_cont(0.5) within group (order by extract(epoch from (h.start_time - h.prev)))
             as med_s,
           count(*) as n
      from hist h
     where h.prev is not null
     group by h.jobid
  ), last_run as (
    select d.jobid, max(d.start_time) as last_start
      from cron.job_run_details d
     group by d.jobid
  ), judged as (
    select j.jobid, j.jobname, iv.med_s, iv.n, lr.last_start,
           -- The overdue line: four observed periods, and never shorter than the schedule's own
           -- longest honest gap plus three periods. For a regular schedule max_gap = period, so the
           -- line is exactly 4 x period, as before.
           greatest(iv.med_s * 4, coalesce(s.max_gap_s + iv.med_s * 3, 0)) as line_s
      from cron.job j
      join since s on s.jobid = j.jobid
      join iv on iv.jobid = j.jobid
      join last_run lr on lr.jobid = j.jobid
     where j.active
  )
  select g.jobid, g.jobname, g.med_s, g.n, g.last_start,
         round((extract(epoch from (now() - g.last_start)) / nullif(g.med_s, 0))::numeric, 1)
    from judged g
   where g.med_s <= 5400   -- frequent enough to judge; 5400 s covers hourly jobs
     and g.n >= 10         -- a long, regular history under THIS schedule
     and g.last_start < now() - (g.line_s || ' seconds')::interval
$function$;

create or replace function public.mon_detect_rent_tiny_gate_reverted()
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v text;
begin
  v := public.mon_selftest_rent_tiny_gate();
  if v <> 'PASS' then
    perform public.mon_raise('P2', 'monitor_integrity', 'fleet', 'rent_tiny_gate_reverted',
      jsonb_build_object('selftest', v,
        'means', 'mon_check_run_field_ranges check (c) no longer distinguishes a period we CLAIM '
              || 'from a price the source published with no period; healthy platforms will be '
              || 'demoted to ok=False daily (gomenassat, 2026-09-21..23)'));
  else
    -- 2026-11-04: the selftest ran and PASSED, so the gate is intact: close the key it may have opened.
    perform public.mon_resolve_key('monitor_integrity', 'rent_tiny_gate_reverted');
  end if;
  return v;
end
$function$;

create or replace function public.mon_detect_url_collisions_res_vs_com()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  n int := 0;
  platform_rec record;
  v_res_table text;
  v_com_table text;
  v_res_exists boolean;
  v_com_exists boolean;
  v_collisions int;
  v_sample jsonb;
  v_row_pairs int;
  v_colliding text[] := '{}';
  v_routed record;
begin
  for platform_rec in
    select distinct platform
      from public.search_listings_ar
     where platform is not null and production_ready
     order by 1
  loop
    v_res_table := platform_rec.platform || '_residential_listings';
    v_com_table := platform_rec.platform || '_commercial_listings';
    select exists(select 1 from information_schema.tables
                   where table_schema = 'public' and table_name = v_res_table)
      into v_res_exists;
    select exists(select 1 from information_schema.tables
                   where table_schema = 'public' and table_name = v_com_table)
      into v_com_exists;

    if not (v_res_exists and v_com_exists) then continue; end if;

    if not exists (select 1 from information_schema.columns
                    where table_schema='public' and table_name=v_res_table
                      and column_name='listing_url')
       or not exists (select 1 from information_schema.columns
                    where table_schema='public' and table_name=v_com_table
                      and column_name='listing_url')
    then continue; end if;

    execute format($sql$
      with res as (
        select lower(r.listing_url) u
          from public.%I r
          join public.search_listings_ar sl on sl.platform = %L
             and sl.listing_id::text = r.id::text
             and sl.source_table = %L
             and sl.production_ready
         where r.listing_url is not null and btrim(r.listing_url) <> ''
      ), com as (
        select lower(c.listing_url) u
          from public.%I c
          join public.search_listings_ar sl on sl.platform = %L
             and sl.listing_id::text = c.id::text
             and sl.source_table = %L
             and sl.production_ready
         where c.listing_url is not null and btrim(c.listing_url) <> ''
      ), inter as (
        select u from res intersect select u from com
      )
      select count(*),
             coalesce((select jsonb_agg(u) from (select u from inter order by u limit 5) x),
                      '[]'::jsonb),
             count(*) * 2
        from inter
    $sql$,
      v_res_table, platform_rec.platform, v_res_table,
      v_com_table, platform_rec.platform, v_com_table)
      into v_collisions, v_sample, v_row_pairs;

    if v_collisions > 0 then
      v_colliding := v_colliding || platform_rec.platform::text;
      n := n + public.mon_raise(
        'P2', 'url_collision_res_vs_com', platform_rec.platform,
        'url_collision_res_vs_com:' || platform_rec.platform,
        jsonb_build_object(
          'platform', platform_rec.platform,
          'colliding_urls', v_collisions,
          'affected_prod_ready_rows_lower_bound', v_row_pairs,
          'sample_urls', v_sample,
          'why', 'Same source ad URL persisted as BOTH a production_ready residential row and a production_ready commercial row on this platform. The Normal Filter surfaces both rows as independent cards, so the user sees the SAME physical property twice (sometimes with disagreeing type_ar). Root cause is upstream ingestion. Repair belongs to Data Integrity: establish source truth before dropping either side.'
        ));
    else
      perform public.mon_resolve_key('url_collision_res_vs_com',
                                     'url_collision_res_vs_com:' || platform_rec.platform);
    end if;
  end loop;

  -- 2026-11-04: a hand-routed duplicate_card_surface_routed alert is a copy of this condition for the
  -- platforms it names. This sweep just re-measured every platform, so it is the copy's resolver: close
  -- it once none of the platforms it names still collides; hold it while any of them does.
  for v_routed in
    select a.dedup_key, a.detail::text as body
      from public.alert_event a
     where a.kind = 'duplicate_card_surface_routed' and a.resolved_at is null
  loop
    if not exists (select 1 from unnest(v_colliding) p
                    where v_routed.body ~* ('\m' || p || '\M')) then
      perform public.mon_resolve_key('duplicate_card_surface_routed', v_routed.dedup_key);
    end if;
  end loop;

  return n;
end $function$;
