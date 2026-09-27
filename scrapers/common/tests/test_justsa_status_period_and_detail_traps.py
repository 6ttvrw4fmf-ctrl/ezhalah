"""فقط نقطة العقارية (just.sa) barrier: a sold/rented status is a skip, a silent rent period stays
NULL, the detail page's labelled facts reach real columns, and the marketer's name never does.

Every assertion runs the SHIPPING functions — run.map_listing, run.parse_detail, run._amenities,
run._signal / run._url_for, run.session, run.main — never a re-implementation. Only to_catalog and
find_district_in_text are stubbed (the barrier is offline).

PROVENANCE: the unit records are copied VERBATIM from
`GET https://just.sa/index.php?ajax=1&page=1&per_page=100` on 2026-09-24 (ids 373, 672, 690, 624,
411), trimmed to the keys map_listing reads. DETAIL_672 is the /l/672 page of that day, trimmed to
the blocks parse_detail reads (hero, price card, spec items, feature cards, description, gallery)
with their markup kept byte-for-byte; the media list is cut to its first two entries. The marketer
card is kept ON PURPOSE (it carries a personal name) so the PII rule is exercised against the real
shape. Two variations are SYNTHETIC and say so: a period word on the price card, and a phone number
in the description.
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

from scrapers.justsa import run as R  # noqa: E402

_CATALOG = {"الرياض": (3, 1), "جدة": (5, 2)}
R.to_catalog = lambda city_ar, region_hint=None: _CATALOG.get((city_ar or "").strip(), (None, None))
R.find_district_in_text = lambda text, city_id: ("حي " + text.strip()) if text else None

U373 = {"id": 373, "ad_number": "J1275", "city": "الرياض", "neighborhood": "العارض", "status": "متاح", "price": 1792000, "unit_type": "تاون هاوس", "property_role": "بيع", "land_area": "297", "bedrooms": "4", "facade": "جنوبية", "street_width": "30", "image1": "/das/includes/uploads/images/offer_20260808_195828_5f4cc1.webp", "license_number": "7201001555"}
U672 = {"id": 672, "ad_number": "J1498", "city": "الرياض", "neighborhood": "الصفا", "status": "متاح", "price": 170000, "unit_type": "فيلا", "property_role": "إيجار", "land_area": "200", "bedrooms": "5", "facade": "غربية", "street_width": "18", "image1": "/das/includes/uploads/images/offer_6a6cbf407d6bb1.77040209.webp", "license_number": "7201043946"}
U690 = {"id": 690, "ad_number": "J1516", "city": "الرياض", "neighborhood": "الغصون", "status": "متاح", "price": 900, "unit_type": "دور أرضي", "property_role": "بيع", "land_area": "360", "bedrooms": "3", "facade": "شمال", "street_width": "15", "image1": "/das/includes/uploads/images/offer_6a7c51b2723b53.65986865.jpg", "license_number": "7201078514"}
U624 = {"id": 624, "ad_number": "J1457", "city": "جدة", "neighborhood": "الريان", "status": "مباع", "price": 730000, "unit_type": "شقة", "property_role": "بيع", "land_area": "112", "bedrooms": "3", "facade": "شمالية", "street_width": "15", "image1": "/das/includes/uploads/images/img_20260512_144111_ed70c5.webp", "license_number": "7200970134"}
U411 = {"id": 411, "ad_number": "J1304", "city": "الرياض", "neighborhood": "النرجس", "status": "متاح", "price": 3588000, "unit_type": "فيلا", "property_role": "بيع", "land_area": "263", "bedrooms": "5", "facade": "جنوبية", "street_width": "15", "image1": "/das/includes/uploads/images/img_20260513_145035_f0d781.webp", "license_number": ""}

DETAIL_672 = """<div class="rv-chip">
                        <i class="fa-solid fa-location-dot"></i>
                        <span>الصفا - الرياض</span>
                    </div>
                    <h1>فيلا</h1>
                    <div class="rv-status-line">
                        <span class="property-status status-available">
                            متاح                        </span>
                    </div>
                <aside class="rv-side-panel">
<div class="rv-price-card">
    <span>قابل للتفاوض</span>
<div class="rv-price-row">
        <img src="https://just.sa/assets/images/saudi-riyal-symbol.svg" alt="ريال">
    <strong>170,000</strong>
