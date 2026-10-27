"""THE RC: every ad's own page, read by the crawl, is its direct check; removals read the same page (2026-10-27).

457 active ads read 0% verified: the crawl opens every ad's own page every night but recorded only
last_seen_at, and its prune had no oracle. MEASURED 2026-10-27: a live ad answers 200 printing its own
«رقم المرجع: AQ410257» with offers.availability InStock; an unserved slug answers 404
(<title>404 - الصفحة غير موجودة). Pinned: live needs THIS ad's ref; 404 is gone only with a live
control; a block, an outage or a timeout is UNKNOWN; and UNKNOWN never deactivates.
"""
from __future__ import annotations

import ast
import json
import pathlib

import pytest

from scrapers.common import db, http_liveness
from scrapers.therc import run as R

RUN = pathlib.Path(R.__file__)


def _page(ref: str, availability: str = "https://schema.org/InStock", similar_ref: str = "") -> str:
    ld = {"@type": "RealEstateListing", "name": "شقة للإيجار في حي طويق",
          "offers": {"@type": "Offer", "price": "50000", "priceCurrency": "SAR",
                     "availability": availability}}
    tail = f"<h2>عقارات مشابهة</h2><span>رقم المرجع: {similar_ref}</span>" if similar_ref else ""
    return (f'<script type="application/ld+json">{json.dumps(ld, ensure_ascii=False)}</script>'
            f'<span class="bg-gray-100">رقم المرجع: {ref}</span>' + "x" * 500 + tail)


NOT_FOUND = "<html><head><title>404 - الصفحة غير موجودة</title></head><body>" + "x" * 300 + "</body></html>"


class _Resp:
    def __init__(self, status, text=""):
        self.status_code, self.text = status, text


class _S:
    def __init__(self, pages):
        self.pages = pages

    def get(self, url, timeout=None, **kw):
        v = self.pages.get(url)
        if v is None or isinstance(v, Exception):
            raise v or ConnectionError(url)
        return v


@pytest.fixture(autouse=True)
def _no_sleep(monkeypatch):
    monkeypatch.setattr(http_liveness.time, "sleep", lambda *_: None)


def _vg(monkeypatch, pages, control="AQ1"):
    urls = {ad: f"{R.BASE}/properties/{ad.lower()}" for ad in ["AQ1", *pages]}
    sess = _S({urls["AQ1"]: _Resp(200, _page("AQ1")), **{urls[a]: v for a, v in pages.items()}})
    monkeypatch.setattr(R, "_session", lambda: sess)
    return R._make_verify_gone(control, urls)


# ── the page itself ─────────────────────────────────────────────────────────────────────────────
def test_live_needs_this_ads_own_reference():
    assert R.page_reads_live(_page("AQ7"), "AQ7")
    assert not R.page_reads_live(_page("AQ8"), "AQ7"), "another listing's page certifies nothing"
    assert not R.page_reads_live(_page("", similar_ref="AQ7"), "AQ7"), \
        "a ref inside «عقارات مشابهة» belongs to another listing"
    assert not R.page_reads_live(_page("AQ7", "https://schema.org/SoldOut"), "AQ7"), \
        "an availability nobody measured is no opinion, never live"
    assert not R.page_reads_live("", "AQ7")


def test_signal_shapes():
    sig = R._make_signal("AQ7")
    assert sig(200, _page("AQ7"), False) == "live"
    assert sig(404, NOT_FOUND, False) == "gone"
    assert sig(410, NOT_FOUND, False) == "gone"
    assert sig(404, NOT_FOUND, True) is None, "a redirect onto a 404 is not this listing's answer"
    assert sig(200, NOT_FOUND, False) is None
    assert sig(200, _page("AQ8"), False) is None


# ── the oracle prune_unseen is handed ───────────────────────────────────────────────────────────
def test_404_is_gone_with_a_live_control(monkeypatch):
    assert _vg(monkeypatch, {"AQ9": _Resp(404, NOT_FOUND)})("AQ9")[0] == "gone"


def test_live_page_is_live(monkeypatch):
    assert _vg(monkeypatch, {"AQ9": _Resp(200, _page("AQ9"))})("AQ9")[0] == "live"


@pytest.mark.parametrize("resp", [_Resp(403, "blocked"), _Resp(500, "oops"), _Resp(503, "x"),
                                  TimeoutError("read timed out"), _Resp(200, "<html>shell</html>")])
def test_blocks_outages_and_timeouts_are_unknown(monkeypatch, resp):
    assert _vg(monkeypatch, {"AQ9": resp})("AQ9")[0] == "unknown"


def test_a_404_without_a_live_control_is_unknown(monkeypatch):
    vg = _vg(monkeypatch, {"AQ9": _Resp(404, NOT_FOUND), "AQ1": _Resp(403, "blocked")})
    assert vg("AQ9")[0] == "unknown", "a source not serving us its live ads cannot testify to a death"
    assert R._make_verify_gone(None, {"AQ9": "u"})("AQ9")[0] == "unknown"


def test_unknown_never_deactivates(monkeypatch):
    """prune_unseen with an at-grace unseen row and the real oracle answering 403: no hide."""
    updates: list[dict] = []

    class _Q:
        def __init__(self):
            self.payload = None

        def __getattr__(self, name):
            def f(*a, **k):
                if name == "update":
                    self.payload = a[0]
                return self
            return f

    class _Res:
        def __init__(self, data):
            self.data = data

    def fake_execute(q, what="", **kw):
        if q.payload is not None:
            updates.append(q.payload)
            return _Res([])
        return _Res([{"ad_number": "AQ9", "missing_count": 2}, {"ad_number": "AQ1", "missing_count": 0}])

    monkeypatch.setattr(db, "sb", lambda: type("C", (), {"table": lambda self, t: _Q()})())
    monkeypatch.setattr(db, "_execute", fake_execute)
    vg = _vg(monkeypatch, {"AQ9": _Resp(403, "blocked")})
    killed = db.prune_unseen("therc_residential_listings", {"AQ1"}, source=R.SOURCE, verify_gone=vg,
                             min_active_guard=99)
    assert killed == 0
    assert not any(u.get("active") is False for u in updates), "an UNKNOWN read must never hide a listing"


# ── the crawl stamps what it read, and the prune is wired ──────────────────────────────────────
def test_crawl_marks_rows_read_live_on_their_own_page(monkeypatch):
    page = _page("AQ7")
    monkeypatch.setattr(R, "_session", lambda: None)
    monkeypatch.setattr(R, "sitemap_urls", lambda s: [(f"{R.BASE}/properties/x", None)])
    monkeypatch.setattr(R, "_get", lambda s, url: page)
    row = {"ad_number": "AQ7", "listing_url": f"{R.BASE}/properties/x", "active": True}
    monkeypatch.setattr(R, "map_listing", lambda url, pg, lm: (dict(row), "residential"))
    res, com, seen = R.crawl()
    assert res[0].get(db._DIRECT_ALIVE_KEY) == "therc.detail_fetch.reference_code"

    monkeypatch.setattr(R, "_get", lambda s, url: _page("AQ8"))   # page does not print THIS ref
    res, _, _ = R.crawl()
    assert db._DIRECT_ALIVE_KEY not in res[0]


def test_run_wires_the_oracle_into_every_prune():
    tree = ast.parse(RUN.read_text(encoding="utf-8"))
    calls = [n for n in ast.walk(tree) if isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute)
             and n.func.attr == "prune_unseen"]
    assert calls and all("verify_gone" in {k.arg for k in c.keywords} for c in calls)
    assert any(isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute)
               and n.func.attr == "mark_direct_alive" for n in ast.walk(tree))
