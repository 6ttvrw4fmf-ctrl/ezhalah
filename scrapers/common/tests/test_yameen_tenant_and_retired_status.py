"""يمين العقارية (yameen.sa) — the yameen-specific traps of the shared Nuzul engine, pinned to
payloads captured VERBATIM from meteen.nzl-backend.com on 2026-09-23 (trimmed to the keys the code
reads; images[] cut to two entries; description_ar cut after the paragraph under test).

  · the tenant host is «meteen», not yameen — a wrong host would enumerate nothing (or someone else)
  · 14 of 27 items are retired in place (rented/unavailable) and MUST be skipped, never published
  · one unit publishes FOUR rent figures; the source's own annual one is stored verbatim
  · rega_ad_number «.» is not a licence

Offline: the two catalog helpers are the only stubs. Engine mechanics (prices, land amenities,
liveness law) are pinned in test_goldendeal_nuzul_source_fidelity.py and are NOT repeated here.

Run: python3 -m pytest -q -p no:cacheprovider scrapers/common/tests/test_yameen_tenant_and_retired_status.py
"""
from __future__ import annotations

import json
import sys
import types
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[3]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scrapers.goldendeal import run as ENGINE  # noqa: E402
from scrapers.yameen import run as R  # noqa: E402

_RIYADH, _RIYADH_REGION = 3, 1


@pytest.fixture(autouse=True)
def _catalog(monkeypatch):
    # map_listing lives in the engine module; the stubs must land where the name is looked up.
    monkeypatch.setattr(ENGINE, "to_catalog", lambda city_ar, region_hint=None: (
        (_RIYADH, _RIYADH_REGION) if city_ar == "الرياض" else (None, None)))
    monkeypatch.setattr(ENGINE, "find_district_in_text",
                        lambda text, city_id: text if (text or "").startswith("حي ") else None)


# ── VERBATIM PAYLOADS ───────────────────────────────────────────────────────────────────────────
# id 43065 — available villa_apartment; monthly + quarterly + semi-annual + annual all published;
# rega_ad_number is literally «.».
ITEM_43065 = json.loads(r'''{"id": 43065, "name_ar": null, "type": "villa_apartment", "purpose": "rent", "category": "residential", "availability_status": "available", "unit_number": "878", "description_ar": "<p><span style=\"font-family: &quot;Times New Roman&quot;; font-size: 20px;\">🏡 </span><span style=\"font-family: TimesNewRomanPS-BoldMT; font-size: 20px;\"><strong>شقة للإيجار – الرياض | حي النظيم</strong></span></p>", "district": {"id": 10100003092, "name_en": "Al Nadheem Dist.", "name_ar": "حي النظيم"}, "city": {"id": 3, "name_en": "Riyadh", "name_ar": "الرياض"}, "selling_price": null, "rent_price_monthly": 2500, "rent_price_quarterly": 7500, "rent_price_semi_annually": 15000, "rent_price_annually": 30000, "daily_price": null, "area": null, "built_up_area": null, "bedrooms": 2, "bathrooms": 2, "living_rooms": 1, "majlis_rooms": 1, "maid_rooms": 0, "driver_rooms": 0, "kitchens": 1, "is_kitchen_installed": 0, "is_ac_installed": 0, "is_furnished": 0, "elevators": 0, "parking_spots": 0, "balconies": 0, "has_electricity": 1, "has_water": 1, "has_sewage": 0, "unit_floor_number": 1, "number_of_floors": 0, "year_built": "0", "facade": null, "street_width": null, "street_width_east": null, "street_width_south": null, "street_width_west": null, "rega_ad_number": ".", "rega_advertiser_number": "1200040538", "whatsapp_number": "0554251053", "cover_image_url": "https://nuzul-saas-production.s3.us-east-2.amazonaws.com/tenants/4561/properties/43065/cover/3678705e-427f-4e6e-ad38-e823013e4221.png", "images": [{"url": "https://nuzul-saas-production.s3.us-east-2.amazonaws.com/tenants/4561/properties/43065/cover/3678705e-427f-4e6e-ad38-e823013e4221.png"}, {"url": "https://nuzul-saas-production.s3.us-east-2.amazonaws.com/tenants/4561/properties/43065/a9e6905f-66d1-4ae4-8f92-31653508e618.png"}], "latitude": "24.809422250247", "longitude": "46.876503563048", "plan_number": null, "plot_number": null}''')

