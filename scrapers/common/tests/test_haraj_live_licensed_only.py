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
from scrapers.haraj import prose as X  # noqa: E402
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
    # title singular since 2026-10-17: a plural title («شقق عزاب») is a catalogue, never stored
    row, *_ = mapped("للايجار شقة عزاب مؤثثة في حي البيان", FLAT_EN_MONTHLY, city="الرياض")
    assert (row["rent_period"], row["price_annual"]) == ("monthly", 2800 * 12)
    assert (row["property_age"], row["direction"], row["furnished"]) == (7, "شمال", True)
    assert row["water_supply"] is True and row["electricity"] is True


def test_licence_location_arabic_fallback_and_corner_facade():
    row, cat, skip, _ = mapped("عمارة على شارع تجاري في حي الخالدية للبيع", NO_DEED, city="المدينة")
    assert skip == "" and row["city_id"] == 14 and row["district_ar"] == "الخالدية"
    assert row["direction"] is None and row["additional_info"]["facade_printed"] == "جنوبية - شرقية"
    assert row["property_age"] == 10    # «اكثر من عشر سنوات» = REGA's open «10+»; the AF clause reads it as ≥ 10 (2026-10-25)
    assert row["optical_fibers"] is True
    assert row["additional_info"]["other_obligations"] == "مرهونه لصالح صندوق التنميه"
    assert row["license_number"] == "7201131815"


def test_placeholder_district_is_null_and_an_unattested_word_is_kept():
    # «حي غير معروف» is a non-answer → NULL (silence is never a district named «unknown»).
    desc = FLAT_AR.replace("الحي: الجنادرية", "الحي: حي غير معروف")
    row, _, skip, facts = mapped("للإيجار شقه", desc, city="الرياض")
    assert skip == "" and row["district_ar"] is None and row["neighborhood"] is None
    assert "district_raw_ar" not in row["additional_info"] and facts["district_resolved"] is False
    # Owner 2026-10-18 (reverses catalogue-or-NULL): a REAL deed word the catalogue does not attest is KEPT
    # as the source wrote it, with its provenance; attestation is recorded, not required.
    row, _, skip, facts = mapped("للإيجار شقه", FLAT_AR.replace("الحي: الجنادرية", "الحي: المصيف"), city="الرياض")
    assert skip == "" and (row["district_ar"], row["neighborhood"]) == ("المصيف", "المصيف")
    assert row["additional_info"]["district_source"] == "deed" and facts["district_resolved"] is False
    assert "district_catalog_ar" not in row["additional_info"]


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
    # census 2026-10-17: a gone page can still carry its JSON-LD — the banner alone decides
    (200, "<p>العرض محذوف او قديم.</p>" + '<script type="application/ld+json">'
     + json.dumps(ld("x", FLAT_AR), ensure_ascii=False) + "</script>", "gone"),
    (200, '<script type="application/ld+json">' + json.dumps(ld("x", "شقة للايجار"), ensure_ascii=False)
     + "</script>", "live"),                                      # no licence block: still a live offer (2026-10-17)
    (200, '<script type="application/ld+json">' + json.dumps(ld("x", FLAT_AR.replace("2026-12-31", "2025-01-01")),
     ensure_ascii=False) + "</script>", "gone"),                  # its licence expired
    (200, '<script type="application/ld+json">' + json.dumps(ld("x", FLAT_AR), ensure_ascii=False) + "</script>", "live"),
    (503, "", None),
    (200, "<html>challenge</html>", None),
    # a stored post whose own page reads as a REQUEST was never an offer (HRJ11190645357, 2026-10-17)
    (200, '<script type="application/ld+json">' + json.dumps(ld("طلب شقه للايجار مستعجل لا ام وولدها", ""),
     ensure_ascii=False) + "</script>", "gone"),
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


# ── catch-up (owner 2026-10-17; every offer since 2026-10-25) ──────────────────────────────────────────────────────────
@pytest.mark.parametrize("title,keep", [
    ("ارض للبيع", True), ("شقة دورين للإيجار", True), ("دور علوي للايجار", True),
    ("للبيع فله خلف مستشفى السعودي الالماني خميس مشيط", True), ("محل للتقبيل", True),
    ("ارض في الجلة زراعي المساحة 10 متر", False),      # no deal word: the 1 of 12 the gate gives up
    ("مطلوب شقة", False), ("ابي ارض", False),
])
def test_catchup_title_gate(title, keep):
    assert bool(R._CATCHUP_NOUN.search(title) and R._CATCHUP_DEAL.search(title)) is keep


