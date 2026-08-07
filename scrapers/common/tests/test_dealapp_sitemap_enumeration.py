"""Regression test for dealapp's coverage collapse (2026-08-07 source reconciliation).

Dealapp's product sitemap now lists every /ad-details/{id} listing DIRECTLY (~58k URLs). The
enumerator used to `continue` past every /ad-details URL and re-derive ids by crawling only the
/ar/ filter pages, which reached ~7% of the catalogue — an id-level reconciliation against the live
sitemap found only 4,330 of 58,711 live listings captured. The fix harvests the listing ids straight
from the sitemap (`_sitemap_entries` returns them) and keeps the filter pages as a backstop.

Run: python -m pytest scrapers/common/tests/test_dealapp_sitemap_enumeration.py -v
"""
from unittest.mock import MagicMock

from scrapers.dealapp.run import _sitemap_entries


def _fake_session(index_xml, part_xml):
    s = MagicMock()

    def get(url, timeout=0):
        r = MagicMock()
        r.text = index_xml if url.endswith("/sitemap.xml") else part_xml
        return r

    s.get.side_effect = get
    return s


def test_listing_ids_are_taken_directly_from_the_sitemap():
    index = "<loc>https://dealapp.sa/sitemap-1.xml</loc>"
    part = (
        "<loc>https://dealapp.sa/ar/ad-details/12345</loc>"
        "<loc>https://dealapp.sa/ar/ad-details/062037</loc>"           # zero-padded variant seen in the wild
        "<loc>https://dealapp.sa/en/ad-details/12345</loc>"            # EN duplicate of the same id
        "<loc>https://dealapp.sa/ar/riyadh/apartments-for-rent</loc>"  # a real filter page
    )
    listing_ids, filter_urls = _sitemap_entries(_fake_session(index, part))

    # the bug: these ids used to be discarded, and only ~7% re-derived from filter pages
    assert "12345" in listing_ids
    assert "062037" in listing_ids
    assert listing_ids.count("12345") == 1  # EN + AR of one id collapse to a single entry

    # filter pages are kept as a backstop — and listing URLs never leak into them
    assert any("/ar/riyadh/apartments-for-rent" in u for u in filter_urls)
    assert all("/ad-details/" not in u for u in filter_urls)
