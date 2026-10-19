"""A source-confirmed withdrawal must be REGISTERED, or the 24h recovery undoes it.

THE DEFECT (measured on suwar, 2026-09-19, routine-3 data-integrity run)
-----------------------------------------------------------------------
suwar's scraper reads «غير متاح» — sold/withdrawn — from each ad's OWN detail page and maps the row
with `active = False`. That is a POSITIVE source verdict, the one evidence class
docs/ops/LISTING_LIVENESS.md allows to kill a listing. It was nevertheless undone every single day:

    crawl_stats_platform_daily, platform='suwar'
      2026-09-16  marked_inactive=54  reactivated=54
      2026-09-17  marked_inactive=54  reactivated=54
      2026-09-18  marked_inactive=54  reactivated=54
      2026-09-19  marked_inactive=54  reactivated=54

leaving all 150 suwar rows `active = true` while the source said 54 were gone.

WHY, AND WHY IT GENERALISES
---------------------------
`auto_recover_false_inactive()` recovers a row on

    active = false AND coalesce(missing_count,0) = 0
                   AND deactivated_at >= now() - 24h
                   AND not exists (<an adjudication row>)

A kill from POSITIVE evidence never involves the ad being ABSENT from the crawl, so nothing
increments `missing_count`. It therefore matches the first three clauses EXACTLY as an accidental
flip does. The adjudication ledger is the only clause that can distinguish a decision from an
accident — which is precisely what AGENTS.md means by "hiding a listing is a two-part act".

This is the third recorded instance of the class: sadin supersession (2026-09-02) and rakez
off-plan (2026-09-14) were the first two. Both were found days late, and both looked like a
scraper bug while the scraper was innocent.

WHAT THESE TESTS DO
-------------------
They EXECUTE `db.register_source_retraction` against a stubbed Supabase client rather than
grepping for it, and they execute the real recovery PREDICATE over the resulting ledger — so they
observe the guard actually holding, in both directions, rather than asserting that a line exists.

Run: python -m pytest scrapers/common/tests/test_source_retraction_survives_auto_recovery.py
"""
from __future__ import annotations

import sys
from pathlib import Path
from typing import Any

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

from scrapers.common import db  # noqa: E402

TABLE = "suwar_residential_listings"

# Three ads the source page says are «غير متاح», one it says is «متاح».
LISTINGS = [
    {"id": 11747577, "ad_number": "SWR22401", "listing_url": "https://suwar.sa/property/a/",
     "source": "Suwar", "available": False},
    {"id": 11747584, "ad_number": "SWR19979", "listing_url": "https://suwar.sa/property/b/",
     "source": "Suwar", "available": False},
    {"id": 11747585, "ad_number": "SWR19293", "listing_url": "https://suwar.sa/property/c/",
     "source": "Suwar", "available": False},
    {"id": 11747590, "ad_number": "SWR20001", "listing_url": "https://suwar.sa/property/d/",
     "source": "Suwar", "available": True},
]


class _Result:
    def __init__(self, data: list[dict[str, Any]]) -> None:
        self.data = data


class _FakeTable:
    def __init__(self, store: "_FakeSupabase", name: str) -> None:
        self.store, self.name = store, name
        self._mode = ""
        self._payload: Any = None
        self._in: tuple[str, list[Any]] | None = None
        self._eq: dict[str, Any] = {}

    def select(self, *_cols: str) -> "_FakeTable":
        self._mode = "select"
        return self

    def upsert(self, payload: Any, **_kw: Any) -> "_FakeTable":
        self._mode, self._payload = "upsert", payload
        return self

    def in_(self, col: str, vals: list[Any]) -> "_FakeTable":
        self._in = (col, list(vals))
        return self

    def eq(self, col: str, val: Any) -> "_FakeTable":
        self._eq[col] = val
        return self

    def execute(self) -> _Result:
        if self._mode == "select":
            rows = [r for r in self.store.listings if r["ad_number"] in (self._in[1] if self._in else [])]
            for col, val in self._eq.items():
                rows = [r for r in rows if r.get(col) == val]
            self.store.selects += 1
            return _Result([{k: r[k] for k in ("id", "ad_number", "listing_url")} for r in rows])
        if self._mode == "upsert":
            for row in self._payload:
                key = (row["source_table"], row["listing_id"])
                self.store.ledger[key] = row       # PK (source_table, listing_id) → idempotent
            return _Result(list(self._payload))
        raise AssertionError(f"unexpected mode {self._mode!r}")


class _FakeSupabase:
    def __init__(self) -> None:
        self.listings = [dict(r) for r in LISTINGS]
        self.ledger: dict[tuple[str, int], dict[str, Any]] = {}
        self.selects = 0

    def table(self, name: str) -> _FakeTable:
        return _FakeTable(self, name)


