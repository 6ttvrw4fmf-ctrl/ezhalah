-- 🔧 2026-11-04 — source_district_dropped_rows(): an ad whose NATIVE district is its own city's name is served city-only
-- ON PURPOSE (owner 2026-10-26: a town written as its own district is shown as city only). The earlier 13:55 UTC edit excused the
-- OTHER-town case (district_is_other_town); the same-town case still counted: aljassim 12589992 / 12590337 (المبرز,
-- native «حي المبرز») and alshawaf 12605957 (جواثا, native «حي جواثا») were the last 3 «dropped» rows behind alert
-- source_district_dropped 12679 after the 14:22 UTC sync (26 → 3). Edited in place; the needle must exist exactly once.
do $mig$
declare src text; n int;
  needle constant text := 'and not coalesce(public.district_is_other_town(city_id, native_d), false)';
  patch  constant text := 'and not coalesce(public.district_is_other_town(city_id, native_d), false)
                                and not coalesce(public.norm_district_tok(native_d) = (select public.norm_district_tok(c.city_ar)
                                                                                         from public.loc_catalog_city c
                                                                                        where c.city_id = k.city_id limit 1), false)   -- 2026-11-04: the city''s own name as the district is city-only on purpose';
begin
  src := pg_get_functiondef('public.source_district_dropped_rows'::regproc);
  n := (select count(*) from regexp_matches(src, regexp_replace(needle, '([().*+?\[\]\\|])', '\\\1', 'g'), 'g'));
  if n <> 1 then raise exception 'needle found % times, expected 1', n; end if;
  execute replace(src, needle, patch);
end $mig$;

-- Both directions: the three same-town rows are excused, and a row whose native district is a real district is still counted
-- (a synthetic check through the predicate the function uses).
do $chk$
declare v_n bigint;
begin
  select coalesce(sum(dropped), 0) into v_n from public.source_district_dropped_rows(interval '3 hours')
   where source_table in ('aljassim_residential_listings', 'alshawaf_commercial_listings');
  if v_n <> 0 then raise exception 'same-town rows still counted: %', v_n; end if;
  if public.norm_district_tok('حي المبرز') <> (select public.norm_district_tok(c.city_ar) from public.loc_catalog_city c where c.city_ar = 'المبرز' limit 1) then
    raise exception 'the own-town comparison does not match «حي المبرز» against المبرز';
  end if;
  if public.norm_district_tok('حي الربيع') = (select public.norm_district_tok(c.city_ar) from public.loc_catalog_city c where c.city_ar = 'بريدة' limit 1) then
    raise exception 'a real district reads as its city — the exclusion would hide real drops';
  end if;
end
$chk$;