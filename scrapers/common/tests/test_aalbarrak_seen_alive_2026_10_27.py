"""aalbarrak: every row the crawl serves gets a direct read of its own REST record (2026-10-27).

0 of 9 active rows had ever been verified: the crawl reads only the properties LIST, and a nightly
full re-read lets no row reach grace, so the removal oracle was never asked. The run now hands the
rows it SAW to db.stamp_seen_alive with the same oracle: a 'live' answer (200, this post id,
«publish», no «تم …» status) is stamped; nothing else writes anything.

Measured live 2026-10-27: /wp-json/wp/v2/properties/20657 → 200 «publish» property_status [19];
/wp-json/wp/v2/properties/20017 (a deleted listing) → HTTP 404 {"code":"rest_post_invalid_id"}.
"""
from __future__ import annotations

import ast
import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

from scrapers.aalbarrak import run as R  # noqa: E402
from scrapers.common import db  # noqa: E402

TAX = {"property_status": {19: "للإيجار", 20: "للبيع", 75: "تم البيع", 74: "تم الايجار"}}


def _rec(pid, status="publish", ps=(19,)):
    return json.dumps({"id": pid, "status": status, "property_status": list(ps)})


SHAPES = {
    20657: (200, _rec(20657), False),
    20651: (200, _rec(20651, ps=(75,)), False),          # «تم البيع» → gone (unchanged)
    20017: (404, json.dumps({"code": "rest_post_invalid_id", "data": {"status": 404}}), False),
    1: (403, "blocked", False),
    2: (503, "busy", False),
    3: (None, "", False),
    4: (200, _rec(999), False),                           # someone else's record → no opinion
}


@pytest.fixture
def oracle(monkeypatch):
    monkeypatch.setattr("scrapers.common.http_liveness.time.sleep", lambda *_: None)
    monkeypatch.setattr(R.LivenessProbe, "fetch", lambda self, url: SHAPES[int(url.rsplit("/", 1)[-1])])
    return R._verify_gone_with(TAX)


def test_oracle_live_limb_and_gone_limbs(oracle):
    assert oracle("BRK20657")[0] == "live"
    assert oracle("BRK20651")[0] == "gone"
    assert oracle("BRK20017")[0] == "gone"
    for ad in ("BRK1", "BRK2", "BRK3", "BRK4"):
        assert oracle(ad)[0] == "unknown", ad


@pytest.fixture
def fake_db(monkeypatch):
    state = {"rows": [], "updates": []}

    class _Q:
        payload = ins = None

        def select(self, *a, **k):
            return self

        def eq(self, *a):
            return self

        def update(self, p):
            self.payload = p
            return self

        def in_(self, col, vals):
            self.ins = list(vals)
            return self

    class _Res:
        def __init__(self, d):
            self.data = d

    def ex(q, what=""):
        if q.payload is not None:
            state["updates"].append((q.payload, q.ins))
            return _Res([])
        return _Res(state["rows"])
    monkeypatch.setattr(db, "sb", lambda: type("C", (), {"table": lambda self, t: _Q()})())
    monkeypatch.setattr(db, "_execute", ex)
    return state


def test_seen_rows_only_live_is_stamped_and_unknown_never_kills(oracle, fake_db):
    ads = ["BRK20657", "BRK20651", "BRK1", "BRK2", "BRK3", "BRK4"]
    fake_db["rows"] = [{"ad_number": a} for a in ads]
    out = db.stamp_seen_alive("aalbarrak_residential_listings", set(ads), oracle, source=R.SOURCE, pace_s=0)
    assert out == {"read": 6, "live": 1, "gone_conflict": 1, "unknown": 4}
    assert len(fake_db["updates"]) == 1
    payload, stamped = fake_db["updates"][0]
    assert stamped == ["BRK20657"]
    assert "active" not in payload and "missing_count" not in payload


def test_main_hands_the_seen_rows_to_the_stamp():
    src = Path(R.__file__).read_text(encoding="utf-8")
    main = next(n for n in ast.parse(src).body if isinstance(n, ast.FunctionDef) and n.name == "main")
    attrs = [n.func.attr for n in ast.walk(main) if isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute)]
    assert "stamp_seen_alive" in attrs and "prune_unseen" in attrs
    assert "stamp_vg = _verify_gone_with(tax)" in src
