"""A ONE-WAY ORACLE MAKES AN ALERT THAT CORRECT BEHAVIOUR CANNOT CLEAR.

These tests EXECUTE `scrapers/common/sold_pin.record_relisting_evidence()` and the reversal half of
`pin_source_confirmed_gone()` against a fake PostgREST client, and assert what they actually WRITE.

WHAT THIS EXISTS TO CONTAIN (measured 2026-09-23, routine #11, over the whole
`ops_stale_inactivation_probe` ledger):

    prune_unseen.verify_gone      362 GONE /  300 LIVE /  618 UNKNOWN   <- three-valued
    wasalt.liveness.check_hybrid 1405 GONE /  145 LIVE /    0           <- two-valued
    *.sold_pin.*  (9 oracles)    5853 GONE /    0 LIVE /    0           <- ONE-WAY

Every other evidence writer in this repo records the source saying "still here". The sold pin
recorded only "gone" — the available complement was read from the same field, on the same page, in
the same crawl, used to decide, and discarded.

`ops_lifecycle_false_resurrection()` takes the LATEST verdict per ad_number and reports rows where
it is GONE while the row is `active = true`. So when a source RELISTS a unit, the scraper does the
right thing (the next upsert carries `active = true`) and the ledger's latest verdict stays GONE
**forever** — a P1 no amount of correct behaviour can clear. satel STC0084 was exactly this: GONE on
09-14/15/16/17, then silence, the row correctly active, and a DIRECT re-probe on 09-23 returning the
very same `property_status` field reading "Available" / postStatus "Published".

`docs/ops/LISTING_LIFECYCLE_ENGINEER.md` §2.5a names the trap: *a permanently unclearable alert is
how a detector teaches people to dismiss it*, and §8.3 says this class can least afford to cry wolf.

    python -m pytest scrapers/common/tests/test_sold_pin_records_the_reversal.py -q
"""
from __future__ import annotations

import sys
import types

import pytest

# ── Hermetic import: stub supabase + dotenv so db.py imports with no credentials/network ─────────
_supabase_mod = types.ModuleType("supabase")
_supabase_mod.Client = type("Client", (), {})
_supabase_mod.create_client = lambda url, key: None
sys.modules.setdefault("supabase", _supabase_mod)
_dotenv_mod = types.ModuleType("dotenv")
_dotenv_mod.load_dotenv = lambda *a, **k: None
sys.modules.setdefault("dotenv", _dotenv_mod)

from scrapers.common import db, sold_pin  # noqa: E402

TABLE = "satel_residential_listings"
ORACLE = "satel.sold_pin.property_status"


# ── A fake PostgREST client that answers the prior-GONE lookup and records every write ───────────
class _Q:
    def __init__(self, sink, table, prior_gone, fail_inserts=False):
        self._sink, self._table, self._prior = sink, table, prior_gone
        self._fail = fail_inserts
        self._payload = None
        self._filters: dict = {}
        self._selecting = False
        self._asked: list[str] = []

    def update(self, payload):
        self._payload = payload
        return self

    def select(self, _cols):
        self._selecting = True
        return self

    def eq(self, col, val):
        self._filters[col] = val
        return self

    def in_(self, _col, ads):
        if self._selecting:
            self._asked = list(ads)
            self._sink.append(("select", self._table, dict(self._filters), list(ads)))
        else:
            self._sink.append(("update", self._table, dict(self._payload), list(ads)))
        return self

    def insert(self, rows):
        if self._fail:
            raise RuntimeError("ops ledger unavailable")
        self._sink.append(("insert", self._table, None, [dict(r) for r in rows]))
        return self

    def execute(self):
        if self._selecting:
            # Only rows the LISTING table (not the ledger it is stored in) has really published a
            # GONE verdict for — the lookup must scope by source_table or it reads another
            # platform's removals as this one's.
            assert self._filters.get("source_table") == TABLE, \
                "the prior-GONE lookup was not scoped to this listing table"
            hit = [a for a in self._asked
                   if a in self._prior and self._filters.get("verdict") == "GONE"]
            return types.SimpleNamespace(data=[{"ad_number": a} for a in hit])
        return types.SimpleNamespace(data=[])


