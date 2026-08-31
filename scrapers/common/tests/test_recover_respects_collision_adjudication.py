"""Hermetic contract for scrapers/dealapp/recover.py's recovery-protection guard.

THE DEFECT THIS CLOSES (found live 2026-08-31, one night after the collision repair).
The 2026-08-30 run repaired 8 res/com URL collisions and taught the SQL recovery path
auto_recover_false_inactive() not to undo them, via a `not exists (… ops_adjudicated_listing …)`
clause. It did not touch the OTHER recovery path. `dealapp_recover` run 38444 (03:20 UTC,
`recovered=2`) fetched the live ad pages of DA499170 and DA549199, got 'live' for both, and set
active=true — restoring exactly the two duplicate Normal Filter cards the repair had removed.

WHY THE ORACLE IS THE WRONG TOOL, not a broken one. `_classify` answers "is this URL still live on
the source?". A res/com collision is two of OUR rows sharing ONE source URL, so the honest answer
for the SUPERSEDED row is also 'live' — the ad really is published, it simply belongs to the
sibling row. No amount of fetching can split them, which is why the guard is a precondition on
which rows may be offered to the oracle at all, never a new verdict.

This mirrors the reasoning already recorded in db.retire_superseded_siblings' docstring for
verify_gone; the bug was that only one of the two recovery paths had learned it.
"""
from __future__ import annotations

import sys
import types

# ── Stub supabase + dotenv (common/db.py imports both at module load) ────────────────────────────
_supabase_mod = types.ModuleType("supabase")


class _StubClient:
    pass


_supabase_mod.Client = _StubClient
_supabase_mod.create_client = lambda url, key: _StubClient()
sys.modules.setdefault("supabase", _supabase_mod)

_dotenv_mod = types.ModuleType("dotenv")
_dotenv_mod.load_dotenv = lambda *a, **k: None
sys.modules.setdefault("dotenv", _dotenv_mod)

import pathlib  # noqa: E402

RES = "dealapp_residential_listings"
COM = "dealapp_commercial_listings"


# ── A tiny in-memory PostgREST stand-in ──────────────────────────────────────────────────────────
class _Resp:
    def __init__(self, data):
        self.data = data


class _Query:
    def __init__(self, table, store):
        self._t, self._store = table, store
        self._ads = None
        self._active = None
        self._tbl_eq = None

    def select(self, *_a, **_k):
        return self

    def order(self, *_a, **_k):
        return self

    def range(self, *_a, **_k):
        return self

    def in_(self, col, vals):
        assert col == "ad_number"
        self._ads = set(vals)
        return self

    def eq(self, col, val):
        if col == "active":
            self._active = val
        elif col == "tbl":
            self._tbl_eq = val
        return self

    def execute(self):
        rows = list(self._store.get(self._t, []))
        if self._tbl_eq is not None:
            rows = [r for r in rows if r.get("tbl") == self._tbl_eq]
        if self._ads is not None:
            rows = [r for r in rows if r.get("ad_number") in self._ads]
        if self._active is not None:
            rows = [r for r in rows if r.get("active") is self._active]
        return _Resp(rows)


def _client(store):
    class _C:
        def table(self, name):
            return _Query(name, store)
    return _C()


def _load_recover(monkeypatch, store):
    """Import recover.py with its DB + the main scraper's network helpers stubbed out."""
    run_stub = types.ModuleType("scrapers.dealapp.run")
    run_stub._listing_schema = lambda html: None
    run_stub.fetch_one = lambda adid: None
    monkeypatch.setitem(sys.modules, "scrapers.dealapp.run", run_stub)
    sys.modules.pop("scrapers.dealapp.recover", None)
    import importlib
    rec = importlib.import_module("scrapers.dealapp.recover")
    monkeypatch.setattr(rec, "sb", lambda: _client(store))
    return rec


def _base_store(*, res_inactive, com_active, adjudicated=()):
    return {
        RES: [{"id": r["id"], "ad_number": r["ad_number"], "active": False} for r in res_inactive],
        COM: [{"id": 900 + i, "ad_number": ad, "active": True} for i, ad in enumerate(com_active)],
        "ops_adjudicated_listing": [
            {"tbl": RES, "listing_id": lid, "ledger": "res_com_collision"} for lid in adjudicated
        ],
    }


# ── 1. THE LIVE DEFECT: the two rows run 38444 actually reactivated ──────────────────────────────
def test_adjudicated_collision_rows_are_never_offered_to_the_oracle(monkeypatch):
    """DA499170 + DA549199 — retired 2026-08-30 with source evidence, reactivated 2026-08-31."""
    store = _base_store(
        res_inactive=[{"id": 1125932, "ad_number": "DA499170"},
                      {"id": 3045476, "ad_number": "DA549199"}],
        com_active=["DA499170", "DA549199"],
        adjudicated=[1125932, 3045476],
    )
    rec = _load_recover(monkeypatch, store)
    assert rec._inactive_rows(RES, 0) == [], \
        "an adjudicated collision row was handed to the live-page oracle and would be reactivated"


