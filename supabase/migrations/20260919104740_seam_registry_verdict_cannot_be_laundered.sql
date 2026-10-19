-- ============================================================================
-- routine-7-seam, 2026-09-19.
--
-- THE SEAM: rotation-writer -> ops_repair_guarantee_registry truth.
--
-- ops_registry_verdict_is_earned() (shipped 2026-09-18) refuses to upgrade a
-- 'violated' entry to 'holds' without an 'evidence_recheck' key, because a
-- reachability probe answers "is something still watching this", NOT "does the
-- invariant still hold". That rule is right and it works for a DIRECT hop.
--
-- MEASURED HOLE, 2026-09-19, executed against production in a rolled-back
-- transaction on entry 20260721104637:
--     T1 violated -> holds            (no evidence)  REFUSED   ok
--     T2 violated -> holds            (evidence)     ALLOWED   ok
--     T3 violated -> detector_missing                ALLOWED   ok
--     T4 violated -> undetermined -> holds (no evidence anywhere)  ALLOWED  <-- HOLE
--
-- The guard keys on old.last_verdict = 'violated', a single-step test on
-- mutable current state. ANY intermediate verdict resets it, so the violation
-- launders in two hops with no evidence at all. This is not theoretical:
-- 'undetermined' is a verdict the rotation genuinely writes (the Al-Ahsa pair
-- 20260720171946 / 20260720172500 sit there now), and the registry's own
-- last_detail records the SAME accident happening twice by the direct route --
-- 2026-09-13 and again 2026-09-18 at 13:17:17Z -- each time caught only because
-- a later reader noticed and hand-restored the verdict.
--
-- THE FIX: make the guard depend on the row's HISTORY, not on its
-- immediately-previous value. A sticky marker (unearned_since) is set when a row
-- enters 'violated' and survives every intermediate verdict; it is cleared ONLY
-- by a transition to holds/clean/ok that carries 'evidence_recheck'. An N-hop
-- path is then no different from a 1-hop path.
--
-- Downgrades stay freely allowed. A genuine evidence-based clear stays allowed.
-- Nothing here weakens the existing guard; it closes a bypass around it.
--
-- RESIDUAL, STATED NOT CLOSED: a DELETE + re-INSERT at 'holds' still bypasses
-- this, because the marker lives on the row. Closing that needs an append-only
-- audit of verdict transitions, which is a bigger change than this defect
-- warrants today. mon_detect_registry_verdict_guard() LIMB 1 below at least
-- makes the trigger's own removal loud.
-- ============================================================================

alter table public.ops_repair_guarantee_registry
  add column if not exists unearned_since timestamptz;

comment on column public.ops_repair_guarantee_registry.unearned_since is
  'Set when the entry enters last_verdict=''violated''; survives intermediate verdicts; '
  'cleared only by a transition to holds/clean/ok carrying an evidence_recheck key. '
  'Non-null while a violation is open and unearned. See ops_registry_verdict_is_earned().';

-- Backfill: every entry currently sitting at 'violated' has an OPEN, unearned
-- violation as of now. Without this the four live violations would be launderable
-- once each, which is the exact bug.
update public.ops_repair_guarantee_registry
   set unearned_since = coalesce(unearned_since, last_verified_at, now())
 where last_verdict = 'violated';

create or replace function public.ops_registry_verdict_is_earned()
returns trigger
language plpgsql
as $function$
declare
  has_ev boolean := coalesce((new.last_detail ? 'evidence_recheck'), false);
  marker timestamptz;
