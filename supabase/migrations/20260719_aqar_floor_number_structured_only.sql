-- =============================================================================================
-- Aqar floor_number: structured-field-only parsing + validation + repair — 2026-07-19
-- =============================================================================================
-- DO NOT RUN STEP 3 (backfill) OR STEP 4 (VALIDATE CONSTRAINT) AGAINST PRODUCTION WITHOUT OWNER
-- SIGN-OFF (standing approval-workflow-rule). Steps 1-2 (function fix + NOT VALID constraints +
-- sync guard) are non-destructive and safe to apply on their own — they only change behavior for
-- FUTURE writes. Step 3 mutates ~27,000 existing rows (all reversible via the backup table it
-- creates). Step 4 only succeeds once Step 3 has run. Hold Steps 3-4 for explicit go-ahead.
--
-- ROOT CAUSE (full investigation in chat; not repeated here) — trigger `aqar_parse_bi` on both
-- aqar_residential_listings and aqar_commercial_listings calls aqar_parse(), whose floor_number
-- line was:
--     'floor_number', (regexp_match(_aqar_between(region, 'الدور'), '\d+'))[1]
-- _aqar_between() is a GENERIC label→next-label slicer built for Aqar's own structured "تفاصيل
-- الإعلان" attribute table. On ads that use that structured table it works correctly. On ads that
-- are free-text seller descriptions (individual/unlicensed sellers — the majority of the affected
-- rows), "الدور" appears conversationally, sometimes more than once, and the lazy capture runs into
-- whatever text sits nearby; a bare \d+ then grabs the first number in that unrelated span. Proven
-- live examples (verbatim, see chat transcript for the full source-text quotes): a comma-grouped
-- price truncated at the first group ("288,239 ريال" → 288), a mentioned area ("مساحة العقار 198.44"
-- → 198), a bare uncomma'd asking price ("الحد 1100000" → 1,100,000), a TV screen size ("شاشة تلفزيون
-- 50 بوصة" → 50), a parking-distance note ("على بعد ٢٠ م" → 20), a street width ("شارع 20م" → 20),
-- and an agent's own internal ad code ("كود 20" → 20). A live distribution check additionally found
-- a spike at round numbers (20/25/30/40/50/60) INSIDE the "sane" 0-60 range — truncated round rent
-- figures — proving a plain range filter alone would not catch everything; it must be paired with
-- the parser fix.
--
-- THE FIX — floor_number is now accepted ONLY when _aqar_between(region,'الدور')'s captured span is
-- an EXACT match (nothing else in the span — no extra words, punctuation, or emoji) against Aqar's
-- own structured-dropdown vocabulary, confirmed against ~8,300 live rows with a REGA license number
-- (a signal, not the proof — see below):
--   أرضي / الأرضي              → 0   (ground)
--   علوي / العلوي              → NULL (ambiguous — "upper", no specific level; PER OWNER INSTRUCTION,
--                                       ambiguous structured values are NULL, never guessed)
--   \d{1,2} in [0,60]           → that digit (bounded; the DB CHECK constraint enforces this too)
--   الأول / الاول               → 1
--   الثاني/الثالث/الرابع/الخامس/السادس/السابع/الثامن/التاسع/العاشر → 2..10
--   anything else (free text, multi-word, decorated)              → NULL
-- license_number presence is NOT used as the gate (owner instruction — it's a correlated signal,
-- not proof: a sampled free-text ad WAS found carrying a license number yet still had emoji/prose
-- immediately after "الدور", and was correctly rejected by the exact-match rule regardless of its
-- license). _aqar_between() ITSELF is intentionally left untouched — it is shared by ~15 other
-- fields (direction, license_number, ad_source, plan_parcel, ...) with no reported issue; touching
-- it would be a much larger blast radius than this fix requires. Only the floor_number line changes.
--
-- VERIFIED (read-only, live, 2026-07-19; full numbers + per-row examples in chat):
--   - 16/16 synthetic unit cases (ground/upper/digit/ordinal/boundary/price-leak/area-leak/
--     huge-bare-number/trailing-junk/emoji) matched the intended outcome exactly.
--   - 20/20 manually-inspected "was non-null, now NULL" residential rows were independently
--     confirmed to be genuine free-text corruption (age mistaken for floor, bedroom count, TV size,
--     rent price, section headers in multi-floor villa descriptions) — zero false rejections found.
--   - aqar_residential_listings, floor_number IS NOT NULL (8,362 rows): 1,228 already fail the
--     simple 0-60 range test; of the full 8,362, only 2,143 survive the new structured-only check
--     UNCHANGED (never a different number — confirmed empirically: 0 rows land on a new, DIFFERENT
--     non-null value; a row either keeps its exact old value or becomes NULL); 6,219 become NULL.
--   - Recovery in the other direction: of 18,845 rows currently NULL that mention "الدور" somewhere,
--     2,560 have a genuinely clean structured value (mostly أرضي=0) and would be RECOVERED.
--   - Net residential non-null: 8,362 → 4,703 (old 8,362 was ~15% obviously-impossible plus a
--     further undetermined slice of round-number camouflage; new 4,703 is structurally verified).
--   - By property type, Buy-only, ACTIVE listings only (matches the app's live search index scope):
--       Apartment: old 1,617 → new 1,321 (bucketed: ground 526 / 1-3 641 / 4-7 130 / 8+ 24 — all
--         4 buckets clear MIN_REAL_BUCKET_COUNT=5; a Floor Number filter remains VIABLE for Apartment)
--       Floor:     old   951 → new   649 (bucketed: ground 588 / 1-3 50 / 4-7 10 / 8+ 1 — 90.6% is
--         ground floor; the upper 3 buckets are too thin/skewed for a meaningful 4-bucket filter)
--       Building:  old   203 → new     2 (villas/whole-building listings don't have a single "which
--         floor" concept — a Residential Building Floor Number filter is NOT viable, essentially 0
--         trustworthy rows)
--   - Villa collapses from 2,525 (Buy+Rent) to 8 for the identical structural reason as Building.
--   - aqar_commercial_listings: only 71 rows had floor_number at all; garbage there was 42/71 (59%,
--     worse than residential) — same shared trigger/function, same fix applies to both tables.
-- =============================================================================================

begin;

-- ---------------------------------------------------------------------------------------------
-- STEP 1: fix the parser. Every line below is byte-identical to the LIVE aqar_parse() definition
-- (pulled via pg_get_functiondef immediately before writing this migration) EXCEPT the new v_dor
-- declaration and the floor_number CASE — nothing else in this function changes.
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.aqar_parse(txt text)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
declare
  region text; head text; prices bigint[]; v_disc int; v_price bigint; v_orig bigint; v_area int;
  v_dor text;
begin
  if txt is null then return '{}'::jsonb; end if;
  txt := translate(txt, '٠١٢٣٤٥٦٧٨٩', '0123456789');
  region := coalesce(substring(txt from 'تفاصيل الإعلان(.*)'), txt);
  head   := split_part(txt, 'تفاصيل الإعلان', 1);

  select array_agg(v order by ord) into prices from (
     select round((regexp_replace((t.g)[1], ',', '', 'g'))::numeric)::bigint as v, ord
     from regexp_matches(head, '(\d[\d,]*(?:\.\d+)?)\s*(?:§|ريال|﷼)', 'g') with ordinality as t(g, ord)
  ) s where v > 0;
  v_disc := nullif(substring(head from 'خصم\s*(\d+)\s*%'), '')::int;
  if v_disc is not null and coalesce(array_length(prices,1),0) >= 2 then v_orig := prices[1]; v_price := prices[2];
  elsif coalesce(array_length(prices,1),0) >= 1 then v_price := prices[1]; end if;

  v_area := nullif(regexp_replace(coalesce((regexp_match(_aqar_between(region, 'المساحة(?!\s*حسب)'), '\d[\d,]*'))[1], ''), ',', '', 'g'), '')::int;

  -- floor_number (2026-07-19 fix): accept ONLY an EXACT match against Aqar's own structured-field
  -- vocabulary for "الدور" — nothing else in the captured span. See migration header for the full
  -- root-cause writeup and the live evidence behind this exact allowlist.
  v_dor := _aqar_between(region, 'الدور');

  return jsonb_strip_nulls(jsonb_build_object(
    'direction',        _aqar_between(region, 'الواجهة'),
    'last_update',      _aqar_between(region, 'آخر تحديث'),
    'date_added',       substring(_aqar_between(region, 'تاريخ الإضافة') from '\d{2}/\d{2}/\d{4}'),
    'license_number',   (regexp_match(_aqar_between(region, 'رخصة الإعلان'), '\d{6,}'))[1],
    'license_expiry',   substring(_aqar_between(region, 'تاريخ نهاية الترخيص') from '\d{2}/\d{2}/\d{4}'),
    'ad_source',        _aqar_between(region, 'مصدر الإعلان'),
    'plan_parcel',      coalesce(_aqar_between(region, 'المخطط و القطعة'), _aqar_between(region, 'المخطط والقطعة')),
    'deed_area_m2',     regexp_replace(coalesce((regexp_match(_aqar_between(region, 'المساحة حسب الصك'), '\d[\d.,]*'))[1],''), ',', '', 'g'),
    'views_count',      regexp_replace(coalesce((regexp_match(_aqar_between(region, 'المشاهدات'), '\d[\d,]*'))[1],''), ',', '', 'g'),
    'tenant_category',  _aqar_between(region, 'الفئة'),
    'floor_number',
      case
        when v_dor ~ '^(?:ال)?أرضي$'                            then '0'
        when v_dor ~ '^(?:ال)?علوي$'                            then null
        when v_dor ~ '^\d{1,2}$' and v_dor::int between 0 and 60 then v_dor
        when v_dor ~ '^ال(?:أول|اول)$'                           then '1'
        when v_dor = 'الثاني'                                    then '2'
        when v_dor = 'الثالث'                                    then '3'
        when v_dor = 'الرابع'                                    then '4'
        when v_dor = 'الخامس'                                    then '5'
        when v_dor = 'السادس'                                    then '6'
        when v_dor = 'السابع'                                    then '7'
        when v_dor = 'الثامن'                                    then '8'
        when v_dor = 'التاسع'                                    then '9'
        when v_dor = 'العاشر'                                    then '10'
        else null
      end,
    'num_apartments',   (regexp_match(_aqar_between(region, 'عدد الشقق'), '\d+'))[1],
    'furnished',        case when txt ~ 'مؤثث|مفروش' then true else null end,
    'area_m2',          v_area, 'price', v_price, 'price_original', v_orig, 'discount_pct', v_disc
  ));
end
$function$;

-- ---------------------------------------------------------------------------------------------
-- STEP 2: defensive validation, at TWO checkpoints (owner's explicit ask):
--   (a) canonical storage — a CHECK constraint on both Aqar raw tables. Added NOT VALID so it does
--       not fail on today's existing bad rows; it still enforces on every INSERT/UPDATE from the
--       moment it's added, from ANY code path (not just this trigger) — genuine defense in depth.
--       VALIDATE CONSTRAINT (Step 4) closes the loop once Step 3 has cleaned the existing rows.
--   (b) the search index — sync_search_listings_ar() gets a inline 0-60 clamp on floor_number as it
--       flows from listing_native_location_v2 into search_listings_ar. This is platform-agnostic
--       (protects the index even if a future non-Aqar bug ever wrote an out-of-range value) and is
--       the ONLY change to that function; every other line is byte-identical to its live definition.
-- ---------------------------------------------------------------------------------------------
ALTER TABLE public.aqar_residential_listings
  ADD CONSTRAINT floor_number_sane_range
  CHECK (floor_number IS NULL OR (floor_number >= 0 AND floor_number <= 60)) NOT VALID;

ALTER TABLE public.aqar_commercial_listings
  ADD CONSTRAINT floor_number_sane_range
  CHECK (floor_number IS NULL OR (floor_number >= 0 AND floor_number <= 60)) NOT VALID;

CREATE OR REPLACE FUNCTION public.sync_search_listings_ar()
 RETURNS TABLE(upserted bigint, deleted bigint)
 LANGUAGE plpgsql
AS $function$
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
         when lower(v.transaction_type)='rent' then 'إيجار' end,
    normalize(case
                when t.ar is not null then t.ar
                when v.property_type is null or btrim(v.property_type) = '' then 'غير معروف'
                when v.property_type ~ '[A-Za-z]' then 'غير معروف'
                else v.property_type
              end, NFC),
    case when lower(v.transaction_type)='rent' then
      case v.rent_period when 'monthly' then 'شهري' when 'annual' then 'سنوي' else null end end,
    v.price_total, v.price_annual, v.area_m2, v.bedrooms, v.bathrooms,
    case when v.source_table ~ '^(gathern|aqarmonthly)_' then true else v.furnished end,
    v.property_age,
    case when v.direction in ('شمال','جنوب','شرق','غرب','شمال شرقي','شمال غربي','جنوب شرقي','جنوب غربي','شمالية','جنوبية','شرقية','غربية') then v.direction end,
    case when v.tenant_category in ('عزاب','عوائل') then v.tenant_category end,
    v.license_number,
    v.street_width_m,
    case when v.floor_number between 0 and 60 then v.floor_number end,  -- defense-in-depth clamp (2026-07-19)
    v.elevator, v.parking, v.kitchen, v.air_conditioner, v.maid_room, v.driver_room, v.private_entrance,
    v.production_ready
  from listing_native_location_v2 v
  left join type_label_ar t on t.en = v.property_type
  where lower(v.transaction_type) in ('buy','rent')
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
                                                            when lower(v.transaction_type)='rent' then 'إيجار' end)
                       or s3.price_total is distinct from v.price_total
                       or s3.price_annual is distinct from v.price_annual
                       or s3.area_m2 is distinct from v.area_m2
                       or s3.bedrooms is distinct from v.bedrooms
                       or s3.property_age is distinct from v.property_age)))
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
  select count(*) into v_del_pending from search_listings_ar s
    where not exists (select 1 from listing_native_location_v2 v
                      where v.source_table = s.source_table and v.listing_id = s.listing_id
                        and lower(v.transaction_type) in ('buy','rent'));
  select count(*) into v_total_now from search_listings_ar;
  v_threshold := greatest(2000::bigint, (v_total_now * 15 / 100));
  if v_del_pending > v_threshold then
    insert into public.location_pipeline_alerts(alert_type, metric, detail)
      values ('sync_delete_circuit_breaker', v_del_pending,
              format('Sync DELETE aborted: %s rows absent from v2 exceed threshold %s (index total %s).', v_del_pending, v_threshold, v_total_now));
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

