"""alqasem: the crawl's own read of each property page certifies it alive (2026-10-27).

0 of 23 active rows had ever been verified: the nightly crawl re-reads all 29 pages, so no row ever
reached grace and the removal oracle was never asked. The crawl ALREADY fetches each listing's own
page, so the row built from it is stamped through db.mark_direct_alive — but only when the removal
oracle's own live limb (200 + body class «single-property postid-<this id>») holds on that page.

Measured live 2026-10-27: /?p=2700 → 200 «single-property postid-2700»; /?p=999999 → HTTP 404,
title «الصفحة غير موجودة - شركة القاسم العقارية».
"""
from __future__ import annotations

import ast
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

from scrapers.alqasem import run as R  # noqa: E402
from scrapers.common import db  # noqa: E402

LIVE = '<body class="property-template-default single single-property postid-2700 elementor">x</body>'
OTHER = '<body class="single single-property postid-2176">x</body>'
NOT_FOUND = f"<title>{R.NOT_FOUND_TITLE} - شركة القاسم العقارية</title>"


def _row(ad="QSM2700", active=True):
    return {"ad_number": ad, "active": active}


def test_own_live_page_marks_the_row_direct_alive():
    row = _row()
    assert R.stamp_crawl_read(row, LIVE) is True
    assert row[db._DIRECT_ALIVE_KEY] == R.DIRECT_ALIVE_ORACLE
    patch, why = db.decide_direct_alive(row, "2026-10-27T05:00:00+00:00")
    assert why == "stamped" and patch == {"last_verified_alive_at": "2026-10-27T05:00:00+00:00"}


def test_another_listings_page_or_a_404_body_stamps_nothing():
    for page in (OTHER, NOT_FOUND, ""):
        row = _row()
        assert R.stamp_crawl_read(row, page) is False
        assert db._DIRECT_ALIVE_KEY not in row


def test_an_inactive_or_malformed_row_is_never_certified():
    for row in (_row(active=False), _row(ad="QSMabc"), _row(ad=None)):
        assert R.stamp_crawl_read(row, LIVE) is False
        assert db._DIRECT_ALIVE_KEY not in row


def test_the_removal_oracle_is_unchanged_and_unknown_never_kills(monkeypatch):
    monkeypatch.setattr("scrapers.common.http_liveness.time.sleep", lambda *_: None)
    shapes = {
        "QSM2700": (200, LIVE, False),
        "QSM999999": (404, NOT_FOUND, False),
        "QSM1": (403, "blocked", False),
        "QSM2": (500, "oops", False),
        "QSM3": (None, "", False),      # timeout / transport failure
    }
    url_by_ad = {}
    vg = R._make_verify_gone(url_by_ad)

    def fake_fetch(self, url):
        pid = url.rsplit("=", 1)[-1]
        return shapes[f"{R.PREFIX}{pid}"]
    monkeypatch.setattr(R.LivenessProbe, "fetch", fake_fetch)
    assert vg("QSM2700")[0] == "live"
    assert vg("QSM999999")[0] == "gone"
    for ad in ("QSM1", "QSM2", "QSM3"):
        assert vg(ad)[0] == "unknown", ad


def test_main_stamps_every_row_built_from_its_own_page():
    src = Path(R.__file__).read_text(encoding="utf-8")
    tree = ast.parse(src)
    main = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == "main")
    calls = [n.func.id for n in ast.walk(main) if isinstance(n, ast.Call) and isinstance(n.func, ast.Name)]
    assert "stamp_crawl_read" in calls
    assert "db._wasalt_batch(RES_TABLE, res)" in src, "the marker is consumed only by _wasalt_batch"
