-- Property Finder cards did not show «رقم رخصة الإعلان» (REGA). The card reads additional_info.rega_ad_license_number
-- (src/data/remote.ts ADDL_FIELDS), the key Haraj's run.py writes; Property Finder's run.py stored the licence only in the
-- license_number column. run.py now writes the key on every crawl (scrapers/propertyfinder/run.py); this fills the rows
-- already stored with the SAME value, verbatim from license_number (the source's own «rera»). Nothing else changes.
update public.propertyfinder_residential_listings
   set additional_info = coalesce(additional_info, '{}'::jsonb) || jsonb_build_object('rega_ad_license_number', license_number)
 where license_number is not null and btrim(license_number) <> ''
   and (additional_info->>'rega_ad_license_number') is distinct from license_number;
update public.propertyfinder_commercial_listings
   set additional_info = coalesce(additional_info, '{}'::jsonb) || jsonb_build_object('rega_ad_license_number', license_number)
 where license_number is not null and btrim(license_number) <> ''
   and (additional_info->>'rega_ad_license_number') is distinct from license_number;

do $verify$
declare n_missing int;
begin
  select count(*) into n_missing from (
    select license_number, additional_info from public.propertyfinder_residential_listings
    union all select license_number, additional_info from public.propertyfinder_commercial_listings) t
   where license_number is not null and btrim(license_number) <> ''
     and (additional_info->>'rega_ad_license_number') is distinct from license_number;
  if n_missing > 0 then
    raise exception '% Property Finder rows still lack the card licence key', n_missing;
  end if;
  raise notice 'every Property Finder row with a licence carries it on the card';
end $verify$;