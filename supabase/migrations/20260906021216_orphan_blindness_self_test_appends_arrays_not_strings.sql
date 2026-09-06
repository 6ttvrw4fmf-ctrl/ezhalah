-- Caught by watching the mutation, minutes after the self-test landed: `blind := blind || '<text>'`
-- resolves to the array-from-string form of ||, so on the ONE path that matters -- the predicate
-- having gone blind -- the detector died with «malformed array literal» instead of raising P1. A
-- detector that crashes shows up in mon_run_all_detectors()'s `failed` list rather than as an alert,
-- so the finding would have arrived as "a detector is broken", not "the meta-detector is blind".
-- Appending array[...] is unambiguous. This is the whole reason a barrier is not finished until it
-- has been watched to go red.
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
    blind := blind || array['an injected detector reachable from NOTHING was not reported as orphaned'];
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
    blind := blind || array['no reachable detector exists to use as a negative control -- the roster is empty or every detector is orphaned'];
  elsif reachable = any (public.mon_orphaned_detectors(array[reachable])) then
    blind := blind || array[format('a REACHABLE detector (%s) was reported as orphaned -- the predicate flags everything', reachable)];
  end if;

  -- And the raising half must still be attached to the deciding half.
  if position('public.mon_orphaned_detectors(' in (
       select pg_get_functiondef(p.oid) from pg_proc p
        where p.pronamespace = 'public'::regnamespace and p.proname = 'mon_detect_orphaned_detectors')) = 0 then
    blind := blind || array['mon_detect_orphaned_detectors() no longer calls the predicate this self-test proves'];
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