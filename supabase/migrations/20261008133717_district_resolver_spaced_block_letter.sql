-- 🔧 Quality & Repair 2026-10-08: block letters after a space.
--
-- bossbih (Al-Ahsa) prints the plan block after the district with a space: «الجابرية د», «منسوب التعليم
-- ب», «شرق شرق الحديقة أ», «الضاحية الحي التاسع ج». The resolver already strips «X / ب» (block letter
-- after a slash, 2026-10-06) but not the spaced form, so 53 searchable ads had no district. Dry run over
-- every no-district row in the index (12.5k): the spaced letter strip resolves 53 rows, all bossbih, all
-- to the district the source names. A number is never stripped («الصفا 2 أ» → «الصفا 2», still blocked by
-- the digit guard: the number may be the district's own name). Only the fallback path changes, so no row
-- that resolved before can change. Same function body as 20261008132125 plus one line.
CREATE OR REPLACE FUNCTION public.resolve_district_ar(p_city_id integer, p_neighborhood text)
 RETURNS text
 LANGUAGE plpgsql
 STABLE
AS $function$
declare
  v text := btrim(coalesce(p_neighborhood, ''));
  k text;
  en text;
  result text;
begin
  if v = '' or p_city_id is null then
    return null;
  end if;

  if v ~ '[ء-ي]' then
    -- Arabic: accept only if it normalizes to a district already attested in THIS city.
    k := norm_district_tok(v);
    if k is null or k = '' then return null; end if;
    select canonical_district_ar into result
      from public.loc_canonical_district
     where city_id = p_city_id
       -- city-scoped spelling aliases (owner-confirmed same place; see migration 2026-10-03)
       and district_norm = coalesce((select a.to_norm from (values
             (11, 'سلمانيه', 'سليمانيه'),
             (12, 'ضاحيه هجر الحي الخامس', 'ضاحيه الخامس'),
             (12, 'رفعهالجنوبيه', 'رفعه الجنوبيه')
           ) a(city_id, from_norm, to_norm)
           where a.city_id = p_city_id and a.from_norm = k),
           -- Hofuf dahiyah ordinals (owner hint 2026-10-03): the numbered districts of ضاحية هجر
           case
             when p_city_id = 12 and k ~ '^ضاحيه هجر الحي ال(اول|ثاني|ثالث|رابع|خامس|سادس|سابع|ثامن|تاسع|عاشر|حادي عشر)$'
               then 'ضاحيه ' || regexp_replace(k, '^ضاحيه هجر الحي ', '')
             when p_city_id = 12 and k ~ ' بضاحيه هجر$'
               then 'ضاحيه ال' || regexp_replace(k, ' بضاحيه هجر$', '')
             when p_city_id = 12 and k ~ '^هجر ال(اول|ثاني|ثالث|رابع|خامس|سادس|سابع|ثامن|تاسع|عاشر|حادي عشر)$'
               then 'ضاحيه ' || regexp_replace(k, '^هجر ', '')
           end,
           k);
    -- al-ahsa dahiyah ordinals (2026-10-05): «الضاحية الحي X» / «ضاحية هجر الحي X» in city 3677
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
    -- al-ahsa cluster (2026-10-08): الهفوف 12 · المبرز 2748 · الاحساء 3677 are one place in search;
    -- a name not attested in the ad's own cluster city resolves when exactly one sibling attests it.
    if result is null and p_city_id in (12, 2748, 3677) and v !~ '[0-9٠-٩]' then
      select min(d.canonical_district_ar) into result
        from public.loc_canonical_district d
       where d.city_id in (12, 2748, 3677) and d.city_id <> p_city_id and d.district_norm = k
      having count(distinct d.canonical_district_ar) = 1;
    end if;
    -- end al-ahsa cluster
    -- city-suffix fallback (2026-10-05): strip a trailing plan number + block letter, then a
    -- trailing city name («X الهفوف», «X - الهفوف», «X/الهفوف», «X بالهفوف»); retry once.
    if result is null then
      declare
        c text := (select cc.city_ar from public.loc_catalog_city cc where cc.city_id = p_city_id);
        v2 text;
      begin
        v2 := regexp_replace(v, '\s*\([^)]*[0-9٠-٩][^)]*\)\s*[أابجده]?\s*$', '');
        -- 2026-10-06: «X رقم 741 / أ» (plan number) and «X / ب» (block letter after a slash)
        v2 := regexp_replace(v2, '\s*رقم\s*[0-9٠-٩][^،]*$', '');
        v2 := regexp_replace(v2, '\s*/\s*[أابجدهو]\s*$', '');
        -- 2026-10-08: a lone trailing block letter after a space («الجابرية د», «منسوب التعليم ب»,
        -- «الراجحي هـ»). Never a number: «الصفا 2 أ» keeps «2» and stays unresolved (digit guard below).
        v2 := regexp_replace(v2, '\s+([أابجده]|هـ)$', '');
        if c ~ '^[ء-ي ]+$' then  -- plain Arabic letters only: the name is spliced into a regex
          v2 := regexp_replace(v2, '\s*[-–/،,]*\s*ب?' || c || '$', '');
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
  else
    -- English/Latin: require an UNAMBIGUOUS bridge translation AND attestation in this city.
    en := norm_en_district(v);
    if en is null or en = '' then return null; end if;
    -- city-scoped translation first (2026-10-06): the same English name inside THIS city
    select district_norm into k
      from public.bridge_en_district
     where en_norm = en || '@' || p_city_id and n_distinct = 1;
    if k is not null then
      select canonical_district_ar into result
        from public.loc_canonical_district
       where city_id = p_city_id and district_norm = k;
      if result is not null then return result; end if;
    end if;
    -- end city-scoped translation
    select district_norm into k
      from public.bridge_en_district
     where en_norm = en and n_distinct = 1;
    if k is null then
      return null;  -- no translation, or ambiguous translation
    end if;
    select canonical_district_ar into result
      from public.loc_canonical_district
     where city_id = p_city_id and district_norm = k;
    return result;
  end if;
end;
$function$;
