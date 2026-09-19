"""عقاريون writes prices as WORDS. Every test here exists because a real listing was mis-read.

akariyoun.sa renders «السعر : 1 مليون» — the theme formats server-side from a translation table and
never prints digits in the header. Two different truths exist on the page and using the wrong one
invents a price, which PRICE = SOURCE forbids outright:

  LAND   publishes the exact riyal figure in the spec table («9766912.00») NEXT TO a rounded worded
         header («9.77 مليون»). Trusting the words writes 9,770,000 against a real 9,766,912 — a
         3,088 error WE would have created.
  BUILT  property renders «-» in that cell. Only the words exist, so they are proven against the
         site's own numeric price filter before any number is stored; a price that cannot be proven
         is stored NULL, never the approximation.

Run: python -m pytest scrapers/common/tests/test_akariyoun_price_is_never_invented.py -v
"""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import scrapers.akariyoun.run as AK  # noqa: E402
from scrapers.akariyoun.run import (  # noqa: E402
    _fold_ar, magnitude, map_listing, map_type_ar, parse_age,
    parse_bathrooms, parse_ppm, parse_price, parse_price_exact,
)

# HERMETIC (AGENTS.md, "the required suite is HERMETIC"). map_listing resolves the city/district
# against the live catalog, which would make every assertion here depend on production — and on a
# machine with no credentials it does not fail, it HANGS. These tests are about price and parsing,
# so the catalog is stubbed to fixed values; the catalog's own behaviour is not what is under test.
AK.to_catalog = lambda city_ar, region_hint=None: (1, 1)
AK.find_district_in_text = lambda text, city_id: text

# A land page: rounded words in the header, the EXACT figure in the spec table.
LAND = """<html><head><title>ارض للبيع في حي الغنامية - Akariyoun</title></head><body>
<h5 class="prt-price-fix"><span class="badge badge-success">سعر المتر للأرض</span> : 400 </h5>
<h5 class="prt-price-fix"><span class="badge badge-success">إجمالي سعر البيع</span> : 9.77 مليون </h5>
<span>الرياض - الغنامية</span> <p>المساحة: 24,417 m²</p>
<p>رقم الاعلان : 904</p><p>نوع العقار: ارض</p><p>للبيع</p>
<td><div class="small" style="color: rgb(33, 107, 194)">إجمالي سعر البيع</div> <div>9766912.00</div></td>
<a href="https://akariyoun.sa/storage/accounts-1/x/1.webp" class="mfp-gallery"><img src="x"></a>
</body></html>"""

# A built-property page: «-» in the table, so ONLY the words carry the price.
VILLA = """<html><head><title>فيلا للبيع في حي الغنامية - Akariyoun</title></head><body>
<h5 class="prt-price-fix"><span class="badge badge-success">السعر</span> : 1 مليون </h5>
<span>الرياض - الغنامية</span> <p>المساحة: 383 m²</p><p>عدد الغرف: 6 غرفة</p>
<p>رقم الاعلان : 973</p><p>نوع العقار: فيلا</p><p>للبيع</p>
<p>عمر العقار : ثمان سنوات إستخدام الأرض : سكني</p>
<p>رقم القطعة رقم المخطط رقم البلوك 2699 3022 181</p>
<td><div class="small" style="color: rgb(33, 107, 194)">إجمالي سعر البيع</div> <div>-</div></td>
<div class="agent-photo"><img src="https://akariyoun.sa/storage/accounts-4252/x/uuid-not-a-photo"></div>
<img src="https://akariyoun.sa/storage/website/logo-ar-b.webp">
<a href="https://akariyoun.sa/storage/accounts-5201/x/2.webp" class="mfp-gallery"><img src="t"></a>
<a href="https://akariyoun.sa/storage/accounts-5199/x/3.webp" class="mfp-gallery"><img src="t"></a>
</body></html>"""


# ── the exact figure always wins over the words ──────────────────────────────────────────────────
def test_land_uses_the_exact_table_figure_not_the_rounded_words():
    assert parse_price_exact(LAND) == 9766912
    row, _cat, raw = map_listing("ard-x", LAND)
    assert row["price_total"] == 9766912, "the spec table is exact; «9.77 مليون» is rounded"
    assert row["price_total"] != 9770000, "9,770,000 is the words — a 3,088 error we would invent"
    assert raw is None, "an exact figure must report NO raw text, so main() does not re-verify it"


def test_built_property_has_no_exact_figure_so_the_words_must_be_proven():
    assert parse_price_exact(VILLA) is None, "«-» is not a price"
    row, _cat, raw = map_listing("fyla-x", VILLA)
    assert row["price_total"] == 1000000
    assert raw, "a worded price MUST surface its raw text so the caller can prove it exact"


