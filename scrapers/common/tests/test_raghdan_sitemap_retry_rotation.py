"""Regression tests for the raghdan sitemap resilience fixes (2026-08-23, senior audit run #36).

TWO incidents, one file — the second fix supersedes the first, so both contracts are pinned here.

ROUND 1 (2026-08-23 08:26, PR #934). Two consecutive daily CI runs logged "Raghdan: 0 candidate
listings" (2026-08-22, 2026-08-23) and reported success. The old single-shot `s.get(SITEMAP)`
wrapped in a bare `except Exception: pass` swallowed the actual failure reason — timeout, reset,
and a genuinely empty catalog were all indistinguishable. That round added fingerprint rotation and
a loud raise. Those contracts still hold and are still tested below.

ROUND 2 (this file's current shape). Round 1 did not fix capture, because it misread the root
cause. Measured from a clean network 2026-08-23: raghdan.sa's sitemap.xml is >4.73 MB and STILL
unfinished after a 300 s transfer (no closing </urlset>) — its /ar/market/ analytics section
dwarfs the catalogue (5,115 market URLs before the property block, 4,105+ after, versus 376
properties), and the 376 contiguous /ar/property/ entries sit at bytes 2.98 MB–3.26 MB. So the
failure was never TLS blocking: `sess.get(..., timeout=30).text` is an all-or-nothing buffered
read, and a merely SLOW transfer raises and discards bytes that often already held every property
URL (`curl (28) timed out after 30000 ms with 148767 bytes received`). Rotating fingerprints just
re-ran the same doomed 30 s buffered read five times.

The fix streams the body and keeps what arrives. That introduces exactly one dangerous failure
mode, and most of the tests below exist for it: UNDER-enumeration. A truncated list handed to
prune_unseen() would inactivate live listings. So a partial body is trusted ONLY when the property
section is provably complete — a non-property <loc> after the final property <loc> proves the
contiguous block ended inside the bytes we hold. A body that ends mid-property-block is a FAILED
attempt, not a short catalogue.

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

_HEAD = """<?xml version="1.0"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
<url><loc>https://raghdan.sa/ar/</loc></url>
<url><loc>https://raghdan.sa/ar/properties/</loc></url>
<url><loc>https://raghdan.sa/ar/market/riyadh/</loc></url>
"""
# The real section ALTERNATES each listing's Arabic URL with its English twin (376 /ar/ and
# 375 /en/ entries). Fixtures must carry that shape: a fixture with /ar/ URLs only would let a
# broken end-of-section proof pass here while truncating the catalogue in production.
_PROPS = """<url><loc>https://raghdan.sa/ar/property/M6u0lHNjH8firnOTcrHu/</loc></url>
<url><loc>https://raghdan.sa/en/property/M6u0lHNjH8firnOTcrHu/</loc></url>
<url><loc>https://raghdan.sa/ar/property/z3xTvtSnlxtWyaJn9p8Vabcd/</loc></url>
<url><loc>https://raghdan.sa/en/property/z3xTvtSnlxtWyaJn9p8Vabcd/</loc></url>
"""
# The real document's shape: a large /ar/market/ tail AFTER the contiguous property block.
_TAIL = """<url><loc>https://raghdan.sa/ar/market/jeddah/</loc></url>
</urlset>"""

GOOD_BODY = _HEAD + _PROPS + _TAIL
# Streamed body cut off inside the property block — the exact under-enumeration hazard. Note it
# ends AFTER an /en/ twin: the English URL must not be mistaken for the end of the section.
TRUNCATED_MID_BLOCK = _HEAD + """<url><loc>https://raghdan.sa/ar/property/M6u0lHNjH8firnOTcrHu/</loc></url>
<url><loc>https://raghdan.sa/en/property/M6u0lHNjH8firnOTcrHu/</loc></url>
<url><loc>https://raghdan.sa/ar/prop"""
# Streamed body cut off AFTER the block ended — provably complete, must be accepted. Note the
# final <loc> is itself cut mid-tag: that trailing fragment must NOT count as the proof (only a
# fully parsed non-property <loc> does), so the complete market entry before it is what proves it.
TRUNCATED_AFTER_BLOCK = _HEAD + _PROPS + """<url><loc>https://raghdan.sa/ar/market/jeddah/</loc></url>
<url><loc>https://raghdan.sa/ar/market/dam"""
# Cut off in the very FIRST market <loc> after the block, so nothing parses past the properties.
# Unprovable, therefore refused — in the real 1.5 MB+ market tail this shape is vanishingly rare,
# but refusing it is what keeps the guard honest.
TRUNCATED_AT_BLOCK_EDGE = _HEAD + _PROPS + """<url><loc>https://raghdan.sa/ar/market/jed"""
DECOY_BODY = "<html><head><title>Just a moment...</title></head><body>Checking your browser</body></html>"

