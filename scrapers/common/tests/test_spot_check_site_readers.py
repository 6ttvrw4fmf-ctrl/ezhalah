"""The double-check reads dealapp and gathern the way their hiding jobs do (2026-10-02).

Judged by HTTP status alone, dealapp's 200 shell read every hidden ad "live" (30 of 30 on
2026-10-02) and gathern was read through a different session than its checker. These tests EXECUTE
_reader_for with each site's own probe stubbed and prove the verdict follows that probe.
"""
from __future__ import annotations

import scrapers.common.lifecycle_spot_check as SC
from scrapers.common.liveness_contract import ALIVE, DEAD, UNKNOWN


def test_dealapp_is_read_by_its_liveness_oracle(monkeypatch):
    from scrapers.dealapp import liveness_run
    answers = {"u1": (ALIVE, 200), "u2": (UNKNOWN, 200), "u3": (DEAD, 404)}
    monkeypatch.setattr(liveness_run, "_session", lambda *a, **k: object())
    monkeypatch.setattr(liveness_run, "probe_listing", lambda s, url, budget=None: answers[url])
    read = SC._reader_for("dealapp")
    assert [read(u) for u in ("u1", "u2", "u3")] == [ALIVE, UNKNOWN, DEAD]


def test_gathern_is_read_by_its_checker_session(monkeypatch):
    from scrapers.gathern import liveness as gl
    statuses = {"a": 200, "b": 404, "c": 410, "d": 0, "e": 403}
    monkeypatch.setattr(gl, "proxied_session", lambda use_proxy: object())
    monkeypatch.setattr(gl, "probe", lambda s, url, retries=3: statuses[url])
    read = SC._reader_for("gathern")
    assert [read(u) for u in "abcde"] == [ALIVE, DEAD, DEAD, UNKNOWN, UNKNOWN]


def test_other_sites_keep_the_generic_judge():
    assert SC._reader_for("aqar") is None
    assert SC._reader_for("wasalt") is None
