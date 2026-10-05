-- District matcher: a city word glued on, or a plan number + block letter, hides an attested district
-- (🔧 Quality & Repair Engineer, 2026-10-05, standing repair A). Sources print the district followed by
-- the city («الامراء الهفوف», «منيفة - الهفوف», «الحمراء الاول/الهفوف», «الدانة بالهفوف») or by a
-- land-plan number and block letter («الراشدية (126/4) أ», «الجرن (53/14)»). Neither suffix is part of
-- the district's name, so the resolver now retries once without it — and still accepts ONLY a district
-- already attested in THIS city (loc_canonical_district), so nothing is invented.
-- Guards: never when the remainder carries a digit (a number stays when the source prints it as the
-- district's own name: «الصفا ١» is not «الصفا»), never a bare compass word («شمال بريدة» is a part
-- of town, not a district), never an empty remainder (an ad whose «district» is the city itself).
-- Needle edit of the LIVE body: one fallback block before the Arabic branch's return.
-- Only a plain-Arabic city name is spliced into the pattern, so no catalog name can break the regex.
-- UNDO: remove the block between the two «city-suffix fallback» markers.
-- Existing rows recover on their own through refresh_district_recovery (job 45, :10) then the :22 sync.
set local statement_timeout = '2min';
set local lock_timeout = '5s';
DO $do$
DECLARE src text; out_def text;
BEGIN
  src := pg_get_functiondef('public.resolve_district_ar(integer,text)'::regprocedure);
  IF position('city-suffix fallback' in src) > 0 THEN
    RAISE NOTICE 'resolve_district_ar already carries the city-suffix fallback';
    RETURN;
  END IF;
  out_def := replace(src,
    E'           k);\n    return result;\n  else',
    $r$           k);
    -- city-suffix fallback (2026-10-05): strip a trailing plan number + block letter, then a
    -- trailing city name («X الهفوف», «X - الهفوف», «X/الهفوف», «X بالهفوف»); retry once.
    if result is null then
      declare
        c text := (select cc.city_ar from public.loc_catalog_city cc where cc.city_id = p_city_id);
        v2 text;
      begin
        v2 := regexp_replace(v, '\s*\([^)]*[0-9٠-٩][^)]*\)\s*[أابجده]?\s*$', '');
        if c ~ '^[ء-ي ]+$' then  -- plain Arabic letters only: the name is spliced into a regex
          v2 := regexp_replace(v2, '\s*[-–/]?\s*ب?' || c || '$', '');
        end if;
        v2 := btrim(v2);
        if v2 <> v and v2 <> '' and v2 !~ '[0-9٠-٩]'
           and v2 !~ '^(حي\s+)?(ال)?(شمال|جنوب|شرق|غرب|وسط)$' then
          return public.resolve_district_ar(p_city_id, v2);
        end if;
      end;
    end if;
    -- end city-suffix fallback
    return result;
  else$r$);
  IF out_def = src THEN
    RAISE EXCEPTION 'needle not found in resolve_district_ar - refusing to guess';
  END IF;
  EXECUTE out_def;
END
$do$;

DO $verify$
BEGIN
  IF public.resolve_district_ar(12, 'الامراء الهفوف') is distinct from 'حي الأمراء' THEN RAISE EXCEPTION 'glued city word not stripped'; END IF;
  IF public.resolve_district_ar(12, 'منيفة - الهفوف') is distinct from 'حي منيفة' THEN RAISE EXCEPTION 'dash city word not stripped'; END IF;
  IF public.resolve_district_ar(12, 'الحمراء الاول/الهفوف') is distinct from 'حي الحمراء الأول' THEN RAISE EXCEPTION 'slash city word not stripped'; END IF;
  IF public.resolve_district_ar(12, 'الدانة بالهفوف') is null THEN RAISE EXCEPTION 'ب+city not stripped'; END IF;
  IF public.resolve_district_ar(3677, 'الراشدية (126/4) أ') is null THEN RAISE EXCEPTION 'plan+block not stripped'; END IF;
  IF public.resolve_district_ar(3677, 'الصفا ١ (93/14)') is not null THEN RAISE EXCEPTION 'a number in the name was dropped'; END IF;
  IF public.resolve_district_ar(11, 'شمال بريدة') is not null THEN RAISE EXCEPTION 'compass word became a district'; END IF;
  IF public.resolve_district_ar(5, 'الطائف') is not null THEN RAISE EXCEPTION 'city-only became a district'; END IF;
  IF public.resolve_district_ar(12, 'حي الامراء الزائف') is not null THEN RAISE EXCEPTION 'unattested resolved'; END IF;
  -- earlier aliases and plain spellings still hold
  IF public.resolve_district_ar(12, 'حي الرفعةالجنوبية') is distinct from 'حي الرفعة الجنوبية' THEN RAISE EXCEPTION 'Rifaa alias regressed'; END IF;
  IF public.resolve_district_ar(11, 'السلمانية') is distinct from 'السليمانية' THEN RAISE EXCEPTION 'Buraydah alias regressed'; END IF;
  IF public.resolve_district_ar(12, 'الرابية') is distinct from 'حي الرابية' THEN RAISE EXCEPTION 'plain spelling regressed'; END IF;
END
$verify$;