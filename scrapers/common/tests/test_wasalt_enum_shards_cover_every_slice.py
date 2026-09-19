"""The sharded enum workflow must enumerate EVERY slice run.py knows about — no more, no less.

This is the safety-critical invariant of the sharded enumeration. run_enum_strike() strikes every
active listing not seen by "the enumeration", across BOTH the residential and commercial tables. If
the workflow matrix omits even one (type, slug, deal) slice, that slice is never crawled, every live
listing in it is counted "unseen", and at grace it is deactivated. A whole commercial category was
omitted in the first draft (the matrix carried only the 10 residential slugs); this pins it shut.

It also pins --shards-expected to the matrix size, because the rollup's "did every shard report?"
guard is only as good as that number matching reality: set it too low and a genuinely missing shard
still clears the bar.

Run: python -m pytest scrapers/common/tests/test_wasalt_enum_shards_cover_every_slice.py -v
"""
from __future__ import annotations

import re
from pathlib import Path

import yaml

from scrapers.wasalt.run import SLUGS

WF = Path(__file__).resolve().parents[3] / ".github/workflows/wasalt-enum-liveness.yml"


def _expected_slices() -> set[tuple[str, str, str]]:
    return {(t, slug, deal)
            for t, slugs in SLUGS.items() for slug in slugs for deal in ("sale", "rent")}


def _matrix_slices() -> list[dict]:
    wf = yaml.safe_load(WF.read_text())
    return wf["jobs"]["enum"]["strategy"]["matrix"]["include"]


def test_matrix_covers_exactly_the_slices_runpy_knows():
    expected = _expected_slices()
    got = [(e["type"], e["slug"], e["deal"]) for e in _matrix_slices()]
    got_set = set(got)

    missing = expected - got_set   # slices that would be struck wholesale — the dangerous direction
    extra = got_set - expected     # harmless but a sign of drift
    assert not missing, f"slices NEVER enumerated (their live listings would be struck): {sorted(missing)}"
    assert not extra, f"matrix has slices run.py does not know: {sorted(extra)}"
    assert len(got) == len(got_set), "duplicate slice in the matrix"


def test_both_tables_are_represented():
    """The strike step touches residential AND commercial; a matrix that is all one type would
    silently strike the entire other table."""
    types = {e["type"] for e in _matrix_slices()}
    assert types == {"residential", "commercial"}, types


def test_shards_expected_equals_the_matrix_size():
    n = len(_matrix_slices())
    wf = WF.read_text()
    m = re.search(r"--shards-expected\s+(\d+)", wf)
    assert m, "no --shards-expected in the workflow"
    assert int(m.group(1)) == n, (
        f"--shards-expected={m.group(1)} but the matrix has {n} shards — the rollup's "
        "every-shard-reported guard would pass while a slice is missing")


def test_shards_do_not_write_the_wasalt_platform_row():
    """The shards must publish under the shard platform; a 'wasalt' row from one ~3k slice would be
    read by the coverage guard as the whole enumeration."""
    wf = WF.read_text()
    assert 'WASALT_RUN_LABEL: "wasalt_enum_shard"' in wf
    from scrapers.wasalt.liveness import SHARD_PLATFORM
    assert SHARD_PLATFORM == "wasalt_enum_shard"
