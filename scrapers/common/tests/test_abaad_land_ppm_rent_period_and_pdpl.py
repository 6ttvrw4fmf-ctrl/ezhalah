"""abaad's traps: land priced PER SQUARE METRE, a rent price field with no period of its own, two
fields that do not mean what their names say, a 0 that IS the source's answer, and a detail page
that keeps answering 200 after the listing is gone.

Fixtures are VERBATIM /api/v1/estate/get-estate/all objects captured 2026-09-24 (ids 1109, 884,
932, 1112, 765, 881, 875, 890, 1111, 968), trimmed to the keys the code reads — plus, on purpose,
the five PII keys the code must never touch. Assertions execute the SHIPPING functions
(run.map_listing, run._rent_fields, run._signal, run.fetch_catalogue). Offline: only to_catalog /
find_district_in_text and the db module are stubbed.

Run: python -m pytest scrapers/common/tests/test_abaad_land_ppm_rent_period_and_pdpl.py -v
"""
from __future__ import annotations

import json
import sys
from datetime import date, timedelta
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

from scrapers.abaad import run as R  # noqa: E402

# ── VERBATIM CAPTURES (2026-09-24) ───────────────────────────────────────────────────────────────
# LAND FOR SALE. The detail page prints «سعر المتر» 1746 AND «إجمالي السعر» 1099980 side by side.
LAND_SALE = {
    "id": 1109, "advertisement_type": "بيع", "property_type": "ارض", "category_name_ar": "ارض",
    "city": "المجمعة", "zone_name_ar": "الرياض", "districts": "الأمير سلطان بن عبدالعزيز",
    "title": "ارض-المجمعة-الأمير سلطان بن عبدالعزيز",
    "short_description": "ارض للبيع في الأمير سلطان بن عبدالعزيز - المجمعة | المساحة 630 م² | السعر 1746 ريال",
    "long_description": "يُطرح للـبيع ارض يقع في حي الأمير سلطان بن عبدالعزيز بمدينة المجمعة.\r\nالمساحة: 630 م²\r\nالسعر: 1746 ريال\r\nالواجهة: شمالية",
    "other_advantages": [{"name": "توفر كهرباء"}, {"name": "توفر ماء"}],
    "propertyUtilities": ["كهرباء", "صرف صحي", "مياه"], "property": [],
    "images": ["1790272668_20c9f8ba-bb39-4923-9c20-b24413d304d1.webp"],
    "price": "1746", "total_price": "1099980", "space": "630", "age_estate": None,
    "street_space": "30", "property_face": "شمالية", "view": 0, "landNumber": "1621",
    "ad_license_number": "7200788496", "end_date": "04/10/2026", "creation_date": "08/12/2025",
    "address": "الامير نايف بن عبدالعزيز، 8757، الأمير سلطان بن عبدالعزيز، المجمعة",
    "numberOfRooms": "", "mainLandUseTypeName": "سكني", "titleDeedTypeName": "صك إلكتروني",
    "deed_number": "912405001025", "status": "active",
    "phoneNumber": "+966561022650",
    "responsible_employee_name": "عبدالرحمن عقيل حميد المطيري",
    "responsible_employee_phone_number": "+966561022650",
    "advertiserName": "مؤسسة مستقبل الماس للاتصالات و تقنية المعلومات",
    "users": {"id": 779, "name": "مؤسسة مستقبل الماس للاتصالات و تقنية المعلومات", "email": "",
              "phone": "0561022650", "image": "1790271638_164af050.webp"},
}
# THE ADVERSARIAL LAND ROW: per-metre rate published, NO total. Its own prose even says «السعر/ 198
# الف» — a PROSE price, which must never be read. 450 × 440 = 198,000 must never be stored either.
LAND_NO_TOTAL = {
    "id": 884, "advertisement_type": "بيع", "property_type": "ارض", "category_name_ar": "ارض",
    "city": "الرس", "zone_name_ar": "القصيم", "districts": "المطار", "title": "ارض-الرس-المطار",
    "short_description": "ارض سكنيه للبيع بحي.       المطار  بالرس ( منطقه القصيم)",
    "long_description": "ارض سكنيه للبيع بحي.       المطار  بالرس ( منطقه القصيم)\r\n\r\nالمساحه /440 متر مربع \r\nالواجهه شارع شمالي ٣٠\r\n \r\n\r\nموقع مميز بالقرب من جميع الخدمات \r\nالسعر/ 198 الف\r\n\r\n7201113553",
    "other_advantages": [{"name": "توفر كهرباء"}, {"name": "توفر ماء"}, {"name": "مدخل سيارة"},
                         {"name": "حوش"}],
    "propertyUtilities": ["كهرباء", "مياه"], "property": [],
    "images": ["1788372601_962bd74e-ed37-4477-8860-57e52d95aa88.jpg"],
    "price": "450", "total_price": None, "space": "440", "age_estate": None, "street_space": "30",
    "property_face": "شمالية", "view": 8, "landNumber": "1187", "ad_license_number": "7201113553",
    "end_date": "24/08/2027", "creation_date": "01/09/2026", "status": "active",
    "phoneNumber": "0530881871", "advertiserName": "مكتب المسكن الثاني العقارية",
    "responsible_employee_name": "ممدوح بن محمد بن بتال الجميلى",
    "responsible_employee_phone_number": "0530881871",
    "users": {"id": 335, "name": "مكتب المسكن الثاني العقارية", "phone": "+966530881871"},
}
# price × space = 7,456,457.6 but the source PUBLISHES 7,456,615. The published total wins.
LAND_PRODUCT_MISMATCH = {
    "id": 932, "advertisement_type": "بيع", "property_type": "ارض", "category_name_ar": "ارض",
    "city": "خميس مشيط", "zone_name_ar": " عسير", "districts": "العمارة",
    "title": "ارض-خميس مشيط-العمارة",
    "short_description": "أرض سكني للبيع في حي العمارة في خميس مشيط",
    "long_description": "فرصة استثمارية مميزة في أحد المواقع الواعدة بمدينة خميس مشيط.\r\nرقم ترخيص الإعلان : 7201027949\r\nرخصة فال : 1200006125",
    "other_advantages": [{"name": "توفر كهرباء"}, {"name": "توفر ماء"}],
    "propertyUtilities": ["كهرباء", "مياه"], "property": [],
    "images": ["1788641122_72491f19-5f94-4e10-a777-b7d535c54a60.webp"],
    "price": "463", "total_price": "7456615", "space": "16104.66", "age_estate": "",
    "street_space": "25", "property_face": "جنوبية", "view": 2, "landNumber": "بدون",
    "ad_license_number": "7201027949", "end_date": "24/06/2027", "creation_date": "03/07/2026",
    "status": "active", "video_url": "", "phoneNumber": "0555754441",
    "advertiserName": "شركة الأزد العقارية",
    "responsible_employee_name": "سعيد يحيى عبدالله شلوان",
    "responsible_employee_phone_number": "+966555754441",
    "users": {"id": 747, "name": "شركة الأزد العقارية", "phone": "+966500689373"},
}
# NON-LAND SALE. The page prints ONE price row, «السعر» 700000, and total_price is the empty string.
REST_HOUSE_SALE = {
    "id": 1112, "advertisement_type": "بيع", "property_type": "إستراحة",
    "category_name_ar": "إستراحة", "city": "روضه سدير", "zone_name_ar": "الرياض",
    "districts": "الفيصلية", "title": "إستراحة-روضه سدير-الفيصلية",
    "short_description": "إستراحة للبيع في الفيصلية - روضه سدير | المساحة 630 م² | السعر 700000 ريال",
    "long_description": "يُطرح للـبيع إستراحة يقع في حي الفيصلية بمدينة روضه سدير.\r\nالمساحة: 630 م²\r\nالسعر: 700000 ريال\r\nالواجهة: شرقية\r\nعدد الغرف: 4\r\nعمر البناء: جديد",
    "other_advantages": [{"name": "توفر كهرباء"}, {"name": "توفر ماء"}, {"name": "مدخل سيارة"},
                         {"name": "حوش"}],
    "propertyUtilities": ["مياه", "كهرباء"], "property": [{"name": "غرف نوم", "number": "4"}],
    "images": ["1790273205_3e7be7be-c2ca-4f45-885e-56358da1a1ea.webp",
               "1790273213_ea90e474-4726-4e07-846d-c8d8ffdd0378.webp"],
    "price": "700000", "total_price": "", "space": "630", "age_estate": None,
    "street_space": "28", "property_face": "شرقية", "view": 1, "landNumber": "37",
    "ad_license_number": "7200717409", "end_date": "04/10/2026", "creation_date": "10/10/2025",
    "numberOfRooms": "4", "status": "active",
    "phoneNumber": "+966561022650", "responsible_employee_name": "",
    "advertiserName": "مؤسسة مستقبل الماس للاتصالات و تقنية المعلومات",
    "users": {"id": 779, "name": "مؤسسة مستقبل الماس للاتصالات و تقنية المعلومات",
              "phone": "0561022650"},
}
# A LAND RENT — per-metre rate 18, published total 425762.22. The rate is not the rent.
LAND_RENT = {
    "id": 765, "advertisement_type": "إيجار", "property_type": "ارض", "category_name_ar": "ارض",
    "city": "نجران", "zone_name_ar": " نجران ", "districts": "المسماه",
    "title": "ارض-نجران-المسماه",
    "short_description": "ارض تجارية للايجار بنجران  مباشرة على طريق الملك عبدالعزيز",
    "long_description": None, "other_advantages": [], "propertyUtilities": ["كهرباء", "مياه"],
    "property": [{"name": "حمام", "number": "0"}, {"name": "غرف نوم", "number": "0"},
                 {"name": "صالات", "number": "0"}, {"name": "مطبخ", "number": "0"}],
    "images": ["1772151376_image_picker_C21F0D08.jpg"],
    "price": "18", "total_price": "425762.22", "space": "23653.49", "street_space": "30",
    "property_face": "شرقية", "view": 590, "landNumber": "2", "ad_license_number": "7100263904",
    "end_date": "26/02/2027", "creation_date": "26/02/2026", "status": "active",
    "phoneNumber": "0591711040", "advertiserName": "احمد حمدان رداد العيلي",
    "responsible_employee_name": "احمد حمدان رداد العيلي",
    "responsible_employee_phone_number": "0591711040",
    "users": {"id": 339, "name": "احمد العتيبي", "phone": "+9660591711040"},
}
# «شقه للإيجار السنوي» + price 60000. 'annual' converts nothing, so the source's word is honoured.
RENT_ANNUAL_STATED = {
    "id": 881, "advertisement_type": "إيجار", "property_type": "شقة", "category_name_ar": "شقة",
    "city": "الرياض", "zone_name_ar": "الرياض", "districts": "الملقا", "title": "شقة-الرياض-الملقا",
    "short_description": "شقه للإيجار السنوي-حي الملقا",
    "long_description": "شقه للإيجار السنوي\r\nالمساحه/ 147متر\r\nب ٦٠ الف شامل المويه\r\n7201103422",
    "other_advantages": [{"name": "توفر كهرباء"}, {"name": "توفر ماء"}],
    "propertyUtilities": ["كهرباء", "مياه"], "property": [{"name": "غرف نوم", "number": "3"}],
    "images": ["1788029982_d67c7909.jpg"], "price": "60000", "total_price": None,
    "space": "146.98", "street_space": "0", "property_face": "", "view": 8,
    "ad_license_number": "7201103422", "end_date": "25/08/2027", "status": "active",
    "phoneNumber": "0530881871", "advertiserName": "مكتب المسكن الثاني العقارية",
}
# THE 12× TRAP. price 9600 is ALREADY annual (800×12); the prose names the MONTHLY instalment 800.
# ×12 here would store 115,200 for a 9,600 listing.
RENT_MONTHLY_UNCORROBORATED = {
    "id": 875, "advertisement_type": "إيجار", "property_type": "شقة", "category_name_ar": "شقة",
    "city": "القريات", "zone_name_ar": " الجوف", "districts": "المروج",
    "title": "شقة-القريات-المروج", "short_description": "شقه نظيفه للايجار بالقريات ",
    "long_description": "شقه نظيفه للايجار بالقريات \r\nالرفاع شارع الثلاثين\r\n* السعر ٨٠٠ ريال شهري\r\n7201071219",
    "other_advantages": [{"name": "توفر كهرباء"}], "propertyUtilities": ["كهرباء", "مياه"],
    "property": [{"name": "حمام", "number": "2"}, {"name": "غرف نوم", "number": "3"},
                 {"name": "صالات", "number": "1"}, {"name": "مطبخ", "number": "1"}],
    "images": ["1787251114_a0ac0507.jpg"], "price": "9600", "total_price": None, "space": "538.08",
    "street_space": "0", "property_face": "شمالية شرقية", "view": 40, "landNumber": "121( ج )",
    "ad_license_number": "7201071219", "end_date": "04/08/2027", "status": "active",
    "phoneNumber": "0530881871", "advertiserName": "مكتب المسكن الثاني العقارية",
}
# The CORROBORATED monthly: «السعر/ 3900 شهريا» beside the very figure `price` holds.
RENT_MONTHLY_CORROBORATED = {
    "id": 890, "advertisement_type": "إيجار", "property_type": "شقة", "category_name_ar": "شقة",
    "city": "الرياض", "zone_name_ar": "الرياض", "districts": "الملقا", "title": "شقة-الرياض-الملقا",
    "short_description": "شقه غرفه وصاله راقيه للايجار بحي الملقا",
    "long_description": "شقه غرفه وصاله راقيه للايجار بحي الملقا\r\nمميزات الشقه /  يوجد فيها مصعد\r\nالسعر/ 3900 شهريا\r\nالسعر /  في حال التقبيل الفتره المتبقيه 6 شهور كامله الدفعه 24000 شامل الاثاث\r\n7201005998",
    "other_advantages": [{"name": "مصعد"}], "propertyUtilities": ["كهرباء", "مياه"],
    "property": [{"name": "غرف نوم", "number": "1"}], "images": ["1788031843_960b165e.jpg"],
    "price": "3900", "total_price": None, "space": "120", "street_space": "0",
    "ad_license_number": "7201005998", "end_date": "25/08/2027", "status": "active",
    "phoneNumber": "0530881871",
}
# A rent whose own text states NO period at all (96 of the 121 rents are this shape).
RENT_SILENT = {
    "id": 1111, "advertisement_type": "إيجار", "property_type": "إستراحة",
    "category_name_ar": "إستراحة", "city": "المجمعه", "zone_name_ar": "الرياض",
    "districts": "الروضة", "title": "إستراحة-المجمعه-الروضة",
    "short_description": "إستراحة للإيجار في الروضة - المجمعه | المساحة 550 م² | السعر 14000 ريال",
    "long_description": "يُطرح للـإيجار إستراحة يقع في حي الروضة بمدينة المجمعه.\r\nالمساحة: 550 م²\r\nالسعر: 14000 ريال\r\nالواجهة: غربية\r\nعدد الغرف: 2\r\nعمر البناء: اكثر من عشر سنوات",
    "other_advantages": [{"name": "توفر كهرباء"}, {"name": "مدخل سيارة"}],
    "propertyUtilities": ["كهرباء", "مياه"], "property": [{"name": "غرف نوم", "number": "2"}],
    "images": ["1790273055_6ddeedf1.webp"], "price": "14000", "total_price": "", "space": "550",
    "street_space": "15", "property_face": "غربية", "view": 0, "landNumber": "162",
    "ad_license_number": "7200717411", "end_date": "04/10/2026", "creation_date": "11/10/2025",
    "numberOfRooms": "2", "status": "active", "phoneNumber": "+966561022650",
    "advertiserName": "مؤسسة مستقبل الماس للاتصالات و تقنية المعلومات",
}
# BEDROOMS 0 with BATHROOMS 3 and numberOfRooms 5. The UI renders «0 غرف نوم» as a chip, so 0 is
# the source's published answer. Its description also carries a phone AND a wa.me link.
ZERO_BEDROOMS = {
    "id": 968, "advertisement_type": "إيجار", "property_type": "شقة", "category_name_ar": "شقة",
    "city": "أبها", "zone_name_ar": " عسير", "districts": "الروابي", "title": "شقة-أبها-الروابي",
    "short_description": "شقة سكنية للإيجار في أبها حي الروابي",
    "long_description": "شقة سكنية للإيجار في أبها حي الروابي \nالمساحة : 182 م\n الإيجار السنوي: 23,000 ريال\nرخصة فال : 1200006125\nترخيص الإعلان : 7201135610\nللتواصل سعيد شلوان : 0555754441\n‎اضغط للمحادثة الفورية على الواتساب\nwa.me/966555754441",
    "other_advantages": [], "propertyUtilities": ["كهرباء", "مياه", "صرف صحي", "ألياف ضوئية"],
    "property": [{"name": "حمام", "number": "3"}, {"name": "غرف نوم", "number": "0"},
                 {"name": "صالات", "number": "1"}, {"name": "مطبخ", "number": "1"}],
    "images": ["1789622611_image_picker_6EF4C649.jpg"], "price": "23000", "total_price": None,
    "space": "182.56", "age_estate": "عشر سنوات", "street_space": "0", "property_face": "شمالية",
    "view": 12, "landNumber": "59", "ad_license_number": "7201135610", "end_date": "17/07/2027",
    "numberOfRooms": "5", "plan_number": "1388 / 1430هـ / ع / 1", "status": "active",
    "phoneNumber": "0555754441", "responsible_employee_name": "سعيد يحيى عبدالله شلوان",
    "responsible_employee_phone_number": "+966555754441",
    "advertiserName": "شركة الأزد العقارية",
    "users": {"id": 750, "name": "شركة الأزد العقارية", "phone": "+966505759010"},
}
# «عرفة خادمة» — the platform's own misspelling of غرفة خادمة, on 25 rows — plus the BLANKET
# «لايوجد خدمات», which names no specific utility.
TYPO_AND_BLANKET_NEGATIVE = {
    "id": 700, "advertisement_type": "بيع", "property_type": "فيلا", "category_name_ar": "فيلا",
    "city": "الرياض", "zone_name_ar": "الرياض", "districts": "الملقا", "title": "فيلا-الرياض-الملقا",
    "short_description": "فيلا للبيع", "long_description": "فيلا للبيع",
    "other_advantages": [{"name": "عرفة خادمة"}, {"name": "ملحق"}, {"name": "مصعد"}],
    "propertyUtilities": ["لايوجد خدمات"], "property": [{"name": "غرف نوم", "number": "5"}],
    "images": [], "price": "2500000", "total_price": None, "space": "400", "status": "active",
    "ad_license_number": "7200000001", "end_date": "01/01/2027",
}

