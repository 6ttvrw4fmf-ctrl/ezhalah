"""A retried scrape_runs INSERT must not create a twin (2026-08-10 senior audit, run #8).

THE DEFECT
----------
`db._execute` retries transient DB errors, and its docstring justified that with "upserts/selects/
updates here are idempotent, so retrying is safe". `begin_run()` routed a bare INSERT through it.
An INSERT with no conflict key is NOT idempotent: PostgREST can fail the RESPONSE (522 / timeout /
connection reset) after the server already COMMITTED the row, and the retry then inserts a second
one. The caller keeps the second id, so the first row is orphaned at ok=NULL / rows_seen=0 forever
— a phantom "killed run" that raises a false P1 `dangling_scrape_run` on a perfectly healthy
platform.

PROOF IT HAPPENED (not hypothetical): production scrape_runs 26326 and 26327 both carry
started_at = 2026-08-10 00:09:56.826524+00 — identical to the MICROSECOND. Two independent shard
processes cannot produce that; two attempts at the SAME payload must, because started_at is
generated once client-side and re-sent verbatim on retry. 26327 finished ok with 468 rows; 26326
dangles. The same infra wobble also made pg_cron report `job startup timeout` on four unrelated
jobs at 00:10:00.

These tests EXECUTE the real `_begin_run_idempotent` against a stubbed Supabase client, so they
prove behaviour rather than pinning source text.

Run: python -m pytest scrapers/common/tests/test_begin_run_insert_idempotent.py
"""
from __future__ import annotations

import sys
from pathlib import Path
from typing import Any

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

from scrapers.common import db  # noqa: E402


class _Result:
    def __init__(self, data: list[dict[str, Any]]) -> None:
        self.data = data


class _FakeTable:
    """Minimal PostgREST-shaped stub backed by an in-memory `rows` list."""

    def __init__(self, store: "_FakeSupabase") -> None:
        self.store = store
        self._filters: dict[str, Any] = {}
        self._payload: dict[str, Any] | None = None
        self._mode = ""

    def insert(self, payload: dict[str, Any]) -> "_FakeTable":
        self._mode, self._payload = "insert", payload
        return self

    def select(self, *_cols: str) -> "_FakeTable":
        self._mode = "select"
        return self

    def eq(self, col: str, val: Any) -> "_FakeTable":
        self._filters[col] = val
        return self

    def limit(self, _n: int) -> "_FakeTable":
        return self

    def execute(self) -> _Result:
        if self._mode == "insert":
            self.store.insert_attempts += 1
            # The server COMMITS the row, then the response fails for the first N attempts —
            # exactly the window that produced the production duplicate.
            row = dict(self._payload or {})
            row["id"] = self.store.next_id
            self.store.next_id += 1
            self.store.rows.append(row)
            if self.store.insert_attempts <= self.store.fail_first_n_responses:
                raise RuntimeError("HTTPStatusError: 522 server disconnected")
            return _Result([{"id": row["id"]}])

        matched = [r for r in self.store.rows if all(r.get(k) == v for k, v in self._filters.items())]
        return _Result([{"id": r["id"]} for r in matched[:1]])


class _FakeSupabase:
    def __init__(self, *, fail_first_n_responses: int = 0, probe_raises: bool = False) -> None:
        self.rows: list[dict[str, Any]] = []
        self.next_id = 1000
        self.insert_attempts = 0
        self.fail_first_n_responses = fail_first_n_responses
        self.probe_raises = probe_raises

    def table(self, name: str) -> _FakeTable:
        assert name == "scrape_runs"
        t = _FakeTable(self)
        if self.probe_raises:
            original_execute = t.execute

            def execute() -> _Result:
                if t._mode == "select":
                    raise RuntimeError("probe blew up")
                return original_execute()

            t.execute = execute  # type: ignore[method-assign]
        return t


@pytest.fixture(autouse=True)
def _no_sleep(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(db.time, "sleep", lambda _s: None)


def _run(fake: _FakeSupabase, monkeypatch: pytest.MonkeyPatch) -> int:
    monkeypatch.setattr(db, "sb", lambda: fake)
    return db._begin_run_idempotent("aqar_residential")


def test_happy_path_inserts_exactly_one_row(monkeypatch: pytest.MonkeyPatch) -> None:
    fake = _FakeSupabase()
    run_id = _run(fake, monkeypatch)
    assert len(fake.rows) == 1, "a clean begin_run must insert exactly one row"
    assert run_id == fake.rows[0]["id"]
    assert fake.insert_attempts == 1


def test_committed_row_is_adopted_not_duplicated(monkeypatch: pytest.MonkeyPatch) -> None:
    """THE REGRESSION. Response fails after the commit — the retry must adopt, not insert a twin."""
    fake = _FakeSupabase(fail_first_n_responses=1)
    run_id = _run(fake, monkeypatch)

    assert len(fake.rows) == 1, (
        f"expected the committed row to be adopted, but {len(fake.rows)} rows exist — this is the "
        "26326/26327 duplicate that dangles at ok=NULL forever and raises a false P1"
    )
    assert fake.insert_attempts == 1, "the insert must not be re-issued once the row is known to exist"
    assert run_id == fake.rows[0]["id"], "the caller must receive the id of the row that actually exists"


def test_no_two_rows_ever_share_a_started_at(monkeypatch: pytest.MonkeyPatch) -> None:
    """The production signature: identical client-side started_at across two rows."""
    fake = _FakeSupabase(fail_first_n_responses=2)
    _run(fake, monkeypatch)
    stamps = [r["started_at"] for r in fake.rows]
    assert len(stamps) == len(set(stamps)), (
        f"two scrape_runs rows share a started_at ({stamps}) — the exact production fingerprint"
    )


def test_falls_back_to_retrying_when_the_probe_itself_fails(monkeypatch: pytest.MonkeyPatch) -> None:
    """A broken probe must never stop a scrape from starting — worst case, retry as before."""
    fake = _FakeSupabase(fail_first_n_responses=1, probe_raises=True)
    run_id = _run(fake, monkeypatch)
    assert run_id in [r["id"] for r in fake.rows]
    assert fake.insert_attempts == 2, "with no usable probe the insert is retried, as it was before"


def test_non_transient_error_still_raises_immediately(monkeypatch: pytest.MonkeyPatch) -> None:
    class _Boom(_FakeSupabase):
        def table(self, name: str) -> _FakeTable:
            t = super().table(name)

            def execute() -> _Result:
                raise RuntimeError("permission denied for table scrape_runs")

            t.execute = execute  # type: ignore[method-assign]
            return t

    monkeypatch.setattr(db, "sb", lambda: _Boom())
    with pytest.raises(RuntimeError, match="permission denied"):
        db._begin_run_idempotent("aqar_residential")


def test_execute_docstring_no_longer_claims_bare_inserts_are_safe() -> None:
    """The false premise that caused this bug must not creep back into the helper's contract."""
    doc = db._execute.__doc__ or ""
    assert "NOT SAFE for a bare INSERT" in doc, (
        "_execute's docstring must keep warning that retrying a keyless INSERT can duplicate a row"
    )
