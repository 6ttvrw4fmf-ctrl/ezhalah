"""alrifai: the crawl's own detail read stamps a row alive by verify_gone's own LIVE rule (2026-10-27).

alrifai re-reads its whole 21-id catalogue every night, so no row ever reached grace and verify_gone
was never asked: 17 active rows, 0 ever verified (ops_platform_liveness_coverage 2026-10-27).
verify_gone's LIVE is «the id's own page renders a title AND the complete catalogue lists it» — the
crawl establishes exactly that for every row it writes, so the row carries db.mark_direct_alive.

Measured 2026-10-27 with curl: id 110 (in the catalogue) → 200 with «<h2>شقة 3 غرف حي البوادي</h2>»;
id 999999 → 200 with the empty shell «<h2></h2>». Fixtures are the verbatim 2026-09-24 captures.
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

from scrapers.alrifai import run as R  # noqa: E402
from scrapers.common import db  # noqa: E402
from scrapers.common.tests.test_alrifai_deal_stated_and_catalogue_oracle import (  # noqa: E402,F401
    BOX_999, CATALOGUE_SNIPPET, PAGE_104, PAGE_110, _no_catalog_network, _route)

KEY = db._DIRECT_ALIVE_KEY


def _row():
    return {"ad_number": "RFI104", "active": True}


def test_a_rendered_page_listed_in_this_runs_catalogue_is_stamped():
    row = _row()
    assert R.mark_crawl_read_live(row, "104", {"104", "110"}, 200, PAGE_104) is True
    assert row[KEY] == R.CRAWL_LIVE_ORACLE


def test_anything_short_of_live_stamps_nothing():
    for status, page, cat in ((200, BOX_999, {"104"}),      # the empty shell: gone, never live
                              (403, PAGE_104, {"104"}),     # blocked: UNKNOWN
                              (500, PAGE_104, {"104"}),     # source error: UNKNOWN
                              (None, "", {"104"}),          # timeout / no answer: UNKNOWN
                              (200, "", {"104"}),           # empty body: UNKNOWN
                              (200, PAGE_104, {"110"})):    # not in this run's catalogue
        row = _row()
        assert R.mark_crawl_read_live(row, "104", cat, status, page) is False
        assert KEY not in row


def test_a_stamped_row_that_ends_inactive_is_never_certified():
    row = _row()
    R.mark_crawl_read_live(row, "104", {"104"}, 200, PAGE_104)
    row["active"] = False
    patch, reason = db.decide_direct_alive(row, "2026-10-27T00:00:00+00:00")
    assert patch == {} and reason == "dropped-inactive"


def test_main_writes_the_stamp_on_the_rows_it_upserts(monkeypatch):
    batches: list = []
    monkeypatch.setattr(sys, "argv", ["run.py"])
    monkeypatch.setattr(R, "session", lambda: object())
    monkeypatch.setattr(R.time, "sleep", lambda s: None)
    monkeypatch.setattr(R, "fetch", _route({"104": PAGE_104, "110": PAGE_110}, CATALOGUE_SNIPPET))
    monkeypatch.setattr(R.db, "begin_run", lambda platform: 7)
    monkeypatch.setattr(R.db, "_wasalt_batch", lambda tbl, rows: batches.append((tbl, [dict(r) for r in rows])))
    monkeypatch.setattr(R.db, "retire_superseded_siblings", lambda **kw: 0)
    monkeypatch.setattr(R.db, "prune_unseen", lambda tbl, seen, source, **kw: 0)
    monkeypatch.setattr(R.db, "end_run", lambda run_id, **kw: True)
    assert R.main() == 0
    res = dict(batches)["alrifai_residential_listings"]
    assert [r["ad_number"] for r in res] == ["RFI104"]
    assert res[0][KEY] == R.CRAWL_LIVE_ORACLE


def test_unknown_never_kills_through_verify_gone(monkeypatch):
    monkeypatch.setattr(R, "session", lambda: object())
    R._SEEN_THIS_RUN.clear(); R._SEEN_THIS_RUN.update({"104"})
    R._CATALOGUE_CACHE.clear()
    monkeypatch.setattr(R, "fetch", _route({"104": PAGE_104}, CATALOGUE_SNIPPET, status=503))
    assert R.verify_gone("RFI104")[0] == "unknown"
    monkeypatch.setattr(R, "fetch", lambda s, url: (None, ""))
    assert R.verify_gone("RFI104")[0] == "unknown"
