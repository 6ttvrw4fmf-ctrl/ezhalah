"""A source that REFUSES to answer must never be recorded as a source with nothing to say.

gathern's crawl paged each city until an empty page. `fetch_page()` returned a bare `[], {}` for
BOTH "HTTP 200, zero items" (a genuine end of catalogue) and "the source declined" (a hard 4xx, or
retries exhausted under throttling). So:

  * a refused page 1 made crawl() print «no monthly units» and skip the whole city, and
  * two refused pages mid-city satisfied the `empties >= 2` end-of-catalogue rule,

while the run still reported ok=true. A platform that starts rate-limiting therefore shrinks the
crawl silently, and every count-based barrier stays green because the counts it compares are
themselves the truncated ones. §10: never let a scraper failure cascade.

These tests pin the distinction and the two places it matters.
"""
import time

import scrapers.gathern.run as g


class _Resp:
    def __init__(self, status, payload=None):
        self.status_code = status
        self._payload = payload

    def json(self):
        if self._payload is None:
            raise ValueError("not json")
        return self._payload


class _Session:
    """Serves a scripted list of responses, then repeats the last one forever."""
    def __init__(self, responses):
        self._responses = list(responses)
        self.calls = 0

    def get(self, url, params=None, timeout=None):
        self.calls += 1
        i = min(self.calls - 1, len(self._responses) - 1)
        r = self._responses[i]
        if isinstance(r, Exception):
            raise r
        return r


def _fast(monkeypatch):
    """Neutralise pacing/backoff sleeps, and map units trivially — these tests are about the
    PAGING outcome logic, not about map_listing()'s field extraction."""
    monkeypatch.setattr(g, "_throttle", lambda: None)
    monkeypatch.setattr(time, "sleep", lambda *_a, **_k: None)
    monkeypatch.setattr(g, "map_listing", lambda it: {"ad_number": f"GA{it['id']}"})


def _unit(uid):
    return {"id": uid, "chalet_id": 1, "name": f"unit {uid}", "city_en": "Riyadh",
            "final_price": 3000, "price": 3000}


def _page(units):
    return _Resp(200, {"items": [_unit(u) for u in units],
                       "_meta": {"totalCount": 999, "pageCount": 9, "perPage": 12}})


def test_status_distinguishes_empty_from_refusal(monkeypatch):
    _fast(monkeypatch)

    items, _, status = g.fetch_page(_Session([_Resp(200, {"items": [], "_meta": {}})]), 1, 1, "a", "b")
    assert (items, status) == ([], "empty")          # a real answer

    items, _, status = g.fetch_page(_Session([_Resp(403)]), 1, 1, "a", "b")
    assert (items, status) == ([], "http_403")       # NOT an empty catalogue

    items, _, status = g.fetch_page(_Session([_Resp(429)]), 1, 1, "a", "b")
    assert (items, status) == ([], "exhausted")      # throttled past its retries

    items, _, status = g.fetch_page(_Session([_page([1, 2])]), 1, 1, "a", "b")
    assert status == "ok" and len(items) == 2


def test_a_refused_city_is_counted_as_failed_not_as_having_no_units(monkeypatch):
    """FAILS on the pre-fix code, which counted this city as an ordinary empty one and moved on."""
    _fast(monkeypatch)
    s = _Session([_Resp(403)])
    _, _, _, outcomes = g.crawl(s, [{"id": 1, "name_en": "Riyadh"}], "a", "b", verbose=False)
    assert outcomes.get("failed") == 1, outcomes
    assert outcomes.get("empty", 0) == 0, outcomes


def test_a_genuinely_empty_city_is_still_counted_as_empty(monkeypatch):
    """The fix must not turn honest empties into false alarms."""
    _fast(monkeypatch)
    s = _Session([_Resp(200, {"items": [], "_meta": {"totalCount": 0}})])
    _, _, _, outcomes = g.crawl(s, [{"id": 1, "name_en": "Tabuk"}], "a", "b", verbose=False)
    assert outcomes.get("empty") == 1, outcomes
    assert outcomes.get("failed", 0) == 0, outcomes


def test_a_refusal_midway_marks_the_city_incomplete_not_finished(monkeypatch):
    """A city truncated by a refusal must not be presented as a fully-crawled city.

    Pre-fix, page 2 returning `[]` from a 429 counted toward `empties >= 2` and the city was
    recorded as completely crawled — the silent-truncation half of the same bug.
    """
    _fast(monkeypatch)
    s = _Session([_page([1, 2]), _Resp(429)])
    rows, _, _, outcomes = g.crawl(s, [{"id": 1, "name_en": "Jeddah"}], "a", "b", verbose=False)
    assert outcomes.get("incomplete") == 1, outcomes
    assert outcomes.get("ok", 0) == 0, outcomes
    assert len(rows) == 2                      # what it DID capture is still kept, never discarded


