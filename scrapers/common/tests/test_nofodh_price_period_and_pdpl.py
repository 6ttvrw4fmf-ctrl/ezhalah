"""nofodh — the price, the period, the source's own skip markers, and the PDPL barrier.

Every fixture below is a VERBATIM record captured from www.nofodh.sa on 2026-09-24 by the shipping
`parse_listing_page()`, trimmed to the keys the mapper reads. The assertions execute the SHIPPING
functions (`map_listing`, `read_price`, `parse_listing_page`, `_signal`) — nothing is re-implemented
here, so a change to the scraper is a change to what these tests measure.

MUTATION-VERIFIED (2026-09-24). The core price guard was broken on purpose and each test below was
watched FAIL, then the guard was restored and each was watched PASS:

  1. «السعر 0» accepted as a price — `read_price` changed to
         shown = normalize.to_int(shown_raw)
         if shown is None: ...          (i.e. `is None` instead of the falsy test)
     → test_a_zero_price_is_not_a_price FAILED: price_annual became 0 on NFD108296, publishing a
       263 m² Khobar office as free. Restored → passes.
  2. The rounding corroboration dropped — the `abs(exact - shown) >= 1` branch deleted and the
     model's float stored instead of the printed figure
         return int(exact), exact, None
     → test_the_printed_price_is_what_is_stored FAILED: NFD432014 stored 530696 where the source
       prints 530,697. Restored → passes.
  3. The mismatch refusal weakened to "trust the model"
     → test_a_price_the_page_and_the_model_disagree_on_is_refused FAILED: the row was stored with
       the model's unrelated figure instead of being skipped. Restored → passes.
  4. The rent period defaulted — `row["rent_period"] = "annual"` added beside `price_annual`
     → test_rent_period_is_never_stated_by_this_platform FAILED. Restored → passes.

Run:
  python -m pytest scrapers/common/tests/test_nofodh_price_period_and_pdpl.py -q
"""
from __future__ import annotations

import sys

from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[3]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

# The REAL scrapers.common.db is imported, deliberately: stubbing it with a fake module here put the
# fake in sys.modules for the whole pytest session and broke the fleet suite that imports
# db._CONTROL_COLS a few files later. Nothing in this file needs a database — db's client is lazy
# (db.sb() is only reached on a write) and only the location catalog is patched, per test, below.
from scrapers.nofodh import run as nofodh  # noqa: E402


# ── the catalog, stubbed so a unit test needs no network ─────────────────────────────────────────
# Real (city_id, region_id) read from production's loc_catalog_city on 2026-09-24 — not invented,
# because a stub that lies about an id is a test that proves the wrong thing. Every district label
# nofodh publishes resolves EXACTLY against loc_catalog_district (9/9 checked the same day).
_CITIES = {"جدة": (18, 2), "الرياض": (3, 1), "الخبر": (31, 5),
           "الدمام": (13, 5), "جازان": (17, 10)}
_DISTRICTS = {(18, "حي المنارات"): "حي المنارات", (3, "حي طيبة"): "حي طيبة",
              (3, "حي المصانع"): "حي المصانع", (31, "حي اليرموك"): "حي اليرموك",
              (3, "حي ديراب"): "حي ديراب", (3, "حي طويق"): "حي طويق",
              (3, "حي الجنادرية"): "حي الجنادرية", (17, "حي الروضة"): "حي الروضة",
              (13, "حي ضاحية الملك فهد"): "حي ضاحية الملك فهد"}


@pytest.fixture(autouse=True)
def _catalog(monkeypatch):
    monkeypatch.setattr(nofodh, "to_catalog", lambda c, *a, **k: _CITIES.get(c, (None, None)))
    monkeypatch.setattr(nofodh, "find_district_in_text",
                        lambda t, cid: _DISTRICTS.get((cid, t)))


# ── VERBATIM CAPTURES ───────────────────────────────────────────────────────────────────────────
# /listings/149628 — a land plot, priced, whose printed and model figures agree exactly.
LAND_FOR_SALE = {
    "id": "149628",
    "details": {"رقم العقار": "149628", "السعر": "882,446",
                "مساحة العقار": "1689.45 متر مربع", "سنة البناء": "2026-05-15",
                "نوع العقار": "أرض", "حالة العقار": "للبيع", "رقم البلوك": "BLK54"},
    "overview": {"تاريخ النشر": "2026-05-15", "متر مربع": "1689.45",
                 "نوع العقار": "أرض", "الفئة": "سكني"},
    "address": {"المدينة": "جدة", "الحي": "حي المنارات"},
    "price_exact": 882446, "min_price": 882446, "max_price": 0,
    "code": "WAP-BLK54-6",
    "photos": ["https://www.nofodh.sa/listings/149628_6a43785435dc0/6.jpg",
               "https://www.nofodh.sa/listings/149628_6a4378547ec68/6.jpg"],
    "has_auction_word": False,
}

