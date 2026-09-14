"""سوار العقارية (suwar.sa): the five judgement calls this source forces, each pinned to a
measurement taken over ALL 167 live listings on 2026-09-14 — not a sample, not a guess.

Every fixture below is a verbatim shape from the live site.

Run: python -m pytest scrapers/common/tests/test_suwar_source_truth.py -v
"""
from __future__ import annotations

import sys
import types
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[3]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
sys.modules.setdefault("scrapers.common.db", types.ModuleType("scrapers.common.db"))

import scrapers.common.arabic_location as _al  # noqa: E402

_MECCA, _JEDDAH = 6, 18
_CATALOG = {_MECCA: ["حي ولي العهد", "حي بطحاء قريش", "حي الحرم", "حي السلامة"],
            _JEDDAH: ["حي السلامة"]}

from scrapers.suwar import run as R  # noqa: E402


@pytest.fixture(autouse=True)
def _seed_catalog(monkeypatch):
    """Seed the REAL matcher with a slice of the REAL catalog, keyed the way PRODUCTION keys it
    (norm_district_tok, not norm_ar — see test_norm_district_tok_mirrors_sql.py).

    Scoped through monkeypatch, NOT assigned at module import: these tests share one pytest process
    with the whole scrapers/common/tests suite, and a module-level `_al.to_catalog = …` leaked into
    test_arabic_location_resolve.py and test_region_label_is_not_a_city.py and failed 9 of their
    cases. Everything here is undone after each test.
    """
    monkeypatch.setitem(_al._CITY, "_stub_", [(1, 1)])
    for cid, districts in _CATALOG.items():
        monkeypatch.setitem(_al._DISTRICT_BY_CITY, cid,
                            {_al.norm_district_tok(d) for d in districts})
        for d in districts:
            monkeypatch.setitem(_al._DISTRICT_AR_BY_NORM, _al.norm_district_tok(d), d)
    monkeypatch.setattr(R, "to_catalog", lambda city_ar, region_hint=None: {
        "مكة": (_MECCA, 2), "مكة المكرمة": (_MECCA, 2), "جدة": (_JEDDAH, 2)
    }.get(city_ar, (None, None)))


def _post(pid=22413, title="مشروع رقم 709 فيلا تمليك الموقع ولي العهد 6", features=(), photo=True):
    emb = {"wp:term": [[{"taxonomy": "property_feature", "name": f} for f in features]]}
    if photo:
        emb["wp:featuredmedia"] = [{"source_url": "https://suwar.sa/wp-content/uploads/2026/07/708-01.jpg"}]
    return {"id": pid, "link": f"https://suwar.sa/property/p-{pid}/",
            "title": {"rendered": title}, "content": {"rendered": "<p>وصف</p>"}, "_embedded": emb}


def _detail(price="1,200,000", status="متاح", address="مكة, Saudi Arabia", text=""):
    return {"price": R._price_to_int(price) if price is not None else None,
            "status": status, "address": address, "text": text}


# ── 1. PRICE = the structured span, never the prose ─────────────────────────────────────────────
# The prose writes money in words and Arabic-Indic digits and often quotes TWO figures. The site
# has already resolved all of that into the span; re-deriving from prose would manufacture numbers.
def test_price_comes_from_the_span_even_when_the_prose_says_something_else():
    prose = "المساحه / ٣٠٧ متر السعر / مليون و ٣٥٠ الف السعر الاماميه / 630,000"
    row, _ = R.map_listing(_post(), _detail(price="1,350,000", text=prose))
    assert row["price_total"] == 1350000, "the span is the price; the prose is never parsed for money"


@pytest.mark.parametrize("raw,expected", [
    ("1,200,000", 1200000),
    ("2,600,000", 2600000),
    ("580000", 580000),
    # RECOVERABLE — a misplaced comma. Every group after the first is still 3 digits.
    ("1500,000", 1500000),
    ("1300,000", 1300000),
    ("1250,000", 1250000),
    # UNREADABLE — a missing digit. «640,00» is 640,000 or 64,000 and nothing decides which.
    ("640,00", None),
    ("650,00", None),
    ("1,50,0000", None),
])
def test_a_malformed_price_is_null_not_a_rescued_number(raw, expected):
    assert R._price_to_int(raw) == expected


