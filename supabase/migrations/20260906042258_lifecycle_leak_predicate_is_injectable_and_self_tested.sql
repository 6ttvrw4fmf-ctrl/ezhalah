-- THE DETECTOR THAT WATCHES FOR DEAD LISTINGS STILL BEING SERVED HAS NEVER BEEN SEEN TO FIRE.
--
-- ops_incident #27 recorded exactly that, in its own words: "the new detector has never been
-- observed firing on a real breaker trip because the breaker has never tripped ... NOT resolvable:
-- no scripts/verify-*.ts barrier with a mutation proof exists yet, and incident_resolve rightly
-- refuses without one."
--
-- That is the shape AGENTS.md keeps warning about, sitting on the one detector that stands between
-- a source-confirmed-dead listing and a user still seeing it. `mon_detect_inactive_still_searchable`
-- is careful and well-written; nothing had ever watched it go red. A guard nobody has seen fail is a
-- comment that runs.
--
-- WHY IT COULD NOT BE PROVEN BEFORE. Detection and adjudication were fused inside a dynamic query
-- over live tables, so the only way to ask "would you notice a leak?" was to CREATE one — to
-- deactivate a real listing and leave it in search_listings_ar. That is a destructive experiment on
-- production inventory and it is not an acceptable way to test a guard.
--
-- So this migration splits them, the same technique 20260906021124 used for the orphan detector:
--
--   ops_lifecycle_row_is_leaked(...)              <- PURE, IMMUTABLE. Decides, from four facts.
--                                                    Takes injected facts through the SAME logic.
--   ops_lifecycle_inactive_still_searchable()     <- unchanged contract. Now ASKS the above rather
--                                                    than carrying its own copy of the rule, so the
--                                                    two cannot drift.
--   mon_detect_lifecycle_leak_detector_is_blind() <- NEW. Runs the predicate against an injected
--                                                    leak and asserts it is reported, and against
--                                                    four NEGATIVE controls (still active, present
--                                                    in the matview, deactivated inside the
--                                                    propagation window, and an undatable cycle)
--                                                    and asserts none of them is. Both directions,
--                                                    every half hour, no DDL, no writes, no listing
--                                                    touched.
--
-- THE NEGATIVE CONTROLS ARE THE HALF THAT MATTERS. A predicate that returned TRUE for everything
-- would satisfy the positive test and be worse than useless: it would raise a P1 naming healthy
-- inventory, and the standing advice on that alert is "do NOT respond by deleting listings" — an
-- alert that cries wolf about live listings is how a real leak gets ignored. In particular
-- `deactivated_at` INSIDE the propagation window must stay FALSE: that is ordinary latency between
-- the :00 matview refresh and the :14 sync, not a defect (docs/ops/LISTING_LIFECYCLE_ENGINEER.md
-- §2.3 — "that window is normal, and it is the thing this routine measures").

-- ── 1. THE PURE PREDICATE ────────────────────────────────────────────────────────────────────────
-- The live detector's own adjudication, verbatim, made injectable. Four facts decide it:
--   p_in_matview      is the row still in active_listing_ids_v2 (the aliveness gate)?
--   p_active          does its own source row still say active?
--   p_deactivated_at  when was it deactivated (NULL = a legacy row with no stamp)?
--   p_cutoff          the end of the last COMPLETE refresh+sync cycle (NULL = we cannot date one)
create or replace function public.ops_lifecycle_row_is_leaked(
  p_in_matview      boolean,
  p_active          boolean,
  p_deactivated_at  timestamptz,
  p_cutoff          timestamptz
) returns boolean
language sql
immutable
as $fn$
  select
      -- We cannot date a complete propagation cycle, so nothing here is adjudicable. The caller's
      -- staleness guard reports that blindness; it must never be reported as "clean".
      p_cutoff is not null
      -- Absent from the aliveness matview. `is not true` deliberately, so a NULL from a LEFT JOIN
      -- (the row simply is not there) counts as absent.
  and p_in_matview is not true
      -- Its own source row is not active. Same `is not true`: NULL is not a claim of life.
  and p_active is not true
      -- And a COMPLETE refresh+sync cycle has run since it was deactivated, so the pipeline has
      -- already had its chance to remove it. Anything more recent is ordinary propagation latency.
  and (p_deactivated_at is null or p_deactivated_at < p_cutoff);