_ALL = (LAND_SALE, LAND_NO_TOTAL, LAND_PRODUCT_MISMATCH, REST_HOUSE_SALE, LAND_RENT,
        RENT_ANNUAL_STATED, RENT_MONTHLY_UNCORROBORATED, RENT_MONTHLY_CORROBORATED, RENT_SILENT,
        ZERO_BEDROOMS, TYPO_AND_BLANKET_NEGATIVE)
# Every personal value in the fixtures above. None may appear anywhere in a stored row.
_PII_VALUES = ("+966561022650", "0561022650", "عبدالرحمن عقيل حميد المطيري",
               "مؤسسة مستقبل الماس للاتصالات و تقنية المعلومات", "0530881871", "+966530881871",
               "مكتب المسكن الثاني العقارية", "ممدوح بن محمد بن بتال الجميلى", "0555754441",
               "+966555754441", "سعيد يحيى عبدالله شلوان", "شركة الأزد العقارية",
               "+966505759010", "+966500689373", "0591711040", "+9660591711040",
               "احمد حمدان رداد العيلي", "احمد العتيبي")

_RIYADH, _ABHA = 3, 21


@pytest.fixture(autouse=True)
def _no_catalog_network(monkeypatch):
    """to_catalog/find_district_in_text would otherwise read loc_catalog_* from the database."""
    cities = {"الرياض": (_RIYADH, 1), "أبها": (_ABHA, 2), "الرس": (30, 5), "خميس مشيط": (31, 2),
              "روضه سدير": (32, 1), "نجران": (33, 9), "القريات": (34, 8),
              "المجمعة": (35, 1), "المجمعه": (35, 1)}
    # NB: live, المجمعة/المجمعه are NOT in loc_catalog_city (7 rows skip on it, a real catalog gap
    # rather than a scraper fault). They are resolvable here so the land fixtures can be exercised;
    # the skip path itself is covered by its own parametrised case below.
    monkeypatch.setattr(R, "to_catalog",
                        lambda c, region_hint=None: cities.get((c or "").strip()) or (None, None))
    known = {"الملقا", "الروابي", "المطار", "العمارة", "المسماه", "المروج"}
    monkeypatch.setattr(R, "find_district_in_text",
                        lambda t, cid: next((d for d in known if t and d in t), None))