# id 53184 — RENTED building_apartment; the office typed its phone into the description; semi-annual
# + annual published.
ITEM_53184 = json.loads(r'''{"id": 53184, "name_ar": null, "type": "building_apartment", "purpose": "rent", "category": "residential", "availability_status": "rented", "unit_number": "349", "description_ar": "<p>🏡 شقة دورين بسطح للإيجار – الرياض | حي طويق</p><p>📝 المواصفات</p><p>غرفتا نوم (واحدة ماستر)</p><p>مجلس + مقلط + صالة</p><p>مطبخ راكب</p><p>3 دورات مياه</p><p>سطح</p><p>المساحة 170م²</p><p>💰 الإيجار</p><p>30,000 ريال دفعة واحدة</p><p>35,000 ريال دفعتين</p><p>💳 دفع شهري عبر رايز أو إيجاري شامل تأمين الوحدة</p><p>✨ المميزات</p><p>مكيفات راكبة</p><p>مصعد</p><p>كهرباء ومياه مستقلة</p><p>عمر العقار 4 سنوات</p><p>بجوار شرطة طويق</p><p>📞 يمين العقارية: 0554252053</p>", "district": {"id": 10100003102, "name_en": "Tuwaiq Dist.", "name_ar": "حي طويق"}, "city": {"id": 3, "name_en": "Riyadh", "name_ar": "الرياض"}, "selling_price": null, "rent_price_monthly": null, "rent_price_quarterly": null, "rent_price_semi_annually": 17000, "rent_price_annually": 30000, "daily_price": null, "area": null, "built_up_area": null, "bedrooms": 3, "bathrooms": 4, "living_rooms": 1, "majlis_rooms": 1, "maid_rooms": 0, "driver_rooms": 0, "kitchens": 1, "is_kitchen_installed": 0, "is_ac_installed": 0, "is_furnished": 0, "elevators": 1, "parking_spots": 1, "balconies": 0, "has_electricity": 1, "has_water": 1, "has_sewage": 1, "unit_floor_number": 0, "number_of_floors": 0, "year_built": "2023", "facade": null, "street_width": null, "street_width_east": null, "street_width_south": null, "street_width_west": null, "rega_ad_number": "7201122406", "rega_advertiser_number": "1200040538", "whatsapp_number": null, "cover_image_url": "https://nuzul-saas-production.s3.us-east-2.amazonaws.com/tenants/4561/properties/53184/cover/6c1c4c08-ace4-4639-b3c3-1681f194f72b.png", "images": [{"url": "https://nuzul-saas-production.s3.us-east-2.amazonaws.com/tenants/4561/properties/53184/cover/6c1c4c08-ace4-4639-b3c3-1681f194f72b.png"}], "latitude": "24.5611679", "longitude": "46.5600224", "plan_number": null, "plot_number": null}''')


# id 48429 — trap 11: purpose=rent (rent_price_annually 1,300,000, available) but name_ar AND the
# description both say «للبيع» — the title names the OTHER deal. Live-verified 2026-09-24.
ITEM_48429 = json.loads(r'''{"id": 48429, "name_ar": "فيلا للبيع", "type": "villa", "purpose": "rent", "category": "residential", "availability_status": "available", "unit_number": "363", "description_ar": "<p><strong>للبيع فيلا مع شقة – الرياض | حي بدر</strong></p><p><strong>السعر:</strong> 1,300,000 ريال<br><strong>الرهن:</strong> مليون ريال لدى بنك الراجحي</p>", "district": {"id": 10100003164, "name_en": "Badr Dist.", "name_ar": "حي بدر"}, "city": {"id": 3, "name_en": "Riyadh", "name_ar": "الرياض"}, "selling_price": null, "rent_price_monthly": null, "rent_price_quarterly": null, "rent_price_semi_annually": null, "rent_price_annually": 1300000, "daily_price": null, "area": 249, "built_up_area": null, "bedrooms": 4, "bathrooms": 5, "living_rooms": 2, "majlis_rooms": 1, "maid_rooms": 0, "driver_rooms": 0, "kitchens": 1, "is_kitchen_installed": 0, "is_ac_installed": 0, "is_furnished": 0, "elevators": 0, "parking_spots": 0, "balconies": 0, "has_electricity": 1, "has_water": 0, "has_sewage": 0, "unit_floor_number": null, "number_of_floors": 0, "year_built": "2024", "facade": null, "street_width": null, "street_width_east": null, "street_width_south": null, "street_width_west": null, "rega_ad_number": "7200951015", "rega_advertiser_number": "1200040538", "whatsapp_number": "0554252053", "cover_image_url": "https://nuzul-saas-production.s3.us-east-2.amazonaws.com/tenants/4561/properties/48429/cover/b7bbf157-06a4-43ef-b98e-40392342e624.png", "images": [], "latitude": "24.513967606969", "longitude": "46.734628879908", "plan_number": null, "plot_number": null}''')


def test_tenant_constants_point_at_the_measured_host_not_the_site_name():
    assert R.TENANT.api_host == "meteen.nzl-backend.com"
    assert R.TENANT.base == "https://www.yameen.sa"
    assert (R.PREFIX, R.SOURCE, R.PLATFORM) == ("YMN", "يمين العقارية", "yameen")
    assert ENGINE.api_url(R.TENANT) == "https://meteen.nzl-backend.com/api/public/properties"