commit;

-- ---------------------------------------------------------------------------------------------
-- STEP 3 (HOLD FOR APPROVAL — repair existing data): backup every candidate row, then force a
-- reparse by resetting fullparse_done to false. This does NOT re-derive the value by hand — it
-- makes trg_aqar_parse (already fixed by Step 1) recompute it from each row's own unchanged
-- source_capture->>'source_text', the single source of truth, so there is no second implementation
-- of the parsing logic to drift out of sync. Verified this only affects floor_number in practice:
-- area_m2 is never assigned by this trigger (Python-owned; confirmed live, "the trigger never sets
-- it" — see 20260717_repair_aqar_area_commas.sql), and price_total/price_per_meter recompute from
-- the SAME unchanged upstream logic this migration does not touch, so they land on their current
-- values again (or a freshly-corrected one, if source_capture itself was re-scraped since).
--
-- Scope: any row where floor_number is currently set, OR the source text mentions "الدور" at all
-- (the recovery direction — e.g. أرضي rows currently NULL that should become 0). ~27,600 rows
-- combined across both tables; run in one statement per table (not 25-row batches — this is a
-- derived filter attribute recomputed by an already-tested trigger, not raw listing price data).
-- ---------------------------------------------------------------------------------------------
-- BEGIN;
--
-- CREATE TABLE IF NOT EXISTS ops_aqar_floor_repair_backup_20260719 (
--   source_table text NOT NULL,
--   id           bigint NOT NULL,
--   old_floor_number integer,
--   old_fullparse_done boolean,
--   staged_at    timestamptz NOT NULL DEFAULT now(),
--   PRIMARY KEY (source_table, id)
-- );
--
-- INSERT INTO ops_aqar_floor_repair_backup_20260719 (source_table, id, old_floor_number, old_fullparse_done)
-- SELECT 'aqar_residential_listings', id, floor_number, fullparse_done
-- FROM aqar_residential_listings
-- WHERE floor_number IS NOT NULL OR source_capture->>'source_text' LIKE '%الدور%'
-- ON CONFLICT (source_table, id) DO NOTHING;
--
-- INSERT INTO ops_aqar_floor_repair_backup_20260719 (source_table, id, old_floor_number, old_fullparse_done)
-- SELECT 'aqar_commercial_listings', id, floor_number, fullparse_done
-- FROM aqar_commercial_listings
-- WHERE floor_number IS NOT NULL OR source_capture->>'source_text' LIKE '%الدور%'
-- ON CONFLICT (source_table, id) DO NOTHING;
--
-- -- Sanity before firing: expect ~8,362 + ~18,845 residential candidates, ~71 + ~358 commercial
-- -- (adjust to whatever the live count is at execution time; these are the 2026-07-19 read-only
-- -- audit figures, not a hard assertion).
-- SELECT source_table, count(*) FROM ops_aqar_floor_repair_backup_20260719 GROUP BY 1;
--
-- COMMIT;
--
-- -- Fire the (fixed) trigger on every backed-up row:
-- UPDATE aqar_residential_listings a SET fullparse_done = false
-- FROM ops_aqar_floor_repair_backup_20260719 b
-- WHERE b.source_table = 'aqar_residential_listings' AND b.id = a.id;
--
-- UPDATE aqar_commercial_listings a SET fullparse_done = false
-- FROM ops_aqar_floor_repair_backup_20260719 b
-- WHERE b.source_table = 'aqar_commercial_listings' AND b.id = a.id;
--
-- -- Post-verify (expect 0 rows outside 0-60, and the before/after counts reported in chat):
-- SELECT count(*) FILTER (WHERE floor_number < 0 OR floor_number > 60) AS still_out_of_range,
--        count(*) FILTER (WHERE floor_number IS NOT NULL) AS new_non_null
-- FROM aqar_residential_listings;

-- ---------------------------------------------------------------------------------------------
-- STEP 4 (HOLD FOR APPROVAL — only after Step 3 has run and Step 3's post-verify shows 0 violations):
-- ---------------------------------------------------------------------------------------------
-- ALTER TABLE public.aqar_residential_listings VALIDATE CONSTRAINT floor_number_sane_range;
-- ALTER TABLE public.aqar_commercial_listings  VALIDATE CONSTRAINT floor_number_sane_range;

-- =============================================================================================
-- ROLLBACK (verbatim live definitions as they existed immediately before this migration, pulled
-- via pg_get_functiondef on 2026-07-19 — use this, not a hand-retyped version, per the RPC
-- full-body-replace hazard rule):
-- =============================================================================================
-- CREATE OR REPLACE FUNCTION public.aqar_parse(txt text)
--  RETURNS jsonb LANGUAGE plpgsql IMMUTABLE
-- AS $function$
-- declare
--   region text; head text; prices bigint[]; v_disc int; v_price bigint; v_orig bigint; v_area int;
-- begin
--   if txt is null then return '{}'::jsonb; end if;
--   txt := translate(txt, '٠١٢٣٤٥٦٧٨٩', '0123456789');
--   region := coalesce(substring(txt from 'تفاصيل الإعلان(.*)'), txt);
--   head   := split_part(txt, 'تفاصيل الإعلان', 1);
--   select array_agg(v order by ord) into prices from (
--      select round((regexp_replace((t.g)[1], ',', '', 'g'))::numeric)::bigint as v, ord
--      from regexp_matches(head, '(\d[\d,]*(?:\.\d+)?)\s*(?:§|ريال|﷼)', 'g') with ordinality as t(g, ord)
--   ) s where v > 0;
--   v_disc := nullif(substring(head from 'خصم\s*(\d+)\s*%'), '')::int;
--   if v_disc is not null and coalesce(array_length(prices,1),0) >= 2 then v_orig := prices[1]; v_price := prices[2];
--   elsif coalesce(array_length(prices,1),0) >= 1 then v_price := prices[1]; end if;
--   v_area := nullif(regexp_replace(coalesce((regexp_match(_aqar_between(region, 'المساحة(?!\s*حسب)'), '\d[\d,]*'))[1], ''), ',', '', 'g'), '')::int;
--   return jsonb_strip_nulls(jsonb_build_object(
--     'direction',        _aqar_between(region, 'الواجهة'),
--     'last_update',      _aqar_between(region, 'آخر تحديث'),
--     'date_added',       substring(_aqar_between(region, 'تاريخ الإضافة') from '\d{2}/\d{2}/\d{4}'),
--     'license_number',   (regexp_match(_aqar_between(region, 'رخصة الإعلان'), '\d{6,}'))[1],
--     'license_expiry',   substring(_aqar_between(region, 'تاريخ نهاية الترخيص') from '\d{2}/\d{2}/\d{4}'),
--     'ad_source',        _aqar_between(region, 'مصدر الإعلان'),
--     'plan_parcel',      coalesce(_aqar_between(region, 'المخطط و القطعة'), _aqar_between(region, 'المخطط والقطعة')),
--     'deed_area_m2',     regexp_replace(coalesce((regexp_match(_aqar_between(region, 'المساحة حسب الصك'), '\d[\d.,]*'))[1],''), ',', '', 'g'),
--     'views_count',      regexp_replace(coalesce((regexp_match(_aqar_between(region, 'المشاهدات'), '\d[\d,]*'))[1],''), ',', '', 'g'),
--     'tenant_category',  _aqar_between(region, 'الفئة'),
--     'floor_number',     (regexp_match(_aqar_between(region, 'الدور'), '\d+'))[1],
--     'num_apartments',   (regexp_match(_aqar_between(region, 'عدد الشقق'), '\d+'))[1],
--     'furnished',        case when txt ~ 'مؤثث|مفروش' then true else null end,
--     'area_m2',          v_area, 'price', v_price, 'price_original', v_orig, 'discount_pct', v_disc
--   ));
-- end
-- $function$;
--
-- ALTER TABLE public.aqar_residential_listings DROP CONSTRAINT IF EXISTS floor_number_sane_range;
-- ALTER TABLE public.aqar_commercial_listings  DROP CONSTRAINT IF EXISTS floor_number_sane_range;
--
-- -- sync_search_listings_ar(): restore by removing the "case when v.floor_number between 0 and 60"
-- -- wrapper and reverting to a bare "v.floor_number" in both the SELECT list and (unchanged either
-- -- way) the ON CONFLICT SET clause — the live pre-migration body is identical to the STEP 2
-- -- definition above except for that one expression.
--
-- -- If Step 3 (backfill) already ran: restore prior floor_number values from the backup table —
-- -- UPDATE aqar_residential_listings a SET floor_number = b.old_floor_number, fullparse_done = b.old_fullparse_done
-- -- FROM ops_aqar_floor_repair_backup_20260719 b WHERE b.source_table='aqar_residential_listings' AND b.id=a.id;
-- -- (same for aqar_commercial_listings) — then re-deploy the OLD aqar_parse() first, or these rows
-- -- will just get re-corrupted on their next natural re-scrape anyway, which is the actual rollback.
-- =============================================================================================
