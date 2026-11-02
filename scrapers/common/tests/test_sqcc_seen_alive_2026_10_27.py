"""SQCC: every post page the crawl reads is its direct check; removals read the same page (2026-10-27).

31 active ads read 0% verified: the crawl opens every post's own page every night but recorded only
last_seen_at, and its prune had no oracle. MEASURED 2026-10-27: a live post answers 200 carrying its
own <link rel='shortlink' href='…?p=52'>; an unserved slug answers 404 («الصفحة غير موجودة»).
Pinned: live needs THIS post's id; the post's own «تم البيع/مباع/محجوز/مزاد» retires it (the words
map_listing already refuses); «مؤجر» is deal-dependent → no opinion; a block, an outage or a timeout
is UNKNOWN, and UNKNOWN never deactivates.
"""
from __future__ import annotations

import ast
import pathlib

import pytest

from scrapers.common import db, http_liveness
from scrapers.sqcc import run as Q

RUN = pathlib.Path(Q.__file__)


def _page(pid: int, title: str = "دوبلكس متصل للبيع", price: str = "950,000 ريال") -> str:
    return (f"<link rel='shortlink' href='https://sqcc.sa/?p={pid}' />"
            f'<div class="precemp"> <h2>{title}</h2></div><div id="postin" style="">'
            f'<div class="news_shape_txt_all"> <p>{price}</p> <div class="serv_info">'
            '<span class="icons139">4</span></div></div><div class="postin_txt"></div>'
            '<div id="data"></div>' + "x" * 300)


NOT_FOUND = "<html><title>مجموعة صالح القرشي العقارية » الصفحة غير موجودة.</title>" + "x" * 300


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


def _vg(pages, control="SQC52"):
    urls = {ad: f"{Q.BASE}/realestate/{ad.lower()}/" for ad in ["SQC52", *pages]}
    s = _S({urls["SQC52"]: _Resp(200, _page(52)), **{urls[a]: v for a, v in pages.items()}})
    return Q._make_verify_gone(s, control, urls)


def test_signal_shapes():
    sig = Q._make_signal("SQC91")
    assert sig(200, _page(91), False) == "live"
    assert sig(200, _page(91), True) == "live", "the page's own shortlink proves it, whatever the path"
    assert sig(200, _page(92), False) is None, "another post's page certifies nothing"
    assert sig(404, NOT_FOUND, False) == "gone"
    assert sig(404, NOT_FOUND, True) is None
    assert sig(200, _page(91, title="فلة للبيع - تم البيع"), False) == "gone"
    assert sig(200, _page(91, title="ارض للبيع في المزاد"), False) == "gone"
    assert sig(200, _page(91, title="عمارة للبيع مؤجرة بالكامل"), False) is None, \
        "a tenanted SALE is still for sale — «مؤجر» is no opinion here"
    assert sig(200, NOT_FOUND, False) is None


def test_404_is_gone_with_a_live_control():
    assert _vg({"SQC9": _Resp(404, NOT_FOUND)})("SQC9")[0] == "gone"


def test_live_page_is_live():
    assert _vg({"SQC9": _Resp(200, _page(9))})("SQC9")[0] == "live"


@pytest.mark.parametrize("resp", [_Resp(403, "blocked"), _Resp(500, "oops"), _Resp(502, "x"),
                                  TimeoutError("read timed out"), _Resp(200, "<html>shell</html>")])
def test_blocks_outages_and_timeouts_are_unknown(resp):
    assert _vg({"SQC9": resp})("SQC9")[0] == "unknown"


def test_a_404_without_a_live_control_is_unknown():
    assert _vg({"SQC9": _Resp(404, NOT_FOUND), "SQC52": _Resp(503, "down")})("SQC9")[0] == "unknown"
    assert Q._make_verify_gone(_S({}), None, {"SQC9": "u"})("SQC9")[0] == "unknown"


def test_unknown_never_deactivates(monkeypatch):
    updates: list[dict] = []

    class _Qr:
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
        return _Res([{"ad_number": "SQC9", "missing_count": 2}, {"ad_number": "SQC52", "missing_count": 0}])

    monkeypatch.setattr(db, "sb", lambda: type("C", (), {"table": lambda self, t: _Qr()})())
    monkeypatch.setattr(db, "_execute", fake_execute)
    killed = db.prune_unseen("sqcc_residential_listings", {"SQC52"}, source=Q.SOURCE,
                             verify_gone=_vg({"SQC9": _Resp(403, "blocked")}), min_active_guard=99)
    assert killed == 0
    assert not any(u.get("active") is False for u in updates), "an UNKNOWN read must never hide a listing"


def test_run_wires_the_oracle_and_the_direct_stamp():
    tree = ast.parse(RUN.read_text(encoding="utf-8"))
    calls = [n for n in ast.walk(tree) if isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute)
             and n.func.attr == "prune_unseen"]
    assert calls and all("verify_gone" in {k.arg for k in c.keywords} for c in calls)
    assert any(isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute)
               and n.func.attr == "mark_direct_alive" for n in ast.walk(tree))
