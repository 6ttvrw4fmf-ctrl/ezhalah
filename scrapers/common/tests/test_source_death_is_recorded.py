"""A source that goes dark must leave a scrape_runs row (senior run, 2026-08-27).

THE DEFECT THIS LOCKS IN
------------------------
Era Pulse captured nothing from 2026-08-24 04:22 until this was fixed, and for 74 hours the
database held no evidence that anything had even been ATTEMPTED. Not a failed run, not a zero-row
run — no row at all.

The cause was one line in the wrong place. `main()` fetched the catalogue FIRST and called
`db.begin_run()` only afterwards:

    first, pag = fetch_page(s, 1)
    if not first:
        print("✗ Era Pulse: list endpoint returned no properties")
        return 1                      # <-- exits having written NOTHING to scrape_runs
    ...
    run_id = db.begin_run("erapulse")  # <-- never reached when the source is dark

So the two states that MUST be distinguishable — "the source stopped answering us" and "the job
was never scheduled" — produced byte-identical evidence: the absence of a row. Every barrier that
reasons over `scrape_runs` (rows_collapse, silent_partial_success, run_duration_explosion, the
ok=false detectors) is structurally blind to a platform that fails this way, because they can only
inspect rows that exist.

Proof it was real, from the 2026-08-27 dispatch of small-sources-sync.yml (run 33046268466,
job 98430887487), which is the whole failure in four lines:

    06:33:33  Sync erapulse            (step start)
    06:34:04  ✗ Era Pulse: list endpoint returned no properties
    06:34:04  ##[error]Process completed with exit code 1.
              → rows in scrape_runs for that attempt: 0

The 31 seconds are exactly `fetch_page`'s retry ladder (2+4+6+8+10 = 30s), i.e. the source was
genuinely probed five times and answered nothing five times. The 23 sibling jobs in the same
workflow run all succeeded, so this was erapulse's source, not the runner or the workflow.

WHAT IT COST BEYOND THE OUTAGE ITSELF: mon_detect_silent_scraper_death was the only barrier that
noticed, 48h late, and its own alert detail said the platform had runs "still being attempted" —
a claim nothing in the database supported, since it had derived `last_attempt` from the last
SUCCESSFUL run (2026-08-24) because no other row existed. A barrier reporting a fact it cannot
observe is the same failure shape as run #62's "configured is not delivered".

THIS WAS A CLASS, NOT A PLATFORM. Seven scrapers had the identical ordering, each able to exit
non-zero on a dark source before opening a run row: aqaratikom, erapulse, jurash, mizlaj,
nowaisiry, ramzalqasim, satel. All seven now call `begin_run()` before the first source call and
close the row with `ok=False` on the empty-source bail. The repo already knew this rule — the
jazwtn leg in small-sources-sync.yml carries the comment "records a scrape_runs row BEFORE the
sitemap fetch so a re-block fails LOUD, not silently" — it just was not enforced anywhere.

WHAT THIS TEST DOES
-------------------
§1 is the class barrier: it parses every active scraper's `main()` and fails if the function can
reach a non-zero return before `db.begin_run()`. Static, so it needs no network and no database,
and it catches the defect in a scraper nobody thought to look at.

§2 pins the behaviour end-to-end on erapulse with a stubbed-dark source: begin_run is called, and
end_run is called with ok=False — NOT left dangling at ok=NULL, which would trip
mon_detect_dangling_scrape_run instead of reporting the real cause.

§3 pins that a `--limit` validation run still opens NO run row. Validation runs are deliberately
invisible to freshness/liveness accounting and must stay that way; a fix for §1 must not
"helpfully" start recording them.

ALLOWLIST. gathern's three early returns are NOT this defect and are excluded by name: they are
`--prune-from` safety refusals (missing --expect-shards, a partial shard union, an empty union) in
a mode that does no scraping at all. Opening a scrape_runs row for a refused prune would invent a
capture attempt that never happened. Any NEW name added to that allowlist needs the same kind of
reason written next to it.

Run: python -m pytest scrapers/common/tests/test_source_death_is_recorded.py
"""
from __future__ import annotations

import ast
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[3]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

SCRAPERS = ROOT / "scrapers"

# Platforms deliberately exempt from §1, each with the reason it is not this defect.
EXEMPT = {
    # Its three pre-begin_run returns are --prune-from safety refusals, not source deaths: the
    # process is not scraping in that mode, so there is no capture attempt to record.
    "gathern",
}


def _retired() -> set[str]:
    f = SCRAPERS / "RETIRED_PLATFORMS.txt"
    if not f.exists():
        return set()
    return {
        ln.strip()
        for ln in f.read_text().splitlines()
        if ln.strip() and not ln.strip().startswith("#")
    }


def _active_scrapers() -> list[Path]:
    retired = _retired()
    return sorted(
        p
        for p in SCRAPERS.glob("*/run.py")
        if p.parent.name not in retired and p.parent.name not in EXEMPT
    )


