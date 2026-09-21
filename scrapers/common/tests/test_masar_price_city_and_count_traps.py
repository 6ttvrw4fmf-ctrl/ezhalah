"""masar's P0s: the numbers in this source's prose are mostly NOT prices, and no ad states a city.

masaraqarat.com publishes no price field at all (`acf` is empty on all 9 listings), so the only
price it ever states lives in the ad's prose — exactly one listing, «السعر 55 ألف». Everything else
numeric in that same prose is a trap, and all of them are live, not hypothetical:

  · a 10-digit REGA ad licence on 6 of 9 («ترخيص رقم/ 7200632026») — a digit-grab publishes
    7,200,632,026 ﷼
  · the office mobile on 3 («0531618250»)
  · the area, the street width, the building age and a 25-year warranty term
  · «الفيلا» — the word contains the substring «الف» (thousand), so 2827's «الشارع 20 متر الفيلا»
    is one boundary-less multiplier away from a 20,000 ﷼ villa

It also states no city on 8 of 9, while every district on it happens to be a Riyadh one — so the
tempting fallback is a hardcoded الرياض, which is the exact fallback ramzalqasim deleted in 2026-07
after it invented a city on 68/184 rows.

Every fixture below is REAL text/HTML copied from a live fetch on 2026-09-20, and every assertion
runs the SHIPPING functions (`run.parse_price`, `run.parse_overview`, `run._unit_count`,
`run.city_in_ad`, `run.map_listing`) — never a re-implementation. Offline: no network.
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

from scrapers.common import normalize  # noqa: E402
from scrapers.masar import run as R  # noqa: E402


@pytest.fixture(autouse=True)
def _no_catalog_network(monkeypatch):
    """to_catalog()/find_district_in_text() are the only calls in this module that would touch
    Supabase. They are stubbed for EVERY test, not just the ones that expect a placed listing, so
    that a regression which wrongly reaches the catalog fails on an ASSERTION rather than on a
    15-second network retry — and so this barrier is provably offline whatever the code does.
    """
    monkeypatch.setattr(R, "to_catalog",
                        lambda c, region_hint=None: (1, 1) if c == "الرياض" else (None, None))
    monkeypatch.setattr(R, "find_district_in_text",
                        lambda t, cid: "حي النرجس" if t and "النرجس" in t else None)

# ── real ad bodies (content.rendered, tags stripped) ──────────────────────────────────────────────

# id 2783 — the ONLY priced listing on the source. Note the licence AND the phone in the same body.
BODY_2783 = (
    "شقة للإيجار شمالية شارع 15 مقابل مسجد الحارة، في حي النرجس – الدور الاول "
    "الشقة قريبة من طريق أبو بكر تتكون من: غرفتين نوم وحدة ماستر، وصالة عائلية، بالإضافة إلى "
    "صالة طعام تتميز الشقة بوجود مجلس رجال بمدخل مستقل مع دورة مياه المطبخ راكب و4 مكيفات راكبة "
    "خاصة بالعوائل الصغيرة فقط السعر 55 ألف قابل للتفاوض ترخيص رقم/ 7200632026 ===== "
    "نسعد بتواصلكم لتسويق عقاراتكم 0531618250"
)

# id 2921 — NO price. A bare licence number, plus «العمر سبع سنوات» and «ثلاث غرف نوم».
BODY_2921 = (
    "شقة للإيجار حي القيروان واجهة المبنى شرقية قريبة من المسجد قريبة من طريق الملك فهد "
    "تتكون الشقو من ثلاث غرف نوم واحدة منها ماستر صالة واسعة المطبخ والمكيفات راكبة "
    "مستودع أو غرفة خادمة ثلاث دورات مياه الطابق الأول العمر سبع سنوات ترخيص/ 7201080329"
)

# id 2827 — NO price. Carries «الشارع 20 متر الفيلا» (the «الف» substring trap) and a licence.
BODY_2827 = (
    "عرض مميز، سكن واستثمار فيلا للبيع حي عكاظ المساحة: 435 م الواجهة شمالية الشارع 20 متر "
    "الفيلا تتكون: -مدخل سيارة وحوش وملحق خارجي -الدور الأرضي: مجلس وصالة طعام وصالة عائلية "
    "ومطبخ وغرفة غسيل ودورتين مياه -الدور الأول: غرفة ماستر غرفتين نوم مع دورة مياه مشتركة "
    "شقة مؤجرة موقع ممتاز به كافة الخدمات قريب من المسجد "
    "قريبة من مستشفى الامام عبد الرحمن الفيصل ترخيص رقم: 7200671763"
)

# id 2935 — NO price. «ضمانات تصل الى 25 سنه» and «كامل الفيلا» (the «الف» substring again), and
# bedrooms itemised across two levels: 4 on the first floor + 1 on the roof.
BODY_2935 = (
    "فيـــلا للبيـــع تصميم حديث موقع مميز المساحة 250 م جنوبية شارع : 18 تكيف مخفي راكب "
    "دور الارضي بالكامل وصالات العلوية وغرفة النوم الرئيسية دبل هاي وتربل هاي حدائق وبلكونات "
    "تأسيس شترات كامل الفيلا وارتفاعات بالأسقف ضمانات تصل الى 25 سنه ا لمواصفات : مدخل سيارة "
    "غرفة سائق مجلس صالة طعام صالة مطبخين غرف خادمه مع الغسيل حديقه داخليه . "
    "الدور الاول : 4 غرف نوم ماستر السطح : غرفة نوم ماستر . صالة . جلسة سطح مصاعد سكاي لايت"
)

# id 2693 — the ONE ad on the source that names its own city.
BODY_2693 = (
    "شقة فاخرة في موقع حيوي وقريب من الخدمات، حيث تقع في أحد أرقى أحياء الرياض – حي النرجس "
    "شمال مدينة الرياض، توفر الراحة والهدوء في موقع مميز تضم الشقة ثلاث غرف واحدة منها ماستر، "
    "إضافة إلى صالة كبيرة مفتوحة على المطبخ يمكن تقسم صالة إلى مجلس، وثلاث دورات مياه، "
    "كما أن المكيفات راكبة في جميع الغرف، ترخيص رقم 7200508102"
)

# The site-wide FOOTER, byte-identical on all 9 rendered pages. It names الرياض twice — and it is
# the BROKER'S office, not any property. It must never be able to reach a listing's city.
FOOTER = (
    "يقدم مكتب مسار المستقبل مجموعة من الحلول التسويقية العقارية للوصول إلى العملاء المهتمين، "
    "كما نسعى لتلبية الطلبات العقارية في شمال الرياض. مكتب مسار المستقبل معتمدة من الهيئة العامة "
    "للعقار برقم 120009512، مكتبنا الرياض- حي العارض - شارع الحارث بن سليل"
)

# ── real detail-page overview widget (id 2298): FOUR items, in a DIFFERENT ORDER ─────────────────
# On the other eight listings the second item is the area. Here it is the room count. Any parser
# keyed by position reads «عدد الغرف 2» as the area of a 142 m² flat.
OVERVIEW_2298 = """<h2 class="elementor-heading-title elementor-size-default">نظرة عامة</h2>
<ul class="elementor-inline-items elementor-icon-list-items elementor-post-info">
    <li class="elementor-icon-list-item elementor-repeater-item-b74c909 elementor-inline-item">
        <span class="elementor-icon-list-icon"><i aria-hidden="true" class="far fa-building"></i></span>
        <span class="elementor-icon-list-text elementor-post-info__item elementor-post-info__item--type-custom">
            حي حطين 					</span>
    </li>
    <li class="elementor-icon-list-item elementor-repeater-item-b83c852 elementor-inline-item">
        <span class="elementor-icon-list-icon"><i aria-hidden="true" class="fas fa-door-open"></i></span>
        <span class="elementor-icon-list-text elementor-post-info__item elementor-post-info__item--type-custom">
            عدد الغرف 2					</span>
    </li>
    <li class="elementor-icon-list-item elementor-repeater-item-b222c8f elementor-inline-item">
        <span class="elementor-icon-list-icon"><i aria-hidden="true" class="fas fa-chart-area"></i></span>
        <span class="elementor-icon-list-text elementor-post-info__item elementor-post-info__item--type-custom">
            142 متر مربع					</span>
    </li>
    <li class="elementor-icon-list-item elementor-repeater-item-71aba69 elementor-inline-item">
        <span class="elementor-icon-list-icon"><i aria-hidden="true" class="fas fa-hotel"></i></span>
        <span class="elementor-icon-list-text elementor-post-info__item elementor-post-info__item--type-custom">
            دور أول					</span>
    </li>
