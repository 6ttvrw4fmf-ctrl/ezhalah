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
    assert dm("... الإعلان منتهي ولم يعد متاحًا ...") is True     # legacy banner → still dead
    assert dm('<h2 class="text-lg">الإعلان غير متاح</h2>') is True  # current banner → dead
    assert dm("شقة للبيع في جدة — 500000 ريال") is False          # normal live listing → not dead


def test_aqarcity_marker_survives_a_banner_rewording_and_never_reads_prose(): # ops_incident #730
    """2026-09-25: aqarcity reworded its expiry banner and the single-substring marker went dark —
    it could not return True for ANY page, so every expired ad read LIVE and the weekly cleanup
    would have SELF-HEALED it back into search. Two independent signals now, and the title one is
    anchored to the suffix shape because a bare phrase match would delete a live listing whose
    seller merely wrote the words. Measured that day over 14 expired + 14 active pages, interleaved:
    old marker 0/14 and 0/14; current banner 14/14 and 0/14; title suffix 14/14 and 0/14."""
    dm = C.PLATFORMS["aqarcity"]["dead_marker"]
    # the title / og:title / twitter:title suffix, verbatim shapes from a real expired page
    assert dm("<title>ارض للبيع في حي السليم - إعلان منتهي | عقار ستي</title>") is True
    assert dm('<meta property="og:title" content="شقة للبيع في جدة - إعلان منتهي"/>') is True
    # the SAME words in a seller's own prose are not the platform declaring anything
    assert dm("<p>الفرصة محدودة، إعلان منتهي قريباً فسارع بالحجز</p>") is False
    assert dm('<meta name="description" content="شقة مميزة إعلان منتهي الصلاحية"/>') is False
    # an unreadable / empty response is never a death
    assert dm("") is False
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


# ── Run-level inconclusive-evidence freeze (2026-08-23) ──────────────────────────────────────
# verdict() already refuses to delete any INDIVIDUAL row whose recheck was inconclusive. These
# prove the RUN-level guard: when a source/proxy degrades mid-run, the rows that came back "dead"
# are suspect too, so the whole run's deletions are discarded rather than applied.

def _probe_seq(seq):
    """Scripted probe: returns seq[i] for the i-th call, then a clean 404 (dead) forever after."""
    state = {"i": 0}
    def p(url):
        i = state["i"]
        state["i"] += 1
        return seq[i] if i < len(seq) else (404, "")
    return p


def _cand_nourl(i):
    r = _cand(i)
    r["listing_url"] = ""        # skipped before _probe() is ever reached
    return r


def test_inconclusive_source_health_freezes_deletion_for_the_whole_run():
    """THE GUARD. 20 of 40 rechecks (50%) come back 503; the other 20 look cleanly dead. Without
    the freeze those 20 would be permanently deleted on evidence gathered while the source was
    demonstrably unwell."""
    c = _install({"testp_listings": [_cand(i) for i in range(40)]}, POL(),
                 probe=_probe_seq([(503, "")] * 20))
    s = C.run("testp", force=True)
    assert s["aborted"] is True
    assert s["deleted"] == 0
    assert c.deleted == {}, "a degraded source must not delete even the rows judged 'dead'"
    assert "inconclusive source health" in s["abort_reason"]
    assert "DELETION FROZEN" in s["abort_reason"]
    # and the audit log must not claim deletions that never happened
    assert not c.inserted.get("cleanup_deletion_log")


def test_healthy_run_is_never_frozen():
    """Both directions matter: a clean run must still delete. Production healthy runs measure ~0%
    inconclusive, so this is the normal case and the guard must be invisible to it."""
    c = _install({"testp_listings": [_cand(i) for i in range(40)]}, POL(), probe=_probe_seq([]))
    s = C.run("testp", force=True)
    assert s["aborted"] is False
    assert s["deleted"] == 40 and len(c.deleted["testp_listings"]) == 40


def test_freeze_threshold_is_actually_the_boundary_not_just_any_failure():
    """Mutation proof on the ceiling itself. 11/40 = 27.5% must pass; 13/40 = 32.5% must freeze.
    A guard that fired on ANY inconclusive probe would fail the first half; one that never fired
    would fail the second."""
    c = _install({"testp_listings": [_cand(i) for i in range(40)]}, POL(),
                 probe=_probe_seq([(503, "")] * 11))
    s = C.run("testp", force=True)
    assert s["aborted"] is False, "27.5% is under the ceiling — must not freeze"
    assert s["deleted"] == 29

    c2 = _install({"testp_listings": [_cand(i) for i in range(40)]}, POL(),
                  probe=_probe_seq([(503, "")] * 13))
    s2 = C.run("testp", force=True)
    assert s2["aborted"] is True, "32.5% is over the ceiling — must freeze"
    assert c2.deleted == {}


def test_small_sample_is_not_frozen_because_the_per_row_rule_already_protects_it():
    """Below _FREEZE_MIN_SAMPLE the rate is noise. Nothing is deleted anyway — not because the
    run aborted, but because verdict() refused every single row. Proving BOTH facts is the point:
    the freeze must not fire, and no row may be lost."""
    c = _install({"testp_listings": [_cand(i) for i in range(10)]}, POL(),
                 probe=_probe_seq([(None, "")] * 10))
    s = C.run("testp", force=True)
    assert s["aborted"] is False, "a 10-row run must not abort on one bad patch"
    assert s["deleted"] == 0 and c.deleted == {}
    assert s["skipped"] == 10


