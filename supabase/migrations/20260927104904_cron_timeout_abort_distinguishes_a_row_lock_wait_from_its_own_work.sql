-- A TIMEOUT KILL IS NOT ONE THING, AND THE DETECTOR PRESCRIBED THE WRONG REMEDY ON THE ONE JOB
-- WHERE IT MATTERS MOST (routine-7-seam, 2026-09-27).
--
-- mon_detect_cron_timeout_headroom() LIMB 2 fires when a cron job was killed by statement_timeout.
-- Its own comment claims the finding is actionable "because this limb matches the return_message",
-- but it matches only '%statement timeout%' -- never the CONTEXT line that says WHY the statement
-- died. It then asserts two things it never verified:
--     why    = 'KILLED by statement_timeout -- not a logic error'
--     action = 'Raise the budget in the job''s COMMAND, or make the query cheaper.'
--
-- MEASURED on 2026-09-27 over 30 days of cron.job_run_details: 40 timeout aborts across 13 jobs.
-- Exactly ONE job's aborts are row-lock waits -- jobid 86, mon-p0-fast-lane, 2 of 2 (100%):
--     ERROR:  canceling statement due to statement timeout
--     CONTEXT:  while updating tuple (526,7) in relation "alert_event"
--     SQL statement "update public.alert_event set detail = coalesce(p_detail, ...)"
-- That is mon_raise()'s affirm UPDATE blocked on another transaction's row lock. For that job BOTH
-- prescriptions are wrong, and the first is actively harmful: a larger budget makes the P0 FAST LANE
-- sit on the contended row LONGER before mon_dispatch_p0_fast() runs, which spends the 300 s P0
-- delivery SLO on a wait. "Make the query cheaper" is not available either -- the blocked statement
-- is a single-row UPDATE. The real remedy is the opposite: find the concurrent holder.
-- (Corroborating, from PR #4719's own commit message: "the first attempt lost a 15 s lock race to
-- mon_dispatch_p0_fast after a 6-minute build and rolled back" -- contention on alert_event between
-- an out-of-band session and the fast lane is a recurring production event, not a one-off.)
--
-- So the detector is right 38/40 times and wrong exactly where the cost is highest. This is the
-- class docs/ops/SYSTEMS_SEAM_ENGINEER.md already records twice -- ops_incident #219 and #311: a
-- detector asserting a CAUSE it never verified and sending its responder to the wrong place.
--
-- THE FIX reads the discriminator from evidence the message already carries, in an INJECTABLE
-- predicate so it can be executed against real captured messages rather than grepped.

create or replace function public.mon_cron_abort_is_lock_wait(p_return_message text)
returns boolean
language sql
immutable
parallel safe
as $$
  select coalesce(
    p_return_message ~ 'while (updating|locking|deleting) tuple \([0-9]+,[0-9]+\) in relation "',
    false);
$$;

comment on function public.mon_cron_abort_is_lock_wait(text) is
'TRUE when a cancelled statement was BLOCKED on another transaction''s ROW LOCK rather than doing
expensive work of its own. Postgres installs an error-context callback while a statement waits on a
tuple lock, so such a cancellation carries "CONTEXT: while updating|locking|deleting tuple (X,Y) in
relation \"R\"". A statement cancelled while doing its own work never carries that line -- its
CONTEXT names the SQL statement instead. The two have OPPOSITE remedies, which is why this is read
from evidence and never assumed. Injectable and self-tested by
mon_detect_cron_abort_classifier_selftest().';

create or replace function public.mon_cron_abort_lock_relation(p_return_message text)
returns text
language sql
immutable
parallel safe
as $$
  select (regexp_match(p_return_message,
    'while (?:updating|locking|deleting) tuple \([0-9]+,[0-9]+\) in relation "([^"]+)"'))[1];
$$;

comment on function public.mon_cron_abort_lock_relation(text) is
'The relation a cancelled statement was blocked on, or NULL when it was not a row-lock wait. Names
WHERE to look for the concurrent holder, so a responder does not have to re-read the raw message.';

-- Rebuilt from pg_get_functiondef() of the LIVE function read at 2026-09-27T10:44Z. Same argument
-- list (none), so this REPLACES rather than creating a second overload. Only the `d` CTE and LIMB 2
-- change; LIMB 1, the budget parser, and the orphaned-key sweep are byte-preserved.
create or replace function public.mon_detect_cron_timeout_headroom()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  rec record;
  n int := 0;
  c_warn_pct numeric := 85;      -- a job at/above this share of its budget is one slow day from aborting
  v_default_ms numeric;
  v_why text;
  v_action text;
  v_cause text;
  v_rels text;
