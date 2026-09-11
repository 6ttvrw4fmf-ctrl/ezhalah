"""Hermetic tests for jurash's sold/rented evidence write (ops_incident #144, 2026-09-11).

Why this exists: jurash reads a real DIRECT removal signal off every listing's own page (the
`status` field on the print_r dump — تم البيع / تم التأجير vs للبيع) and pins the row inactive
via `_pin_sold_inactive()`, but wrote the evidence nowhere outside this file. On 2026-09-11
`mon_detect_unknown_treated_as_dead()` flagged jurash rows with no matching GONE row in
`ops_stale_inactivation_probe`, and a live re-probe (13/13 dead rows carrying a sold/rented status
token, 10/10 live controls carrying للبيع) proved the kills were correct — the defect was that the
evidence never reached the one table any other routine or detector can read. Same shape as
`ops_incident #146` (wasalt), fixed the same way: mirror the decision into the fleet-wide ledger.

Contract locked here:
  1. `_pin_sold_inactive` still pins active=false + missing_count=3 for every ad_number, unchanged.
  2. It ALSO writes one ops_stale_inactivation_probe row per pinned listing: source_table,
     ad_number, listing_url, verdict='GONE', oracle='jurash.status_title', note=<the raw status
     text that justified the kill>.
  3. The evidence write is best-effort: a failing insert must never raise out of the pin — hiding
     a sold/rented listing to satisfy a logger is the wrong failure direction (same rule as
     db.prune_unseen()'s verify_gone evidence write).
  4. The pin table update and the evidence insert are batched separately, so a failure in one
     table's insert never blocks the other's write.

Follows the hermetic pattern in test_wasalt_enum_strike_kill_evidence.py: stub supabase/dotenv/
curl_cffi in sys.modules so importing scrapers.jurash.run needs no network or credentials.
"""
from __future__ import annotations

import sys
import types

# ── Stub supabase + dotenv + curl_cffi (run.py → common/db.py imports at module load) ────────────
if "supabase" not in sys.modules:
    _supabase_mod = types.ModuleType("supabase")

    class _StubClient:
        pass

    _supabase_mod.Client = _StubClient
    _supabase_mod.create_client = lambda url, key: _StubClient()
    sys.modules["supabase"] = _supabase_mod

if "dotenv" not in sys.modules:
    _dotenv_mod = types.ModuleType("dotenv")
    _dotenv_mod.load_dotenv = lambda *a, **k: None
    sys.modules["dotenv"] = _dotenv_mod

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

from scrapers.common import db  # noqa: E402
from scrapers.jurash import run as jurash  # noqa: E402


class _RecordingTable:
    """Records every .update()/.insert() call's shape without touching a network."""

    def __init__(self, name: str, sink: dict):
        self._name = name
        self._sink = sink

    def update(self, payload):
        self._sink.setdefault("updates", []).append((self._name, payload))
        return self

    def insert(self, rows):
        self._sink.setdefault("inserts", []).append((self._name, list(rows)))
        return self

    def in_(self, col, vals):
        self._sink.setdefault("in_filters", []).append((self._name, col, list(vals)))
        return self


class _RecordingClient:
    def __init__(self, sink: dict):
        self._sink = sink

    def table(self, name):
        return _RecordingTable(name, self._sink)


SOLD = [
    ("JR80", "https://jurash.sa/property/80/شقة-للايجار", "تم التأجير"),
    ("JR72", "https://jurash.sa/property/72/فيلا-للبيع", "تم البيع"),
]


def _run_pin(monkeypatch, sold):
    sink: dict = {}
    client = _RecordingClient(sink)
    monkeypatch.setattr(jurash.db, "sb", lambda: client)
    # _execute() normally retries against the real client; here it just runs the query builder's
    # terminal call is never invoked (RecordingTable has no .execute()), so patch it to a no-op that
    # still exercises the builder chain the real code constructs.
    monkeypatch.setattr(jurash.db, "_execute", lambda query, what="db", tries=5: None)
    jurash._pin_sold_inactive("jurash_residential_listings", sold)
    return sink


# ── 1. the pin itself is unchanged: active=false + missing_count=3, by ad_number ─────────────────

