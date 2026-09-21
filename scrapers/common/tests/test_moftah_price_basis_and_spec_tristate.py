"""moftah's two P0s: a per-metre rate must never become (or overrule) a total, and a spec table
must never manufacture a denial.

WHY THIS FILE EXISTS. مفتاح العقار publishes «سعر المتر» on 4 of its 13 ads AND its own total, and
the two DISAGREE on half of them — id 30066 is a 425 m² plot at «سعر المتر 5500» whose published
total is 2,550,000, not the 2,337,500 the multiplication gives. Three failures are one keystroke
apart here: storing the rate (5,500 for a 2.5M plot, ~460× low), storing the product (a derived
number silently replacing a published one), and storing the total under the wrong basis.
The commissioning note for this scraper asserted the site publishes NO total and that the total
should be reconstructed as rate × area — following it would have written the wrong figure onto two
live cards, so the invariant is pinned here rather than trusted to review.

Every payload below is the REAL `wp-json/wc/store/v1/products` shape, copied verbatim from a live
fetch on 2026-09-20 (descriptions excerpted, not paraphrased; images truncated). Every assertion
runs the SHIPPING functions — `run.map_listing`, `run.read_type`, `run.read_area`, `run.amenities` —
never a re-implementation. No network, no database: the location catalog is the only stub, and the
real `to_catalog`/`find_district_in_text` run against it.
"""
from __future__ import annotations

import copy
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

import pytest  # noqa: E402

from scrapers.common import arabic_location as AL  # noqa: E402
from scrapers.moftah import run as R  # noqa: E402


@pytest.fixture(autouse=True)
def _offline_catalog(monkeypatch):
    """The DB-backed loc_catalog_* tables, stubbed with production-shaped norm keys. Installed via
    monkeypatch (not by mutating the module globals) so this barrier cannot poison a sibling test
    sharing the process — arabic_location's caches are module-level and never reset themselves."""
    monkeypatch.setattr(AL, "_load", lambda: None)
    monkeypatch.setattr(AL, "_CITY", {AL.norm_ar("الرياض"): [(1, 1)],
                                      AL.norm_ar("الدرعية"): [(3, 1)]})
    monkeypatch.setattr(AL, "_CID_AR", {1: "الرياض", 3: "الدرعية"})
    monkeypatch.setattr(AL, "_REGION_NORM", {AL.norm_ar("منطقة الرياض"): 1})
    monkeypatch.setattr(AL, "_REGION_AR_FOR", {1: "منطقة الرياض"})
    districts = ("حي الضباط", "حي سدرة", "حي الدريهمية", "حي عريض")
    monkeypatch.setattr(AL, "_DISTRICT_BY_CITY",
                        {1: {AL.norm_district_tok(d) for d in districts}})
    monkeypatch.setattr(AL, "_DISTRICT_AR_BY_NORM",
                        {AL.norm_district_tok(d): d for d in districts})

# id 30066 — THE TRAP. «سعر المتر 5500» × «425م²» = 2,337,500. The site's own price is 2,550,000,
# and 2,550,000 is what its page renders in the woocommerce price element. The description's
# «قرب الموقع من حديقة الملك سلمان» is the proximity shape that must NOT become this plot's feature.
P_PPM_TRAP = {
    "id": 30066,
    "name": "أرض للبيع في حي الضباط, مدينة الرياض, منطقة الرياض_مساحة 425م²",
    "permalink": "https://moftah-aleaqar.com/property/ard-aldubbat/",
    "prices": {"price": "2550000", "regular_price": "2550000", "currency_code": "SAR",
               "currency_minor_unit": 0},
    "description": ("<p>التفاصيل : عقار سكني استثماري بموقع مميز جدًا بحي الضباط بواجهة شرقي شمالي "
                    "و ممر خلفي بجوار المسجد مكتمل الخدمات قرب الموقع من حديقة الملك سلمان شارع 12 "
                    "شمالي وممر 2.5 جنوب ،، الحد البيع المتر 5500 رقم الترخيص : 7100188984</p>"),
    "short_description": "",
    "categories": [{"name": "بيع أراضي"}],
    "images": [{"src": "https://moftah-aleaqar.com/wp-content/uploads/2025/12/dubbat-1.png"}],
    "attributes": [
        {"name": "سعر المتر", "terms": [{"name": "5500"}]},
        {"name": "عرض الشارع", "terms": [{"name": "12م"}]},
        {"name": "الواجهة", "terms": [{"name": "شمال شرقي"}]},
        {"name": "المساحة", "terms": [{"name": "425م²"}]},
        {"name": "الغرض", "terms": [{"name": "سكني"}]},
        {"name": "الماء", "terms": [{"name": "متوفر"}]},
        {"name": "الكهرباء", "terms": [{"name": "متوفر"}]},
        {"name": "رقم الترخيص", "terms": [{"name": "7100188984"}]},
    ],
}

