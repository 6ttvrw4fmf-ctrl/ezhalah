-- price_eq_area waivers superseded by a recorded price-blanking decision retire themselves (2026-11-04 PM, repair).
-- The owner decision #4 repair blanked the 1 x area price on aqar 8982174 / 10222037 / 12069092 and logged it in
-- ops_authoritative_null_price, but left their ops_price_eq_area_verified waivers in place; the waivers then
-- read as "stale" forever (3 P2 alerts). A waiver proven against a price that a later, logged decision blanked
-- protects nothing: the detector now removes it first (a detector repairs before it raises), and the decision row
-- keeps the evidence (price_before + reason). A waiver whose price moved for any OTHER reason still raises.
create or replace function public.mon_detect_price_eq_area_waiver_stale()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_n int := 0;
  r record;
begin
  delete from public.ops_price_eq_area_verified v
   using public.ops_authoritative_null_price d
   where d.source_table = v.source_table and d.listing_id = v.listing_id
     and d.column_blanked = 'price_total'
     and d.decided_at > v.verified_at
     and d.price_before = v.verified_price_total
     and not exists (select 1 from public.search_listings_ar s
                      where s.source_table = v.source_table and s.listing_id = v.listing_id
                        and s.price_total is not null);

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