EXPECTED = [
    "https://raghdan.sa/ar/property/M6u0lHNjH8firnOTcrHu/",
    "https://raghdan.sa/ar/property/z3xTvtSnlxtWyaJn9p8Vabcd/",
]


class _Stream:
    """Minimal stand-in for curl_cffi's streaming response context manager."""

    def __init__(self, step):
        self.step = step

    def __enter__(self):
        if self.step == "reset_before_bytes":
            raise ConnectionError("curl: (35) Recv failure: Connection reset by peer")
        return self

    def __exit__(self, *a):
        return False

    def iter_content(self):
        body = {
            "good": GOOD_BODY,
            "decoy": DECOY_BODY,
            "trunc_mid": TRUNCATED_MID_BLOCK,
            "trunc_after": TRUNCATED_AFTER_BLOCK,
            "trunc_edge": TRUNCATED_AT_BLOCK_EDGE,
        }[self.step.replace("_then_die", "")]
        # Chunk it, so a mid-stream death lands with a partially filled buffer.
        raw = body.encode()
        for i in range(0, len(raw), 32):
            yield raw[i:i + 32]
        if self.step.endswith("_then_die"):
            raise TimeoutError("curl: (28) Operation timed out")


class _FakeSession:
    """Scripted session: each stream() pops the next behavior."""
    script: list = []          # shared across instances — sitemap_urls builds fresh sessions
    calls: int = 0

    def __init__(self, *a, **k):
        pass

    def stream(self, method, url, timeout=None):
        _FakeSession.calls += 1
        return _Stream(_FakeSession.script.pop(0))


def _run_scripted(script):
    _FakeSession.script = list(script)
    _FakeSession.calls = 0
    with mock.patch.object(rg.cc, "Session", _FakeSession), \
         mock.patch.object(rg.time, "sleep", lambda *_: None):
        return rg.sitemap_urls(_FakeSession())


def _expect_raise(script):
    _FakeSession.script = list(script)
    _FakeSession.calls = 0
    with mock.patch.object(rg.cc, "Session", _FakeSession), \
         mock.patch.object(rg.time, "sleep", lambda *_: None):
        try:
            rg.sitemap_urls(_FakeSession())
        except RuntimeError as e:
            return str(e)
    raise AssertionError("expected RuntimeError after exhausting fingerprints")


# ── Round 1 contracts (still in force) ────────────────────────────────────────

def test_good_body_extracts_only_property_urls():
    assert _run_scripted(["good"]) == EXPECTED


def test_first_attempt_success_no_retry():
    _run_scripted(["good"])
    assert _FakeSession.calls == 1


def test_timeout_then_decoy_then_success_recovers():
    entries = _run_scripted(["reset_before_bytes", "decoy", "good"])
    assert entries == EXPECTED
    assert _FakeSession.calls == 3


def test_all_failures_raise_instead_of_returning_empty():
    # A run must NEVER treat a timeout/decoy as an empty catalog — "0 candidate listings" with
    # exit-0 success was exactly the 2026-08-22/08-23 silent failure this fix closes.
    msg = _expect_raise(["reset_before_bytes"] * len(rg._SITEMAP_IMPERSONATES))
    assert "no provably complete property block" in msg
    assert _FakeSession.calls == len(rg._SITEMAP_IMPERSONATES)


