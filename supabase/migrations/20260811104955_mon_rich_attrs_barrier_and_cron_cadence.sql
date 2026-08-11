-- BARRIER for the rich-attrs path, plus the cron cadence that keeps it fed.
--
-- Four things can silently undo this work. Each gets a check:
--
--   A. listing_rich_attrs stops being 1:1 on (source_table, listing_id). Downstream resolves that
--      key with DISTINCT ON and no tiebreak, so a duplicate is not an error there — it silently
--      picks one branch arbitrarily. The sibling view listing_native_location_v2 already shipped
--      exactly this bug once (migration 20260809154813, souq24 double-emit, caught only as a "+2"
--      row-count gap). This is the check that fails loudly instead.
--
--   B. A platform starts contributing cohort rows with NO branch in the view. That is precisely the
--      defect just fixed for raghdan/abeea/eastabha: data captured, mapped nowhere, silently absent
--      from every filter. A new platform must alarm, not sit quiet for months.
--
--   C. The index drifts from the view — the state the whole fleet was in until today, when the 27
--      rich columns were maintained only by hand-run UPDATEs.
--
--   D. THE WIRING ITSELF DISAPPEARS. Removing a guard inverts its monitor: if someone edits cron
--      jobid 28 and drops the sync calls, checks A-C keep passing while the data quietly rots.
--      So the barrier asserts its own plumbing is still connected.
create or replace function public.mon_rich_attrs_barrier()
returns integer
language plpgsql
as $fn$
declare total int := 0; v int; missing text; def text; cmd text;
begin
  -- A. 1:1 key
  select count(*) into v from (
    select 1 from public.listing_rich_attrs group by source_table, listing_id having count(*) > 1
  ) q;
  if v > 0 then
    total := total + 1;
    insert into public.location_pipeline_alerts(alert_type, metric, detail)
    values ('rich_attrs_duplicate_key', v,
            format('listing_rich_attrs emits %s duplicated (source_table, listing_id) keys. '
                || 'Downstream DISTINCT ON will pick one arbitrarily instead of failing.', v));
  end if;

  -- B. cohort platform with no branch
  select pg_get_viewdef('public.listing_rich_attrs'::regclass, true) into def;
  select string_agg(distinct s.source_table, ', ') into missing
    from public.search_listings_ar s
   where s.deal_ar = 'إيجار' and s.rent_period_ar = 'سنوي' and s.type_ar = 'شقة'
     and s.production_ready
     and position(s.source_table in def) = 0;
  if missing is not null then
    total := total + 1;
    insert into public.location_pipeline_alerts(alert_type, metric, detail)
    values ('rich_attrs_platform_unmapped', 1,
            'Annual Rent -> Apartment platforms with NO listing_rich_attrs branch: ' || missing
            || '. Their captured rich fields cannot reach search.');
  end if;

  -- C. drift, per platform. Row-wise IS DISTINCT FROM compares all 27 columns NULL-safely.
  select count(*) into v
    from public.search_listings_ar s
    join public.listing_rich_attrs r
      on r.source_table = s.source_table and r.listing_id = s.listing_id
   where (s.ac_type, s.kitchen_status, s.furnishing_level, s.parking_count, s.parking_type,
          s.installment_available, s.installment_amount, s.installment_count,
          s.separate_electricity_meter, s.separate_water_meter, s.electricity, s.water_supply,
          s.sanitation, s.balcony, s.laundry_room, s.pool, s.gym, s.garden, s.living_rooms,
          s.majlis_rooms, s.total_floors, s.frontage_count, s.latitude, s.longitude,
          s.rega_license_status, s.postal_code, s.deed_location_text)
         is distinct from
         (r.ac_type, r.kitchen_status, r.furnishing_level, r.parking_count, r.parking_type,
          r.installment_available, r.installment_amount, r.installment_count,
          r.separate_electricity_meter, r.separate_water_meter, r.electricity, r.water_supply,
          r.sanitation, r.balcony, r.laundry_room, r.pool, r.gym, r.garden, r.living_rooms,
          r.majlis_rooms, r.total_floors, r.frontage_count, r.latitude, r.longitude,
          r.rega_license_status, r.postal_code, r.deed_location_text);
  if v > 0 then
    total := total + 1;
    insert into public.location_pipeline_alerts(alert_type, metric, detail)
    values ('rich_attrs_index_drift', v,
            format('%s listings whose rich columns disagree with listing_rich_attrs. '
                || 'sync_listing_rich_attrs() should have converged them.', v));
  end if;

  -- D. the plumbing
  select command into cmd from cron.job where jobid = 28 and active;
  if cmd is null or cmd not like '%sync_listing_rich_attrs%' then
    total := total + 1;
    insert into public.location_pipeline_alerts(alert_type, metric, detail)
    values ('rich_attrs_sync_unwired', 1,
            'cron jobid 28 no longer calls sync_listing_rich_attrs - the rich columns are back to '
         || 'being hand-maintained and will rot silently.');
  end if;
  if not exists (select 1 from cron.job
                  where active and command like '%sync_listing_rich_attrs%'
                    and command like '%wasalt%') then
    total := total + 1;
    insert into public.location_pipeline_alerts(alert_type, metric, detail)
    values ('rich_attrs_wasalt_sync_unwired', 1,
            'no active cron job syncs wasalt rich attrs (it is on its own daily slot because its '
         || 'branch costs ~19s and is too heavy for the hourly job).');
  end if;

  return total;
