"""aqaralsaudia: the two things that can silently go wrong on this source.

1. قيد الإنشاء (under construction) must NEVER be upserted. Owner rule 2026-09-13: a COMPLETED
   property is a real listing; one that is not yet built is not. 3 of the site's 19 posts carry
   this status, and they are also the only 3 with no size and no rooms.
2. The district must come from the address's FIRST segment when that segment is a real place, and
   only fall back to the title's "بحي X" phrase. Getting this backwards silently files 12 of the 19
   under the wrong name, and an apartment number ("رقم (12)") or a sub-plan ("مخطط الشروق") must
   never end up in the district — that is the number-in-the-picker leak the fleet already guards.
"""
import sys
import types
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
sys.modules.setdefault("scrapers.common.db", types.ModuleType("scrapers.common.db"))
import scrapers.common.arabic_location as _al  # noqa: E402
_al.to_catalog = lambda city_ar: (None, None)   # DB-backed lookup; unit-irrelevant here

from scrapers.aqaralsaudia import run  # noqa: E402

# The page-fetch fallback is a NETWORK call; a unit test must never depend on it. Stubbed to None
# so every assertion below exercises only what the feed itself states.
run.deal_from_page = lambda url: None


def _post(pid=1, title="", status=None, ptype=None, addr="", price="700000", size="150",
          beds="4", baths="3", features=None):
    terms = []
    if ptype:
        terms.append({"taxonomy": "property-type", "name": ptype})
    for s in (status or []):
        terms.append({"taxonomy": "property-status", "name": s})
    for f in (features or []):
        terms.append({"taxonomy": "property-feature", "name": f})
    return {
        "id": pid,
        "link": f"https://aqaralsaudia.com/property/x-{pid}/",
        "title": {"rendered": title},
        "content": {"rendered": ""},
        "property_meta": {
            "REAL_HOMES_property_price": price,
            "REAL_HOMES_property_size": size,
            "REAL_HOMES_property_bedrooms": beds,
            "REAL_HOMES_property_bathrooms": baths,
            "REAL_HOMES_property_address": addr,
        },
        "_embedded": {"wp:term": [terms]},
    }


RIYADH_LABAN = "لبن, ظهرة لبن, بلدية العريجاء, محافظة الرياض, منطقة الرياض, 13874, السعودية"
RIYADH_ONLY = "منطقة الرياض, السعودية"

# ── 1. قيد الإنشاء IS NEVER UPSERTED ────────────────────────────────────────────────────────────
row, _ = run.map_listing(_post(title="شقق تمليك حي لبن", status=["قيد الإنشاء"], ptype="شقة",
                               addr=RIYADH_ONLY, size="", beds="", baths=""))
assert row is None, "a not-yet-built listing must never be upserted (owner rule 2026-09-13)"

# the same post WITHOUT that status is a real listing and must come through
row, _ = run.map_listing(_post(title="شقق تمليك حي لبن", status=["للبيع"], ptype="شقة",
                               addr=RIYADH_ONLY))
assert row is not None, "a completed listing must be kept"

# ── 2. DISTRICT: address first segment wins over the title ──────────────────────────────────────
row, _ = run.map_listing(_post(title="شقة فاخرة للبيع بحي لبن رقم (12)", ptype="شقة",
                               addr=RIYADH_LABAN))
assert row["district_ar"] == "لبن", f'address segment should win, got {row["district_ar"]!r}'
assert row["city_ar"] == "الرياض"

# an apartment number must NEVER reach the district
assert "12" not in (row["district_ar"] or ""), "an apartment number must never enter the district"
assert "رقم" not in (row["district_ar"] or "")

# ── 3. DISTRICT falls back to the title when the address has no district ────────────────────────
row, _ = run.map_listing(_post(title="دور اول فاخر بحي البيان شرق الرياض", ptype="دور",
                               addr=RIYADH_ONLY, status=["للبيع"]))
assert row["district_ar"] == "البيان", f'title fallback failed: {row["district_ar"]!r}'
assert "شرق" not in row["district_ar"], "a direction word must not be glued onto the district"

# a sub-plan in parentheses must not reach the district either
row, _ = run.map_listing(_post(title="دور أول بحي الجنادرية (مخطط الشروق)", ptype="دور",
                               addr=RIYADH_ONLY, status=["للبيع"]))
assert row["district_ar"] == "الجنادرية", f'got {row["district_ar"]!r}'
assert "مخطط" not in row["district_ar"], "a مخطط sub-plan must never enter the district"