begin
  -- The open-violation marker carried in from the previous state. The
  -- old.last_verdict = 'violated' arm keeps this correct for rows written
  -- before unearned_since existed.
  if tg_op = 'UPDATE' then
    marker := old.unearned_since;
    if old.last_verdict = 'violated' then
      marker := coalesce(marker, old.last_verified_at, now());
    end if;
  end if;

  -- Entering (or staying in) violation: open or keep the marker.
  if new.last_verdict = 'violated' then
    new.unearned_since := coalesce(marker, new.last_verified_at, now());
    return new;
  end if;

  -- Claiming the invariant is good again.
  if new.last_verdict in ('holds', 'clean', 'ok') then
    if marker is not null and not has_ev then
      raise exception using
        errcode = 'check_violation',
        message = format(
          'ops_repair_guarantee_registry: refusing to upgrade %s to %s -- an open violation from %s has never been earned back',
          new.repair_version, new.last_verdict, marker),
        detail  = 'A detector returning 0 proves the DETECTOR is green, not that the INVARIANT holds. '
               || 'The standing counter-example is aqarmonthly 20260721104637 / 20260823145919: raw '
               || 'clean, index clean, detector 0, and hundreds of rows still glued in the shadow layer '
               || 'listings_arabic_locations that no limb watches. This check follows the row''s HISTORY, '
               || 'so routing through an intermediate verdict (undetermined, detector_missing, ...) does '
               || 'not clear it -- that two-hop path was the measured bypass this replaces.',
        hint    = 'Downgrades are always allowed. To clear a violation, do the per-invariant data '
               || 're-check the verdict is about and record it: last_detail must contain an '
               || '"evidence_recheck" key describing what was re-measured against production.';
    end if;
    -- Earned back (or never violated).
    new.unearned_since := null;
    return new;
  end if;

  -- Any other verdict (undetermined, detector_missing, detector_error, ...):
  -- a downgrade or a holding pattern. Always allowed, and it MUST carry the
  -- marker forward -- preserving it here is the entire fix.
  new.unearned_since := marker;
  return new;
end
$function$;

drop trigger if exists trg_ops_registry_verdict_is_earned on public.ops_repair_guarantee_registry;
create trigger trg_ops_registry_verdict_is_earned
  before insert or update on public.ops_repair_guarantee_registry
  for each row execute function public.ops_registry_verdict_is_earned();

-- ---------------------------------------------------------------------------
-- Detector: the guard itself must stay present and must stay effective.
-- ---------------------------------------------------------------------------
create or replace function public.mon_detect_registry_verdict_guard()
returns integer
language plpgsql
as $function$
declare
  n int := 0;
  n_trig int;
  n_laundered int;
  detail_rows text;
