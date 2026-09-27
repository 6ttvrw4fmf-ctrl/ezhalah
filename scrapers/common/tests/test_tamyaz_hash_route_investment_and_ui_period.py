"""tamyaz's traps: a hash-routed detail page, «للاستثمار» rows that are neither sale nor lease, a
structured type that contradicts its own title, bedrooms 0 meaning unset, count-0 amenity chips that
ARE shown, placeholder coordinates, and a per-id JSON 404 oracle.

Fixtures are VERBATIM /api/properties objects captured 2026-09-24 (ids prop-mu7drwdljc4k,
modern-studio, luxury-villa, retail-shop; trimmed to the keys the code reads). Assertions run the
SHIPPING functions (run.map_listing, run._amenities, run._make_signal, run.main). Offline: only
to_catalog/find_district_in_text and db are stubbed.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

from scrapers.tamyaz import run as R  # noqa: E402

ROOF = {"id": "prop-mu7drwdljc4k", "title": {"ar": "شقة روف للايجار حي الفلاح", "en": "Rooftop Apartment for Rent – Al Falah District"},
        "type": {"ar": "شقة", "en": "Apartment"}, "filter": "apartment",
        "location": {"ar": "منطقة مكة المكرمة - جدة - حي الفلاح", "en": "Makkah Region – Jeddah – Al Falah District"},
        "desc": {"ar": "شقة للإيجار في مدينة جدة  حي الفلاح / الحمدانية غرفتين نوم | صالة واسعة | مطبخ بدولاب راكب دورتين مياه | سطح خاص", "en": "Apartment for Rent"},
        "amenities": [{"label": {"ar": "الغرف", "en": "room"}, "count": 2}, {"label": {"ar": "حمام", "en": "Bathroom"}, "count": 2},
                      {"label": {"ar": "القاعات", "en": "Halls"}, "count": 1}, {"label": {"ar": "مطبخ مجهز", "en": "Equipped kitchen"}, "count": 0},
                      {"label": {"ar": "مصعد", "en": "Elevator"}, "count": 0}, {"label": {"ar": "الواجهة: الغربية", "en": ""}, "count": 0},
                      {"label": {"ar": "الأمن", "en": "Security"}, "count": 0}, {"label": {"ar": "رقم الطابق", "en": "Floor Number"}, "count": 5},
                      {"label": {"ar": "الفئة : عائلة", "en": "Category: Family"}, "count": 0}],
        "bedrooms": 2, "bathrooms": 2, "area": 100, "price": 24000, "forSale": False,
        "gallery": ["/uploads/u-1789887977499-21aefe53.jpg", "/uploads/u-1789887990195-93588552.jpg"],
        "lat": 24.7136, "lng": 46.6753, "mapEmbed": "", "featured": False, "published": True, "createdAt": 1789761369972}
INVEST = {"id": "modern-studio", "title": {"ar": "معارض للاستثمار - جدة - طريق الامير سلطان - رابطة العالم الاسلامي", "en": "Investment Showrooms"},
          "type": {"ar": "شقة", "en": "Apartment"}, "filter": "apartment",
          "location": {"ar": "منطقة مكة المكرمة - جدة - حي الروضة", "en": "Makkah Region – Jeddah – Al Rawdah District"},
          "desc": {"ar": "", "en": ""}, "amenities": [{"label": {"ar": "الغرف", "en": "room"}, "count": 12}],
          "bedrooms": 12, "bathrooms": 1, "area": 1518, "price": 3000000, "forSale": False, "gallery": [], "published": True}
CONFLICT = {"id": "luxury-villa", "title": {"ar": "عمارة للبيع جدة حي السلامة", "en": "Building for Sale – Jeddah – Al Salamah District"},
            "type": {"ar": "شقة", "en": "Apartment"}, "filter": "apartment",
            "location": {"ar": "منطقة مكة المكرمة - جدة - السلامة", "en": "Makkah Region – Jeddah – Al Salamah District"},
            "desc": {"ar": "", "en": ""}, "amenities": [{"label": {"ar": "الفئة : عائلة", "en": "Category: Family"}, "count": 0}],
            "bedrooms": 0, "bathrooms": 0, "area": 900, "price": 7000000, "forSale": True, "gallery": [], "published": True}
SALE = {"id": "retail-shop", "title": {"ar": "عمارة للبيع جدة حي الفلاح", "en": "Building for Sale – Jeddah – Al Falah District"},
        "type": {"ar": "عمارة سكنية", "en": "Residential Building"}, "filter": "residential-building",
        "location": {"ar": "منطقة مكة المكرمة - جدة - حي الفلاح", "en": "Makkah Region – Jeddah – Al Falah District"},
        "desc": {"ar": "", "en": ""}, "amenities": [{"label": {"ar": "الغرف", "en": "room"}, "count": 12}],
        "bedrooms": 12, "bathrooms": 1, "area": 450, "price": 2200000, "forSale": True,
        "gallery": ["/uploads/u-1789886000000-aa.jpg"], "published": True}
GONE_404 = '{"message":"العقار غير موجود","stack":"Error: العقار غير موجود\\n    at getProperty (file:///var/www/tamayz-website/api/src/controllers/properties.controller.js:82:27)"}'


@pytest.fixture(autouse=True)
def _no_catalog_network(monkeypatch):
    monkeypatch.setattr(R, "to_catalog", lambda c, region_hint=None: (18, 2) if c == "جدة" else (None, None))
    monkeypatch.setattr(R, "find_district_in_text",
                        lambda t, cid: next((d for d in ("حي الفلاح", "حي السلامة") if t and d[3:] in t), None))


def _p(base, **over):
    p = json.loads(json.dumps(base))
    p.update(over)
    return p


def test_a_silent_listing_falls_back_to_the_sites_own_universal_template():
    """ROOF's own title+desc state no period word anywhere (checked: neither شهري nor سنوي occurs).
    The UI stamps «/ سنة» beside EVERY rent regardless — a platform-wide constant, not this ONE
    listing's own words. Owner attestation 2026-09-24 (checked the live site, confirmed yearly):
    that universal template is now trusted as a platform-level statement when a listing is silent,
    the same class as azure/rightcompound's single-period entries — a period the listing DOES state
    still wins (see the next test)."""
    row, cat, why = R.map_listing(ROOF)
    assert why == "" and cat == "residential" and row["property_type"] == "Apartment"
    assert row["ad_number"] == "TMZprop-mu7drwdljc4k"
    assert row["listing_url"] == "https://www.tamyaz-sa.com/#property-prop-mu7drwdljc4k"
    assert row["transaction_type"] == "Rent"
    assert row["rent_period"] == "annual" and row["price_annual"] == 24000     # template fallback
    assert "price_total" not in row and row["additional_info"]["price_unit_ui"] == "ر.س / سنة"
    assert row["city_ar"] == "جدة" and row["region_id"] == 2 and row["district_ar"] == "حي الفلاح" and row["neighborhood"] == "حي الفلاح"
    assert row["additional_info"]["region_ar"] == "منطقة مكة المكرمة"


def test_a_period_the_listing_actually_states_is_honored_over_the_ui_template():
    """If a listing's OWN title/desc ever does state a period, that — not the UI's blanket «/ سنة»
    fallback — is what gets stored, via the shared rent_period_and_annual() parser."""
    annual = R.map_listing(_p(ROOF, desc={"ar": "شقة للإيجار السنوي في حي الفلاح", "en": ""}))[0]
    assert annual["rent_period"] == "annual" and annual["price_annual"] == 24000
    monthly = R.map_listing(_p(ROOF, desc={"ar": "شقة للإيجار الشهري في حي الفلاح", "en": ""}))[0]
    assert monthly["rent_period"] == "monthly" and monthly["price_annual"] == 24000 * 12
    weekly = R.map_listing(_p(ROOF, desc={"ar": "شقة للإيجار الأسبوعي في حي الفلاح", "en": ""}))[0]
    # a daily/weekly rate is never parked as annual, even the template fallback does not apply here
    assert "rent_period" not in weekly and weekly["price_annual"] is None


def test_count_zero_chips_are_shown_amenities_and_counts_land_in_real_columns():
    row, _, _ = R.map_listing(ROOF)
    assert row["elevator"] is True and row["kitchen"] is True          # «مصعد» / «مطبخ مجهز» at count 0
    assert row["halls"] == 1 and row["floor_number"] == 5 and row["direction"] == "غرب"
    assert row["bedrooms"] == 2 and row["bathrooms"] == 2 and row["area_m2"] == 100
    assert "الأمن" in row["additional_info"]["amenity_labels"] and "رقم الطابق: 5" in row["additional_info"]["amenity_labels"]
    assert "lat" not in row["additional_info"] and "lat" not in row       # Riyadh coordinates on a Jeddah flat
    assert row["photo_urls"] == ["https://www.tamyaz-sa.com/uploads/u-1789887977499-21aefe53.jpg",
                                 "https://www.tamyaz-sa.com/uploads/u-1789887990195-93588552.jpg"]
    assert "furnished" not in row and "parking" not in row               # silent → NULL


def test_investment_rows_and_a_type_contradicting_its_title_are_skipped():
    assert R.map_listing(INVEST)[2] == "investment"
    assert R.map_listing(CONFLICT)[2] == "type_title_conflict"
    assert R.map_listing(_p(ROOF, title={"ar": "مزاد شقة روف", "en": ""}))[2] == "auction"
    assert R.map_listing(_p(ROOF, type={"ar": "منزل ريفي", "en": "Country house"}))[2] == "type_unmapped_منزل ريفي"
    assert R.map_listing(_p(ROOF, published=False))[2] == "unpublished"
    assert R.map_listing(_p(ROOF, id=""))[2] == "no_id"
    assert R.map_listing(_p(ROOF, location={"ar": "منطقة مكة المكرمة - رابغ - المركز", "en": ""}))[2] == "city_not_in_catalog"


def test_sale_stores_price_total_and_zero_rooms_are_unset():
    row, cat, why = R.map_listing(SALE)
    assert why == "" and row["property_type"] == "Building" and cat == "residential"
    assert row["price_total"] == 2200000 and "rent_period" not in row and "price_annual" not in row
    assert row["bedrooms"] is None and row["bathrooms"] is None          # a building's counts are not bedrooms
    assert row["additional_info"]["source_bedrooms"] == 12
    villa = R.map_listing(_p(ROOF, type={"ar": "فيلا", "en": "Villa"}, title={"ar": "فيلا دوبليكس", "en": ""}, bedrooms=0, bathrooms=10))[0]
    assert villa["bedrooms"] is None and villa["bathrooms"] == 10


def test_pii_in_the_description_is_redacted():
    row, _, _ = R.map_listing(_p(ROOF, desc={"ar": "شقة للإيجار للتواصل 0537711100", "en": ""}))
    assert "0537711100" not in json.dumps(row, ensure_ascii=False) and "[redacted]" in row["description"]


def test_signal_404_message_is_gone_and_only_the_same_published_id_is_live():
    sig = R._make_signal("prop-mu7drwdljc4k")
    assert sig(404, GONE_404, False) == "gone"
    assert sig(200, json.dumps(ROOF), False) == "live"
    assert sig(200, json.dumps(_p(ROOF, published=False)), False) == "gone"
    assert sig(200, json.dumps(SALE), False) is None                     # another listing's body
    assert sig(200, "<html>edge</html>", False) is None and sig(500, GONE_404, False) is None and sig(None, "", False) is None


def test_main_tallies_every_skip_into_end_run_notes(monkeypatch):
    calls: dict = {"batches": []}
    monkeypatch.setattr(sys, "argv", ["run.py"])
    monkeypatch.setattr(R, "session", lambda: object())
    monkeypatch.setattr(R, "fetch_properties", lambda s, limit=0: [ROOF, INVEST, CONFLICT, SALE])
    monkeypatch.setattr(R.db, "begin_run", lambda platform: 7)
    monkeypatch.setattr(R.db, "_wasalt_batch", lambda tbl, rows: calls["batches"].append((tbl, [r["ad_number"] for r in rows])))
    monkeypatch.setattr(R.db, "retire_superseded_siblings", lambda **kw: 0)
    monkeypatch.setattr(R.db, "prune_unseen", lambda tbl, seen, source, **kw: 0)
    monkeypatch.setattr(R.db, "end_run", lambda run_id, **kw: calls.update(end=kw) or True)
    assert R.main() == 0
    assert calls["batches"][0] == ("tamyaz_residential_listings", ["TMZprop-mu7drwdljc4k", "TMZretail-shop"])
    assert calls["end"]["rows_seen"] == 4 and calls["end"]["rows_upserted"] == 2
    assert "investmentx1" in calls["end"]["notes"] and "type_title_conflictx1" in calls["end"]["notes"]
    assert calls["end"]["check_tables"] == ["tamyaz_residential_listings", "tamyaz_commercial_listings"]
