"""aqarmonthly gets a SECOND daily full pass (--recheck-all) so its 24 h SLA has margin (2026-11-09).

repeat_bug:liveness_sla:aqarmonthly (alert 13739) re-raised 3 times in 7 days with verified_in_sla = 0
of 3,686: the 01:30 sweep was aqarmonthly's ONLY full pass, so every row was stamped in one batch, and
any day the sweep started later than the day before (03:12 on 11-09 vs 01:31 on 11-08) every row aged
past 24 h at once. The 13:02 recheck now reads every due row, struck or not, under its own label, with
the same 6 h rest between readings. Drives the real main() against the fake PostgREST.
"""
from __future__ import annotations

import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

import scrapers.aqar.liveness as L

from scrapers.common.tests import test_aqar_liveness_recheck_min_strikes as R

TABLE = "aqarmonthly_residential_listings"


def test_recheck_all_reads_every_due_row_struck_or_not_under_the_recheck_label(monkeypatch):
    rows, labels, notes, read = R._run(monkeypatch, ["--recheck-all"])
    assert "gone-1" in read, read          # struck, due
    assert "gone-3" in read, read          # UNSTRUCK, due — the old recheck never read it
    assert "gone-2" not in read, read      # read 1 h ago: the 6 h rest still holds
    assert labels == [f"aqar_liveness_recheck:{R.TABLE}:0/1"]   # its own label, never the daily one
    assert rows[1]["active"] is False and rows[1]["missing_count"] == 3   # 3-strike grace unchanged
    assert rows[3]["missing_count"] == 1 and rows[3]["active"] is True     # first strike only
    assert "controls=5/5" in notes


def test_the_scheduled_recheck_gives_aqarmonthly_its_second_full_pass():
    wf = Path(".github/workflows/aqar-liveness-recheck.yml").read_text()
    line = next(l for l in wf.splitlines() if "--table aqarmonthly_residential_listings" in l)
    assert "--recheck-all" in line, line
    assert "--min-strikes" not in line, line


@pytest.fixture
def run_monthly(monkeypatch):
    """Run the CLI with a fixed clock and in-memory rows, including its real cohort filters."""
    now = datetime(2026, 11, 9, 13, 2, tzinfo=timezone.utc)

    class FrozenDateTime(datetime):
        @classmethod
        def now(cls, tz=None):
            return now if tz else now.replace(tzinfo=None)

    monkeypatch.setattr(L, "datetime", FrozenDateTime)
    monkeypatch.setattr(L, "reconcile_orphaned_stubs", lambda *a, **k: 0)

    def run(rows, argv=(), response_status=404, controls_alive=True):
        client = R._Client({TABLE: rows})
        labels, reads, result = [], [], {}
        monkeypatch.setattr(L, "sb", lambda: client)
        monkeypatch.setattr(L, "begin_run", lambda name: labels.append(name) or 1)
        monkeypatch.setattr(L, "end_run", lambda *a, **k: result.update(k))
        controls = [dict(R.F._row(100 + i, f"https://sa.aqar.fm/control-{i}"),
                         last_seen_at=now.isoformat()) for i in range(5)]
        monkeypatch.setattr(L, "_known_live_controls", lambda *a: controls)

        def get(url, **kwargs):
            if "/control-" in url:
                status = 200 if controls_alive else 404
            else:
                reads.append(int(url.rsplit("/", 1)[1]))
                status = response_status
            if status is None:
                return None
            return R.F._Resp(status, "<html><h1>شقة للإيجار الشهري</h1></html>" if status == 200 else "")

        monkeypatch.setattr(L, "get", get)
        monkeypatch.setattr(sys, "argv", ["liveness", "--table", TABLE, *argv])
        L.main()
        return reads, client, labels, result

    def row(i, *, age_seconds=None, strikes=0, active=True):
        return dict(R.F._row(i, f"https://sa.aqar.fm/{i}", mc=strikes), active=active,
                    last_liveness_probe_at=(now - timedelta(seconds=age_seconds)).isoformat()
                    if age_seconds is not None else None)

    return run, row, now


