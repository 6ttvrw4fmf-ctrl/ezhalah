-- Hofuf's numbered districts: «ضاحية هجر الحي الخامس» IS our catalog's «الضاحية الخامس»
-- (🆕 New Listings Engineer, 2026-10-03; the owner's hint: «maybe it's called الضاحية in our district
-- catalog»). Measured: ~560 Hofuf listings from abralosol, arkaan, aqarcity, rawasidark and dealapp
-- publish this district in three spellings and none reached the catalog's «الضاحية <ordinal>» rows:
--   «ضاحية هجر الحي <ordinal>»   (abralosol, rawasidark)
--   «<ordinal> بضاحية هجر»       (arkaan)  — also «التعاون بضاحية هجر» -> «الضاحية التعاون»
--   «حي هجر <ordinal>»           (aqarcity)
-- City-scoped (Hofuf = 12) and validated by the catalog lookup itself: a spelling whose
-- «الضاحية …» counterpart does not exist (الأول and الثالث are not in the catalog today, «المناهيل»
-- is not) still resolves to NULL, never to a guess. The ordinal is NOT folded away: the numbered
-- districts are distinct places, only the spelling is translated.
-- Needle edit of the LIVE body: the alias coalesce from 20261003163234 gains one more branch.
-- UNDO: remove the case expression; the explicit VALUES aliases stay.
set local statement_timeout = '2min';
set local lock_timeout = '5s';
DO $do$
DECLARE src text; out_def text;
BEGIN
  src := pg_get_functiondef('public.resolve_district_ar(integer,text)'::regprocedure);
  IF position('Hofuf dahiyah ordinals' in src) > 0 THEN
    RAISE NOTICE 'resolve_district_ar already carries the dahiyah rule';
    RETURN;
  END IF;
  out_def := replace(src,
    'a.city_id = p_city_id and a.from_norm = k), k);',
    E'a.city_id = p_city_id and a.from_norm = k),\n           -- Hofuf dahiyah ordinals (owner hint 2026-10-03): the numbered districts of ضاحية هجر\n           case\n             when p_city_id = 12 and k ~ ''^ضاحيه هجر الحي ال(اول|ثاني|ثالث|رابع|خامس|سادس|سابع|ثامن|تاسع|عاشر|حادي عشر)$''\n               then ''ضاحيه '' || regexp_replace(k, ''^ضاحيه هجر الحي '', '''')\n             when p_city_id = 12 and k ~ '' بضاحيه هجر$''\n               then ''ضاحيه ال'' || regexp_replace(k, '' بضاحيه هجر$'', '''')\n             when p_city_id = 12 and k ~ ''^هجر ال(اول|ثاني|ثالث|رابع|خامس|سادس|سابع|ثامن|تاسع|عاشر|حادي عشر)$''\n               then ''ضاحيه '' || regexp_replace(k, ''^هجر '', '''')\n           end,\n           k);');
  IF out_def = src THEN
    RAISE EXCEPTION 'needle not found in resolve_district_ar - refusing to guess';
  END IF;
  EXECUTE out_def;
END
$do$;

DO $verify$
BEGIN
  IF public.resolve_district_ar(12, 'ضاحية هجر الحي الخامس') is distinct from 'الضاحية الخامس' THEN
    RAISE EXCEPTION 'dahiyah «ضاحية هجر الحي» spelling did not resolve';
  END IF;
  IF public.resolve_district_ar(12, 'الخامس بضاحية هجر') is distinct from 'الضاحية الخامس' THEN
    RAISE EXCEPTION 'dahiyah «X بضاحية هجر» spelling did not resolve';
  END IF;
  IF public.resolve_district_ar(12, 'حي هجر الخامس') is distinct from 'الضاحية الخامس' THEN
    RAISE EXCEPTION 'dahiyah «حي هجر X» spelling did not resolve';
  END IF;
  IF public.resolve_district_ar(12, 'التعاون بضاحية هجر') is distinct from 'الضاحية التعاون' THEN
    RAISE EXCEPTION 'dahiyah التعاون did not resolve';
  END IF;
  -- no guess where the catalog has no counterpart
  IF public.resolve_district_ar(12, 'المناهيل بضاحية هجر') is not null THEN
    RAISE EXCEPTION 'dahiyah rule guessed a district the catalog does not have';
  END IF;
  -- city-scoped, and the plain district «حي هجر» is untouched
  IF public.resolve_district_ar(18, 'ضاحية هجر الحي الخامس') is not null THEN
    RAISE EXCEPTION 'dahiyah rule leaked into another city';
  END IF;
  IF public.resolve_district_ar(12, 'حي هجر') is distinct from 'حي هجر' THEN
    RAISE EXCEPTION 'plain «حي هجر» regressed';
  END IF;
END
$verify$;