def _file(stamp):
    return f"https://sitemapfiles.haraj.com.sa/{stamp[:10]}/sitemap-{stamp}.txt"


def test_catchup_walks_older_files_newest_first_and_moves_the_cursor(monkeypatch):
    locs = [_file(f"2026-10-1{d}-0{h}") for d in (5, 6) for h in (1, 2, 3)]       # oldest first
    read = []
    monkeypatch.setattr(R, "ids_in", lambda u, pre, tight=False: (read.append((u, tight)) or [u[-6:-4]]))
    def fake_crawl(files, skip, limit=0, today=None, only=None, meta=None):
        assert only          # owner 2026-10-25: every offer, licensed or not — crawl() has no licence filter
        return [{"ad_number": "HRJ" + only[0]}], [], R.Counter(fetched=1), R.Counter(), meta
    monkeypatch.setattr(R, "crawl", fake_crawl)
    # first run: no cursor → everything older than the live window, newest first
    res, _, c, _, head = R.catchup(locs, locs[-2:], 3600, None)
    assert [u for u, _ in read] == locs[:-2][::-1] and all(t for _, t in read)
    assert head == {"catchup_all_before": "2026-10-15-01", "catchup_files_left": 0, "catchup_stored": 4}
    # next run resumes below the cursor; nothing left → nothing read
    read.clear()
    assert R.catchup(locs, locs[-2:], 3600, "2026-10-15-01")[4]["catchup_stored"] == 0 and not read


def test_catchup_budget_stops_and_keeps_the_cursor_at_the_last_finished_file(monkeypatch):
    locs = [_file(f"2026-10-16-0{h}") for h in range(1, 7)]
    monkeypatch.setattr(R, "ids_in", lambda u, pre, tight=False: ["1"])
    monkeypatch.setattr(R, "crawl", lambda *a, **k: ([], [], R.Counter(), R.Counter(), None))
    head = R.catchup(locs, locs[-1:], 0, None)[4]          # budget 0: the first file runs, then it stops
    assert head["catchup_all_before"] == "2026-10-16-05" and head["catchup_files_left"] == 4
    assert R._CURSOR.search(R._notes(R.Counter(fetched=3), R.Counter(), head)).group(1) == "2026-10-16-05"


# ── fleet_liveness controls from Haraj's own newest hour (2026-10-17) ─────────────────────────────
def test_liveness_controls_are_fresh_posts_that_read_live_and_fail_closed(monkeypatch):
    monkeypatch.setattr(R, "hour_files", lambda: ["old", "newest-complete", "filling"])
    seen = []
    monkeypatch.setattr(R, "ids_in", lambda u, pre, tight=False: (seen.append((u, tight)) or [str(i) for i in range(30)]))
    live = {"1", "3", "4", "7", "9", "12"}
    monkeypatch.setattr(R, "_verify_gone", lambda ad: ("live" if ad[3:] in live else "gone", ""))
    got = R.liveness_controls(5)
    assert seen == [("newest-complete", True)]                       # the newest COMPLETE hour, tight titles
    assert [r["ad_number"] for r in got] == ["HRJ1", "HRJ3", "HRJ4", "HRJ7", "HRJ9"]
    assert got[0]["listing_url"].endswith("/1/")
    # a block / redesign: nothing reads live → fewer than n → fleet_liveness quarantines
    monkeypatch.setattr(R, "_verify_gone", lambda ad: ("unknown", "challenge"))
    assert R.liveness_controls(5) == []


