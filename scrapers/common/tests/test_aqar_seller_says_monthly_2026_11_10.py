"""A monthly rent is never stored as a yearly one because aqar's price box said «سنوي» (owner, 2026-11-10).

Aqar ad 6560368 (a Jeddah flat, row 14990555) was the cheapest "yearly" rental on Ezhalah: 9,499 a year. Aqar's own
price box says «/سنوي»; the seller's own words in the same ad say «السعر الشهري: 9499 ريال فقط». The real rent is
9,499 a MONTH. `seller_says_monthly()` reads the seller's text and, only when the monthly word belongs to the very
figure aqar publishes, the ad is stored as monthly (period "monthly", yearly figure = advertised figure x 12).

It is deliberately narrow, and every limit is pinned here:
  * 8,000..10,000 only. Under 8,000 the serving rule already treats a "yearly" figure as monthly
    (docs/ARCHITECTURE.md §20) -- flipping here too would multiply twice. Above 10,000 nothing is touched.
  * homes and business units only (the serving rule's thirteen types) -- never rooms, land, chalets, farms.
  * a second figure beside the word, a yearly word, «دفعة واحدة», or the fleet's own reader saying "annual"
    leave the ad exactly as aqar published it.
  * the PRICE is never read from the text: the figure is aqar's own, only its period comes from the seller.

The texts are real seller texts from production: scripts/fixtures/aqar-seller-says-monthly.json, the same file
scripts/verify-aqar-seller-says-monthly.ts reads (that guard also breaks the rule fourteen ways).

Run: python -m pytest scrapers/common/tests/test_aqar_seller_says_monthly_2026_11_10.py -v
"""
import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT))

import scrapers.aqar.enrich_residential as E  # noqa: E402  -- the REAL module, never a copy
from scrapers.common import normalize as N  # noqa: E402

F = json.loads((ROOT / "scripts/fixtures/aqar-seller-says-monthly.json").read_text(encoding="utf-8"))
MONTHLY, YEARLY, TRICKY = F["monthly"], F["yearly"], F["tricky"]


def _worded(n: int) -> str:
    return f"الايجار الشهري {n} ريال"


# ── the rule on real seller texts ────────────────────────────────────────────────────────────────

def test_the_fixture_is_not_empty_or_thinned():
    assert len(MONTHLY) >= 24 and len(YEARLY) >= 9 and len(TRICKY) >= 21
    assert sum(1 for c in MONTHLY if c["flips"]) >= 22
    assert any(c["row"] == 14990555 and c["price"] == 9499 and c["flips"] for c in MONTHLY), "the ad the owner saw"


@pytest.mark.parametrize("c", [c for c in MONTHLY if c["flips"]], ids=lambda c: f"row{c['row']}")
def test_seller_says_monthly_is_read_as_monthly(c):
    assert E.seller_says_monthly(c["price"], c["text"], c["type"]) is True


@pytest.mark.parametrize("c", [c for c in MONTHLY if not c["flips"]], ids=lambda c: f"row{c['row']}")
def test_true_monthly_ads_the_strict_rule_leaves_alone_on_purpose(c):
    """Really monthly, but the text is not certain enough. Leaving a yearly label is the safe miss; a wrong x12 is not."""
    assert c.get("why_left"), "a deliberate miss must say why"
    assert E.seller_says_monthly(c["price"], c["text"], c["type"]) is False


@pytest.mark.parametrize("c", YEARLY, ids=lambda c: f"row{c['row']}")
def test_yearly_ads_are_never_flipped(c):
    assert E.seller_says_monthly(c["price"], c["text"], c["type"]) is False
    assert E.seller_says_monthly(c["price"], c["text"], "Apartment") is False, "the same words on a flat"


@pytest.mark.parametrize("c", TRICKY, ids=lambda c: f"{c['price']}:{c['text'][:28]}")
def test_tricky_wordings(c):
    assert E.seller_says_monthly(c["price"], c["text"], "Apartment") is c["monthly"]


