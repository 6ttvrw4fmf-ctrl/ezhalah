"""Regression test for scrapers/fursaghyr/run.py's price_total resolution.

fursaghyr.com's rea payload carries `total_price` (stored verbatim when present) and `meter_price`.

- 2026-07-28: ad FG26842 has total_price=null and meter_price=55000, and the live page shows
  "55000 SAR" as THE price. A meter_price >= 50,000 is not a real SAR/m² rate, so it is a raw total
  in the wrong field. It is used directly and never multiplied.
- 2026-09-21 (owner, PR #3450): a plausible rate with no total_price stores NO total. The 07-28 rule
  filled price_total with meter × area. Owner rule 2026-09-03 now puts that derivation in the
  search/display layer only (price_total_effective / derivedTotalFromPerMeter). The rate stays in
  price_per_meter. The scraper sends AUTHORITATIVE_NULL so the rate × area totals it stored before
  get cleared, instead of being frozen by the upsert's None-dropping guard.

Run: python -m pytest scrapers/common/tests/test_fursaghyr_total_price_fallback.py -v
"""
import sys

sys.path.insert(0, ".")

from scrapers.common import db  # noqa: E402
from scrapers.fursaghyr.run import _resolve_total, map_listing  # noqa: E402


def _row(**rea):
    row, _ = map_listing({"id": 1, "rea": {"property_type": "أرض", **rea}})
    return row


def test_total_price_present_used_verbatim_unchanged():
    # ad FG24982-shape: total_price published → stored as-is.
    assert _resolve_total(369720, 1185) == 369720


def test_real_repro_missing_total_implausible_rate_used_directly():
    # ad FG26842, live 2026-07-28.
    assert _resolve_total(None, 55000) == 55000


def test_missing_total_plausible_rate_is_never_multiplied():
    assert _resolve_total(None, 1185) is None


def test_missing_total_no_meter_stays_none():
    assert _resolve_total(None, None) is None


def test_sale_row_with_rate_only_clears_the_old_derived_total():
    row = _row(purpose="بيع", land_area=312, meter_price=1185)
    assert row["price_total"] is db.AUTHORITATIVE_NULL, "must CLEAR a stored rate × area, not be dropped"
    assert row["price_per_meter"] == 1185, "the source rate is kept, so display derives the ≈ total"
    db._unknown_must_not_overwrite_known(row)
    assert "price_total" in row and row["price_total"] is None, "the upsert must write the NULL"


def test_rent_row_with_rate_only_clears_price_annual():
    row = _row(purpose="إيجار", land_area=312, meter_price=1185)
    assert row["price_annual"] is db.AUTHORITATIVE_NULL
    assert row["price_total"] is None


def test_published_total_and_raw_total_in_meter_field_are_stored():
    assert _row(purpose="بيع", land_area=312, meter_price=1185, total_price=369720)["price_total"] == 369720
    assert _row(purpose="إيجار", land_area=149, meter_price=55000)["price_annual"] == 55000


def test_no_rate_and_no_total_is_unknown_not_authoritative():
    # Nothing to clear and nothing the source settled: None, which the upsert drops.
    assert _row(purpose="بيع", land_area=312)["price_total"] is None


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_"):
            fn()
    print("OK — fursaghyr total-price tests pass")
