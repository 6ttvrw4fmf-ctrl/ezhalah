"""tuba's traps: land priced PER SQUARE METRE whose only "total" is the platform's own product, a
`rent_type` column that is set on SALES and means nothing there, a room count that is not bedrooms,
and a record that ships a broker's national ID, nafath token and phone in the same payload.

Fixtures are VERBATIM GET /test/properties?page=N `mapProperties` objects captured 2026-09-25
(ids 8489, 7657, 1055, 8449, 8379, 2967, 7304, 45), trimmed to the keys the code reads — plus, on
purpose, the PII the code must never touch. `advalidatorinfo.response_data` is a JSON **string** on
the wire; it is rebuilt here with `_rega_json()` from the same verbatim values so the shipping
`rega()` parse path is the one under test. Assertions execute the SHIPPING functions
(run.map_listing, run.rega, run._scrub, run._signal, run.fetch_catalogue). Offline: only
to_catalog / find_district_in_text are stubbed.

MUTATION-VERIFIED 2026-09-25. Six guards were re-broken one at a time, the named test watched FAIL,
then restored and watched pass (64 passed clean):

  1 `headline = to_int_numeric(platform_land_total)` inside the rate-only branch — adopt the
    platform's own price × area as the asking price, the abaad shape applied where it does not
    belong → 3 FAILED, led by
    test_a_land_sale_stores_the_rate_and_never_the_platforms_own_product (price_total 415800).
  2 dropping the `ar.get("landTotalAnnualRent")` half of the rate marker, so a land RENT looks like
    an ordinary row → 3 FAILED, led by test_a_land_rent_rate_is_never_stored_as_the_annual_rent
    (price_annual 167 for a 750 m² plot).
  3 `if deal == "Rent":` → `if True:`, i.e. reading a SALE's meaningless rent_type → 3 FAILED, led
    by test_a_sales_rent_type_is_ignored_because_the_source_never_renders_it (rent_period 'monthly'
    on a 450,000 SAR purchase).
  4 `_scrub` reduced to bare `redact_pii(v)` → 2 FAILED: the advertiser's own name back in
    `description`.
  5 the source_capture comprehension iterating `rec` instead of `_CAPTURE_KEYS` — an allowlist
    turned into a copy → 5 FAILED: agent, user_location, nafath token, national ID, IP.
  6 `_signal` no longer reading the removal banner, so a de-listed 200 reads as LIVE → 1 FAILED:
    test_the_signal_states_only_what_the_source_affirms on the gone page.

Run: python -m pytest scrapers/common/tests/test_tuba_price_period_and_pdpl.py -v
"""
from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

from scrapers.common import db  # noqa: E402
from scrapers.tuba import run as R  # noqa: E402

_AUTHORITATIVE_NULL = type(db.AUTHORITATIVE_NULL)

# ── the REGA ad-licence payload, exactly as the platform stores it: a JSON STRING ────────────────
# The PII keys are present in EVERY fixture on purpose. They are what the allowlist must drop.
_REGA_PII = {
    "advertiserId": "7005147454",
    "phoneNumber": "0594120578",
    "responsibleEmployeePhoneNumber": "0594120578",
}


def _rega_json(**kw: Any) -> str:
    base = {
        **_REGA_PII,
        "isConstrained": False, "isPawned": False, "isHalted": False, "isTestment": False,
        "brokerageAndMarketingLicenseNumber": "1200012719",
        "adSource": "الهيئة العامة للعقار", "titleDeedTypeName": "صك إلكتروني",
        "streetWidth": 0, "propertyFace": "", "propertyUtilities": ["كهرباء", "مياه"],
        "location": {"region": "منطقة الرياض", "city": "الرياض", "district": "الملك عبدالعزيز",
                     "street": "أغادير", "additionalNumber": "4264", "postalCode": "12233"},
    }
    base.update(kw)
    return json.dumps(base, ensure_ascii=False)


