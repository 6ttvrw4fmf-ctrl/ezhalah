-- wasalt_rate_is_not_the_total(): an impossible per-metre figure is not a rate (2026-11-03).
--
-- Found while applying the companion fix to wasalt_preserve_detail(): once the five corrected prices were written
-- (WST5893701 3,100,000 …), THIS trigger read the stale archived description total (1,046,250,000 = 3,100,000 × 337.5)
-- and concluded 3,100,000 must be a per-m² rate — so it moved it to price_per_meter and NULLed price_total, and the
-- cards lost their price. A per-metre rate above 2,000,000 SAR/m² is beyond the fleet's own physical bound for any
-- single unit (mon_detect_field_integrity), so such a number is never re-labelled a rate. Real rates (7,500 SAR/m²,
-- the class this trigger exists for) are untouched. Then the five rows get wasalt's live price back, guarded.
do $mig$
declare d text;
begin
  d := pg_get_functiondef('public.wasalt_rate_is_not_the_total()'::regprocedure);
  if position($x$NEW.price_total > 0 and NEW.area_m2 > 0 then$x$ in d) = 0 then
    raise exception 'wasalt_rate_is_not_the_total: guard line not found — body changed, re-derive the edit';
  end if;
  d := replace(d, $x$NEW.price_total > 0 and NEW.area_m2 > 0 then$x$,
    $x$NEW.price_total > 0 and NEW.area_m2 > 0
     and NEW.price_total <= 2000000 then   -- a "rate" above 2,000,000 SAR/m² is impossible, never a rate (2026-11-03)$x$);
  execute d;
end
$mig$;

update public.wasalt_residential_listings set price_total = 3100000, price_per_meter = null where id = 9431433  and price_total is null and price_per_meter = 3100000;
update public.wasalt_residential_listings set price_total = 8925000, price_per_meter = null where id = 13746442 and price_total is null and price_per_meter = 8925000;
update public.wasalt_residential_listings set price_total = 2430000, price_per_meter = null where id = 13746443 and price_total is null and price_per_meter = 2430000;
update public.wasalt_residential_listings set price_total = 4340000, price_per_meter = null where id = 16527251 and price_total is null and price_per_meter = 4340000;
update public.wasalt_residential_listings set price_total = 3000000, price_per_meter = null where id = 16527252 and price_total is null and price_per_meter = 3000000;