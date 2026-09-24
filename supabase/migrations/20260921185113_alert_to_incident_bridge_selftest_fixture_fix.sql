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
    perform public.promote_aged_alerts_to_incidents();
    select exists(select 1 from public.ops_incident where fingerprint='alert:bridge_selftest:age' and state not in ('resolved','wont_fix')) into v_age_exists;
    select (dispatched_at is not null and acknowledged_at is null and resolved_at is null and dispatched_at < now()-interval '48 hours') into v_unworked_a from public.alert_event where dedup_key='bridge_selftest:age';
    select (dispatched_at is not null and acknowledged_at is null and resolved_at is null and dispatched_at < now()-interval '48 hours') into v_unworked_b from public.alert_event where dedup_key='bridge_selftest:ack';
    perform public.promote_aged_alerts_to_incidents();
    select count(*) into v_age_count from public.ops_incident where fingerprint='alert:bridge_selftest:age';
    update public.alert_event set resolved_at = now() where dedup_key='bridge_selftest:age';
    perform public.promote_aged_alerts_to_incidents();
    select (state='resolved' and exit_reason='source_alert_resolved') into v_age_resolved from public.ops_incident where fingerprint='alert:bridge_selftest:age';
    select exists(select 1 from public.ops_incident where fingerprint='alert:bridge_selftest:ack' and state not in ('resolved','wont_fix')) into v_ack_open;
    if v_age_exists is not true then v_result := 'FAIL(3)'; end if;
    if v_unworked_a is not true then v_result := 'FAIL(2a)'; end if;
    if v_unworked_b is not false then v_result := 'FAIL(2b)'; end if;
    if v_age_count <> 1 then v_result := 'FAIL(4): '||v_age_count; end if;
    if v_age_resolved is not true then v_result := 'FAIL(5)'; end if;
    if v_ack_open is not true then v_result := 'FAIL(6)'; end if;
    raise exception 'ROLLBACK_SELFTEST';
  exception when others then
    if sqlerrm <> 'ROLLBACK_SELFTEST' then v_result := 'FAIL: ' || sqlerrm; end if;
  end;
  return v_result;
end $fn$;