"""AqarAlSaudia must record WHY its listing feed yielded nothing — never a silent empty list.

THE INCIDENT (daily engineer, 2026-09-24). aqaralsaudia's scrape_runs showed FOUR consecutive
0-row days (09-21 through 09-24), each recorded as:

    ok=false  rows_seen=0  notes="pruned=0 superseded=0 skipped_not_built=0 | RC-B demoted
              ok=False: 0-row run (blocked/empty source?)"

with the job's own stdout reading only "AqarAlSaudia: 0 posts fetched" — no status code, no
exception, nothing. `fetch_all()` read `.status_code` but discarded it on the floor once retries
were exhausted (`if r is None or r.status_code != 200: break`), and every transport exception was
silently retried into the same fate. A block page, a 5xx, or a transport failure looked EXACTLY
like "the site genuinely has zero posts" — the same defect class already fixed for
sadin/sanadak/erapulse/abeea (scrapers/sadin/run.py's _fetch_page(), see
test_sadin_list_fetch_failure_reason.py). A TLS-fingerprint fix (impersonate="chrome124", PR #3807)
landed 2026-09-23 and did NOT resolve the 0-row runs — this is why: nothing recorded what was
actually still going wrong, so nobody could tell whether the fingerprint fix worked.

The invariant, same as its siblings: **rows_seen alone can never separate "the source served
nothing" from "we never got an answer we can believe" — so the reason must be captured at fetch
time.**

Run: python -m pytest scrapers/common/tests/test_aqaralsaudia_fetch_failure_reason.py -v
"""
import inspect
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

import pytest  # noqa: E402

# fetch_all() never touches db/arabic_location — no stubbing needed, and stubbing them here would
# be a MODULE-LEVEL side effect that leaks into every other file in this shared pytest process
# (see common-location-tests.yml's own warning about `_al.to_catalog` rebinds colliding across
# scrapers/*/test_*.py — those are run one-file-per-interpreter for exactly this reason; this file
# lives in scrapers/common/tests/, which runs as ONE shared process, so it must not do that).
from scrapers.aqaralsaudia import run as aqs  # noqa: E402


class _Resp:
    def __init__(self, status_code=200, body=None, total_pages=1):
        self.status_code = status_code
        self._body = body if body is not None else []
        self.headers = {"X-WP-TotalPages": str(total_pages)}

    def json(self):
        return self._body


class _Session:
    """Either one scripted response/exception repeated every call (`resp=`/`raise_exc=`), or a
    `sequence=[...]` consumed one per call and held at the last item once exhausted — enough to
    script a retry-then-recover, same shape as sadin's test double."""

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
    monkeypatch.setattr(aqs.time, "sleep", lambda *_a, **_k: None)
    monkeypatch.setattr(aqs, "_throttle", lambda *_a, **_k: None)


def setup_function(_fn):
    aqs._fetch_fail_reasons.clear()


def teardown_function(_fn):
    aqs._fetch_fail_reasons.clear()


# ── THE REGRESSION: a source-side 5xx/block must be named ───────────────────────
def test_http_500_is_recorded_as_a_concrete_reason():
    posts = aqs.fetch_all(_Session(_Resp(500)))
    assert posts == []
    summary = aqs.fetch_failure_summary()
    assert "http_500" in summary, f"a 500 must be named, got: {summary!r}"
    assert "?" not in summary


def test_transport_failure_is_recorded_by_exception_type():
    aqs.fetch_all(_Session(raise_exc=ConnectionError("reset by peer")))
    assert "transport_ConnectionError" in aqs.fetch_failure_summary()


def test_a_real_200_with_zero_posts_on_page_one_is_a_different_bucket_from_a_500():
    """A 500 is the SOURCE being down/blocking. A 200 with an empty body is markup/API drift —
    OUR parsing being wrong. Never collapse the two."""
    aqs.fetch_all(_Session(_Resp(200, body=[])))
    summary = aqs.fetch_failure_summary()
    assert "http_200_zero_posts_page1" in summary
    assert "http_500" not in summary


def test_http_400_on_page_one_is_end_of_catalogue_not_a_failure():
    """WP answers 400 past the last page — this is the site's own pagination signal, not an
    error, and must never be recorded as a fetch failure."""
    posts = aqs.fetch_all(_Session(_Resp(400)))
    assert posts == []
    assert aqs.fetch_failure_summary() == ""


# ── The other direction: success must stay silent, retries still recover ────────
def test_a_successful_single_page_records_no_failure():
    posts = aqs.fetch_all(_Session(_Resp(200, body=[{"id": 1}], total_pages=1)))
    assert posts == [{"id": 1}]
    assert aqs.fetch_failure_summary() == ""


def test_http_502_retries_and_succeeds_on_a_later_attempt():
    s = _Session(sequence=[_Resp(502), _Resp(200, body=[{"id": 1}], total_pages=1)])
    posts = aqs.fetch_all(s)
    assert posts == [{"id": 1}]
    assert aqs.fetch_failure_summary() == "", "an eventual success must record no failure"
    assert s.calls == 2, "the 502 must be retried, not accepted as the final answer"


def test_retry_budget_is_bounded():
    s = _Session(_Resp(503))
    aqs.fetch_all(s)
    assert s.calls == 3, "retries must be bounded, not open-ended"
    assert aqs.fetch_failure_summary() == "http_503=1", \
        "the reason must be recorded once per page, not once per attempt"


# ── Mutation proof: the OLD implementation must fail the test above ─────────────
def test_the_old_status_blind_fetch_all_would_fail_this_suite():
    """Reproduce the pre-fix body: status/exception discarded once retries were exhausted, no
    reason recorded anywhere. On the real incident input it yields nothing with NO reason
    recorded — indistinguishable from a genuinely empty catalogue."""
    def _old_fetch_all(s):
        out = []
        r = None
        for _attempt in range(3):
            try:
                r = s.get("x", timeout=40)
            except Exception:
                continue
            if r.status_code == 400:
                return out
            if r.status_code == 200:
                break
        if r is None or r.status_code != 200:
            return out
        return out

    _old_fetch_all(_Session(_Resp(500)))
    assert aqs.fetch_failure_summary() == "", "the old path recorded nothing — that IS the defect"


# ── Structural guard on main() ───────────────────────────────────────────────────
def test_main_puts_the_breakdown_into_the_run_notes():
    src = inspect.getsource(aqs.main)
    assert "fetch_failure_summary()" in src, "main() must read the breakdown"
    assert "notes" in src and "fetch failures" in src, \
        "the breakdown must reach scrape_runs.notes, not just stdout"


if __name__ == "__main__":
    raise SystemExit(pytest.main([__file__, "-v"]))
