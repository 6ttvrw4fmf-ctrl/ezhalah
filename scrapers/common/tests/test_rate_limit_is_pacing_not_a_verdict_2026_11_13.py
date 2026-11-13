"""A 429 is pacing, never a verdict about a handshake or a walk (2026-11-13).

sakani nightly job 131687422795 (small-sources-sync 43365043857, 04:30 UTC): the sale walk drew HTTP 429 on
page 9, asked for a fresh session, and negotiated_session() spent all six TLS profiles in ~50 s against the
SAME rate limit (every one 429), raised «no TLS profile was served», and that exception escaped the walk:
rows_upserted 0, and the 276 rent units plus 8 sale pages already read were thrown away.

1. negotiated_session() waits out a 429 (Retry-After, bounded) and asks the same profile again.
2. A renewal that still fails after page 1 is a late wall: WalkIncomplete keeps the rows already read.
"""
from __future__ import annotations

import pytest

import scrapers.common.http as http
import scrapers.sakani.run as SKN


class _R:
    def __init__(self, code, headers=None):
        self.status_code = code
        self.headers = headers or {}


def _fake_sessions(monkeypatch, answers):
    """Every Session.get pops the next status from `answers` (shared across profiles)."""
    calls = []

    class S:
        def __init__(self, impersonate=None, proxies=None):
            self.prof = impersonate
            self.headers = {}

        def get(self, url, timeout=None):
            code = answers.pop(0)
            calls.append((self.prof, code))
            return _R(code, {"retry-after": "7"} if code == 429 else {})

    monkeypatch.setattr(http.cc, "Session", S)
    slept = []
    monkeypatch.setattr(http, "_sleep", lambda s: slept.append(s))
    return calls, slept


def test_429_is_waited_out_on_the_same_profile(monkeypatch):
    calls, slept = _fake_sessions(monkeypatch, [429, 429, 200])
    s = http.negotiated_session("https://x.test/p", order=("safari17_0", "chrome"))
    assert s._impersonate_profile == "safari17_0"
    assert [c[0] for c in calls] == ["safari17_0"] * 3
    assert slept == [7.0, 7.0]                       # the host's Retry-After, honoured


def test_a_403_still_moves_to_the_next_profile_at_once(monkeypatch):
    calls, slept = _fake_sessions(monkeypatch, [403, 200])
    s = http.negotiated_session("https://x.test/p", order=("safari17_0", "chrome"))
    assert s._impersonate_profile == "chrome" and slept == []


def test_a_rate_limit_that_never_lifts_still_raises_and_says_so(monkeypatch):
    calls, slept = _fake_sessions(monkeypatch, [429] * 6)
    with pytest.raises(RuntimeError, match=r"after 2 rate-limit waits"):
        http.negotiated_session("https://x.test/p", order=("safari17_0", "chrome"))
    assert len(slept) == 4


def test_retry_after_is_bounded():
    assert http._retry_after_s(_R(429, {"retry-after": "9999"})) == http.RATE_LIMIT_MAX_S
    assert http._retry_after_s(_R(429, {})) == http.RATE_LIMIT_DEFAULT_S
    assert http._retry_after_s(_R(429, {"retry-after": "Wed, 21 Oct"})) == http.RATE_LIMIT_DEFAULT_S


def test_a_failed_renewal_after_page_one_keeps_the_rows_read(monkeypatch):
    pages = {1: 200, 2: 200}

    def fetch_json(s, url, params=None, **kw):
        n = params["page[number]"]
        if n in pages:
            data = [{"id": f"u{n}{i}", "attributes": {}} for i in range(SKN.PAGE_SIZE)]
            return 200, {"data": data, "meta": {"first_page": {"data": data}}}
        return None                                   # page 3: the wall

    def renew():
        raise RuntimeError("no TLS profile was served by … (last safari15_5:HTTP 429)")

    monkeypatch.setattr(SKN, "fetch_json", fetch_json)
    monkeypatch.setattr(SKN, "_walk_renew", renew)
    monkeypatch.setattr(SKN.time, "sleep", lambda s: None)
    with pytest.raises(SKN.WalkIncomplete) as ei:
        SKN.enumerate_catalogue(object(), "sale")
    assert len(ei.value.units) == 2 * SKN.PAGE_SIZE
    assert "fresh session failed" in str(ei.value)


def test_a_failed_renewal_on_page_one_still_fails_the_run(monkeypatch):
    monkeypatch.setattr(SKN, "fetch_json", lambda *a, **k: None)
    monkeypatch.setattr(SKN, "_walk_renew", lambda: (_ for _ in ()).throw(RuntimeError("walled")))
    monkeypatch.setattr(SKN.time, "sleep", lambda s: None)
    with pytest.raises(RuntimeError, match="walled") as ei:
        SKN.enumerate_catalogue(object(), "sale")
    assert not isinstance(ei.value, SKN.WalkIncomplete)