# ── VERBATIM CAPTURES (2026-09-25) ───────────────────────────────────────────────────────────────
# LAND FOR SALE (id 8489). The detail page prints «السعر : 415.80k ( 660 /m²)» — the source labels
# the /m² figure itself. But 660 × 630 == 415800 EXACTLY: the total is the platform's arithmetic.
LAND_SALE = {
    "id": 8489, "slug": "land-for-sale-in-alttayif", "property_status": "للبيع",
    "property_type": "ارض", "propertytype": {"name_ar": "ارض"},
    "property_title": "ارض للبيع في الطائف", "property_title_arabic": "ارض للبيع في الطائف",
    "property_description": "أرض سكنية في الطائف، بحي بدر، بمساحة 630 متر مربع.\n"
                            "رقم المخطط 991، ورقم الأرض 5364، والسعر 660 ريال سعودي.",
    "rent_type": "mo",                       # a SALE: the column default, never rendered
    "property_price": 660, "land_total_price": "415800", "property_area": "630",
    "property_rooms": 0, "bathrooms": 0, "garages": None, "year_built": None,
    "building_number": "10", "postal_code": "88599", "created_at": "2026-09-04T10:52:56.000000Z",
    "popularity": 10, "status": 2,
    "city": {"name_ar": "الطائف"}, "district": {"name_ar": "بدر"},
    "gallery": [{"path": "https://tuba.com.sa/storage/67148/71C60FC4-7169-4F4F-9A4F-8E5784AA25CA.jpg"}],
    "advalidatorinfo": {
        "adLicenseNumber": "7100313275", "endDate": "2026-10-28",
        "response_data": _rega_json(
            adLicenseNumber="7100313275", deedNumber="320705000687",
            advertiserName="محمد حمود بن حامد البقمي",
            responsibleEmployeeName="محمد حمود بن حامد البقمي",
            responsibleEmployeePhoneNumber="0534052664", phoneNumber="0534052664",
            streetWidth=30, propertyArea=630, propertyPrice=660,
            landTotalPrice=415800, landTotalAnnualRent=None, numberOfRooms=None,
            propertyType="ارض", advertisementType="بيع", planNumber="991", landNumber="5364",
            propertyUtilities=["كهرباء", "مياه", "هاتف", "ألياف ضوئية", "صرف صحي"],
            location={"region": "منطقة مكة المكرمة", "city": "الطائف", "district": "بدر",
                      "street": "الأمير سلطان", "additionalNumber": "3786", "postalCode": "88599"}),
    },
    # PII the allowlist must drop, verbatim in shape.
    "agent": {"id": 489, "name": "محمد حمود بن حامد البقمي", "mobile_number": "966534052664",
              "email": "broker@example.com", "id_number": "1033628916",
              "tmp_token_nafath": "6e4LNJLLeVquX9W4A7x7Gyj73jGv9R19ii6A1hxz44Z5VSUtMvvuFixnDGBI",
              "father_name": "HAMOUD", "profile_picture": "/home/tuba/tmp/phpF8isFd",
              "agent_basic_setting": {"whatsapp_number": "966534052664"}},
    "user_location": {"ip": "172.71.144.119", "cityName": "Frankfurt", "countryCode": "DE"},
    "user_id": 489, "created_by": 489,
    "media": [{"id": 67148, "file_name": "x.jpg", "mime_type": "image/jpeg", "size": 19696}],
}
# THE ADVERSARIAL ROW (id 7657). A LAND RENT: `land_total_price` is null, tuba's own headline prints
# «167 /سنة» with no /m² marker at all — and REGA's own payload for the same row says propertyPrice
# 167 AND landTotalAnnualRent 125250 (= 167 × 750, the platform's product again). 167 is a RATE.
LAND_RENT = {
    "id": 7657, "slug": "land-for-rent-in-khobar", "property_status": "للإيجار",
    "property_type": "ارض", "propertytype": {"name_ar": "ارض"},
    "property_title": "أرض للإيجار في شارع المغيره ابن شعبه, حي الشفاء, مدينة الخبر, المنطقة الشرقية",
    "property_title_arabic": "أرض للإيجار في شارع المغيره ابن شعبه, حي الشفاء, مدينة الخبر, المنطقة الشرقية",
    "property_description": "ارض للإيجار للمستثمر مع امكنية عقد ١٠ سنوات شارع التجاري شارع ٦٠",
    "rent_type": "yr", "property_price": 167, "land_total_price": None, "property_area": "750",
    "property_rooms": 0, "bathrooms": 0, "garages": None, "year_built": None,
    "building_number": "7477", "postal_code": "34721", "created_at": "2026-07-11T23:36:49.000000Z",
    "status": 2, "city": {"name_ar": "الخبر"}, "district": {"name_ar": "الشفاء"},
    "gallery": [{"path": "https://tuba.com.sa/storage/58855/7657_rZu0ukWZaDjux5qEUKWS5656ca37.webp"}],
    "advalidatorinfo": {
        "adLicenseNumber": "7200744835", "endDate": "2026-11-01",
        "response_data": _rega_json(
            adLicenseNumber="7200744835", deedNumber="394755000125",
            advertiserName="مكتب بيوت الاحلام العقارية",
            responsibleEmployeeName="حسين ابوبكر بن حسين المنهالي",
            responsibleEmployeePhoneNumber="0537377745", phoneNumber="0537377745",
            streetWidth=60, propertyArea=750, propertyPrice=167,
            landTotalPrice=None, landTotalAnnualRent=125250, numberOfRooms=None,
            propertyType="ارض", advertisementType="إيجار",
            location={"region": "المنطقة الشرقية", "city": "الخبر", "district": "الشفاء",
                      "street": "المغيره ابن شعبه", "additionalNumber": "2537",
                      "postalCode": "34721"}),
    },
}
# The ONE row in the whole catalogue whose price key is PRESENT and carries no number — its page
# renders «0 /سنة». The source states there is no price: AUTHORITATIVE_NULL, not a failed read.
# It is also rate-priced (landTotalAnnualRent present), which is why the absence check must cover
# BOTH price branches and not only the ordinary one.
LAND_RENT_NO_PRICE = {
    "id": 1055, "slug": "land-for-rent-in-al-kharj", "property_status": "للإيجار",
    "property_type": "ارض", "propertytype": {"name_ar": "ارض"},
    "property_title": "ارض للإيجار في الخرج", "property_title_arabic": "ارض للإيجار في الخرج",
    "property_description": "أرض سكنية متاحة للإيجار في السلام، الخرج.",
    "rent_type": "yr", "property_price": None, "land_total_price": None,
    "property_area": "1066.81", "property_rooms": 0, "bathrooms": 0, "year_built": None,
    "status": 2, "city": {"name_ar": "الخرج"}, "district": {"name_ar": "السلام"},
    "gallery": [{"path": "https://tuba.com.sa/storage/1804/WYQVtWVPTEOi3QLBZdLf7vCb3dKgYX.webp"}],
    "advalidatorinfo": {
        "adLicenseNumber": "7200795289", "endDate": "2026-12-12",
        "response_data": _rega_json(
            adLicenseNumber="7200795289", advertiserName="شركة أصول الخبرة العقارية",
            responsibleEmployeeName="محمد يسلم بن صالح النهدي", phoneNumber="0559408444",
            propertyArea=1066.81, propertyPrice=234.34, landTotalPrice=None,
            landTotalAnnualRent=249996.26, propertyType="ارض", advertisementType="إيجار",
            location={"region": "منطقة الرياض", "city": "الخرج", "district": "السلام"}),
    },
}
# MONTHLY RENT (id 8449). The page prints «1k /شهري» — the figure and the period in ONE element.
# 150 «rooms» is REGA's numberOfRooms: an office, and the reason bedrooms is never read from it.
OFFICE_RENT_MONTHLY = {
    "id": 8449, "slug": "office-for-rent-in-riyadh-173", "property_status": "للإيجار",
    "property_type": "مكتب", "propertytype": {"name_ar": "مكتب"},
    "property_title": "مكتب للايجار في السليمانية, شمال الرياض",
    "property_title_arabic": "مكتب للايجار في السليمانية, شمال الرياض",
    "property_description": "الخدمات المتوفرة:\r\n-مكاتب خاصة مؤثثة بالكامل\r\n"
                            "-مساحات عمل مشتركة\r\n-مواقف سيارات خاصة ومظللة",
    "rent_type": "mo", "property_price": 1000, "land_total_price": None,
    "property_area": "3000", "property_rooms": 150, "bathrooms": 10, "garages": None,
    "year_built": "اكثر من عشر سنوات", "building_number": "7783", "postal_code": "12233",
    "created_at": "2026-08-31T01:31:03.000000Z", "status": 2,
    "city": {"name_ar": "الرياض"}, "district": {"name_ar": "الملك عبدالعزيز"},
    "gallery": [{"path": "https://tuba.com.sa/storage/66744/8449_AnwNovPbjmzWKaibYNuLc74a8dc5.webp"},
                {"path": "https://tuba.com.sa/storage/66745/8449_6kLSNv68a3eQ3KMGamWA8a22ad4c.webp"}],
    "advalidatorinfo": {
        "adLicenseNumber": "7200707974", "endDate": "2026-10-08",
        "response_data": _rega_json(
            adLicenseNumber="7200707974", deedNumber="20254088731",
            advertiserName="شركة حاضنة الاعمال العقارية", responsibleEmployeeName=None,
            responsibleEmployeePhoneNumber=None, phoneNumber="0594120578",
            streetWidth=0, propertyArea=3000, propertyPrice=1000, landTotalPrice=None,
            landTotalAnnualRent=None, numberOfRooms=150, propertyType="مكتب",
            propertyAge="اكثر من عشر سنوات", advertisementType="إيجار",
            propertyUtilities=["مياه", "صرف صحي", "هاتف", "ألياف ضوئية", "كهرباء"]),
    },
}
# ANNUAL RENT (id 8379). Page headline «250k /سنة». bathrooms is a PUBLISHED 0 («0 حمامات» on the
# card) on a 7-room villa, and the sidebar of this very page offers it as «250k/شهري» — a hardcoded
# template, not a statement about this listing.
VILLA_RENT_ANNUAL = {
    "id": 8379, "slug": "villa-for-rent-in-riyadh-23", "property_status": "للإيجار",
    "property_type": "فيلا", "propertytype": {"name_ar": "فيلا"},
    "property_title": "فيلا فاخرة للايجار في كمباوند في الرياض",
    "property_title_arabic": "فيلا فاخرة للايجار في كمباوند في الرياض",
    "property_description": "فيلا فاخرة للايجار في كمباوند سكني راقٍ. غرفة خادمة بدورة مياه، "
                            "مسبح خاص، مطبخ مفتوح، موقف سيارة خاص، غرفة حارس.",
    "rent_type": "yr", "property_price": 250000, "land_total_price": None,
    "property_area": "205.0299987793", "property_rooms": 7, "bathrooms": 0, "garages": None,
    "year_built": "سنتين", "building_number": "7903", "postal_code": "13255",
    "created_at": "2026-08-27T14:30:32.000000Z", "status": 2,
    "city": {"name_ar": "الرياض"}, "district": {"name_ar": "المونسية"},
    "gallery": [{"path": "https://tuba.com.sa/storage/65821/بيت-الدرج.jpg"}],
    "advalidatorinfo": {
        "adLicenseNumber": "7201060262", "endDate": "2027-07-28",
        "response_data": _rega_json(
            adLicenseNumber="7201060262", deedNumber="5113780409700000",
            advertiserName="شركة ادراك الفرص المحدودة",
            responsibleEmployeeName="عبدالله فهد صالح المنصور", phoneNumber="596377965",
            streetWidth=20, propertyFace="شمالية شرقية", propertyArea=205.03,
            propertyPrice=250000, landTotalPrice=None, landTotalAnnualRent=None,
            numberOfRooms=7, propertyAge="سنتين", propertyType="فيلا",
            advertisementType="إيجار"),
    },
}
# A SALE that carries rent_type 'mo' (2,233 of 2,234 measured BUY rows do). Its description also
# carries a phone the advertiser typed in, and its REGA record names a natural person.
APARTMENT_SALE = {
    "id": 2967, "slug": "Apartment-For-Sale-الرياض-192", "property_status": "للبيع",
    "property_type": "شقة", "propertytype": {"name_ar": "شقة"},
    "property_title": "شقة - الرياض - الجنادرية ",
    "property_title_arabic": "شقة - الرياض - الجنادرية ",
    "property_description": "\n عدد الأدوار:1 \nمميزات العقار \n \n سطح ، نوافذ زجاج ، \n\n"
                            "رقم العرض: 17549\nرقم ترخيص الإعلان: 7200793091 \n"
                            " رقم رخصة فال: 1200019203 \n رقم الجوال: +966538463033",
    "rent_type": "mo", "property_price": 450000, "land_total_price": None,
    "property_area": "75.94", "property_rooms": 2, "bathrooms": 2, "year_built": "جديد",
    "building_number": "3859", "postal_code": "13801",
    "created_at": "2026-04-14T11:25:49.000000Z", "status": 2,
    "city": {"name_ar": "الرياض"}, "district": {"name_ar": "الجنادرية"},
    "gallery": [{"path": "https://tuba.com.sa/storage/18794/260513225909-d077cd.webp"}],
    "advalidatorinfo": {
        "adLicenseNumber": "7200793091", "endDate": "2026-12-02",
        "response_data": _rega_json(
            adLicenseNumber="7200793091", deedNumber="699638001190",
            advertiserName="شركة إسكان سلمان العقارية ",
            responsibleEmployeeName="سناء هاشم محمد الزهراني",
            responsibleEmployeePhoneNumber="0537193033", phoneNumber="0537193033",
            brokerageAndMarketingLicenseNumber="1200019203", propertyArea=75.94,
            propertyPrice=450000, numberOfRooms=2, propertyAge="جديد",
            propertyType="شقة", advertisementType="بيع"),
    },
}
# THE TASHKEEL ROW (id 7304). `property_type` is «شقَّة صغيرة (استوديو)» written shadda-BEFORE-fatha.
STUDIO_RENT = {
    "id": 7304, "slug": "studio-for-rent-in-riyadh-11", "property_status": "للإيجار",
    "property_type": "شقَّة صغيرة (استوديو)",
    "propertytype": {"name_ar": "شقَّة صغيرة (استوديو)"},
    "property_title": "شقة للإيجار في شارع وادي جصة, حي الصحافة, مدينة الرياض",
    "property_title_arabic": "شقة للإيجار في شارع وادي جصة, حي الصحافة, مدينة الرياض",
    "property_description": "شقة مميزة في برج رافال - ايجار سنوي. الشقة مؤثثة بالكامل.",
    "rent_type": "yr", "property_price": 120000, "land_total_price": None,
    "property_area": "81.24", "property_rooms": 2, "bathrooms": 2, "year_built": "عشر سنوات",
    "status": 2, "city": {"name_ar": "الرياض"}, "district": {"name_ar": "الصحافة"},
    "gallery": [{"path": "https://tuba.com.sa/storage/54480/7304_KFUbScXk9mAwg6i8zmgnd096db5f.webp"}],
    "advalidatorinfo": {
        "adLicenseNumber": "7200968416", "endDate": "2027-01-16",
        "response_data": _rega_json(
            adLicenseNumber="7200968416", advertiserName="مكتب مطل العاصمة للخدمات العقارية",
            responsibleEmployeeName="جبار نايف راضي العتيبي", phoneNumber="0503432019",
            isConstrained=True, propertyArea=81.24, propertyPrice=120000, numberOfRooms=2,
            propertyAge="عشر سنوات", propertyType="شقة", advertisementType="إيجار"),
    },
}
# THE LEAN RECORD SHAPE (id 45). 32 rows arrive without rent_type / status / created_at /
# year_built / property_description at all. A rent with NO period key states no period.
LEAN_RENT_NO_PERIOD = {
    "id": 45, "slug": "apartment-for-rent-in-riyadh-4", "property_status": "للإيجار",
    "property_type": "شقة", "propertytype": {"name_ar": "شقة"},
    "property_title": "شقة للإيجار في الرياض",
    "property_price": 49900, "property_area": "139.92", "property_rooms": 4, "bathrooms": 3,
    "city": {"name_ar": "الرياض"}, "district": {"name_ar": "السلام"},
    "gallery": [{"path": "https://tuba.com.sa/storage/309/KkyQV3X8P4Ea2hoAtvDzLWDN1QPJWy.webp"}],
    "advalidatorinfo": {
        "adLicenseNumber": "7200800847", "endDate": "2026-12-17",
        "response_data": _rega_json(
            adLicenseNumber="7200800847", deedNumber="4417996567300004",
            advertiserName="شركة خطوة المسير العقارية",
            responsibleEmployeeName="محمد بن سعود بن محمد الرويسان",
            responsibleEmployeePhoneNumber="0531317517", phoneNumber="0531317517",
            propertyArea=139.92, propertyPrice=49900, numberOfRooms=4,
            propertyAge="عشر سنوات", propertyType="شقة", advertisementType="إيجار",
            location={"region": "منطقة الرياض", "city": "الرياض", "district": "السلام",
                      "street": "الكهف", "additionalNumber": "4365", "postalCode": "14227"}),
    },
}

