"""Hermetic tests for the enum-strike per-row kill evidence (2026-08-03).

Why this exists: `enum-strike` inactivates ~1.2-1.5k Wasalt rows per run but persisted only the
AGGREGATE counts in `wasalt_liveness_runs`. When the daily listing-count check flagged the rising
kill rate on 2026-08-03, "were those 1,200 kills correct?" could not be answered from our own data
at all — it took re-fetching wasalt's own sitemap as an outside oracle to prove 1200/1200 were
genuinely gone. `check_hybrid` already computed the deciding status per row and threw it away.

Contract locked here:
  1. check_hybrid carries head_status AND get_status out, not just the verdict — a 404 and a
     200-without-propertyDetailsV3 are different evidence for the same 'dead' verdict.
  2. A HEAD-200 short-circuit reports get_status=None (no GET ran) — the body was never read, so
     has_property_details is UNKNOWN (None), never False. Recording False there would fabricate
     evidence for a check that never happened.
  3. The evidence write is best-effort: a failing audit-log insert must never break a liveness run
     (hiding a live listing to satisfy a logger is the wrong failure direction).

Follows the hermetic pattern in test_aqar_liveness_sharding.py: stub supabase/dotenv in sys.modules
so importing the module needs no network or credentials.
"""
from __future__ import annotations

import sys
import types

# ── Stub supabase + dotenv (liveness.py → common/db.py imports both at module load) ──────────────
_supabase_mod = types.ModuleType("supabase")


class _StubClient:
    pass


_supabase_mod.Client = _StubClient
_supabase_mod.create_client = lambda url, key: _StubClient()
sys.modules.setdefault("supabase", _supabase_mod)

_dotenv_mod = types.ModuleType("dotenv")
_dotenv_mod.load_dotenv = lambda *a, **k: None
sys.modules.setdefault("dotenv", _dotenv_mod)

# curl_cffi is a real runtime dep of liveness.py; stub it so the test needs no network stack.
if "curl_cffi" not in sys.modules:
    _cc_mod = types.ModuleType("curl_cffi")
    _req_mod = types.ModuleType("curl_cffi.requests")

    class _StubSession:
        def __init__(self, *a, **k):
            self.headers = {}
            self.proxies = {}

    _req_mod.Session = _StubSession
    _cc_mod.requests = _req_mod
    sys.modules["curl_cffi"] = _cc_mod
    sys.modules["curl_cffi.requests"] = _req_mod

from scrapers.wasalt import liveness  # noqa: E402


ROW = ("wasalt_residential_listings", 4450679, "https://wasalt.sa/en/property/x-5889160", 2)


def _detail_row(res):
    """Rebuild the dict run_enum_strike() records, from check_hybrid's return tuple."""
    tbl, lid, _cur, verdict, used_get, nbytes, hc, gc = res
    return {
        "tbl": tbl, "listing_id": lid, "head_status": hc, "get_status": gc,
        "get_verdict": verdict, "nbytes": nbytes,
        "has_property_details": (verdict == "live") if used_get else None,
    }


# ── 1. the deciding status survives, for every verdict ──────────────────────────────────────────

def test_head_200_shortcircuit_records_no_get_status(monkeypatch):
    """HEAD 200 → live without a GET. get_status must be None and has_property_details UNKNOWN."""
    monkeypatch.setattr(liveness, "head_status", lambda url, tries=3: 200)
    monkeypatch.setattr(liveness, "get_verdict", lambda url, tries=3: (_ for _ in ()).throw(
        AssertionError("GET must not run after a HEAD 200")))
    res = liveness.check_hybrid(ROW)
    assert len(res) == 8, "check_hybrid must carry head_status + get_status out"
    d = _detail_row(res)
    assert d["get_verdict"] == "live"
    assert d["head_status"] == 200
    assert d["get_status"] is None
    assert d["has_property_details"] is None, "no GET ran — unknown, not False"


def test_get_404_records_the_404_as_the_kill_evidence(monkeypatch):
    monkeypatch.setattr(liveness, "head_status", lambda url, tries=3: 404)
    monkeypatch.setattr(liveness, "get_verdict", lambda url, tries=3: ("dead", 404, 1200))
    d = _detail_row(liveness.check_hybrid(ROW))
    assert (d["get_verdict"], d["head_status"], d["get_status"]) == ("dead", 404, 404)
    assert d["has_property_details"] is False
    assert d["nbytes"] == 1200


def test_get_200_without_property_details_is_distinguishable_from_a_404(monkeypatch):
    """Both verdicts are 'dead'; only get_status separates 'removed' from 'placeholder page'.
    Collapsing them would erase the difference the evidence exists to preserve."""
    monkeypatch.setattr(liveness, "head_status", lambda url, tries=3: 500)
    monkeypatch.setattr(liveness, "get_verdict", lambda url, tries=3: ("dead", 200, 210_000))
    d = _detail_row(liveness.check_hybrid(ROW))
    assert d["get_verdict"] == "dead" and d["get_status"] == 200
    assert d["has_property_details"] is False


def test_transient_failure_is_recorded_as_failed_never_dead(monkeypatch):
    """A 403 challenge / timeout must stay 'failed' — the row is untouched upstream, and the log
    must say so rather than implying a death."""
    monkeypatch.setattr(liveness, "head_status", lambda url, tries=3: None)
    monkeypatch.setattr(liveness, "get_verdict", lambda url, tries=3: ("failed", 403, 0))
    d = _detail_row(liveness.check_hybrid(ROW))
    assert d["get_verdict"] == "failed"
    assert d["has_property_details"] is False or d["has_property_details"] is None
    assert d["get_verdict"] != "dead"


# ── 2. the audit log must never break the lifecycle ─────────────────────────────────────────────

def test_flush_detail_swallows_db_errors(monkeypatch, capsys):
    """A failing evidence write must not raise: losing a log line is recoverable, aborting a
    liveness run mid-flight (or crashing after rows were already flipped) is not."""
    def _boom(*a, **k):
        raise RuntimeError("PostgREST 500 schema cache")

    monkeypatch.setattr(liveness.db, "_execute", _boom)
    monkeypatch.setattr(liveness.db, "sb", lambda: _StubTable())
    liveness._flush_detail([{"tbl": "t", "listing_id": 1, "get_verdict": "dead"}])
    assert "non-fatal" in capsys.readouterr().out


def test_flush_detail_batches_large_cohorts(monkeypatch):
    """A full 1500-row cohort must go out in bounded chunks, not one oversized request."""
    sizes: list[int] = []
    monkeypatch.setattr(liveness.db, "sb", lambda: _StubTable(sizes))
    monkeypatch.setattr(liveness.db, "_execute", lambda q, what="db": None)
    liveness._flush_detail([{"tbl": "t", "listing_id": i, "get_verdict": "dead"} for i in range(1500)])
    assert sizes == [500, 500, 500]


class _StubTable:
    """Minimal db.sb() stand-in: .table(name).insert(rows) records the batch size."""

    def __init__(self, sizes=None):
        self._sizes = sizes

    def table(self, _name):
        return self

    def insert(self, rows):
        if self._sizes is not None:
            self._sizes.append(len(rows))
        return self
