-- Built by needle-edit from pg_get_functiondef() of the LIVE function (fetched 2026-08-10 11:0x).
-- Only addition: the cron_worker_starvation block at the end. Everything else is byte-identical.
CREATE OR REPLACE FUNCTION public.location_pipeline_monitor()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $mon$
declare v_drift bigint; v_dup bigint; v_deal_gap bigint; v_withheld bigint;
        v_starve bigint; v_starve_jobs bigint;
begin
  -- Expected index state = what sync_search_listings_ar() writes, THEN what the BEFORE trigger
  -- does to it. Modelling only the first half is what pinned this alert at a permanent floor.
  select count(*) into v_drift from search_listings_ar s
    join listing_native_location_v2 v on v.source_table=s.source_table and v.listing_id=s.listing_id
    where s.city_id is distinct from v.city_id or s.region_id is distinct from v.region_id
       or s.district_ar is distinct from v.district_ar
       or s.production_ready is distinct from (v.production_ready
            and not public.price_size_impossible(v.price_total, v.price_annual, v.area_m2));
  if v_drift > 0 then
    insert into location_pipeline_alerts(alert_type, metric, detail)
      values ('search_v2_drift', v_drift, 'search index disagrees with resolver (v2) on location for '||v_drift||' row(s)');
  end if;

  -- The gate is now excluded from the drift count, so it must be reported under its own name --
  -- otherwise this change would silently bury a population that includes listings whose prices the
  -- source platform genuinely publishes. Owner decision pending; the number must stay in view.
  select count(*) into v_withheld from search_listings_ar s
    where not s.production_ready
      and public.price_size_impossible(s.price_total, s.price_annual, s.area_m2);
  if v_withheld > 0 then
    perform public.mon_raise('P2','price_gate_withheld','search_index','price_gate_withheld',
      jsonb_build_object('count', v_withheld,
        'why','listings withheld from search by the price/size plausibility gate (trg_price_size_sanity). Verified 2026-08-09: 28 of 34 carry values the source platform itself publishes, so the gate is hiding source-published data, contrary to the standing rule that a source price stays searchable at any magnitude. Needs an owner decision; the remainder are parser bugs.'));
  else
    perform public.mon_resolve_key('price_gate_withheld','price_gate_withheld');
  end if;

  select count(*) into v_dup from (select source_table, listing_id from listing_native_location_v2 group by 1,2 having count(*)>1) d;
  if v_dup > 0 then
    insert into location_pipeline_alerts(alert_type, metric, detail)
      values ('v2_duplicate_pk', v_dup, 'listing_native_location_v2 emits '||v_dup||' duplicate (source_table,listing_id) row(s)');
  end if;

  with gap as (
    select s.source_table, s.listing_id, s.city_id, r.neighborhood
    from search_listings_ar s
    join dealapp_residential_listings r on r.id = s.listing_id and s.source_table='dealapp_residential_listings'
    where s.production_ready and (s.district_ar is null or btrim(s.district_ar)='')
      and r.neighborhood is not null and btrim(r.neighborhood)<>''
    union all
    select s.source_table, s.listing_id, s.city_id, r.neighborhood
    from search_listings_ar s
    join dealapp_commercial_listings r on r.id = s.listing_id and s.source_table='dealapp_commercial_listings'
    where s.production_ready and (s.district_ar is null or btrim(s.district_ar)='')
      and r.neighborhood is not null and btrim(r.neighborhood)<>''
  ),
  resolvable as (
    select g.source_table, g.listing_id
    from gap g
    join district_name_bridge b on norm_en_district(b.district_en) = norm_en_district(g.neighborhood) and b.district_en !~ '[ء-ي]'
    join loc_catalog_district lc on lc.city_id = g.city_id and lc.district_norm = normalize_ar(b.district_ar)
    group by g.source_table, g.listing_id
    having count(distinct lc.district_ar) = 1
  )
  select count(*) into v_deal_gap from resolvable;
  if v_deal_gap > 0 then
    insert into location_pipeline_alerts(alert_type, metric, detail)
      values ('dealapp_district_unresolved', v_deal_gap, v_deal_gap||' production_ready dealapp listing(s) lack a district despite a unique catalogued match — resolver may be stalled');
  end if;

  insert into location_pipeline_alerts(alert_type, metric, detail)
  select 'cron_job_unhealthy', j.jobid,
         'jobid '||j.jobid||' ('||j.jobname||') last status='||coalesce(r.status,'never run')||' ended '||coalesce(r.end_time::text,'n/a')
  from cron.job j
  left join lateral (select status, end_time from cron.job_run_details d where d.jobid=j.jobid order by start_time desc limit 1) r on true
  where j.jobname in ('refresh_listing_native_location_v1','resolve-aqar-locations','sync-search-listings-ar','resolve-dealapp-districts')
    and (r.status is distinct from 'succeeded' or r.end_time < now() - interval '150 minutes');

  -- REGRESSION GUARD (2026-08-10). pg_cron gets max_worker_processes(6) background-worker slots,
  -- NOT cron.max_running_jobs(32); max_parallel_workers(2) draws from the same pool. When more
  -- jobs share a minute than there are free slots the losers fail with "job startup timeout" and
  -- their body NEVER RUNS. The per-name check above cannot see this class -- it watches 4 jobs,
  -- while the 2026-08-10 burst starved 13. Zero occurrences 2026-07-20..2026-08-08 makes any
  -- occurrence a real signal, so this fires on >0 rather than on a threshold.
  select count(*), count(distinct jobid) into v_starve, v_starve_jobs
    from cron.job_run_details
    where return_message = 'job startup timeout'
      and start_time > now() - interval '65 minutes';
  if v_starve > 0 then
    insert into location_pipeline_alerts(alert_type, metric, detail)
      values ('cron_worker_starvation', v_starve,
        v_starve||' cron run(s) across '||v_starve_jobs||' job(s) failed with "job startup timeout" in the last hour '
        ||'— pg_cron worker slots exhausted (max_worker_processes=6). Re-stagger colliding schedules '
        ||'or raise max_worker_processes (needs a DB restart).');
  end if;
end $mon$;