# ── the limits ───────────────────────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("price,want", [(5000, False), (7999, False), (8000, True), (9499, True), (10000, True),
                                        (10001, False), (12000, False), (113988, False)])
def test_only_between_8000_and_10000(price, want):
    assert E.seller_says_monthly(price, _worded(price), "Apartment") is want


def test_the_band_starts_where_the_serving_rule_stops_and_ends_at_the_fleet_ceiling():
    assert E.SELLER_MONTHLY_MIN == 8_000          # = CHEAP_YEARLY_BELOW in src/lib/rentPool.ts (the TS guard compares them)
    assert N.MONTHLY_LOOKING_MAX == 10_000


@pytest.mark.parametrize("ptype", sorted(E.SELLER_MONTHLY_TYPES))
def test_homes_and_business_units_are_covered(ptype):
    assert E.seller_says_monthly(9000, _worded(9000), ptype) is True


@pytest.mark.parametrize("ptype", ["Room", "Residential Land", "Commercial Land", "Other Land", "Rest House", "Chalet",
                                   "Camp", "Farm", "Unknown", "", None])
def test_other_types_are_never_touched(ptype):
    assert ptype not in E.SELLER_MONTHLY_TYPES
    assert E.seller_says_monthly(9000, _worded(9000), ptype) is False


def test_exactly_the_thirteen_types():
    assert E.SELLER_MONTHLY_TYPES == frozenset({
        "Apartment", "Villa", "Floor", "Duplex", "Studio", "House", "Building", "Residential Building",
        "Office", "Shop", "Warehouse", "Showroom", "Commercial Building"})


@pytest.mark.parametrize("price,content", [(None, _worded(9000)), (0, _worded(9000)), (9000, None), (9000, ""),
                                           (9000, 9000), (9000, ["الايجار الشهري 9000"]), (9000, {"x": 1})])
def test_missing_or_odd_input_is_left_alone(price, content):
    assert E.seller_says_monthly(price, content, "Apartment") is False


# ── the whole reader, on a page shaped like aqar's ───────────────────────────────────────────────

URL = "https://sa.aqar.fm/شقق-للإيجار/جدة/حي-الشاطئ/x-6560368"
BASE = {"id": 6560368, "published": True, "location": {"lat": 21.6, "lng": 39.1}}
YEARLY_SLOT = "9,499 <span>§</span> ريال /سنوي"
SAYS_MONTHLY = "شقة فاخرة السعر الشهري: 9499 ريال فقط"


class _Resp:
    def __init__(self, text):
        self.text = text


def _page(listing, slot, rnpl=False, flight=None):
    inner = json.dumps({"listing": listing}, ensure_ascii=False)
    blob = f"<script>self.__next_f.push([1,{json.dumps(inner, ensure_ascii=False)}])</script>"
    if flight:   # a long description: listing.content = "$8a" and the text in its own flight row
        row = "\n8a:T%x,%s" % (len(flight.encode("utf-8")), flight)
        blob += f"<script>self.__next_f.push([1,{json.dumps(row, ensure_ascii=False)}])</script>"
    extra = '<a href="/rnpl/apply">x</a><p>استأجر الآن وأدفع لاحقًا ابتداءً من981 § ريال شهريا</p>' if rnpl else ""
    return (f"<html><body><h1>شقة للإيجار</h1><div><h3><span>{slot}</span></h3></div>"
            f"<div>تفاصيل الإعلان المساحة 120 م²</div><p>{listing.get('content') or ''}</p>{extra}{blob}</body></html>")


def _read(monkeypatch, slot=YEARLY_SLOT, slug="apartment", deal="rent", rnpl=False, flight=None, **over):
    listing = {**BASE, "price": 9499, "rent_period": 3, "content": SAYS_MONTHLY, **over}
    monkeypatch.setattr(E, "get", lambda *a, **k: _Resp(_page(listing, slot, rnpl, flight)))
    row = E.enrich_residential(URL, type_slug=slug, deal_slug=deal)
    assert row is not None
    return row


