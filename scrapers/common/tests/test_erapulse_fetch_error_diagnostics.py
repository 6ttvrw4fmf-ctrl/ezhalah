"""Regression test for the 2026-08-31 erapulse fetch_page() diagnostic fix (daily engineer run).

erapulse has failed EVERY single scheduled run since at least 2026-08-27 (5+ consecutive days,
scrape_runs.notes always the same generic "list endpoint returned no properties after 5 attempts
(api.erapulse.sa unreachable, blocking, or schema change)") with mon_detect_silent_scraper_death
open (P0) since 2026-08-26. The retry loop in fetch_page() caught every exception, non-200 status,
and JSON-parse failure and just `continue`d — the actual reason (timeout? DNS failure? 403? empty
body? schema change?) was thrown away on every single attempt, so five days of failures produced
zero diagnostic signal to root-cause from.

Fix: fetch_page() now returns a third value, the last concrete failure reason (exception type +
message, HTTP status + body snippet, or "valid JSON but empty" for the flaky-empty case), which
main() folds into both the printed message and the scrape_runs.notes row — so the NEXT failure
(and everyone reading scrape_runs afterward) can actually tell which of the three cases occurred.

Hermetic: fake session only, no network, sleeps patched out.

Run: python -m pytest scrapers/common/tests/test_erapulse_fetch_error_diagnostics.py -v
"""
import sys
from unittest import mock

sys.path.insert(0, ".")

# Stub supabase + dotenv + playwright + curl_cffi's heavier deps so importing scrapers.erapulse.run
# is hermetic (same pattern as test_jazwtn_sitemap_retry_rotation.py / test_aqar_ppm_parse.py).
for name in ("supabase", "dotenv"):
    if name not in sys.modules:
        stub = mock.MagicMock()
        if name == "dotenv":
            stub.load_dotenv = lambda *a, **k: None
        sys.modules[name] = stub

from scrapers.erapulse import run as ep  # noqa: E402


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

    def get(self, url, params=None, timeout=None):
        self.calls += 1
        step = self.script.pop(0)
        if isinstance(step, Exception):
            raise step
        return step


def _run(script):
    s = _FakeSession()
    s.script = list(script)
    with mock.patch.object(ep.time, "sleep", lambda *_: None):
        return ep.fetch_page(s, 1) + (s.calls,)


def test_success_on_first_attempt_returns_no_error():
    data, pag, err, calls = _run([
        _Resp(200, {"data": [{"id": "1"}], "pagination": {"hasNext": False}}),
    ])
    assert data == [{"id": "1"}]
    assert err is None
    assert calls == 1


def test_connection_exception_is_captured_verbatim():
    data, pag, err, calls = _run([
        ConnectionError("curl: (7) Failed to connect to api.erapulse.sa port 443: Connection refused"),
    ] * 5)
    assert data == []
    assert err is not None
    assert "ConnectionError" in err
    assert "Connection refused" in err
    assert calls == 5


def test_non_200_status_is_captured_with_body_snippet():
    data, pag, err, calls = _run([
        _Resp(403, text="Forbidden — Cloudflare"),
    ] * 5)
    assert data == []
    assert err is not None
    assert "HTTP 403" in err
    assert "Forbidden" in err


def test_non_json_body_is_captured():
    data, pag, err, calls = _run([
        _Resp(200, json_body=None, text="<html>rate limited</html>"),
    ] * 5)
    assert data == []
    assert err is not None
    assert "non-JSON body" in err
    assert "rate limited" in err


def test_valid_empty_page1_is_captured_as_flaky_case():
    data, pag, err, calls = _run([
        _Resp(200, {"data": [], "pagination": {}}),
    ] * 5)
    assert data == []
    assert err is not None
    assert "empty" in err.lower() or "data=[]" in err


def test_recovers_after_transient_failure_and_clears_error():
    data, pag, err, calls = _run([
        ConnectionError("timeout"),
        _Resp(200, {"data": [{"id": "2"}], "pagination": {"hasNext": False}}),
    ])
    assert data == [{"id": "2"}]
    assert err is None
    assert calls == 2


def test_main_failure_message_includes_last_error(capsys):
    """End-to-end: main() must fold fetch_page's diagnostic into its printed failure message,
    not just the generic three-way guess — this is the whole point of the fix."""
    fake_session = _FakeSession()
    fake_session.script = [
        ConnectionError("curl: (35) SSL connect error"),
    ] * 5

    with mock.patch.object(ep, "session", return_value=fake_session), \
         mock.patch.object(ep.db, "begin_run", return_value=None), \
         mock.patch.object(ep.time, "sleep", lambda *_: None), \
         mock.patch.object(sys, "argv", ["run.py", "--type", "all"]):
        rc = ep.main()

    assert rc == 1
    out = capsys.readouterr().out
    assert "SSL connect error" in out, (
        "main()'s failure message must surface fetch_page's captured error, not just the generic "
        "'unreachable, blocking, or schema change' guess — that regression is exactly what left "
        "5 days of erapulse failures undiagnosable."
    )


if __name__ == "__main__":
    test_success_on_first_attempt_returns_no_error()
    test_connection_exception_is_captured_verbatim()
    test_non_200_status_is_captured_with_body_snippet()
    test_non_json_body_is_captured()
    test_valid_empty_page1_is_captured_as_flaky_case()
    test_recovers_after_transient_failure_and_clears_error()
    print("OK — erapulse fetch_page diagnostic regression tests pass (run via pytest for the capsys test)")
