-- Homes filed under a retired place move to their real town (owner 2026-10-26 «one name, one list»; backlog #894).
--
-- 20261026013519 retired 13 own-name districts, 11 districts that are really cities (G2), 29 city rows that are
-- really districts (G3) and 12 duplicate cities (G4), and left «move their homes» to the New Listings Engineer. It
-- was still open on 2026-10-30: ~520 served homes sat under a retired place — 140 under the city «الهياثم» (a
-- district of الخرج), 45 under «حي جواثا» in الاحساء (the town جواثا), 22 «بيش» homes served in منطقة عسير
-- because the retired duplicate carried the wrong region.
--
-- Mechanism: listing_city_correction (already read by listing_native_location_v2, which takes city, city name AND
-- region from the corrected city) gets city_source 'retired_place_remap', recomputed hourly from the retired rows'
-- own retired_why, so a later retirement is picked up without a code change. Region-safe: a move that would change
-- the home's region is allowed only between two rows of the SAME town (G4 duplicate, ≤ 40 km — the kept row always
-- carries the right region, checked 2026-10-30); a G3 / chained move across regions is skipped (13 homes) and stays
-- for the engineer. Nothing is deleted, the source tables are untouched (SOURCE IS TRUTH).
--
-- Also: source_district_dropped stops counting a district the display hides ON PURPOSE (a town written as its own
-- district, «حي ثول» in ثول — owner 2026-10-26). Those were ~1,500 of its ~1,700 «dropped» rows on 2026-10-30.

create or replace function public.retired_place_remap_rows()
returns table(source_table text, listing_id bigint, old_city_id integer, new_city_id integer, kind text)
language sql stable security definer set search_path = public as $$
  with tc as (
    select c.city_id as src, c.region_id as src_region,
           coalesce((regexp_match(c.retired_why, 'duplicate of city (\d+)'))[1],
                    (regexp_match(c.retired_why, '\(city (\d+)'))[1])::int as t1,
           c.retired_why like 'duplicate of city%' as dup
      from public.loc_catalog_city c where c.retired_at is not null
  ), tc2 as (
    select tc.src, tc.src_region,
           case when t.retired_at is null then tc.t1 end as tgt,
           tc.dup
      from tc join public.loc_catalog_city t on t.city_id = tc.t1
  ), g34 as (
    select v1.source_table, v1.listing_id, v1.city_id as old_city_id, tc2.tgt as new_city_id,
           case when tc2.dup then 'duplicate_city' else 'city_is_district' end as kind
      from public.listing_native_location_v1 v1
      join tc2 on tc2.src = v1.city_id
      join public.loc_catalog_city n on n.city_id = tc2.tgt
     where tc2.tgt is not null and (n.region_id = tc2.src_region or tc2.dup)
  ), g2d as (
    select d.city_id, public.district_key_letters(d.district_ar) as k,
           (regexp_match(d.retired_why, '\(city (\d+)'))[1]::int as tgt
      from public.loc_catalog_district d
     where d.retired_at is not null and d.retired_why like 'is the city%'
  ), g2 as (
    select v1.source_table, v1.listing_id, v1.city_id, g2d.tgt, 'district_is_city'
      from public.listing_native_location_v1 v1
      left join public.district_recovery dr on dr.source_table = v1.source_table and dr.listing_id = v1.listing_id
      join g2d on g2d.city_id = v1.city_id
              and g2d.k = public.district_key_letters(coalesce(nullif(btrim(v1.district_ar), ''), dr.district_ar))
      join public.loc_catalog_city o on o.city_id = v1.city_id
      join public.loc_catalog_city n on n.city_id = g2d.tgt
     where n.retired_at is null and n.region_id = o.region_id
  )
  select * from g34 union all select * from g2;
$$;

create or replace function public.refresh_retired_place_remap()
returns bigint language plpgsql security definer set search_path = public as $$
declare n bigint;
begin
  delete from public.listing_city_correction where city_source = 'retired_place_remap';
  insert into public.listing_city_correction (source_table, listing_id, city_id, city_source, district_norm)
  select r.source_table, r.listing_id, r.new_city_id, 'retired_place_remap', r.kind
    from public.retired_place_remap_rows() r
  on conflict (source_table, listing_id) do nothing;
  get diagnostics n = row_count;
  return n;
end $$;

CREATE OR REPLACE FUNCTION public.refresh_listing_city_correction()
 RETURNS bigint
 LANGUAGE plpgsql