def test_page_box_says_yearly_seller_says_monthly(monkeypatch):
    row = _read(monkeypatch)
    assert row["rent_period"] == "monthly"
    assert row["price_annual"] == 9499 * 12 == 113988
    assert row["source_capture"]["rent_period_from"] == "seller_text"
    # the PRICE is still aqar's own structured figure -- never read from the seller's prose
    assert row["price_evidence"]["origin"] == "structured"


def test_page_no_period_from_aqar_seller_says_monthly(monkeypatch):
    row = _read(monkeypatch, slot="9,499 <span>§</span> ريال", rent_period=None)
    assert (row["rent_period"], row["price_annual"]) == ("monthly", 113988)
    assert row["source_capture"]["rent_period_from"] == "seller_text"


def test_page_seller_says_yearly_is_untouched(monkeypatch):
    row = _read(monkeypatch, content="الايجار السنوي 9499 ريال")
    assert (row["rent_period"], row["price_annual"]) == ("annual", 9499)
    assert "rent_period_from" not in row["source_capture"]


def test_page_aqars_own_monthly_is_not_marked_as_the_sellers_word(monkeypatch):
    row = _read(monkeypatch, slot="9,499 <span>§</span> ريال /شهري", rent_period=2)
    assert (row["rent_period"], row["price_annual"]) == ("monthly", 113988)
    assert "rent_period_from" not in row["source_capture"]


def test_page_room_is_untouched(monkeypatch):
    row = _read(monkeypatch, slug="room")
    assert (row["rent_period"], row["price_annual"]) == ("annual", 9499)


@pytest.mark.parametrize("price", [5000, 12000])
def test_page_outside_the_band_is_untouched(monkeypatch, price):
    row = _read(monkeypatch, slot=f"{price:,} <span>§</span> ريال /سنوي", price=price, content=f"السعر الشهري: {price} ريال")
    assert (row["rent_period"], row["price_annual"]) == ("annual", price)
    assert "rent_period_from" not in row["source_capture"]


def test_page_pay_later_seller_says_monthly_is_monthly(monkeypatch):
    """aqar 6560368 itself is a pay-later page: «10,999 → 9,499 سنوي … ابتداءً من 981 ريال شهريا … السعر الشهري: 9499»."""
    row = _read(monkeypatch, rnpl=True)
    assert (row["rent_period"], row["price_annual"]) == ("monthly", 113988)
    assert row["source_capture"]["rent_period_from"] == "seller_text"


def test_page_pay_later_instalment_line_alone_is_not_monthly(monkeypatch):
    row = _read(monkeypatch, rnpl=True, content="شقة مفروشة راقية 3 غرف نوم")
    assert (row["rent_period"], row["price_annual"]) == ("annual", 9499)
    assert "rent_period_from" not in row["source_capture"]


def test_page_seller_text_behind_a_flight_reference_is_read(monkeypatch):
    """aqar 6560368 live: listing.content == "$8a"; the text is the flight row «8a:T8ae,🔥 للإيجار الشهري … 9499»."""
    row = _read(monkeypatch, rnpl=True, content="$8a",
                flight="🔥 للإيجار الشهري | شقة مفروشة\n\n💰 السعر الشهري: 9499  ريال فقط\n✨ شامل الكهرباء")
    assert (row["rent_period"], row["price_annual"]) == ("monthly", 113988)
    assert row["source_capture"]["rent_period_from"] == "seller_text"


def test_an_unresolvable_reference_is_unknown_text(monkeypatch):
    row = _read(monkeypatch, content="$8b")
    assert (row["rent_period"], row["price_annual"]) == ("annual", 9499)


@pytest.mark.parametrize("content,want", [("السعر الشهري: 9499", "السعر الشهري: 9499"), (None, None), (5, None),
                                          ("$zz", "$zz")])
def test_seller_text_returns_inline_text_unchanged(content, want):
    assert E.seller_text({"content": content}, "") == want


def test_page_sale_ad_has_no_rent_period(monkeypatch):
    row = _read(monkeypatch, slot="9,499 <span>§</span> ريال", deal="sale")
    assert row["rent_period"] is None and row["price_annual"] is None
    assert row["price_total"] == 9499
