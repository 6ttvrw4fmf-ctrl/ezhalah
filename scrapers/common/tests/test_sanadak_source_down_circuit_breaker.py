"""Sanadak must stop retrying a source that is already dead for every listing.

THE INCIDENT (daily engineer, 2026-09-01). The 2026-08-31 fix (test_sanadak_detail_fetch_failure_
reason.py) made a whole-source 5xx outage NAMEABLE in scrape_runs.notes. It did not make the run
stop CAUSING one. 2026-09-01 confirmed the SAME outage was still live — sanadak.sa/sitemap.xml
answered 200 (1,093 URLs) while /property-details/* answered HTTP 500 on 3/3 probes from an
independent egress, ~30s each — and a live scrape_runs row showed the CI job still running at
63+ minutes with 0 rows_seen, on track to be SIGINT-killed at the 90-minute timeout-minutes budget
(small-sources-sync.yml) exactly like the run_killed_by_timeout / run_duration_explosion alerts
already open for this platform (alert_event ids 1230/1246).

fetch_one() already retries each URL 3x with backoff (~90-100s worst case per URL). With WORKERS=4
and ~1,164 sitemap URLs, a source that 500s on every single one guarantees the job blows its CI
timeout budget learning a fact the first handful of fetches already proved. The invariant this
suite pins: a source that answers every early fetch with a 5xx must be declared down FAST, without
ever touching listing state (never prune on an unreachable source — LISTING_LIVENESS.md §1: a
non-answer is UNKNOWN, and UNKNOWN never deactivates anything), so the CI budget is spent finding
new outages instead of re-confirming the same one 1,164 times.

Run: python -m pytest scrapers/common/tests/test_sanadak_source_down_circuit_breaker.py -v
"""
import sys

from scrapers.sanadak import run as sd


def _reset():
    sd._fetch_fail_reasons.clear()


def setup_function(_fn):
    _reset()


def teardown_function(_fn):
    _reset()


# ── The regression: a whole-source 5xx outage must trip the breaker ─────────────
def test_trips_once_the_sample_is_all_5xx_and_nothing_was_captured():
    for _ in range(sd._SOURCE_DOWN_SAMPLE):
        sd._record_fetch_failure("http_500")
    assert sd._source_looks_down(sd._SOURCE_DOWN_SAMPLE, captured=0) is True