def test_liveness_controls_walk_back_past_a_quiet_hour(monkeypatch):
    """2026-10-18 07:48 UTC: the newest complete hour held 3 licensed posts, all live, and the run
    quarantined 3,600 ads on «controls 3/3 live». A thin hour walks back; a block still fails closed."""
    files = {"h1": ["10", "11", "12"], "h2": ["20", "21"], "h3": ["30", "31", "32"], "filling": ["99"]}
    monkeypatch.setattr(R, "hour_files", lambda: ["h1", "h2", "h3", "filling"])
    seen = []
    monkeypatch.setattr(R, "ids_in", lambda u, pre, tight=False: (seen.append(u) or files[u]))
    monkeypatch.setattr(R, "_verify_gone", lambda ad: ("live", ""))
    got = R.liveness_controls(5)
    assert seen == ["h3", "h2"]                                    # newest complete first, never "filling"
    assert [r["ad_number"] for r in got] == ["HRJ30", "HRJ31", "HRJ32", "HRJ20", "HRJ21"]
    # the read budget still binds across hours, and a block still yields fewer than n
    monkeypatch.setattr(R, "_verify_gone", lambda ad: ("unknown", "challenge"))
    seen.clear()
    assert R.liveness_controls(5, max_reads=4) == [] and seen == ["h3", "h2"]


def test_liveness_controls_budget_outlasts_a_run_of_honest_non_offers(monkeypatch):
    """2026-10-18 20:48 UTC: 20 reads found 3 live posts (the rest honest non-offers read «gone»), the gate
    needs 5, and 6,317 ads were quarantined. The default budget reaches the 5th live post at read 40."""
    monkeypatch.setattr(R, "hour_files", lambda: ["h1", "h2", "h3", "h4", "filling"])
    monkeypatch.setattr(R, "ids_in", lambda u, pre, tight=False: [f"{u[1]}{i:02d}" for i in range(20)])
    live = {"400", "405", "410", "300", "319"}            # 3 in the newest hour, 2 more only 20 reads later
    monkeypatch.setattr(R, "_verify_gone", lambda ad: ("live" if ad[3:] in live else "gone", ""))
    assert len(R.liveness_controls(5)) == 5
    assert len(R.liveness_controls(5, max_reads=20)) == 3    # the old budget: what quarantined the recheck


# ── several units in one licensed post = a catalogue (owner real-user check 2026-10-17) ─────────────
@pytest.mark.parametrize("title,cat", [
    ("شقق تمليك فاخرة للسكن والا ستثمار ابحر الشمالية 3و4و 5غرف", True),   # HRJ11190739649, 1,161 m²
    ("شقق استثمارية للبيع غرفتين ابحر الجنوبية", True),                    # HRJ11190629474, 2,484 m²
    ("فلل للبيع حي الرحمانيه", True), ("محلات تجارية للايجار", True),
    ("للبيع عمار 4 شقق", False), ("عماره 6 شقق للبيع", False),             # one building, its flats counted
    ("شقة سكنية الايجار 5 غرف في حي التيسير", False), ("شقة للبيع", False), ("دور علوي 3 غرف", False),
])
def test_licensed_catalogue_title(title, cat):
    assert R.is_catalogue_title(title) is cat


def test_licensed_catalogue_is_never_stored_and_reads_gone():
    name = "شقق تمليك فاخرة للسكن 3و4و 5غرف"
    row, _, skip, _ = R.map_post("1", ld(name, FLAT_AR), "", "offer", "x", TODAY)
    assert row is None and skip == "catalogue"
    assert R._signal(200, '<script type="application/ld+json">' + json.dumps(ld(name, FLAT_AR), ensure_ascii=False)
                     + "</script>", False) == "gone"


# ── several DIFFERENT units offered in the body = a catalogue (backlog 615, 2026-10-18) ──────────────
BODY_TWO_UNITS = ("للبيع شاليه عمره سنه ونصف موجر حاليا ايجار سنوي للبيع استراحة بالطائف حي الرميدة، مساحة خمسمية "
                  "وخمسين متر مسبح وحديقة وجلسات خارجية. للبيع استراحة مميزة في الطائف حي الرميدة.")   # HRJ11190705938
BODY_ONE_UNIT_TWICE = ("للبيع استراحة بالطائف حي الرميدة، مساحة خمسمية وخمسين متر مسبح وحديقة. للبيع استراحة "
                       "مميزة في الطائف حي الرميدة.")                                                 # HRJ11190717503


