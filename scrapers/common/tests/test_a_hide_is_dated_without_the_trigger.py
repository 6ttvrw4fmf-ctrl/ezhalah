"""A hide writes its own `deactivated_at` (2026-10-03).

27 platforms' listing tables (rakez, arkaan, suwar, ksaaqar, sadiqeltajer …) never had
`trg_set_deactivated_at`, so a row hidden by `prune_unseen` or the daily direct check kept
`deactivated_at` NULL: 1,016 residential hides were invisible to the hidden counts, to
mon_unverified_inactivations_24h, to auto_recover_false_inactive() and to the 30-day clock. The
trigger keeps a date it is given, so writing it in the hide patch is right with or without it.
These tests EXECUTE the real prune_unseen against a stub client and read the patch it sends.
"""
from __future__ import annotations

import types

from scrapers.common import db


class _Q:
    def __init__(self, sink):
        self.sink = sink

    def __getattr__(self, _name):
        return lambda *a, **k: self

    def update(self, payload):
        self.sink.append(payload)
        return self


def test_prune_unseen_dates_the_hide_it_writes(monkeypatch):
    written = []
    active = [{"ad_number": str(i), "missing_count": 2 if i == 5 else 0} for i in range(100)]
    monkeypatch.setattr(db, "sb", lambda: types.SimpleNamespace(table=lambda _n: _Q(written)))
    monkeypatch.setattr(db, "_execute", lambda q, what="", **k: types.SimpleNamespace(
        data=active if what.endswith("prune_select") else []))
    db._PRUNE_TRIPS.clear()
    seen = [str(i) for i in range(100) if i != 5]
    db.prune_unseen("x_residential_listings", seen, verify_gone=lambda ad: ("gone", "404 on its own url"))
    hides = [p for p in written if p.get("active") is False]
    assert hides, "the confirmed-gone row must be hidden"
    assert all(p.get("deactivated_at") for p in hides), "a hide must carry its own deactivated_at"
