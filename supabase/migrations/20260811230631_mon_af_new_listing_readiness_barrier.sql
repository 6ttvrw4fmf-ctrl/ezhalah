-- NEW-LISTING READINESS for the Annual Rent -> Apartment Advanced Filter (owner, 2026-08-11:
-- "whenever we get a new listing we know how to match the advanced search").
--
-- Two ways a NEW listing can silently fall out of the interview:
--   A. its platform has no listing_extra_attrs branch (the view that feeds the MAIN chips:
--      AC/elevator/kitchen/private-entrance/parking/maid/driver/furnished/age/direction/width/
--      floor/licence). mon_rich_attrs_barrier guards only the RICH view; this was unguarded.
--   B. the platform IS mapped but its scraper regresses and stops CAPTURING a field — new rows
--      arrive all-NULL where the platform historically published the fact. Counts stay "right"
--      while coverage quietly rots. Nothing watched this.
--
-- Check B compares each cohort platform's FRESH listings (raw scraped_at, i.e. first-seen, within
-- 48h) against that platform's own all-time known-rate per interview field: alarm when >= 20 fresh
-- rows show less than HALF the established rate on a field the platform establishes at >= 20%.
-- Self-baselined — no state table, no invented thresholds per platform.
create or replace function public.mon_af_new_listing_readiness()
returns integer
language plpgsql
as $fn$
declare
  total int := 0; def text; missing text; t text; fresh_n bigint; r record;
  fields constant text[] := array['air_conditioner','elevator','kitchen','private_entrance',
    'parking','maid_room','driver_room','furnished','bathrooms','property_age'];
  f text; all_rate numeric; fresh_rate numeric;
begin
  -- A. every cohort platform must have a listing_extra_attrs branch
  select pg_get_viewdef('public.listing_extra_attrs'::regclass, true) into def;
  select string_agg(distinct s.source_table, ', ') into missing
    from public.search_listings_ar s
   where s.deal_ar='إيجار' and s.rent_period_ar='سنوي' and s.type_ar='شقة' and s.production_ready
     and position(s.source_table in def) = 0;
  if missing is not null then
    total := total + 1;
    insert into public.location_pipeline_alerts(alert_type, metric, detail)
    values ('af_new_listing_unmapped_platform', 1,
            'Annual Rent -> Apartment platforms with NO listing_extra_attrs branch (new listings '
         || 'cannot reach the interview chips): ' || missing);
  end if;

  -- B. capture regression on fresh listings, per platform x interview field
  for t in select distinct s.source_table from public.search_listings_ar s
            where s.deal_ar='إيجار' and s.rent_period_ar='سنوي' and s.type_ar='شقة' and s.production_ready
  loop
    continue when not exists (select 1 from information_schema.columns
      where table_schema='public' and table_name=t and column_name='scraped_at');
    foreach f in array fields loop
      begin
        execute format($f$
          select count(*) filter (where raw.scraped_at > now() - interval '48 hours'),
                 avg((s.%1$I is not null)::int) filter (where raw.scraped_at > now() - interval '48 hours'),
                 avg((s.%1$I is not null)::int)
            from public.search_listings_ar s
            join public.%2$I raw on raw.id = s.listing_id
           where s.source_table = %3$L
             and s.deal_ar='إيجار' and s.rent_period_ar='سنوي' and s.type_ar='شقة' and s.production_ready
        $f$, f, t, t) into fresh_n, fresh_rate, all_rate;
      exception when undefined_column then continue; end;
      if fresh_n >= 20 and all_rate >= 0.20 and coalesce(fresh_rate, 0) < all_rate * 0.5 then
        total := total + 1;
        insert into public.location_pipeline_alerts(alert_type, metric, detail)
        values ('af_new_listing_capture_regression', fresh_n,
                format('%s: field %s known on %s%% of fresh 48h listings vs %s%% all-time — the '
                    || 'scraper likely stopped capturing it; new listings are arriving blind to the '
                    || 'Advanced Filter.', t, f, round(coalesce(fresh_rate,0)*100), round(all_rate*100)));
      end if;
    end loop;
  end loop;

  return total;
end
$fn$;

-- daily, chained onto the existing 06:52 barrier slot (worker-starvation rule: reuse slots)
do $$
declare cur text;
begin
  select command into strict cur from cron.job where jobname = 'mon-rich-attrs-barrier';
  if cur not like '%mon_af_new_listing_readiness%' then
    perform cron.alter_job((select jobid from cron.job where jobname='mon-rich-attrs-barrier'),
      command => rtrim(btrim(cur),';') || '; select public.mon_af_new_listing_readiness();');
  end if;
  select command into strict cur from cron.job where jobname = 'mon-rich-attrs-barrier';
  if cur not like '%mon_rich_attrs_barrier%' or cur not like '%mon_af_new_listing_readiness%' then
    raise exception 'cron edit lost a call: %', cur;
  end if;
end $$;

do $$
declare v int;
begin
  v := public.mon_af_new_listing_readiness();
  if v <> 0 then raise exception 'new-listing readiness reports % violations at install — investigate before trusting', v; end if;
end $$;
