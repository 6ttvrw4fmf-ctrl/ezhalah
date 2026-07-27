-- Fix the Riyadh/Jazan cross-region location leak (daily-audit 2026-07-27, owner-instructed).
--
-- SYMPTOM: a Buy search for الرياض returned 2 wasalt listings physically in أبو عريش (Jazan,
-- ~1,200 km away): wasalt_residential_listings 488187 & 513009, city_ar 'أبو عريش - أبو عريش',
-- stored & view city_id = 3 (الرياض), region_ar 'منطقة الرياض'.
--
-- ROOT CAUSE (two independent defects that compose):
--
-- 1. The "safe unique-district" resolver in listing_native_location_v2
--    (20260717_safe_unique_district_city_resolver.sql) was designed to restore a city ONLY for a
--    "fully location-less row" — but its guard checks v1.city_id IS NULL (city RESOLUTION failed),
--    not v1.city_ar IS NULL (city TEXT absent). So for rows that DO carry an explicit city string
--    the catalog cannot resolve, it infers the city from the district name instead — inventing a
--    location that CONTRADICTS the listing's own city text. Catalog "uniqueness" is a coverage
--    artifact, not geography: النسيم is catalogued only under الرياض (city 3), so an Abu Arish row
--    whose district is النسيم was teleported to Riyadh. Audited live 2026-07-27: the heuristic
--    fires on exactly 9 active rows, EVERY ONE with city text present, and EVERY ONE resolved to a
--    wrong city (النسيم→الرياض for أبو عريش rows; النهضة→بيش for أبو عريش AND محائل rows;
--    الإسكان→العلا for a المجمعة row; الياسمين→رماح for الخبراء والسحابين rows — three of them
--    cross-REGION). 0-for-9. The fix adds the missing v1.city_ar IS NULL guard, restoring the
--    resolver's documented intent ("fully location-less"); with it the heuristic fires on 0
--    current rows (a dormant safety valve for genuinely city-less rows). Those 9 rows become
--    honestly unresolved instead of confidently wrong — the exact-location-only contract.
--
-- 2. City-text ALIAS resolution never reached the location pipeline: loc_catalog_city_alias (the
--    table the search RPC itself consults for user-typed city variants) was consulted NOWHERE in
--    listing resolution, so a listing whose city text only an alias can resolve sat permanently
--    unlocated. wasalt emits compound 'governorate - city' strings; for 'أبو عريش - أبو عريش' both
--    halves name the same city, so the mapping to catalog city 3525 (ابو عريش, region 10 جازان) is
--    unambiguous — ~86 active wasalt rows sat unresolved on that one string (which is what exposed
--    them to defect #1). listing_native_location_v1 is a MATERIALIZED view, so the alias fallback
--    lives in v2 (plain view, computed live): a LATERAL that resolves v1.city_ar through
--    loc_catalog_city_alias whenever v1.city_id failed — platform-agnostic, no matview refresh
--    dependency, and correctly ordered ABOVE the unique-district heuristic in every COALESCE.
--    city_ar itself keeps the raw source text (card fidelity — only canonical ids resolve).
--    Blast radius measured before applying: with the pre-existing 5 alias rows exactly 1 active
--    row newly resolves (wasalt 3501034, 'ضباء' → ضبا/Tabuk — a correct spelling variant).
--
-- 3. Seed the one PROVEN alias: normalize_ar('أبو عريش - أبو عريش') → 3525. normalize_ar folds
--    hamza variants, so this single row also covers 'ابو عريش - ابو عريش' (verified equal norms).
--    Only the identical-halves compound is seeded; mixed compounds like 'الجموم - بحرة' (two
--    DIFFERENT cities — which half is the city?) stay unmapped pending owner decision, per the
--    ambiguous-mapping ask-first rule. Same for فرسان/المجمعة whose catalog entries are themselves
--    duplicated ([1675,3571] / 4 entries).
--
-- NO ROW UPDATES HERE: sync_search_listings_ar's drift clause (s.city_id IS DISTINCT FROM
-- v.city_id) re-upserts every affected row on its next hourly run once the view computes the
-- corrected values — the pipeline self-heals; hand-editing rows would just fight the view.
--
-- The v2 edit is a GUARDED IN-PLACE REPLACEMENT of the live catalog definition (assert each exact
-- needle with an expected occurrence count, RAISE on mismatch) rather than a full-body re-issue:
-- v2's last repo issue (20260717) predates live joins added since (district_recovery,
-- listing_age_resolved) — a full-body paste from any file we have would silently revert those,
-- the exact PR#120 failure mode verify-rpc-clause-invariants.ts exists to prevent. A guarded edit
-- cannot drop clauses it does not name, and fails LOUD if the live shape ever drifts.

