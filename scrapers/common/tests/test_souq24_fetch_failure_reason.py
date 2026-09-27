"""souq24's browse-page harvest and detail sweep must record WHY they saw nothing — never a
silent empty result indistinguishable from a genuinely empty catalogue.

THE INCIDENT (daily engineer, 2026-09-24). souq24 came OFF its residential proxy on 2026-09-18
(small-sources-sync.yml), measured that day to work fine DIRECT (200, 161 KB, 18 real listing
links). Every scheduled run since 2026-09-20 (4+ days) then recorded:

    harvest: 23/23 browse pages in 2.3s (0 failed, 8 workers, 15s/page) -> 0 seed ids, max id 0
    24 Souq: 0 browse-seeded ids, sweeping ids 1..1300 (1300 candidates, 8 workers)
    ✓ 24 Souq: 0 residential + 0 commercial upserted, 0 stale pruned
    ✗ run demoted to unhealthy by end_run()'s RC-B guard

Every browse page answered without a transport exception, so `failed` stayed 0 and `visited`
reached every page — the harvest even reported itself COMPLETE. But `one()` read `.text`
regardless of `.status_code`, so a WAF/soft-block response (a "listing-less shell" served with a
200, or any non-200 that isn't an exception) was invisible: it looked exactly like "23 real pages
that just happened to contain 0 ids". `fetch_one()` had the identical shape — a non-200/404 status
that survived all 3 retries was discarded with a bare `return None`, indistinguishable from "this
id is sold/deleted" (the normal, expected outcome for ~96% of the numeric sweep).

The invariant, same as sadin/sanadak/erapulse/abeea: **rows_seen alone can never separate "the
source served nothing" from "we never got an answer we can believe" — so the reason must be
captured at fetch time**, and a real 200-with-nothing must land in its OWN bucket, separate from a
hard failure, because the two point at different root causes (markup/API drift vs. a block).

Run: python -m pytest scrapers/common/tests/test_souq24_fetch_failure_reason.py -v
"""
import sys
import threading
import time
from pathlib import Path
from unittest import mock

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

from scrapers.souq24 import run as sq  # noqa: E402


@pytest.fixture(autouse=True)
def _no_real_delays(monkeypatch):
    monkeypatch.setattr(sq.time, "sleep", lambda *_a, **_k: None)


def setup_function(_fn):
    sq._fetch_fail_reasons.clear()
    sq._SWEEP_ABORT.clear()


def teardown_function(_fn):
    sq._fetch_fail_reasons.clear()
    sq._SWEEP_ABORT.clear()


class _Session:
    """Sitemap answers empty; every browse page answers with the same scripted response/exception."""

    def __init__(self, resp=None, raise_exc=None):
        self._resp = resp
        self._raise = raise_exc

    def get(self, url, timeout=None, **kw):
        if url == sq.SITEMAP:
            return mock.Mock(status_code=200, text="<urlset></urlset>")
        if self._raise is not None:
            raise self._raise
        return self._resp


# ── THE REGRESSION: harvest_ids() must name a non-200 status, not just an exception ─────────────
def test_harvest_records_a_non_200_status_even_though_no_exception_was_raised():
    """THE ACTUAL BUG: a WAF/soft-block page answers WITHOUT raising, so the old code's
    except-only accounting saw 0 failures and 0 ids and called the harvest COMPLETE."""
    s = _Session(resp=mock.Mock(status_code=403, text="blocked"))
    ids, mx, complete = sq.harvest_ids(s)
    assert ids == set()
    assert complete is False, "a non-200 page must count as a failed/unread page, not a clean pass"
    assert "http_403" in sq.fetch_failure_summary()


def test_harvest_transport_exception_is_recorded_by_type():
    s = _Session(raise_exc=ConnectionError("reset by peer"))
    sq.harvest_ids(s)
    assert "transport_ConnectionError" in sq.fetch_failure_summary()