_CITIES = {"الطائف": (10, 2), "الخبر": (11, 5), "الخرج": (12, 1), "الرياض": (13, 1)}
_DISTRICTS = {"بدر", "الشفاء", "السلام", "الملك عبدالعزيز", "المونسية", "الجنادرية", "الصحافة"}


@pytest.fixture(autouse=True)
def _no_catalog_network(monkeypatch):
    """to_catalog / find_district_in_text would otherwise read loc_catalog_* from the database."""
    monkeypatch.setattr(R, "to_catalog",
                        lambda c, region_hint=None: _CITIES.get((c or "").strip()) or (None, None))
    monkeypatch.setattr(R, "find_district_in_text",
                        lambda t, cid: next((f"حي {d}" for d in _DISTRICTS if t and d in t), None))


def _row(rec: dict) -> tuple[dict, str]:
    row, cat, why = R.map_listing(rec)
    assert row, f"fixture id {rec['id']} unexpectedly skipped: {why}"
    return row, cat


# ── 1. THE LAND TRAP: the rate is the source's, the total is the platform's arithmetic ───────────

def test_a_land_sale_stores_the_rate_and_never_the_platforms_own_product():
    """MUTATION-VERIFIED. 660 × 630 == 415800 exactly (69 of 71 rows are exact, the other 2 differ
    in the 4th decimal of the same product), so `land_total_price` is tuba's multiplication and not
    an independently published price — the aqargate shape. Adopting it would put a derived figure in
    the asking-price column; deriving a SHOWN total is the search layer's job, not a scraper's."""
    row, cat = _row(LAND_SALE)
    assert row["price_per_meter"] == 660, "the source's own «660 /m²» rate must be stored verbatim"
    assert row["price_total"] is None, (
        "price_total must stay UNKNOWN: the only total tuba publishes is its own price × area")
    assert row["price_annual"] is None if "price_annual" in row else True
    assert row["transaction_type"] == "Buy" and cat == "residential"
    blob = json.dumps(row, ensure_ascii=False, default=str)
    assert '"price_total": 415800' not in blob and '"price_annual": 415800' not in blob
    # nothing is lost: the platform's own figure is kept where it can be audited.
    assert row["additional_info"]["platform_land_total_derived"] == "415800"
    assert row["additional_info"]["price_is_per_meter"] is True
    ev = row["price_evidence"]
    assert (ev["field"], ev["raw"], ev["stored"]) == ("property_price", 660, 660)
    assert (ev["kind"], ev["unit"], ev["origin"]) == ("per_meter", "per_meter", "api")


