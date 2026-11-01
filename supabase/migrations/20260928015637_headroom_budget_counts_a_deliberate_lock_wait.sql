-- mon_detect_cron_timeout_headroom LIMB 1 judged a job's TOTAL elapsed time against its
-- PER-STATEMENT statement_timeout. That was a fair proxy while elapsed time was all the job's own
-- work. It stopped being one when 20260927224625 made jobid 28 WAIT on the ordering lock held by
-- jobid 17's listing_native_location_v1 refresh: cron.job_run_details records only
-- (start_time, end_time), so the wait is inside the elapsed time it compares.
--
-- Measured 2026-09-28 01:22 UTC, the first hour the new lock actually blocked anything:
--   jobid 17  01:20:00 -> 01:28:33   513 s  (normal 115 s)
--   jobid 28  01:22:00 -> 01:40:52  1132 s  succeeded
-- jobid 28 waited ~393 s for the refresh to commit, then did its own work. LIMB 1 read
-- 1132 / 600 = 188.7% of budget and would have raised a P2 saying it is "one slow day from
-- aborting" -- while no single statement came near 600 s, which is why the job SUCCEEDED. The
-- number was inflated by a wait the detector had no way to see, and its remedy ("raise the budget,
-- or make the query cheaper") pointed at the wrong job entirely.
--
-- FIX: a job that sets lock_timeout is declaring how long it may legitimately block before its own
-- work starts, so its wall-clock budget is statement_timeout + lock_timeout. For jobid 28 that is
-- 600 + 540 = 1140 s, and tonight's run reads 99.3% instead of 188.7%.
--
-- This deliberately does NOT silence tonight's alert, and must not be read as an attempt to. 1132 s
-- against a 1140 s envelope is still over the 85% bar and still raises P2 -- correctly: ~739 s of
-- that was jobid 28's OWN work against a normal 84 s. The defect being repaired is the ARITHMETIC
-- and the REMEDY TEXT, not the fact that the hour was flagged. Per this detector's own standing
-- rule, the bar (c_warn_pct) is untouched.
--
-- LIMB 2 needs no change: a lock wait killed by lock_timeout reports "canceling statement due to
-- lock timeout", which does not contain the substring "statement timeout", so LIMB 2's filter
-- already declines to classify it as a budget abort. That is the correct behaviour, and it is why
-- 20260927224625 chose lock_timeout (540 s) rather than letting the 600 s statement budget kill the
-- wait -- a wait that ends should report AS a wait.
--
-- Scope check before applying: jobid 28 is the ONLY active job whose command sets lock_timeout, so
-- exactly one job's reading changes today. Note `set lock_timeout to '0'` (jobid 28 resets it after
-- acquiring) cannot be matched by the pattern below, which requires a digit followed by 's' -- so
-- the reset is correctly ignored and the first real budget wins.
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
             end as stmt_timeout_s,
             -- A job that sets lock_timeout is declaring how long it may legitimately BLOCK before its
             -- own work begins. cron.job_run_details cannot separate that wait from the work, so the
             -- wall-clock budget below adds it; otherwise a deliberate wait is charged to the
             -- per-statement budget and reports headroom that was never consumed.
             coalesce((regexp_match(j.command, 'lock_timeout\s*(?:to|=)\s*''?\s*([0-9]+)\s*s', 'i'))[1]::numeric, 0)
               as lock_wait_s
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
    select e.jobid, e.jobname,
           e.stmt_timeout_s, e.lock_wait_s,
           e.stmt_timeout_s + e.lock_wait_s as timeout_s,
           d.max_ok_s,
           coalesce(d.timeout_fails_24h, 0) as timeout_fails_24h,
           coalesce(d.lock_wait_fails_24h, 0) as lock_wait_fails_24h,
           d.blocked_on_relations
    from eff e
    join d on d.jobid = e.jobid
    where e.stmt_timeout_s is not null and e.stmt_timeout_s > 0
  loop
    -- LIMB 1 — HEADROOM EXHAUSTED (P2). The job still succeeds, so every other check reads green;
    -- this is the only thing that speaks before the first abort.
    if rec.max_ok_s is not null and rec.max_ok_s >= (c_warn_pct / 100.0) * rec.timeout_s then
      n := n + public.mon_raise('P2', 'cron_timeout_headroom', null,
        'cron_timeout_headroom:' || rec.jobid,
        jsonb_build_object('jobid', rec.jobid, 'job', rec.jobname,
          'timeout_s', rec.timeout_s,
          'statement_budget_s', rec.stmt_timeout_s,
          'lock_wait_budget_s', rec.lock_wait_s,
          'max_successful_run_s', round(rec.max_ok_s::numeric, 1),
          'pct_of_budget', round(100 * rec.max_ok_s::numeric / rec.timeout_s, 1),
          'why', 'This job''s slowest SUCCESSFUL run in 24h is within ' || (100 - c_warn_pct)
              || '% of the wall-clock budget it runs under. It has not failed yet, so cron_health '
              || 'and every point-in-time check read green — but the next slow run aborts, and an '
              || 'aborted monitoring job performs NO detection for that period while still leaving '
              || 'a roster count of 0.'
              || case when rec.lock_wait_s > 0 then
                   ' That budget is statement_timeout ' || rec.stmt_timeout_s || 's PLUS lock_timeout '
                   || rec.lock_wait_s || 's, because this job blocks on a lock before its own work '
                   || 'starts and cron.job_run_details cannot separate the wait from the work.'
                 else '' end,
          'action', case when rec.lock_wait_s > 0 then
                 'Some of this elapsed time may be a DELIBERATE wait — this job sets lock_timeout '
              || rec.lock_wait_s || 's and blocks on a lock first. Check whether the UPSTREAM HOLDER '
              || 'got slower before touching this job: for jobid 28 that is jobid 17''s '
              || 'listing_native_location_v1 refresh (ordering lock added by 20260927224625), whose '
              || 'slow runs cluster in UTC hours 01, 04, 05, 06, 11, 13 and 17 — hour 11 averaged '
              || '400 s over the 3 days to 2026-09-28. Only once you have shown the job''s OWN work '
              || 'grew: raise the budget in the job''s COMMAND, or make the query cheaper. A cron '
              || 'SCHEDULE change is owner-only. Never silence this by widening c_warn_pct.'
            else
                 'Raise the budget in the job''s COMMAND (set statement_timeout to ''Ns''), or make '
              || 'the query cheaper. A cron SCHEDULE change is owner-only. Never silence this by '
              || 'widening c_warn_pct.'
            end));
    else
      perform public.mon_resolve_key('cron_timeout_headroom', 'cron_timeout_headroom:' || rec.jobid);
    end if;

    -- LIMB 2 — ALREADY ABORTING ON BUDGET (P1). cron_health limb 1/2 also fire on these, but cannot say
    -- WHY. This limb now reads the CONTEXT line, not just the fact of a timeout: a statement cancelled
    -- while BLOCKED on another transaction's row lock and one cancelled while doing its own expensive
    -- work need OPPOSITE remedies, and prescribing "raise the budget" for the former makes it worse.
    -- NOTE: an ADVISORY-lock wait killed by lock_timeout says "canceling statement due to lock timeout",
    -- which does not contain "statement timeout", so it never reaches this limb at all — correct, it is
    -- not a budget abort. It surfaces as a plain cron job failure instead.
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

