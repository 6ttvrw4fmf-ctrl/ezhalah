"""fleet_liveness controls (♻️ 2026-11-13): a row our own reader already read gone is never a known-live control.
opensooq OSQ288563804 (struck at 05:00) was the most recently SEEN ad, so the 03:31 recheck opened with it as a
control, read it gone and quarantined the pass: the dead ad blocked its own removal."""
from __future__ import annotations

from scrapers.common import fleet_liveness as F


def _rows_fake(pool):
    def _rows(client, table, cols, *, order, limit, since=None):
        assert "missing_count" in cols, "controls must read missing_count to skip struck rows"
        return [dict(r, _table=table) for r in pool[table]][:limit]
    return _rows


def test_struck_rows_are_never_controls(monkeypatch):
    pool = {"x_residential_listings": [
        {"ad_number": "D1", "last_seen_at": "2026-11-13T05:00", "missing_count": 1},
        {"ad_number": "L1", "last_seen_at": "2026-11-13T04:00", "missing_count": 0},
        {"ad_number": "L2", "last_seen_at": "2026-11-13T03:00", "missing_count": None},
        {"ad_number": "D2", "last_seen_at": "2026-11-13T02:00", "missing_count": 2},
        {"ad_number": "L3", "last_seen_at": "2026-11-13T01:00", "missing_count": 0},
        {"ad_number": "L4", "last_seen_at": "2026-11-13T00:30", "missing_count": 0},
        {"ad_number": "L5", "last_seen_at": "2026-11-13T00:10", "missing_count": 0},
    ]}
    monkeypatch.setattr(F, "_rows", _rows_fake(pool))
    got = [r["ad_number"] for r in F.controls(None, {"x_residential_listings": 7})]
    assert got == ["L1", "L2", "L3", "L4", "L5"][:F.MIN_CANARIES], got
    assert not {"D1", "D2"} & set(got)
