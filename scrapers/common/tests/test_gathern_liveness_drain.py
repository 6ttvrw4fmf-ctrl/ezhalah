"""Gathern liveness: flagged-first re-checks + DRAIN of a standing backlog (2026-09-28).

The Lifecycle Engineer measured ~20,600 visible gathern ads carrying "gone" strikes and nothing
hidden: flagged rows waited days for their next reading, and any run with more 3-strike kills than
the anomaly cap quarantined ALL of them, forever. These pin the fix through the real main():

  1. rows already carrying a strike are probed BEFORE unflagged ones (a slice stays reserved);
  2. a TRUSTED over-cap batch hides exactly `kill_cap` rows, oldest strikes first;
  3. a SPIKE (vs recent trusted runs, or with no history at all) still hides nothing;
  4. an UNTRUSTED run still writes nothing destructive.

    python -m pytest scrapers/common/tests/test_gathern_liveness_drain.py -q
"""
from __future__ import annotations

import sys
import types

_supabase_mod = types.ModuleType("supabase")
_supabase_mod.Client = type("Client", (), {})
_supabase_mod.create_client = lambda url, key: None
sys.modules.setdefault("supabase", _supabase_mod)
_dotenv_mod = types.ModuleType("dotenv")
_dotenv_mod.load_dotenv = lambda *a, **k: None
sys.modules.setdefault("dotenv", _dotenv_mod)

import scrapers.gathern.liveness as lv  # noqa: E402

OLD = "2026-09-01T00:00:00+00:00"  # stale last_seen_at / an old probe


class _Q:
    """Records a PostgREST call chain; the fake DB interprets it on execute()."""

    def __init__(self, db, table):
        self.db, self.table, self.ops = db, table, []

    @property
    def not_(self):
        return self

    def __getattr__(self, name):
        def rec(*a, **k):
            self.ops.append((name, a, k))
            return self
        return rec

    def execute(self):
        return self.db.run(self)


class _DB:
    def __init__(self, rows, runs=()):
        self.rows = {r["id"]: dict(r) for r in rows}
        self.runs = list(runs)
        self.updates: list[tuple[int, dict]] = []

    def table(self, name):
        return _Q(self, name)

    def run(self, q):
        ops = {name: (a, k) for name, a, k in q.ops}
        if q.table == "scrape_runs":
            return types.SimpleNamespace(data=[{"notes": n} for n in self.runs])
        if q.table != lv.TABLE:
            return types.SimpleNamespace(data=[])
        if "update" in ops:
            payload = ops["update"][0][0]
            ids = [ops["eq"][0][1]] if "eq" in ops else list(ops["in_"][0][1])
            for rid in ids:
                self.updates.append((rid, dict(payload)))
                self.rows[rid].update(payload)
            return types.SimpleNamespace(data=[])
        rows = [r for r in self.rows.values() if r["active"]]
        if ops.get("select", ((), {}))[1].get("count"):
            return types.SimpleNamespace(data=[], count=len(rows))
        for name, a, _ in q.ops:
            if name == "gt" and a[0] == "missing_count":
                rows = [r for r in rows if (r["missing_count"] or 0) > a[1]]
            if name == "or_" and "missing_count.is.null" in a[0]:
                rows = [r for r in rows if (r["missing_count"] or 0) <= 0]
            if name == "or_" and "last_liveness_probe_at.lt." in a[0]:
                cut = a[0].split("last_liveness_probe_at.lt.")[1].replace("Z", "+00:00")
                rows = [r for r in rows if r["last_liveness_probe_at"] is None
                        or r["last_liveness_probe_at"] < cut]
        for name, a, k in reversed([o for o in q.ops if o[0] == "order"]):
            col, desc = a[0], k.get("desc", False)
            present = sorted((r for r in rows if r[col] is not None), key=lambda r: r[col],
                             reverse=desc)
            nulls = [r for r in rows if r[col] is None]
            rows = nulls + present if k.get("nullsfirst") else present + nulls
        lo, hi = ops["range"][0]
        return types.SimpleNamespace(data=rows[lo:hi + 1])


