-- CONTROLLED PROOF OF THE REMEDIATION CHAIN (owner mandate area 9).
--
-- Proves, deterministically and with ZERO production residue (everything runs inside a subtransaction
-- that is rolled back), BOTH required paths:
--   (1) failure -> detect -> auto-fix -> VERIFY -> closure
--   (2) failure -> auto-fix runs but does NOT clear the condition -> escalation -> stays open
--
-- It works on a synthetic sandbox kind ('remediation_selftest') with two scenarios keyed by
-- platform: 'ok' (the fix clears the condition) and 'stuck' (the fix runs but the condition
-- persists). Inside the test it disables the real policies so only the synthetic kind is processed,
-- runs the real run_remediation(), asserts the outcomes, then raises a sentinel to roll everything
-- back. Nothing here can touch real inventory.

create table if not exists public.ops_remediation_selftest (
  scenario text primary key,
  fixed    boolean not null default false
);

-- Synthetic fix: only the 'ok' scenario actually clears; 'stuck' runs cleanly but changes nothing.
create or replace function public.remediate_selftest(p_dedup text, p_platform text)
 returns void language plpgsql security definer set search_path to 'public'
as $fn$
begin
  if p_platform = 'ok' then
    update public.ops_remediation_selftest set fixed = true where scenario = p_platform;
  end if;
  -- 'stuck': intentionally a no-op (fix "executed" but the condition is not resolved)
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
    -- Isolate: only the synthetic kind is auto-fixed during the test (rolled back after).
    update public.ops_remediation_policy set enabled = false where kind <> 'remediation_selftest';
    insert into public.ops_remediation_policy (kind, fix_fn, verify_fn, max_attempts, cooldown_minutes, enabled, note)
      values ('remediation_selftest','remediate_selftest','verify_selftest',1,0,true,'selftest')
      on conflict (kind) do update set fix_fn=excluded.fix_fn, verify_fn=excluded.verify_fn,
        max_attempts=1, cooldown_minutes=0, enabled=true;
    delete from public.ops_remediation_selftest;
    insert into public.ops_remediation_selftest values ('ok', false), ('stuck', false);

    -- Two synthetic failures enter the system as alerts (as a detector would raise them).
    perform public.mon_raise('P2','remediation_selftest','ok','remediation_selftest:ok', '{"selftest":true}'::jsonb);
    perform public.mon_raise('P2','remediation_selftest','stuck','remediation_selftest:stuck','{"selftest":true}'::jsonb);

    -- Run the REAL worker.
    perform public.run_remediation();

    -- Path 1: 'ok' must be verified-fixed and CLOSED.
    select (resolved_at is null) into v_ok_open from public.alert_event
      where dedup_key='remediation_selftest:ok' order by created_at desc limit 1;
    select verified into v_ok_attempt from public.ops_remediation_attempt
      where dedup_key='remediation_selftest:ok' order by attempted_at desc limit 1;

    -- Path 2: 'stuck' must stay OPEN and an escalation must exist.
    select (resolved_at is null) into v_stuck_open from public.alert_event
      where dedup_key='remediation_selftest:stuck' order by created_at desc limit 1;
    select exists(select 1 from public.alert_event
      where dedup_key='remediation_exhausted:remediation_selftest:stuck' and resolved_at is null) into v_exhausted;

    if v_ok_open is not false then v_result := 'FAIL: ok scenario was not closed after verified fix'; end if;
    if coalesce(v_ok_attempt,false) is not true then v_result := 'FAIL: ok scenario attempt not marked verified'; end if;
    if v_stuck_open is not true then v_result := 'FAIL: stuck scenario was closed without a real fix'; end if;
    if v_exhausted is not true then v_result := 'FAIL: stuck scenario did not escalate to remediation_exhausted'; end if;

    raise exception 'ROLLBACK_SELFTEST';   -- undo ALL of the above; the assertions are already captured
  exception when others then
    if sqlerrm <> 'ROLLBACK_SELFTEST' then v_result := 'FAIL: ' || sqlerrm; end if;
  end;
  return v_result;
end $fn$;
