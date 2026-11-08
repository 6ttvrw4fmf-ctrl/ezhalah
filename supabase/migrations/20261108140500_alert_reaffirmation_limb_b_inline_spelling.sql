-- 🔧 2026-11-08: mon_detect_alert_reaffirmation() LIMB B learns the inline raise-once spelling (backlog 1339, second half).
-- Prepared 2026-11-04 PM on branch fix/detectors-inline-guard-reaffirm (docs/ops/owner-apply/2026-11-04-detectors-reaffirm)
-- and never applied: LIMB A's scratch cleanup carries DELETE text, which the Supabase connector holds for a human.
-- Applied through apply-migration.yml instead (owner 2026-11-04: «database changes without the question»).
-- The four detectors themselves were fixed in place by the «raise_once_detectors_reaffirm» migration of the same morning (the guard → else).
-- The production watcher had the same blind spot: LIMB B searched only for the literal «elsif not v_open then»
-- and so never saw the inline «elsif not exists (select 1 from public.alert_event … resolved_at is null) then»
-- spelling the four detectors above used. LIMB B now matches both spellings; LIMB A is unchanged.
create or replace function public.mon_detect_alert_reaffirmation()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  c_key    constant text := 'alert_reaffirmation_selftest';
  fails    jsonb := '[]'::jsonb;
  n        int := 0;
  r1 int; r2 int; r3 int;
  v_detail jsonb; v_affirmed timestamptz; v_open_rows int;
  v_guarded text[];
begin
  ---------------------------------------------------------------------------------------------
  -- LIMB A — the round trip, executed.
  ---------------------------------------------------------------------------------------------
  delete from public.alert_event where dedup_key = c_key;   -- clean slate; scratch key only

  begin
    r1 := public.mon_raise('P3','alert_reaffirmation_selftest', null, c_key,
            jsonb_build_object('probe', 1));
    r2 := public.mon_raise('P3','alert_reaffirmation_selftest', null, c_key,
            jsonb_build_object('probe', 2));

    select detail, last_affirmed_at, count(*) over ()
      into v_detail, v_affirmed, v_open_rows
      from public.alert_event where dedup_key = c_key and resolved_at is null limit 1;

    if r1 <> 1 then
      fails := fails || jsonb_build_object('case','first_raise_inserts','expected',1,'got',r1);
    end if;
    if r2 <> 0 then
      fails := fails || jsonb_build_object('case','second_raise_dedups_to_zero','expected',0,'got',r2);
    end if;
    if coalesce(v_open_rows, 0) <> 1 then
      fails := fails || jsonb_build_object('case','exactly_one_open_row_per_dedup_key',
        'expected',1,'got', coalesce(v_open_rows,0));
    end if;
    -- The half the five guarded detectors were losing: the payload must be TODAY's.
    if coalesce(v_detail->>'probe','') <> '2' then
      fails := fails || jsonb_build_object('case','re_raise_refreshes_detail',
        'expected','probe=2','got', coalesce(v_detail::text,'<no row>'));
    end if;
    -- ...and the column that lets a reader tell "still standing behind this" from "raised once".
    if v_affirmed is null then
      fails := fails || jsonb_build_object('case','re_raise_stamps_last_affirmed_at',
        'expected','not null','got','null');
    end if;

    -- Resolve must RELEASE the key, or a recurrence raises nothing for ever.
    perform public.mon_resolve_key('alert_reaffirmation_selftest', c_key);
    r3 := public.mon_raise('P3','alert_reaffirmation_selftest', null, c_key,
            jsonb_build_object('probe', 3));
    if r3 <> 1 then
      fails := fails || jsonb_build_object('case','resolved_key_can_raise_again',
        'expected',1,'got',r3,
        'why','a resolved dedup key that still suppresses is worse than one that never resolved');
    end if;
  exception when others then
    fails := fails || jsonb_build_object('case','round_trip_threw','error', sqlerrm);
  end;

  delete from public.alert_event where dedup_key = c_key;   -- always clean up the scratch rows

  ---------------------------------------------------------------------------------------------
  -- LIMB B — the shape that loses LIMB A's guarantees, in any roster-reachable detector.
  -- Two spellings (2026-11-04): the v_open variable, and the inline not-exists subquery.
  ---------------------------------------------------------------------------------------------
  select coalesce(array_agg(p.proname order by p.proname), '{}')
    into v_guarded
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname like 'mon\_detect\_%'
     and p.proname <> 'mon_detect_alert_reaffirmation'          -- this function names the pattern
     and (position('elsif not v_open then' in pg_get_functiondef(p.oid)) > 0
          or pg_get_functiondef(p.oid) ~* '(if|elsif)\s+not\s+exists\s*\(\s*select\s+1\s+from\s+(public\.)?alert_event\M[^;]*?resolved_at\s+is\s+null\s*\)\s*then[^;]*?\mmon_raise\s*\(')
     -- ...unless it also carries an unguarded else-arm that re-raises anyway, which is what
     -- mon_detect_zero_price_served does and is a correct (if roundabout) implementation.
     and position(E'  else\n    n := n + public.mon_raise' in pg_get_functiondef(p.oid)) = 0;

  if cardinality(v_guarded) > 0 then
    fails := fails || jsonb_build_object('case','raise_guarded_by_alert_already_open',
      'detectors', to_jsonb(v_guarded),
      'why','these detectors skip mon_raise() entirely while their own alert is open, so the '
         || 'payload never refreshes, last_affirmed_at is never stamped, and severity can never '
         || 'escalate — mon_raise() already dedups correctly and calling it unconditionally is '
         || 'both simpler and strictly safer');
  end if;

  -- Both limbs have been evaluated by the time we get here, so raise and resolve alike sit on a
  -- path that genuinely ran the condition.
  if jsonb_array_length(fails) = 0 then
    perform public.mon_resolve_key('alert_reaffirmation','alert_reaffirmation');
    return 0;
  end if;

  n := public.mon_raise('P1','alert_reaffirmation', 'monitoring', 'alert_reaffirmation',
    jsonb_build_object(
      'failures', fails,
      'why','An open alert is supposed to be re-affirmed by its detector on every sweep. That '
         || 'call is what refreshes the payload, stamps last_affirmed_at, and carries a worsening '
         || 'condition up to a higher severity with dispatch re-armed. Without it an alert is a '
         || 'claim about the day it was raised: production carried a P1 for 88 hours whose count '
         || 'was four days old and which nothing had re-checked.',
      'fix','Call mon_raise() unconditionally whenever the condition is true. It already keeps '
         || 'exactly one open row per dedup_key and already returns 0 for an open key, so nothing '
         || 'about alert volume or the sweep''s all-zero semantics changes. Do NOT fix this by '
         || 'hand-stamping last_affirmed_at or by deleting the open alert.'));
  return n;
end $function$;
