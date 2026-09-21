"""Offline barrier for scrapers/gomenassat/run.py — the six traps this source actually sets.

Every fixture below is REAL gomenassat payload harvested from the live site on 2026-09-20: the
`offers` arrays are verbatim rows from POST /ar/get_offers, and the HTML fragments are verbatim
slices of /ar/offer/803 (a live chalet), /ar/offer/800 (a villa with a real total) and /ar/offer/152
(a DELETED offer that still serves HTTP 200). Nothing here is a shape this repo invented, and the
functions under test are the production ones — only to_catalog / find_district_in_text are stubbed,
because they resolve against the city/district tables and a barrier gets no database.

WHAT IT PINS
  1. AREA: this field's comma is a decimal point on «240,16» and a thousands separator on «16,065».
     normalize.to_int() drops every comma by contract, so it answers 24,016 m² for a 240 m² shop — a
     100× area on the card and in the area filter. _area_m2() is why; these goldens keep it that way,
     and pin to_int's answer beside it so nobody "simplifies" the local parser away.
  2. AREA: «مساحات متعددة» / «من 300م2 إلى 360م2» / «1341 -684» state a RANGE or a set, not an area.
     NULL, never an endpoint — an endpoint would answer an exactly-300 filter the source never met.
  3. PRICE: a bare figure this source does not publish as a total (1, 80, 170, 4,500…) is NOT stored
     as one, is NOT multiplied by the area into an invented total, and is NOT lost either — it lands
     in additional_info.source_price_figure with price_note="unit_ambiguous".
  4. PERIOD: never defaulted. Stated in the title → mapped. Not stated → NULL, figure unconverted.
     And the DESCRIPTION is not a period statement: «الدخل السنوي 350 الف ريال» is a building's
     annual income, and reading it produced 12 wrong periods out of 145 live rows.
  5. AMENITIES: silence stays NULL. The spec grid's «مؤثث: لا» / «مكيفات: لا» / «يوجد مواقف: 0» are
     unset-column defaults that render on bare land too, so they must never become False; and
     «مصعد مؤسس» (prepared only) and «قريب من حديقة» (the neighbourhood's) stay NULL, not True.
  6. SKIPS: «تم البيع»/«تم الإيجار» (already transacted), «مزاد» (auction) and «استثمار» (states
     neither sale nor lease) produce no row, each with its own reason so an empty run says why.
  7. A DELETED OFFER SERVES 200. parse_detail decides on the body, not the status code.
  8. PHOTOS are scoped to <section id="slider">: the sibling «عروض أخرى قريبة» cards use the same
     /uploads/offers/ path, and the «تحميل ملف المشروع» PDF lives there too.
"""
from __future__ import annotations

import sys
import types

import pytest

# ── Stub supabase + dotenv so the import chain stays hermetic (house pattern) ────────────────────
_supabase_mod = types.ModuleType("supabase")


class _StubClient:  # pragma: no cover - never called
    pass


_supabase_mod.Client = _StubClient
_supabase_mod.create_client = lambda url, key: _StubClient()
sys.modules.setdefault("supabase", _supabase_mod)

_dotenv_mod = types.ModuleType("dotenv")
_dotenv_mod.load_dotenv = lambda *a, **k: None
sys.modules.setdefault("dotenv", _dotenv_mod)

from scrapers.common import normalize  # noqa: E402
from scrapers.gomenassat import run as R  # noqa: E402


@pytest.fixture(autouse=True)
def _catalog(monkeypatch):
    """Only the DB lookups are stubbed. الرياض resolves; «سدير» (an area the source lists as a city)
    does not, so the city_not_in_catalog skip path stays reachable."""
    monkeypatch.setattr(R, "to_catalog",
                        lambda city_ar, hint=None: ((1, 100) if city_ar == "الرياض" else (None, None)))
    monkeypatch.setattr(R, "find_district_in_text",
                        lambda text, city_id: (text.strip() if text and city_id else None))


# ── real /ar/offer/803 fragments (live chalet, price figure 170, 2 gallery photos) ───────────────
_SLIDER_803 = """<section id="slider" class="slider-element include-header">
        <div class="property-gallery-grid items-2" data-lightbox="gallery">
            <div class="gallery-grid-item main-image">
                <a href="https://gomenassat.com/uploads/offers/17898907711.webp" data-lightbox="gallery-item">
                    <img src="https://gomenassat.com/uploads/offers/17898907711.webp" alt="Main Image">
                </a>
            </div>
                    <div class="gallery-grid-item secondary-image">
                        <a href="https://gomenassat.com/uploads/offers/17898906770.webp" data-lightbox="gallery-item">
                            <img src="https://gomenassat.com/uploads/offers/17898906770.webp" alt="Image 0">
                        </a>
                    </div>
        </div>
    </section>"""

