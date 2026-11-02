-- Bug #4: liveness_checking_stalled fired ~79 times a week.
-- Cause: STALLED meant "zero checks in the last 24h". Small sites are checked once a day as one
-- batch, ~24-25h apart. In the hour before each daily run the newest check is just over 24h old,
-- so ~18 healthy sites (nothing overdue) read STALLED, then cleared when the run landed. Daily flap.
-- Fix: measure in a window that fits a daily checker: least(sla_hours, 30h).
--   STALLED = zero checks in that window. BEHIND = rate in that window, scaled to per-day, < half of needed.
-- Real stalls stay caught (2026-10-30: wasalt 52h, moftah 71h, sakani 73h since last check).
-- This does NOT raise any sla_hours or lower any cap (LISTING_LIVENESS.md §7).

-- One pure place for the shape rule, so it can be self-tested every sweep.
create or replace function public.ops_liveness_shape(
  p_active bigint, p_sla_hours int, p_probes_window bigint, p_probes_7d bigint)
 returns text
 language sql
 immutable
as $function$
  select case
    when coalesce(p_active, 0) = 0 then null
    when coalesce(p_probes_7d, 0) = 0 then 'NEVER_CHECKED'       -- nothing has looked at this platform
    when coalesce(p_probes_window, 0) = 0 then 'STALLED'         -- it was running and stopped
    -- rate inside the window, scaled to per day, under half of what the SLA needs
    when p_probes_window * 24.0 / least(greatest(p_sla_hours, 1), 30)
         < ceil(p_active / (greatest(p_sla_hours, 1) / 24.0)) * 0.5 then 'BEHIND'
    else null
  end;
$function$;

create or replace function public.ops_liveness_stall_window_hours(p_sla_hours int)
 returns int language sql immutable
as $$ select least(greatest(coalesce(p_sla_hours, 168), 1), 30) $$;

create or replace function public.ops_liveness_checking_shortfall(p_inject jsonb DEFAULT '[]'::jsonb)
 returns table(platform text, active_rows bigint, sla_hours integer, probes_24h bigint, probes_7d bigint, required_per_day bigint, pct_of_required numeric, shape text, injected boolean)
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare
  r record;
  v_active bigint;
  v_24h    bigint;
  v_win    bigint;
  v_7d     bigint;
  v_sla    int;
  v_req    bigint;
  v_pct    numeric;
  v_shape  text;