</ul>"""

# The hcdn interstitial, verbatim-shaped. IT IS SERVED WITH HTTP 200 on every URL but a fresh
# session's first, so a status check cannot tell it apart from data.
CHALLENGE_PAGE = (
    '<!DOCTYPE html><html lang="en"><head><meta http-equiv="refresh" content="30">'
    "<title>Checking your browser before accessing. Just a moment...</title></head>"
    '<body><div class="container">Please wait for up to 5 seconds...</div>'
    '<script src="/hcdn-cgi/jschallenge"></script></body></html>'
)


def _post(pid, title, cls, body):
    """A minimal real-shaped /wp-json/wp/v2/aqar item."""
    return {"id": pid, "status": "publish", "link": f"https://masaraqarat.com/aqar/{pid}/",
            "slug": str(pid), "class_list": ["aqar", "type-aqar", cls],
            "title": {"rendered": title}, "content": {"rendered": f"<p>{body}</p>"},
            "acf": [], "date_gmt": "2025-08-14T10:49:36", "modified_gmt": "2025-08-26T13:39:03"}


# ── price ─────────────────────────────────────────────────────────────────────────────────────────

def test_the_one_published_price_is_read_exactly():
    """«السعر 55 ألف» is 55,000 — the multiplier is applied, and the figure is not rounded or
    adjusted. A source-published price must never be hidden."""
    total, ppm = R.parse_price(BODY_2783, area_m2=None)
    assert total == 55_000, total
    assert ppm is None


def test_a_rega_licence_number_never_becomes_a_price():
    """6 of 9 bodies carry a 10-digit «ترخيص رقم» and no price. Each must come back priceless."""
    for body in (BODY_2921, BODY_2827, BODY_2935):
        total, ppm = R.parse_price(body, area_m2=435)
        assert total is None, f"licence/phone leaked as a price: {total}"
        assert ppm is None
    # and the licence digits specifically are nowhere near the result
    assert R.parse_price("ترخيص رقم/ 7200632026", None) == (None, None)
    assert R.parse_price("نسعد بتواصلكم 0531618250", None) == (None, None)


def test_alif_inside_al_villa_is_not_a_thousands_multiplier():
    """«الشارع 20 متر الفيلا تتكون» — «الفيلا» contains «الف». A boundary-less multiplier reads a
    20-metre street as 20,000 ﷼. Guarded both in the real body and in isolation."""
    assert R.parse_price(BODY_2827, area_m2=435)[0] is None
    assert R.parse_price("السعر 20 الفيلا", None)[0] == 20, "«الفيلا» must not multiply by 1000"
    assert R.parse_price("السعر 20 ألف", None)[0] == 20_000, "a real «ألف» must still multiply"


def test_area_street_width_and_age_are_not_prices():
    for txt in ("المساحة: 435 م", "الواجهة شمالية الشارع 20 متر", "شارع : 18",
                "العمر سبع سنوات", "ضمانات تصل الى 25 سنه"):
        assert R.parse_price(txt, area_m2=435) == (None, None), txt


def test_per_metre_figure_is_never_stored_as_a_total_on_its_own():
    """«سعر المتر» is a PER-SQUARE-METRE figure. Without an area there is no total the source
    supports, so the total stays NULL and the basis is preserved separately."""
    total, ppm = R.parse_price("فيلا للبيع سعر المتر 3,000 ريال", area_m2=None)
    assert ppm == 3_000
    assert total is None, "a per-metre figure alone must not be published as a total"


def test_a_per_metre_rate_is_stored_as_a_rate_and_never_multiplied_here():
    """Owner rule 2026-09-03: ppm × area is the search/display layer's ≈ total, never a scraper's."""
    total, ppm = R.parse_price("سعر المتر المربع 3000", area_m2=435)
    assert (ppm, total) == (3_000, None)


def test_silence_is_not_a_price():
    assert R.parse_price("السعر عند الطلب", None) == (None, None)
    assert R.parse_price("", None) == (None, None)
    assert R.parse_price(None, None) == (None, None)


def test_arabic_indic_digits_are_real_digits():
    assert R.parse_price("السعر ٥٥ ألف", None)[0] == 55_000


# ── city ──────────────────────────────────────────────────────────────────────────────────────────

def test_only_the_ad_that_names_its_city_gets_one():
    assert R.city_in_ad(BODY_2693) == "الرياض"
    for body in (BODY_2783, BODY_2921, BODY_2827, BODY_2935):
        assert R.city_in_ad(body) is None, "a city was invented from a district or a landmark"


def test_a_district_never_becomes_a_city():
    """Every district on this source is a Riyadh district. Recognising that is inference, not
    source truth, and it is not allowed to place the listing."""
    for d in ("حي النرجس", "حي العارض", "حي القيروان", "حي عكاظ", "حي حطين"):
        assert R.city_in_ad(f"شقة للإيجار {d} الدور الأول") is None


def test_the_ad_body_never_includes_the_brokers_own_footer():
    """The footer names الرياض on all 9 rendered pages. _ad_body() reads content.rendered + title
    only, so the office address cannot be read as the property's city."""
    post = _post(2921, "شقة للإيجار", "aqar_type-for-rent", BODY_2921)
    body = R._ad_body(post)
    assert "مكتبنا" not in body and "نسعى لتلبية" not in body
    assert R.city_in_ad(body) is None
    # …and if it ever did leak in, this is what it would cost:
    assert R.city_in_ad(BODY_2921 + " " + FOOTER) == "الرياض"