def _row(rec):
    row, cat, why = R.map_listing(rec)
    assert row, f"fixture id {rec['id']} unexpectedly skipped: {why}"
    return row, cat


# ── 1. THE LAND TRAP: per-metre is a RATE, and nothing is ever multiplied ────────────────────────

def test_a_land_row_stores_the_sources_own_total_and_not_the_per_metre_figure():
    row, cat = _row(LAND_SALE)
    assert row["price_total"] == 1099980, "the source's own «إجمالي السعر» must be the listing price"
    assert row["price_per_meter"] == 1746, "«سعر المتر» belongs in price_per_meter"
    assert row["price_total"] != 1746, "storing the per-m² rate as the price understates it ~600×"
    assert cat == "residential" and row["transaction_type"] == "Buy"


def test_a_land_row_with_no_published_total_stores_null_rather_than_a_computed_product():
    """THE ADVERSARIAL CASE. id 884 publishes «سعر المتر» 450 and NO total (verified on its live
    page: «إجمالي السعر» does not appear). 450 × 440 = 198,000 — and its own prose even says
    «السعر/ 198 الف». Neither may be stored: an unpublished total is UNKNOWN."""
    row, _ = _row(LAND_NO_TOTAL)
    assert row["price_per_meter"] == 450, "the published rate is still the published rate"
    assert row.get("price_total") is None, "a total the source never published must be NULL"
    assert row.get("price_annual") is None, "and it must not be smuggled in as a rent either"
    stored = json.dumps(row, ensure_ascii=False, default=str)
    for invented in ("198000", "198,000"):
        assert invented not in stored, f"{invented} is arithmetic/prose, not a published price"


