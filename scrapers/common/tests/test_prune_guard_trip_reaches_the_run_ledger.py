"""A withheld prune must reach scrape_runs.notes, whatever the caller does with prune_unseen()'s -1.

gathern's prune tripped its coverage guard every day from at least 2026-09-21 to 2026-09-28 (re-saw ~4.4k of
~28k active) and wrote «pruned=0» with ok=true, so mon_detect_enumeration_incomplete() — which watches notes
for «prune guard tripped» — never fired while ~23k listings whose page was 404 stayed in search.
"""
import re
import sys
import types

sys.path.insert(0, ".")
_sb = types.ModuleType("supabase")
_sb.Client = type("Client", (), {})
_sb.create_client = lambda *a, **k: None
sys.modules.setdefault("supabase", _sb)
_de = types.ModuleType("dotenv")
_de.load_dotenv = lambda *a, **k: None
sys.modules.setdefault("dotenv", _de)

import pytest  # noqa: E402

from scrapers.common import db  # noqa: E402

# the detector's own predicate (mon_detect_enumeration_incomplete, notes ~* …)
DETECTOR = re.compile(r"harvest incomplete|enumeration incomplete|prune withheld|prune guard tripped", re.I)


class _Q:
    def __init__(self, sink):
        self.sink = sink

    def __getattr__(self, _name):          # select / eq / limit / … all chain
        return lambda *a, **k: self

    def update(self, payload):
        self.sink.append(payload)
        return self


@pytest.fixture
def ledger(monkeypatch):
    written, active = [], [{"ad_number": str(i), "missing_count": 0} for i in range(100)]
    monkeypatch.setattr(db, "sb", lambda: types.SimpleNamespace(table=lambda _n: _Q(written)))
    monkeypatch.setattr(db, "_execute", lambda q, what="", **k: types.SimpleNamespace(
        data=active if what.endswith("prune_select") else []))
    db._PRUNE_TRIPS.clear()
    return written


def _end(notes="pruned=0"):
    db.end_run(1, ok=True, rows_seen=10, rows_upserted=10, notes=notes)


def test_a_coverage_trip_reaches_the_notes_the_detector_reads(ledger):
    assert db.prune_unseen("x_residential_listings", [str(i) for i in range(75)]) == -1  # 75 % < 80 % floor
    _end()
    notes = ledger[-1]["notes"]
    assert DETECTOR.search(notes) and "x_residential_listings coverage" in notes and "re-saw 75 of 100" in notes


def test_a_collapse_trip_reaches_the_notes_too(ledger):
    assert db.prune_unseen("x_residential_listings", [str(i) for i in range(60)],
                           min_coverage=0.5) == -1                                          # 40 % gone
    _end()
    assert DETECTOR.search(ledger[-1]["notes"]) and "collapse" in ledger[-1]["notes"]


def test_a_healthy_prune_adds_nothing_and_a_trip_is_reported_once(ledger):
    db.prune_unseen("x_residential_listings", [str(i) for i in range(10)])
    _end()
    db.prune_unseen("x_residential_listings", [str(i) for i in range(100)])                  # full coverage
    _end()
    assert not DETECTOR.search(ledger[-1]["notes"])
