-- manafe publishes its Jeddah rentals as «السعر N ر.س» with no period on any of its 210 pages, so the
-- scraper left rent_period NULL and 72 rows stayed out of every rent search (owner rule 2026-09-21:
-- yearly only when the source says so). On 2026-09-28 the owner attested «yes show them as yearly»
-- after the company's OWN evidence: the same ad (REGA ad licence 7200942068, villa «مجمع الخير السكني
-- 471», الروضة) prints «125000 ر.س» on manafe.com.sa and «125,000 /سنوي» on Aqar (ad 6662364), posted by
-- «شركة منافع الاقتصادية للعقار» itself. scrapers/manafe/run.py now writes rent_period='annual' for a
-- silent page (a period the page ties to the price still wins); these rows keep
-- mon_detect_manufactured_rent_period from raising — the registration wadod and tamyaz carry.
insert into public.ops_rent_period_single_value_ok (table_name, only_value, reason)
select t, 'annual',
       'owner attestation 2026-09-28 («yes show them as yearly») on the company''s own Aqar cross-post: REGA 7200942068 prints 125000 ر.س on manafe.com.sa and 125,000 /سنوي on Aqar 6662364. scrapers/manafe/run.py writes annual for a silent page; a period the page ties to the price still wins.'
from unnest(array['manafe_residential_listings','manafe_commercial_listings']) t
where not exists (select 1 from public.ops_rent_period_single_value_ok o where o.table_name = t);