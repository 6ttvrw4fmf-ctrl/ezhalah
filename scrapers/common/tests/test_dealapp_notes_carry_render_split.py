"""Regression test: a dealapp run's note says where its pages came from (origin vs edge).

WHY (2026-11-09, alert_event 13962 run_duration_explosion:dealapp:10/24). The same shard, the same
code, the same ~2,500 ids: 4 minutes on 11-08 and 157 minutes on 11-09. The difference was CloudFront
— edge hits are refunded, origin renders are paced at RENDERS_PER_MIN per IP (the login-wall
protection) — and the only evidence of that was a GitHub Actions log timeline that expires. The
duration detector reads rows/min from scrape_runs and cannot see the split; its SLOW_COMPLETE shape
(migration 20261109124054) names a paced run for what it is, but adjudicating it still needed the log.

Contract locked here: every `_get()` is tallied as origin or edge, and the finalized
`scrape_runs.notes` carries ` origin_renders=N edge_hits=M` — content-free integers, appended after
the fetch-failure summary so the existing prefix other tests and migrations quote is unchanged. A run
that fetched nothing adds nothing.

Run: python -m pytest scrapers/common/tests/test_dealapp_notes_carry_render_split.py -v
"""
from __future__ import annotations

from unittest.mock import MagicMock

import pytest

from scrapers.dealapp import run
from scrapers.common.tests.test_dealapp_fetch_failure_breakdown_persisted import (
    _run_main_capturing_end_run_notes,
)


@pytest.fixture(autouse=True)
def _clean_counters():
    run._render_split.clear()
    run._fetch_fail_reasons.clear()
    run._fetch_fail_samples.clear()
    yield
    run._render_split.clear()
    run._fetch_fail_reasons.clear()
    run._fetch_fail_samples.clear()


def _resp(x_cache: str):
    r = MagicMock()
    r.status_code = 200
    r.headers = {"x-cache": x_cache}
    r.text = ""
    return r


def test_get_tallies_origin_and_edge_separately():
    s = MagicMock()
    s.get.side_effect = [_resp("Miss from cloudfront"), _resp("Hit from cloudfront"),
                         _resp("Hit from cloudfront"), _resp("")]
    for _ in range(4):
        run._get(s, "https://dealapp.sa/ar/ad-details/1")
    assert run._render_split["origin"] == 2, dict(run._render_split)   # Miss + no header = origin
    assert run._render_split["edge"] == 2, dict(run._render_split)
    assert run._render_split_summary() == " origin_renders=2 edge_hits=2"


def test_notes_carry_the_render_split_after_the_failure_summary(monkeypatch):
    def _fetch(adid: str):
        # fetch_one's own bookkeeping, without the network: one origin render, one edge hit, one
        # classified failure — the three things a slow shard's note must let SQL tell apart.
        with run._render_split_lock:
            run._render_split["origin"] += 1
            run._render_split["edge"] += 1
        run._record_fetch_failure("not_found_404_410")
        return None

    notes = _run_main_capturing_end_run_notes(monkeypatch, ids=["1", "2", "3"], fetch_one=_fetch)

    assert notes.startswith("sold=0 pruned=0 attempted=3 "), notes
    assert "fetch_fail_total=3" in notes, notes
    assert notes.endswith(" origin_renders=3 edge_hits=3"), notes
    assert notes.index("fetch_fail_total=") < notes.index("origin_renders="), notes


def test_a_run_that_fetched_nothing_adds_no_render_noise(monkeypatch):
    notes = _run_main_capturing_end_run_notes(monkeypatch, ids=[], fetch_one=lambda adid: None)
    assert "origin_renders" not in notes, notes
    assert "edge_hits" not in notes, notes