def test_an_unplaceable_listing_is_skipped_not_guessed():
    post = _post(2827, "فيلا للبيع", "aqar_type-for-sale", BODY_2827)
    row, category, why = R.map_listing(post, {"district": "عكاظ", "area": "435"}, [])
    assert row is None
    assert why == "city_not_stated"
    assert category == "residential"


# ── overview widget ───────────────────────────────────────────────────────────────────────────────

def test_overview_is_keyed_by_icon_not_position():
    ov = R.parse_overview(OVERVIEW_2298)
    assert ov["district"] == "حي حطين"
    assert ov["area"] == "142 متر مربع"
    assert ov["rooms"] == "عدد الغرف 2"
    assert ov["floor"] == "دور أول"
    assert normalize.to_int(ov["area"]) == 142, "the area must not pick up the room count"
    assert R._count(ov["rooms"]) == 2


def test_overview_absent_is_empty_not_an_exception():
    assert R.parse_overview("<html><body>no widget here</body></html>") == {}


def test_a_zero_area_is_not_an_area():
    """An empty ACF slot rendering as 0 is "not stated", never a 0 m² property — a 0 would also
    make any per-metre total collapse to nothing. Caught in the mutation sweep as an unasserted
    guard on 2026-09-20."""
    post = _post(993, "شقة للإيجار", "aqar_type-for-rent", BODY_2693)
    row, _, why = R.map_listing(post, {"district": "النرجس", "area": "0"}, [])
    assert why == ""
    assert row["area_m2"] is None, "0 must not be stored as an area"
    row2, _, _ = R.map_listing(post, {"district": "النرجس", "area": "0 متر مربع"}, [])
    assert row2["area_m2"] is None