def test_a_published_total_wins_over_the_product_of_rate_and_area():
    """id 932: 463 × 16104.66 = 7,456,457.6, but the source publishes 7,456,615. 4 of the 47 land
    rows disagree like this, which is the proof that the product is not the price."""
    row, _ = _row(LAND_PRODUCT_MISMATCH)
    assert row["price_total"] == 7456615
    assert row["price_total"] != int(463 * 16104.66)


def test_a_land_rent_stores_the_published_total_as_the_rent_and_the_rate_as_per_metre():
    row, _ = _row(LAND_RENT)
    assert row["price_per_meter"] == 18, "18 SAR/m² is a RATE, never the rent"
    assert row["price_annual"] == 425762, "the rent is the source's own «إجمالي السعر»"
    assert row.get("price_total") is None, "a rent never lands in price_total"


def test_a_non_land_row_stores_price_as_the_total_and_claims_no_per_metre_rate():
    row, _ = _row(REST_HOUSE_SALE)
    assert row["price_total"] == 700000, "«السعر» on a non-land page IS the whole asking price"
    assert row.get("price_per_meter") is None, "the source publishes no rate for this row"


# ── 2. RENT PERIOD = SOURCE ─────────────────────────────────────────────────────────────────────

def test_a_rent_whose_text_states_no_period_stores_a_null_period_and_the_price_unconverted():
    row, _ = _row(RENT_SILENT)
    assert row.get("rent_period") is None, "a silent listing must never be defaulted to annual"
    assert row["price_annual"] == 14000, "and its price is stored exactly as published"