class _Client:
    def __init__(self, sink, prior_gone, fail_inserts=False):
        self._sink, self._prior, self._fail = sink, prior_gone, fail_inserts

    def table(self, name):
        return _Q(self._sink, name, self._prior, self._fail)


def _wire(monkeypatch, prior_gone=(), *, fail_inserts=False):
    sink: list = []
    prior = set(prior_gone)
    monkeypatch.setattr(db, "sb", lambda: _Client(sink, prior, fail_inserts))
    monkeypatch.setattr(db, "_execute", lambda q, what=None: q.execute())
    return sink


def _ledger(sink):
    return [r for s in sink if s[0] == "insert" and s[1] == sold_pin.EVIDENCE_TABLE for r in s[3]]


def _live_rows(sink):
    return [r for r in _ledger(sink) if r["verdict"] == "LIVE"]


def _writes_to(sink, table):
    return [s for s in sink if s[0] in ("insert", "update") and s[1] == table]


# ── The defect, in both directions ───────────────────────────────────────────────────────────────
def test_a_relisted_listing_gets_exactly_one_live_row_naming_the_oracle(monkeypatch):
    """The satel STC0084 case: prior GONE, read available this crawl."""
    sink = _wire(monkeypatch, prior_gone={"STC0084"})
    got = sold_pin.record_relisting_evidence(
        TABLE, ["STC0084", "STC0090"], [], oracle=ORACLE)

    assert got == ["STC0084"], "the reversal the source published was not recorded"
    rows = _live_rows(sink)
    assert len(rows) == 1
    assert rows[0]["ad_number"] == "STC0084"
    assert rows[0]["source_table"] == TABLE
    assert rows[0]["oracle"] == ORACLE, "a LIVE row that cannot say which field was read is " \
        "as unfalsifiable as the GONE rows the 2026-08-26 aqarcity lesson was about"


def test_an_id_sold_this_crawl_is_never_certified_live(monkeypatch):
    """The direction that matters: this must not be able to bury a real false resurrection.

    A caller that hands over its whole seen-set, sold rows included, still cannot produce a
    contradictory pair — the LAW subtracts them, so the guarantee does not depend on the caller.
    """
    sink = _wire(monkeypatch, prior_gone={"STC0084", "STC0018"})
    got = sold_pin.record_relisting_evidence(
        TABLE, ["STC0084", "STC0018"], ["STC0018"], oracle=ORACLE)

    assert got == ["STC0084"]
    assert [r["ad_number"] for r in _live_rows(sink)] == ["STC0084"], \
        "an id this very crawl read as SOLD was certified available — the alert can now be buried"


def test_a_listing_with_no_prior_gone_verdict_writes_nothing(monkeypatch):
    """Bounded on purpose: without this, a daily crawl files tens of thousands of 'still available'
    rows into a ledger holding ~12k in total, and the real signal drowns in its own noise."""
    sink = _wire(monkeypatch, prior_gone=set())
    got = sold_pin.record_relisting_evidence(
        TABLE, [f"STC{i:04d}" for i in range(500)], [], oracle=ORACLE)

    assert got == []
    assert _live_rows(sink) == []


def test_the_reversal_is_recorded_even_when_nothing_is_sold_this_crawl(monkeypatch):
    """The early-return trap. A crawl in which nothing is sold is precisely a crawl in which a
    previously-sold unit may have come back; returning early on an empty sold-set is how the
    one-way ledger would quietly survive this fix."""
    sink = _wire(monkeypatch, prior_gone={"STC0084"})
    pinned = sold_pin.pin_source_confirmed_gone(
        TABLE, [], oracle=ORACLE, seen_ad_numbers=["STC0084"])

    assert pinned == []
    assert [r["ad_number"] for r in _live_rows(sink)] == ["STC0084"], \
        "pin_source_confirmed_gone returned early on an empty sold-set and skipped the reversal"


