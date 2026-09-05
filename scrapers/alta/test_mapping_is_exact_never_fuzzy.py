"""alta's type mapping must stay EXACT — the fuzzy matcher mis-files this source.

The defect this pins, found live 2026-09-05 while building the scraper:
`normalize.map_type("محلات ومعارض")` (shops and showrooms) returns **"Residential Land"**. A
fuzzy fallback would therefore have filed every shop on this site as a plot of land — plausible
in the data, invisible in review, and a listing-fidelity breach.

Also pinned here, because each one silently corrupts rather than crashes:
  · «طلب جاد» is a WANTED ad and must never be ingested as inventory.
  · تم البيع / تم التأجير / غير متاح mean active=false; NO status means active (absence of a sold
    marker is not evidence of a sale).
  · category_for_type returns "Residential"/"Commercial" — the run splits on the LOWERCASE form,
    so a capitalisation slip would silently route every row to the residential table.
"""
import sys
import types
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
sys.modules.setdefault("scrapers.common.db", types.ModuleType("scrapers.common.db"))

from scrapers.common import normalize  # noqa: E402
from scrapers.alta.run import TYPE_OVERRIDES, TYPE_UNMAPPABLE, WANTED_AD, map_listing  # noqa: E402

# 1. THE REASON THIS FILE EXISTS: the fuzzy matcher is wrong for this source's combined categories.
assert normalize.map_type("محلات ومعارض") == "Residential Land", (
    "upstream fuzzy behaviour changed — re-check whether alta may now use map_type")
assert "محلات ومعارض" in TYPE_UNMAPPABLE, "the mis-fuzzing category must stay on the refuse list"

# 2. Every override is a real canonical type, and agrees with the singular the house map knows.
SINGULAR = {"أراضي": "أرض", "احواش": "حوش", "فلل": "فيلا", "فنادق": "فندق",
            "مزارع": "مزرعة", "عمائر وأبراج": "عمارة"}
for plural, canon in TYPE_OVERRIDES.items():
    assert normalize.map_type_exact(SINGULAR[plural]) == canon, (
        f"{plural}→{canon} disagrees with the house map for {SINGULAR[plural]}")

# 3. No override may collide with the refuse list (a type is mapped or refused, never both).
assert not (set(TYPE_OVERRIDES) & set(TYPE_UNMAPPABLE))


def _tax(**kw):
    """Build the {taxonomy: {id: name}} shape fetch_taxonomies returns."""
    base = {k: {} for k in ("property_category", "property_action_category", "property_city",
                            "property_area", "property_status", "property_features")}
    for k, names in kw.items():
        base[k] = {i: n for i, n in enumerate(names, start=1)}
    return base


def _post(cats, actions, statuses=(), body="", link="https://alta.com.sa/estate_property/x/"):
    tax = _tax(property_category=cats, property_action_category=actions,
               property_status=statuses)
    p = {"link": link, "slug": "x", "id": 1,
         "property_category": list(range(1, len(cats) + 1)),
         "property_action_category": list(range(1, len(actions) + 1)),
         "property_status": list(range(1, len(statuses) + 1)),
         "title": {"rendered": "t"}, "content": {"rendered": body}}
    return map_listing(p, tax)

# 4. A wanted-ad is never inventory — in either taxonomy.
assert _post([WANTED_AD], ["بيع"])[0] is None
assert _post(["شقق"], [WANTED_AD])[0] is None

# 5. A refused category yields no row (it is skipped, not guessed into some near-miss type).
assert _post(["محلات ومعارض"], ["بيع"])[0] is None

# 6. The happy path still maps, and lands in a LOWERCASE category the run can route on.
row, cat = _post(["شقق"], ["بيع"])
assert row is not None and row["property_type"] == "Apartment"
assert cat == "residential", f"category must be lowercase for the run's split, got {cat!r}"
row, cat = _post(["مصنع"], ["بيع"])
assert cat == "commercial", f"commercial rows must route to the commercial table, got {cat!r}"

# 7. Sold/rented/unavailable → inactive. No status at all → ACTIVE (unknown is not "gone").
for gone_status in ("تم البيع", "تم التأجير", "غير متاح"):
    row, _ = _post(["شقق"], ["بيع"], [gone_status])
    assert row["active"] is False, f"{gone_status} must set active=false"
assert _post(["شقق"], ["بيع"], ["متاح"])[0]["active"] is True
assert _post(["شقق"], ["بيع"], [])[0]["active"] is True, "no status must NOT be read as sold"

# 8. PRICE = SOURCE. A stated figure is kept verbatim; silence stays NULL and is never derived.
row, _ = _post(["شقق"], ["بيع"], [], "شقة جميلة السعر: 600,000 ريال قابل للتفاوض")
assert row["price_total"] == 600000, row["price_total"]
row, _ = _post(["شقق"], ["بيع"], [], "شقة جميلة بمساحة 150 متر")
assert row["price_total"] is None and row["price_annual"] is None
assert row["price_per_meter"] is None, "price_per_meter is a calculation and must never be stored"

# 9. A rent row with no period token keeps rent_period NULL — never a manufactured 'annual'.
row, _ = _post(["شقق"], ["ايجار"], [], "شقة للايجار السعر: 50,000 ريال")
assert row["rent_period"] is None, f"period must come from the source, got {row['rent_period']!r}"
row, _ = _post(["شقق"], ["ايجار"], [], "شقة للايجار السعر: 50,000 ريال سنوياً")
assert row["rent_period"] == "annual"

print("ok: alta mapping is exact-only, wanted-ads excluded, sold→inactive, price/period = source")

# 10. THE SOLD-PIN. Observed 2026-09-05: the first successful run landed at 05:20 UTC — the minute
#     auto_recover_false_inactive() fires — and all 9 source-confirmed sold rows came back
#     active=true, missing_count=0. The honest active=false is written, then erased, unless the
#     run pins it. Pin the SHAPE here: run.py must call _pin_sold_inactive AFTER the upsert, for
#     both tables, and it must write BOTH active=false and a missing_count above the recover
#     job's `coalesce(missing_count,0)=0` condition.
import inspect  # noqa: E402
import re as _re  # noqa: E402
from scrapers.alta import run as _run  # noqa: E402

_pin = inspect.getsource(_run._pin_sold_inactive)
assert '"active": False' in _pin and '"missing_count": 3' in _pin, (
    "the pin must set BOTH active=false and missing_count>0, or the sweep re-activates it")

_main = inspect.getsource(_run.main)
_up = _main.index("upsert_alta_commercial_batch")
assert _main.index("_pin_sold_inactive") > _up, "the pin must run AFTER the upsert resets missing_count"
for tbl in ("alta_residential_listings", "alta_commercial_listings"):
    assert f'_pin_sold_inactive("{tbl}"' in _main, f"{tbl} sold rows are never pinned"
assert _re.search(r'if not row\["active"\]:\s*\n\s*\(sold_com if cat == "commercial" else sold_res\)',
                  _main), "sold ad_numbers must be collected per category"

print("ok: alta sold rows are pinned after upsert so the 05:20 sweep cannot resurrect them")
