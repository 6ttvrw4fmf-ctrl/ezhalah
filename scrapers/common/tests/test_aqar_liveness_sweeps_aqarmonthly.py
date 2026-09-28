"""Aqar Monthly gets aqar's daily liveness sweep (owner, 2026-09-28: «Aqar Monthly must work like
Aqar»). Its ads are sa.aqar.fm pages, so it is the SAME sweep — scrapers/aqar/liveness.py main() —
run over aqarmonthly_residential_listings: 404 → strike, three strikes → hidden, a live page →
strikes cleared and last_verified_alive_at stamped, no answer → nothing written, and every strike
or kill leaves its evidence row. Drives the real main() against a fake PostgREST; no network."""
from __future__ import annotations

import sys

import pytest

import scrapers.aqar.liveness as L

TABLE = "aqarmonthly_residential_listings"


class _Res:
    def __init__(self, data):
        self.data = data


class _Q:
    def __init__(self, c, t):
        self.c, self.t, self.f, self.op, self.n = c, t, [], None, None

    def select(self, *a, **k): return self
    def order(self, *a, **k): return self
    def limit(self, n): self.n = n; return self
    def eq(self, col, v): self.f.append(lambda r: r.get(col) == v); return self
    def gte(self, col, v): self.f.append(lambda r: (r.get(col) or 0) >= v); return self
    def gt(self, col, v): self.f.append(lambda r: r.get(col) > v); return self
    def in_(self, col, vals):
        vs = set(vals)
        self.f.append(lambda r: r.get(col) in vs)
        return self
    def update(self, p): self.op = ("update", p); return self
    def insert(self, p): self.op = ("insert", p); return self

    def execute(self):
        if self.op and self.op[0] == "insert":
            self.c.inserted.setdefault(self.t, []).extend(self.op[1])
            return _Res([])
        rows = [r for r in self.c.rows.get(self.t, []) if all(f(r) for f in self.f)]
        if self.op and self.op[0] == "update":
            for r in rows:
                r.update(self.op[1])
            return _Res([])
        rows = sorted(rows, key=lambda r: r["id"])[: self.n or None]
        return _Res([dict(r) for r in rows])


class _Client:
    def __init__(self, rows):
        self.rows, self.inserted = rows, {}

    def table(self, t): return _Q(self, t)


class _Resp:
    def __init__(self, status, text=""):
        self.status_code, self.text = status, text


def _row(i, url, mc=0):
    return {"id": i, "ad_number": f"AQM{i}", "listing_url": url, "missing_count": mc, "active": True,
            "transaction_type": "Rent", "price_total": 4000, "area_m2": None, "price_per_meter": None}


@pytest.fixture
def swept(monkeypatch):
    client = _Client({TABLE: [
        _row(1, "https://sa.aqar.fm/gone-1"),            # first 404 → strike 1, still shown
        _row(2, "https://sa.aqar.fm/live-2", mc=2),      # live page → strikes cleared, verified
        _row(3, "https://sa.aqar.fm/gone-3", mc=2),      # third 404 → hidden
        _row(4, "https://sa.aqar.fm/blocked-4", mc=1),   # no answer → untouched
    ]})
    pages = {"gone-1": _Resp(404), "live-2": _Resp(200, "<html><h1>شقة للإيجار الشهري</h1></html>"),
             "gone-3": _Resp(404), "blocked-4": None}
    monkeypatch.setattr(L, "sb", lambda: client)
    monkeypatch.setattr(L, "begin_run", lambda name: client.inserted.setdefault("run", []).append(name) or 1)
    monkeypatch.setattr(L, "end_run", lambda *a, **k: True)
    monkeypatch.setattr(L, "reconcile_orphaned_stubs", lambda *a, **k: 0)
    monkeypatch.setattr(L, "get", lambda url, **k: pages[url.rsplit("/", 1)[1]])
    monkeypatch.setattr(sys, "argv", ["liveness", "--table", TABLE, "--shards", "1", "--shard", "0"])
    L.main()
    return {r["id"]: r for r in client.rows[TABLE]}, client


def test_aqarmonthly_is_an_accepted_table_of_the_same_sweep(swept):
    _, client = swept
    assert client.inserted["run"] == [f"aqar_liveness:{TABLE}:0/1"]


def test_a_404_strikes_and_the_third_one_hides(swept):
    rows, _ = swept
    assert rows[1]["missing_count"] == 1 and rows[1]["active"] is True
    assert rows[3]["missing_count"] == 3 and rows[3]["active"] is False


def test_a_live_page_clears_strikes_and_stamps_verification(swept):
    rows, _ = swept
    assert rows[2]["missing_count"] == 0 and rows[2]["active"] is True
    assert rows[2].get("last_verified_alive_at")


def test_no_answer_writes_nothing(swept):
    rows, _ = swept
    assert rows[4]["missing_count"] == 1 and rows[4]["active"] is True
    assert "last_verified_alive_at" not in rows[4]


def test_every_strike_and_kill_keeps_its_evidence_row(swept):
    _, client = swept
    ev = {(e["listing_id"], e["verdict"]) for e in client.inserted.get("aqar_liveness_detail", [])}
    assert {(1, "strike"), (3, "kill"), (4, "transient")} <= ev
    assert all(e["source_table"] == TABLE for e in client.inserted["aqar_liveness_detail"])


def test_monthly_rents_are_never_price_refreshed(swept):
    rows, _ = swept
    assert all(r["price_total"] == 4000 for r in rows.values())