def test_the_unreadable_price_does_not_throw_the_listing_away():
    # Withhold the number, keep the listing: photo/district/area are still perfectly good.
    row, _ = R.map_listing(_post(), _detail(price="640,00", text="المساحة / 108 م"))
    assert row is not None and row["price_total"] is None
    assert row["area_m2"] == 108 and row["photo_urls"], "only the number is withheld"


# ── 2. CITY is read from the source's own address line, never defaulted to مكة ───────────────────
# The site's WhatsApp button is hardcoded to 'مكة' on all 167 pages, and حي السلامة exists in BOTH
# cities — defaulting would file the one Jeddah listing under Mecca and match the wrong district.
def test_the_one_jeddah_listing_is_not_swallowed_by_the_mecca_default():
    row, _ = R.map_listing(_post(title="شقق للبيع في مدينة جدة – حي السلامة"),
                           _detail(address="حي السلامة, جدة, Saudi Arabia"))
    assert row["city_ar"] == "جدة" and row["city_id"] == _JEDDAH
    assert row["district_ar"] == "حي السلامة"


def test_mecca_listings_still_resolve_to_mecca():
    row, _ = R.map_listing(_post(), _detail(address="مكة, Saudi Arabia"))
    assert row["city_ar"] == "مكة" and row["city_id"] == _MECCA


def test_an_unreadable_address_leaves_the_city_null_rather_than_guessing():
    row, _ = R.map_listing(_post(), _detail(address=None))
    assert row["city_ar"] is None and row["city_id"] is None and row["district_ar"] is None


# ── 3. DISTRICT from the title, NEVER from the description ──────────────────────────────────────
# «داخل حد الحرم» ("inside the Haram boundary") is printed on about half the ads as a religious
# qualifier. Reading the description raised resolution 85%→93% and every one of those 14 extra
# hits was that phrase being read as Mecca's real حي الحرم.
def test_the_haram_boundary_phrase_in_the_description_never_becomes_a_district():
    prose = ("6 غرف + صالة + مطبخ + 4 دورات مياه ✏️ داخل حد الحرم 🕋 ✏️ ضمان على الهيكل الإنشائي")
    row, _ = R.map_listing(_post(title="مشروع رقم 759 شقق تمليك الموقع مكة"), _detail(text=prose))
    assert row["district_ar"] is None, (
        "«داخل حد الحرم» is a boundary qualifier in marketing prose, not the district حي الحرم")


def test_a_district_stated_in_the_title_is_resolved_to_the_catalog_spelling():
    row, _ = R.map_listing(_post(title="مشروع رقم 725 شقق تمليك الموقع حي بطحاء قريش"), _detail())
    assert row["district_ar"] == "حي بطحاء قريش"


def test_the_developers_trailing_project_number_never_leaks_into_the_district():
    # «ولي العهد 6» is the developer's phase number, not part of the district name.
    row, _ = R.map_listing(_post(title="مشروع رقم 709 فيلا تمليك الموقع ولي العهد 6"), _detail())
    assert row["district_ar"] == "حي ولي العهد"
    assert not any(ch.isdigit() for ch in row["district_ar"]), "no digit may reach a district name"


# ── 4. «غير متاح» is inactive, not absent ───────────────────────────────────────────────────────
# 63 of the 167 are sold/withdrawn. Storing them inactive (rather than dropping) means a flip back
# is not a brand-new listing, and a flip away is deactivated by the source's own statement.
@pytest.mark.parametrize("status,active", [
    ("متاح", True),
    ("غير متاح", False),      # CONTAINS «متاح» — a naive `in` test would call this available
    (None, True),             # status silent → the listing is not presumed dead
])
def test_availability_is_read_from_the_source_statement(status, active):
    row, _ = R.map_listing(_post(), _detail(status=status))
    assert row["active"] is active
    if status:
        assert row["additional_info"]["source_status"] == status


# ── 5. TYPE and DEAL are stated, never assumed ──────────────────────────────────────────────────
@pytest.mark.parametrize("title,expected", [
    ("مشروع رقم 709 فيلا تمليك الموقع ولي العهد", "Villa"),
    ("مشروع رقم 709 فبلا تمليك الموقع ولي العهد", "Villa"),   # the site's own typo, ف-ب-لا
    ("مشروع رقم 704 شقق تمليك الموقع ولي العهد", "Apartment"),
    ("مشروع رقم 704 ؤشقق تمليك الموقع ولي العهد", "Apartment"),  # and its other typo
])
def test_the_sites_own_type_spellings_including_typos(title, expected):
    row, _ = R.map_listing(_post(title=title), _detail())
    assert row["property_type"] == expected