# /listings/432014 — THE ROUNDING TRAP. The page prints 530,697; the component holds 530696.94.
# Also: an untranslated enum type, and a rent with no period anywhere on the page.
WAREHOUSE_FOR_RENT = {
    "id": "432014",
    "details": {"رقم العقار": "432014", "السعر": "530,697",
                "مساحة العقار": "2412.26 متر مربع", "الحمامات": "1",
                "سنة البناء": "2026-05-15", "نوع العقار": "WAREHOUSE",
                "حالة العقار": "للإيجار"},
    "overview": {"حمام": "1", "تاريخ النشر": "2026-05-15", "متر مربع": "2412.26",
                 "نوع العقار": "WAREHOUSE"},
    "address": {"المدينة": "الرياض", "الحي": "حي طيبة"},
    "price_exact": 530696.94, "min_price": 530696.94, "max_price": 0,
    "code": "19", "photos": [], "has_auction_word": False,
}

# /listings/108296 — THE ZERO TRAP. The site number_format()s an unpriced row into a literal "0".
OFFICE_PRICE_ZERO = {
    "id": "108296",
    "details": {"رقم العقار": "108296", "السعر": "0", "مساحة العقار": "263 متر مربع",
                "الحمامات": "1", "سنة البناء": "2026-05-15", "نوع العقار": "OFFICE",
                "حالة العقار": "للإيجار"},
    "overview": {"حمام": "1", "تاريخ النشر": "2026-05-15", "متر مربع": "263",
                 "نوع العقار": "OFFICE"},
    "address": {"المدينة": "الخبر", "الحي": "حي اليرموك"},
    "price_exact": 0, "min_price": 0, "max_price": 0,
    "code": "304A", "photos": [], "has_auction_word": False,
}

# /listings/113828 — an apartment rent. 17,000 for 62 m²: monthly or annual is UNKNOWABLE from the
# page, which is exactly why nothing may be assumed.
APARTMENT_FOR_RENT = {
    "id": "113828",
    "details": {"رقم العقار": "113828", "السعر": "17,000",
                "مساحة العقار": "62.11 متر مربع", "الحمامات": "1",
                "سنة البناء": "2026-05-15", "نوع العقار": "شقة", "حالة العقار": "للإيجار"},
    "overview": {"حمام": "1", "تاريخ النشر": "2026-05-15", "متر مربع": "62.11",
                 "نوع العقار": "شقة"},
    "address": {"المدينة": "الرياض", "الحي": "حي المصانع"},
    "price_exact": 17000, "min_price": 17000, "max_price": 0,
    "code": "B2-14", "photos": [], "has_auction_word": False,
}

# /listings/531729 — SOLD. Its page still answers 200 with full content, and its «السعر» row is
# simply absent (not 0). Type «بلوك» is a source word with no fleet meaning.
BLOCK_SOLD = {
    "id": "531729",
    "details": {"رقم العقار": "531729", "سنة البناء": "2026-05-15",
                "نوع العقار": "بلوك", "حالة العقار": "مباع"},
    "overview": {"تاريخ النشر": "2026-05-15", "نوع العقار": "بلوك"},
    "address": {"المدينة": "الرياض", "الحي": "حي ديراب"},
    "price_exact": 0, "min_price": 0, "max_price": 0,
    "code": None, "photos": [], "has_auction_word": False,
}

# /listings/844706 — a PROJECT container: an abbreviated price BAND, unit counts, a %-sold bar.
PROJECT_WITH_RANGE = {
    "id": "844706",
    "details": {"رقم العقار": "844706", "السعر": "550.0K - 830.0K", "عدد الوحدات": "14",
                "عدد الوحدات المتبقية": "14", "سنة البناء": "2026-03-04",
                "نوع العقار": "مشروع", "حالة العقار": "للبيع"},
    "overview": {"تاريخ النشر": "2026-03-04", "نوع العقار": "مشروع", "الفئة": "سكني"},
    "address": {"المدينة": "الرياض", "الحي": "حي طويق"},
    "price_exact": 550000, "min_price": 550000, "max_price": 830000,
    "code": "الموسى رزيدنس 2", "photos": [], "has_auction_word": False,
}