def test_a_period_the_listing_itself_states_is_honoured():
    annual, _ = _row(RENT_ANNUAL_STATED)
    assert annual["rent_period"] == "annual", "«للإيجار السنوي» is the source saying so"
    assert annual["price_annual"] == 60000, "'annual' converts nothing — the figure is verbatim"

    monthly, _ = _row(RENT_MONTHLY_CORROBORATED)
    assert monthly["rent_period"] == "monthly", "«السعر/ 3900 شهريا» names THIS very figure"
    assert monthly["price_annual"] == 3900 * 12, "the documented ×12 storage conversion"


def test_a_monthly_token_that_describes_a_different_number_is_not_applied():
    """THE 12× TRAP. id 875 publishes `price` 9600 — already annual — while its prose names the
    monthly instalment «٨٠٠ ريال شهري». Handing that to ×12 stores 115,200 for a 9,600 listing."""
    row, _ = _row(RENT_MONTHLY_UNCORROBORATED)
    assert row.get("rent_period") is None, "an uncorroborated period is UNKNOWN, not monthly"
    assert row["price_annual"] == 9600, "the source's own figure, unconverted"
    assert row["price_annual"] != 9600 * 12


@pytest.mark.parametrize("text,price,expect", [
    ("السعر/ 3900 شهريا", 3900, ("monthly", 46800)),        # corroborated → converted
    ("* السعر ٨٠٠ ريال شهري", 9600, (None, 9600)),          # the measured 875 shape
    ("للايجار الشهري واليومي", 3800, (None, 3800)),          # two periods = no statement
    ("شقه للإيجار السنوي", 60000, ("annual", 60000)),        # no conversion, no corroboration owed
    ("شقة للإيجار", 14000, (None, 14000)),                   # silent
    # A period this schema has no bucket for. The shared parser answers (None, None) for platforms
    # whose price field carries that label; abaad's does not, so the published figure is kept with
    # an UNKNOWN period instead of being discarded (no hiding a source-published price).
    ("شاليه للإيجار اليومي", 350, (None, 350)),
    ("للإيجار نصف سنوي", 40000, (None, 40000)),
])
def test_the_rent_gate_itself_on_the_shapes_measured_live(text, price, expect):
    assert R._rent_fields(price, text) == expect


