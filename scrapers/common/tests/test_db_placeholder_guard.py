"""Hermetic tests for scrapers/common/db.py's `_reject_placeholder_location` — the LAST-line-of-
defense backstop (2026-07-10 architecture redesign) that every scraper's upsert path (via
`_wasalt_batch` or a dedicated `upsert_*` function) already runs through before a row reaches
Postgres. Stubs `supabase`/`dotenv` in sys.modules so this needs no network/credentials, matching
the hermetic pattern established in scrapers/wasalt/tests/conftest.py.
"""
from __future__ import annotations

import sys
import types

import pytest

# ── Stub supabase + dotenv (db.py does `from supabase import Client, create_client` and
#    `from dotenv import load_dotenv` at import time) ────────────────────────────────────────────
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


class _FakeAlertsInsert:
    def __init__(self, captured):
        self._captured = captured

    def insert(self, payload):
        self._captured.append(payload)
        return self

    def execute(self):
        return types.SimpleNamespace(data=[{}])


class _FakeTable:
    def __init__(self, name, captured):
        self._name = name
        self._captured = captured

    def __call__(self, name):
        return _FakeAlertsInsert(self._captured) if name == "location_pipeline_alerts" else self


@pytest.fixture
def captured_alerts(monkeypatch):
    alerts: list[dict] = []
    fake_client = types.SimpleNamespace(table=_FakeTable("client", alerts))
    monkeypatch.setattr(db, "sb", lambda: fake_client)
    return alerts


@pytest.mark.parametrize("junk", ["Other", "Unknown", "N/A", "other", "  UNKNOWN  ", ""])
def test_placeholder_city_is_nulled_not_written(captured_alerts, junk):
    row = {"ad_number": "X1", "city": junk, "region": "Riyadh"}
    db._reject_placeholder_location(row, table="fake_residential_listings")
    assert row["city"] is None
    assert row["region"] == "Riyadh"  # a REAL region is never touched


@pytest.mark.parametrize("junk", ["Other", "Unknown", "N/A"])
def test_placeholder_region_is_nulled_not_written(captured_alerts, junk):
    row = {"ad_number": "X2", "city": "Jeddah", "region": junk}
    db._reject_placeholder_location(row, table="fake_residential_listings")
    assert row["region"] is None
    assert row["city"] == "Jeddah"


def test_real_location_values_are_completely_untouched(captured_alerts):
    row = {"ad_number": "X3", "city": "Jeddah", "region": "Makkah",
           "district_ar": "حي الشاطئ", "neighborhood": "North Corniche"}
    original = dict(row)
    db._reject_placeholder_location(row, table="fake_residential_listings")
    assert row == original  # zero mutation when nothing is a placeholder


def test_honest_none_is_not_flagged_as_a_caught_placeholder(captured_alerts):
    # A row with city=None (the expected, honest "unresolved" state) must NOT trigger an alert —
    # only an ACTUAL placeholder string write attempt should. Alerting on every honestly-unresolved
    # row would flood the ops dashboard with false positives on ~1,400 known-unresolved rows.
    row = {"ad_number": "X4", "city": None, "region": None}
    db._reject_placeholder_location(row, table="fake_residential_listings")
    assert row["city"] is None
    assert captured_alerts == []


def test_catching_a_placeholder_writes_exactly_one_alert_row(captured_alerts):
    row = {"ad_number": "X5", "city": "Other", "region": "Unknown"}
    db._reject_placeholder_location(row, table="fake_residential_listings")
    assert len(captured_alerts) == 1
    alert = captured_alerts[0]
    assert alert["alert_type"] == "placeholder_location_blocked"
    assert "fake_residential_listings" in alert["detail"]
    assert "X5" in alert["detail"]


def test_never_raises_even_if_alert_insert_fails(monkeypatch):
    class _BrokenClient:
        def table(self, name):
            raise RuntimeError("network down")

    monkeypatch.setattr(db, "sb", lambda: _BrokenClient())
    row = {"ad_number": "X6", "city": "Other"}
    db._reject_placeholder_location(row, table="fake_residential_listings")  # must not raise
    assert row["city"] is None  # the actual guard (nulling) still happened despite the alert failing


def test_city_ar_column_is_also_guarded(captured_alerts):
    # wasalt/sanadak/aqargate/aldarim/alhoshan/hajer/aqarmonthly carry a first-class Arabic city_ar
    # column alongside the legacy English `city` — must be guarded too, not just the English one.
    row = {"ad_number": "X9", "city": "Riyadh", "city_ar": "Other"}
    db._reject_placeholder_location(row, table="fake_residential_listings")
    assert row["city_ar"] is None
    assert row["city"] == "Riyadh"


def test_guard_location_update_works_on_a_bare_dict_for_direct_write_scripts(captured_alerts):
    # The public entry point for scripts that write via .table().update() directly, bypassing the
    # upsert helpers entirely (the confirmed gap: scrapers/wasalt/enrich_ar.py) — must null in place
    # AND return the same dict for convenient inline chaining.
    upd = {"ar_fetched": True, "city_ar": "Unknown", "region_id": 5}
    result = db.guard_location_update(upd, table="wasalt_residential_listings", ref="id=123")
    assert result is upd  # same object, mutated in place
    assert upd["city_ar"] is None
    assert upd["region_id"] == 5  # untouched, not a guarded column
    assert upd["ar_fetched"] is True


def test_district_and_neighborhood_columns_are_also_guarded(captured_alerts):
    row = {"ad_number": "X7", "city": "Jeddah", "district_ar": "N/A", "neighborhood": "Unknown"}
    db._reject_placeholder_location(row, table="fake_residential_listings")
    assert row["district_ar"] is None
    assert row["neighborhood"] is None
    assert row["city"] == "Jeddah"


def test_missing_columns_are_a_harmless_noop(captured_alerts):
    # A row shape without city/region at all (e.g. a table that doesn't carry these columns) must
    # not error — `.get()` on a missing key is just None, which is not a placeholder.
    row = {"ad_number": "X8", "price_total": 500000}
    db._reject_placeholder_location(row, table="fake_residential_listings")
    assert row == {"ad_number": "X8", "price_total": 500000}
