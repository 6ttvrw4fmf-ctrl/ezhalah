"""Sadin must record WHY its list pages yielded nothing — never a question mark.

THE INCIDENT (daily engineer, 2026-09-01). sadin's scrape_runs showed TWO consecutive 0-row days:

    2026-08-31  ok=False  rows_seen=0  notes="pruned=0 | RC-B demoted ok=False: 0-row run (blocked/empty source?)"
    2026-09-01  ok=False  rows_seen=0  notes="pruned=0 | RC-B demoted ok=False: 0-row run (blocked/empty source?)"

`_pages()` read `.text` and dropped `.status_code` on the floor, and swallowed every exception
with a bare `except Exception: return` — so a block page, a 5xx, or a transport failure on page 1
looked EXACTLY like "the catalogue is genuinely this small". This is the same defect class already
fixed for sanadak (test_sanadak_sitemap_failure_reason.py), erapulse, and abeea — sadin was the one
platform in this family still recording a bare question mark.

The invariant, one line, same as its siblings: **rows_seen alone can never separate "the source
served nothing" from "we never got an answer we can believe" — so the reason must be captured at
fetch time.**

Run: python -m pytest scrapers/common/tests/test_sadin_list_fetch_failure_reason.py -v
"""
import inspect

import pytest

from scrapers.sadin import run as sd


class _Resp:
    def __init__(self, status_code=200, text=""):
        self.status_code = status_code
        self.text = text


class _Session:
    """Either one scripted response/exception repeated every call (`resp=`/`raise_exc=`, the
    original single-attempt shape), or a `sequence=[...]` of _Resp/Exception items consumed one
    per call and held at the last item once exhausted — enough to script a retry-then-recover."""

    def __init__(self, resp=None, raise_exc=None, sequence=None):
        self._resp = resp
        self._raise = raise_exc
        self._sequence = list(sequence) if sequence is not None else None
        self.calls = 0

    def get(self, url, **kw):
        self.calls += 1
        if self._sequence is not None:
            item = self._sequence[min(self.calls, len(self._sequence)) - 1]
            if isinstance(item, Exception):
                raise item
            return item
        if self._raise is not None:
            raise self._raise
        return self._resp


@pytest.fixture(autouse=True)
def _no_real_delays(monkeypatch):
    """LIST_FETCH_ATTEMPTS retries back off with time.sleep(); neuter both that and the per-page
    throttle so the retry tests below are fast and deterministic, same as ramzalqasim's `rq`
    fixture (test_cloudflare_52x_is_transient.py)."""
    monkeypatch.setattr(sd.time, "sleep", lambda *_a, **_k: None)
    monkeypatch.setattr(sd, "_throttle", lambda *_a, **_k: None)


def setup_function(_fn):
    sd._list_fetch_fail_reasons.clear()


def teardown_function(_fn):
    sd._list_fetch_fail_reasons.clear()


def _drain(gen):
    return list(gen)


# ── THE REGRESSION: a source-side 500/block must be named ───────────────────────
def test_http_500_on_page_one_is_recorded_as_a_concrete_reason():
    pages = _drain(sd._pages(_Session(_Resp(500, "")), sd.LIST_ALL))
    assert pages == []
    summary = sd.list_fetch_failure_summary()
    assert "http_500" in summary, f"a 500 must be named, got: {summary!r}"
    assert "?" not in summary


def test_transport_failure_is_recorded_by_exception_type():
    _drain(sd._pages(_Session(raise_exc=ConnectionError("reset by peer")), sd.LIST_ALL))
    assert "transport_ConnectionError" in sd.list_fetch_failure_summary()


# ── THE 2026-09-12 REGRESSION: a transient 503 must be retried, not treated as final ─────────
def test_http_503_retries_and_succeeds_on_a_later_attempt():
    """THE REAL INCIDENT: sadin drew http_503 on page 1 of all 3 list URLs, 5 days running, and
    every run failed with zero cards because a single unretried GET took the 503 as the final
    answer. 503 then 200 must recover, not abort."""
    html = '<a href="/property/AD001"></a>'
    # page 1: 503 then 200-with-a-card; page 2: 200-with-no-NEW-card, which ends the crawl —
    # _pages() always looks one page ahead, so the 3rd call belongs to that pagination check,
    # not to page 1's retry.
    s = _Session(sequence=[_Resp(503, ""), _Resp(200, html), _Resp(200, html)])
    pages = _drain(sd._pages(s, sd.LIST_ALL))
    assert pages == [html]
    assert sd.list_fetch_failure_summary() == "", "an eventual success must record no failure"
    assert s.calls == 3, "the 503 must be retried, not accepted as the final answer"


