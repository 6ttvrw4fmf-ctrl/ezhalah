"""Safety regression tests for the unified retention cleanup engine (scrapers/common/cleanup.py).

The one property that matters: a listing is NEVER permanently deleted unless a FRESH source re-check
confirms it gone, and no guard (cap, anomaly, fail-safe) is bypassed. These prove exactly that with a
fake client + scripted probe — no real DB, no network.
"""
from __future__ import annotations

import scrapers.common.cleanup as C


class _Res:
    def __init__(self, data, count=None):
        self.data = data
        # head+count queries (the unclamped anomaly measurement) read .count
        self.count = len(data) if count is None else count


class _Table:
    """NOTE (2026-08-22 safety audit): eq/gte/lt used to be no-ops that returned every row
    regardless of the filter — meaning min_inactive_days and min_missing_count were enforced ONLY
    by the real Postgres query in production, with ZERO test coverage proving that predicate is
    correct. They now actually filter, so a mutation that weakens either predicate in cleanup.py
    (e.g. dropping the .lt(last_seen_at) clause, or flipping .gte to .gt) fails a test here
    instead of only being caught by the real query in production, if at all."""
    def __init__(self, client, name):
        self.c, self.name, self._op, self._ids = client, name, None, None
        self._filters = []
    def select(self, *a, **k): return self
    def eq(self, col, val): self._filters.append(("eq", col, val)); return self
    def gte(self, col, val): self._filters.append(("gte", col, val)); return self
    def lt(self, col, val): self._filters.append(("lt", col, val)); return self
    def is_(self, col, val): self._filters.append(("is", col, val)); return self
    def order(self, *a, **k): return self
    def limit(self, *a, **k): return self
    def update(self, payload): self._op = ("update", payload); return self
    def insert(self, payload): self._op = ("insert", payload); return self
    def delete(self): self._op = ("delete", None); return self
    def in_(self, col, ids):
        self._ids = list(ids)                              # used by delete/update targeting
        self._filters.append(("in", col, list(ids)))        # also usable as a select filter
        return self
    def _matches(self, row):
        for op, col, val in self._filters:
            v = row.get(col)
            if op == "eq" and v != val: return False
            if op == "gte" and not (v is not None and v >= val): return False
            if op == "lt" and not (v is not None and v < val): return False
            if op == "is" and val == "null" and v is not None: return False
            if op == "in" and v not in val: return False
        return True
    def execute(self):
        if self._op and self._op[0] == "delete":
            self.c.deleted.setdefault(self.name, []).extend(self._ids); return _Res([])
        if self._op and self._op[0] == "update":
            self.c.updated.setdefault(self.name, []).append((self._ids, self._op[1])); return _Res([])
        if self._op and self._op[0] == "insert":
            self.c.inserted.setdefault(self.name, []).append(self._op[1]); return _Res([])
        rows = [r for r in self.c.rows.get(self.name, []) if self._matches(r)]
        return _Res(rows, count=len(rows))


class _Client:
    def __init__(self, rows): self.rows, self.deleted, self.updated, self.inserted = rows, {}, {}, {}
    def table(self, name): return _Table(self, name)


def _install(monkey_rows, policy, probe, platform="testp", tables=("testp_listings",), dead_marker=(lambda b: b == "DEAD")):
    rows = dict(monkey_rows)
    # "platform" must be present for _load_policy's real .eq("platform", platform) filter to match
    # now that _Table actually filters (see _Table docstring) — a bare dict without it would make
    # every test silently fall through to DEFAULT_POLICY instead of the POL(...) the test asked for.
    rows["platform_retention_policy"] = [{**policy, "platform": platform}]
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
def _cand(i): return {"id": i, "ad_number": f"A{i}", "listing_url": f"http://x/{i}", "missing_count": 3, "last_seen_at": "2026-01-01T00:00:00+00:00", "active": False}


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