def test_freeze_discards_deletions_but_KEEPS_reactivations():
    """The fail-safe direction. During the same degraded run, a row the source positively proved
    LIVE (HTTP 200, no dead-marker) must still be restored — freezing those too would turn a
    source wobble into lost inventory, which is the harm this guard exists to prevent."""
    seq = [(503, "")] * 20 + [(200, "still for sale")] * 5
    c = _install({"testp_listings": [_cand(i) for i in range(40)]}, POL(), probe=_probe_seq(seq))
    s = C.run("testp", force=True)
    assert s["aborted"] is True and s["deleted"] == 0 and c.deleted == {}
    assert s["reactivated"] == 5, "live rows must be restored even in a frozen run"
    assert c.updated.get("testp_listings"), "the reactivation write must actually be applied"


def test_rows_without_a_url_cannot_trigger_the_freeze():
    """Mutation proof on the COUNTER. stats['skipped'] is also incremented for rows with no
    listing_url, which never reach _probe(). Keying the freeze on 'skipped' instead of the
    dedicated inconclusive counter would compute 30/10 = 300% here and freeze a run whose every
    actual probe came back clean."""
    # The recheck count MUST clear _FREEZE_MIN_SAMPLE (20), or the min-sample gate short-circuits
    # before the rate is ever computed and this test proves nothing. 25 real probes, all clean;
    # 30 no-URL rows alongside them. Correct code: 0/25 = 0%. Keyed on 'skipped': 30/25 = 120%.
    rows = [_cand_nourl(i) for i in range(30)] + [_cand(100 + i) for i in range(25)]
    c = _install({"testp_listings": rows}, POL(), probe=_probe_seq([]))
    s = C.run("testp", force=True)
    assert s["rechecked"] == 25 and s["skipped"] == 30      # sample clears the min-sample gate
    assert s["aborted"] is False, "no-URL rows must not be mistaken for inconclusive evidence"
    assert s["deleted"] == 25 and len(c.deleted["testp_listings"]) == 25


# ── DRAIN MODE (2026-09-20): a genuine standing backlog must drip out, source-verified, instead of
# aborting forever — WITHOUT losing the protection against a scraper-regression spike. ────────────

def _drain_pol(**k):
    k.setdefault("drain_spike_factor", 2.0)
    return POL(drain_backlog=True, **k)


def test_is_spike_pure():
    p = {"drain_spike_factor": 2.0}
    assert C._is_spike(25252, 25237, p) is False      # flat standing backlog → drain
    assert C._is_spike(12000, 25237, p) is False      # shrinking (being drained) → drain
    assert C._is_spike(60000, 25237, p) is True       # doubled+ → spike → abort
    assert C._is_spike(5000, None, p) is False         # no history + owner opted in → drain
    assert C._is_spike(5000, 0, p) is False            # zero baseline → treat as no history


def test_drain_off_still_aborts_default_deny():
    """Without drain_backlog a standing backlog aborts exactly as before (unchanged behaviour)."""
    c = _install({"testp_listings": [_cand(i) for i in range(400)],
                  "cleanup_runs": [{"platform": "testp", "dry_run": False, "candidates": 400}]},
                 POL(anomaly_floor=300), probe=lambda url: (404, ""))
    s = C.run("testp", force=True)
    assert s["aborted"] is True and s["deleted"] == 0 and c.deleted == {}


def test_drain_drips_a_capped_batch_instead_of_aborting():
    """Backlog of 400 over the floor(300), drain on, baseline flat → drips max_delete_per_run,
    source-verified, does NOT abort."""
    c = _install({"testp_listings": [_cand(i) for i in range(400)],
                  "cleanup_runs": [{"platform": "testp", "dry_run": False, "candidates": 400}]},
                 _drain_pol(anomaly_floor=300, max_delete_per_run=50), probe=lambda url: (404, ""))
    s = C.run("testp", force=True)
    assert s["aborted"] is False, s.get("abort_reason")
    assert s["deleted"] == 50, s                       # exactly the per-run cap
    assert len(c.deleted["testp_listings"]) == 50
    assert "drain mode" in (s["note"] or "")


def test_drain_still_self_heals_live_rows_never_deletes_them():
    """Even while draining, a row the source says is LIVE is reactivated, not deleted."""
    c = _install({"testp_listings": [_cand(i) for i in range(400)],
                  "cleanup_runs": [{"platform": "testp", "dry_run": False, "candidates": 400}]},
                 _drain_pol(anomaly_floor=300, max_delete_per_run=10),
                 probe=lambda url: (200, "still for sale"))   # every recheck says LIVE
    s = C.run("testp", force=True)
    assert s["aborted"] is False
    assert s["deleted"] == 0 and c.deleted == {}       # nothing deleted
    assert s["reactivated"] == 10                       # the capped batch was self-healed


def test_drain_aborts_on_a_real_spike():
    """A sudden jump (eligible >> factor × last run) is a regression, not a backlog — drain mode
    still aborts and deletes nothing, even though every row would recheck 'dead'."""
    c = _install({"testp_listings": [_cand(i) for i in range(600)],
                  "cleanup_runs": [{"platform": "testp", "dry_run": False, "candidates": 100}]},
                 _drain_pol(anomaly_floor=300, drain_spike_factor=2.0), probe=lambda url: (404, ""))
    s = C.run("testp", force=True)
    assert s["aborted"] is True and s["deleted"] == 0 and c.deleted == {}
    assert "spike" in (s["abort_reason"] or "").lower()