def test_an_unmapped_type_is_skipped_not_guessed():
    row, _ = R.map_listing(_post(title="مشروع رقم 1 مبنى تمليك الموقع ولي العهد"), _detail())
    assert row is None


def test_the_deal_may_be_stated_on_the_page_when_the_title_omits_it():
    # 18 of 167 omit or misspell it in the title; reading the page is a READ, not a default.
    row, _ = R.map_listing(_post(title="فيلا دورين وملحق منفصلة بمدينة مكة ولي العهد 6"),
                           _detail(text="فيلا للتمليك المساحة / 300 م"))
    assert row is not None and row["transaction_type"] == "Buy"


def test_a_listing_that_states_the_deal_NOWHERE_is_skipped():
    # Measured: 17 of 167. The platform is never assumed to be Buy just because it usually is.
    row, _ = R.map_listing(_post(title="فيلا دورين وملحق منفصلة بمدينة مكة ولي العهد 6"),
                           _detail(text="فيلا دورين المساحة / 300 م"))
    assert row is None


# ── area / rooms: every spelling this source actually uses ──────────────────────────────────────
@pytest.mark.parametrize("text,area", [
    ("المساحة / 300 م", 300),
    ("المساحه / 155 م", 155),          # ه not ة
    ("مساحة / 196 م أمامية", 196),     # no «ال»
    ("المساحه : 200م", 200),           # colon
    ("المساحه / ٣٠٧ متر", 307),        # Arabic-Indic digits
    ("لا يوجد", None),
])
def test_area_spellings(text, area):
    row, _ = R.map_listing(_post(), _detail(text=text))
    assert row["area_m2"] == area


def test_plot_and_built_up_are_both_kept_and_area_is_the_plot():
    row, _ = R.map_listing(_post(), _detail(text="مساحة الأرض / 200م مساحة البناء / 380 م"))
    assert row["area_m2"] == 200, "«المساحة» for a Saudi villa is the plot — that is what buyers filter on"
    assert row["additional_info"]["area_land_m2"] == 200
    assert row["additional_info"]["area_built_m2"] == 380, "nothing the source published is lost"


def test_rooms_are_read_into_the_REAL_column_names():
    # `halls` and `reception_rooms_majlis` — NOT `living_rooms`/`majlis_rooms`, which exist only on
    # the SEARCH INDEX. Writing the index's names broke suwar's first production run with PGRST204
    # (see test_scraper_rows_only_use_real_columns.py).
    row, _ = R.map_listing(_post(), _detail(text="الغرف / 5 الصالات / 3 المجالس / 2 دورات المياه / 6"))
    assert (row["bedrooms"], row["halls"], row["bathrooms"]) == (5, 3, 6)
    assert row["reception_rooms_majlis"] == 2
    assert "living_rooms" not in row and "majlis_rooms" not in row
    bare, _ = R.map_listing(_post(), _detail(text="فيلا جميلة"))
    assert bare["bedrooms"] is None and bare["bathrooms"] is None, "silence is NULL, never 0"


# ── amenities: a mapped term sets a column, an unmapped one is preserved, absence stays NULL ─────
def test_features_map_to_columns_and_unmapped_ones_survive_verbatim():
    row, _ = R.map_listing(_post(features=("مصعد", "غرفة سائق", "ضمان على الهيكل الإنشائي")), _detail())
    assert row["elevator"] is True and row["driver_room"] is True
    assert row.get("parking") is None, "an absent amenity stays NULL, never False"
    assert "ضمان على الهيكل الإنشائي" in row["additional_info"]["features_ar"], (
        "a warranty describes the CONTRACT, not the unit — kept verbatim rather than forced to a column")


def test_the_listing_url_is_the_sources_own_link_verbatim():
    post = _post()
    row, _ = R.map_listing(post, _detail())
    assert row["listing_url"] == post["link"], "never a reconstructed or shortened URL (404 incident)"


def test_photos_are_captured():
    row, _ = R.map_listing(_post(photo=True), _detail())
    assert row["photo_urls"] == ["https://suwar.sa/wp-content/uploads/2026/07/708-01.jpg"]
    bare, _ = R.map_listing(_post(photo=False), _detail())
    assert bare["photo_urls"] == [], "no photo at source stays empty, never a placeholder"