# Verbatim: the four spec rows are template defaults on EVERY listing, land included.
_SPECS = """<h4 class="mb-0 mt-5">المواصفات</h4>
    <div class="row"><div class="col-md-4"><ul class="iconlist">
      <li class="mb-1"><i class="bi-check-circle"></i>تاريخ البناء: 2026-09-21</li>
      <li class="mb-1"><i class="bi-check-circle"></i>المساحة: 869.61م م².</li>
      <li class="mb-1"><i class="bi-check-circle"></i>الغرف: {rooms}</li>
    </ul></div><div class="col-md-4"><ul class="iconlist">
      <li class="mb-1"><i class="bi-check-circle"></i>يوجد مواقف: 0</li>
      <li class="mb-1"><i class="bi-check-circle"></i>رقم الدور: </li>
    </ul></div><div class="col-md-4"><ul class="iconlist">
      <li class="mb-1"><i class="bi-check-circle"></i>مؤثث: لا</li>
      <li class="mb-1"><i class="bi-check-circle"></i>مكيفات: لا</li>
    </ul></div></div>
    <p>{desc}</p>
    <div class="widget"><h4>الموقع على الخريطة</h4><iframe src="x"></iframe></div>"""

# The sibling «عروض أخرى قريبة» cards and the project PDF, both outside the slider section.
_SIBLINGS = """<h4>عروض أخرى قريبة</h4>
    <a href="https://gomenassat.com/uploads/offers/16816383680.pdf">تحميل ملف المشروع</a>
    <img src="https://gomenassat.com/uploads/offers/17890310921.webp" alt="sibling card">
    <a href="https://gomenassat.com/uploads/offers/17889466880.webp">sibling</a>"""

_GONE_152 = ("<html><body><h1>نأسف!</h1><p>هذه الصفحة غير متوفرة</p>"
             "<a href=\"https://gomenassat.com/ar/offers\">العروض</a></body></html>")


def _page(price: str = "170", rooms: str = "", desc: str = "شاليه على شارعين.") -> str:
    tag = (f'<div class="price-tag">\n  {price}\n  <span class="currency">ر.س</span>\n</div>'
           if price is not None else "")
    return ("<html>" + tag + _SLIDER_803 + _SPECS.format(rooms=rooms, desc=desc)
            + _SIBLINGS + "</html>")


# Verbatim `offers` rows from POST /ar/get_offers.
OFFER_803 = [803, "شاليه للايجار السنوي حي بنبان", "استراحة", "24.977185995180076",
             "46.57496354418089", "869.61م", "للإيجار", "منطقة الرياض", "الرياض", "بنبان"]
OFFER_800 = [800, "فيلا حي الأجاويد", "فيلا", "21.402377029312284", "39.30618815767236",
             "750", "للبيع", "مكة المكرمة", "الرياض", "الاجاويد"]
OFFER_153_SOLD = [153, "عمارة الديرة للبيع", "عمارة", "24.63", "46.71", "240,16", "تم البيع",
                  "منطقة الرياض", "الرياض", "الديرة "]
OFFER_741_INVEST = [741, "ارض صناعية طريق الخرج للاستثمار", "ارض", "24.5", "46.9", "10,000",
                    "استثمار", "منطقة الرياض", "الرياض", "هيت"]
OFFER_802_FIG1 = [802, "مكتب للايجار حي حطين", "مكتب", "24.75", "46.61", "972", "للإيجار",
                  "منطقة الرياض", "الرياض", "حطين"]


# ── 1 + 2. area ──────────────────────────────────────────────────────────────────────────────────
@pytest.mark.parametrize("raw,expected", [
    ("240,16", 240),            # DECIMAL comma — the shop that to_int() calls 24,016 m²
    ("706,25", 706),            # decimal comma
    ("16,065", 16065),          # THOUSANDS comma, same field, same character
    ("13,885", 13885),
    ("17,983.97", 17983),       # both separators at once
    ("1,791,703.02م", 1791703),
    ("869.61م", 869),
    ("٢٠٠٢م", 2002),            # Arabic-Indic digits are real digits
    ("م4583.07", 4583),
    ("م  147.13", 147),
    ("652l", 652),              # stray latin letter on the live value
    ("1050 م²", 1050),
    ("1600م2", 1600),
])
def test_area_is_parsed_from_the_source_string(raw, expected):
    assert R._area_m2(raw) == expected


def test_to_int_is_why_the_local_area_parser_exists():
    """Pins the shared helper's contract, so the local parser can never be "simplified" back to it.

    to_int() is CORRECT for this repo's prices (comma == thousands, always). It is wrong for THIS
    field, which overloads the comma, and that is the whole reason _area_m2 exists."""
    assert normalize.to_int("240,16") == 24016          # 100× the real 240.16 m²
    assert R._area_m2("240,16") == 240
    assert normalize.to_int("16,065") == R._area_m2("16,065") == 16065


