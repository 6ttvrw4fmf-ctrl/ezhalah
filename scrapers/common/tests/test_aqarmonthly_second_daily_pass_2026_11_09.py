"""aqarmonthly gets a SECOND daily full pass (--recheck-all) so its 24 h SLA has margin (2026-11-09).

repeat_bug:liveness_sla:aqarmonthly (alert 13739) re-raised 3 times in 7 days with verified_in_sla = 0
of 3,686: the 01:30 sweep was aqarmonthly's ONLY full pass, so every row was stamped in one batch, and
any day the sweep started later than the day before (03:12 on 11-09 vs 01:31 on 11-08) every row aged
past 24 h at once. The 13:02 recheck now reads every due row, struck or not, under its own label, with
the same 6 h rest between readings. Drives the real main() against the fake PostgREST.
"""
from __future__ import annotations

from pathlib import Path

from scrapers.common.tests import test_aqar_liveness_recheck_min_strikes as R

TABLE = R.TABLE


def test_recheck_all_reads_every_due_row_struck_or_not_under_the_recheck_label(monkeypatch):
    rows, labels, notes, read = R._run(monkeypatch, ["--recheck-all"])
    assert "gone-1" in read, read          # struck, due
    assert "gone-3" in read, read          # UNSTRUCK, due — the old recheck never read it
    assert "gone-2" not in read, read      # read 1 h ago: the 6 h rest still holds
    assert labels == [f"aqar_liveness_recheck:{TABLE}:0/1"]   # its own label, never the daily one
    assert rows[1]["active"] is False and rows[1]["missing_count"] == 3   # 3-strike grace unchanged
    assert rows[3]["missing_count"] == 1 and rows[3]["active"] is True     # first strike only
    assert "controls=5/5" in notes


def test_the_scheduled_recheck_gives_aqarmonthly_its_second_full_pass():
    wf = Path(".github/workflows/aqar-liveness-recheck.yml").read_text()
    line = next(l for l in wf.splitlines() if "--table aqarmonthly_residential_listings" in l)
    assert "--recheck-all" in line, line
    assert "--min-strikes" not in line, line
