-- IS EVERY WEBSITE ACTUALLY BEING CHECKED, AT THE RATE ITS OWN SLA REQUIRES?
-- Owner directive 2026-09-24: "Add monitoring/alarms so we know when any website falls behind its
-- expected checking schedule."
--
-- WHY NOTHING ALREADY ANSWERED THIS
-- ---------------------------------
-- `mon_detect_liveness_verification_sla` asks whether rows are VERIFIED inside their SLA — a
-- question about the inventory. This asks whether the CHECKER IS RUNNING FAST ENOUGH — a question
-- about the machine. They come apart exactly when it matters: a platform whose sweep re-probes the
-- same 1,500 rows every day is working hard, producing runs that report success, and covering
-- nothing. gathern did precisely that while 27,102 of its 28,639 listings were never looked at once.
--
-- It was unanswerable before today because a probe that returned DEAD or UNKNOWN moved no column at
-- all. `last_liveness_probe_at` (migration 20260924020545) records "we LOOKED at this row, whatever
-- we concluded", so "how many rows did this platform check in the last 24h" is now a real
-- measurement instead of an inference.
--
-- THE YARDSTICK IS THE PLATFORM'S OWN PROMISE, not a number invented here:
--     required_per_day = active_rows / (sla_hours / 24)
-- i.e. the rate at which a full pass finishes inside the SLA the platform itself declares. A
-- platform cannot fail this by being small or slow — only by promising a window it does not serve.
-- Raising an SLA to clear this alert would be the "lower a floor to go green" move that
-- LISTING_LIVENESS.md §7 forbids; the alert says so in its own payload.
--
-- AUTO-ENROLMENT: the cohort is "every platform with active inventory", computed from pg_tables on
-- every sweep. A website added next month is measured the first time it holds an active row, with
-- nobody enabling anything. That is the owner's "new websites must automatically use the same
-- checking system" requirement, on the monitoring side.
--
-- NOISE DISCIPLINE: 62 platforms are below target as this ships, so a per-platform alert would be
-- 62 alerts nobody reads — the surest way to make a real one invisible. Arm 1 raises ONE alert
-- carrying the whole table. Arm 2 is the page-worthy one and is per-platform: a checker that WAS
-- running and STOPPED (§9's expected-but-absent shape), which cannot be seen in a fleet total.

create or replace function public.ops_liveness_checking_shortfall(p_inject jsonb default '[]'::jsonb)
returns table(
  platform text, active_rows bigint, sla_hours int, probes_24h bigint, probes_7d bigint,
  required_per_day bigint, pct_of_required numeric, shape text, injected boolean)
language plpgsql
stable
security definer
set search_path to 'public'
as $fn$
declare
  r record;
  v_active bigint;
  v_24h    bigint;
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
    v_active := 0; v_24h := 0; v_7d := 0;
    declare t text; a bigint; b bigint; c2 bigint;
    begin
      foreach t in array r.tbls loop
        execute format(
          'select count(*) filter (where active),
                  count(*) filter (where active and last_liveness_probe_at > now() - interval ''24 hours''),
                  count(*) filter (where active and last_liveness_probe_at > now() - interval ''7 days'')
             from public.%I', t)
          into a, b, c2;
        v_active := v_active + coalesce(a, 0);
        v_24h    := v_24h + coalesce(b, 0);
        v_7d     := v_7d + coalesce(c2, 0);
      end loop;
    end;

    continue when v_active = 0;   -- nothing served, nothing owed

    select coalesce(max(p.sla_hours), 168) into v_sla
      from public.ops_liveness_registry p where p.platform = r.plat;
    if v_sla is null or v_sla <= 0 then v_sla := 168; end if;

    -- rows/day needed for a full pass to finish inside the platform's OWN declared SLA
    v_req := ceil(v_active / (v_sla / 24.0))::bigint;
    v_pct := round(100.0 * v_24h / nullif(v_req, 0), 1);

    v_shape := case
      when v_7d = 0  then 'NEVER_CHECKED'                -- nothing has looked at this platform at all
      when v_24h = 0 then 'STALLED'                      -- it was running and stopped
      when v_24h < v_req * 0.5 then 'BEHIND'             -- running at under half the needed rate
      else null
    end;

    continue when v_shape is null;

    platform := r.plat; active_rows := v_active; sla_hours := v_sla;
    probes_24h := v_24h; probes_7d := v_7d; required_per_day := v_req;
    pct_of_required := coalesce(v_pct, 0); shape := v_shape; injected := false;
    return next;
  end loop;
end
$fn$;

comment on function public.ops_liveness_checking_shortfall(jsonb) is
  'Every platform holding active inventory whose liveness CHECKER is not running fast enough to '
  'complete a pass inside the SLA that platform itself declares. NEVER_CHECKED / STALLED / BEHIND. '
  'Cohort is discovered from pg_tables, so a new website is measured automatically.';


create or replace function public.mon_detect_liveness_checking_shortfall()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  n int := 0;
  live text[] := '{}';
  r record;
  v_rows jsonb;
  v_pos int;
  v_neg int;
  v_gathern jsonb;
begin
  -- SELF-TEST, both directions, every sweep (the §2.5a precedent): a predicate that stops
  -- discriminating must say so rather than read as "nothing wrong".
  select count(*) into v_pos from public.ops_liveness_checking_shortfall(
    '[{"platform":"__selftest_stalled","active_rows":100,"sla_hours":24,"probes_24h":0,"probes_7d":50,"shape":"STALLED"}]'::jsonb)
   where injected and shape = 'STALLED';
  select count(*) into v_neg from public.ops_liveness_checking_shortfall('[]'::jsonb) where injected;

  if v_pos <> 1 or v_neg <> 0 then
    return public.mon_raise('P1', 'liveness_checking_predicate_blind', 'all',
      'liveness_checking_predicate_blind',
      jsonb_build_object('why', 'ops_liveness_checking_shortfall() stopped discriminating; its '
                              || 'silence no longer means anything',
                         'got_injected', v_pos, 'got_empty', v_neg));
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'platform', s.platform, 'shape', s.shape, 'active', s.active_rows,
           'sla_hours', s.sla_hours, 'checked_24h', s.probes_24h,
           'needed_per_day', s.required_per_day, 'pct_of_needed', s.pct_of_required)
         order by s.active_rows desc), '[]'::jsonb)
    into v_rows
    from public.ops_liveness_checking_shortfall() s where not s.injected;

  select to_jsonb(x) into v_gathern from (
    select s.platform, s.shape, s.active_rows, s.sla_hours, s.probes_24h,
           s.required_per_day, s.pct_of_required
      from public.ops_liveness_checking_shortfall() s
     where not s.injected and s.platform = 'gathern') x;

  -- ── ARM 1: one alert, whole fleet. 62 platforms are below target as this ships; 62 separate
  -- alerts would bury the one that matters.
  if jsonb_array_length(v_rows) > 0 then
    live := live || 'liveness_checking_shortfall:fleet';
    n := n + public.mon_raise('P1', 'liveness_checking_shortfall', 'all',
      'liveness_checking_shortfall:fleet',
      jsonb_build_object(
        'platforms_behind', jsonb_array_length(v_rows),
        'rows', v_rows,
        'gathern', coalesce(v_gathern, to_jsonb('gathern is NOT behind its schedule'::text)),
        'why', 'These websites are not re-checking their listings fast enough to complete one full '
            || 'pass inside the SLA they themselves declare. required_per_day = active / '
            || '(sla_hours/24). NEVER_CHECKED = nothing has ever looked at this platform. STALLED = '
            || 'it was being checked and stopped. BEHIND = running at under half the needed rate.',
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

  -- ── ARM 2: per-platform, and the page-worthy one. A checker that WAS running and STOPPED is
  -- invisible in a fleet total and is LISTING_LIVENESS.md §9's expected-but-absent shape: absence
  -- cannot be compared, so silence reads as health.
  for r in
    select * from public.ops_liveness_checking_shortfall()
     where not injected and shape = 'STALLED'
  loop
    live := live || ('liveness_checking_shortfall:' || r.platform);
    n := n + public.mon_raise('P1', 'liveness_checking_stalled', r.platform,
      'liveness_checking_shortfall:' || r.platform,
      jsonb_build_object(
        'active_rows', r.active_rows, 'sla_hours', r.sla_hours,
        'checked_last_24h', r.probes_24h, 'checked_last_7d', r.probes_7d,
        'needed_per_day', r.required_per_day,
        'why', 'This platform WAS having its listings checked within the last 7 days and has '
            || 'checked ZERO in the last 24h. A checker that stops produces no rows for anything to '
            || 'compare, so nothing else in the system notices — that is exactly how wasalt''s '
            || 'enumeration died for seven days while its workflow reported success every run.',
        'action', 'Find why this platform''s liveness job stopped running or stopped selecting '
            || 'rows. Check its workflow schedule, its last runs in scrape_runs, and whether its '
            || 'rotation is stuck behind rows it cannot resolve.',
        'do_not', 'A platform nothing has looked at is UNKNOWN, never dead. Do NOT deactivate or '
            || 'delete anything on account of this alert, and do NOT widen a kill to catch up.'));
  end loop;

  perform public.mon_resolve_stale_keys('liveness_checking_stalled',
    array(select 'liveness_checking_shortfall:' || s.platform
            from public.ops_liveness_checking_shortfall() s
           where not s.injected and s.shape = 'STALLED'));
  return n;
end
$fn$;

comment on function public.mon_detect_liveness_checking_shortfall() is
  'P1. Arm 1 (one fleet alert): every website not re-checking fast enough to finish a pass inside '
  'its own declared SLA, gathern always called out separately. Arm 2 (per-platform): a checker that '
  'WAS running and STOPPED. Cohort auto-discovered, so new websites are covered with no enabling.';

-- A detector nothing calls is decoration (mon_detect_orphaned_detectors fires on one), so the
-- roster entry lands in the SAME migration.
do $mig$
declare src text; before_len int;
begin
  select prosrc into src from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname = 'mon_run_all_detectors';
  if src is null then raise exception 'mon_run_all_detectors not found'; end if;
  if position('mon_detect_liveness_checking_shortfall' in src) > 0 then return; end if;

  before_len := length(src);
  src := replace(src,
    '''mon_detect_liveness_coverage_ramp''',
    '''mon_detect_liveness_checking_shortfall'',''mon_detect_liveness_coverage_ramp''');
  if length(src) = before_len then
    -- Fall back to a second anchor rather than silently leaving the detector orphaned.
    src := replace(src,
      '''mon_detect_liveness_verification_sla''',
      '''mon_detect_liveness_checking_shortfall'',''mon_detect_liveness_verification_sla''');
  end if;
  if length(src) = before_len then
    raise exception 'roster anchor not matched -- refusing to leave the detector orphaned';
  end if;

  execute format('create or replace function public.mon_run_all_detectors() returns jsonb language plpgsql as %L', src);
end $mig$;
