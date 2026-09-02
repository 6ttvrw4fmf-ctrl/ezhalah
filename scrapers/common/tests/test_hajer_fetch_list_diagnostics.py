"""Regression test for the 2026-09-02 hajer fetch_list() diagnostic + retry fix (daily engineer run).

hajer failed with "Hajer Houses: 0 listings from REST" on 2026-09-01 AND 2026-09-02 back to back
(mon_detect_silent_scraper_death P0, alert_event id 1271 — "no attributable scrape run has
succeeded with rows within this platform's own cadence"). fetch_list() used to break silently on
any non-200 response or an empty page-1 JSON body, with no retry and no record of WHY — re-fetching
https://hajerhouses.com/wp-json/wp/v2/properties by hand both times returned a healthy 352KB
catalogue immediately, so this was a transient page-1 response the scraper never retried or
explained, exactly the gap the 2026-08-31 erapulse fetch_page() fix closed for that platform.

Fix: fetch_list() now retries page 1 up to 5 times and returns (listings, last_err) — last_err
carries the concrete failure reason (exception, HTTP status + body snippet, or a valid-but-empty
body) instead of discarding it. main() folds it into both the printed message and scrape_runs.notes.

Hermetic: fake session only, no network, sleeps patched out.

Run: python -m pytest scrapers/common/tests/test_hajer_fetch_list_diagnostics.py -v
"""
import sys
import types
from unittest import mock

sys.path.insert(0, ".")

for name in ("supabase", "dotenv"):
    if name not in sys.modules:
        stub = mock.MagicMock()
        if name == "dotenv":
            stub.load_dotenv = lambda *a, **k: None
        sys.modules[name] = stub

# curl_cffi is a real runtime dep of hajer/run.py; stub it so the test needs no network stack
# (same pattern as test_wasalt_enum_strike_kill_evidence.py).
if "curl_cffi" not in sys.modules:
    _cc_mod = types.ModuleType("curl_cffi")
    _req_mod = types.ModuleType("curl_cffi.requests")

    class _StubSession:
        def __init__(self, *a, **k):
            self.headers = {}

    _req_mod.Session = _StubSession
    _cc_mod.requests = _req_mod
    sys.modules["curl_cffi"] = _cc_mod
    sys.modules["curl_cffi.requests"] = _req_mod

from scrapers.hajer import run as hj  # noqa: E402


class _Resp:
    def __init__(self, status_code=200, json_body=None, text=""):
        self.status_code = status_code
        self._json_body = json_body
        self.text = text

    def json(self):
        if self._json_body is None:
            raise ValueError("no JSON body")
        return self._json_body


class _FakeSession:
    """Scripted session: each get() pops the next scripted _Resp or raises a scripted exception."""

    def __init__(self):
        self.script: list = []
        self.calls = 0

    def get(self, url, timeout=None, headers=None):
        self.calls += 1
        step = self.script.pop(0)
        if isinstance(step, Exception):
            raise step
        return step


def _run(script):
    s = _FakeSession()
    s.script = list(script)
    with mock.patch.object(hj.time, "sleep", lambda *_: None), \
         mock.patch.object(hj, "_throttle", lambda: None):
        listings, err = hj.fetch_list(s)
        return listings, err, s.calls


def test_success_on_first_attempt_returns_no_error():
    listings, err, calls = _run([
        _Resp(200, [{"id": 1}] * 40),  # < 100 → single page, done
    ])
    assert len(listings) == 40
    assert err is None
    assert calls == 1


def test_connection_exception_is_captured_verbatim():
    listings, err, calls = _run([
        ConnectionError("curl: (7) Failed to connect to hajerhouses.com port 443: Connection refused"),
    ] * 5)
    assert listings == []
    assert err is not None
    assert "ConnectionError" in err
    assert "Connection refused" in err
    assert calls == 5


def test_non_200_status_is_captured_with_body_snippet():
    listings, err, calls = _run([
        _Resp(403, text="Forbidden — Cloudflare"),
    ] * 5)
    assert listings == []
    assert err is not None
    assert "HTTP 403" in err
    assert "Forbidden" in err


