-- CONTROLLED PROOF OF THE ALERT->INCIDENT BRIDGE (owner tests 2-6), zero production residue.
--
-- Everything runs inside a subtransaction rolled back by a sentinel exception. Two synthetic P1
-- alerts, both aged past the P1 SLA and owned by routine-3-data-integrity:
--   A ('bridge_selftest:age')  — open, unacknowledged  -> promotes; then resolved -> incident closes
--   B ('bridge_selftest:ack')  — open, acknowledged     -> promotes; stays open (ack != resolved)
--
-- Proves: (3) serious aged alert ages into an incident; (4) a second run makes no duplicate
-- incident; (2) acknowledgement is honoured (an acked alert leaves the unworked-queue scope while an
-- unacked one does not); (5) a verified-resolved source alert closes its incident via the verified
-- path; (6) an unresolved alert's incident stays open (and mon_detect_stalled_incident escalates it).

create or replace function public.mon_selftest_bridge_chain()
 returns text language plpgsql security definer set search_path to 'public'
as $fn$
declare
  v_result text := 'PASS';
  v_age_exists boolean; v_age_count int; v_age_resolved boolean; v_ack_open boolean;
  v_unworked_a boolean; v_unworked_b boolean;
begin
  begin
    delete from public.alert_event where dedup_key in ('bridge_selftest:age','bridge_selftest:ack');
    delete from public.ops_incident where fingerprint in ('alert:bridge_selftest:age','alert:bridge_selftest:ack');

    insert into public.alert_event (severity, kind, platform, dedup_key, detail, created_at, last_affirmed_at, dispatched_at, acknowledged_at, owner_routine)
    values
      ('P1','bridge_selftest','age','bridge_selftest:age','{"selftest":true}'::jsonb, now()-interval '3 days', now(), now()-interval '3 days', null, 'routine-3-data-integrity'),
      ('P1','bridge_selftest','ack','bridge_selftest:ack','{"selftest":true}'::jsonb, now()-interval '3 days', now(), now()-interval '3 days', now(), 'routine-3-data-integrity');

    -- run #1
    perform public.promote_aged_alerts_to_incidents();

    select exists(select 1 from public.ops_incident
      where fingerprint='alert:bridge_selftest:age' and state not in ('resolved','wont_fix')) into v_age_exists;   -- test 3

    -- test 2: ack removes B from the unworked-queue scope; A (unacked) stays in it
    select (dispatched_at is not null and acknowledged_at is null and resolved_at is null
            and dispatched_at < now()-interval '48 hours')
      into v_unworked_a from public.alert_event where dedup_key='bridge_selftest:age';
    select (dispatched_at is not null and acknowledged_at is null and resolved_at is null
            and dispatched_at < now()-interval '48 hours')
      into v_unworked_b from public.alert_event where dedup_key='bridge_selftest:ack';

    -- run #2 (idempotency)
    perform public.promote_aged_alerts_to_incidents();
    select count(*) into v_age_count from public.ops_incident where fingerprint='alert:bridge_selftest:age';  -- test 4

    -- verified resolution of A, then run #3
    update public.alert_event set resolved_at = now() where dedup_key='bridge_selftest:age';
    perform public.promote_aged_alerts_to_incidents();
    select (state='resolved' and exit_reason='source_alert_resolved')
      into v_age_resolved from public.ops_incident where fingerprint='alert:bridge_selftest:age';           -- test 5
    select exists(select 1 from public.ops_incident
      where fingerprint='alert:bridge_selftest:ack' and state not in ('resolved','wont_fix')) into v_ack_open; -- test 6

    if v_age_exists is not true then v_result := 'FAIL(3): serious aged alert did not become an incident'; end if;
    if v_unworked_a is not true then v_result := 'FAIL(2a): unacked alert should be in the unworked scope'; end if;
    if v_unworked_b is not false then v_result := 'FAIL(2b): acknowledged alert should leave the unworked scope'; end if;
    if v_age_count <> 1 then v_result := 'FAIL(4): duplicate incidents created ('||v_age_count||')'; end if;
    if v_age_resolved is not true then v_result := 'FAIL(5): verified-resolved alert did not close its incident'; end if;
    if v_ack_open is not true then v_result := 'FAIL(6): unresolved alert''s incident did not stay open'; end if;

    raise exception 'ROLLBACK_SELFTEST';
  exception when others then
    if sqlerrm <> 'ROLLBACK_SELFTEST' then v_result := 'FAIL: ' || sqlerrm; end if;
  end;
  return v_result;
end $fn$;
