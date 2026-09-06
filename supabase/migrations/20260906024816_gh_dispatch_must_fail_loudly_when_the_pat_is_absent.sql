-- A DISPATCHER THAT REPORTS SUCCESS WITHOUT DISPATCHING (ops_incident #74, routine-7 seam).
--
-- WHAT WAS FOUND. public.trigger_gh_workflow(wf) is the ONLY path from pg_cron to a
-- workflow_dispatch-only GitHub workflow: 22 cron jobs (21 active on 2026-09-05) call nothing else.
-- It read the PAT from vault.decrypted_secrets and, when that read came back null, did
--     raise notice 'github PAT not in Vault yet; skipping %', wf;
--     return;
-- A notice is not an error. The function returned void, the pg_cron run was recorded as
-- status='succeeded', and no HTTP request was ever made. Every scraper sweep, every cleanup, every
-- liveness pass and both hourly safety backstops (alert-dispatch.yml, migration-drift-guard.yml)
-- would have stopped running while cron reported success across the board and nothing anywhere
-- said otherwise. Project memory records this PAT expiring 2027-06-22, so this is a dated fuse.
--
-- THE SIBLING FAILURE, deliberately NOT re-solved here. A PAT that is PRESENT but expired produces
-- a 401 from GitHub. net.http_post is fire-and-forget, so that also returns success -- but the real
-- outcome lands in net._http_response and mon_detect_outbound_http_failures already watches it.
-- The hole was the branch that makes no request at all: it leaves no row anywhere, so no detector
-- reading net._http_response, cron.job_run_details or alert_event could ever see it.
--
-- THE FIX, three parts.
--   1. The missing-credential branch RAISES. The cron run then records status='failed' with the
--      message, and mon_detect_cron_health limb 1 already raises a P1 on any active job whose last
--      completed run failed. A blank secret is treated as absent for the same reason a null one is:
--      it cannot authenticate either, and it would otherwise buy back the silence through 401s.
--   2. mon_gh_dispatch_faults(def, tok, jobs) -- the PREDICATE, pure and injectable, so it can be
--      EXECUTED against a mutated definition without writing an alert or touching the vault. Same
--      split as mon_orphaned_detectors vs mon_detect_orphaned_detectors: that one decides, this one
--      raises.
--   3. mon_detect_gh_dispatch_silently_skipped() -- raises P1 when there is no usable PAT while
--      dispatch jobs are active (so the gap is named on the next detector sweep rather than at the
--      next fire of what may be a weekly job), and separately when the dispatcher's own shape has
--      regressed to something that can return before it dispatches. The second limb is what makes
--      part 1 permanent: a future migration re-introducing an early return is caught in production,
--      not only by the offline barrier reading this file.
--
-- The needle-edits below read the LIVE definition with pg_get_functiondef and splice. A full-body
-- replace pasted from a copy is how the detector roster lost entries four separate times
-- (see scripts/verify-detector-roster-edits-are-guarded.ts), and the same hazard applies to any
-- function concurrent sessions may have edited.

-- 1. trigger_gh_workflow: the missing-credential branch must fail loudly ------------------------
do $fix$
declare
  v_def    text;
  v_anchor text := $a$  if tok is null then
    raise notice 'github PAT not in Vault yet; skipping %', wf;
    return;
  end if;$a$;
  v_new    text := $a$  if tok is null or btrim(tok) = '' then
    raise exception 'trigger_gh_workflow(%): no usable GitHub PAT in vault.decrypted_secrets (looked for ''github'' / ''github_pat''). Refusing to report success for a dispatch that never happened.', wf
      using errcode = '28000',
            hint = 'Put a valid PAT back in Vault. Never restore the notice-and-return this replaced: it let every pg_cron driven workflow stop running while each cron run still recorded succeeded (ops_incident 74).';
  end if;$a$;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname = 'trigger_gh_workflow'
   limit 1;

  if v_def is null then
    raise exception 'trigger_gh_workflow() not found. Refusing to guess at a dispatcher that is not there.';
  end if;

  if position(v_new in v_def) > 0 then
    raise notice 'trigger_gh_workflow() already fails loudly, nothing to do';
    return;
  end if;

  if position(v_anchor in v_def) = 0 then
    raise exception 'trigger_gh_workflow() body is not the shape this needle-edit was derived from; re-derive it by hand from the live definition rather than guessing';
  end if;

  execute replace(v_def, v_anchor, v_new);
end $fix$;

do $verify$
declare v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.proname = 'trigger_gh_workflow' limit 1;
  if position('raise exception' in v_def) = 0 or position('raise notice ''github PAT not in Vault' in v_def) > 0 then
    raise exception 'trigger_gh_workflow edit did not take; the silent skip is still reachable';
  end if;
end $verify$;

-- 2. the predicate, pure and injectable ---------------------------------------------------------
create or replace function public.mon_gh_dispatch_faults(p_def text, p_tok text, p_jobs integer)
returns text[]
language plpgsql
immutable
set search_path to 'public'
as $function$
declare
  v_code   text;
  v_post   integer;
  v_ret    integer;
  v_faults text[] := '{}';
begin
  if p_def is null then
    if coalesce(p_jobs, 0) > 0 then
      v_faults := v_faults || 'dispatcher_missing';
    end if;
    return v_faults;
  end if;

  -- Strip comments at the READER, trailing ones included. A prose header that quotes the old
  -- silent body must never be able to satisfy, or trip, a check about the executed code path.
  v_code := regexp_replace(p_def, '/\*.*?\*/', ' ', 'gs');
  v_code := regexp_replace(v_code, '--.*$', '', 'gn');

  v_post := position('net.http_post' in v_code);
  if v_post = 0 then
    v_faults := v_faults || 'no_dispatch_call';
  else
    -- A `return;` AFTER the post is harmless; one BEFORE it is the defect itself, which is why
    -- this compares positions instead of merely asking whether the token appears.
    v_ret := regexp_instr(v_code, '\mreturn\s*;', 1, 1, 0, 'i');
    if v_ret > 0 and v_ret < v_post then
      v_faults := v_faults || 'returns_before_dispatch';
    end if;
  end if;

  if v_code !~* '\mraise\s+exception' then
    v_faults := v_faults || 'no_loud_failure';
  end if;

  if coalesce(p_jobs, 0) > 0 and (p_tok is null or btrim(p_tok) = '') then
    v_faults := v_faults || 'credential_missing';
  end if;

  return v_faults;
end $function$;

comment on function public.mon_gh_dispatch_faults(text, text, integer) is
  'Decides whether the pg_cron to GitHub dispatch seam can silently do nothing. Pure and injectable '
  'so the predicate can be executed against a mutated definition; mon_detect_gh_dispatch_silently_skipped() raises on it.';

-- 3. the detector ------------------------------------------------------------------------------
create or replace function public.mon_detect_gh_dispatch_silently_skipped()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_def    text;
  v_tok    text;
  v_jobs   integer;
  v_names  text[];
  v_faults text[];
  n        integer := 0;
begin
  select count(*)::integer, coalesce(array_agg(j.jobname order by j.jobname), '{}')
    into v_jobs, v_names
    from cron.job j
   where j.active and j.command like '%trigger_gh_workflow%';

  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname = 'trigger_gh_workflow'
   limit 1;

  -- Presence only. The secret itself is never put in an alert payload.
  select s.decrypted_secret into v_tok
    from vault.decrypted_secrets s
   where s.name = any (array['github', 'github_pat'])
   limit 1;

  v_faults := public.mon_gh_dispatch_faults(v_def, v_tok, v_jobs);

  if 'credential_missing' = any (v_faults) then
    n := n + public.mon_raise('P1', 'gh_dispatch_credential', 'monitoring',
      'gh_dispatch_credential_missing',
      jsonb_build_object(
        'active_dispatch_jobs', v_jobs,
        'jobs', to_jsonb(v_names),
        'why', 'There is no usable GitHub PAT in vault.decrypted_secrets, and these active pg_cron '
            || 'jobs have no other way to start their workflow. Every one of them is now failing '
            || 'loudly at its next fire, which is the intended behaviour, but several fire only '
            || 'weekly, so this says it on the next detector sweep instead of days later.',
        'action', 'Restore the PAT in Vault under the name github. Do NOT make the dispatcher '
            || 'return quietly again to clear this: a dispatch that reports success without making '
            || 'a request is ops_incident 74.'));
  else
    perform public.mon_resolve_key('gh_dispatch_credential', 'gh_dispatch_credential_missing');
  end if;

  if v_faults && array['dispatcher_missing', 'no_dispatch_call', 'returns_before_dispatch',
                       'no_loud_failure'] then
    n := n + public.mon_raise('P1', 'gh_dispatch_credential', 'monitoring',
      'gh_dispatch_silent_shape',
      jsonb_build_object(
        'faults', to_jsonb(v_faults),
        'active_dispatch_jobs', v_jobs,
        'why', 'public.trigger_gh_workflow() can once again finish normally without making an HTTP '
            || 'request, so a pg_cron run would be recorded as succeeded for work that never '
            || 'happened. That silence leaves no row in net._http_response and no failed cron run, '
            || 'so no other detector in this system can see it.',
        'action', 'Read the live definition with pg_get_functiondef. Any path that leaves the '
            || 'function before net.http_post must raise instead of returning. Do NOT relax this '
            || 'detector to match the new shape.'));
  else
    perform public.mon_resolve_key('gh_dispatch_credential', 'gh_dispatch_silent_shape');
  end if;

  return n;
end $function$;

-- 4. wire the detector into the roster IN THIS SAME MIGRATION -----------------------------------
do $wire$
declare
  v_def    text;
  v_anchor text := $a$    'mon_detect_outbound_http_failures',$a$;
  v_new    text := $a$    'mon_detect_outbound_http_failures',
    'mon_detect_gh_dispatch_silently_skipped',$a$;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname = 'mon_run_all_detectors'
   limit 1;

  if v_def is null then
    raise exception 'mon_run_all_detectors() not found. Refusing to wire a detector nothing reaches.';
  end if;

  if position('mon_detect_gh_dispatch_silently_skipped' in v_def) > 0 then
    raise notice 'already on the roster, nothing to do';
    return;
  end if;

  if position(v_anchor in v_def) = 0 then
    raise exception 'roster anchor not found; the roster shape changed. Re-derive the needle edit by hand rather than guessing.';
  end if;

  execute replace(v_def, v_anchor, v_new);
end $wire$;

do $verify$
declare v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.proname = 'mon_run_all_detectors' limit 1;
  if position('mon_detect_gh_dispatch_silently_skipped' in v_def) = 0 then
    raise exception 'roster edit did not take; mon_detect_gh_dispatch_silently_skipped is not reachable';
  end if;
end $verify$;
