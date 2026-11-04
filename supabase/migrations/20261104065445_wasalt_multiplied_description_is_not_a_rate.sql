-- wasalt: a MULTIPLIED description total is not proof of a rate, in the trigger AND in its detector (2026-11-04).
--
-- THE DEFECT, two faces of one wrong inference. wasalt's REGA description template prints «سعرها T ر.س». When a seller
-- types the TOTAL into the per-m² box, wasalt multiplies it by the area, so T = price × area. That is exactly the shape
-- trg_wrm_rate_is_not_the_total and rate_served_as_total_rows() read as «the price is a per-m² RATE», so:
--   * the detector flagged 13 served totals that are the seller's own figure (13746443: 2,430,000 for 405 m² in Riyadh,
--     description «سعرها 984150000» = 2.43 M SAR/m²; 15925545: wasalt's own salePrice 4,500,000, description 4.5 B);
--     P1 rate_served_as_total, raised 2026-11-03 17:59, all 13 are this case;
--   * the trigger (bounded only by a flat «price ≤ 2,000,000» since 20261103170936) turned two real totals into rates:
--     14700765 salePrice 1,000,000 for 312 m² → served «≈ 312,000,000»; 14619626 salePrice 150,000 for 160 m² → «≈ 24 M».
--
-- THE RULE. A description total T is the multiplied typo, not a total, when T itself is impossible for the area — the SAME
-- bar the owner-approved meter-box rule uses (price_typed_in_meter_box_ar, owner 2026-10-28: «serve the seller's figure»):
-- price_size_impossible(T) or, outside مكة/المدينة and outside commercial, T / area >= 100,000 SAR/m². Then the price is a
-- total and is left exactly as the source states it. A real rate (5848132: 8,000 × 1,225 = «سعرها 9800000», 8,000 SAR/m²)
-- is untouched. The flat 2,000,000 bound stays (it is a separate fleet bound). One predicate, called by both.
--
-- Repair: the two rows the trigger mis-relabelled get wasalt's own structured salePrice back (PRICE = SOURCE), guarded on
-- the exact current state. Watched by mon_detect_rate_served_as_total (redefined below with the same predicate).
-- Barrier: scripts/verify-wasalt-multiplied-description-is-not-a-rate.ts.

create or replace function public.wasalt_description_total_is_multiplied(p_total numeric, p_area integer, p_holy boolean, p_commercial boolean)
 returns boolean
 language sql
 immutable
as $function$
  select coalesce(p_total > 0 and p_area > 0
     and (public.price_size_impossible(p_total, null, p_area)
          or (not coalesce(p_commercial, false) and not coalesce(p_holy, false) and p_total / p_area >= 100000)), false)
$function$;

do $mig$
declare d text;
begin
  d := pg_get_functiondef('public.wasalt_rate_is_not_the_total()'::regprocedure);
  if position($x$and abs(t - NEW.price_total::numeric * NEW.area_m2) <= 0.01 * NEW.price_total::numeric * NEW.area_m2 then$x$ in d) = 0 then
    raise exception 'wasalt_rate_is_not_the_total: predicate line not found — body changed, re-derive the edit';
  end if;
  if position('wasalt_description_total_is_multiplied' in d) > 0 then
    raise exception 'wasalt_rate_is_not_the_total: already patched';
  end if;
  d := replace(d, $x$and abs(t - NEW.price_total::numeric * NEW.area_m2) <= 0.01 * NEW.price_total::numeric * NEW.area_m2 then$x$,
    $x$and abs(t - NEW.price_total::numeric * NEW.area_m2) <= 0.01 * NEW.price_total::numeric * NEW.area_m2
       and not public.wasalt_description_total_is_multiplied(t, NEW.area_m2, NEW.city in ('Mecca', 'Medina'), TG_TABLE_NAME like '%commercial%') then$x$);
  execute d;
end
$mig$;

create or replace function public.rate_served_as_total_rows()
 returns table(platform text, source_table text, listing_id bigint, served_total bigint, area_m2 integer, description_total numeric)
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select s.platform, s.source_table, s.listing_id, s.price_total::bigint, s.area_m2, t.total
    from public.search_listings_ar s
    join public.wasalt_residential_listings w on s.source_table = 'wasalt_residential_listings' and w.id = s.listing_id
    cross join lateral (select public.wasalt_description_total(w.ar_data, w.description) as total) t
   where s.production_ready and s.deal_ar = 'بيع' and s.price_total > 0 and s.area_m2 > 0
     and t.total is not null and t.total <> s.price_total
     and abs(t.total - s.price_total::numeric * s.area_m2) <= 0.01 * s.price_total::numeric * s.area_m2
     and s.price_total <= 2000000
     and not public.wasalt_description_total_is_multiplied(t.total, s.area_m2, s.city_ar in ('مكة المكرمة', 'المدينة المنورة'), false)
  union all
  select s.platform, s.source_table, s.listing_id, s.price_total::bigint, s.area_m2, t.total
    from public.search_listings_ar s
    join public.wasalt_commercial_listings w on s.source_table = 'wasalt_commercial_listings' and w.id = s.listing_id
    cross join lateral (select public.wasalt_description_total(w.ar_data, w.description) as total) t
   where s.production_ready and s.deal_ar = 'بيع' and s.price_total > 0 and s.area_m2 > 0
     and t.total is not null and t.total <> s.price_total
     and abs(t.total - s.price_total::numeric * s.area_m2) <= 0.01 * s.price_total::numeric * s.area_m2
     and s.price_total <= 2000000
     and not public.wasalt_description_total_is_multiplied(t.total, s.area_m2, s.city_ar in ('مكة المكرمة', 'المدينة المنورة'), true)
$function$;

revoke all on function public.rate_served_as_total_rows() from public, anon, authenticated;
revoke all on function public.wasalt_description_total_is_multiplied(numeric, integer, boolean, boolean) from anon, authenticated;

update public.wasalt_residential_listings set price_total = 1000000, price_per_meter = null
 where id = 14700765 and price_total is null and price_per_meter = 1000000
   and (ar_data #>> '{propertyInfo,salePrice}')::numeric = 1000000;
update public.wasalt_residential_listings set price_total = 150000, price_per_meter = null
 where id = 14619626 and price_total is null and price_per_meter = 150000
   and (ar_data #>> '{propertyInfo,salePrice}')::numeric = 150000;

do $proof$
begin
  if exists (select 1 from public.wasalt_residential_listings where id in (14700765, 14619626) and price_total is null) then
    raise exception 'repair did not hold: the fixed trigger still relabels a multiplied description as a rate';
  end if;
  -- the class this trigger exists for is untouched (5848132's recorded shape)
  if public.wasalt_description_total_is_multiplied(9800000, 1225, false, false) then
    raise exception 'a real rate (8,000 × 1,225) is now read as a multiplied typo';
  end if;
  if not public.wasalt_description_total_is_multiplied(984150000, 405, false, false) then
    raise exception '13746443 (2.43 M SAR/m²) is not read as the multiplied typo';
  end if;
end
$proof$;

select public.mon_detect_rate_served_as_total();