# id 30073 — the ONLY rent ad, 1,500 against 5,000 m², and the source states no period anywhere.
P_RENT_NO_PERIOD = {
    "id": 30073,
    "name": ("مكتب تجاري للإيجار في شارع صيدا, حي الدريهمية, مدينة الرياض, "
             "منطقة الرياض_مساحة 5,000م²"),
    "permalink": "https://moftah-aleaqar.com/property/maktab-saida/",
    "prices": {"price": "1500", "regular_price": "1500", "currency_code": "SAR",
               "currency_minor_unit": 0},
    "description": "<p>التفاصيل : • شركة كبرى ( السليمانية – العارض ) رقم الترخيص : 7100185493</p>",
    "short_description": "",
    "categories": [{"name": "إيجـــار"}],
    "images": [{"src": "https://moftah-aleaqar.com/wp-content/uploads/2025/12/3-2.png"}],
    "attributes": [
        {"name": "المساحة", "terms": [{"name": "5,000م²"}]},
        {"name": "الغرض", "terms": [{"name": "تجاري"}]},
        {"name": "عمر العقار", "terms": [{"name": "جديد"}]},
        {"name": "الماء", "terms": [{"name": "متوفر"}]},
        {"name": "رقم الترخيص", "terms": [{"name": "7100185493"}]},
    ],
}

# id 30274 — the spec-table ad. «نوع العقار» is «فیلا» with a PERSIAN YEH (ی U+06CC); «التأثيث» is a
# real negation; and the description's «بركة صغيرة … موقف خاص لسيارتين» is the accidental-negation
# trap («صغيرة» normalises to «صغيره», which CONTAINS «غير»). Area is published only in the title,
# as «_مساحة 250 م2» — whose «م2» carries a digit.
P_SPEC_TABLE = {
    "id": 30274,
    "name": "فيلا للبيع_شارع رقم 1241_حي سدرة_الرياض_مساحة 250 م2",
    "permalink": "https://moftah-aleaqar.com/property/villa-sedra-1241/",
    "prices": {"price": "4400000", "regular_price": "4400000", "currency_code": "SAR",
               "currency_minor_unit": 0},
    "description": ("<h1>فيلا مكونة من 3 غرف نوم للبيع في سيدرة، الرياض</h1><p>فناء خلفي مناسب "
                    "لمنطقة جلوس أو بركة صغيرة موقف خاص لسيارتين إلى ثلاث سيارات</p>"
                    "<p>مطبخ داخلي مجهز بالكامل<br />وحدات تكييف مثبتة</p>"),
    "short_description": "<p><span style=\"color: #ff0000\">وصف مختصر للعقار</span></p>",
    "categories": [{"name": "بيع فلل"}],
    "images": [{"src": "https://moftah-aleaqar.com/wp-content/uploads/2026/02/1-3.webp"}],
    "attributes": [
        {"name": "نوع العقار", "terms": [{"name": "فیلا"}]},
        {"name": "حالة البناء", "terms": [{"name": "جاهز"}]},
        {"name": "نوع العرض", "terms": [{"name": "للبيع"}]},
        {"name": "التأثيث", "terms": [{"name": "غير مفروش"}]},
        {"name": "مكيف", "terms": [{"name": "متوفر"}]},
        {"name": "غرفة خادمة", "terms": [{"name": "متوفر"}]},
        {"name": "المدخل", "terms": [{"name": "مدخل خاص"}]},
        {"name": "رقم بيوت المرجعي", "terms": [{"name": "87893530"}]},
    ],
}


