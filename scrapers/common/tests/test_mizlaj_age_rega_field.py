"""Regression tests for the 2026-07-29 mizlaj property_age fix.

Root cause (documented in full 2026-07-17, fixed 2026-07-29): mizlaj/run.py read
`listing.get("property_age")` — the broker's own unverified free int typed into the Inertia page —
instead of the REGA-licensed advertisement's `property_age`, an authoritative closed-vocabulary Arabic
string ("سنة"/"سنتين"/"اكثر من عشر سنوات"). Live-verified 2026-07-17: 3 of 5 sampled active rows were
wrong when read from the broker field (630022: broker=12 vs REGA "اكثر من عشر سنوات"=10; 630024:
broker=3 vs REGA "سنتين"=2; 630031 additionally exposed a stray REGA age on a land parcel).

Fix, three parts:
  1. Read `rega.get("property_age")` via the shared `normalize.parse_property_age()` closed-vocabulary
     parser instead of the broker's `listing.get("property_age")` via a bespoke `_int()`. No REGA age ->
     honest None; never fall back to the unverifiable broker int.
  2. AGELESS_TYPES guard (Residential Land, Commercial Land, Gas Station) — a land/fuel-station row
     never carries an age even if REGA states a stray one (live case: ad 630031).
  3. `rega_property_age` provenance added to the additional_info whitelist so the raw source string is
     always inspectable, matching this scraper's existing rega_ad_license_number/rega_property_area
     pattern.

Run: python -m pytest scrapers/common/tests/test_mizlaj_age_rega_field.py -v
"""
import sys
from pathlib import Path

sys.path.insert(0, ".")

from scrapers.mizlaj.run import AGELESS_TYPES, map_listing  # noqa: E402

SCRAPERS_DIR = Path(__file__).resolve().parents[2]


def _src() -> str:
    return (SCRAPERS_DIR / "mizlaj" / "run.py").read_text(encoding="utf-8")


def _md(**over) -> dict:
    base = {
        "id": 999001, "slug": "test-listing", "name": "فيلا للبيع",
        "total_price": 1_500_000, "space": 400, "price_per_meter": 3750,
        "location": {}, "latitude": 24.0, "longitude": 46.0,
    }
    base.update(over)
    return base


def _listing(property_type_code="فيلا", rega_age=None, broker_age=None, rega_status="approved") -> dict:
    return {
        "propertyType": {"code": property_type_code, "name_ar": ""},
        "name": "فيلا للبيع",
        "advertisement_type": "Sell",
        "property_age": broker_age,  # the broker's own unverified free field — must be IGNORED now
        "rega_advertisements": [{
            "status": rega_status,
            "property_age": rega_age,
            "ad_license_number": "7200000000",
        }],
        "media": {"images": []},
    }


# ═══ 1. Source-text assertions — the broker field / buggy _int() are gone ═══════════════════════════

def test_int_helper_removed():
    text = _src()
    assert "def _int(" not in text, "_int() is dead after the fix — it was only used by the broker read"


def test_broker_property_age_no_longer_feeds_the_column():
    text = _src()
    assert 'age = listing.get("property_age")' not in text
    assert 'normalize.parse_property_age(rega.get("property_age"))' in text


# ═══ 2. Behavioral tests — exercise the real map_listing() end to end ═══════════════════════════════

def test_rega_age_used_not_broker_int():
    # Live-shaped case: broker typed 12, REGA (authoritative) says "اكثر من عشر سنوات" (floor 10).
    row, _ = map_listing(_md(), _listing(rega_age="اكثر من عشر سنوات", broker_age=12))
    assert row is not None
    assert row["property_age"] == 10, "must use REGA's floored bucket value, not the broker's raw 12"


def test_rega_lexical_identity_case():
    # Live-shaped case: broker typed 3, REGA says "سنتين" (= 2).
    row, _ = map_listing(_md(), _listing(rega_age="سنتين", broker_age=3))
    assert row is not None
    assert row["property_age"] == 2


def test_no_rega_age_is_honest_none_no_broker_fallback():
    row, _ = map_listing(_md(), _listing(rega_age=None, broker_age=15))
    assert row is not None
    assert row["property_age"] is None, "absent REGA age must never fall back to the broker's free int"


def test_ageless_land_type_nulls_age_even_if_rega_has_one():
    assert "Residential Land" in AGELESS_TYPES
    row, _ = map_listing(_md(name="ارض للبيع"), _listing(property_type_code="ارض", rega_age="اكثر من عشر سنوات"))
    assert row is not None
    assert row["property_type"] == "Residential Land"
    assert row["property_age"] is None, "land rows must never carry an age, even a REGA-stated stray one"


def test_gas_station_ageless():
    row, _ = map_listing(_md(name="محطة للبيع"), _listing(property_type_code="محطة", rega_age="سنة"))
    assert row is not None
    assert row["property_type"] == "Gas Station"
    assert row["property_age"] is None


def test_rega_property_age_provenance_captured():
    row, _ = map_listing(_md(), _listing(rega_age="سنتين", broker_age=3))
    assert row is not None
    assert row["additional_info"].get("rega_property_age") == "سنتين"


if __name__ == "__main__":
    test_int_helper_removed()
    test_broker_property_age_no_longer_feeds_the_column()
    test_rega_age_used_not_broker_int()
    test_rega_lexical_identity_case()
    test_no_rega_age_is_honest_none_no_broker_fallback()
    test_ageless_land_type_nulls_age_even_if_rega_has_one()
    test_gas_station_ageless()
    test_rega_property_age_provenance_captured()
    print("OK — mizlaj REGA-age regression tests pass")
