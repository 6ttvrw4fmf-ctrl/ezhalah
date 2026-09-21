"""The oracle-feasibility judgement, EXECUTED against every failure shape this repo has paid for.

Each case below is a real measurement from `scrapers/absence-only-prune.txt` or
`docs/ops/LISTING_LIVENESS.md`, replayed through the real `judge()`. The point is not that the
function has opinions — it is that it refuses the four specific wrong conclusions that were actually
reached by people looking at these exact numbers:

  · an egress block read as "the platform has no signal"            (13 rows of the ledger)
  · live listings answering 404 read as deaths                      (gathern, 83% false-death rate)
  · a marker that also appears on live pages read as a signal       (fursaghyr)
  · one shared SPA shell read as "the page renders, so 200 = alive" (aqaratikom, abeea)

    python -m pytest scrapers/common/tests/test_oracle_feasibility.py -q
"""
from __future__ import annotations

from scrapers.common.oracle_feasibility import (
    Read,
    absence_only_platforms,
    judge,
    markers_in,
    probe_platform,
    title_of,
)


def _r(cohort, status, body="", ad="A1", moved=False):
    return Read(ad, f"https://x/{ad}", cohort, status, len(body), title_of(body), moved,
                markers_in(body))


LIVE_PAGE = "<html><title>شقة للإيجار في الرياض</title><body>ثلاث غرف</body></html>"
DEAD_404 = "<html><title>404</title><body>لم يتم العثور على الصفحة</body></html>"


def test_no_reachable_live_cohort_is_unusable_not_impossible():
    """THE LEDGER'S 13 'EGRESS BLOCKED' ROWS. A network failure must never become a claim about
    the platform — that conflation is what LISTING_LIVENESS.md §9.4 exists to forbid."""
    v = judge("abwbna", [_r("live", None) for _ in range(10)] + [_r("dead", None) for _ in range(10)])
    assert v.verdict == "UNUSABLE_READ"
    assert "about our network" in v.why


def test_live_rows_answering_404_is_the_gathern_signature_and_refuses_a_verdict():
    """Measured 2026-09-21: a cloud egress got 404 on 10 of 12 listings the crawl had just served
    alive. A 404-means-gone oracle there manufactures deaths on command."""
    reads = [_r("live", 404, DEAD_404) for _ in range(8)] + [_r("live", 200, LIVE_PAGE) for _ in range(2)]
    reads += [_r("dead", 404, DEAD_404) for _ in range(10)]
    v = judge("gathern", reads)
    assert v.verdict == "UNUSABLE_READ"
    assert "KNOWN-LIVE" in v.why


def test_clean_status_separation_is_an_oracle():
    v = judge("jazwtn",
              [_r("live", 200, LIVE_PAGE) for _ in range(10)]
              + [_r("dead", 404, DEAD_404) for _ in range(10)])
    assert v.verdict == "ORACLE_POSSIBLE"
    assert "404/410" in v.why


def test_a_marker_that_also_appears_on_live_pages_is_disqualified():
    """FURSAGHYR. «مؤجر» sat inside the advertising prose of LIVE listings («مؤجرة حاليًا بعقود
    شهرية» — a selling point of a rental investment). Gating on it would deactivate live stock."""
    live_with_prose = "<html><title>عمارة</title><body>مؤجرة حاليًا بعقود شهرية</body></html>"
    v = judge("fursaghyr",
              [_r("live", 200, live_with_prose) for _ in range(10)]
              + [_r("dead", 200, "<html><title>عمارة</title><body>مؤجر</body></html>") for _ in range(8)])
    assert "مؤجر" in v.disqualified_markers
    assert v.usable_markers == ()
    assert v.verdict == "NO_SIGNAL_ON_THIS_PAGE"
    assert "furniture" not in v.why  # the word is in the report, not the verdict text
    assert "fursaghyr mistake" in v.why


def test_identical_shell_is_named_as_the_aqaratikom_shape():
    """12 dead + 12 live returned a byte-identical 5,795-byte shell with one shared title."""
    shell = "<html><title>عقاراتكم</title><body>" + ("x" * 5000) + "</body></html>"
    v = judge("aqaratikom",
              [_r("live", 200, shell) for _ in range(12)] + [_r("dead", 200, shell) for _ in range(12)])
    assert v.verdict == "NO_SIGNAL_ON_THIS_PAGE"
    assert v.distinct_live_titles == 1 and v.distinct_live_bytes == 1
    assert "one shared shell" in v.why
    assert "API" in v.why


def test_distinct_titles_on_both_cohorts_is_still_no_signal():
    """SATEL. 12/12 dead and 12/12 live answered 200 with DISTINCT per-listing titles and none of
    18 candidate markers. A page that renders is not an ad that is live."""
    live = [_r("live", 200, f"<html><title>عقار {i}</title><body>تفاصيل {i}</body></html>", ad=f"L{i}")
            for i in range(12)]
    dead = [_r("dead", 200, f"<html><title>عقار {90+i}</title><body>تفاصيل {90+i}</body></html>", ad=f"D{i}")
            for i in range(12)]
    v = judge("satel", live + dead)
    assert v.verdict == "NO_SIGNAL_ON_THIS_PAGE"
    assert v.distinct_live_titles == 12          # distinct, and it still proves nothing
    assert "status field" in v.why or "status endpoint" in v.why or "source-published status" in v.why