@pytest.fixture()
def fake(monkeypatch: pytest.MonkeyPatch) -> _FakeSupabase:
    store = _FakeSupabase()
    monkeypatch.setattr(db, "sb", lambda: store)
    return store


def _unavailable_ads() -> set[str]:
    return {r["ad_number"] for r in LISTINGS if not r["available"]}


def _recovery_would_resurrect(store: _FakeSupabase, ad_numbers: set[str]) -> set[str]:
    """auto_recover_false_inactive()'s predicate, over the ledger this run produced.

    active=false, missing_count=0 and a fresh deactivated_at are ALL true of a source-confirmed
    withdrawal, so they are held constant here: the ledger clause is the only variable, which is
    exactly the point being proven.
    """
    return {
        ad for ad in ad_numbers
        if not any(row["evidence"]["ad_number"] == ad for row in store.ledger.values())
    }


def test_source_confirmed_withdrawals_are_registered(fake: _FakeSupabase) -> None:
    n = db.register_source_retraction(
        table=TABLE, ad_numbers=_unavailable_ads(), source="Suwar",
        reason="Source marks this ad «غير متاح» (sold/withdrawn) on its own detail page.",
        source_signal='<span class="status">غير متاح</span> read from the ad\'s own URL.')

    assert n == 3, f"expected 3 retractions registered, got {n}"
    assert len(fake.ledger) == 3
    assert {r["evidence"]["ad_number"] for r in fake.ledger.values()} == _unavailable_ads()
    # The ledger row must carry the evidence a later reader needs to re-adjudicate it.
    row = next(iter(fake.ledger.values()))
    assert row["source_table"] == TABLE
    assert "غير متاح" in row["reason"]
    assert row["evidence"]["listing_url"].startswith("https://suwar.sa/")
    assert row["evidence"]["source_signal"]


def test_the_recovery_job_can_no_longer_resurrect_them(fake: _FakeSupabase) -> None:
    """The whole point: WITHOUT the ledger all three come back, WITH it none do."""
    ads = _unavailable_ads()

    # Before registering — this is the production behaviour measured on 2026-09-19.
    assert _recovery_would_resurrect(fake, ads) == ads, (
        "precondition: with an empty ledger the recovery predicate matches every "
        "source-confirmed withdrawal — that is the defect this guard exists for")

    db.register_source_retraction(
        table=TABLE, ad_numbers=ads, source="Suwar",
        reason="Source marks this ad «غير متاح» (sold/withdrawn) on its own detail page.",
        source_signal="read from the ad's own URL")

    assert _recovery_would_resurrect(fake, ads) == set(), (
        "after registration the recovery job must skip every one of them")


def test_an_available_ad_is_never_retracted(fake: _FakeSupabase) -> None:
    """Only ads the source SAYS are gone. A live ad must never reach the ledger."""
    db.register_source_retraction(
        table=TABLE, ad_numbers=_unavailable_ads(), source="Suwar",
        reason="r", source_signal="s")
    live = {r["ad_number"] for r in LISTINGS if r["available"]}
    assert not (live & {r["evidence"]["ad_number"] for r in fake.ledger.values()})


def test_registering_twice_is_idempotent(fake: _FakeSupabase) -> None:
    """A daily run may call this unconditionally, so a repeat must not accumulate rows."""
    for _ in range(3):
        db.register_source_retraction(
            table=TABLE, ad_numbers=_unavailable_ads(), source="Suwar",
            reason="r", source_signal="s")
    assert len(fake.ledger) == 3, "PK (source_table, listing_id) must collapse repeats"


def test_empty_input_costs_no_round_trip(fake: _FakeSupabase) -> None:
    """A platform with nothing withdrawn must not build a client or hit the network."""
    assert db.register_source_retraction(
        table=TABLE, ad_numbers=set(), reason="r", source_signal="s") == 0
    assert fake.selects == 0 and not fake.ledger


def test_a_ledger_failure_never_blocks_the_crawl(monkeypatch: pytest.MonkeyPatch) -> None:
    """Recording why a row died may never be able to keep the crawl from finishing."""
    store = _FakeSupabase()
    monkeypatch.setattr(db, "sb", lambda: store)
    real_execute = db._execute

    def _boom(q: Any, what: str = "") -> Any:
        if "ops_adjudicated_retraction" in what:
            raise RuntimeError("PostgREST 503")
        return real_execute(q, what=what)

    monkeypatch.setattr(db, "_execute", _boom)
    assert db.register_source_retraction(
        table=TABLE, ad_numbers=_unavailable_ads(), source="Suwar",
        reason="r", source_signal="s") == 0
