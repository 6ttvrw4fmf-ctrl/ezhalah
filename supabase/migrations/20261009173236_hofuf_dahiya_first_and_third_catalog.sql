-- 🔧 QA 2026-10-09 (backlog 153): الهفوف's ضاحية هجر districts are served as «الضاحية <ordinal>» — the
-- spelling 3–5 platforms attest for the 2nd and 4th–11th (amlakalahsa, arkaan, abralosol, dealapp,
-- aqarcity; e.g. الضاحية الخامس 119 ads). The 1st and 3rd were missing from that series, so
-- resolve_district_ar() left abralosol's «ضاحية هجر الحي الاول/الأول» (30 ads) and «… الحي الثالث» (5)
-- with no district. The same places are attested elsewhere: «ضاحية هجر(الحي الأول)» 56 ads and
-- «ضاحية هجر(الحي الثالث)» 20 under الاحساء, «هجر الأول» / «هجر الثالث» under الهفوف. Dry run (rolled back):
-- both raw forms now resolve to these names; nothing else changes. No listing row is written here:
-- the hourly district-recovery pipeline (:10) and the :22 sync serve them.
insert into public.loc_catalog_district (city_id, district_ar, district_norm)
select v.city_id, v.district_ar, public.norm_district_tok(v.district_ar)
from (values
    (12, 'الضاحية الأول'),
    (12, 'الضاحية الثالث')
) as v(city_id, district_ar)
on conflict (city_id, district_norm) do nothing;