</div>
            <em>ترخيص: 7201043946</em>
    </div>
                    <div class="rv-agent-mini">
                        <img class="" src="/assets/uploads/team/avatar_20260808_144712_71af74.jpg" alt="المسوق">
                        <div>
                            <b>شروق الجويهل</b>
                            <span>مشرف المشروع</span>
                        </div>
                    </div>
                </aside>
            <div class="media-gallery horizontal-scroll" data-media='[{&quot;type&quot;:&quot;img&quot;,&quot;src&quot;:&quot;https://just.sa/das/includes/uploads/images/offer_6a6cbf407d6bb1.77040209.webp&quot;},{&quot;type&quot;:&quot;img&quot;,&quot;src&quot;:&quot;https://just.sa/das/includes/uploads/images/offer_20260808_202524_83e9ba.webp&quot;}]'></div>
        <section class="rv-accordion open">
            <button class="rv-accordion-header" type="button">
                <div>
                    <span>المواصفات</span>
                    <h2>تفاصيل سريعة</h2>
                </div>
            </button>
            <div class="rv-accordion-content">
                <div class="specs-list">
                                            <div class="spec-item">
                            <div class="spec-icon"><i class="fa-solid fa-ruler-combined"></i></div>
                            <span>المساحة</span>
                            <strong>200 م²</strong>
                        </div>
                                            <div class="spec-item">
                            <div class="spec-icon"><i class="fa-solid fa-vector-square"></i></div>
                            <span>المسطح</span>
                            <strong>400 م²</strong>
                        </div>
                                            <div class="spec-item">
                            <div class="spec-icon"><i class="fa-solid fa-calendar-days"></i></div>
                            <span>عمر العقار</span>
                            <strong>جديد</strong>
                        </div>
                                            <div class="spec-item">
                            <div class="spec-icon"><i class="fa-solid fa-bed"></i></div>
                            <span>الغرف</span>
                            <strong>5</strong>
                        </div>
                                            <div class="spec-item">
                            <div class="spec-icon"><i class="fa-solid fa-bath"></i></div>
                            <span>الحمامات</span>
                            <strong>8</strong>
                        </div>
                                            <div class="spec-item">
                            <div class="spec-icon"><i class="fa-solid fa-couch"></i></div>
                            <span>المجالس</span>
                            <strong>3</strong>
                        </div>
                                            <div class="spec-item">
                            <div class="spec-icon"><i class="fa-solid fa-road"></i></div>
                            <span>عرض الشارع</span>
                            <strong>18 م</strong>
                        </div>
                                            <div class="spec-item">
                            <div class="spec-icon"><i class="fa-solid fa-building"></i></div>
                            <span>الواجهة</span>
                            <strong>غربية</strong>
                        </div>
                                    </div>
            </div>
        </section>
                <div class="rv-accordion-content">
                    <div class="features-grid">
                                                    <div class="feature-card">
                                <div class="feature-icon">
                                    <i class="fa-solid fa-solar-panel"></i>
                                </div>
                                <div class="feature-text">سطح</div>
                            </div>
                                                    <div class="feature-card">
                                <div class="feature-icon">
                                    <i class="fa-solid fa-bed"></i>
                                </div>
                                <div class="feature-text">غرفة غسيل</div>
                            </div>
                                                    <div class="feature-card">
                                <div class="feature-icon">
                                    <i class="fa-solid fa-bed"></i>
                                </div>
                                <div class="feature-text">غرفة خادمة</div>
                            </div>
                                                    <div class="feature-card">
                                <div class="feature-icon">
                                    <i class="fa-solid fa-bed"></i>
                                </div>
                                <div class="feature-text">غرفة سائق</div>
                            </div>
                                                    <div class="feature-card">
                                <div class="feature-icon">
                                    <i class="fa-solid fa-kitchen-set"></i>
                                </div>
                                <div class="feature-text">مطبخ راكب</div>
                            </div>
                                                    <div class="feature-card">
                                <div class="feature-icon">
                                    <i class="fa-solid fa-snowflake"></i>
                                </div>
                                <div class="feature-text">مكيفات</div>
                            </div>
                                            </div>
                </div>
            <div class="rv-accordion-content">
                <div class="unit-details">
                    فلة 200 متر حي الصفا <br />