def test_a_city_that_ends_on_real_empty_pages_is_complete(monkeypatch):
    _fast(monkeypatch)
    empty = _Resp(200, {"items": [], "_meta": {}})
    s = _Session([_page([1, 2]), empty, empty])
    rows, _, _, outcomes = g.crawl(s, [{"id": 1, "name_en": "Riyadh"}], "a", "b", verbose=False)
    assert outcomes.get("ok") == 1, outcomes
    assert outcomes.get("incomplete", 0) == 0, outcomes
    assert len(rows) == 2


def test_failure_reasons_are_tallied_so_throttle_vs_block_is_queryable(monkeypatch):
    """The COUNT says coverage dropped; only the REASON says whether that is our problem.

    429/exhausted means the source throttled us (pace/parallelism is ours to fix); 403 means we are
    blocked; 404 means the endpoint moved. These end up in the run's notes precisely so the question
    is answerable from SQL later instead of by digging through an expired CI log.
    """
    _fast(monkeypatch)
    cities = [{"id": 1, "name_en": "A"}, {"id": 2, "name_en": "B"}]
    s = _Session([_Resp(403)])
    _, _, _, outcomes = g.crawl(s, cities, "a", "b", verbose=False)
    assert outcomes.get("failed") == 2, outcomes
    assert outcomes.get("reason:http_403") == 2, outcomes

    s = _Session([_Resp(429)])
    _, _, _, outcomes = g.crawl(s, [{"id": 1, "name_en": "A"}], "a", "b", verbose=False)
    assert outcomes.get("reason:exhausted") == 1, outcomes


def test_a_clean_run_records_no_reasons_at_all(monkeypatch):
    """No failures ⇒ no reason keys ⇒ the notes stay short and a clean run reads as clean."""
    _fast(monkeypatch)
    empty = _Resp(200, {"items": [], "_meta": {}})
    s = _Session([_page([1]), empty, empty])
    _, _, _, outcomes = g.crawl(s, [{"id": 1, "name_en": "A"}], "a", "b", verbose=False)
    assert not [k for k in outcomes if k.startswith("reason:")], outcomes


def test_a_rejection_is_captured_verbatim_with_its_request(monkeypatch):
    """"http_400" is a symptom. The API's own error body plus the exact params is the root cause.

    Without this, the only route to the offending parameter is guessing at an unobserved request —
    which is precisely how the sadin selector fix failed earlier the same day.
    """
    _fast(monkeypatch)
    g._REJECTS.clear()
    r = _Resp(400)
    r.text = '{"name":"Bad Request","message":"city must be an integer."}'
    g.fetch_page(_Session([r]), 820, 1, "2026-09-04", "2026-10-04")

    assert len(g._REJECTS) == 1
    rec = g._REJECTS[0]
    assert rec["city"] == 820 and rec["code"] == 400
    assert rec["params"]["check_in"] == "2026-09-04"      # the exact request is preserved
    assert rec["params"]["has_available"] == "true"
    assert "city must be an integer" in rec["body"]        # the source's own words
    assert "city=820" in g.reject_report()


def test_reject_capture_is_bounded(monkeypatch):
    """A platform-wide rejection must not turn the log into a flood."""
    _fast(monkeypatch)
    g._REJECTS.clear()
    r = _Resp(400)
    r.text = "nope"
    for i in range(20):
        g.fetch_page(_Session([r]), i, 1, "a", "b")
    assert len(g._REJECTS) == g._REJECT_LIMIT


def test_a_healthy_run_records_no_rejections(monkeypatch):
    _fast(monkeypatch)
    g._REJECTS.clear()
    g.fetch_page(_Session([_page([1])]), 1, 1, "a", "b")
    assert g._REJECTS == [] and g.reject_report() == ""


def test_a_400_that_says_too_many_requests_is_a_THROTTLE_and_is_retried(monkeypatch):
    """gathern rate-limits with HTTP 400, not 429 — observed live 2026-09-03, run 33816958296.

    The rejected request was byte-identical in shape to ones that succeeded seconds earlier in the
    same shard; the body read {"success":false,"message":"Too many requests. Please try again
    later."}. Classifying that as a permanent client error and giving up is what cost the crawl
    whole cities. FAILS on the pre-fix code, which returned http_400 after a single attempt.
    """
    _fast(monkeypatch)
    g._REJECTS.clear()
    throttled = _Resp(400)
    throttled.text = '{"success":false,"message":"Too many requests. Please try again later.","errors":null}'
    s = _Session([throttled, throttled, _page([1, 2])])

    items, _, status = g.fetch_page(s, 1626, 2, "2026-09-04", "2026-10-04")
    assert status == "ok" and len(items) == 2, status   # it retried through the throttle
    assert s.calls == 3
    assert g._REJECTS == []                             # a throttle is not a rejection to report


def test_a_sustained_throttle_ends_as_exhausted_not_as_a_hard_400(monkeypatch):
    """Routing matters: 'exhausted' says the source throttled us, http_400 says our request is bad."""
    _fast(monkeypatch)
    g._REJECTS.clear()
    throttled = _Resp(400)
    throttled.text = '{"message":"Too many requests. Please try again later."}'
    items, _, status = g.fetch_page(_Session([throttled]), 1, 1, "a", "b")
    assert (items, status) == ([], "exhausted"), status