begin
  -- The fallback budget must be the value a FRESH session gets, not this session's. pg_settings.reset_val
  -- is exactly that and is immune to a `set statement_timeout` upstream in the caller's command — which
  -- matters here because this detector runs from mon-detectors-and-dispatch, whose own command sets 900s.
  -- Reading current_setting() instead would judge every un-budgeted job against 900s rather than its real
  -- 120s, i.e. the detector would report headroom that does not exist.
  select reset_val::numeric into v_default_ms from pg_settings where name = 'statement_timeout';

  for rec in
    with eff as (
      select j.jobid, j.jobname,
             case
               -- an explicit, parseable budget in the command wins
               when (regexp_match(j.command, 'statement_timeout\s*(?:to|=)\s*''?\s*([0-9]+)\s*s', 'i')) is not null
                 then (regexp_match(j.command, 'statement_timeout\s*(?:to|=)\s*''?\s*([0-9]+)\s*s', 'i'))[1]::numeric
               -- it SETS one but in a shape we cannot read: UNKNOWN, never "assume the default".
               -- Judging it against the wrong budget would be a confident wrong answer, so skip it.
               when j.command ~* 'statement_timeout' then null
               else v_default_ms / 1000.0
             end as timeout_s
      from cron.job j
      where j.active
    ),
    d as (
      select jobid,
             max(extract(epoch from (end_time - start_time)))
               filter (where status = 'succeeded') as max_ok_s,
             count(*) filter (where status = 'failed'
                                and return_message ilike '%statement timeout%') as timeout_fails_24h,
             -- A timeout kill is NOT one thing, and the two kinds have opposite remedies. Split them
             -- by the evidence the message already carries rather than assuming "expensive work".
             count(*) filter (where status = 'failed'
                                and return_message ilike '%statement timeout%'
                                and public.mon_cron_abort_is_lock_wait(return_message))
               as lock_wait_fails_24h,
             (array_agg(distinct public.mon_cron_abort_lock_relation(return_message))
                filter (where status = 'failed'
                         and return_message ilike '%statement timeout%'
                         and public.mon_cron_abort_is_lock_wait(return_message)))
               as blocked_on_relations
      from cron.job_run_details
      where start_time > now() - interval '24 hours'
        and end_time is not null
      group by jobid
    )
    select e.jobid, e.jobname, e.timeout_s, d.max_ok_s,
           coalesce(d.timeout_fails_24h, 0) as timeout_fails_24h,
           coalesce(d.lock_wait_fails_24h, 0) as lock_wait_fails_24h,
           d.blocked_on_relations
    from eff e
    join d on d.jobid = e.jobid
    where e.timeout_s is not null and e.timeout_s > 0
  loop
    -- LIMB 1 — HEADROOM EXHAUSTED (P2). The job still succeeds, so every other check reads green;
    -- this is the only thing that speaks before the first abort.
    if rec.max_ok_s is not null and rec.max_ok_s >= (c_warn_pct / 100.0) * rec.timeout_s then
      n := n + public.mon_raise('P2', 'cron_timeout_headroom', null,
        'cron_timeout_headroom:' || rec.jobid,
        jsonb_build_object('jobid', rec.jobid, 'job', rec.jobname,
          'timeout_s', rec.timeout_s,
          'max_successful_run_s', round(rec.max_ok_s::numeric, 1),
          'pct_of_budget', round(100 * rec.max_ok_s::numeric / rec.timeout_s, 1),
          'why', 'This job''s slowest SUCCESSFUL run in 24h is within ' || (100 - c_warn_pct)
              || '% of the statement_timeout it runs under. It has not failed yet, so cron_health '
              || 'and every point-in-time check read green — but the next slow run aborts, and an '
              || 'aborted monitoring job performs NO detection for that period while still leaving '
              || 'a roster count of 0.',
          'action', 'Raise the budget in the job''s COMMAND (set statement_timeout to ''Ns''), or make '
              || 'the query cheaper. A cron SCHEDULE change is owner-only. Never silence this by '
              || 'widening c_warn_pct.'));
    else
      perform public.mon_resolve_key('cron_timeout_headroom', 'cron_timeout_headroom:' || rec.jobid);
    end if;

    -- LIMB 2 — ALREADY ABORTING ON BUDGET (P1). cron_health limb 1/2 also fire on these, but cannot say
    -- WHY. This limb now reads the CONTEXT line, not just the fact of a timeout: a statement cancelled
    -- while BLOCKED on another transaction's row lock and one cancelled while doing its own expensive
    -- work need OPPOSITE remedies, and prescribing "raise the budget" for the former makes it worse.
    if rec.timeout_fails_24h > 0 then
      v_rels := coalesce(array_to_string(rec.blocked_on_relations, ', '), '');
      v_cause := case
                   when rec.lock_wait_fails_24h = 0 then 'own_work'
                   when rec.lock_wait_fails_24h >= rec.timeout_fails_24h then 'row_lock_wait'
                   else 'mixed'
                 end;

      if v_cause = 'own_work' then
        v_why := 'This job was KILLED by statement_timeout in the last 24h while doing its OWN work '
              || '(no row-lock wait in any of the ' || rec.timeout_fails_24h || ' abort message(s)). '
              || 'Each abort is one scheduled period that did no work at all, and pg_cron runs the '
              || 'whole command in ONE transaction, so anything the command would have written rolled '
              || 'back with it.';
        v_action := 'Raise the budget in the job''s COMMAND, or make the query cheaper.';
      else
        v_why := rec.lock_wait_fails_24h || ' of this job''s ' || rec.timeout_fails_24h
              || ' timeout abort(s) in the last 24h were the statement being cancelled while BLOCKED '
              || 'on another transaction''s ROW LOCK on: ' || v_rels || ' — not while doing expensive '
              || 'work of its own. Postgres reports this as "while updating/locking tuple (X,Y) in '
              || 'relation". pg_cron runs the whole command in ONE transaction, so the period did no '
              || 'work at all and anything it would have written rolled back.'
              || case when v_cause = 'mixed'
                   then ' The remaining abort(s) WERE its own work, so this job needs both remedies.'
                   else '' end;
        v_action := 'Do NOT raise this job''s budget for the lock-wait aborts: a larger budget only '
              || 'makes it WAIT LONGER on the contended row before its own work begins. On jobid 86 '
              || '(mon-p0-fast-lane) that spends the 300 s P0 delivery SLO on a wait, so it makes '
              || 'delivery worse. "Make the query cheaper" does not apply either when the blocked '
              || 'statement is a single-row UPDATE. Find the CONCURRENT HOLDER instead — an '
              || 'out-of-band session or a long transaction writing ' || v_rels || ' — and shorten '
              || 'the transaction that holds the row.'
              || case when v_cause = 'mixed'
                   then ' For the non-lock aborts, the usual budget/cost remedy still applies.'
                   else '' end;
      end if;

      n := n + public.mon_raise('P1', 'cron_timeout_headroom', null,
        'cron_timeout_abort:' || rec.jobid,
        jsonb_build_object('jobid', rec.jobid, 'job', rec.jobname,
          'timeout_s', rec.timeout_s,
          'timeout_aborts_24h', rec.timeout_fails_24h,
          'lock_wait_aborts_24h', rec.lock_wait_fails_24h,
          'abort_cause', v_cause,
          'blocked_on_relations', coalesce(to_jsonb(rec.blocked_on_relations), 'null'::jsonb),
          'why', v_why,
          'action', v_action));
    else
      perform public.mon_resolve_key('cron_timeout_headroom', 'cron_timeout_abort:' || rec.jobid);
    end if;
  end loop;

  -- ORPHANED-KEY SWEEP. Both resolves above live inside the per-job loop, so a key belonging to a job
  -- that has since been DELETED is unreachable and would sit open forever — suppressing every future
  -- raise for that key, because mon_raise() returns 0 on an already-open dedup_key and pg_cron REUSES
  -- jobids. Same failure mon_detect_cron_health() was repaired for (alert 2419, 48 sweeps). This is a
  -- resolve on an EVALUATED path: the discriminator is whether the job still exists, which is the same
  -- fact that made the key unreachable. Never widen this to resolve keys for jobs that DO exist.
  update public.alert_event a
     set resolved_at = now()
   where a.kind = 'cron_timeout_headroom'
     and a.resolved_at is null
     and a.dedup_key ~ '^cron_timeout_[a-z]+:[0-9]+$'
     and not exists (select 1 from cron.job j
                      where j.jobid = split_part(a.dedup_key, ':', 2)::bigint);

  return n;
