-- dealapp: a town that is a catalogue city in SEVERAL regions is placed by the ad's OWN pin, or not at all
-- (owner 2026-10-18).
--
-- 151 served dealapp ads had no city. 132 of them name a town the catalogue holds in several regions: «الكهفة» (Eastern
-- AND Hail), «الدرب» (Asir AND Jazan), «قصيباء» (four regions), «القصب», «الفويلق», «الرفيعة», «الرويضة», «الحرجة».
-- resolve_dealapp_city() rightly placed none of them: a name alone never picks a twin.
--
-- The ad's own pin now decides. The scraper (scrapers/common/arabic_location.py city_by_own_pin) writes
-- additional_info.pin_city_id with additional_info.city_source = 'own_pin_disambiguation' ONLY when the pin sits inside
-- exactly one candidate's region (so inside KSA), at least 15 km from every other candidate's region, and that region
-- holds exactly one city of the name. This bridge narrows the name's catalogue candidates to that city, and only when
-- that city carries the name; anything else stays NULL. Provenance: review_reason 'own_pin_disambiguation'.
-- Bridge rows also now update when the region changes, not only the city name (the city name is shared by the twins).
--
-- Needle edits on the live body (the last full definition is 20261018081657); each needle must occur exactly once.
set local lock_timeout = '5s';

do $edit$
declare
  src text;
  edits text[][] := array[
    ['               r.additional_info->>''city_ar'' as city_ar
        from public.search_listings_ar s
',
     '               r.additional_info->>''city_ar'' as city_ar,
               -- 2026-10-18: the scraper''s own-pin pick for a town that is a city in several regions
               case when r.additional_info->>''city_source'' = ''own_pin_disambiguation''
                    then nullif(r.additional_info->>''pin_city_id'', '''')::int end as pin_city_id
        from public.search_listings_ar s
'],
    ['        join public.loc_catalog_city lc on lc.city_norm = normalize_ar(g.city_ar)
        union all
',
     '        join public.loc_catalog_city lc on lc.city_norm = normalize_ar(g.city_ar)
         and (g.pin_city_id is null or lc.city_id = g.pin_city_id)
        union all
'],
    ['        where not exists (select 1 from public.loc_catalog_city e where e.city_norm = normalize_ar(g.city_ar))
      ),
',
     '        where not exists (select 1 from public.loc_catalog_city e where e.city_norm = normalize_ar(g.city_ar))
          and (g.pin_city_id is null or lc.city_id = g.pin_city_id)
      ),
'],
    ['        select c.id, c.platform, c.deal_ar, c.raw_city_en, c.city_ar,
               min(c.city_id) as city_id, count(distinct c.city_id) as n_cat
        from cand c
        group by c.id, c.platform, c.deal_ar, c.raw_city_en, c.city_ar
',
     '        select c.id, c.platform, c.deal_ar, c.raw_city_en, c.city_ar, c.pin_city_id,
               min(c.city_id) as city_id, count(distinct c.city_id) as n_cat
        from cand c
        group by c.id, c.platform, c.deal_ar, c.raw_city_en, c.city_ar, c.pin_city_id
'],
    ['               nullif(btrim(x.raw_city_en), ''''), cc.city_ar, cr.region_ar, true, ''dealapp_arabic_city_bridge''
',
     '               nullif(btrim(x.raw_city_en), ''''), cc.city_ar, cr.region_ar, true,
               case when x.pin_city_id is not null then ''own_pin_disambiguation'' else ''dealapp_arabic_city_bridge'' end
'],
    ['              review_reason = ''dealapp_arabic_city_bridge''
          where public.listings_arabic_locations.city_ar is distinct from excluded.city_ar
',
     '              review_reason = excluded.review_reason
          where (public.listings_arabic_locations.city_ar, public.listings_arabic_locations.region_ar)
                is distinct from (excluded.city_ar, excluded.region_ar)
']
  ];
  i int;
  k int;
begin
  select pg_get_functiondef(p.oid) into src from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.proname = 'resolve_dealapp_city';
  if src is null then raise exception 'resolve_dealapp_city not found'; end if;
  for i in 1 .. array_length(edits, 1) loop
    k := (length(src) - length(replace(src, edits[i][1], ''))) / length(edits[i][1]);
    if k <> 1 then raise exception 'edit %: needle found % times, want 1', i, k; end if;
    src := replace(src, edits[i][1], edits[i][2]);
  end loop;
  execute src;
end $edit$;

-- PROOF on a real unplaced «الكهفة» ad (DA417737, residential id 7056927, pinned in Hail), always rolled back:
--   (a) the pin pick with its provenance places it in Hail with review_reason 'own_pin_disambiguation';
--   (b) the same pick WITHOUT the provenance places nothing;  (c) a pick of a city with another name places nothing.
do $proof$
declare v_case text; v_city text; v_region text; v_reason text; n int;
begin
  foreach v_case in array array['a', 'b', 'c'] loop
    begin
      update public.dealapp_residential_listings
         set additional_info = additional_info || case v_case
               when 'a' then jsonb_build_object('pin_city_id', 1965, 'city_source', 'own_pin_disambiguation')
               when 'b' then jsonb_build_object('pin_city_id', 1965)
               else jsonb_build_object('pin_city_id', 3402, 'city_source', 'own_pin_disambiguation') end
       where id = 7056927 and additional_info->>'city_ar' = 'الكهفة' and city is null;
      get diagnostics n = row_count;
      if n <> 1 then raise exception 'PROOF: DA417737 is not an unplaced «الكهفة» row'; end if;
      perform public.resolve_dealapp_city();
      select l.city_ar, l.region_ar, l.review_reason into v_city, v_region, v_reason
        from public.listings_arabic_locations l where l.index_id = 'dealapp_residential_listings:7056927';
      raise exception 'PROOF_OUT|%|%|%', coalesce(v_city, ''), coalesce(v_region, ''), coalesce(v_reason, '');
    exception when others then
      if sqlerrm not like 'PROOF_OUT|%' then raise; end if;
      v_city := split_part(sqlerrm, '|', 2); v_region := split_part(sqlerrm, '|', 3);
      if v_case = 'a' and (v_city, v_region, split_part(sqlerrm, '|', 4))
           is distinct from ('الكهفة', 'منطقة حائل', 'own_pin_disambiguation') then
        raise exception 'PROOF (a): the own pin did not place DA417737 in Hail: %', sqlerrm;
      end if;
      if v_case in ('b', 'c') and v_city <> '' then
        raise exception 'PROOF (%): a pick without provenance / of another name placed DA417737: %', v_case, sqlerrm;
      end if;
    end;
  end loop;
  if exists (select 1 from public.listings_arabic_locations where index_id = 'dealapp_residential_listings:7056927') then
    raise exception 'PROOF: the rollback left a bridge row behind';
  end if;
  raise notice 'PROOF OK: own pin places (a); no provenance (b) and another name (c) place nothing';
end $proof$;
