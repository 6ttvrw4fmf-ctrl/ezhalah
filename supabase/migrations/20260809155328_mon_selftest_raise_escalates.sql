-- Regression guard for the mon_raise() escalation fix (20260809154032).
--
-- Before that fix, mon_raise() returned 0 the instant an open alert_event existed for the dedup
-- key: an alert that opened at P2 stayed P2 forever with the payload it was born with. That is how
-- dealapp_residential sat at "P2, frac 0.234" from 2026-07-27 while the real figure climbed to
-- 0.414 -- past the 0.30 critical threshold -- and never paged anyone, and it is why dealapp could
-- go 30 days with zero deactivations unnoticed. The bug was fleet-wide: every detector raises
-- through mon_raise.
--
-- This function proves the behaviour end to end against the LIVE mon_raise, using a reserved dedup
-- key and cleaning up after itself, so it can be run on production as often as you like. It
-- returns false on the pre-fix implementation and true on the fixed one.
create or replace function public.mon_selftest_raise_escalates()
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  k constant text := '__selftest__mon_raise_escalates';
  v_sev text; v_detail jsonb; v_dispatched timestamptz; v_ret int; v_ok boolean := true;
begin
  -- start from a clean slate even if a previous run died mid-way
  delete from public.alert_event where dedup_key = k;

  -- 1. a fresh key must actually raise
  if public.mon_raise('P2','selftest', null, k, jsonb_build_object('stage','initial')) <> 1 then
    v_ok := false;
  end if;

  -- pretend it was already delivered, the way a real dispatched alert would be
  update public.alert_event set dispatched_at = now() where dedup_key = k;

  -- 2. same severity again must NOT create a second row, but MUST refresh the payload
  v_ret := public.mon_raise('P2','selftest', null, k, jsonb_build_object('stage','refreshed'));
  select severity, detail, dispatched_at into v_sev, v_detail, v_dispatched
    from public.alert_event where dedup_key = k;
  if v_ret <> 0
     or (select count(*) from public.alert_event where dedup_key = k) <> 1
     or v_detail->>'stage' is distinct from 'refreshed'   -- pre-fix: still 'initial' (stale payload)
     or v_dispatched is null then                          -- must NOT re-page when nothing worsened
    v_ok := false;
  end if;

  -- 3. a worse severity MUST escalate, and MUST re-arm dispatch so the page actually happens
  v_ret := public.mon_raise('P1','selftest', null, k, jsonb_build_object('stage','escalated'));
  select severity, detail, dispatched_at into v_sev, v_detail, v_dispatched
    from public.alert_event where dedup_key = k;
  if v_ret <> 1                                            -- pre-fix: 0
     or v_sev <> 'P1'                                      -- pre-fix: still 'P2'
     or v_detail->>'stage' is distinct from 'escalated'
     or v_dispatched is not null then                      -- pre-fix: still stamped, never re-sent
    v_ok := false;
  end if;

  -- 4. a LESS severe reading must never silently downgrade an open critical
  perform public.mon_raise('P2','selftest', null, k, jsonb_build_object('stage','downgrade_attempt'));
  select severity into v_sev from public.alert_event where dedup_key = k;
  if v_sev <> 'P1' then
    v_ok := false;
  end if;

  delete from public.alert_event where dedup_key = k;
  return v_ok;
end $function$;

comment on function public.mon_selftest_raise_escalates() is
  'Regression guard: proves mon_raise() refreshes a stale payload, escalates P2->P1, re-arms dispatch on escalation, and never downgrades an open alert. Returns false on the pre-2026-08-09 implementation. Self-cleaning; safe to run on production.';

do $do$
begin
  if not public.mon_selftest_raise_escalates() then
    raise exception 'mon_raise escalation self-test FAILED against the live function — refusing to ship the guard green';
  end if;
end $do$;