def test_drain_bootstraps_with_no_history():
    """First drain run for an opted-in platform (no prior cleanup_runs) is NOT treated as a spike —
    enabling drain_backlog is the human decision; each row is still source-verified."""
    c = _install({"testp_listings": [_cand(i) for i in range(400)]},
                 _drain_pol(anomaly_floor=300, max_delete_per_run=25), probe=lambda url: (404, ""))
    s = C.run("testp", force=True)
    assert s["aborted"] is False and s["deleted"] == 25


def test_drain_inconclusive_freeze_still_applies():
    """If the source/proxy degrades mid-drain (many 'unknown' rechecks), the run-level freeze must
    still fire and delete nothing — drain does not weaken the inconclusive-evidence guard."""
    c = _install({"testp_listings": [_cand(i) for i in range(400)],
                  "cleanup_runs": [{"platform": "testp", "dry_run": False, "candidates": 400}]},
                 _drain_pol(anomaly_floor=300, max_delete_per_run=50), probe=lambda url: (403, ""))
    s = C.run("testp", force=True)
    assert s["deleted"] == 0 and c.deleted == {}       # frozen — a degraded source can't delete
    assert s["aborted"] is True


def test_drain_over_fraction_gate_also_drips():
    """Over the 10% mass-inactivation guard (not just the floor) but not a spike → still drains."""
    # 600 rows, 400 eligible: 400 > 10% of 600 (=60) trips the fraction guard; floor set high so it
    # is the fraction gate, not the anomaly gate, that would abort.
    rows = ([_cand(i) for i in range(400)]
            + [{"id": 1000 + i, "ad_number": f"L{i}", "listing_url": f"http://x/{1000+i}",
                "missing_count": 0, "last_seen_at": "2026-09-19T00:00:00+00:00", "active": True}
               for i in range(200)])
    c = _install({"testp_listings": rows,
                  "cleanup_runs": [{"platform": "testp", "dry_run": False, "candidates": 400}]},
                 _drain_pol(anomaly_floor=100000, max_delete_per_run=30), probe=lambda url: (404, ""))
    s = C.run("testp", force=True)
    assert s["aborted"] is False, s.get("abort_reason")
    assert s["deleted"] == 30


# ── wasalt browser probe (2026-09-20): cloud rechecks must go through the browser, not curl_cffi,
# because wasalt.sa null-routes curl_cffi+proxy (issue #1019). Without this every wasalt recheck is
# 'unknown' and nothing dead is ever deleted. ─────────────────────────────────────────────────────

_REAL_PROBE = C._probe   # captured at import, before any _install test rebinds C._probe


class _FakeBrowser:
    def __init__(self, answer): self.answer = answer; self.closed = False
    def page_data(self, url): return self.answer          # (data, status, nbytes)
    def close(self): self.closed = True


def _with_browser(monkey, answer):
    import scrapers.wasalt.browser as B
    monkey.setattr(B, "browser_enabled", lambda: True)
    fb = _FakeBrowser(answer)
    monkey.setattr(B, "BrowserFetcher", lambda: fb)
    C._BROWSER = None
    return fb


def test_wasalt_probe_uses_browser_and_maps_status(monkeypatch):
    live_data = {"props": {"pageProps": {"propertyDetailsV3": {"id": 1}}}}
    # a real 404 → dead
    _with_browser(monkeypatch, (None, 404, 0))
    assert _REAL_PROBE("https://wasalt.sa/en/property/x-1") == (404, "")
    # 200 with propertyDetailsV3 → live (200, "")
    _with_browser(monkeypatch, (live_data, 200, 900))
    assert _REAL_PROBE("https://wasalt.sa/en/property/x-2") == (200, "")
    # a block/timeout (no data, no clean status) → unknown (None, "")
    _with_browser(monkeypatch, (None, None, 0))
    assert _REAL_PROBE("https://wasalt.sa/en/property/x-3") == (None, "")
    # a 200 we could NOT parse (no propertyDetailsV3) → unknown, never dead
    _with_browser(monkeypatch, ({"props": {"pageProps": {}}}, 200, 30000))
    assert _REAL_PROBE("https://wasalt.sa/en/property/x-4") == (None, "")
    C._BROWSER = None


def test_wasalt_probe_verdicts_end_to_end(monkeypatch):
    """The mapped (status, body) must drive verdict() to the right delete/self-heal decision."""
    dm = C.PLATFORMS["wasalt"]["dead_marker"]
    _with_browser(monkeypatch, (None, 404, 0))
    st, body = _REAL_PROBE("https://wasalt.sa/en/property/gone")
    assert C.verdict(st, body, dm) == "dead"
    live_data = {"props": {"pageProps": {"propertyDetailsV3": {"id": 1}}}}
    _with_browser(monkeypatch, (live_data, 200, 900))
    st, body = _REAL_PROBE("https://wasalt.sa/en/property/alive")
    assert C.verdict(st, body, dm) == "live"
    _with_browser(monkeypatch, (None, 403, 0))
    st, body = _REAL_PROBE("https://wasalt.sa/en/property/blocked")
    assert C.verdict(st, body, dm) == "unknown"
    C._BROWSER = None


# ── aqar soft-close (2026-09-20): the cleanup dead-check must match aqar's OWN liveness, or a
# soft-closed (sold/rented) listing re-checks as "live" and gets RESURRECTED into search. ──────────

_AQAR_CLOSED_BODY = '<html>… <span class="badge status">مغلق</span> … no offers node …</html>'
_AQAR_LIVE_BODY = '<html>… "offers": {"price":"500000"} … price 500000 ريال …</html>'