def test_an_exact_price_is_never_handed_to_the_verifier():
    """The first pilot NULLed a known-exact 3,150,000 because main() probed it anyway.
    The contract that prevents it: raw is None ⟺ the figure came from the table."""
    _row, _cat, raw_land = map_listing("ard-x", LAND)
    _row2, _cat2, raw_villa = map_listing("fyla-x", VILLA)
    assert raw_land is None and raw_villa is not None


# ── the word arithmetic itself ───────────────────────────────────────────────────────────────────
def test_magnitude_words():
    assert magnitude(1, "مليون") == 1_000_000
    assert magnitude(1.5, "مليون") == 1_500_000
    assert magnitude(800, "الف") == 800_000
    assert magnitude(800, "ألف") == 800_000
    assert magnitude(2, "مليار") == 2_000_000_000
    assert magnitude(None, "مليون") is None


def test_the_themes_translation_table_is_not_a_price():
    """The page ships `window.trans = {"million": "مليون"}` inside a <script>. If scripts were not
    stripped before reading text, that word could be picked up as a listing's price."""
    # Strip the real header price, leaving the word ONLY inside a <script>. If scripts are not
    # removed before reading text, the fallback text path picks up 999 مليون as this listing's
    # price. (parse_price prefers the header regex, so the header must be gone for this to bite.)
    no_header = VILLA.replace(
        '<h5 class="prt-price-fix"><span class="badge badge-success">السعر</span> : 1 مليون \ue900</h5>',
        '')
    poisoned = no_header.replace("<body>", '<body><script>window.trans={"million":"مليون"};'
                                           'var x="السعر : 999 مليون";</script>')
    row, _c, _r = map_listing("fyla-x", poisoned)
    got = row.get("price_total")
    assert got != 999_000_000, "a price must never come out of a <script> block"
    assert got is None, "with no published price, the answer is UNKNOWN — never a scraped artefact"


# ── price per meter is READ, never derived ───────────────────────────────────────────────────────
def test_ppm_carries_its_magnitude_word_too():
    """«9.2 مليون» per m² was stored as 9 — a millionfold understatement — because parse_ppm read
    the number and dropped the word. Found on a real listing (ard-llbyaa-fy-hy-bdr) where the
    source publishes 9.2 مليون/m² AND 4.6 مليار total for 500 m²; 9,200,000 x 500 = 4,600,000,000,
    so the page agrees with itself and only our reading was wrong."""
    big = LAND.replace('سعر المتر للأرض</span> : 400', 'سعر المتر للأرض</span> : 9.2 مليون')
    assert parse_ppm(big) == 9_200_000
    assert parse_ppm(LAND) == 400, "a plain number must still read as itself"


def test_ppm_is_read_from_the_source():
    assert parse_ppm(LAND) == 400
    row, _c, _r = map_listing("ard-x", LAND)
    assert row["price_per_meter"] == 400
    # 24,417 m² x 400 = 9,766,800, but the published total is 9,766,912. They DIFFER — proof the
    # total is read from the source and not computed from ppm x area.
    assert row["price_total"] != row["price_per_meter"] * row["area_m2"]


# ── the three parser bugs found on real pages ────────────────────────────────────────────────────
def test_district_stops_at_the_next_label():
    """Taking a fixed two words produced «الغنامية السعر» on the very first listing tested."""
    row, _c, _r = map_listing("fyla-x", VILLA)
    assert row["neighborhood"] == "الغنامية"
    row2, _c2, _r2 = map_listing("ard-x", LAND)
    assert row2["neighborhood"] == "الغنامية", "land reads «سعر المتر» next, not «السعر»"


def test_plot_plan_block_are_three_distinct_numbers():
    """The table prints three HEADERS then three VALUES, so a per-label regex returned the first
    number for every label — plot == plan == 2699."""
    row, _c, _r = map_listing("fyla-x", VILLA)
    ai = row["additional_info"]
    assert (ai["plot_no"], ai["plan_no"], ai["block_no"]) == ("2699", "3022", "181")


def test_the_riyal_icon_glyph_never_reaches_the_stored_text():
    _row, _c, raw = map_listing("fyla-x", VILLA)
    assert "" not in raw, "U+E900 is an icon font glyph, not a character"


# ── photos are scoped to the gallery, not blocklisted ────────────────────────────────────────────
def test_photos_come_only_from_the_gallery_anchor():
    row, _c, _r = map_listing("fyla-x", VILLA)
    ph = row["photo_urls"]
    assert len(ph) == 2 and all(u.endswith(".webp") for u in ph)
    assert not any("accounts-4252" in u for u in ph), "that is the AGENT avatar, not the property"
    assert not any("/storage/website/" in u for u in ph), "that is the site logo"


