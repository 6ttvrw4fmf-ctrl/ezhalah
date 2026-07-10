"""Proves GitHub Actions can tell apart the three states the owner requires:
    ✅ successful scrape   ✅ legitimately-empty category   ❌ real scraper failure

Each test drives the REAL run.fetch_page / scrape_slice / main against a scripted fake HTTP session,
and asserts BOTH the fine-grained classification (PageResult.reason) AND the coarse signal GitHub
actually reads: main()'s exit code (0=green, 1=red) and the ok flag written to scrape_runs.

Design invariant under test: a slice is reported ✅-empty ONLY on a positively-parsed searchResult
with count==0. No transport/parse failure can reach that state, so a failure can never hide as empty.
"""
from __future__ import annotations

import sys

from scrapers.wasalt import run
from scrapers.wasalt.tests.conftest import (
    CLOUDFLARE_CHALLENGE, FakeResponse, FakeSession, next_data_bad_json, next_data_html,
    next_data_missing_searchresult, sample_prop,
)


# ─────────────────────────────────────────────────────────────────────────────────────────────────
# 1. Legitimately empty category  →  ✅  (reached the API, count==0)
# ─────────────────────────────────────────────────────────────────────────────────────────────────
def test_empty_category_is_success(run_main):
    s = FakeSession([FakeResponse(200, next_data_html(count=0, total_pages=0, properties=[]))])
    # fetch_page classifies it as a reached-but-empty result…
    pr = run.fetch_page(s, "rent", "residential", "farm", 1)
    assert pr.ok is True and pr.reason == run.REASON_OK and pr.count == 0

    # …and main reports GREEN with an explicit EMPTY CATEGORY note (no phantom failure).
    s2 = FakeSession([FakeResponse(200, next_data_html(count=0, total_pages=0, properties=[]))])
    code, end = run_main(s2, slug="farm", deal="rent")
    assert code == 0
    assert end["ok"] is True
    assert "EMPTY CATEGORY" in end["notes"]
    assert end["rows_upserted"] == 0


# ─────────────────────────────────────────────────────────────────────────────────────────────────
# 2. Cloudflare challenge  →  ❌  (200 shell, no __NEXT_DATA__)
# ─────────────────────────────────────────────────────────────────────────────────────────────────
def test_cloudflare_challenge_is_failure(run_main):
    s = FakeSession([FakeResponse(200, CLOUDFLARE_CHALLENGE)])
    pr = run.fetch_page(s, "sale", "residential", "apartment", 1)
    assert pr.ok is False and pr.reason == run.REASON_NO_NEXT_DATA
    assert "cloudflare" in pr.detail.lower()
    assert s.calls == 1  # a persistent CF wall is NOT retried into a silent zero

    s2 = FakeSession([FakeResponse(200, CLOUDFLARE_CHALLENGE)])
    code, end = run_main(s2, slug="apartment", deal="sale")
    assert code == 1
    assert end["ok"] is False
    assert "REAL FAILURE" in end["notes"] and "cloudflare" in end["notes"].lower()


# ─────────────────────────────────────────────────────────────────────────────────────────────────
# 3. HTTP error (e.g. 403/503)  →  ❌  (non-200 after 3 retries)
# ─────────────────────────────────────────────────────────────────────────────────────────────────
def test_http_error_is_failure(run_main):
    s = FakeSession([FakeResponse(403, "forbidden")], loop=True)
    pr = run.fetch_page(s, "sale", "residential", "apartment", 1)
    assert pr.ok is False and pr.reason == run.REASON_HTTP and pr.detail == "HTTP 403"
    assert s.calls == 3  # retried the full budget before giving up

    s2 = FakeSession([FakeResponse(503, "unavailable")], loop=True)
    code, end = run_main(s2, slug="apartment", deal="sale")
    assert code == 1 and end["ok"] is False and "http_error" in end["notes"]


# ─────────────────────────────────────────────────────────────────────────────────────────────────
# 4. Timeout  →  ❌  (transport exception classified as timeout)
# ─────────────────────────────────────────────────────────────────────────────────────────────────
def test_timeout_is_failure(run_main):
    s = FakeSession([TimeoutError("Operation timed out after 30000 ms")], loop=True)
    pr = run.fetch_page(s, "sale", "residential", "villa-townhouse", 1)
    assert pr.ok is False and pr.reason == run.REASON_TIMEOUT
    assert s.calls == 3

    s2 = FakeSession([TimeoutError("connection timed out")], loop=True)
    code, end = run_main(s2, slug="villa-townhouse", deal="sale")
    assert code == 1 and end["ok"] is False and "timeout" in end["notes"]


# ─────────────────────────────────────────────────────────────────────────────────────────────────
# 5. Invalid JSON / API response  →  ❌  (bad_json, and the searchResult-missing hole)
# ─────────────────────────────────────────────────────────────────────────────────────────────────
def test_malformed_json_is_failure(run_main):
    s = FakeSession([FakeResponse(200, next_data_bad_json())])
    pr = run.fetch_page(s, "sale", "residential", "land", 1)
    assert pr.ok is False and pr.reason == run.REASON_BAD_JSON

    s2 = FakeSession([FakeResponse(200, next_data_bad_json())])
    code, end = run_main(s2, slug="land", deal="sale")
    assert code == 1 and end["ok"] is False


