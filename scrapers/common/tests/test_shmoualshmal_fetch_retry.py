"""شموع الشمال: ONE flaky proxy hop must not cost the whole run (2026-09-14).

Root cause of a 4-day stall. This source succeeded on 09-11 and failed on 09-10/12/13/14, and every
failure was the identical transport error — `curl: (28) Connection timed out after 40002 ms` on page
1 through the residential proxy — while the very same URL answered in under a second from a normal
connection and souq24 used that SAME proxy fine on those days. The source was never down and never
blocked us. `fetch_listings` simply attempted each page ONCE and `break`ed on the first exception, so
a single bad hop produced "REST returned no listings" and a failed run with 0 rows.

Every sibling WP/REST scraper already retried (sadin 4x, amlakalahsa 3x); this one uniquely did not.

Pinned BY EXECUTION against an injected failure rather than by reading run.py's source text: a
source-shape assertion would stay green if someone hoisted the retry outside the page loop and broke
pagination, which is the realistic way this regresses.

Run: python -m pytest scrapers/common/tests/test_shmoualshmal_fetch_retry.py -v
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[3]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scrapers.shmoualshmal import run  # noqa: E402

_TIMEOUT = "Failed to perform, curl: (28) Connection timed out after 40002 milliseconds"
ONE_PAGE = [{"id": 1, "title": {"rendered": "شقة"}}]  # < 100 rows, so enumeration ends after it


@pytest.fixture(autouse=True)
def _no_real_backoff(monkeypatch):
    """Keep the unit test instant; the backoff itself is not what is under test."""
    monkeypatch.setattr(run.time, "sleep", lambda *_a, **_k: None)


class _Resp:
    def __init__(self, payload, status=200):
        self._payload, self.status_code = payload, status

    def json(self):
        return self._payload


class _Flaky:
    """Raises on the first N calls the way a bad proxy hop does, then answers normally."""

    def __init__(self, fail_times, payload=ONE_PAGE):
        self.fail_times, self.payload, self.calls = fail_times, payload, 0

    def get(self, url, timeout=None):
        self.calls += 1
        if self.calls <= self.fail_times:
            raise TimeoutError(_TIMEOUT)
        return _Resp(self.payload)


@pytest.mark.parametrize("bad_attempts", [1, 2])
def test_a_recoverable_hop_does_not_lose_the_page(bad_attempts):
    # bad_attempts=1 and =2 are both the real observed shape: the failure was transient, not the
    # source. Before the fix either one returned [] and the run reported the source as empty.
    s = _Flaky(bad_attempts)
    rows = run.fetch_listings(s)
    assert len(rows) == 1, f"a transient hop must be retried, not fatal — got {rows!r}"
    assert s.calls == bad_attempts + 1, f"expected {bad_attempts + 1} attempts, made {s.calls}"


def test_a_genuinely_unreachable_source_still_gives_up_bounded_and_says_why():
    # The retry must not become an unbounded loop against a dead host, and must not let a transport
    # failure masquerade as "the source published nothing" — those are different incidents.
    s = _Flaky(99)
    assert run.fetch_listings(s) == [], "an unreachable source yields no rows"
    assert s.calls == 3, f"must give up after 3 attempts, not loop — made {s.calls}"
    assert "3 attempts" in run.LAST_FETCH_NOTE, run.LAST_FETCH_NOTE
    assert "Timeout" in run.LAST_FETCH_NOTE, (
        f"the note must name the transport failure, not 'no listings': {run.LAST_FETCH_NOTE!r}")


def test_a_deliberate_non_200_is_a_hard_stop_and_is_not_retried():
    # 403/503 is the source answering us on purpose. Retrying it would hammer them and still be
    # wrong, so the retry must cover EXCEPTIONS only — never a status the source chose to return.
    calls = []

    class _Blocked:
        def get(self, url, timeout=None):
            calls.append(url)
            return _Resp(None, status=503)

    assert run.fetch_listings(_Blocked()) == [], "a 503 yields no rows"
    assert len(calls) == 1, f"a deliberate 503 must not be retried — made {len(calls)} calls"
    assert "503" in run.LAST_FETCH_NOTE, f"the status must be recorded: {run.LAST_FETCH_NOTE!r}"


class _Refusing:
    """Answers HTTP `status` on the first N calls (the 2026-10-09 shape: page 1 → 403), then serves."""

    def __init__(self, refuse_times, status=403, payload=ONE_PAGE):
        self.refuse_times, self.status, self.payload, self.calls = refuse_times, status, payload, 0

    def get(self, url, timeout=None):
        self.calls += 1
        if self.calls <= self.refuse_times:
            return _Resp(None, status=self.status)
        return _Resp(self.payload)


@pytest.mark.parametrize("status", [403, 429, 503])
@pytest.mark.parametrize("refusals", [1, 2])
def test_a_refused_page_is_retried_on_a_fresh_session(status, refusals):
    # 2026-10-09: page 1 answered 403 once and the whole run failed as «REST returned no listings»;
    # the automatic re-crawl 14 minutes later read all 6 posts. A refusal must be retried, on a fresh
    # session with the next browser profile, before the walk gives up.
    s = _Refusing(refusals, status)
    rotated: list[int] = []

    def fresh(attempt):
        rotated.append(attempt)
        return s

    rows = run.fetch_listings(s, fresh=fresh)
    assert len(rows) == 1, f"a refused page must be retried — got {rows!r} ({run.LAST_FETCH_NOTE})"
    assert rotated == list(range(1, refusals + 1)), f"each retry needs a fresh session: {rotated}"


def test_a_refusal_that_persists_gives_up_bounded_and_names_the_status():
    s = _Refusing(99, 403)
    assert run.fetch_listings(s, fresh=lambda _a: s) == []
    assert s.calls == 3, f"must give up after 3 attempts — made {s.calls}"
    assert "HTTP 403" in run.LAST_FETCH_NOTE, run.LAST_FETCH_NOTE


def test_a_real_not_found_is_not_retried():
    # 404/400 is an answer, not a refusal: the walk ends on it without burning retries.
    s = _Refusing(99, 400)
    assert run.fetch_listings(s, fresh=lambda _a: s) == []
    assert s.calls == 1, s.calls
