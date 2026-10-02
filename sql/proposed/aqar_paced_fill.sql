-- aqar paced fill: one shared NEW-row budget per workflow run, and both aqar fills on a 6-hour rota.
--
-- STAGED, NOT APPLIED (2026-10-02). The owner applies and mirrors it into supabase/migrations/.
-- The code that calls aqar_fill_claim() FAILS CLOSED while this is unapplied: a fill run then writes
-- no NEW rows at all (it still re-reads held ads), so merge order is safe either way.
--
-- WHY. The aqar deep fill stopped at 150 pages per (type × deal × city) slice while aqar paginates to
-- ceil(numberOfItems / 20) — measured 2026-10-02: Riyadh apartments for rent 22,415 ads (1,121 pages),
-- Jeddah apartments for sale 25,048 (1,253 pages), Riyadh villas for sale 14,307 (716 pages). The fill
-- now reads every page (scrapers/aqar/discover.py), but the gap must arrive GRADUALLY: on 2026-09-21 a
-- single ~3 GB write filled the disk before its autoscale (at most once per ~6 h) could react. An aqar
-- row costs ~9 KB in its own table plus ~5 KB across search_listings_ar and the location stores.
--
-- 1. aqar_fill_budget / aqar_fill_claim(): one row per workflow run (run_key = '<workflow>:<run_id>').
--    The deep fill runs ~108 shards in parallel; a per-shard cap could not bound the RUN, and an even
--    split starves the few slices that hold the gap (9 Riyadh/Jeddah slices hold almost all of it).
--    Every shard draws from this one row under a row lock, so the run's NEW rows are <= budget by
--    construction (CHECK granted <= budget). A grant is claimed before the ad is enriched, so a failed
--    enrich only makes the bound looser, never broken.
--    DISK BRAKE + MONITOR: each run's row records the disk in use (database + pg_wal) at its first claim
--    and at its latest one, and a run stops granting once it has grown the disk by more than 1.5 GB
--    (~4x the expected ~0.35 GB for 25k rows), so a row-cost estimate that is wrong cannot repeat
--    2026-09-21. Growth between runs is the difference of consecutive disk_bytes_at_start:
--      select run_key, created_at, granted, budget,
--             pg_size_pretty(disk_bytes_at_start) disk_at_start,
--             pg_size_pretty(disk_bytes_last - disk_bytes_at_start) grown_during_run
--        from public.aqar_fill_budget order by created_at desc limit 20;
-- 2. Schedules. pg_cron dispatches with no inputs, so the workflows' defaults are the schedule:
--    every page, new_budget 25000, refresh_after_days 6. One paced writer per 6-hour slot:
--      03:40 / 15:40 UTC  aqar-deep-fill.yml        (residential)
--      09:40 / 21:40 UTC  aqar-commercial-fill.yml  (commercial — had not run since 2026-06-20)
--    Off the cron fleet's busy minutes (:00/:15/:20), after aqar liveness (01:00) and cleanup (02:00).
--    The weekly gh-aqar-deep-fill-weekly (Sat 02:00) is replaced: held ads are now re-read once their
--    capture is 6 days old, on whichever run reaches them, instead of all at once on Saturday.

create table if not exists public.aqar_fill_budget (
  run_key    text primary key,
  budget     integer not null check (budget >= 0),
  granted    integer not null default 0 check (granted >= 0 and granted <= budget),
  disk_bytes_at_start bigint,
  disk_bytes_last     bigint,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.aqar_fill_budget enable row level security;
revoke all on table public.aqar_fill_budget from anon, authenticated;
comment on table public.aqar_fill_budget is
  'One row per aqar fill workflow run: the NEW-row budget all its shards share (aqar_fill_claim). '
  'granted = rows claimed for new ads; a run whose granted reaches budget deferred the rest to the next run.';

create or replace function public.aqar_fill_claim(p_run_key text, p_budget integer, p_want integer)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  -- A run that has grown database + WAL by more than this stops granting (fail closed).
  c_max_run_growth constant bigint := 1610612736;   -- 1.5 GB
  v_disk  bigint := pg_database_size(current_database())
                    + coalesce((select sum(size) from pg_ls_waldir()), 0);
  v_start bigint;
  v_left  integer;
  v_grant integer;
begin
  if p_run_key is null or p_want is null or p_want <= 0 then
    return 0;
  end if;
  -- First claimer of a run fixes its budget; later claims with another p_budget cannot raise it.
  insert into public.aqar_fill_budget (run_key, budget, disk_bytes_at_start, disk_bytes_last)
  values (p_run_key, greatest(coalesce(p_budget, 0), 0), v_disk, v_disk)
  on conflict (run_key) do nothing;

  select budget - granted, disk_bytes_at_start into v_left, v_start
    from public.aqar_fill_budget
   where run_key = p_run_key
   for update;                                   -- serialises the parallel shards of one run

  v_grant := greatest(0, least(p_want, coalesce(v_left, 0)));
  if v_disk > coalesce(v_start, v_disk) + c_max_run_growth then
    v_grant := 0;                                -- disk brake: this run has grown the disk enough
  end if;
  update public.aqar_fill_budget
     set granted = granted + v_grant, disk_bytes_last = v_disk, updated_at = now()
   where run_key = p_run_key;
  return v_grant;
end
$function$;

revoke all on function public.aqar_fill_claim(text, integer, integer) from public, anon, authenticated;
grant execute on function public.aqar_fill_claim(text, integer, integer) to service_role;
comment on function public.aqar_fill_claim(text, integer, integer) is
  'Grant up to p_want NEW rows from the aqar fill run p_run_key''s shared budget (p_budget, fixed by the '
  'first claim). Returns the grant; 0 once the run has spent its budget. See scrapers/aqar/paced_fill.py.';

-- Self-test before the schedules go live: the bound must hold and a second run must get its own pool.
do $$
declare g1 int; g2 int; g3 int; g4 int;
begin
  g1 := public.aqar_fill_claim('selftest:aqar_paced_fill', 10, 7);
  g2 := public.aqar_fill_claim('selftest:aqar_paced_fill', 999, 7);   -- budget stays 10
  g3 := public.aqar_fill_claim('selftest:aqar_paced_fill', 10, 7);
  g4 := public.aqar_fill_claim('selftest:aqar_paced_fill:2', 10, 7);
  if (g1, g2, g3, g4) is distinct from (7, 3, 0, 7) then
    raise exception 'aqar_fill_claim self-test failed: got (%, %, %, %), want (7, 3, 0, 7)', g1, g2, g3, g4;
  end if;
  delete from public.aqar_fill_budget where run_key like 'selftest:aqar_paced_fill%';
end $$;

select cron.unschedule(jobid) from cron.job where jobname = 'gh-aqar-deep-fill-weekly';
select cron.schedule('gh-aqar-deep-fill', '40 3,15 * * *',
  $$select public.trigger_gh_workflow('aqar-deep-fill.yml')$$);
select cron.schedule('gh-aqar-commercial-fill', '40 9,21 * * *',
  $$select public.trigger_gh_workflow('aqar-commercial-fill.yml')$$);
