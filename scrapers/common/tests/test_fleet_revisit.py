"""scrapers/common/fleet_revisit.py may prove listings alive and may never remove or strike one.

Executes the real revisit() against a recording stub DB, the real discover() against the tree, and
the real goldendeal hook through LivenessProbe.fetch (http_liveness's documented test seam).
"""
from __future__ import annotations

import ast
import json
from pathlib import Path

import pytest

from scrapers.common import db, fleet_revisit as F, http_liveness


class _Q:
    def __init__(self, log, table):
        self.log, self.table, self.payload, self.filters = log, table, None, []

    def update(self, payload):
        self.payload = payload
        return self

    def in_(self, col, vals):
        self.filters.append(("in", col, tuple(vals)))
        return self

    def eq(self, col, val):
        self.filters.append(("eq", col, val))
        return self


class _SB:
    def __init__(self, log):
        self.log = log

    def table(self, t):
        q = _Q(self.log, t)
        self.log.append(q)
        return q


@pytest.fixture
def recorder(monkeypatch):
    log: list[_Q] = []
    monkeypatch.setattr(db, "sb", lambda: _SB(log))
    monkeypatch.setattr(db, "_execute", lambda q, **_k: q)
    return log


def _verify_from(verdicts):
    def v(ad):
        out = verdicts[ad]
        if isinstance(out, Exception):
            raise out
        return out, "test"
    return v


def test_live_stamps_through_the_contract_and_only_on_active_rows(recorder):
    work = [("x_residential_listings", "A1"), ("x_residential_listings", "A2")]
    t = F.revisit("x", _verify_from({"A1": "live", "A2": "unknown"}), work)
    assert t == {"checked": 2, "live": 1, "gone": 0, "unknown": 1, "stamped": 1}
    stamps = [q for q in recorder if q.payload and "last_verified_alive_at" in q.payload]
    assert len(stamps) == 1 and set(stamps[0].payload) == {"last_verified_alive_at"}
    assert ("in", "ad_number", ("A1",)) in stamps[0].filters
    assert ("eq", "active", True) in stamps[0].filters, "must never stamp a row deactivated meanwhile"


def test_gone_and_unknown_only_record_that_we_looked(recorder):
    work = [("x_commercial_listings", "G1"), ("x_commercial_listings", "U1"), ("x_commercial_listings", "E1")]
    t = F.revisit("x", _verify_from({"G1": "gone", "U1": "maybe", "E1": RuntimeError("boom")}), work)
    assert t["gone"] == 1 and t["unknown"] == 2 and t["stamped"] == 0
    for q in recorder:
        assert q.payload is None or set(q.payload) == {"last_liveness_probe_at"}, q.payload


def test_dry_run_writes_nothing(recorder):
    F.revisit("x", _verify_from({"A1": "live"}), [("x_residential_listings", "A1")], dry_run=True)
    assert not [q for q in recorder if q.payload]


def test_the_module_never_writes_active_strikes_or_crawler_presence():
    tree = ast.parse(Path(F.__file__).read_text("utf-8"))
    forbidden = {"active", "missing_count", "last_seen_at"}
    for node in ast.walk(tree):
        if isinstance(node, ast.Dict):
            keys = {k.value for k in node.keys if isinstance(k, ast.Constant)}
            assert not keys & forbidden, f"fleet_revisit writes {keys & forbidden}"


def test_discover_finds_hooks_by_shape():
    found = F.discover()
    assert "goldendeal" in found and "yameen" in found
    for p in found:
        assert "def revisit_verify()" in (F.ROOT / p / "run.py").read_text("utf-8")


# ── the goldendeal hook: its real oracle, unable to say 'gone' ───────────────────────────────────
from scrapers.goldendeal import run as G  # noqa: E402


def _probe_answers(monkeypatch, status, body):
    monkeypatch.setattr(http_liveness.LivenessProbe, "fetch", lambda self, url: (status, body, False))
    monkeypatch.setattr(http_liveness.time, "sleep", lambda *_: None, raising=False)


def test_goldendeal_hook_reads_a_live_echo_as_live(monkeypatch):
    _probe_answers(monkeypatch, 200, json.dumps({"data": {"id": 777, "availability_status": "available"}}))
    assert G.revisit_verify()("GDL777")[0] == "live"


def test_goldendeal_hook_never_returns_gone(monkeypatch):
    _probe_answers(monkeypatch, 404, G._NOT_FOUND)
    assert G.revisit_verify()("GDL777")[0] == "unknown"
    _probe_answers(monkeypatch, 200, json.dumps({"data": {"id": 777, "availability_status": "sold"}}))
    assert G.revisit_verify()("GDL777")[0] == "unknown"


def test_goldendeal_hook_ignores_another_listings_echo(monkeypatch):
    _probe_answers(monkeypatch, 200, json.dumps({"data": {"id": 999, "availability_status": "available"}}))
    assert G.revisit_verify()("GDL777")[0] != "live"