def test_arabic_indic_digits_corroborate_just_as_western_ones_do():
    """«٣٩٠٠ شهريا» is the same statement as «3900 شهريا» — parity is a standing fleet rule."""
    assert R._rent_fields(3900, "السعر ٣٩٠٠ شهريا") == ("monthly", 46800)
    assert R._rent_fields(23000, "الإيجار السنوي: 23,000 ريال") == ("annual", 23000)


# ── 3. PDPL: no personal data anywhere ──────────────────────────────────────────────────────────

@pytest.mark.parametrize("rec", _ALL, ids=[str(r["id"]) for r in _ALL])
def test_no_phone_name_or_advertiser_ever_reaches_the_row(rec):
    row, _ = _row(rec)
    stored = json.dumps(row, ensure_ascii=False, default=str)
    for value in _PII_VALUES:
        assert value not in stored, (
            f"{value!r} is personal data and reached the row for id {rec['id']} — PDPL forbids "
            f"storing broker/owner identity or any contact number, in a column, in additional_info "
            f"or in source_capture")
    for key in ("phoneNumber", "responsible_employee_name", "responsible_employee_phone_number",
                "advertiserName", "users"):
        assert key not in stored, f"the {key!r} key itself must never be carried into a row"


def test_a_contact_number_in_the_description_is_redacted_not_stored():
    row, _ = _row(ZERO_BEDROOMS)
    assert "0555754441" not in (row["description"] or "")
    assert "wa.me" not in (row["description"] or "")
    assert "7201135610" in (row["description"] or ""), (
        "the REGA advertisement licence is regulatory data and must survive the redaction")


def test_the_capture_and_additional_info_are_built_from_an_allowlist():
    """A blocklist would miss `users.name` (db.redact_capture deliberately does not treat a bare
    'name' as a contact channel, so it must never arrive in the first place)."""
    row, _ = _row(LAND_SALE)
    for blob in (row["additional_info"], row["source_capture"]):
        flat = json.dumps(blob, ensure_ascii=False, default=str)
        assert "users" not in flat and "مؤسسة مستقبل" not in flat


# ── 4. The two fields that do not mean what their names say ─────────────────────────────────────

def test_street_width_comes_from_street_space_because_street_width_is_always_null():
    """The API's own `street_width` is null on all 405; `street_space` is what the page labels
    «عرض الشارع» (28 on /details/1112)."""
    row, _ = _row(REST_HOUSE_SALE)
    assert row["street_width_m"] == 28
    assert "street_width" not in row, "the column is street_width_m"


def test_bedrooms_come_from_the_property_array_not_from_numberOfRooms():
    """`numberOfRooms` is «عدد الغرف» — TOTAL rooms. id 968 has numberOfRooms 5 and غرف نوم 0."""
    row, _ = _row(ZERO_BEDROOMS)
    assert row["bedrooms"] == 0, "the UI renders «0 غرف نوم» as a chip, so 0 IS the source's answer"
    assert row["bathrooms"] == 3 and row["halls"] == 1 and row["kitchen"] is True
    assert row["additional_info"]["total_rooms"] == "5", "numberOfRooms has no column"


def test_a_zero_bedroom_count_is_not_confused_with_an_unstated_one():
    zero, _ = _row(ZERO_BEDROOMS)         # property[] says 0
    absent, _ = _row(LAND_SALE)           # property[] is empty — the source says nothing
    assert zero["bedrooms"] == 0
    assert "bedrooms" not in absent or absent.get("bedrooms") is None


