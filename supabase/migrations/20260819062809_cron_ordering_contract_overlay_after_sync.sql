-- Senior Production Engineer run #30 (2026-08-19).
-- resolve_english_city_overlay() SELECTs FROM public.search_listings_ar, which sync_search_listings_ar
-- writes. The overlay ran at :06, the sync at :14 - the consumer ran 8 minutes BEFORE its producer,
-- every hour. Measured live: 11 listings scraped 04:22-04:25 entered search_listings_ar at the 05:14
-- sync with city_id NULL, were still unlocated at the 05:29 detector sweep, and were only resolved by
-- the 06:06 overlay - ~52 minutes of avoidable unlocated time in which no city/district Filter
-- combination could return them. It also flapped the english_overlay_stranded_city P1 ~3x/day
-- (avg 45 min open); because mon_raise() returns 0 on an already-open dedup key, a GENUINE overlay
-- regression landing in one of those windows would have raised nothing at all.

-- 1. Put the consumer after its producer. Sync p95/max runtime observed at 50s/245s over 168 runs,
--    overlay 3s/26s; minute :22 carries zero other hourly jobs (:06 carried two).
do $$
declare v_jobid bigint;
begin
  select jobid into v_jobid from cron.job where jobname = 'resolve-english-city-overlay';
  if v_jobid is null then
    raise exception 'cron job resolve-english-city-overlay not found - refusing to guess';
  end if;
  perform cron.alter_job(v_jobid, schedule => '22 * * * *');
end $$;

-- 2. The contract, declared as data so the barrier covers the CLASS, not today's example.
create table if not exists public.ops_cron_ordering_contract (
  id               bigserial primary key,
  upstream_job     text        not null,
  downstream_job   text        not null,
  min_gap_minutes  int         not null default 1,
  why              text        not null,
  created_at       timestamptz not null default now(),
  constraint ops_cron_ordering_contract_uq unique (upstream_job, downstream_job)
);

insert into public.ops_cron_ordering_contract (upstream_job, downstream_job, min_gap_minutes, why)
values ('sync-search-listings-ar', 'resolve-english-city-overlay', 5,
        'resolve_english_city_overlay SELECTs FROM public.search_listings_ar, which '
        'sync_search_listings_ar writes. Until 2026-08-19 the overlay ran at :06 and the sync at :14, '
        'so the overlay read its input 8 minutes before that input existed and every newly ingested '
        'listing with a resolvable English city stayed unlocated for ~52 extra minutes. Sync max '
        'runtime observed 245s over 168 runs, hence a 5 minute floor.')
on conflict (upstream_job, downstream_job) do nothing;

-- 3. The barrier.
create or replace function public.mon_detect_cron_ordering_contract()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  c record; problems text[] := '{}'; n int := 0;
  up_sched text; dn_sched text; up_min int; dn_min int; gap int;
begin
  for c in select * from public.ops_cron_ordering_contract order by id loop
    select schedule into up_sched from cron.job where jobname = c.upstream_job   and active;
    select schedule into dn_sched from cron.job where jobname = c.downstream_job and active;

    if up_sched is null or dn_sched is null then
      problems := problems || format('%s -> %s: %s is not present as an ACTIVE cron job',
        c.upstream_job, c.downstream_job,
        case when up_sched is null then c.upstream_job else c.downstream_job end);
      continue;
    end if;

    -- An unevaluable contract is a finding, never a silent pass: if either side stops being a plain
    -- hourly schedule the ordering guarantee is gone and somebody must re-derive it by hand.
    if up_sched !~ '^\d+ \* \* \* \*$' or dn_sched !~ '^\d+ \* \* \* \*$' then
      problems := problems || format('%s (%s) -> %s (%s): not a plain hourly schedule, ordering is unevaluable',
        c.upstream_job, up_sched, c.downstream_job, dn_sched);
      continue;
    end if;

    up_min := split_part(up_sched, ' ', 1)::int;
    dn_min := split_part(dn_sched, ' ', 1)::int;
    gap    := dn_min - up_min;

    if gap < c.min_gap_minutes then
      problems := problems || format('%s at :%s -> %s at :%s: gap %s min is below the required %s min',
        c.upstream_job, lpad(up_min::text, 2, '0'),
        c.downstream_job, lpad(dn_min::text, 2, '0'), gap, c.min_gap_minutes);
    end if;
  end loop;

  if cardinality(problems) > 0 then
    n := public.mon_raise('P2', 'cron_ordering_contract', 'cron', 'cron_ordering_contract',
      jsonb_build_object(
        'violations', to_jsonb(problems),
        'why', 'A job READS what another job WRITES but is scheduled at or before its producer '
               'inside the hour, so it consumes an input that is up to a full cycle stale.',
        'do_not', 'Fix the SCHEDULE (cron.alter_job), never the contract row. Do NOT lower '
                  'min_gap_minutes or delete the row to make this green - that re-creates the exact '
                  'silent staleness this exists to catch.'));
  else
    perform public.mon_resolve_key('cron_ordering_contract', 'cron_ordering_contract');
  end if;

  return n;
end
$function$;
