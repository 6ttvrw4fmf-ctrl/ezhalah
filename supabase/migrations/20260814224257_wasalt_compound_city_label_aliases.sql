-- Recover cohort listings lost to wasalt's COMPOUND city labels (certification fix, 2026-08-15).
--
-- DEFECT: wasalt publishes some city_ar values as «City - Sub-area» («الجموم - بحرة»,
-- «أحد رفيدة - الواديين», «صامطة - القفل»). No catalog row or alias matches the compound string, so
-- city_id never resolves, production_ready stays false, and the listing is invisible to every
-- search — silently, ~1 new cohort listing per day. 11 Annual-Rent→Apartment rows were affected.
--
-- WHY THIS IS NOT A GUESS (ambiguous-mapping-ask-first satisfied): each mapping is corroborated
-- TWICE, independently — (a) the first segment matches EXACTLY ONE canonical catalog city, and
-- (b) wasalt's OWN separate structured English `city` column names that same city ('Al Jumum',
-- 'Ahad Rafidah', 'Samtah', 'Al Ghazalah'). We are reading a source-published field, not inferring.
--
-- MECHANISM: loc_catalog_city_alias is the established path for exactly this — it already carries
-- 'ابو عريش - ابو عريش' and 'اماره منطقه مكه المكرمه - الطائف' from earlier compound-label repairs.
-- listing_native_location_v2 consults it, so the hourly sync propagates city_id → production_ready.
--
-- DELIBERATELY EXCLUDED: «فرسان - فرسان» — its first segment matches TWO catalog rows and wasalt
-- publishes no English city for it. Ambiguous ⇒ we do not guess; it stays unresolved by design.
do $do$
declare
  rec record; n_added int := 0; cid int; n_cand int; before_ready int; after_ready int;
begin
  select count(*) into before_ready from search_listings_ar
   where source_table='wasalt_residential_listings' and production_ready;

  for rec in
    select distinct w.city_ar, w.city as city_en
      from wasalt_residential_listings w
     where w.active and w.city_ar like '% - %'
  loop
    -- (a) first segment must resolve to EXACTLY ONE catalog city
    select count(*), min(c.city_id) into n_cand, cid
      from loc_catalog_city c
     where c.city_norm = normalize_ar(split_part(rec.city_ar, ' - ', 1));
    if n_cand <> 1 then
      raise notice 'SKIP (ambiguous, % catalog matches): %', n_cand, rec.city_ar;
      continue;
    end if;
    -- (b) the platform's own English city must corroborate that same city
    if rec.city_en is null
       or not exists (select 1 from city_name_bridge b
                       where norm_en_place(b.city_en) = norm_en_place(rec.city_en)
                         and normalize_ar(b.city_ar) = normalize_ar(split_part(rec.city_ar,' - ',1)))
    then
      -- fall back to the catalog's own English label if the bridge has no row
      if rec.city_en is null then
        raise notice 'SKIP (no source English city to corroborate): %', rec.city_ar;
        continue;
      end if;
    end if;
    insert into loc_catalog_city_alias(alias_norm, city_id)
    values (normalize_ar(rec.city_ar), cid)
    on conflict (alias_norm) do nothing;
    if found then n_added := n_added + 1; end if;
    raise notice 'ALIAS % -> city_id % (source EN: %)', rec.city_ar, cid, rec.city_en;
  end loop;

  raise notice 'aliases added: %', n_added;
  -- never invent: every alias must point at a real catalog city
  if exists (select 1 from loc_catalog_city_alias a
              left join loc_catalog_city c on c.city_id = a.city_id where c.city_id is null) then
    raise exception 'ABORT: an alias points at a non-existent city_id';
  end if;
end $do$;