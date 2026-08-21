"""Regression test for the 2026-08-21 wasalt burst-concurrency incident.

ROOT CAUSE (evidence in the fix PR / ops report): scrape_runs showed wasalt's daily failure rate
step-changing from ~0% to 57.8-67.6% starting 2026-08-17. Every failing run timed at a near-
constant 204.2-204.7s while runs in the SAME dispatch batch that succeeded took 5-37s. The math
(30s curl_cffi timeout x 3 retries x 2 fetch_page() call sites, plus backoff) proved every failing
attempt hung the FULL 30s timeout with no response, six times in a row, never once succeeding.

The bug: `session()` created ONE curl_cffi Session (and its underlying TCP connection / proxy
tunnel) per process, and `fetch_page()`'s retry loop reused that SAME session object across all 3
attempts. Through the shared Webshare Saudi-residential proxy, wasalt-residential-sweep.yml and
wasalt-commercial-sweep.yml both dispatch 14-20 fully parallel jobs against ONE proxy secret with
no `max-parallel` cap — so once an attempt landed on a bad/overloaded exit route through the proxy
pool, every retry stayed pinned to that exact same bad route and was guaranteed to fail identically
three more times. There was never a chance for a retry to route differently.

The fix: `RotatingSession.rotate()` discards the current curl_cffi Session and builds a fresh one
(fresh TCP handshake, fresh proxy-gateway negotiation) between failed attempts, so a retry actually
gets a shot at a different route instead of repeating the same one.

This test proves the ROTATION BEHAVIOUR ITSELF (not the network) with curl_cffi's `.get` monkey-
patched to fail deterministically — no real network calls. It is written to be run against BOTH the
old and new code:

  - Against the OLD code (a single cc.Session reused across retries, `fetch_page(s, ...)` where `s`
    is a bare `cc.Session`) this test's `identity_log` will show every attempt on the SAME session
    object — i.e. rotation never happens — and `test_fetch_page_rotates_session_between_failed_attempts`
    FAILS.
  - Against the NEW code (this file's `RotatingSession` + the retry loop calling `s.rotate()` on
    failure) each of the first 2 failed attempts is followed by a fresh, distinct session object
    before the next attempt — and the test PASSES.

Run: python -m pytest scrapers/common/tests/test_wasalt_session_rotation_on_retry.py -v
"""
from __future__ import annotations

import sys
import types

import pytest

from scrapers.wasalt import run as wasalt_run


class _FakeResponse:
    def __init__(self, status_code: int, text: str = ""):
        self.status_code = status_code
        self.text = text


def test_rotate_replaces_the_underlying_session_object():
    """RotatingSession.rotate() must swap in a genuinely new curl_cffi Session, not mutate the
    existing one in place — a retry needs a NEW TCP/proxy handshake, and reusing the same
    connection object (even if its state were reset) would keep the same pooled connection."""
    s = wasalt_run.RotatingSession()
    before = s._s
    s.rotate()
    after = s._s
    assert after is not before, "rotate() must build a fresh session object, not reuse the old one"


def test_fetch_page_rotates_session_between_failed_attempts(monkeypatch):
    """The actual incident scenario: every attempt raises (simulating the full-timeout hang), and
    fetch_page's retry loop must rotate to a distinct session before each subsequent attempt.

    identity_log[i] is the id() of the session `.get` ran on for attempt i. Old, buggy behaviour:
    identity_log == [X, X, X] (same session every time). Fixed behaviour: identity_log == [X, Y, Z]
    (three distinct sessions — one fresh build per retry)."""
    monkeypatch.setattr(wasalt_run.time, "sleep", lambda *_a, **_kw: None)  # don't actually wait
    monkeypatch.setattr(wasalt_run, "_throttle", lambda: None)

    # Keep STRONG references to the actual session objects (not just id()) — a session dropped by
    # rotate() would otherwise get garbage-collected and CPython can hand its freed memory address
    # to the very next object created, making id() reuse look like "the same session" by accident.
    seen_sessions: list = []

    def always_raises(self, *a, **kw):
        seen_sessions.append(self)
        raise ConnectionError("simulated proxy hang / connection reset")

    monkeypatch.setattr(wasalt_run.cc.Session, "get", always_raises, raising=True)

    s = wasalt_run.session()
    result = wasalt_run.fetch_page(s, "sale", "residential", "apartment", 1)

    assert result == (0, 0, [], False), "all attempts failing must surface as an invalid page"
    assert len(seen_sessions) == 3, f"expected exactly 3 attempts, got {len(seen_sessions)}"
    distinct = {id(o) for o in seen_sessions}
    assert len(distinct) == 3, (
        "every retry must run on a DISTINCT session object (rotated on failure) — "
        f"got {len(distinct)} distinct session(s) across 3 attempts, meaning the same connection "
        "was reused across retries (the exact 2026-08-21 incident: a bad proxy route stays pinned "
        "across all 3 attempts)"
    )


def test_fetch_page_rotates_on_non_200_status_too(monkeypatch):
    """A non-200 response (e.g. a proxy-gateway error page) must also trigger rotation before the
    next attempt — not just a raised exception."""
    monkeypatch.setattr(wasalt_run.time, "sleep", lambda *_a, **_kw: None)
    monkeypatch.setattr(wasalt_run, "_throttle", lambda: None)

    seen_sessions: list = []

    def always_502(self, *a, **kw):
        seen_sessions.append(self)
        return _FakeResponse(502)

    monkeypatch.setattr(wasalt_run.cc.Session, "get", always_502, raising=True)

    s = wasalt_run.session()
    wasalt_run.fetch_page(s, "rent", "residential", "villa-townhouse", 1)

    distinct = {id(o) for o in seen_sessions}
    assert len(distinct) == 3, (
        f"non-200 responses must also rotate the session between retries, got "
        f"{len(distinct)} distinct session(s) across {len(seen_sessions)} attempts"
    )


def test_fetch_page_succeeds_without_rotating_when_first_attempt_works(monkeypatch):
    """No regression on the healthy path: a first-attempt success must not rotate or retry at
    all — this proves the fix doesn't add rotation overhead/behaviour change to working runs."""
    monkeypatch.setattr(wasalt_run, "_throttle", lambda: None)
    rotate_calls = []

    next_data = (
        '<script id="__NEXT_DATA__" type="application/json">'
        '{"props":{"pageProps":{"searchResult":{"count":1,"totalPages":1,"properties":[]}}}}'
        "</script>"
    )

    def ok_once(self, *a, **kw):
        return _FakeResponse(200, next_data)

    monkeypatch.setattr(wasalt_run.cc.Session, "get", ok_once, raising=True)

    s = wasalt_run.session()
    orig_rotate = s.rotate
    s.rotate = lambda: (rotate_calls.append(1), orig_rotate())[-1]

    count, total_pages, props, valid = wasalt_run.fetch_page(s, "sale", "residential", "apartment", 1)

    assert valid is True
    assert count == 1
    assert rotate_calls == [], "a first-attempt success must never rotate the session"


if __name__ == "__main__":
    raise SystemExit(pytest.main([__file__, "-v"]))
