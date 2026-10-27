"""db.stamp_seen_alive — the SEEN rows of a full-list crawl get a direct own-page check (2026-10-27).

Owner 2026-10-26: «the amount of listings we keep should also reflect on the amount of listings we
check». 17 live sites read 0% verified because their crawl re-read the whole list every night, so no
row ever reached grace and prune_unseen's oracle was never asked. stamp_seen_alive asks the site's
own oracle about the rows the crawl DID see and records ONLY a 'live' answer.

The law pinned here: it can never hide a listing. 'gone' on a seen row, 'unknown', a raising oracle
— none of them writes anything. Only 'live' writes, and only the contract's stamp.
"""
from __future__ import annotations

import pytest

from scrapers.common import db


@pytest.fixture
def wired(monkeypatch):
    state = {"rows": [], "updates": [], "filters": []}

    class _Q:
        def __init__(self):
            self.payload = None
            self.ins = None

        def select(self, *a, **k):
            return self

        def eq(self, col, val):
            state["filters"].append((col, val))
            return self

        def update(self, payload):
            self.payload = payload
            return self

        def in_(self, col, vals):
            self.ins = list(vals)
            return self

    class _Res:
        def __init__(self, data):
            self.data = data

    def fake_execute(q, what=""):
        if q.payload is not None:
            state["updates"].append((q.payload, q.ins))
            return _Res([])
        return _Res(state["rows"])

    monkeypatch.setattr(db, "sb", lambda: type("C", (), {"table": lambda self, t: _Q()})())
    monkeypatch.setattr(db, "_execute", fake_execute)
    return state


def _rows(*ads):
    return [{"ad_number": a} for a in ads]


def test_only_live_answers_are_stamped(wired):
    wired["rows"] = _rows("A1", "A2", "A3", "A4")
    verdicts = {"A1": ("live", "200 + its own id"), "A2": "unknown", "A3": ("gone", "404"), "A4": "live"}
    out = db.stamp_seen_alive("x_residential_listings", {"A1", "A2", "A3", "A4"}, verdicts.get, pace_s=0)
    assert out == {"read": 4, "live": 2, "gone_conflict": 1, "unknown": 1}
    assert len(wired["updates"]) == 1
    payload, ads = wired["updates"][0]
    assert sorted(ads) == ["A1", "A4"]
    assert set(payload) == {"last_verified_alive_at", "last_liveness_probe_at"}


def test_unknown_never_writes_anything_and_never_kills(wired):
    wired["rows"] = _rows("A1", "A2")

    def boom(ad):
        if ad == "A1":
            raise TimeoutError("read timed out")
        return ("unknown", "HTTP 403")
    out = db.stamp_seen_alive("t", {"A1", "A2"}, boom, pace_s=0)
    assert out["live"] == 0 and out["unknown"] == 2
    assert wired["updates"] == [], "an UNKNOWN read writes nothing — no stamp, no strike, no hide"


def test_gone_on_a_seen_row_is_never_acted_on(wired):
    wired["rows"] = _rows("A1")
    out = db.stamp_seen_alive("t", {"A1"}, lambda ad: "gone", pace_s=0)
    assert out["gone_conflict"] == 1
    assert wired["updates"] == [], "removal stays prune_unseen's; this path cannot hide a listing"


def test_unseen_rows_are_not_read(wired):
    wired["rows"] = _rows("A1", "UNSEEN")
    asked: list[str] = []

    def oracle(ad):
        asked.append(ad)
        return "live"
    db.stamp_seen_alive("t", {"A1"}, oracle, pace_s=0)
    assert asked == ["A1"], "an unseen row is prune_unseen's candidate, never stamped from here"


def test_nothing_seen_or_no_oracle_reads_nothing(wired):
    wired["rows"] = _rows("A1")
    assert db.stamp_seen_alive("t", set(), lambda ad: "live")["read"] == 0
    assert db.stamp_seen_alive("t", {"A1"}, None)["read"] == 0
    assert wired["updates"] == []


def test_the_update_is_gated_on_active_and_the_function_never_writes_active():
    import inspect
    code = inspect.getsource(db.stamp_seen_alive).split('"""')[2] + inspect.getsource(db._stamp_seen_alive)
    for col in ('"active":', '"missing_count"', '"deactivated_at"'):
        assert col not in code, f"stamp_seen_alive must not write {col}"
    assert '.eq("active", True)' in code


def test_read_budget_is_respected(wired):
    wired["rows"] = _rows(*[f"A{i}" for i in range(10)])
    out = db.stamp_seen_alive("t", {f"A{i}" for i in range(10)}, lambda ad: "live", max_reads=3, pace_s=0)
    assert out["read"] == 3 and out["live"] == 3


def test_a_failure_inside_never_fails_the_crawl(monkeypatch):
    def broken():
        raise KeyError("SUPABASE_URL")
    monkeypatch.setattr(db, "sb", broken)
    out = db.stamp_seen_alive("t", {"A1"}, lambda ad: "live", pace_s=0)
    assert out == {"read": 0, "live": 0, "gone_conflict": 0, "unknown": 0}