@pytest.mark.parametrize("body,cat", [
    (BODY_TWO_UNITS, True),
    ("للايجار شقة 3 غرف ... للايجار محل تجاري على الشارع", True),
    (BODY_ONE_UNIT_TWICE, False),
    (FLAT_AR, False),
    ("للبيع او الايجار شقة في حي النرجس", False),
    ("فيلا للبيع في حي الملقا، للبيع الفيلا مع الاثاث", False),
])
def test_body_offers_several_units(body, cat):
    assert X.body_offers_several_units(body) is cat


def test_body_catalogue_is_never_stored_and_reads_gone():
    row, _, skip, _ = R.map_post("1", ld("شاليه للبيع- بدخل ثابت", BODY_TWO_UNITS + "\n" + FLAT_AR), "",
                                 "offer", "x", TODAY)
    assert row is None and skip == "catalogue"
    assert X.type_of("شاليه للبيع- بدخل ثابت", BODY_TWO_UNITS) == (None, "catalogue:body")
    page = ('<script type="application/ld+json">'
            + json.dumps(ld("شاليه للبيع- بدخل ثابت", BODY_TWO_UNITS), ensure_ascii=False) + "</script>")
    assert R._signal(200, page, False) == "gone"
    one = ('<script type="application/ld+json">'
           + json.dumps(ld("شاليه للبيع - الطايف", BODY_ONE_UNIT_TWICE), ensure_ascii=False) + "</script>")
    assert R._signal(200, one, False) == "live"


# ── the crawl's own-page read is a liveness reading (2026-10-18) ─────────────────────────────────
def test_crawl_stamps_live_only_when_the_oracles_reader_says_live_on_this_post(monkeypatch):
    """4,074 of 4,478 active haraj rows read «never checked» after the catch-up stored them from their
    own pages. The crawl now records that read through the oracle's OWN reader (_signal), and only for
    a page that names this post; a gone/request page is never stored, so never stamped."""
    live = '<script type="application/ld+json">' + json.dumps(ld("x", FLAT_AR), ensure_ascii=False) + "</script>"
    pages = {"11190690713": live + R.TAG,                       # live, names itself (ld url)
             "11190690999": live + R.TAG}                       # live body, but about another post
    monkeypatch.setattr(R, "read_post", lambda pid: (200, pages[pid]))
    monkeypatch.setattr(R, "map_post", lambda pid, *a, **k: (
        {"ad_number": f"{R.PREFIX}{pid}", "additional_info": {}}, "residential", "", {"district_resolved": True}))
    res, _, c, _, _ = R.crawl(0, 0, only=list(pages), meta={"files": ["--ids"], "prefiltered": {}})
    marked = {r["ad_number"]: R.db._DIRECT_ALIVE_KEY in r for r in res}
    assert marked == {"HRJ11190690713": True, "HRJ11190690999": False} and c["stamped_live"] == 1


# 2026-10-18, the haraj plots under the city floor: the RATE is stated somewhere other than the first mention of
# the figure, or in a wording the narrow window missed. Recorded free-text lines (licence box excluded), verbatim.
import pytest  # noqa: E402


@pytest.mark.parametrize("price, area, text", [
    (1650, 1080, "💰 سعر البيع: 1,780,000 ريال تقريبًا (المتر 1,650 ريال) 📄"),                       # 11190453852
    (1100, 1014, "للبيع في حي المروج 3ج س ع شارعين المساحه 1014 البيع المتر 1100 شرقيه جنوبيه"),        # 11190435595
    (1100, 660, "💵 السعر / Price💵 سعر المتر : 1,100 ريال السعر الاجمالي :"),                          # 11189560091
    (1400, 900, "للبيع في محافظه المزاحميه حي المروج المساحه 900 سكني المتر 1400 ريال"),               # 11189410160
    (1800, 400, "💰 السعر والشروط: السعر المطلوب: 1800ريال سعودي للمتر السعر غير شامل السعي"),          # 11189183446
    (3500, 1443, "/ شارع30مـ شرقا -العرض/مباشر - المطلوب /3500ريال بالمتر -السعي وضريبة التصرف"),        # 11189087398
])
def test_a_rate_stated_anywhere_about_the_figure_is_per_meter(price, area, text):
    assert R.land_price_basis(price, area, "مساحة الأرض " + str(area) + " " + str(price) + " نهائي " + text) == "per_meter"


