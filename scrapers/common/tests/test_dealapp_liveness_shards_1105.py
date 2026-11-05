"""dealapp's hourly sweep runs as id-partitioned shards, one runner IP each (owner 2026-11-05).

Measured 2026-11-05: one sweep per hour, ~600 ads read in ~50 min (~420 verified) → ~10k fresh reads
a day for 55,971 active rows, 65.0 % inside the 48 h window. dealapp's view quota is per visitor IP,
so three shards on three GitHub runners read three times as many ads with no proxy. These tests pin
(1) the partition: every row in exactly one shard, never two shards on one row; and (2) the wiring:
the scheduled path really passes three shards and the sweep really reads --shard (a flag nobody
passes is a fix that never ran, lesson 2026-11-01).

Proof is the first scheduled hourly run after merge (gh-dealapp-liveness, :40): three dealapp_liveness rows whose
notes carry shard=0/3, 1/3, 2/3. Never dispatch the sweep from this PR's branch to prove it: its jobs attach to the
PR's head SHA as check runs, and a sweep the hourly run displaces reads «cancelled» to the merge gate (2026-11-05).
"""
from __future__ import annotations

import pathlib
import re

import pytest

from scrapers.dealapp.liveness_run import in_shard, parse_shard

ROOT = pathlib.Path(__file__).resolve().parents[3]


def test_parse_shard():
    assert parse_shard("") == (0, 1)
    assert parse_shard("0/1") == (0, 1)
    assert parse_shard("2/3") == (2, 3)
    for bad in ("3/3", "-1/3", "1/0"):
        with pytest.raises(ValueError):
            parse_shard(bad)


def test_every_row_in_exactly_one_shard():
    for n in (1, 2, 3, 5):
        for rid in range(1, 2000):
            owners = [i for i in range(n) if in_shard({"id": rid}, i, n)]
            assert owners == [rid % n], (rid, n, owners)


def test_unsharded_reads_everything():
    assert all(in_shard({"id": rid}, 0, 1) for rid in range(1, 500))


def test_scheduled_path_runs_three_shards():
    cron = (ROOT / ".github/workflows/dealapp-liveness-cron.yml").read_text()
    m = re.search(r"shards:\s*'(\[.*?\])'", cron)
    assert m, "dealapp-liveness-cron.yml must pass a shards list"
    assert m.group(1) == '["0/3","1/3","2/3"]'


def test_sweep_reads_its_matrix_shard():
    wf = (ROOT / ".github/workflows/dealapp-liveness.yml").read_text()
    assert "shard: ${{ fromJSON(inputs.shards" in wf
    assert '--shard "${{ matrix.shard }}"' in wf
    src = (ROOT / "scrapers/dealapp/liveness_run.py").read_text()
    assert "in_shard(r, shard_idx, shard_n)" in src, "the worklist must be filtered by shard"
