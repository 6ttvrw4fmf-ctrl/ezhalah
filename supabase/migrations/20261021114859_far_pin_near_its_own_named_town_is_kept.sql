-- A pin far from the ad's CITY label but on the TOWN its own district names is a real pin (mapping audit
-- 2026-10-21). The far-from-city guard (20261020175228) judged only the city label, and Al-Ahsa / Riyadh /
-- Afif are governorates whose ads name towns 150-240 km from the seat: arkaan property/739 is filed
-- «الهفوف · هجرة يبرين», its page's own map box reads maps?q=23.29721,48.97580 — Yabrin itself, 0.1 km from
-- the other Yabrin ads' pins and 235 km from Hofuf. The guard stripped it, and 16 more like it:
--   arkaan «هجرة يبرين» 11 · alshawaf «حي يبرين» 3 · dealapp «حي الحسو» (عفيف) 2 · sirdab «القويعية» 1.
-- A far pin is now kept when the ad's own district, minus «حي/هجرة/قرية/مركز/محافظة», is a town whose served
-- pins sit within 10 km of it, and which the labelled city does not itself have as a district. Those rows leave the register (so the reject trigger stops stripping them)
-- and the next crawl writes the pin back. Every other far pin keeps the owner's «A» rule unchanged.

create or replace function public.far_from_city_pins(p_km numeric default 150, p_min_city_pins int default 30)
returns table(source_table text, listing_id bigint, city_ar text, lat numeric, lng numeric, km numeric)
language sql stable as $$
  with p as (
    select s.source_table, s.listing_id, s.city_ar, s.city_id, s.latitude::float8 la, s.longitude::float8 lo,
           trim(regexp_replace(coalesce(s.district_ar, ''), '^(حي|هجرة|هجره|قرية|قريه|مركز|محافظة)\s+', '')) town
      from public.search_listings_ar s
     where s.latitude is not null and s.longitude is not null
       and s.city_ar is not null and s.city_ar <> 'غير معروف'),
  c as (
    select p.city_ar, percentile_cont(0.5) within group (order by p.la) mla,
           percentile_cont(0.5) within group (order by p.lo) mlo
      from p group by 1 having count(*) >= p_min_city_pins),
  t as (   -- every named place with ≥ 3 served pins: its median
    select p.city_ar town, percentile_cont(0.5) within group (order by p.la) tla,
           percentile_cont(0.5) within group (order by p.lo) tlo
      from p group by 1 having count(*) >= 3)
  select p.source_table, p.listing_id, p.city_ar, round(p.la::numeric, 5), round(p.lo::numeric, 5),
         round((111.0 * sqrt(power(p.la - c.mla, 2) + power((p.lo - c.mlo) * cos(radians(c.mla)), 2)))::numeric, 1)
    from p join c using (city_ar)
    left join t on t.town = p.town and p.town <> ''
   where 111.0 * sqrt(power(p.la - c.mla, 2) + power((p.lo - c.mlo) * cos(radians(c.mla)), 2)) > p_km
     and not (t.town is not null
              and 111.0 * sqrt(power(p.la - t.tla, 2) + power((p.lo - t.tlo) * cos(radians(t.tla)), 2)) < 10
              -- «حي العقيق» in الرياض is Riyadh's own district, not the town of العقيق (Al-Baha): a name the
              -- labelled city has as a district never vouches for a far pin (6 ksaaqar ads, dry run 2026-10-21).
              and not exists (select 1 from public.loc_catalog_district d
                         where d.city_id = p.city_id
                           and regexp_replace(regexp_replace(d.district_ar, '^حي\s+', ''), '[أإآ]', 'ا', 'g') = regexp_replace(p.town, '[أإآ]', 'ا', 'g')));
$$;
comment on function public.far_from_city_pins(numeric, int) is
  'Served pins > 150 km from their city label''s median (owner 2026-10-20 «A»), EXCEPT a pin within 10 km of the town the ad''s own district names (mapping audit 2026-10-21: Yabrin, Afif, Al-Quwayiyah).';

-- Release the rows the old rule stripped although their pin sits on their own named town. The pins come back on
-- the next crawl (the trigger strips only a registered pair). Judged on the REGISTERED pair against the served
-- pins of the named town.
with town as (
  select s.city_ar town, percentile_cont(0.5) within group (order by s.latitude::float8) tla,
         percentile_cont(0.5) within group (order by s.longitude::float8) tlo
    from public.search_listings_ar s where s.latitude is not null group by 1 having count(*) >= 3),
rel as (
  select r.source_table, r.listing_id
    from public.ops_far_pin_register r
    join public.search_listings_ar s on s.source_table = r.source_table and s.listing_id = r.listing_id
    join town on town.town = trim(regexp_replace(coalesce(s.district_ar, ''), '^(حي|هجرة|هجره|قرية|قريه|مركز|محافظة)\s+', ''))
   where 111.0 * sqrt(power(r.lat::float8 - town.tla, 2) + power((r.lng::float8 - town.tlo) * cos(radians(town.tla)), 2)) < 10
     and not exists (select 1 from public.loc_catalog_district d
                         where d.city_id = s.city_id
                           and regexp_replace(regexp_replace(d.district_ar, '^حي\s+', ''), '[أإآ]', 'ا', 'g') = regexp_replace(trim(regexp_replace(coalesce(s.district_ar, ''), '^(حي|هجرة|هجره|قرية|قريه|مركز|محافظة)\s+', '')), '[أإآ]', 'ا', 'g')))
delete from public.ops_far_pin_register r using rel
 where r.source_table = rel.source_table and r.listing_id = rel.listing_id;
