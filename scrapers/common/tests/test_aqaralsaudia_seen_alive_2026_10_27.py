"""aqaralsaudia: the rows the crawl SAW get a direct read of their own REST record every run (2026-10-27).

The crawl reads the /wp-json/wp/v2/properties LIST, re-read in full every run, so no row ever reached
grace and _verify_gone was never asked: 16 active rows, 0 ever verified. After the prune, run.main()
hands the seen rows to db.stamp_seen_alive with the SAME _verify_gone, which records only LIVE.

Measured 2026-10-27 with curl: /wp-json/wp/v2/properties/9086 → 200 {"id":9086,"status":"publish"};
/wp-json/wp/v2/properties/9999999 → 404 {"code":"rest_post_invalid_id"}.
"""
from __future__ import annotations

import ast
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

from scrapers.aqaralsaudia import run as aqs  # noqa: E402
from scrapers.common import db  # noqa: E402


class _Resp:
    def __init__(self, status, payload):
        self.status_code = status
        self._payload = payload

    def json(self):
        if isinstance(self._payload, Exception):
            raise self._payload
        return self._payload


@pytest.fixture
def source(monkeypatch):
    answers: dict = {}

    def get(url, **kw):
        a = answers[url.rsplit("/", 1)[1]]
        if isinstance(a, Exception):
            raise a
        return a
    monkeypatch.setattr(aqs.cc, "get", get)
    monkeypatch.setattr(aqs, "_throttle", lambda *a, **k: None)
    monkeypatch.setattr(aqs.time, "sleep", lambda s: None)
    return answers


def test_measured_shapes_through_the_shipping_oracle(source):
    source["9086"] = _Resp(200, {"id": 9086, "status": "publish"})
    source["9999999"] = _Resp(404, {"code": "rest_post_invalid_id", "data": {"status": 404}})
    assert aqs._verify_gone("AQS9086")[0] == "live"
    assert aqs._verify_gone("AQS9999999")[0] == "gone"


def test_unknown_reads_are_never_a_verdict(source):
    source["1"] = _Resp(403, None)
    source["2"] = _Resp(500, {"code": "x"})
    source["3"] = TimeoutError("read timed out")
    source["4"] = _Resp(200, ValueError("not json"))
    source["5"] = _Resp(200, {"id": 6, "status": "publish"})      # another post
    for pid in "12345":
        assert aqs._verify_gone(f"AQS{pid}")[0] == "unknown"


def test_main_hands_the_seen_rows_to_stamp_seen_alive_with_the_same_oracle():
    tree = ast.parse(Path(aqs.__file__).read_text(encoding="utf-8"))
    main = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == "main")
    calls = [n for n in ast.walk(main) if isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute)]
    stamp = [c for c in calls if c.func.attr == "stamp_seen_alive"]
    prune = [c for c in calls if c.func.attr == "prune_unseen"]
    assert stamp and prune and stamp[0].lineno > prune[0].lineno
    assert isinstance(stamp[0].args[2], ast.Name) and stamp[0].args[2].id == "_verify_gone"


def test_stamp_records_live_only_and_unknown_never_kills(monkeypatch, source):
    source["9086"] = _Resp(200, {"id": 9086, "status": "publish"})
    source["9044"] = _Resp(429, None)
    updates: list = []

    class _Q:
        payload = None

        def __getattr__(self, name):
            def f(*a, **k):
                if name == "update":
                    self.payload = a[0]
                if name == "in_":
                    self.ins = list(a[1])
                return self
            return f

    class _Res:
        def __init__(self, data):
            self.data = data

    def ex(q, what=""):
        if q.payload is not None:
            updates.append((q.payload, q.ins))
            return _Res([])
        return _Res([{"ad_number": "AQS9086"}, {"ad_number": "AQS9044"}])
    monkeypatch.setattr(db, "sb", lambda: type("C", (), {"table": lambda self, t: _Q()})())
    monkeypatch.setattr(db, "_execute", ex)
    out = db.stamp_seen_alive("aqaralsaudia_residential_listings", {"AQS9086", "AQS9044"},
                              aqs._verify_gone, source="AqarAlSaudia", pace_s=0)
    assert out["live"] == 1 and out["unknown"] == 1
    assert len(updates) == 1 and updates[0][1] == ["AQS9086"]
    assert "active" not in updates[0][0] and "missing_count" not in updates[0][0]
