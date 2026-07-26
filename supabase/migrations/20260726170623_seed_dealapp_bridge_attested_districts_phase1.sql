-- dealapp bridge-expansion PHASE 1 — 2026-07-26 (owner-approved scope).
-- dealapp publishes districts in English only. These 7 (city_id, district) pairs are the
-- "attestation gap": bridge_en_district already translates the English UNAMBIGUOUSLY
-- (n_distinct=1, e.g. 'Bani Malik'→بنى مالك, 'Al-Huda'→الهدا), but the district was not in
-- that city's catalog, so resolve_district_ar's city-attestation step returned NULL.
-- district_ar = the canonical Arabic spelling this district already carries in other cities'
-- catalogs (never invented). Excluded by the city-name rule: 'Mahalah'→المحالة (صبيا) — a town,
-- 8 listings stay honestly NULL. Same seed mechanism as gathern buckets A/B
-- (20260721112816, 20260724230200). Phase 2 (transliteration nomination for the ~85
-- not-in-bridge forms) is scoped separately.
insert into public.loc_catalog_district (city_id, district_ar, district_norm)
select v.city_id, v.district_ar, public.normalize_ar(v.district_ar)
from (values
    (6,   'حي الهدا'),
    (6,   'حي الفيحاء'),
    (62,  'حي بنى مالك'),
    (199, 'حي الاندلس'),
    (199, 'حي الخالدية'),
    (199, 'حي الربوة'),
    (199, 'حي الشاطئ')
) as v(city_id, district_ar)
on conflict (city_id, district_norm) do nothing;