# /listings/914863 — a PROJECT whose eight units are all one price, so min == max and the range
# check alone would let it through. Only the source's own type word catches it.
PROJECT_FLAT_PRICE = {
    "id": "914863",
    "details": {"رقم العقار": "914863", "السعر": "2.1M - 2.1M", "عدد الوحدات": "8",
                "عدد الوحدات المتبقية": "8", "سنة البناء": "2026-05-14",
                "نوع العقار": "مشروع", "حالة العقار": "للبيع"},
    "overview": {"تاريخ النشر": "2026-05-14", "نوع العقار": "مشروع"},
    "address": {"المدينة": "الرياض", "الحي": "حي طويق"},
    "price_exact": 2126250, "min_price": 2126250, "max_price": 2126250,
    "code": "واحة الموسى", "photos": [], "has_auction_word": False,
}


def _row(rec):
    row, cat, why = nofodh.map_listing(rec)
    assert row is not None, f"expected a row, got skip {why!r}"
    return row, cat


def _skip(rec) -> str:
    row, _cat, why = nofodh.map_listing(rec)
    assert row is None, f"expected a skip, got a row for {rec['id']}"
    assert why, "a skip must always carry a counted reason"
    return why


# ── PRICE: the platform's own hardest trap ──────────────────────────────────────────────────────
def test_a_zero_price_is_not_a_price():
    """MUTATION TARGET 1. «السعر 0» is the column default rendered by number_format(), not an offer.

    Measured on 14 of a 44-page spread. Storing it would publish a 263 m² Khobar office at 0 SAR.
    """
    assert nofodh.read_price(OFFICE_PRICE_ZERO) == (None, None, None)
    row, _ = _row(OFFICE_PRICE_ZERO)
    assert row.get("price_annual") is None
    assert row.get("price_total") is None
    assert row.get("price_per_meter") is None
    # And it must be a genuine absence, not a stored zero anywhere on the row.
    assert 0 not in [row.get(k) for k in ("price_total", "price_annual", "price_per_meter")]


def test_the_printed_price_is_what_is_stored():
    """MUTATION TARGET 2. The page prints 530,697; the component holds 530696.94.

    The two differ by rounding alone, and what is stored is the figure the SOURCE DISPLAYS — the
    number a real-user comparison against the listing checks. The un-rounded float survives in
    additional_info so the halalas are not lost.
    """
    stored, exact, refused = nofodh.read_price(WAREHOUSE_FOR_RENT)
    assert refused is None
    assert stored == 530697, "the printed figure is the source's published price"
    assert exact == 530696.94
    row, cat = _row(WAREHOUSE_FOR_RENT)
    assert row["price_annual"] == 530697
    assert row["additional_info"]["source_price_exact"] == 530696.94
    assert row["additional_info"]["source_price_shown"] == "530,697"
    assert cat == "commercial"


def test_a_price_the_page_and_the_model_disagree_on_is_refused():
    """MUTATION TARGET 3. A gap wider than rounding means the two figures are not the same quantity.

    Neither is derived from the other, so there is no way to reconcile them — the row is SKIPPED with
    a counted reason rather than stored on a guess. 6,300 vs 75,600 is the ×12 shape a defaulted
    period would have produced, and it must not be resolved silently either.
    """
    poisoned = {**APARTMENT_FOR_RENT, "price_exact": 75600.0}
    why = _skip(poisoned)
    assert why.startswith("price_mismatch_"), why
    assert "17000" in why and "75600" in why, "the reason must name both published figures"


def test_a_price_the_page_hides_is_not_taken_from_the_model():
    """The model holding a figure the page does not print is not a published price."""
    hidden = {**OFFICE_PRICE_ZERO, "price_exact": 88000.0}
    assert _skip(hidden).startswith("price_hidden_but_model_holds_")