def _row(rid, mc, probe=OLD):
    return {"id": rid, "ad_number": f"GTH{rid}", "listing_url": f"https://gathern.co/view/1/unit/{rid}",
            "missing_count": mc, "active": True, "last_seen_at": OLD, "last_liveness_probe_at": probe}


def _run_main(monkeypatch, db, argv, canaries=((True, 10, 10, "200x10"), (True, 10, 10, "200x10"))):
    """Drive the REAL main() against the fake DB; every probe answers 404 (a real death)."""
    ended = {}
    canary_results = list(canaries)
    monkeypatch.setattr(lv, "sb", lambda: db)
    monkeypatch.setattr(lv, "begin_run", lambda platform: 1)
    monkeypatch.setattr(lv, "end_run", lambda run_id, **kw: ended.update(kw) or True)
    monkeypatch.setattr(lv, "detail_session", lambda: types.SimpleNamespace())
    monkeypatch.setattr(lv, "probe", lambda s, url: 404)
    monkeypatch.setattr(lv, "_run_canary", lambda s, c, n: canary_results.pop(0))
    monkeypatch.setattr(lv, "_acquire_apply_lock", lambda c, h, t: True)
    monkeypatch.setattr(lv, "_release_apply_lock", lambda c, h: None)
    monkeypatch.setattr(sys, "argv", ["liveness", *argv])
    assert lv.main() == 0
    return ended


def _inactivated(db):
    return sorted(rid for rid, p in db.updates if p.get("active") is False)


# ── 1. flagged rows first ────────────────────────────────────────────────────────────────────────
def test_flagged_rows_are_probed_before_unflagged_with_a_reserved_slice():
    # Unflagged rows never probed (NULL) would head the OLD rotation queue; flagged ones must win.
    rows = [_row(1, 0, probe=None), _row(2, 0, probe=None), _row(3, 1), _row(4, 3),
            _row(5, 1, probe="2026-08-20T00:00:00+00:00"), _row(6, 2)]
    work = lv._collect_stale(_DB(rows), "2026-09-20T00:00:00+00:00", limit=5)
    # highest strike count first, then oldest reading; 20% of 5 = 1 slot kept for unflagged
    assert [r["id"] for r in work] == [4, 6, 5, 3, 1]


def test_reprobe_gap_skips_a_row_read_moments_ago():
    fresh = "2999-01-01T00:00:00+00:00"  # "just probed" relative to any real clock
    work = lv._collect_stale(_DB([_row(1, 2, probe=fresh), _row(2, 1)]),
                             "2026-09-20T00:00:00+00:00", limit=10)
    assert [r["id"] for r in work] == [2]


def test_compose_worklist_fills_each_side_from_the_other():
    f, u = [{"id": i} for i in range(10)], [{"id": 100 + i} for i in range(10)]
    assert [r["id"] for r in lv.compose_worklist(f, [], 5)] == [0, 1, 2, 3, 4]
    assert [r["id"] for r in lv.compose_worklist([], u, 5)] == [100, 101, 102, 103, 104]
    assert [r["id"] for r in lv.compose_worklist(f, u, 5)] == [0, 1, 2, 3, 100]
    assert len(lv.compose_worklist(f, u, 0)) == 20


# ── 2. trusted over-cap backlog drains exactly the cap, oldest first ─────────────────────────────
def test_trusted_over_cap_backlog_hides_exactly_the_cap_oldest_strikes_first(monkeypatch):
    # five rows about to reach grace; rows 11 and 14 have waited longest (most strikes)
    db = _DB([_row(10, 2), _row(11, 5), _row(12, 2), _row(13, 2), _row(14, 4)],
             runs=["APPLY scanned=1500 dead=9 inactivated=0 kill_candidates=5 trusted=True"])
    ended = _run_main(monkeypatch, db, ["--limit", "10", "--apply", "--kill-cap", "2"])
    assert _inactivated(db) == [11, 14]
    # every other candidate still had its earned strike recorded, and stays visible for a re-read
    assert {r: db.rows[r]["missing_count"] for r in (10, 12, 13)} == {10: 3, 12: 3, 13: 3}
    assert all(db.rows[r]["active"] for r in (10, 12, 13))
    assert ended["ok"] is True and ended["notes"].startswith("DRAIN:")
    assert "kill_candidates=5" in ended["notes"]