# ── Arabic orthography: the same word, written differently ───────────────────────────────────────
def test_alef_and_ta_marbuta_variants_map_to_the_same_type():
    """«إستراحة» (hamza-under-alef) was skipped as an unmapped type on the first pilot while
    «استراحة» mapped fine — the same word, one orthographic variant apart."""
    for variant in ("إستراحة", "استراحة", "استراحه", "اسْتراحة"):
        assert map_type_ar(variant) == "Rest House", variant
    # ...and through map_listing itself. Asserting only on the dict tested the TABLE, not the code
    # path: a mutation that reverted map_listing to the unfolded lookup left this file green.
    for variant in ("إستراحة", "استراحه"):
        page = VILLA.replace("نوع العقار: فيلا", f"نوع العقار: {variant}")
        row, _c, _r = map_listing("x", page)
        assert row is not None and row["property_type"] == "Rest House", variant


def test_an_open_age_bound_is_UNKNOWN_not_the_number():
    """Live probe 2026-09-19: «اكثر من عشر سنوات» — MORE THAN ten years — was being stored as
    exactly 10. A customer filtering «10 years or newer» would then be shown properties the source
    itself says are OLDER. 10 invents a precision the source withheld; 11 invents a different one.
    The honest answer is UNKNOWN, which the AF reports as «لم يذكر»."""
    for txt in ("اكثر من عشر سنوات", "أكثر من عشر سنوات", "اكثر من خمس سنوات"):
        assert parse_age(txt) is None, txt
    # ...and a plain count must STILL parse — the guard must not swallow ordinary ages.
    assert parse_age("عشر سنوات") == 10
    assert parse_age("ثمان سنوات") == 8


def test_age_accepts_arabic_word_numerals():
    assert parse_age("ثمان سنوات") == 8
    assert parse_age("سنتين") == 2
    assert parse_age("جديد") == 0
    assert parse_age("١٢ سنة") == 12
    assert parse_age(None) is None


def test_types_come_from_the_shared_canonical_map():
    """The first full sweep skipped 5 listings as "unmapped" for «غرفة» and «ورشة» — both of which
    normalize.TYPE_MAP_AR and known_type_ar have carried all along. A private per-scraper type list
    is a drift hazard; this pins that the shared map is what answers."""
    assert map_type_ar("غرفة") == "Room"
    assert map_type_ar("ورشة") == "Workshop"
    assert map_type_ar("مستودع") == "Warehouse"
    assert map_type_ar("فيلا") == "Villa"


def test_an_unmapped_type_is_skipped_not_guessed():
    """AMBIGUOUS-MAPPING ASK-FIRST: a type we do not know must not fall into the nearest bucket."""
    weird = VILLA.replace("نوع العقار: فيلا", "نوع العقار: قبو")
    row, _c, _r = map_listing("x", weird)
    assert row is None


# ── source truth: an unmentioned service is UNKNOWN, not absent ───────────────────────────────────
def test_unmentioned_services_are_null_never_false():
    row, _c, _r = map_listing("fyla-x", VILLA)
    assert row["electricity"] is None and row["water_supply"] is None, \
        "SOURCE IS TRUTH — silent means NULL, never a confirmed 'no'"


# ── bathrooms: the stated TOTAL, never a per-floor fragment ───────────────────────────────────────
# Live probe 2026-09-19: عقاريون publishes bathrooms in the free-text «عبارة عن» blurb on 37 of 75
# real pages, and the scraper stored 0. These are the exact shapes found on those pages.

# Real page fyla-llaygar-fy-hy-alshaf-4: a 3-storey villa. Reading the FIRST inline mention stores
# 3 for a house the seller says has 9. This is the case that motivated the parser.
_VILLA_3_FLOORS = ("عبارة عن : الدور الأرضي : ملحق خارجي - مجلس - مقلط - صالة واسعة - مطبخ - "
                   "3 دورات مياه الدور الأول : 4 غرف نوم ثلاثة منهم ماستر - صالة - 4 دورات مياه "
                   "الدور الثاني : 2 غرف نوم ماستر - سطح - 2 دورات مياه . عدد دورات المياه : 9 "
                   "- مطبخ راكب - 10 مكيفات سبيلت")


def test_bathrooms_uses_stated_total_not_the_first_floor():
    assert parse_bathrooms(_VILLA_3_FLOORS) == 9, \
        "the seller states 9; 3 is only the ground floor"


