-- A P1 ABOUT A JOB THAT NO LONGER EXISTS CAN NEVER BE CLOSED — routine #7.
--
-- mon_detect_cron_health() raises per-job keys (cron_fail:<jobid>, cron_flapping:<jobid>,
-- cron_absent:<jobid>, …) inside a `for rec in <live cron jobs> loop`, and EVERY resolve is inside
-- that same loop. So the resolve is reachable only while the job still exists. Delete the job and
-- its open alert becomes permanent: the loop never yields that jobid again, mon_resolve_key is never
-- called for that key, and no amount of the condition clearing can clear it.
--
-- OBSERVED. Alert 2419 (P1, cron_fail:113, "temp-refresh-v1-now2") was raised 2026-09-11 19:29 for a
-- TEMPORARY job a concurrent session created and then removed. Job 113 is gone from cron.job; the
-- alert has survived 48 consecutive sweeps and would have survived every future one. On 2026-09-12
-- it was the ONLY open cron_health key.
--
-- The dangerous half is the same one AGENTS.md records for every stuck-open key: while it is open,
-- mon_raise() returns 0 for it. pg_cron REUSES jobids, so a future job that lands on 113 and starts
-- failing would raise nothing, dispatch nothing, and leave the roster count at 0 — the detector
-- reading green over exactly the failure it exists to report.
--
-- THE FIX IS A RESOLVE ON AN EVALUATED PATH, NOT A GRACE WINDOW. The sweep already knows the live
-- roster; after the loop it now closes any open cron_health key whose jobid is absent from cron.job.
-- That is a fact about the world, evaluated every sweep — not a timeout, and not a mute. A key for a
-- job that still exists is untouched, so nothing this detector currently reports can be silenced by
-- it: the discriminator is EXISTENCE of the job, which is exactly the condition that made the key
-- unreachable in the first place.
--
-- Built by needle-edit from pg_get_functiondef() of the LIVE body, anchored on the function's single
-- `end loop; … return n;`, with the anchor asserted before the edit — a concurrent session's work
-- cannot be dropped by re-creating this function from a stale copy.
do $mig$
declare
  v_def text;
  v_new text;
  v_block constant text :=
    E'\n  -- ORPHANED-KEY SWEEP (2026-09-12). Every resolve above lives INSIDE the per-job loop, so a\n'
 || E'  -- key belonging to a job that has since been DELETED is unreachable: the loop never yields\n'
 || E'  -- that jobid again. Alert 2419 (cron_fail:113, a temporary job another session removed) sat\n'
 || E'  -- open through 48 consecutive sweeps because of it, and while it sat there mon_raise()\n'
 || E'  -- returned 0 for that key — so a FUTURE job reusing jobid 113 and failing would have raised\n'
 || E'  -- nothing at all. pg_cron reuses jobids.\n'
 || E'  --\n'
 || E'  -- This is a resolve on an EVALUATED path, not a grace window: the discriminator is whether\n'
 || E'  -- the job still exists, which is the same fact that made the key unreachable. A key whose\n'
 || E'  -- job is still on the roster is untouched, so nothing this detector genuinely reports can be\n'
 || E'  -- silenced here. Never widen this to resolve keys for jobs that DO exist.\n'
 || E'  update public.alert_event a\n'
 || E'     set resolved_at = now()\n'
 || E'   where a.kind = ''cron_health''\n'
 || E'     and a.resolved_at is null\n'
 || E'     and a.dedup_key ~ ''^cron_[a-z_]+:[0-9]+$''\n'
 || E'     and not exists (select 1 from cron.job j\n'
 || E'                      where j.jobid = split_part(a.dedup_key, '':'', 2)::bigint);\n';
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname = 'mon_detect_cron_health';
  if v_def is null then
    raise exception 'mon_detect_cron_health() does not exist';
  end if;

  if position(E'  end loop;\n\n  return n;\nend $function$' in v_def) = 0 then
    raise exception 'could not anchor the orphaned-key sweep on the function''s trailing end loop/return';
  end if;
  v_new := replace(v_def,
    E'  end loop;\n\n  return n;\nend $function$',
    E'  end loop;\n' || v_block || E'\n  return n;\nend $function$');
  if v_new = v_def then
    raise exception 'needle-edit changed nothing';
  end if;

  execute v_new;
end $mig$;

-- Prove it, in the same migration, against production as it stands right now.
do $verify$
declare v_raised int; v_orphans int; v_live_keys int;
begin
  v_raised := public.mon_detect_cron_health();

  -- Every open cron_health key must now belong to a job that still exists.
  select count(*) into v_orphans
    from public.alert_event a
   where a.kind = 'cron_health' and a.resolved_at is null
     and a.dedup_key ~ '^cron_[a-z_]+:[0-9]+$'
     and not exists (select 1 from cron.job j where j.jobid = split_part(a.dedup_key, ':', 2)::bigint);
  if v_orphans <> 0 then
    raise exception 'orphaned cron_health keys still open after the sweep: %', v_orphans;
  end if;

  -- NEGATIVE CONTROL, executed: the predicate must discriminate a vanished job from a live one, or
  -- it is a mute button rather than a fix. Job 38 is the detector sweep itself and is always live.
  select count(*) into v_live_keys
    from (values ('cron_fail:113'), ('cron_fail:38')) v(k)
   where v.k ~ '^cron_[a-z_]+:[0-9]+$'
     and not exists (select 1 from cron.job j where j.jobid = split_part(v.k, ':', 2)::bigint);
  if v_live_keys <> 1 then
    raise exception 'the orphan predicate does not discriminate: matched % of 2 probe keys (expected exactly 1, the deleted job)', v_live_keys;
  end if;
end $verify$;
