"""eydah: the crawl's own offer-page read stamps a row alive by _make_signal's LIVE rule (2026-10-27).

Two offers, re-read in full every night: no row ever reached grace, the oracle was never asked, and
neither active row had ever been verified. _make_signal's LIVE is «200 + a RealEstateListing JSON-LD
whose url is THIS listing's url» — the page the crawl already reads for every row it writes.

Measured 2026-10-27 with curl: /offers/EY-1002.html and /offers/Ey-1001.html → 200, JSON-LD url equal
to the page's own url, availability https://schema.org/InStock; /offers/zz-not-real-9999.html → 200
serving the homepage (no top-level RealEstateListing JSON-LD) — the soft-404 the oracle reads gone.
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

from scrapers.common import db  # noqa: E402
from scrapers.eydah import run as R  # noqa: E402
from scrapers.common.tests.test_eydah_static_pages_and_homepage_soft404 import (  # noqa: E402,F401
    EY_1001, EY_1002, HOME_SOFT404, _no_catalog_network)

KEY = db._DIRECT_ALIVE_KEY


def test_the_crawls_own_live_read_is_stamped():
    for href, page in (("/offers/EY-1002.html", EY_1002), ("/offers/Ey-1001.html", EY_1001)):
        d = R.parse_detail(page)
        row, _, why = R.map_listing(href, d)
        assert row and why == ""
        assert R.mark_crawl_read_live(row, d) is True
        assert row[KEY] == R.CRAWL_LIVE_ORACLE


def test_another_listings_page_or_an_unmeasured_availability_stamps_nothing():
    d = R.parse_detail(EY_1001)                                    # a listing page, not THIS one
    row = {"ad_number": "EYDEY-1002", "listing_url": "https://eydah.com/offers/EY-1002.html", "active": True}
    assert R.mark_crawl_read_live(row, d) is False and KEY not in row
    d = R.parse_detail(EY_1002.replace("schema.org/InStock", "schema.org/SoldOut"))
    row, _, _ = R.map_listing("/offers/EY-1002.html", d)
    assert R.mark_crawl_read_live(row, d) is False and KEY not in row
    assert R.mark_crawl_read_live({"listing_url": "x"}, {}) is False


def test_the_homepage_soft404_never_reaches_a_stamp():
    assert R.parse_detail(HOME_SOFT404) is None          # fetch_detail returns None → no row at all


def test_unknown_never_kills():
    sig = R._make_signal("https://eydah.com/offers/EY-1002.html")
    for status in (403, 429, 500, 503, None):
        assert sig(status, EY_1002, False) is None, f"HTTP {status} is UNKNOWN, never gone"


def test_main_writes_the_stamp_on_the_rows_it_upserts(monkeypatch):
    batches: list = []
    pages = {"/offers/EY-1002.html": EY_1002, "/offers/Ey-1001.html": EY_1001}
    monkeypatch.setattr(sys, "argv", ["run.py"])
    monkeypatch.setattr(R, "session", lambda: object())
    monkeypatch.setattr(R, "fetch_index", lambda s: (list(pages), 2))
    monkeypatch.setattr(R, "fetch_detail", lambda s, href: R.parse_detail(pages[href]))
    monkeypatch.setattr(R.db, "begin_run", lambda platform: 7)
    monkeypatch.setattr(R.db, "_wasalt_batch", lambda tbl, rows: batches.append((tbl, [dict(r) for r in rows])))
    monkeypatch.setattr(R.db, "retire_superseded_siblings", lambda **kw: 0)
    monkeypatch.setattr(R.db, "prune_unseen", lambda tbl, seen, source, **kw: 0)
    monkeypatch.setattr(R.db, "end_run", lambda run_id, **kw: True)
    assert R.main() == 0
    rows = [r for _, rs in batches for r in rs]
    assert sorted(r["ad_number"] for r in rows) == ["EYDEY-1001", "EYDEY-1002"]
    assert all(r[KEY] == R.CRAWL_LIVE_ORACLE for r in rows)
