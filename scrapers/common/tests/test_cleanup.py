"""Safety regression tests for the unified retention cleanup engine (scrapers/common/cleanup.py).

The one property that matters: a listing is NEVER permanently deleted unless a FRESH source re-check
confirms it gone, and no guard (cap, anomaly, fail-safe) is bypassed. These prove exactly that with a
fake client + scripted probe — no real DB, no network.
"""
from __future__ import annotations

import scrapers.common.cleanup as C


class _Res:
    def __init__(self, data): self.data = data


class _Table:
    def __init__(self, client, name):
        self.c, self.name, self._op, self._ids = client, name, None, None
    def select(self, *a, **k): return self
    def eq(self, *a, **k): return self
    def gte(self, *a, **k): return self
    def lt(self, *a, **k): return self
    def order(self, *a, **k): return self
    def limit(self, *a, **k): return self
    def update(self, payload): self._op = ("update", payload); return self
    def insert(self, payload): self._op = ("insert", payload); return self
    def delete(self): self._op = ("delete", None); return self
    def in_(self, col, ids): self._ids = list(ids); return self
    def execute(self):
        if self._op and self._op[0] == "delete":
            self.c.deleted.setdefault(self.name, []).extend(self._ids); return _Res([])
        if self._op and self._op[0] == "update":
            self.c.updated.setdefault(self.name, []).append((self._ids, self._op[1])); return _Res([])
        if self._op and self._op[0] == "insert":
            self.c.inserted.setdefault(self.name, []).append(self._op[1]); return _Res([])
        return _Res(self.c.rows.get(self.name, []))


class _Client:
    def __init__(self, rows): self.rows, self.deleted, self.updated, self.inserted = rows, {}, {}, {}
    def table(self, name): return _Table(self, name)


def _install(monkey_rows, policy, probe, platform="testp", tables=("testp_listings",), dead_marker=(lambda b: b == "DEAD")):
    rows = dict(monkey_rows)
    rows["platform_retention_policy"] = [policy]
    rows.setdefault("cleanup_runs", [])
    client = _Client(rows)
    C.sb = lambda: client
    C.begin_run = lambda name: 1
    C.end_run = lambda *a, **k: True
    C._probe = probe
    if dead_marker is not None or platform not in C.PLATFORMS:
        C.PLATFORMS[platform] = {"tables": list(tables), "dead_marker": dead_marker}
    return client


POL = lambda **k: {"min_inactive_days": 30, "min_missing_count": 3, "require_source_recheck": True,
                   "max_delete_per_run": 500, "anomaly_floor": 300, "anomaly_factor": 4, "enabled": True, **k}
def _cand(i): return {"id": i, "ad_number": f"A{i}", "listing_url": f"http://x/{i}", "missing_count": 3, "last_seen_at": "2026-01-01T00:00:00+00:00"}


def test_live_row_is_reactivated_never_deleted():
    c = _install({"testp_listings": [_cand(1)]}, POL(), probe=lambda url: (200, "still for sale"))
    s = C.run("testp", force=True)
    assert s["deleted"] == 0 and s["reactivated"] == 1
    assert c.deleted == {}                     # nothing was ever deleted
    assert c.updated.get("testp_listings")     # it was self-healed back to active


def test_dead_marker_and_404_are_deleted():
    c = _install({"testp_listings": [_cand(1)]}, POL(), probe=lambda url: (200, "DEAD"))
    s = C.run("testp", force=True)
    assert s["deleted"] == 1 and c.deleted["testp_listings"] == [1]
    assert c.inserted.get("cleanup_deletion_log")            # audit row written

    c2 = _install({"testp_listings": [_cand(2)]}, POL(), probe=lambda url: (404, ""))
    s2 = C.run("testp", force=True)
    assert s2["deleted"] == 1 and c2.deleted["testp_listings"] == [2]


