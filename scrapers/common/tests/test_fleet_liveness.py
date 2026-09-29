"""Daily DIRECT liveness for the small sites (scrapers/common/fleet_liveness.py). What must hold:
UNKNOWN writes nothing but "we looked"; three DIRECT 'gone' answers hide, each hide with its
evidence row written first; a live answer clears strikes and stamps last_verified_alive_at; failed
known-live controls or a hide count over the cap write no strike and no hide; a site outside APPLY
(shadow) writes nothing at all. Fake PostgREST, fake oracle, no network."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

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


def test_a_row_its_crawl_proved_alive_today_is_covered_not_reread(site):
    # dwelleo, 2026-09-29: its crawl reads every ad's own record daily (11k), the fleet check reached
    # 30% in its budget re-reading them. A fresh direct proof counts; a strike or a stale proof does not.
    def v(r, hours):
        return dict(r, last_verified_alive_at=(NOW - timedelta(hours=hours)).isoformat())
    rows = [v(_row(1), 2), v(_row(2, mc=1), 2), v(_row(3), F.FRESH_HOURS + 6), _row(4)]
    seen = []
    site(rows + _controls(), lambda ad, n: seen.append(ad) or "live")
    st = F.run_site("testsite", shadow=True)
    assert "A1" not in seen and {"A2", "A3", "A4"} <= set(seen)
    assert st["fresh"] >= 1 and st["covered"] == 100.0


def test_a_quarantine_says_why_the_controls_failed(site):
    site([_row(1)] + _controls(), lambda ad, n: "unknown")
    st = F.run_site("testsite", shadow=True)
    assert "test says unknown" in st["quarantined"]
