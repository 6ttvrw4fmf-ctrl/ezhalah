create table if not exists public.ops_remediation_selftest (
  scenario text primary key,
  fixed    boolean not null default false
);

create or replace function public.remediate_selftest(p_dedup text, p_platform text)
 returns void language plpgsql security definer set search_path to 'public'
as $fn$
begin
  if p_platform = 'ok' then
    update public.ops_remediation_selftest set fixed = true where scenario = p_platform;
  end if;
end $fn$;

create or replace function public.verify_selftest(p_dedup text, p_platform text)
 returns boolean language sql security definer set search_path to 'public'
as $fn$
  select coalesce((select fixed from public.ops_remediation_selftest where scenario = p_platform), false);
$fn$;

create or replace function public.mon_selftest_remediation_chain()
 returns text language plpgsql security definer set search_path to 'public'
as $fn$
declare
  v_ok_open boolean; v_stuck_open boolean; v_exhausted boolean;
  v_ok_attempt boolean; v_result text := 'PASS';
begin
  begin
    update public.ops_remediation_policy set enabled = false where kind <> 'remediation_selftest';
    insert into public.ops_remediation_policy (kind, fix_fn, verify_fn, max_attempts, cooldown_minutes, enabled, note)
      values ('remediation_selftest','remediate_selftest','verify_selftest',1,0,true,'selftest')
      on conflict (kind) do update set fix_fn=excluded.fix_fn, verify_fn=excluded.verify_fn,
        max_attempts=1, cooldown_minutes=0, enabled=true;
    delete from public.ops_remediation_selftest;
    insert into public.ops_remediation_selftest values ('ok', false), ('stuck', false);

    perform public.mon_raise('P2','remediation_selftest','ok','remediation_selftest:ok', '{"selftest":true}'::jsonb);
    perform public.mon_raise('P2','remediation_selftest','stuck','remediation_selftest:stuck','{"selftest":true}'::jsonb);

    perform public.run_remediation();

    select (resolved_at is null) into v_ok_open from public.alert_event
      where dedup_key='remediation_selftest:ok' order by created_at desc limit 1;
    select verified into v_ok_attempt from public.ops_remediation_attempt
      where dedup_key='remediation_selftest:ok' order by attempted_at desc limit 1;

    select (resolved_at is null) into v_stuck_open from public.alert_event
      where dedup_key='remediation_selftest:stuck' order by created_at desc limit 1;
    select exists(select 1 from public.alert_event
      where dedup_key='remediation_exhausted:remediation_selftest:stuck' and resolved_at is null) into v_exhausted;

    if v_ok_open is not false then v_result := 'FAIL: ok scenario was not closed after verified fix'; end if;
    if coalesce(v_ok_attempt,false) is not true then v_result := 'FAIL: ok scenario attempt not marked verified'; end if;
    if v_stuck_open is not true then v_result := 'FAIL: stuck scenario was closed without a real fix'; end if;
    if v_exhausted is not true then v_result := 'FAIL: stuck scenario did not escalate to remediation_exhausted'; end if;

    raise exception 'ROLLBACK_SELFTEST';
  exception when others then
    if sqlerrm <> 'ROLLBACK_SELFTEST' then v_result := 'FAIL: ' || sqlerrm; end if;
  end;
  return v_result;
end $fn$;