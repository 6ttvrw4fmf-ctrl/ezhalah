-- PERF: check B ran one GROUP-BY join per (table x field) = ~180 scans; on a loaded box the
-- function flirted with statement timeouts (observed 2026-08-15 13:14 during the hourly sync).
-- Same semantics, one scan per table: all 10 fields aggregated in a single pass into jsonb,
-- thresholds/keys/waivers unchanged. ~18 scans total.
create or replace function public.mon_af_new_listing_readiness()
returns integer language plpgsql as $function$
declare
  total int := 0; def text; missing text; t text; seg record;
  fields constant text[] := array['air_conditioner','elevator','kitchen','private_entrance',
    'parking','maid_room','driver_room','furnished','bathrooms','property_age'];
  f text; sel text; fresh_rate numeric; all_rate numeric;
  raw_aged bigint; resolved_aged bigint;
begin
  -- A. every cohort platform must have a listing_extra_attrs branch
  select pg_get_viewdef('public.listing_extra_attrs'::regclass, true) into def;
  select string_agg(distinct s.source_table, ', ') into missing
    from public.search_listings_ar s
   where public.af_in_certified_cohort(s.deal_ar, s.rent_period_ar, s.type_ar) and s.production_ready
     and position(s.source_table in def) = 0;
  if missing is not null then
    total := total + 1;
    insert into public.location_pipeline_alerts(alert_type, metric, detail)
    values ('af_new_listing_unmapped_platform', 1,
            'Certified-cohort platforms with NO listing_extra_attrs branch (new listings '
         || 'cannot reach the interview chips): ' || missing);
    perform public.mon_raise('P1','af_new_listing_unmapped_platform','search_index',
      'af_new_listing_unmapped_platform',
      jsonb_build_object('platforms', missing,
        'why','Certified-cohort platforms with no listing_extra_attrs branch: their NEW '
            || 'listings are searchable but arrive blind to every Advanced-Filter chip.'));
  else
    perform public.mon_resolve_key('af_new_listing_unmapped_platform','af_new_listing_unmapped_platform');
  end if;

  -- B. capture regression on fresh listings, per COHORT SEGMENT x platform x interview field.
  -- Grouped per enabled registry row (pooled version masked دور 0% behind شقة 90% — live miss
  -- 2026-08-15). PROVEN source-side changes acknowledged in ops_amenity_capture_verified.
  select string_agg(format(
    '%L, jsonb_build_array(avg((s.%I is not null)::int) filter (where raw.scraped_at > now() - interval ''48 hours''), avg((s.%I is not null)::int))',
    x, x, x), ', ') into sel from unnest(fields) x;
  for t in select distinct s.source_table from public.search_listings_ar s
            where public.af_in_certified_cohort(s.deal_ar, s.rent_period_ar, s.type_ar) and s.production_ready
  loop
    continue when not exists (select 1 from information_schema.columns
      where table_schema='public' and table_name=t and column_name='scraped_at');
    for seg in execute format($f$
      select c.deal_ar, coalesce(c.rent_period_ar,'*') as period_key, c.type_ar,
             count(*) filter (where raw.scraped_at > now() - interval '48 hours') as fresh_n,
             jsonb_build_object(%s) as stats
        from public.search_listings_ar s
        join public.%I raw on raw.id = s.listing_id
        join public.af_cohort_registry c
          on c.enabled and c.deal_ar = s.deal_ar and c.type_ar = s.type_ar
         and (c.rent_period_ar is null or c.rent_period_ar = s.rent_period_ar)
       where s.source_table = %L and s.production_ready
       group by 1,2,3
    $f$, sel, t, t) loop
      foreach f in array fields loop
        fresh_rate := nullif(seg.stats->f->>0, '')::numeric;
        all_rate   := nullif(seg.stats->f->>1, '')::numeric;
        if seg.fresh_n >= 20 and all_rate >= 0.20 and coalesce(fresh_rate, 0) < all_rate * 0.5
           and not exists (select 1 from public.ops_amenity_capture_verified w
                            where w.source_table = t and w.field = f and w.deal_ar = seg.deal_ar
                              and w.rent_period_key = seg.period_key and w.type_ar = seg.type_ar) then
          total := total + 1;
          insert into public.location_pipeline_alerts(alert_type, metric, detail)
          values ('af_new_listing_capture_regression', seg.fresh_n,
                  format('%s: field %s known on %s%% of fresh 48h listings vs %s%% all-time in cohort '
                      || '%s/%s/%s — the scraper likely stopped capturing it; new listings in this '
                      || 'cohort are arriving blind to the Advanced Filter. If PROVEN source-side, '
                      || 'acknowledge in ops_amenity_capture_verified with evidence.',
                      t, f, round(coalesce(fresh_rate,0)*100), round(all_rate*100),
                      seg.deal_ar, seg.period_key, seg.type_ar));
          perform public.mon_raise('P2','af_new_listing_capture_regression', t,
            'af_new_listing_capture_regression:'||t||':'||f||':'||seg.deal_ar||':'||seg.period_key||':'||seg.type_ar,
            jsonb_build_object('source_table', t, 'field', f, 'deal_ar', seg.deal_ar,
              'rent_period_key', seg.period_key, 'type_ar', seg.type_ar,
              'fresh_48h_rows', seg.fresh_n,
              'fresh_known_pct', round(coalesce(fresh_rate,0)*100),
              'alltime_known_pct', round(all_rate*100),
              'why','This certified cohort segment: the field stopped arriving on new listings.'));
        else
          perform public.mon_resolve_key('af_new_listing_capture_regression',
            'af_new_listing_capture_regression:'||t||':'||f||':'||seg.deal_ar||':'||seg.period_key||':'||seg.type_ar);
        end if;
      end loop;
    end loop;
    -- retire the pre-2026-08-15 pooled key format so no stale open alert lingers
    foreach f in array fields loop
      perform public.mon_resolve_key('af_new_listing_capture_regression',
        'af_new_listing_capture_regression:'||t||':'||f);
    end loop;
  end loop;

  -- C. the source publishes an age, the pipeline drops all of it (age_source_registry is a MANUAL
  --    table with no other monitor). Fires only when raw has ages AND none reach listing_age_resolved,
  --    so a genuinely age-silent platform stays quiet.
  for t in select distinct s.source_table from public.search_listings_ar s
            where public.af_in_certified_cohort(s.deal_ar, s.rent_period_ar, s.type_ar) and s.production_ready
  loop
    begin
      execute format('select count(*) from public.%I where active and property_age is not null', t)
        into raw_aged;
    exception when undefined_column or undefined_table then continue; end;
    select count(*) into resolved_aged
      from public.listing_age_resolved a where a.source_table = t;
    if raw_aged >= 20 and resolved_aged = 0 then
      total := total + 1;
      insert into public.location_pipeline_alerts(alert_type, metric, detail)
      values ('af_age_source_unregistered', raw_aged,
              format('%s publishes property_age on %s active row(s) but contributes 0 rows to '
                  || 'listing_age_resolved — no age_source_registry entry, so the age chips call '
                  || 'every one of its listings "unknown" until a human adds one.', t, raw_aged));
      perform public.mon_raise('P2','af_age_source_unregistered', t,
        'af_age_source_unregistered:'||t,
        jsonb_build_object('source_table', t, 'raw_rows_with_age', raw_aged,
          'fix','insert the platform into public.age_source_registry (strategy/trusted), then '
             || 'rebuild_age_producer() picks it up on the next hourly run (jobid 46).'));
    else
      perform public.mon_resolve_key('af_age_source_unregistered','af_age_source_unregistered:'||t);
    end if;
  end loop;

  return total;
end
$function$;

do $do$
declare n int; t0 timestamptz := clock_timestamp(); secs numeric;
begin
  select public.mon_af_new_listing_readiness() into n;
  secs := round(extract(epoch from clock_timestamp() - t0)::numeric, 1);
  if n <> 0 then raise exception 'ABORT: readiness=% after single-scan rewrite (expected 0)', n; end if;
  if secs > 120 then raise exception 'ABORT: readiness took %s — still too slow for the 06:52 cron budget', secs; end if;
  raise notice 'SUCCESS: single-scan readiness clean in %s seconds', secs;
end $do$;