"""A broken pipe on the REQUEST write must be RETRIED, not treated as a fatal bug. (2026-09-03.)

THE DEFECT
----------
Ingesting the new arkaan platform, a full crawl of 1,072 listings died on the write with:

    httpx.WriteError: [Errno 32] Broken pipe

689 rows had already been upserted; the rest were lost and the run reported failure. `_execute`
retries only when the message matches `db._TRANSIENT_MARKERS`, and "[Errno 32] Broken pipe" matches
NONE of them — not "connection", not "reset by peer", not "server disconnected", not "eof". So the
most ordinary transient socket failure there is was classified permanent and re-raised on the FIRST
attempt, throwing away an hour of crawling.

A broken pipe means the socket closed while the request body was still being written. It says
nothing about the data and nothing about the server's health — it is transient by construction, in
exactly the same family as the "reset by peer" marker that was already there.

WHY RETRYING IS SAFE HERE
-------------------------
Every caller of `_execute` is idempotent: `_wasalt_batch` upserts `on_conflict="ad_number"`, and the
one non-idempotent insert in the module (`scrape_runs`) deliberately bypasses `_execute` via
`_begin_run_idempotent`. A broken pipe can also fire AFTER the server committed — with an upsert
that is a harmless no-op rather than a duplicate, which is precisely why the docstring on `_execute`
restricts it to idempotent statements.

WHAT THIS PINS, BOTH DIRECTIONS
-------------------------------
  * broken pipe / httpx.WriteError ⇒ transient (retried).
  * A genuine schema/permission/constraint error must STILL fail fast — a retry loop on a real bug
    just delays the diagnosis by five backoffs. PGRST204 (column not in the schema cache) is the
    live example: it is what a scraper writing a non-existent column raises, and it must stay fatal.

Run: python -m pytest scrapers/common/tests/test_broken_pipe_is_transient.py -v
"""
from __future__ import annotations

import sys
import types
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

# db.py imports supabase/dotenv at module scope; stub what is missing so this test stays hermetic.
for name, attrs in (
    ("supabase", {"create_client": lambda *a, **k: None, "Client": object}),
    ("dotenv", {"load_dotenv": lambda *a, **k: None}),
):
    if name not in sys.modules:
        mod = types.ModuleType(name)
        for k, v in attrs.items():
            setattr(mod, k, v)
        sys.modules[name] = mod

from scrapers.common import db  # noqa: E402


def _classify(message: str) -> bool:
    """Exactly the predicate _execute uses to decide retry vs re-raise."""
    msg = message.lower()
    return any(m in msg for m in db._TRANSIENT_MARKERS)


def test_broken_pipe_is_transient():
    # The verbatim string that lost the arkaan run.
    assert _classify("[Errno 32] Broken pipe")
    assert _classify("httpx.WriteError: [Errno 32] Broken pipe")
    # httpx names the class WriteError; catch it with or without the space.
    assert _classify("WriteError")
    assert _classify("write error while sending request")


def test_real_bugs_still_fail_fast():
    # PGRST204 = the scraper wrote a column that does not exist. Retrying cannot help, and this is
    # the exact error the arkaan row-shape bug raised, so it must stay fatal.
    assert not _classify(
        "{'code': 'PGRST204', 'message': \"Could not find the 'city_ar' column of "
        "'arkaan_residential_listings' in the schema cache\"}")
    # Constraint / permission / ambiguity errors are real bugs too.
    assert not _classify("duplicate key value violates unique constraint")
    assert not _classify("permission denied for table aqar_residential_listings")
    assert not _classify(
        "{'code': 'PGRST203', 'message': 'Could not choose the best candidate function'}")


def test_the_marker_family_is_intact():
    """The pre-existing transient markers must keep working — this change only ADDS."""
    for msg in ("HTTP 522", "connection reset by peer", "server disconnected",
                "request timed out", "PGRST002 Could not query the database for the schema cache"):
        assert _classify(msg), msg


def test_execute_actually_retries_a_broken_pipe():
    """Executed, not just classified: _execute must call through again after a broken pipe."""
    calls = {"n": 0}

    class _Q:
        def execute(self):
            calls["n"] += 1
            if calls["n"] == 1:
                raise RuntimeError("[Errno 32] Broken pipe")
            return "ok"

    real_sleep = db.time.sleep
    db.time.sleep = lambda *_a, **_k: None  # no real backoff in tests
    try:
        assert db._execute(_Q(), what="test") == "ok"
    finally:
        db.time.sleep = real_sleep
    assert calls["n"] == 2, f"expected one retry, got {calls['n']} call(s)"


def test_execute_does_not_retry_a_real_bug():
    calls = {"n": 0}

    class _Q:
        def execute(self):
            calls["n"] += 1
            raise RuntimeError("PGRST204 Could not find the 'city_ar' column")

    try:
        db._execute(_Q(), what="test")
        raised = False
    except RuntimeError:
        raised = True
    assert raised, "a schema error must propagate"
    assert calls["n"] == 1, f"must fail fast, but retried {calls['n']} times"