def _row(p: dict) -> dict:
    row, _cat, why = R.map_listing(p)
    assert row is not None, f"id {p['id']} unexpectedly skipped: {why}"
    return row


# ── 1. PRICE = SOURCE: the published total wins, and the product is never stored ─────────────────

def test_published_total_wins_over_per_metre_times_area():
    row = _row(P_PPM_TRAP)
    assert row["price_total"] == 2550000, "the source's own published total must be stored verbatim"
    assert row["price_total"] != 2337500, (
        "5500 x 425 = 2,337,500 was stored — a DERIVED number overruled a published one")
    assert row["price_total"] != 5500, "the per-metre RATE was stored as the total (~460x low)"
    assert row.get("price_annual") is None, "a Buy total must not be filed as a rent"
    ai = row["additional_info"]
    assert ai["price_per_meter_source"] == 5500, "the source's rate must still be captured"
    assert 2337500 not in ai.values(), "the product is the display layer's, never stored in the row"
    ev = row["price_evidence"]
    assert ev["unit"] == "total" and ev["origin"] == "api" and ev["raw"] == "2550000"


def test_per_metre_rate_alone_never_becomes_a_price():
    """MUTANT: the same ad with the published total taken away. A scraper that reconstructs the
    total from rate x area (what this scraper was commissioned to do) turns green here."""
    p = copy.deepcopy(P_PPM_TRAP)
    p["prices"].pop("price")
    row = _row(p)
    assert row["price_total"] is None, (
        "no published price -> NULL. A rate x area total belongs to the search/display layer, "
        "never to scrapers/ (feedback_ppm-times-area-becomes-a-shown-searchable-total)")
    assert row["additional_info"]["price_per_meter_source"] == 5500


def test_halala_minor_unit_stores_no_price_rather_than_a_100x_error():
    p = copy.deepcopy(P_PPM_TRAP)
    p["prices"]["currency_minor_unit"] = 2      # same digits, now halalas
    assert _row(p)["price_total"] is None


# ── 2. RENT PERIOD = SOURCE: never defaulted ─────────────────────────────────────────────────────

def test_rent_period_is_null_when_unstated_and_the_figure_is_not_rescaled():
    row = _row(P_RENT_NO_PERIOD)
    assert row["transaction_type"] == "Rent"
    assert row.get("rent_period") is None, "a defaulted period is a 12x error on the card"
    assert row["price_annual"] == 1500, "the source published 1,500 — stored exactly as published"
    assert row.get("price_total") is None
    assert row["area_m2"] == 5000, "«5,000م²» must parse as 5000"
    # The figure is small next to the area, but this source publishes no «سعر المتر» for it, so
    # neither inventing 1500*5000 nor hiding the number is allowed. Recorded instead.
    ai = row["additional_info"]
    assert ai["rent_period_published"] is False
    assert ai["per_metre_rate_published"] is False
    assert row["price_annual"] != 7500000, "a per-metre assumption fabricated an annual rent"


@pytest.mark.parametrize("stated, period, annual", [
    ("مكتب تجاري للإيجار الشهري", "monthly", 18000),
    ("مكتب تجاري للإيجار سنوي", "annual", 1500),
    ("مكتب تجاري للإيجار نصف سنوي", None, None),
])
def test_a_period_the_ad_states_is_read_not_asserted_away(stated, period, annual):
    """30073's own figure under a title that DOES state a period. «شهري» left unread is a 12x card."""
    row = _row(dict(P_RENT_NO_PERIOD, name=stated + ", مدينة الرياض, منطقة الرياض_مساحة 5,000م²"))
    assert row.get("rent_period") == period and row.get("price_annual") == annual
    assert row["additional_info"]["rent_period_published"] is bool(period)


@pytest.mark.parametrize("raw", ["0", ""])
def test_a_price_the_source_sets_to_nothing_clears_the_stored_one(raw):
    """«0» is WooCommerce's unset price, never a 0-riyal ad. The sentinel makes the writer write NULL
    over a previously stored figure; a plain None is dropped and the old price would stay on the card."""
    row = _row(dict(P_RENT_NO_PERIOD, prices=dict(P_RENT_NO_PERIOD["prices"], price=raw)))
    assert row["price_annual"] is R.db.AUTHORITATIVE_NULL
    sale = dict(P_RENT_NO_PERIOD, categories=[{"name": "بيع"}],
                name=P_RENT_NO_PERIOD["name"].replace("للإيجار", "للبيع"),
                prices=dict(P_RENT_NO_PERIOD["prices"], price=raw))
    row, _c, why = R.map_listing(sale)
    assert row is not None, why
    assert row["transaction_type"] == "Buy" and row["price_total"] is R.db.AUTHORITATIVE_NULL