def test_missing_search_result_is_failure_not_empty(run_main):
    """THE hidden-failure regression: valid JSON but searchResult vanished (API shape changed). The
    old `searchResult or {}` → count=0 would have logged this as a green 'empty'. It must be ❌."""
    s = FakeSession([FakeResponse(200, next_data_missing_searchresult())])
    pr = run.fetch_page(s, "sale", "residential", "apartment", 1)
    assert pr.ok is False and pr.reason == run.REASON_NO_SEARCH_RESULT

    s2 = FakeSession([FakeResponse(200, next_data_missing_searchresult())])
    code, end = run_main(s2, slug="apartment", deal="sale")
    assert code == 1
    assert end["ok"] is False
    assert "EMPTY CATEGORY" not in end["notes"]  # must NOT be misclassified as empty


# ─────────────────────────────────────────────────────────────────────────────────────────────────
# 6. Proxy failure  →  ❌  (connection exception, not a timeout)
# ─────────────────────────────────────────────────────────────────────────────────────────────────
def test_proxy_failure_is_failure(run_main):
    exc = ConnectionError("Failed to connect to proxy gw.dataimpulse.com port 823: Connection refused")
    s = FakeSession([exc], loop=True)
    pr = run.fetch_page(s, "sale", "residential", "apartment", 1)
    assert pr.ok is False and pr.reason == run.REASON_NETWORK
    assert s.calls == 3

    s2 = FakeSession([exc], loop=True)
    code, end = run_main(s2, slug="apartment", deal="sale")
    assert code == 1 and end["ok"] is False and "network_error" in end["notes"]


# ─────────────────────────────────────────────────────────────────────────────────────────────────
# 7. Successful populated scrape  →  ✅  (reached, count>0, rows upserted)
# ─────────────────────────────────────────────────────────────────────────────────────────────────
def test_populated_scrape_is_success(run_main):
    page = FakeResponse(200, next_data_html(count=96, total_pages=3,
                                            properties=[sample_prop(1), sample_prop(2)]))
    # scrape_slice fetches page1 once, then pages 2 & 3 → script 3 identical populated pages.
    s = FakeSession([page, page, page])
    code, end = run_main(s, slug="apartment", deal="sale", pages=3)
    assert code == 0
    assert end["ok"] is True
    assert end["rows_upserted"] == 6  # 2 rows × 3 pages
    assert "upserted=6" in end["notes"]


# ─────────────────────────────────────────────────────────────────────────────────────────────────
# 8. A later page failing AFTER page 1 succeeded does NOT sink a slice that already delivered rows.
# ─────────────────────────────────────────────────────────────────────────────────────────────────
def test_partial_pagination_after_page1_still_success(run_main):
    good = FakeResponse(200, next_data_html(count=96, total_pages=3, properties=[sample_prop(1)]))
    # page1 good (reused), page2 fetch → good, page3 fetch → hard 403 loop.
    s = FakeSession([good, good, FakeResponse(403), FakeResponse(403), FakeResponse(403)])
    code, end = run_main(s, slug="apartment", deal="sale", pages=3)
    assert code == 0 and end["ok"] is True and end["rows_upserted"] >= 1


# ─────────────────────────────────────────────────────────────────────────────────────────────────
# 9. SliceResult state machine — the three mutually-exclusive verdicts.
# ─────────────────────────────────────────────────────────────────────────────────────────────────
def test_sliceresult_states():
    unreached = run.SliceResult("farm", "rent", "residential", reached=False, reason=run.REASON_HTTP)
    empty = run.SliceResult("farm", "rent", "residential", reached=True, count=0, upserted=0)
    ok = run.SliceResult("apartment", "sale", "residential", reached=True, count=96, upserted=64)
    anomaly = run.SliceResult("apartment", "sale", "residential", reached=True, count=96, upserted=0)

    assert unreached.failed and not unreached.empty
    assert empty.empty and not empty.failed
    assert not ok.failed and not ok.empty
    assert anomaly.failed and not anomaly.empty  # API claims listings, none upserted → ❌


# ─────────────────────────────────────────────────────────────────────────────────────────────────
# 10. --all aggregation: one blocked slice among many empties/populated ones fails the whole run.
# ─────────────────────────────────────────────────────────────────────────────────────────────────
def _drive_all(monkeypatch, results_iter):
    monkeypatch.setattr(run, "session", lambda: object())
    monkeypatch.setattr(sys, "argv", ["run.py", "--all", "--pages", "3"])
    it = iter(results_iter)
    default = run.SliceResult("x", "sale", "residential", reached=True, count=0, upserted=0)  # empty
    monkeypatch.setattr(run, "scrape_slice",
                        lambda *a, **k: next(it, default))
    code = run.main()
    from scrapers.wasalt.tests.conftest import _db
    return code, _db.RUN_ENDED[-1]


def test_all_sweep_one_failure_reddens_run(monkeypatch):
    blocked = run.SliceResult("apartment", "sale", "residential", reached=False,
                              reason=run.REASON_NO_NEXT_DATA, detail="cloudflare-challenge")
    code, end = _drive_all(monkeypatch, [blocked])  # slice 1 blocked, remaining 33 default→empty
    assert code == 1 and end["ok"] is False and "REAL FAILURE" in end["notes"]


def test_all_sweep_all_empty_is_green(monkeypatch):
    code, end = _drive_all(monkeypatch, [])  # every slice → default empty
    assert code == 0 and end["ok"] is True and "EMPTY CATEGORY" in end["notes"]


def test_all_sweep_mixed_populated_and_empty_is_green(monkeypatch):
    populated = run.SliceResult("apartment", "sale", "residential", reached=True, count=96, upserted=64)
    code, end = _drive_all(monkeypatch, [populated])  # 1 populated, rest empty
    assert code == 0 and end["ok"] is True and "upserted=64" in end["notes"]
