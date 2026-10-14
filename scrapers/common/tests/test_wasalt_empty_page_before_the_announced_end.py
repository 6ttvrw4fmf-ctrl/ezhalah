"""A VALID but empty page before the last page the source announced is not «the end of results»
(2026-10-14, backlog 532).

On 2026-10-13 21:00 UTC every wasalt enumeration shard stopped after ~5-6 pages on a parsed
__NEXT_DATA__ page with no properties: apartment/sale announced count=33,814 and pages≤1053 and
upserted 176, and every shard reported ok=true («upserted=176»). Only the roll-up's 40,000-row
floor noticed the enumeration had fallen 177,017 → 5,408. scrape_slice() read such a page as the
legitimate end of the catalogue; it now asks once more and, still empty, marks the slice
TRUNCATED and names where the source stopped.

Run: python -m pytest scrapers/common/tests/test_wasalt_empty_page_before_the_announced_end.py -v
"""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scrapers.wasalt import run as R  # noqa: E402


def _setup(monkeypatch, pages):
    calls: list[int] = []

    def _fp(s, deal, cat, slug, page):
        calls.append(page)
        v = pages[page]
        return v.pop(0) if isinstance(v, list) else v

    monkeypatch.setattr(R, "fetch_page", _fp)
    monkeypatch.setattr(R, "map_property", lambda prop, deal, s: {"property_type": "apartment", **prop})
    monkeypatch.setattr(R.db, "upsert_wasalt_residential_batch", lambda batch: None)
    monkeypatch.setattr(R, "_EMPTY_PAGE_RETRY_PAUSE_S", 0)
    monkeypatch.setattr(R, "_STOPS", [])
    return calls


def test_the_10_13_shape_is_truncated_and_named(monkeypatch):
    """page 1 announces 33,814 listings over 1,053 pages; page 3 is a valid empty page, twice."""
    row = [{"id": i} for i in range(30)]
    calls = _setup(monkeypatch, {
        1: (33814, 1053, row, True),
        2: (33814, 1053, row, True),
        3: (0, 0, [], True),
    })
    up, count, page1_valid, truncated = R.scrape_slice(None, "sale", "residential", "apartment", max_pages=2000)
    assert truncated is True, "an empty page 3 of 1,053 is an incomplete slice, not the end"
    assert up == 60 and count == 33814 and page1_valid is True
    assert calls.count(3) == 2, "the empty page is asked once more before giving up"
    assert R._STOPS and "empty page 3 of 1053" in R._STOPS[0]


def test_a_transient_empty_page_recovers_on_the_second_ask(monkeypatch):
    row = [{"id": i} for i in range(30)]
    _setup(monkeypatch, {
        1: (90, 3, row, True),
        2: [(0, 0, [], True), (90, 3, row, True)],
        3: (90, 3, row, True),
    })
    up, _c, _v, truncated = R.scrape_slice(None, "sale", "residential", "apartment", max_pages=10)
    assert truncated is False and up == 90
    assert R._STOPS == []


def test_the_last_announced_page_empty_is_still_a_clean_end(monkeypatch):
    """Announced 2 pages, page 2 empty: the source's own end, never truncated."""
    _setup(monkeypatch, {
        1: (2, 2, [{"id": 1}, {"id": 2}], True),
        2: (2, 2, [], True),
    })
    up, _c, _v, truncated = R.scrape_slice(None, "sale", "residential", "apartment", max_pages=10)
    assert truncated is False and up == 2


def test_all_rows_already_read_is_a_clean_end(monkeypatch):
    """The announced count already reached (count=30, 1 page of 30) and page 2 empty: done."""
    row = [{"id": i} for i in range(30)]
    _setup(monkeypatch, {
        1: (30, 5, row, True),
        2: (30, 5, [], True),
    })
    up, _c, _v, truncated = R.scrape_slice(None, "sale", "residential", "apartment", max_pages=10)
    assert truncated is False and up == 30
