"""Wasalt liveness reads through the BROWSER, and a block can never retire a listing.

THE DEFECT (found 2026-09-19 while repairing 6 dead-but-active rows, migration 20260919010944).
`scrapers/wasalt/liveness.py` is the module that decides whether a wasalt listing is retired, and
its `_session()` was the exact shape wasalt.sa has null-routed since 2026-08-17 (issue #1019):
curl_cffi `impersonate="chrome124"` through the Saudi residential proxy. `run.py` moved to a real
browser in PR #3129 and `enrich_ar.py` in PR #3140 — liveness was the THIRD consumer of the blocked
transport and nothing listed it.

The consequence was not staleness. Every read returned 403/timeout, `get_verdict()` correctly
called that 'failed' (transient, never dead), so no wasalt row could accumulate a strike and NO
DEAD WASALT LISTING COULD EVER BE RETIRED. Six were found active AND in the search index, clickable
straight to a 404, and had to be repaired by hand.

WHAT THIS PINS, and why each one is a real trap rather than a hypothetical:

1. A BLOCK IS NEVER A KILL. `page_data()` returns None for a challenge shell, a dead proxy exit and
   a navigation timeout alike. If that mapped to 'dead', a single blocked run would strike every
   row it touched and, at grace, deactivate live inventory in bulk. This is the worst thing this
   module can do and it is one wrong branch away.

2. THE STATUS IS LOAD-BEARING AND NOT REDUNDANT WITH THE PAYLOAD. Measured 2026-09-19 through a
   headed Chromium: a DEAD listing answers HTTP 404 with a perfectly parseable __NEXT_DATA__
   (`page:"/404"`, propertyDetailsV3 null, 211KB); a LIVE one answers 200 with the payload (326KB).
   So "we got a parsed dict" cannot decide anything on its own — a 404 carries one too.

3. workers==1 RUNS INLINE, NOT IN A POOL OF ONE. Playwright's sync driver is bound to its starting
   thread and this module maps over rows from four separate call sites, each opening a fresh
   executor. A pool of one looks single-threaded and is not.

Executes the REAL browser_verdict / get_verdict / check_hybrid / _pmap — never a copy.

Run: python -m pytest scrapers/common/tests/test_wasalt_liveness_browser_transport.py -v
"""
from __future__ import annotations

import threading
import types

import pytest

from scrapers.wasalt import liveness as L

ALIVE_DATA = {"props": {"pageProps": {"propertyDetailsV3": {"id": 1, "propertyInfo": {}}}}}
DEAD_DATA = {"props": {"pageProps": {"_sentryBaggage": "x"}}, "page": "/404"}


class _StubBrowser:
    """Contract twin of BrowserFetcher.page_data → (parsed __NEXT_DATA__ | None, status, nbytes)."""

    def __init__(self, triple):
        self.triple, self.calls = triple, 0

    def page_data(self, url):
        self.calls += 1
        self.url = url
        return self.triple


@pytest.fixture
def browser(monkeypatch):
    monkeypatch.setenv("WASALT_BROWSER", "1")
    monkeypatch.setattr(L, "_throttle", lambda: None)

    def install(triple):
        stub = _StubBrowser(triple)
        monkeypatch.setattr(L, "_browser", lambda: stub)
        return stub

    return install


# ── 1. A BLOCK IS NEVER A KILL ──────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("status", [None, 0, 403, 429, 500, 502, 503], ids=str)
def test_no_parseable_answer_is_failed_never_dead(browser, status):
    browser((None, status, 0))
    verdict, _st, _n = L.get_verdict("https://wasalt.sa/ar/property/x")
    assert verdict == "failed", (
        f"a block (status={status}) became {verdict!r}. A blocked RUN would then strike every row "
        "it touched and, at grace, deactivate live inventory in bulk.")


def test_a_blocked_sweep_cannot_strike_anything(browser):
    """End to end over check_hybrid, the function the enforce/enum-strike loops actually call."""
    browser((None, 403, 0))
    rows = [("wasalt_residential_listings", i, f"https://wasalt.sa/ar/property/x-{i}", 2)
            for i in range(5)]
    out = L._pmap(L.check_hybrid, rows, 1)
    assert [r[3] for r in out] == ["failed"] * 5, out
    assert not any(r[3] == "dead" for r in out), "a blocked sweep produced a death verdict"


