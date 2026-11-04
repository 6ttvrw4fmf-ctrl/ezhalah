"""A dealapp shard that read fewer than half the ids it attempted is DEGRADED, never a small catalogue.

Measured 2026-11-03 (crawl-health, alert silent_partial_success:dealapp:19/24): shard 19/24 attempted 2,375 ids
and parsed 356 — 2,019 pages answered 200 with ng-state but no listing schema — while its 23 siblings parsed
96-99% the same night and dealapp_liveness quarantined itself on canary_live=0/3. The collapse guard withheld
the prune (nothing was lost), but the run finalized ok=true, so no failure barrier could see it.

This drives the REAL main() end to end with stubbed I/O and asserts what end_run() is told.

Run: python -m pytest scrapers/common/tests/test_dealapp_unprovable_night_is_degraded.py -v
"""
from __future__ import annotations

import sys
from unittest.mock import MagicMock

from scrapers.dealapp import run


def _drive(monkeypatch, *, attempted: int, parsed: int) -> dict:
    calls: dict = {}
    ids = [str(1000 + i) for i in range(attempted)]
    readable = set(ids[:parsed])
    monkeypatch.setattr(sys, "argv", ["run.py"])
    monkeypatch.setattr(run, "session", lambda: MagicMock())
    monkeypatch.setattr(run, "enumerate_ids", lambda s, cap: list(ids))
    monkeypatch.setattr(run, "fetch_one", lambda adid: ("<html/>", adid) if adid in readable else None)
    monkeypatch.setattr(run, "map_listing",
                        lambda html, adid: ({"ad_number": f"DA{adid}", "photo_urls": [], "title": ""},
                                            "residential", False))
    monkeypatch.setattr(run, "_pin_sold_inactive", lambda *a, **k: None)
    monkeypatch.setattr(run, "set_liveness_canaries", lambda *a, **k: None)
    monkeypatch.setattr(run, "confirmed_absent", lambda: {})
    monkeypatch.setattr(run, "prune_table", lambda *a, **k: 0)
    monkeypatch.setattr(run.db, "begin_run", lambda platform: 999)
    monkeypatch.setattr(run.db, "retire_superseded_siblings", lambda **kw: 0)
    monkeypatch.setattr(run.db, "upsert_dealapp_residential_batch", lambda rows: None)
    monkeypatch.setattr(run.db, "upsert_dealapp_commercial_batch", lambda rows: None)
    monkeypatch.setattr(run.db, "mark_direct_alive", lambda *a, **k: None, raising=False)

    def _end_run(run_id, **kw):
        calls.update(kw)
        return not kw.get("degraded")
    monkeypatch.setattr(run.db, "end_run", _end_run)
    calls["rc"] = run.main()
    return calls


def test_the_measured_shard_19_night_is_reported_degraded(monkeypatch):
    run._fetch_fail_reasons.clear()
    got = _drive(monkeypatch, attempted=2375, parsed=356)
    assert got["degraded"] is True
    assert "unprovable_capture" in got["notes"]
    assert got["rc"] == 1


def test_a_normal_night_stays_healthy(monkeypatch):
    run._fetch_fail_reasons.clear()
    got = _drive(monkeypatch, attempted=1471, parsed=1417)   # shard 22/24 the same night: 96%
    assert not got.get("degraded")
    assert "unprovable_capture" not in got["notes"]
    assert got["rc"] == 0


def test_the_cut():
    assert run.capture_unprovable(100, 49) is True
    assert run.capture_unprovable(100, 50) is False
    # too few ids to judge (a validation or an empty slice) is never called unprovable
    assert run.capture_unprovable(10, 0) is False