@pytest.mark.parametrize("age_seconds,due", [
    (None, True), (21601, True), (21600, False), (21599, False), (-1, False),
])
def test_monthly_recheck_rest_boundary_including_never_probed_and_future_rows(
        run_monthly, age_seconds, due):
    run, row, now = run_monthly
    original = row(1, age_seconds=age_seconds)
    before = dict(original)
    reads, client, labels, result = run([original], ["--recheck-all"])
    assert reads == ([1] if due else [])
    assert labels == [f"aqar_liveness_recheck:{TABLE}:0/1"]
    assert result["rows_seen"] == int(due)
    if due:
        assert original["missing_count"] == 1
        assert original["last_liveness_probe_at"] == now.isoformat()
        assert original["active"] is True
        assert client.inserted["aqar_liveness_detail"][0]["source_table"] == TABLE
    else:
        assert original == before


@pytest.mark.parametrize("extra,expected,label", [
    ([], {1, 2, 3, 4}, "aqar_liveness_recheck"),
    (["--min-strikes", "2"], {3, 4}, "aqar_liveness_recheck"),
    (["--only-struck"], {4, 5}, "aqar_liveness"),
    (["--only-struck", "--min-strikes", "4"], {4, 5}, "aqar_liveness"),
])
def test_recheck_all_respects_other_cohort_flags_and_excludes_inactive_rows(run_monthly, extra, expected, label):
    run, row, _ = run_monthly
    rows = [row(i + 1, age_seconds=43200, strikes=i) for i in range(4)]
    rows += [row(5, age_seconds=3600, strikes=3), row(6, strikes=3, active=False)]
    before_inactive = dict(rows[-1])
    reads, _, labels, _ = run(rows, ["--recheck-all", *extra])
    assert set(reads) == expected
    assert labels == [f"{label}:{TABLE}:0/1"]
    assert rows[-1] == before_inactive


@pytest.mark.parametrize("status", [200, 404, None])
def test_monthly_full_recheck_preserves_alive_dead_and_unknown_contract(run_monthly, status):
    run, row, now = run_monthly
    original = row(1, age_seconds=43200, strikes=2)
    before = dict(original)
    reads, _, _, _ = run([original], ["--recheck-all"], response_status=status)
    assert reads == [1]
    if status == 200:
        assert original["active"] is True
        assert original["missing_count"] == 0
        assert original["last_verified_alive_at"] == now.isoformat()
        assert original["last_liveness_probe_at"] == now.isoformat()
    elif status == 404:
        assert original["active"] is False
        assert original["missing_count"] == 3
    else:
        assert original == before


@pytest.mark.parametrize("extra,controls_alive", [([], False), (["--report-only"], True)])
def test_recheck_all_cannot_strike_or_hide_in_report_only_or_failed_controls(run_monthly, extra, controls_alive):
    run, row, _ = run_monthly
    rows = [row(1, strikes=0), row(2, strikes=2)]
    before = [dict(r) for r in rows]
    reads, client, _, result = run(rows, ["--recheck-all", *extra], controls_alive=controls_alive)
    assert set(reads) == {1, 2}
    assert rows == before
    evidence = client.inserted["aqar_liveness_detail"]
    assert {e["verdict"] for e in evidence} == {"strike", "kill"}
    assert all(e["applied"] is False for e in evidence)
    if not controls_alive:
        assert "CONTROLS-QUARANTINED" in result["notes"]


def test_monthly_second_pass_keeps_modulo_shard_ownership(run_monthly):
    run, row, _ = run_monthly
    rows = [row(i) for i in range(1, 7)]
    reads, _, labels, _ = run(rows, ["--recheck-all", "--shards", "2", "--shard", "1"])
    assert set(reads) == {1, 3, 5}
    assert labels == [f"aqar_liveness_recheck:{TABLE}:1/2"]
    assert all(r["missing_count"] == 0 for r in rows if r["id"] % 2 == 0)