def test_begin_run_precedes_sitemap_fetch_in_main_source():
    """Structural guard: db.begin_run("raghdan") must appear before the sitemap_urls( call in
    main()'s source, so a raise from sitemap_urls still lands a scrape_runs row via the except-arm
    (same ordering bug class jazwtn fixed 2026-07-27 — the sitemap fetch used to run BEFORE
    begin_run, so a crash there produced zero scrape_runs telemetry)."""
    import inspect
    src = inspect.getsource(rg.main)
    assert src.index('db.begin_run("raghdan")') < src.index("sitemap_urls(s)")


# ── Round 2 contracts: streaming + provable completeness ──────────────────────

def test_slow_transfer_that_dies_after_the_block_still_yields_the_catalogue():
    """THE ACTUAL 2026-08-22/08-23 OUTAGE. The transfer dies mid-document, but every property URL
    already arrived. The old buffered read discarded all of it; streaming must keep it."""
    assert _run_scripted(["good_then_die"]) == EXPECTED
    assert _FakeSession.calls == 1


def test_body_truncated_after_block_is_accepted_without_the_closing_tag():
    """No </urlset> — completeness is proven by a market <loc> following the last property."""
    assert _run_scripted(["trunc_after_then_die"]) == EXPECTED


def test_body_truncated_INSIDE_the_block_is_refused_not_silently_short():
    """The under-enumeration guard. A body cut off mid-property-block holds SOME properties, and
    accepting it would hand prune_unseen() a short list that inactivates live listings. It must
    count as a failed attempt — and when every attempt looks like that, raise."""
    msg = _expect_raise(["trunc_mid_then_die"] * len(rg._SITEMAP_IMPERSONATES))
    assert "no provably complete property block" in msg
    assert _FakeSession.calls == len(rg._SITEMAP_IMPERSONATES)


def test_body_cut_at_the_block_edge_is_refused():
    """Nothing parses past the last property, so completeness is unproven even though the
    catalogue happens to be whole. The guard errs toward refusing, never toward a short list."""
    msg = _expect_raise(["trunc_edge_then_die"] * len(rg._SITEMAP_IMPERSONATES))
    assert "no provably complete property block" in msg


def test_truncated_inside_block_recovers_on_a_later_fingerprint():
    """A partial body is a retryable condition, not a terminal one."""
    assert _run_scripted(["trunc_mid_then_die", "good"]) == EXPECTED
    assert _FakeSession.calls == 2


def test_english_twin_is_not_mistaken_for_the_end_of_the_property_section():
    """THE 249-OF-376 NEAR-MISS. Each listing's /ar/ URL is immediately followed by its /en/ twin,
    which is outside the HARVEST set but inside the property SECTION. Treating it as proof that
    the section ended stopped the live read a third of the way in, returning 249 of 376 URLs while
    reporting success — a short list that would drive prune_unseen() to inactivate 127 live
    listings. A body ending on an /en/ twin must therefore be unprovable."""
    body = _HEAD + """<url><loc>https://raghdan.sa/ar/property/M6u0lHNjH8firnOTcrHu/</loc></url>
<url><loc>https://raghdan.sa/en/property/M6u0lHNjH8firnOTcrHu/</loc></url>
"""
    urls, complete = rg._harvest_property_urls(body)
    assert urls == EXPECTED[:1]
    assert complete is False, "/en/ twin was accepted as end-of-section — the 249/376 bug is back"


def test_section_membership_is_wider_than_the_harvest_set():
    """Structural guard on the distinction that the bug turned on."""
    assert rg._PROP_SECTION_RE.match("https://raghdan.sa/en/property/M6u0lHNjH8firnOTcrHu/")
    assert rg._PROP_SECTION_RE.match("https://raghdan.sa/ar/property/M6u0lHNjH8firnOTcrHu/")
    assert not rg._PROP_SECTION_RE.match("https://raghdan.sa/ar/market/riyadh/")
    # …and the harvest set stays Arabic-only, so /en/ never enters the catalogue.
    assert not rg.PROP_URL_RE.match("https://raghdan.sa/en/property/M6u0lHNjH8firnOTcrHu/")