$fn$;

comment on function public.ops_lifecycle_row_is_leaked(boolean, boolean, timestamptz, timestamptz) is
  'Pure adjudication for inactive_still_searchable. Extracted so mon_detect_lifecycle_leak_detector_is_blind() can execute it against injected facts without deactivating a real listing. ops_lifecycle_inactive_still_searchable() calls THIS — never a copy.';

-- ── 2. THE CANDIDATE GENERATOR NOW ASKS THE PREDICATE ────────────────────────────────────────────
-- Body is otherwise byte-for-byte the live one; only the WHERE clause changes, from an inline copy
-- of the rule to a call. That is the point: a future edit to the rule cannot leave the self-test
-- proving something the detector no longer does.
create or replace function public.ops_lifecycle_inactive_still_searchable()
returns table(source_table text, listing_id bigint, deactivated_at timestamptz,
              city_id integer, deal_ar text)
language plpgsql
stable
security definer
set search_path to 'public'
as $fn$
declare
  v_cut timestamptz;
  r     record;
begin
  v_cut := public.ops_lifecycle_propagation_cutoff();
  if v_cut is null then
    return;  -- cannot date a full cycle; the caller's staleness guard reports the blindness
  end if;

  for r in
    select distinct s.source_table as st
      from public.search_listings_ar s
      left join public.active_listing_ids_v2 m
        on m.source_table = s.source_table and m.listing_id = s.listing_id
     where m.listing_id is null
  loop
    -- A served table with no `active` column cannot be adjudicated here; skip rather than
    -- crash the sweep. (No such table exists today; this is defence, not a known case.)
    if not exists (select 1 from information_schema.columns c
                    where c.table_schema = 'public' and c.table_name = r.st
                      and c.column_name = 'active') then
      continue;
    end if;

    return query execute format($q$
      select %1$L::text, s.listing_id, t.deactivated_at, s.city_id, s.deal_ar
        from public.search_listings_ar s
        left join public.active_listing_ids_v2 m
          on m.source_table = s.source_table and m.listing_id = s.listing_id
        join public.%1$I t on t.id = s.listing_id
       where s.source_table = %1$L
         and public.ops_lifecycle_row_is_leaked(
               m.listing_id is not null, t.active, t.deactivated_at, %2$L::timestamptz)
    $q$, r.st, v_cut);
  end loop;
end;
$fn$;

-- ── 3. THE SELF-TEST ─────────────────────────────────────────────────────────────────────────────
create or replace function public.mon_detect_lifecycle_leak_detector_is_blind()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  n     int := 0;
  blind text[] := '{}';
  cut   constant timestamptz := timestamptz '2026-01-10 00:00:00+00';
  old   constant timestamptz := timestamptz '2026-01-01 00:00:00+00';  -- before the cutoff
  fresh constant timestamptz := timestamptz '2026-01-10 00:05:00+00';  -- inside the window
