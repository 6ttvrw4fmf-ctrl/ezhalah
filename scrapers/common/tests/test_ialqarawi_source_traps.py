"""ialqarawi (إبراهيم القرعاوي) — the traps its pages set, asserted against the REAL parser.

Every fixture below is production payload, not a shape this file invented:
  · the HTML skeleton is the site's own markup, copied from
    https://ialqarawi.com/index.php?router=card&id=3793&catid=46 (the `<dl class="row">` /
    `<dd class="col-sm-3"><strong>…` field table, the `royalSlider` `data-rsBigImg` gallery anchor,
    and the `card card-shadow` sibling cards that sit on the same page);
  · every FIELD VALUE is a string measured verbatim from the live site — the price strings come
    from a dump of both price cells of all 2,641 listings, and each test names the listing id it
    was taken from.
Only `to_catalog` / `find_district_in_text` are stubbed, because they read the production location
catalog and there is no service-role key in CI (the same stubbing the fleet's
test_scraper_rows_only_use_real_columns.py does for suwar and rakez).

Process-isolated by design: it stubs scrapers.common.db before importing the scraper, so run it on
its own file, not as part of a `pytest scrapers/` sweep —
    python -m pytest scrapers/common/tests/test_ialqarawi_source_traps.py -v
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

from scrapers.ialqarawi import run as R  # noqa: E402
from scrapers.common.tests.test_scraper_rows_only_use_real_columns import (  # noqa: E402
    LISTING_COLUMNS,
)

UNAIZAH, CITY_ID, REGION_ID = "عنيزة", 21, 4
# The homepage the site serves — with HTTP 200 — for an id that does not exist. Shortened, but it
# has what matters: real card links and NOT ONE «رقم العقار» field row.
HOMEPAGE = ('<section class="cards"><div class="card-deck">'
            '<div class="card position-relative mb-4"><img class="card-img-top" '
            'src="https://ialqarawi.com/download/products/img__de2bb6c20767412.png">'
            '<h5 class="card-title font-weight-normal">'
            '<a href="index.php?router=card&amp;id=3793&amp;catid=46">للبيع أرض سكنية</a></h5>'
            '</div></div></section>')


def page(*, number="3793", section="اراضي سكنية", district="الصالحية", details="",
         land_area="526م", built="غير متوفر", parcel="131", board="غير متوفر",
         som="لا يوجد", limit="لا يوجد", visits="1", title="للبيع أرض سكنية بحي الصالحية بعنيزة",
         gallery=1, siblings=5) -> str:
    """The site's detail markup, verbatim in structure."""
    rows = [("رقم العقار", f'<span class="num" style="display: inline-block;">{number}</span>'),
            ("القسم", section), ("الحي", district), ("تفاصيل العقار", details),
            ("مساحة الأرض", land_area), ("مسطح البناء", built), ("رقم القطعة", parcel),
            ("رقم اللوحة", board), ("سعر السوم", som), ("سعر الحد", limit),
            ("عدد الزيارات", visits), ("مضاف منذ", "1 ساعة")]
    body = "".join(
        f'<dl class="row"> <dd class="col-sm-3"><strong>{k}</strong></dd> '
        f'<dd class="col-sm-9"> {v} </dd> </dl>' for k, v in rows)
    gal = "".join(
        f'<a class="rsImg" data-rsw="400" data-rsh="500" '
        f'data-rsBigImg="https://ialqarawi.com/download/products/gal{i}.png" '
        f'href="https://ialqarawi.com/download/products/gal{i}.png">'
        f'<img class="rsTmb" src="https://ialqarawi.com/download/products/gal{i}.png"></a>'
        for i in range(gallery))
    # «عقارات مشابهة» — OTHER listings' cards, on this same page, same image directory.
    sib = "".join(
        f'<div class="card card-shadow position-relative mb-4"><img class="card-img-top '
        f'mx-auto d-block img-fluid" src="https://ialqarawi.com/download/products/sib{i}.png">'
        f'</div>' for i in range(siblings))
    return (f'<section class="bg-white cards"><h3 style="color:#180180"> {title} </h3>'
            f'<div class="card-body">{body}</div>'
            f'<div id="gallery-1" class="royalSlider rsDefault">{gal}</div>{sib}</section>')


