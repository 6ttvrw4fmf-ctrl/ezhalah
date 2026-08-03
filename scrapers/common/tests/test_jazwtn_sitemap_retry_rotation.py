"""Regression tests for the 2026-08-03 jazwtn sitemap resilience fix (senior audit run #3).

jazwtn.sa's edge is flaky: the same sitemap URL answered 200/68,410 bytes and then a TCP reset
seconds apart from one residential IP, and the 08-03 GH run received an HTTP-success WAF decoy body
that parsed to zero /projects/ URLs (logged "Jazwtn: 0 candidate listings"). The old single-shot
`s.get(SITEMAP)` turned each crawl into a coin flip. The fix retries across TLS fingerprints with
backoff, treats an entry-less body as a FAILED attempt (decoy, never an empty catalog), and raises
after exhaustion so the run is marked failed while the prune guard protects the existing stock.

Hermetic: fake sessions only, no network, sleeps patched out.

Run: python -m pytest scrapers/common/tests/test_jazwtn_sitemap_retry_rotation.py -v
"""
import sys
from pathlib import Path
from unittest import mock

sys.path.insert(0, ".")

# Stub supabase + dotenv so importing scrapers.jazwtn.run is hermetic (same pattern as
# test_aqar_ppm_parse.py).
for name in ("supabase", "dotenv"):
    if name not in sys.modules:
        stub = mock.MagicMock()
        if name == "dotenv":
            stub.load_dotenv = lambda *a, **k: None
        sys.modules[name] = stub

from scrapers.jazwtn import run as jz  # noqa: E402

GOOD_BODY = """<?xml version="1.0"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
<url><loc>https://jazwtn.sa/projects/</loc></url>
<url><loc>https://jazwtn.sa/projects/villa-alnargis/</loc>
     <image:loc>https://jazwtn.sa/uploads/v1.jpg</image:loc></url>
<url><loc>https://jazwtn.sa/projects/shaqa-alyarmuk/</loc></url>
</urlset>"""

DECOY_BODY = "<html><head><title>Just a moment...</title></head><body>Checking your browser</body></html>"


class _Resp:
    def __init__(self, text, status_code=200):
        self.text = text
        self.status_code = status_code


class _FakeSession:
    """Scripted session: each get() pops the next behavior ('good'|'decoy'|'reset')."""
    script: list = []          # shared across instances — sitemap_entries builds fresh sessions
    calls: int = 0

    def __init__(self, *a, **k):
        self.proxies = None

    def get(self, url, timeout=None):
        _FakeSession.calls += 1
        step = _FakeSession.script.pop(0)
        if step == "reset":
            raise ConnectionError("curl: (35) Recv failure: Connection reset by peer")
        return _Resp(GOOD_BODY if step == "good" else DECOY_BODY)


def _run_scripted(script):
    _FakeSession.script = list(script)
    _FakeSession.calls = 0
    with mock.patch.object(jz.cc, "Session", _FakeSession), \
         mock.patch.object(jz.time, "sleep", lambda *_: None):
        return jz.sitemap_entries(_FakeSession())


def test_parse_good_body_extracts_entries_and_skips_archive_root():
    entries = jz._parse_sitemap(GOOD_BODY)
    assert [u for u, _ in entries] == [
        "https://jazwtn.sa/projects/villa-alnargis/",
        "https://jazwtn.sa/projects/shaqa-alyarmuk/",
    ]
    assert entries[0][1] == "https://jazwtn.sa/uploads/v1.jpg"
    assert entries[1][1] is None


def test_decoy_body_parses_to_zero_entries():
    assert jz._parse_sitemap(DECOY_BODY) == []


def test_first_attempt_success_no_retry():
    entries = _run_scripted(["good"])
    assert len(entries) == 2
    assert _FakeSession.calls == 1


def test_reset_then_decoy_then_success_recovers():
    # 08-02 shape (reset) followed by 08-03 shape (decoy), then a clean body on rotation.
    entries = _run_scripted(["reset", "decoy", "good"])
    assert len(entries) == 2
    assert _FakeSession.calls == 3


def test_all_decoys_raise_instead_of_returning_empty():
    # A run must NEVER treat a decoy as an empty catalog — 0 candidates with success status was
    # exactly the 08-03 silent failure.
    _FakeSession.script = ["decoy"] * len(jz._SITEMAP_IMPERSONATES)
    _FakeSession.calls = 0
    with mock.patch.object(jz.cc, "Session", _FakeSession), \
         mock.patch.object(jz.time, "sleep", lambda *_: None):
        try:
            jz.sitemap_entries(_FakeSession())
            raise AssertionError("expected RuntimeError after exhausting fingerprints")
        except RuntimeError as e:
            assert "no entries" in str(e)
    assert _FakeSession.calls == len(jz._SITEMAP_IMPERSONATES)


if __name__ == "__main__":
    test_parse_good_body_extracts_entries_and_skips_archive_root()
    test_decoy_body_parses_to_zero_entries()
    test_first_attempt_success_no_retry()
    test_reset_then_decoy_then_success_recovers()
    test_all_decoys_raise_instead_of_returning_empty()
    print("OK — jazwtn sitemap retry/rotation regression tests pass")
