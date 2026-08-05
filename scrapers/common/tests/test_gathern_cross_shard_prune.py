"""Guards for the gathern cross-shard prune (inventory investigation, 2026-08-04).

THE FAILURE THIS PREVENTS — a silent, 9-day, whole-platform staleness leak:
gathern's crawl became a 12-way sharded matrix on 2026-07-27. The scraper deliberately refuses to
prune on a sharded run (a shard sees ~1/12 of the cities, so pruning by source would deactivate the
other 11/12), and the code comment assumed "the cron's full pass runs with no --cities, so that's the
one that prunes". After the move to shards there WAS no full pass — so nothing pruned gathern at all.
27k listings (15% of the whole index) stopped being aged out; 3,005 went 7+ days unseen while still
shown to users as available. `pruned=0` appeared in every run's notes and every run reported ok=true.

The contract these tests pin is the one that broke: the workflow's shard count, the artifact wiring,
and the scraper's fail-closed union check must agree. If someone changes the matrix width, or drops
the prune job, or removes --emit-seen, these fail instead of production going quietly stale.

Run: python -m pytest scrapers/common/tests/test_gathern_cross_shard_prune.py
"""
from __future__ import annotations

import re
from pathlib import Path

import yaml

REPO = Path(__file__).resolve().parent.parent.parent.parent
RUN_PY = (REPO / "scrapers" / "gathern" / "run.py").read_text(encoding="utf-8")
WORKFLOW_PATH = REPO / ".github" / "workflows" / "gathern-sync.yml"
WORKFLOW_RAW = WORKFLOW_PATH.read_text(encoding="utf-8")
WORKFLOW = yaml.safe_load(WORKFLOW_RAW)


# ── the workflow half of the contract ────────────────────────────────────────────────────────────
def test_a_prune_job_exists_and_waits_for_every_shard() -> None:
    jobs = WORKFLOW["jobs"]
    assert "prune" in jobs, (
        "gathern-sync.yml has no prune job. A sharded crawl NEVER prunes, so without this job "
        "gathern stops ageing out sold/booked listings entirely — the 2026-07-27 regression."
    )
    needs = jobs["prune"]["needs"]
    needs = [needs] if isinstance(needs, str) else needs
    assert "sync" in needs, "the prune job must run after the shards, or it unions nothing"


def test_prune_expects_exactly_the_matrix_width() -> None:
    """If the matrix is rewidened, --expect-shards must move with it or the prune fails closed."""
    shards = WORKFLOW["jobs"]["sync"]["strategy"]["matrix"]["shard"]
    steps = WORKFLOW["jobs"]["prune"]["steps"]
    run_cmds = " ".join(s.get("run", "") for s in steps)
    m = re.search(r"--expect-shards\s+(\d+)", run_cmds)
    assert m, "the prune job must pass --expect-shards so a partial union can never prune"
    assert int(m.group(1)) == len(shards), (
        f"--expect-shards {m.group(1)} != matrix width {len(shards)}. These must agree: too high and "
        "the prune never runs (silent staleness again), too low and it prunes on a partial union "
        "(deactivating live listings in the missing shards' cities)."
    )


def test_every_shard_emits_its_seen_set_and_uploads_it() -> None:
    steps = WORKFLOW["jobs"]["sync"]["steps"]
    run_cmds = " ".join(s.get("run", "") for s in steps)
    assert "--emit-seen" in run_cmds, "shards must write their seen ad_numbers for the union"
    uploads = [s for s in steps if "upload-artifact" in str(s.get("uses", ""))]
    assert uploads, "shard seen-sets must be uploaded as artifacts or the prune job cannot read them"
    assert uploads[0]["with"].get("if-no-files-found") == "error", (
        "if-no-files-found must be 'error': a shard that crawled but wrote no seen-file would "
        "otherwise silently shrink the union, and its cities would look unseen."
    )


def test_prune_job_downloads_all_shard_artifacts() -> None:
    steps = WORKFLOW["jobs"]["prune"]["steps"]
    dl = [s for s in steps if "download-artifact" in str(s.get("uses", ""))]
    assert dl, "the prune job must download the shard artifacts"
    with_ = dl[0]["with"]
    assert with_.get("merge-multiple") is True, "all shard files must land in ONE directory"
    assert "gathern-seen" in str(with_.get("pattern", "")), "must pattern-match the shard artifacts"


# ── the scraper half of the contract ─────────────────────────────────────────────────────────────
def test_sharded_runs_still_never_prune_directly() -> None:
    """The original safety property must survive the fix."""
    assert "if args.cities or args.shard:" in RUN_PY and "NO prune (partial run)" in RUN_PY, (
        "a --shard/--cities run must still skip the direct prune; only the union job may deactivate."
    )


def test_prune_from_fails_closed_on_a_partial_union() -> None:
    """Wrong shard count, or an empty union, must ABORT rather than prune."""
    assert 'if len(files) != args.expect_shards:' in RUN_PY, (
        "--prune-from must compare the file count to --expect-shards and refuse on a mismatch"
    )
    assert "Refusing to prune on a partial union" in RUN_PY
    assert "if not seen:" in RUN_PY and "union is empty" in RUN_PY, (
        "an empty union must abort — prune_unseen against an empty set would target everything"
    )
    assert "if args.expect_shards <= 0:" in RUN_PY, (
        "--prune-from without --expect-shards must refuse (unknown slice count)"
    )


def test_prune_from_prunes_the_real_table_with_the_union() -> None:
    body = RUN_PY[RUN_PY.index("if args.prune_from:") :]
    body = body[: body.index("\n    ci, co = ") if "\n    ci, co = " in body else len(body)]
    assert 'db.prune_unseen("gathern_residential_listings", seen, source=SOURCE)' in body, (
        "the union job must call prune_unseen with the UNIONED seen-set"
    )
    assert "if pruned < 0:" in body, "prune_unseen's guard-tripped return must still be handled"


def test_emit_seen_writes_ad_numbers_one_per_line() -> None:
    assert 'fh.write("\\n".join(sorted(r["ad_number"] for r in rows)))' in RUN_PY, (
        "--emit-seen must write bare ad_numbers, one per line — that is what --prune-from parses"
    )


def test_union_parsing_round_trips(tmp_path) -> None:
    """EXECUTED: emit-then-union must reproduce the full set across shards, deduped."""
    shards = [["GA1", "GA2"], ["GA3"], ["GA2", "GA4"]]  # note GA2 appears twice
    for i, ads in enumerate(shards):
        (tmp_path / f"shard-{i}.txt").write_text("\n".join(sorted(ads)), encoding="utf-8")
    seen: set[str] = set()
    for f in sorted(tmp_path.glob("*.txt")):
        seen |= {ln.strip() for ln in f.read_text(encoding="utf-8").splitlines() if ln.strip()}
    assert seen == {"GA1", "GA2", "GA3", "GA4"}, f"union lost or duplicated ids: {seen}"