def card(lid="3793", catid=46, ty=1, title="للبيع أرض سكنية بحي الصالحية بعنيزة") -> dict:
    return {"id": lid, "catid": catid, "type": ty, "title": title,
            "url": f"index.php?router=card&id={lid}&catid={catid}"}


@pytest.fixture(autouse=True)
def _catalog(monkeypatch):
    """عنيزة and الدوادمي are the only cities the stub catalog knows — a source label it does not
    recognise must NOT become a location."""
    monkeypatch.setattr(R, "to_catalog", lambda name, region_hint=None: (
        (CITY_ID, REGION_ID) if str(name).strip() in (UNAIZAH, "عنيزه")
        else (7, 1) if str(name).strip() == "الدوادمي" else (None, None)))
    monkeypatch.setattr(R, "find_district_in_text", lambda text, city_id: (
        "حي الصالحية" if text and "الصالحية" in str(text) else
        "حي المزادة" if text and "المزادة" in str(text) else None))


def mapped(**kw):
    """The detail page's own <h3> IS the title map_listing reads, so a card passed here carries its
    title onto the page too — exactly as the live pages do."""
    c = kw.pop("card", None) or card()
    kw.setdefault("title", c["title"])
    return R.map_listing(c, R.parse_detail(page(**kw)))


# ── the page that lies ───────────────────────────────────────────────────────────────────────────
def test_unknown_id_serves_the_homepage_and_that_is_a_miss_not_an_empty_listing():
    """ialqarawi answers a dead id with HTTP 200 and the HOMEPAGE. An empty parse must be a skip;
    treating it as a listing writes the homepage (and its 62 foreign card links) as a property."""
    assert R.parse_detail(HOMEPAGE) == {}
    row, _, why = R.map_listing(card(), R.parse_detail(HOMEPAGE))
    assert row is None and why == "detail_missing"


def test_a_page_for_a_different_listing_is_a_mismatch():
    row, _, why = R.map_listing(card(lid="3793"), R.parse_detail(page(number="1234")))
    assert row is None and why == "id_mismatch"


# ── «مزاد» is a substring of a real district ─────────────────────────────────────────────────────
def test_an_auction_is_skipped_but_the_almazada_district_is_not():
    """«حي المزادة» is a real عنيزة district on 5 live listings (e.g. «للبيع فيلا بحي المزادة
    بعنيزة»). A substring test for «مزاد» deletes all five."""
    row, _, why = mapped(title="للبيع أرض مزاد علني بحي الصالحية بعنيزة")
    assert row is None and why == "auction"

    row, _, why = mapped(district="المزادة", title="للبيع فيلا بحي المزادة بعنيزة",
                         section="فلل")
    assert why == "" and row is not None
    assert row["district_ar"] == "حي المزادة"


# ── price ────────────────────────────────────────────────────────────────────────────────────────
@pytest.mark.parametrize("raw,total", [
    ("850 الف", 850_000),                  # id 3262 — «الف» after a bare <1000 number IS the unit
    ("1.600.000 الف", 1_600_000),          # id 47 — after a grouped number it is a redundant word
    ("75000 الف الاجمالي", 75_000),        # id 1477 — ×1000 here would be 75 million
    ("2,100,000", 2_100_000),              # id 3521
    ("3850.000", 3_850_000),               # id 3194
    ("مليون و500 الف", 1_500_000),         # the compound form: 1.5M, NOT 500,000,000
    ("مليونين و500 ألف ريال صافي", 2_500_000),
    ("ثلاثة مليون", 3_000_000),            # a word numeral is a number
    ("1.350.000 مليون صافي", 1_350_000),   # grouped digits make «مليون» redundant too
    ("440.000 قابل لاتفاوض", 440_000),     # id 3526 — «negotiable» is noise, the price stands
])
def test_a_price_the_source_published_is_read_exactly(raw, total):
    assert R.parse_money(raw)[0] == total


