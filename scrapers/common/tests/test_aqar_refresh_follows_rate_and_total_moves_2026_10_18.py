"""aqar: the price refresh follows the source when it moves between a per-metre rate and a total (2026-10-18).

Read live that day by the read-only aqar-price-probe (run 39148998971) and in a browser:
  • 6903628 — aqar's RSC `listing` now publishes price 1,575,000, meter_price 3,500, area 450, and the price slot
    renders «1,575,000 ريال» with «سعر المتر 3,500». We still held 3,500 as the TOTAL (stored when the ad was
    priced by the metre). The refresh read the first «"price":N» in the body and the artifact guard compared it with
    the stale stored rate, so the move was never followed.
  • 6885624 — the price slot renders «600 ريال» and the ad says «سعر المتر 600 ريال»: the headline IS the rate, so
    the stored 600 «total» must clear.
  • 6896329 — price 3,500 and REGA's declared total `rega_total_price` 3,500: the licence states it as the total,
    so it is NOT read as a rate even though the page's «سعر المتر» shows the same figure.
A rate of 1 is aqar's placeholder and is never read as a rate here (those rows are left as they are).
"""
from __future__ import annotations

import json

import pytest

from scrapers.aqar import enrich_residential as ER
from scrapers.aqar.liveness import refresh_decision


def _body(listing: dict, visible: str = "") -> str:
    obj = {"id": 1, "published": True, "status": 0, "closed": False, **listing}
    return ('<html><head><script type="application/ld+json">{"@type":"Offer","price":' + str(listing.get("price"))
            + '}</script></head><body>' + visible + '<script>' + json.dumps({"listing": obj}) + '</script></body></html>')


def test_rate_to_total_is_followed():
    body = _body({"price": 1575000, "meter_price": 3500, "area": 450, "rega_total_price": 1575000},
                 "1,575,000 § ريال المساحة 450م² سعر المتر 3,500 § ريال")
    assert refresh_decision(body, old_price=3500, area_m2=450, stored_ppm=3500) == ("write", 1575000)


def test_a_headline_that_is_the_rate_clears_the_stored_total():
    body = _body({"price": 600, "meter_price": 600, "area": 10000}, "600 § ريال سعر المتر 600 ريال")
    assert refresh_decision(body, old_price=600, area_m2=10000, stored_ppm=600) == ("clear", None)
    text_only = _body({"price": 600, "area": 10000}, "600 § ريال أرض مسورة سعر المتر 600 ريال")
    assert refresh_decision(text_only, old_price=2_400_000, area_m2=10000, stored_ppm=None) == ("clear", None)


def test_regas_declared_total_is_a_total_and_a_placeholder_rate_is_left_alone():
    rega = _body({"price": 3500, "rega_total_price": 3500, "area": 2494}, "3,500 § ريال سعر المتر 3,500 § ريال")
    assert refresh_decision(rega, old_price=3500, area_m2=2494, stored_ppm=3500)[0] in ("keep", "reject")
    placeholder = _body({"price": 1, "meter_price": 1, "area": 717928}, "سعر المتر 1 §")
    assert refresh_decision(placeholder, old_price=717928, area_m2=717928, stored_ppm=1)[0] != "clear"


def test_an_unchanged_total_is_kept_and_an_unreadable_payload_falls_back_to_the_body():
    same = _body({"price": 900000, "area": 450}, "900,000 § ريال")
    assert refresh_decision(same, old_price=900000, area_m2=450, stored_ppm=2000) == ("keep", None)
    no_payload = '<script type="application/ld+json">{"@type":"Offer","price":950000}</script>'
    assert refresh_decision(no_payload, old_price=900000, area_m2=450, stored_ppm=2000) == ("write", 950000)


@pytest.mark.parametrize("obj, price, text_ppm, want", [
    ({"meter_price": 3500}, 3500, None, True),
    ({"meter_price": 3500}, 1575000, 3500, False),
    ({}, 600, 600, True),
    ({"rega_total_price": 3500}, 3500, 3500, False),
    ({"meter_price": 1}, 1, 1, False),
])
def test_headline_is_rate(obj, price, text_ppm, want):
    assert ER.headline_is_rate(obj, price, text_ppm) is want


# ── the enricher writes the same verdict (it is what the stub-recovery re-read and new captures use) ─────────────
def _enrich(listing: dict, prose: str):
    from scrapers.common.tests.test_aqar_structured_price import _page, _parse
    return _parse(_page({"id": 6885624, "published": True, **listing}, prose=prose),
                  deal="sale", ptype="أراضي-للبيع")


def test_the_enricher_clears_a_rate_headline_and_keeps_a_moved_total():
    from scrapers.common.db import AUTHORITATIVE_NULL
    row = _enrich({"price": 600, "meter_price": 600, "area": 10000}, "600 § ريال سعر المتر 600 ريال")
    assert row["price_total"] is AUTHORITATIVE_NULL and row["price_per_meter"] == 600
    assert row["price_evidence"]["unit"] == "per_meter"
    row = _enrich({"price": 1575000, "meter_price": 3500, "area": 450}, "1,575,000 § ريال سعر المتر 3,500 § ريال")
    assert row["price_total"] == 1575000 and row["price_per_meter"] == 3500