# ── 3b. A POST WITH NO DEAL ANYWHERE IS SKIPPED, NEVER DEFAULTED TO Buy ─────────────────────────
# 8 of the 19 state the deal only on their own page; with that fetch stubbed out they must drop
# rather than be assumed. This is the guard against "it's a sales office, so default to Buy".
row, _ = run.map_listing(_post(title="دور اول فاخر بحي البيان", ptype="دور", addr=RIYADH_ONLY))
assert row is None, "no stated deal anywhere must skip the row, never default to Buy"

# ── 4. CITY comes only from the source's own address text, never assumed ────────────────────────
row, _ = run.map_listing(_post(title="شقة للبيع بحي لبن", ptype="شقة", addr=""))
assert row["city_ar"] is None, "no address means no city — never defaulted to الرياض"

# ── 5. ABSENT NUMBERS STAY ABSENT (never 0) ─────────────────────────────────────────────────────
row, _ = run.map_listing(_post(title="شقة للبيع بحي لبن", ptype="شقة", addr=RIYADH_LABAN,
                               price="", size="", beds="", baths=""))
assert row["price_total"] is None and row["area_m2"] is None, "blank must be NULL, never 0"
assert row["bedrooms"] is None and row["bathrooms"] is None

# ── 6. AMENITIES map only where the source actually states them ─────────────────────────────────
row, _ = run.map_listing(_post(title="شقة للبيع بحي لبن", ptype="شقة", addr=RIYADH_LABAN,
                               features=["مصعد", "تكييف", "أرضيات رخامية"]))
assert row.get("elevator") is True and row.get("air_conditioner") is True
assert "marble" not in row, "an unmapped feature must not invent a column"

row, _ = run.map_listing(_post(title="شقة للبيع بحي لبن", ptype="شقة", addr=RIYADH_LABAN))
assert "elevator" not in row, "an unstated amenity must stay absent, never False"

# ── 7. DEAL is stated, never assumed ────────────────────────────────────────────────────────────
row, _ = run.map_listing(_post(title="شقة فاخرة بحي لبن", ptype="شقة", addr=RIYADH_LABAN,
                               status=["للبيع"]))
assert row["transaction_type"] == "Buy" and row["price_total"] == 700000
assert row["price_annual"] is None

row, _ = run.map_listing(_post(title="شقة للإيجار بحي لبن", ptype="شقة", addr=RIYADH_LABAN))
assert row["transaction_type"] == "Rent", "the title's own للإيجار must be honoured"
assert row["price_total"] is None and row["price_annual"] == 700000

# ── 7b. THE LINK IS THE SOURCE'S OWN, NEVER CONSTRUCTED ─────────────────────────────────────────
# 2026-09-13: the owner clicked a card and landed on the office's 404 page. Cause: a URL that had
# been shortened/typed by hand instead of copied from the source. A made-up link sends a real user
# to a dead page on the publisher's own site, so it must be impossible, not merely unlikely.
row, _ = run.map_listing(_post(pid=4242, title="شقة للبيع بحي لبن", ptype="شقة", addr=RIYADH_LABAN))
assert row["listing_url"] == "https://aqaralsaudia.com/property/x-4242/", (
    "listing_url must be the source's own `link` field, copied verbatim — never built from the "
    "title, never transliterated, never shortened")

# and if the source gives no link at all, the fallback is the site's own ?p=<id> permalink, which
# WordPress always resolves — not an invented /property/<slug>/ path that may not exist
post_no_link = _post(pid=77, title="شقة للبيع بحي لبن", ptype="شقة", addr=RIYADH_LABAN)
del post_no_link["link"]
row, _ = run.map_listing(post_no_link)
assert row["listing_url"] == "https://aqaralsaudia.com/?p=77", f'got {row["listing_url"]!r}'
assert "/property/" not in row["listing_url"], "never fabricate a /property/<slug>/ path"

# ── 8. AN UNMAPPED TYPE IS SKIPPED, NEVER GUESSED ───────────────────────────────────────────────
row, _ = run.map_listing(_post(title="شيء غير معروف", ptype="نوع غير موجود", addr=RIYADH_LABAN))
assert row is None, "an unmappable type is skipped, never assumed"

print("ok: aqaralsaudia excludes قيد الإنشاء, resolves district address-first then title, never "
      "lets an apartment number or مخطط into the district, never defaults a city, keeps blanks "
      "NULL, and only sets amenities the source actually states")
