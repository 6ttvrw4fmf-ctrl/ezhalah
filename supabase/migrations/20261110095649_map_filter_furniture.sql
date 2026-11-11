-- THE MAP FILTER'S «الأثاث» (owner 2026-11-10: «yeah you copy the filter»): furnished / unfurnished on the map, the same
-- rule as the Filter home (apartment_guided_counts_ar: `s.furnished = p_furnished`), so a listing whose ad does not say
-- shows only under «الكل». Four parts, each a copy of the live object plus one furniture clause:
--   1. map_listing_points_ar (the pins' source view) carries s.furnished;
--   2. map_nopin_ar (district markers for listings with no exact spot) carries it, filled now and on every refresh;
--   3. map_pins_ar(…, p_furnished) — the old 15-argument version is DROPPED first, so no second overload exists;
--   4. map_nopin_markers_ar(…, p_furnished) — same.
-- New argument defaults to NULL = not narrowed, so the live site keeps working before and after the frontend ships.

-- 1. The view: the same two branches, furnished appended (CREATE OR REPLACE VIEW may only add columns at the end).
create or replace view public.map_listing_points_ar as
 SELECT s.source_table, s.listing_id, s.latitude, s.longitude, s.type_ar, s.platform, s.deal_ar, s.rent_period_ar,
    s.price_total, s.price_annual, s.bedrooms, s.area_m2, s.city_ar, s.district_ar, s.region_ar, s.furnished
   FROM search_listings_ar s
  WHERE ((s.latitude IS NOT NULL) AND (s.longitude IS NOT NULL))
UNION ALL
 SELECT s.source_table, s.listing_id, b.lat AS latitude, b.lng AS longitude, s.type_ar, s.platform, s.deal_ar, s.rent_period_ar,
    s.price_total, s.price_annual, s.bedrooms, s.area_m2, s.city_ar, s.district_ar, s.region_ar, s.furnished
   FROM (map_pin_borrow b
     JOIN search_listings_ar s ON (((s.source_table = b.source_table) AND (s.listing_id = b.listing_id))))
  WHERE ((s.latitude IS NULL) OR (s.longitude IS NULL));

-- 2. The district-marker table and its refresh.
alter table public.map_nopin_ar add column if not exists furnished boolean;
update public.map_nopin_ar m set furnished = s.furnished
  from public.search_listings_ar s where s.source_table = m.source_table and s.listing_id = m.listing_id;

do $mig$
declare v text; v2 text; n int;
begin
  -- 2b. map_nopin_refresh_ar(): carry s.furnished into the table.
  v := pg_get_functiondef('public.map_nopin_refresh_ar()'::regprocedure);
  v2 := replace(v, 's.area_m2 area, s.type_ar, s.bedrooms beds', 's.area_m2 area, s.type_ar, s.bedrooms beds, s.furnished');
  v2 := replace(v2, 'deal, price, area, type_ar, beds)', 'deal, price, area, type_ar, beds, furnished)');
  v2 := replace(v2, 'deal, price, area, type_ar, beds from map_nopin_new', 'deal, price, area, type_ar, beds, furnished from map_nopin_new');
  if v2 = v or (length(v2) - length(v)) <> length(', s.furnished') + 2 * length(', furnished') then
    raise exception 'map_nopin_refresh_ar: unexpected shape, furniture not added (delta %)', length(v2) - length(v);
  end if;
  execute v2;

  -- 3. map_pins_ar: drop the 15-argument version, create the 16-argument one (furniture on every read path).
  v := pg_get_functiondef('public.map_pins_ar(double precision,double precision,double precision,double precision,double precision,text[],jsonb,integer,text,text[],integer[],integer,integer,numeric,numeric)'::regprocedure);
  n := (length(v) - length(replace(v, 'and (p_beds is null or s.bedrooms = any (p_beds))', ''))) / length('and (p_beds is null or s.bedrooms = any (p_beds))');
  if n <> 4 then raise exception 'map_pins_ar: expected 4 read paths, found %', n; end if;
  v2 := replace(v, 'p_price_max numeric DEFAULT NULL::numeric)' || chr(10) || ' RETURNS TABLE',
                   'p_price_max numeric DEFAULT NULL::numeric, p_furnished boolean DEFAULT NULL::boolean)' || chr(10) || ' RETURNS TABLE');
  v2 := replace(v2, 'and p_price_min is null and p_price_max is null' || chr(10), 'and p_price_min is null and p_price_max is null and p_furnished is null' || chr(10));
  v2 := replace(v2, 'and (p_beds is null or s.bedrooms = any (p_beds))', 'and (p_beds is null or s.bedrooms = any (p_beds)) and (p_furnished is null or s.furnished = p_furnished)');
  if position('p_furnished boolean DEFAULT NULL::boolean)' in v2) = 0 or position('p_price_max is null and p_furnished is null' in v2) = 0 then
    raise exception 'map_pins_ar: signature or grid fast-path not rewritten';
  end if;
  drop function public.map_pins_ar(double precision,double precision,double precision,double precision,double precision,text[],jsonb,integer,text,text[],integer[],integer,integer,numeric,numeric);
  execute v2;
  revoke all on function public.map_pins_ar(double precision,double precision,double precision,double precision,double precision,text[],jsonb,integer,text,text[],integer[],integer,integer,numeric,numeric,boolean) from public;
  grant execute on function public.map_pins_ar(double precision,double precision,double precision,double precision,double precision,text[],jsonb,integer,text,text[],integer[],integer,integer,numeric,numeric,boolean) to anon, authenticated, service_role;

  -- 4. map_nopin_markers_ar: same, 13 → 14 arguments.
  v := pg_get_functiondef('public.map_nopin_markers_ar(double precision,double precision,double precision,double precision,text[],text,text[],integer[],integer,integer,numeric,numeric,integer)'::regprocedure);
  v2 := replace(v, 'p_limit integer DEFAULT 200)', 'p_limit integer DEFAULT 200, p_furnished boolean DEFAULT NULL::boolean)');
  v2 := replace(v2, 'and (p_beds is null or m.beds = any (p_beds))', 'and (p_beds is null or m.beds = any (p_beds)) and (p_furnished is null or m.furnished = p_furnished)');
  if (length(v2) - length(v)) <> length(', p_furnished boolean DEFAULT NULL::boolean') + length(' and (p_furnished is null or m.furnished = p_furnished)') then
    raise exception 'map_nopin_markers_ar: unexpected shape (delta %)', length(v2) - length(v);
  end if;
  drop function public.map_nopin_markers_ar(double precision,double precision,double precision,double precision,text[],text,text[],integer[],integer,integer,numeric,numeric,integer);
  execute v2;
  revoke all on function public.map_nopin_markers_ar(double precision,double precision,double precision,double precision,text[],text,text[],integer[],integer,integer,numeric,numeric,integer,boolean) from public;
  grant execute on function public.map_nopin_markers_ar(double precision,double precision,double precision,double precision,text[],text,text[],integer[],integer,integer,numeric,numeric,integer,boolean) to anon, authenticated, service_role;
end
$mig$;