def test_anomaly_abort_names_the_fraction_gate_when_it_would_also_trip():
    """Regression (aqarcity, 2026-08-16): the anomaly abort told the operator to 'raise
    anomaly_floor', but on a platform where the eligible population ALSO exceeds
    max_eligible_frac, doing only that re-aborts on the mass-inactivation guard — whose
    message blames 'a partial crawl or source outage', a misleading read when the backlog is
    already proven to be genuine delistings. The abort must name BOTH gates so it is one
    owner decision. 600 rows: over FRAC_GUARD_MIN_ROWS, and 600 > 10% of 600."""
    c = _install({"testp_listings": [_cand(i) for i in range(600)]},
                 POL(anomaly_floor=2, anomaly_factor=4), probe=lambda url: (404, ""))
    s = C.run("testp", force=True)
    assert s["aborted"] is True and s["deleted"] == 0 and c.deleted == {}
    assert "ALSO NOTE" in s["abort_reason"], s["abort_reason"]
    assert "mass-inactivation guard" in s["abort_reason"]
    assert "raising anomaly_floor alone would NOT unblock" in s["abort_reason"]


def test_anomaly_abort_stays_quiet_when_the_fraction_gate_would_pass():
    """The converse: below FRAC_GUARD_MIN_ROWS the fraction guard does not apply, so the
    abort must NOT claim a second gate is in the way."""
    c = _install({"testp_listings": [_cand(i) for i in range(5)]},
                 POL(anomaly_floor=2, anomaly_factor=4), probe=lambda url: (404, ""))
    s = C.run("testp", force=True)
    assert s["aborted"] is True and c.deleted == {}
    assert "ALSO NOTE" not in s["abort_reason"], s["abort_reason"]


def _cand_ts(i, ts):
    return {"id": i, "ad_number": f"A{i}", "listing_url": f"http://x/{i}", "missing_count": 3, "last_seen_at": ts, "active": False}


def test_bounded_cap_never_exceeds_what_unbounded_gates_would_allow():
    """The core safety property the owner asked for (2026-08-16, aqarcity 419-row backlog):
    bounded_cap is NOT a bypass. Even when the operator requests far more than the standing
    gates would ever allow, the actual work-set is hard-capped at what an UNBOUNDED run would
    already permit. 600 rows, max_eligible_frac default 0.10 -> frac_cap=60; anomaly_floor set
    high so the fraction guard is the binding constraint. Requesting bounded_cap=600 (the full
    backlog) must still delete only 60 — proving the request cannot widen the guard."""
    c = _install({"testp_listings": [_cand(i) for i in range(600)]},
                 POL(anomaly_floor=1000, max_delete_per_run=500), probe=lambda url: (404, ""))
    s = C.run("testp", force=True, bounded_cap=600)
    assert s["aborted"] is False
    assert s["deleted"] == 60, s
    assert len(c.deleted["testp_listings"]) == 60
    assert "requested_cap=600 -> safe_cap=60" in s["note"], s["note"]


def test_bounded_cap_below_gates_is_honored_exactly():
    """When the requested cap is already the tightest bound (well under every gate), it is used
    as-is — this is the normal case (aqarcity: requested 261, no gate is tighter)."""
    c = _install({"testp_listings": [_cand(i) for i in range(50)]},
                 POL(anomaly_floor=1000, max_delete_per_run=500), probe=lambda url: (404, ""))
    s = C.run("testp", force=True, bounded_cap=10)
    assert s["deleted"] == 10
    assert "requested_cap=10 -> safe_cap=10" in s["note"]


def test_bounded_cap_deletes_oldest_first_across_all_tables():
    """'oldest-first' (owner instruction, 2026-08-16) means globally oldest across every table
    the platform spans — NOT oldest-per-table-then-concatenated, which is what the UNBOUNDED
    path intentionally still does, unchanged (test_hard_cap_limits_deletes above)."""
    old = [_cand_ts(100 + i, f"2026-01-0{i + 1}T00:00:00+00:00") for i in range(3)]   # oldest 3
    newer_a = [_cand_ts(200 + i, "2026-06-01T00:00:00+00:00") for i in range(3)]      # newest, table A
    newer_b = [_cand_ts(300 + i, "2026-05-01T00:00:00+00:00") for i in range(3)]      # mid, table B
    c = _install({"testp_listings": old + newer_a, "testp2_listings": newer_b},
                 POL(anomaly_floor=1000, max_delete_per_run=500), probe=lambda url: (404, ""),
                 tables=("testp_listings", "testp2_listings"))
    s = C.run("testp", force=True, bounded_cap=4)
    assert s["deleted"] == 4
    deleted_ids = set(c.deleted.get("testp_listings", [])) | set(c.deleted.get("testp2_listings", []))
    # the 3 globally-oldest (100,101,102) plus the next-oldest overall, which lives in table B (300)
    assert deleted_ids == {100, 101, 102, 300}, deleted_ids


