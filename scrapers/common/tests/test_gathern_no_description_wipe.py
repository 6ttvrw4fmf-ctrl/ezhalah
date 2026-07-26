"""Regression guard for the description-wipe bug (2026-07-25).

The Gathern list feed carries NO description — description is filled ONLY by the separate
`--backfill-details` Tier-2 pass. The crawl upserts full rows with on_conflict=ad_number, so if
map_listing() emits a "description" key, every re-crawl of a still-live unit runs
`SET description = <that value>` and destroys the backfilled text. It DID: descriptions collapsed
23,509 -> 7,333 in one day. The fix is to omit the key entirely so the column stays out of the
UPDATE and the backfilled value survives.

This test fails if anyone re-adds a description key to the crawl payload.

    python -m pytest scrapers/common/tests/test_gathern_no_description_wipe.py -q
"""
from __future__ import annotations

import sys
import types

# Hermetic import chain: stub supabase + dotenv so importing scrapers.gathern.run never needs a
# network or credentials (same pattern as test_gathern_amenities_bathrooms.py).
_supabase_mod = types.ModuleType("supabase")
_supabase_mod.Client = type("Client", (), {})
_supabase_mod.create_client = lambda url, key: None
sys.modules.setdefault("supabase", _supabase_mod)
_dotenv_mod = types.ModuleType("dotenv")
_dotenv_mod.load_dotenv = lambda *a, **k: None
sys.modules.setdefault("dotenv", _dotenv_mod)

import scrapers.gathern.run as _run  # noqa: E402
from scrapers.gathern.run import map_listing  # noqa: E402

# map_listing() calls arabic_location.resolve(), which lazy-loads a dataset from the DB on first use.
# Stub it via the monkeypatch fixture (auto-reverted) so the test stays hermetic AND never leaks the
# stub into other tests' resolve() — a module-level assignment here silently broke
# test_arabic_location_resolve.py under the full-suite run.
_STUB_RESOLVE = lambda *a, **k: {
    "city_ar": None, "city_id": None, "region_id": None, "district_ar": None, "confidence": "unresolved",
}

# Smallest item that survives map_listing's guards: residential type (6=Apartment), monthly signal
# (long_stay), a unit id, a valid monthly price, a Saudi city.
_ITEM = {
    "unit_type_id": 6,
    "long_stay": True,
    "id": 999999,
    "chalet_id": 12345,
    "final_price": 5000,
    "event_data": {"city_en": "Riyadh"},
}


def test_crawl_row_has_no_description_key(monkeypatch):
    monkeypatch.setattr(_run.AL, "resolve", _STUB_RESOLVE)
    row = map_listing(_ITEM)
    assert row is not None, "fixture should map to a valid residential row"
    assert row["ad_number"] == "GTH999999"
    # The crawl must NOT carry description — otherwise the full-row upsert nulls the backfilled text.
    assert "description" not in row, (
        "map_listing() must not emit a 'description' key; a full-row upsert would then wipe the "
        "Tier-2 --backfill-details description on every re-crawl."
    )


if __name__ == "__main__":
    # Standalone run (throwaway process): a plain setattr shim stands in for the monkeypatch fixture.
    class _MP:
        def setattr(self, obj, name, val):
            setattr(obj, name, val)
    test_crawl_row_has_no_description_key(_MP())
    print("ok")