@pytest.mark.parametrize("raw,reason", [
    ("60.000 الف لكل مستودع", "per_unit"),        # id 1323 — per WAREHOUSE, not the listing
    ("حد لكل قطعة 520.000الف", "per_unit"),       # id 1301 — per PLOT
    ("10.000 للفتحة الواحدة", "per_unit"),        # id 614
    ("تبدا من 12000الف الى20000الف", "range"),    # id 1369 — a range is not a price
    ("مليون و100", "million_second_term_unit_unstated"),
    ("150.000 الف +204.000الف للبنك العقاري", "multiple_numbers"),
])
def test_a_figure_that_is_not_this_listings_total_is_never_published_as_one(raw, reason):
    total, ppm, why = R.parse_money(raw)
    assert (total, ppm, why) == (None, None, reason)


@pytest.mark.parametrize("raw,total", [
    ("9300 الف", 9_300_000),        # id 3739 — read as written: 9,300 thousand
    ("1000", 1000),                 # bare and small, stored as the page shows it
    ("900", 900),                   # id 2823
    ("بالكامل اخر سومه 6300", 6300),
])
def test_a_small_or_odd_published_figure_is_stored_never_hidden(raw, total):
    """Owner rule 2026-08-03: no plausibility floor on a source price, at any magnitude."""
    assert R.parse_money(raw) == (total, None, "")


def test_a_price_the_source_does_not_state_is_silence_not_a_defect():
    for raw in ("لا يوجد", "على السوم", "ع السوم", "تحت السوم", "لايوجد حد", ""):
        assert R.parse_money(raw) == (None, None, "")


def test_a_per_metre_rate_is_stored_as_a_rate_and_never_multiplied_here():
    """«1500 للمتر» on 526 m². Owner rule 2026-09-03 derives ppm × area in the SEARCH/DISPLAY layer
    only (shown as ≈, sale-only); a scraper writing it into price_total claims the advertiser
    published 789,000. And never on a rent: that would be a 789,000 «annual» rent."""
    row, _, why = mapped(som="1500 للمتر", land_area="526م")
    assert why == ""
    assert row["price_per_meter"] == 1500 and row["area_m2"] == 526
    assert row.get("price_total") is None
    rent, _, _ = mapped(card=card(ty=2, title="للإيجار ارض بحي الصالحية بعنيزة"),
                        som="1500 للمتر", land_area="526م")
    assert rent.get("price_annual") is None and rent["price_per_meter"] == 1500

    row, _, _ = mapped(som="1500 للمتر", land_area="غير متوفر")
    assert row["price_per_meter"] == 1500
    assert row["price_total"] is None, "no area means no total — never a bare rate on the card"


def test_a_price_that_did_not_parse_is_still_preserved_verbatim():
    row, _, _ = mapped(som="مليون و100", limit="60.000 الف لكل مستودع")
    ai = row["additional_info"]
    assert row["price_total"] is None and ai.get("price_basis") is None
    assert ai["som_price_raw"] == "مليون و100"
    assert ai["limit_price_raw"] == "60.000 الف لكل مستودع"
    assert "per_unit" in ai["price_skip_reason"]


# ── rent period ──────────────────────────────────────────────────────────────────────────────────
def test_rent_period_is_mapped_when_stated_and_never_defaulted():
    row, _, _ = mapped(card=card(ty=2, title="للإيجار شالية بحي الصالحية بعنيزة"),
                       section="شاليهات واستراحات", limit="18.000 سنوي")   # id 950
    assert (row["transaction_type"], row["rent_period"], row["price_annual"]) == \
        ("Rent", "annual", 18_000)

    row, _, _ = mapped(card=card(ty=2, title="للإيجار شالية بحي الصالحية بعنيزة"),
                       section="شاليهات واستراحات", limit="15.000")        # id 547
    assert row["transaction_type"] == "Rent"
    assert row.get("rent_period") is None, "an unstated period must stay NULL, not become annual"
    assert row["price_annual"] == 15_000


def test_the_period_is_read_from_the_prices_own_cell_only():
    """«18.000» under السوم with «1500 شهري» under الحد: 18,000 states no period of its own."""
    row, _, _ = mapped(card=card(ty=2, title="للإيجار شالية بحي الصالحية بعنيزة"),
                       section="شاليهات واستراحات", som="18.000", limit="1500 شهري")
    assert row.get("rent_period") is None and row["price_annual"] == 18_000