def test_the_pin_and_the_reversal_travel_together(monkeypatch):
    """One call, both directions — so a platform cannot wire the kill half and omit the other."""
    sink = _wire(monkeypatch, prior_gone={"STC0084", "STC0018"})
    pinned = sold_pin.pin_source_confirmed_gone(
        TABLE, ["STC0018"], oracle=ORACLE, seen_ad_numbers=["STC0018", "STC0084"])

    assert pinned == ["STC0018"]
    verdicts = {r["ad_number"]: r["verdict"] for r in _ledger(sink)}
    assert verdicts == {"STC0018": "GONE", "STC0084": "LIVE"}


# ── The safety envelope ──────────────────────────────────────────────────────────────────────────
def test_the_reversal_writes_evidence_only_never_a_liveness_stamp(monkeypatch):
    """`LISTING_LIVENESS.md` §3: only scrapers/common/liveness_contract.py may write
    last_verified_alive_at. A hand-written stamp puts a confident, recent-looking timestamp on
    inventory nobody read."""
    sink = _wire(monkeypatch, prior_gone={"STC0084"})
    sold_pin.record_relisting_evidence(TABLE, ["STC0084"], [], oracle=ORACLE)

    assert _writes_to(sink, TABLE) == [], \
        "the reversal half touched the listing table — it may only write the evidence ledger"
    for r in _ledger(sink):
        assert "last_verified_alive_at" not in r
        assert "active" not in r and "missing_count" not in r


def test_a_ledger_outage_can_never_break_a_crawl_or_the_pin(monkeypatch):
    """Best-effort in exactly the sense the GONE half is: monitoring must not be able to abort a
    crawl, nor keep a source-confirmed dead listing on screen."""
    sink = _wire(monkeypatch, prior_gone={"STC0084"}, fail_inserts=True)

    assert sold_pin.record_relisting_evidence(TABLE, ["STC0084"], [], oracle=ORACLE) == []

    pinned = sold_pin.pin_source_confirmed_gone(
        TABLE, ["STC0018"], oracle=ORACLE, seen_ad_numbers=["STC0084"])
    assert pinned == ["STC0018"], "a ledger outage stopped a source-confirmed dead listing " \
        "from being pinned — the listing stays on screen"
    assert [s for s in sink if s[0] == "update"], "the pin update itself did not happen"


def test_a_blank_oracle_is_refused(monkeypatch):
    """An evidence row that cannot name the field it read is unfalsifiable in either direction."""
    _wire(monkeypatch, prior_gone={"STC0084"})
    with pytest.raises(ValueError):
        sold_pin.plan_relisting_evidence(["STC0084"], [], {"STC0084"}, "")


def test_a_duplicated_ad_number_produces_one_row_not_two(monkeypatch):
    sink = _wire(monkeypatch, prior_gone={"STC0084"})
    sold_pin.record_relisting_evidence(
        TABLE, ["STC0084", "STC0084", "STC0084"], [], oracle=ORACLE)

    assert len(_live_rows(sink)) == 1, "one reversal was filed as several source confirmations"


def test_the_prior_gone_lookup_is_asked_in_bounded_slices(monkeypatch):
    """PostgREST caps an unbounded select at 1000 rows. A cap that silently truncates would make
    the intersection under-report on exactly the busiest platforms."""
    sink = _wire(monkeypatch, prior_gone={"STC0999"})
    sold_pin.record_relisting_evidence(
        TABLE, [f"STC{i:04d}" for i in range(1000)], [], oracle=ORACLE)

    selects = [s for s in sink if s[0] == "select"]
    assert len(selects) == 5, f"expected 1000/{sold_pin._BATCH} bounded slices, got {len(selects)}"
    assert all(len(s[3]) <= sold_pin._BATCH for s in selects)
    assert [r["ad_number"] for r in _live_rows(sink)] == ["STC0999"], \
        "a candidate past the first slice was lost"
