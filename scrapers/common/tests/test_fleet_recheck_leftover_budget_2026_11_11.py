"""The recheck's 12-minute per-site budget is a floor; the time small sites leave goes to the biggest backlog.

♻️ 2026-11-11: nofodh had 873 rows struck at the 11-10 daily run (its own pages read 404) and each
recheck read only 96-99 of them in 12 minutes (≈6.7 s a read), while the 120-minute job left ~60 minutes
unused. 777 dead nofodh ads stayed on screen at one strike.
"""
from __future__ import annotations

import re
from pathlib import Path

from scrapers.common import fleet_liveness as fl

ROOT = Path(__file__).resolve().parents[3]


def test_the_floor_holds_when_the_job_is_crowded():
    assert fl.recheck_budget_s(0, 1000) == fl.RECHECK_BUDGET_S
    assert fl.recheck_budget_s(fl.RECHECK_JOB_S + 60, 1) == fl.RECHECK_BUDGET_S


def test_the_last_site_inherits_what_the_small_sites_left():
    # 51 minutes used by the small sites (the 11-11 03:27 pass reached nofodh at 04:21): the last site gets the rest
    assert fl.recheck_budget_s(51 * 60, 1) == fl.RECHECK_JOB_S - 51 * 60
    assert fl.recheck_budget_s(51 * 60, 1) > 3 * fl.RECHECK_BUDGET_S


def test_the_share_is_split_over_the_sites_still_to_read():
    assert fl.recheck_budget_s(0, 2) == fl.RECHECK_JOB_S / 2


def test_main_hands_the_leftover_to_the_biggest_backlog(monkeypatch):
    clock = {"t": 0.0}
    got = {}

    def fake_run_site(site, *, shadow, struck_only, budget_s=None):
        got[site] = budget_s
        clock["t"] += 30.0                     # every small site finishes in 30 s

    monkeypatch.setattr(fl.time, "monotonic", lambda: clock["t"])
    monkeypatch.setattr(fl, "recheck_order", lambda _c, sites: sites)
    monkeypatch.setattr(fl, "sb", lambda: None)
    monkeypatch.setattr(fl, "run_site", fake_run_site)
    monkeypatch.setattr("sys.argv", ["fleet_liveness", "--struck-only", "--site", "haraj", "--site", "tuba",
                                     "--site", "nofodh"])
    assert fl.main() == 0
    assert got["haraj"] == fl.RECHECK_JOB_S / 3
    assert got["nofodh"] == fl.RECHECK_JOB_S - 60.0      # all of what the first two left


def test_the_daily_run_keeps_its_own_budget(monkeypatch):
    got = {}
    monkeypatch.setattr(fl, "sb", lambda: None)
    monkeypatch.setattr(fl, "run_site", lambda site, **k: got.__setitem__(site, k.get("budget_s")))
    monkeypatch.setattr("sys.argv", ["fleet_liveness", "--site", "nofodh"])
    assert fl.main() == 0
    assert got == {"nofodh": None}


def test_the_job_budget_fits_the_workflow_ceiling():
    text = (ROOT / ".github/workflows/fleet-liveness-recheck.yml").read_text()
    ceiling = int(re.search(r"timeout-minutes:\s*(\d+)", text).group(1))
    # setup (~3 min), the closing controls of the last site and its writes must still fit
    assert fl.RECHECK_JOB_S <= (ceiling - 20) * 60


# CodeRabbit on #11829: the tests above stub run_site, so a run_site that ignored the override would
# still pass them. These run the REAL run_site against the fake PostgREST of test_fleet_liveness.
from scrapers.common.tests.test_fleet_liveness import _controls, _row, site  # noqa: E402,F401


def _struck_backlog(n):
    rows = [_row(i, mc=1, seen_h=30) for i in range(1, n + 1)]
    for r in rows:
        r["last_liveness_probe_at"] = "2026-01-01T00:00:00+00:00"   # rested well past REPROBE_MIN_HOURS
    return rows + _controls()


def _probed_with(site, monkeypatch, budget_s):
    # controls (A100-A104) read live, so the run is trusted; every struck row reads UNKNOWN (no hide, no reset)
    site(_struck_backlog(400), {f"A{100 + k}": "live" for k in range(5)}, default="unknown")
    clock = {"t": 0.0}

    def tick():
        clock["t"] += 10.0            # every clock read is 10 s of a slow site
        return clock["t"]

    monkeypatch.setattr(fl.time, "monotonic", tick)
    monkeypatch.setattr(fl.time, "sleep", lambda *_: None)
    return fl.run_site("testsite", shadow=False, struck_only=True, budget_s=budget_s)["probed"]


def test_the_real_run_site_reads_past_the_floor_when_given_more(site, monkeypatch):
    floor = _probed_with(site, monkeypatch, None)              # no override: the 12-minute floor
    more = _probed_with(site, monkeypatch, 3 * fl.RECHECK_BUDGET_S)
    assert 0 < floor < 400
    assert more > 2 * floor, (floor, more)                     # the override is what stops the loop


def test_the_real_run_site_stops_at_the_override(site, monkeypatch):
    short = _probed_with(site, monkeypatch, fl.RECHECK_BUDGET_S / 4)
    floor = _probed_with(site, monkeypatch, None)
    assert short < floor
