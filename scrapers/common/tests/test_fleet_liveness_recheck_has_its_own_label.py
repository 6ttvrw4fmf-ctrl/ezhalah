"""The struck-only RECHECK writes its own run label (🦅 2026-11-03).

MEASURED (scrape_runs, 10-26 → 11-03): `fleet_liveness:haraj` carried three jobs a day — the 07:17 UTC full pass
(172-293 min, ~15,000 rows), the 14:17 recheck (0-2 min, 0-1 row) and the 20:47 recheck (3-6 min, ~190 rows).
mon_detect_run_duration_explosion baselines the MEDIAN run of a label, so the full pass was measured against a
few minutes and every in-flight morning pass (rows are written at end_run) read as a stall:
run_duration_explosion:fleet_liveness:muhaysini and :haraj opened 7 times each in 7 days, plus tuba, rakez,
dwelleo, nofodh, sakani. Drives the REAL run_site and checks the label each job writes.
"""
from __future__ import annotations

import re

import pytest

import scrapers.common.fleet_liveness as F
from scrapers.common.tests.test_fleet_liveness import _row, _controls, site  # noqa: F401  (fixture)


def _labels(monkeypatch):
    seen: list[str] = []
    monkeypatch.setattr(F, "begin_run", lambda name: seen.append(name) or 1)
    return seen


def test_the_daily_pass_keeps_its_label(site, monkeypatch):
    site([_row(1)] + _controls(), {})
    seen = _labels(monkeypatch)
    F.run_site("testsite", shadow=True)
    assert seen == ["fleet_liveness:testsite"]


def test_the_recheck_writes_its_own_label(site, monkeypatch):
    site([_row(1, mc=2)] + _controls(), {})
    seen = _labels(monkeypatch)
    monkeypatch.setattr(F, "struck", lambda client, s: True)
    F.run_site("testsite", shadow=True, struck_only=True)
    assert seen == ["fleet_liveness:testsite:recheck"]


@pytest.mark.parametrize("struck_only", [False, True])
def test_every_reader_that_must_see_the_label_still_does(struck_only):
    label = F.run_label("haraj", struck_only)
    # mon_detect_rows_collapse excludes liveness labels; lifecycle_report's JOB_RE / LIVENESS_JOB_RE
    assert re.match(r"^(fleet_liveness|cleanup|verify_deletions|aqar_liveness|aqar_liveness_recheck):", label)
    # stale-remediation (20261026111118): the platform as a prefix OR after a colon
    assert re.search(r"liveness", label, re.I) and re.search(r"(^|:)haraj([_:]|$)", label)
    # silent-partial-success skips every liveness label
    assert "liveness" in label


def test_a_recheck_with_nothing_to_read_still_leaves_its_heartbeat(site, monkeypatch):
    """♻️ 2026-11-07, alert 13588: a recheck pass that found no struck row returned before begin_run, so
    fleet_liveness:reinvest:recheck wrote nothing for 21 h and liveness_job_silent fired on a healthy job.
    The pass must write its own row, ok, with nothing read."""
    site([_row(1)] + _controls(), {})
    seen = _labels(monkeypatch)
    ended: list[dict] = []
    monkeypatch.setattr(F, "end_run", lambda rid, **kw: ended.append(kw))
    monkeypatch.setattr(F, "struck", lambda client, s: 0)
    out = F.run_site("testsite", shadow=False, struck_only=True)
    assert out["skipped"] == "no struck row"
    assert seen == ["fleet_liveness:testsite:recheck"]
    assert len(ended) == 1 and ended[0]["ok"] is True and ended[0]["rows_seen"] == 0
    assert "nothing to re-read" in ended[0]["notes"]
