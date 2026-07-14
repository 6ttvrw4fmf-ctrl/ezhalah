-- =============================================================================================
-- Eaqar Tabuk (eaqartabuk) price-fidelity repair — 2026-07-14
-- NOT EXECUTED. Written for human review only. Do not run against production without approval.
-- =============================================================================================
--
-- CONTEXT
-- -------
-- Investigation: PR / branch fix/eaqartabuk-price-parsing-2026-07-14, code fix already committed
-- in scrapers/eaqartabuk/run.py (_price() + new _price_on_request()).
--
-- Two separate bug classes were investigated for the eaqartabuk platform:
--
--   BUG 2 (monthly-rent-stored-raw-instead-of-annualized, PR #68 / commit a1d8f3f, merged to
--   origin/main BEFORE this branch was cut): ALL 96 backed-up eaqartabuk rows
--   (ops_price_repair_backup_20260713, source_table like 'eaqartabuk%') were re-verified live
--   against the production DB on 2026-07-14 and are ALREADY CORRECT — the daily
--   small-sources-sync.yml cron re-scraped every one of them after PR #68 merged, and the full-row
--   upsert overwrote the old bad value with the correctly-annualized one (old_value × 12, in every
--   single case). See verification query below. NO UPDATE STATEMENTS ARE NEEDED OR INCLUDED for
--   BUG 2 — there is nothing left to repair. This script exists only for BUG 3.
--
--   Verification query (read-only, run again before/after applying this script to reconfirm):
--     SELECT b.source_table, b.listing_id, b.price_annual_old, b.bug,
--            COALESCE(r.price_annual, c.price_annual) AS annual_now
--     FROM ops_price_repair_backup_20260713 b
--     LEFT JOIN eaqartabuk_residential_listings r
--       ON r.id = b.listing_id AND b.source_table = 'eaqartabuk_residential_listings'
--     LEFT JOIN eaqartabuk_commercial_listings c
--       ON c.id = b.listing_id AND b.source_table = 'eaqartabuk_commercial_listings'
--     WHERE b.source_table LIKE 'eaqartabuk%'
--       AND COALESCE(r.price_annual, c.price_annual) IS DISTINCT FROM b.price_annual_old * 12;
--     -- Expected result as of 2026-07-14: 0 rows (all 96 self-healed).
--
--   BUG 3 (fabricated on-request price, found during this investigation, NOT previously known/
--   backed up anywhere): some eaqartabuk listings carry NO real price — the source description
--   literally states the price depends on the tenant's business activity and/or contract term
--   ("السعر حسب النشاط ومدة العقد" / "السعر حسب مدة العقد"), but meta.price still holds a non-zero
--   placeholder digit that the old code's magnitude heuristic turned into a fabricated real-looking
--   price. A DB-wide LIKE sweep for '%السعر حسب%' (and several other on-request phrasings —
--   '%عند التواصل%', '%يحدد لاحق%', '%السعر يحدد%', '%حسب الاستخدام%') across BOTH
--   eaqartabuk_residential_listings and eaqartabuk_commercial_listings found exactly 3 matching
--   rows total. One (598631 / ET7327) was already NULL because its raw meta.price was "0" (the
--   pre-existing v<=0 guard already handled it correctly — confirmed live, id 7327 → meta.price="0").
--   The other two are the fabricated-price rows repaired below.
--
-- LIVE VERIFICATION (performed 2026-07-14, this session — raw source quoted verbatim)
-- -------------------------------------------------------------------------------------------
-- Row 598534 (ad_number ET8092, eaqartabuk internal id 8092):
--   GET https://eaqartabuk.com/wp-json/candles-map/v1/property/8092
--     {"id":8092,...,"price":"150000","price_number":150000,"status":"إيجار",...}
--   GET https://eaqartabuk.com/wp-json/public/v1/property/8092
--     {"content":"<p>ارض بحي ملحق الرابية تجاري للاستثمار مساحة 910م شارعين واجهة 42م
--                  السعر حسب النشاط ومدة العقد رقم 121<\/p>\n", "meta":{"price":"150000",...}}
--   → source explicitly states price depends on activity/contract term; "150000" is not a real
--     quoted price. Correct value: NULL (price_total, price_annual, rent_period all unknown).
--
-- Row 598548 (ad_number ET7917, eaqartabuk internal id 7917):
--   GET https://eaqartabuk.com/wp-json/candles-map/v1/property/7917
--     {"id":7917,...,"price":"150","price_number":150,"status":"إيجار",...}
--   GET https://eaqartabuk.com/wp-json/public/v1/property/7917
--     {"content":"<p>ارض بحي الريان مساحة 593م شارعين السعر حسب النشاط ومدة العقد<\/p>\n",
--      "meta":{"price":"150",...}}
--   → same pattern; "150" is not a real quoted price. Correct value: NULL.
--
-- Both rows currently live (checked via execute_sql, 2026-07-14):
--   598534: price_total=NULL, price_annual=150000, price_per_meter=NULL, rent_period='annual',
--           transaction_type='Rent', area_m2=910, active=true
--   598548: price_total=NULL, price_annual=1800,   price_per_meter=NULL, rent_period='monthly',
--           transaction_type='Rent', area_m2=593,  active=true
--   (price_per_meter is already NULL in both — it's derived from price_total, which was already
--   NULL, so no separate repair needed there.)
--
-- transaction_type is NOT touched: "Rent" vs "Buy" comes from the source's own operation/status
-- field (a separate, reliable signal — status="إيجار" for both), independent of whether a price
-- figure exists. Only the fabricated price/rent_period is corrected to NULL/unknown.
--
-- NEEDS MANUAL ATTENTION (excluded from UPDATEs below — do NOT infer a value for these):
--   • None for this batch. All rows identified by the on-request-phrasing sweep were either
--     already NULL (598631/ET7327, no action needed) or live-re-verified above (598534, 598548).
--   • If a future sweep finds additional "السعر حسب ..." rows, live-refetch
--     https://eaqartabuk.com/wp-json/public/v1/property/{internal_id} for each before adding it to
--     an UPDATE batch here — never assume the same fabricated-value pattern applies without
--     checking that specific row's source page.
--
-- =============================================================================================

-- -----------------------------------------------------------------------------------------------
-- STEP 1 — Backup (additive, create-if-not-exists). Captures pre-repair state of the 2 rows this
-- script touches so the repair is reversible. Distinct table name from the 2026-07-13 BUG2 backup
-- (that one already fully served its purpose — all 96 rows self-healed, nothing to restore from
-- it) to avoid any ambiguity about which bug class a given backup row belongs to.
-- -----------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ops_price_repair_backup_20260714 (
    source_table        text NOT NULL,
    listing_id           bigint NOT NULL,
    ad_number            text,
    price_total_old      bigint,
    price_annual_old     bigint,
    price_per_meter_old  integer,
    rent_period_old      text,
    transaction_type_old text,
    active_old           boolean,
    bug                  text NOT NULL,          -- 'BUG3_ON_REQUEST_PRICE_FABRICATED'
    backed_up_at         timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (source_table, listing_id, bug)
);

INSERT INTO ops_price_repair_backup_20260714
    (source_table, listing_id, ad_number, price_total_old, price_annual_old, price_per_meter_old,
     rent_period_old, transaction_type_old, active_old, bug)
SELECT 'eaqartabuk_residential_listings', id, ad_number, price_total, price_annual, price_per_meter,
       rent_period, transaction_type, active, 'BUG3_ON_REQUEST_PRICE_FABRICATED'
FROM eaqartabuk_residential_listings
WHERE id IN (598534, 598548)
ON CONFLICT (source_table, listing_id, bug) DO NOTHING;

-- -----------------------------------------------------------------------------------------------
-- STEP 2 — Repair batch 1 of 1 (2 rows — well under the 25-row batch cap).
-- Both rows are eaqartabuk_residential_listings; no commercial rows matched the on-request sweep
-- with a non-null fabricated price (the one commercial-adjacent-pattern hit, 598631, was already
-- NULL — see header). Corrected value for both: price_annual/price_total/rent_period → NULL.
-- transaction_type is left as 'Rent' (see header — sourced independently, still reliable).
-- -----------------------------------------------------------------------------------------------
-- guard: only touch a row if it is still in the exact fabricated state observed above; if a
-- re-scrape already changed it (e.g. the source later published a real number), do nothing to it.
UPDATE eaqartabuk_residential_listings
SET price_total = NULL,
    price_annual = NULL,
    price_per_meter = NULL,
    rent_period = NULL
WHERE (id = 598534 AND price_annual = 150000 AND rent_period = 'annual')
   OR (id = 598548 AND price_annual = 1800 AND rent_period = 'monthly');

-- -----------------------------------------------------------------------------------------------
-- STEP 3 — Post-repair verification (read-only; run after applying STEP 2)
-- -----------------------------------------------------------------------------------------------
-- SELECT id, ad_number, price_total, price_annual, price_per_meter, rent_period, transaction_type
-- FROM eaqartabuk_residential_listings WHERE id IN (598534, 598548);
-- Expected: price_total=NULL, price_annual=NULL, price_per_meter=NULL, rent_period=NULL,
--           transaction_type='Rent' (unchanged) for both rows.
