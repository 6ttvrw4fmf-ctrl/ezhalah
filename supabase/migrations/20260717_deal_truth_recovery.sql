-- ─────────────────────────────────────────────────────────────────────────────────────────
-- DEAL-TRUTH RECOVERY — follow-up to Batch 2's NULL-deal quarantine (owner: "Valid listings
-- missing from search because Buy/Rent is lost upstream — recover the valid ones").
-- STAGED 2026-07-16 on branch fix/null-deal-recovery. NOT applied to prod. Rehearsed
-- end-to-end in BEGIN..ROLLBACK against live prod 2026-07-16 (results at the bottom).
--
-- ── INVESTIGATION RESULT (all live 2026-07-16 ~19:30 UTC, read-only) ──
-- 1. The ~1,300 quarantined rows are ALREADY BACK IN SEARCH. Live: active_listing_ids_v2
--    = 185,627 = search_listings_ar total; rows missing from the index = 0; rows with
--    transaction_type NULL anywhere (all 70 *_listings tables, active AND inactive) = 0.
--    The scrapers were never the leak: every one of the 34 transaction_type writers maps
--    deal TOTALLY (binary "Rent" if … else "Buy", constant, or an all-constant-returns
--    helper — see scrapers/common/tests/test_deal_mapping_total.py, added on this branch).
--    Every row of the quarantined population carries write-evidence (raw_captured_at) from
--    its platform's regular 2026-07-16 early crawl (dealapp 04:25, gathern 05:03 UTC …)
--    with a valid Buy/Rent, and the hourly sync re-admitted it. Recovery of the original
--    population is complete; nothing here re-does it.
-- 2. WHERE the deal was actually being lost — the SQL location layer, not the scrapers:
--    listing_native_location_v1 (matview) hard-codes `NULL::text AS transaction_type` in
--    its phasea + legacy arms (11,235 NULL rows live, 1,322 of them active: dealapp_res
--    982 · gathern_res 281 · wasalt_res 30 · dealapp_com 20 · 9 others), with only stale
--    listing_location_canonical.purpose as a fallback. listing_native_location_v2 rescues
--    those via COALESCE against the live base row — but in the WRONG ORDER (defect B).
-- 3. TWO LIVE DEFECTS REMAIN in the deal-truth chain (this migration fixes both):
--    DEFECT A — 56 index rows still carry the pre-Batch-2 FABRICATED 'إيجار':
--      dealapp_res 54 · dealapp_com 1 · aqar_res 1. Base + v2 both say Buy; source titles
--      literally say "للبيع"/"For Sale" (verbatim evidence snapshotted below). They were
--      indexed in the era when the sync's CASE had `else 'إيجار'`, and the incremental
--      sync never re-touches them: they are buy/rent-ELIGIBLE (so the delete arm keeps
--      them) but deal drift is NOT a re-select trigger (only new-row / last_updated /
--      location drift are). Users find FOR-SALE listings inside Rent searches.
--    DEFECT B — v2's `COALESCE(v1.transaction_type, a.transaction_type)` lets a STALE
--      layer shadow live base truth: v1's value (matview refresh-lagged, or derived from
--      listing_location_canonical.purpose) wins whenever it is non-NULL. Live proof:
--      abeea_residential_listings id=638798 — base transaction_type='Buy', listing_url
--      '…/villa-for-sale-in-al-shaati-al-gharbi-district/', raw_captured_at 2026-07-16
--      12:34 UTC; llc.purpose='rent' (last_updated 2026-07-15) → v2 serves 'Rent', index
--      shows 'إيجار'. 1 live row today, unbounded class tomorrow (any deal flip on source
--      is shadowed until the canonical layer catches up).
--
-- ── THE FIX (two marked diffs + backup-first snapshot, everything else verbatim) ──
--  [DEAL-SRC]   listing_native_location_v2: flip the coalesce to prefer the LIVE base row
--               — COALESCE(a.transaction_type, v1.transaction_type). The platform tables
--               are raw truth (aggregator-fidelity rule); v1/llc is a location-resolution
--               layer and keeps working as the fallback (and Batch 2's quarantine remains
--               the backstop if both are ever NULL). Column list/order/types unchanged —
--               dependent views (platforms_deprecated_status, platforms_unsearchable) and
--               the 10 consumer functions are untouched; for all of them the view simply
--               becomes MORE truthful (today: exactly 1 row changes value).
--  [DEAL-DRIFT] sync_search_listings_ar(): deal drift becomes a re-select trigger — one
--               added arm in the s3 change-detection EXISTS. The first sync run after
--               apply re-selects exactly the 57 stale rows (56 + abeea via [DEAL-SRC]) and
--               the existing upsert relabels deal_ar (and recomputes rent_period_ar) from
--               v2 truth. SELF-HEALING: no manual UPDATE of the index, and any future deal
--               flip on source now propagates within one hourly sync. The quarantine
--               predicate, delete arm, and circuit breaker are byte-identical.
--
-- NEUTRALITY/FIDELITY: no listing row is modified, hidden, estimated, or re-ranked. Raw
-- platform tables are strictly read. Only the derived search index is relabeled, to match
-- the raw source exactly. Prices untouched (price-fidelity rule).
-- ─────────────────────────────────────────────────────────────────────────────────────────

