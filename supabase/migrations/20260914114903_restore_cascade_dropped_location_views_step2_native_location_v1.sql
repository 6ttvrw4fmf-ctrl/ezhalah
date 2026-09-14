-- STEP 2: recreate listing_native_location_v1 (see step 1's header for the full CASCADE chain).
--
-- SOURCE OF THE BODY: sql/mirrors/listing_native_location_v1.sql, which the repo regenerates
-- verbatim from pg_get_viewdef and byte-verifies. Re-checked here before use — md5
-- 5fb92dbf2a54966df41d0401918a9af5 over 26,127 chars, exactly the value its header records for the
-- 2026-09-14 rakez splice, i.e. what production served immediately before the drop. It carries all
-- 36 platform-arm references, rakez/suwar/amlakalahsa/aqaralsaudia included, so nothing activated in
-- the last eight days is un-wired by this restore. The ops_ddl_snapshot copy is NOT used for the
-- body: at 14,189 chars it predates those four platforms and would have silently un-wired them.
-- Its indexes and grants ARE replayed from the snapshot, since those have not moved.
create materialized view public.listing_native_location_v1 as
 WITH native AS (
         SELECT 'alhoshan'::text AS platform,
            'alhoshan_residential_listings'::text AS source_table,
            alhoshan_residential_listings.id AS listing_id,
            alhoshan_residential_listings.city_ar,
            alhoshan_residential_listings.city_id,
            alhoshan_residential_listings.district_ar,
            alhoshan_residential_listings.region_id,
            'native_scraper'::text AS source_method,
            alhoshan_residential_listings.transaction_type
           FROM alhoshan_residential_listings
          WHERE alhoshan_residential_listings.active
        UNION ALL
         SELECT 'alhoshan'::text AS text,
            'alhoshan_commercial_listings'::text AS text,
            alhoshan_commercial_listings.id,
            alhoshan_commercial_listings.city_ar,
            alhoshan_commercial_listings.city_id,
            alhoshan_commercial_listings.district_ar,
            alhoshan_commercial_listings.region_id,
            'native_scraper'::text AS text,
            alhoshan_commercial_listings.transaction_type
           FROM alhoshan_commercial_listings
          WHERE alhoshan_commercial_listings.active
        UNION ALL
         SELECT 'aldarim'::text AS text,
            'aldarim_residential_listings'::text AS text,
            aldarim_residential_listings.id,
            aldarim_residential_listings.city_ar,
            aldarim_residential_listings.city_id,
            aldarim_residential_listings.district_ar,
            aldarim_residential_listings.region_id,
            'native_scraper'::text AS text,
            aldarim_residential_listings.transaction_type
           FROM aldarim_residential_listings
          WHERE aldarim_residential_listings.active
        UNION ALL
         SELECT 'aldarim'::text AS text,
            'aldarim_commercial_listings'::text AS text,
            aldarim_commercial_listings.id,
            aldarim_commercial_listings.city_ar,
            aldarim_commercial_listings.city_id,
            aldarim_commercial_listings.district_ar,
            aldarim_commercial_listings.region_id,
            'native_scraper'::text AS text,
            aldarim_commercial_listings.transaction_type
           FROM aldarim_commercial_listings
          WHERE aldarim_commercial_listings.active
        UNION ALL
         SELECT 'rakez'::text AS platform,
            'rakez_residential_listings'::text AS source_table,
            rakez_residential_listings.id AS listing_id,
            rakez_residential_listings.city_ar,
            rakez_residential_listings.city_id,
            rakez_residential_listings.district_ar,
            rakez_residential_listings.region_id,
            'native_scraper'::text AS source_method,
            rakez_residential_listings.transaction_type
           FROM rakez_residential_listings
          WHERE rakez_residential_listings.active
        UNION ALL
         SELECT 'rakez'::text AS platform,
            'rakez_commercial_listings'::text AS source_table,
            rakez_commercial_listings.id AS listing_id,
            rakez_commercial_listings.city_ar,
            rakez_commercial_listings.city_id,
            rakez_commercial_listings.district_ar,
            rakez_commercial_listings.region_id,
            'native_scraper'::text AS source_method,
            rakez_commercial_listings.transaction_type
           FROM rakez_commercial_listings
          WHERE rakez_commercial_listings.active
        UNION ALL
         SELECT 'suwar'::text AS platform,
            'suwar_residential_listings'::text AS source_table,
            suwar_residential_listings.id AS listing_id,
            suwar_residential_listings.city_ar,
            suwar_residential_listings.city_id,
            suwar_residential_listings.district_ar,
            suwar_residential_listings.region_id,
            'native_scraper'::text AS source_method,
            suwar_residential_listings.transaction_type
           FROM suwar_residential_listings
          WHERE suwar_residential_listings.active
        UNION ALL
         SELECT 'suwar'::text AS platform,
            'suwar_commercial_listings'::text AS source_table,
            suwar_commercial_listings.id AS listing_id,
            suwar_commercial_listings.city_ar,
            suwar_commercial_listings.city_id,
            suwar_commercial_listings.district_ar,
            suwar_commercial_listings.region_id,
            'native_scraper'::text AS source_method,
            suwar_commercial_listings.transaction_type
           FROM suwar_commercial_listings
          WHERE suwar_commercial_listings.active
        UNION ALL
         SELECT 'amlakalahsa'::text AS platform,
            'amlakalahsa_residential_listings'::text AS source_table,
            amlakalahsa_residential_listings.id AS listing_id,
            amlakalahsa_residential_listings.city_ar,
            amlakalahsa_residential_listings.city_id,
            amlakalahsa_residential_listings.district_ar,
            amlakalahsa_residential_listings.region_id,
            'native_scraper'::text AS source_method,
            amlakalahsa_residential_listings.transaction_type
           FROM amlakalahsa_residential_listings
          WHERE amlakalahsa_residential_listings.active
        UNION ALL
         SELECT 'amlakalahsa'::text AS platform,
            'amlakalahsa_commercial_listings'::text AS source_table,
            amlakalahsa_commercial_listings.id AS listing_id,
            amlakalahsa_commercial_listings.city_ar,
            amlakalahsa_commercial_listings.city_id,
            amlakalahsa_commercial_listings.district_ar,
            amlakalahsa_commercial_listings.region_id,
            'native_scraper'::text AS source_method,
            amlakalahsa_commercial_listings.transaction_type
           FROM amlakalahsa_commercial_listings
          WHERE amlakalahsa_commercial_listings.active
        UNION ALL
         SELECT 'aqaralsaudia'::text AS platform,
            'aqaralsaudia_residential_listings'::text AS source_table,
            aqaralsaudia_residential_listings.id AS listing_id,
            aqaralsaudia_residential_listings.city_ar,
            aqaralsaudia_residential_listings.city_id,
            aqaralsaudia_residential_listings.district_ar,
            aqaralsaudia_residential_listings.region_id,
            'native_scraper'::text AS source_method,
            aqaralsaudia_residential_listings.transaction_type
           FROM aqaralsaudia_residential_listings
          WHERE aqaralsaudia_residential_listings.active
        UNION ALL
         SELECT 'aqaralsaudia'::text AS platform,
            'aqaralsaudia_commercial_listings'::text AS source_table,
            aqaralsaudia_commercial_listings.id AS listing_id,
            aqaralsaudia_commercial_listings.city_ar,
            aqaralsaudia_commercial_listings.city_id,
            aqaralsaudia_commercial_listings.district_ar,
            aqaralsaudia_commercial_listings.region_id,
            'native_scraper'::text AS source_method,
            aqaralsaudia_commercial_listings.transaction_type
           FROM aqaralsaudia_commercial_listings
          WHERE aqaralsaudia_commercial_listings.active
        UNION ALL
         SELECT 'remal'::text AS platform,
            'remal_residential_listings'::text AS source_table,
            remal_residential_listings.id AS listing_id,
            remal_residential_listings.city_ar,
            remal_residential_listings.city_id,
            remal_residential_listings.district_ar,
            remal_residential_listings.region_id,
            'native_scraper'::text AS source_method,
            remal_residential_listings.transaction_type
           FROM remal_residential_listings
          WHERE remal_residential_listings.active
        UNION ALL
         SELECT 'remal'::text AS platform,
            'remal_commercial_listings'::text AS source_table,
            remal_commercial_listings.id AS listing_id,
            remal_commercial_listings.city_ar,
            remal_commercial_listings.city_id,
            remal_commercial_listings.district_ar,
            remal_commercial_listings.region_id,
            'native_scraper'::text AS source_method,
            remal_commercial_listings.transaction_type
           FROM remal_commercial_listings
          WHERE remal_commercial_listings.active
        UNION ALL
         SELECT 'amaall'::text AS platform,
            'amaall_residential_listings'::text AS source_table,
            amaall_residential_listings.id AS listing_id,
            amaall_residential_listings.city_ar,
            amaall_residential_listings.city_id,
            amaall_residential_listings.district_ar,
            amaall_residential_listings.region_id,
            'native_scraper'::text AS source_method,
            amaall_residential_listings.transaction_type
           FROM amaall_residential_listings
          WHERE amaall_residential_listings.active
        UNION ALL
         SELECT 'amaall'::text AS platform,
            'amaall_commercial_listings'::text AS source_table,
            amaall_commercial_listings.id AS listing_id,
            amaall_commercial_listings.city_ar,
            amaall_commercial_listings.city_id,
            amaall_commercial_listings.district_ar,
            amaall_commercial_listings.region_id,
            'native_scraper'::text AS source_method,
            amaall_commercial_listings.transaction_type
           FROM amaall_commercial_listings
          WHERE amaall_commercial_listings.active
        UNION ALL
         SELECT 'aqarmonthly'::text AS text,
            'aqarmonthly_residential_listings'::text AS text,
            aqarmonthly_residential_listings.id,
            aqarmonthly_residential_listings.city_ar,
            aqarmonthly_residential_listings.city_id,
            aqarmonthly_residential_listings.district_ar,
            aqarmonthly_residential_listings.region_id,
            'native_scraper'::text AS text,
            aqarmonthly_residential_listings.transaction_type
           FROM aqarmonthly_residential_listings
          WHERE aqarmonthly_residential_listings.active
        UNION ALL
         SELECT 'aqargate'::text AS text,
            'aqargate_residential_listings'::text AS text,
            aqargate_residential_listings.id,
            aqargate_residential_listings.city_ar,
            aqargate_residential_listings.city_id,
            aqargate_residential_listings.district_ar,
            aqargate_residential_listings.region_id,
            'native_scraper'::text AS text,
            aqargate_residential_listings.transaction_type
           FROM aqargate_residential_listings
          WHERE aqargate_residential_listings.active
        UNION ALL
         SELECT 'aqargate'::text AS text,
            'aqargate_commercial_listings'::text AS text,
            aqargate_commercial_listings.id,
            aqargate_commercial_listings.city_ar,
            aqargate_commercial_listings.city_id,
            aqargate_commercial_listings.district_ar,
            aqargate_commercial_listings.region_id,
            'native_scraper'::text AS text,
            aqargate_commercial_listings.transaction_type
           FROM aqargate_commercial_listings
          WHERE aqargate_commercial_listings.active
        UNION ALL
         SELECT 'sanadak'::text AS text,
            'sanadak_residential_listings'::text AS text,
            sanadak_residential_listings.id,
            sanadak_residential_listings.city_ar,
            sanadak_residential_listings.city_id,
            sanadak_residential_listings.district_ar,
            sanadak_residential_listings.region_id,
            'native_scraper'::text AS text,
            sanadak_residential_listings.transaction_type
           FROM sanadak_residential_listings
          WHERE sanadak_residential_listings.active
        UNION ALL
         SELECT 'sanadak'::text AS text,
            'sanadak_commercial_listings'::text AS text,
            sanadak_commercial_listings.id,
            sanadak_commercial_listings.city_ar,
            sanadak_commercial_listings.city_id,
            sanadak_commercial_listings.district_ar,
            sanadak_commercial_listings.region_id,
            'native_scraper'::text AS text,
            sanadak_commercial_listings.transaction_type
           FROM sanadak_commercial_listings
          WHERE sanadak_commercial_listings.active
        UNION ALL
         SELECT 'hajer'::text AS text,
            'hajer_residential_listings'::text AS text,
            hajer_residential_listings.id,
            hajer_residential_listings.city_ar,
            hajer_residential_listings.city_id,
            hajer_residential_listings.district_ar,
            hajer_residential_listings.region_id,
            'native_scraper'::text AS text,
            hajer_residential_listings.transaction_type
           FROM hajer_residential_listings
          WHERE hajer_residential_listings.active
        UNION ALL
         SELECT 'hajer'::text AS text,
            'hajer_commercial_listings'::text AS text,
            hajer_commercial_listings.id,
            hajer_commercial_listings.city_ar,
            hajer_commercial_listings.city_id,
            hajer_commercial_listings.district_ar,
            hajer_commercial_listings.region_id,
            'native_scraper'::text AS text,
            hajer_commercial_listings.transaction_type
           FROM hajer_commercial_listings
          WHERE hajer_commercial_listings.active
        UNION ALL
         SELECT 'wasalt'::text AS text,
            'wasalt_residential_listings'::text AS text,
            w.id,
            w.city_ar,
            ( SELECT cc.city_id
                   FROM loc_catalog_city cc
                  WHERE cc.city_norm = normalize_ar(w.city_ar) AND (w.region_id IS NULL OR cc.region_id = w.region_id)
                 LIMIT 1) AS city_id,
            w.district_ar,
            w.region_id,
            'native_scraper'::text AS text,
            w.transaction_type
           FROM wasalt_residential_listings w
          WHERE w.active AND w.ar_fetched
        UNION ALL
         SELECT 'wasalt'::text AS text,
            'wasalt_commercial_listings'::text AS text,
            w.id,
            w.city_ar,
            ( SELECT cc.city_id
                   FROM loc_catalog_city cc
                  WHERE cc.city_norm = normalize_ar(w.city_ar) AND (w.region_id IS NULL OR cc.region_id = w.region_id)
                 LIMIT 1) AS city_id,
            w.district_ar,
            w.region_id,
            'native_scraper'::text AS text,
            w.transaction_type
           FROM wasalt_commercial_listings w
          WHERE w.active AND w.ar_fetched
        UNION ALL
         SELECT 'aqar'::text AS text,
            'aqar_residential_listings'::text AS text,
            a.id,
            s.city_ar_parsed,
            s.parsed_city_id,
            NULL::text AS text,
            c.region_id,
            'aqar_parser'::text AS text,
            a.transaction_type
           FROM aqar_residential_listings a
             JOIN aqar_shadow_resolved s ON s.id = a.id
             LEFT JOIN loc_catalog_city c ON c.city_id = s.parsed_city_id
          WHERE a.active AND s.parsed_city_id IS NOT NULL
        UNION ALL
         SELECT 'aqar'::text AS text,
            'aqar_commercial_listings'::text AS text,
            a.id,
            s.city_ar_parsed,
            s.parsed_city_id,
            NULL::text AS text,
            c.region_id,
            'aqar_parser'::text AS text,
            a.transaction_type
           FROM aqar_commercial_listings a
             JOIN aqar_shadow_resolved s ON s.id = a.id
             LEFT JOIN loc_catalog_city c ON c.city_id = s.parsed_city_id
          WHERE a.active AND s.parsed_city_id IS NOT NULL
        UNION ALL
         SELECT p.platform,
            p.source_table,
            p.listing_id,
            p.city_ar_src,
            p.city_id,
            NULL::text AS text,
            p.region_id,
            'phasea'::text AS text,
            NULL::text AS text
           FROM phasea_shadow_resolution p
          WHERE p.city_id IS NOT NULL
        UNION ALL
         SELECT 'satel'::text AS text,
            'satel_residential_listings'::text AS text,
            s.id,
            s.additional_info ->> 'city_ar'::text,
            ( SELECT cc.city_id
                   FROM loc_catalog_city cc
                  WHERE cc.city_norm = normalize_ar(s.additional_info ->> 'city_ar'::text)
                 LIMIT 1) AS city_id,
            s.additional_info ->> 'district_ar'::text,
            ( SELECT cc.region_id
                   FROM loc_catalog_city cc
                  WHERE cc.city_norm = normalize_ar(s.additional_info ->> 'city_ar'::text)
                 LIMIT 1) AS region_id,
            'native_scraper'::text AS text,
            s.transaction_type
           FROM satel_residential_listings s
          WHERE s.active
        UNION ALL
         SELECT 'satel'::text AS text,
            'satel_commercial_listings'::text AS text,
            s.id,
            s.additional_info ->> 'city_ar'::text,
            ( SELECT cc.city_id
                   FROM loc_catalog_city cc
                  WHERE cc.city_norm = normalize_ar(s.additional_info ->> 'city_ar'::text)
                 LIMIT 1) AS city_id,
            s.additional_info ->> 'district_ar'::text,
            ( SELECT cc.region_id
                   FROM loc_catalog_city cc
                  WHERE cc.city_norm = normalize_ar(s.additional_info ->> 'city_ar'::text)
                 LIMIT 1) AS region_id,
            'native_scraper'::text AS text,
            s.transaction_type
           FROM satel_commercial_listings s
          WHERE s.active
        UNION ALL
         SELECT 'abwbna'::text AS platform,
            'abwbna_residential_listings'::text AS source_table,
            abwbna_residential_listings.id AS listing_id,
            abwbna_residential_listings.city_ar,
            abwbna_residential_listings.city_id,
            abwbna_residential_listings.district_ar,
            abwbna_residential_listings.region_id,
            'native_scraper'::text AS source_method,
            abwbna_residential_listings.transaction_type
           FROM abwbna_residential_listings
          WHERE abwbna_residential_listings.active
        UNION ALL
         SELECT 'abwbna'::text AS platform,
            'abwbna_commercial_listings'::text AS source_table,
            abwbna_commercial_listings.id AS listing_id,
            abwbna_commercial_listings.city_ar,
            abwbna_commercial_listings.city_id,
            abwbna_commercial_listings.district_ar,
            abwbna_commercial_listings.region_id,
            'native_scraper'::text AS source_method,
            abwbna_commercial_listings.transaction_type
           FROM abwbna_commercial_listings
          WHERE abwbna_commercial_listings.active
        UNION ALL
         SELECT 'bahadhabab'::text AS platform,
            'bahadhabab_residential_listings'::text AS source_table,
            bahadhabab_residential_listings.id AS listing_id,
            bahadhabab_residential_listings.city_ar,
            bahadhabab_residential_listings.city_id,
            bahadhabab_residential_listings.district_ar,
            bahadhabab_residential_listings.region_id,
            'native_scraper'::text AS source_method,
            bahadhabab_residential_listings.transaction_type
           FROM bahadhabab_residential_listings
          WHERE bahadhabab_residential_listings.active
        UNION ALL
         SELECT 'bahadhabab'::text AS platform,
            'bahadhabab_commercial_listings'::text AS source_table,
            bahadhabab_commercial_listings.id AS listing_id,
            bahadhabab_commercial_listings.city_ar,
            bahadhabab_commercial_listings.city_id,
            bahadhabab_commercial_listings.district_ar,
            bahadhabab_commercial_listings.region_id,
            'native_scraper'::text AS source_method,
            bahadhabab_commercial_listings.transaction_type
           FROM bahadhabab_commercial_listings
          WHERE bahadhabab_commercial_listings.active
        UNION ALL
         SELECT 'alobid'::text AS platform,
            'alobid_residential_listings'::text AS source_table,
            alobid_residential_listings.id AS listing_id,
            alobid_residential_listings.city_ar,
            alobid_residential_listings.city_id,
            alobid_residential_listings.district_ar,
            alobid_residential_listings.region_id,
            'native_scraper'::text AS source_method,
            alobid_residential_listings.transaction_type
           FROM alobid_residential_listings
          WHERE alobid_residential_listings.active
        UNION ALL
         SELECT 'alobid'::text AS platform,
            'alobid_commercial_listings'::text AS source_table,
            alobid_commercial_listings.id AS listing_id,
            alobid_commercial_listings.city_ar,
            alobid_commercial_listings.city_id,
            alobid_commercial_listings.district_ar,
            alobid_commercial_listings.region_id,
            'native_scraper'::text AS source_method,
            alobid_commercial_listings.transaction_type
           FROM alobid_commercial_listings
          WHERE alobid_commercial_listings.active
        UNION ALL
         SELECT 'azdad'::text AS platform,
            'azdad_residential_listings'::text AS source_table,
            azdad_residential_listings.id AS listing_id,
            azdad_residential_listings.city_ar,
            azdad_residential_listings.city_id,
            azdad_residential_listings.district_ar,
            azdad_residential_listings.region_id,
            'native_scraper'::text AS source_method,
            azdad_residential_listings.transaction_type
           FROM azdad_residential_listings
          WHERE azdad_residential_listings.active
        UNION ALL
         SELECT 'azdad'::text AS platform,
            'azdad_commercial_listings'::text AS source_table,
            azdad_commercial_listings.id AS listing_id,
            azdad_commercial_listings.city_ar,
            azdad_commercial_listings.city_id,
            azdad_commercial_listings.district_ar,
            azdad_commercial_listings.region_id,
            'native_scraper'::text AS source_method,
            azdad_commercial_listings.transaction_type
           FROM azdad_commercial_listings
          WHERE azdad_commercial_listings.active
        ), legacy AS (
         SELECT lal_1.platform,
            lal_1.source_table,
            lal_1.listing_id,
            lal_1.city_ar,
            COALESCE(lsc.city_id, lgc.city_id) AS city_id,
            lal_1.district_ar,
            COALESCE(lsc.region_id, lgc.region_id) AS region_id,
            'legacy_derived'::text AS source_method,
            NULL::text AS transaction_type
           FROM listings_arabic_locations lal_1
             LEFT JOIN LATERAL ( SELECT min(c.city_id) AS city_id,
                    min(c.region_id) AS region_id
                   FROM loc_catalog_city c
                     JOIN loc_catalog_region r ON r.region_id = c.region_id
                  WHERE c.city_norm = normalize_ar(lal_1.city_ar) AND lal_1.region_ar IS NOT NULL AND normalize_ar(r.region_ar) = normalize_ar(lal_1.region_ar)
                 HAVING count(DISTINCT c.city_id) = 1) lsc ON true
             LEFT JOIN LATERAL ( SELECT c2.city_id,
                    c2.region_id
                   FROM loc_catalog_city c2
                  WHERE c2.city_norm = normalize_ar(lal_1.city_ar)
                  ORDER BY c2.city_id
                 LIMIT 1) lgc ON true
          WHERE lal_1.city_ar IS NOT NULL
        ), ranked AS (
         SELECT native.platform,
            native.source_table,
            native.listing_id,
            native.city_ar,
            native.city_id,
            native.district_ar,
            native.region_id,
            native.source_method,
            native.transaction_type,
            1 AS priority
           FROM native
        UNION ALL
         SELECT legacy.platform,
            legacy.source_table,
            legacy.listing_id,
            legacy.city_ar,
            legacy.city_id,
            legacy.district_ar,
            legacy.region_id,
            legacy.source_method,
            legacy.transaction_type,
            2 AS priority
           FROM legacy
        ), best AS (
         SELECT DISTINCT ON (ranked.platform, ranked.listing_id) ranked.platform,
            ranked.source_table,
            ranked.listing_id,
            ranked.city_ar,
            ranked.city_id,
            ranked.district_ar,
            ranked.region_id,
            ranked.source_method,
            ranked.transaction_type,
            ranked.priority
           FROM ranked
          ORDER BY ranked.platform, ranked.listing_id, ranked.priority, ranked.source_method
        )
 SELECT b.platform,
    b.source_table,
    b.listing_id,
    COALESCE(b.transaction_type,
        CASE lower(llc.purpose)
            WHEN 'buy'::text THEN 'Buy'::text
            WHEN 'rent'::text THEN 'Rent'::text
            ELSE NULL::text
        END) AS transaction_type,
    b.region_id,
    b.city_id,
    b.city_ar,
    COALESCE(
        CASE
            WHEN btrim(b.district_ar) = ANY (ARRAY[''::text, 'غير محدد'::text, 'اخرى'::text, 'أخرى'::text]) THEN NULL::text
            ELSE btrim(b.district_ar)
        END,
        CASE
            WHEN btrim(lal.district_ar) = ANY (ARRAY[''::text, 'غير محدد'::text, 'اخرى'::text, 'أخرى'::text]) THEN NULL::text
            ELSE btrim(lal.district_ar)
        END) AS district_ar,
    cr.region_ar,
    b.source_method,
    b.region_id IS NOT NULL AND b.city_id IS NOT NULL AS production_ready,
    llc.last_updated
   FROM best b
     LEFT JOIN listings_arabic_locations lal ON lal.platform = b.platform AND lal.listing_id = b.listing_id
     LEFT JOIN listing_location_canonical llc ON llc.platform = b.platform AND llc.listing_id = b.listing_id
     LEFT JOIN loc_catalog_region cr ON cr.region_id = b.region_id;

do $idx$
declare r record; failed text[] := '{}'; n int := 0;
begin
  for r in
    select ddl, obj_kind from ops_ddl_snapshot
    where label = 'pre_remal_amaall_activation_20260906'
      and obj_name = 'listing_native_location_v1' and obj_kind in ('index','grant')
    order by case obj_kind when 'index' then 1 else 2 end, ordinal, id
  loop
    begin
      execute r.ddl; n := n + 1;
    exception
      when duplicate_table or duplicate_object then n := n + 1;
      when others then failed := array_append(failed, r.obj_kind||' -> '||sqlerrm);
    end;
  end loop;
  raise notice 'v1 indexes/grants replayed: % ok, % failed', n, coalesce(array_length(failed,1),0);
end
$idx$;

do $verify$
declare v1_rows bigint; v1_idx int; plats int;
begin
  select count(*) into v1_rows from public.listing_native_location_v1;
  if v1_rows = 0 then raise exception 'listing_native_location_v1 came back EMPTY'; end if;
  select count(*) into v1_idx from pg_indexes
   where schemaname='public' and tablename='listing_native_location_v1';
  if v1_idx < 7 then raise exception 'v1 has only % of its 7 indexes', v1_idx; end if;
  select count(distinct platform) into plats from public.listing_native_location_v1
   where platform in ('rakez','suwar','amlakalahsa','aqaralsaudia');
  if plats <> 4 then
    raise exception 'v1 restored WITHOUT the four recent platforms (found %) - the body was stale', plats;
  end if;
  raise notice 'v1 restored: % rows, % indexes, all four recent platforms present', v1_rows, v1_idx;
end
$verify$;
