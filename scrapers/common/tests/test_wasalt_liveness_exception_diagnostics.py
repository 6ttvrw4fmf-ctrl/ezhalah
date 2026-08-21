"""Regression test: wasalt liveness must not silently discard the real exception on a 'failed'
verdict (alert_event 507, 2026-08-21).

head_status()/get_verdict() used a bare `except Exception:` on every retry attempt, so a listing
stuck perpetually "failed" (alert_event 507's 7-row batch) left NOTHING in the logs to say
whether the underlying cause was a timeout, a TLS/connection reset, or something route-specific —
`_note_exc()` records the exception TYPE the first time each (call-site, type) pair is seen in a
process, without flooding logs on every one of a shard's rows hitting the same known issue, and
without ever printing the URL (may carry query params / listing identifiers).

This does not change any liveness VERDICT or timing behavior — it is purely diagnostic.

Run: python -m pytest scrapers/common/tests/test_wasalt_liveness_exception_diagnostics.py -v
"""
from __future__ import annotations

import sys

sys.path.insert(0, ".")

import scrapers.wasalt.liveness as liveness  # noqa: E402


def test_note_exc_logs_once_per_where_and_kind(capsys):
    liveness._seen_exc_kinds.clear()
    liveness._note_exc("head_status", TimeoutError("boom"))
    liveness._note_exc("head_status", TimeoutError("boom again, different message"))  # same (where, kind) -> suppressed
    liveness._note_exc("head_status", ConnectionError("reset"))                        # different kind -> logged
    liveness._note_exc("get_verdict", TimeoutError("boom"))                            # different where -> logged

    err = capsys.readouterr().err
    assert err.count("TimeoutError") == 2   # once for head_status, once for get_verdict — never a 3rd
    assert "ConnectionError" in err
    assert err.count("boom again") == 0, "the second call for an already-seen (where, kind) must not print"


def test_head_status_reports_the_real_exception_on_final_failure(monkeypatch, capsys):
    liveness._seen_exc_kinds.clear()

    class FakeSession:
        def head(self, *a, **k):
            raise TimeoutError("connect timed out")

    monkeypatch.setattr(liveness, "_session", lambda: FakeSession())
    monkeypatch.setattr(liveness, "_throttle", lambda: None)
    monkeypatch.setattr(liveness, "_backoff", lambda attempt: None)

    result = liveness.head_status("https://wasalt.sa/en/property/x-1", tries=2)
    assert result is None  # unchanged pre-existing return value
    assert "TimeoutError" in capsys.readouterr().err


def test_get_verdict_reports_the_real_exception_on_final_failure(monkeypatch, capsys):
    liveness._seen_exc_kinds.clear()

    class FakeSession:
        def get(self, *a, **k):
            raise ConnectionResetError("connection reset by peer")

    monkeypatch.setattr(liveness, "_session", lambda: FakeSession())
    monkeypatch.setattr(liveness, "_throttle", lambda: None)
    monkeypatch.setattr(liveness, "_backoff", lambda attempt: None)

    verdict, status, nbytes = liveness.get_verdict("https://wasalt.sa/en/property/x-1", tries=2)
    assert (verdict, status, nbytes) == ("failed", 0, 0)  # unchanged pre-existing return value
    assert "ConnectionResetError" in capsys.readouterr().err


if __name__ == "__main__":
    import pytest
    sys.exit(pytest.main([__file__, "-v"]))