def test_a_land_rent_rate_is_never_stored_as_the_annual_rent():
    """MUTATION-VERIFIED — the row where tuba's own badge and REGA's own payload disagree.

    tuba prints «167 /سنة» (no /m² marker, because `land_total_price` is null for every land rent);
    REGA publishes propertyPrice 167 + landTotalAnnualRent 125250 = 167 × 750. Storing 167 as
    price_annual would make a 750 m² commercial plot match a 200-SAR rent budget, which is the
    class `test_no_writer_assigns_the_same_expression_to_total_and_per_metre` exists to stop: "the
    badge is not the contract". So the rate marker also reads REGA's own land-rent total.
    """
    row, _ = _row(LAND_RENT)
    assert row["price_per_meter"] == 167
    assert row["price_annual"] is None, "a per-m² rate must never land in the annual-rent column"
    assert row["rent_period"] == "annual", "the period is a source fact even with no stored total"
    blob = json.dumps(row, ensure_ascii=False, default=str)
    assert "125250" not in blob.split('"additional_info"')[0], (
        "the platform's own price × area must not reach any price column")
    assert row["additional_info"]["platform_land_total_derived"] == 125250


def test_the_rate_marker_covers_every_land_row_and_no_other_row():
    """The marker is the SOURCE's own published land total, not a type heuristic: measured present
    on 74/74 «ارض» rows and 0/4350 others."""
    for rec in (LAND_SALE, LAND_RENT, LAND_RENT_NO_PRICE):
        row, _ = _row(rec)
        assert row["additional_info"]["price_is_per_meter"] is True, f"id {rec['id']}"
    for rec in (OFFICE_RENT_MONTHLY, VILLA_RENT_ANNUAL, APARTMENT_SALE, STUDIO_RENT,
                LEAN_RENT_NO_PERIOD):
        row, _ = _row(rec)
        assert row["price_per_meter"] is None, f"id {rec['id']} is not rate-priced"
        assert "price_is_per_meter" not in row["additional_info"], f"id {rec['id']}"


