"""A dead proxy route must cost souq24 ONE request, not the whole run.

THE INCIDENT (2026-09-24, run 36073310746 — the first run after the owner approved re-enabling the
residential proxy, PR #3900). The proxy was injected and the credentials were fine, yet the run
produced ZERO rows:

    ⚠ browse: sitemap fetch failed after 15.0s: curl: (28) Connection timed out
      harvest: 0/23 browse pages in 45.0s (23 failed, 8 workers, 15s/page) -> 0 seed ids, max id 0
    ⚠ sweep: hit the 2700s budget after 433/1300 ids — abandoning the rest
      fetch failures: transport_Timeout=465

Not a block: individual DataImpulse exit routes die, and this scraper pinned ONE `cc.Session` per
thread in `_local` for the entire run. Once a thread's route died, every later request on that
thread timed out — including all three attempts inside `fetch_one`, which rode the same dead socket
and so turned its retry ladder into three guaranteed timeouts instead of three chances.

The fix is the one already proven on eilmalriyada (PR #4065): on a transport failure, abandon the
SESSION, not just the request, so the next dial gets a fresh route.

These tests execute the SHIPPING functions with a stubbed `cc.Session`, so they fail if someone
removes the rotation or goes back to reusing a dead session across retries.

Run: python -m pytest scrapers/common/tests/test_souq24_rotates_a_dead_proxy_route.py -v
"""
import sys
import threading
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

from scrapers.souq24 import run as sq  # noqa: E402


class _FakeResp:
    def __init__(self, status_code=200, text=""):
        self.status_code = status_code
        self.text = text


class _FakeSession:
    """Counts its own dials so a test can tell a FRESH session from a reused one."""

    made = 0

    def __init__(self, *a, **kw):
        type(self).made += 1
        self.serial = type(self).made
        self.headers = {}
        self.proxies = None
        self.closed = False
        self.gets = []

    def get(self, url, **kw):
        self.gets.append(url)
        # Route 1 is the dead one; every later route answers.
        if self.serial == 1:
            raise TimeoutError("curl: (28) Connection timed out")
        # Shape the SHIPPING parser looks for (REALESTATE_NAME_RE): a non-empty realestate_name
        # assignment is what marks a real, active listing rather than the homepage shell.
        return _FakeResp(200, 'var realestate_name = "فيلا للبيع في الرياض";')

    def close(self):
        self.closed = True


def _reset(monkeypatch):
    _FakeSession.made = 0
    sq._local = threading.local()
    monkeypatch.setattr(sq.cc, "Session", _FakeSession)


def test_a_dead_route_is_abandoned_rather_than_retried_on_the_same_socket(monkeypatch):
    """fetch_one's retries must dial a NEW session after a transport failure.

    Before the fix all three attempts reused one dead session, so a 3-attempt ladder produced
    3 timeouts and the id was recorded as a failure. After it, attempt 2 rides a fresh route and
    the listing is read — which is the difference between 0 rows and a real crawl.
    """
    _reset(monkeypatch)
    monkeypatch.setattr(sq, "_SWEEP_ABORT", threading.Event())
    monkeypatch.setattr(sq.time, "sleep", lambda *_: None)

    got = sq.fetch_one(4242)

    assert _FakeSession.made >= 2, (
        "fetch_one reused the dead session across its retries — a dead DataImpulse route must cost "
        "one request, not the whole ladder"
    )
    assert got is not None and got[0] == 4242, (
        "the retry on a fresh route should have read the listing"
    )


def test_rotate_closes_the_dead_session_and_returns_a_working_one(monkeypatch):
    """The dead socket is closed (not leaked) and the replacement is a different object."""
    _reset(monkeypatch)
    first = sq._session()
    second = sq._rotate_session()

    assert second is not first, "_rotate_session must hand back a NEW session"
    assert first.closed is True, "the dead session must be closed, not leaked"
    assert sq._session() is second, "the fresh session must become this thread's cached one"


def test_rotation_survives_a_session_that_cannot_be_closed(monkeypatch):
    """A curl handle that throws on close() must not take the run down with it."""
    _reset(monkeypatch)

    class _Unclosable(_FakeSession):
        def close(self):
            raise RuntimeError("handle already gone")

    monkeypatch.setattr(sq.cc, "Session", _Unclosable)
    sq._session()
    assert sq._rotate_session() is not None, "a failing close() must not abort the rotation"


def test_the_proxy_is_reapplied_to_every_fresh_session(monkeypatch):
    """A rotated session that forgot the proxy would go out on the datacenter IP, which this source
    answers with a listing-less shell — a silent wrong answer, worse than the timeout."""
    _reset(monkeypatch)
    monkeypatch.setattr(sq, "_PROXIES", {"http": "http://x", "https": "http://x"})

    sq._session()
    fresh = sq._rotate_session()

    assert fresh.proxies == {"http": "http://x", "https": "http://x"}, (
        "a rotated session must carry the residential proxy; without it 24.com.sa serves the shell"
    )
