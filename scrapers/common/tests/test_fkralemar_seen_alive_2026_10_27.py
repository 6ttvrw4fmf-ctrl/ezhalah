"""fkralemar: the crawl's own read of each product page certifies it alive (2026-10-27).

0 of 10 active rows had ever been verified: the nightly crawl re-reads the whole catalogue, so no
row reached grace and the removal oracle was never asked. The crawl ALREADY fetches each «للبيع»
product's own page; the row built from it is stamped through db.mark_direct_alive only when its
card ribbon is the measured live word «للبيع» AND the removal oracle's live limb (200 +
product-container data-unique-id=<this id>) holds on that same page.

Measured live 2026-10-27: /offers/three-room-apartment-to-own → 200 with
product-container … data-unique-id="6a0e437bdb866"; /offers/zz-no-such-flat-9999 → HTTP 404 with
«لم يتم العثور على الصفحة». Ribbons on /offers: «للبيع» ×9, «مباع» ×1.
"""
from __future__ import annotations

import ast
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

from scrapers.common import db  # noqa: E402
from scrapers.fkralemar import run as R  # noqa: E402

UID = "6a0e437bdb866"
LIVE = f'<div class="product-container product-data-obj" data-unique-id="{UID}">x</div>'
OTHER = '<div class="product-container product-data-obj" data-unique-id="6a0e412a0c6e6">x</div>'
NOT_FOUND = f"<h1>404 - {R.NOT_FOUND_TITLE}</h1>"


def _row(uid=UID, active=True):
    return {"ad_number": f"{R.PREFIX}{uid}", "active": active}


def _card(ribbon=R.FOR_SALE, uid=UID):
    return {"uid": uid, "ribbon": ribbon, "href": "/offers/x"}


def test_for_sale_card_and_own_live_page_mark_the_row():
    row = _row()
    assert R.stamp_crawl_read(row, _card(), LIVE, {UID: R.FOR_SALE}) is True
    assert row[db._DIRECT_ALIVE_KEY] == R.DIRECT_ALIVE_ORACLE


def test_sold_or_unmeasured_ribbon_is_never_certified():
    for ribbon in (R.SOLD, "قريبا", None, ""):
        row = _row()
        assert R.stamp_crawl_read(row, _card(ribbon), LIVE, {UID: ribbon}) is False
        assert db._DIRECT_ALIVE_KEY not in row


def test_another_products_page_a_404_or_a_mismatched_row_stamps_nothing():
    for page in (OTHER, NOT_FOUND, ""):
        row = _row()
        assert R.stamp_crawl_read(row, _card(), page, {UID: R.FOR_SALE}) is False
        assert db._DIRECT_ALIVE_KEY not in row
    row = _row(uid="6a0e412a0c6e6")
    assert R.stamp_crawl_read(row, _card(), LIVE, {UID: R.FOR_SALE}) is False
    row = _row(active=False)
    assert R.stamp_crawl_read(row, _card(), LIVE, {UID: R.FOR_SALE}) is False


def test_the_removal_oracle_is_unchanged_and_unknown_never_kills(monkeypatch):
    monkeypatch.setattr("scrapers.common.http_liveness.time.sleep", lambda *_: None)
    pages = {"/live": (200, LIVE, False), "/dead": (404, NOT_FOUND, False),
             "/blocked": (403, "blocked", False), "/err": (500, "oops", False), "/timeout": (None, "", False)}
    url_by_ad = {f"{R.PREFIX}{UID}": "/live", f"{R.PREFIX}aaaaaaaa01": "/dead",
                 f"{R.PREFIX}aaaaaaaa02": "/blocked", f"{R.PREFIX}aaaaaaaa03": "/err",
                 f"{R.PREFIX}aaaaaaaa04": "/timeout"}
    monkeypatch.setattr(R.LivenessProbe, "fetch", lambda self, url: pages[url])
    vg = R._make_verify_gone(url_by_ad, {UID: R.FOR_SALE})
    assert vg(f"{R.PREFIX}{UID}")[0] == "live"
    assert vg(f"{R.PREFIX}aaaaaaaa01")[0] == "gone"
    for ad in ("aaaaaaaa02", "aaaaaaaa03", "aaaaaaaa04"):
        assert vg(f"{R.PREFIX}{ad}")[0] == "unknown", ad


def test_main_stamps_every_row_built_from_its_own_page():
    src = Path(R.__file__).read_text(encoding="utf-8")
    main = next(n for n in ast.parse(src).body if isinstance(n, ast.FunctionDef) and n.name == "main")
    calls = [n.func.id for n in ast.walk(main) if isinstance(n, ast.Call) and isinstance(n.func, ast.Name)]
    assert "stamp_crawl_read" in calls
    assert "db._wasalt_batch(RES_TABLE, res)" in src
