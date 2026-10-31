-- price_fidelity() and the aqar «index_price_differs_from_raw» check expect the SERVED price rules, not the raw figure
-- (🔧 Quality & Repair, 2026-10-31; backlog 2290 / alerts price_drift:* 11605 12249 12254 12310 12311 12312,
-- price_size_contamination:index_price_differs_from_raw:aqar 11710).
--
-- Measured 2026-10-31 12:47 UTC: price_fidelity_snapshot read confirmed_stuck = 701 (dealapp 658, muhaysini 33, aqar 4,
-- wasalt 3, bossbih 2, aqaratikom 1). Every sampled row had the same shape — source price_total 52,000,000,000 beside a
-- served 260,000; 1,152,251,500 beside 576,125 — i.e. served = the figure the seller typed into the «سعر المتر» box,
-- exactly what enforce_price_size_sanity() writes under the owner's 2026-10-28 rule (price_typed_in_meter_box_ar(),
-- ceiling 100,000 SAR/m² since 20261030235606). The detector compared the RAW source total with the served total, so the
-- served rule read as «the sync had the value and did not write it» and six price_drift alarms (one P1) sat on the owner's
-- own rule. Same blind spot as 20261030135112 (which taught price_fidelity() the rent ×12 rule), now for sale.
--
-- Fix: price_fidelity() computes the EXPECTED sale total the way the trigger does — the meter-box fix when it applies and
-- is not itself impossible, else the raw total — and runs the mirror-drop on that expected figure (trigger order).
-- The aqar «index_price_differs_from_raw» check in mon_price_size_fidelity_barrier() compared s.price_annual with the raw
-- a.price_annual, so every aqar monthly rent served ×12 under the cheap-«yearly» rule (ARCHITECTURE §20) counted as
-- contamination (4,877 rows on alert 11710); it now expects rent_price_annual_ar(), the same function the sync serves.
-- PRICE = SOURCE is untouched: no source table is written; only what the detectors EXPECT changes.
--
-- PROOF (read, never hand-run the detector): the :47 mon_detect_price_fidelity run after this apply must write
-- confirmed_stuck well under 701 and resolve price_drift:<platform> by its own loop; the daily price_size_contamination
-- slot must drop 'index_price_differs_from_raw:aqar' from its live keys.

