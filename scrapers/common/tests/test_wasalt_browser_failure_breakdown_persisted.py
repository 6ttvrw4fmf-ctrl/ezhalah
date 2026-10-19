"""Regression test: wasalt's browser-path failure breakdown must reach scrape_runs, not just
stdout — and the old http-path label must not be trusted at face value any more.

WHY (daily-engineer run, 2026-09-19). wasalt moved from a plain http fetch to a real
headless-under-xvfb Chromium on 2026-09-18 (scrapers/wasalt/browser.py) to clear wasalt.sa's
tightened Cloudflare challenge. The fail-visibly guard in run.py still stamps every 0-row run with
the SAME fixed string it used before that migration — "FETCHED 0 ROWS — proxy/network block
(fail-visibly guard)" — which is now a guess: a browser attempt can fail at launch, at a challenge
that never clears, at a navigation exception (often the proxy/TLS interaction the module's own
docstring documents), or an unclassified empty shell. A daily-engineer run blended 24h of
scrape_runs (mixing the bad rollout window with the since-recovered steady state) and reported
wasalt as "degraded, needs an owner proxy top-up" purely from that one fixed label plus a raw
pass/fail count — there was no per-run signal saying WHICH failure shape actually happened.

`_page_once` already classifies every failure and PRINTS it (http status, challenge markers,
exception type) — this locks the same fix dealapp already has for its own fetch path
(`_record_status_200_no_schema` / `test_dealapp_fetch_failure_breakdown_persisted.py`): whatever
browser.py tallies must reach `scrape_runs.notes`, not just a GitHub Actions log that expires.

Run: python -m pytest scrapers/common/tests/test_wasalt_browser_failure_breakdown_persisted.py -v
"""
from __future__ import annotations

import sys
from unittest.mock import MagicMock

import pytest

from scrapers.wasalt import browser as B
from scrapers.wasalt import run


@pytest.fixture(autouse=True)
def _clean_counter():
    """The tally is module-global; isolate each test from the others (and from import order)."""
    B._fail_reasons.clear()
    yield
    B._fail_reasons.clear()


# ── browser.py: the classifier itself ────────────────────────────────────────────────────────────

def test_launch_failure_is_recorded_and_classified_differently_from_a_challenge():
    """A browser that never launched and a challenge that never cleared are different root causes
    (one is a CI/runner problem, the other is Cloudflare/proxy) and must not collapse into one
    bucket — that collapse is exactly what made the generic label a guess."""

    class _LaunchFails(B.BrowserFetcher):
        def _ensure(self) -> None:
            raise RuntimeError("no display :99")

    data, status, nbytes = _LaunchFails()._page_once("https://wasalt.sa/whatever")
    assert data is None and status is None and nbytes == 0
    assert B._fail_reasons["launch_failed"] == 1


def test_a_challenge_shell_is_bucketed_separately_from_an_unclassified_empty_page():
    class _Ctx:
        def new_page(self):
            return _Page(html='<html><body>Just a moment...<div id="_cf_chl_opt"></div></body></html>')

    class _Page:
        def __init__(self, html: str):
            self._html = html

        def goto(self, *a, **k):
            return type("R", (), {"status": 200})()

        def content(self):
            return self._html

        def wait_for_timeout(self, *_a):
            pass

        def close(self):
            pass

    f = B.BrowserFetcher()
    f._ctx = _Ctx()
    f._ensure = lambda: None  # already "ensured"
    data, status, _n = f._page_once("https://wasalt.sa/whatever")
    assert data is None and status == 200
    assert B._fail_reasons["challenge_shell"] == 1
    assert "no_next_data_unclassified" not in B._fail_reasons


def test_a_nav_exception_is_bucketed_by_exception_type():
    class _Ctx:
        def new_page(self):
            return _Page()

    class _Page:
        def goto(self, *a, **k):
            raise TimeoutError("net::ERR_TIMED_OUT")

        def close(self):
            pass

    f = B.BrowserFetcher()
    f._ctx = _Ctx()
    f._ensure = lambda: None
    data, status, _n = f._page_once("https://wasalt.sa/whatever")
    assert data is None and status is None
    assert B._fail_reasons["nav_exception:TimeoutError"] == 1