عبارة عن ثلاثة ادوار ( ارضي + اول + ثاني )<br />
وغرفة سائق <br />
<br />
الارضي: <br />
مدخل قراج<br />
مجلس رجال <br />
مقلط الضيوف<br />
صالة عائلية <br />
مطبخ مفتوح ومركب جاهز <br />
ارتداد خلفي  <br />
مكيفة<br />
الدور الاول: <br />
اربع غرف نوم جميعها ماستر <br />
صالة صغيره مع بلكونة <br />
<br />
الدور الثاني: <br />
صالة + دورة مياة<br />
غرفة اضافية <br />
غرفة الخادمة + دورة مياة خاصه لها <br />
غرفة غسيل<br />
<br />
وسطح خارجي مع منطقة تشجير مجهزة                </div>
"""
NOT_FOUND_BODY = "لم يتم العثور على الوحدة"


def _row(u, detail):
    row, cat, why = R.map_listing(u, detail)
    assert row is not None, why
    return row, cat


# ── 1. THE DETAIL PAGE'S LABELLED FACTS ─────────────────────────────────────────────────────────
def test_parse_detail_reads_only_the_named_blocks():
    d = R.parse_detail(DETAIL_672)
    assert d["specs"] == {"المساحة": "200 م²", "المسطح": "400 م²", "عمر العقار": "جديد", "الغرف": "5",
                          "الحمامات": "8", "المجالس": "3", "عرض الشارع": "18 م", "الواجهة": "غربية"}
    assert d["features"] == ["سطح", "غرفة غسيل", "غرفة خادمة", "غرفة سائق", "مطبخ راكب", "مكيفات"]
    assert d["status"] == "متاح" and d["negotiable"] is True and d["license_number"] == "7201043946"
    assert d["price_card"].startswith("قابل للتفاوض")
    assert d["photos"] == ["https://just.sa/das/includes/uploads/images/offer_6a6cbf407d6bb1.77040209.webp",
                           "https://just.sa/das/includes/uploads/images/offer_20260808_202524_83e9ba.webp"]
    assert "J1498" not in d["j_numbers"]          # the trimmed page names no J-number → no direct-alive stamp
    assert d["description"].startswith("فلة 200 متر حي الصفا") and "غرفة غسيل" in d["description"]
    assert "شروق" not in str(d)                     # the marketer card is never read


def test_a_rent_row_takes_the_facts_into_real_columns_and_keeps_its_period_null():
    row, cat = _row(U672, R.parse_detail(DETAIL_672))
    assert row["ad_number"] == "JST672" and row["listing_url"] == "https://just.sa/l/672"
    assert row["transaction_type"] == "Rent" and row["property_type"] == "Villa" and cat == "residential"
    assert row["price_annual"] == 170000 and "rent_period" not in row and "price_total" not in row
    assert row["price_evidence"]["raw"] == 170000 and row["price_evidence"]["kind"] == "annual"
    assert row["city_ar"] == "الرياض" and row["district_ar"] == "حي الصفا" and row["neighborhood"] == "الصفا"
    assert row["area_m2"] == 200 and row["bedrooms"] == 5 and row["bathrooms"] == 8
    assert row["reception_rooms_majlis"] == 3 and row["street_width_m"] == 18 and row["direction"] == "غرب"
    assert row["property_age"] == 0                                    # «جديد»
    assert row["maid_room"] is True and row["driver_room"] is True and row["laundry_room"] is True
    assert row["kitchen"] is True and row["air_conditioner"] is True
    assert row["license_number"] == "7201043946"
    assert row["photo_urls"][0] == "https://just.sa/das/includes/uploads/images/offer_6a6cbf407d6bb1.77040209.webp"
    assert len(row["photo_urls"]) == 2
    assert row["additional_info"]["built_area_raw"] == "400 م²" and row["additional_info"]["negotiable"] is True
    assert row["additional_info"]["source_ad_number"] == "J1498"
    assert "شروق" not in str(row)
    assert "_direct_alive_oracle" not in row        # this trimmed page did not name the unit


def test_a_period_word_on_the_price_card_is_honoured_on_the_sources_own_word():
    """SYNTHETIC: «سنوي» / «شهري» beside the real figure."""
    d = R.parse_detail(DETAIL_672.replace("<span>قابل للتفاوض</span>", "<span>سنوي</span>"))
    row, _ = _row(U672, d)
    assert row["rent_period"] == "annual" and row["price_annual"] == 170000
    d = R.parse_detail(DETAIL_672.replace("<span>قابل للتفاوض</span>", "<span>شهري</span>"))
    row, _ = _row(U672, d)
    assert row["rent_period"] == "monthly" and row["price_annual"] == 170000 * 12


def test_a_direct_read_that_names_the_unit_stamps_the_row():
    d = R.parse_detail(DETAIL_672.replace("<h1>فيلا</h1>", "<h1>فيلا</h1><small>J1498</small>"))
    row, _ = _row(U672, d)
    assert row["_direct_alive_oracle"] == "just.sa./l/<id>.detail_page"


# ── 2. PRICE = SOURCE, TYPES, JSON-ONLY ROWS ────────────────────────────────────────────────────
def test_json_only_rows_still_map_and_a_900_riyal_sale_stays_900():
    row, _ = _row(U373, None)
    assert row["property_type"] == "Villa" and row["price_total"] == 1792000       # «تاون هاوس» → the fleet fold
    assert row["direction"] == "جنوب" and row["street_width_m"] == 30 and row["license_number"] == "7201001555"
    assert row["photo_urls"] == ["https://just.sa/das/includes/uploads/images/offer_20260808_195828_5f4cc1.webp"]
    assert "bathrooms" not in row or row["bathrooms"] is None
    row, _ = _row(U690, None)
    assert row["price_total"] == 900 and row["property_type"] == "Floor"
    row, _ = _row(U411, None)
    assert row["license_number"] is None                                            # blank stays NULL
    # A source «0» is an unpublished figure, not a 0 m² plot or a free unit (live: land_area "0" on
    # 11 units, e.g. 722, 720, 721 on 2026-09-24).
    row, _ = _row({**U373, "land_area": "0", "price": 0}, None)
    assert row["area_m2"] is None and row["price_total"] is None
    assert row["price_evidence"]["raw"] == 0 and row["price_evidence"]["stored"] is None


def test_property_age_is_exact_only_and_an_open_bound_stays_null():
    """SYNTHETIC ages on the real spec block: «10» is a fact, «أكثر من 10 سنوات» is a bound."""
    row, _ = _row(U672, R.parse_detail(DETAIL_672.replace("<strong>جديد</strong>", "<strong>10</strong>")))
    assert row["property_age"] == 10 and row["additional_info"]["age_raw"] == "10"
    row, _ = _row(U672, R.parse_detail(DETAIL_672.replace("<strong>جديد</strong>", "<strong>أكثر من 10 سنوات</strong>")))
    assert row["property_age"] is None and row["additional_info"]["age_raw"] == "أكثر من 10 سنوات"


def test_the_headline_area_is_the_card_area_for_every_type_and_the_built_up_stays_raw():
    """OWNER-DECISION DEFAULT (raised 2026-09-24, not yet decided): the site's headline «المساحة»
    (= JSON land_area) is area_m2 for apartments too — live شقة 676 prints «المساحة 400 م²» beside
    «المسطح 160 م²». «المسطح» is kept verbatim in additional_info.built_area_raw, never promoted.
    SYNTHETIC: U672's record and page re-typed as that apartment."""
    page = DETAIL_672.replace("<strong>400 م²</strong>", "<strong>160 م²</strong>").replace("<strong>200 م²</strong>", "<strong>400 م²</strong>")
    d = R.parse_detail(page)
    assert d["specs"]["المساحة"] == "400 م²" and d["specs"]["المسطح"] == "160 م²"
    row, _ = _row({**U672, "unit_type": "شقة", "land_area": "400"}, d)
    assert row["property_type"] == "Apartment" and row["area_m2"] == 400
    assert row["additional_info"]["built_area_raw"] == "160 م²" and row["additional_info"]["land_area_raw"] == "400"


