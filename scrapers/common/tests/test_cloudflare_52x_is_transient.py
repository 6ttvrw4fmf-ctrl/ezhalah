"""A Cloudflare origin error is a hiccup, not a dead page.

WHAT THIS LOCKS OUT (2026-08-26 senior audit).

scrapers/common/http.get() retried 429/502/503/504 and treated everything else as permanent.
The Cloudflare edge-to-origin family — 520/521/522/523/524/530 — was NOT in that set, even though
it means precisely "the edge is fine, it just could not reach the origin", which is the same
transient shape as 502/503/504. Most sources here sit behind Cloudflare.

The cost was measured, not hypothetical. ramzalqasim.com's origin flaps: probing /maps from two
unrelated networks returned 200,200 / 200,522 / 200,200. On 2026-08-26 the scheduled run drew a
522 on PAGE 1 of the marker walk. fetch_markers did a single unretried GET and `break`s on any
non-200, so it printed "no markers — site may have changed" and returned 1 BEFORE db.begin_run()
— no scrape_runs row was ever written. The platform vanished from the day's data with nothing
recording why, and the alert that would eventually notice (silent_scraper_death) needs 48h.
A re-dispatch reproduced it exactly: Actions run 32940436435, 48 seconds, "page 1 HTTP 522".

Two things are asserted here, and the second matters as much as the first:
  1. the transient set covers the Cloudflare family AND still covers the original four;
  2. a genuine 404/permanent error is still permanent — retrying must not become "retry forever",
     and _fetch_page must still eventually give up so the caller's fail-safe (no run row, no
     prune, no inactivation) is reached unchanged.
"""
from __future__ import annotations

import sys
import types
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

from scrapers.common.http import TRANSIENT_STATUSES


CLOUDFLARE_ORIGIN_ERRORS = (520, 521, 522, 523, 524, 530)
ALREADY_COVERED = (429, 502, 503, 504)


@pytest.mark.parametrize("status", CLOUDFLARE_ORIGIN_ERRORS)
def test_cloudflare_origin_errors_are_transient(status):
    assert status in TRANSIENT_STATUSES, (
        f"HTTP {status} is a Cloudflare edge-to-origin error — the origin was unreachable or slow, "
        "not the page missing. Dropping it from TRANSIENT_STATUSES re-opens the 2026-08-26 "
        "ramzalqasim outage where one 522 on page 1 cost the whole platform for a day."
    )


@pytest.mark.parametrize("status", ALREADY_COVERED)
def test_original_transient_statuses_still_covered(status):
    """The 2026-08-26 change ADDED to this set. Losing any of the original four is a regression."""
    assert status in TRANSIENT_STATUSES


@pytest.mark.parametrize("status", (400, 401, 403, 404, 410, 451, 500))
def test_permanent_statuses_are_not_retried(status):
    """Retrying a 404 forever would turn a dead listing into an infinite loop. 500 is deliberately
    excluded too: it is an application error from the origin itself, not an edge-reachability
    blip, and the fleet has always treated it as permanent."""
    assert status not in TRANSIENT_STATUSES


# ---------------------------------------------------------------------------
# ramzalqasim's marker walk: the caller that actually broke.
# ---------------------------------------------------------------------------

class _Resp:
    def __init__(self, status_code: int, text: str = "ok"):
        self.status_code = status_code
        self.text = text


class _FakeSession:
    """Replays a scripted list of statuses/exceptions and records how many GETs it saw."""

    def __init__(self, script):
        self.script = list(script)
        self.calls = 0

    def get(self, url, timeout=None, **kw):
        self.calls += 1
        item = self.script.pop(0) if self.script else _Resp(200)
        if isinstance(item, Exception):
            raise item
        return item


@pytest.fixture()
def rq(monkeypatch):
    """Import the ramzalqasim module with sleeping and throttling neutered."""
    mod = pytest.importorskip("scrapers.ramzalqasim.run")
    monkeypatch.setattr(mod.time, "sleep", lambda *_: None)
    monkeypatch.setattr(mod, "_throttle", lambda *a, **k: None)
    return mod


def test_page_fetch_recovers_from_a_transient_522(rq):
    """THE REAL 2026-08-26 CASE: 522 then 200. Before the fix this returned None on the first 522
    and the entire run aborted with zero listings."""
    s = _FakeSession([_Resp(522), _Resp(200, "payload")])
    r = rq._fetch_page(s, 1)
    assert r is not None and r.status_code == 200
    assert s.calls == 2, "the 522 must be retried, not accepted as the final answer"


def test_page_fetch_recovers_from_a_raised_connection_error(rq):
    s = _FakeSession([ConnectionError("Recv failure: Connection reset by peer"), _Resp(200)])
    r = rq._fetch_page(s, 1)
    assert r is not None and r.status_code == 200
    assert s.calls == 2


def test_page_fetch_gives_up_on_a_persistent_522_and_stays_bounded(rq):
    """A real outage must still end in None so the caller's fail-safe runs — and must not spin."""
    s = _FakeSession([_Resp(522)] * 200)
    assert rq._fetch_page(s, 1) is None
    assert s.calls == rq.MARKER_FETCH_ATTEMPTS, "retries must be bounded"


def test_retry_budget_is_sane_in_absolute_terms():
    """The bound must be a real number, not just self-consistent.

    Caught by mutation testing: asserting only `calls == MARKER_FETCH_ATTEMPTS` passes happily
    when someone raises the constant to 50, because the assertion follows the constant. With the
    2*attempt backoff, 50 attempts is ~42 minutes of sleeping PER PAGE across a 12-page walk —
    which would blow the 90-minute small-sources timeout and turn a brief origin blip into a
    cancelled job, the very outcome this fix exists to prevent.
    """
    mod = pytest.importorskip("scrapers.ramzalqasim.run")
    attempts = mod.MARKER_FETCH_ATTEMPTS
    assert 2 <= attempts <= 6, (
        f"MARKER_FETCH_ATTEMPTS={attempts}: fewer than 2 is no retry at all; more than 6 spends "
        "longer sleeping than the walk can afford."
    )
    worst_case_sleep = sum(2 * a for a in range(1, attempts))
    assert worst_case_sleep <= 60, (
        f"worst-case backoff per page is {worst_case_sleep}s — too much for a 12-page walk"
    )


def test_page_fetch_does_not_retry_a_permanent_404(rq):
    s = _FakeSession([_Resp(404), _Resp(200)])
    assert rq._fetch_page(s, 1) is None
    assert s.calls == 1, "a 404 is permanent — retrying it wastes the budget a real blip needs"


def test_fetch_markers_survives_a_transient_522_on_page_one(rq):
    """End to end through the caller: page 1 flaps once, then serves an empty payload. The walk
    must reach the payload rather than aborting the whole platform."""
    s = _FakeSession([_Resp(522), _Resp(200, "no markers here")])
    out = rq.fetch_markers(s, max_pages=1)
    assert out == []           # no markers in that body — the point is it got there at all
    assert s.calls == 2
