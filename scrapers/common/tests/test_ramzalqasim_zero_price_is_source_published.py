"""ramzalqasim's price of 0 is SOURCE-PUBLISHED and must be preserved exactly (2026-08-10).

THE INVESTIGATION THIS LOCKS IN
-------------------------------
Six ramzalqasim rows store price_total = 0, three of them searchable, and they rank above every
genuinely priced listing in عنيزة on cheapest-first. That LOOKS like the classic sentinel bug —
a source's "no price / السوم" placeholder parsed as a real number — and the 2026-08-10 senior audit
initially suspected exactly that, because 0 of 188 ramzalqasim rows carry a NULL price (so the
pipeline appeared unable to express "not stated") and the ad copy contains no price.

IT WAS WRONG. A read-only probe run against the live source from GitHub Actions
(.github/workflows/ramzalqasim-zero-price-probe.yml, run 31382195933, 2026-08-10 11:09Z) settled it
at BOTH layers:

  Layer 1 — the updateMapMarkers payload the scraper parses:
      id 226/252/253/200/199/147 → price = str '0.00'
      Not null, not absent, not an empty string. Distribution across the whole catalogue:
      179 non-zero, 6 zero, 0 null, 0 absent, 0 empty.

  Layer 2 — the PUBLIC page a human opens, e.g. https://ramzalqasim.com/x/253:
      «… يبعد 3.5 كم عن مستشفى الحياة الوطني. السعر: 0 ر.س للبيع للاستفسار المباشر …»
      i.e. "PRICE: 0 SAR". All six render it. The control listing id 251 renders
      «السعر: 540,000 ر.س» in the SAME slot with the SAME markup, so the extraction is sound and
      the two cases are directly comparable.

The site publishes the number 0 in the very place a real price appears. It does not hide it, does
not write «السوم», does not say "price on request". Under the owner's standing rule — SOURCE IS
TRUTH, a source-published value is preserved at ANY magnitude, and an implausible-looking number is
never "corrected" because it looks wrong — the correct stored value is 0, exactly as it is today.

SO THIS TEST GUARDS THE OPPOSITE OF WHAT THE BUG REPORT ASSUMED. It exists because the next
engineer (or agent) to notice "0 SAR listings ranking first" will be tempted to null them, and that
would be a fidelity violation, silently destroying a value the source really publishes. It is the
same class of mistake as the 2026-08-09 sub-1000 Buy gate that had to be reverted (PR#385), and the
extreme-price gate reverted before it.

If ramzalqasim ever stops publishing 0 — if the payload starts sending null/""/absent for these —
that is a DIFFERENT situation and honest NULL becomes correct. Re-run the probe before changing
anything; do not infer it from the database.

Run: python -m pytest scrapers/common/tests/test_ramzalqasim_zero_price_is_source_published.py
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

from scrapers.ramzalqasim.run import map_marker  # noqa: E402

# Captured VERBATIM from the live payload by the probe run above (PDPL: owner_name/owner_phone,
# which the real payload also carries, are deliberately not reproduced here).
ZERO_PRICE_MARKER = {
    "id": 253,
    "price": "0.00",
    "area": 315,
    "status": "sell",
    "type": "land",
    "city": "عنيزة",
    "district": "المصيف",
    "real_estate_age": "جديد",
    "width_street": "20",
    "bedrooms": 0,
    "bathroom": 0,
    "avalible": "available",
}

# The control from the same payload — proves the test compares like with like.
REAL_PRICE_MARKER = {**ZERO_PRICE_MARKER, "id": 251, "price": "540000.00", "type": "role",
                     "area": 231.86, "district": "الخزامى", "bedrooms": 2, "bathroom": 4}


def _row(marker: dict) -> dict:
    row, _category, _gone = map_marker(marker)
    assert row is not None, f"marker {marker['id']} was dropped entirely — a published listing vanished"
    return row


def test_zero_price_is_stored_as_zero_not_null() -> None:
    """The load-bearing assertion. ramzalqasim publishes «السعر: 0 ر.س»; we store 0."""
    row = _row(ZERO_PRICE_MARKER)
    assert row["price_total"] == 0, (
        f"price_total is {row['price_total']!r}, expected 0. ramzalqasim PUBLISHES «السعر: 0 ر.س» on "
        "the public page (verified live 2026-08-10, probe run 31382195933). Nulling it would "
        "destroy a source-published value — the exact fidelity violation the owner rule forbids."
    )


def test_zero_price_listing_is_not_dropped_or_deactivated() -> None:
    """A 0 price must not make the listing disappear or be marked gone."""
    row, category, gone = map_marker(ZERO_PRICE_MARKER)
    assert row is not None, "a 0-priced listing must still be ingested"
    assert gone is False, "a 0 price is not a liveness signal — the ad is available on the source"
    assert category == "residential"


def test_zero_price_does_not_fabricate_a_per_metre_rate() -> None:
    """Never derive a rate from a price we did not receive (aqar PR#216 / scrapers PR#217)."""
    row = _row(ZERO_PRICE_MARKER)
    assert row["price_per_meter"] is None, (
        f"price_per_meter is {row['price_per_meter']!r} — must stay NULL; the source publishes no "
        "per-m² rate and 0/315 is not a value the source ever stated"
    )
    assert row["price_annual"] is None, "a 'sell' listing must not populate price_annual"


def test_a_real_price_still_round_trips() -> None:
    """Control: if this ever fails, the test above proves nothing."""
    row = _row(REAL_PRICE_MARKER)
    assert row["price_total"] == 540000, f"control price mis-parsed: {row['price_total']!r}"
    assert row["price_annual"] is None


def test_zero_is_distinguishable_from_a_genuinely_absent_price() -> None:
    """The rule only protects a PUBLISHED 0. If the source ever sends nothing, we store nothing.

    This is the branch that must stay honest: absent/null/empty are NOT 0. If ramzalqasim changes
    its payload to omit the price, the correct stored value becomes NULL — and this test makes that
    behaviour explicit rather than accidental, so the two cases can never be conflated.
    """
    for missing in ({k: v for k, v in ZERO_PRICE_MARKER.items() if k != "price"},
                    {**ZERO_PRICE_MARKER, "price": None},
                    {**ZERO_PRICE_MARKER, "price": ""}):
        row = _row(missing)
        assert row["price_total"] is None, (
            f"an absent/null/empty source price must be stored as NULL, got {row['price_total']!r} "
            "— honest NULL beats a guess, and it must never be conflated with a published 0"
        )
