"""Haraj licensed posts (owner 2026-10-16; since 10-17 unlicensed offers are stored too — test_haraj_prose_offers.py). Real post shapes measured 2026-10-16
(11190690713, 11190682544, 11190682681, 11190684322, 11190691040); names and phones replaced (PDPL).

Pins: no licence block → never a listing (however clear the offer); a request / non-property post → never;
an expired licence → never; every licence field (Arabic AND REGA's English enums) reaches its column,
silence stays NULL; the DEED district wins over the seller's own words; an unresolved district is NULL
with its raw spelling kept; no person's name or phone is ever stored; the own-page removal signal.
"""
import json
import sys
from datetime import date
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

from scrapers.haraj import parse as P  # noqa: E402
from scrapers.haraj import run as R  # noqa: E402
from scrapers.haraj.classify import classify  # noqa: E402

TODAY = date(2026, 10, 16)
CITY_IDS = {"جيزان": 17, "الرياض": 3, "جده": 18, "المدينة المنورة": 14}
CATALOG = {(17, "الروابي"), (3, "الجنادرية"), (3, "البيان"), (14, "الخالدية")}

LAND_EN = (
    "🏡 أرض سكنية للبيع في المحمدية 3 – جيزان | مساحة 473.71م2\n🔹 المدينة: جيزان\n🔹 الحي: المحمدية 3\n"
    "عرض الشارع: 15 متر\n💰 السعر المطلوب: 400,000 ريال\n💵 سعر المتر التقريبي: 844.4 ريال\n"
    "📞 للتواصل والاستفسار والمعاينة:\n 0500000000\n\n"
    "معلومات العقار حسب الرخصة\nغرض الإعلان: Sell\nسعر الوحدة: 400000\nنوع العقار: Land\nعمر العقار: لا يوجد\n"
    "مساحة العقار: 473.71\nواجهة العقار: Southern\nعدد الغرف: لا يوجد\nرقم المخطط: 465\nرقم القطعة: 45\n"
    "عرض الشارع: 15\nاستخدامات العقار: لا يوجد\nخدمات العقار: Electricity\nالضمانات ومدتها: لا يوجد\n"
    "الالتزامات الآخرى على العقار: -\nوصف موقع العقار: Jazan Region, Jazan, Al Mohammadiyah 3\n\n"
    " صاحب الترخيص : مؤسسة فلان العقارية\n تاريخ انتهاء رخصة الإعلان : 2027-08-31\n-----\n"
    "نأمل مطابقة الموقع على الخريطة مع الموقع حسب الصك\n\nوصف موقع العقار حسب الصك\nالمدينة: جيزان\n"
    "الحي: الروابي\nالموظف المسؤول عن الإعلان: فلان بن فلان\nرقم جوال مسؤول الإعلان: 0500000001\n"
    "عمولة نقل الملكية: لا يوجد\nموقع العقار على الخريطة: \nhttps://maps.google.com/?q=16.946853221896,42.571620414793")
FLAT_AR = (
    "شقة مميزة للإيجار في حي الجنادرية – شرق الرياض\n✨ تتكون الشقة من:\n 3 غرف نوم، منها غرفتان ماستر\n صالة\n"
    "🍽 مطبخ\n🚿 دورتَي مياه\n مصعد\n\nمعلومات العقار حسب الرخصة\nغرض الإعلان: إيجار\nسعر الوحدة: 40000\n"
    "نوع العقار: شقة\nعمر العقار: جديد\nمساحة العقار: 189\nواجهة العقار: شرقية\nعدد الغرف: 4\nرقم المخطط: 3680\n"
    "رقم القطعة: 314\nعرض الشارع: لا يوجد\nاستخدامات العقار: لا يوجد\nخدمات العقار: مياه, صرف صحي, تصريف الفيضانات , هاتف\n"
    "الضمانات ومدتها: -\nالالتزامات الآخرى على العقار: لا\nوصف موقع العقار: -\n\n صاحب الترخيص : فلان الفلاني\n"
    " تاريخ انتهاء رخصة الإعلان : 2026-12-31\n-----\n\nوصف موقع العقار حسب الصك\nالمدينة: الرياض\nالحي: الجنادرية\n"
    "عمولة نقل الملكية: لا يوجد\nموقع العقار على الخريطة: \nhttps://maps.google.com/?q=24.849875757681,46.902830200675")
FLAT_EN_MONTHLY = (
    "للايجار شقق عزاب مؤثثة في حي البيان\nمعلومات العقار حسب الرخصة\nغرض الإعلان: Rent\nسعر الوحدة: 2800\n"
    "نوع العقار: Apartment\nعمر العقار: Seven Year\nمساحة العقار: 1912.43\nواجهة العقار: Northern\nعدد الغرف: 1\n"
    "خدمات العقار: Waters, Electricity\nوصف موقع العقار: Riyadh Region, Riyadh, Al Bayan\n\n"
    " تاريخ انتهاء رخصة الإعلان : 2026-12-26\n-----\nوصف موقع العقار حسب الصك\nالمدينة: الرياض\nالحي: البيان\n")
