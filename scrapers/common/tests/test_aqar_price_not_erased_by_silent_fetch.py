"""A fetch that saw no price must not delete a price we already stored.

An upsert sends the whole row, so `price_annual: None` writes NULL over whatever was there. That
default is wrong for aqar specifically: «this fetch found no price» and «this listing has no price»
are different statements, and aqar makes the first one often — it renders «طلب تسويق» instead of a
figure on a large minority of live ads (74/234 sampled live on 2026-08-09), and it withholds fields
from anonymous fetches (see reference_aqar-liveness-source-verification-method).

Dropping the key rather than sending NULL is correct in both directions: a NEW row still lands with
the column NULL, an EXISTING row keeps what it had, and a price only moves when the source publishes
a number to move it to.

GENERALISED 2026-08-09 to the whole fleet and every field, on the owner's permanent SOURCE IS TRUTH
rule — the guard is now `_unknown_must_not_overwrite_known` and runs on every upsert path. These
tests stay because they carry the aqar EVIDENCE that motivated it; the fleet-level contract lives in
test_source_is_truth_fleet_invariants.py.
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[3]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scrapers.common.db import _unknown_must_not_overwrite_known as guard  # noqa: E402


@pytest.mark.parametrize("col", ["price_annual", "price_total", "price_per_meter"])
def test_a_none_price_is_dropped_rather_than_written(col):
    row = {"ad_number": "6600001", col: None, "bedrooms": 3}
    guard(row)
    assert col not in row, f"{col}=None would have overwritten the stored price with NULL"
    assert row["bedrooms"] == 3, "only price columns are touched"


@pytest.mark.parametrize("col,value", [
    ("price_annual", 16000),
    ("price_total", 1200000),
    ("price_per_meter", 5500),
])
def test_a_published_price_still_moves(col, value):
    row = {"ad_number": "6600001", col: value}
    guard(row)
    assert row[col] == value, "a source-published number must always be written"


def test_zero_is_a_value_not_an_absence():
    """0 reaches the guard only if something upstream chose to write it; that choice is not ours
    to silently undo here."""
    row = {"price_annual": 0}
    guard(row)
    assert row["price_annual"] == 0


def test_every_listing_field_is_protected_not_just_price():
    """Originally price-only. The owner's 2026-08-09 rule extends it to every scraped field: an
    unreadable bedroom count is no more entitled to erase a verified one than an unreadable price."""
    row = {"bedrooms": None, "furnished": None, "property_age": None, "price_annual": None}
    guard(row)
    assert row == {}, "no unreadable field may overwrite a stored value"


def test_guard_is_wired_into_both_aqar_upserts():
    """A guard nobody calls is not a guard. Both aqar tables share the «طلب تسويق» exposure."""
    src = (ROOT / "scrapers" / "common" / "db.py").read_text()
    for fn in ("upsert_aqar_residential", "upsert_aqar_commercial"):
        body = src.split(f"def {fn}(", 1)[1].split("\ndef ", 1)[0]
        assert "_unknown_must_not_overwrite_known(row)" in body, f"{fn} does not call the guard"
