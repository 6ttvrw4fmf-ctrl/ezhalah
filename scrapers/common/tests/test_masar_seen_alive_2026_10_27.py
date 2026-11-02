"""masar: the rows the crawl SAW get a direct read of their own REST record every run (2026-10-27).

masar's crawl reads the /wp-json/wp/v2/aqar LIST (plus each post's HTML overview, which does not name
the post id), re-read in full every night — so no row ever reached grace, _verify_gone was never
asked, and its one active row (MSR2693) had never been verified. After the prune, run.main() now hands
the seen rows to db.stamp_seen_alive with the SAME _verify_gone, which records only a LIVE answer.

Measured 2026-10-27 with curl: /wp-json/wp/v2/aqar/2921 → 200 {"id":2921,"status":"publish"};
/wp-json/wp/v2/aqar/99999999 → 404 {"code":"rest_post_invalid_id"}.
"""
from __future__ import annotations

import ast
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

from scrapers.common import db  # noqa: E402
from scrapers.masar import run as R  # noqa: E402

LIVE_2921 = json.dumps({"id": 2921, "status": "publish", "title": {"rendered": "شقة للإيجار"},
                        "content": {"rendered": "<p>شقة للإيجار</p>"}})
INVALID = json.dumps({"code": "rest_post_invalid_id", "message": "رقم المقالة خاطئ.", "data": {"status": 404}})


def test_measured_shapes_through_the_shipping_signal():
    sig = R._signal_for(2921)
    assert sig(200, LIVE_2921, False) == "live"
    assert sig(404, INVALID, False) == "gone"
    for status, body in ((403, ""), (429, ""), (500, "oops"), (503, LIVE_2921), (None, ""),
                         (200, "<title>Checking your browser before accessing</title>")):
        assert sig(status, body, False) is None, f"{status} is UNKNOWN, never a verdict"


def test_main_hands_the_seen_rows_to_stamp_seen_alive_with_the_same_oracle():
    tree = ast.parse(Path(R.__file__).read_text(encoding="utf-8"))
    main = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == "main")
    calls = [n for n in ast.walk(main) if isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute)]
    stamp = [c for c in calls if c.func.attr == "stamp_seen_alive"]
    prune = [c for c in calls if c.func.attr == "prune_unseen"]
    assert stamp and prune, "run.main() must call db.stamp_seen_alive after its prune"
    assert stamp[0].lineno > prune[0].lineno
    assert isinstance(stamp[0].args[2], ast.Name) and stamp[0].args[2].id == "_verify_gone"


def _fake_db(monkeypatch, rows):
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
        return _Res(rows)
    monkeypatch.setattr(db, "sb", lambda: type("C", (), {"table": lambda self, t: _Q()})())
    monkeypatch.setattr(db, "_execute", ex)
    return updates


def test_live_record_is_stamped_and_unknown_never_kills(monkeypatch):
    updates = _fake_db(monkeypatch, [{"ad_number": "MSR2921"}, {"ad_number": "MSR2693"}])
    answers = {"MSR2921": (200, LIVE_2921), "MSR2693": (503, "")}

    def oracle(ad):
        status, body = answers[ad]
        v = R._signal_for(int(ad[3:]))(status, body, False)
        return (v or "unknown"), f"HTTP {status}"
    out = db.stamp_seen_alive("masar_residential_listings", {"MSR2921", "MSR2693"}, oracle,
                              source=R.SOURCE, pace_s=0)
    assert out["live"] == 1 and out["unknown"] == 1
    assert len(updates) == 1 and updates[0][1] == ["MSR2921"]
    assert set(updates[0][0]) == {"last_verified_alive_at", "last_liveness_probe_at"}


def test_non_numeric_ad_number_is_unknown():
    assert R._verify_gone("MSRabc")[0] == "unknown"
