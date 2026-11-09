-- Integration tests for PR #11170. Requires a DISPOSABLE LOCAL database with
-- the PR's migrations applied. Never run on production: the detector sweeps all alerts.
-- psql --no-psqlrc --set ON_ERROR_STOP=1 --file supabase/tests/repeat_bug_loop.sql <local-test-db>
-- Everything, including detector writes, is rolled back on success or connection close.
\set ON_ERROR_STOP on
begin;
set local statement_timeout = '30s';

do $$
declare
  k text := '__unit_repeat_11170__';
  n int;
  baseline_opened int;
  baseline_repeats int;
begin
  -- Refuse a dirty fixture namespace rather than deleting unrelated data.
  if exists (select 1 from public.alert_event where dedup_key like '%__unit_repeat_11170__%') then
    raise exception 'repeat-loop fixture namespace already in use';
  end if;
  -- History outside the seven-day window still establishes a first occurrence.
  insert into public.alert_event (severity, kind, dedup_key, detail, created_at, resolved_at)
  values ('P2', 'run_unit_repeat', k, '{}', now() - interval '8 days', now() - interval '8 days');
  insert into public.alert_event (severity, kind, dedup_key, detail, created_at, resolved_at)
  select 'P2', 'run_unit_repeat', k, '{}', now() - make_interval(hours => g), now()
    from generate_series(1, 2) g;
  select reopens_7d into n from public.ops_repeat_bugs where dedup_key = k;
  if n is distinct from 2 then raise exception 'expected 2 recent reopens, got %', n; end if;
  perform public.mon_detect_repeat_bug();
  if exists (select 1 from public.alert_event where dedup_key = 'repeat_bug:' || k) then
    raise exception 'two reopens must not escalate';
  end if;

  -- A third reopen, including tied timestamps, crosses the exact escalation threshold.
  insert into public.alert_event (severity, kind, dedup_key, detail, created_at, resolved_at)
  values ('P2', 'run_unit_repeat', k, '{}', now() - interval '1 hour', now());
  perform public.mon_detect_repeat_bug();
  perform public.mon_detect_repeat_bug();
  select count(*) into n from public.alert_event
   where dedup_key = 'repeat_bug:' || k and kind = 'repeat_bug:run_unit_repeat'
     and severity = 'P1' and resolved_at is null;
  if n <> 1 then raise exception 'expected one open P1 after repeated sweeps, got %', n; end if;
  select count(*) into n from public.ops_engineer_backlog
   where position('repeat_bug:' || k || ' ' in item) > 0 and status = 'open'
     and engineer = 'scraping-engineer';
  if n <> 1 then raise exception 'expected one backlog item in the source lane, got %', n; end if;

  -- Two resolved escalation rows must affect neither numerator nor denominator.
  select opened, repeats into baseline_opened, baseline_repeats
    from public.ops_repeat_rate_weekly where period = 'last 7 d';
  insert into public.alert_event (severity, kind, dedup_key, detail, created_at, resolved_at)
  select 'P1', 'repeat_bug:run_unit_repeat', 'repeat_bug:' || k, '{}',
         now() - make_interval(minutes => g), now() from generate_series(1, 2) g;
  if exists (select 1 from public.ops_repeat_bugs where dedup_key = 'repeat_bug:' || k) then
    raise exception 'repeat alerts fed back into repeat detection';
  end if;
  if not exists (select 1 from public.ops_repeat_rate_weekly where period = 'last 7 d'
      and opened = baseline_opened and repeats = baseline_repeats) then
    raise exception 'escalations changed the repeat rate denominator or numerator';
  end if;

  -- Quiet duration alone cannot close an escalation while a source alert remains open.
  update public.alert_event set created_at = created_at - interval '3 days'
   where dedup_key = k;
  update public.alert_event set resolved_at = null
   where dedup_key = k and id = (select max(id) from public.alert_event where dedup_key = k);
  perform public.mon_detect_repeat_bug();
  if not exists (select 1 from public.alert_event where dedup_key = 'repeat_bug:' || k and resolved_at is null) then
    raise exception 'quiet but still-open source prematurely closed escalation';
  end if;
  update public.alert_event set resolved_at = now() where dedup_key = k;
  perform public.mon_detect_repeat_bug();
  if exists (select 1 from public.alert_event where dedup_key = 'repeat_bug:' || k and resolved_at is null)
     or exists (select 1 from public.ops_engineer_backlog where position('repeat_bug:' || k || ' ' in item) > 0 and status = 'open') then
    raise exception 'quiet resolved source did not close both P1 and backlog';
  end if;
  if not exists (select 1 from public.ops_engineer_backlog
      where position('repeat_bug:' || k || ' ' in item) > 0
        and status = 'done' and closed_at is not null and evidence like '%48 h%') then
    raise exception 'automatic closure did not record evidence';
  end if;
end $$;

do $$
declare
  k text := '__unit_debounce_11170__';
  other_key text := '__unit_debounce_other_11170__';
begin
  if public.mon_condition_held(k, true, interval '50 minutes') then
    raise exception 'first bad reading must wait';
  end if;
  update public.ops_check_pending set first_bad_at = now() - interval '50 minutes' + interval '1 millisecond'
   where check_key = k;
  if public.mon_condition_held(k, true, interval '50 minutes') then
    raise exception 'debounce fired before boundary';
  end if;
  update public.ops_check_pending set first_bad_at = now() - interval '50 minutes' where check_key = k;
  if not public.mon_condition_held(k, true, interval '50 minutes') then
    raise exception 'debounce failed at inclusive boundary';
  end if;
  if public.mon_condition_held(other_key, true, interval '50 minutes') then
    raise exception 'state leaked between check keys';
  end if;
  if public.mon_condition_held(k, null, interval '50 minutes') then
    raise exception 'unknown reading must clear pending state';
  end if;
  if exists (select 1 from public.ops_check_pending where check_key = k) then
    raise exception 'unknown reading left pending state';
  end if;
  if public.mon_condition_held(k, true, interval '50 minutes') then
    raise exception 'unknown reading did not restart grace';
  end if;
  if public.mon_condition_held(k, false, interval '50 minutes') then
    raise exception 'clean reading must return false';
  end if;
  if exists (select 1 from public.ops_check_pending where check_key = k)
     or not exists (select 1 from public.ops_check_pending where check_key = other_key) then
    raise exception 'reset must clear only its own key';
  end if;
end $$;
rollback;
