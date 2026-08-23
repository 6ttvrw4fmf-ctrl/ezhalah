"""Regression tests for the 2026-08-23 souq24 harvest stall.

WHAT HAPPENED. souq24's last three scheduled runs (08-19, 08-21, 08-23) were each SIGINT-killed at
~134 minutes having upserted ZERO rows, after months of clean 7-22 minute runs. The cause was not
the proxy and not the source blocking us — it was harvest_ids():

  - it walked EVERY browse page SERIALLY,
  - at a 40s per-page timeout,
  - over a page list whose size is set by the sitemap's /view/ section, which is outside our
    control and grew.

That is an unbounded cost by construction: (pages) x (latency), no ceiling. Measured on 2026-08-23
the process started at 04:22:44 and did not reach begin_run() until 04:38:26 — sixteen minutes gone
before the id sweep had even started, after which the job ran out its 150-minute budget and died.

TWO SEPARATE DEFECTS, both fixed here and both tested:

1. OBSERVABILITY. begin_run() sat AFTER harvest_ids(), so a run that stalled in the harvest never
   wrote a scrape_runs row at all. It read as "never ran" rather than "ran and is stuck", which
   made it invisible to every scrape_runs-based barrier — including the run_duration_explosion
   detector added the same day specifically to catch stalls. Three deaths passed unseen.

2. THE STALL ITSELF. Concurrency + a per-page ceiling + a total wall-clock budget.

And one safety property that the fix must not break: a short harvest may miss listing ids above the
numeric sweep's 1300 floor, and an unscraped-but-live listing is precisely what prune_unseen()
inactivates. So an incomplete harvest must SUPPRESS pruning. Upserts still land; only the
destructive half is withheld.

Hermetic: fake sessions, no network, no DB.
"""
from __future__ import annotations

import inspect
import re
import threading
import time
from unittest import mock

from scrapers.souq24 import run as sq


class _FakeSession:
    """Browse pages answer after `latency` seconds with a body containing `ids_per_page` ids."""

    def __init__(self, latency: float = 0.0, ids_per_page: int = 2, sitemap_pages: int = 0):
        self.latency = latency
        self.ids_per_page = ids_per_page
        self.sitemap_pages = sitemap_pages
        self.concurrent = 0
        self.max_concurrent = 0
        self.calls: list[str] = []
        self._lock = threading.Lock()
        self._n = 0

    def get(self, url, timeout=None, **kw):
        if url == sq.SITEMAP:
            locs = "".join(
                f"<loc>https://24.com.sa/view/slug-{i}</loc>" for i in range(self.sitemap_pages))
            return mock.Mock(text=f"<urlset>{locs}</urlset>")
        with self._lock:
            self.calls.append(url)
            self.concurrent += 1
            self.max_concurrent = max(self.max_concurrent, self.concurrent)
            self._n += 1
            n = self._n
        try:
            if self.latency:
                time.sleep(self.latency)
            body = "".join(
                f'href="https://24.com.sa/{n * 100 + k}/slug"' for k in range(self.ids_per_page))
            return mock.Mock(text=body)
        finally:
            with self._lock:
                self.concurrent -= 1


# ── Defect 1: observability ──────────────────────────────────────────────────────────────────

def test_begin_run_is_called_before_any_crawling():
    """THE INVISIBILITY BUG. If begin_run() runs after harvest_ids(), a run that stalls in the
    harvest writes no scrape_runs row at all and no barrier can see it. Structural check on the
    source, because the ordering is the whole property."""
    src = inspect.getsource(sq.main)
    assert 'db.begin_run("souq24")' in src
    assert "harvest_ids(s)" in src
    assert src.index('db.begin_run("souq24")') < src.index("harvest_ids(s)"), (
        "begin_run() must precede harvest_ids() — otherwise a harvest stall is invisible to every "
        "scrape_runs-based barrier, which is exactly how three souq24 deaths went unnoticed"
    )


def test_harvest_failure_still_closes_the_run_out():
    """Registering the run early is only safe if a later exception still ends it. The except-arm
    must call end_run(ok=False) so a stalled/failed harvest lands as a FAILED run, not a dangling
    one."""
    src = inspect.getsource(sq.main)
    tail = src[src.index("except Exception"):]
    assert "end_run(run_id, ok=False" in tail, (
        "with begin_run() moved earlier, the except-arm must close the run out as ok=False"
    )


# ── Defect 2: the stall ──────────────────────────────────────────────────────────────────────

