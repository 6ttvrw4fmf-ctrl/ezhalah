"""sanadak must say WHY the detail fetches failed — the second layer of the same defect.

THE INCIDENT (senior production run, 2026-08-31, second half). PR #1420 made the SITEMAP path name
its failure. Hours later sanadak failed again in a way #1420 could not describe: the sitemap
RECOVERED (HTTP 200, 242,457 bytes, 1,093 URLs) while every LISTING page stayed down —
/property-details answered HTTP 500 under `RSC: 1` and 504 plain, ~30s each, on 3/3 random
listings measured from an independent egress.

`fetch_one()` read `.text` and never looked at `.status_code`, so a 500 with an empty body was
indistinguishable from "the page loaded and had no listing object in it". Every URL returned None,
the run ended with 0 rows, and RC-B wrote the generic `"0-row run (blocked/empty source?)"` — the
same question mark #1420 removed one layer up. A run where 1,093 pages all 500'd was recorded
identically to a run whose catalogue was genuinely empty.

The invariant is unchanged from #1420, applied one layer down: **rows_seen alone can never
separate "the source served nothing" from "we never got an answer we can believe".**

This suite also pins the distinction that makes the tally worth having: an HTTP 500 and a real 200
we could not parse are DIFFERENT facts and must never collapse into one bucket. The first is the
source being down; the second is a parser/shape problem that is ours.

Run: python -m pytest scrapers/common/tests/test_sanadak_detail_fetch_failure_reason.py -v
"""
import inspect

import pytest

from scrapers.sanadak import run as sd


class _R:
    def __init__(self, status_code=200, text=""):
        self.status_code = status_code
        self.text = text


class _Session:
    def __init__(self, resp=None, raise_exc=None):
        self._resp = resp
        self._raise = raise_exc
        self.calls = 0

    def get(self, url, **kw):
        self.calls += 1
        if self._raise is not None:
            raise self._raise
        return self._resp


@pytest.fixture(autouse=True)
def _isolate(monkeypatch):
    """Fresh tally per test, and no real backoff sleeping."""
    sd._fetch_fail_reasons.clear()
    monkeypatch.setattr(sd.time, "sleep", lambda *a, **k: None)
    yield
    sd._fetch_fail_reasons.clear()


def _use(session, monkeypatch):
    monkeypatch.setattr(sd, "_session", lambda: session)


# ── THE REGRESSION: a source-side 500 must be named ─────────────────────────────
def test_http_500_is_recorded_as_a_concrete_reason(monkeypatch):
    _use(_Session(_R(500, "")), monkeypatch)
    assert sd.fetch_one("https://sanadak.sa/property-details/x-1") is None
    summary = sd.fetch_failure_summary()
    assert "http_500" in summary, f"a 500 must be named, got: {summary!r}"
    assert "?" not in summary


def test_gateway_timeout_is_recorded(monkeypatch):
    _use(_Session(_R(504, "")), monkeypatch)
    sd.fetch_one("https://sanadak.sa/property-details/x-2")
    assert "http_504" in sd.fetch_failure_summary()


def test_transport_failure_is_recorded_by_exception_type(monkeypatch):
    _use(_Session(raise_exc=ConnectionError("reset by peer")), monkeypatch)
    sd.fetch_one("https://sanadak.sa/property-details/x-3")
    assert "transport_ConnectionError" in sd.fetch_failure_summary()


# ── The distinction that makes the tally useful ─────────────────────────────────
def test_a_real_200_we_cannot_parse_is_a_different_bucket_from_a_500(monkeypatch):
    """A 500 is the SOURCE being down. An unparseable 200 is OURS. Never collapse them."""
    _use(_Session(_R(200, "<html>not a listing</html>")), monkeypatch)
    sd.fetch_one("https://sanadak.sa/property-details/x-4")
    summary = sd.fetch_failure_summary()
    assert "http_200_no_listing_object" in summary
    assert "http_500" not in summary


def test_an_unparseable_200_does_not_burn_retries(monkeypatch):
    """A 200 is an answer: parse it once, don't hammer the origin three times for it."""
    s = _Session(_R(200, "<html>nope</html>"))
    _use(s, monkeypatch)
    sd.fetch_one("https://sanadak.sa/property-details/x-5")
    assert s.calls == 1


def test_a_500_is_retried_before_giving_up(monkeypatch):
    """A 5xx may be transient — it earns the retry ladder, unlike a parsed 200."""
    s = _Session(_R(500, ""))
    _use(s, monkeypatch)
    sd.fetch_one("https://sanadak.sa/property-details/x-6")
    assert s.calls == 3


# ── The other direction: success must stay silent ───────────────────────────────
def test_a_successful_fetch_records_no_failure(monkeypatch):
    """A barrier that fires on healthy runs is noise. Success must leave the tally empty."""
    sentinel = {"advertisementNumber": "123"}
    _use(_Session(_R(200, "irrelevant-body")), monkeypatch)
    monkeypatch.setattr(sd, "_extract_obj_for_url", lambda body, url: sentinel)
    got = sd.fetch_one("https://sanadak.sa/property-details/x-7")
    assert got is not None and got[0] is sentinel
    assert sd.fetch_failure_summary() == ""


def test_summary_is_empty_when_nothing_failed():
    assert sd.fetch_failure_summary() == ""


def test_summary_aggregates_and_orders_by_frequency(monkeypatch):
    for _ in range(3):
        sd._record_fetch_failure("http_500")
    sd._record_fetch_failure("transport_ReadTimeout")
    summary = sd.fetch_failure_summary()
    assert summary.startswith("http_500=3"), summary
    assert "transport_ReadTimeout=1" in summary


# ── Mutation proof + wiring ─────────────────────────────────────────────────────
def test_the_old_status_blind_fetch_would_fail_this_suite(monkeypatch):
    """Reproduce the pre-fix body: `.text` read with the status discarded. On the real incident
    input it returns None with NO reason recorded — indistinguishable from an empty page."""
    def _old_fetch_one(url, session):
        for attempt in range(3):
            try:
                body = session.get(url, timeout=45, headers={"RSC": "1"}).text
            except Exception:
                continue
            return None if not body else "parsed"
        return None

    assert _old_fetch_one("u", _Session(_R(500, ""))) is None
    assert sd.fetch_failure_summary() == "", "the old path recorded nothing — that IS the defect"


def test_main_puts_the_breakdown_into_the_run_notes():
    src = inspect.getsource(sd.main)
    assert "fetch_failure_summary()" in src, "main() must read the breakdown"
    assert "notes" in src and "detail-fetch failures" in src, \
        "the breakdown must reach scrape_runs.notes, not just stdout"


if __name__ == "__main__":
    raise SystemExit(pytest.main([__file__, "-v"]))