NO_DEED = (
    "معلومات العقار حسب الرخصة\nغرض الإعلان: بيع\nسعر الوحدة: 2000000\nنوع العقار: عمارة\n"
    "عمر العقار: اكثر من عشر سنوات\nمساحة العقار: 400\nواجهة العقار: جنوبية - شرقية\nعرض الشارع: 40\n"
    "خدمات العقار: كهرباء, مياه, صرف صحي, هاتف, ألياف ضوئية\nالالتزامات الآخرى على العقار: مرهونه لصالح صندوق التنميه\n"
    "وصف موقع العقار: منطقة المدينة المنورة, المدينة المنورة, الخالدية\n\n تاريخ انتهاء رخصة الإعلان : 2027-01-31\n")
PAGE = '<article>… رقم العارض 1200000000 رقم الترخيص 7201131815</article>'


def ld(name, desc, images=("https://img4cdn.haraj.com.sa/a.jpg",), city="جيزان"):
    return {"@type": "RealEstateListing", "name": name, "description": desc, "image": list(images),
            "url": "https://haraj.com.sa/11190690713/x/", "datePosted": "2026-10-16T18:00:05.000Z",
            "address": {"addressLocality": city}, "offers": {"seller": {"@type": "Person", "name": "بائع مجهول"}}}


@pytest.fixture(autouse=True)
def _catalog(monkeypatch):
    def resolve(city_ar, district_ar=None, region_hint=None):
        cid = CITY_IDS.get(city_ar)
        return {"city_id": cid, "region_id": 1 if cid else None}
    monkeypatch.setattr(R, "resolve", resolve)
    monkeypatch.setattr(R, "catalog_district", lambda cid, d: d if (cid, d) in CATALOG else None)


def mapped(name, desc, page=PAGE, **kw):
    d = ld(name, desc, **kw)
    v, why = classify(name, P.strip_person_lines(desc))
    return R.map_post("11190690713", d, page, v, why, today=TODAY)


def test_licensed_land_with_english_enums_reaches_every_column():
    row, cat, skip, facts = mapped("أرض سكنية للبيع في المحمدية حى الصفا", LAND_EN)
    assert skip == "" and cat == "residential"
    assert (row["transaction_type"], row["property_type"]) == ("Buy", "Residential Land")   # title «أرض سكنية»
    assert row["price_total"] == 400000 and row["price_per_meter"] is None                    # its own text: a total
    assert (row["direction"], row["street_width_m"], row["area_m2"]) == ("جنوب", 15, 474)
    assert row["plan_parcel"] == "465 / 45" and row["electricity"] is True and row.get("water_supply") is None
    assert (row["license_number"], row["license_expiry"]) == ("7201131815", "2027-08-31")
    assert row["property_age"] is None                                                       # «لا يوجد» = silence
    # the DEED district wins; the seller's «المحمدية 3» is kept, never used
    assert row["district_ar"] == "الروابي" and row["additional_info"]["post_text_district_ar"] == "المحمدية 3"
    assert row["additional_info"]["latitude"] == 16.946853221896


def test_no_person_or_phone_is_ever_stored():
    row, *_ = mapped("أرض سكنية للبيع", LAND_EN)
    blob = json.dumps(row, ensure_ascii=False)
    for pii in ("فلان", "0500000000", "0500000001", "1200000000", "بائع مجهول", "صاحب الترخيص", "الموظف المسؤول"):
        assert pii not in blob, pii


def test_arabic_flat_rent_rooms_baths_services():
    row, cat, skip, _ = mapped("للإيجار شقه حي الجنادرية", FLAT_AR, city="الرياض")
    assert skip == "" and cat == "residential" and row["transaction_type"] == "Rent"
    assert row["price_annual"] == 40000 and row["rent_period"] is None   # 40,000 with no period word: unstated
    assert (row["bedrooms"], row["bathrooms"], row["property_age"], row["direction"]) == (3, 2, 0, "شرق")
    assert row["water_supply"] is True and row["sanitation"] is True and row.get("electricity") is None
    assert row["kitchen"] is True and row["elevator"] is True
    assert row["additional_info"]["rooms_count"] == "4"           # «عدد الغرف» is never bedrooms
    assert row["street_width_m"] is None


def test_english_monthly_rent_and_age_words():
    row, *_ = mapped("للايجار شقق عزاب مؤثثة في حي البيان", FLAT_EN_MONTHLY, city="الرياض")
    assert (row["rent_period"], row["price_annual"]) == ("monthly", 2800 * 12)
    assert (row["property_age"], row["direction"], row["furnished"]) == (7, "شمال", True)
    assert row["water_supply"] is True and row["electricity"] is True


def test_licence_location_arabic_fallback_and_corner_facade():
    row, cat, skip, _ = mapped("عمارة على شارع تجاري في حي الخالدية للبيع", NO_DEED, city="المدينة")
    assert skip == "" and row["city_id"] == 14 and row["district_ar"] == "الخالدية"
    assert row["direction"] is None and row["additional_info"]["facade_printed"] == "جنوبية - شرقية"
    assert row["property_age"] is None                                  # «اكثر من عشر سنوات» is an open bound
    assert row["optical_fibers"] is True
    assert row["additional_info"]["other_obligations"] == "مرهونه لصالح صندوق التنميه"
    assert row["license_number"] == "7201131815"