def test_no_per_metre_rate_is_ever_derived_for_land():
    """This source prints no «سعر المتر» row on any page, so price_per_meter stays NULL.

    A land plot of 1689 m² at 882,446 SAR has an obvious per-metre rate; the point is that the
    source never published it, so we never store one — and the total is never rebuilt from it.
    """
    row, cat = _row(LAND_FOR_SALE)
    # The key is never written at all — which is also what the no-clobber guard wants: an absent key
    # leaves the column alone instead of sending a NULL that a future crawl could not distinguish
    # from a retraction.
    assert "price_per_meter" not in row
    assert row.get("price_per_meter") is None
    assert row["price_total"] == 882446
    assert row["area_m2"] == 1689
    assert row["additional_info"]["source_area_raw"] == "1689.45 متر مربع"
    assert cat == "residential"


# ── RENT PERIOD = SOURCE ────────────────────────────────────────────────────────────────────────
@pytest.mark.parametrize("rec,price", [(APARTMENT_FOR_RENT, 17000), (WAREHOUSE_FOR_RENT, 530697)])
def test_rent_period_is_never_stated_by_this_platform(rec, price):
    """MUTATION TARGET 4. No period field, no period label, no description to state one in.

    So rent_period is NULL and the figure is stored EXACTLY as published — never ×12, never annual
    by default. 17,000 for a 62 m² Riyadh flat is plausibly annual and plausibly nothing of the kind;
    the source does not say, so neither do we.
    """
    row, _ = _row(rec)
    assert row.get("rent_period") is None, "the source states no period — NULL is the only answer"
    assert row["price_annual"] == price, "the published figure, unconverted"
    assert row["transaction_type"] == "Rent"
    assert row.get("price_total") is None


def test_a_period_the_source_did_state_would_still_be_honoured():
    """The platform is deliberately NOT in SINGLE_PERIOD_PLATFORMS and hardcodes nothing.

    There is no period token to honour today, so this asserts the shape that guarantees it: the
    scraper contains no literal period assignment, and the shared audited parser still reads a
    period out of a stated one when a source has it.
    """
    from scrapers.common import normalize

    src = Path(nofodh.__file__).read_text(encoding="utf-8")
    assert '"rent_period": "annual"' not in src
    assert '"rent_period"] = "annual"' not in src
    assert "annualize_rent" not in src, "nothing on this platform may be annualized"
    # The shared parser is the fleet's answer for a source that DOES state one, unchanged here.
    assert normalize.rent_period_and_annual(5000, "الإيجار شهري") == ("monthly", 60000)
    # Silence → no period, and the figure comes back UNCONVERTED. That second half is the contract
    # this scraper depends on for every one of its rents.
    assert normalize.rent_period_and_annual(5000, "") == (None, 5000)


# ── THE SOURCE'S OWN SKIP MARKERS ───────────────────────────────────────────────────────────────
def test_a_sold_unit_is_skipped_by_the_sources_own_word():
    assert _skip(BLOCK_SOLD) == "sold"


@pytest.mark.parametrize("state,reason", [
    ("مباع", "sold"), ("مؤجر", "already_rented"), ("محجوز", "reserved"), ("مدفوع", "paid"),
    ("تحت الصيانة", "under_maintenance"), ("TRANSFERRED", "transferred"),
    ("MORTGAGED", "mortgaged"), ("محجوب", "hidden_by_source"),
    ("قريباً", "coming_soon_not_released"),
])
def test_every_off_market_state_the_filter_publishes_is_skipped(state, reason):
    """The nine non-transactable states of the platform's own «حالة البيع» enum.

    «قريباً» is the READY-ONLY case: the source's own not-yet-released marker, never inferred from a
    date or a price. Only «للبيع» and «للإيجار» produce a row.
    """
    rec = {**LAND_FOR_SALE, "details": {**LAND_FOR_SALE["details"], "حالة العقار": state}}
    assert _skip(rec) == reason


def test_an_unrecognised_state_is_never_guessed_into_buy_or_rent():
    rec = {**LAND_FOR_SALE, "details": {**LAND_FOR_SALE["details"], "حالة العقار": "قيد التفاوض"}}
    assert _skip(rec) == "status_unknown_قيد التفاوض"


def test_an_auction_ad_is_skipped():
    assert _skip({**LAND_FOR_SALE, "has_auction_word": True}) == "auction"


@pytest.mark.parametrize("rec,reason", [
    (PROJECT_WITH_RANGE, "project_container"),
    (PROJECT_FLAT_PRICE, "project_container"),
])
def test_a_project_container_is_never_a_listing(rec, reason):
    """A project page publishes a price BAND and a %-sold bar — the READY-ONLY rule's own shapes.

    PROJECT_FLAT_PRICE is why the range test cannot stand alone: min == max on that one, so only the
    source's own «مشروع» type word catches it.
    """
    assert _skip(rec) == reason


