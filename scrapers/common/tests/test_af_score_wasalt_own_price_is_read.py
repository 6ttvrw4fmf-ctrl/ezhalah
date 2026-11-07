"""af_score.wasalt_page: wasalt's own price (propertyInfo.salePrice, a bare number) is a page line (🆕 2026-11-07).

Score run 42343488034 marked wasalt 24768819 (500,400) and 24756108 (640,000) price MISMATCH while both equal
propertyInfo.salePrice (re-read 42349778746): a number leaf never became an evidence line, so the comparison read
the description's other «ريال» figures instead.
"""
from __future__ import annotations

from scrapers.common import af_score as A
from scrapers.common import new_listings_score as S


def _page(info):
    pd = {"propertyInfo": {"description": "<p>شقة للبيع في حي الزهور، أبها</p><p>سعر المتر 2840 ريال</p>", **info}}
    return A.wasalt_page("https://wasalt.sa/en/property/x-1",
                         fetch=lambda _u: ({"props": {"pageProps": {"propertyDetailsV3": pd}}}, 200, 1))


def test_sale_price_is_a_line_and_our_price_matches():
    pg = _page({"salePrice": 640000, "conversionPrice": 640000})
    assert any(x == "السعر 640000 ريال" for x in pg["evidence_lines"])
    assert S.compare_listing({"price_total": 640000}, pg)["price"] == S.MATCH


def test_a_different_stored_price_still_mismatches():
    pg = _page({"salePrice": 640000})
    assert S.compare_listing({"price_total": 700000}, pg)["price"] == S.MISMATCH


def test_no_price_key_adds_no_line():
    pg = _page({})
    assert not any(x.startswith("السعر ") for x in pg["evidence_lines"])