@pytest.mark.parametrize("raw", [
    "مساحات متعددة", "مساحات مختلفة", "متنوعه", "متعددة",
    "من 300م2 إلى 360م2",                                  # a range is not a value
    "مساحات متعددة من 662.5م الى 881م",
    "تبدا من m102",                                        # a floor is not the area
    "1341 -684",
    "مساحة المعرض 68م إجمالي مساحة المعارض : 204م2",       # two areas in prose
    "_", "", None, "0 م².",                                # 0 m² is not an area
])
def test_area_without_a_single_stated_value_is_null(raw):
    assert R._area_m2(raw) is None


# ── 3. price ─────────────────────────────────────────────────────────────────────────────────────
def test_a_small_published_figure_is_stored_exactly_never_hidden():
    """Owner 2026-08-03: no plausibility floor, high or low. «170 ر.س» on the page is 170 on the card."""
    detail = R.parse_detail(_page(price="170"))
    assert detail["price_figure"] == 170
    row, cat, why = R.map_listing(OFFER_803, detail)
    assert why == "" and row["rent_period"] == "annual"
    assert row["price_annual"] == 170
    for k, v in row.items():
        assert v != 170 * (row["area_m2"] or 1), f"{k} looks like an invented ppm x area total"


def test_the_figure_one_is_stored_as_published():
    detail = R.parse_detail(_page(price="1"))
    row, _, why = R.map_listing(OFFER_802_FIG1, detail)
    assert why == ""
    assert (row.get("price_annual") or row.get("price_total")) == 1


def test_a_real_published_total_is_stored_exactly_as_published():
    detail = R.parse_detail(_page(price="2,600,000"))
    row, cat, why = R.map_listing(OFFER_800, detail)
    assert why == "" and cat == "residential"
    assert row["transaction_type"] == "Buy"
    assert row["price_total"] == 2600000            # not rounded, not scaled, not re-derived
    assert row.get("price_annual") is None
    assert "price_note" not in row["additional_info"]


# ── 4. rent period ───────────────────────────────────────────────────────────────────────────────
def test_a_period_stated_in_the_title_is_mapped():
    row, _, _ = R.map_listing(OFFER_803, R.parse_detail(_page(price="120,000")))
    assert row["rent_period"] == "annual"           # «للايجار السنوي»
    assert row["price_annual"] == 120000


def test_a_period_the_source_never_states_is_never_defaulted():
    offer = list(OFFER_803)
    offer[1] = "شاليه للايجار حي بنبان"             # same ad, period word removed
    row, _, _ = R.map_listing(offer, R.parse_detail(_page(price="120,000")))
    assert row.get("rent_period") is None
    assert row["price_annual"] == 120000            # unconverted: NOT 120000 * 12


@pytest.mark.parametrize("title", ["شقة للايجار نصف سنوي", "محل للايجار ربع سنوي",
                                   "شاليه للايجار الليلة", "استراحة للايجار يومي"])
def test_a_stated_period_with_no_annual_bucket_is_never_read_as_annual(title):
    """«نصف سنوي» contains «سنوي»: substring-matching it prints a 6-month rent as the year's."""
    offer = list(OFFER_803)
    offer[1] = title
    row, _, _ = R.map_listing(offer, R.parse_detail(_page(price="60,000")))
    assert row.get("rent_period") is None and row.get("price_annual") is None
    assert row["additional_info"]["source_price_figure"] == 60000
    assert row["additional_info"]["price_note"] == "period_not_annualizable"


def test_a_word_containing_layla_is_not_a_nightly_period():
    offer = list(OFFER_803)
    offer[1] = "شقة للايجار مساحة قليلة"
    row, _, _ = R.map_listing(offer, R.parse_detail(_page(price="30,000")))
    assert row.get("rent_period") is None and row["price_annual"] == 30000


def test_an_annual_income_sentence_in_the_description_is_not_a_rent_period():
    """The 12-wrong-periods regression: «الدخل السنوي للعمارة 350 الف ريال» describes a building's
    income, not the term of this lease."""
    offer = list(OFFER_803)
    offer[1] = "عمارة العويمرية للايجار"
    detail = R.parse_detail(_page(price="350,000",
                                 desc="الدخل السنوي للعمارة 350 الف ريال وعائدها 12% وعدد الشقق 21"))
    row, _, _ = R.map_listing(offer, detail)
    assert row.get("rent_period") is None
    assert row["price_annual"] == 350000