def test_the_range_check_catches_a_container_the_type_word_would_not():
    """The second, independent marker: a band is not a price, whatever the type says."""
    disguised = {**PROJECT_WITH_RANGE,
                 "details": {**PROJECT_WITH_RANGE["details"], "نوع العقار": "أرض"},
                 "overview": {**PROJECT_WITH_RANGE["overview"], "نوع العقار": "أرض"}}
    assert _skip(disguised) == "price_range_not_a_listing"
    # THIRD MARKER: «عدد الوحدات». A container announces its unit count, and a unit never does.
    flat = {**disguised, "min_price": 550000, "max_price": 0}
    assert _skip(flat) == "project_container_unit_counts"
    # FOURTH BARRIER — the price cross-check, which needs no container marker at all. Parsed as a
    # number the band is garbage (55,008,300: two dots collapsed to digit grouping), and garbage
    # cannot agree with the model's 550,000, so the row is refused. Four independent barriers stand
    # between an abbreviated band and a price column, and this is the one that holds when every
    # container marker has been removed.
    assert nofodh.normalize.to_int("550.0K - 830.0K") == 55008300, "the band is not a number"
    naked = {**flat, "details": {k: v for k, v in flat["details"].items()
                                 if not k.startswith("عدد الوحدات")}}
    assert _skip(naked).startswith("price_mismatch_"), "the band must never reach a price column"


# ── TYPE MAPPING ────────────────────────────────────────────────────────────────────────────────
@pytest.mark.parametrize("raw,expected,category", [
    ("أرض", "Residential Land", "residential"),
    ("شقة", "Apartment", "residential"),
    ("WAREHOUSE", "Warehouse", "commercial"),
    ("OFFICE", "Office", "commercial"),
    ("WORKSHOP", "Workshop", "commercial"),
    ("RETAIL_STORE", "Shop", "commercial"),
])
def test_the_type_mapping_covers_both_of_the_sources_vocabularies(raw, expected, category):
    """The platform prints Arabic for translated types and leaks the bare enum for the rest."""
    rec = {**LAND_FOR_SALE,
           "details": {**LAND_FOR_SALE["details"], "نوع العقار": raw},
           "overview": {**LAND_FOR_SALE["overview"], "نوع العقار": raw}}
    row, cat = _row(rec)
    assert row["property_type"] == expected
    assert cat == category
    assert row["additional_info"]["type_raw"] == raw


def test_an_unmapped_type_word_is_skipped_not_guessed():
    """«بلوك» is a real source word (id 531729) with no fleet meaning. It is never invented into one."""
    rec = {**BLOCK_SOLD, "details": {**BLOCK_SOLD["details"], "حالة العقار": "للبيع"}}
    assert _skip(rec) == "type_unmapped_بلوك"


def test_a_city_outside_the_catalog_is_never_filed_under_a_neighbour():
    """The platform also sells in Istanbul; its districts share the same picker."""
    rec = {**LAND_FOR_SALE, "address": {"المدينة": "إسطنبول", "الحي": "حي أتاشهير"}}
    assert _skip(rec) == "city_not_in_catalog"