# ── 2. SIBLING-ACTIVE alone protects a collision nobody has adjudicated yet ──────────────────────
def test_sibling_active_row_is_protected_without_any_adjudication(monkeypatch):
    store = _base_store(
        res_inactive=[{"id": 5, "ad_number": "DA777"}],
        com_active=["DA777"],
        adjudicated=[],  # never adjudicated — the structural guard must still hold
    )
    rec = _load_recover(monkeypatch, store)
    assert rec._inactive_rows(RES, 0) == []


# ── 3. THE GUARD MUST NOT OVER-REACH: ordinary false inactivations still recover ─────────────────
def test_ordinary_inactive_row_is_still_offered_for_recovery(monkeypatch):
    """The whole point of this sweep (owner decision 2026-07-21) is age-sweep kills. Keep it."""
    store = _base_store(
        res_inactive=[{"id": 42, "ad_number": "DA123"}],
        com_active=["DA999"],          # a different ad is live commercially — irrelevant
        adjudicated=[7],               # an adjudication about a different row — irrelevant
    )
    rec = _load_recover(monkeypatch, store)
    assert [r["id"] for r in rec._inactive_rows(RES, 0)] == [42]


# ── 4. An adjudication about the SIBLING table must not block this table ─────────────────────────
def test_adjudication_is_scoped_to_its_own_table(monkeypatch):
    store = _base_store(res_inactive=[{"id": 42, "ad_number": "DA123"}], com_active=[])
    store["ops_adjudicated_listing"] = [
        {"tbl": COM, "listing_id": 42, "ledger": "res_com_collision"}
    ]
    rec = _load_recover(monkeypatch, store)
    assert [r["id"] for r in rec._inactive_rows(RES, 0)] == [42]


# ── 5. Protection is applied BEFORE --limit, so it cannot be starved out ─────────────────────────
def test_protected_rows_do_not_consume_limit_slots(monkeypatch):
    """If filtering ran after --limit, a protected row would silently shrink the day's sweep."""
    store = _base_store(
        res_inactive=[{"id": 1, "ad_number": "DAX"}, {"id": 2, "ad_number": "DAY"}],
        com_active=["DAX"],
        adjudicated=[],
    )
    rec = _load_recover(monkeypatch, store)
    assert [r["id"] for r in rec._inactive_rows(RES, 1)] == [2]


# ── 6. MUTATION PROOF — the pre-fix behaviour fails contract 1 ───────────────────────────────────
def test_MUTATION_unguarded_sweep_fails_the_contract(monkeypatch):
    """Reproduce the literal pre-fix `_inactive_rows` (no protection filter) and assert it FAILS.

    Deleting the guard, or neutering `_protected` to return an empty set, can never pass."""
    store = _base_store(
        res_inactive=[{"id": 1125932, "ad_number": "DA499170"},
                      {"id": 3045476, "ad_number": "DA549199"}],
        com_active=["DA499170", "DA549199"],
        adjudicated=[1125932, 3045476],
    )
    rec = _load_recover(monkeypatch, store)
    monkeypatch.setattr(rec, "_protected", lambda table, rows: set())
    leaked = rec._inactive_rows(RES, 0)
    # Both collision orphans reach the oracle, which answers 'live' (the URL IS live) → reactivated.
    assert [r["id"] for r in leaked] == [1125932, 3045476], \
        "expected the pre-fix path to leak both rows — the mutation proof is no longer reproducing"


# ── 7. Both recovery paths must carry the guard — SQL and Python ─────────────────────────────────
def test_sql_recovery_path_also_carries_the_adjudication_guard():
    """The 2026-08-30 fix guarded only auto_recover_false_inactive(); this job undid its work the
    next night. Pin BOTH halves of the net so a future edit cannot orphan one of them again."""
    root = pathlib.Path(__file__).resolve().parents[3]
    src = (root / "scrapers" / "dealapp" / "recover.py").read_text(encoding="utf-8")
    assert "ops_adjudicated_listing" in src, "python recovery path lost its adjudication guard"
    assert "_protected(" in src and "_protected(table, rows)" in src, \
        "recover.py no longer filters candidates through _protected()"

    mig = sorted((root / "supabase" / "migrations").glob("*.sql"))
    guarded = [p for p in mig
               if "auto_recover_false_inactive" in (t := p.read_text(encoding="utf-8"))
               and "ops_adjudicated_listing" in t]
    assert guarded, "no migration defines auto_recover_false_inactive with the adjudication guard"
