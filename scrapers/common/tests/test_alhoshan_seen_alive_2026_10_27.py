"""Al Hoshan: each listed ad is re-read at its OWN API record; only a live record is stamped (2026-10-27).

34 active ads read 0% verified: the crawl reads only the search list, which is no ad's own record, and
its prune had no oracle. MEASURED 2026-10-27: GET /api/alhoshan/properties/<GUID> answers 200 with
data.publicId / isPublished=true / moderationStatus=approved / listingExpiresAt=null for a live ad,
and HTTP 404 with the JSON body {} for a GUID the API does not hold. Pinned: live needs THIS publicId
and every measured flag; isPublished=false (the record's own retirement) and the API's JSON 404 are
gone, the latter only with a live control; an HTML 404, a 400/403/5xx or a timeout is UNKNOWN; and
UNKNOWN never deactivates.
"""
from __future__ import annotations

import ast
import json
import pathlib

import pytest

from scrapers.alhoshan import run as R
from scrapers.common import db, http_liveness

RUN = pathlib.Path(R.__file__)
CTRL, GONE, LIVE = "11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222", \
    "33333333-3333-4333-8333-333333333333"


def _rec(pub: int, **over) -> str:
    d = {"id": "x", "publicId": pub, "isPublished": True, "moderationStatus": "approved",
         "listingExpiresAt": None, "title": "تاون هاوس للبيع"}
    d.update(over)
    return json.dumps({"success": True, "message": "", "data": d, "errors": None, "meta": {}})


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


def _u(guid):
    return R.RECORD.format(guid=guid)


def _vg(pages, control="AH1001"):
    s = _S({_u(CTRL): _Resp(200, _rec(1001)), **{_u(g): v for g, v in pages.items()}})
    return R._make_verify_gone(s, control, {"AH1001": CTRL, "AH1030": GONE, "AH1041": LIVE})


def test_signal_shapes():
    sig = R._make_signal("AH1041")
    assert sig(200, _rec(1041), False) == "live"
    assert sig(200, _rec(1042), False) is None, "another record certifies nothing"
    assert sig(200, _rec(1041, isPublished=False), False) == "gone"
    assert sig(200, _rec(1041, moderationStatus="pending"), False) is None, "unmeasured → no opinion"
    assert sig(200, _rec(1041, listingExpiresAt="2026-11-01T00:00:00Z"), False) is None
    assert sig(404, "{}", False) == "gone"
    assert sig(404, "<html>Not Found</html>", False) is None, "an HTML 404 is not the API's answer"
    assert sig(400, '{"success":false,"errors":{"id":["not valid"]}}', False) is None


def test_json_404_is_gone_with_a_live_control():
    assert _vg({GONE: _Resp(404, "{}")})("AH1030")[0] == "gone"


def test_live_record_is_live():
    assert _vg({LIVE: _Resp(200, _rec(1041))})("AH1041")[0] == "live"


@pytest.mark.parametrize("resp", [_Resp(403, "<html>blocked</html>"), _Resp(500, "{}"), _Resp(502, "x"),
                                  TimeoutError("read timed out"), _Resp(404, "<html>cf</html>")])
def test_blocks_outages_and_timeouts_are_unknown(resp):
    assert _vg({GONE: resp})("AH1030")[0] == "unknown"


def test_a_gone_without_a_live_control_is_unknown():
    assert _vg({GONE: _Resp(404, "{}"), CTRL: _Resp(503, "{}")})("AH1030")[0] == "unknown"


def test_no_guid_is_unknown(monkeypatch):
    monkeypatch.setattr(R, "_stored_guid", lambda ad: None)
    assert _vg({})("AH9999")[0] == "unknown"


def test_unknown_never_deactivates(monkeypatch):
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
        return _Res([{"ad_number": "AH1030", "missing_count": 2}, {"ad_number": "AH1001", "missing_count": 0}])

    monkeypatch.setattr(db, "sb", lambda: type("C", (), {"table": lambda self, t: _Q()})())
    monkeypatch.setattr(db, "_execute", fake_execute)
    killed = db.prune_unseen("alhoshan_residential_listings", {"AH1001"}, source="Alhoshan",
                             verify_gone=_vg({GONE: _Resp(403, "<html>blocked</html>")}), min_active_guard=99)
    assert killed == 0
    assert not any(u.get("active") is False for u in updates), "an UNKNOWN read must never hide a listing"


def test_run_wires_the_oracle_and_the_seen_stamp():
    tree = ast.parse(RUN.read_text(encoding="utf-8"))
    calls = [n for n in ast.walk(tree) if isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute)
             and n.func.attr == "prune_unseen"]
    assert calls and all("verify_gone" in {k.arg for k in c.keywords} for c in calls)
    assert any(isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute)
               and n.func.attr == "stamp_seen_alive" for n in ast.walk(tree))