def test_http_503_exhausts_retries_and_records_the_reason_once():
    """A genuine outage must still end the crawl (fail-safe unchanged) and still record a
    CONCRETE reason exactly once per page — not once per retry attempt, which would make
    list_fetch_failure_summary()'s counts describe attempts instead of pages."""
    s = _Session(_Resp(503, ""))
    pages = _drain(sd._pages(s, sd.LIST_ALL))
    assert pages == []
    assert sd.list_fetch_failure_summary() == "http_503=1", sd.list_fetch_failure_summary()
    assert s.calls == sd.LIST_FETCH_ATTEMPTS, "retries must be bounded, not open-ended"


def test_http_500_is_permanent_and_is_not_retried():
    """500 is an application error from the source, not an edge/transient blip (same distinction
    scrapers/common/http.py's TRANSIENT_STATUSES already draws) — retrying it would just burn the
    retry budget a real transient blip needs."""
    s = _Session(_Resp(500, ""))
    _drain(sd._pages(s, sd.LIST_ALL))
    assert s.calls == 1, "a non-transient status must fail fast, not spend retries on it"


def test_retry_budget_is_bounded():
    """Caught by mutation testing on the ramzalqasim sibling of this fix: an assertion that only
    checks self-consistency (calls == LIST_FETCH_ATTEMPTS) still passes if the constant itself is
    raised unreasonably high, quietly turning a brief block into minutes of retries per page
    across a 3-list-URL, multi-page crawl."""
    assert 2 <= sd.LIST_FETCH_ATTEMPTS <= 6


def test_a_real_200_with_zero_ids_on_page_one_is_a_different_bucket_from_a_500():
    """A 500 is the SOURCE being down/blocking. A 200 with nothing extracted is markup drift —
    OUR parser being wrong. Never collapse the two."""
    _drain(sd._pages(_Session(_Resp(200, "<html>no cards here</html>")), sd.LIST_ALL))
    summary = sd.list_fetch_failure_summary()
    assert "http_200_zero_ids_page1" in summary
    assert "http_500" not in summary


# ── The other direction: success must stay silent, and real pagination still works ──
def test_a_successful_single_page_records_no_failure():
    html = '<a href="/property/AD001"></a>'
    pages = _drain(sd._pages(_Session(_Resp(200, html)), sd.LIST_ALL))
    assert pages == [html]
    assert sd.list_fetch_failure_summary() == ""


def test_summary_is_empty_when_nothing_failed():
    assert sd.list_fetch_failure_summary() == ""


def test_summary_aggregates_and_orders_by_frequency():
    for _ in range(3):
        sd._record_list_fetch_failure("http_500")
    sd._record_list_fetch_failure("transport_ReadTimeout")
    summary = sd.list_fetch_failure_summary()
    assert summary.startswith("http_500=3"), summary
    assert "transport_ReadTimeout=1" in summary


# ── Mutation proof: the OLD implementation must fail the test above ─────────────
def test_the_old_status_blind_pages_would_fail_this_suite():
    """Reproduce the pre-fix body: `.text` read with the status discarded, exceptions swallowed
    with no reason. On the real incident input it yields nothing with NO reason recorded —
    indistinguishable from a genuinely tiny catalogue."""
    def _old_pages(s, url):
        try:
            html = s.get(url, timeout=40).text
        except Exception:
            return []
        ids = set()
        return [html] if ids or html else []

    _old_pages(_Session(_Resp(500, "")), sd.LIST_ALL)
    assert sd.list_fetch_failure_summary() == "", "the old path recorded nothing — that IS the defect"


# ── Structural guard on main() ───────────────────────────────────────────────────
def test_main_puts_the_breakdown_into_the_run_notes():
    src = inspect.getsource(sd.main)
    assert "list_fetch_failure_summary()" in src, "main() must read the breakdown"
    assert "notes" in src and "list-fetch failures" in src, \
        "the breakdown must reach scrape_runs.notes, not just stdout"


if __name__ == "__main__":
    import pytest
    raise SystemExit(pytest.main([__file__, "-v"]))