def test_a_403_shell_with_a_body_is_still_not_dead(browser):
    """Cloudflare can answer 403 WITH parseable markup. Status decides, not the presence of a dict."""
    browser((ALIVE_DATA, 403, 4096))
    assert L.get_verdict("https://wasalt.sa/ar/property/x")[0] == "failed"


# ── 2. THE STATUS IS LOAD-BEARING ───────────────────────────────────────────────────────────────

def test_http_404_is_dead_even_though_the_page_parses(browser):
    """The measured shape of a retired wasalt listing: real 404, real __NEXT_DATA__, no payload."""
    browser((DEAD_DATA, 404, 211272))
    verdict, status, nbytes = L.get_verdict("https://wasalt.sa/ar/property/gone")
    assert (verdict, status) == ("dead", 404)
    assert nbytes == 211272, "byte count must be carried for the audit trail"


def test_410_is_dead(browser):
    browser((None, 410, 0))
    assert L.get_verdict("https://wasalt.sa/ar/property/gone")[0] == "dead"


def test_200_with_property_details_is_live(browser):
    browser((ALIVE_DATA, 200, 326339))
    assert L.get_verdict("https://wasalt.sa/ar/property/ok")[:2] == ("live", 200)


def test_200_without_property_details_is_dead(browser):
    """Pre-existing semantics, preserved: a 200 that renders no listing is a retired ad."""
    browser((DEAD_DATA, 200, 1000))
    assert L.get_verdict("https://wasalt.sa/ar/property/x")[0] == "dead"


def test_browser_path_never_builds_the_blocked_session(browser, monkeypatch):
    browser((ALIVE_DATA, 200, 10))
    monkeypatch.setattr(L, "_session", lambda: (_ for _ in ()).throw(
        AssertionError("liveness built a curl_cffi session while WASALT_BROWSER=1 — that is the "
                       "transport wasalt.sa has null-routed since 2026-08-17")))
    assert L.get_verdict("https://wasalt.sa/ar/property/ok")[0] == "live"


def test_browser_path_skips_the_useless_head(browser):
    """curl_cffi HEAD is the blocked transport too, so short-circuiting on it is worse than
    useless — it would report 403 and force the GET anyway, having paid for both."""
    stub = browser((ALIVE_DATA, 200, 10))
    monkey_head = []
    orig = L.head_status
    L.head_status = lambda *a, **k: monkey_head.append(a) or 200
    try:
        out = L.check_hybrid(("wasalt_residential_listings", 7, "https://wasalt.sa/ar/property/x", 0))
    finally:
        L.head_status = orig
    assert monkey_head == [], "the browser path called head_status()"
    assert out[3] == "live" and out[4] is True and out[6] is None, out
    assert stub.calls == 1


def test_http_path_is_untouched_when_the_browser_is_off(monkeypatch):
    """The browser branch is opt-in; aqar and local runs keep the old transport and the HEAD."""
    monkeypatch.delenv("WASALT_BROWSER", raising=False)
    monkeypatch.setattr(L, "_throttle", lambda: None)
    monkeypatch.setattr(L, "_browser", lambda: (_ for _ in ()).throw(
        AssertionError("browser used with WASALT_BROWSER unset")))
    monkeypatch.setattr(L, "head_status", lambda *a, **k: 200)
    out = L.check_hybrid(("wasalt_residential_listings", 1, "https://wasalt.sa/x", 0))
    assert out[3] == "live" and out[4] is False, "HEAD-200 must still short-circuit off-browser"


# ── 3. ONE THREAD, INLINE ───────────────────────────────────────────────────────────────────────

def test_workers_one_runs_inline_on_the_calling_thread():
    seen = []
    L._pmap(lambda x: seen.append(threading.get_ident()), range(4), 1)
    assert seen == [threading.main_thread().ident] * 4, (
        "a pool of one is still not the calling thread — Playwright's sync driver dies with "
        "greenlet.error the moment a second executor's worker touches it")


def test_repeated_maps_share_one_thread_at_workers_one():
    """The real shape: four call sites, each opening its own executor."""
    t = set()
    for _ in range(4):
        L._pmap(lambda x: t.add(threading.get_ident()), range(2), 1)
    assert len(t) == 1 and t == {threading.main_thread().ident}, t


def test_pmap_still_parallelises_above_one():
    t = set()
    L._pmap(lambda x: t.add(threading.get_ident()) or __import__("time").sleep(0.02), range(8), 4)
    assert len(t) > 1, "the http path lost its concurrency"