def test_non_json_body_is_captured():
    listings, err, calls = _run([
        _Resp(200, json_body=None, text="<html>rate limited</html>"),
    ] * 5)
    assert listings == []
    assert err is not None
    assert "non-JSON body" in err
    assert "rate limited" in err


def test_valid_empty_page1_is_captured_as_flaky_case():
    """The exact 2026-09-01/02 shape: HTTP 200, valid JSON, page 1 is simply []."""
    listings, err, calls = _run([
        _Resp(200, []),
    ] * 5)
    assert listings == []
    assert err is not None
    assert "empty" in err.lower() or "data=[]" in err
    assert calls == 5


def test_recovers_after_transient_failure_and_clears_error():
    listings, err, calls = _run([
        ConnectionError("timeout"),
        _Resp(200, [{"id": 2}] * 40),
    ])
    assert len(listings) == 40
    assert err is None
    assert calls == 2


def test_pagination_continues_across_full_pages_and_stops_on_short_page():
    listings, err, calls = _run([
        _Resp(200, [{"id": i} for i in range(100)]),   # full page → keep going
        _Resp(200, [{"id": i} for i in range(30)]),    # short page → real end, no retry needed
    ])
    assert len(listings) == 130
    assert err is None
    assert calls == 2


def test_later_page_failure_is_not_retried_and_stops_the_walk():
    """A later page hitting trouble is NOT the flaky page-1 case — it should stop cleanly (attempts=1)
    rather than burning 5 retries on every page, and still surface what happened."""
    listings, err, calls = _run([
        _Resp(200, [{"id": i} for i in range(100)]),   # page 1: full page
        _Resp(500, text="Internal Server Error"),       # page 2: fails once, no retry
    ])
    assert len(listings) == 100
    assert err is not None
    assert "HTTP 500" in err
    assert calls == 2


def test_main_prints_and_records_the_diagnostic_on_total_failure(capsys):
    """End-to-end: main() must fold fetch_list's diagnostic into both the printed message and the
    scrape_runs.notes it hands to db.end_run — this is the whole point of the fix."""
    fake_session = _FakeSession()
    fake_session.script = [_Resp(200, [])] * 5

    recorded = {}

    def _fake_end_run(run_id, **kwargs):
        recorded.update(kwargs)
        return True

    with mock.patch.object(hj, "session", return_value=fake_session), \
         mock.patch.object(hj.db, "begin_run", return_value=1), \
         mock.patch.object(hj.db, "end_run", side_effect=_fake_end_run), \
         mock.patch.object(hj.db, "prune_unseen", return_value=0), \
         mock.patch.object(hj.time, "sleep", lambda *_: None), \
         mock.patch.object(hj, "_throttle", lambda: None), \
         mock.patch.object(sys, "argv", ["run.py", "--type", "all"]):
        hj.main()

    out = capsys.readouterr().out
    assert "flaky-empty case" in out or "data=[]" in out, (
        "main()'s printed message must surface fetch_list's captured error, not just a bare "
        "'0 listings from REST' — that regression is exactly what left the 2026-09-01/02 hajer "
        "failures undiagnosable."
    )
    assert "fetch_err=" in recorded.get("notes", ""), (
        "the diagnostic must also land in scrape_runs.notes so it survives past the CI log."
    )


if __name__ == "__main__":
    test_success_on_first_attempt_returns_no_error()
    test_connection_exception_is_captured_verbatim()
    test_non_200_status_is_captured_with_body_snippet()
    test_non_json_body_is_captured()
    test_valid_empty_page1_is_captured_as_flaky_case()
    test_recovers_after_transient_failure_and_clears_error()
    test_pagination_continues_across_full_pages_and_stops_on_short_page()
    test_later_page_failure_is_not_retried_and_stops_the_walk()
    print("OK — hajer fetch_list diagnostic regression tests pass (run via pytest for the capsys test)")