-- ── 0 · BACKUP-FIRST (permanent repair standard): snapshot every index row whose deal_ar
--        currently disagrees with live base truth, with verbatim per-row source evidence.
--        Live 2026-07-16: exactly 57 rows, every one provable from its own base row
--        (listing_url/title verbatim below); rows without proof: 0. Idempotent.
create table if not exists public.ops_stale_deal_backup_20260716 as
select s.source_table,
       s.listing_id,
       s.deal_ar  as old_deal_ar,
       a.transaction_type as base_transaction_type_verbatim,
       case when lower(a.transaction_type)='buy'  then 'بيع'
            when lower(a.transaction_type)='rent' then 'إيجار' end as new_deal_ar,
       coalesce(d1.listing_url, d2.listing_url, d3.listing_url, d4.listing_url) as listing_url_evidence,
       left(coalesce(d1.title, d2.title, d3.title, d4.title), 160)              as title_evidence,
       now() as backed_up_at
from public.search_listings_ar s
join public.active_listing_ids_v2 a
  on a.source_table = s.source_table and a.listing_id = s.listing_id
left join public.dealapp_residential_listings d1
  on s.source_table = 'dealapp_residential_listings' and d1.id = s.listing_id
left join public.dealapp_commercial_listings d2
  on s.source_table = 'dealapp_commercial_listings'  and d2.id = s.listing_id
left join public.aqar_residential_listings d3
  on s.source_table = 'aqar_residential_listings'    and d3.id = s.listing_id
left join public.abeea_residential_listings d4
  on s.source_table = 'abeea_residential_listings'   and d4.id = s.listing_id
where s.deal_ar is distinct from
      (case when lower(a.transaction_type)='buy'  then 'بيع'
            when lower(a.transaction_type)='rent' then 'إيجار' end);

-- ── 1 · [DEAL-SRC] listing_native_location_v2 — live base row is the deal source of truth ──
-- Verbatim copy of the live 2026-07-16 definition (pg_get_viewdef) except the ONE marked
-- expression in the first arm. The souq24 arms and the catch-all arm already read the live
-- base/active rows directly and are unchanged.
create or replace view public.listing_native_location_v2 as
 SELECT v1.platform,
    v1.source_table,
    v1.listing_id,
    COALESCE(a.transaction_type, v1.transaction_type) AS transaction_type,  -- [DEAL-SRC] was COALESCE(v1.…, a.…): live base row first; v1/llc only as fallback; Batch 2 quarantine stays the backstop for double-NULL
    v1.region_id,
    v1.city_id,
    v1.city_ar,
    v1.district_ar,
    v1.region_ar,
    v1.source_method,
    v1.production_ready,
    v1.last_updated,
    a.property_type,
    a.price_total,
    a.price_annual,
    a.price_per_meter,
    a.area_m2,
    a.bedrooms,
    a.bathrooms,
    a.rent_period,
    ea.furnished,
    ea.property_age,
    ea.direction,
    ea.street_width_m,
    ea.floor_number,
    ea.tenant_category,
    ea.license_number,
    ea.elevator,
    ea.parking,
    ea.kitchen,
    ea.air_conditioner,
    ea.maid_room,
    ea.driver_room,
    ea.private_entrance
   FROM listing_native_location_v1 v1
     JOIN active_listing_ids_v2 a ON a.source_table = v1.source_table AND a.listing_id = v1.listing_id
     LEFT JOIN listing_extra_attrs ea ON ea.source_table = v1.source_table AND ea.listing_id = v1.listing_id
