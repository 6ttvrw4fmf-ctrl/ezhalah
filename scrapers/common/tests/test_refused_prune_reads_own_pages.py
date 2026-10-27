"""A refused absence prune still reads the unseen ads' own pages (2026-10-23).

tawia: 10 active, its walk re-saw 4, so the collapse guard refused every prune and 3 ads whose own
page was gone stayed on screen with missing_count 0 (dead-visible 10-23, 3 of 5 sampled). 125
crawlers stopped at «prune guard tripped»; prune_unseen now hands such a refusal to strike_read_gone
for every caller that brought no oracle of its own.
"""
from __future__ import annotations

import pytest

from scrapers.common import db


@pytest.fixture
def wired(monkeypatch):
    calls: list[dict] = []
    state = {"rows": []}

    class _Q:
        def __getattr__(self, _):
            return lambda *a, **k: self

    class _Res:
        @property
        def data(self):
            return state["rows"]

    monkeypatch.setattr(db, "sb", lambda: type("C", (), {"table": lambda self, t: _Q()})())
    monkeypatch.setattr(db, "_execute", lambda q, what="": _Res())
    monkeypatch.setattr(db, "_READ_GONE_DONE", set())

    def fake_strike(table, seen, source, verify_gone=None, **kw):
        calls.append({"table": table, "seen": set(seen), "source": source, "vg": verify_gone, **kw})
        return 0
    monkeypatch.setattr(db, "strike_read_gone", fake_strike)
    return calls, state


def _rows(n):
    return [{"ad_number": f"TWA{i}", "missing_count": 0} for i in range(n)]


def test_collapse_on_an_oracle_less_caller_reads_the_unseen_pages(wired):
    calls, state = wired
    state["rows"] = _rows(10)
    assert db.prune_unseen("tawia_residential_listings", {"TWA0", "TWA1", "TWA2", "TWA3"}, source="s") == -1
    assert len(calls) == 1, "the refused prune must hand its unseen ads to the own-page reader"
    c = calls[0]
    assert c["vg"] is None, "the default own_page_status_oracle (404/410 + a live control)"
    assert c["seen"] == {"TWA0", "TWA1", "TWA2", "TWA3"} and c["source"] == "s"
    assert c["max_prune_frac"] == 0.30 and c["grace"] == 3, "the cap and the 3 strikes never move"


def test_coverage_trip_reads_too(wired):
    calls, state = wired
    state["rows"] = _rows(10)
    seen = {f"TWA{i}" for i in range(8)}
    assert db.prune_unseen("t", seen, min_coverage=0.9) == -1
    assert len(calls) == 1


def test_a_caller_with_its_own_oracle_keeps_its_own_handling(wired):
    calls, state = wired
    state["rows"] = _rows(10)
    assert db.prune_unseen("t", {"TWA0"}, verify_gone=lambda ad: "gone") == -1
    assert calls == []


def test_sharded_or_big_or_empty_is_left_alone(wired):
    calls, state = wired
    state["rows"] = _rows(10)
    db.prune_unseen("t", {"TWA0"}, shards=2, shard=0)
    db.prune_unseen("t", set())
    state["rows"] = _rows(1000)
    db.prune_unseen("t", {"TWA0"})
    assert calls == []


def test_no_double_strike_when_the_caller_also_reads(monkeypatch):
    """manzo calls strike_read_gone itself after the -1: the second call must be a no-op."""
    monkeypatch.setattr(db, "_READ_GONE_DONE", {"manzo_residential_listings"})
    monkeypatch.setattr(db, "sb", lambda: (_ for _ in ()).throw(AssertionError("must not read")))
    assert db.strike_read_gone("manzo_residential_listings", {"MNZ1"}, "s") == 0


def test_a_caller_with_its_own_oracle_still_reads_but_never_strikes_twice(monkeypatch):
    """2026-10-27: a soft-404 site (200 for a removed ad) reads again with its OWN oracle after the
    refused prune's 404-only reading. It must run, skip ads already struck, and keep the cap."""
    rows = [{"ad_number": f"A{i}", "last_seen_at": f"2026-10-{i + 10:02d}"} for i in range(10)]

    class _Q:
        def __getattr__(self, _):
            return lambda *a, **k: self

    class _Res:
        data = rows

    monkeypatch.setattr(db, "sb", lambda: type("C", (), {"table": lambda self, t: _Q()})())
    monkeypatch.setattr(db, "_execute", lambda q, what="": _Res())
    monkeypatch.setattr(db, "_READ_GONE_DONE", {"t"})
    monkeypatch.setattr(db, "_READ_GONE_STRUCK", {"t": {"A5"}})
    asked: list[str] = []
    got = {}

    def fake_prune(table, seen, **kw):
        got["seen"], got["kw"] = set(seen), kw
        return 2
    monkeypatch.setattr(db, "prune_unseen", fake_prune)

    def oracle(ad):
        asked.append(ad)
        return ("gone", "soft 404")
    seen = {"A0", "A1", "A2", "A3"}
    assert db.strike_read_gone("t", seen, "s", verify_gone=oracle) == 2
    assert "A5" not in asked, "an ad the first reading struck is not read or struck again"
    assert sorted(asked) == ["A4", "A6", "A7", "A8", "A9"]
    struck = {f"A{i}" for i in range(10)} - got["seen"]
    assert len(struck) == 2, "cap 30% of 10 = 3, minus the 1 already struck this run"
    assert "A5" not in struck and got["kw"]["verify_gone"] is oracle
