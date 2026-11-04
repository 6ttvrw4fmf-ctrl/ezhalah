"""Every fleet recheck pass must start long enough after the one before it to find rested rows.

fleet-liveness-recheck.yml re-reads only struck rows whose last reading is >= REPROBE_MIN_HOURS old
(stamped when a site's run ENDS). 2026-11-04: a "minute only" cron rebalance (20261104000454) moved
gh-fleet-liveness-recheck-2 from 20:47 to 20:06, 5 h 49 min after the 14:17 pass, so no row the
first pass struck could ever take its third reading that evening; and on 11-03 even 20:47 read 0 tuba
rows because the 14:17 pass waited behind the daily run until 15:41. 20 tuba ads read dead three
times stayed shown. Migrations 20261104111452, 20261104111742 and 20261104113034 put the passes at 14:17, 20:56 and 03:27.

This reads the committed migrations (hermetic), takes each recheck job's LAST schedule — written by
cron.schedule(...), cron.alter_job, or a rebalance values row (name, old, new, cut) — and requires
every gap between consecutive passes to be at least REPROBE_MIN_HOURS + 30 minutes.
"""
import pathlib
import re

from scrapers.common.fleet_liveness import REPROBE_MIN_HOURS

MIG = pathlib.Path(__file__).resolve().parents[3] / "supabase" / "migrations"
JOB = r"gh-fleet-liveness-recheck(?:-\d+)?"
SHAPES = [
    re.compile(rf"cron\.schedule\(\s*'({JOB})'\s*,\s*'([^']+)'"),
    re.compile(rf"\(\s*'({JOB})'\s*,\s*'[^']+'\s*,\s*'([^']+)'\s*,\s*(?:true|false)\s*\)"),
]
ALTER = re.compile(rf"jobname\s*=\s*'({JOB})'.*?cron\.alter_job\([^,]+,\s*schedule\s*:=\s*'([^']+)'", re.S)
UNSCHEDULE = re.compile(rf"cron\.unschedule\(\s*'({JOB})'\s*\)")


def latest_schedules(root: pathlib.Path = MIG) -> dict[str, str]:
    out: dict[str, str] = {}
    for f in sorted(root.glob("*.sql")):
        sql = f.read_text(encoding="utf-8")
        events = [(m.start(), m.group(1), m.group(2)) for p in SHAPES for m in p.finditer(sql)]
        events += [(m.start(), m.group(1), m.group(2)) for m in ALTER.finditer(sql)]
        events += [(m.start(), m.group(1), None) for m in UNSCHEDULE.finditer(sql)]
        for _, name, sched in sorted(events):
            if sched is None:
                out.pop(name, None)
            else:
                out[name] = sched
    return out


def start_minutes(sched: str) -> list[int]:
    minute, hour, *_ = sched.split()
    assert minute.isdigit() and re.fullmatch(r"\d+(,\d+)*", hour), f"unexpected recheck schedule {sched!r}"
    return [int(h) * 60 + int(minute) for h in hour.split(",")]


def gaps(scheds: dict[str, str]) -> list[int]:
    starts = sorted(m for s in scheds.values() for m in start_minutes(s))
    return [(b - a) % 1440 for a, b in zip(starts, starts[1:] + starts[:1])]


def test_every_recheck_pass_is_rested_after_the_previous():
    scheds = latest_schedules()
    assert "gh-fleet-liveness-recheck" in scheds, scheds
    need = REPROBE_MIN_HOURS * 60 + 30
    assert min(gaps(scheds)) >= need, (scheds, gaps(scheds))


def test_the_2026_11_04_rebalance_shape_is_caught():
    """The mutation this guards: recheck at 14:17 and 20:06 is a 349-minute gap."""
    bad = {"gh-fleet-liveness-recheck": "17 14 * * *", "gh-fleet-liveness-recheck-2": "6 20 * * *"}
    assert min(gaps(bad)) < REPROBE_MIN_HOURS * 60 + 30


def test_parser_reads_all_three_shapes(tmp_path):
    (tmp_path / "1.sql").write_text("select cron.schedule('gh-fleet-liveness-recheck-2', '47 20 * * *', $$x$$);")
    (tmp_path / "2.sql").write_text("('gh-fleet-liveness-recheck-2', '47 20 * * *', '6 20 * * *', false),")
    assert latest_schedules(tmp_path)["gh-fleet-liveness-recheck-2"] == "6 20 * * *"
    (tmp_path / "3.sql").write_text("where jobname = 'gh-fleet-liveness-recheck-2' and x;\n"
                                    "perform cron.alter_job(v_id, schedule := '48 20 * * *');")
    assert latest_schedules(tmp_path)["gh-fleet-liveness-recheck-2"] == "48 20 * * *"
