"""mizlaj: the crawl's own detail-page read now stamps the row alive (2026-10-27).

33 active rows, 0 ever verified: the crawl re-reads the full catalogue nightly, so nothing reached
grace and the 404 oracle was never asked. The crawl already fetches every /guest/listings/<slug>
page and writes a row only when it states is_sold False / is_reserved False / deleted_at null.
detail_proves_live() records that read (zero extra requests) when the page's own id is THIS row's.

Measured 2026-10-27 with curl: shk-1765m2-llbyaa-altayf-lmirqyh6 → 200, props.listing id 62,
is_sold false, is_reserved false, deleted_at null (row MZ62); the removed
aakar-42659m2-llaygar-alryad-BeHUFnTO and a made-up slug → 404.
"""
from __future__ import annotations

import inspect

from scrapers.mizlaj import run as MZ

AVAILABLE = {"id": 62, "slug": "shk-1765m2-llbyaa-altayf-lmirqyh6",
             "is_sold": False, "is_reserved": False, "deleted_at": None}


def _row(ad="MZ62", active=True):
    return {"ad_number": ad, "active": active}


def test_this_listings_available_page_proves_live():
    assert MZ.detail_proves_live(_row(), AVAILABLE)


def test_sold_reserved_or_deleted_is_never_stamped():
    for k, v in (("is_sold", True), ("is_reserved", True), ("deleted_at", "2026-10-01")):
        assert not MZ.detail_proves_live(_row(), {**AVAILABLE, k: v})
    assert not MZ.detail_proves_live(_row(), {k: v for k, v in AVAILABLE.items() if k != "is_sold"})


def test_another_listings_page_or_no_page_is_not_proof():
    assert not MZ.detail_proves_live(_row("MZ21"), AVAILABLE)
    assert not MZ.detail_proves_live(_row(), None)                       # failed fetch
    assert not MZ.detail_proves_live(_row(), {**AVAILABLE, "id": None})
    assert not MZ.detail_proves_live(_row(active=False), AVAILABLE)


def test_the_gone_signal_is_unchanged_and_unknown_never_kills():
    assert MZ._signal(404, "", False) == "gone" and MZ._signal(410, "", False) == "gone"
    for status in (None, 200, 403, 429, 500):
        assert MZ._signal(status, "x", False) is None
    assert MZ._signal(404, "", True) is None, "a redirect is never a removal"


def test_main_marks_the_row_only_through_the_predicate():
    src = inspect.getsource(MZ.main)
    assert "detail_proves_live(row, listing)" in src
    assert "db.mark_direct_alive(row, oracle=DIRECT_ALIVE_ORACLE)" in src
