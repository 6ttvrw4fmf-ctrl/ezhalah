"""The aqar COMMERCIAL fill must run on a schedule, 6 h clear of the residential fill, and stay green.

WHY (coverage audit 2026-09-28). aqar-commercial-fill.yml was dispatch-only and had not run since
2026-06-20; only a 3-page sweep of 12 cities kept aqar_commercial_listings alive. Every scraper here is
scheduled by pg_cron through trigger_gh_workflow(), which dispatches with NO inputs — so being
"scheduled" means three things, all asserted below:
  1. a committed cron.schedule() dispatches aqar-commercial-fill.yml at least daily, and no slot is
     within 6 h of the residential deep fill's (one paced writer per 6-hour window, for the disk);
  2. the workflow's input-less defaults are the paced fill (every page, a shared new-row budget);
  3. that exact input-less command, run for a town with no commercial ads at all, finishes GREEN —
     95 towns are scheduled and many publish nothing, which would otherwise redden every run.

The schedule is staged in sql/proposed/aqar_paced_fill.sql until the owner applies and mirrors it into
supabase/migrations/; the test reads whichever home holds it.

    python -m pytest scrapers/common/tests/test_aqar_commercial_fill_is_scheduled.py -q
"""
from __future__ import annotations

import re
import shlex
import sys
import types
from pathlib import Path

for _name, _attrs in (("supabase", {"Client": object, "create_client": lambda *a, **k: None}),
                      ("dotenv", {"load_dotenv": lambda *a, **k: None})):
    if _name not in sys.modules:
        sys.modules[_name] = types.ModuleType(_name)
        for _k, _v in _attrs.items():
            setattr(sys.modules[_name], _k, _v)

import scrapers.aqar.discover as D  # noqa: E402
import scrapers.aqar.run_commercial as C  # noqa: E402

ROOT = Path(__file__).resolve().parents[3]
SCHEDULE_RE = r"cron\.schedule\(\s*'[\w-]+'\s*,\s*'([^']+)'\s*,\s*\$\$select public\.trigger_gh_workflow\('%s'\)\$\$"

# aqar's real empty-state page (same fixture as test_aqar_sweep_requests_only_pages_aqar_serves.py).
EMPTY = ('<html><body>{\\"not_found\\":\\"لا توجد نتائج\\"}{"numberOfItems":0}'
         '<img src="https://assets.aqar.fm/icons/v2/search.svg"/> لا توجد نتائج </body></html>')


def _hours(workflow: str, sql: str) -> list[int]:
    m = re.findall(SCHEDULE_RE % re.escape(workflow), sql)
    assert m, f"no committed cron.schedule() dispatches {workflow}"
    minute, hour, dom, month, dow = m[-1].split()
    assert (dom, month, dow) == ("*", "*", "*"), f"{workflow} must run every day, got {m[-1]!r}"
    return [int(h) for h in hour.split(",")]


def test_commercial_fill_is_scheduled_paced_and_green_on_an_empty_town(monkeypatch):
    homes = sorted((ROOT / "supabase/migrations").glob("*aqar_paced_fill*.sql")) \
        or [ROOT / "sql/proposed/aqar_paced_fill.sql"]
    sql = homes[-1].read_text(encoding="utf-8")

    com, res = _hours("aqar-commercial-fill.yml", sql), _hours("aqar-deep-fill.yml", sql)
    gap = min(min(abs(c - r), 24 - abs(c - r)) for c in com for r in res)
    assert gap >= 6, f"commercial fill at {com}h is {gap}h from the residential fill at {res}h"

    wf = (ROOT / ".github/workflows/aqar-commercial-fill.yml").read_text(encoding="utf-8")
    assert re.search(r"^\s*workflow_dispatch:", wf, re.M), "pg_cron can only dispatch a workflow_dispatch"
    assert "FILL_RUN_KEY: aqar-commercial-fill:${{ github.run_id }}" in wf
    assert re.search(r"concurrency:\s*\n\s*group: aqar-commercial-fill\s*\n\s*cancel-in-progress: false", wf)

    # The exact command pg_cron's dispatch runs: every ${{ inputs.X || D }} is D.
    cmd = wf[wf.index("exec python -m scrapers.aqar.run_commercial"):].split("\n\n")[0]
    cmd = re.sub(r"\$\{\{\s*github\.event\.inputs\.\w+\s*\|\|\s*(-?\d+)\s*\}\}", r"\1", cmd)
    cmd = cmd.replace("${{ matrix.city }}", "badr").replace("\\\n", " ")
    argv = shlex.split(cmd)[3:]                       # drop exec python -m
    assert "${{" not in " ".join(argv), argv
    opts = {f: v for f, v in zip(argv, argv[1:]) if f.startswith("--") and not v.startswith("--")}
    assert opts["--pages"] == "0" and int(opts["--new-budget"]) > 0, opts

    ended = {}
    monkeypatch.setattr(D, "get", lambda url, *a, **k: types.SimpleNamespace(status_code=200, text=EMPTY))
    monkeypatch.setattr(C.db, "begin_run", lambda platform: 1)
    monkeypatch.setattr(C.db, "end_run", lambda run_id, **kw: ended.update(kw) or (kw["ok"] and (
        kw["rows_seen"] > 0 or kw.get("allow_empty", False))))
    monkeypatch.setattr(sys, "argv", argv)
    assert C.main() == 0, ended
    assert ended["rows_seen"] == 0 and ended["allow_empty"] is True, ended