def test_unresolved_district_is_null_with_raw_kept():
    desc = FLAT_AR.replace("الحي: الجنادرية", "الحي: حي غير معروف")
    row, _, skip, facts = mapped("للإيجار شقه", desc, city="الرياض")
    assert skip == "" and row["district_ar"] is None and row["neighborhood"] is None
    assert row["additional_info"]["district_raw_ar"] == "حي غير معروف" and facts["district_resolved"] is False


def test_unlicensed_offer_is_stored_from_its_own_words_owner_2026_10_17():
    # Owner 2026-10-17 reversed «licensed only»: an offer without the block is a listing, licence NULL.
    row, _, skip, _ = mapped("شقة للايجار حي الحمدانية جدة", "شقة 3 غرف وصالة الايجار 25 الف سنوي", city="جده")
    assert skip == "" and row["license_number"] is None and row["license_expiry"] is None
    assert (row["transaction_type"], row["property_type"], row["rent_period"], row["price_annual"]) == (
        "Rent", "Apartment", "annual", 25000)


def test_request_and_non_property_are_never_stored():
    row, _, skip, _ = mapped("مطلوب شقة للايجار في الرياض", FLAT_AR, city="الرياض")
    assert row is None and skip == "not_offer_request"
    row, _, skip, _ = mapped("نقل عفش داخل الرياض", FLAT_AR, city="الرياض")
    assert row is None and skip == "not_offer_other"


def test_expired_licence_is_never_stored():
    desc = FLAT_AR.replace("2026-12-31", "2026-10-15")
    row, _, skip, _ = mapped("للإيجار شقه حي الجنادرية", desc, city="الرياض")
    assert row is None and skip == "licence_expired"


def test_licence_without_readable_number_stores_null():
    row, *_ = mapped("للإيجار شقه حي الجنادرية", FLAT_AR, page="<article>no number</article>", city="الرياض")
    assert row["license_number"] is None and row["rega_location_verified"] is False


def test_every_photo_in_order():
    imgs = [f"https://mimg6cdn.haraj.com.sa/userfiles30/2026-10-16/{i}.jpg" for i in range(6)]
    row, *_ = mapped("للإيجار شقه", FLAT_AR, images=imgs, city="الرياض")
    assert row["photo_urls"] == imgs and row["additional_info"]["photo_count"] == 6


def test_land_price_basis_ladder():
    assert R.land_price_basis(400000, 473.7, "السعر المطلوب: 400,000 ريال") == "total"
    assert R.land_price_basis(1200, 600, "سعر المتر 1200 ريال") == "per_meter"
    assert R.land_price_basis(7900, 1902.5, "ارض للبيع") == "per_meter"
    assert R.land_price_basis(50000, 600, "ارض للبيع") is None          # neither: never guessed


def test_page_licence_number_and_data_key():
    assert P.licence_number('رقم العارض 1200001771 رقم الترخيص 7201131815</article>') == "7201131815"
    assert P.licence_number('\\"re_REGA_Authorization_number\\",\\"7201176657\\"') == "7201176657"
    assert P.licence_number("<html></html>") is None


@pytest.mark.parametrize("status,body,want", [
    (404, "", "gone"),
    (200, "<p>العرض محذوف او قديم.</p>", "gone"),
    (200, '<script type="application/ld+json">' + json.dumps(ld("x", "شقة للايجار"), ensure_ascii=False)
     + "</script>", "live"),                                      # no licence block: still a live offer (2026-10-17)
    (200, '<script type="application/ld+json">' + json.dumps(ld("x", FLAT_AR.replace("2026-12-31", "2025-01-01")),
     ensure_ascii=False) + "</script>", "gone"),                  # its licence expired
    (200, '<script type="application/ld+json">' + json.dumps(ld("x", FLAT_AR), ensure_ascii=False) + "</script>", "live"),
    (503, "", None),
    (200, "<html>challenge</html>", None),
])
def test_own_page_removal_signal(status, body, want):
    assert R._signal(status, body, False) == want


def test_rega_arabic_studio_enum_with_tashkeel():
    assert R.type_of("شقَّة صغيرة (استوديو)", None, "استديوهات للإيجار") == "Studio"
    assert R.type_of("Apartment", None, "") == "Apartment" and R.type_of("Land", "سكني", "") == "Residential Land"
    assert R.type_of("أرض", None, "ارض للبيع") == "أرض"                     # no usage stated: no guess
    assert R.type_of("عمارة", "تجاري", "") == "Commercial Building"


def test_first_crawl_enums_fibreoptics_and_warehouses():
    assert P.services_of("Electricity, Waters, Sanitation, FixedPhone, FibreOptics, FloodDrainage") == {
        "electricity": True, "water_supply": True, "sanitation": True, "optical_fibers": True}
    assert R.type_of("Warehouses", None, "") == "Warehouse"
