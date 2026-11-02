"""alsidra: every row the crawl serves gets a direct read of its own REST record (2026-10-27).

0 of 29 active rows had ever been verified: the crawl reads only the posts LIST, and a nightly full
re-read lets no row reach grace, so the removal oracle was never asked. After the prune the run now
hands the rows it SAW to db.stamp_seen_alive with the same oracle: a 'live' answer (200, this post
id, «publish», not an auction, not closed) is stamped; nothing else writes anything.

Measured live 2026-10-27: ?rest_route=/wp/v2/عقارات/21286 → 200 {"id":21286,"status":"publish"};
…/999999 → HTTP 404 {"code":"rest_post_invalid_id"}.
"""
from __future__ import annotations

import ast
import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

from scrapers.alsidra import run as R  # noqa: E402
from scrapers.common import db  # noqa: E402

TERMS = {"property_status": {117: "للبيع", 118: R.AUCTION_STATUS}}


def _rec(pid, status="publish", ps=(117,), title="أرض للبيع"):
    return json.dumps({"id": pid, "status": status, "property_status": list(ps),
                       "title": {"rendered": title}, "content": {"rendered": "وصف"}})


SHAPES = {
    21286: (200, _rec(21286), False),
    21287: (200, _rec(21287, ps=(118,)), False),          # auction → gone (unchanged)
    999999: (404, json.dumps({"code": "rest_post_invalid_id", "data": {"status": 404}}), False),
    1: (403, "blocked", False),
    2: (500, "oops", False),
    3: (None, "", False),
    4: (401, json.dumps({"code": "rest_forbidden"}), False),  # trashed/draft → no opinion
}


@pytest.fixture
def oracle(monkeypatch):
    monkeypatch.setattr("scrapers.common.http_liveness.time.sleep", lambda *_: None)
    monkeypatch.setattr(R.LivenessProbe, "fetch", lambda self, url: SHAPES[int(url.rsplit("/", 1)[-1])])
    return R._make_verify_gone(TERMS)


def test_oracle_live_limb_and_gone_limbs(oracle):
    assert oracle("SDR21286")[0] == "live"
    assert oracle("SDR21287")[0] == "gone"
    assert oracle("SDR999999")[0] == "gone"
    for ad in ("SDR1", "SDR2", "SDR3", "SDR4"):
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
    ads = ["SDR21286", "SDR21287", "SDR1", "SDR2", "SDR3", "SDR4"]
    fake_db["rows"] = [{"ad_number": a} for a in ads]
    out = db.stamp_seen_alive(R.RES_TABLE, set(ads), oracle, source=R.SOURCE, pace_s=0)
    assert out == {"read": 6, "live": 1, "gone_conflict": 1, "unknown": 4}
    assert len(fake_db["updates"]) == 1
    payload, stamped = fake_db["updates"][0]
    assert stamped == ["SDR21286"]
    assert "active" not in payload and "missing_count" not in payload


def test_main_hands_the_seen_rows_to_the_stamp_with_the_prune_oracle():
    src = Path(R.__file__).read_text(encoding="utf-8")
    main = next(n for n in ast.parse(src).body if isinstance(n, ast.FunctionDef) and n.name == "main")
    attrs = [n.func.attr for n in ast.walk(main) if isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute)]
    assert "stamp_seen_alive" in attrs and "prune_unseen" in attrs
    assert "stamp_seen_alive(tbl, {r[\"ad_number\"] for r in rows}, verify_gone, source=SOURCE)" in src
