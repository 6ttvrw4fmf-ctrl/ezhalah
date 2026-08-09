"""aqar price + rent period come from aqar's OWN statement, never from a guess.

Pins the 2026-08-09 price-path verification. Each rule below was established by probing live aqar
listings from a GitHub runner (aqar serves laptops a 241 KB app shell, so the evidence had to be
gathered in CI — see `scrapers/aqar/probe_price.py` and the `Aqar price probe` workflow):

  • the structured `price` field and the number aqar RENDERS agreed 84/84 on live listings;
  • every apparent disagreement was an «N شهريا» RNPL financing instalment, never the rent;
  • `published: false` listings render «طلب تسويق» and show the human NO price, while the payload
    still carries the advertiser's figure (21/150 sampled) — that figure must never be imported;
  • the old `rent_period = "annual"` default asserted a billing period on listings where aqar states
    none, including 2,040 live rows that have no price at all.

The rules these tests hold in place, in one line: WHEN AQAR SPEAKS WE COPY IT, WHEN AQAR IS SILENT
WE STAY SILENT, AND PROSE IS ONLY EVER A FALLBACK FOR A PAYLOAD WE COULD NOT READ.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[3]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scrapers.aqar import enrich_residential as ER  # noqa: E402


def _page(listing: dict, *, prose: str = "") -> str:
    """A page shaped like aqar's: the listing object inside an RSC flight chunk, plus rendered text.

    The payload is escaped exactly as aqar escapes it — JSON inside a JS string literal, non-ASCII
    as raw UTF-8 — so the test exercises the real unescape path rather than a convenient shortcut.
    """
    body = json.dumps({"listing": listing}, ensure_ascii=False)
    escaped = body.replace("\\", "\\\\").replace('"', '\\"')
    return f'<script>self.__next_f.push([1,"{escaped}"])</script><div>{prose}</div>'


def _parse(html: str, *, deal: str = "rent", ptype: str = "شقق-للإيجار"):
    """Run the production enricher over `html` without touching the network."""
    class _R:
        text = html
    orig = ER.get
    ER.get = lambda url, **kw: _R()          # noqa: ARG005
    try:
        return ER.enrich_residential(
            f"https://sa.aqar.fm/{ptype}/الرياض/حي-الملقا/شارع-س-6600001",
            type_slug="شقق", deal_slug=deal)
    finally:
        ER.get = orig


# ── the payload is the source of truth ───────────────────────────────────────────────────────────

def test_published_price_is_copied_verbatim():
    row = _parse(_page({"id": 6600001, "price": 16000, "published": True, "rent_period": 3},
                       prose="16,000 § سنوي"))
    assert row["price_annual"] == 16000
    assert row["rent_period"] == "annual"


def test_price_is_never_recomputed_from_the_rendered_number():
    """A rendered figure that disagrees with the payload does NOT get to move the price."""
    row = _parse(_page({"id": 6600001, "price": 18000, "published": True, "rent_period": 3},
                       prose="134 § شهريا 18,000 § سنوي"))     # 134 شهريا is the RNPL instalment
    assert row["price_annual"] == 18000


def test_unpublished_price_stays_null_even_though_the_payload_carries_a_number():
    """`published: false` renders «طلب تسويق» — aqar shows no price, so neither do we."""
    row = _parse(_page({"id": 6600001, "price": 20000, "published": False, "rent_period": 3},
                       prose="طلب تسويق"))
    assert row["price_annual"] is None


def test_no_price_at_source_is_not_filled_from_a_neighbouring_listing_card():
    """The live 6689796 defect: aqar publishes no price, prose scan lifted 2,000 from a related card.

    The page deliberately has NO «تفاصيل الإعلان» anchor, which is what defeated the old
    cross-listing guard — the payload's statement has to be what stops it.
    """
    row = _parse(_page({"id": 6600001, "price": None, "published": True},
                       prose="2,000 § سنوي 2,400 § سنوي"))     # related-listing strip
    assert row["price_annual"] is None


def test_zero_price_is_absence_not_a_price():
    row = _parse(_page({"id": 6600001, "price": 0, "published": True}, prose=""))
    assert row["price_annual"] is None


# ── rent period: evidence or nothing ─────────────────────────────────────────────────────────────

def test_rent_period_is_never_defaulted_to_annual():
    """No enum, no rendered period word, no price → the period is UNKNOWN, not "annual"."""
    row = _parse(_page({"id": 6600001, "price": None, "published": True}, prose=""))
    assert row["rent_period"] is None, "a missing period must stay NULL, never default to annual"


def test_rent_period_from_aqar_enum():
    row = _parse(_page({"id": 6600001, "price": 30000, "published": True, "rent_period": 3},
                       prose=""))
    assert row["rent_period"] == "annual"


def test_rent_period_from_the_rendered_word_when_the_enum_is_absent():
    row = _parse(_page({"id": 6600001, "price": 30000, "published": True}, prose="30,000 § سنوي"))
    assert row["rent_period"] == "annual"


def test_enum_2_is_monthly_and_the_price_is_annualized():
    """Live proof: ad 6586188 carries enum 2, price_text "6,500", and renders «6,500 شهري».

    aqar DOES publish monthly residential rentals, so the retired `"annual"` default was not merely
    unevidenced — it filed a monthly rent as a yearly one, understating it 12×.
    """
    row = _parse(_page({"id": 6600001, "price": 6500, "published": True, "rent_period": 2},
                       prose="6,500 § شهري"))
    assert row["rent_period"] == "monthly"
    assert row["price_annual"] == 6500 * 12, "price_annual holds the ANNUAL figure by contract"


def test_period_is_read_beside_the_price_even_below_the_details_anchor():
    """The 104-row gap: the price headline is not always above «تفاصيل الإعلان».

    Searching the full page text is safe because the search is anchored on the published figure.
    """
    row = _parse(_page({"id": 6600001, "price": 40000, "published": True},
                       prose="تفاصيل الإعلان المساحة 120 م² 40,000 § سنوي"))
    assert row["rent_period"] == "annual"


def test_an_rnpl_instalment_line_never_supplies_the_period():
    """«597 شهريا» is financing, not rent. Anchoring on the published figure is what excludes it."""
    row = _parse(_page({"id": 6600001, "price": 6690, "published": True},
                       prose="6,690 § سنوي 597 § شهريا"))
    assert row["rent_period"] == "annual"
    assert row["price_annual"] == 6690, "the instalment must not become the rent"


def test_a_neighbouring_listing_card_never_supplies_the_period():
    """A related-listing strip prints other listings' «N سنوي». Ours is 8,000, which appears nowhere
    with a period word, so the honest answer is unknown."""
    row = _parse(_page({"id": 6600001, "price": 8000, "published": True},
                       prose="2,000 § سنوي 2,400 § سنوي"))
    assert row["price_annual"] == 8000
    assert row["rent_period"] is None


def test_unmapped_enum_value_does_not_invent_a_period():
    row = _parse(_page({"id": 6600001, "price": 30000, "published": True, "rent_period": 99},
                       prose=""))
    assert row["rent_period"] is None


def test_buy_listing_never_carries_a_rent_period():
    row = _parse(_page({"id": 6600001, "price": 1200000, "published": True}, prose="1,200,000 §"),
                 deal="buy", ptype="شقق-للبيع")
    assert row["rent_period"] is None
    assert row["price_total"] == 1200000
    assert row["price_annual"] is None


def test_monthly_rendered_against_the_published_figure_is_annualized_and_tagged():
    """Not seen on aqar today; pinned so a future monthly product cannot be filed as yearly."""
    row = _parse(_page({"id": 6600001, "price": 2500, "published": True}, prose="2,500 § شهري"))
    assert row["rent_period"] == "monthly"
    assert row["price_annual"] == 2500 * 12


# ── prose fallback survives only for an unreadable payload ───────────────────────────────────────

def test_prose_fallback_when_the_payload_is_unreadable():
    """No RSC payload at all → the legacy prose path still works, unchanged."""
    row = _parse("<div>45,000 § سنوي تفاصيل الإعلان</div>")
    assert row["price_annual"] == 45000
    assert row["rent_period"] == "annual"


def test_i18n_bundle_is_not_mistaken_for_the_listing():
    """The first `"listing":{` in aqar's payload is a label dictionary with no id — skip it."""
    body = json.dumps({"listing": {"price_label": "السعر"}}, ensure_ascii=False)
    real = json.dumps({"listing": {"id": 6600001, "price": 77000, "published": True}},
                      ensure_ascii=False)
    esc = (body + real).replace("\\", "\\\\").replace('"', '\\"')
    row = _parse(f'<script>self.__next_f.push([1,"{esc}"])</script>')
    assert row["price_annual"] == 77000


def test_arabic_survives_the_payload_unescape():
    """`unicode_escape` decodes byte-by-byte as latin-1; without the round-trip «سنوي» arrives as
    "Ø³Ù\\x86Ù\\x88Ù\\x8a" and any Arabic-valued key is unreadable."""
    html = _page({"id": 6600001, "price": 1, "published": True, "district": "حي الملقا"})
    obj = ER._listing_json(html)
    assert obj is not None and obj["district"] == "حي الملقا"


@pytest.mark.parametrize("payload,expected", [
    (None, (None, False)),                                   # unreadable fetch → prose stays in charge
    ({"id": 1}, (None, False)),                              # no price key → no statement
    ({"id": 1, "price": 5000}, (5000, True)),
    ({"id": 1, "price": None}, (None, True)),                # aqar states: no price
    ({"id": 1, "price": 5000, "published": False}, (None, True)),
])
def test_structured_price_contract(payload, expected):
    assert ER._structured_price(payload) == expected
