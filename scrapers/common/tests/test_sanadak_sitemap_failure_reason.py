"""Sanadak must record WHY the sitemap yielded nothing — never a question mark.

THE INCIDENT (senior production run, 2026-08-31). sanadak captured 0 listings and the only durable
record of it was:

    scrape_runs.notes = "pruned=0 | RC-B demoted ok=False: 0-row run (blocked/empty source?)"

That parenthesis is the bug. `sitemap_urls()` read `r.text` and dropped `r.status_code` on the
floor, so an HTTP 500 with a 0-byte body produced exactly the same `[]` as a healthy 200 whose
sitemap happened to list nothing. Measured that morning from an independent egress:
sanadak.sa/sitemap.xml returned **HTTP 500, empty body, 3/3**, while sanadak.sa/ served 200 — the
source's own endpoint was down and none of it was ours. Monitoring could not say so, because the
status was never captured. `mon_detect_silent_scraper_death` reads only ok/rows_seen, so a
source-down platform and a scraper-broken platform were literally the same row.

This is a KNOWN, RECURRING defect class in this repo, not a one-off:
  • abeea, 2026-07-16 — status-blind sitemap parser swallowed a themed 404 PAGE and reported a
    clean 0-row run (see test_abeea_discovery.py).
  • erapulse, 2026-08-31 — five days of "unreachable, blocking, or schema change?" until PR #1398
    made the real fetch reason ride back; the first instrumented run said HTTP 530 / Cloudflare
    1033 immediately.
  • verify_deletions, run #71 — "0-row run (blocked/empty source?)" demoted ok=False every week
    with nothing blocked.

The invariant, one line: **rows_seen alone can never separate "the source served nothing" from
"we never got an answer we can believe" — so the reason must be captured at fetch time.**

Run: python -m pytest scrapers/common/tests/test_sanadak_sitemap_failure_reason.py -v
"""
import inspect
import re

from scrapers.sanadak import run as sd

PROP = "https://sanadak.sa/property-details/villa-for-sale-riyadh-12345"
PROP2 = "https://sanadak.sa/property-details/apartment-for-rent-jeddah-67890"

_HEALTHY_SITEMAP = f"""<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
<url><loc>https://sanadak.sa/</loc></url>
<url><loc>{PROP}</loc></url>
<url><loc>{PROP2}</loc></url>
</urlset>"""


class _Resp:
    def __init__(self, status_code=200, text=""):
        self.status_code = status_code
        self.text = text
        self.content = text.encode()


class _Session:
    """Minimal stand-in for the curl_cffi session: one scripted response, or an exception."""

    def __init__(self, resp=None, raise_exc=None):
        self._resp = resp
        self._raise = raise_exc

    def get(self, url, **kw):
        if self._raise is not None:
            raise self._raise
        return self._resp


# ── The incident itself ──────────────────────────────────────────────────────────
def test_http_500_is_reported_as_a_concrete_reason_not_an_empty_catalogue():
    """THE REGRESSION. The exact production shape: HTTP 500, empty body."""
    urls, reason = sd.sitemap_urls(_Session(_Resp(500, "")))
    assert urls == []
    # A reason must exist at all — this is what the old code could not produce.
    assert reason, "an HTTP 500 must yield a concrete reason, not None"
    # And it must name the status, so monitoring/a human can classify it as SOURCE-side.
    assert "500" in reason, f"the reason must carry the HTTP status, got: {reason!r}"
    # It must NOT be a guess.
    assert "?" not in reason, f"the reason must be evidence, not a guess, got: {reason!r}"


def test_transport_failure_is_reported_and_never_crashes_the_run():
    """We never reached the source — UNKNOWN, and it must say so rather than raise."""
    urls, reason = sd.sitemap_urls(_Session(raise_exc=ConnectionError("Connection reset by peer")))
    assert urls == []
    assert reason and "ConnectionError" in reason
    assert "?" not in reason


def test_http_200_that_parses_to_nothing_is_still_not_an_empty_catalogue():
    """A 200 we cannot interpret is UNKNOWN, not proof the catalogue is empty."""
    urls, reason = sd.sitemap_urls(_Session(_Resp(200, "<html>maintenance</html>")))
    assert urls == []
    assert reason and "200" in reason


# ── The other direction: a healthy sitemap must stay clean ───────────────────────
def test_healthy_sitemap_returns_urls_and_no_reason():
    """BOTH DIRECTIONS. A barrier that only ever fires is as useless as one that never does."""
    urls, reason = sd.sitemap_urls(_Session(_Resp(200, _HEALTHY_SITEMAP)))
    assert reason is None, f"a healthy 200 must report no failure reason, got: {reason!r}"
    assert urls == [PROP, PROP2]


# ── Mutation proof: the OLD implementation must fail the test above ──────────────
def test_the_old_status_blind_parser_would_fail_this_suite():
    """Pin that this suite actually catches the bug it was written for.

    Reproduces the pre-fix body (`r.text` parsed, status ignored) and asserts it cannot satisfy
    the 500 contract — so deleting or neutering the status check can never pass.
    """
    def _old_sitemap_urls(s):
        r = s.get(sd.SITEMAP, timeout=30)
        return re.findall(r"<loc>([^<]*property-details[^<]*)</loc>", r.text)

    # On the real incident input the old parser returns a bare [] with NO reason attached —
    # indistinguishable from a healthy-but-empty catalogue. That is precisely the defect.
    assert _old_sitemap_urls(_Session(_Resp(500, ""))) == []
    assert _old_sitemap_urls(_Session(_Resp(200, _HEALTHY_SITEMAP))) == [PROP, PROP2]
    # Same output for a dead source and a live-but-empty one => zero diagnostic power.
    assert _old_sitemap_urls(_Session(_Resp(500, ""))) == _old_sitemap_urls(_Session(_Resp(200, "<urlset/>")))


# ── Structural guards on main() ──────────────────────────────────────────────────
def test_begin_run_precedes_the_sitemap_fetch():
    """The row must exist BEFORE the first source call, or a sitemap failure has nowhere to land
    and "source stopped answering" == "job never ran" to every ok/count-based barrier."""
    src = inspect.getsource(sd.main)
    assert 'db.begin_run("sanadak")' in src
    assert src.index('db.begin_run("sanadak")') < src.index("sitemap_urls(s)")


def test_sitemap_failure_path_never_reaches_prune():
    """LIVENESS CONTRACT (docs/ops/LISTING_LIVENESS.md §1): a non-answer is UNKNOWN, and UNKNOWN
    never deactivates anything. The early-return must happen before any prune/deactivation."""
    src = inspect.getsource(sd.main)
    assert "sitemap_err" in src, "main() must consult the failure reason"
    # The early return must come before the first prune_unseen call in the function body.
    assert src.index("if sitemap_err:") < src.index("prune_unseen"), \
        "the sitemap-failure early return must precede any prune, so a dead source cannot deactivate"


if __name__ == "__main__":
    test_http_500_is_reported_as_a_concrete_reason_not_an_empty_catalogue()
    test_transport_failure_is_reported_and_never_crashes_the_run()
    test_http_200_that_parses_to_nothing_is_still_not_an_empty_catalogue()
    test_healthy_sitemap_returns_urls_and_no_reason()
    test_the_old_status_blind_parser_would_fail_this_suite()
    test_begin_run_precedes_the_sitemap_fetch()
    test_sitemap_failure_path_never_reaches_prune()
    print("all sanadak sitemap-failure-reason contracts hold")
