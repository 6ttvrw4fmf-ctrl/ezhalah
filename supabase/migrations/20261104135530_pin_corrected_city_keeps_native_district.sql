-- 🔧 2026-11-04 — THE SITE'S OWN DISTRICT SURVIVES A PIN-CORRECTED CITY, part 2 (after 🆕's 20261103074143).
-- That migration let listing_native_location_v2 fall back to district_recovery's VERBATIM district when the pin
-- correction carried none. It did not cover the ads whose NATIVE district (listing_native_location_v1.district_ar) is
-- set — those never get a district_recovery row (the refresher fills only rows whose v1 district is blank), so the
-- COALESCE found nothing and the ad served no district although the site's own word sits on the corrected city's
-- list. Measured 13:5x UTC: 45 served ads in 8 tables (النماص «حي الاندلس» / «حي النسيم» ×30, بريدة «حي الربيع»
-- 6245680, أبها «حي الزهور» 8982486 / 9998444, …), alert source_district_dropped 12679 (P1, re-affirmed every sweep).
-- Owner rule (2026-10-25): the site's own district always wins — served only if it is on the corrected city's list,
-- in the list's spelling (the same guard as 20261103074143; a name off the list stays blank).
do $mig$
declare
  v_def  text := pg_get_viewdef('public.listing_native_location_v2'::regclass);
  v_pat  constant text := 'COALESCE\(NULLIF\(xcc\.district_norm, ''''::text\),\s*CASE\s*WHEN dr\.verbatim THEN norm_district_tok\(dr\.district_ar\)\s*ELSE NULL::text\s*END\)';
  v_new  constant text := 'COALESCE(NULLIF(xcc.district_norm, ''''::text), CASE WHEN dr.verbatim THEN norm_district_tok(dr.district_ar) ELSE NULL::text END, norm_district_tok(NULLIF(btrim(v1.district_ar), ''''::text)))';
  v_hits int := (select count(*) from regexp_matches(v_def, v_pat, 'g'));
begin
  if v_hits <> 1 then
    raise exception 'needle found % times in listing_native_location_v2 (expected 1)', v_hits;
  end if;
  execute 'create or replace view public.listing_native_location_v2 as ' || regexp_replace(v_def, v_pat, v_new);
end
$mig$;

-- Check block: EXECUTE the view on the measured case, a guard case, and the global rule.
do $chk$
declare v_d text;
begin
  select district_ar into v_d from public.listing_native_location_v2
   where source_table = 'aqar_residential_listings' and listing_id = 6245680;
  if v_d is distinct from 'حي الربيع' then
    raise exception 'aqar 6245680 should serve حي الربيع under بريدة, got %', coalesce(v_d, 'NULL');
  end if;
  select district_ar into v_d from public.listing_native_location_v2
   where source_table = 'aqar_commercial_listings' and listing_id = 11851327;
  if v_d is not null then
    raise exception 'aqar 11851327 (خليص, native «حي الرياض» not on the list) must stay blank, got %', v_d;
  end if;
  if exists (select 1 from public.listing_native_location_v2 v
               join public.listing_city_correction x on x.source_table = v.source_table and x.listing_id = v.listing_id
              where x.city_source = 'pin_governorate' and v.district_ar is not null
                and not exists (select 1 from public.loc_catalog_district kd
                                 where kd.city_id = v.city_id and kd.retired_at is null
                                   and kd.district_norm = public.norm_district_tok(v.district_ar))) then
    raise exception 'a pin-corrected row serves a district that is not on its corrected city''s list';
  end if;
end
$chk$;

-- The detector half: a town written as its own district is shown as city only ON PURPOSE (owner 2026-10-26), and
-- source_district_dropped_rows() already excused that through the listings_arabic_locations «city_only_match» ledger —
-- but the bossbih Al-Ahsa rows (8 at 13:5x: «القصر في المبرز», «المصطفى بالمبرز أ», …) are excused by
-- district_is_other_town() on their NATIVE district («حي المبرز») instead, and the detector counted them as dropped.
-- Edited in place; the needle must exist exactly once.
do $mig$
declare src text; n int;
  needle1 constant text := 'and x.city_source = ''pin_governorate'' and x.city_id = s.city_id) as pin_city';
  patch1  constant text := 'and x.city_source = ''pin_governorate'' and x.city_id = s.city_id) as pin_city,
               (select v1.district_ar from public.listing_native_location_v1 v1
                 where v1.source_table = s.source_table and v1.listing_id = s.listing_id limit 1) as native_d';
  needle2 constant text := 'and not city_only and not (pin_city';
  patch2  constant text := 'and not coalesce(public.district_is_other_town(city_id, native_d), false)   -- 2026-11-04: a town as the native district is city-only on purpose
                                and not city_only and not (pin_city';
begin
  src := pg_get_functiondef('public.source_district_dropped_rows'::regproc);
  n := (select count(*) from regexp_matches(src, regexp_replace(needle1, '([().*+?\[\]\\|])', '\\\1', 'g'), 'g'));
  if n <> 1 then raise exception 'needle1 found % times, expected 1', n; end if;
  n := (select count(*) from regexp_matches(src, regexp_replace(needle2, '([().*+?\[\]\\|])', '\\\1', 'g'), 'g'));
  if n <> 1 then raise exception 'needle2 found % times, expected 1', n; end if;
  execute replace(replace(src, needle1, patch1), needle2, patch2);
end $mig$;

do $chk$
declare v_b bigint;
begin
  select coalesce(sum(dropped), 0) into v_b from public.source_district_dropped_rows(interval '3 hours') where platform = 'bossbih';
  if v_b <> 0 then raise exception 'bossbih still counts % dropped rows after the native-town exclusion', v_b; end if;
end
$chk$;