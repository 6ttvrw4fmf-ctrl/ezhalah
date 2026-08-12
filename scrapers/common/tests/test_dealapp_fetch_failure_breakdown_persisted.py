"""Regression test: the dealapp fetch-failure breakdown must reach scrape_runs, not just stdout.

WHY (senior audit 2026-08-12). dealapp's 12-shard fleet ran green — all 12 shards succeeded, none
hit the 120m timeout, none hit the 1200 cap — and still re-confirmed only 2,461 of 9,827 active
rows (25%). `prune_unseen` therefore returned -1 on every shard (coverage floor 0.80), so nothing
aged out and the standing `stale_active` / `stale_coverage_gate` P1s kept firing. The same fleet
also failed on roughly two thirds of the BRAND-NEW sitemap ids it was handed, and an id the
sitemap published hours earlier cannot be "delisted" — so the shortfall is a fetch/render failure,
not dead inventory.

`fetch_one` already classifies every failure (404/410 vs a persistent unhydrated skeleton vs a 200
that never carried the listing schema, itself split three ways by
`_record_status_200_no_schema`). That classification is the difference between "let prune do its
job" and "never prune, we are the broken half" — and it was PRINTED ONLY. It lived in a GitHub
Actions log that expires, cannot be read by any `mon_detect_*`, and was already gone by the time
the alerts it explains were adjudicated. Three separate audits re-derived it by hand.

So the contract locked here is narrow and structural: whatever `fetch_one` tallied, the run's
`scrape_runs.notes` carries it, alongside `attempted` (the enumerated id count) so the hit rate is
computable in SQL without the log. Content-free — bucket names and integers only, the same PDPL
rule the sample buckets follow.

Run: python -m pytest scrapers/common/tests/test_dealapp_fetch_failure_breakdown_persisted.py -v
"""
from __future__ import annotations

import sys
from unittest.mock import MagicMock

import pytest

from scrapers.dealapp import run


@pytest.fixture(autouse=True)
def _clean_counters():
    """The tally is module-global; isolate each test from the others (and from import order)."""
    run._fetch_fail_reasons.clear()
    run._fetch_fail_samples.clear()
    yield
    run._fetch_fail_reasons.clear()
    run._fetch_fail_samples.clear()


def _run_main_capturing_end_run_notes(monkeypatch, *, ids, fetch_one) -> str:
    """Drive main() over a canned id list and return the `notes` string it finalized with."""
    captured: dict = {}

    def _end_run(run_id, **kwargs):
        captured.update(kwargs)
        return True

    monkeypatch.setattr(sys, "argv", ["run.py"])
    monkeypatch.setattr(run, "session", lambda: MagicMock())
    monkeypatch.setattr(run, "enumerate_ids", lambda s, cap: list(ids))
    monkeypatch.setattr(run, "fetch_one", fetch_one)
    monkeypatch.setattr(run.db, "begin_run", lambda platform: 999)
    monkeypatch.setattr(run.db, "prune_unseen", lambda tbl, seen, source: 0)
    monkeypatch.setattr(run.db, "upsert_dealapp_residential_batch", lambda rows: None)
    monkeypatch.setattr(run.db, "upsert_dealapp_commercial_batch", lambda rows: None)
    monkeypatch.setattr(run.db, "end_run", _end_run)

    run.main()
    return captured.get("notes") or ""


def test_notes_carry_the_failure_buckets_and_attempted_count(monkeypatch):
    """The 2026-08-12 shape: every fetch fails, each for a classified reason. The finalized row
    must say how many ids were attempted AND which buckets they fell in — that is exactly what
    was missing when the coverage alerts had to be adjudicated without the job log."""
    ids = [str(i) for i in range(1, 11)]

    def _failing_fetch(adid: str):
        # Mirrors fetch_one's own classification calls, without needing the network.
        if int(adid) <= 7:
            run._record_fetch_failure("status_200_no_listing_schema:same_url_no_ng_state")
        else:
            run._record_fetch_failure("not_found_404_410")
        return None

    notes = _run_main_capturing_end_run_notes(monkeypatch, ids=ids, fetch_one=_failing_fetch)

    assert "attempted=10" in notes, notes
    assert "fetch_fail_total=10" in notes, notes
    assert "status_200_no_listing_schema:same_url_no_ng_state=7" in notes, notes
    assert "not_found_404_410=3" in notes, notes
    # The pre-existing prefix is preserved — migrations and prior audits quote this shape.
    assert notes.startswith("sold=0 pruned=0 "), notes


def test_a_clean_run_adds_no_failure_noise(monkeypatch):
    """Negative control. With nothing to report the note keeps its original shape plus
    `attempted`, so a healthy run is not made to look like it carries diagnostics."""
    notes = _run_main_capturing_end_run_notes(
        monkeypatch, ids=[], fetch_one=lambda adid: None)

    assert "attempted=0" in notes, notes
    assert "fetch_fail" not in notes, notes


def test_summary_is_bounded_and_content_free():
    """A pathological run must not blow up the notes column, and the rendering must never carry
    anything but bucket names and integers (PDPL: no listing content in diagnostics)."""
    for i in range(200):
        run._record_fetch_failure(f"bucket_{i}")
    for _ in range(500):
        run._record_fetch_failure("not_found_404_410")

    summary = run._fetch_fail_summary()

    assert len(summary) <= 240, len(summary)
    assert "fetch_fail_total=700" in summary
    # Most-common first, so the dominant class survives truncation.
    assert "not_found_404_410=500" in summary


def test_summary_is_empty_when_nothing_failed():
    assert run._fetch_fail_summary() == ""