UNION ALL
 SELECT 'souq24'::text AS platform,
    'souq24_residential_listings'::text AS source_table,
    s.id AS listing_id,
    s.transaction_type,
    cc.region_id,
    cc.city_id,
    cm.city_ar,
    NULLIF(btrim(s.neighborhood), ''::text) AS district_ar,
    cm.region_ar,
    'inline_lookup'::text AS source_method,
    cc.region_id IS NOT NULL AND cc.city_id IS NOT NULL AS production_ready,
    s.last_seen_at AS last_updated,
    s.property_type,
    s.price_total,
    s.price_annual,
    s.price_per_meter,
    s.area_m2,
    s.bedrooms,
    s.bathrooms,
    s.rent_period,
    NULL::boolean AS furnished,
    NULL::smallint AS property_age,
    NULL::text AS direction,
    NULL::smallint AS street_width_m,
    NULL::integer AS floor_number,
    NULL::text AS tenant_category,
    NULL::text AS license_number,
    NULL::boolean AS elevator,
    NULL::boolean AS parking,
    NULL::boolean AS kitchen,
    NULL::boolean AS air_conditioner,
    NULL::boolean AS maid_room,
    NULL::boolean AS driver_room,
    NULL::boolean AS private_entrance
   FROM souq24_residential_listings s
     LEFT JOIN loc_city_map cm ON cm.city_key = lower(btrim(s.city))
     LEFT JOIN loc_catalog_region cr ON cr.region_ar = cm.region_ar
     LEFT JOIN LATERAL ( SELECT c2.city_id,
            c2.region_id
           FROM loc_catalog_city c2
          WHERE (normalize_ar(c2.city_ar) = normalize_ar(cm.city_ar) OR (EXISTS ( SELECT 1
                   FROM loc_catalog_city_alias al
                  WHERE al.alias_norm = normalize_ar(cm.city_ar) AND al.city_id = c2.city_id))) AND (cr.region_id IS NULL OR c2.region_id = cr.region_id)
          ORDER BY c2.city_id
         LIMIT 1) cc ON true
  WHERE s.active = true
UNION ALL
 SELECT 'souq24'::text AS platform,
    'souq24_commercial_listings'::text AS source_table,
    s.id AS listing_id,
    s.transaction_type,
    cc.region_id,
    cc.city_id,
    cm.city_ar,
    NULLIF(btrim(s.neighborhood), ''::text) AS district_ar,
    cm.region_ar,
    'inline_lookup'::text AS source_method,
    cc.region_id IS NOT NULL AND cc.city_id IS NOT NULL AS production_ready,
    s.last_seen_at AS last_updated,
    s.property_type,
    s.price_total,
    s.price_annual,
    s.price_per_meter,
    s.area_m2,
    s.bedrooms,
    s.bathrooms,
    s.rent_period,
    NULL::boolean AS furnished,
    NULL::smallint AS property_age,
    NULL::text AS direction,
    NULL::smallint AS street_width_m,
    NULL::integer AS floor_number,
    NULL::text AS tenant_category,
    NULL::text AS license_number,
    NULL::boolean AS elevator,
    NULL::boolean AS parking,
    NULL::boolean AS kitchen,
    NULL::boolean AS air_conditioner,
    NULL::boolean AS maid_room,
    NULL::boolean AS driver_room,
    NULL::boolean AS private_entrance
   FROM souq24_commercial_listings s
     LEFT JOIN loc_city_map cm ON cm.city_key = lower(btrim(s.city))
     LEFT JOIN loc_catalog_region cr ON cr.region_ar = cm.region_ar
     LEFT JOIN LATERAL ( SELECT c2.city_id,
            c2.region_id
           FROM loc_catalog_city c2
          WHERE (normalize_ar(c2.city_ar) = normalize_ar(cm.city_ar) OR (EXISTS ( SELECT 1
                   FROM loc_catalog_city_alias al
                  WHERE al.alias_norm = normalize_ar(cm.city_ar) AND al.city_id = c2.city_id))) AND (cr.region_id IS NULL OR c2.region_id = cr.region_id)
          ORDER BY c2.city_id
         LIMIT 1) cc ON true
  WHERE s.active = true