# ── 5. Amenities: only a named one is True ──────────────────────────────────────────────────────

def test_the_platforms_own_maid_room_typo_is_mapped_like_the_correct_spelling():
    row, _ = _row(TYPO_AND_BLANKET_NEGATIVE)
    assert row["maid_room"] is True, "«عرفة خادمة» is the source's own spelling on 25 rows"
    assert row["extension"] is True and row["elevator"] is True


def test_a_blanket_no_services_phrase_sets_no_utility_column_false():
    """«لايوجد خدمات» is an explicit negative that names no specific utility, so it cannot decide
    electricity vs water vs sanitation. It is preserved raw and settles nothing."""
    row, _ = _row(TYPO_AND_BLANKET_NEGATIVE)
    for col in ("electricity", "water_supply", "sanitation", "optical_fibers"):
        assert row.get(col) is not False, f"{col} must stay UNKNOWN, never a manufactured NO"
    assert "لايوجد خدمات" in row["additional_info"]["amenity_words"]


def test_an_unnamed_amenity_stays_unknown_rather_than_false():
    row, _ = _row(LAND_SALE)
    for col in ("elevator", "maid_room", "driver_room", "extension"):
        assert row.get(col) is not False, f"{col} was never mentioned — absent is not absent-so-NO"
    assert row["electricity"] is True and row["water_supply"] is True, "these WERE named"


# ── 6. Skips are counted, never guessed ─────────────────────────────────────────────────────────

@pytest.mark.parametrize("field,value,expect", [
    ("advertisement_type", "مزاد", "deal_unknown_مزاد"),
    ("advertisement_type", None, "deal_unknown_blank"),
    ("property_type", "محطة", "type_unmapped_محطة"),      # bare «station» — never guessed
    ("property_type", "مجمع", "type_unmapped_مجمع"),      # compound or commercial complex?
    ("city", "مخطط ال بلحي", "city_not_in_catalog"),   # a plot label the source puts in `city`
    ("city", "", "no_city"),
])
def test_an_unrecognised_value_skips_the_row_with_a_counted_reason(field, value, expect):
    rec = {**REST_HOUSE_SALE, field: value}
    if field == "property_type":
        rec["category_name_ar"] = value        # both carry the type; neither may be guessed
    row, _cat, why = R.map_listing(rec)
    assert row is None and why == expect


# The source's studio type, built from its CODEPOINTS so no editor, copy-paste or hand-typing can
# silently reorder the marks. Captured from the live API: shadda (U+0651) comes BEFORE fatha
# (U+064E). A hand-typed «شقَّة صغيرة (استوديو)» renders identically and compares UNEQUAL — the first
# build's override was keyed on the hand-typed form, so it never fired in production while a test
# using that same hand-typed string passed. A fixture that supplies its own input proves nothing.
STUDIO_TYPE_AR = ("شقَّة صغيرة "
                  "(استوديو)")


def test_the_studio_type_fixture_really_is_the_bytes_the_source_serves():
    """Guards the guard: if this ever equals the hand-typed spelling, the test below stops proving
    anything about production input."""
    assert STUDIO_TYPE_AR != "شقَّة صغيرة (استوديو)", (
        "the fixture must carry the SOURCE's mark order (shadda then fatha), not a typed copy")
    assert STUDIO_TYPE_AR.index("ّ") < STUDIO_TYPE_AR.index("َ")


def test_the_studio_override_fires_on_the_sources_own_bytes():
    """The type maps through the mark-stripping lookup, and the TABLE then follows
    normalize.category_for_type VERBATIM — that shared rule files Studio (and Duplex) as COMMERCIAL
    fleet-wide. Asserting the shared rule rather than a local opinion: if the split for Studio is
    revisited it must be revisited in normalize for every platform at once, never forked here.
    (Raised as an open question at onboarding.)
    """
    from scrapers.common import normalize
    rec = {**REST_HOUSE_SALE, "property_type": STUDIO_TYPE_AR,
           "category_name_ar": STUDIO_TYPE_AR}
    row, cat = _row(rec)
    assert row["property_type"] == "Studio", "the source's own mark order must still map"
    assert cat == normalize.category_for_type("Studio").lower() == "commercial"


def test_a_hand_typed_spelling_of_the_same_word_maps_identically():
    """Both mark orders are the same word, so both must map — that is the point of stripping."""
    rec = {**REST_HOUSE_SALE, "property_type": "شقَّة صغيرة (استوديو)",
           "category_name_ar": "شقَّة صغيرة (استوديو)"}
    row, _ = _row(rec)
    assert row["property_type"] == "Studio"


# ── 7. The removal oracle: a 200 is NOT proof of life ───────────────────────────────────────────

_TODAY = date.today()


def _page(expiry: date | None) -> str:
    body = "<html>…<span class=\"k\">رقم القطعة</span><div class=\"v\">37</div>"
    if expiry:
        body += ("<span class=\"k\">تاريخ انتهاء رخصة الإعلان</span><div class=\"v\">"
                 f"{expiry.strftime('%d/%m/%Y')}</div>")
    return body + "…</html>"