def test_bathrooms_are_never_summed():
    # 3+4+2 == 9 here by coincidence of this listing. Prove the 9 comes from the LABEL by removing
    # the label: with only per-floor fragments left, the honest answer is UNKNOWN, not 9.
    no_label = _VILLA_3_FLOORS.split("عدد دورات المياه")[0]
    assert parse_bathrooms(no_label) is None, \
        "summing per-floor figures would manufacture a total the source never stated"


def test_bathrooms_reads_the_second_label_word():
    # 12 of the 75 real pages use «مجموع» rather than «عدد» — missing it loses a third of coverage.
    assert parse_bathrooms("مطبخ - 3 دورات مياه الدور الثاني : دورة مياه . مجموع دورات المياه : 4") == 4


def test_bathrooms_lone_inline_mention_is_the_total():
    assert parse_bathrooms("عبارة عن : 2 غرف نوم - صالة - مطبخ - 2 دورة مياه") == 2


def test_bathrooms_accepts_the_arabic_dual_and_word_numerals():
    assert parse_bathrooms("عبارة عن : 2 غرف نوم - صالة - دورتين مياه") == 2
    assert parse_bathrooms("مجموع دورات المياه : ثلاث") == 3


def test_bathrooms_accept_arabic_indic_digits():
    assert parse_bathrooms("عدد دورات المياه : ٣") == 3


def test_bathrooms_silent_page_is_null_never_zero():
    assert parse_bathrooms("عبارة عن : 3 غرف نوم - صالة - مطبخ") is None, \
        "SOURCE IS TRUTH — a page that does not mention bathrooms is UNKNOWN, not 'has none'"
    assert parse_bathrooms("") is None and parse_bathrooms(None) is None


def test_bathrooms_conflicting_totals_are_unknown():
    assert parse_bathrooms("عدد دورات المياه : 3 ... مجموع دورات المياه : 5") is None, \
        "two disagreeing totals must not be silently picked between"


def test_bathrooms_large_apartment_building_total_is_kept():
    # Real page aamar-llaygar-fy-hy-almsfa: «30 غرفة 20 دورة مياه». 20 is genuinely the total.
    assert parse_bathrooms("عمارة 30 غرفة 20 دورة مياه سطح واسع عدد دورات المياه : 20") == 20


def test_bathrooms_reach_the_row():
    row, _c, _r = map_listing("fyla-x", VILLA.replace("</body>",
                              "<p>عدد دورات المياه : 4</p></body>"))
    assert row["bathrooms"] == 4, "the parsed count must actually be written to the row"


def test_bathrooms_implausible_count_is_unknown():
    # The count pattern reads up to two digits, so a stray figure sitting next to the phrase
    # («الشارع 60 ... دورات مياه») could otherwise be stored as a room count. Above a plausible
    # ceiling the honest answer is UNKNOWN, not a number we would have invented.
    assert parse_bathrooms("عدد دورات المياه : 99") is None
    assert parse_bathrooms("عدد دورات المياه : 50") == 50      # ceiling itself still real


# ── street width: «عرض الشارع», never the ad-form's own default ───────────────────────────────────
# Live probe 2026-09-19: 272 of 276 stored listings carried street_width_m = 3, because every
# عقاريون listing page also renders the site's AD-CREATION FORM, which contains the literal
# «الشارع 3». A bare «شارع N» fallback matched it on 40 of 40 sampled pages.
_AD_FORM_CHROME = ("الشارع 3 اختيار من الخريطة يرجى اختيار نوع الإعلان الذي تريد إنشاؤه "
                   "اعلان بيع اعلان ايجار")


def _street(page_text: str):
    """The real mapper's street-width read, executed — never a copy of it."""
    row, _c, _r = map_listing("shk-x", VILLA.replace("</body>", f"<p>{page_text}</p></body>"))
    return row["street_width_m"]


def test_street_width_ignores_the_ad_creation_form():
    assert _street(_AD_FORM_CHROME) is None, \
        "«الشارع 3» belongs to the site's own ad form — it is not this property's street"


def test_street_width_reads_the_published_field():
    assert _street("كهرباء, مياه عرض الشارع 20 الضمانات ومدة صلاحيتها -") == 20


def test_street_width_prefers_the_field_over_the_chrome_on_the_same_page():
    # Both strings appear on every real page. The published field must win, not the form default.
    assert _street(f"{_AD_FORM_CHROME} عرض الشارع 15 الضمانات") == 15, \
        "a page carries both; 3 is the form, 15 is the listing"


def test_street_width_unpublished_dash_is_null_never_a_number():
    assert _street("كهرباء, مياه عرض الشارع - الضمانات ومدة صلاحيتها -") is None, \
        "«-» means the seller did not publish it — SOURCE IS TRUTH, that is UNKNOWN"


def test_street_width_accepts_arabic_indic_digits():
    assert _street("عرض الشارع ٢٠") == 20