-- Self-check: the two readings this migration exists to separate, on live cron.job rows.
do $chk$
declare
  v_stmt numeric; v_lock numeric; v_jobs int;
begin
  select (regexp_match(command, 'statement_timeout\s*(?:to|=)\s*''?\s*([0-9]+)\s*s', 'i'))[1]::numeric,
         coalesce((regexp_match(command, 'lock_timeout\s*(?:to|=)\s*''?\s*([0-9]+)\s*s', 'i'))[1]::numeric, 0)
    into v_stmt, v_lock
    from cron.job where jobid = 28 and active;

  if v_stmt is distinct from 600 or v_lock is distinct from 540 then
    raise exception 'jobid 28 no longer reads as 600s statement / 540s lock (got %/%) — the fix assumed it does',
      v_stmt, v_lock;
  end if;

  -- `set lock_timeout to '0'` must NOT be picked up as a budget (it has no trailing 's').
  if (regexp_match('set lock_timeout to ''0''; ', 'lock_timeout\s*(?:to|=)\s*''?\s*([0-9]+)\s*s', 'i')) is not null then
    raise exception 'the reset to 0 is being parsed as a lock budget';
  end if;

  -- Exactly one active job sets lock_timeout today; if that grows, the new allowance silently
  -- widens more budgets than this migration reviewed.
  select count(*) into v_jobs from cron.job where active and command ~* 'lock_timeout';
  if v_jobs <> 1 then
    raise exception 'expected exactly 1 active job setting lock_timeout, found %', v_jobs;
  end if;
end
$chk$;
