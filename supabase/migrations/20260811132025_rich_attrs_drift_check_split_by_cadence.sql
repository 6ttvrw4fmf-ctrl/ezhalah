-- The persistence alarm fired on 11 WASALT rows. wasalt is EXCLUDED from the hourly sync by design
-- (its branch costs ~19s; it converges daily at 06:47), so wasalt drift between daily syncs is the
-- cadence working — but check C measured one pooled drift number, so wasalt's expected inter-day lag
-- read as "sync not converging". Split the measurement by cadence, one persistence state each:
--   * hourly platforms: drift persisting across two barrier runs = the hourly chain is broken;
--   * wasalt: drift persisting across two barrier runs = two DAYS unconverged (barrier runs daily
--     at 06:52, five minutes after the wasalt sync) = the daily slot is broken.
alter table public.mon_rich_attrs_drift_state
  add column if not exists drift_wasalt bigint not null default 0;

create or replace function public.mon_rich_attrs_barrier()
returns integer
language plpgsql
as $fn$
declare total int := 0; v int; vw int; missing text; def text; cmd text; cols text[]; diff_list text;
begin
  -- A. the (source_table, listing_id) key must stay 1:1 — downstream DISTINCT ON would otherwise
  --    pick a branch arbitrarily instead of failing (see souq24 double-emit, migration 20260809154813)
  select count(*) into v from (
    select 1 from public.listing_rich_attrs group by source_table, listing_id having count(*) > 1) q;
  if v > 0 then
    total := total + 1;
    insert into public.location_pipeline_alerts(alert_type, metric, detail)
    values ('rich_attrs_duplicate_key', v,
            format('listing_rich_attrs emits %s duplicated (source_table, listing_id) keys.', v));
  end if;

  -- B. a cohort platform with no branch = captured data that can never reach search
  select pg_get_viewdef('public.listing_rich_attrs'::regclass, true) into def;
  select string_agg(distinct s.source_table, ', ') into missing
    from public.search_listings_ar s
   where s.deal_ar = 'إيجار' and s.rent_period_ar = 'سنوي' and s.type_ar = 'شقة'
     and s.production_ready and position(s.source_table in def) = 0;
  if missing is not null then
    total := total + 1;
    insert into public.location_pipeline_alerts(alert_type, metric, detail)
    values ('rich_attrs_platform_unmapped', 1,
            'Annual Rent -> Apartment platforms with NO listing_rich_attrs branch: ' || missing);
  end if;

  -- C. drift, split by sync cadence, alarming only on PERSISTENCE (or catastrophe)
  cols := public._rich_attr_columns();
  select string_agg(format('s.%I is distinct from r.%I', c, c), ' or ') into diff_list from unnest(cols) c;
  execute format($f$
    select count(*) filter (where s.source_table <> 'wasalt_residential_listings'),
           count(*) filter (where s.source_table =  'wasalt_residential_listings')
      from public.search_listings_ar s
      join public.listing_rich_attrs r
        on r.source_table = s.source_table and r.listing_id = s.listing_id
     where (%s)$f$, diff_list) into v, vw;

  if v > 50000 or (v > 0 and (select ds.drift_n from public.mon_rich_attrs_drift_state ds where ds.id = 1) > 0) then
    total := total + 1;
    insert into public.location_pipeline_alerts(alert_type, metric, detail)
    values ('rich_attrs_index_drift', v,
            format('%s hourly-cadence listings still disagree with listing_rich_attrs after a full '
                || 'sync cycle — sync_all_rich_attrs is not converging.', v));
  end if;
  if vw > 50000 or (vw > 0 and (select ds.drift_wasalt from public.mon_rich_attrs_drift_state ds where ds.id = 1) > 0) then
    total := total + 1;
    insert into public.location_pipeline_alerts(alert_type, metric, detail)
    values ('rich_attrs_wasalt_drift', vw,
            format('%s wasalt listings unconverged across two consecutive daily readings — the '
                || '06:47 wasalt rich sync is not doing its job.', vw));
  end if;
  insert into public.mon_rich_attrs_drift_state(id, drift_n, drift_wasalt, seen_at)
  values (1, v, vw, now())
  on conflict (id) do update set drift_n = excluded.drift_n,
                                 drift_wasalt = excluded.drift_wasalt, seen_at = now();

  -- D. the plumbing itself must still be connected (removing a guard inverts its monitor)
  select command into cmd from cron.job where jobid = 28 and active;
  if cmd is null or (cmd not like '%sync_listing_rich_attrs%' and cmd not like '%sync_all_rich_attrs%') then
    total := total + 1;
    insert into public.location_pipeline_alerts(alert_type, metric, detail)
    values ('rich_attrs_sync_unwired', 1, 'cron jobid 28 no longer syncs rich attrs.');
  end if;
  if not exists (select 1 from cron.job where active
                  and command like '%sync_listing_rich_attrs%' and command like '%wasalt%') then
    total := total + 1;
    insert into public.location_pipeline_alerts(alert_type, metric, detail)
    values ('rich_attrs_wasalt_sync_unwired', 1, 'no active cron job syncs wasalt rich attrs.');
  end if;

  return total;
end
$fn$;

-- converge wasalt now, then verify the barrier is genuinely green and clear the two transient alerts
select public.sync_listing_rich_attrs('wasalt_residential_listings');
do $$
declare v int;
begin
  v := public.mon_rich_attrs_barrier();
  if v <> 0 then raise exception 'rich barrier still reports % after wasalt convergence', v; end if;
end $$;
delete from public.location_pipeline_alerts where alert_type in ('rich_attrs_index_drift','rich_attrs_wasalt_drift');