def test_bounded_cap_never_touches_retention_policy():
    c = _install({"testp_listings": [_cand(i) for i in range(20)]},
                 POL(anomaly_floor=1000), probe=lambda url: (404, ""))
    C.run("testp", force=True, bounded_cap=5)
    assert c.updated.get("platform_retention_policy") is None


def test_bounded_cap_still_preserves_unknown_and_reactivates_live():
    """Bounded mode must keep every existing individual-row protection: unknown/blocked stays
    preserved, a still-live row self-heals, only the confirmed-dead row is deleted."""
    verdicts = {"http://x/0": (200, "still for sale"), "http://x/1": (403, ""), "http://x/2": (200, "DEAD")}
    c = _install({"testp_listings": [_cand(i) for i in range(3)]}, POL(anomaly_floor=1000),
                 probe=lambda url: verdicts[url])
    s = C.run("testp", force=True, bounded_cap=10)
    assert s["deleted"] == 1 and s["reactivated"] == 1 and s["skipped"] == 1
    assert c.deleted["testp_listings"] == [2]
    assert c.updated.get("testp_listings")   # the still-live row (id 0) was self-healed, not deleted


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


def test_aqarcity_expired_marker_deletes_clean_200_self_heals():
    dm = C.PLATFORMS["aqarcity"]["dead_marker"]
    assert dm("... الإعلان منتهي ولم يعد متاحًا ...") is True     # expired banner → dead
    assert dm("شقة للبيع في جدة — 500000 ريال") is False          # normal live listing → not dead
    # live (200, no banner) → self-heal, never deleted
    c = _install({"aqarcity_residential_listings": [_cand(1)]}, POL(),
                 probe=lambda url: (200, "شقة للبيع 500000 ريال"),
                 platform="aqarcity", tables=("aqarcity_residential_listings",), dead_marker=None)
    s = C.run("aqarcity", force=True)
    assert s["deleted"] == 0 and s["reactivated"] == 1 and c.deleted == {}
    # expired (200 + banner) → delete
    c2 = _install({"aqarcity_residential_listings": [_cand(2)]}, POL(),
                  probe=lambda url: (200, "الإعلان منتهي أو غير مطابق للشروط"),
                  platform="aqarcity", tables=("aqarcity_residential_listings",), dead_marker=None)
    s2 = C.run("aqarcity", force=True)
    assert s2["deleted"] == 1 and c2.deleted["aqarcity_residential_listings"] == [2]


def test_below_missing_count_threshold_never_becomes_a_candidate():
    """Barrier 6 (repeated dead confirmations): a row with FEWER strikes than policy requires must
    never even be FETCHED as a candidate, no matter how old it is. Mutation-proof: if cleanup.py's
    .gte("missing_count", ...) filter were ever dropped or weakened, this row (dead_marker always
    fires 404) would get force-deleted and this test would catch it — it did not have coverage
    before 2026-08-22 because the old test fake ignored every filter."""
    old_but_unstruck = {**_cand(1), "missing_count": 2}   # only 2 of the required 3 strikes
    c = _install({"testp_listings": [old_but_unstruck]}, POL(), probe=lambda url: (404, ""))
    s = C.run("testp", force=True)
    assert s["eligible_total"] == 0 and s["deleted"] == 0 and c.deleted == {}


def test_below_min_age_never_becomes_a_candidate():
    """Barrier 5 (minimum inactive age): a row with enough strikes but still INSIDE the grace
    window (last_seen_at recent) must never be fetched as a candidate. Mutation-proof: if
    cleanup.py's .lt("last_seen_at", cutoff) filter were ever dropped, this row would get
    force-deleted 5 days after going inactive instead of waiting the full 30."""
    import datetime
    recent = (datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(days=5)).isoformat()
    struck_but_young = {**_cand(1), "last_seen_at": recent}
    c = _install({"testp_listings": [struck_but_young]}, POL(), probe=lambda url: (404, ""))
    s = C.run("testp", force=True)
    assert s["eligible_total"] == 0 and s["deleted"] == 0 and c.deleted == {}


