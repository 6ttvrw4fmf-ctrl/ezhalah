-- 🔧 2026-11-08 (owner 3295 «fix the ones that come back, the root»): repeat_bug:field_integrity ×3.
-- mon_detect_field_integrity()'s phone/ID-price and extreme-magnitude arms read the RAW source tables, where
-- PRICE = SOURCE keeps the advertiser's figure forever (muhaysini 520,352,000 for 325 m² land; dealapp
-- 3,240,000,000 for 900 m²). The search index already serves most of those rows corrected (the land-price guard,
-- land_price_unit_review_ar: muhaysini 14819973 is served at 1,600,000, dealapp 24940952 at 3,600,000), so the
-- alarm kept re-opening on rows no customer sees: 3–4 reopens in 7 days, each «fixed» by a waiver.
-- Root fix: an arm counts a row only while a customer is SERVED that raw figure (production_ready index row whose
-- price equals the raw price). A raw artifact the index still serves keeps raising, exactly as before; a
-- source-verified figure still goes to ops_price_source_verified with a re-fetch.
do $m$
declare v text; n text;
  anchor constant text := 'where v.source_table = %L and v.listing_id = id)';
begin
  v := pg_get_functiondef('public.mon_detect_field_integrity()'::regprocedure);
  if (length(v) - length(replace(v, anchor, ''))) / length(anchor) <> 2 then
    raise exception 'mon_detect_field_integrity: expected the anchor exactly twice (phone/ID arm + extreme arm)';
  end if;
  n := replace(v, anchor, anchor || $a$
                            -- only while a customer is served this raw figure (11-08: the index corrects most)
                            and exists (select 1 from public.search_listings_ar s
                                         where s.source_table = (select c.relname from pg_catalog.pg_class c where c.oid = x.tableoid)
                                           and s.listing_id = x.id and s.production_ready
                                           and coalesce(s.price_total, s.price_annual) = coalesce(x.price_total, x.price_annual))$a$);
  execute n;
end
$m$;