create or replace function public.price_fidelity()
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_last_sync timestamptz; v_sync_recent boolean; v_result jsonb;
begin
  -- ops_incident #37: "the cron job succeeded" is NOT "the sync wrote". Read the writer's own
  -- record, which sync_search_listings_ar() writes only past its single-writer lock gate.
  select refreshed_at into v_last_sync
    from public.mon_mv_refresh_log where object_name = 'search_listings_ar_sync_pass';
  v_sync_recent := v_last_sync is not null and v_last_sync > now() - interval '90 minutes';

  with src as (
    select v.platform, v.source_table, v.listing_id,
           -- EXPECTED, not raw: the pair the sanity trigger would leave behind. Without this the
           -- trigger's own deliberate mirror-drop reads as drift (see this migration's header).
           -- 2026-10-31: the SALE total is the trigger's expected figure too — the seller's «سعر المتر»
           -- box when price_typed_in_meter_box_ar() fires (owner 2026-10-28), else the raw total.
           case when public.price_inapplicable_mirror(d.deal_ar, e.total, v.price_annual) = 'price_total'
                then null else e.total end  as src_total,
           case when public.price_inapplicable_mirror(d.deal_ar, e.total, v.price_annual) = 'price_annual'
                then null else public.rent_price_annual_ar(v.platform, v.rent_period, v.price_annual, v.property_type) end as src_annual
      from public.listing_native_location_v2 v
      cross join lateral (
        select case when lower(v.transaction_type)='buy' then 'بيع'
                    when lower(v.transaction_type)='rent' then 'إيجار' end as deal_ar,
               public.price_typed_in_meter_box_ar(v.price_total, v.area_m2, v.price_per_meter, v.city_ar,
                                                  v.source_table like '%commercial%') as fix
      ) d
      cross join lateral (
        select case when d.deal_ar = 'بيع' and d.fix is not null
                     and not public.price_size_impossible(d.fix, v.price_annual, v.area_m2)
                    then d.fix else v.price_total end as total
      ) e
  ),
  mm as (
    select s.platform, s.source_table, s.listing_id,
           s.price_total as idx_total, s.price_annual as idx_annual,
           x.src_total, x.src_annual,
           exists (
             select 1 from public.ops_price_drift_probe p
              where p.source_table = s.source_table
                and p.listing_id   = s.listing_id
                and public.price_drift_confirmed(
                      p.src_total, p.src_annual, p.sync_pass_at,
                      x.src_total, x.src_annual, v_last_sync)) as confirmed
    from public.search_listings_ar s
    join src x on x.source_table = s.source_table and x.listing_id = s.listing_id
    where s.price_total  is distinct from x.src_total
       or s.price_annual is distinct from x.src_annual
  ),
  -- 'mismatches' counts LISTINGS, not platforms (ops_incident #36), and stays paired with
  -- 'by_platform' over the same set.
  agg as (
    select coalesce(sum(cnt), 0)::bigint as tot,
           coalesce(jsonb_object_agg(platform, cnt) filter (where platform is not null), '{}'::jsonb) as byp
      from (select platform, count(*) cnt from mm group by platform) q),
  cagg as (
    select coalesce(sum(cnt), 0)::bigint as tot,
           coalesce(jsonb_object_agg(platform, cnt) filter (where platform is not null), '{}'::jsonb) as byp
      from (select platform, count(*) cnt from mm where confirmed group by platform) q),
  samp as (
    select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) as j from (
      select source_table, listing_id,
             idx_total as search_price_total,   src_total  as source_price_total,
             idx_annual as search_price_annual, src_annual as source_price_annual
        from mm limit 10) x),
  csamp as (
    select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) as j from (
      select source_table, listing_id, platform,
             idx_total as search_price_total,   src_total  as source_price_total,
             idx_annual as search_price_annual, src_annual as source_price_annual
        from mm where confirmed limit 10) x)
  select jsonb_build_object(
    'mismatches', agg.tot, 'by_platform', agg.byp, 'samples', samp.j,
    'confirmed_stuck', cagg.tot,
    'confirmed_by_platform', cagg.byp,
    'confirmed_samples', csamp.j,
    'pending_lag', agg.tot - cagg.tot,
    'last_successful_sync_at', v_last_sync, 'sync_recent', v_sync_recent,
    'sync_evidence', 'mon_mv_refresh_log.search_listings_ar_sync_pass — the pass that actually ran the upsert, NOT cron job status',
    'source_of_truth', 'listing_native_location_v2, NORMALISED through price_inapplicable_mirror() so the sanity trigger''s own deliberate mirror-drop is not counted as drift, and through the SERVED rules (rent_price_annual_ar, price_typed_in_meter_box_ar) so a figure the index serves on purpose is not counted as drift',
    'confirmed_meaning', 'confirmed_stuck = an earlier observation saw this same source price, a sync pass has completed since, and the index still disagrees — so the sync had the value and did not write it. pending_lag = first sighting or the source moved again; the next pass is expected to converge it and is not a defect.',
    'measured_at', now())
    into v_result
  from agg, cagg, samp, csamp;

  return v_result;
end $function$;

create or replace function public.mon_price_size_fidelity_barrier()
 returns table(check_name text, platform text, n bigint, detail text)
 language sql
 stable
