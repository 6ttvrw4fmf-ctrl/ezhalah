"""Daily DIRECT liveness for the small sites (scrapers/common/fleet_liveness.py). What must hold:
UNKNOWN writes nothing but "we looked"; three DIRECT 'gone' answers hide, each hide with its
evidence row written first; a live answer clears strikes and stamps last_verified_alive_at; failed
known-live controls or a hide count over the cap write no strike and no hide; a site outside APPLY
(shadow) writes nothing at all. Fake PostgREST, fake oracle, no network."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import types

import pytest

import scrapers.common.fleet_liveness as F

T = "testsite_residential_listings"
NOW = datetime.now(timezone.utc)


class _Res:
    def __init__(self, data, count=None):
        self.data, self.count = data, count


class _Q:
    def __init__(self, c, t):
        self.c, self.t, self.f, self.op, self.n, self.orders, self.counting = c, t, [], None, None, [], False

    def select(self, *a, count=None): self.counting = count == "exact"; return self
    def eq(self, col, v): self.f.append(lambda r: r.get(col) == v); return self
    def gt(self, col, v): self.f.append(lambda r: (r.get(col) or 0) > v); return self
    def gte(self, col, v): self.f.append(lambda r: (r.get(col) or "") >= v); return self
    def in_(self, col, vals): vs = set(vals); self.f.append(lambda r: r.get(col) in vs); return self
    def order(self, col, desc=False, nullsfirst=False): self.orders.append((col, desc)); return self
    def limit(self, n): self.n = n; return self
    def range(self, a, b): self.off, self.n = a, b - a + 1; return self
    def update(self, p): self.op = ("update", p); return self
    def insert(self, p): self.op = ("insert", p); return self

    def execute(self):
        if self.op and self.op[0] == "insert":
            self.c.log.append(("insert", self.t, self.op[1]))
            return _Res([])
        rows = [r for r in self.c.rows.get(self.t, []) if all(f(r) for f in self.f)]
        if self.op and self.op[0] == "update":
            for r in rows:
                r.update(self.op[1])
                self.c.log.append(("update", self.t, r["id"], dict(self.op[1])))
            return _Res([])
        for col, desc in reversed(self.orders):
            rows.sort(key=lambda r: (r.get(col) is None, r.get(col) or 0) if not desc
                      else (r.get(col) is not None, r.get(col) or 0), reverse=desc)
        off = getattr(self, "off", 0)
        return _Res([dict(r) for r in rows[off: off + self.n if self.n else None]], count=len(rows))


class _Client:
    def __init__(self, rows): self.rows, self.log = {T: rows}, []
    def table(self, t): return _Q(self, t)


def _row(i, mc=0, seen_h=2):
    return {"id": i, "ad_number": f"A{i}", "listing_url": f"https://x/{i}", "active": True,
            "missing_count": mc, "last_seen_at": (NOW - timedelta(hours=seen_h)).isoformat(),
            "last_liveness_probe_at": None}


@pytest.fixture
def site(monkeypatch):
    def install(rows, answers, *, apply=True, default="live"):
        client = _Client(rows)
        monkeypatch.setattr(F, "sb", lambda: client)
        monkeypatch.setattr(F, "begin_run", lambda name: 1)
        monkeypatch.setattr(F, "end_run", lambda *a, **k: True)
        monkeypatch.setitem(F.SITES, "testsite", "unused:x")
        monkeypatch.setattr(F, "APPLY", frozenset({"testsite"} if apply else ()))
        monkeypatch.setattr(F, "policy_for", lambda s: _Policy())
        monkeypatch.setattr(F, "PACE_S", 0)
        calls = {"n": 0}

        def oracle(ad):
            calls["n"] += 1
            a = answers(ad, calls["n"]) if callable(answers) else answers.get(ad, default)
            return (a, f"test says {a}")
        monkeypatch.setattr(F, "oracle_for", lambda spec, control: oracle)
        return client
    return install


class _Policy:
    grace = 3


def _updates(c, i):
    return [u[3] for u in c.log if u[0] == "update" and u[2] == i]


def _controls():
    return [_row(100 + k, seen_h=1) for k in range(5)]


def test_three_direct_gones_hide_with_evidence_written_first(site):
    c = site([_row(1, mc=2), _row(2, mc=0)] + _controls(), {"A1": "gone", "A2": "gone"})
    st = F.run_site("testsite", shadow=False)
    assert st["hidden"] == 1 and st["struck"] == 1
    ev = [i for i, e in enumerate(c.log) if e[0] == "insert" and e[1] == "ops_stale_inactivation_probe"]
    hide = [i for i, e in enumerate(c.log) if e[0] == "update" and e[2] == 1 and e[3].get("active") is False]
    assert ev and hide and ev[0] < hide[0], "the evidence row must exist before the row is hidden"
    assert c.log[ev[0]][2]["verdict"] == "GONE" and c.log[ev[0]][2]["ad_number"] == "A1"
    assert _updates(c, 2)[-1]["missing_count"] == 1 and "active" not in _updates(c, 2)[-1]


def test_live_clears_strikes_and_stamps_verification(site):
    c = site([_row(1, mc=2)] + _controls(), {})
    F.run_site("testsite", shadow=False)
    u = _updates(c, 1)[-1]
    assert u["missing_count"] == 0 and u["last_verified_alive_at"]


def test_unknown_only_records_that_we_looked(site):
    c = site([_row(1, mc=2)] + _controls(), {"A1": "unknown"})
    F.run_site("testsite", shadow=False)
    assert _updates(c, 1) == [{"last_liveness_probe_at": _updates(c, 1)[0]["last_liveness_probe_at"]}]


def test_failed_opening_controls_read_and_write_nothing(site):
    c = site([_row(1, mc=2)] + _controls(), lambda ad, n: "gone")
    st = F.run_site("testsite", shadow=False)
    assert st["quarantined"].startswith("opening") and st["probed"] == 0
    assert not [e for e in c.log if e[0] in ("update", "insert")]


def test_a_stale_crawl_still_yields_controls_and_the_site_is_checked(site):
    # dwelleo/muhaysini 2026-10-02: crawl failing for 3-4 days, nothing seen inside CONTROL_HOURS.
    stale = [_row(100 + k, seen_h=F.CONTROL_HOURS + 30 + k) for k in range(5)]
    c = site([_row(1, mc=0, seen_h=F.CONTROL_HOURS + 90)] + stale, {})
    st = F.run_site("testsite", shadow=False)
    assert st["quarantined"] is None and st["probed"] == 6 and st["verified"] == 6
    assert _updates(c, 1)[-1]["last_verified_alive_at"]


def test_stale_controls_that_are_gone_still_quarantine(site):
    stale = [_row(100 + k, seen_h=F.CONTROL_HOURS + 30) for k in range(5)]
    c = site([_row(1, mc=2, seen_h=F.CONTROL_HOURS + 90)] + stale, lambda ad, n: "gone")
    st = F.run_site("testsite", shadow=False)
    assert st["quarantined"].startswith("opening") and st["probed"] == 0
    assert not [e for e in c.log if e[0] in ("update", "insert")]


def test_failed_closing_controls_write_no_strike_or_hide_but_keep_live_stamps(site):
    # 5 opening controls live, then every later read (worklist + closing controls) says gone,
    # except A2 which is live.
    c = site([_row(1, mc=2), _row(2)] + _controls(),
             lambda ad, n: "live" if n <= 5 or ad == "A2" else "gone")
    st = F.run_site("testsite", shadow=False)
    assert st["quarantined"].startswith("closing") and st["hidden"] == st["struck"] == 0
    assert all("active" not in u and "missing_count" not in u for u in _updates(c, 1))
    assert _updates(c, 2)[-1]["last_verified_alive_at"]
    assert not [e for e in c.log if e[0] == "insert"]


def test_more_hides_than_the_cap_hide_nothing(site):
    rows = [_row(i, mc=2) for i in range(1, 6)] + _controls()       # 10 active → cap 3
    c = site(rows, {f"A{i}": "gone" for i in range(1, 6)})
    st = F.run_site("testsite", shadow=False)
    assert "cap" in st["quarantined"] and st["hidden"] == 0
    assert not [u for i in range(1, 6) for u in _updates(c, i) if "active" in u or "missing_count" in u]


def test_a_site_outside_apply_is_shadow_and_writes_nothing(site):
    c = site([_row(1, mc=2)] + _controls(), {"A1": "gone"}, apply=False)
    st = F.run_site("testsite", shadow=False)
    assert st["shadow"] and len(st["would_hide"]) == 1
    assert not [e for e in c.log if e[0] in ("update", "insert")]


def test_struck_rows_are_read_first_across_both_tables(site):
    rows = [_row(i) for i in range(1, 40)]
    seen = []
    c = site(rows, lambda ad, n: seen.append(ad) or "live")
    c.rows["testsite_commercial_listings"] = [_row(40, mc=2)]      # the struck row, in the other table
    F.run_site("testsite", shadow=True)
    assert seen[5] == "A40", "after the 5 opening controls, the struck row is the first one read"

def test_every_site_resolves_to_its_scrapers_own_oracle():
    for site, spec in F.SITES.items():
        assert spec.startswith(f"scrapers.{site}.run:"), site
        assert callable(F.oracle_for(spec, None)), site
        assert callable(F.oracle_for(spec, {"ad_number": "X1", "listing_url": "https://x/1"})), site


def test_a_factory_oracle_is_built_from_the_sites_freshest_control(monkeypatch):
    import types
    got = {}
    mod = types.ModuleType("fake_site_run")
    mod.make = lambda control: got.setdefault("control", control) and (lambda ad: ("live", ""))
    monkeypatch.setitem(__import__("sys").modules, "fake_site_run", mod)
    assert callable(F.oracle_for("fake_site_run:make()", {"ad_number": "C1"}))
    assert got["control"] == {"ad_number": "C1"}
    assert F.oracle_for("fake_site_run:make", None) is mod.make      # no () → the callable itself


def test_a_site_out_of_time_says_how_much_it_covered(site, monkeypatch):
    rows = [_row(i) for i in range(1, 11)]
    site(rows, {})
    monkeypatch.setattr(F, "BUDGET_S", -1)
    st = F.run_site("testsite", shadow=True)
    assert st["probed"] == 0 and st["covered"] == 0.0


def test_read_maps_anything_but_gone_or_live_to_unknown():
    assert F.read(lambda a: ("gone", "x"), "A")[0] == F.DEAD
    assert F.read(lambda a: ("live", "x"), "A")[0] == F.ALIVE
    assert F.read(lambda a: ("unknown", "x"), "A")[0] == F.UNKNOWN
    assert F.read(lambda a: 1 / 0, "A")[0] == F.UNKNOWN


def test_every_active_row_is_read_every_run_like_aqar(site):
    rows = [_row(i) for i in range(1, 60)]
    seen = []
    site(rows, lambda ad, n: seen.append(ad) or "live")
    F.run_site("testsite", shadow=True)
    assert {f"A{i}" for i in range(1, 60)} <= set(seen[5:]), "aqar's window: every live row, daily"


def test_every_site_that_writes_is_declared_daily_direct_and_nothing_else_writes():
    from scrapers.common import liveness_policies as LP
    assert F.APPLY == frozenset(LP.FLEET_DAILY_DIRECT) and F.APPLY <= set(F.SITES)
    for p in F.APPLY:
        assert LP.strategy_for(p) == LP.DIRECT_REVISIT, p
        assert LP.policy_for(p).max_verification_age_hours == 48 and LP.policy_for(p).grace == 3, p


def test_pace_is_a_rate_not_a_pause_added_to_every_read(site, monkeypatch):
    """At most one read per PACE_S. A read slower than PACE_S waits for nothing; a fast one waits only
    the rest of its second (2026-09-29: rakez's 1.42 s/read was 0.42 s of reading + 1 s of sleep)."""
    clock = {"t": 0.0}
    slept = []
    monkeypatch.setattr(F, "time", types.SimpleNamespace(
        monotonic=lambda: clock["t"],
        sleep=lambda s: (slept.append(round(s, 3)), clock.__setitem__("t", clock["t"] + s))))
    durations = iter([2.0, 0.25] + [0.0] * 100)

    def answers(ad, n):
        if n > 5:      # the 5 opening controls are not paced
            clock["t"] += next(durations)
        return "live"
    site(_controls() + [_row(1), _row(2), _row(3)], answers)
    monkeypatch.setattr(F, "PACE_S", 1.0)
    F.run_site("testsite", shadow=True)
    assert slept[:3] == [0.0, 0.0, 0.75], slept


def test_a_run_cut_short_keeps_the_live_stamps_it_already_earned(site, monkeypatch):
    # 2026-10-02: six jobs were cancelled mid-run; every write waited for the end, so dwelleo lost
    # 37 minutes of reads and stayed at 0% checked.
    monkeypatch.setattr(F, "FLUSH", 2)

    def answers(ad, n):
        if n == 5 + 4:                      # 5 opening controls, then the 4th row: the job is killed
            raise KeyboardInterrupt
        return "live"
    c = site([_row(i, mc=1) for i in range(1, 6)] + _controls(), answers)
    with pytest.raises(KeyboardInterrupt):
        F.run_site("testsite", shadow=False)
    stamped = [i for i in range(1, 6) if any(u.get("last_verified_alive_at") for u in _updates(c, i))]
    assert len(stamped) == 2, "the reads made before the kill are written, in FLUSH-sized steps"


def test_the_reading_budget_fits_inside_the_jobs_own_ceiling():
    import re
    from pathlib import Path
    yml = (Path(__file__).resolve().parents[3] / ".github/workflows/fleet-liveness.yml").read_text()
    ceiling = int(re.search(r"timeout-minutes: (\d+)", yml).group(1))
    assert F.BUDGET_S / 60 + 20 <= ceiling <= 360, "the reader must stop itself before GitHub kills it"
    # dwelleo, the largest site here: every ad inside its 48 h window needs half of it a day.
    assert F.BUDGET_S / 1.6 >= 11_137


def _probed_ago(i, mc, hours):
    return dict(_row(i, mc=mc), last_liveness_probe_at=(NOW - timedelta(hours=hours)).isoformat())


def test_the_recheck_reads_only_rested_struck_rows_and_hides_at_the_third_gone(site):
    # A removed ad must not wait three daily runs: the recheck gives a struck row its next reading.
    seen = []
    rows = [_probed_ago(1, 2, 8), _probed_ago(2, 1, 8), _probed_ago(3, 1, 1), _row(4)] + _controls()
    c = site(rows, lambda ad, n: seen.append(ad) or ("gone" if ad in ("A1", "A2", "A3") else "live"))
    st = F.run_site("testsite", shadow=False, struck_only=True)
    assert sorted(seen[5:-5]) == ["A1", "A2"], "A3 was read an hour ago, A4 carries no strike"
    assert st["hidden"] == 1 and st["struck"] == 1 and st["covered"] == 100.0
    assert _updates(c, 1)[-1]["active"] is False and _updates(c, 2)[-1]["missing_count"] == 2
    assert not _updates(c, 3) and not _updates(c, 4)


def test_the_recheck_clears_a_strike_that_was_a_blip(site):
    c = site([_probed_ago(1, 2, 8)] + _controls(), {})
    F.run_site("testsite", shadow=False, struck_only=True)
    assert _updates(c, 1)[-1]["missing_count"] == 0 and _updates(c, 1)[-1]["last_verified_alive_at"]


def test_the_recheck_leaves_a_site_with_no_struck_row_alone(site, monkeypatch):
    c = site([_row(1)] + _controls(), lambda ad, n: pytest.fail("nothing to read"))
    monkeypatch.setattr(F, "begin_run", lambda name: pytest.fail("no run row for a site left alone"))
    assert F.run_site("testsite", shadow=False, struck_only=True)["skipped"]
    assert not c.log


def test_the_recheck_is_scheduled_clear_of_the_daily_run_and_shares_its_lock():
    import re
    from pathlib import Path
    wf = Path(__file__).resolve().parents[3] / ".github/workflows"
    recheck = (wf / "fleet-liveness-recheck.yml").read_text()
    assert "--struck-only" in recheck
    group = re.search(r"concurrency:\n  group: (\S+)", (wf / "fleet-liveness.yml").read_text()).group(1)
    assert f"group: {group}" in recheck, "the daily run and the recheck must never write at once"