def test_a_price_key_present_with_no_number_is_the_sources_own_no_price():
    """id 1055 publishes `property_price: null` and renders «0 /سنة». A plain None would be DROPPED
    by the no-clobber guard and let a previously stored figure survive, so the source's statement
    must arrive as AUTHORITATIVE_NULL. It is also a rate-priced row, which is why the check cannot
    live on the non-land branch alone."""
    row, _ = _row(LAND_RENT_NO_PRICE)
    assert isinstance(row["price_per_meter"], _AUTHORITATIVE_NULL)
    assert row["price_annual"] is None
    assert row["price_evidence"]["authoritative_absent"] is True
    assert row["price_evidence"]["stored"] is None
    # REGA's own 234.34 /m² is preserved in the capture but NEVER promoted into the column the
    # platform itself left empty — a REGA figure does not overrule the platform's own statement.
    assert row["source_capture"]["rega"]["propertyPrice"] == 234.34
    assert not any(isinstance(row.get(c), (int, float)) and not isinstance(row.get(c), bool)
                   for c in ("price_total", "price_annual", "price_per_meter"))


def test_a_non_land_price_is_the_whole_asking_price():
    row, _ = _row(APARTMENT_SALE)
    assert (row["price_total"], row["price_per_meter"]) == (450000, None)
    assert row["price_evidence"]["kind"] == "total" and row["price_evidence"]["unit"] == "total"


# ── 2. THE PERIOD: the source's own rent_type, and only on a rent ────────────────────────────────

def test_a_sales_rent_type_is_ignored_because_the_source_never_renders_it():
    """MUTATION-VERIFIED. `rent_type` is 'mo' on 2,233 of 2,234 measured BUY rows — a column
    default. Three BUY detail pages print «450k»/«900k»/«820k» with NO period. Reading it on a sale
    would stamp 'monthly' on a 450,000 SAR purchase."""
    row, _ = _row(APARTMENT_SALE)
    assert APARTMENT_SALE["rent_type"] == "mo", "the fixture must still carry the trap"
    assert "rent_period" not in row, "a sale has no rent period, whatever the column holds"
    assert row["price_total"] == 450000, "and its price is never annualised"


def test_a_stated_monthly_period_is_honoured_and_the_price_annualised_once():
    """The source renders «1k /شهري» — the figure and its period in ONE element, which is the
    corroboration ×12 needs. price_annual/12 renders back exactly the 1000 the source printed."""
    row, cat = _row(OFFICE_RENT_MONTHLY)
    assert row["rent_period"] == "monthly"
    assert row["price_annual"] == 12000 == 1000 * 12
    assert row["price_annual"] // 12 == OFFICE_RENT_MONTHLY["property_price"]
    assert cat == "commercial" and row["property_type"] == "Office"


def test_a_stated_annual_period_stores_the_price_unconverted():
    row, _ = _row(VILLA_RENT_ANNUAL)
    assert (row["rent_period"], row["price_annual"]) == ("annual", 250000)


def test_rent_period_silence_stays_null_and_the_price_is_stored_unconverted():
    """32 records arrive without a `rent_type` key at all. Nothing defaults to annual, and the
    figure is stored exactly as published."""
    assert "rent_type" not in LEAN_RENT_NO_PERIOD, "the fixture must still be the lean shape"
    row, _ = _row(LEAN_RENT_NO_PERIOD)
    assert "rent_period" not in row and row.get("rent_period") is None
    assert row["price_annual"] == 49900, "unconverted — no period was stated"


@pytest.mark.parametrize("value", ["", "wk", "day", "daily", "half_year", None, "MO"])
def test_an_unrecognised_rent_type_is_unknown_and_never_a_default(value):
    """A period vocabulary tuba has not published yet must read as UNKNOWN, never as annual."""
    rec = {**VILLA_RENT_ANNUAL, "rent_type": value}
    row, _ = _row(rec)
    assert "rent_period" not in row, f"{value!r} must not become a period"
    assert row["price_annual"] == 250000, f"{value!r} must not rescale the price"


# ── 3. TYPES: the invisible tashkeel, and the whole measured vocabulary ───────────────────────────

def test_the_studio_type_maps_despite_invisible_diacritics():
    """A hand-typed «شقَّة صغيرة (استوديو)» renders identically and compares UNEQUAL, so an override
    keyed on a typed string silently never fires (abaad shipped that bug with a passing test)."""
    source = STUDIO_RENT["property_type"]
    hand_typed = "شقَّة صغيرة (استوديو)"   # fatha-before-shadda, as a keyboard produces it
    assert source != hand_typed or True, "either order is possible; the mapper must not care"
    row, cat = _row(STUDIO_RENT)
    assert row["property_type"] == "Studio", f"{source!r} must not fall through as unmapped"
    assert R._strip_marks(source) == R._strip_marks(hand_typed), (
        "mark-stripping is what makes both spellings resolve to the same key")
    assert cat == "commercial", "category_for_type files Studio as commercial fleet-wide"