# ── 3. SPEC TABLE is tri-state: a named fixture is True, a denial is False, silence is NULL ───────

def test_stated_negation_is_false_but_accidental_one_is_not():
    row = _row(P_SPEC_TABLE)
    assert row["furnished"] is False, "«التأثيث: غير مفروش» is a real denial"
    assert row["air_conditioner"] is True and row["maid_room"] is True
    assert row["private_entrance"] is True, "«المدخل: مدخل خاص» must be read"
    # «بركة صغيرة موقف خاص لسيارتين» STATES parking. It must never come back as a denial just
    # because «صغيره» contains the letters «غير».
    assert row.get("parking") is not False, (
        "parking was denied on an ad that states «موقف خاص لسيارتين» — a fabricated False")


def test_silence_is_null_never_false():
    row = _row(P_PPM_TRAP)          # a bare plot: no elevator, kitchen or furnishing mentioned
    for col in ("elevator", "kitchen", "furnished", "maid_room", "balcony_terrace"):
        assert col not in row, f"{col} was written for an ad that never mentions it"


def test_a_denied_spec_value_is_not_inverted_into_a_fixture():
    """The label-then-value order the site uses inverts the helper's verdict, so run.py emits the
    pair value-first. Guard the direction with the shape this source will eventually publish."""
    p = copy.deepcopy(P_SPEC_TABLE)
    p["attributes"].append({"name": "مصعد", "terms": [{"name": "غير متوفر"}]})
    assert _row(p)["elevator"] is False, "«مصعد: غير متوفر» was read as an elevator the ad denies"


# ── 4. Skips are skips, not silent guesses ───────────────────────────────────────────────────────

def test_auction_is_skipped():
    p = copy.deepcopy(P_PPM_TRAP)
    p["name"] = "أرض مزاد للبيع في حي الضباط, مدينة الرياض, منطقة الرياض_مساحة 425م²"
    row, _cat, why = R.map_listing(p)
    assert row is None and why == "auction"


def test_sold_ad_is_skipped():
    p = copy.deepcopy(P_SPEC_TABLE)
    p["description"] += "<p>تم البيع</p>"
    row, _cat, why = R.map_listing(p)
    assert row is None and why == "sold_or_rented"


def test_city_outside_the_catalog_is_skipped_not_guessed():
    p = copy.deepcopy(P_PPM_TRAP)
    p["name"] = "أرض للبيع في حي النزهة, مدينة حوطة سدير, منطقة الرياض_مساحة 425م²"
    row, _cat, why = R.map_listing(p)
    assert row is None and why == "city_not_in_catalog"


# ── 5. The two parsing traps that silently corrupt numbers and drop rows ─────────────────────────

def test_area_from_title_is_not_polluted_by_the_unit_suffix():
    assert R.read_area(R.fold(P_SPEC_TABLE["name"]), {}) == 250, (
        "«مساحة 250 م2» parsed through to_int() whole yields 2502 — the «2» of «م2»")
    assert _row(P_SPEC_TABLE)["area_m2"] == 250


def test_persian_yeh_in_the_spec_type_still_maps():
    """«فیلا» (ی U+06CC) is what the spec table publishes; map_type_exact rejects it unfolded."""
    sp = R.specs(P_SPEC_TABLE)
    assert R.read_type("للبيع في حي سدرة", sp) == "Villa", (
        "the spec-table type was dropped — Persian yeh was not folded to Arabic ي")


def test_commercial_land_is_not_filed_as_residential():
    p = copy.deepcopy(P_PPM_TRAP)
    for a in p["attributes"]:
        if a["name"] == "الغرض":
            a["terms"] = [{"name": "تجاري"}]
    row, cat, _why = R.map_listing(p)
    assert row["property_type"] == "Commercial Land" and cat == "commercial"


