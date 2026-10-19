-- dealapp towns (owner 2026-10-19): two exact spelling aliases, and «جزيرة فرسان» placed by the ad's own pin.
--
-- 1) «بئر ابن هرماس» = بئر بن هرماس (Tabuk, 3581) and «حنيضل» = حنيظل (Qassim, 1992): the same town, spelling only.
--    Added to loc_catalog_city_alias (the catalogue alias table every resolver reads); neither written form is a
--    catalogue city name, so no twin is created. resolve_dealapp_city() now reads that table as a third arm, exact only,
--    after the exact name and the spacing-insensitive key — still one catalogue city or nothing.
-- 2) «جزيرة فرسان» is the island of «فرسان», a town both Jazan (3571) and Asir (1675) hold. The scraper applies the own-pin
--    rule to «فرسان» and writes additional_info.catalog_town_ar = 'فرسان' next to pin_city_id; the bridge reads that form
--    ONLY with city_source = 'own_pin_disambiguation'. Without a usable pin nothing is placed.
-- 3) «الخفية» (2 ads): no catalogue city, alias or district carries that name — left unplaced and listed.
set local lock_timeout = '5s';

do $alias$
declare n int;
begin
  if (select count(*) from public.loc_catalog_city where city_id = 3581 and city_ar = 'بئر بن هرماس') <> 1
     or (select count(*) from public.loc_catalog_city where city_id = 1992 and city_ar = 'حنيظل') <> 1 then
    raise exception 'alias targets moved: 3581 بئر بن هرماس / 1992 حنيظل';
  end if;
  if exists (select 1 from public.loc_catalog_city
              where city_norm in (public.normalize_ar('بئر ابن هرماس'), public.normalize_ar('حنيضل'))) then
    raise exception 'an alias spelling is already a catalogue city name — it would make a twin';
  end if;
  insert into public.loc_catalog_city_alias (alias_norm, city_id)
  select v.a, v.c from (values (public.normalize_ar('بئر ابن هرماس'), 3581), (public.normalize_ar('حنيضل'), 1992)) v(a, c)
   where not exists (select 1 from public.loc_catalog_city_alias x where x.alias_norm = v.a);
  select count(*) into n from public.loc_catalog_city_alias
   where (alias_norm, city_id) in ((public.normalize_ar('بئر ابن هرماس'), 3581), (public.normalize_ar('حنيضل'), 1992));
  if n <> 2 then raise exception 'alias rows: % of 2', n; end if;
  if exists (select 1 from public.loc_catalog_city_alias group by alias_norm having count(distinct city_id) > 1) then
    raise exception 'an alias now names two catalogue cities';
  end if;
end $alias$;

-- Needle edits on the live resolve_dealapp_city() (last full definition 20261018081657, then 20261019001829).
do $edit$
declare
  src text;
  edits text[][] := array[
    ['               r.additional_info->>''city_ar'' as city_ar,
',
     '               case when r.additional_info->>''city_source'' = ''own_pin_disambiguation''
                    then coalesce(nullif(r.additional_info->>''catalog_town_ar'', ''''), r.additional_info->>''city_ar'')
                    else r.additional_info->>''city_ar'' end as city_ar,  -- 2026-10-19: «جزيرة فرسان» → «فرسان», pin only
'],
    ['          and (g.pin_city_id is null or lc.city_id = g.pin_city_id)
      ),
      resolved as (
',
     '          and (g.pin_city_id is null or lc.city_id = g.pin_city_id)
        union all
        -- 2026-10-19: a written form the catalogue holds only as an exact alias (loc_catalog_city_alias)
        select g.*, a.city_id
        from gap g
        join public.loc_catalog_city_alias a on a.alias_norm = normalize_ar(g.city_ar)
        where not exists (select 1 from public.loc_catalog_city e where e.city_norm = normalize_ar(g.city_ar))
          and (g.pin_city_id is null or a.city_id = g.pin_city_id)
      ),
      resolved as (
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

-- PROOF, always rolled back, on real unplaced ads:
--   (a) DA415659 «بئر ابن هرماس» → بئر بن هرماس / Tabuk and DA451263 «حنيضل» → حنيظل / Qassim, through the alias rows;
--   (b) DA418566 «جزيرة فرسان» with the scraper's pin pick → فرسان / Jazan, review_reason own_pin_disambiguation;
--   (c) the same pick WITHOUT the provenance places nothing.
do $proof$
declare v_case text; got text; n int;
begin
  foreach v_case in array array['a', 'b', 'c'] loop
    begin
      if v_case <> 'a' then
        update public.dealapp_residential_listings
           set additional_info = additional_info || case v_case
                 when 'b' then jsonb_build_object('pin_city_id', 3571, 'city_source', 'own_pin_disambiguation', 'catalog_town_ar', 'فرسان')
                 else jsonb_build_object('pin_city_id', 3571, 'catalog_town_ar', 'فرسان') end
         where id = 14985818 and additional_info->>'city_ar' = 'جزيرة فرسان' and city is null;
        get diagnostics n = row_count;
        if n <> 1 then raise exception 'PROOF: DA418566 is not an unplaced «جزيرة فرسان» row'; end if;
      end if;
      perform public.resolve_dealapp_city();
      select string_agg(l.index_id || '=' || coalesce(l.city_ar, '') || '/' || coalesce(l.region_ar, '') || '/' || coalesce(l.review_reason, ''), ';' order by l.index_id)
        into got from public.listings_arabic_locations l
       where l.index_id in ('dealapp_residential_listings:7853423', 'dealapp_residential_listings:6201976',
                            'dealapp_residential_listings:14985818');
      raise exception 'PROOF_OUT|%', coalesce(got, '');
    exception when others then
      if sqlerrm not like 'PROOF_OUT|%' then raise; end if;
      got := substr(sqlerrm, 11);
      if position('dealapp_residential_listings:7853423=بئر بن هرماس/منطقة تبوك/dealapp_arabic_city_bridge' in got) = 0
         or position('dealapp_residential_listings:6201976=حنيظل/منطقة القصيم/dealapp_arabic_city_bridge' in got) = 0 then
        raise exception 'PROOF (%): an alias ad was not placed: %', v_case, got;
      end if;
      if v_case = 'b' and position('dealapp_residential_listings:14985818=فرسان/منطقة جازان/own_pin_disambiguation' in got) = 0 then
        raise exception 'PROOF (b): the island was not placed in Jazan by its pin: %', got;
      end if;
      if v_case in ('a', 'c') and position('14985818' in got) > 0 then
        raise exception 'PROOF (%): the island was placed without the pin provenance: %', v_case, got;
      end if;
    end;
  end loop;
  raise notice 'PROOF OK: aliases place (a); the island by its own pin (b); no provenance places nothing (c)';
end $proof$;