end $function$;

-- THE BARRIER. It EXECUTES the classifier against messages captured verbatim from
-- cron.job_run_details rather than grepping the detector's source -- the distinction AGENTS.md draws
-- after five defects shipped under source-TEXT tripwires that pinned the defective line as correct.
-- If the predicate ever stops telling the two shapes apart, LIMB 2 silently returns to prescribing
-- the harmful remedy, so this must go RED rather than the detector going quiet.
create or replace function public.mon_detect_cron_abort_classifier_selftest()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  n int := 0;
  v_bad text[] := '{}';
  -- REAL messages, captured from production cron.job_run_details on 2026-09-27.
  c_lock_wait text := E'ERROR:  canceling statement due to statement timeout\nCONTEXT:  while updating tuple (526,7) in relation "alert_event"\nSQL statement "update public.alert_event\n     set detail          = coalesce(p_detail, a.detail)"';
  c_work      text := E'ERROR:  canceling statement due to statement timeout\nCONTEXT:  SQL statement "select count(*)             from public.mon_aqar_ppm_as_total"\nPL/pgSQL function mon_detect_aqar_ppm_as_total() line 12 at SQL statement';
  c_locking   text := E'ERROR:  canceling statement due to statement timeout\nCONTEXT:  while locking tuple (1,2) in relation "listing_location_canonical_mv"';
  c_decoy     text := E'ERROR:  canceling statement due to statement timeout\nCONTEXT:  SQL statement "select relation from pg_locks where relation is not null and tuple is not null"';