UNION ALL
 SELECT regexp_replace(a.source_table, '_(residential|commercial)_listings$'::text, ''::text) AS platform,
    a.source_table,
    a.listing_id,
    a.transaction_type,
    NULL::integer AS region_id,
    NULL::integer AS city_id,
    NULL::text AS city_ar,
    NULL::text AS district_ar,
    NULL::text AS region_ar,
    'unresolved_catchall'::text AS source_method,
    false AS production_ready,
    NULL::timestamp with time zone AS last_updated,
    a.property_type,
    a.price_total,
    a.price_annual,
    a.price_per_meter,
    a.area_m2,
    a.bedrooms,
    a.bathrooms,
    a.rent_period,
    NULL::boolean AS furnished,
    NULL::smallint AS property_age,
    NULL::text AS direction,
    NULL::smallint AS street_width_m,
    NULL::integer AS floor_number,
    NULL::text AS tenant_category,
    NULL::text AS license_number,
    NULL::boolean AS elevator,
    NULL::boolean AS parking,
    NULL::boolean AS kitchen,
    NULL::boolean AS air_conditioner,
    NULL::boolean AS maid_room,
    NULL::boolean AS driver_room,
    NULL::boolean AS private_entrance
   FROM active_listing_ids_v2 a
  WHERE (a.source_table <> ALL (ARRAY['souq24_residential_listings'::text, 'souq24_commercial_listings'::text])) AND NOT (EXISTS ( SELECT 1
           FROM listing_native_location_v1 v1
          WHERE v1.source_table = a.source_table AND v1.listing_id = a.listing_id));

-- ── 2 · [DEAL-DRIFT] sync_search_listings_ar() — deal drift is a re-select trigger ──
-- Verbatim copy of the live 2026-07-16 definition (pg_get_functiondef, byte-identical to
-- 20260716_batch2_search_truth.sql) except the ONE [DEAL-DRIFT] marked arm.
create or replace function public.sync_search_listings_ar()
 returns table(upserted bigint, deleted bigint)
 language plpgsql