def test_a_dead_only_marker_is_an_oracle_candidate():
    """AQARCITY's real shape: a soft-expire 200 carrying «الإعلان منتهي», absent from live pages."""
    v = judge("aqarcity",
              [_r("live", 200, LIVE_PAGE) for _ in range(10)]
              + [_r("dead", 200, "<html><title>إعلان</title><body>الإعلان منتهي</body></html>") for _ in range(9)])
    assert v.verdict == "ORACLE_POSSIBLE"
    assert "الإعلان منتهي" in v.usable_markers
    assert "canary" in v.why


def test_no_dead_cohort_cannot_license_a_kill():
    v = judge("alhoshan", [_r("live", 200, LIVE_PAGE) for _ in range(12)])
    assert v.verdict == "NO_DEAD_COHORT"
    assert "cannot license a kill" in v.why


def test_probe_interleaves_the_two_cohorts():
    """A source that degrades halfway through would otherwise hit one cohort and not the other,
    and the difference would read as a signal."""
    order: list[str] = []

    def fetch(u):
        order.append(u)
        return 200, LIVE_PAGE, False

    live = [{"ad_number": f"L{i}", "listing_url": f"https://x/L{i}"} for i in range(3)]
    dead = [{"ad_number": f"D{i}", "listing_url": f"https://x/D{i}"} for i in range(3)]
    probe_platform("p", live, dead, fetch)
    assert order == ["https://x/L0", "https://x/D0", "https://x/L1", "https://x/D1",
                     "https://x/L2", "https://x/D2"]


def test_a_probe_that_throws_is_unreachable_never_dead():
    def boom(_u):
        raise TimeoutError("connection reset")

    live = [{"ad_number": "L1", "listing_url": "https://x/L1"}]
    dead = [{"ad_number": "D1", "listing_url": "https://x/D1"}]
    v, reads = probe_platform("p", live, dead, boom)
    assert all(r.status is None for r in reads)
    assert v.verdict == "UNUSABLE_READ"


def test_a_row_with_no_stored_url_is_unreachable_not_a_death():
    live = [{"ad_number": "L1", "listing_url": ""}]
    dead = [{"ad_number": "D1", "listing_url": None}]
    v, reads = probe_platform("p", live, dead, lambda u: (200, LIVE_PAGE, False))
    assert [r.error for r in reads] == ["no stored listing_url", "no stored listing_url"]
    assert v.verdict == "UNUSABLE_READ"


def test_the_worklist_is_discovered_from_the_committed_ledger():
    """The platform list is DISCOVERED from scrapers/absence-only-prune.txt, so it cannot rot into
    a hardcoded list that quietly stops covering a platform added to the gap tomorrow.

    It lives in the PURE module, not the runner: reaching it through the runner would drag
    `requests` into a test that needs no network, which is exactly how this file first failed CI.
    """
    plats = absence_only_platforms()
    assert len(plats) >= 20, plats
    assert "fursaghyr" in plats and "aqaratikom" in plats and "satel" in plats
    assert all(p and " " not in p and not p.startswith("#") for p in plats)


def test_a_source_that_is_DOWN_is_an_unusable_read_not_a_platform_limitation():
    """MEASURED IN THIS PROBE'S OWN FIRST RUN, 2026-09-21, and it was wrong.

    sadin's site has been down since 09-07. The probe fetched ten live and ten dead rows, got HTTP
    502 on all twenty, and returned NO_SIGNAL_ON_THIS_PAGE — describing a 502 error page as "one
    shared shell for every id, the aqaratikom shape". A failed read rendered as a platform
    limitation, by the instrument built to catch failed reads rendered as platform limitations.

    Root cause: `reached` meant `status is not None`, so any answer counted as a read. It now asks
    http_liveness.read_is_unbelievable() — the same law that governs every real liveness decision,
    so this can never drift from what the kill path believes.
    """
    mk = lambda c: [Read(f"{c}{i}", "u", c, 502, 1500, "Bad Gateway", False, ()) for i in range(10)]
    v = judge("sadin", mk("live") + mk("dead"))
    assert v.verdict == "UNUSABLE_READ"
    assert "502" in v.why and "source is broken" in v.why
    assert "aqaratikom" not in v.why      # the wrong answer it used to give


def test_every_unbelievable_shape_the_law_names_is_refused_as_a_control():
    """403 (blocked), 429 (throttled), 5xx (source broken) and an empty body each mean we did not
    read an answer. None of them may support a verdict about the platform's page."""
    for status, nbytes in ((403, 900), (429, 900), (500, 900), (503, 900), (200, 0)):
        mk = lambda c: [Read(f"{c}{i}", "u", c, status, nbytes, "", False, ()) for i in range(10)]
        v = judge("p", mk("live") + mk("dead"))
        assert v.verdict == "UNUSABLE_READ", f"status={status} bytes={nbytes} -> {v.verdict}"


def test_a_404_on_live_rows_is_still_the_gathern_signature_not_an_unusable_read():
    """The law deliberately does NOT call 404 unbelievable — it is a legitimate death signal. The
    gathern case (live rows answering 404) must keep its own, more specific diagnosis."""
    reads = [_r("live", 404, DEAD_404) for _ in range(9)] + [_r("live", 200, LIVE_PAGE)]
    reads += [_r("dead", 404, DEAD_404) for _ in range(10)]
    v = judge("gathern", reads)
    assert v.verdict == "UNUSABLE_READ"
    assert "KNOWN-LIVE" in v.why          # the specific one, not the generic law message