begin
  -- LIMB 1: the trigger is gone or disabled. A guard that can be silently
  -- removed is the class this repo has been burned by most.
  select count(*) into n_trig
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace ns on ns.oid = c.relnamespace
   where ns.nspname = 'public'
     and c.relname = 'ops_repair_guarantee_registry'
     and t.tgname = 'trg_ops_registry_verdict_is_earned'
     and not t.tgisinternal
     and t.tgenabled <> 'D';

  if n_trig = 0 then
    n := n + public.mon_raise('P1', 'registry_verdict_guard', null,
      'registry_verdict_guard:trigger_missing',
      jsonb_build_object(
        'why', 'trg_ops_registry_verdict_is_earned is absent or disabled on '
            || 'ops_repair_guarantee_registry. Without it, an oldest-first rotation can overwrite an '
            || 'evidence-based ''violated'' verdict with ''holds'' -- which happened on 2026-09-13 and '
            || 'again on 2026-09-18, and is how a decayed guarantee reads green.',
        'action', 'Restore the trigger from the migration that created it. Do not work around it by '
               || 'writing verdicts with elevated privileges.'));
  else
    perform public.mon_resolve_key('registry_verdict_guard', 'registry_verdict_guard:trigger_missing');
  end if;

  -- LIMB 2: a row claiming the invariant holds while its violation marker is
  -- still open. The trigger makes this unreachable, so if it appears, something
  -- wrote around the trigger.
  select count(*), left(string_agg(repair_version || ' (' || last_verdict || ')', ', '
                                   order by repair_version), 600)
    into n_laundered, detail_rows
    from public.ops_repair_guarantee_registry
   where last_verdict in ('holds', 'clean', 'ok')
     and unearned_since is not null;

  if n_laundered > 0 then
    n := n + public.mon_raise('P1', 'registry_verdict_guard', null,
      'registry_verdict_guard:laundered_verdict',
      jsonb_build_object(
        'entries', n_laundered,
        'which', detail_rows,
        'why', 'These entries report the invariant HOLDS while carrying an unearned open violation. '
            || 'The trigger cannot produce this state, so the write bypassed it (a DELETE+re-INSERT, '
            || 'or a session that disabled the trigger).',
        'action', 'Re-do the per-invariant data re-check against production and either restore '
               || '''violated'', or record an evidence_recheck key describing what was measured.'));
  else
    perform public.mon_resolve_key('registry_verdict_guard', 'registry_verdict_guard:laundered_verdict');
  end if;

  return n;
end
$function$;

-- ---------------------------------------------------------------------------
-- APPLY-TIME SELF-TESTS. These EXECUTE the truth table against a synthetic row.
-- If any expectation fails the migration aborts and nothing is committed --
-- including the schema change above. A detector wired in on unproven logic is
-- decoration, which is precisely what this whole area keeps rediscovering.
-- ---------------------------------------------------------------------------
do $selftest$
declare
  v text := '__seam_selftest_20260919__';
  probe jsonb := jsonb_build_object('method','detector exists + reachable','fn_exists',true,'reachable',true);
  ev    jsonb := jsonb_build_object('evidence_recheck','re-measured the shadow layer against production: 0 glued');
  fails text := '';
  marker_after timestamptz;
begin
  delete from public.ops_repair_guarantee_registry where repair_version = v;

  -- T1: direct violated -> holds, no evidence. MUST REFUSE.
  insert into public.ops_repair_guarantee_registry
    (repair_version, repair_name, invariant, detector, registered_at, registered_by,
     last_verified_at, last_verdict, last_detail)
  values (v, 'selftest', 'selftest invariant', null, now(), 'selftest', now(), 'violated', probe);
  begin
    update public.ops_repair_guarantee_registry set last_verdict='holds', last_detail=probe where repair_version=v;
    fails := fails || 'T1 (violated->holds, no evidence) was ALLOWED; ';
  exception when check_violation then null;
  end;

  -- T2: direct violated -> holds WITH evidence. MUST ALLOW, and must clear the marker.
  update public.ops_repair_guarantee_registry set last_verdict='violated', last_detail=probe where repair_version=v;
  begin
    update public.ops_repair_guarantee_registry set last_verdict='holds', last_detail=ev where repair_version=v;
    select unearned_since into marker_after from public.ops_repair_guarantee_registry where repair_version=v;
    if marker_after is not null then
      fails := fails || 'T2 allowed but left the marker open; ';
    end if;
  exception when check_violation then
    fails := fails || 'T2 (violated->holds WITH evidence) was REFUSED; ';
  end;

  -- T3: violated -> detector_missing (a downgrade). MUST ALLOW and MUST KEEP the marker.
  update public.ops_repair_guarantee_registry set last_verdict='violated', last_detail=probe where repair_version=v;
  begin
    update public.ops_repair_guarantee_registry set last_verdict='detector_missing', last_detail=probe where repair_version=v;
    select unearned_since into marker_after from public.ops_repair_guarantee_registry where repair_version=v;
    if marker_after is null then
      fails := fails || 'T3 downgrade dropped the marker (this is the bypass); ';
    end if;
  exception when check_violation then
    fails := fails || 'T3 (violated->detector_missing) was REFUSED; ';
  end;

  -- T4: THE MEASURED HOLE. violated -> undetermined -> holds, no evidence. MUST REFUSE.
  update public.ops_repair_guarantee_registry set last_verdict='violated', last_detail=probe where repair_version=v;
  begin
    update public.ops_repair_guarantee_registry set last_verdict='undetermined', last_detail=probe where repair_version=v;
    update public.ops_repair_guarantee_registry set last_verdict='holds', last_detail=probe where repair_version=v;
    fails := fails || 'T4 (violated->undetermined->holds) was ALLOWED -- the hole is still open; ';
  exception when check_violation then null;
  end;

  -- T5: a LONGER path must not launder either.
  update public.ops_repair_guarantee_registry set last_verdict='violated', last_detail=probe where repair_version=v;
  begin
    update public.ops_repair_guarantee_registry set last_verdict='undetermined', last_detail=probe where repair_version=v;
    update public.ops_repair_guarantee_registry set last_verdict='detector_missing', last_detail=probe where repair_version=v;
    update public.ops_repair_guarantee_registry set last_verdict='undetermined', last_detail=probe where repair_version=v;
    update public.ops_repair_guarantee_registry set last_verdict='holds', last_detail=probe where repair_version=v;
    fails := fails || 'T5 (4-hop laundering) was ALLOWED; ';
  exception when check_violation then null;
  end;

  -- T6: a multi-hop path that DOES supply evidence at the end MUST still be allowed.
  update public.ops_repair_guarantee_registry set last_verdict='violated', last_detail=probe where repair_version=v;
  begin
    update public.ops_repair_guarantee_registry set last_verdict='undetermined', last_detail=probe where repair_version=v;
    update public.ops_repair_guarantee_registry set last_verdict='holds', last_detail=ev where repair_version=v;
  exception when check_violation then
    fails := fails || 'T6 (multi-hop WITH evidence at the end) was REFUSED -- too strict; ';
  end;

  -- T7: an entry that was never violated can go to holds freely.
  update public.ops_repair_guarantee_registry
     set last_verdict='detector_missing', last_detail=probe, unearned_since=null where repair_version=v;
  begin
    update public.ops_repair_guarantee_registry set last_verdict='holds', last_detail=probe where repair_version=v;
  exception when check_violation then
    fails := fails || 'T7 (never-violated -> holds) was REFUSED -- too strict; ';
  end;

  delete from public.ops_repair_guarantee_registry where repair_version = v;

  -- T8: the detector must be callable and must read CLEAN right now (the trigger
  -- is installed and no laundered row exists).
  if public.mon_detect_registry_verdict_guard() <> 0 then
    fails := fails || 'T8 detector raised on a healthy installation; ';
  end if;

  if fails <> '' then
    raise exception 'ops_registry_verdict_is_earned self-tests FAILED: %', fails;
  end if;
end
$selftest$;

-- ---------------------------------------------------------------------------
-- Roster wiring, in the SAME migration. Needle-edited from the LIVE definition
-- so a concurrent session's roster changes are not silently dropped.
-- ---------------------------------------------------------------------------
do $roster$
declare
  src text;
  anchor text := '''mon_detect_cron_health'',';
begin
  select pg_get_functiondef(p.oid) into src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'mon_run_all_detectors';

  if src is null then
    raise exception 'mon_run_all_detectors not found -- refusing to guess a roster';
  end if;

  if position('mon_detect_registry_verdict_guard' in src) > 0 then
    return;  -- already on the roster
  end if;

  if (length(src) - length(replace(src, anchor, ''))) / length(anchor) <> 1 then
    raise exception 'roster anchor % is not unique -- refusing to needle-edit blindly', anchor;
  end if;

  src := replace(src, anchor, anchor || chr(10) || '    ''mon_detect_registry_verdict_guard'',');
  execute src;

  select pg_get_functiondef(p.oid) into src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'mon_run_all_detectors';
  if position('mon_detect_registry_verdict_guard' in src) = 0 then
    raise exception 'roster edit did not take';
  end if;
end
$roster$;