def test_browse_pages_are_fetched_concurrently_not_serially():
    """THE ACTUAL STALL. Serial fetching made cost = pages x latency with no ceiling. With 24+
    pages at 0.05s each, a serial walk cannot exceed 1 concurrent request; the pool must."""
    s = _FakeSession(latency=0.05, sitemap_pages=40)
    ids, mx, complete = sq.harvest_ids(s)
    assert complete is True
    assert s.max_concurrent > 1, (
        f"browse pages must be fetched concurrently, saw max_concurrent={s.max_concurrent} "
        "(serial walk = the 2026-08-23 stall)"
    )
    assert ids, "a healthy harvest must return seed ids"


def test_harvest_respects_its_wall_clock_budget_and_reports_incomplete():
    """The budget is what converts 'the run dies with zero rows' into 'the harvest is short and
    says so'. With a tiny budget and slow pages, it must stop and report complete=False."""
    s = _FakeSession(latency=0.2, sitemap_pages=200)
    with mock.patch.object(sq, "_HARVEST_BUDGET_S", 0.3):
        ids, mx, complete = sq.harvest_ids(s)
    assert complete is False, "blowing the budget must be reported, not silently swallowed"
    assert len(s.calls) < 200 + 23, "the harvest must actually stop early, not just flag itself"


def test_a_fast_harvest_is_complete():
    """Both directions: a harvest that finishes inside its budget must report complete=True, or the
    prune suppression below would fire on every healthy run and stale listings would accumulate
    forever."""
    s = _FakeSession(latency=0.0, sitemap_pages=5)
    ids, mx, complete = sq.harvest_ids(s)
    assert complete is True
    assert mx == max(ids)


def test_per_page_timeout_is_bounded_and_budget_is_sane():
    """Pin the constants. A 40s per-page timeout over an unbounded page list is the original bug;
    a future 'tidy-up' must not restore it."""
    assert sq._HARVEST_PAGE_TIMEOUT_S <= 20, "a hung browse page must cost seconds, not 40s"
    assert sq._HARVEST_WORKERS >= 2, "the harvest must be concurrent"
    assert 60 <= sq._HARVEST_BUDGET_S <= 1800, "the budget must exist and be within one job"


def test_timeout_is_actually_passed_to_the_fetch():
    """A constant nothing reads is decoration. Prove the per-page ceiling reaches s.get()."""
    seen: list = []

    class _S(_FakeSession):
        def get(self, url, timeout=None, **kw):
            seen.append(timeout)
            return super().get(url, timeout=timeout, **kw)

    sq.harvest_ids(_S(sitemap_pages=2))
    browse_timeouts = [t for t in seen if t is not None]
    assert browse_timeouts, "harvest must pass an explicit timeout"
    assert all(t <= 20 for t in browse_timeouts), f"unbounded timeout leaked through: {seen}"


# ── The safety property the fix must not break ───────────────────────────────────────────────

def test_incomplete_harvest_suppresses_pruning():
    """UNDER-ENUMERATION GUARD. The numeric sweep floors at id 1300, so a short harvest cannot hide
    ids below that — but ids ABOVE it come only from the browse pages, and an unscraped live
    listing is what prune_unseen() inactivates. main() must therefore refuse to prune when the
    harvest was truncated. Structural, because the branch is the contract."""
    src = inspect.getsource(sq.main)
    assert "harvest_complete" in src, "main() must read the harvest's completeness flag"
    prune_at = src.index("db.prune_unseen(")
    # The guard was later widened to cover an aborted detail sweep too; match on the harvest limb
    # so this test keeps asserting ITS property without pinning the sweep limb's exact wording.
    guard_at = src.index("if not harvest_complete")
    assert guard_at < prune_at, (
        "the incomplete-harvest guard must come BEFORE prune_unseen() — otherwise a truncated "
        "crawl inactivates live listings, the exact harm this guard exists to prevent"
    )


def test_harvest_ids_returns_the_completeness_flag():
    """The signature itself is load-bearing: a 2-tuple return would silently drop the flag and any
    caller unpacking it would crash or, worse, treat the flag as an id."""
    s = _FakeSession(sitemap_pages=1)
    out = sq.harvest_ids(s)
    assert isinstance(out, tuple) and len(out) == 3, f"expected (ids, mx, complete), got {out!r}"
    assert isinstance(out[2], bool)


def test_all_pages_failing_is_INCOMPLETE_even_though_the_budget_was_never_hit():
    """THE 2026-08-17 SHAPE. The egress failed, every browse page errored, the harvest still
    finished fast — so the budget was never touched. If completeness keyed only on the budget,
    this returns complete=True on an EMPTY seed set and the run goes on to prune. That day souq24
    returned 8 rows instead of 43 and reported ok=true: an 81% silent loss no barrier caught."""

    class _AllFail(_FakeSession):
        def get(self, url, timeout=None, **kw):
            if url == sq.SITEMAP:
                return super().get(url, timeout=timeout, **kw)
            raise ConnectionError("simulated egress denial")

    s = _AllFail(sitemap_pages=3)
    ids, mx, complete = sq.harvest_ids(s)
    assert ids == set(), "no page was readable, so there can be no seed ids"
    assert complete is False, (
        "every page failing must be INCOMPLETE — keying completeness on the budget alone lets a "
        "total egress failure through as a 'complete' empty harvest, and the run then prunes"
    )


