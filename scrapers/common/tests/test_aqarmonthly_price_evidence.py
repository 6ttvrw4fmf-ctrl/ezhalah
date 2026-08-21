"""Regression test: aqarmonthly must emit price_evidence (owner invariant 2026-08-04, alert_event
523, 2026-08-21).

Every sibling scraper (dealapp, wasalt, ...) already calls normalize.price_evidence() so a stored
price can be corroborated from the DB alone, without re-fetching the source. aqarmonthly's
map_listing() was the one gap in the fleet: it computed price_annual and stored it with NO
evidence at all. That gap is exactly what let 5 rows land at 1.27M-30.4M SAR/m²/yr (alert_event
523, mon_detect_field_integrity's extreme_magnitude class) with nothing in the database to say
where the number came from or whether it had ever been corroborated.

This fix is deliberately ADDITIVE ONLY — it records evidence next to the stored price, it never
suppresses, nulls, or caps a value on plausibility grounds. See
test_dealapp_extreme_price_preserved.py for why a write-time "looks implausible -> drop it" gate
is the wrong shape here: dealapp's billion-riyal listing was live-verified as genuinely
source-published and must be preserved as-is. Whether the 5 already-stored aqarmonthly rows are a
genuine (if extreme) source value or a captured API glitch is exactly the kind of question that
needs a live re-probe and an evidence-backed decision, not a scraper-side guess — that piece stays
open as a separate data-repair item.

Run: python -m pytest scrapers/common/tests/test_aqarmonthly_price_evidence.py -v
"""
from __future__ import annotations

import sys

import pytest

sys.path.insert(0, ".")

from scrapers.common import arabic_location as al  # noqa: E402
from scrapers.aqarmonthly.run import map_listing  # noqa: E402


@pytest.fixture(autouse=True)
def fake_catalog(monkeypatch):
    # map_listing() also calls resolve_slug(), which lazy-loads a DB catalog on first use — stub it
    # out exactly like test_aqarmonthly_resolve_slug_district_suffix.py's fixture so this test needs
    # no network/DB. The slug used below has no "حي" token, so resolve_slug() legitimately finds no
    # district — this test is about price_evidence, not location resolution.
    monkeypatch.setattr(al, "_load", lambda: None)
    monkeypatch.setattr(al, "_CITY", {"الرياض": [(3, 1)]})
    monkeypatch.setattr(al, "_CID_AR", {3: "الرياض"})
    monkeypatch.setattr(al, "_REGION_NORM", {})
    yield


def _listing(uri: str = "شقة-فندقية-الرياض-النرجس-123456", area: int = 45, category: int = 101) -> dict:
    return {
        "id": 123456,
        "uri": uri,
        "area": area,
        "category": category,
        "imgs": [],
        "address": None,
    }


def test_price_evidence_is_present_and_matches_source_field():
    price = {"discounted_price": "7260", "total_price": "8000"}
    row = map_listing(_listing(), price)
    assert row is not None
    ev = row["price_evidence"]
    assert ev["found"] is True
    assert ev["raw"] == "7260"                       # discounted_price wins over total_price, same as the stored value
    assert ev["stored"] == row["price_annual"] == round(7260 * 12)
    assert ev["field"] == "DailyRenting.getCalculatedBookingPriceWithDiscount.discounted_price"
    assert ev["kind"] == "monthly"
    assert ev["unit"] == "total"
    assert ev["origin"] == "api"


def test_price_evidence_falls_back_to_total_price_field():
    price = {"discounted_price": None, "total_price": "5500"}
    row = map_listing(_listing(), price)
    assert row is not None
    assert row["price_evidence"]["raw"] == "5500"
    assert row["price_evidence"]["stored"] == row["price_annual"] == round(5500 * 12)


def test_price_evidence_never_suppresses_an_extreme_value():
    # Deliberately mirrors the shape of the alert_event 523 rows (huge SAR/m²/yr on a small unit).
    # Per the owner's preserve-not-guess rule, this must still be STORED, with evidence attached —
    # not nulled or dropped by this scraper. See test_dealapp_extreme_price_preserved.py.
    price = {"discounted_price": "2500000", "total_price": None}
    row = map_listing(_listing(area=10), price)
    assert row is not None, "an implausible-looking price must still be stored, never silently dropped"
    assert row["price_annual"] == round(2_500_000 * 12)
    assert row["price_evidence"]["found"] is True
    assert row["price_evidence"]["stored"] == row["price_annual"]


def test_no_price_at_all_yields_no_row_as_before():
    # Unchanged pre-existing behavior: a non-numeric/zero price still returns None outright, and
    # this fix does not touch that path.
    assert map_listing(_listing(), {"discounted_price": None, "total_price": None}) is None
    assert map_listing(_listing(), {"discounted_price": "0", "total_price": "0"}) is None


if __name__ == "__main__":
    import pytest
    sys.exit(pytest.main([__file__, "-v"]))
