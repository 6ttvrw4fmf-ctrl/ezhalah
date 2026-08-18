"""A PostgREST schema-cache outage (PGRST002) must be RETRIED, not treated as a fatal bug.
Its lookalikes PGRST202/PGRST203 must still fail fast. (2026-08-18 senior audit, run #28.)

THE DEFECT
----------
On 2026-08-18 Supabase's PostgREST lost its schema cache for about five minutes (00:05:32-00:10:57).
Every request in that window raised:

    postgrest.exceptions.APIError: {'code': 'PGRST002', 'details': None, 'hint': None,
      'message': 'Could not query the database for the schema cache. Retrying.'}

`db._TRANSIENT_MARKERS` did not match that string, so `db._execute` re-raised on the FIRST attempt
with no backoff. In the aqar residential sweep (GitHub Actions run 32083099544) that killed 12 of 95
shards outright:

  * 10 died inside `begin_run()` — no scrape_runs row was ever inserted, so the shard vanished
    silently from the run record;
  * 2 died inside `end_run()` (thadiq run 30678, dawadmi run 30687) AFTER each had already upserted
    roughly 150 real listings. Because the counters only reach the database in that one final call,
    both rows were left at `ok=NULL, finished_at=NULL, rows_seen=0, rows_upserted=0` and raised a P1
    `dangling_scrape_run` whose text claimed nothing was captured. It had been.

A five-minute transient outage should cost a retry, not a shard. PostgREST's own message ends in
"Retrying." — the error is transient by construction.

WHY THE FIX MATCHES THE CODE AND NOT THE PHRASE
-----------------------------------------------
"schema cache" would have been the tempting marker, and it would be WRONG: PGRST202 ("Could not find
the function ... in the schema cache") and PGRST203 (duplicate overload) both contain that phrase,
and those are the genuine missing-function bugs behind the 2026-07-16 search outage. Retrying them
would delay and muddy a real defect that must surface immediately. So the marker is the code
`pgrst002`, and the test below pins BOTH directions of that distinction.

These tests execute the real `db._execute` against a stub query, so they prove behaviour rather than
pinning source text.

Run: python -m pytest scrapers/common/tests/test_pgrst002_is_transient.py
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

from scrapers.common import db  # noqa: E402


class _APIErrorLike(Exception):
    """Mimics postgrest.exceptions.APIError: str() is the repr of the error dict."""

    def __init__(self, payload: dict) -> None:
        super().__init__(str(payload))


PGRST002 = {"code": "PGRST002", "details": None, "hint": None,
            "message": "Could not query the database for the schema cache. Retrying."}
PGRST202 = {"code": "PGRST202", "details": None, "hint": None,
            "message": "Could not find the function public.foo(bar) in the schema cache"}
PGRST203 = {"code": "PGRST203", "details": None, "hint": None,
            "message": "Could not choose the best candidate function between: public.foo(a), public.foo(b)"}


class _FlakyQuery:
    """Fails with `payload` for the first `fail_times` attempts, then succeeds."""

    def __init__(self, payload: dict, fail_times: int) -> None:
        self.payload = payload
        self.fail_times = fail_times
        self.attempts = 0

    def execute(self):
        self.attempts += 1
        if self.attempts <= self.fail_times:
            raise _APIErrorLike(self.payload)
        return "ok"


@pytest.fixture(autouse=True)
def _no_sleeping(monkeypatch):
    """The retry path sleeps with exponential backoff; keep the test instant."""
    monkeypatch.setattr(db.time, "sleep", lambda _s: None)


def test_pgrst002_is_retried_and_then_succeeds():
    """THE REGRESSION. On the old marker list this raised on attempt 1 and the shard died."""
    q = _FlakyQuery(PGRST002, fail_times=2)
    assert db._execute(q, what="scrape_runs", tries=5) == "ok"
    assert q.attempts == 3, "PGRST002 must be retried until it clears, not re-raised immediately"


def test_pgrst002_still_gives_up_after_the_last_attempt():
    """Retrying must not become retrying forever — a persistent outage still surfaces."""
    q = _FlakyQuery(PGRST002, fail_times=99)
    with pytest.raises(Exception) as exc:
        db._execute(q, what="scrape_runs", tries=3)
    assert "PGRST002" in str(exc.value)
    assert q.attempts == 3, "must attempt exactly `tries` times, then re-raise"


@pytest.mark.parametrize("payload,code", [(PGRST202, "PGRST202"), (PGRST203, "PGRST203")])
def test_schema_cache_lookalikes_still_fail_fast(payload, code):
    """THE OTHER DIRECTION. These carry the words 'schema cache' too, but they are REAL bugs
    (missing function / duplicate overload — the 2026-07-16 search outage class). They must raise
    on the first attempt so the defect surfaces immediately."""
    q = _FlakyQuery(payload, fail_times=99)
    with pytest.raises(Exception) as exc:
        db._execute(q, what="rpc", tries=5)
    assert code in str(exc.value)
    assert q.attempts == 1, f"{code} must NOT be retried — it is a genuine schema bug, not a wobble"


def test_marker_is_the_code_not_the_phrase():
    """Guards the intent directly: a future edit that swaps in the broad phrase would make the
    lookalike test above fail, but this states the rule where the next reader will look."""
    assert "pgrst002" in db._TRANSIENT_MARKERS
    assert "schema cache" not in db._TRANSIENT_MARKERS