def test_aqar_soft_closed_is_dead_not_live():
    dm = C.PLATFORMS["aqar"]["dead_marker"]
    # a real 200 soft-closed page (مغلق badge + no offers node) MUST verdict 'dead' (delete),
    # not 'live' (which would reactivate a sold listing back into search).
    assert C.verdict(200, _AQAR_CLOSED_BODY, dm) == "dead"
    # a genuinely live aqar listing (offers node present) stays 'live' → self-heal, never deleted.
    assert C.verdict(200, _AQAR_LIVE_BODY, dm) == "live"


def test_aqar_deadcheck_matches_aqar_liveness():
    """The cleanup's aqar dead-check must agree with aqar liveness's own looks_dead on a 200 body —
    they were allowed to diverge and the cleanup's was weaker (markers-only)."""
    from scrapers.aqar.liveness import looks_dead
    dm = C.PLATFORMS["aqar"]["dead_marker"]
    for body in (_AQAR_CLOSED_BODY, _AQAR_LIVE_BODY, "<html>ordinary live page 500000 ريال</html>"):
        cleanup_dead = C.verdict(200, body, dm) == "dead"
        assert cleanup_dead == looks_dead(200, body), f"divergence on: {body[:40]}"


def test_wasalt_deadcheck_does_not_borrow_aqar_soft_close():
    """wasalt must NOT inherit aqar's مغلق soft-close rule — a live wasalt listing whose text
    happens to contain مغلق (e.g. gated compound) must not be judged dead. wasalt dead = 404."""
    dm = C.PLATFORMS["wasalt"]["dead_marker"]
    assert C.verdict(200, _AQAR_CLOSED_BODY, dm) == "live"   # 200 + مغلق badge but NOT aqar → live
    assert C.verdict(404, "", dm) == "dead"                    # wasalt dead is the real 404


# ── A run that DIES mid-delete must still leave an audit trail ────────────────────────────────
# Earned 2026-09-20 by cleanup run 49535 (cleanup:wasalt). It wrote 500 pre-delete rows into
# cleanup_deletion_log, deleted 1, then took a Postgres statement timeout (57014) in the delete
# loop. Because the cleanup_runs insert sits AFTER the loop and the except handler called only
# end_run(), the run left NO row in cleanup_runs — of every cleanup:* run in the preceding 30
# days it was the only one without one, and every CONTROLLED abort wrote one. The cleanup audit
# surface therefore showed wasalt's last action as the clean dry run that preceded it, while 499
# claims of permanent deletion sat unexplained in the deletion ledger. end_run also reported
# rows_seen=0, rows_upserted=0 over a row that really had been destroyed.

class _DeleteTimeoutClient(_Client):
    """Deletes normally for `allow_chunks` chunks, then raises the way postgrest surfaces a
    statement timeout. cleanup_deletion_log has already committed by then, exactly as in prod."""
    def __init__(self, rows, allow_chunks=0):
        super().__init__(rows)
        self.allow_chunks, self.delete_chunks = allow_chunks, 0

    def table(self, name):
        t = _Table(self, name)
        real = t.execute

        def execute():
            if t._op and t._op[0] == "delete":
                if self.delete_chunks >= self.allow_chunks:
                    raise RuntimeError(
                        "{'code': '57014', 'message': 'canceling statement due to statement timeout'}")
                self.delete_chunks += 1
            return real()

        t.execute = execute
        return t


def _run_killed_mid_delete():
    """Two tables → two delete chunks; the first commits, the second times out. Returns the
    killer client after C.run() has raised."""
    rows = {"testp_listings": [_cand(1)], "testp_other": [_cand(2)]}
    c = _install(rows, POL(anomaly_floor=100), probe=lambda url: (404, ""),
                 tables=("testp_listings", "testp_other"))
    killer = _DeleteTimeoutClient(c.rows, allow_chunks=1)
    C.sb = lambda: killer
    raised = None
    try:
        C.run("testp", force=True)
    except Exception as e:      # the original failure must still propagate to the caller
        raised = e
    assert raised is not None, "the underlying failure must never be swallowed"
    assert "57014" in str(raised)
    return killer


def test_run_killed_mid_delete_still_writes_its_cleanup_runs_row():
    killer = _run_killed_mid_delete()
    runs = killer.inserted.get("cleanup_runs")
    assert runs, ("a cleanup run that dies mid-delete must still record itself in cleanup_runs — "
                  "otherwise its pre-delete deletion-ledger claims have nothing explaining them")
    row = runs[0]
    assert row["aborted"] is True
    assert "57014" in (row["abort_reason"] or ""), "the run row must name why it died"


def test_run_killed_mid_delete_reports_the_TRUE_partial_delete_count():
    killer = _run_killed_mid_delete()
    # one table's chunk committed before the timeout, the other never ran
    assert len(killer.deleted) == 1, "exactly one table's delete should have committed"
    runs = killer.inserted.get("cleanup_runs")
    assert runs, "no cleanup_runs row was written at all, so no count was reported"
    row = runs[0]
    assert row["deleted"] == 1, (
        f"the audit row must report the rows actually deleted, got {row['deleted']}. Reporting 0 "
        "hides a real destruction; reporting 2 claims one that never happened.")