begin
  if not public.mon_cron_abort_is_lock_wait(c_lock_wait) then
    v_bad := v_bad || 'the real alert_event row-lock abort (jobid 86, 07:51Z) was classified as expensive work';
  end if;
  if public.mon_cron_abort_lock_relation(c_lock_wait) is distinct from 'alert_event' then
    v_bad := v_bad || 'the blocked relation was not extracted from the real row-lock abort';
  end if;
  if not public.mon_cron_abort_is_lock_wait(c_locking) then
    v_bad := v_bad || 'a SELECT-FOR-UPDATE style "while locking tuple" abort was not recognised as a lock wait';
  end if;
  if public.mon_cron_abort_is_lock_wait(c_work) then
    v_bad := v_bad || 'a genuine expensive-work abort (mon-aqar-ppm-as-total) was misread as a lock wait';
  end if;
  if public.mon_cron_abort_is_lock_wait(c_decoy) then
    v_bad := v_bad || 'a message merely containing the words relation and tuple was misread as a lock wait';
  end if;
  if public.mon_cron_abort_is_lock_wait(null) then
    v_bad := v_bad || 'a NULL return_message was classified as a lock wait (absence is not evidence)';
  end if;

  if array_length(v_bad, 1) > 0 then
    n := n + public.mon_raise('P1', 'cron_abort_classifier_broken', null,
      'cron_abort_classifier_broken',
      jsonb_build_object(
        'failures', to_jsonb(v_bad),
        'why', 'mon_cron_abort_is_lock_wait()/mon_cron_abort_lock_relation() no longer classify the '
            || 'REAL production messages they were built from. mon_detect_cron_timeout_headroom() '
            || 'LIMB 2 uses them to choose which remedy to prescribe, so while this is broken that '
            || 'detector is back to telling whoever responds to raise a budget that must NOT be '
            || 'raised (the P0 fast lane, where a bigger budget lengthens the lock wait and spends '
            || 'the 300 s P0 SLO), or to hunt a lock holder that does not exist.',
        'action', 'Fix the classifier. Do NOT delete or weaken this self-test to make a sweep read '
            || 'clean: it executes the predicate against captured messages precisely so it cannot '
            || 'pass over a predicate that no longer works.'));
  else
    perform public.mon_resolve_key('cron_abort_classifier_broken', 'cron_abort_classifier_broken');
  end if;
  return n;
end $function$;

-- ROSTER ENTRY, IN THIS SAME MIGRATION (mon_detect_orphaned_detectors() fires on any detector nothing
-- reaches, and a detector outside the roster is decoration). Needle-edited from the LIVE definition at
-- apply time rather than re-created from a copy pasted here, so a concurrent session's roster addition
-- cannot be silently dropped. Fails CLOSED if the anchor is missing or already present.
do $roster$
declare
  v_def text;
  v_new text;
begin
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'mon_run_all_detectors';

  if v_def is null then
    raise exception 'mon_run_all_detectors() not found - refusing to leave the new detector orphaned';
  end if;

  if v_def like '%mon_detect_cron_abort_classifier_selftest%' then
    raise notice 'already on the roster; nothing to do';
    return;
  end if;

  if (length(v_def) - length(replace(v_def, '''mon_detect_cron_timeout_headroom''', ''))) /
     length('''mon_detect_cron_timeout_headroom''') <> 1 then
    raise exception 'anchor ''mon_detect_cron_timeout_headroom'' is not present exactly once - refusing to needle-edit blind';
  end if;

  v_new := replace(v_def,
    '''mon_detect_cron_timeout_headroom''',
    '''mon_detect_cron_timeout_headroom'',' || E'\n    ' || '''mon_detect_cron_abort_classifier_selftest''');

  execute v_new;

  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'mon_run_all_detectors';
  if v_def not like '%mon_detect_cron_abort_classifier_selftest%' then
    raise exception 'roster edit did not take effect - the detector would be decoration';
  end if;
end $roster$;