def _main_node(tree: ast.Module) -> ast.FunctionDef | None:
    for node in tree.body:
        if isinstance(node, ast.FunctionDef) and node.name == "main":
            return node
    return None


def _is_begin_run(node: ast.AST) -> bool:
    return (
        isinstance(node, ast.Call)
        and isinstance(node.func, ast.Attribute)
        and node.func.attr == "begin_run"
    )


def _is_nonzero_return(node: ast.AST) -> bool:
    """`return 1` / `return 2` / `raise SystemExit(1)` — a failure exit."""
    if isinstance(node, ast.Return):
        v = node.value
        return isinstance(v, ast.Constant) and isinstance(v.value, int) and v.value != 0
    if isinstance(node, ast.Raise) and isinstance(node.exc, ast.Call):
        f = node.exc.func
        name = getattr(f, "id", None) or getattr(f, "attr", None)
        if name == "SystemExit" and node.exc.args:
            a = node.exc.args[0]
            return isinstance(a, ast.Constant) and isinstance(a.value, int) and a.value != 0
    return False


def _first_begin_run_line(main: ast.FunctionDef) -> int | None:
    lines = [n.lineno for n in ast.walk(main) if _is_begin_run(n)]
    return min(lines) if lines else None


# ── §1 — the class barrier ───────────────────────────────────────────────────────────────────
@pytest.mark.parametrize("path", _active_scrapers(), ids=lambda p: p.parent.name)
def test_no_failure_exit_before_begin_run(path: Path) -> None:
    tree = ast.parse(path.read_text())
    main = _main_node(tree)
    if main is None:
        pytest.skip(f"{path.parent.name} has no main()")

    begin_line = _first_begin_run_line(main)
    if begin_line is None:
        pytest.skip(f"{path.parent.name}'s main() does not call begin_run()")

    offenders = [
        n.lineno for n in ast.walk(main) if _is_nonzero_return(n) and n.lineno < begin_line
    ]
    assert not offenders, (
        f"{path.parent.name}: main() can exit non-zero at line(s) "
        f"{offenders} before db.begin_run() at line {begin_line}. A source that goes dark would "
        f"leave NO scrape_runs row, making 'the source stopped answering' indistinguishable from "
        f"'the job never ran' — the erapulse defect of 2026-08-27. Move begin_run() above the "
        f"first source call and close the row with end_run(ok=False) on the bail."
    )


# ── §2 — erapulse end to end against a dark source ───────────────────────────────────────────
def test_erapulse_dark_source_records_a_failed_run(monkeypatch) -> None:
    from scrapers.erapulse import run as era

    calls: dict[str, object] = {}

    monkeypatch.setattr(era, "session", lambda: object())
    # The source answers nothing — exactly what fetch_page returns after its ladder is exhausted.
    monkeypatch.setattr(era, "fetch_page", lambda s, page: ([], {}))
    def _begin_run(platform):
        calls["begin"] = platform
        return 4242

    monkeypatch.setattr(era.db, "begin_run", _begin_run)

    def _end_run(run_id, *, ok, rows_seen, rows_upserted, notes=None, **kw):
        calls["end"] = {"run_id": run_id, "ok": ok, "notes": notes}
        return ok

    monkeypatch.setattr(era.db, "end_run", _end_run)
    monkeypatch.setattr(sys, "argv", ["run.py", "--type", "all"])

    rc = era.main()

    assert rc == 1, "a dark source must still be a non-zero exit"
    assert calls.get("begin") == "erapulse", (
        "begin_run() was never called — the run is invisible to scrape_runs, which is the defect"
    )
    end = calls.get("end")
    assert end is not None, (
        "end_run() was never called: the row would dangle at ok=NULL and surface as "
        "dangling_scrape_run instead of naming the real cause"
    )
    assert end["ok"] is False, "a dark source is not a successful run"
    assert end["run_id"] == 4242
    assert "no properties" in (end["notes"] or ""), "the note must say what actually happened"


# ── §3 — validation runs stay invisible ──────────────────────────────────────────────────────
def test_erapulse_limit_run_opens_no_scrape_run(monkeypatch) -> None:
    from scrapers.erapulse import run as era

    opened: list[str] = []
    monkeypatch.setattr(era, "session", lambda: object())
    monkeypatch.setattr(era, "fetch_page", lambda s, page: ([], {}))
    monkeypatch.setattr(era.db, "begin_run", lambda platform: opened.append(platform) or 1)
    monkeypatch.setattr(sys, "argv", ["run.py", "--type", "all", "--limit", "5"])

    assert era.main() == 1
    assert opened == [], (
        "a --limit validation run must NOT open a scrape_runs row — freshness and liveness "
        "accounting deliberately do not see validation runs"
    )