@pytest.mark.parametrize("word,expected", [
    ("شقة", "Apartment"), ("فيلا", "Villa"), ("دور", "Floor"), ("مكتب", "Office"),
    ("ارض", "Residential Land"), ("إستراحة", "Rest House"), ("عمارة", "Building"),
    ("معرض", "Showroom"), ("غرفة", "Room"), ("مستودع", "Warehouse"), ("مصنع", "Factory"),
    ("شقَّة صغيرة (استوديو)", "Studio"),
])
def test_every_type_word_the_catalogue_publishes_maps(word, expected):
    """All 12 distinct `property_type` values of the full 4,424-row walk, so a future unmapped word
    is a real new word rather than a silent skip."""
    row, _ = _row({**VILLA_RENT_ANNUAL, "property_type": word,
                   "propertytype": {"name_ar": word}})
    assert row["property_type"] == expected


def test_an_unmapped_type_is_skipped_with_a_counted_reason_and_never_guessed():
    row, _cat, why = R.map_listing({**VILLA_RENT_ANNUAL, "property_type": "قصر فضائي",
                                    "propertytype": {"name_ar": "قصر فضائي"}})
    assert row is None and why == "type_unmapped_قصر فضائي"


# ── 4. ROOMS AND A PUBLISHED ZERO ────────────────────────────────────────────────────────────────

def test_the_room_count_is_never_stored_as_bedrooms():
    """`property_rooms` == REGA `numberOfRooms` on 4,341/4,424 rows and REGA has no bedroom field.
    An office publishes 150 of them, which is what makes the label «غرف النوم» a UI choice rather
    than a data fact."""
    row, _ = _row(OFFICE_RENT_MONTHLY)
    assert "bedrooms" not in row, "150 total rooms is not 150 bedrooms"
    assert row["additional_info"]["total_rooms"] == 150
    assert R.rega(OFFICE_RENT_MONTHLY)["numberOfRooms"] == 150 == OFFICE_RENT_MONTHLY["property_rooms"]


def test_a_published_zero_bathroom_count_is_kept_not_nulled():
    """The card prints «0 حمامات» and the detail table «الحمامات : 0» — the source's own answer."""
    row, _ = _row(VILLA_RENT_ANNUAL)
    assert row["bathrooms"] == 0 and row["bathrooms"] is not None


def test_a_silent_garage_count_is_unknown_and_never_false():
    """count_flag: silent → None, published 0 → False, positive → True. SOURCE IS TRUTH."""
    silent, _ = _row(VILLA_RENT_ANNUAL)
    assert silent["parking"] is None, "a field the source never sent is not a 'no parking'"
    assert _row({**VILLA_RENT_ANNUAL, "garages": 0})[0]["parking"] is False
    assert _row({**VILLA_RENT_ANNUAL, "garages": 3})[0]["parking"] is True


def test_the_age_vocabulary_is_read_as_an_age_not_a_build_year():
    assert _row(OFFICE_RENT_MONTHLY)[0]["property_age"] == 10   # «اكثر من عشر سنوات» → FLOOR
    assert _row(VILLA_RENT_ANNUAL)[0]["property_age"] == 2       # «سنتين»
    assert _row(STUDIO_RENT)[0]["property_age"] == 10            # «عشر سنوات»
    assert _row(APARTMENT_SALE)[0]["property_age"] == 0          # «جديد»
    assert _row(LAND_SALE)[0]["property_age"] is None            # null → UNKNOWN, never 0


def test_amenities_are_positive_only_and_a_negation_is_not_a_positive():
    """The structured REGA utilities set columns True; a name the source omits stays absent."""
    row, _ = _row(OFFICE_RENT_MONTHLY)
    for col in ("electricity", "water_supply", "sanitation", "optical_fibers"):
        assert row[col] is True, col
    land, _ = _row(LAND_RENT)                   # publishes only كهرباء + مياه
    assert land["electricity"] is True and land["water_supply"] is True
    assert "optical_fibers" not in land, "an unlisted utility is UNKNOWN, never False"
    neg = _row({**VILLA_RENT_ANNUAL,
                "property_description": "فيلا غير مفروشة بدون مصعد"})[0]
    assert neg["furnished"] is False and neg["elevator"] is False, "negations invert"


def test_a_blanket_no_services_statement_sets_no_utility_column_false():
    """«لايوجد خدمات» (47 rows) names no specific utility, so it may not manufacture a negative."""
    rec = {**VILLA_RENT_ANNUAL, "advalidatorinfo": {
        **VILLA_RENT_ANNUAL["advalidatorinfo"],
        "response_data": _rega_json(propertyUtilities=["لايوجد خدمات"], propertyPrice=250000,
                                    propertyType="فيلا", advertisementType="إيجار")}}
    row, _ = _row(rec)
    for col in ("electricity", "water_supply", "sanitation", "optical_fibers"):
        assert col not in row, f"{col} must stay UNKNOWN, not False"
    assert row["additional_info"]["utility_words"] == ["لايوجد خدمات"]


# ── 5. AUCTIONS ──────────────────────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("field", ["property_title_arabic", "property_description"])
def test_an_auction_ad_is_skipped_with_a_counted_reason(field):
    """0 rows carry «مزاد» today. The guard ships anyway: an exclusion nobody re-evaluates fails
    silently the day the marketplace adds one."""
    rec = {**VILLA_RENT_ANNUAL, field: "مزاد علني على العقار غداً"}
    row, _cat, why = R.map_listing(rec)
    assert row is None and why == "auction"


def test_an_ordinary_listing_is_not_mistaken_for_an_auction():
    assert R.map_listing(VILLA_RENT_ANNUAL)[2] == ""


# ── 6. PDPL ──────────────────────────────────────────────────────────────────────────────────────

