"""gathern: «monthly» must come from the unit's own card, never from our request echoed back.

`_is_monthly_available()` fell back to "the card carries selected_check_in/out" when a unit showed
neither nights=30 nor long_stay. But gathern echoes our dates on EVERY card, nightly-priced ones
included. Measured 2026-09-28 on a one-night request (Khobar): nights=1, long_stay=false,
final_price=500, both dates set. The fallback turned that into a 500 SAR «monthly» rent — period and
price both manufactured by us. FAILS on the pre-fix code.
"""
import scrapers.gathern.run as g

# The exact card shape gathern returns for a ONE-night window (2026-09-28).
_NIGHTLY = {
    "id": 263732, "unit_id": 263732, "chalet_id": 190001, "unit_type_id": 6,
    "nights": 1, "long_stay": False,
    "selected_check_in": "2026-09-29", "selected_check_out": "2026-09-30",
    "final_price": 500, "price": "500",
    "event_data": {"city_en": "Al Khobar", "city_ar": "الخبر"},
    "address": {"city": "الخبر"},
}


def test_a_nightly_price_is_never_filed_as_a_monthly_rent(monkeypatch):
    monkeypatch.setattr(g.AL, "resolve", lambda *a, **k: {
        "city_ar": None, "city_id": None, "region_id": None, "district_ar": None,
        "confidence": "unresolved"})
    assert g.map_listing(_NIGHTLY) is None
    # the same unit priced for 30 nights IS a monthly rent — the guard must not over-reject
    monthly = dict(_NIGHTLY, nights=30, long_stay=True, selected_check_out="2026-10-29",
                   final_price=4532.4, price="4,532.40")
    row = g.map_listing(monthly)
    assert row and row["rent_period"] == "monthly" and row["price_annual"] == 4532 * 12
