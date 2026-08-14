-- AF new-listing readiness barrier: DELIVER, and cover the age-registry gap (2026-08-15).
--
-- Two defects found while auditing "a brand-new إيجار/سنوي/شقة listing inherits everything with
-- zero human action":
--
--  (1) SILENT BARRIER. mon_af_new_listing_readiness() wrote its findings ONLY to
--      public.location_pipeline_alerts. Verified this session: no function, view, trigger or
--      workflow READS that table (alert-dispatch.yml reads public.alert_event; mon_dispatch_alerts()
--      reads public.alert_event; location_pipeline_monitor() is the only function that touches both
--      and it escalates just its own price_gate_withheld check). So the barrier fired into a
--      write-only log. It now ALSO raises through mon_raise() — the same P1/P2 channel that becomes
--      a GitHub issue — and self-resolves through mon_resolve_key() when the condition clears.
--      The location_pipeline_alerts rows are kept unchanged (dashboard history).
--
--  (2) AGE REGISTRY IS MANUAL AND UNWATCHED. public.age_source_registry is referenced by exactly
--      one function (rebuild_age_producer) and by nothing else — no monitor. A platform that STARTS
--      publishing property_age but has no registry row never reaches the age chips: source says a
--      value, the interview says "unknown", and only a human adding a row fixes it. Live example at
--      the time of writing: eastabha_residential_listings has active rows carrying property_age and
--      contributes 0 rows to listing_age_resolved. New check fires per platform, deduped.
--
-- Barrier semantics unchanged otherwise. Proven by mutation test (deliberate break => fires,
-- rolled back) before and after this change.
CREATE OR REPLACE FUNCTION public.mon_af_new_listing_readiness()
 RETURNS integer
 LANGUAGE plpgsql
AS $function$
declare
  total int := 0; def text; missing text; t text; fresh_n bigint; r record;
  fields constant text[] := array['air_conditioner','elevator','kitchen','private_entrance',
    'parking','maid_room','driver_room','furnished','bathrooms','property_age'];
  f text; all_rate numeric; fresh_rate numeric;
  raw_aged bigint; resolved_aged bigint;
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
    perform public.mon_raise('P1','af_new_listing_unmapped_platform','search_index',
      'af_new_listing_unmapped_platform',
      jsonb_build_object('platforms', missing,
        'why','Annual Rent -> Apartment platforms with no listing_extra_attrs branch: their NEW '
            || 'listings are searchable but arrive blind to every Advanced-Filter chip.'));
  else
    perform public.mon_resolve_key('af_new_listing_unmapped_platform','af_new_listing_unmapped_platform');
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
        perform public.mon_raise('P2','af_new_listing_capture_regression', t,
          'af_new_listing_capture_regression:'||t||':'||f,
          jsonb_build_object('source_table', t, 'field', f, 'fresh_48h_rows', fresh_n,
            'fresh_known_pct', round(coalesce(fresh_rate,0)*100),
            'alltime_known_pct', round(all_rate*100),
            'why','Annual Rent -> Apartment: this field stopped arriving on new listings.'));
      else
        perform public.mon_resolve_key('af_new_listing_capture_regression',
          'af_new_listing_capture_regression:'||t||':'||f);
      end if;
    end loop;
  end loop;

  -- C. the source publishes an age, the pipeline drops all of it (age_source_registry is a MANUAL
  --    table with no other monitor). Fires only when raw has ages AND none reach listing_age_resolved,
  --    so a genuinely age-silent platform stays quiet.
  for t in select distinct s.source_table from public.search_listings_ar s
            where s.deal_ar='إيجار' and s.rent_period_ar='سنوي' and s.type_ar='شقة' and s.production_ready
  loop
    begin
      execute format('select count(*) from public.%I where active and property_age is not null', t)
        into raw_aged;
    exception when undefined_column or undefined_table then continue; end;
    select count(*) into resolved_aged
      from public.listing_age_resolved a where a.source_table = t;
    -- >= 20 is the same noise floor part B already uses. A 2-row trickle (eastabha today) is below
    -- age_source_health()'s own 'too_small' verdict, so registering it would change nothing and the
    -- alert could never be closed — exactly the un-actionable noise the 2026-08-12 issue flood was.
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
