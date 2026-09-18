"""The Wasalt AR enricher fetches through the BROWSER, and a block never spends a retry attempt.

THE DEFECT (found 2026-09-18 while adjudicating the wasalt ×1000 price alerts, PR #3137).
`enrich_ar.py` populates `wasalt_residential_listings.ar_data` — wasalt's own archived detail
payload — and docs/ops/DATA_INTEGRITY_ENGINEER.md §25 makes that column THE oracle for deciding
whether a suspect wasalt price is wasalt's or ours. But wasalt.sa has been unreachable by every
http client since Cloudflare tightened on 2026-08-17 (issue #1019), and while the SWEEP moved to a
real browser in PR #3129, this enricher did not. So every row the new sweep captured from
2026-09-17 on had `ar_data = NULL`: the oracle was blind on precisely the newest rows, which is why
adjudicating ids 11939802 / 11939808 needed a fresh live fetch instead of a lookup.

THREE THINGS THIS PINS, each of which was a real trap rather than a hypothetical:

1. A BLOCK IS TRANSIENT, NEVER DEFINITIVE. `browser.next_data()` returns None for "no parseable
   answer" — a Cloudflare challenge shell, a dead proxy exit and a nav timeout are indistinguish-
   able from here, and none is evidence about the listing. The http path's sibling branch
   (`if not m: return True, {"_err": "noNEXT"}`) IS definitive, so mirroring it would have been the
   natural thing to write — and would have spent one of each row's ERR_MAX_ATTEMPTS attempts per
   blocked run, parking rows permanently on the strength of our own outage.

2. A VANISHED LISTING IS NOT AN EMPTY ARCHIVE. Measured 2026-09-18 against a bogus slug: wasalt
   answers 200 with a perfectly parseable __NEXT_DATA__ whose pageProps holds nothing but two
   Sentry keys and `propertyDetailsV3: null`. Unguarded, `_extract({})` yields `{}`, which work()
   stores as `ar_data = {}` and counts as a SUCCESS — the oracle would then read "wasalt published
   nothing about this property" when the truth is the listing is gone. `_from_next_data()` is the
   single point both transports pass through, so one guard covers both.

3. workers==1 RUNS INLINE, NOT IN A POOL OF ONE. Playwright's sync driver is bound to the thread
   that started it, and enrich_table() runs its rows TWICE through a fresh executor (pending pass,
   then retry pass). Measured: pass 1 succeeds, pass 2 dies with
   `greenlet.error: cannot switch to a different thread (which happens to have exited)`. A pool of
   one looks single-threaded and is not.

Executes the REAL fetch_ar / enrich_table from scrapers/wasalt/enrich_ar.py against a stub browser
and a stub Supabase client — never a copy of them.

Run: python -m pytest scrapers/common/tests/test_wasalt_enrich_ar_browser_transport.py -v
"""
from __future__ import annotations

import threading
import types

import pytest

from scrapers.wasalt import enrich_ar as E

# A real propertyDetailsV3 skeleton, shaped like the live payload measured on 2026-09-18
# (36 top-level keys; PII in propertyOwner / leadContactInfo / reservation; price in
# propertyInfo.salePrice — id 11939802 archived 24,829,872,186, matching its stored price_total).
LIVE_PDV = {
    "id": 5908995,
    "propertyInfo": {"city": "مكة المكرمة", "district": "العكيشية", "salePrice": 24829872186},
    "additionalAttributes": [{"key": "area", "value": "3523967"}],
    "propertyOwner": {"name": "broker", "mobile": "+9665xxxxxxx"},
    "leadContactInfo": {"phone": "+9665xxxxxxx"},
    "reservation": {"holderName": "someone"},
}


def _next_data(pdv):
    """Wrap a propertyDetailsV3 the way wasalt's Next.js document really does."""
    return {"props": {"pageProps": {"propertyDetailsV3": pdv}}}


class _StubBrowser:
    """Stands in for scrapers/wasalt/browser.py:BrowserFetcher — same contract: next_data() returns
    the ALREADY-PARSED __NEXT_DATA__ dict, or None when no attempt produced a parseable answer."""

    def __init__(self, answer):
        self.answer = answer
        self.calls = 0

    def next_data(self, url):
        self.calls += 1
        self.url = url
        return self.answer


@pytest.fixture
def browser_on(monkeypatch):
    """Turn the browser transport on and hand back a factory that installs a stub fetcher."""
    monkeypatch.setenv("WASALT_BROWSER", "1")
    monkeypatch.setattr(E, "_throttle", lambda: None)

    def install(answer):
        stub = _StubBrowser(answer)
        monkeypatch.setattr(E, "_browser", lambda: stub)
        return stub

    return install


# ── 1. THE TRANSPORT IS ACTUALLY THE BROWSER ────────────────────────────────────────────────────

