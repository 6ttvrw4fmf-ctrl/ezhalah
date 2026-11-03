-- price_fidelity(): judge the inapplicable-column mirror the way the trigger does — against the SERVED annual
-- (🔧 Quality & Repair, 2026-10-31; follow-up to 20261031133334; backlog 1136; alert price_drift:wasalt 12254).
--
-- Measured 13:47 UTC after 20261031133334: confirmed_stuck 701 → 3, all three wasalt RENT rows of one shape —
-- source price_total 4,000 = price_annual 4,000 (rent_period annual; ar_data expectedRent 4000 yearly), served
-- price_annual 48,000 (the cheap-«yearly» ×12 rule, ARCHITECTURE §20) and served price_total 4,000.
-- enforce_price_size_sanity() runs price_inapplicable_mirror() on the row the sync hands it, whose price_annual is
-- ALREADY the served 48,000, so 4,000 ≠ 48,000 and the inapplicable price_total is kept (not an exact duplicate).
-- price_fidelity() ran the same mirror on the RAW pair (4,000 = 4,000 → drop → expected NULL) and so read the
-- trigger's own correct outcome as drift. One more served rule the detector must expect (same lesson as
-- 20261030135112 and 20261031133334): compute the served annual FIRST, then the mirror on (expected total, served annual).
-- PRICE = SOURCE untouched: nothing but what the detector EXPECTS changes.
--
-- PROOF: the next :47 mon_detect_price_fidelity run writes confirmed_stuck 3 → 0 and resolves price_drift:wasalt.

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
           -- box when price_typed_in_meter_box_ar() fires (owner 2026-10-28), else the raw total — and the
           -- mirror is judged against the SERVED annual (rent_price_annual_ar), exactly what the trigger sees.
           case when public.price_inapplicable_mirror(d.deal_ar, e.total, a.annual) = 'price_total'
                then null else e.total end  as src_total,
           case when public.price_inapplicable_mirror(d.deal_ar, e.total, a.annual) = 'price_annual'
                then null else a.annual end as src_annual
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
                    then d.fix else v.price_total end as total,
               public.rent_price_annual_ar(v.platform, v.rent_period, v.price_annual, v.property_type) as annual
      ) e
      cross join lateral (select e.annual) a
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
    'source_of_truth', 'listing_native_location_v2, NORMALISED through price_inapplicable_mirror() (judged on the SERVED annual, as the trigger sees it) so the sanity trigger''s own deliberate mirror-drop is not counted as drift, and through the SERVED rules (rent_price_annual_ar, price_typed_in_meter_box_ar) so a figure the index serves on purpose is not counted as drift',
    'confirmed_meaning', 'confirmed_stuck = an earlier observation saw this same source price, a sync pass has completed since, and the index still disagrees — so the sync had the value and did not write it. pending_lag = first sighting or the source moved again; the next pass is expected to converge it and is not a defect.',
    'measured_at', now())
    into v_result
  from agg, cagg, samp, csamp;

  return v_result;
end $function$;
