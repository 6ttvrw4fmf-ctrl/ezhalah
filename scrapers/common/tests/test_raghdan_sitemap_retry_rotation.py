"""Regression tests for the 2026-08-23 raghdan sitemap resilience fix (daily engineer run).

raghdan.sa's sitemap.xml is intermittently unreachable to automated fetchers: 2 consecutive daily
CI runs logged "Raghdan: 0 candidate listings" (2026-08-22, 2026-08-23) while a direct probe from a
different network fetched the same sitemap successfully with 376 property URLs moments later, and a
same-network repeat request then timed out again. The old single-shot `s.get(SITEMAP)` wrapped in a
bare `except Exception: pass` turned every crawl into a coin flip and swallowed the actual failure
reason — timeout, reset, and a genuinely empty catalog were all indistinguishable as "0 candidate
listings". Same lesson as jazwtn's 2026-08-03 fix (test_jazwtn_sitemap_retry_rotation.py): retry
across TLS fingerprints with backoff, treat an entry-less body as a FAILED attempt (never a healthy
empty catalog), and raise after exhaustion so the run is marked failed while the prune guard
protects the existing stock, instead of silently reporting an empty catalog as success.

Hermetic: fake sessions only, no network, sleeps patched out.

Run: python -m pytest scrapers/common/tests/test_raghdan_sitemap_retry_rotation.py -v
"""
import sys
from unittest import mock

sys.path.insert(0, ".")

# Stub supabase + dotenv so importing scrapers.raghdan.run is hermetic (same pattern as
# test_jazwtn_sitemap_retry_rotation.py).
for name in ("supabase", "dotenv"):
    if name not in sys.modules:
        stub = mock.MagicMock()
        if name == "dotenv":
            stub.load_dotenv = lambda *a, **k: None
        sys.modules[name] = stub

from scrapers.raghdan import run as rg  # noqa: E402

GOOD_BODY = """<?xml version="1.0"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
<url><loc>https://raghdan.sa/ar/</loc></url>
<url><loc>https://raghdan.sa/ar/properties/</loc></url>
<url><loc>https://raghdan.sa/ar/property/M6u0lHNjH8firnOTcrHu/</loc></url>
<url><loc>https://raghdan.sa/ar/property/z3xTvtSnlxtWyaJn9p8Vabcd/</loc></url>
</urlset>"""

DECOY_BODY = "<html><head><title>Just a moment...</title></head><body>Checking your browser</body></html>"


class _Resp:
    def __init__(self, text):
        self.text = text


class _FakeSession:
    """Scripted session: each get() pops the next behavior ('good'|'decoy'|'reset'|'timeout')."""
    script: list = []          # shared across instances — sitemap_urls builds fresh sessions
    calls: int = 0

    def __init__(self, *a, **k):
        pass

    def get(self, url, timeout=None):
        _FakeSession.calls += 1
        step = _FakeSession.script.pop(0)
        if step == "reset":
            raise ConnectionError("curl: (35) Recv failure: Connection reset by peer")
        if step == "timeout":
            raise TimeoutError("curl: (28) Operation timed out")
        return _Resp(GOOD_BODY if step == "good" else DECOY_BODY)


def _run_scripted(script):
    _FakeSession.script = list(script)
    _FakeSession.calls = 0
    with mock.patch.object(rg.cc, "Session", _FakeSession), \
         mock.patch.object(rg.time, "sleep", lambda *_: None):
        return rg.sitemap_urls(_FakeSession())


def test_good_body_extracts_only_property_urls():
    entries = _run_scripted(["good"])
    assert entries == [
        "https://raghdan.sa/ar/property/M6u0lHNjH8firnOTcrHu/",
        "https://raghdan.sa/ar/property/z3xTvtSnlxtWyaJn9p8Vabcd/",
    ]


def test_first_attempt_success_no_retry():
    _run_scripted(["good"])
    assert _FakeSession.calls == 1


def test_timeout_then_decoy_then_success_recovers():
    # 2026-08-23 CI shape (timeout) followed by a WAF decoy, then a clean body on rotation.
    entries = _run_scripted(["timeout", "decoy", "good"])
    assert len(entries) == 2
    assert _FakeSession.calls == 3


def test_all_failures_raise_instead_of_returning_empty():
    # A run must NEVER treat a timeout/decoy as an empty catalog — "0 candidate listings" with
    # exit-0 success was exactly the 2026-08-22/08-23 silent failure this fix closes.
    _FakeSession.script = ["timeout"] * len(rg._SITEMAP_IMPERSONATES)
    _FakeSession.calls = 0
    with mock.patch.object(rg.cc, "Session", _FakeSession), \
         mock.patch.object(rg.time, "sleep", lambda *_: None):
        try:
            rg.sitemap_urls(_FakeSession())
            raise AssertionError("expected RuntimeError after exhausting fingerprints")
        except RuntimeError as e:
            assert "no property urls" in str(e)
    assert _FakeSession.calls == len(rg._SITEMAP_IMPERSONATES)


def test_begin_run_precedes_sitemap_fetch_in_main_source():
    """Structural guard: db.begin_run("raghdan") must appear before the sitemap_urls( call in
    main()'s source, so a raise from sitemap_urls still lands a scrape_runs row via the except-arm
    (same ordering bug class jazwtn fixed 2026-07-27 — the sitemap fetch used to run BEFORE
    begin_run, so a crash there produced zero scrape_runs telemetry)."""
    import inspect
    src = inspect.getsource(rg.main)
    assert src.index('db.begin_run("raghdan")') < src.index("sitemap_urls(s)")


if __name__ == "__main__":
    test_good_body_extracts_only_property_urls()
    test_first_attempt_success_no_retry()
    test_timeout_then_decoy_then_success_recovers()
    test_all_failures_raise_instead_of_returning_empty()
    test_begin_run_precedes_sitemap_fetch_in_main_source()
    print("OK — raghdan sitemap retry/rotation regression tests pass")