@pytest.mark.parametrize("status,body,expect,why", [
    (404, "Not Found", "gone", "a hard-deleted listing (ids 415/459/701/813/838/970 + 3 fabricated)"),
    (200, _page(_TODAY - timedelta(days=200)), "gone", "licence lapsed — why the catalogue dropped it"),
    (200, _page(_TODAY), None, "expires TODAY: the measured boundary, so hold"),
    (200, _page(_TODAY + timedelta(days=10)), "live", "still publishable — absent from OUR crawl only"),
    (200, _page(None), None, "200 without the expiry line says nothing"),
    (403, _page(_TODAY - timedelta(days=200)), None, "a block is about us, not the listing"),
    (500, _page(_TODAY - timedelta(days=200)), None, "the source is broken, not the listing"),
])
def test_the_oracle_only_kills_on_a_404_or_a_lapsed_licence(status, body, expect, why):
    assert R._signal(status, body, False) == expect, why


def test_a_200_with_a_valid_licence_is_never_read_as_gone_and_a_de_listed_page_never_as_live():
    """The measured trap: all five ids that left the catalogue mid-capture still served 200 with
    full content. So content alone must decide nothing — only the expiry may."""
    assert R._signal(200, "<html>" + "x" * 5000 + "</html>", False) is None, (
        "a rich 200 page with no expiry line must be UNKNOWN — a de-listed ad still serves one")


# ── 8. Pagination and the completeness gate ─────────────────────────────────────────────────────

class _FakeResp:
    def __init__(self, payload):
        self.status_code = 200
        self._payload = payload
        self.text = json.dumps(payload)

    def json(self):
        return self._payload


def _fake_session(pages: dict[int, dict]):
    class S:
        def get(self, url, timeout=None):
            page = int(url.split("offset=")[1])
            return _FakeResp(pages.get(page, {"total_size": 0, "estate": []}))
    return S()


def test_offset_is_read_as_a_page_number_and_every_page_is_collected():
    """A row-offset reading would re-serve page 1 forever. Verified live: limit=200 offset=1/2/3
    returned 200 + 200 + 5 rows with 405 DISTINCT ids."""
    big = [{"id": i} for i in range(1, R.PAGE_SIZE + 1)]
    tail = [{"id": i} for i in range(R.PAGE_SIZE + 1, R.PAGE_SIZE + 6)]
    items, complete = R.fetch_catalogue(
        _fake_session({1: {"total_size": R.PAGE_SIZE + 5, "estate": big},
                       2: {"total_size": R.PAGE_SIZE + 5, "estate": tail}}))
    assert len(items) == R.PAGE_SIZE + 5, "both pages must be collected"
    assert len({str(i["id"]) for i in items}) == R.PAGE_SIZE + 5, "and be distinct"
    assert complete is True, "total_size matched the rows served"


def test_a_short_catalogue_is_not_complete_so_nothing_may_be_pruned():
    """The completeness gate is what stops a truncated response from looking like a mass removal."""
    items, complete = R.fetch_catalogue(
        _fake_session({1: {"total_size": 400, "estate": [{"id": 1}, {"id": 2}]}}))
    assert len(items) == 2 and complete is False


def test_a_page_that_repeats_itself_terminates_instead_of_looping():
    same = [{"id": i} for i in range(1, R.PAGE_SIZE + 1)]
    items, complete = R.fetch_catalogue(
        _fake_session({1: {"total_size": 999, "estate": same}, 2: {"total_size": 999, "estate": same}}))
    assert len(items) == R.PAGE_SIZE and complete is False


# ── 9. Shape ────────────────────────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("rec", _ALL, ids=[str(r["id"]) for r in _ALL])
def test_every_row_carries_a_verified_listing_url_and_the_platforms_photo_base(rec):
    row, _ = _row(rec)
    assert row["listing_url"] == f"https://app.abaadapp.sa/details/{rec['id']}"
    assert row["ad_number"] == f"ABD{rec['id']}"
    assert row["source"] == "أبعاد"
    for url in row.get("photo_urls") or []:
        assert url.startswith("https://pub-4ce088f208944decb4e9cf11054558ea.r2.dev/estate/"), (
            "the grid template's /storage/app/public/estate/ base 404s; the R2 bucket is the live one")


def test_a_video_filename_never_becomes_a_url_we_could_not_resolve():
    rec = {**REST_HOUSE_SALE, "video_url": "video_1789621590.mov"}
    row, _ = _row(rec)
    assert row.get("video_url") is None, "no base serves these files — an unresolved URL is not a URL"
    assert row["additional_info"]["video_filename"] == "video_1789621590.mov"


def test_the_licence_and_its_expiry_are_stored_because_the_expiry_is_the_removal_signal():
    row, _ = _row(REST_HOUSE_SALE)
    assert row["license_number"] == "7200717409"
    assert row["license_expiry"] == "04/10/2026", "kept as the source's own text"
