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

Also covers: fetch_one now classifies WHY each fetch ultimately failed (404 vs a persistent
unhydrated skeleton vs a 200 that never carried the listing schema, itself split into
redirected-away / same-url-no-ng-state / same-url-ng-state-no-schema — see
_record_status_200_no_schema's docstring) into a counter, so a future silent-zero run is
diagnosable straight from the job log instead of needing live access to the source to guess.
The 2026-08-09 follow-up (issue #343 second pass) added the sub-classification after a real run
showed 980/1200 fetches in that one bucket, with no way to tell "expired listing" from "we're
failing to render a live one" apart.

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


def _fetch_one_with_fake_response(adid, resp):
    """Run fetch_one against a canned response, patching the module-level thread-local _session()
    helper (fetch_one doesn't take a session argument) rather than injecting one directly."""
    fake_session = MagicMock()
    fake_session.get.return_value = resp
    import scrapers.dealapp.run as run_mod
    orig_session = run_mod._session
    try:
        run_mod._session = lambda: fake_session
        return run_mod.fetch_one(adid)
    finally:
        run_mod._session = orig_session


def test_fetch_one_classifies_a_404_separately_from_a_block_page():
    run._fetch_fail_reasons.clear()

    class _FakeResp:
        status_code = 404
        text = "Not Found"

    out = _fetch_one_with_fake_response("999", _FakeResp())

    assert out is None
    assert run._fetch_fail_reasons["not_found_404_410"] == 1
    assert "status_200" not in run._fetch_fail_reasons


def test_fetch_one_classifies_a_redirect_away_as_redirected_away():
    """dealapp 301/302s an expired/removed ad to somewhere else entirely (home, search, a generic
    page) — the strongest safe (content-free) signal that the id is gone, not that OUR renderer
    failed on a still-live page."""
    run._fetch_fail_reasons.clear()
    run._fetch_fail_samples.clear()

    class _FakeResp:
        status_code = 200
        text = "<html><body>generic homepage shell</body></html>"
        url = "https://dealapp.sa/ar/home"  # left the requested /ad-details/999 path entirely

    out = _fetch_one_with_fake_response("999", _FakeResp())

    assert out is None
    assert run._fetch_fail_reasons["status_200_no_listing_schema:redirected_away"] == 1
    assert run._fetch_fail_samples["redirected_away"][0]["adid"] == "999"


def test_fetch_one_classifies_a_same_url_response_with_no_ng_state_as_a_block_signature():
    """The login-wall/consent-shell/rate-limit shape: HTTP 200, stayed on the requested URL, but
    never even hydrated an Angular ng-state block. The one bucket that's a candidate for 'we're
    failing to render a genuinely live listing' rather than 'dealapp told us it's gone'."""
    run._fetch_fail_reasons.clear()
    run._fetch_fail_samples.clear()

    class _FakeResp:
        status_code = 200
        text = "<html><body>يرجى تسجيل الدخول للمتابعة</body></html>"  # no ng-state at all
        url = "https://dealapp.sa/ar/ad-details/999"  # same path as requested

    out = _fetch_one_with_fake_response("999", _FakeResp())

    assert out is None
    assert run._fetch_fail_reasons["status_200_no_listing_schema:same_url_no_ng_state"] == 1


def test_fetch_one_classifies_a_hydrated_soft_404_distinctly_from_a_block_page():
    """Angular DID fully hydrate (ng-state present) but the app itself never wrote a real-estate-
    listing schema block — the SPA rendered and decided there's no listing here. Cleanest 'this id
    is genuinely gone' signal of the three, and must NOT be confused with the block-page bucket."""
    run._fetch_fail_reasons.clear()
    run._fetch_fail_samples.clear()

    class _FakeResp:
        status_code = 200
        text = '<html><body><script id="ng-state" type="application/json">{"schemaMarkupScripts":{}}</script></body></html>'
        url = "https://dealapp.sa/ar/ad-details/999"

    out = _fetch_one_with_fake_response("999", _FakeResp())

    assert out is None
    assert run._fetch_fail_reasons["status_200_no_listing_schema:same_url_ng_state_no_schema"] == 1
    assert run._fetch_fail_reasons["status_200_no_listing_schema:same_url_no_ng_state"] == 0


def test_fetch_fail_samples_are_content_free():
    """PDPL guard: a sample must carry only the adid, a truncated redirect path, and a body length
    — never the response text itself."""
    run._fetch_fail_reasons.clear()
    run._fetch_fail_samples.clear()

    class _FakeResp:
        status_code = 200
        text = "<html><body>0512345678 محمد للتواصل</body></html>"  # a phone number, on purpose
        url = "https://dealapp.sa/ar/home"

    _fetch_one_with_fake_response("999", _FakeResp())

    sample = run._fetch_fail_samples["redirected_away"][0]
    assert set(sample.keys()) == {"adid", "final_path", "body_len"}
    assert "0512345678" not in str(sample.values())
    assert "محمد" not in str(sample.values())


def test_fetch_fail_samples_are_capped_per_bucket():
    run._fetch_fail_reasons.clear()
    run._fetch_fail_samples.clear()

    class _FakeResp:
        status_code = 200
        text = "<html></html>"
        url = "https://dealapp.sa/ar/home"

    for i in range(run._MAX_SAMPLES_PER_BUCKET + 5):
        _fetch_one_with_fake_response(str(i), _FakeResp())

    assert run._fetch_fail_reasons["status_200_no_listing_schema:redirected_away"] == run._MAX_SAMPLES_PER_BUCKET + 5
    assert len(run._fetch_fail_samples["redirected_away"]) == run._MAX_SAMPLES_PER_BUCKET