def test_at_exactly_the_thresholds_is_eligible():
    """The converse of the two tests above: a row that exactly meets both floors (missing_count ==
    min, well past the age cutoff) IS eligible — proves the predicates aren't silently off-by-one
    in the safe direction either, which would shrink the real eligible population without anyone
    noticing (the two tests above already prove the unsafe direction is blocked)."""
    c = _install({"testp_listings": [_cand(1)]}, POL(), probe=lambda url: (404, ""))
    s = C.run("testp", force=True)
    assert s["eligible_total"] == 1 and s["deleted"] == 1


def test_degraded_platform_health_freezes_deletion_before_measuring_candidates():
    """Barrier 2 (platform health precondition): an open scraper_failure_step_change (or
    silent_scraper_death) alert for THIS platform must abort the run BEFORE any candidate is even
    fetched — proactive, not the reactive anomaly gate. Mirrors the real wasalt alert 686
    (standing since 2026-08-18)."""
    c = _install({"testp_listings": [_cand(1)],
                  "alert_event": [{"id": 686, "kind": "scraper_failure_step_change",
                                    "platform": "testp", "severity": "P1", "resolved_at": None}]},
                 POL(), probe=lambda url: (404, ""))
    s = C.run("testp", force=True)
    assert s["aborted"] is True and s["deleted"] == 0 and c.deleted == {}
    assert s["eligible_total"] == 0            # never even measured — the precondition ran first
    assert "platform health degraded" in s["abort_reason"]
    assert "686" in s["abort_reason"]


def test_health_gate_ignores_other_platforms_and_resolved_alerts():
    """The gate must be platform-scoped (an open alert on a DIFFERENT platform must not freeze
    this one) and status-scoped (a RESOLVED alert on this platform must not freeze it either)."""
    c = _install({"testp_listings": [_cand(1)],
                  "alert_event": [
                      {"id": 1, "kind": "scraper_failure_step_change", "platform": "otherplatform",
                       "severity": "P1", "resolved_at": None},
                      {"id": 2, "kind": "scraper_failure_step_change", "platform": "testp",
                       "severity": "P1", "resolved_at": "2026-08-20T00:00:00+00:00"},
                  ]}, POL(), probe=lambda url: (404, ""))
    s = C.run("testp", force=True)
    assert s["aborted"] is False and s["deleted"] == 1


def test_health_gate_ignores_unrelated_alert_kinds():
    """A data-fidelity alert unrelated to capture health (e.g. field_integrity) must NOT freeze
    deletion — the gate is deliberately narrow to alert kinds that speak to whether the CRAWL
    itself is currently trustworthy, not general platform noise."""
    c = _install({"testp_listings": [_cand(1)],
                  "alert_event": [{"id": 3, "kind": "field_integrity", "platform": "testp",
                                    "severity": "P1", "resolved_at": None}]},
                 POL(), probe=lambda url: (404, ""))
    s = C.run("testp", force=True)
    assert s["aborted"] is False and s["deleted"] == 1


def test_health_gate_is_not_bypassed_by_force():
    """force overrides policy.enabled=false only. A degraded-platform freeze is a live safety
    signal, not a policy toggle, and must survive --force."""
    c = _install({"testp_listings": [_cand(1)],
                  "alert_event": [{"id": 4, "kind": "silent_scraper_death", "platform": "testp",
                                    "severity": "P1", "resolved_at": None}]},
                 POL(enabled=False), probe=lambda url: (404, ""))
    s = C.run("testp", force=True)
    assert s["aborted"] is True and "platform health degraded" in s["abort_reason"]


def test_verdict_status_mapping():
    dm = lambda b: b == "DEAD"
    assert C.verdict(404, "", dm) == "dead"
    assert C.verdict(410, "", dm) == "dead"
    assert C.verdict(200, "DEAD", dm) == "dead"
    assert C.verdict(200, "for sale", dm) == "live"
    assert C.verdict(403, "", dm) == "unknown"
    assert C.verdict(500, "", dm) == "unknown"
    assert C.verdict(None, "", dm) == "unknown"