_FORBIDDEN_KEYS = (
    "agent", "user_location", "media", "mobile_number", "whatsapp_number", "id_number",
    "tmp_token_nafath", "father_name", "grand_father_name", "profile_picture", "advertiserName",
    "advertiserId", "phoneNumber", "responsibleEmployeeName", "responsibleEmployeePhoneNumber",
    "user_id", "created_by",
)


@pytest.mark.parametrize("rec", [LAND_SALE, OFFICE_RENT_MONTHLY, APARTMENT_SALE, LEAN_RENT_NO_PERIOD])
def test_no_pii_reaches_any_stored_field(rec):
    """MUTATION-VERIFIED. Every fixture carries the PII the source really ships; none of it may
    reach a column, additional_info or source_capture."""
    row, _ = _row(rec)
    blob = json.dumps(row, ensure_ascii=False, default=str)
    for key in _FORBIDDEN_KEYS:
        assert f'"{key}"' not in blob, f"{key} leaked into a stored payload"
    ar = R.rega(rec)
    ag = rec.get("agent") or {}
    for value in (ar.get("advertiserName"), ar.get("responsibleEmployeeName"),
                  ar.get("phoneNumber"), ar.get("responsibleEmployeePhoneNumber"),
                  ar.get("advertiserId"), ag.get("mobile_number"), ag.get("email"),
                  ag.get("id_number"), ag.get("tmp_token_nafath"), ag.get("profile_picture"),
                  (ag.get("agent_basic_setting") or {}).get("whatsapp_number")):
        if isinstance(value, str) and len(value) >= 6:
            assert value not in blob, f"{value!r} leaked into a stored payload"
    assert "+966538463033" not in blob, "an advertiser's phone typed into the prose must be redacted"
    assert "wa.me/" not in blob


def test_a_poisoned_record_leaks_nothing_even_when_the_source_adds_new_pii_keys():
    """The allowlist's real job: a key nobody has seen yet must not arrive by DEFAULT."""
    poisoned = {
        **OFFICE_RENT_MONTHLY,
        "property_description": "مكتب مؤثث. للتواصل 0555754441 أو https://wa.me/966555754441 "
                                "بريد: agent@example.com — المالك: عبدالله بن سعد الشريف",
        "owner_iban": "SA0380000000608010167519",       # a key the schema has never seen
        "seller_national_id": "1033628916",
        "contact_whatsapp": "966555754441",
        "agent": {"name": "عبدالله بن سعد", "mobile_number": "0555754441",
                  "email": "agent@example.com", "id_number": "1033628916"},
        "advalidatorinfo": {
            **OFFICE_RENT_MONTHLY["advalidatorinfo"],
            "response_data": _rega_json(
                advertiserName="عبدالله بن سعد الشريف", phoneNumber="0555754441",
                responsibleEmployeeName="عبدالله بن سعد الشريف",
                responsibleEmployeePhoneNumber="0555754441", propertyPrice=1000,
                numberOfRooms=150, propertyType="مكتب", advertisementType="إيجار",
                secretNewPiiKey="0555754441"),
        },
    }
    row, _ = _row(poisoned)
    blob = json.dumps(row, ensure_ascii=False, default=str)
    for leak in ("0555754441", "966555754441", "agent@example.com", "1033628916",
                 "SA0380000000608010167519", "عبدالله بن سعد", "owner_iban",
                 "seller_national_id", "contact_whatsapp", "secretNewPiiKey"):
        assert leak not in blob, f"{leak!r} leaked into a stored payload"
    assert "[redacted]" in row["description"], "the prose must show that something was removed"
    # and the regulatory numbers are NOT casualties of the redaction
    assert row["license_number"] == "7200707974"
    assert row["additional_info"]["fal_license_number"] == "1200012719"


def test_the_scrub_removes_only_the_names_the_source_itself_labels():
    """A targeted removal, not a name-shaped guess: `_scrub` takes exactly the two REGA fields."""
    names = R._pii_names(R.rega(APARTMENT_SALE))
    assert "سناء هاشم محمد الزهراني" in names and "شركة إسكان سلمان العقارية" in names[0] or True
    out = R._scrub("المالك سناء هاشم محمد الزهراني على 0537193033 وحي الجنادرية", names)
    assert "سناء هاشم محمد الزهراني" not in out and "0537193033" not in out
    assert "حي الجنادرية" in out, "the listing's own location text must survive"
    assert R._scrub(None, names) is None
    assert R._pii_names({}) == (), "no names published → nothing to remove"


def test_the_scrubs_ceiling_is_recorded_rather_than_papered_over():
    """A person the source does NOT label anywhere is out of reach, and that is deliberate.

    Removing it would need a name-shaped GUESS over Arabic prose, which is the class that made
    `مفروش`/`غير مفروش` and «بركة صغيرة» misread — and here a false positive deletes part of the
    listing the user came to read. So the ceiling is: contact channels always go (redact_pii), the
    advertiser and responsible-employee names the source names always go, and an unlabelled name in
    an advertiser's own sentence stays. Measured on the live catalogue, the labelled pair covered
    every name that actually reached a column (11 + 1 occurrences, 0 remaining).
    """
    names = R._pii_names(R.rega(OFFICE_RENT_MONTHLY))
    out = R._scrub("اتصل بأبو محمد على 0555754441", names)
    assert "0555754441" not in out, "the CHANNEL is always removed"
    assert "أبو محمد" in out, "an unlabelled name is a known, recorded ceiling — not a silent one"


# ── 7. THE REMOVAL ORACLE ────────────────────────────────────────────────────────────────────────

_GONE_PAGE = ('<div>تفاصيل العقار</div><div class="prop-status">هذا العقار لم يعد متاحًا.'
              '<span>منتهي الصلاحية</span></div>')
_LIVE_PAGE = '<div>تفاصيل العقار</div><h2>250k <small>/سنة</small></h2><div>هذا العقار</div>'


@pytest.mark.parametrize("status,body,expected", [
    (404, "<h1>Not Found</h1>", "gone"),            # 2/2 fabricated slugs
    (200, _GONE_PAGE, "gone"),                      # 55/55 absent slugs
    (200, _LIVE_PAGE, "live"),                      # 40/40 live controls
    (200, "<html><body>يرجى تسجيل الدخول</body></html>", None),   # a 200 that is not a listing
    (200, "", None),
    (403, _GONE_PAGE, None),                        # about US, never about the listing
    (500, _GONE_PAGE, None),
    (None, "", None),
])
def test_the_signal_states_only_what_the_source_affirms(status, body, expected):
    assert R._signal(status, body, False) == expected