# ── room / bathroom counts ────────────────────────────────────────────────────────────────────────

def test_a_fused_dual_is_a_count():
    """«غرفتين نوم» / «دورتين مياه» carry their count in the noun's dual form, with no digit."""
    assert R._unit_count("تتكون من: غرفتين نوم وحدة ماستر، وصالة", R._BEDS_RE) == 2
    assert R._unit_count("ومطبخ ودورتين مياه", R._BATHS_RE) == 2


def test_arabic_word_numerals_are_counts():
    assert R._unit_count(BODY_2921, R._BEDS_RE) == 3      # «ثلاث غرف نوم»
    assert R._unit_count(BODY_2921, R._BATHS_RE) == 3     # «ثلاث دورات مياه»


def test_a_count_itemised_across_floors_is_not_the_unit_total():
    """2935 states 4 bedrooms on the first floor and 1 on the roof. Neither 4 nor 5 is a figure the
    ad published as a total, so the honest answer is NULL."""
    assert R._unit_count(BODY_2935, R._BEDS_RE) is None
    # 2827 spreads its bathrooms the same way: «ودورتين مياه» (ground) + «دورة مياه مشتركة» (first)
    assert R._unit_count(BODY_2827, R._BATHS_RE) is None


def test_a_feature_mention_is_not_a_count():
    """«مجلس رجال بمدخل مستقل مع دورة مياه» says the majlis has a bathroom, not that the flat has
    exactly one."""
    assert R._unit_count(BODY_2783, R._BATHS_RE) is None


