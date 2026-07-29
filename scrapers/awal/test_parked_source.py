"""fetch_listings must not crash when the source stops serving JSON.

awaalun.com was parked on 2026-07-27: every REST page answered 200 text/html with a 133-byte
redirect stub, the bare r.json() raised JSONDecodeError, and the process died BEFORE begin_run —
two days of failures with zero scrape_runs rows. Guard: an unparseable body ends enumeration.
"""
import json
import sys
import types


class _FakeResp:
    def __init__(self, body: str, status: int = 200):
        self.text, self.status_code = body, status

    def json(self):
        return json.loads(self.text)  # raises JSONDecodeError on HTML, exactly like curl_cffi


class _FakeSession:
    def __init__(self, body: str, status: int = 200):
        self._body, self._status, self.calls = body, status, 0

    def get(self, *_a, **_kw):
        self.calls += 1
        assert self.calls < 50, "fetch_listings looped instead of breaking out"
        return _FakeResp(self._body, self._status)


# stub the scraper's DB module so importing run.py needs no credentials
sys.modules.setdefault("scrapers.common.db", types.ModuleType("scrapers.common.db"))

from scrapers.awal.run import fetch_listings  # noqa: E402

PARKED = ('<!DOCTYPE html><html><head><script>window.onload=function(){'
          'window.location.href="/lander?page=1&per_page=50"}</script></head></html>')

# 1. the real parked-page body: no exception, no listings, no infinite loop
s = _FakeSession(PARKED)
assert fetch_listings(s) == [], "parked HTML must yield zero listings"
assert s.calls == 1, f"must stop after the first unparseable page, got {s.calls}"

# 2. an empty body (WAF drop / truncated response) behaves the same
assert fetch_listings(_FakeSession("")) == []

# 3. a WP error OBJECT still degrades to empty (pre-existing 2026-07-01 guard, unchanged)
assert fetch_listings(_FakeSession('{"code":"rest_post_invalid_page_number"}')) == []

# 4. real JSON still enumerates — the guard must not swallow the happy path
page = json.dumps([{"id": i, "link": f"https://awaalun.com/l/{i}"} for i in range(3)])
assert len(fetch_listings(_FakeSession(page))) == 3, "valid JSON must still parse"

print("ok: parked/empty/error bodies degrade to 0 listings; valid JSON still parses")
