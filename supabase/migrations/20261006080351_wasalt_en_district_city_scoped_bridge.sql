-- New Listings Engineer, 2026-10-06. An English district name is translated INSIDE ITS CITY first.
--
-- Defect (measured 2026-10-06 07:20 UTC): 61 of 549 wasalt listings that arrived in the last 24 h had
-- no district in search, although the source published one («Al-Arid» ×11, «Al-Malqa» ×6,
-- «Qurtubah» ×4, «Al-Olaya», «Ar-Rawdah» … all Riyadh). resolve_district_ar() translates English
-- through bridge_en_district, which is COUNTRY-WIDE and keyed by the English token alone. One pair
-- from another city makes the token "ambiguous" everywhere:
--   «Al Malqa» Medina → حي الملك فهد (18 ads)   ⇒  Riyadh «Al-Malqa» (865 ads → حي الملقا) unresolved
--   «Al Arid» Medina → حي العريض (19 ads)       ⇒  Riyadh «Al-Arid» (1,160 ads → حي العارض) unresolved
-- The pairs are the source's own bilingual pages (district_name_bridge: the same ad's English and
-- Arabic names), so the evidence for Riyadh was there; the key simply threw the city away.
--
-- Fix (needle edit, both functions otherwise byte-identical to the live definitions):
--  * refresh_bridge_en_district() also writes CITY-SCOPED rows keyed '<en_norm>@<city_id>', built only
--    from pairs whose city_en pins to exactly one catalog city (same pin as resolve_english_city_overlay),
--    seen on >= 2 ads (owner, 2026-10-05: «only where unambiguous and >= 2 ads»), and only when every
--    such pair in that city names ONE Arabic district (n_distinct = 1). Generic labels («The District»
--    → 'the') and very short tokens are never keyed.
--  * resolve_district_ar() looks up the city-scoped key first, then the country-wide key as before.
--    Either way the result must still be a district ATTESTED in this city's catalog: nothing is invented.
-- Old rows recover through district_recovery (job 45, :10) and the hourly search sync (:22).
-- Undo: re-apply the two definitions from migration 20261005131858 / 20260717204046 (saved before edit).

create or replace function public.refresh_bridge_en_district()
 returns bigint
 language plpgsql
as $function$
declare n bigint;
begin
  truncate public.bridge_en_district;
  insert into public.bridge_en_district (en_norm, district_norm, n_distinct)
  select en_norm,
         case when count(distinct dk) = 1 then min(dk) else null end,
         count(distinct dk)::int
  from (
    select norm_en_district(district_en) en_norm, norm_district_tok(district_ar) dk
    from public.district_name_bridge
  ) z
  where en_norm is not null and en_norm <> '' and dk is not null and dk <> '' and en_norm !~ '@'
  group by en_norm;
  get diagnostics n = row_count;
  -- city-scoped rows (2026-10-06): '<en_norm>@<city_id>', unambiguous inside that city, >= 2 ads each
  insert into public.bridge_en_district (en_norm, district_norm, n_distinct)
  select z.en_norm || '@' || z.city_id, min(z.dk), 1
  from (
    select norm_en_district(b.district_en) en_norm, norm_district_tok(b.district_ar) dk, pin.city_id
    from public.district_name_bridge b
    join lateral (
      select min(cc.city_id) as city_id
      from public.loc_city_map cm
      join public.loc_catalog_region cr on cr.region_ar = cm.region_ar
      join public.loc_catalog_city cc on cc.region_id = cr.region_id
           and (normalize_ar(cc.city_ar) = normalize_ar(cm.city_ar)
                or exists (select 1 from public.loc_catalog_city_alias al
                           where al.alias_norm = normalize_ar(cm.city_ar) and al.city_id = cc.city_id))
      where cm.city_key = lower(btrim(b.city_en))
      having count(distinct cc.city_id) = 1
    ) pin on true
    where b.n >= 2
  ) z
  where z.en_norm is not null and length(z.en_norm) >= 3 and z.en_norm !~ '@'
    and z.en_norm not in ('the', 'new', 'old', 'north', 'south', 'east', 'west', 'central', 'downtown')
    and z.dk is not null and z.dk <> ''
  group by z.en_norm, z.city_id
  having count(distinct z.dk) = 1;
  -- end city-scoped rows
  return n;
end;
$function$;

create or replace function public.resolve_district_ar(p_city_id integer, p_neighborhood text)
 returns text
 language plpgsql
 stable
as $function$
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

select public.refresh_bridge_en_district();

do $check$
begin
  if public.resolve_district_ar(3, 'Al-Malqa') is distinct from 'حي الملقا'
     or public.resolve_district_ar(3, 'Al-Arid') is distinct from 'حي العارض'
     or public.resolve_district_ar(3, 'Qurtubah') is distinct from 'حي قرطبة' then
    raise exception 'city-scoped English bridge did not resolve the Riyadh districts';
  end if;
  -- unchanged paths still hold
  if public.resolve_district_ar(3, 'Al-Janadriyah') is distinct from 'حي الجنادرية'
     or public.resolve_district_ar(3, 'The District') is not null then
    raise exception 'city-scoped English bridge changed an unrelated resolution';
  end if;
end
$check$;