def test_a_partial_page_failure_is_also_incomplete():
    """The dangerous middle case: most pages answer, a few do not. The seed set is short but
    non-empty, so neither an emptiness check nor prune_unseen's collapse guard would catch it.
    An unread page is an un-enumerated page."""
    state = {"n": 0}

    class _SomeFail(_FakeSession):
        def get(self, url, timeout=None, **kw):
            if url == sq.SITEMAP:
                return super().get(url, timeout=timeout, **kw)
            state["n"] += 1
            if state["n"] % 5 == 0:
                raise ConnectionError("simulated intermittent denial")
            return super().get(url, timeout=timeout, **kw)

    s = _SomeFail(sitemap_pages=10)
    ids, mx, complete = sq.harvest_ids(s)
    assert ids, "most pages answered, so there ARE seed ids — this is the subtle case"
    assert complete is False, (
        "a partially-read harvest must not count as complete: the missing pages may hold the very "
        "ids above the 1300 numeric floor that pruning would then inactivate"
    )


# ── The SECOND unbounded loop (2026-08-23, second pass) ──────────────────────────────────────
# Bounding harvest_ids() alone only moved the bottleneck. fetch_one() had the identical shape:
# 3 attempts x 40s + backoff = 122.4s per id, and 1316 candidates at 8 workers = ~336 MINUTES
# against a timeout-minutes: 150 job. Under proxy denial the run could not finish — it just got
# SIGINT-killed from the detail phase instead of the harvest phase.

def test_detail_sweep_worst_case_fits_inside_the_job_timeout():
    """THE ARITHMETIC THAT MATTERS. Whatever the constants are, the sweep's worst case must be
    bounded below the CI job budget — otherwise total denial guarantees a kill with zero rows,
    which is the failure this whole exercise removed from the harvest."""
    per_id = 3 * sq._SWEEP_TIMEOUT_S + (0.8 + 1.6)
    worst_min = (sq.ID_CAP / sq.WORKERS) * per_id / 60.0
    assert sq._SWEEP_BUDGET_S / 60.0 < 150, "the sweep budget must sit inside timeout-minutes: 150"
    assert min(worst_min, sq._SWEEP_BUDGET_S / 60.0) < 150, (
        f"worst-case sweep is {worst_min:.0f} min against a 150 min job budget and the "
        f"{sq._SWEEP_BUDGET_S/60:.0f} min budget does not save it"
    )
    assert sq._SWEEP_TIMEOUT_S <= 20, "a denied detail fetch must cost seconds, not 40s"


def test_fetch_one_returns_immediately_once_the_sweep_is_aborted():
    """The abort flag is what makes the budget real. ex.map() has already queued every future, so
    without this each remaining id would still burn its own full retry ladder and the budget would
    save nothing. Aborted fetches must cost no network at all."""
    calls = []

    class _Boom:
        def get(self, *a, **kw):
            calls.append(a)
            raise AssertionError("aborted sweep must not touch the network")

    sq._SWEEP_ABORT.set()
    try:
        with mock.patch.object(sq, "_session", lambda: _Boom()):
            assert sq.fetch_one(1234) is None
        assert calls == [], "no request may be made once the sweep has aborted"
    finally:
        sq._SWEEP_ABORT.clear()


def test_fetch_one_uses_the_bounded_timeout():
    """A constant nothing reads is decoration — prove the ceiling reaches s.get()."""
    seen = []

    class _S:
        def get(self, url, timeout=None, **kw):
            seen.append(timeout)
            return mock.Mock(status_code=404)

    sq._SWEEP_ABORT.clear()
    with mock.patch.object(sq, "_session", lambda: _S()):
        sq.fetch_one(99)
    assert seen and all(t <= 20 for t in seen), f"unbounded detail timeout leaked: {seen}"


def test_an_aborted_sweep_also_suppresses_pruning():
    """Same hazard as a truncated harvest, reached by a different route: ids we INTENDED to visit
    were abandoned, so an unseen listing cannot be told apart from a delisted one. Structural,
    because the branch is the contract."""
    src = inspect.getsource(sq.main)
    assert "sweep_incomplete" in src, "main() must consider an aborted sweep"
    guard = src.index("if not harvest_complete or sweep_incomplete:")
    prune = src.index("db.prune_unseen(")
    assert guard < prune, "the incomplete-enumeration guard must precede prune_unseen()"


if __name__ == "__main__":
    import pytest
    raise SystemExit(pytest.main([__file__, "-v"]))