def test_drain_picks_the_oldest_strikes_whatever_order_they_arrive_in():
    pending = [(1, 3), (2, 7), (3, 3), (4, 5), (5, 3)]   # (row id, missing_count after this run)
    assert lv.plan_kills(pending, 2, baseline=5, trusted=True) == [(2, 7), (4, 5)]


# ── 3. a spike still quarantines ──────────────────────────────────────────────────────────────────
def test_spike_versus_recent_runs_still_hides_nothing(monkeypatch):
    db = _DB([_row(i, 2) for i in range(20, 25)],
             runs=["APPLY scanned=1500 dead=1 inactivated=1 kill_candidates=1 trusted=True"])
    ended = _run_main(monkeypatch, db, ["--limit", "10", "--apply", "--kill-cap", "2"])
    assert _inactivated(db) == []
    assert ended["ok"] is False and ended["notes"].startswith("ANOMALY-CAPPED")


def test_no_recent_history_is_a_spike_fail_closed(monkeypatch):
    # untrusted and dry-run history must not count as a baseline either
    db = _DB([_row(i, 2) for i in range(30, 35)],
             runs=["DRY-RUN scanned=1500 dead=9 WOULD inactivate=5 kill_candidates=5 trusted=True",
                   "APPLY scanned=1500 dead=9 inactivated=0 kill_candidates=5 trusted=False"])
    ended = _run_main(monkeypatch, db, ["--limit", "10", "--apply", "--kill-cap", "2"])
    assert _inactivated(db) == [] and ended["ok"] is False


def test_at_or_under_the_cap_every_kill_lands_as_before():
    pending = [(1, 3), (2, 3)]
    assert lv.plan_kills(pending, 2, None, trusted=True) == pending


# ── 4. an untrusted run hides nothing ─────────────────────────────────────────────────────────────
def test_untrusted_run_writes_no_strike_and_no_kill(monkeypatch):
    db = _DB([_row(40, 2), _row(41, 5), _row(42, 0)],
             runs=["APPLY scanned=1500 dead=9 inactivated=0 kill_candidates=3 trusted=True"])
    # opening canary passes, CLOSING canary fails -> the environment degraded during the run
    ended = _run_main(monkeypatch, db, ["--limit", "10", "--apply", "--kill-cap", "2"],
                      canaries=((True, 10, 10, "200x10"), (False, 0, 10, "404x10")))
    assert db.updates == []
    assert ended["notes"].startswith("TRUST-QUARANTINED") and ended["ok"] is False


def test_plan_kills_refuses_an_untrusted_run_at_any_size():
    for n in (1, 2, 50):
        assert lv.plan_kills([(i, 3) for i in range(n)], 2, 10_000, trusted=False) == []


# ── daily direct check of EVERY listing (owner 2026-10-02) ───────────────────────────────────────
def test_every_unflagged_row_is_read_about_once_a_day_not_every_run():
    from datetime import datetime, timedelta, timezone
    iso = lambda h: (datetime.now(timezone.utc) - timedelta(hours=h)).isoformat()  # noqa: E731
    rows = [_row(1, 0, probe=None), _row(2, 0, probe=iso(2)), _row(3, 0, probe=iso(30)),
            _row(4, 0, probe=iso(19))]
    work = lv._collect_stale(_DB(rows), "2999-01-01T00:00:00+00:00", limit=10)
    # never read and read 30h ago are due; read 2h / 19h ago wait for their day
    assert sorted(r["id"] for r in work) == [1, 3]


def test_the_schedule_probes_every_active_row_not_only_stale_ones():
    from pathlib import Path
    yml = (Path(__file__).resolve().parents[3] / ".github" / "workflows" / "gathern-liveness.yml").read_text()
    assert "inputs.min_stale_days || '0'" in yml
    assert 'default: "0"' in yml.split("min_stale_days:")[1].split("kill_cap:")[0]
