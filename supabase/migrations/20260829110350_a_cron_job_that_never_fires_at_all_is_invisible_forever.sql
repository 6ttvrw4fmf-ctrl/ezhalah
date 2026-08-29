-- A CRON JOB THAT HAS NEVER RUN ONCE IS EXEMPT FROM THE OVERDUE CHECK -- WITH NO TIME BOUND.
--
-- mon_detect_cron_health() LIMB 3 is guarded by `rec.last_success is not null`, and says why:
--   "A brand-new job that has never run (last_success IS NULL) is intentionally NOT alerted --
--    it isn't overdue, it just hasn't been due yet (else every freshly-created job false-alarms
--    until its first fire)."
-- That reasoning is right, and the exemption is kept. What is wrong is that it NEVER EXPIRES. A job
-- created months ago that has still never fired -- an impossible schedule, a job pg_cron silently
-- never picked up, a workflow-trigger job whose first run died before it was recorded -- stays
-- exempt for the rest of time. It is the shape this repo has repeatedly been burned by: a monitor
-- that cannot fire reads as a clean bill of health (AGENTS.md, the nine dark detectors of
-- 2026-08-10; mon_detect_stalled_daily_detector exists for exactly this reason on the detector
-- side, and nothing did the same for a cron job's FIRST run).
--
-- Found by inspection this run, not by an alert -- which is the point. jobid 78 gh-verify-deletions
-- ('0 5 * * 0', deletion verification) has zero rows in cron.job_run_details, ever. Adjudicated and
-- NOT a defect: it was created 2026-08-23 15:07 UTC, after that Sunday's 05:00 slot had passed, so
-- its first legitimate fire is 2026-08-30 05:00. But if it does NOT fire tomorrow, nothing in this
-- system would ever say so, and a deletion-verification job silently never running is not a thing
-- to discover by luck a month later.
--
-- THE BOUND. pg_cron's cron.job carries no creation timestamp, so "how long has this job existed
-- without ever succeeding" is not answerable from pg_cron alone -- which is why the hole was
-- unclosable rather than merely unclosed. ops_cron_job_first_seen records it, populated by the
-- detector itself on every sweep. The exemption then lasts exactly as long as the job's own
-- expected cadence (the same mon_cron_expected_gap() grace LIMB 3 uses), instead of forever.
--
-- SELF-BOOTSTRAPPING AND FALSE-ALARM FREE. On the first sweep every existing job is stamped
-- first_seen_at = now(), so nothing can raise immediately; a job only raises once it has been
-- WATCHED for longer than its own cadence and still never succeeded. gh-verify-deletions is weekly,
-- so its grace is 336h -- it will not raise tomorrow, only if it is still dark two weeks from now.

create table if not exists public.ops_cron_job_first_seen (
  jobid         int primary key,
  jobname       text not null,
  first_seen_at timestamptz not null default now()
);

comment on table public.ops_cron_job_first_seen is
  'When mon_detect_cron_health() first OBSERVED each active pg_cron job. pg_cron keeps no creation '
  'timestamp, so this is the only way to bound the "never fired yet" exemption in LIMB 3 -- without '
  'it, a job that never fires at all is exempt forever. Written by the detector, read by LIMB 4.';

do $patch$
declare
  v_def text;

  -- (a) stamp first-seen before the loop
  v_anchor_upsert text := $anch$  for rec in
    select j.jobid, j.jobname, j.schedule,$anch$;
  v_new_upsert text := $lit$  -- Record when each active job was first OBSERVED. pg_cron has no creation timestamp, so this
  -- is what makes the "never fired yet" exemption in LIMB 3 boundable instead of permanent.
  -- A reused jobid carrying a DIFFERENT jobname is a new job: restart its clock rather than
  -- inheriting the dead job's age, which would make it raise immediately and wrongly.
  insert into public.ops_cron_job_first_seen (jobid, jobname)
  select j.jobid, j.jobname from cron.job j where j.active
  on conflict (jobid) do update
    set jobname       = excluded.jobname,
        first_seen_at = case when public.ops_cron_job_first_seen.jobname is distinct from excluded.jobname
                             then now() else public.ops_cron_job_first_seen.first_seen_at end;

  for rec in
    select j.jobid, j.jobname, j.schedule,$lit$;

  -- (b) the new limb, inside the loop
  v_anchor_limb text := $anch2$  end loop;
  return n;
end $function$$anch2$;
  v_new_limb text := $lit2$
    -- (4) NEVER FIRED AT ALL, past its own cadence. LIMB 3 deliberately exempts a job that has
    -- never succeeded, so a fresh job does not false-alarm before its first fire. This bounds that
    -- exemption to the job's own expected gap instead of forever: a monitor that cannot fire must
    -- never read as a clean bill of health.
    if rec.last_success is null
       and exists (select 1 from public.ops_cron_job_first_seen s
                    where s.jobid = rec.jobid and s.first_seen_at < now() - v_grace) then
      n := n + public.mon_raise('P1','cron_health', null, 'cron_never_fired:'||rec.jobid,
        jsonb_build_object('jobid',rec.jobid,'job',rec.jobname,'schedule',rec.schedule,
          'first_seen_at',(select s.first_seen_at from public.ops_cron_job_first_seen s where s.jobid = rec.jobid),
          'grace_h', round(extract(epoch from v_grace)::numeric/3600.0, 2),
          'why','this job has NEVER completed a successful run, and it has now been watched for '
             ||'longer than its own expected cadence. LIMB 3 exempts a never-run job so a freshly '
             ||'created one does not false-alarm before its first fire; this is that exemption '
             ||'expiring. A job that never fires is work nobody is doing and nothing else reports.',
          'action','check the schedule is actually reachable (a date that never occurs), that the '
             ||'command parses, and cron.job_run_details for a run that died before being recorded. '
             ||'Do NOT silence this by deactivating the job -- inactive jobs are skipped entirely.'));
    else
      perform public.mon_resolve_key('cron_health', 'cron_never_fired:'||rec.jobid);
    end if;
  end loop;
  return n;
end $function$$lit2$;
begin
  select pg_get_functiondef('public.mon_detect_cron_health()'::regprocedure) into v_def;
  if position('cron_never_fired' in v_def) > 0 then
    raise notice 'already patched -- nothing to do';
    return;
  end if;
  if position(v_anchor_upsert in v_def) = 0 then
    raise exception 'upsert anchor not found in live mon_detect_cron_health -- re-derive by hand';
  end if;
  if position(v_anchor_limb in v_def) = 0 then
    raise exception 'limb anchor not found in live mon_detect_cron_health -- re-derive by hand';
  end if;
  -- Needle-edit from the LIVE definition, twice: a concurrent session may have changed this body.
  v_def := replace(v_def, v_anchor_upsert, v_new_upsert);
  v_def := replace(v_def, v_anchor_limb,   v_new_limb);
  execute v_def;
end $patch$;

do $verify$
declare v_src text; v_rows int;
begin
  select prosrc into v_src from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname='public' and p.proname='mon_detect_cron_health';
  if position('cron_never_fired' in v_src) = 0 then
    raise exception 'LIMB 4 did not land';
  end if;
  if position('ops_cron_job_first_seen' in v_src) = 0 then
    raise exception 'the first-seen stamp did not land -- LIMB 4 could never fire';
  end if;
  -- Every pre-existing limb must survive the needle-edit.
  if position('cron_fail:' in v_src) = 0 or position('cron_flapping:' in v_src) = 0
     or position('cron_overdue:' in v_src) = 0 then
    raise exception 'a pre-existing limb was clobbered -- refusing to leave the detector degraded';
  end if;
  -- LIMB 3's deliberate exemption must still be there: this migration BOUNDS it, never removes it.
  if position('rec.last_success is not null' in v_src) = 0 then
    raise exception 'LIMB 3 exemption was removed -- that would false-alarm every fresh job';
  end if;

  -- Prove the stamp actually populates, and that nothing raises on the bootstrap sweep.
  perform public.mon_detect_cron_health();
  select count(*) into v_rows from public.ops_cron_job_first_seen;
  if v_rows = 0 then
    raise exception 'first-seen table is empty after a sweep -- the stamp is not running';
  end if;
  if exists (select 1 from public.alert_event
              where dedup_key like 'cron_never_fired:%' and resolved_at is null) then
    raise exception 'bootstrap sweep raised a never-fired alert -- the grace bound is wrong';
  end if;
end $verify$;