AS $function$
declare n bigint;
begin
  delete from public.listing_city_correction where city_source = 'unique_district_in_governorate';
  insert into public.listing_city_correction (source_table, listing_id, city_id, city_source, district_norm)
  select v1.source_table, v1.listing_id, u.city_id, 'unique_district_in_governorate', u.district_norm
    from public.listing_native_location_v1 v1
    left join public.district_recovery dr on dr.source_table = v1.source_table and dr.listing_id = v1.listing_id
    join (select d.district_norm, min(d.city_id) as city_id
            from public.loc_catalog_district d
           where d.city_id = any (public.ahsa_governorate_city_ids())
           group by d.district_norm
          having count(distinct d.city_id) = 1) u
      on u.district_norm = public.norm_district_tok(coalesce(nullif(btrim(v1.district_ar), ''), dr.district_ar))
   where v1.city_id in (12, 3677)
     and u.city_id not in (12, 3677)
     -- the 10-08 المبرز hold names (resolve_district_ar), nothing else
     and u.district_norm in ('غسانيه','جوهره الهادي','جابريه','دانه الراشديه','بوسحبل','راجحي','جوهره النزهه','بستان المطيرفي',
                             'فتح','اتصالات','رضا بالمبرز','بو سحبل الثاني','صناعيه','بو سحبل الاول')
  on conflict (source_table, listing_id) do nothing;
  get diagnostics n = row_count;
  -- homes under a retired place move to their real town (2026-10-30, backlog #894)
  n := n + public.refresh_retired_place_remap();
  return n;
end $function$;

CREATE OR REPLACE FUNCTION public.source_district_dropped_rows(p_grace interval DEFAULT '00:00:00'::interval)
 RETURNS TABLE(platform text, source_table text, null_rows bigint, dropped bigint, blank bigint, numbered bigint, english bigint, silent_proven boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare t text;
begin
  for t in
    select c.table_name from information_schema.columns c
    where c.table_schema = 'public' and c.column_name = 'neighborhood' and c.table_name ~ '_(residential|commercial)_listings$'
      and exists (select 1 from information_schema.columns i
                  where i.table_schema = 'public' and i.table_name = c.table_name and i.column_name = 'id')
  loop
    return query execute format($q$
      with r as (
        select nullif(btrim(r.neighborhood), '') as nb, s.last_updated, s.city_id,
               exists (select 1 from public.listings_arabic_locations l
                        where l.source_table = s.source_table and l.listing_id = s.listing_id
                          and l.review_reason like 'city_only_match%%') as city_only
        from public.search_listings_ar s
        join public.%I r on r.id = s.listing_id
        where s.source_table = %L and s.production_ready and s.district_ar is null
      ), k as (
        select r.*, case when nb ~ '[0-9٠-٩]' then public.district_plot_fold(nb) else nb end as w from r
      )
      select %L::text, %L::text, count(*)::bigint,
             -- a town written as its own district is shown as city only ON PURPOSE (owner 2026-10-26): not dropped
             count(*) filter (where public.district_word_carryable(w)
                                and public.loc_display_district_ar(city_id, w) is not null
                                and not city_only and (last_updated is null or last_updated < now() - $1))::bigint,
             count(*) filter (where not city_only and (nb is null or public.norm_district_tok(nb) in
                                    ('', public.norm_district_tok('غير محدد'), public.norm_district_tok('اخرى'), public.norm_district_tok('أخرى'))))::bigint,
             count(*) filter (where nb ~ '[ء-ي]' and nb ~ '[0-9٠-٩]' and not public.district_word_carryable(w))::bigint,
             count(*) filter (where nb is not null and nb !~ '[ء-ي]')::bigint,
             exists (select 1 from public.ops_district_silent_source o where o.platform = %L and o.source_table is null)
      from k
      having count(*) > 0 $q$,
      t, t, regexp_replace(t, '_(residential|commercial)_listings$', ''), t,
      regexp_replace(t, '_(residential|commercial)_listings$', '')) using p_grace;
  end loop;
end $function$;

select public.refresh_retired_place_remap();

-- Apply-time proof: the الهياثم homes go to الخرج, the بيش homes to the Jazan بيش, and nothing crosses a region
-- unless it is the same town.
do $chk$
declare bad int;
begin
  if not exists (select 1 from public.retired_place_remap_rows() where old_city_id = 1071 and new_city_id = 1061) then
    raise exception 'retired_place_remap: الهياثم (1071) homes are not moving to الخرج (1061)';
  end if;
  if not exists (select 1 from public.retired_place_remap_rows() where old_city_id = 1667 and new_city_id = 3462) then
    raise exception 'retired_place_remap: بيش (1667, wrong region) homes are not moving to بيش (3462, جازان)';
  end if;
  select count(*) into bad from public.retired_place_remap_rows() r
    join public.loc_catalog_city o on o.city_id = r.old_city_id join public.loc_catalog_city n on n.city_id = r.new_city_id
   where o.region_id <> n.region_id and r.kind <> 'duplicate_city';
  if bad > 0 then raise exception 'retired_place_remap: % homes would cross a region without being the same town', bad; end if;
  select count(*) into bad from public.retired_place_remap_rows() r
    join public.loc_catalog_city n on n.city_id = r.new_city_id where n.retired_at is not null;
  if bad > 0 then raise exception 'retired_place_remap: % homes would move to a retired city', bad; end if;
end
$chk$;