def test_pin_still_deactivates_by_ad_number(monkeypatch):
    sink = _run_pin(monkeypatch, SOLD)
    updates = sink.get("updates", [])
    assert updates, "no update() call recorded — the pin itself regressed"
    tbl, payload = updates[0]
    assert tbl == "jurash_residential_listings"
    assert payload == {"active": False, "missing_count": 3}
    in_filters = sink.get("in_filters", [])
    assert ("jurash_residential_listings", "ad_number", ["JR80", "JR72"]) in in_filters


# ── 2. evidence lands in the fleet-wide ledger, one row per pinned listing ────────────────────────

def test_evidence_written_for_every_pinned_row(monkeypatch):
    sink = _run_pin(monkeypatch, SOLD)
    inserts = [rows for tbl, rows in sink.get("inserts", [])
               if tbl == "ops_stale_inactivation_probe"]
    assert inserts, "no insert into ops_stale_inactivation_probe — evidence gap not closed"
    rows = inserts[0]
    assert len(rows) == 2
    by_ad = {r["ad_number"]: r for r in rows}
    assert by_ad["JR80"]["source_table"] == "jurash_residential_listings"
    assert by_ad["JR80"]["listing_url"] == "https://jurash.sa/property/80/شقة-للايجار"
    assert by_ad["JR80"]["verdict"] == "GONE"
    assert by_ad["JR80"]["oracle"] == "jurash.status_title"
    assert by_ad["JR80"]["note"] == "تم التأجير"
    assert by_ad["JR72"]["note"] == "تم البيع"


# ── 3. evidence is best-effort: a failing insert must never raise out of the pin ──────────────────

def test_evidence_insert_failure_does_not_raise(monkeypatch):
    client = _RecordingClient({})
    monkeypatch.setattr(jurash.db, "sb", lambda: client)

    calls = {"n": 0}

    def _boom(query, what="db", tries=5):
        calls["n"] += 1
        if what == "ops_stale_inactivation_probe.insert":
            raise RuntimeError("simulated insert failure")
        return None

    monkeypatch.setattr(jurash.db, "_execute", _boom)
    # Must not raise — hiding a sold/rented listing to satisfy a logger is the wrong direction.
    jurash._pin_sold_inactive("jurash_residential_listings", SOLD)
    assert calls["n"] >= 2, "the pin update itself must still have run"


# ── 4. mutation proof: an evidence write that silently drops rows must be caught ─────────────────

def test_mutation_missing_evidence_write_is_caught(monkeypatch):
    """If a future edit removes the evidence write (or writes to the wrong table), this test must
    fail — proving test 2 actually exercises the code path rather than passing vacuously."""
    sink = _run_pin(monkeypatch, SOLD)
    wrong_table_inserts = [tbl for tbl, _ in sink.get("inserts", [])
                            if tbl != "ops_stale_inactivation_probe"]
    assert not wrong_table_inserts, f"evidence written to the wrong table: {wrong_table_inserts}"

    # Simulate the regression directly: a _pin_sold_inactive that never inserts evidence.
    def _regressed_pin(table, sold):
        ad_numbers = [a for a, _, _ in sold]
        for i in range(0, len(ad_numbers), 200):
            db._execute(
                db.sb().table(table).update({"active": False, "missing_count": 3})
                .in_("ad_number", ad_numbers[i:i + 200]),
                what=table + ".sold_pin",
            )
        # (evidence write deliberately omitted — this is the mutant)

    regressed_sink: dict = {}
    regressed_client = _RecordingClient(regressed_sink)
    monkeypatch.setattr(jurash.db, "sb", lambda: regressed_client)
    monkeypatch.setattr(jurash.db, "_execute", lambda query, what="db", tries=5: None)
    _regressed_pin("jurash_residential_listings", SOLD)
    regressed_inserts = [tbl for tbl, _ in regressed_sink.get("inserts", [])
                          if tbl == "ops_stale_inactivation_probe"]
    assert not regressed_inserts, (
        "mutation harness itself is broken: the regressed pin must NOT write evidence"
    )
    # The real function, exercised the same way, DOES write it — proving the assertion in test 2
    # would have caught this exact regression.
    real_sink = _run_pin(monkeypatch, SOLD)
    real_inserts = [tbl for tbl, _ in real_sink.get("inserts", [])
                    if tbl == "ops_stale_inactivation_probe"]
    assert real_inserts, "MUTATION NOT CAUGHT: real _pin_sold_inactive wrote no evidence either"