@pytest.mark.parametrize("title", ["للبيع بالمزاد ارض بعنيزة", "ارض في المزاد العلني بعنيزة",
                                   "مزادات عقارية ارض بعنيزة"])
def test_an_auction_with_a_prefix_is_still_an_auction(title):
    assert R._AUCTION_RE.search(title)
    assert not R._AUCTION_RE.search("ارض بحي المزادة بعنيزة")


# ── amenities: silence is NULL ───────────────────────────────────────────────────────────────────
def test_silence_and_a_prepared_fitting_are_not_false():
    row, _, _ = mapped(section="فلل", details="تتكون من : مجلس + صالة", land_area="270م")
    assert "elevator" not in row, "an unmentioned lift is NULL, never False"
    assert "furnished" not in row

    row, _, _ = mapped(section="فلل", details="غير مؤثثة", land_area="270م")
    assert row["furnished"] is False, "the source NEGATED it — that is a real False"

    row, _, _ = mapped(section="عمائر", details="مصعد مؤسس", land_area="270م")
    assert row.get("elevator") is None, "«مؤسس» = prepared for, not present"

    row, _, _ = mapped(section="فلل", details="قريب من حديقة", land_area="270م")
    assert not any(v is True for k, v in row.items() if isinstance(v, bool) and k != "active"), \
        "the NEIGHBOURHOOD's park is not this property's feature"


# ── rooms, location, deal ────────────────────────────────────────────────────────────────────────
def test_only_an_explicit_bedroom_phrase_becomes_bedrooms():
    row, _, _ = mapped(section="فلل", land_area="270م",
                       details="4غرف نوم مع 3دوراة مياة+ صالة")            # id 1589
    assert (row["bedrooms"], row["bathrooms"]) == (4, 3)

    row, _, _ = mapped(section="مستودعات", land_area="540م",
                       details="5 مستودعات كل مستودع مع غرفة حارس + حمام",  # id 1323
                       title="للبيع مستودعات بحي الصالحية بعنيزة")
    assert row.get("bedrooms") is None, "a guard room in a warehouse is not a bedroom"


def test_two_different_street_widths_leave_the_column_null():
    row, _, _ = mapped(details="تفتح على شارع عرض 15م جنوبأ بطول 20م")      # id 3793
    assert row["street_width_m"] == 15
    row, _, _ = mapped(details="شارع عرض 45م غربأ بطول 20م وشارع عرض 20م شمالا بطول 22م")
    assert row.get("street_width_m") is None


def test_a_city_the_catalog_does_not_know_is_skipped_not_guessed():
    row, _, why = mapped(card=card(title="للبيع فيلا بحي المحمدية بعينزة"), section="فلل")
    assert row is None and why == "city_not_in_catalog"


def test_a_district_field_holding_a_city_never_reaches_the_card():
    """Three live rentals titled «… بعنيزة» carry «الحي: الدوادمي» — a town 500 km away."""
    row, _, _ = mapped(district="الدوادمي", section="فلل",
                       title="للبيع فيلا بحي الصالحية بعنيزة")
    assert row["city_ar"] == UNAIZAH
    assert row["neighborhood"] is None
    assert row["additional_info"]["district_field_raw"] == "الدوادمي"


def test_a_title_that_contradicts_the_index_deal_is_skipped():
    """id 217 sits in the RENT index with a «للبيع» title — two source claims, no known deal."""
    row, _, why = mapped(card=card(ty=2, title="للبيع إستراحة شباب بالخليج/عنيزة"),
                         section="شاليهات واستراحات")
    assert row is None and why == "deal_title_contradicts_index"


def test_an_investment_offer_is_not_coerced_into_buy_or_rent():
    row, _, why = mapped(card=card(ty=3, title="للإستثمار أرض تجارية بحي الصالحية بعنيزة"),
                         section="أراضي تجارية")
    assert row is None and why == "deal_investment_not_buy_or_rent"