# ── PDPL ────────────────────────────────────────────────────────────────────────────────────────
def test_a_poisoned_record_leaks_no_contact_detail_anywhere():
    """Every nofodh page carries «920029555» and «info@nofodh.sa» in its footer and JSON-LD.

    TWO BARRIERS, and this exercises both:
      · the LABEL allowlist — a label the mapper does not know («اسم المسوق», «رقم الجوال») is not
        copied into the capture at all, so an advertiser-identity field the platform adds upstream
        cannot arrive by default. This is the barrier that carries the NAME guarantee: redact_pii()
        deliberately does not strip human names (db.redact_capture must not eat a
        sellerLicenseNumber-style regulatory value), so a name is kept out by never being admitted.
      · redact_pii() over every stored value — for a contact detail typed into a field that is
        otherwise legitimate, which is what advertisers actually do.

    The record below is poisoned in every field the mapper reads, plus two keys and two labels it
    does not, and nothing survives into any column, additional_info or source_capture.
    """
    import json

    poison = {
        **LAND_FOR_SALE,
        "code": "WAP-BLK54-6 اتصل 0555754441",
        "details": {**LAND_FOR_SALE["details"],
                    "رقم البلوك": "BLK54 واتساب https://wa.me/966501234567",
                    "الفئة": "سكني — للتواصل info@nofodh.sa",
                    # labels the platform does not publish today
                    "اسم المسوق": "أبو محمد العتيبي",
                    "رقم الجوال": "0501112223"},
        "overview": {**LAND_FOR_SALE["overview"],
                     "تاريخ النشر": "2026-05-15 — 0555112233"},
        "address": {"المدينة": "جدة", "الحي": "حي المنارات — 920029555",
                    "جهة الاتصال": "أبو محمد 0509998887"},
        # record keys outside the allowlist
        "advertiser_phone": "0555754441",
        "agent_name": "أبو محمد العتيبي",
    }
    row, _ = _row(poison)
    blob = json.dumps(row, ensure_ascii=False, default=str)
    for leak in ("0555754441", "wa.me", "966501234567", "info@nofodh.sa", "0501112223",
                 "0555112233", "0509998887", "920029555", "advertiser_phone", "agent_name",
                 "اسم المسوق", "رقم الجوال", "جهة الاتصال", "أبو محمد", "العتيبي"):
        assert leak not in blob, f"{leak!r} reached a stored payload"
    # The listing content itself survives the redaction — this is a scrub, not a blanket delete.
    assert row["ad_number"] == "NFD149628"
    assert row["price_total"] == 882446
    assert "WAP-BLK54-6" in row["title"]
    assert "BLK54" in row["additional_info"]["block_number"]
    assert row["source_capture"]["details"]["السعر"] == "882,446"
    assert row["source_capture"]["address"]["المدينة"] == "جدة"


def test_the_pdpl_test_would_catch_a_real_regression():
    """CONTROL: the assertion is only worth something if an unredacted value would trip it."""
    import json

    row, _ = _row(LAND_FOR_SALE)
    row["additional_info"] = {**row["additional_info"], "agent": "0555754441"}
    assert "0555754441" in json.dumps(row, ensure_ascii=False, default=str)


# ── PARSER + LIVENESS ───────────────────────────────────────────────────────────────────────────
# A verbatim trim of /listings/149628's own markup: the label pair, the address pair and the map
# iframe, exactly as the page serves them — plus one foreign-folder image and the brochure PDF the
# project pages serve out of the same directory shape.
PAGE_FRAGMENT = """
<div class="d-flex align-items-start mb10">
    <p class="fw600 mb-0" style="min-width:50%;">حالة العقار</p>
    <p class="text mb-0">للبيع</p>
</div>
<div class="d-flex align-items-start mb10">
    <p class="fw600 mb-0" style="min-width:50%;">السعر</p>
    <p class="text mb-0 "><span class="price-current">882,446</span></p>
</div>
<div class="pd-list"><p class="mb-0 fw600 ff-heading dark-color">المدينة</p></div>
<div class="pd-list"><p class="mb-0 text">
    جدة
</p></div>
<iframe class="position-relative bdrs12 mt30 h250" loading="lazy"
    src="https://maps.google.com/maps?q=21.8296389,39.0961389&amp;output=embed"
    title="WAP-BLK54-6"></iframe>
<img src="https://www.nofodh.sa/listings/149628_6a4378547ec68/6.jpg">
<img src="https://www.nofodh.sa/listings/844706_6a27f051406ff/4.jpeg">
<a href="https://www.nofodh.sa/listings/149628_6a27eea6627a7/BROCHURE.pdf">brochure</a>
"""


def test_the_parser_reads_the_pages_own_shapes():
    rec = nofodh.parse_listing_page(PAGE_FRAGMENT, "149628")
    assert rec["details"]["حالة العقار"] == "للبيع"
    assert rec["details"]["السعر"] == "882,446"
    assert rec["address"]["المدينة"] == "جدة"
    assert rec["code"] == "WAP-BLK54-6"


def test_photos_are_scoped_to_this_listing_and_to_real_images():
    """Regression, caught live: an unscoped pattern harvested the whole document.

    On /listings/844706 that meant six OTHER listings' photos plus a brochure PDF, i.e. one row
    claiming another row's pictures. The folder prefix is the source's own per-listing scoping.
    """
    rec = nofodh.parse_listing_page(PAGE_FRAGMENT, "149628")
    assert rec["photos"] == ["https://www.nofodh.sa/listings/149628_6a4378547ec68/6.jpg"]
    # The same fragment parsed AS 844706 sees only 844706's media, and still no PDF.
    other = nofodh.parse_listing_page(PAGE_FRAGMENT, "844706")
    assert other["photos"] == ["https://www.nofodh.sa/listings/844706_6a27f051406ff/4.jpeg"]