def test_pre_delete_ledger_claims_are_still_written_when_the_delete_dies():
    """Guards the direction that must NOT change: the ledger is written BEFORE the delete on
    purpose (DELETION_SAFETY.md §1). Suppressing it on failure would turn the committed delete
    into an UNLEDGERED HARD DELETE, which is strictly worse."""
    killer = _run_killed_mid_delete()
    assert killer.inserted.get("cleanup_deletion_log"), "pre-delete claims must still be recorded"


def test_write_chunk_is_small_enough_for_the_slow_archive_trigger():
    """Each delete fires trg_archive_hard_delete (jsonb archive of the whole row; ~16ms/row on
    wasalt because of its ar_data blob). At 200/batch that is ~3.4s in one statement and 57014'd a
    real wasalt drain against PostgREST's 8s timeout. Keep the write chunk small enough for a wide
    margin on the slowest table — a regression back to a big batch reintroduces the timeout."""
    assert C._WRITE_CHUNK <= 100, (
        f"_WRITE_CHUNK={C._WRITE_CHUNK}: at ~16ms/row the archive trigger makes a delete batch this "
        "big approach the 8s statement_timeout on wasalt. Keep it <= 100.")


def test_deletes_are_actually_chunked_by_write_chunk(monkeypatch):
    """More candidates than _WRITE_CHUNK must still all be deleted (proves the loop chunks, not
    that it silently drops the tail)."""
    n = C._WRITE_CHUNK * 2 + 7
    c = _install({"testp_listings": [_cand(i) for i in range(n)]},
                 POL(max_delete_per_run=n + 100, anomaly_floor=n + 100), probe=lambda url: (404, ""))
    s = C.run("testp", force=True)
    assert s["deleted"] == n and len(c.deleted["testp_listings"]) == n


# ── The ledger of a PERMANENT delete must name the branch that decided it (2026-09-21) ───────────
# Measured that day: cleanup run 129 permanently deleted 1,825 aqar rows, EVERY ONE on
# `http_status: 200`. aqar is the only enabled platform whose death signal is a BODY check (it
# soft-closes with 200 + a «مغلق» badge), so on aqar — and only on aqar — `verdict: dead,
# http_status: 200` is indistinguishable from what a mis-firing dead_marker would have written, and
# the row is gone permanently. This repo already paid for exactly this omission once: on 2026-08-26
# the aqarcity oracle was found mapping "real id but unparseable page" to 'gone', and adjudicating
# 254 same-day deactivations needed a by-hand re-probe of the live source "because nothing stored
# said WHICH condition had fired". That fix landed on ops_stale_inactivation_probe — the
# DEACTIVATION ledger — and never on the DELETION ledger, where the action cannot be undone.

def test_the_two_dead_branches_are_distinguishable_in_the_record():
    """A 404-dead and a 200-marker-dead must not write the same evidence."""
    dm = lambda b: b == "DEAD"
    by_404 = C.verdict_detail(404, "", dm)
    by_body = C.verdict_detail(200, "DEAD", dm)
    assert by_404[0] == by_body[0] == "dead"
    assert by_404[1] and by_body[1], "a dead verdict with no stated evidence is unfalsifiable"
    assert by_404[1] != by_body[1], (
        "both routes to a PERMANENT delete write the same evidence string, so the record cannot "
        "say which one decided — the 2026-08-26 aqarcity lesson, on the irreversible ledger")


def test_every_verdict_states_its_branch():
    dm = lambda b: b == "DEAD"
    for status, body in ((None, ""), (404, ""), (410, ""), (403, ""), (500, ""),
                         (200, "DEAD"), (200, "for sale"), (200, "")):
        v, why = C.verdict_detail(status, body, dm)
        assert v in ("dead", "live", "unknown")
        assert why, f"verdict_detail({status}, {body!r}) returned no reason"


def test_verdict_delegates_so_the_branches_cannot_drift():
    """`verdict()` must not keep a second copy of the decision."""
    dm = lambda b: b == "DEAD"
    for status, body in ((None, ""), (404, ""), (410, ""), (403, ""), (429, ""), (500, ""),
                         (200, "DEAD"), (200, "for sale"), (200, "")):
        assert C.verdict(status, body, dm) == C.verdict_detail(status, body, dm)[0]


def test_the_evidence_reaches_the_deletion_ledger_end_to_end():
    """Executed, not asserted about: run the real run() and read the real log payload.

    The 1,825-row case is the `body_dead` row here — a 200 that only the dead_marker condemned.
    """
    verdicts = {"http://x/0": (404, ""), "http://x/1": (200, "DEAD")}
    c = _install({"testp_listings": [_cand(0), _cand(1)]}, POL(anomaly_floor=1000),
                 probe=lambda url: verdicts[url])
    s = C.run("testp", force=True)
    assert s["deleted"] == 2, s
    logged = c.inserted.get("cleanup_deletion_log")
    assert logged, "no audit row was written for a permanent delete"
    rows = [r for batch in logged for r in (batch if isinstance(batch, list) else [batch])]
    by_id = {r["listing_id"]: r["reason"] for r in rows}
    assert set(by_id) == {0, 1}, by_id
    for lid, reason in by_id.items():
        assert reason.get("evidence"), (
            f"listing {lid} was PERMANENTLY DELETED and its ledger row does not say what decided it")
    assert by_id[0]["evidence"] != by_id[1]["evidence"], (
        "a 404 delete and a 200-marker delete wrote identical evidence into the ledger")
    assert "200" in by_id[1]["evidence"] and "marker" in by_id[1]["evidence"], by_id[1]