as $function$
declare v_upserted bigint; v_deleted bigint; v_since timestamptz; v_del_pending bigint; v_total_now bigint; v_threshold bigint;
begin
  select coalesce(max(last_updated), now() - interval '30 days') - interval '2 hours'
    into v_since from search_listings_ar;
  insert into search_listings_ar (
    source_table, listing_id, platform, last_updated, region_id, city_id, region_ar, city_ar, district_ar,
    deal_ar, type_ar, rent_period_ar, price_total, price_annual, area_m2, bedrooms, bathrooms,
    furnished, property_age, direction_ar, tenant_ar, license_number, street_width_m, floor_number,
    elevator, parking, kitchen, air_conditioner, maid_room, driver_room, private_entrance, production_ready)
  select distinct on (v.source_table, v.listing_id)
    v.source_table, v.listing_id, v.platform, v.last_updated, v.region_id, v.city_id, v.region_ar, v.city_ar, v.district_ar,
    case when lower(v.transaction_type)='buy'  then 'بيع'
         when lower(v.transaction_type)='rent' then 'إيجار' end,  -- [DEAL] no else-branch: the eligibility predicate below guarantees buy|rent — nothing can silently become Rent again
    normalize(case
                when t.ar is not null then t.ar
                when v.property_type is null or btrim(v.property_type) = '' then 'غير معروف'  -- [TYPE] no raw type at all (0 live rows today; future-proofing)
                when v.property_type ~ '[A-Za-z]' then 'غير معروف'                            -- [TYPE] unmapped NON-Arabic raw (the 'Compound' leak): never Latin in the Arabic index
                else v.property_type                                                          -- [TYPE] unmapped but Arabic-native raw: by-design fall-through, unchanged
              end, NFC),
    case when lower(v.transaction_type)='rent' then
      case v.rent_period when 'monthly' then 'شهري' when 'annual' then 'سنوي' else null end end,
    v.price_total, v.price_annual, v.area_m2, v.bedrooms, v.bathrooms,
    case when v.source_table ~ '^(gathern|aqarmonthly)_' then true else v.furnished end,  -- [FURN] platform-rule derivation
    v.property_age,
    case when v.direction in ('شمال','جنوب','شرق','غرب','شمال شرقي','شمال غربي','جنوب شرقي','جنوب غربي','شمالية','جنوبية','شرقية','غربية') then v.direction end,
    case when v.tenant_category in ('عزاب','عوائل') then v.tenant_category end,
    v.license_number,
    v.street_width_m, v.floor_number,
    v.elevator, v.parking, v.kitchen, v.air_conditioner, v.maid_room, v.driver_room, v.private_entrance,
    v.production_ready
  from listing_native_location_v2 v
  left join type_label_ar t on t.en = v.property_type
  where lower(v.transaction_type) in ('buy','rent')   -- [DEAL] quarantine: unknown/NULL deals are not searchable at all (owner 2026-07-16)
    and (v.last_updated is null or v.last_updated > v_since
     or not exists (select 1 from search_listings_ar s2
                    where s2.source_table = v.source_table and s2.listing_id = v.listing_id)
     or exists (select 1 from search_listings_ar s3
                where s3.source_table = v.source_table and s3.listing_id = v.listing_id
                  and (s3.city_id is distinct from v.city_id
                       or s3.region_id is distinct from v.region_id
                       or s3.district_ar is distinct from v.district_ar
                       or s3.production_ready is distinct from v.production_ready
                       or s3.region_ar is distinct from v.region_ar
                       or s3.city_ar is distinct from v.city_ar
                       or s3.deal_ar is distinct from (case when lower(v.transaction_type)='buy'  then 'بيع'
                                                            when lower(v.transaction_type)='rent' then 'إيجار' end))))  -- [DEAL-DRIFT] a deal flip (or a pre-Batch-2 fabricated 'إيجار') re-selects the row; the upsert relabels deal_ar + rent_period_ar from v2 truth on the next hourly run
  order by v.source_table, v.listing_id, v.last_updated desc nulls last
  on conflict (source_table, listing_id) do update set
    platform=excluded.platform, last_updated=excluded.last_updated, region_id=excluded.region_id,
    city_id=excluded.city_id, region_ar=excluded.region_ar, city_ar=excluded.city_ar,
    district_ar=excluded.district_ar, deal_ar=excluded.deal_ar, type_ar=excluded.type_ar,
    rent_period_ar=excluded.rent_period_ar, price_total=excluded.price_total, price_annual=excluded.price_annual,
    area_m2=excluded.area_m2, bedrooms=excluded.bedrooms, bathrooms=excluded.bathrooms,
    furnished=excluded.furnished, property_age=excluded.property_age, direction_ar=excluded.direction_ar,
    tenant_ar=excluded.tenant_ar, license_number=excluded.license_number,
    street_width_m=excluded.street_width_m, floor_number=excluded.floor_number,
    elevator=excluded.elevator, parking=excluded.parking, kitchen=excluded.kitchen,
    air_conditioner=excluded.air_conditioner, maid_room=excluded.maid_room, driver_room=excluded.driver_room,
    private_entrance=excluded.private_entrance, production_ready=excluded.production_ready;
  get diagnostics v_upserted = row_count;

  -- [DEAL] the anti-join now requires an ELIGIBLE (buy|rent) v2 row, not mere presence: rows that
  -- vanish from v2 AND rows whose deal is/becomes unknown are both removed. Same circuit breaker
  -- as before (greatest(2000, 15%) of the index) still guards against a collapsed matview.
  select count(*) into v_del_pending from search_listings_ar s
    where not exists (select 1 from listing_native_location_v2 v
                      where v.source_table = s.source_table and v.listing_id = s.listing_id
                        and lower(v.transaction_type) in ('buy','rent'));
  select count(*) into v_total_now from search_listings_ar;
  v_threshold := greatest(2000::bigint, (v_total_now * 15 / 100));
  if v_del_pending > v_threshold then
    insert into public.location_pipeline_alerts(alert_type, metric, detail)
      values ('sync_delete_circuit_breaker', v_del_pending,
              format('Sync DELETE aborted: %s rows absent from v2 exceed threshold %s (index total %s). Likely a collapsed/failed matview refresh; rows kept stale-but-present instead of mass-deleted.', v_del_pending, v_threshold, v_total_now));
    v_deleted := 0;
  else
    delete from search_listings_ar s
      where not exists (select 1 from listing_native_location_v2 v
                        where v.source_table = s.source_table and v.listing_id = s.listing_id
                          and lower(v.transaction_type) in ('buy','rent'));
    get diagnostics v_deleted = row_count;
  end if;
  v_deleted := v_deleted + public.prune_inactive_from_search();

  perform refresh_district_name_bridge();
  perform refresh_city_name_bridge();
  return query select v_upserted, v_deleted;
