"""A muktamel town the English city map lacks is NEVER filed under its region's capital.

2026-10-06 (New Listings Engineer): muktamel 15741395 — page «شقة سكني للإيجار في حي الفنار في بحرة»,
source city_ar «بحرة» — was stored as Mecca, because _resolve_location() fell back to the region's
anchor city for ANY unmapped city. That fallback exists for metro-zone labels («شمال الرياض») only.
36 live Bahrah listings were searchable under مكة المكرمة and not under بحرة.
"""
from scrapers.muktamel import run as R

ADDR = {
    "Regions": {"1": "منطقة الرياض", "2": "منطقة مكة المكرمة"},
    "Cities": {"10": "بحرة", "11": "شمال الرياض", "12": "جدة", "13": "قرية لا يعرفها الكتالوج"},
    "Districts": {"5": "الفنار"},
}


def _loc(monkeypatch, city, region, catalog=None):
    calls = []

    def fake_to_catalog(city_ar, region_hint=None):
        calls.append((city_ar, region_hint))
        return (catalog, 2) if catalog else (None, None)

    monkeypatch.setattr(R, "to_catalog", fake_to_catalog)
    out = R._resolve_location({"address": {"region": region, "city": city, "district": 5}}, ADDR)
    return out, calls


def test_unmapped_town_is_not_the_region_capital(monkeypatch):
    (city_en, _region, district, raw), calls = _loc(monkeypatch, 10, 2, catalog=3504)
    assert city_en == "Other"                  # never "Mecca"
    assert raw["catalog_city_id"] == 3504      # the catalog's own بحرة
    assert calls == [("بحرة", "منطقة مكة المكرمة")]
    assert district == "الفنار"


def test_unknown_town_stays_unknown(monkeypatch):
    (city_en, _r, _d, raw), _ = _loc(monkeypatch, 13, 2, catalog=None)
    assert city_en == "Other" and raw["catalog_city_id"] is None


def test_zone_label_still_means_the_region_city(monkeypatch):
    (city_en, _r, _d, raw), calls = _loc(monkeypatch, 11, 1)
    assert city_en == "Riyadh" and calls == [] and raw["catalog_city_id"] is None


def test_mapped_city_unchanged(monkeypatch):
    (city_en, _r, _d, raw), calls = _loc(monkeypatch, 12, 2)
    assert city_en == "Jeddah" and calls == []
