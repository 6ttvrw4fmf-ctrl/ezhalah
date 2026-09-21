"""wasalt's price/area parse must stay on the JSON-number path (int() / measure_num) — the ONE refactor that
would make the 1000x land-price bug real instead of imaginary.

Why this exists. The «wasalt x1000 land prices» hypothesis has now been raised FOUR times (2026-08-22,
the standing field_integrity P1, 2026-08-28, 2026-09-18) and was wrong every time: wasalt genuinely
publishes those figures, and docs/ops/DATA_INTEGRITY_ENGINEER.md §25/§25a settles it against 172/172
rows of its own archived payload. Nothing in our code inflates anything.

But the reason it CANNOT is a single unguarded implementation detail. run.py maps price with a bare
`int(info["salePrice"])` on a JSON-native number, and area with `normalize.measure_num(carpetArea)` (exact since 2026-09-21). Swap either
for the shared `normalize.to_int()` helper — an entirely reasonable-looking tidy-up, and run.py has a
comment begging you not to — and a 3-decimal value is read as EUROPEAN DIGIT GROUPING:
`to_int("3523.967") == 3523967`. On the real Makkah land listing below that turns a 3,523.967 m plot
into 3,523,967 m, and the same swap on the price turns 24,829,872.186 into 24,829,872,186.

That is the exact 1000x defect four investigations went looking for. It is not in the code today. This
barrier is what keeps it that way, because a comment is not a code path.

The payload is the REAL one (wasalt id 5908995 / our 11939802), read live from wasalt.sa on
2026-09-18 and independently re-archived by the enricher hours later — both agree to the digit.

Run: python -m pytest scrapers/common/tests/test_wasalt_price_parse_cannot_inflate.py -v
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

from scrapers.common import normalize          # noqa: E402
from scrapers.wasalt.run import map_property   # noqa: E402  -- the REAL mapper, never a copy

# Exactly what wasalt publishes for this listing, trimmed to the keys map_property reads.
SALE_PRICE = 24829872186
CARPET_AREA = "3523.967"          # a STRING with three decimals — the whole hazard
# NOTE the key: the SEARCH payload map_property() consumes calls this `builtUpArea`; the DETAIL
# payload archived into ar_data calls the same figure `carpetArea`. Using the detail-page name here
# silently yields area_m2=None and the barrier tests nothing — which is exactly what happened on the
# first draft of this file, caught by the assertion below.
REAL_PAYLOAD = {
    "id": 5908995,
    "attributes": [{"key": "builtUpArea", "value": CARPET_AREA, "unit": "متر مربع"}],
    "propertyInfo": {
        "slug": "land-3523967-sqm-facing-3-streets-on-30m-width-street-5908995",
        "title": "Land 3523.967 SQM Facing 3 Streets on 30m Width Street",
        "salePrice": SALE_PRICE,
        "conversionPrice": SALE_PRICE,
        "averageSalePricePerSqm": 7046000,
        "currencyType": "ر.س",
        "conversionUnit": "ر.س",
        "propertySubType": "Land",
        "city": "Makkah",
        "unitType": "متر مربع",
    },
}


def _mapped():
    row = map_property(REAL_PAYLOAD, "sale", None)
    assert row is not None, "map_property refused the real payload — the fixture drifted from run.py"
    return row


def test_price_total_is_the_source_number_unchanged():
    """PRICE = SOURCE. Not rounded, not scaled, not recomputed from area."""
    assert _mapped()["price_total"] == SALE_PRICE


def test_a_fractional_price_truncates_and_is_never_multiplied_by_1000():
    """The assertion above is NOT enough on its own, and this is why.

    wasalt sends salePrice as a JSON integer today, and on an integer `int()` and
    `normalize.to_int()` return the SAME answer — so swapping them is invisible to any test that
    only feeds an integer. (Measured: the price mutant survived the first draft of this file.)
    A FRACTIONAL price is where they diverge, and it is the shape the whole 1000x story imagined:
    int(24829872.186) -> 24,829,872 (correct, floored), to_int("24829872.186") -> 24,829,872,186.

    So pin the invariant on the shape that can actually move, not on the one that happens to be
    safe today."""
    fractional = {**REAL_PAYLOAD,
                  "propertyInfo": {**REAL_PAYLOAD["propertyInfo"], "salePrice": 24829872.186}}
    assert map_property(fractional, "sale", None)["price_total"] == 24829872


def test_area_is_exact_and_is_never_multiplied_by_1000():
    """3523.967 m is stored as 3523.967 — NOT 3,523,967, and (since 2026-09-21, exact measurements)
    no longer floored to 3523 either. This is the assertion that dies first if anyone routes area
    through to_int() or to_measure() (both read 3 decimals as thousands grouping)."""
    row = _mapped()
    assert row["area_m2"] is not None, "area did not parse at all — check the builtUpArea key above"
    assert row["area_m2"] == 3523.967


def test_price_is_not_derived_from_area_at_all():
    """A total that tracks area is a computed price. Halve the area; the price must not move."""
    halved = {**REAL_PAYLOAD, "attributes": [{"key": "builtUpArea", "value": "1761.9"}]}
    assert map_property(halved, "sale", None)["price_total"] == SALE_PRICE


# --- mutation proof: the helper this must never be swapped for really would inflate -------------
# Without this the tests above could pass for the wrong reason (e.g. if to_int were harmless here),
# and the barrier would be asserting nothing.

def test_to_int_would_inflate_the_area_1000x():
    assert normalize.to_int(CARPET_AREA) == 3523967, (
        "to_int no longer reads 3 decimals as European grouping. If that changed deliberately, this "
        "barrier's premise moved — re-read normalize.to_int's docstring before relaxing anything."
    )


def test_to_int_would_inflate_a_fractional_price_1000x():
    assert normalize.to_int("24829872.186") == 24829872186


def test_the_two_helpers_are_not_interchangeable():
    """to_int_numeric is the safe one; to_int is not. Different answers on the same input is the
    whole reason run.py keeps its own parse."""
    assert normalize.to_int_numeric(CARPET_AREA) == 3523
    assert normalize.to_int(CARPET_AREA) != normalize.to_int_numeric(CARPET_AREA)
