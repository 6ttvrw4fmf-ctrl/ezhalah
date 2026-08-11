-- Barrier-strength audit (owner, 2026-08-11) found ONE unwired guard: mon_filter_parity_barrier()
-- — the older period/count parity detector — is detect-only and had NO automatic caller: not in the
-- mon_run_all_detectors roster, not on any cron. A barrier nobody runs is not a barrier.
--
-- Wired as a thin alerting wrapper chained onto the EXISTING hourly af-parity cron slot (worker
-- starvation rule: reuse slots, don't multiply jobs).
create or replace function public.mon_check_filter_parity_legacy()
returns integer
language plpgsql
as $fn$
declare total int := 0; r record;
begin
  for r in select * from public.mon_filter_parity_barrier() where n > 0 loop
    total := total + 1;
    insert into public.location_pipeline_alerts(alert_type, metric, detail)
    values ('filter_parity_legacy_' || r.check_name, r.n, left(coalesce(r.detail, r.check_name), 400));
  end loop;
  return total;
end
$fn$;

do $$
declare cur text;
begin
  select command into strict cur from cron.job where jobname = 'mon-af-predicate-parity';
  if cur like '%mon_check_filter_parity_legacy%' then return; end if;
  perform cron.alter_job((select jobid from cron.job where jobname = 'mon-af-predicate-parity'),
    command => rtrim(btrim(cur), ';') || '; select public.mon_check_filter_parity_legacy();');
  select command into strict cur from cron.job where jobname = 'mon-af-predicate-parity';
  if cur not like '%mon_af_predicate_parity%' or cur not like '%mon_check_filter_parity_legacy%' then
    raise exception 'cron edit lost a call: %', cur;
  end if;
end $$;

-- must be green at install
do $$
declare v int;
begin
  v := public.mon_check_filter_parity_legacy();
  if v <> 0 then raise exception 'legacy parity barrier reports % at install', v; end if;
end $$;
