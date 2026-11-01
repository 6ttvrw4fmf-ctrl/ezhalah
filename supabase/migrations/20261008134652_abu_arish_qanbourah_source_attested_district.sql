-- 🔧 Quality & Repair 2026-10-08: «حي قنبورة» (أبو عريش, city_id 3525) — a district aqar states in its
-- structured district field on 23 active ads (23 distinct ad pages), missing from loc_catalog_district, so
-- the resolver (catalog ∪ live attestation only, never invents) left all 23 with no district and a customer
-- who picks the district never finds them. The name exists nowhere else in the catalog (checked: no other
-- city attests «قنبورة»), so it cannot pair a district with the wrong city.
-- Deliberately NOT added (routed to new_listings_engineer): «حي العسيلة» (45 ads; also a city of its own,
-- العسيلة, and a district of صبيا) and «حي مختارة» (10 ads; a district of صامطة) — the ad's city may be the
-- wrong one, which a catalog row would hide rather than fix. «حي مخطط …» names stay excluded by
-- district_ar_looks_bogus() (plan names, owner rule 2026-09-14).
-- No listing row is written: the hourly district-recovery job (:10) re-resolves through the sanctioned
-- resolver and the :22 sync serves the result.
insert into public.loc_catalog_district (city_id, district_ar, district_norm)
select v.city_id, v.district_ar, public.norm_district_tok(v.district_ar)
from (values
    (3525, 'حي قنبورة')
) as v(city_id, district_ar)
on conflict (city_id, district_norm) do nothing;