# ── photos + row shape ───────────────────────────────────────────────────────────────────────────
def test_only_the_gallery_is_this_listings_photos():
    """The «عقارات مشابهة» cards on the same page serve from the same /download/products/ folder;
    attaching them would put twelve other properties' pictures on this card."""
    row, _, _ = mapped(gallery=3, siblings=12)
    assert row["photo_urls"] == [f"https://ialqarawi.com/download/products/gal{i}.png"
                                 for i in range(3)]

    row, _, _ = mapped(gallery=28, siblings=6)
    assert len(row["photo_urls"]) == 20, "the column caps at 20"


def test_every_key_the_scraper_writes_is_a_real_listing_column():
    """PGRST204 rejects the WHOLE batch on one unknown key — a run that fetched perfectly writes
    nothing (the suwar incident, 2026-09-14)."""
    row, _, _ = mapped(section="فلل", land_area="270م", som="850 الف", parcel="131",
                       details="4غرف نوم مع 3دوراة مياة+ صالة مصعد مدخل سيارة "
                               "ترخيص الاعلان : 7200123456 شارع عرض 15م")
    extra = set(row) - LISTING_COLUMNS
    assert not extra, f"not columns of ialqarawi_*_listings: {sorted(extra)}"
    assert row["license_number"] == "7200123456"
    assert row["ad_number"] == "QRW3793"
    assert row["listing_url"] == "https://ialqarawi.com/index.php?router=card&id=3793&catid=46"


def test_the_index_only_counts_the_results_section():
    """The nav and footer carry ~24 more `router=card` links per page; counting the whole document
    would attribute other categories' listings to this one."""
    card_html = R._CARD_RE.search(HOMEPAGE).group(0)
    nav = "<nav>" + card_html.replace(R._CARD_RE.search(HOMEPAGE).group(2), "99999") + "</nav>"
    assert len(R._CARD_RE.findall(nav + HOMEPAGE)) == 2, "the nav link must be a real card link"

    class _Page:                      # runs the REAL fetch_index over one category page
        status_code, text = 200, nav + HOMEPAGE + nav

    class _S:
        def get(self, *_a, **_k):
            return _Page()

    assert len(R.fetch_index(_S(), deal_types=(1,))) == 1


def test_age_and_a_single_facade_are_read_only_from_their_anchored_phrases():
    row, _, _ = mapped(details="فيلا العمر ٤ سنوات واجهة شرقية")                  # QRW567 / QRW3090
    assert (row["property_age"], row["direction"]) == (4, "شرق")
    row, _, _ = mapped(details="العمر يتجاوز 30 سنه واجهة شرقية وواجهة غربية ضمان 25 سنه")
    assert row.get("property_age") is None and row.get("direction") is None
    row, _, _ = mapped(details="تفتح على شارع عرض 13.5م جنوبأ")
    assert row.get("street_width_m") is None, "a fraction is not truncated into the smallint"


def test_a_labelled_per_metre_figure_has_no_plausibility_ceiling():
    """Owner rule: no plausibility gate on a source-published price. Only the documented unit
    ambiguity («1 حد المتر» may be «1 [ألف]») abstains; a large labelled rate is stored as given."""
    assert R.parse_money("250000 حد المتر") == (None, 250000, "")
    assert R.parse_money("1 حد المتر") == (None, None, "ppm_unit_unstated")


# ── 2026-09-23: the host started refusing some TLS fingerprints ──────────────────────────────────
class _Resp:
    def __init__(self, status, text):
        self.status_code, self.text = status, text
        self.headers, self.url = {}, ""


class _FakeSession:
    """Stands in for curl_cffi's Session: answers per impersonate profile, like the live host did."""
    SERVED = {}
    seen = []

    def __init__(self, impersonate=None, **_kw):
        self.impersonate = impersonate
        self.headers = {}
        _FakeSession.seen.append(impersonate)

    def get(self, *_a, **_kw):
        return _FakeSession.SERVED.get(self.impersonate, _Resp(403, "<title>403 - Forbidden</title>"))


