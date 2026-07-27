-- Riyadh/Jazan cross-region location leak fix (daily-audit 2026-07-27, owner-instructed).
-- Full rationale in repo: supabase/migrations/20260727125500_udid_city_text_guard_and_wasalt_city_alias.sql
-- 1) v2 udid heuristic: only infer city-from-unique-district when the row has NO city text (0-for-9 wrong today).
-- 2) v2 alias lateral: resolve unresolved city TEXT through loc_catalog_city_alias (live, platform-agnostic;
--    v1 is a matview so the fallback lives in v2). city_ar keeps raw source text (card fidelity).
-- 3) Seed unambiguous compound alias 'أبو عريش - أبو عريش' -> 3525 (ابو عريش, جازان).
-- No row updates: sync's drift clause self-heals affected rows next run.

do $$
declare
  v_def text;
  v_udid   text := 'v1.city_id IS NULL AND v1.region_id IS NULL AND v1.district_ar IS NOT NULL';
  v_uc     text := 'LEFT JOIN loc_catalog_city uc ON uc.city_id = udid.city_id';
  v_region text := 'COALESCE(v1.region_id, uc.region_id)';
  v_city   text := 'COALESCE(v1.city_id, uc.city_id)';
  v_regar  text := 'COALESCE(v1.region_ar, ur.region_ar)';
  cnt_of int;
begin
  v_def := pg_get_viewdef('public.listing_native_location_v2'::regclass, true);

  if position('uali' in v_def) > 0 then
    raise notice 'alias lateral already present — skipping (idempotent re-run)';
    return;
  end if;

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

  v_def := replace(v_def, v_udid, 'v1.city_ar IS NULL AND ' || v_udid);

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

do $$
begin
  if not exists (select 1 from loc_catalog_city where city_id = 3525 and region_id = 10) then
    raise exception 'catalog city 3525 is not ابو عريش/region 10 anymore — refusing to seed alias';
  end if;
  insert into loc_catalog_city_alias (alias_norm, city_id)
  values (normalize_ar('أبو عريش - أبو عريش'), 3525)
  on conflict do nothing;
end $$;