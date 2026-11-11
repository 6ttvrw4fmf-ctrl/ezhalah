-- ONE GREEN RUN DOES NOT CLOSE A CHECK THAT KEEPS GOING RED (alert_flapping, 2026-11-10).
--
-- Every unattended workflow reports through scripts/ops/raise-workflow-alert.mjs: a red run raises
-- `workflow_failed:<file>`, a green run calls mon_resolve_key() and the alert closes at once. For a check that
-- fails one run in five that is a lie told ten times a day: «Site speed watch (live)» raised 9 times and closed 8
-- times in 48 hours while the same slow step (the impatient map tap, 6.8–7.0 s against a 5 s budget) kept coming
-- back, and auto-deploy-merged-fixes.yml raised 7 and closed 7. Each close said «over», each new raise looked like
-- a new problem, and alert_flapping paged about the pattern instead of the cause.
--
-- The rule now, for `workflow_failed:*` keys only: when the same key has already been closed twice or more in the
-- last 48 hours, a green run closes it only after 6 hours with no red run. Until then the SAME row stays open, a
-- later red run re-affirms it (mon_raise), and the row says why it is held. A key that has not been flapping closes
-- on the first green run exactly as before, and no other key is touched. Nothing is silenced and no threshold moves:
-- the alert is open for longer, not shorter.

create or replace function public.mon_resolve_key(p_kind text, p_dedup text)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_closed int;
  v_last_red timestamptz;
begin
  if p_dedup like 'workflow\_failed:%' then
    select count(*) into v_closed
      from public.alert_event
     where kind = p_kind and dedup_key = p_dedup
       and resolved_at is not null
       and created_at > now() - interval '48 hours';
    select max(greatest(created_at, coalesce(last_affirmed_at, created_at))) into v_last_red
      from public.alert_event
     where kind = p_kind and dedup_key = p_dedup and resolved_at is null;
    if v_closed >= 2 and v_last_red is not null and v_last_red > now() - interval '6 hours' then
      update public.alert_event
         set detail = detail || jsonb_build_object(
               'held_open', 'A green run did not close this: the same check closed ' || v_closed
                 || ' times in 48 hours and went red again each time. It closes on the first green run after 6 hours with no red run.',
               'held_open_since', now())
       where kind = p_kind and dedup_key = p_dedup and resolved_at is null
         and not (detail ? 'held_open_since');
      return;
    end if;
  end if;
  update public.alert_event set resolved_at = now()
   where kind = p_kind and dedup_key = p_dedup and resolved_at is null;
end $function$;

revoke all on function public.mon_resolve_key(text, text) from public, anon, authenticated;
grant execute on function public.mon_resolve_key(text, text) to service_role;

-- PROOF, both directions, on planted rows that are rolled back (no real alert is touched).
do $proof$
declare k constant text := '__flap_hold_selftest__'; n int;
begin
  begin
    -- 1. not flapping: one open row, no earlier closes -> the first green run closes it, as before.
    insert into public.alert_event (severity, kind, dedup_key, detail) values ('P3', k, 'workflow_failed:a.yml', '{}');
    perform public.mon_resolve_key(k, 'workflow_failed:a.yml');
    select count(*) into n from public.alert_event where kind = k and dedup_key = 'workflow_failed:a.yml' and resolved_at is null;
    if n <> 0 then raise exception 'PROOF: a check that is not flapping was not closed by its green run'; end if;

    -- 2. flapping: closed twice in 48 h, red again 10 minutes ago -> a green run does NOT close it.
    insert into public.alert_event (severity, kind, dedup_key, detail, created_at, resolved_at) values
      ('P3', k, 'workflow_failed:b.yml', '{}', now() - interval '20 hours', now() - interval '19 hours'),
      ('P3', k, 'workflow_failed:b.yml', '{}', now() - interval '9 hours',  now() - interval '8 hours');
    insert into public.alert_event (severity, kind, dedup_key, detail, created_at) values
      ('P3', k, 'workflow_failed:b.yml', '{}', now() - interval '10 minutes');
    perform public.mon_resolve_key(k, 'workflow_failed:b.yml');
    select count(*) into n from public.alert_event
     where kind = k and dedup_key = 'workflow_failed:b.yml' and resolved_at is null and detail ? 'held_open_since';
    if n <> 1 then raise exception 'PROOF: a flapping check was closed by one green run'; end if;

    -- 3. the same flapping key, quiet for 7 hours -> the green run closes it.
    update public.alert_event set created_at = now() - interval '7 hours', last_affirmed_at = null
     where kind = k and dedup_key = 'workflow_failed:b.yml' and resolved_at is null;
    perform public.mon_resolve_key(k, 'workflow_failed:b.yml');
    select count(*) into n from public.alert_event where kind = k and dedup_key = 'workflow_failed:b.yml' and resolved_at is null;
    if n <> 0 then raise exception 'PROOF: a held check never closes after 6 quiet hours'; end if;

    -- 4. any other key is untouched by the hold, however often it closed.
    insert into public.alert_event (severity, kind, dedup_key, detail, created_at, resolved_at) values
      ('P3', k, 'other_key', '{}', now() - interval '20 hours', now() - interval '19 hours'),
      ('P3', k, 'other_key', '{}', now() - interval '9 hours',  now() - interval '8 hours');
    insert into public.alert_event (severity, kind, dedup_key, detail) values ('P3', k, 'other_key', '{}');
    perform public.mon_resolve_key(k, 'other_key');
    select count(*) into n from public.alert_event where kind = k and dedup_key = 'other_key' and resolved_at is null;
    if n <> 0 then raise exception 'PROOF: a key outside workflow_failed was held'; end if;

    raise exception '__flap_hold_rollback__';
  exception when others then
    if sqlerrm <> '__flap_hold_rollback__' then raise; end if;
  end;
  if exists (select 1 from public.alert_event where kind = k) then
    raise exception 'PROOF: the planted rows were not rolled back';
  end if;
end $proof$;