end $function$;

-- ─────────────────────────────────────────────────────────────────────────────────────────
-- VERIFICATION (run after the first post-apply hourly sync, or run
-- `select * from sync_search_listings_ar();` once under the deploy lock):
--   -- 0 rows: no index deal may disagree with its live base row
--   select count(*) from search_listings_ar s
--     join active_listing_ids_v2 a
--       on a.source_table=s.source_table and a.listing_id=s.listing_id
--    where s.deal_ar is distinct from
--          (case when lower(a.transaction_type)='buy' then 'بيع'
--                when lower(a.transaction_type)='rent' then 'إيجار' end);       -- expect 0 (was 57)
--   -- the shadowed abeea row now shows its source truth
--   select deal_ar from search_listings_ar
--    where source_table='abeea_residential_listings' and listing_id=638798;    -- expect 'بيع'
--   -- v2 never disagrees with live base again
--   select count(*) from listing_native_location_v2 v
--     join active_listing_ids_v2 a
--       on a.source_table=v.source_table and a.listing_id=v.listing_id
--    where v.transaction_type is distinct from a.transaction_type;             -- expect 0 (was 1)
--   -- quarantine + coverage invariants unchanged
--   select (select count(*) from active_listing_ids_v2)
--        - (select count(*) from search_listings_ar);                          -- expect 0
--   select count(*) from ops_stale_deal_backup_20260716;                       -- expect 57
--
-- REHEARSED 2026-07-16 ~19:50 UTC against live prod — the exact statements above wrapped
-- in a single DO block that ends in RAISE EXCEPTION (guaranteed rollback; post-check
-- confirmed prod byte-identical afterwards: v2-vs-base back to 1, mismatches back to 57,
-- backup table absent). Measured inside the rehearsal:
--   backup rows = 57 · sync upserted = 2,450 (57 relabels + the regular incremental
--   window) · deleted = 0 · remaining index-vs-base deal mismatches = 0 (was 57) ·
--   abeea 638798 deal_ar = 'بيع' (was 'إيجار') · v2-vs-base disagreements = 0 (was 1) ·
--   index total = 185,627 (unchanged — relabel only, zero adds/removes) ·
--   active rows missing from index = 0 (quarantine untouched).
--
-- ROLLBACK: replace-only + one snapshot table — no data loss.
--   1. Restore the previous listing_native_location_v2 (flip [DEAL-SRC] back) and
--      sync_search_listings_ar() (drop the [DEAL-DRIFT] arm) from git history.
--   2. ops_stale_deal_backup_20260716 holds each relabeled row's exact prior deal_ar; a
--      reverse UPDATE from it restores the pre-fix index state if ever required.
--   3. drop table if exists public.ops_stale_deal_backup_20260716;  -- optional, after review
-- ─────────────────────────────────────────────────────────────────────────────────────────