def test_a_genuinely_malformed_400_still_fails_FAST_and_is_reported(monkeypatch):
    """The fix must not turn every 400 into a retry loop against a request that can never work."""
    _fast(monkeypatch)
    g._REJECTS.clear()
    bad = _Resp(400)
    bad.text = '{"success":false,"message":"city must be an integer.","errors":{"city":["invalid"]}}'
    s = _Session([bad])
    items, _, status = g.fetch_page(s, 99, 1, "a", "b")
    assert (items, status) == ([], "http_400"), status
    assert s.calls == 1, s.calls                        # one attempt, no ladder
    assert len(g._REJECTS) == 1                         # and it IS captured for diagnosis


# ── STOPPING EARLY IS THE SAME BUG WHOEVER STOPS US (incident #76, 2026-09-05) ──────────────────
# Everything above pins the case where the SOURCE declines. One path was left where WE stop and the
# run still reports a finished city — the 400-page hard cap — which is the identical "a truncated
# crawl reads as a smaller healthy one" shape with the identical consequence:
# mon_detect_gathern_city_coverage_gap reads `city_incomplete=` straight out of scrape_runs.notes,
# so a truncation the crawl never records is a truncation the detector can never raise.
#
# The last two tests pin a property the loop currently HAS and must not lose. They are not a bug
# report: the same investigation first read the `continue` below as re-scanning the previous page's
# cards, and the mutation sweep proved that reading wrong (the tuple unpack rebinds `items` to []).
# They stay because the property is easy to break by refactor and nothing else asserts it.


def test_the_page_cap_marks_the_city_incomplete_not_finished(monkeypatch):
    """FAILS on the pre-fix code, which fell out of the loop with `truncated` still False.

    Measured live: on 2026-08-31 shard 9 stopped Jeddah at `pagesRead=400 kept=3888` against
    `monthlyTotalMeta=6281` — the source was still serving — and the run recorded
    `city_ok=… city_incomplete=0` with ok=true.
    """
    _fast(monkeypatch)
    s = _Session([_page([1, 2])])                  # an endless supply of full pages
    rows, _, _, outcomes = g.crawl(s, [{"id": 1, "name_en": "Jeddah"}], "a", "b",
                                   max_pages=3, verbose=False)
    assert outcomes.get("incomplete") == 1, outcomes
    assert outcomes.get("ok", 0) == 0, outcomes
    assert outcomes.get("reason:hard_cap") == 1, outcomes
    assert len(rows) == 2                          # what it DID capture is still kept


def test_a_city_that_fits_inside_the_cap_is_still_complete(monkeypatch):
    """The fix must not turn every capped run into a false alarm — prove the other direction."""
    _fast(monkeypatch)
    empty = _Resp(200, {"items": [], "_meta": {}})
    s = _Session([_page([1, 2]), empty, empty])
    _, _, _, outcomes = g.crawl(s, [{"id": 1, "name_en": "Riyadh"}], "a", "b",
                                max_pages=50, verbose=False)
    assert outcomes.get("ok") == 1, outcomes
    assert outcomes.get("incomplete", 0) == 0, outcomes
    assert "reason:hard_cap" not in outcomes, outcomes


def test_a_single_empty_page_does_not_re_scan_the_page_before_it(monkeypatch):
    """`scanned` becomes scrape_runs.rows_seen — the number every crawl-health check reads.

    Two real cards are served here, so two must be counted. The `continue` after one empty page
    re-enters `for it in items`, and this holds only because the tuple unpack already rebound
    `items` to []. Mutation that turns it red: `fetched, _, status = fetch_page(...)` followed by
    `items = fetched or items` — the plausible "don't lose the page we already have" refactor,
    which reports four.
    """
    _fast(monkeypatch)
    empty = _Resp(200, {"items": [], "_meta": {}})
    s = _Session([_page([1, 2]), empty, empty])
    rows, scanned, _, _ = g.crawl(s, [{"id": 1, "name_en": "Riyadh"}], "a", "b", verbose=False)
    assert scanned == 2, scanned
    assert len(rows) == 2


def test_an_interior_empty_page_is_survived_without_inflating_the_count(monkeypatch):
    """gathern really does serve holes: Riyadh page 200 of a 224-page catalogue returned zero items
    on 20/20 probes while pages 190-199 and 201-240 each returned 12 (measured 2026-09-05, incident
    #76). Paging must continue past one hole, and each card after it must be counted once."""
    _fast(monkeypatch)
    empty = _Resp(200, {"items": [], "_meta": {}})
    s = _Session([_page([1, 2]), empty, _page([3, 4]), empty, empty])
    rows, scanned, _, outcomes = g.crawl(s, [{"id": 1, "name_en": "Riyadh"}], "a", "b",
                                         verbose=False)
    assert scanned == 4, scanned
    assert sorted(rows) == ["GA1", "GA2", "GA3", "GA4"], sorted(rows)
    assert outcomes.get("ok") == 1, outcomes