as $function$
  select 'zero_in_inapplicable_price_column'::text, s.platform, count(*)::bigint,
         'a 0 standing in for "not applicable" — the honest value is NULL'::text
  from public.search_listings_ar s
  where (s.deal_ar='بيع' and s.price_annual = 0) or (s.deal_ar='إيجار' and s.price_total = 0)
  group by s.platform having count(*) > 0

  union all
  -- Evidence-gated (run #25): a row adjudicated source-real in ops_price_eq_area_verified is
  -- excluded here exactly as it already is in mon_detect_price_eq_area_or_ppm. Anything NOT in that
  -- table still fires.
  select 'rate_stored_as_total', s.platform, count(*)::bigint,
         'price_total/area_m2 < 100 SAR/m² — a rate wearing the total column'
  from public.search_listings_ar s
  where s.deal_ar='بيع' and s.price_total is not null and s.price_per_meter is not null
    and s.price_total = s.price_per_meter and s.area_m2 > 0
    and s.price_total::numeric / s.area_m2 < 100
    and not exists (select 1 from public.ops_price_eq_area_verified v
                    where v.source_table = s.source_table and v.listing_id = s.listing_id)
  group by s.platform having count(*) > 0

  union all
  -- AREA LEAKED INTO PRICE — now over BOTH aqar tables via a UNION of their captures. Three signals
  -- must agree before a row is reported: area = price exactly, the spec table publishes no area, and
  -- no currency-marked figure exists in the capture. aqar 6594767 is deliberately NOT caught (it
  -- publishes «سعر المتر 1», so total = area legitimately and the figure is printed on the page).
  select 'area_leaked_into_price', s.platform, count(*)::bigint,
         'area = price exactly, no spec-table area, no priced token in the capture'
  from public.search_listings_ar s
  join (
    select id, 'aqar_residential_listings'::text tbl, source_capture from public.aqar_residential_listings
    union all
    select id, 'aqar_commercial_listings',           source_capture from public.aqar_commercial_listings
  ) a on a.id = s.listing_id and a.tbl = s.source_table
  where s.area_m2 is not null and s.area_m2 > 1000
    and s.area_m2 in (s.price_total, s.price_annual)
    and (regexp_match(split_part(coalesce(a.source_capture->>'source_text',''),'تفاصيل الإعلان',2),
                      'المساحة[\s:]{0,4}([0-9][0-9,٬]{0,12})'))[1] is null
    and (regexp_match(split_part(coalesce(a.source_capture->>'source_text',''),'تفاصيل الإعلان',1),
                      '([0-9][0-9,]{2,})\s*[§﷼]'))[1] is null
  group by s.platform having count(*) > 0

  union all
  select 'index_price_differs_from_raw', 'aqar', count(*)::bigint,
         'search_listings_ar price_annual differs from aqar_residential_listings'
  from public.search_listings_ar s
  join public.aqar_residential_listings a on a.id = s.listing_id
  where s.source_table = 'aqar_residential_listings'
    -- 2026-10-31: compare with the figure the index SERVES on purpose — rent_price_annual_ar() is the
    -- cheap-«yearly» ×12 rule (ARCHITECTURE §20) the sync applies — not the raw column, or every aqar
    -- monthly rent served ×12 reads as contamination (4,877 rows on alert 11710).
    and s.price_annual is distinct from public.rent_price_annual_ar('aqar', a.rent_period, a.price_annual, a.property_type)
    -- LAG GUARD (senior run #32, 2026-08-20): search_listings_ar is an hourly snapshot and
    -- aqar_residential_listings is rewritten continuously, so a row physically re-captured since the
    -- last sync has not had its turn yet and its "disagreement" is propagation, not contamination.
    -- 90 minutes = one hourly sync cycle (:14) + 30 min margin. A row quiet for longer that still
    -- disagrees IS the corruption class and still fires at P1.
    and greatest(coalesce(a.raw_captured_at, 'epoch'::timestamptz),
                 coalesce(a.last_seen_at,    'epoch'::timestamptz),
                 coalesce(a.scraped_at,      'epoch'::timestamptz)) < now() - interval '90 minutes'
  having count(*) > 0

  union all
  select 'area_differs_from_spec_block', 'aqar', count(*)::bigint,
         'stored area_m2 disagrees with «المساحة» inside the spec block'
  from (
    select a.area_m2,
           (regexp_match(split_part(a.source_capture->>'source_text','تفاصيل الإعلان',2),
                         'المساحة[\s:]{0,4}([0-9][0-9,٬]{0,12})(?:\.[0-9]+)?\s*م'))[1] r
    from public.aqar_residential_listings a
    where a.active and a.area_m2 is not null
      and coalesce(a.source_capture->>'source_text','') like '%تفاصيل الإعلان%'
  ) q
  where q.r is not null and q.area_m2 <> replace(replace(q.r,',',''),'٬','')::bigint
  having count(*) > 0
$function$;
