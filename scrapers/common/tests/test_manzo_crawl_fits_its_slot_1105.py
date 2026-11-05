"""manzo's crawl is its liveness check (SOURCE_LIST_PRESENCE): a crawl killed by its job timeout stamps nothing.

Measured 2026-11-05: 1,062 detail records, HTTP 429 on 432 of them with ten workers (11-04 12:27), and the 10-minute
slot killed three runs in a row before end_run (11-04 12:44, 11-05 08:34, 08:40) — 89.5 % checked in 48 h and falling.
"""
from __future__ import annotations

import pathlib
import re

from scrapers.manzo import run as R

ROOT = pathlib.Path(__file__).resolve().parents[3]


def test_manzo_slot_fits_the_catalogue():
    wf = (ROOT / ".github/workflows/small-sources-sync.yml").read_text()
    m = re.search(r"source: manzo,[^}]*tmo: (\d+)", wf)
    assert m, "manzo must keep its small-sources-sync row"
    assert int(m.group(1)) >= 25, "1,062 records at ~2 s each with 429 back-off do not fit a 10-min slot"


def test_manzo_reads_with_few_enough_workers_to_avoid_429():
    assert 1 < R.DETAIL_WORKERS <= 5