def test_wasalt_empty_body_self_heal_is_preserved():
    """A REGRESSION GUARD ON THE FIX ITSELF, not on the original defect.

    `_wasalt_browser_probe()` deliberately encodes "200 and propertyDetailsV3 is present" as
    `(200, '')` and relies on `dead_marker('')` being False to mean self-heal. Tightening the
    empty-body case to 'unknown' — which is what LISTING_LIVENESS.md §1 says about a body we could
    not read, and which was tried on 2026-09-21 — silently disables wasalt's self-heal and leaves
    proven-live listings inactive and ageing on the deletion clock. Making the two consistent means
    moving wasalt's transport off the empty-body encoding FIRST.
    """
    dm = C.PLATFORMS["wasalt"]["dead_marker"]
    v, why = C.verdict_detail(200, "", dm)
    assert v == "live", "wasalt's empty-body self-heal encoding was broken"
    assert why, "even the encoded case must state itself in the record"


# ── handshake-block escape (2026-09-28): aqar 403s chrome124 and serves safari17_0. Before the
# escape every aqar recheck was inconclusive (runs 02:00 and 11:10 UTC, 2000/2000) and cleanup froze.

class _Resp:
    def __init__(self, status, text=""): self.status_code = status; self.text = text


class _Sess:
    def __init__(self, answers, log, name): self.answers = answers; self.log = log; self.name = name
    def get(self, url, **_kw):
        self.log.append(self.name)
        a = self.answers.get(self.name)
        if isinstance(a, Exception):
            raise a
        return _Resp(*a)


def _routes(monkeypatch, answers):
    from scrapers.common import http as H
    log: list[str] = []
    monkeypatch.setattr(H, "session", lambda: _Sess(answers, log, "chrome124"))
    monkeypatch.setattr(H, "_route_session", lambda p, _v, fresh=False: _Sess(answers, log, p))
    C._probe_route.clear()
    return log


AQAR_URL = "https://sa.aqar.fm/ad/123"


def test_probe_escapes_handshake_403_and_pins_the_working_profile(monkeypatch):
    log = _routes(monkeypatch, {"chrome124": (403,), "safari17_0": (200, "<html>live</html>")})
    assert _REAL_PROBE(AQAR_URL) == (200, "<html>live</html>")
    assert C._probe_route["sa.aqar.fm"] == "safari17_0"
    log.clear()
    assert _REAL_PROBE(AQAR_URL)[0] == 200
    assert log == ["safari17_0"], "a pinned host must go straight to its working profile"


def test_probe_escape_returns_a_real_404_from_the_working_profile(monkeypatch):
    _routes(monkeypatch, {"chrome124": (403,), "safari17_0": (404,)})
    assert _REAL_PROBE(AQAR_URL)[0] == 404


def test_probe_blocked_on_every_profile_stays_inconclusive(monkeypatch):
    _routes(monkeypatch, {"chrome124": (403,), "safari17_0": (403,), "firefox133": RuntimeError("x"),
                          "edge101": (401,)})
    status, _ = _REAL_PROBE(AQAR_URL)
    assert status in (None, 403)
    assert C.verdict(status, "", C._never) == "unknown"
    assert "sa.aqar.fm" not in C._probe_route


def test_probe_does_not_escape_a_non_block_answer(monkeypatch):
    log = _routes(monkeypatch, {"chrome124": (404,)})
    assert _REAL_PROBE(AQAR_URL)[0] == 404
    assert log == ["chrome124"]


# ── Known-live controls + the daily fleet run (2026-09-28, owner: 30-day deletion for every site) ──

def _live(i, hours_ago=1):
    from datetime import datetime, timedelta, timezone
    seen = (datetime.now(timezone.utc) - timedelta(hours=hours_ago)).isoformat()
    return {"id": 1000 + i, "ad_number": f"L{i}", "listing_url": f"http://x/live{i}",
            "missing_count": 0, "last_seen_at": seen, "active": True}


def _controlled(rows, probe, **pol):
    c = _install({"testp_listings": rows}, POL(**pol), probe=probe, dead_marker=C._never)
    C.PLATFORMS["testp"]["controls"] = True
    return c


def test_controls_that_404_mean_a_block_so_nothing_is_deleted():
    """gathern answered a block with 404 (LISTING_LIVENESS.md §5.4). With every page 404, a 404-only
    check calls every candidate dead; only the known-live controls reveal the source is lying."""
    c = _controlled([_cand(1), _cand(2)] + [_live(i) for i in range(5)], probe=lambda url: (404, ""))
    s = C.run("testp", force=True)
    assert s["aborted"] and s["deleted"] == 0 and c.deleted == {} and s["rechecked"] == 0
    assert "known-live controls failed: 0/5" in s["abort_reason"]


def test_controls_that_answer_live_let_a_real_404_delete():
    probe = lambda url: (200, "<html>ad</html>") if "live" in url else (404, "")
    c = _controlled([_cand(1), _cand(2)] + [_live(i) for i in range(5)], probe=probe)
    s = C.run("testp", force=True)
    assert not s["aborted"] and s["deleted"] == 2 and sorted(c.deleted["testp_listings"]) == [1, 2]


def test_a_block_that_starts_mid_run_is_caught_by_the_closing_controls():
    calls = {"live": 0}
    def probe(url):
        if "live" in url:
            calls["live"] += 1
            return (200, "<html>ad</html>") if calls["live"] <= 5 else (404, "")
        return (404, "")
    c = _controlled([_cand(1), _cand(2)] + [_live(i) for i in range(5)], probe=probe)
    s = C.run("testp", force=True)
    assert s["aborted"] and s["deleted"] == 0 and c.deleted == {}
    assert s["abort_reason"].startswith("closing known-live controls failed")
    assert not c.inserted.get("cleanup_deletion_log")


