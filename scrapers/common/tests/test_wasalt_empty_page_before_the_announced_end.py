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

    def _fp(s, deal, cat, slug, page, bust=None):
        calls.append(page if bust is None else (page, "bust"))
        v = pages.get(page, (0, 0, [], True))   # pages not listed answer empty
        return v.pop(0) if isinstance(v, list) else v

    monkeypatch.setattr(R, "fetch_page", _fp)
    monkeypatch.setattr(R, "map_property", lambda prop, deal, s: {"property_type": "apartment", **prop})
    monkeypatch.setattr(R.db, "upsert_wasalt_residential_batch", lambda batch: None)
    monkeypatch.setattr(R, "_EMPTY_PAGE_RETRY_PAUSE_S", 0)
    monkeypatch.setattr(R, "_STOPS", [])
    monkeypatch.setattr(R, "_ROUTE_ROTATIONS_RECOVERED", [])
    monkeypatch.setattr(R, "rotate_route", lambda s: calls.append("rotate"))
    return calls


def test_the_10_13_shape_is_truncated_and_named(monkeypatch):
    """page 1 announces 33,814 listings over 1,053 pages; from page 3 on every page is empty."""
    row = [{"id": i} for i in range(30)]
    calls = _setup(monkeypatch, {
        1: (33814, 1053, row, True),
        2: (33814, 1053, row, True),
    })
    up, count, page1_valid, truncated = R.scrape_slice(None, "sale", "residential", "apartment", max_pages=2000)
    assert truncated is True, "an empty tail before the announced end is an incomplete slice, not the end"
    assert up == 60 and count == 33814 and page1_valid is True
    assert calls.count(3) == 1 and calls.count((3, "bust")) == R._EMPTY_PAGE_RETRIES, \
        "the empty page is re-asked, cache-busted, before it is skipped"
    n = R._MAX_EMPTY_PAGES_IN_A_ROW
    last = 2 + n
    assert last + 1 not in calls, f"{n} empty pages in a row end the walk"
    assert R._STOPS and f"{n} empty pages in a row, the last {last} of 1053" in R._STOPS[0]


def test_one_page_the_source_cannot_render_is_skipped_not_the_end(monkeypatch):
    """2026-10-16 proof sweeps: the stop is deterministic per page and slides down as new ads arrive
    (floor/sale 2 -> 3, apartment/rent 7 -> 8), so it is one unrenderable page. The walk must skip it
    and keep reading, and the slice must stay TRUNCATED so the enum roll-up strikes nothing."""
    row = [{"id": i} for i in range(30)]
    calls = _setup(monkeypatch, {
        1: (150, 5, row, True), 2: (150, 5, row, True),
        4: (150, 5, row, True), 5: (150, 5, row, True),
    })
    up, _c, _v, truncated = R.scrape_slice(None, "sale", "residential", "apartment", max_pages=10)
    assert up == 120, "pages 4 and 5 are read after the unrenderable page 3"
    assert truncated is True
    assert 5 in calls
    assert any("skipped 1 empty page(s) the source could not render: 3" in x for x in R._STOPS), R._STOPS


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


def test_every_re_ask_is_cache_busted_on_a_fresh_exit(monkeypatch):
    """2026-10-16 (backlog 532/569): re-asking the SAME url — on the same exit or on 3 fresh ones —
    got the same empty page every time. Each re-ask must be preceded by a route rotation AND carry
    a cache-busting parameter, and a page that answers keeps the walk going."""
    row = [{"id": i} for i in range(30)]
    calls = _setup(monkeypatch, {
        1: (120, 4, row, True),
        2: [(0, 0, [], True), (120, 4, row, True)],
        3: (120, 4, row, True),
        4: (120, 4, row, True),
    })
    up, _c, _v, truncated = R.scrape_slice(None, "sale", "residential", "apartment", max_pages=10)
    assert truncated is False and up == 120, "the re-ask answered page 2; the slice is whole"
    i = calls.index(2)
    assert calls[i:i + 4] == [2, "rotate", (2, "bust"), 3], calls
    assert R._ROUTE_ROTATIONS_RECOVERED == ["apartment/sale p2"]


def test_recycle_drops_the_browser_process():
    from scrapers.wasalt import browser as B
    f = B.BoundedBrowserFetcher(factory=None, deadline_s=1)
    seen = []
    f._discard = lambda: seen.append("discard")
    f.recycle()
    assert seen == ["discard"]


def test_fetch_page_puts_the_bust_on_the_url(monkeypatch):
    seen = []

    class _B:
        def next_data(self, url):
            seen.append(url)
            return {"props": {"pageProps": {"searchResult": {"count": 0, "totalPages": 0, "properties": []}}}}

    monkeypatch.setattr(R, "_browser_fetch_enabled", lambda: True)
    monkeypatch.setattr(R, "_browser", lambda: _B())
    monkeypatch.setattr(R, "_throttle", lambda: None)
    R.fetch_page(None, "sale", "residential", "floor", 2)
    R.fetch_page(None, "sale", "residential", "floor", 2, bust="17")
    assert "_ezh" not in seen[0] and seen[1].endswith("&page=2&_ezh=17")


def test_a_cluster_shorter_than_the_limit_is_walked_through(monkeypatch):
    """10-16 third sweep: villa-townhouse/rent answered again after empty 16, 18, 19; a cluster of
    empties shorter than the limit must not end the slice."""
    row = [{"id": i} for i in range(30)]
    pages = {p: (300, 10, row, True) for p in (1, 2, 7, 8, 9, 10)}   # 3-6 empty: a cluster of 4
    _setup(monkeypatch, pages)
    up, _c, _v, truncated = R.scrape_slice(None, "rent", "residential", "villa-townhouse", max_pages=10)
    assert R._MAX_EMPTY_PAGES_IN_A_ROW > 4
    assert up == 180 and truncated is True
