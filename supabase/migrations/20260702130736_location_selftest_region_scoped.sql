-- Tripwire refined: fail ONLY when listings are HIDDEN (id-linked rows unreachable by the
-- canonical name + region-pinned query — exactly how the app searches after twin disambiguation).
-- Twin-name unions (got > expected without region pin) are by-design, not failures.
create or replace function public.location_selftest()
returns table(kind text, name text, expected bigint, got bigint)
language sql stable as $$
  select 'city'::text, c.city_ar, count(*)::bigint as expected,
         (select count(*) from search_listings_ar s2
           where s2.production_ready and s2.region_id = c.region_id
             and (normalize_ar(s2.city_ar) = normalize_ar(c.city_ar) or s2.city_id = c.city_id))::bigint as got
  from search_listings_ar s
  join loc_catalog_city c on c.city_id = s.city_id
  where s.production_ready
  group by c.city_id, c.city_ar, c.region_id
  having count(*) > (select count(*) from search_listings_ar s2
                      where s2.production_ready and s2.region_id = c.region_id
                        and (normalize_ar(s2.city_ar) = normalize_ar(c.city_ar) or s2.city_id = c.city_id))
  union all
  select 'region', r.region_ar, count(*)::bigint,
         (select count(*) from search_listings_ar s2 where s2.production_ready and s2.region_id = r.region_id)::bigint
  from search_listings_ar s
  join loc_catalog_region r on r.region_id = s.region_id
  where s.production_ready
  group by r.region_id, r.region_ar
  having count(*) <> (select count(*) from search_listings_ar s2 where s2.production_ready and s2.region_id = r.region_id)
  union all
  select 'district', d.city_ar || ' / ' || d.district_ar, d.n,
         (select count(*) from search_listings_ar s2
           where s2.production_ready and s2.city_id = d.city_id
             and regexp_replace(normalize_ar(s2.district_ar), '^حي\s+', '')
               = regexp_replace(normalize_ar(d.district_ar), '^حي\s+', ''))::bigint
  from (select city_id, max(city_ar) city_ar, district_ar, count(*)::bigint n
        from search_listings_ar where production_ready and district_ar is not null and city_id is not null
        group by city_id, district_ar) d
  where d.n > (select count(*) from search_listings_ar s2
                where s2.production_ready and s2.city_id = d.city_id
                  and regexp_replace(normalize_ar(s2.district_ar), '^حي\s+', '')
                    = regexp_replace(normalize_ar(d.district_ar), '^حي\s+', ''));
$$;
notify pgrst, 'reload schema';