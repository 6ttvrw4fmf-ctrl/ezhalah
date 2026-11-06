-- The migration mirror robot runs on the database clock, like the merge robot it feeds (2026-11-05).
-- migration-auto-mirror.yml carries its own GitHub schedule '7,22,37,52 * * * *' (96 runs a day), and GitHub fired it
-- THREE times on 2026-11-05 (10:44, 18:21, 23:44 UTC). Every production deploy was refused by the drift gate for most of
-- that day while applied migrations waited for a mirror PR nobody opened. engineer-automerge.yml has the same GitHub
-- schedule and runs reliably only because this bundle dispatches it (96 dispatches that day). A workflow's own schedule
-- is not a schedule here (docs/ops/LIFECYCLE_ENGINEER.md). Same bundle, same slot, no schedule change: the mirror robot is
-- dispatched first so the merge robot that follows sees the PRs it opens on its next pass.
-- Re-read live before replacing (jobid 211, 2026-11-05 22:3x UTC): four steps, the last trigger_gh_workflow('engineer-automerge.yml').
do $mig$
declare cmd text;
begin
  select command into cmd from cron.job where jobid = 211 and jobname = 'bundle-quarter-hour';
  if cmd is null then raise exception 'bundle-quarter-hour (jobid 211) not found'; end if;
  if cmd like '%migration-auto-mirror.yml%' then return; end if;
  if cmd not like '%$s$select public.trigger_gh_workflow(''engineer-automerge.yml'')$s$);' then
    raise exception 'bundle-quarter-hour changed since it was re-read; refusing to overwrite: %', cmd;
  end if;
  cmd := replace(cmd,
    '$s$select public.trigger_gh_workflow(''engineer-automerge.yml'')$s$);',
    '$s$select public.trigger_gh_workflow(''migration-auto-mirror.yml'')$s$,' || chr(10) ||
    '  $s$select public.trigger_gh_workflow(''engineer-automerge.yml'')$s$);');
  perform cron.alter_job(211, command := cmd);
end
$mig$;