def test_mutation_a_mention_with_no_marker_anywhere_stays_a_total():
    # 11189120675: «عليها سوم 750» on 1,008 m² — no per-metre word for this figure (owner default: a total)
    assert R.land_price_basis(750, 1008, "أرض بمساحة مناسبة وموقع واعد، عليها سوم 750 والبيع قريب") == "total"


# ── the post's own words disagree on Buy vs Rent: a doubt, never stored (backlog 656/672, 2026-10-19) ─────
TWO_BLOCKS = (  # HRJ11190666849: a Sell block with no price, then an إيجار block priced 28,000
    "معلومات العقار حسب الرخصة\nغرض الإعلان: Sell\nنوع العقار: Apartment\nمساحة العقار: 119.45\nعدد الغرف: 5\n"
    "معلومات العقار حسب الرخصة\nغرض الإعلان: إيجار\nسعر الوحدة: 28000\nنوع العقار: شقة\nمساحة العقار: 119.45\n"
    "وصف موقع العقار: حي مريخ بمدينة جدة .\n تاريخ انتهاء رخصة الإعلان : 2027-10-15\n-----\n"
    "وصف موقع العقار حسب الصك\nالمدينة: جده\nالحي: مريخ\n")
SELL_BLOCK = NO_DEED   # «غرض الإعلان: بيع · سعر الوحدة: 2000000»


def _page(name, desc):
    return '<script type="application/ld+json">' + json.dumps(ld(name, desc), ensure_ascii=False) + "</script>"


def test_two_licence_blocks_with_different_deals_are_never_one_offer():
    assert P.licence_deals(TWO_BLOCKS) == ["Buy", "Rent"]
    row, _, skip, _ = mapped("شقة سكنية الايجار 5 غرف في حي التيسير (وادي مريخ) او للبيع", TWO_BLOCKS)
    assert row is None and skip == "deal_conflict:blocks"
    assert R._signal(200, _page("شقة سكنية الايجار 5 غرف", TWO_BLOCKS), False) == "gone"


@pytest.mark.parametrize("title,why", [
    ("ايجار شقه ارضي3غرف وصاله حي النور الدمام 20 الف السنه", "title"),   # stored Buy 1,000,000,000
    ("شقه للايجار فى لبن قريب المخرج 3 غرف وصاله بسعر 35 الف", "title"),   # stored Buy 2,800,000
    ("للإيجار عمارة في الخالدية", "title"),
    ("عمارة للبيع في الخالدية", None),                                        # agrees with the Sell block
    ("عمارة للبيع او للايجار في الخالدية", None),                             # names both: decides nothing
    ("عمارة دخلها الايجاري 200 الف للبيع", None),                              # «الايجاري» is not a rent offer
    ("عمارة في الخالدية", None),                                               # names neither
])
def test_a_title_that_names_the_other_deal_is_a_doubt(title, why):
    row, _, skip, _ = mapped(title, SELL_BLOCK, city="المدينة المنورة")
    if why:
        assert row is None and skip == f"deal_conflict:{why}"
        assert R._signal(200, _page(title, SELL_BLOCK), False) == "gone"
    else:
        assert not skip.startswith("deal_conflict")
        assert R._signal(200, _page(title, SELL_BLOCK), False) == "live"


def test_mutation_one_block_agreeing_with_its_title_is_still_stored():
    row, _, skip, _ = mapped("شقة مميزة للإيجار في حي الجنادرية", FLAT_AR, city="الرياض")
    assert skip == "" and row["transaction_type"] == "Rent" and P.licence_deals(FLAT_AR) == ["Rent"]


def test_catchup_cursor_ignores_the_finished_licensed_only_walk():
    """2026-10-25: the licensed-only walk ended at «catchup_before» 2026-07-20-00 having dropped every
    unlicensed offer. Its key must not resume the all-offers walk, or the walk would start finished."""
    old = '{"catchup_before": "2026-07-20-00", "catchup_files_left": 0}'
    assert R._CURSOR.search(old) is None
    assert R._CURSOR.search('{"catchup_all_before": "2026-09-01-03"}').group(1) == "2026-09-01-03"
