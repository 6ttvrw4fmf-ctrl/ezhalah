"""aqar liveness: a dropped DB connection is retried, not fatal to the shard (2026-10-02).

`scrapers/aqar/liveness.py::_run_with_retry` retried only Postgres 57014. On 2026-10-02 one
`httpx.RemoteProtocolError: <ConnectionTerminated error_code:0 ...>` on a single per-row update
killed aqar_residential shard 7 after 500 reads (and aqar_commercial shard 12 on 2026-09-30), so the
rest of that shard went unchecked for the night. These tests EXECUTE the helper against the exact
exception text production raised.
"""
from __future__ import annotations

import httpx
import pytest

from scrapers.aqar import liveness


@pytest.fixture(autouse=True)
def _no_sleep(monkeypatch):
    monkeypatch.setattr(liveness.time, "sleep", lambda *_: None)


def _flaky(exc, fail_times):
    calls = {"n": 0}

    def fn():
        calls["n"] += 1
        if calls["n"] <= fail_times:
            raise exc
        return "ok"
    return fn, calls


def test_connection_terminated_is_retried():
    exc = httpx.RemoteProtocolError("<ConnectionTerminated error_code:0, last_stream_id:3, additional_data:None>")
    fn, calls = _flaky(exc, 2)
    assert liveness._run_with_retry(fn) == "ok"
    assert calls["n"] == 3


def test_statement_timeout_still_retried():
    fn, calls = _flaky(Exception("{'code': '57014', 'message': 'canceling statement due to statement timeout'}"), 1)
    assert liveness._run_with_retry(fn) == "ok"
    assert calls["n"] == 2


def test_real_error_fails_fast():
    fn, calls = _flaky(Exception("{'code': 'PGRST202', 'message': 'Could not find the function'}"), 1)
    with pytest.raises(Exception):
        liveness._run_with_retry(fn)
    assert calls["n"] == 1


def test_persistent_transient_eventually_raises():
    exc = httpx.RemoteProtocolError("<ConnectionTerminated error_code:0>")
    fn, calls = _flaky(exc, 99)
    with pytest.raises(httpx.RemoteProtocolError):
        liveness._run_with_retry(fn, tries=3)
    assert calls["n"] == 3