def test_a_diagonal_facade_is_one_answer_and_a_two_street_list_is_none():
    row, _ = _row({**U373, "facade": "شمالية شرقية"}, None)
    assert row["direction"] == "شمال شرق"
    row, _ = _row({**U373, "facade": "-"}, None)
    assert row["direction"] is None


# ── 3. SKIP, NEVER GUESS ────────────────────────────────────────────────────────────────────────
def test_sold_rented_unmapped_and_unplaceable_are_skipped_by_name():
    assert R.map_listing(U624, None)[2] == "status_مباع"
    assert R.map_listing({**U672, "status": "مؤجر"}, None)[2] == "status_مؤجر"
    assert R.map_listing({**U373, "unit_type": "مزاد"}, None)[2] == "type_unmapped"
    assert R.map_listing({**U373, "city": "بلدة مجهولة"}, None)[2] == "city_not_in_catalog"
    assert R.map_listing({**U373, "property_role": "استثمار"}, None)[2] == "deal_unknown_استثمار"
    assert R.map_listing({**U373, "id": None}, None)[2] == "no_id"
    # The detail page's own status outranks a stale JSON «متاح».
    d = R.parse_detail(DETAIL_672.replace("متاح                        </span>", "مباع</span>"))
    assert R.map_listing(U672, d)[2] == "status_مباع"


