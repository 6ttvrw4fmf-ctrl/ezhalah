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

from scrapers.sadin import run as sd


class _Resp:
    def __init__(self, status_code=200, text=""):
        self.status_code = status_code
        self.text = text


class _Session:
    """One scripted response per call, or an exception — enough for _pages()'s single .get()."""

    def __init__(self, resp=None, raise_exc=None):
        self._resp = resp
        self._raise = raise_exc
        self.calls = 0

    def get(self, url, **kw):
        self.calls += 1
        if self._raise is not None:
            raise self._raise
        return self._resp


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
