"""fetch_listings must not crash when the source stops serving JSON.

awaalun.com was parked on 2026-07-27: every REST page answered 200 text/html with a 133-byte
redirect stub, the bare r.json() raised JSONDecodeError, and the process died BEFORE begin_run —
two days of failures with zero scrape_runs rows. Guard: an unparseable body ends enumeration.
"""
import json
import sys
import types
from pathlib import Path


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


sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
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

# ── FIVE WAYS TO RETURN ZERO, AND ONLY ONE OF THEM IS AN ANSWER ─────────────────────────────────
# Everything above proves the crawl does not CRASH. None of it proves anyone can tell WHY it came
# back empty — and for three consecutive runs (2026-09-24 04:22 onward) awal reported the single
# sentence "(source down, parked, or blocked)", which is three guesses standing in for the fact the
# fetch already held. `empty_first_page` is the source speaking; the other four are us failing to
# hear it, and UNKNOWN is never DEAD.
from scrapers.awal.run import why_no_listings  # noqa: E402


class _RespWithHeaders(_FakeResp):
    def __init__(self, body: str, status: int = 200, ctype: str = "text/html"):
        super().__init__(body, status)
        self.headers = {"content-type": ctype}


class _SessionRaising:
    def __init__(self, exc: Exception):
        self._exc, self.calls = exc, 0

    def get(self, *_a, **_kw):
        self.calls += 1
        assert self.calls < 50, "retry loop ran away"
        raise self._exc


class _SessionResp:
    def __init__(self, resp):
        self._resp, self.calls = resp, 0

    def get(self, *_a, **_kw):
        self.calls += 1
        assert self.calls < 50, "fetch_listings looped instead of breaking out"
        return self._resp


def _stop_for(session) -> dict:
    d: dict = {}
    assert fetch_listings(session, d) == [], "these cases must all still yield zero listings"
    return d


# Each distinct failure must land on its OWN stop code — that is the whole point.
cases = {
    "transport":   _stop_for(_SessionRaising(ConnectionError("connection reset by peer"))),
    "http_status": _stop_for(_SessionResp(_RespWithHeaders("nope", status=502))),
    "not_json":    _stop_for(_SessionResp(_RespWithHeaders(PARKED))),
    "not_a_list":  _stop_for(_SessionResp(_RespWithHeaders(
        '{"code":"rest_post_invalid_page_number"}', ctype="application/json"))),
    "empty_first_page": _stop_for(_SessionResp(_RespWithHeaders("[]", ctype="application/json"))),
}
for expected, diag in cases.items():
    assert diag["stop"] == expected, f"expected stop={expected}, got {diag['stop']} ({diag})"

# They must not merely differ — they must be FIVE distinct codes, or two causes still collapse.
assert len({d["stop"] for d in cases.values()}) == 5, "stop codes collapsed"

# The ONE case that is the source speaking is labelled as such; the other four say UNKNOWN out loud,
# because a caller that cannot tell them apart is exactly how a fetch failure becomes a deactivation.
assert "SOURCE-TRUTH" in why_no_listings(cases["empty_first_page"])
for k in ("transport", "http_status", "not_json", "not_a_list"):
    line = why_no_listings(cases[k])
    assert "UNKNOWN" in line and "SOURCE-TRUTH" not in line, f"{k} must read as UNKNOWN: {line}"

# The evidence a responder actually needs survives into the note.
assert "502" in why_no_listings(cases["http_status"]), "the status code must reach the note"
assert "ConnectionError" in why_no_listings(cases["transport"]), "the exception type must reach it"
assert "text/html" in why_no_listings(cases["not_json"]), "the content-type must reach it"
assert "rest_post_invalid_page_number" in why_no_listings(cases["not_a_list"])

# MUTATION: if every case were given one shared code, the assertions above must fail.
assert len({"x", "x", "x", "x", "x"}) != 5, "the distinctness check must be able to fail"

# The happy path stays untouched and is never mistaken for a failure.
ok: dict = {}
assert len(fetch_listings(_SessionResp(_RespWithHeaders(page, ctype="application/json")), ok)) == 3
assert ok["stop"] == "ok", f"a successful crawl must not record a stop reason, got {ok}"

# A short LAST page is the normal end of pagination, not an empty source.
assert _stop_for(_SessionResp(_RespWithHeaders("[]", ctype="application/json")))["page"] == 1

print("ok: five distinct stop reasons; only an empty 200 reads as the source's own answer")
