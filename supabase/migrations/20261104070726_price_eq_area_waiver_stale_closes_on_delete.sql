-- price_eq_area_waiver_stale (alerts 10053/10054/10055), amlakalahsa 11622340 / 11622372 / 11622913, 2026-11-04.
--
-- THE ROWS. The three waivers (2026-09-13/14) declared «1700 / 1650 as the TOTAL is source-real» because amlakalahsa's
-- capture carried the same figure in pw-prc and pw-prc-mtr. The ads' own text settles which it is: «سعر المتر 1700
-- السعر 425,000», «سعر المتر 1650», «سعر المتر 1700 السعر 1,020,000» — the number is the per-m² rate. The writer has
-- since been fixed: the source rows now hold price_total = NULL, price_per_meter = 1700/1650, and search serves
-- 425,000 / ≈ 1,093,950 / no total. So the waivers are the parser-artifact case of their own fix text: DELETE them
-- (price already NULL, writer already fixed). mon_detect_price_eq_area_or_ppm re-opens the question if any of these
-- rows is ever served with price = area or price = per-m² again.
--
-- THE DETECTOR GAP. mon_detect_price_eq_area_waiver_stale() only ever resolved a key inside its loop over EXISTING
-- waivers on SERVED rows, so following its own instruction («DELETE the waiver row») left the alert open forever —
-- the correct repair could never read as done, which teaches the next engineer to refresh the number instead. Now an
-- open key whose waiver no longer exists (or whose row is no longer served) is resolved by the detector itself.
delete from public.ops_price_eq_area_verified v
 using public.search_listings_ar s
 where v.source_table = 'amlakalahsa_residential_listings'
   and v.listing_id in (11622340, 11622372, 11622913)
   and s.source_table = v.source_table and s.listing_id = v.listing_id
   and s.price_total is null;

do $proof$
begin
  if exists (select 1 from public.ops_price_eq_area_verified
              where source_table = 'amlakalahsa_residential_listings' and listing_id in (11622340, 11622372, 11622913)) then
    raise exception 'a waiver survived: its row is served with a total again — re-read the source before deleting';
  end if;
  if position('mon_raise(''P2'', ''price_eq_area_waiver_stale''' in pg_get_functiondef('public.mon_detect_price_eq_area_waiver_stale()'::regprocedure)) = 0 then
    raise exception 'mon_detect_price_eq_area_waiver_stale body changed — re-derive before redefining';
  end if;
end
$proof$;

CREATE OR REPLACE FUNCTION public.mon_detect_price_eq_area_waiver_stale()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_n int := 0;
  r record;
begin
  for r in
    select v.source_table, v.listing_id, v.verified_price_total, v.verified_at,
           s.price_total as current_price_total, s.area_m2 as current_area_m2
      from public.ops_price_eq_area_verified v
      join public.search_listings_ar s
        on s.source_table = v.source_table and s.listing_id = v.listing_id
     where s.production_ready
       and v.verified_price_total is not null
  loop
    if r.current_price_total is distinct from r.verified_price_total then
      v_n := v_n + public.mon_raise('P2', 'price_eq_area_waiver_stale', r.source_table,
        'price_eq_area_waiver_stale:' || r.source_table || ':' || r.listing_id,
        jsonb_build_object(
          'source_table', r.source_table, 'listing_id', r.listing_id,
          'verified_price_total', r.verified_price_total,
          'current_price_total', r.current_price_total,
          'current_area_m2', r.current_area_m2,
          'verified_at', r.verified_at,
          'why', 'This row carries a standing price_eq_area waiver that SUPPRESSES mon_detect_price_eq_area_or_ppm, but the served price has moved away from the price the waiver was actually proven against. The waiver is now unproven and may be hiding a real parser artifact.',
          'fix', 'Re-probe the source ad. Still source-published -> update ops_price_eq_area_verified.verified_price_total (and the evidence text) to the new proven value. Parser artifact -> DELETE the waiver row, NULL the price and fix the writer. Do NOT simply refresh the number to silence this.'));
    else
      perform public.mon_resolve_key('price_eq_area_waiver_stale',
        'price_eq_area_waiver_stale:' || r.source_table || ':' || r.listing_id);
    end if;
  end loop;

  -- A key whose waiver is gone (the «DELETE the waiver row» repair) or whose row is no longer served suppresses
  -- nothing any more: close it here, or the instructed repair can never read as done (2026-11-04).
  for r in
    select a.dedup_key
      from public.alert_event a
     where a.kind = 'price_eq_area_waiver_stale' and a.resolved_at is null
       and not exists (
         select 1
           from public.ops_price_eq_area_verified v
           join public.search_listings_ar s
             on s.source_table = v.source_table and s.listing_id = v.listing_id
          where s.production_ready and v.verified_price_total is not null
            and a.dedup_key = 'price_eq_area_waiver_stale:' || v.source_table || ':' || v.listing_id)
  loop
    perform public.mon_resolve_key('price_eq_area_waiver_stale', r.dedup_key);
  end loop;
  return v_n;
end
$function$;

select public.mon_detect_price_eq_area_waiver_stale();
select public.mon_detect_price_eq_area_or_ppm();