def test_block_and_network_error_are_skipped_never_deleted():
    for status in (403, 429, 503, None):
        c = _install({"testp_listings": [_cand(1)]}, POL(), probe=lambda url, st=status: (st, ""))
        s = C.run("testp", force=True)
        assert s["deleted"] == 0 and s["skipped"] == 1 and c.deleted == {}, f"status {status} must not delete"


def test_hard_cap_limits_deletes():
    c = _install({"testp_listings": [_cand(i) for i in range(6)]}, POL(max_delete_per_run=2, anomaly_floor=100),
                 probe=lambda url: (404, ""))
    s = C.run("testp", force=True)
    assert s["deleted"] == 2 and len(c.deleted["testp_listings"]) == 2


def test_anomaly_spike_aborts_and_deletes_nothing():
    c = _install({"testp_listings": [_cand(i) for i in range(5)]}, POL(anomaly_floor=2, anomaly_factor=4),
                 probe=lambda url: (404, ""))   # all "dead", but the run must still abort on the spike
    s = C.run("testp", force=True)
    assert s["aborted"] is True and s["deleted"] == 0 and c.deleted == {}


def test_failsafe_no_dead_check_aborts():
    C.PLATFORMS.pop("nodeadp", None)
    C.PLATFORMS["nodeadp"] = {"tables": ["nodeadp_listings"], "dead_marker": None}
    c = _install({"nodeadp_listings": [_cand(1)]}, POL(), probe=lambda url: (404, ""),
                 platform="nodeadp", tables=("nodeadp_listings",), dead_marker=None)
    s = C.run("nodeadp", force=True)
    assert s["aborted"] is True and s["deleted"] == 0 and c.deleted == {}


def test_disabled_policy_deletes_nothing_without_force():
    c = _install({"testp_listings": [_cand(1)]}, POL(enabled=False), probe=lambda url: (404, ""))
    s = C.run("testp")                          # no force → default-deny
    assert s["aborted"] is True and s["deleted"] == 0 and c.deleted == {}


def test_dry_run_reports_but_deletes_nothing():
    c = _install({"testp_listings": [_cand(1)]}, POL(), probe=lambda url: (404, ""))
    s = C.run("testp", force=True, dry_run=True)
    assert s["deleted"] == 1 and c.deleted == {}                 # counted, but nothing deleted
    assert not c.inserted.get("cleanup_deletion_log")           # and nothing logged as deleted


def test_gathern_is_404_only_booked_200_never_deleted():
    # gathern registered with the _never marker → a 200 (live OR booked-but-listed) must NOT delete.
    assert C.PLATFORMS["gathern"]["dead_marker"]("anything, even 'not available for these dates'") is False
    c = _install({"gathern_residential_listings": [_cand(1)]}, POL(),
                 probe=lambda url: (200, "booked · لليلة 400 ريال"),
                 platform="gathern", tables=("gathern_residential_listings",), dead_marker=None)
    s = C.run("gathern", force=True)
    assert s["deleted"] == 0 and s["reactivated"] == 1 and c.deleted == {}     # booked 200 → self-heal, never deleted
    c2 = _install({"gathern_residential_listings": [_cand(2)]}, POL(),
                  probe=lambda url: (404, ""),
                  platform="gathern", tables=("gathern_residential_listings",), dead_marker=None)
    s2 = C.run("gathern", force=True)
    assert s2["deleted"] == 1 and c2.deleted["gathern_residential_listings"] == [2]   # only a hard 404 deletes


def test_verdict_status_mapping():
    dm = lambda b: b == "DEAD"
    assert C.verdict(404, "", dm) == "dead"
    assert C.verdict(410, "", dm) == "dead"
    assert C.verdict(200, "DEAD", dm) == "dead"
    assert C.verdict(200, "for sale", dm) == "live"
    assert C.verdict(403, "", dm) == "unknown"
    assert C.verdict(500, "", dm) == "unknown"
    assert C.verdict(None, "", dm) == "unknown"