begin
  -- Injected rows first, so the detector can self-test its own predicate without touching data.
  return query
    select x->>'platform',
           coalesce((x->>'active_rows')::bigint, 0),
           coalesce((x->>'sla_hours')::int, 168),
           coalesce((x->>'probes_24h')::bigint, 0),
           coalesce((x->>'probes_7d')::bigint, 0),
           coalesce((x->>'required_per_day')::bigint, 0),
           coalesce((x->>'pct_of_required')::numeric, 0),
           x->>'shape',
           true
      from jsonb_array_elements(coalesce(p_inject, '[]'::jsonb)) x
     where x->>'platform' is not null;

  for r in
    select regexp_replace(tablename, '_(residential|commercial)_listings$', '') as plat,
           array_agg(tablename order by tablename) as tbls
      from pg_tables
     where schemaname = 'public' and tablename ~ '_(residential|commercial)_listings$'
       and exists (select 1 from information_schema.columns c
                    where c.table_schema = 'public' and c.table_name = pg_tables.tablename
                      and c.column_name = 'last_liveness_probe_at')
     group by 1
  loop
    -- SOURCE_LIST_PRESENCE: the daily crawl of the site's own complete list IS the check (owner
    -- 2026-10-02). It stamps last_verified_alive_at, never last_liveness_probe_at, and is graded on
    -- its own 48 h window by mon_detect_liveness_verification_sla, not on a per-row probe rate.
    continue when exists (select 1 from public.ops_liveness_registry p
                           where p.platform = r.plat and p.strategy = 'SOURCE_LIST_PRESENCE');

    select coalesce(max(p.sla_hours), 168) into v_sla
      from public.ops_liveness_registry p where p.platform = r.plat;
    if v_sla is null or v_sla <= 0 then v_sla := 168; end if;

    v_active := 0; v_24h := 0; v_win := 0; v_7d := 0;
    declare t text; a bigint; b bigint; w bigint; c2 bigint;
    begin
      foreach t in array r.tbls loop
        execute format(
          'select count(*) filter (where active),
                  count(*) filter (where active and last_liveness_probe_at > now() - interval ''24 hours''),
                  count(*) filter (where active and last_liveness_probe_at > now() - make_interval(hours => %s)),
                  count(*) filter (where active and last_liveness_probe_at > now() - interval ''7 days'')
             from public.%I', public.ops_liveness_stall_window_hours(v_sla), t)
          into a, b, w, c2;
        v_active := v_active + coalesce(a, 0);
        v_24h    := v_24h + coalesce(b, 0);
        v_win    := v_win + coalesce(w, 0);
        v_7d     := v_7d + coalesce(c2, 0);
      end loop;
    end;

    continue when v_active = 0;   -- nothing served, nothing owed

    -- rows/day needed for a full pass to finish inside the platform's OWN declared SLA
    v_req := ceil(v_active / (v_sla / 24.0))::bigint;
    v_pct := round(100.0 * v_24h / nullif(v_req, 0), 1);

    -- Bug #4: shape is judged on the stall window (fits a once-a-day batch), not a bare 24h.
    v_shape := public.ops_liveness_shape(v_active, v_sla, v_win, v_7d);

    continue when v_shape is null;

    platform := r.plat; active_rows := v_active; sla_hours := v_sla;
    probes_24h := v_24h; probes_7d := v_7d; required_per_day := v_req;
    pct_of_required := coalesce(v_pct, 0); shape := v_shape; injected := false;
    return next;
  end loop;
end
$function$;

create or replace function public.mon_detect_liveness_checking_shortfall()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  n int := 0;
  live text[] := '{}';
  r record;
  v_rows jsonb;
  v_pos int;
  v_neg int;
  v_gathern jsonb;
  v_shape_ok boolean;
begin
  select count(*) into v_pos from public.ops_liveness_checking_shortfall(
    '[{"platform":"__selftest_stalled","active_rows":100,"sla_hours":24,"probes_24h":0,"probes_7d":50,"shape":"STALLED"}]'::jsonb)
   where injected and shape = 'STALLED';
  select count(*) into v_neg from public.ops_liveness_checking_shortfall('[]'::jsonb) where injected;

  -- Bug #4 barrier: the shape rule itself, on fixed cases.
  --   a daily batch whose newest check is 24.5h old (in window, nothing in 24h) is HEALTHY;
  --   a checker with nothing in its window is STALLED; never looked at is NEVER_CHECKED;
  --   a real slow checker is BEHIND.
  v_shape_ok :=
        public.ops_liveness_shape(285, 48, 285, 285) is null
    and public.ops_liveness_shape(2496, 168, 2496, 2496) is null
    and public.ops_liveness_shape(89378, 48, 0, 6721) = 'STALLED'
    and public.ops_liveness_shape(13, 48, 0, 13) = 'STALLED'
    and public.ops_liveness_shape(83, 168, 0, 0) = 'NEVER_CHECKED'
    and public.ops_liveness_shape(1000, 48, 10, 500) = 'BEHIND'
    and public.ops_liveness_stall_window_hours(48) = 30
    and public.ops_liveness_stall_window_hours(168) = 30
    and public.ops_liveness_stall_window_hours(12) = 12;

  if v_pos <> 1 or v_neg <> 0 or not v_shape_ok then
    return public.mon_raise('P1', 'liveness_checking_predicate_blind', 'all',
      'liveness_checking_predicate_blind',
      jsonb_build_object('why', 'ops_liveness_checking_shortfall() / ops_liveness_shape() stopped '
                              || 'discriminating; its silence (or its noise) no longer means anything',
                         'got_injected', v_pos, 'got_empty', v_neg, 'shape_rule_ok', v_shape_ok));
  end if;

  -- Dormant sites (source down at its own end, listings already out of search) are skipped (2026-10-30).
  select coalesce(jsonb_agg(jsonb_build_object(
           'platform', s.platform, 'shape', s.shape, 'active', s.active_rows,
           'sla_hours', s.sla_hours, 'checked_24h', s.probes_24h,
           'needed_per_day', s.required_per_day, 'pct_of_needed', s.pct_of_required)
         order by s.active_rows desc), '[]'::jsonb)
    into v_rows
    from public.ops_liveness_checking_shortfall() s
   where not s.injected and not public.ops_platform_is_dormant(s.platform);

  select to_jsonb(x) into v_gathern from (
    select s.platform, s.shape, s.active_rows, s.sla_hours, s.probes_24h,
           s.required_per_day, s.pct_of_required
      from public.ops_liveness_checking_shortfall() s
     where not s.injected and s.platform = 'gathern') x;

  if jsonb_array_length(v_rows) > 0 then
    -- ::text is load-bearing, see header.
    live := live || 'liveness_checking_shortfall:fleet'::text;
    n := n + public.mon_raise('P1', 'liveness_checking_shortfall', 'all',
      'liveness_checking_shortfall:fleet',
      jsonb_build_object(
        'platforms_behind', jsonb_array_length(v_rows),
        'rows', v_rows,
        'gathern', coalesce(v_gathern, to_jsonb('gathern is NOT behind its schedule'::text)),
        'why', 'These websites are not re-checking their listings fast enough to complete one full '
            || 'pass inside the SLA they themselves declare. required_per_day = active / '
            || '(sla_hours/24). NEVER_CHECKED = nothing has ever looked at this platform. STALLED = '
            || 'it was being checked and stopped (nothing in least(sla_hours, 30h)). BEHIND = running '
            || 'at under half the needed rate over that same window.',
        'do_not', 'Do NOT clear this by raising a platform''s sla_hours or by lowering a cap. That '
            || 'changes the promise instead of the checking, which LISTING_LIVENESS.md §7 forbids '
            || 'in terms. The fix is checking capacity or rotation fairness — see gathern, whose '
            || '0.4% was caused by a sweep re-probing the same 1,500 rows every run, not by '
            || 'throughput (migration 20260924020545, last_liveness_probe_at).',
        'note', 'last_liveness_probe_at starts NULL everywhere it was just added, so a platform '
            || 'reads NEVER_CHECKED until its checker runs once after 2026-09-24. Read this '
            || 'alert''s trend, not its first firing.'));
  else
    perform public.mon_resolve_stale_keys('liveness_checking_shortfall', '{}'::text[]);
  end if;

  for r in
    select * from public.ops_liveness_checking_shortfall() s
     where not s.injected and s.shape = 'STALLED' and not public.ops_platform_is_dormant(s.platform)
  loop
    live := live || ('liveness_checking_shortfall:' || r.platform)::text;
    n := n + public.mon_raise('P1', 'liveness_checking_stalled', r.platform,
      'liveness_checking_shortfall:' || r.platform,
      jsonb_build_object(
        'active_rows', r.active_rows, 'sla_hours', r.sla_hours,
        'checked_last_24h', r.probes_24h, 'checked_last_7d', r.probes_7d,
        'stall_window_hours', public.ops_liveness_stall_window_hours(r.sla_hours),
        'needed_per_day', r.required_per_day,
        'why', 'This platform WAS having its listings checked within the last 7 days and has '
            || 'checked ZERO inside its stall window (least(sla_hours, 30h) — wide enough for a '
            || 'once-a-day checker). A checker that stops produces no rows for anything to '
            || 'compare, so nothing else in the system notices — that is exactly how wasalt''s '
            || 'enumeration died for seven days while its workflow reported success every run.',
        'action', 'Find why this platform''s liveness job stopped running or stopped selecting '
            || 'rows. Check its workflow schedule, its last runs in scrape_runs, and whether its '
            || 'rotation is stuck behind rows it cannot resolve.',
        'do_not', 'A platform nothing has looked at is UNKNOWN, never dead. Do NOT deactivate or '
            || 'delete anything on account of this alert, and do NOT widen a kill to catch up.'));
  end loop;

  perform public.mon_resolve_stale_keys('liveness_checking_stalled',
    array(select ('liveness_checking_shortfall:' || s.platform)::text
            from public.ops_liveness_checking_shortfall() s
           where not s.injected and s.shape = 'STALLED' and not public.ops_platform_is_dormant(s.platform)));
  return n;
end
$function$;

-- Apply-time self-test: the barrier must hold, and the OLD rule (bare 24h) must be what it rejects.
do $$
begin
  if public.ops_liveness_shape(285, 48, 285, 285) is not null
     or public.ops_liveness_shape(89378, 48, 0, 6721) is distinct from 'STALLED'
     or public.ops_liveness_shape(83, 168, 0, 0) is distinct from 'NEVER_CHECKED'
     or public.ops_liveness_shape(1000, 48, 10, 500) is distinct from 'BEHIND' then
    raise exception 'bug #4 shape self-test FAILED';
  end if;
end $$;