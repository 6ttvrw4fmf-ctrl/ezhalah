"""شموع الشمال publishes NO price, and this scraper must keep saying so.

Verified live 2026-09-05 three independent ways: the REST meta has 42 keys and the only
price-shaped one is `fave_show_price_placeholder` (a display toggle); the detail page's JSON-LD is
a `Place` with no offer; the rendered page shows «اتصل». Houzez keeps prices in
`fave_property_price`, which this site does not expose.

That makes NULL the TRUTHFUL value. The failure this pins is the tempting "fix": someone notices
every price is empty, assumes a parse bug, and back-computes one from area — manufacturing a
figure the source never published. price_total / price_annual / price_per_meter must all stay
NULL no matter what else the payload carries.

Also pinned: rent_period is never defaulted to 'annual' (the 2026-08-11 audit defect that put
سنوي on 187 rows across 11 scrapers), and a feature TAG never becomes a COUNT.
"""
import sys
import types
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
sys.modules.setdefault("scrapers.common.db", types.ModuleType("scrapers.common.db"))

from scrapers.shmoualshmal.run import FEATURE_COLUMN, map_listing  # noqa: E402


def _call(type_name="فيلا", status="للبيع", city="تبوك", area="حي الصفا",
          features=(), meta=None):
    tax = {
        "property_type": {1: type_name},
        "property_status": {1: status},
        "property_city": {1: city},
        "property_area": {1: area},
        "property_feature": {i: f for i, f in enumerate(features, start=1)},
        "property_label": {},
    }
    p = {"link": "https://shmoua-alshmal.com/property/x/", "slug": "x", "id": 1,
         "property_type": [1], "property_status": [1], "property_city": [1],
         "property_area": [1], "property_feature": list(range(1, len(features) + 1)),
         "title": {"rendered": "فيلا"}, "content": {"rendered": "وصف"},
         "property_meta": meta or {}}
    return map_listing(p, tax)

# 1. THE CORE FACT: no price, whatever else the payload says.
row, _ = _call(meta={"fave_property_size": ["452"], "fave_property_bedrooms": ["5"],
                     "fave_show_price_placeholder": ["0"]})
assert row is not None
assert row["price_total"] is None, "the source publishes no price — NULL is the truthful value"
assert row["price_annual"] is None
assert row["price_per_meter"] is None, "never back-compute a price from area"

# 2. Area and bedrooms ARE published and must survive — the row is thin, not empty.
assert row["area_m2"] == 452 and row["bedrooms"] == 5

# 3. Period is never defaulted, on either transaction.
assert row["rent_period"] is None
rent, _ = _call(status="للإيجار")
assert rent["transaction_type"] == "Rent"
assert rent["rent_period"] is None, "no source token → no period, never a manufactured 'annual'"

# 4. Transaction comes from the site's own status taxonomy; an unstated one yields no row.
assert _call(status="للبيع")[0]["transaction_type"] == "Buy"
assert _call(status="متاحة")[0] is None, "no stated transaction → not ingestible"

# 5. A feature TAG sets a boolean, never a count. «مجلس» maps to nothing on purpose:
#    reception_rooms_majlis is a COUNT and a presence tag does not state one.
row, _ = _call(features=("غرفة خادمة", "مجلس"))
assert row["maid_room"] is True
assert row.get("reception_rooms_majlis") is None, "a presence tag must never become a count"
assert "مجلس" not in FEATURE_COLUMN
#    ...and an unmapped tag is preserved verbatim rather than dropped or approximated.
assert "مجلس" in (row["additional_info"].get("features_ar") or [])

# 6. An absent feature stays NULL — never False. (Silence is not a denial.)
row, _ = _call(features=())
assert row.get("maid_room") is None, "absence must stay NULL, not False"

# 7. The row records WHY the price is empty, so a later reader cannot mistake it for a parse gap.
assert row["additional_info"]["price_published"] is False

print("ok: shmoualshmal price stays NULL by source truth; period never defaulted; tags never counts")
