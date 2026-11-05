-- THE SAME LAND POSTED TWICE ON ONE SITE COUNTS ONCE IN THE WELCOME FACTS (owner 2026-11-05, «make it a rule»).
-- The builder already folded the same property across DIFFERENT sites (owner 2026-10-22). A repost on the SAME site
-- was counted twice: in حفر الباطن land, aqar 6891846 and 6891844 are one plot (شارع المسيرة, حي الصفاء, 780 m²,
-- 642 SAR/m², facade جنوب شرقي, both added 26/09/2026 — read on both pages), and 4 such pairs moved the city's
-- median land price. The rule, owner-approved: same site + same town, district, deal, type, price and area + BOTH pins
-- within 10 m = one property. A look-alike without a pin, or with pins further apart, is kept: plots side by side
-- often share size and price (3 of 7 look-alike pairs in that city were 355 m to 2 km apart, i.e. real plots).
do $mig$
declare
  d text := pg_get_functiondef('public.build_welcome_insights'::regproc);
  a constant text := 'cos(radians(x.lat)), 2) < 40000);';
  ins constant text := $n$cos(radians(x.lat)), 2) < 40000);
  -- same_site repost (owner 2026-11-05): the same property posted twice on ONE site counts once — only when both
  -- carry a pin and the pins are within 10 m (a size/price look-alike alone is a neighbouring plot, kept)
  delete from w_b x using w_b y
   where x.city_id = y.city_id and x.district_ar = y.district_ar and x.deal_ar = y.deal_ar and x.type_ar = y.type_ar
     and coalesce(x.price_total, x.price_annual) = coalesce(y.price_total, y.price_annual) and x.area_m2 = y.area_m2
     and x.platform = y.platform and x.listing_id > y.listing_id
     and x.lat is not null and y.lat is not null and x.lng is not null and y.lng is not null
     and power((x.lat - y.lat) * 111000, 2) + power((x.lng - y.lng) * 111000 * cos(radians(x.lat)), 2) < 100;$n$;
begin
  if position('same_site repost' in d) > 0 then return; end if;
  if (length(d) - length(replace(d, a, ''))) / length(a) <> 1 then
    raise exception 'build_welcome_insights: cross-site dedup anchor not found exactly once';
  end if;
  execute replace(d, a, ins);
  if position('same_site repost' in pg_get_functiondef('public.build_welcome_insights'::regproc)) = 0 then
    raise exception 'build_welcome_insights: same-site rule did not land';
  end if;
end
$mig$;