def test_harvest_completeness_predicate_directly():
    """Pin the predicate itself, so a refactor cannot quietly weaken it to 'any urls will do'."""
    urls, complete = rg._harvest_property_urls(GOOD_BODY)
    assert urls == EXPECTED and complete is True
    urls, complete = rg._harvest_property_urls(TRUNCATED_AFTER_BLOCK)
    assert urls == EXPECTED and complete is True
    urls, complete = rg._harvest_property_urls(TRUNCATED_MID_BLOCK)
    assert len(urls) == 1 and complete is False        # has properties, cannot prove completeness
    urls, complete = rg._harvest_property_urls(TRUNCATED_AT_BLOCK_EDGE)
    assert urls == EXPECTED and complete is False      # a half-written <loc> is not proof
    urls, complete = rg._harvest_property_urls(DECOY_BODY)
    assert urls == [] and complete is False
    # A body with zero properties but a clean close is still NOT a healthy empty catalog.
    urls, complete = rg._harvest_property_urls(_HEAD + "</urlset>")
    assert urls == [] and complete is False


def test_timeout_budget_is_sized_for_a_multi_megabyte_document():
    """The 30 s buffered read could not reach the property block at byte 2.98 MB; at the measured
    ~15.8 KB/s that mark arrives at ~206 s. Guard the budget so a future 'tidy-up' cannot quietly
    restore a value that cannot reach the catalogue."""
    assert rg._SITEMAP_TIMEOUT_S >= 300
    assert rg._SITEMAP_MAX_BYTES >= 8_000_000


class _BigStream:
    """A stream whose body is large enough to trip the completeness probe, so the early-exit path
    is actually exercised. Counts how many chunks the reader consumed."""

    #  >1 probe interval of market padding, then the property block, then a long market tail.
    PAD = "".join(f"<url><loc>https://raghdan.sa/ar/market/pad{i}/</loc></url>\n"
                  for i in range(9000))
    TAIL = "".join(f"<url><loc>https://raghdan.sa/ar/market/tail{i}/</loc></url>\n"
                   for i in range(9000)) + "</urlset>"
    BODY = (_HEAD + PAD + _PROPS + TAIL).encode()

    def __init__(self):
        self.consumed = 0

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def iter_content(self):
        for i in range(0, len(self.BODY), 4096):
            self.consumed += 1
            yield self.BODY[i:i + 4096]


def test_read_stops_once_the_property_block_is_proven_complete():
    """The origin serves ~15.8 KB/s and the document never ends, so reading to EOF is what made
    this unfetchable. Once completeness is proven the reader must stop, not keep pulling the
    /ar/market/ tail."""
    stream = _BigStream()

    class _S:
        def __init__(self, *a, **k):
            pass

        def stream(self, method, url, timeout=None):
            return stream

    with mock.patch.object(rg.cc, "Session", _S), \
         mock.patch.object(rg.time, "sleep", lambda *_: None):
        urls = rg.sitemap_urls(_S())

    assert urls == EXPECTED
    total_chunks = (len(_BigStream.BODY) + 4095) // 4096
    assert stream.consumed < total_chunks, "reader consumed the whole body instead of stopping"
    # It must still have read far enough to pass the property block.
    assert stream.consumed * 4096 > _BigStream.BODY.index(b"/ar/property/")


def test_sitemap_is_streamed_not_buffered():
    """Structural guard: the buffered .get(SITEMAP).text read is what discarded 148 KB of good
    bytes on every attempt. Reintroducing it would re-open the outage."""
    import inspect
    fetch_src = inspect.getsource(rg._stream_sitemap_body)
    assert ".stream(" in fetch_src
    assert "iter_content" in fetch_src
    caller_src = inspect.getsource(rg.sitemap_urls)
    assert "_stream_sitemap_body" in caller_src, "sitemap_urls must delegate to the streaming fetch"
    assert ".get(" not in caller_src, "the buffered .get() read must not come back"


if __name__ == "__main__":
    for _name, _fn in sorted(globals().items()):
        if _name.startswith("test_") and callable(_fn):
            _fn()
    print("OK — raghdan sitemap streaming/retry regression tests pass")
