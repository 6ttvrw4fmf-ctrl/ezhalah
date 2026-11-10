"""A refused prune's DIRECT READS must reach scrape_runs.notes, so a partial walk with a complete verdict is
told apart from one that leaves stale inventory (2026-11-09).

superoffice respects robots.txt (owner decision 4, 2026-11-03): its server-rendered window can never list the
whole catalogue, so the coverage guard trips on every run — and the run then reads EVERY unseen office's own
page through strike_read_gone(). The notes carried only «prune guard tripped: …», and
mon_detect_enumeration_incomplete() reported «delisted ads are NOT being retired» for a platform whose unseen
rows had all been read. end_run() now appends, per table,
    «unseen read directly: <table> unseen=U read=R gone=G live=L unknown=K unread=U-R»
and the detector raises only when a tripped table has no marker or unread>0.
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

# the detector's two predicates (migration 20261109124506): the trip, and the per-table direct-read marker
TRIP = re.compile(r"prune guard tripped", re.I)
MARKER = re.compile(r"unseen read directly: (\S+) unseen=(\d+) read=(\d+) gone=(\d+) live=(\d+) unknown=(\d+) unread=(\d+)")


class _Q:
    def __init__(self, sink):
        self.sink = sink

    def __getattr__(self, _name):          # select / eq / in_ / limit / … all chain
        return lambda *a, **k: self

    def update(self, payload):
        self.sink.append(payload)
        return self


@pytest.fixture
def ledger(monkeypatch):
    written = []
    active = [{"ad_number": str(i), "missing_count": 0, "last_seen_at": f"2026-11-0{1 + i % 8}"} for i in range(30)]
    monkeypatch.setattr(db, "sb", lambda: types.SimpleNamespace(table=lambda _n: _Q(written)))
    monkeypatch.setattr(db, "_execute", lambda q, what="", **k: types.SimpleNamespace(
        data=active if (what.endswith("prune_select") or what.endswith("read_gone_set")) else []))
    monkeypatch.setattr(db, "prune_unseen", lambda *a, **k: 0)    # the re-run after the reads is not under test
    db._PRUNE_TRIPS.clear()
    db._READ_GONE_REPORT.clear()
    db._READ_GONE_DONE.clear()
    db._READ_GONE_STRUCK.clear()
    return written


def _oracle(gone=(), live=()):
    def verify_gone(ad):
        if ad in gone:
            return "gone", "HTTP 404"
        if ad in live:
            return "live", "InStock"
        return "unknown", "HTTP 503"
    return verify_gone


def test_every_unseen_row_read_writes_unread_zero(ledger):
    db._PRUNE_TRIPS.append("x_commercial_listings coverage (re-saw 22 of 30 active, floor 80%)")
    seen = {str(i) for i in range(22)}                                   # 8 unseen: 22 … 29
    db.strike_read_gone("x_commercial_listings", seen, "x", verify_gone=_oracle(gone={"22"}, live={"23", "24"}))
    db.end_run(1, ok=True, rows_seen=22, rows_upserted=22)
    notes = ledger[-1]["notes"]
    assert TRIP.search(notes), "the trip itself still reaches the notes"
    m = MARKER.search(notes)
    assert m and m.group(1) == "x_commercial_listings"
    unseen, read, gone, live, unknown, unread = map(int, m.groups()[1:])
    assert (unseen, read, gone, live, unknown, unread) == (8, 8, 1, 2, 5, 0)


def test_a_read_cap_leaves_rows_unread_and_says_so(ledger):
    db._PRUNE_TRIPS.append("x_commercial_listings coverage (re-saw 22 of 30 active, floor 80%)")
    seen = {str(i) for i in range(22)}
    db.strike_read_gone("x_commercial_listings", seen, "x", verify_gone=_oracle(), max_reads=3)
    db.end_run(1, ok=True, rows_seen=22, rows_upserted=22)
    m = MARKER.search(ledger[-1]["notes"])
    assert m and int(m.group(2)) == 8 and int(m.group(3)) == 3 and int(m.group(7)) == 5, \
        "unread must be the rows the cap kept the reader from reaching — never 0 by omission"


def test_a_raising_oracle_is_an_unknown_reading_not_a_skipped_row(ledger):
    db._PRUNE_TRIPS.append("x_commercial_listings coverage (re-saw 28 of 30 active, floor 80%)")
    seen = {str(i) for i in range(28)}

    def boom(_ad):
        raise RuntimeError("socket")
    db.strike_read_gone("x_commercial_listings", seen, "x", verify_gone=boom)
    db.end_run(1, ok=True, rows_seen=28, rows_upserted=28)
    m = MARKER.search(ledger[-1]["notes"])
    assert m and (int(m.group(3)), int(m.group(6)), int(m.group(7))) == (2, 2, 0)


def test_no_direct_reads_leaves_no_marker(ledger):
    db._PRUNE_TRIPS.append("x_commercial_listings coverage (re-saw 22 of 30 active, floor 80%)")
    db.end_run(1, ok=True, rows_seen=22, rows_upserted=22)
    notes = ledger[-1]["notes"]
    assert TRIP.search(notes) and not MARKER.search(notes), "a trip nobody read behind must still raise"


def test_the_report_is_cleared_by_end_run(ledger):
    seen = {str(i) for i in range(22)}
    db.strike_read_gone("x_commercial_listings", seen, "x", verify_gone=_oracle())
    db.end_run(1, ok=True, rows_seen=22, rows_upserted=22)
    db.end_run(2, ok=True, rows_seen=22, rows_upserted=22)
    assert not MARKER.search(ledger[-1]["notes"] or ""), "a second run must not inherit the first run's reads"


def test_the_marker_matches_the_detectors_regexes():
    """The migration's detector reads `unread=[1-9][0-9]*` and counts `unseen read directly: ` markers; the line
    end_run() writes must be the one it parses."""
    line = db.read_gone_report_line("t_residential_listings", {"unseen": 6, "read": 6, "gone": 1, "live": 4, "unknown": 1})
    assert line == "unseen read directly: t_residential_listings unseen=6 read=6 gone=1 live=4 unknown=1 unread=0"
    assert not re.search(r"unread=[1-9][0-9]*", line)
    assert re.search(r"unread=[1-9][0-9]*", db.read_gone_report_line("t", {"unseen": 60, "read": 50, "gone": 0, "live": 0, "unknown": 50}))
