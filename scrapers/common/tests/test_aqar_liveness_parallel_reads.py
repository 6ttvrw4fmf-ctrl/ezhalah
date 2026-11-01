"""Backlog 1140 (2026-11-01): the aqar sweep reads each chunk's pages on a few threads.

sa.aqar.fm went from <0.3 s to ~1.4 s per page on 10-31 and every one-at-a-time shard was
SIGINT-killed at the 120-min cap. These tests pin the three things the fix must hold:
  1. the reads overlap (a slow source no longer multiplies shard time by its latency);
  2. the per-host START spacing (http._throttle) still holds across threads — no extra load on aqar;
  3. every url gets exactly one outcome, and an exception is None (UNKNOWN), never dropped.
"""
from __future__ import annotations

import threading
import time

import scrapers.common.http as http
from scrapers.aqar import liveness


def test_reads_overlap_on_a_slow_source():
    def slow(u):
        time.sleep(0.4)
        return u.upper()
    urls = [f"https://x/{i}" for i in range(8)]
    t0 = time.monotonic()
    got = liveness.prefetch_pages(urls, slow, workers=4)
    took = time.monotonic() - t0
    assert got == {u: u.upper() for u in urls}
    # sequential would be 3.2 s; four threads ≈ 0.8 s
    assert took < 1.8, f"reads did not overlap ({took:.2f}s for 8 x 0.4 s)"


def test_one_worker_is_the_old_sequential_behaviour():
    order = []
    liveness.prefetch_pages(["a", "b", "c"], lambda u: order.append(u), workers=1)
    assert order == ["a", "b", "c"]


def test_exception_is_no_answer_and_every_url_has_an_outcome():
    def flaky(u):
        if u == "boom":
            raise RuntimeError("connection reset")
        return 200
    got = liveness.prefetch_pages(["ok", "", "boom", "ok"], flaky, workers=4)
    assert got == {"ok": 200, "boom": None}  # empty url skipped, duplicate read once


def test_per_host_start_spacing_still_holds_across_threads(monkeypatch):
    monkeypatch.setattr(http, "MIN_INTERVAL", 0.15)
    http._last_hit.pop("spacing.test", None)
    starts, lock = [], threading.Lock()

    def fetch(u):
        http._throttle(u)
        with lock:
            starts.append(time.monotonic())
        time.sleep(0.3)  # slow source
        return 200
    liveness.prefetch_pages([f"https://spacing.test/{i}" for i in range(6)], fetch, workers=4)
    starts.sort()
    # _throttle reserves slots MIN_INTERVAL apart and adds up to 0.08 s jitter to each start, so
    # the honest bound is: 6 starts span >= 5 slots minus one jitter, and no two land together.
    gaps = [b - a for a, b in zip(starts, starts[1:])]
    assert starts[-1] - starts[0] >= 5 * 0.15 - 0.09, f"threads burst the host: gaps {gaps}"
    assert min(gaps) >= 0.15 - 0.09, f"two starts landed together: gaps {gaps}"


def test_sweep_reads_rows_through_the_prefetch_not_one_get_per_row():
    src = open(liveness.__file__, encoding="utf-8").read()
    loop = src.split("for row in rows:", 1)[1].split("_detail(row[\"id\"], status", 1)[0]
    assert "pages.get(url)" in loop
    assert "get(url, max_retries" not in loop, "the per-row sequential read is back"
    assert liveness.READ_WORKERS >= 2
