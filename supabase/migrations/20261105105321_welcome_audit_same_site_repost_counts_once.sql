-- The independent recount (audit_welcome_insights) learns the same-site repost rule the builder got in
-- migration welcome_same_site_repost_counts_once (owner 2026-11-05): otherwise every fact whose count the builder
-- corrected would read as a mismatch, be removed and raise mon_detect_welcome_insights_audit. Written again in the
-- recount's own words (as its cross-site rule is): same site, same town/district/deal/type/price/area, both pins
-- present and within 10 m → the later listing id goes.
do $mig$
declare
  d text := pg_get_functiondef('public.audit_welcome_insights'::regproc);
  a constant text := 'cos(radians(x.lat)), 2) < 40000));';
  ins constant text := $n$cos(radians(x.lat)), 2) < 40000));
  -- same_site repost, written again (owner 2026-11-05): one site posting the same property twice counts once, only
  -- with both pins present and within 10 m
  delete from a_b x where exists (
    select 1 from a_b y
     where y.city_id = x.city_id and y.dist = x.dist and y.deal_ar = x.deal_ar and y.type_ar = x.type_ar
       and coalesce(y.price_total, y.price_annual) = coalesce(x.price_total, x.price_annual) and y.area_m2 = x.area_m2
       and y.platform = x.platform and y.listing_id < x.listing_id
       and x.lat is not null and y.lat is not null and x.lng is not null and y.lng is not null
       and power((x.lat - y.lat) * 111000, 2) + power((x.lng - y.lng) * 111000 * cos(radians(x.lat)), 2) < 100);$n$;
begin
  if position('same_site repost, written again' in d) > 0 then return; end if;
  if (length(d) - length(replace(d, a, ''))) / length(a) <> 1 then
    raise exception 'audit_welcome_insights: cross-site dedup anchor not found exactly once';
  end if;
  execute replace(d, a, ins);
  if position('same_site repost, written again' in pg_get_functiondef('public.audit_welcome_insights'::regproc)) = 0 then
    raise exception 'audit_welcome_insights: same-site rule did not land';
  end if;
end
$mig$;
