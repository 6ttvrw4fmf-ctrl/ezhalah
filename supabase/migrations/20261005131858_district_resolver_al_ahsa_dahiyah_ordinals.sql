-- Al-Ahsa «الضاحية الحي الخامس» IS the attested «ضاحية هجر(الحي الخامس)» (🔧 Quality & Repair Engineer,
-- 2026-10-05, standing repair A). bossbih, alshawaf and aqalemhajer file ~388 searchable Al-Ahsa ads
-- (city 3677) under «الضاحية الحي <ordinal>» or «ضاحية هجر الحي <ordinal>», usually with a plan number
-- («(640/4) ج», stripped by 20261005131351). Al-Ahsa's catalog already attests the same numbered districts
-- of ضاحية هجر under two spellings: «ضاحية هجر(الحي X)» (9 of 11 ordinals) and «هجر X» (10 of 11). The
-- resolver now maps the ordinal form to the first attested of the two — the same place, never a new one.
-- City-scoped to 3677 (Hofuf, city 12, already has its own ordinal rule). Ordinals 1–11 only: «الثاني
-- عشر (المناهيل)» is attested nowhere and stays NULL.
-- Needle edit of the LIVE body: one block before the city-suffix fallback.
-- UNDO: remove the block between the two «al-ahsa dahiyah ordinals» markers.
-- Existing rows recover on their own through refresh_district_recovery (job 45, :10) then the :22 sync.
set local statement_timeout = '2min';
set local lock_timeout = '5s';
DO $do$
DECLARE src text; out_def text;
BEGIN
  src := pg_get_functiondef('public.resolve_district_ar(integer,text)'::regprocedure);
  IF position('al-ahsa dahiyah ordinals' in src) > 0 THEN
    RAISE NOTICE 'resolve_district_ar already carries the Al-Ahsa dahiyah ordinals';
    RETURN;
  END IF;
  out_def := replace(src,
    E'    -- city-suffix fallback (2026-10-05)',
    $r$    -- al-ahsa dahiyah ordinals (2026-10-05): «الضاحية الحي X» / «ضاحية هجر الحي X» in city 3677
    if result is null and p_city_id = 3677
       and k ~ '^ضاحيه (هجر )?الحي ال(اول|ثاني|ثالث|رابع|خامس|سادس|سابع|ثامن|تاسع|عاشر|حادي عشر)$' then
      select coalesce(
               (select d.canonical_district_ar from public.loc_canonical_district d
                 where d.city_id = 3677
                   and d.district_norm = 'ضاحيه هجر(الحي ' || regexp_replace(k, '^ضاحيه (هجر )?الحي ', '') || ')'),
               (select d.canonical_district_ar from public.loc_canonical_district d
                 where d.city_id = 3677
                   and d.district_norm = 'هجر ' || regexp_replace(k, '^ضاحيه (هجر )?الحي ', '')))
        into result;
    end if;
    -- end al-ahsa dahiyah ordinals
    -- city-suffix fallback (2026-10-05)$r$);
  IF out_def = src THEN
    RAISE EXCEPTION 'needle not found in resolve_district_ar - refusing to guess';
  END IF;
  EXECUTE out_def;
END
$do$;

DO $verify$
BEGIN
  IF public.resolve_district_ar(3677, 'الضاحية الحي الرابع (640/4) ج') is distinct from 'ضاحية هجر(الحي الرابع)' THEN RAISE EXCEPTION 'plan-numbered ordinal not mapped'; END IF;
  IF public.resolve_district_ar(3677, 'الضاحية الحي الخامس') is distinct from 'ضاحية هجر(الحي الخامس)' THEN RAISE EXCEPTION 'ordinal not mapped'; END IF;
  IF public.resolve_district_ar(3677, 'ضاحية هجر الحي الحادي عشر') is distinct from 'ضاحية هجر(الحي الحادي عشر)' THEN RAISE EXCEPTION 'two-word ordinal not mapped'; END IF;
  IF public.resolve_district_ar(3677, 'الضاحية الحي السابع') is distinct from 'هجر السابع' THEN RAISE EXCEPTION 'second spelling not used'; END IF;
  IF public.resolve_district_ar(3677, 'الضاحية الحي الثاني عشر') is not null THEN RAISE EXCEPTION 'unattested ordinal resolved'; END IF;
  IF public.resolve_district_ar(13, 'الضاحية الحي الرابع') is not null THEN RAISE EXCEPTION 'rule leaked into another city'; END IF;
  -- earlier behaviour still holds
  IF public.resolve_district_ar(12, 'ضاحية هجر الحي الخامس') is distinct from 'الضاحية الخامس' THEN RAISE EXCEPTION 'Hofuf dahiyah rule regressed'; END IF;
  IF public.resolve_district_ar(12, 'الامراء الهفوف') is distinct from 'حي الأمراء' THEN RAISE EXCEPTION 'city-suffix fallback regressed'; END IF;
  IF public.resolve_district_ar(3677, 'الصفا ١ (93/14)') is not null THEN RAISE EXCEPTION 'digit guard regressed'; END IF;
END
$verify$;