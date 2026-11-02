"""strike_read_gone on a table of 1,000+ active rows (2026-10-27).

haraj holds 13,702 active residential ads. strike_read_gone used to read only a 1,000-row slice and hand
prune_unseen «the slice minus the gone ads» as the seen set, so prune_unseen measured 999 seen against
13,702 active, tripped the collapse guard on every run since 10-18, and the one ad whose own page read
gone was never struck. The whole active set must reach prune_unseen, minus exactly the ads that read gone.
"""
from __future__ import annotations

from scrapers.common import db


def _wire(monkeypatch, rows):
    calls = {"ranged": False}

    class _Q:
        def range(self, *a, **k):
            calls["ranged"] = True
            return self

        def __getattr__(self, _):
            return lambda *a, **k: self

    class _Res:
        data = rows

    monkeypatch.setattr(db, "sb", lambda: type("C", (), {"table": lambda self, t: _Q()})())
    monkeypatch.setattr(db, "_execute", lambda q, what="": _Res())

    def fake_prune(tbl, seen, **kw):
        calls["seen"], calls["kw"] = set(seen), kw
        return 1
    monkeypatch.setattr(db, "prune_unseen", fake_prune)
    return calls


def test_a_big_table_passes_every_active_row_minus_the_gone_one(monkeypatch):
    rows = [{"ad_number": f"H{i}", "last_seen_at": f"2026-10-{1 + i % 28:02d}"} for i in range(1500)]
    calls = _wire(monkeypatch, rows)
    seen_this_run = {f"H{i}" for i in range(1, 1500)}           # H0 was not seen this crawl
    n = db.strike_read_gone("haraj_residential_listings", seen_this_run, "Haraj",
                            lambda ad: ("gone", "404") if ad == "H0" else ("live", "200"))
    assert n == 1
    assert not calls["ranged"], "the active set must not be read as a 1,000-row slice"
    assert len(calls["seen"]) == 1499 and "H0" not in calls["seen"], \
        "prune_unseen must see every active row except the one that read gone"


def test_the_collapse_cap_still_holds_on_a_big_table(monkeypatch):
    rows = [{"ad_number": f"H{i}", "last_seen_at": "2026-10-01"} for i in range(1200)]
    calls = _wire(monkeypatch, rows)
    # nothing but H0 was seen; every other ad reads gone — the cap (30% of 1,200 = 360) must bind,
    # and max_reads caps how many pages are read in the first place
    db.strike_read_gone("t", {"H0"}, None, lambda ad: ("gone", "404"), max_reads=2000)
    assert 1200 - len(calls["seen"]) == 360