def test_browser_path_is_used_and_never_touches_the_http_session(browser_on, monkeypatch):
    stub = browser_on(_next_data(LIVE_PDV))

    def _boom():
        raise AssertionError("fetch_ar built a curl_cffi session while WASALT_BROWSER=1 — that is "
                             "the blocked transport this change exists to stop using")

    monkeypatch.setattr(E, "_session", _boom)
    ok, d, city, dist = E.fetch_ar("land-3523967-sqm-facing-3-streets-on-30m-width-street-5908995")

    assert ok is True
    assert stub.calls == 1, "next_data() carries its own retry ladder; fetch_ar must call it ONCE"
    assert stub.url.startswith("https://wasalt.sa/ar/property/"), stub.url
    assert city == "مكة المكرمة" and dist == "العكيشية"


def test_browser_payload_is_archived_whole_minus_pii(browser_on):
    browser_on(_next_data(LIVE_PDV))
    ok, d, _, _ = E.fetch_ar("slug")

    assert ok is True
    # The oracle's whole job: the archived price must be wasalt's own published number.
    assert d["propertyInfo"]["salePrice"] == 24829872186
    assert d["additionalAttributes"] == [{"key": "area", "value": "3523967"}]
    for pii in E.PII_KEYS:
        assert pii not in d, f"PDPL: {pii} must never be archived"


def test_http_path_still_works_when_the_browser_is_off(monkeypatch):
    """The browser branch must be opt-in — an unset WASALT_BROWSER keeps the old transport."""
    monkeypatch.delenv("WASALT_BROWSER", raising=False)
    monkeypatch.setattr(E, "_throttle", lambda: None)
    monkeypatch.setattr(E, "_browser", lambda: (_ for _ in ()).throw(
        AssertionError("browser used with WASALT_BROWSER unset")))
    body = ('<script id="__NEXT_DATA__" type="application/json">'
            + __import__("json").dumps(_next_data(LIVE_PDV)) + '</script>')
    monkeypatch.setattr(E, "_session", lambda: types.SimpleNamespace(
        get=lambda *a, **k: types.SimpleNamespace(status_code=200, text=body)))

    ok, d, city, _ = E.fetch_ar("slug")
    assert ok is True and city == "مكة المكرمة"
    assert d["propertyInfo"]["salePrice"] == 24829872186


# ── 2. A BLOCK IS TRANSIENT — THE BUDGET-BURNING TRAP ───────────────────────────────────────────

def test_browser_block_is_transient_and_never_a_definitive_error(browser_on):
    """next_data() -> None is OUR failure, not the listing's. It must leave the row untouched."""
    browser_on(None)
    ok, d, city, dist = E.fetch_ar("slug")

    assert ok is False, ("a browser block was reported as a definitive answer — every blocked run "
                         "would then spend one of the row's ERR_MAX_ATTEMPTS attempts")
    assert d is None, f"a block must carry no ar_data to write, got {d!r}"
    assert city is None and dist is None


def test_a_blocked_run_cannot_park_a_single_row(browser_on):
    """End to end over the whole policy: ERR_MAX_ATTEMPTS blocked runs in a row must leave the row
    exactly as it was — not errored, not parked, still eligible."""
    browser_on(None)
    ar_data = None
    for _ in range(E.ERR_MAX_ATTEMPTS + 2):
        ok, d, _, _ = E.fetch_ar("slug")
        assert ok is False
        if ok:  # pragma: no cover — only reached if the transient contract breaks
            ar_data = E.bump_err(d, ar_data)
    assert ar_data is None, "a run of pure blocks wrote an error marker"


def test_a_real_definitive_error_still_parks(browser_on):
    """The mirror image: the transient rule must not have disarmed parking altogether."""
    browser_on(_next_data(None))  # 200 + parseable page + no listing → DEFINITIVE
    prev = None
    for n in range(1, E.ERR_MAX_ATTEMPTS + 1):
        ok, d, _, _ = E.fetch_ar("gone")
        assert ok is True and "_err" in d
        prev = E.bump_err(d, prev)
    assert prev["_parked"] is True, "a genuinely vanished listing must still park at the cap"


# ── 3. A VANISHED LISTING IS NOT AN EMPTY ARCHIVE ───────────────────────────────────────────────

@pytest.mark.parametrize("pdv", [None, {}], ids=["null", "empty"])
def test_missing_property_details_is_an_error_not_an_empty_success(browser_on, pdv):
    browser_on(_next_data(pdv))
    ok, d, _, _ = E.fetch_ar("this-slug-does-not-exist-000000")

    assert ok is True, "the page answered — that is not a transport failure"
    assert d.get("_err") == "nodetail", (
        f"a 200 page with no propertyDetailsV3 was archived as {d!r}. Stored as ar_data that reads "
        "to the §25 oracle as 'wasalt published nothing about this property'.")