end
$fn$;

-- ── cadence ────────────────────────────────────────────────────────────────────
-- Measured no-op cost per platform: wasalt 18.6s (correlated subplans over its jsonb), every other
-- platform under 310ms. So the cheap eight run hourly and wasalt gets its own daily slot.
do $$
declare cur text; want text;
begin
  select command into cur from cron.job where jobid = 28;
  if cur is null or cur not like '%sync_search_listings_ar()%' then
    raise exception 'jobid 28 is not the search sync job - refusing to edit';
  end if;

  -- rebuild the tail deterministically instead of appending to whatever is there
  want := regexp_replace(cur, '\s*select public\.sync_listing_rich_attrs\([^)]*\);', '', 'g');
  want := rtrim(btrim(want), ';') || ';'
       || ' select public.sync_listing_rich_attrs(''aqar_residential_listings'');'
       || ' select public.sync_listing_rich_attrs(''sanadak_residential_listings'');'
       || ' select public.sync_listing_rich_attrs(''satel_residential_listings'');'
       || ' select public.sync_listing_rich_attrs(''aqarcity_residential_listings'');'
       || ' select public.sync_listing_rich_attrs(''dealapp_residential_listings'');'
       || ' select public.sync_listing_rich_attrs(''raghdan_residential_listings'');'
       || ' select public.sync_listing_rich_attrs(''abeea_residential_listings'');'
       || ' select public.sync_listing_rich_attrs(''eastabha_residential_listings'');';
  perform cron.alter_job(28, command => want);

  select command into cur from cron.job where jobid = 28;
  if cur not like '%sync_search_listings_ar()%' or cur not like '%refresh_rnpl_flags()%'
     or cur not like '%sync_payment_monthly()%' or cur not like '%eastabha_residential_listings%' then
    raise exception 'post-edit jobid 28 lost a call: %', cur;
  end if;
end $$;

-- wasalt daily, on a free minute (:47 — avoids the :00/:15/:20 hot minutes and every existing slot)
select cron.schedule('sync-rich-attrs-wasalt', '47 6 * * *',
  $$set statement_timeout to '600s'; select public.sync_listing_rich_attrs('wasalt_residential_listings');$$);

-- barrier daily, after the wasalt sync has had time to converge
select cron.schedule('mon-rich-attrs-barrier', '52 6 * * *',
  $$set statement_timeout to '600s'; select public.mon_rich_attrs_barrier();$$);