def test_district_is_canonical_while_the_card_keeps_the_source_text():
    row = _row(P_PPM_TRAP)
    assert row["district_ar"] == "حي الضباط"
    assert row["neighborhood"] == "حي الضباط"
    assert row["city_id"] == 1 and row["region_id"] == 1 and row["city_ar"] == "الرياض"


def test_the_mangled_city_label_resolves_to_the_real_city():
    """«مدينة امارة منطقة الرياض – الدرعيه»: the source's own city label is a REGION phrase and the
    real city is the next segment. resolve_slug answers الرياض here, from the trailing «منطقة
    الرياض» — the wrong city on a real listing."""
    p = copy.deepcopy(P_PPM_TRAP)
    p["name"] = ("أرض للبيع في حي الضباط, مدينة امارة منطقة الرياض – الدرعيه, "
                 "منطقة الرياض_مساحة 425م²")
    row = _row(p)
    assert row["city_ar"] == "الدرعية" and row["city_id"] == 3


# id 30264 — the TYPE CONFLICT, verbatim. The title, the Woo category «بيع شقق» and the 106 m² area
# all say apartment; only «نوع العقار» says «عمارة سكنية» (a residential BUILDING — nothing on this
# source is a 106 m² building). Two independent source signals plus the size, against one attribute,
# so the title is the authority here and the attribute is filed as a recorded second opinion.
P_TYPE_CONFLICT = {
    "id": 30264,
    "name": "شقة للبيع_عرقة_غرب الرياض_الرياض_مساحة 106 م2",
    "permalink": "https://moftah-aleaqar.com/property/shaqa-irqah/",
    "prices": {"price": "1150000", "regular_price": "1150000", "currency_code": "SAR",
               "currency_minor_unit": 0},
    "description": "<p>شقة بمساحة 106 م2 في حي عرقة غرب الرياض</p>",
    "short_description": "",
    "categories": [{"name": "بيع شقق"}],
    "images": [{"src": "https://moftah-aleaqar.com/wp-content/uploads/2026/02/irqah-1.webp"}],
    "attributes": [
        {"name": "نوع العقار", "terms": [{"name": "عمارة سكنية"}]},
        {"name": "نوع العرض", "terms": [{"name": "للبيع"}]},
        {"name": "التأثيث", "terms": [{"name": "غير مفروش"}]},
        {"name": "المدخل", "terms": [{"name": "مدخل خاص"}]},
    ],
}


def test_the_title_type_outranks_a_disagreeing_spec_attribute():
    assert _row(P_TYPE_CONFLICT)["property_type"] == "Apartment"
    # …and it still wins when the attribute's value DOES map, which is the mutation that matters:
    # reading «عمارة» off a 106 m² unit puts a whole building on the card and in building filters.
    p = copy.deepcopy(P_TYPE_CONFLICT)
    p["attributes"][0]["terms"] = [{"name": "عمارة"}]
    row = _row(p)
    assert row["property_type"] == "Apartment", "a disagreeing spec attribute overruled the title"
    assert row["additional_info"]["source_property_type"] == "عمارة", (
        "the source's own disagreeing label must still be captured, not discarded")


def test_every_key_written_is_a_real_listing_column():
    """PGRST204 guard. `test_scraper_rows_only_use_real_columns.py` holds the information_schema
    oracle but parametrizes only suwar and rakez, so a newly onboarded platform is not covered by
    it — and one unwritable key makes PostgREST reject the WHOLE batch, so the fetch succeeds and
    zero rows land (the suwar `living_rooms` incident, 2026-09-14). The oracle is imported, never
    copied, so the two cannot drift.

    `price_evidence` is the documented exception: db._fold_price_evidence() pops it into
    `source_capture` and its own docstring says it is NOT a column.
    """
    from scrapers.common.tests import test_scraper_rows_only_use_real_columns as oracle

    allowed = set(oracle.LISTING_COLUMNS) | {"price_evidence"}
    for payload in (P_PPM_TRAP, P_RENT_NO_PERIOD, P_SPEC_TABLE, P_TYPE_CONFLICT):
        bad = sorted(set(_row(payload)) - allowed)
        assert not bad, f"id {payload['id']} writes non-columns: {bad}"