def test_the_same_guard_covers_the_http_transport(monkeypatch):
    """The hole predates the browser path; _from_next_data() is the one place both go through."""
    monkeypatch.delenv("WASALT_BROWSER", raising=False)
    monkeypatch.setattr(E, "_throttle", lambda: None)
    body = ('<script id="__NEXT_DATA__" type="application/json">'
            '{"props":{"pageProps":{"_sentryBaggage":"x"}}}</script>')
    monkeypatch.setattr(E, "_session", lambda: types.SimpleNamespace(
        get=lambda *a, **k: types.SimpleNamespace(status_code=200, text=body)))

    ok, d, _, _ = E.fetch_ar("slug")
    assert ok is True and d.get("_err") == "nodetail"


# ── 4. ONE THREAD, INLINE — NOT A POOL OF ONE ───────────────────────────────────────────────────

def _stub_db(pending_rows, retry_rows=()):
    """Minimal Supabase stand-in: enough surface for enrich_table's two queries and its updates."""
    state = {"updated": 0}

    class _Res:
        def __init__(self, data=None, count=None):
            self.data = list(data or [])
            self.count = count

    class _Q:
        def __init__(self):
            self._head = False
            self._retry = False

        def select(self, *a, **k):
            self._head = bool(k.get("head"))
            return self

        def eq(self, *a): return self
        def like(self, *a): return self
        def lt(self, *a): return self
        def is_(self, *a): return self
        def order(self, *a): return self
        def limit(self, n): return self
        def update(self, upd): state["updated"] += 1; return self

        @property
        def not_(self):
            self._retry = True
            return self

        def execute(self):
            if self._head:
                return _Res(count=len(pending_rows))
            return _Res(data=list(retry_rows) if self._retry else list(pending_rows))

    return types.SimpleNamespace(
        sb=lambda: types.SimpleNamespace(table=lambda t: _Q()),
        begin_run=lambda *a, **k: 1,
        end_run=lambda *a, **k: None,
        guard_location_update=lambda *a, **k: None,
    ), state


def _run_enrich(monkeypatch, workers, browser):
    """Execute the REAL enrich_table and report which threads did the fetching."""
    rows = [{"id": i, "ad_number": f"WST{i}", "listing_url": f"https://wasalt.sa/en/property/x-{i}"}
            for i in range(6)]
    retry = [{"id": 90 + i, "ad_number": f"WST{90 + i}", "ar_data": {"_err": 404},
              "listing_url": f"https://wasalt.sa/en/property/r-{i}"} for i in range(3)]
    db_stub, _ = _stub_db(rows, retry)
    monkeypatch.setattr(E, "db", db_stub)
    monkeypatch.setattr(E, "_load_catalog", lambda: None)
    monkeypatch.setattr(E, "_region_for", lambda c: None)
    if browser:
        monkeypatch.setenv("WASALT_BROWSER", "1")
    else:
        monkeypatch.delenv("WASALT_BROWSER", raising=False)

    seen, lock, inflight, peak = set(), threading.Lock(), [0], [0]

    def _fetch(slug):
        with lock:
            seen.add(threading.get_ident())
            inflight[0] += 1
            peak[0] = max(peak[0], inflight[0])
        try:
            return True, {"propertyInfo": {}}, None, None
        finally:
            with lock:
                inflight[0] -= 1

    monkeypatch.setattr(E, "fetch_ar", _fetch)
    stats = E.enrich_table("wasalt_residential_listings", 100, workers, retry_errs=5)
    return stats, seen, peak[0]


def test_browser_run_stays_on_ONE_thread_across_both_passes(monkeypatch):
    stats, threads, peak = _run_enrich(monkeypatch, workers=6, browser=True)

    assert stats["ok"] == 9, f"both passes must still run: {stats}"
    assert stats["retry_attempted"] == 3, f"the retry pass must not be skipped: {stats}"
    assert peak == 1, f"browser run had {peak} fetches in flight — Playwright is not thread-safe"
    assert len(threads) == 1, (
        f"the pending pass and the retry pass fetched from {len(threads)} different threads. "
        "Playwright's sync driver dies with `greenlet.error: cannot switch to a different thread` "
        "the moment the second executor's worker touches it.")
    assert threads == {threading.main_thread().ident}, (
        "a pool of one is still not the calling thread — workers==1 must run INLINE")


def test_http_run_keeps_its_thread_pool(monkeypatch):
    """The serialization is the browser path's price, not a global throughput regression."""
    _, threads, peak = _run_enrich(monkeypatch, workers=6, browser=False)
    assert peak > 1 or len(threads) > 1, (
        f"the http path lost its concurrency (peak={peak}, threads={len(threads)})")
