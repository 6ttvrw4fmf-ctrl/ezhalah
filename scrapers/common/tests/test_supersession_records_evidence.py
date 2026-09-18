"""An automatic res/com supersession must leave per-row evidence — executed against a stub client.

WHY (ops_incident #275, measured 2026-09-18 by routine-11-lifecycle)
--------------------------------------------------------------------
`db.retire_superseded_siblings()` wrote `{active: false, deactivated_at}` and nothing else, so an
automatic retirement was — in SQL — indistinguishable from a crawl that timed out.
`mon_detect_unknown_treated_as_dead` (P1) asks *was this row set active=false with no verdict
recorded against its ad_number at the time?* and therefore counted every automatic supersession as
a kill on unknown evidence. Measured over the seven wired platforms: 16 retirements in 30 days,
every one evidence-free, every one confirmed a genuine supersession by an ACTIVE sibling row holding
the same ad_number (sadin_commercial 5, amaall_residential 6, dealapp_residential 4,
arkaan_residential 1).

The detector's existing exclusion reads `ops_res_com_collision_adjudication`, whose only writer is a
human/agent session — so the suppression for the AUTOMATIC path was written by hand (arkaan AK907)
or not at all (AK920). This is `scrapers/common/sold_pin.py`'s lesson applied to the other automatic
kill path: the actor that performs the kill writes the evidence for it, in the same function.

`scripts/verify-supersession-kill-leaves-evidence.ts` executes the PURE planner and mutates it.
This file executes the WRITE path — the half a pure planner cannot cover: that the rows reach the
ledger at all, that they describe the rows actually retired, and that a ledger outage can never keep
a superseded duplicate card on screen.
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

from scrapers.common import db  # noqa: E402

LEDGER = "ops_stale_inactivation_probe"
RES = "p_residential_listings"
COM = "p_commercial_listings"


class _Resp:
    def __init__(self, data):
        self.data = data


class _Query:
    """A PostgREST stand-in narrow enough to observe exactly what the function asks for."""

    def __init__(self, table, store, ledger, fail_ledger):
        self._t, self._store, self._ledger = table, store, ledger
        self._fail_ledger = fail_ledger
        self._ads, self._active_only, self._update, self._insert = None, False, None, None

    def select(self, *_a):
        return self

    def update(self, payload):
        self._update = payload
        return self

    def insert(self, rows):
        self._insert = rows
        return self

    def in_(self, _col, ads):
        self._ads = list(ads)
        return self

    def eq(self, col, val):
        if col == "active":
            self._active_only = bool(val)
        return self

    def execute(self):
        if self._insert is not None:
            if self._t == LEDGER and self._fail_ledger:
                raise RuntimeError("ledger unavailable")
            self._ledger.extend(self._insert)
            return _Resp(list(self._insert))
        rows = self._store.setdefault(self._t, [])
        if self._update is not None:
            hit = [r for r in rows if r["ad_number"] in (self._ads or [])]
            for r in hit:
                r.update(self._update)
            return _Resp(hit)
        sel = [r for r in rows
               if r["ad_number"] in (self._ads or [])
               and (not self._active_only or r.get("active"))]
        # The real select asks for "id, ad_number, listing_url" — identity must survive the round
        # trip, or the ledger row cannot say WHICH row was retired.
        return _Resp([{"id": r["id"], "ad_number": r["ad_number"],
                       "listing_url": r["listing_url"]} for r in sel])


class _Client:
    def __init__(self, store, ledger, fail_ledger):
        self._store, self._ledger, self._fail = store, ledger, fail_ledger

    def table(self, name):
        return _Query(name, self._store, self._ledger, self._fail)


def _row(ad, rid, active=True):
    return {"id": rid, "ad_number": ad, "active": active,
            "listing_url": f"https://p.example/ad/{ad}", "deactivated_at": None}


def _run(store, res_ads, com_ads, monkeypatch, fail_ledger=False):
    ledger: list = []
    monkeypatch.setattr(db, "sb", lambda: _Client(store, ledger, fail_ledger))
    n = db.retire_superseded_siblings(
        res_table=RES, com_table=COM, res_ads=res_ads, com_ads=com_ads)
    return n, ledger


# ── 1. THE DEFECT ITSELF: the retirement happened and said nothing about why ─────────────────────
def test_every_retired_row_gets_one_ledger_row_naming_the_sibling(monkeypatch):
    store = {RES: [_row("AK920", 11), _row("AK931", 12)], COM: [_row("AK920", 21), _row("AK931", 22)]}
    n, ledger = _run(store, res_ads=set(), com_ads={"AK920", "AK931"}, monkeypatch=monkeypatch)

    assert n == 2
    assert len(ledger) == 2, "a retirement that files no evidence is the shipped defect"
    assert sorted(e["ad_number"] for e in ledger) == ["AK920", "AK931"]
    for e in ledger:
        assert e["source_table"] == RES, "evidence must be filed against the table that was killed"
        assert e["verdict"] == "SUPERSEDED"
        assert e["oracle"] == "res_com.sibling_classified_this_run"
        assert COM in e["note"], "the note must name the sibling that superseded this copy"
        # Identity pinned to the row actually retired, not inferred from an ad_number later.
        assert e["listing_id"] in (11, 12)
        assert e["listing_url"].endswith(e["ad_number"])


# ── 2. SOURCE TRUTH: a supersession is not a statement about the source ──────────────────────────
def test_the_verdict_is_never_gone(monkeypatch):
    """The listing_url is still SERVED — by the sibling. Four detectors read verdict='GONE' as a
    source verdict (prune_kill_without_source_verdict, deletion_clock_without_evidence,
    lifecycle_false_resurrection, unknown_treated_as_dead); filing a supersession there would put a
    source claim nobody obtained into the one ledger they all trust."""
    store = {RES: [_row("A1", 1)], COM: [_row("A1", 2)]}
    _, ledger = _run(store, res_ads=set(), com_ads={"A1"}, monkeypatch=monkeypatch)
    assert [e["verdict"] for e in ledger] == ["SUPERSEDED"]
    assert all(e["verdict"] not in ("GONE", "LIVE") for e in ledger)


# ── 3. THE LEDGER MAY NEVER BLOCK THE REPAIR ─────────────────────────────────────────────────────
def test_a_ledger_outage_still_retires_the_duplicate(monkeypatch):
    """Monitoring must not be able to keep a superseded duplicate card on screen — the write is
    best-effort and attempted AFTER the retirement, exactly as sold_pin.py argues."""
    store = {RES: [_row("A1", 1)], COM: [_row("A1", 2)]}
    n, ledger = _run(store, res_ads=set(), com_ads={"A1"}, monkeypatch=monkeypatch, fail_ledger=True)
    assert n == 1
    assert store[RES][0]["active"] is False
    assert ledger == []


# ── 4. ONLY ROWS ACTUALLY RETIRED ARE CLAIMED ────────────────────────────────────────────────────
def test_an_already_inactive_row_files_no_new_evidence(monkeypatch):
    """`deactivated_at` keeps its original date for a row already inactive, so a fresh ledger row
    would assert a retirement that did not happen on that date."""
    store = {RES: [_row("A1", 1, active=False)], COM: [_row("A1", 2)]}
    n, ledger = _run(store, res_ads=set(), com_ads={"A1"}, monkeypatch=monkeypatch)
    assert n == 0
    assert ledger == []


def test_an_ad_classified_both_ways_is_untouched_and_unclaimed(monkeypatch):
    """Contradictory evidence in one run is not ours to settle — and an evidence row for a kill that
    never happened is worse than none."""
    store = {RES: [_row("A1", 1)], COM: [_row("A1", 2)]}
    n, ledger = _run(store, res_ads={"A1"}, com_ads={"A1"}, monkeypatch=monkeypatch)
    assert n == 0
    assert ledger == []
    assert store[RES][0]["active"] is True and store[COM][0]["active"] is True