def test_the_sources_own_annual_figure_wins_and_every_figure_is_kept():
    row, cat, why = R.map_listing(ITEM_43065, this_year=2026)
    assert why == "" and cat == "residential"
    assert (row["rent_period"], row["price_annual"], row["price_total"]) == ("annual", 30000, None)
    assert row["additional_info"]["rent_published"] == {
        "monthly": 2500, "quarterly": 7500, "semi_annually": 15000, "annually": 30000}
    assert row["ad_number"] == "YMN43065"
    assert row["listing_url"] == "https://www.yameen.sa/properties/43065"
    assert row["source"] == "يمين العقارية"
    assert (row["city_ar"], row["city_id"], row["district_ar"], row["neighborhood"]) == (
        "الرياض", _RIYADH, "حي النظيم", "حي النظيم")
    assert row["title"] == "شقة في فيلا للإيجار"          # name_ar null → the site's own composition
    assert row["floor_number"] == 1 and row["bedrooms"] == 2


def test_a_dot_is_not_a_licence_and_the_raw_value_survives_in_capture():
    row, _, _ = R.map_listing(ITEM_43065)
    assert row["license_number"] is None
    assert row["source_capture"]["rega_ad_number"] == "."
    assert "rega_advertiser_number" not in row["source_capture"]     # the FAL broker licence: PII
    assert "whatsapp_number" not in row["source_capture"]


def test_a_rented_unit_is_skipped_never_published():
    row, _, why = R.map_listing(ITEM_53184)
    assert row is None and why == "status_rented"


def test_a_title_naming_the_opposite_deal_is_skipped_not_written_as_a_1_3m_rental():
    # trap 11 on yameen's own live catalogue: purpose=rent + rent_price_annually 1,300,000, but
    # name_ar/description say «للبيع». Fires on the shared engine's guard in goldendeal/run.py.
    # Mutation-checked: removing that guard must turn this red.
    row, _, why = R.map_listing(ITEM_48429, this_year=2026)
    assert row is None and why == "deal_conflict"


def test_the_typed_phone_is_stripped_from_the_description():
    # Same verbatim item with ONLY availability_status flipped, to reach the description path.
    item = {**ITEM_53184, "availability_status": "available"}
    row, _, why = R.map_listing(item, this_year=2026)
    assert why == ""
    assert "0554252053" not in row["description"] and "[redacted]" in row["description"]
    assert "0554252053" not in json.dumps(row, ensure_ascii=False)
    assert (row["rent_period"], row["price_annual"]) == ("annual", 30000)
    assert row["additional_info"]["rent_published"] == {"semi_annually": 17000, "annually": 30000}
    assert row["property_age"] == 3 and row["elevator"] is True and row["parking"] is True
    assert row["license_number"] == "7201122406"


def test_verify_gone_probes_the_meteen_host_for_this_tenant():
    asked: list[str] = []

    class _S:
        def get(self, url, **_kw):
            asked.append(url)
            return types.SimpleNamespace(status_code=404, url=url,
                                         text='{"message": "No query results for model [App\\\\Models\\\\Property] 43065"}')
    verify = ENGINE.verify_gone_for(R.TENANT, canary=lambda: (True, "control ok"),
                                    session_factory=lambda: _S())
    verdict, _ = verify("YMN43065")
    assert verdict == "gone"
    assert asked == ["https://meteen.nzl-backend.com/api/public/properties/43065"]


def test_main_writes_the_yameen_tables_and_tallies_the_rented_skip(monkeypatch):
    written: dict[str, list] = {}
    ended: dict = {}
    monkeypatch.setattr(ENGINE, "fetch_all", lambda s, tenant, limit=0: ([ITEM_43065, ITEM_53184], 2))
    monkeypatch.setattr(R, "session", lambda: object())
    monkeypatch.setattr(R.db, "begin_run", lambda platform: 11)
    monkeypatch.setattr(R.db, "_wasalt_batch", lambda table, rows: written.setdefault(table, list(rows)))
    monkeypatch.setattr(R.db, "retire_superseded_siblings", lambda **kw: 0)
    monkeypatch.setattr(R.db, "prune_unseen", lambda tbl, seen, source, **kw: 0)
    monkeypatch.setattr(R.db, "end_run", lambda run_id, **kw: ended.update(kw) or True)

    assert R.main([]) == 0
    assert [r["ad_number"] for r in written["yameen_residential_listings"]] == ["YMN43065"]
    assert written["yameen_commercial_listings"] == []
    assert "status_rentedx1" in ended["notes"]
    assert ended["rows_seen"] == 2 and ended["rows_upserted"] == 1
    assert ended["check_tables"] == ["yameen_residential_listings", "yameen_commercial_listings"]
