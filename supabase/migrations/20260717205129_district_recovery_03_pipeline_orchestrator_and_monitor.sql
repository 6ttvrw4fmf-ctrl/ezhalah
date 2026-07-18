-- District recovery — Migration 3: orchestrator + underproduction monitor + hourly schedule.
create or replace function public.refresh_district_recovery_pipeline()
returns table(bridge_rows bigint, canonical_rows bigint, recovery_rows bigint)
language plpgsql
as $$
declare b bigint; c bigint; r bigint;
begin
  b := public.refresh_bridge_en_district();
  c := public.refresh_loc_canonical_district();
  r := public.refresh_district_recovery();

  if c < 3000 then
    insert into public.location_pipeline_alerts(alert_type, metric, detail)
      values ('district_canonical_underproduction', c,
              format('loc_canonical_district produced only %s rows (expected ~5.8k) — check normalizers/catalog.', c));
  end if;
  if r < 4000 then
    insert into public.location_pipeline_alerts(alert_type, metric, detail)
      values ('district_recovery_underproduction', r,
              format('district_recovery produced only %s rows (expected ~8.8k) — resolver/bridge may be broken.', r));
  end if;

  bridge_rows := b; canonical_rows := c; recovery_rows := r;
  return next;
end;
$$;

-- Hourly at :10 — after v1 matview refresh (:00, job 17), before sync (:15, job 28).
select cron.schedule('district-recovery-pipeline', '10 * * * *',
  $$ set statement_timeout to '600s'; select public.refresh_district_recovery_pipeline(); $$);

-- One-time initial population (idempotent; the cron repeats it hourly):
--   select public.refresh_district_recovery_pipeline();
--   select * from public.sync_search_listings_ar();
