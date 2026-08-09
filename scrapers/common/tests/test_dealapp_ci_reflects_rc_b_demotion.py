"""Regression test: RC-B's ok=False verdict must actually redden CI (2026-08-09).

Every dealapp run funnels its finalization through db.end_run(), whose RC-B guard demotes a
0-row (or otherwise unhealthy) run to ok=False and returns that EFFECTIVE ok specifically so a
caller can sys.exit(1) — see scrapers/common/db.py's end_run() docstring and
scrapers/common/tests/test_end_run_honesty.py, which already locks the DB-side half of that
contract. dealapp's main() called end_run() and discarded the return value, then unconditionally
`return 0` — so a run the DB correctly marked unhealthy still showed GREEN in GitHub Actions.

Found live 2026-08-09: run 31294408328 (job 93197018140, "Small sources sync #82") scraped
0/1200 detail pages over its full 33-minute crawl. scrape_runs.ok WAS correctly demoted to false
(scrape_runs id 25926, "RC-B demoted ok=False: 0-row run"), but the GitHub Actions job still
exited 0, so the daily cron kept reporting success while dealapp's raw last_seen_at froze at
2026-08-08 05:51 UTC for 23+ hours across 2 consecutive days. Filed as
https://github.com/6ttvrw4fmf-ctrl/ezhalah/issues/343.

Also covers: fetch_one now classifies WHY each fetch ultimately failed (login-wall/page-shape-
change vs 404 vs a persistent unhydrated skeleton) into a counter, so a future silent-zero run is
diagnosable straight from the job log instead of needing live access to the source to guess.

Run: python -m pytest scrapers/common/tests/test_dealapp_ci_reflects_rc_b_demotion.py -v
"""
from __future__ import annotations

import sys
from unittest.mock import MagicMock

from scrapers.dealapp import run


def _stub_common_db_writes(monkeypatch, *, end_run_returns: bool) -> None:
    monkeypatch.setattr(run.db, "begin_run", lambda platform: 999)
    monkeypatch.setattr(run.db, "prune_unseen", lambda tbl, seen, source: 0)
    monkeypatch.setattr(run.db, "upsert_dealapp_residential_batch", lambda rows: None)
    monkeypatch.setattr(run.db, "upsert_dealapp_commercial_batch", lambda rows: None)
    monkeypatch.setattr(run.db, "end_run", lambda *a, **k: end_run_returns)


def test_main_exits_nonzero_when_end_run_demotes_the_run_to_unhealthy(monkeypatch):
    """0 usable fetches -> end_run's RC-B guard would demote ok=False -> main() must return 1,
    not silently return 0 the way it did in production on 2026-08-09."""
    monkeypatch.setattr(sys, "argv", ["run.py"])
    monkeypatch.setattr(run, "session", lambda: MagicMock())
    monkeypatch.setattr(run, "enumerate_ids", lambda s, cap: ["1", "2", "3"])
    monkeypatch.setattr(run, "fetch_one", lambda adid: None)  # every fetch fails, like 08-09's run
    _stub_common_db_writes(monkeypatch, end_run_returns=False)

    assert run.main() == 1


def test_main_exits_zero_when_end_run_reports_a_healthy_run(monkeypatch):
    """The flip side — a genuinely healthy run (end_run returns True) must still exit 0. Proves
    the fix only changes behavior on a demotion, not the ~34-scraper-wide healthy path."""
    monkeypatch.setattr(sys, "argv", ["run.py"])
    monkeypatch.setattr(run, "session", lambda: MagicMock())
    monkeypatch.setattr(run, "enumerate_ids", lambda s, cap: [])
    _stub_common_db_writes(monkeypatch, end_run_returns=True)

    assert run.main() == 0


def test_fetch_one_classifies_a_persistent_200_with_no_listing_schema():
    """The exact shape a login-wall / consent shell / changed page layout would produce: HTTP 200
    on every attempt, but the response never once carries the 'real-estate-listing' marker at all
    (not even an unhydrated skeleton). Must be tallied distinctly from a 404 or a skeleton-only
    response so the next run's job log actually says which one happened."""
    run._fetch_fail_reasons.clear()

    class _FakeResp:
        status_code = 200
        text = "<html><body>يرجى تسجيل الدخول للمتابعة</body></html>"  # no ng-state at all

    fake_session = MagicMock()
    fake_session.get.return_value = _FakeResp()

    # fetch_one calls the module-level _session() helper (thread-local), not a passed-in session —
    # patch that instead of trying to inject one directly.
    import scrapers.dealapp.run as run_mod
    orig_session = run_mod._session
    try:
        run_mod._session = lambda: fake_session
        out = run_mod.fetch_one("999")
    finally:
        run_mod._session = orig_session

    assert out is None
    assert run._fetch_fail_reasons["status_200_no_listing_schema(likely_block_or_page_shape_change)"] == 1


def test_fetch_one_classifies_a_404_separately_from_a_block_page():
    run._fetch_fail_reasons.clear()

    class _FakeResp:
        status_code = 404
        text = "Not Found"

    fake_session = MagicMock()
    fake_session.get.return_value = _FakeResp()

    import scrapers.dealapp.run as run_mod
    orig_session = run_mod._session
    try:
        run_mod._session = lambda: fake_session
        out = run_mod.fetch_one("999")
    finally:
        run_mod._session = orig_session

    assert out is None
    assert run._fetch_fail_reasons["not_found_404_410"] == 1
    assert "status_200" not in run._fetch_fail_reasons
