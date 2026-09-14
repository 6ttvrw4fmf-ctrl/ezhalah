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