# ── 5. amenities ─────────────────────────────────────────────────────────────────────────────────
def test_the_template_spec_defaults_never_become_false():
    """«مؤثث: لا», «مكيفات: لا» and «يوجد مواقف: 0» render on all 256 offers, bare land included."""
    detail = R.parse_detail(_page(desc="أرض على شارعين."))
    row, _, _ = R.map_listing(OFFER_803, detail)
    assert row.get("furnished") is None
    assert row.get("air_conditioner") is None
    assert row.get("parking") is None
    # absent, not present-and-false — an upsert of False would assert an unfurnished plot of land
    assert "furnished" not in row and "air_conditioner" not in row and "parking" not in row


def test_amenity_prose_keeps_all_four_outcomes():
    def amen(desc):
        return R.map_listing(OFFER_803, R.parse_detail(_page(desc=desc)))[0]
    assert amen("فيلا مفروشة")["furnished"] is True                  # named
    assert amen("غير مفروشة")["furnished"] is False                  # negated
    assert "elevator" not in amen("مصعد مؤسس")                       # prepared only -> NULL
    assert amen("قريب من حديقة").get("garden") is None               # the neighbourhood's -> NULL


def test_zero_rooms_is_an_unset_column_not_a_bedroom_count():
    assert R.parse_detail(_page(rooms="0"))["rooms"] is None
    row, _, _ = R.map_listing(OFFER_803, R.parse_detail(_page(rooms="0")))
    assert row.get("bedrooms") is None


def test_rooms_are_not_read_as_bedrooms_on_a_non_dwelling():
    detail = R.parse_detail(_page(rooms="53"))
    assert detail["rooms"] == 53
    row, cat, _ = R.map_listing(OFFER_802_FIG1, detail)          # مكتب -> Office, Commercial
    assert cat == "commercial"
    assert row.get("bedrooms") is None                          # 53 rooms in a tower, not 53 beds
    assert row["additional_info"]["source_rooms"] == 53          # kept, not discarded


# ── 6. skips ─────────────────────────────────────────────────────────────────────────────────────
def test_an_already_transacted_ad_is_skipped():
    row, _, why = R.map_listing(OFFER_153_SOLD, R.parse_detail(_page(price="1,272,848")))
    assert row is None and why == "already_transacted"


def test_an_auction_is_skipped():
    offer = list(OFFER_800)
    offer[1] = "مزاد علني على أرض حي الأجاويد"
    row, _, why = R.map_listing(offer, R.parse_detail(_page(price="2,600,000")))
    assert row is None and why == "auction"


def test_a_purpose_that_states_neither_sale_nor_lease_is_skipped_not_guessed():
    row, _, why = R.map_listing(OFFER_741_INVEST, R.parse_detail(_page(price="5,000,000")))
    assert row is None and why.startswith("purpose_unmapped")
    assert "استثمار" in why                                   # the reason names the source's word


def test_a_city_the_catalog_cannot_place_is_skipped_not_guessed():
    offer = list(OFFER_800)
    offer[8] = "سدير"                                          # the source lists an area as a city
    row, _, why = R.map_listing(offer, R.parse_detail(_page(price="2,600,000")))
    assert row is None and why == "city_not_in_catalog"


# ── 7 + 8. soft 404 and photo scoping ────────────────────────────────────────────────────────────
def test_a_deleted_offer_serving_http_200_is_not_a_listing():
    assert R.parse_detail(_GONE_152) is None


def test_photos_come_only_from_the_gallery_and_exclude_the_project_pdf():
    detail = R.parse_detail(_page())
    assert detail["photo_urls"] == [
        "https://gomenassat.com/uploads/offers/17898907711.webp",
        "https://gomenassat.com/uploads/offers/17898906770.webp",
    ]
    blob = " ".join(detail["photo_urls"])
    assert ".pdf" not in blob
    assert "17890310921" not in blob and "17889466880" not in blob   # sibling cards
    assert detail["project_pdf"].endswith("16816383680.pdf")


def test_an_entity_escaped_href_is_unescaped():
    page = _page().replace("17898906770.webp", "17898906770.webp?v=1&amp;s=2")
    urls = R.parse_detail(page)["photo_urls"]
    assert not any("&amp;" in u for u in urls)


# ── row shape ────────────────────────────────────────────────────────────────────────────────────
def test_row_carries_the_identity_and_arabic_columns_the_index_needs():
    row, cat, _ = R.map_listing(OFFER_803, R.parse_detail(_page(price="120,000")))
    assert row["ad_number"] == "MNS803"
    assert row["listing_url"] == "https://gomenassat.com/ar/offer/803"
    assert row["source"] == "منصات" and row["active"] is True
    assert row["city_ar"] == "الرياض" and row["city"] == "Riyadh"
    assert row["city_id"] == 1 and row["region_id"] == 100
    assert row["district_ar"] == "بنبان" and row["neighborhood"] == "بنبان"
    assert row["property_type"] == "Rest House" and cat == "residential"
    assert row["area_m2"] == 869
    assert row["additional_info"]["source_area_raw"] == "869.61م"