def test_summary_is_bounded_and_content_free():
    for i in range(200):
        B._record_failure(f"bucket_{i}")
    for _ in range(500):
        B._record_failure("challenge_shell")

    summary = B.fail_reasons_summary()

    assert len(summary) <= 200, len(summary)
    assert "browser_fail_total=700" in summary
    # Most-common first, so the dominant class survives truncation.
    assert "challenge_shell=500" in summary


def test_summary_is_empty_when_nothing_failed():
    assert B.fail_reasons_summary() == ""


# ── run.py: the breakdown must reach scrape_runs.notes ──────────────────────────────────────────

def _run_main_capturing_end_run_notes(monkeypatch, *, fetch_page) -> str:
    captured: dict = {}

    def _end_run(run_id, **kwargs):
        captured.update(kwargs)
        return True

    monkeypatch.setattr(sys, "argv", ["run.py", "--deal", "sale", "--type", "residential",
                                       "--slug", "apartment", "--pages", "3"])
    monkeypatch.setattr(run, "session", lambda: MagicMock())
    monkeypatch.setattr(run, "fetch_page", fetch_page)
    # map_property/upsert are Wasalt's field-mapping concern, not this classifier's — stub them so
    # a "clean run" only needs fetch_page to report a row, not a real listing shape.
    monkeypatch.setattr(run, "map_property", lambda prop, deal, s=None: {"property_type": "apartment"})
    monkeypatch.setattr(run.db, "upsert_wasalt_residential_batch", lambda rows: None)
    monkeypatch.setattr(run.db, "upsert_wasalt_commercial_batch", lambda rows: None)
    monkeypatch.setattr(run, "_browser_fetch_enabled", lambda: True)
    monkeypatch.setattr(run.db, "begin_run", lambda platform: 999)
    monkeypatch.setattr(run.db, "end_run", _end_run)

    run.main()
    return captured.get("notes") or ""


def test_notes_carry_the_browser_failure_breakdown_on_a_zero_row_run(monkeypatch):
    """The 2026-09-19 shape: page 1 never produces a parseable answer, browser.py already knows
    WHY (a mix of challenge shells and one launch failure), and the finalized row must say so
    instead of falling back to the old fixed proxy-block guess alone."""

    def _failing_fetch_page(s, deal, cat, slug, page):
        B._record_failure("challenge_shell")
        B._record_failure("challenge_shell")
        B._record_failure("launch_failed")
        return 0, 0, [], False

    notes = _run_main_capturing_end_run_notes(monkeypatch, fetch_page=_failing_fetch_page)

    assert notes.startswith("FETCHED 0 ROWS — proxy/network block (fail-visibly guard)"), notes
    assert "browser_fail_total=3" in notes, notes
    assert "challenge_shell=2" in notes, notes
    assert "launch_failed=1" in notes, notes


def test_a_clean_run_adds_no_failure_noise(monkeypatch):
    """Negative control. A successful fetch must not carry stale/leftover diagnostics into the
    notes of a healthy run."""

    def _ok_fetch_page(s, deal, cat, slug, page):
        return 1, 1, [{"id": "1", "attributes": []}], True

    notes = _run_main_capturing_end_run_notes(monkeypatch, fetch_page=_ok_fetch_page)

    assert notes.startswith("upserted="), notes
    assert "browser_fail" not in notes, notes


def test_the_summary_is_omitted_when_the_browser_path_is_not_in_use(monkeypatch):
    """The http path predates this classifier and has none of its own — the old fixed label must
    stand alone rather than silently claiming a browser breakdown that was never produced."""

    def _failing_fetch_page(s, deal, cat, slug, page):
        return 0, 0, [], False

    captured: dict = {}

    def _end_run(run_id, **kwargs):
        captured.update(kwargs)
        return True

    monkeypatch.setattr(sys, "argv", ["run.py", "--deal", "sale", "--type", "residential",
                                       "--slug", "apartment", "--pages", "3"])
    monkeypatch.setattr(run, "session", lambda: MagicMock())
    monkeypatch.setattr(run, "fetch_page", _failing_fetch_page)
    monkeypatch.setattr(run, "_browser_fetch_enabled", lambda: False)
    monkeypatch.setattr(run.db, "begin_run", lambda platform: 999)
    monkeypatch.setattr(run.db, "end_run", _end_run)

    run.main()
    notes = captured.get("notes") or ""

    assert notes == "FETCHED 0 ROWS — proxy/network block (fail-visibly guard)", notes