def test_a_bare_room_word_never_becomes_a_bedroom_count():
    """«ثلاث غرف واحدة منها ماستر» (2693) and «3 غرف ودورتين مياه» (2724) say «غرف», not «غرف نوم»
    — a vague room mention must not answer a bedroom filter."""
    assert R._unit_count(BODY_2693, R._BEDS_RE) is None
    assert R._unit_count("بالإضافة إلى 3 غرف ودورتين مياه مع صالة واسعة", R._BEDS_RE) is None


# ── property age ──────────────────────────────────────────────────────────────────────────────────

def test_a_stated_age_is_captured():
    assert R.parse_age(BODY_2921) == 7            # «العمر سبع سنوات» — an Arabic word numeral
    assert R.parse_age("عمر العقار جديد") == 0
    assert R.parse_age("عمر المبنى 5 سنوات") == 5


def test_a_warranty_term_is_not_the_buildings_age():
    """2935 advertises «ضمانات تصل الى 25 سنه» — a 25-year WARRANTY on a new-build villa. The
    shared age vocabulary reads «25 سنه» as 25, so only the AGE word may introduce an age."""
    assert R.parse_age(BODY_2935) is None
    assert normalize.parse_property_age("25 سنه") == 25, "…which is exactly why the anchor matters"


def test_an_unstated_age_is_null():
    assert R.parse_age(BODY_2827) is None
    assert R.parse_age("") is None


# ── amenities: four outcomes, and silence is not False ───────────────────────────────────────────

def test_silence_never_becomes_false():
    am = normalize.amenities_from_text(BODY_2935)
    assert am.get("furnished") is None, "an unmentioned amenity must be absent, not False"
    assert "elevator" not in am or am["elevator"] is True


def test_the_neighbourhoods_amenity_is_not_this_propertys():
    """2827 says «قريب من المسجد» and «قريبة من مستشفى الامام عبد الرحمن الفيصل». Neither is a
    feature of the unit."""
    am = normalize.amenities_from_text(BODY_2827)
    for col, val in am.items():
        assert val is not False or col == "furnished", (col, val)
    assert am.get("hospital_nearby") is not True


def test_a_stated_amenity_is_true():
    am = normalize.amenities_from_text(BODY_2693)
    assert am.get("air_conditioner") is True     # «المكيفات راكبة في جميع الغرف»


# ── rent period ───────────────────────────────────────────────────────────────────────────────────

def test_an_unstated_rent_period_is_null_and_the_figure_is_not_scaled():
    """No ad on this source states شهري or سنوي — measured 0 of 6 rent ads. Defaulting 'annual'
    would be a silent 12x claim; the published figure is stored as-is with a NULL period."""
    post = _post(2783, "شقة للإيجار", "aqar_type-for-rent", BODY_2783)
    row, _, why = R.map_listing(post, {"district": "النرجس"}, [])
    assert row is None and why == "city_not_stated"      # this one is unplaceable…
    # …so assert the period rule directly on the shipping helper with the same body:
    period, annual = normalize.rent_period_and_annual(55_000, BODY_2783)
    assert period is None
    assert annual == 55_000, "an unstated period must never scale the figure"


def test_a_stated_monthly_period_is_mapped_and_annualised():
    period, annual = normalize.rent_period_and_annual(5_000, "الإيجار شهري قابل للتفاوض")
    assert (period, annual) == ("monthly", 60_000)


# ── skips ─────────────────────────────────────────────────────────────────────────────────────────