do $$
declare
  v_def text;
  v_udid   text := 'v1.city_id IS NULL AND v1.region_id IS NULL AND v1.district_ar IS NOT NULL';
  v_uc     text := 'LEFT JOIN loc_catalog_city uc ON uc.city_id = udid.city_id';
  v_region text := 'COALESCE(v1.region_id, uc.region_id)';
  v_city   text := 'COALESCE(v1.city_id, uc.city_id)';
  v_regar  text := 'COALESCE(v1.region_ar, ur.region_ar)';
  n int;
  cnt_of int;
begin
  v_def := pg_get_viewdef('public.listing_native_location_v2'::regclass, true);

  if position('uali' in v_def) > 0 then
    raise notice 'alias lateral already present — skipping (idempotent re-run)';
    return;
  end if;

  -- assert every needle count before touching anything
  cnt_of := (length(v_def) - length(replace(v_def, v_udid, ''))) / length(v_udid);
  if cnt_of <> 1 then raise exception 'udid needle x% (expected 1) — view drifted', cnt_of; end if;
  cnt_of := (length(v_def) - length(replace(v_def, v_uc, ''))) / length(v_uc);
  if cnt_of <> 1 then raise exception 'uc-join needle x% (expected 1) — view drifted', cnt_of; end if;
  cnt_of := (length(v_def) - length(replace(v_def, v_region, ''))) / length(v_region);
  if cnt_of <> 2 then raise exception 'region-coalesce needle x% (expected 2) — view drifted', cnt_of; end if;
  cnt_of := (length(v_def) - length(replace(v_def, v_city, ''))) / length(v_city);
  if cnt_of <> 2 then raise exception 'city-coalesce needle x% (expected 2) — view drifted', cnt_of; end if;
  cnt_of := (length(v_def) - length(replace(v_def, v_regar, ''))) / length(v_regar);
  if cnt_of <> 1 then raise exception 'region-ar-coalesce needle x% (expected 1) — view drifted', cnt_of; end if;

  -- 1. unique-district inference only when the row has NO city text at all
  v_def := replace(v_def, v_udid, 'v1.city_ar IS NULL AND ' || v_udid);

  -- 2. alias-based city resolution (live, platform-agnostic), ranked above the district heuristic
  v_def := replace(v_def, v_uc,
       'LEFT JOIN LATERAL ( SELECT a2.city_id FROM loc_catalog_city_alias a2'
    || ' WHERE v1.city_id IS NULL AND v1.city_ar IS NOT NULL AND a2.alias_norm = normalize_ar(v1.city_ar)'
    || ' LIMIT 1) uali ON true'
    || ' LEFT JOIN loc_catalog_city uac ON uac.city_id = uali.city_id'
    || ' LEFT JOIN loc_catalog_region uar ON uar.region_id = uac.region_id '
    || v_uc);
  v_def := replace(v_def, v_region, 'COALESCE(v1.region_id, uac.region_id, uc.region_id)');
  v_def := replace(v_def, v_city,   'COALESCE(v1.city_id, uali.city_id, uc.city_id)');
  v_def := replace(v_def, v_regar,  'COALESCE(v1.region_ar, uar.region_ar, ur.region_ar)');

  execute 'create or replace view public.listing_native_location_v2 as ' || v_def;
end $$;

-- 3. Seed the unambiguous compound alias
do $$
begin
  if not exists (select 1 from loc_catalog_city where city_id = 3525 and region_id = 10) then
    raise exception 'catalog city 3525 is not ابو عريش/region 10 anymore — refusing to seed alias';
  end if;
  insert into loc_catalog_city_alias (alias_norm, city_id)
  values (normalize_ar('أبو عريش - أبو عريش'), 3525)
  on conflict do nothing;
end $$;