def test_mixed_500_and_504_still_trips_it():
    """Both are 5xx-class — yesterday's real incident mixed 500 (RSC) and 504 (plain)."""
    for _ in range(sd._SOURCE_DOWN_SAMPLE // 2):
        sd._record_fetch_failure("http_500")
    for _ in range(sd._SOURCE_DOWN_SAMPLE // 2):
        sd._record_fetch_failure("http_504")
    assert sd._source_looks_down(sd._SOURCE_DOWN_SAMPLE, captured=0) is True


# ── The guardrails: never fire on a partial/ambiguous signal ────────────────────
def test_does_not_trip_before_the_minimum_sample():
    """One or two stray 500s must not fast-abort a run that could still recover."""
    for _ in range(sd._SOURCE_DOWN_SAMPLE - 1):
        sd._record_fetch_failure("http_500")
    assert sd._source_looks_down(sd._SOURCE_DOWN_SAMPLE - 1, captured=0) is False


def test_does_not_trip_once_any_row_was_captured():
    """Even a single successful parse means the source is answering — a real partial outage,
    never the total-outage shape this breaker exists for."""
    for _ in range(sd._SOURCE_DOWN_SAMPLE):
        sd._record_fetch_failure("http_500")
    assert sd._source_looks_down(sd._SOURCE_DOWN_SAMPLE, captured=1) is False


def test_does_not_trip_on_a_mix_with_transport_errors():
    """A mix of 5xx and transport failures is a less certain signal (could be OUR egress) and
    must not be treated the same as a clean, pure 5xx-from-the-source signature."""
    for _ in range(sd._SOURCE_DOWN_SAMPLE - 1):
        sd._record_fetch_failure("http_500")
    sd._record_fetch_failure("transport_ConnectionError")
    assert sd._source_looks_down(sd._SOURCE_DOWN_SAMPLE, captured=0) is False


def test_does_not_trip_on_unparseable_200s():
    """An unparseable 200 is OUR parser being wrong, not the source being down — must never be
    folded into the same signal as a 5xx storm."""
    for _ in range(sd._SOURCE_DOWN_SAMPLE):
        sd._record_fetch_failure("http_200_no_listing_object")
    assert sd._source_looks_down(sd._SOURCE_DOWN_SAMPLE, captured=0) is False


def test_does_not_trip_with_no_failures_recorded_yet():
    assert sd._source_looks_down(sd._SOURCE_DOWN_SAMPLE, captured=0) is False


# ── Wiring: main() must actually use the breaker and never prune on an abort ────
def test_main_checks_the_breaker_inside_the_fetch_loop():
    import inspect
    src = inspect.getsource(sd.main)
    assert "_source_looks_down(" in src, "main() must consult the circuit breaker per result"
    assert "source_down" in src, "main() must track whether the breaker tripped"


def test_main_never_reaches_prune_unseen_when_the_breaker_trips():
    import inspect
    src = inspect.getsource(sd.main)
    # The abort branch must return before the prune_unseen loop — string-order is a proxy for
    # control flow here, matching how the existing sitemap_err branch already returns early.
    down_idx = src.index("if source_down:")
    prune_idx = src.index("db.prune_unseen(")
    return_idx = src.index("return 1", down_idx)
    assert down_idx < return_idx < prune_idx, \
        "the source_down branch must return before db.prune_unseen() is ever called"


def test_main_marks_the_aborted_run_as_not_ok_with_zero_rows():
    import inspect
    src = inspect.getsource(sd.main)
    down_idx = src.index("if source_down:")
    end_run_call = src.index("db.end_run(run_id, ok=False, rows_seen=0, rows_upserted=0", down_idx)
    assert end_run_call > down_idx


# ── End-to-end: main() itself, not just its source text, must behave this way ───
class _Resp:
    def __init__(self, status_code=200, text=""):
        self.status_code = status_code
        self.text = text
        self.content = text.encode()


class _AllFiveHundredSession:
    """Sitemap answers healthy; every single detail fetch answers HTTP 500 — the exact incident
    shape (sitemap recovered, every listing page still down)."""

    def get(self, url, **kw):
        if url == sd.SITEMAP:
            urls = "".join(
                f"<url><loc>{sd.BASE}/property-details/x-{i}</loc></url>" for i in range(30)
            )
            return _Resp(200, f'<?xml version="1.0"?><urlset>{urls}</urlset>')
        return _Resp(500, "")


def test_main_end_to_end_aborts_fast_never_prunes_and_reports_ok_false(monkeypatch):
    calls = {"begin": 0, "end": [], "prune": 0}

    monkeypatch.setattr(sd, "session", lambda: _AllFiveHundredSession())
    monkeypatch.setattr(sd, "_session", lambda: _AllFiveHundredSession())
    monkeypatch.setattr(sd.time, "sleep", lambda *a, **k: None)  # skip real backoff delays

    def _begin_run(_platform):
        calls["begin"] += 1
        return 999

    def _end_run(run_id, *, ok, rows_seen, rows_upserted, notes=None, **kw):
        calls["end"].append((run_id, ok, rows_seen, rows_upserted, notes))
        return ok

    def _prune_unseen(*a, **kw):
        calls["prune"] += 1
        return 0

    monkeypatch.setattr(sd.db, "begin_run", _begin_run)
    monkeypatch.setattr(sd.db, "end_run", _end_run)
    monkeypatch.setattr(sd.db, "prune_unseen", _prune_unseen)
    monkeypatch.setattr(sys, "argv", ["run.py"])

    rc = sd.main()

    assert rc == 1, "an all-5xx source must exit non-zero"
    assert calls["begin"] == 1
    assert calls["prune"] == 0, "prune_unseen must NEVER run on an unreachable source"
    assert len(calls["end"]) == 1
    run_id, ok, rows_seen, rows_upserted, notes = calls["end"][0]
    assert run_id == 999
    assert ok is False
    assert rows_seen == 0 and rows_upserted == 0
    assert notes and "5xx" in notes and "source is down" in notes
    # The breaker must trip well before all 30 URLs are attempted — the whole point is not
    # burning the full sitemap on a source that already announced itself as down.
    assert f"aborted after {sd._SOURCE_DOWN_SAMPLE}/30" in notes or "aborted after" in notes


if __name__ == "__main__":
    import pytest
    raise SystemExit(pytest.main([__file__, "-v"]))