def test_an_auction_is_skipped():
    post = _post(999, "فيلا للبيع", "aqar_type-for-sale",
                 "فيلا للبيع في حي النرجس بمدينة الرياض مزاد علني المساحة 400 م")
    row, _, why = R.map_listing(post, {"district": "النرجس"}, [])
    assert row is None and why == "auction"


def test_a_closed_deal_is_skipped():
    post = _post(998, "شقة للإيجار", "aqar_type-for-rent",
                 "شقة في حي النرجس شمال مدينة الرياض تم الإيجار ولله الحمد")
    row, _, why = R.map_listing(post, {"district": "النرجس"}, [])
    assert row is None and why == "sold_or_rented"


def test_an_unmappable_type_is_skipped():
    post = _post(997, "عقار مميز للبيع", "aqar_type-for-sale", BODY_2693)
    row, _, why = R.map_listing(post, {"district": "النرجس"}, [])
    assert row is None and why == "type_unmapped"


def test_a_draft_is_not_published():
    post = _post(996, "فيلا للبيع", "aqar_type-for-sale", BODY_2693)
    post["status"] = "draft"
    row, _, why = R.map_listing(post, {}, [])
    assert row is None and why == "status_draft"


def test_deal_comes_from_the_taxonomy_class_and_a_missing_one_is_skipped():
    post = _post(995, "فيلا للبيع", "aqar_type-for-sale", BODY_2693)
    post["class_list"] = ["aqar", "type-aqar"]
    row, _, why = R.map_listing(post, {}, [])
    assert row is None and why == "no_deal"


# ── the transport's 200-that-is-not-data ─────────────────────────────────────────────────────────

def test_the_challenge_page_is_recognised_as_not_being_data():
    """It arrives with HTTP 200, so only the BODY can tell. If this ever returns False the scraper
    parses an interstitial as the catalogue and finalizes a green empty run."""
    assert R._is_challenge(CHALLENGE_PAGE) is True
    assert R._is_challenge('[{"id":2935,"status":"publish"}]') is False


# ── the row a placeable listing produces ─────────────────────────────────────────────────────────

def test_a_placeable_listing_maps_with_arabic_location_and_capped_photos():
    """The one ad that names its city. Only the two catalog calls are stubbed (autouse fixture) —
    every other value asserted below comes from the shipping code."""
    post = _post(2693, "شقة للإيجار", "aqar_type-for-rent", BODY_2693)
    photos = [f"https://masaraqarat.com/wp-content/uploads/2025/04/{i}-png.avif" for i in range(25)]
    row, category, why = R.map_listing(post, {"district": "النرجس", "area": "126 م"}, photos)

    assert why == "" and category == "residential"
    assert row["ad_number"] == "MSR2693"
    assert row["source"] == "مسار المستقبل"
    assert row["transaction_type"] == "Rent"
    assert row["property_type"] == "Apartment"
    assert row["city_ar"] == "الرياض" and row["city_id"] == 1 and row["region_id"] == 1
    assert row["district_ar"] == "حي النرجس"
    assert row["neighborhood"] == "النرجس"          # the SOURCE's own text, uncanonicalised
    assert row["area_m2"] == 126
    assert row["bathrooms"] == 3
    assert row["bedrooms"] is None                  # «ثلاث غرف» has no نوم → never guessed
    assert len(row["photo_urls"]) == 20             # capped, not truncated silently elsewhere
    assert row["price_annual"] is None and row.get("rent_period") is None
    assert "price_total" not in row                 # a Rent row must not carry a sale price
    assert row["additional_info"]["modified_at"] == "2025-08-26T13:39:03"
    assert row["additional_info"]["district_raw"] == "النرجس"


def test_a_buy_row_carries_price_total_and_no_rent_fields():
    body = "فيلا للبيع في حي النرجس بمدينة الرياض المساحة 400 م السعر 2 مليون ريال"
    post = _post(994, "فيلا للبيع", "aqar_type-for-sale", body)
    row, category, why = R.map_listing(post, {}, [])
    assert why == "" and category == "residential"
    assert row["transaction_type"] == "Buy"
    assert row["price_total"] == 2_000_000
    assert "price_annual" not in row and "rent_period" not in row