def test_too_few_or_stale_controls_fail_closed():
    probe = lambda url: (200, "<html>ad</html>") if "live" in url else (404, "")
    few = _controlled([_cand(1)] + [_live(i) for i in range(2)], probe=probe)
    assert C.run("testp", force=True)["deleted"] == 0 and few.deleted == {}
    stale = _controlled([_cand(1)] + [_live(i, hours_ago=C.CONTROL_HOURS + 1) for i in range(5)], probe=probe)
    assert C.run("testp", force=True)["deleted"] == 0 and stale.deleted == {}


def test_a_dry_run_whose_controls_fail_is_aborted_so_it_cannot_enable_a_site():
    probe = lambda url: (404, "")
    c = _controlled([_cand(1)] + [_live(i) for i in range(5)], probe=probe)
    s = C.run("testp", force=True, dry_run=True)
    assert s["aborted"] and s["deleted"] == 0 and c.deleted == {}   # a dry run proves nothing here


def test_the_new_sites_are_registered_with_their_measured_check():
    assert C.PLATFORMS["aqarmonthly"]["dead_marker"] is C._aqar_dead      # aqar's own, never a copy
    assert C.PLATFORMS["aqarmonthly"]["tables"] == ["aqarmonthly_residential_listings"]
    for p in ("jazwtn", "mizlaj", "nowaisiry", "raghdan"):
        reg = C.PLATFORMS[p]
        assert reg["dead_marker"] is C._never and reg["controls"] is True, p
        assert reg["tables"] == [f"{p}_residential_listings", f"{p}_commercial_listings"], p
    # Every 404-only site added after gathern carries controls: 404-only is exactly the check a
    # block-as-404 fools.
    for p, reg in C.PLATFORMS.items():
        if reg.get("dead_marker") is C._never and p not in ("gathern", "testp", "nodeadp"):
            assert reg.get("controls") is True, p


def test_fleet_runs_every_enabled_site_without_its_own_workflow(monkeypatch):
    client = _Client({"platform_retention_policy": [
        {"platform": "aqar", "enabled": True}, {"platform": "wasalt", "enabled": True},
        {"platform": "gathern", "enabled": True}, {"platform": "aqarcity", "enabled": True},
        {"platform": "jazwtn", "enabled": True}, {"platform": "mizlaj", "enabled": False},
        {"platform": "unregistered", "enabled": True}]})
    monkeypatch.setattr(C, "sb", lambda: client)
    ran = []
    def fake_run(p, **kw):
        ran.append((p, kw))
        if p == "jazwtn":
            raise RuntimeError("boom")
        return {"aborted": p == "unregistered"}
    monkeypatch.setattr(C, "run", fake_run)
    assert C.run_fleet(dry_run=True) == 2                  # one died, one aborted — both counted
    assert [p for p, _ in ran] == ["aqarcity", "jazwtn", "unregistered"]
    assert all(kw == {"dry_run": True} for _, kw in ran)   # never force: each site's policy decides


def test_statement_timeout_on_a_delete_chunk_splits_and_finishes_it():
    # aqar 2026-10-02: a 50-row delete hit 57014; 850 logged rows were left undeleted.
    deleted, calls = [], []

    class _D:
        def __init__(self, ids): self.ids = ids
        def execute(self):
            calls.append(len(self.ids))
            if len(self.ids) > 10:
                raise Exception({"code": "57014", "message": "canceling statement due to statement timeout"})
            deleted.extend(self.ids)

    class _T:
        def delete(self): return self
        def in_(self, col, ids): return _D(ids)

    class _Cl:
        def table(self, t): return _T()

    stats = {"deleted": 0}
    C._delete_chunk(_Cl(), "aqar_residential_listings", list(range(50)), stats)
    assert sorted(deleted) == list(range(50)) and stats["deleted"] == 50


def test_any_other_delete_error_still_raises():
    import pytest

    class _T:
        def delete(self): return self
        def in_(self, col, ids): return self
        def execute(self): raise Exception({"code": "42501", "message": "permission denied"})

    class _Cl:
        def table(self, t): return _T()

    stats = {"deleted": 0}
    with pytest.raises(Exception):
        C._delete_chunk(_Cl(), "t", [1, 2, 3], stats)
    assert stats["deleted"] == 0


# ── A cleanup "live" may not overrule a FRESH direct "dead" (2026-10-05) ──────────────────────────
# gathern: the 03:00 cleanup re-read 496 hidden rows as 200 in 7 days and revived them; all 142 it
# revived on 2026-10-05 read 404 again on the bracketed direct sweep within 3 hours.
from datetime import datetime as _dt, timedelta as _td, timezone as _tz


def _ago(h): return (_dt.now(_tz.utc) - _td(hours=h)).isoformat()


def _ledger_row(i, verdict, status, hours_ago, applied=True):
    return {"listing_id": i, "source_table": "testp_listings", "run_at": _ago(hours_ago),
            "verdict": verdict, "http_status": status, "applied": applied}


def _with_ledger(ledger_rows, probe):
    C.DIRECT_LEDGERS["testp"] = "testp_liveness_detail"
    return _install({"testp_listings": [_cand(1)], "testp_liveness_detail": ledger_rows}, POL(), probe=probe)


