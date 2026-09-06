-- An open alert that no detector has re-affirmed is a claim about four days ago.
--
-- `mon_raise()` documents its own contract in its body: an already-open dedup key must still be
-- re-raised every run, because that call is what REFRESHES `detail`, stamps `last_affirmed_at`
-- ("the ONLY writer of this column, ... which is what makes (last_affirmed_at > created_at) mean
-- 'a detector is still standing behind this alert'"), and — if the condition got worse — promotes
-- severity and re-arms dispatch and acknowledgement so the escalation actually reaches a human.
--
-- Five detectors never reach that call. They compute `v_open` themselves and then guard the raise
-- with `elsif not v_open then`, a hand-rolled dedup that duplicates what mon_raise() already does
-- correctly and defeats everything mon_raise() does BESIDES dedup:
--
--   mon_detect_cron_minute_collision
--   mon_detect_english_district_leak
--   mon_detect_impossible_price_size
--   mon_detect_price_eq_area_or_ppm
--   mon_detect_summary_only_capture
--
-- Measured on production, 2026-09-06:
--   alert 1288  price_eq_area_or_ppm   open since 2026-09-02 18:29 (88.5 h), last_affirmed_at NULL.
--               Its payload still reads "count": 1 — the count taken on 2026-09-02. The detector has
--               run ~177 times since and stamped nothing. Running it by hand returned 0 and changed
--               no row: not because the condition cleared (it has not — the alert is still open),
--               but because the guard skipped the call entirely.
--   summary_only_capture:aqaratikom  open 483.8 h, last_affirmed_at NULL, same shape.
--
-- So for these kinds you cannot tell "still true, same magnitude" from "raised once three weeks ago
-- and never re-checked", the dashboard shows a stale number, and a condition that worsened from one
-- row to five hundred — or from P2 to a genuine P1 — would never re-page, because the escalation
-- path lives inside the call the guard skips.
--
-- `mon_detect_zero_price_served` is the counter-example and the proof this is a legacy oversight
-- rather than a deliberate policy: it carries the same `elsif not v_open` arm AND an `else` arm that
-- re-raises with a shorter payload. It re-affirms correctly today and is deliberately left alone.
--
-- THE FIX REMOVES A SUPPRESSOR; IT ADDS NOTHING. `mon_raise()` still keeps exactly ONE open row per
-- dedup key, so this cannot produce alert spam, and it still returns 0 for an already-open key, so
-- every detector's return value — and therefore `mon_run_all_detectors()`'s all-zero-means-nothing-
-- NEW semantics — is completely unchanged. It only re-arms on genuine escalation, which is the
-- behaviour mon_raise() was written to provide.

do $needle$
declare
  d text;
  fn text;
  a_old constant text := E'  elsif not v_open then';
  a_new constant text := E'  else';
  targets constant text[] := array[
    'mon_detect_cron_minute_collision',
    'mon_detect_english_district_leak',
    'mon_detect_impossible_price_size',
    'mon_detect_price_eq_area_or_ppm',
    'mon_detect_summary_only_capture'];
begin
  foreach fn in array targets loop
    -- Built from the LIVE definition at execution time, never a body captured earlier: a concurrent
    -- session's edit to another part of the same detector must not be silently dropped.
    select pg_get_functiondef(p.oid) into d
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = fn;

    if d is null then
      raise exception '%() not found — refusing to guess at its body', fn;
    end if;

    if position(a_old in d) = 0 then
      continue;  -- idempotent: already re-affirms
    end if;

    if (length(d) - length(replace(d, a_old, ''))) / length(a_old) <> 1 then
      raise exception '%() has the guard more than once — refusing to edit blind', fn;
    end if;

    execute replace(d, a_old, a_new);
  end loop;
end $needle$;

-- ---------------------------------------------------------------------------------------------
-- Barrier.
--
-- LIMB A is EXECUTED: it drives a real alert through mon_raise() on a scratch dedup key and reads
-- back what actually happened to the row, rather than asserting anything about source text. It
-- therefore also pins the acknowledgment -> self-clear seam that SYSTEMS_SEAM_ENGINEER.md PART 1
-- requires proved end to end each run: raise -> re-raise (dedup holds, payload refreshes) ->
-- resolve -> raise again returns 1, i.e. the dedup key was genuinely RELEASED and a recurrence
-- can still reach a human. A stuck key that silently suppressed every future raise is how nine
-- dark detectors read as a clean bill of health on 2026-08-10.
--
-- LIMB B is a SHAPE rule, and is honestly labelled as one: it fails if any roster-reachable
-- detector re-introduces a raise guarded by "is my alert already open". It is deliberately the
-- SECOND limb — the executed limb above is what establishes that the guarded call is load-bearing;
-- this one just stops the specific regression from coming back unnoticed.
-- ---------------------------------------------------------------------------------------------
create or replace function public.mon_detect_alert_reaffirmation()
returns int
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
  ---------------------------------------------------------------------------------------------
  select coalesce(array_agg(p.proname order by p.proname), '{}')
    into v_guarded
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname like 'mon\_detect\_%'
     and p.proname <> 'mon_detect_alert_reaffirmation'          -- this function names the pattern
     and position('elsif not v_open then' in pg_get_functiondef(p.oid)) > 0
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

-- Roster, same migration. Rewritten from the definition read at execution time so a concurrent
-- session's roster addition is not dropped; idempotent on re-run.
do $roster$
declare def text;
begin
  select pg_get_functiondef(p.oid) into def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'mon_run_all_detectors';

  if def is null then
    raise exception 'mon_run_all_detectors() not found — roster entry cannot be added';
  end if;

  if position('mon_detect_alert_reaffirmation' in def) = 0 then
    def := replace(def,
      '''mon_detect_cron_health''',
      '''mon_detect_cron_health'',' || chr(10) ||
      '    ''mon_detect_alert_reaffirmation''');
    if position('mon_detect_alert_reaffirmation' in def) = 0 then
      raise exception 'anchor mon_detect_cron_health not found in the roster — refusing to leave the new detector unreachable';
    end if;
    execute def;
  end if;
end $roster$;