def test_the_session_walks_past_a_refused_fingerprint_to_one_that_serves_cards(monkeypatch):
    """Measured live: chrome116/120/124 → an identical 75,193-byte 403; safari/firefox/edge → the
    full catalogue, same IP. A run that pins one profile reads a block as "no cards" and the
    platform silently stops refreshing (two daily runs did, 2026-09-22 and 09-23)."""
    from scrapers.common import http
    _FakeSession.seen = []
    _FakeSession.SERVED = {"safari17_0": _Resp(200, '<section class="cards"><a href="index.php?router=card&id=1"></a>')}
    monkeypatch.setattr(http.cc, "Session", _FakeSession)
    s = R.session()
    assert s.impersonate == "safari17_0"
    assert s.__dict__["_impersonate_profile"] == "safari17_0"
    assert _FakeSession.seen[0] == "chrome", "the newest chrome is still tried first"


def test_a_200_that_is_the_block_page_is_not_accepted_as_a_served_profile(monkeypatch):
    """The block can arrive as HTTP 200 with a challenge body. A profile counts as served only when
    the page carries the catalogue section this scraper reads."""
    from scrapers.common import http
    _FakeSession.SERVED = {p: _Resp(200, "<title>Just a moment…</title>") for p in http.IMPERSONATE_ORDER}
    monkeypatch.setattr(http.cc, "Session", _FakeSession)
    with pytest.raises(RuntimeError) as e:
        R.session()
    msg = str(e.value)
    assert "no TLS profile was served" in msg
    for prof in http.IMPERSONATE_ORDER:
        assert prof in msg, "the error must name every profile tried, so a block is not read as a dead site"


# ---------------------------------------------------------------------------
# AREA vs PRICE: «X.YYY» is thousands-grouped in a price cell and a decimal on a
# surveyed land area. Every string below is a verbatim `area_raw` measured from
# production (all 2,568 ialqarawi rows, 150 separator strings).
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("raw,m2", [
    ("4,260 م²", 4_260),              # head 1 — canonical grouping
    ("11.295م", 11_295),              # head 2
    ("509,879م", 509_879),            # head 3
    ("175.000 الف متر", 175_000),     # head 3, «الف» is the redundant word again
    ("1,056,174م", 1_056_174),        # head 1, two groups
    ("10,630,467 م²", 10_630_467),    # head 2, two groups
    ("1500.000م", 1_500_000),         # head 4 — this office's «1500 thousand» shorthand
    ("526م", 526),                    # no separator at all
    ("517.5م", 517),                  # a 1-2 digit fraction is a decimal and truncates to int4
])
def test_an_unambiguous_area_is_read_exactly_as_before(raw, m2):
    assert R.parse_area(raw) == (m2, "")


def test_a_five_plus_digit_head_is_ambiguous_and_the_parser_abstains():
    """REGRESSION (routine-3, 2026-09-24). Listing QRW3566 — «للبيع أرض زراعية بحي شمال عنيزة»,
    source area «361788.431م» — was stored and indexed at 361,788,431 m², i.e. 362 km², because
    parse_area reused the PRICE grammar in which a dot followed by exactly three digits is a
    thousands separator. The source's own description gives the plot's frontages as 316.64 m /
    245.70 m / 698.97 m / 504 m, which no 362 km² parcel has.

    That row happens to carry no source price, so it is production_ready=false and was never served
    as a Normal Filter card — but the parser is the live one, and the next surveyed ialqarawi area
    that DOES carry a price would reach users 1000x wrong. The defect is the grammar, not the row.

    Both readings (361,788.431 m² and 361,788,431 m²) are grammatically available and differ by
    1000x, and the stored capture is an auto.v1-fallback with no raw HTML, so nothing on record can
    settle it. The parser must therefore publish NEITHER: honest NULL beats a guess, and the exact
    string survives in additional_info.area_raw.
    """
    assert R.parse_area("361788.431م") == (None, "ambiguous_thousands_or_decimal")
    # The class, not just the one row.
    assert R.parse_area("12345.678 م²") == (None, "ambiguous_thousands_or_decimal")


def test_the_price_grammar_is_deliberately_untouched_by_the_area_rule():
    """A price is never written to three decimals, so parse_money keeps its measured reading —
    the abstention above must not leak across and start nulling prices."""
    assert R.parse_money("3850.000")[0] == 3_850_000
    assert R.parse_money("1.600.000 الف")[0] == 1_600_000
