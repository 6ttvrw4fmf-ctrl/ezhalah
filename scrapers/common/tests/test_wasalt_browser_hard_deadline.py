"""One wasalt browser check can never stall a liveness job (ops_incident #708, 2026-09-25).

new_page(), page.content() and page.close() take no timeout, and Playwright's sync driver is bound to
its starting thread, so a watchdog thread cannot interrupt a stuck call. BoundedBrowserFetcher runs
the browser in a forked child and waits on a pipe with a deadline. These tests EXECUTE it against a
child that really hangs, really raises and really dies, and check that:

  * the call returns within the deadline as "no parseable answer" (None, None, 0);
  * liveness maps that to 'failed', never 'dead';
  * the stuck process is gone, and the next call runs in a fresh one;
  * the deadline can never be shorter than the fetcher's own worst-case retry ladder.
"""
from __future__ import annotations

import os
import threading
import time

import pytest

from scrapers.wasalt import browser as B

ALIVE = ({"props": {"pageProps": {"propertyDetailsV3": {"id": 1}}}}, 200, 326339)
GONE = ({"props": {"pageProps": {}}, "page": "/404"}, 404, 211272)
DEADLINE = 1.5


class _Scripted:
    """Same contract as BrowserFetcher.page_data; the URL's last path segment picks the behaviour."""

    def page_data(self, url):
        tail = url.rsplit("/", 1)[-1]
        if tail == "hang":
            time.sleep(3600)
        if tail == "raise":
            raise RuntimeError("Target page, context or browser has been closed")
        if tail == "die":
            os._exit(1)
        return GONE if tail == "gone" else ALIVE

    def close(self):
        pass


@pytest.fixture
def fetcher():
    f = B.BoundedBrowserFetcher(factory=_Scripted, deadline_s=DEADLINE)
    yield f
    f.close()


def within(limit_s: float, fn):
    """Run fn on a helper thread; FAIL (never hang the suite) if it has not returned in limit_s."""
    box: dict = {}
    t = threading.Thread(target=lambda: box.setdefault("v", fn()), daemon=True)
    t.start()
    t.join(limit_s)
    assert not t.is_alive(), f"still blocked after {limit_s:.0f}s — the deadline did not fire"
    return box["v"]


def _gone(pid: int) -> bool:
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return True
    return False


def test_answers_pass_through_unchanged(fetcher):
    assert fetcher.page_data("https://wasalt.sa/en/property/ok") == ALIVE
    assert fetcher.page_data("https://wasalt.sa/en/property/gone") == GONE
    assert fetcher.deadline_kills == 0 and fetcher.child_failures == 0


def test_a_hung_call_returns_no_answer_within_the_deadline(fetcher):
    fetcher.page_data("https://wasalt.sa/en/property/ok")
    stuck_pid = fetcher._proc.pid
    out = within(DEADLINE + 10, lambda: fetcher.page_data("https://wasalt.sa/en/property/hang"))
    assert out == (None, None, 0)
    assert fetcher.deadline_kills == 1
    assert _gone(stuck_pid), "the stuck browser process was left running"


def test_the_call_after_a_hang_runs_in_a_fresh_process(fetcher):
    within(DEADLINE + 10, lambda: fetcher.page_data("https://wasalt.sa/en/property/hang"))
    assert fetcher.page_data("https://wasalt.sa/en/property/ok") == ALIVE
    assert fetcher.page_data("https://wasalt.sa/en/property/gone") == GONE


def test_a_raise_is_no_answer_and_the_next_call_gets_a_fresh_browser(fetcher):
    fetcher.page_data("https://wasalt.sa/en/property/ok")
    first = fetcher._proc.pid
    assert fetcher.page_data("https://wasalt.sa/en/property/raise") == (None, None, 0)
    assert fetcher.child_failures == 1
    assert fetcher.page_data("https://wasalt.sa/en/property/ok") == ALIVE
    assert fetcher._proc.pid != first, "a browser that raised was reused"


def test_a_process_that_dies_mid_call_is_no_answer_not_a_crash(fetcher):
    assert fetcher.page_data("https://wasalt.sa/en/property/die") == (None, None, 0)
    assert fetcher.child_failures == 1
    assert fetcher.page_data("https://wasalt.sa/en/property/ok") == ALIVE


def test_close_leaves_no_process_behind():
    f = B.BoundedBrowserFetcher(factory=_Scripted, deadline_s=DEADLINE)
    f.page_data("https://wasalt.sa/en/property/ok")
    pid = f._proc.pid
    f.close()
    assert f._proc is None and _gone(pid)


def test_deadline_never_cuts_a_healthy_retry_ladder_short(monkeypatch):
    monkeypatch.delenv("WASALT_BROWSER_HARD_DEADLINE_S", raising=False)
    assert B.hard_deadline_s() > B.ladder_budget_s()
    before = B.ladder_budget_s()
    monkeypatch.setattr(B, "_ATTEMPTS", B._ATTEMPTS + 2)
    assert B.ladder_budget_s() > before, "the deadline no longer follows the ladder it bounds"
    assert B.hard_deadline_s() > B.ladder_budget_s()


def test_deadline_override(monkeypatch):
    monkeypatch.setenv("WASALT_BROWSER_HARD_DEADLINE_S", "42")
    assert B.hard_deadline_s() == 42.0
    assert B.BoundedBrowserFetcher().deadline_s == 42.0


# ── through liveness, the module that turns an answer into a strike ──────────────────────────────

def test_liveness_uses_the_bounded_fetcher(monkeypatch):
    from scrapers.wasalt import liveness as L
    monkeypatch.setattr(L, "_BROWSER", None)
    got = L._browser()
    assert isinstance(got, B.BoundedBrowserFetcher), type(got)
    assert got._proc is None, "building the fetcher must not start a browser"


def test_a_hung_listing_is_failed_never_dead_and_the_sweep_continues(monkeypatch, fetcher):
    from scrapers.wasalt import liveness as L
    monkeypatch.setenv("WASALT_BROWSER", "1")
    monkeypatch.setattr(L, "_throttle", lambda: None)
    monkeypatch.setattr(L, "_BROWSER", fetcher)
    rows = [("wasalt_residential_listings", 1, "https://wasalt.sa/en/property/ok", 3),
            ("wasalt_residential_listings", 2, "https://wasalt.sa/en/property/hang", 3),
            ("wasalt_residential_listings", 3, "https://wasalt.sa/en/property/gone", 3),
            ("wasalt_residential_listings", 4, "https://wasalt.sa/en/property/raise", 3),
            ("wasalt_residential_listings", 5, "https://wasalt.sa/en/property/ok", 3)]
    out = within(DEADLINE + 20, lambda: L._pmap(L.check_hybrid, rows, 1))
    assert [(r[1], r[3]) for r in out] == [(1, "live"), (2, "failed"), (3, "dead"),
                                           (4, "failed"), (5, "live")], out
    assert L._browser_deadline_kills() == 1
