-- Backlog 325 (owner, 2026-10-09): aqarcity's «خدمات العقار» is a structured checklist. On a LAND,
-- «لايوجد خدمات» is the site's explicit «no services» and a utility the checklist does not tick is a
-- stated NO, so electricity / water_supply / sanitation are False — not NULL. 61 live lands said
-- «لايوجد خدمات» while all three were NULL, so a raw-land search could not find them.
-- scrapers/aqarcity/run.py land_utilities() now writes this on every crawl; this repairs the stored
-- lands from the SAME stored field, filling only NULLs (a known True is never touched).
-- Land only: on a flat an unticked «مياه» is not a statement that it has no water.
-- The index picks the change up through the next rich-attribute sync.
update public.aqarcity_residential_listings r
   set electricity  = coalesce(r.electricity,  (r.additional_info->>'services') like '%كهرباء%'),
       water_supply = coalesce(r.water_supply, (r.additional_info->>'services') ~ '(مياه|ماء)'),
       sanitation   = coalesce(r.sanitation,   (r.additional_info->>'services') like '%صرف صحي%')
 where r.property_type like '%Land'
   and coalesce(btrim(r.additional_info->>'services'), '') <> ''
   and (r.electricity is null or r.water_supply is null or r.sanitation is null);

do $c$
declare bad int;
begin
  select count(*) into bad from public.aqarcity_residential_listings r
   where r.active and r.property_type like '%Land'
     and btrim(r.additional_info->>'services') = 'لايوجد خدمات'
     and not (r.electricity is false and r.water_supply is false and r.sanitation is false);
  if bad > 0 then raise exception 'backlog 325 check: % «لايوجد خدمات» lands are not false/false/false', bad; end if;
end $c$;
