-- MAP: the borrowed-pin rebuild runs INSIDE the hourly map rebuild (job map_grid_refresh_ar, :53), right before it,
-- instead of in its own :47 slot. :47 already starts two jobs (the cron slot ceiling, verify-cron-slot-discipline), and
-- no free minute exists outside the slow jobs' windows. Borrow (~7 s) then grid (~14 s) — one job, one slot, and the
-- labels always count the pins borrowed a moment earlier.
select cron.unschedule('map-pin-borrow-refresh');
select cron.alter_job(
  (select jobid from cron.job where jobname = 'map_grid_refresh_ar'),
  command := $cron$set statement_timeout to '300s'; select public.map_pin_borrow_refresh_ar(); select public.map_grid_refresh_ar();$cron$
);