begin
  -- POSITIVE: the thing it exists to notice. Absent from the matview, inactive at source, and
  -- deactivated before a complete refresh+sync cycle finished.
  if not public.ops_lifecycle_row_is_leaked(false, false, old, cut) then
    blind := blind || 'a genuine leak (absent from the matview, inactive, deactivated before a complete cycle) was NOT reported';
  end if;
  -- A legacy row with no deactivated_at stamp is still a leak.
  if not public.ops_lifecycle_row_is_leaked(false, null, null, cut) then
    blind := blind || 'a leaked row with a NULL deactivated_at was NOT reported';
  end if;

  -- NEGATIVE CONTROLS. A predicate that answered TRUE to everything would pass the positive half
  -- and raise P1 alerts naming healthy inventory, which is how a real leak learns to be ignored.
  if public.ops_lifecycle_row_is_leaked(false, true, null, cut) then
    blind := blind || 'a row that is still ACTIVE at source was reported as leaked';
  end if;
  if public.ops_lifecycle_row_is_leaked(true, false, old, cut) then
    blind := blind || 'a row still present in active_listing_ids_v2 was reported as leaked';
  end if;
  if public.ops_lifecycle_row_is_leaked(false, false, fresh, cut) then
    blind := blind || 'ordinary propagation latency (deactivated INSIDE the refresh+sync window) was reported as a leak';
  end if;
  if public.ops_lifecycle_row_is_leaked(false, false, old, null) then
    blind := blind || 'a row was adjudicated as leaked while no complete cycle could be dated (must be blind, not clean)';
  end if;

  -- And the deciding half must still be attached to the generating half.
  if position('ops_lifecycle_row_is_leaked(' in coalesce((
       select pg_get_functiondef(p.oid) from pg_proc p
        where p.pronamespace = 'public'::regnamespace
          and p.proname = 'ops_lifecycle_inactive_still_searchable'), '')) = 0 then
    blind := blind || 'ops_lifecycle_inactive_still_searchable() no longer calls the predicate this self-test proves';
  end if;
  -- ...and the alerting half must still be attached to the generating half.
  if position('ops_lifecycle_inactive_still_searchable' in coalesce((
       select pg_get_functiondef(p.oid) from pg_proc p
        where p.pronamespace = 'public'::regnamespace
          and p.proname = 'mon_detect_inactive_still_searchable'), '')) = 0 then
    blind := blind || 'mon_detect_inactive_still_searchable() no longer reads the candidate generator';
  end if;

  if cardinality(blind) > 0 then
    n := public.mon_raise('P1', 'blind_guard', 'search',
      'blind_guard:mon_detect_inactive_still_searchable',
      jsonb_build_object('blind', to_jsonb(blind),
        'why', 'mon_detect_inactive_still_searchable() is the guard standing between a '
            || 'source-confirmed-dead listing and a user still seeing it. It can no longer tell a '
            || 'genuine leak from healthy inventory or from ordinary propagation latency.',
        'action', 'Repair the predicate. Do NOT deactivate or delete any listing in response to '
            || 'this alert — it is a statement about the DETECTOR, not about inventory.',
        'owner', 'routine-11-lifecycle'));
  else
    -- Resolve THIS key only. mon_resolve(kind, platform) would clear every blind_guard alert on
    -- the 'search' platform, including one raised by a different guard that is still genuinely blind.
    perform public.mon_resolve_key('blind_guard', 'blind_guard:mon_detect_inactive_still_searchable');
  end if;
  return n;
end $fn$;

revoke all on function public.mon_detect_lifecycle_leak_detector_is_blind() from public;

-- ── 4. ROSTER — needle-edited, never rebuilt from a remembered body ──────────────────────────────
-- "A detector outside the roster is decoration" (AGENTS.md), and that applies hardest to a detector
-- whose whole job is proving another detector can still see.
do $mig$
declare def text;
  anchor constant text := '''mon_detect_inactive_still_searchable''';
begin
  select pg_get_functiondef(p.oid) into def
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.proname = 'mon_run_all_detectors';
  if def is null then
    raise exception 'mon_run_all_detectors() is missing -- refusing to invent a roster';
  end if;
  if position('mon_detect_lifecycle_leak_detector_is_blind' in def) > 0 then
    return; -- idempotent
  end if;
  if (length(def) - length(replace(def, anchor, ''))) / length(anchor) <> 1 then
    raise exception 'the roster anchor is not unique -- refusing to needle-edit blindly';
  end if;
  def := replace(def, anchor,
                 anchor || ',' || chr(10) || '    ''mon_detect_lifecycle_leak_detector_is_blind''');
  execute def;
end $mig$;

-- ── 5. PROVE IT, HERE, AT APPLY TIME ─────────────────────────────────────────────────────────────
-- A migration that installs a self-test and does not run it is asking to be trusted.
do $chk$
declare v int;
begin
  select public.mon_detect_lifecycle_leak_detector_is_blind() into v;
  if v <> 0 then
    raise exception 'the lifecycle leak predicate is blind on the version this migration just installed';
  end if;
  if not exists (select 1 from pg_proc p
                  where p.pronamespace = 'public'::regnamespace
                    and p.proname = 'mon_run_all_detectors'
                    and position('mon_detect_lifecycle_leak_detector_is_blind' in pg_get_functiondef(p.oid)) > 0) then
    raise exception 'the self-test did not make it into the roster';
  end if;
end $chk$;