# ── 4. PDPL ─────────────────────────────────────────────────────────────────────────────────────
def test_a_phone_number_in_the_description_is_redacted():
    """SYNTHETIC: a contact line inside the real description."""
    d = R.parse_detail(DETAIL_672.replace("وسطح خارجي مع منطقة تشجير مجهزة", "للتواصل واتساب 0551234567"))
    row, _ = _row(U672, d)
    assert "0551234567" not in row["description"] and "0551234567" not in str(row["additional_info"])


# ── 5. THE REMOVAL ORACLE ───────────────────────────────────────────────────────────────────────
def test_the_signal_reads_the_not_found_sentence_and_the_status_word():
    assert R._signal(200, NOT_FOUND_BODY, False) == "gone"
    live = DETAIL_672.replace("<h1>فيلا</h1>", "<h1>فيلا</h1><small>J1498</small>")
    assert R._signal(200, live, False) == "live"
    assert R._signal(200, live.replace("متاح                        </span>", "مباع</span>"), False) == "gone"
    assert R._signal(200, DETAIL_672, False) is None            # no J-number → no opinion
    # The kill is the measured 25-byte shape: the sentence INSIDE a full unit page is not a death.
    assert R._signal(200, live + NOT_FOUND_BODY, False) == "live"
    assert R._signal(200, "<html>maintenance</html>", False) is None
    assert R._signal(404, NOT_FOUND_BODY, False) is None         # only the measured 200 shape counts
    assert R._signal(403, NOT_FOUND_BODY, False) is None
    assert R._url_for("JST672") == "https://just.sa/l/672" and R._url_for("J1498") is None


def test_session_asks_for_arabic():
    assert R.session().headers.get("Accept-Language", "").startswith("ar")


# ── 6. THE RUN LEDGER ───────────────────────────────────────────────────────────────────────────
def test_the_skip_tally_and_detail_count_reach_end_run(monkeypatch):
    calls: dict = {}
    written: dict = {}
    pruned: list = []
    units = [U672, U624, {**U373, "unit_type": "مزاد"}]
    monkeypatch.setattr(sys, "argv", ["run.py"])
    monkeypatch.setattr(R, "PAUSE", 0)
    monkeypatch.setattr(R, "session", lambda: None)
    monkeypatch.setattr(R, "fetch_catalogue", lambda s, limit=0: (units, len(units)))
    monkeypatch.setattr(R, "fetch_detail", lambda s, uid: R.parse_detail(DETAIL_672) if uid == 672 else None)
    monkeypatch.setattr(R.db, "begin_run", lambda src: 1)
    monkeypatch.setattr(R.db, "_wasalt_batch", lambda t, rows: written.__setitem__(t, list(rows)))
    monkeypatch.setattr(R.db, "retire_superseded_siblings", lambda **k: 0)
    monkeypatch.setattr(R.db, "prune_unseen", lambda t, seen, **k: pruned.append((t, set(seen))) or 0)
    monkeypatch.setattr(R.db, "end_run", lambda run_id, **k: calls.update(k) or True)

    assert R.main() == 0
    assert calls["ok"] is True and calls["rows_seen"] == 3 and calls["rows_upserted"] == 1
    assert "status_مباعx1" in calls["notes"] and "type_unmappedx1" in calls["notes"] and "detail=1/3" in calls["notes"]
    assert calls["check_tables"] == ["justsa_residential_listings", "justsa_commercial_listings"]
    assert [r["ad_number"] for r in written["justsa_residential_listings"]] == ["JST672"]
    assert ("justsa_residential_listings", {"JST672"}) in pruned


def test_an_incomplete_enumeration_never_prunes(monkeypatch):
    pruned: list = []
    monkeypatch.setattr(sys, "argv", ["run.py", "--no-detail"])
    monkeypatch.setattr(R, "session", lambda: None)
    monkeypatch.setattr(R, "fetch_catalogue", lambda s, limit=0: ([U672], 80))   # site says 80, we got 1
    monkeypatch.setattr(R.db, "begin_run", lambda src: 1)
    monkeypatch.setattr(R.db, "_wasalt_batch", lambda t, rows: None)
    monkeypatch.setattr(R.db, "retire_superseded_siblings", lambda **k: 0)
    monkeypatch.setattr(R.db, "prune_unseen", lambda t, seen, **k: pruned.append(t) or 0)
    monkeypatch.setattr(R.db, "end_run", lambda run_id, **k: True)
    assert R.main() == 0 and pruned == []