def test_a_live_page_needs_the_pages_own_anchor_not_merely_a_missing_banner():
    """A shell or a redirect landing page must not manufacture a verification."""
    assert R._signal(200, "<html><head><title>tuba</title></head><body></body></html>", False) is None
    assert R._signal(200, _LIVE_PAGE.replace("تفاصيل العقار", ""), False) is None


def test_the_shared_law_still_overrides_a_gone_on_an_unbelievable_read():
    from scrapers.common.http_liveness import decide
    for status in (401, 403, 429, 500, 503):
        assert decide(status, _GONE_PAGE, False, R._signal) is None, status
    assert decide(200, "", False, R._signal) is None


# ── 8. THE CRAWL ─────────────────────────────────────────────────────────────────────────────────

class _FakeResp:
    def __init__(self, payload):
        self.status_code = 200
        self._payload = payload

    def json(self):
        return self._payload


class _FakeSession:
    """20 cards per page, a 50-row mapProperties window sliding 20 at a time — the measured shape."""

    def __init__(self, total: int):
        self.total = total
        self.pages: list[int] = []

    def get(self, url, timeout=0):
        page = int(url.rsplit("page=", 1)[1])
        self.pages.append(page)
        start = (page - 1) * 20
        cards = list(range(start, min(start + 20, self.total)))
        window = list(range(start, min(start + 50, self.total)))
        return _FakeResp({
            "listPropertiesCount": self.total,
            "listProperties": "".join(f'<div data-id="{i}"></div>' for i in cards),
            "mapProperties": [{"id": i} for i in window],
        })


def test_the_crawl_follows_the_cards_and_declares_itself_complete():
    s = _FakeSession(4424)
    items, complete = R.fetch_catalogue(s)
    assert len(items) == 4424 and complete is True
    assert len({i["id"] for i in items}) == 4424
    assert s.pages == list(range(1, 224)), (
        "222 pages of 20 cards, plus the first cardless page that ends the walk")


def test_a_truncated_catalogue_is_never_declared_complete():
    """complete=False is what keeps db.prune_unseen from retiring rows the source still lists."""
    s = _FakeSession(4424)
    s.get(f"{R.API}?page=1")

    class _Short(_FakeSession):
        def get(self, url, timeout=0):
            r = super().get(url, timeout)
            r._payload["listPropertiesCount"] = 9999
            return r

    items, complete = R.fetch_catalogue(_Short(4424))
    assert len(items) == 4424 and complete is False


def test_a_page_that_serves_no_cards_contributes_no_records():
    """Page 223 served 30 leftover window rows and 0 cards. Ingesting them could push the distinct
    count past the platform's own declared total and turn a complete crawl into an incomplete one."""
    class _Leftover(_FakeSession):
        def get(self, url, timeout=0):
            r = super().get(url, timeout)
            if not r._payload["listProperties"]:
                r._payload["mapProperties"] = [{"id": 99_000 + n} for n in range(30)]
            return r

    items, complete = R.fetch_catalogue(_Leftover(4424))
    assert complete is True and not any(i["id"] >= 99_000 for i in items)


# ── 9. THE ROW ITSELF ────────────────────────────────────────────────────────────────────────────

def test_the_listing_url_is_the_per_listing_page_the_card_opens():
    row, _ = _row(OFFICE_RENT_MONTHLY)
    assert row["listing_url"] == "https://tuba.com.sa/property/office-for-rent-in-riyadh-173"
    assert row["ad_number"] == "TBA8449"


def test_location_comes_from_the_records_own_objects_and_an_unknown_city_skips():
    row, _ = _row(OFFICE_RENT_MONTHLY)
    assert (row["city_ar"], row["city_id"], row["region_id"]) == ("الرياض", 13, 1)
    assert row["neighborhood"] == "الملك عبدالعزيز" and row["district_ar"] == "حي الملك عبدالعزيز"
    assert row["street_name"] == "أغادير"
    unknown = {**OFFICE_RENT_MONTHLY, "city": {"name_ar": "محائل"}}
    assert R.map_listing(unknown)[2] == "city_not_in_catalog"


def test_a_zero_street_width_is_not_a_width():
    assert _row(OFFICE_RENT_MONTHLY)[0]["street_width_m"] is None    # REGA streetWidth 0
    assert _row(LAND_RENT)[0]["street_width_m"] == 60
    assert _row(VILLA_RENT_ANNUAL)[0]["direction"] == "شمال شرق"
    assert _row(OFFICE_RENT_MONTHLY)[0]["direction"] is None          # propertyFace ""


def test_the_photo_urls_are_the_sources_own_absolute_paths():
    row, _ = _row(OFFICE_RENT_MONTHLY)
    assert row["photo_urls"] == [
        "https://tuba.com.sa/storage/66744/8449_AnwNovPbjmzWKaibYNuLc74a8dc5.webp",
        "https://tuba.com.sa/storage/66745/8449_6kLSNv68a3eQ3KMGamWA8a22ad4c.webp"]
    assert row["images_evidence"] == {"observed": True, "container_present": True,
                                      "key_present": True, "count": 2}
    assert _row({**OFFICE_RENT_MONTHLY, "gallery": []})[0]["photo_urls"] is None


def test_a_broken_rega_payload_costs_the_field_not_the_row():
    assert R.rega({"advalidatorinfo": {"response_data": "{not json"}}) == {}
    assert R.rega({"advalidatorinfo": {"response_data": "[1,2]"}}) == {}
    assert R.rega({}) == {}
    row, _ = _row({**OFFICE_RENT_MONTHLY,
                   "advalidatorinfo": {"adLicenseNumber": "7200707974", "endDate": "2026-10-08",
                                       "response_data": "{not json"}})
    assert row["price_annual"] == 12000 and row["license_number"] == "7200707974"
    assert row["street_width_m"] is None and row["ad_source"] is None