def test_a_clean_200_with_zero_ids_on_every_page_is_a_different_bucket_from_a_block():
    """A 403/5xx is the source refusing us. A 200 that extracts nothing on EVERY page — no
    transport failure, no bad status — is a DIFFERENT fact: markup/API drift, or a soft
    datacenter-IP shell served without ever refusing the request. Never collapse the two."""
    s = _Session(resp=mock.Mock(status_code=200, text="<html>no listing links here</html>"))
    ids, mx, complete = sq.harvest_ids(s)
    assert ids == set()
    summary = sq.fetch_failure_summary()
    assert "http_200_zero_ids_all_pages" in summary, summary
    assert "http_403" not in summary and "transport_" not in summary


def test_a_healthy_harvest_records_no_failure():
    s = _Session(resp=mock.Mock(
        status_code=200, text='href="https://24.com.sa/12345/slug"'))
    ids, mx, complete = sq.harvest_ids(s)
    assert ids == {12345}
    assert complete is True
    assert sq.fetch_failure_summary() == ""


# ── fetch_one(): the numeric sweep's identical defect ────────────────────────────────────────────
def test_fetch_one_records_a_non_200_404_status_after_exhausting_retries():
    calls = {"n": 0}

    class _S:
        def get(self, url, timeout=None, allow_redirects=True):
            calls["n"] += 1
            return mock.Mock(status_code=503)

    with mock.patch.object(sq, "_session", lambda: _S()):
        out = sq.fetch_one(555)
    assert out is None
    assert calls["n"] == 3, "retries must be bounded, not open-ended"
    assert sq.fetch_failure_summary() == "http_503=1", \
        "the reason must be recorded once per id, not once per attempt"


def test_fetch_one_transport_exception_is_recorded():
    class _S:
        def get(self, *a, **kw):
            raise ConnectionError("reset")

    with mock.patch.object(sq, "_session", lambda: _S()):
        sq.fetch_one(556)
    assert "transport_ConnectionError" in sq.fetch_failure_summary()


def test_fetch_one_404_is_not_a_failure():
    """A 404 means this id does not exist — the expected outcome for the vast majority of the
    numeric sweep. It must never be recorded as a fetch failure."""
    class _S:
        def get(self, *a, **kw):
            return mock.Mock(status_code=404)

    with mock.patch.object(sq, "_session", lambda: _S()):
        out = sq.fetch_one(557)
    assert out is None
    assert sq.fetch_failure_summary() == ""


def test_fetch_one_homepage_fallback_is_not_a_failure():
    """A 200 whose body carries no realestate_name is the documented sold/deleted/expired
    homepage-shell fallback — a normal outcome, not a failure."""
    class _S:
        def get(self, *a, **kw):
            return mock.Mock(status_code=200, text="<html>homepage shell</html>")

    with mock.patch.object(sq, "_session", lambda: _S()):
        out = sq.fetch_one(558)
    assert out is None
    assert sq.fetch_failure_summary() == ""


def test_fetch_one_success_records_no_failure():
    class _S:
        def get(self, *a, **kw):
            return mock.Mock(status_code=200, text='realestate_name">فيلا للبيع</')

    with mock.patch.object(sq, "REALESTATE_NAME_RE") as pat:
        pat.search.return_value = mock.Mock(group=lambda _i: "فيلا للبيع")
        with mock.patch.object(sq, "_session", lambda: _S()):
            out = sq.fetch_one(559)
    assert out is not None
    assert sq.fetch_failure_summary() == ""


# ── Concurrency: the tally must be safe under ThreadPoolExecutor use ─────────────────────────────
def test_record_fetch_failure_is_thread_safe():
    def hammer():
        for _ in range(200):
            sq._record_fetch_failure("http_500")

    threads = [threading.Thread(target=hammer) for _ in range(8)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert sq.fetch_failure_summary() == "http_500=1600"


if __name__ == "__main__":
    raise SystemExit(pytest.main([__file__, "-v"]))