def test_the_removal_oracle_needs_the_sources_own_state_not_a_200():
    """A sold unit KEEPS its page (id 531729 answers 200 with «مباع»), so 200 is not life.

    404 is measured as the hard delete (7/7 ids the platform does not have). Nothing else may kill.
    """
    sold_body = '<p class="fw600 mb-0" style="min-width:50%;">حالة العقار</p><p class="text mb-0">مباع</p>'
    live_body = '<p class="fw600 mb-0" style="min-width:50%;">حالة العقار</p><p class="text mb-0">للبيع</p>'
    soon_body = '<p class="fw600 mb-0" style="min-width:50%;">حالة العقار</p><p class="text mb-0">قريباً</p>'
    assert nofodh._signal(404, "not found", False) == "gone"
    assert nofodh._signal(200, sold_body, False) == "gone"
    assert nofodh._signal(200, live_body, False) == "live"
    # Not-yet-released is not a removal, and a page with no state row has no opinion.
    assert nofodh._signal(200, soon_body, False) is None
    assert nofodh._signal(200, "<html>shell</html>", False) is None
    # The law's own cases are never claimed by this platform's signal.
    for blocked in (403, 429, 500, 503):
        assert nofodh._signal(blocked, live_body, False) is None


def test_the_waf_challenge_is_never_read_as_a_missing_listing():
    """The WAF answers its challenge with HTTP **202** — a success code — and a 2,047-byte shim.

    Measured 2026-09-24: a first walk served 351 real pages and then drew 202 for all 2,250
    remaining ids, including ones that had answered 200 minutes earlier. Counted as absence, that is
    2,250 listings apparently vanishing at once, which is how a crawl deletes a catalogue.
    """
    challenge = ('<html><script>window.awsWafCookieDomainList = [];'
                 'window.gokuProps = {"key":"AQID..."}</script></html>')
    assert nofodh.is_waf_challenge(challenge) is True
    assert nofodh.is_waf_challenge("<html>a real page</html>") is False
    # The liveness oracle must have NO opinion on a challenge — never 'gone'.
    assert nofodh._signal(202, challenge, False) is None
    # …and that holds even if the WAF ever wrapped its challenge in a 404, which the 404 branch
    # would otherwise read as this platform's hard delete. This is the assertion that matters:
    # without the challenge check ahead of the 404, one block becomes one deletion.
    assert nofodh._signal(404, challenge, False) is None
    assert nofodh._signal(404, "genuine not found page", False) == "gone"
    assert nofodh.WAF_CHALLENGE_STATUS in nofodh._RETRY_STATUSES, "a challenge must be retried"


def test_a_challenged_crawl_cannot_prune():
    """The run refuses to treat a challenged walk as a catalogue.

    Asserted on the shipping source because the branch is inside main()'s network path: a nonzero
    blocked count clears `complete`, and `complete` is what gates prune_unseen.
    """
    src = Path(nofodh.__file__).read_text(encoding="utf-8")
    assert "if blocked:\n            complete = False" in src, (
        "any challenged page must take the crawl's completeness away")
    assert "if args.type == \"all\" and complete:" in src, "prune must be gated on completeness"
    # And the thin-crawl tolerance must raise rather than record a healthy partial run.
    assert "share >= 0.05" in src and "raise RuntimeError" in src


def test_the_law_still_refuses_a_death_this_signal_would_allow():
    """CONTROL: the shared law, not this file, is what makes a block un-killable.

    `decide()` returns None for an unbelievable read — "no answer yet, spend another attempt" — and
    only an exhausted budget becomes UNKNOWN. What matters here is that a signal SAYING 'gone' on a
    403 or a 5xx never becomes a death, however this scraper is written.
    """
    from scrapers.common.http_liveness import decide, read_is_unbelievable

    for status in (403, 429, 500, 503, None):
        assert decide(status, "whatever", False, lambda *a: "gone") is None
        assert read_is_unbelievable(status, "whatever")
    # An empty body cannot manufacture a life either.
    assert decide(200, "", False, lambda *a: "live") is None