def test_cleanup_200_does_not_revive_a_row_its_direct_sweep_read_404_hours_ago():
    c = _with_ledger([_ledger_row(1, "kill", 404, 3)], probe=lambda url: (200, "page"))
    s = C.run("testp", force=True)
    assert s["reactivated"] == 0 and s["deleted"] == 0 and s["skipped"] == 1
    assert not c.updated.get("testp_listings")          # not set back to active
    assert "held_live_vs_fresh_direct_dead=1" in (s["note"] or "")


def test_a_newer_direct_alive_reading_lets_the_cleanup_revive():
    c = _with_ledger([_ledger_row(1, "kill", 404, 10), _ledger_row(1, "alive", 200, 2)],
                     probe=lambda url: (200, "page"))
    s = C.run("testp", force=True)
    assert s["reactivated"] == 1 and c.updated.get("testp_listings")


def test_a_stale_direct_dead_reading_does_not_hold_a_real_comeback():
    c = _with_ledger([_ledger_row(1, "kill", 404, C.FRESH_DEAD_HOURS + 5)], probe=lambda url: (200, "page"))
    s = C.run("testp", force=True)
    assert s["reactivated"] == 1 and c.updated.get("testp_listings")


def test_an_unapplied_dead_reading_holds_nothing():
    c = _with_ledger([_ledger_row(1, "kill", 404, 3, applied=False)], probe=lambda url: (200, "page"))
    s = C.run("testp", force=True)
    assert s["reactivated"] == 1


def test_the_hold_never_changes_deletion():
    c = _with_ledger([_ledger_row(1, "kill", 404, 3)], probe=lambda url: (404, ""))
    s = C.run("testp", force=True)
    assert s["deleted"] == 1 and s["reactivated"] == 0


def test_an_unreadable_ledger_revives_nothing():
    c = _with_ledger([], probe=lambda url: (200, "page"))
    orig = c.table
    def table(name):
        if name == "testp_liveness_detail":
            raise RuntimeError("ledger down")
        return orig(name)
    c.table = table
    s = C.run("testp", force=True)
    assert s["reactivated"] == 0 and s["deleted"] == 0


def test_platform_without_a_ledger_is_unchanged():
    C.DIRECT_LEDGERS.pop("testp", None)
    c = _install({"testp_listings": [_cand(1)]}, POL(), probe=lambda url: (200, "page"))
    s = C.run("testp", force=True)
    assert s["reactivated"] == 1


def test_gathern_has_a_direct_ledger():
    assert C.DIRECT_LEDGERS["gathern"] == "gathern_liveness_detail"


# ── A listing URL that lands on the site's home page is no answer (2026-10-05) ────────────────────
# gathern: a removed unit answers 307 -> /ar?error=500 and the home page serves 200; the old reader
# called that live (496 false revivals in 7 days, two false P0 deleted_but_source_live).
class _HomeResp:
    def __init__(self, status, text, url):
        self.status_code, self.text, self.url = status, text, url


class _HomeSess:
    def __init__(self, resp): self.resp = resp
    def get(self, url, **k): return self.resp


class _Real:
    """The real cleanup._probe (_install replaces C._probe), with C's own globals."""
    _probe = staticmethod(lambda u: _REAL_PROBE(u))
    verdict = staticmethod(lambda *a: C.verdict(*a))
    PLATFORMS = property(lambda self: C.PLATFORMS)


def _real_probe_with(monkeypatch, resp, escape_resp=None):
    monkeypatch.setattr(C.http, "session", lambda: _HomeSess(resp))
    monkeypatch.setattr(C.http, "_route_session",
                        lambda *a, **k: _HomeSess(escape_resp or resp))
    C._probe_route.clear()
    return _Real()


def test_redirect_to_the_home_page_is_no_answer_never_live(monkeypatch):
    u = "https://gathern.co/view/94419/unit/135509"
    mod = _real_probe_with(monkeypatch, _HomeResp(200, "<html>home</html>", "https://gathern.co/ar?error=500"))
    status, body = mod._probe(u)
    assert status is None and body == ""
    assert mod.verdict(status, body, mod.PLATFORMS["gathern"]["dead_marker"]) == "unknown"


def test_home_redirect_falls_through_to_a_profile_that_reads_the_real_404(monkeypatch):
    u = "https://gathern.co/view/94419/unit/135509"
    mod = _real_probe_with(monkeypatch, _HomeResp(200, "home", "https://gathern.co/ar?error=500"),
                           escape_resp=_HomeResp(404, "الصفحة غير موجودة", u))
    assert mod._probe(u)[0] == 404


def test_a_live_listing_page_and_a_slug_redirect_stay_live(monkeypatch):
    u = "https://gathern.co/view/197331/unit/275879"
    mod = _real_probe_with(monkeypatch, _HomeResp(200, "<html>unit</html>", u))
    assert mod._probe(u)[0] == 200
    mod = _real_probe_with(monkeypatch, _HomeResp(200, "<html>ad</html>", "https://x.sa/ad/123-villa-riyadh"))
    assert mod._probe("https://x.sa/ad/123")[0] == 200


def test_landed_on_home_predicate():
    assert C._landed_on_home("https://gathern.co/view/1/unit/2", "https://gathern.co/ar?error=500")
    assert C._landed_on_home("https://a.sa/p/9", "https://a.sa/")
    assert not C._landed_on_home("https://a.sa/p/9", "https://a.sa/p/9/")
    assert not C._landed_on_home("https://a.sa/", "https://a.sa/")
    assert not C._landed_on_home("https://a.sa/p/9", None)
