"""Hermetic test harness for the Wasalt empty-vs-failure guard.

These tests must run OFFLINE and with NO third-party scraper deps (curl_cffi, supabase, dotenv). We
stub `curl_cffi` and `scrapers.common.db` in sys.modules BEFORE importing the module under test, then
drive `scrapers.wasalt.run` with a scripted fake HTTP session. This lets us reproduce every failure
mode deterministically — including ones that are hard/impossible to trigger against the live site
(Cloudflare challenge, proxy death, timeout, malformed API) — and assert exactly how each is classified.
"""
from __future__ import annotations

import sys
import types

import pytest

# ── Stub curl_cffi (run.py does `from curl_cffi import requests as cc` at import) ──────────────────
_cc = types.ModuleType("curl_cffi")
_cc_requests = types.ModuleType("curl_cffi.requests")


class _StubSession:  # only referenced as a type; real sessions are the FakeSession below
    pass


_cc_requests.Session = _StubSession
_cc.requests = _cc_requests
sys.modules.setdefault("curl_cffi", _cc)
sys.modules.setdefault("curl_cffi.requests", _cc_requests)

# ── Stub scrapers.common.db (avoids needing supabase creds / network) ──────────────────────────────
_db = types.ModuleType("scrapers.common.db")
_db.RUN_ENDED = []  # captured (ok, notes, rows) per end_run, inspected by tests


def _begin_run(platform):
    return 1


def _end_run(run_id, *, ok, rows_seen, rows_upserted, notes):
    _db.RUN_ENDED.append({"ok": ok, "rows_seen": rows_seen, "rows_upserted": rows_upserted, "notes": notes})


def _upsert_res(batch):
    _db.UPSERTED_RES.append(len(batch))


def _upsert_com(batch):
    _db.UPSERTED_COM.append(len(batch))


_db.UPSERTED_RES = []
_db.UPSERTED_COM = []
_db.begin_run = _begin_run
_db.end_run = _end_run
_db.upsert_wasalt_residential_batch = _upsert_res
_db.upsert_wasalt_commercial_batch = _upsert_com
_db.upsert_wasalt_residential = lambda row: None
sys.modules["scrapers.common.db"] = _db

# Now it is safe to import the module under test.
from scrapers.wasalt import run  # noqa: E402


# ── Fake HTTP layer ───────────────────────────────────────────────────────────────────────────────
class FakeResponse:
    def __init__(self, status_code: int, text: str = ""):
        self.status_code = status_code
        self.text = text


class FakeSession:
    """Returns queued responses (or raises queued exceptions) in order, one per .get() call.
    If `loop` is True the last scripted item repeats forever (handy for 'every retry fails')."""

    def __init__(self, script, loop=False):
        self._script = list(script)
        self._loop = loop
        self._i = 0
        self.calls = 0
        self.proxies = {}
        self.headers = {}

    def get(self, url, timeout=None):
        self.calls += 1
        if self._i >= len(self._script):
            if self._loop and self._script:
                item = self._script[-1]
            else:
                raise AssertionError("FakeSession ran out of scripted responses")
        else:
            item = self._script[self._i]
            self._i += 1
        if isinstance(item, Exception):
            raise item
        return item


def next_data_html(count, total_pages=1, properties=None):
    """Wrap a searchResult payload in the exact <script id="__NEXT_DATA__"> envelope run.py greps for."""
    import json
    payload = {"props": {"pageProps": {"searchResult": {
        "count": count, "totalPages": total_pages, "properties": properties or [],
    }}}}
    return ('<html><body><script id="__NEXT_DATA__" type="application/json">'
            + json.dumps(payload)
            + "</script></body></html>")


def next_data_missing_searchresult():
    """Valid __NEXT_DATA__ JSON whose pageProps has NO searchResult key (simulated API change)."""
    return ('<script id="__NEXT_DATA__" type="application/json">'
            '{"props":{"pageProps":{"somethingElse":true}}}</script>')


def next_data_bad_json():
    """__NEXT_DATA__ present but the JSON body is truncated/garbage."""
    return '<script id="__NEXT_DATA__" type="application/json">{not: valid json,,,</script>'


CLOUDFLARE_CHALLENGE = (
    "<html><head><title>Just a moment...</title></head>"
    "<body><div class='cf-chl-widget' id='challenge-platform'>Checking your browser…</div></body></html>"
)


def sample_prop(pid=1, subtype="Apartment"):
    """Minimal but valid Wasalt property dict → map_property yields a row with property_type set."""
    return {
        "id": pid,
        "propertyInfo": {"slug": f"listing-{pid}", "propertySubType": subtype,
                         "salePrice": 500000, "city": "Riyadh", "title": f"Unit {pid}"},
        "attributes": [], "propertyFiles": {"images": []},
    }


@pytest.fixture(autouse=True)
def _fast_and_clean(monkeypatch):
    """No real sleeping, no throttle waits, and a fresh capture buffer per test."""
    monkeypatch.setattr(run.time, "sleep", lambda *_a, **_k: None)
    monkeypatch.setattr(run, "_throttle", lambda: None)
    _db.RUN_ENDED.clear()
    _db.UPSERTED_RES.clear()
    _db.UPSERTED_COM.clear()
    yield


@pytest.fixture
def run_main(monkeypatch):
    """Run run.main() for a single slice against a scripted FakeSession; return (exit_code, end_run dict)."""
    def _run(session, *, deal="rent", cat="residential", slug="farm", pages=3):
        monkeypatch.setattr(run, "session", lambda: session)
        monkeypatch.setattr(sys, "argv",
                            ["run.py", "--type", cat, "--slug", slug, "--deal", deal, "--pages", str(pages)])
        code = run.main()
        return code, (_db.RUN_ENDED[-1] if _db.RUN_ENDED else None)
    return _run
