-- THE DETECTOR THAT PROVES THE OTHER 176 ARE WIRED HAD NOTHING WATCHING IT (ops_incident #72).
--
-- AGENTS.md leans on one sentence: "mon_detect_orphaned_detectors() fires on any detector nothing
-- reaches, and a detector outside the roster is decoration." Every downstream claim of monitoring
-- coverage in this repo rests on that function still being able to fire. Twelve scripts/verify-*
-- files name it; every one of those mentions is a comment or a string literal. Nothing executed it,
-- and nothing had ever watched it go red -- the exact shape this repo calls a source-TEXT tripwire,
-- sitting on the meta-layer where it is most expensive.
--
-- It could not be executed against an injected orphan because DETECTION and RAISING were fused: the
-- only way to ask "would you notice this?" was to create a real unreachable function and let it
-- write a real alert. So this migration splits them, which is the same "extract the predicate as a
-- pure function so a proof can hand it a broken input" technique the TypeScript barriers use:
--
--   mon_orphaned_detectors(p_extra_candidates)  <- PURE. Decides. Writes nothing. Takes injected
--                                                  candidates through the SAME reachability filter.
--   mon_detect_orphaned_detectors()             <- unchanged contract. Raises. Now asks the above.
--   mon_detect_orphan_detector_is_blind()       <- NEW. Runs the predicate against an injected name
--                                                  that is reachable from nothing and asserts it is
--                                                  reported; and against a name that IS reachable
--                                                  and asserts it is NOT (so a predicate that
--                                                  flagged everything would fail too). Both
--                                                  directions, every half hour, no DDL, no writes.
--
-- The wrapper is produced by NEEDLE-EDITING the LIVE pg_get_functiondef() body, never by pasting a
-- remembered one -- the rule earned by four separate roster clobbers (see
-- scripts/verify-detector-roster-edits-are-guarded.ts). The roster entry is added the same way, in
-- this same migration, because "a detector outside the roster is decoration" applies hardest to a
-- detector whose whole job is enforcing that rule.

-- 1. THE PURE PREDICATE -- the live detector's own reachability test, verbatim, made injectable
create or replace function public.mon_orphaned_detectors(p_extra_candidates text[] default '{}')
returns text[]
language sql
stable
security definer
set search_path to 'public'
as $fn$
  with candidates as (
    -- Reachability, not intent: a mon_detect_* function must be called by mon_run_all_detectors or
    -- own a cron job (district_resolution/price_fidelity/wasalt_enrich_backlog each own one). This
    -- is the guard for the defect class itself -- a later create-or-replace rebuilding the sweep
    -- from a stale base is how mon_detect_unverified_inactivation went dark 8h after run #3 wired it.
    select p.proname as name
      from pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and p.proname like 'mon\_detect\_%'
       and p.proname <> 'mon_detect_orphaned_detectors'
    union
    -- Injected candidates are judged by exactly the same filter, which is what lets a self-test ask
    -- "would you notice an unreachable detector?" without creating one.
    select x from unnest(coalesce(p_extra_candidates, '{}'::text[])) x
  ),
  unreachable as (
    select c.name
      from candidates c
     where not exists (select 1 from pg_proc r
                        where r.pronamespace = 'public'::regnamespace
                          and r.proname = 'mon_run_all_detectors'
                          and position(c.name in pg_get_functiondef(r.oid)) > 0)
       and not exists (select 1 from cron.job j where position(c.name in j.command) > 0)
  ),
  af as (
    -- 2026-08-15: the mon_detect_% prefix rule cannot see the first-class AF barriers; each of
    -- these must own an active cron entry (they are not roster members by design).
    select m
      from unnest(array['mon_af_predicate_parity','mon_check_normal_filter_barrier',
                        'mon_check_filter_parity_legacy','mon_rich_attrs_barrier',
                        'mon_af_new_listing_readiness']) m
     where not exists (select 1 from cron.job j where j.active and position(m in j.command) > 0)
  )
  select coalesce((select array_agg(name order by name) from unreachable), '{}'::text[])
      || coalesce((select array_agg(m order by m) from af), '{}'::text[]);
$fn$;

-- Do not widen what anon can reach: this is an internal predicate, called by SECURITY DEFINER
-- functions owned by postgres, so revoking here changes nothing about how the detectors run.
revoke all on function public.mon_orphaned_detectors(text[]) from public;

-- 2. THE EXISTING DETECTOR NOW ASKS THE PREDICATE -- needle-edited from the LIVE body
do $mig$
declare def text; a int; b int;
  head_anchor constant text := '  -- Reachability, not intent:';
  tail_anchor constant text := 'where not exists (select 1 from cron.job j where j.active and position(m in j.command) > 0));';
begin
  select pg_get_functiondef(p.oid) into def
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.proname = 'mon_detect_orphaned_detectors';
  if def is null then
    raise exception 'mon_detect_orphaned_detectors() is missing -- refusing to invent one';
  end if;
  if position('public.mon_orphaned_detectors(' in def) > 0 then
    return; -- already needle-edited; this migration is idempotent
  end if;
  a := position(head_anchor in def);
  b := position(tail_anchor in def);
  if a = 0 or b = 0 or b <= a then
    raise exception 'needle anchors not found in the LIVE mon_detect_orphaned_detectors() -- refusing to full-body-replace it';
  end if;
  def := substr(def, 1, a - 1)
      || '  -- Detection lives in mon_orphaned_detectors() (2026-09-06, routine #10, ops_incident #72)' || chr(10)
      || '  -- so it can be EXECUTED against an injected candidate without writing an alert. Same' || chr(10)
      || '  -- predicate, moved verbatim: that function decides, this one raises.' || chr(10)
      || '  orphans := public.mon_orphaned_detectors();' || chr(10)
      || substr(def, b + length(tail_anchor));
  execute def;
end $mig$;

-- 3. THE SELF-TEST -- the guard on the guard
create or replace function public.mon_detect_orphan_detector_is_blind()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  n int := 0;
  -- A name no function, roster entry or cron command has ever carried. If the reachability test is
  -- working, injecting it MUST come back as an orphan.
  probe constant text := 'mon_detect_zz_unreachable_blindness_probe';
  reachable text;
  blind text[] := '{}';
begin
  -- POSITIVE: the thing it exists to notice.
  if not (probe = any (public.mon_orphaned_detectors(array[probe]))) then
    blind := blind || 'an injected detector reachable from NOTHING was not reported as orphaned';
  end if;

  -- NEGATIVE CONTROL: a predicate that reported everything would satisfy the positive half and be
  -- just as useless. Pick a detector the predicate currently considers reachable and assert that
  -- re-injecting it does NOT make it an orphan.
  select p.proname into reachable
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname like 'mon\_detect\_%'
     and p.proname <> 'mon_detect_orphaned_detectors'
     and not (p.proname = any (public.mon_orphaned_detectors()))
   order by p.proname
   limit 1;
  if reachable is null then
    blind := blind || 'no reachable detector exists to use as a negative control -- the roster is empty or every detector is orphaned';
  elsif reachable = any (public.mon_orphaned_detectors(array[reachable])) then
    blind := blind || format('a REACHABLE detector (%s) was reported as orphaned -- the predicate flags everything', reachable);
  end if;

  -- And the raising half must still be attached to the deciding half.
  if position('public.mon_orphaned_detectors(' in (
       select pg_get_functiondef(p.oid) from pg_proc p
        where p.pronamespace = 'public'::regnamespace and p.proname = 'mon_detect_orphaned_detectors')) = 0 then
    blind := blind || 'mon_detect_orphaned_detectors() no longer calls the predicate this self-test proves';
  end if;

  if cardinality(blind) > 0 then
    n := public.mon_raise('P1', 'blind_guard', 'all', 'blind_guard:mon_detect_orphaned_detectors',
      jsonb_build_object('blind', to_jsonb(blind),
        'why', 'mon_detect_orphaned_detectors() is the meta-detector every claim of monitoring coverage rests on; it can no longer distinguish an unreachable detector from a wired one',
        'owner', 'routine-10-barrier'));
  else
    perform public.mon_resolve('blind_guard', 'all');
  end if;
  return n;
end $fn$;

revoke all on function public.mon_detect_orphan_detector_is_blind() from public;

-- 4. ROSTER -- needle-edited, never rebuilt from a remembered body
do $mig$
declare def text;
  anchor constant text := '''mon_detect_orphaned_detectors''';
begin
  select pg_get_functiondef(p.oid) into def
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.proname = 'mon_run_all_detectors';
  if def is null then
    raise exception 'mon_run_all_detectors() is missing -- refusing to invent a roster';
  end if;
  if position('mon_detect_orphan_detector_is_blind' in def) > 0 then
    return; -- idempotent
  end if;
  if (length(def) - length(replace(def, anchor, ''))) / length(anchor) <> 1 then
    raise exception 'the roster anchor is not unique -- refusing to needle-edit blindly';
  end if;
  def := replace(def, anchor, anchor || ',' || chr(10) || '    ''mon_detect_orphan_detector_is_blind''');
  execute def;
end $mig$;