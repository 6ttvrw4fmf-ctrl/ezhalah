"""رمال carries all its structure in `class_list`, and its detail page carries OTHER listings' photos.

THE IMAGE TRAP THIS PINS, measured 2026-09-06 before the scraper was written: the detail page holds
~33 image URLs, and TWO DIFFERENT listings share several of them (أرض-الحمراء-السيلاني…, تلال.png),
because the page renders a block of other listings (`mh-estate-vertical`, each with its own
city/neighborhood attributes). Scraping the page would put a neighbour's photo on this card — the
same listing-fidelity breach alta's price nearly hit. /wp/v2/media?parent=<post id> cannot make that
mistake: an attachment has exactly one parent. Verified distinct per post (1, 1, 1, 2, 0).

Also pinned:
  · The type/city SLUGS are plurals (and one consistent misspelling, `appartments`) that the house
    map does not carry. They map through a vetted table — EXACT ONLY, never fuzzy: map_type()
    mis-files unfamiliar category names (proven on alta, where "محلات ومعارض" → "Residential Land").
  · A few posts carry a raw term ID where a slug belongs (property-type-357, city-364, city-348) —
    the site's own broken rows. Skipped and counted, never guessed.
  · class_list's `neighborhood-248` is a raw term id this site exposes no taxonomy endpoint to
    resolve — it is never itself used as the district, only preserved for audit. The title/content
    free text often DOES state a real district, though, and find_district_in_text() (2026-09-11)
    recognizes it — but only when it exact-matches the city's own curated district catalog, so a
    subdivision-plan name or a housing-program name sitting next to a real place is never invented.
"""
import sys
import types
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
sys.modules.setdefault("scrapers.common.db", types.ModuleType("scrapers.common.db"))

import scrapers.common.arabic_location as _al  # noqa: E402
# Seed the module's own state directly (bypasses _load()'s live DB fetch — `if _CITY: return`
# short-circuits on the first non-empty entry) with a tiny, hand-picked slice of the REAL Jeddah
# catalog, so find_district_in_text() runs its actual matching logic against KNOWN answers rather
# than being stubbed into a dumb always-None/always-same-value shape that would stop testing it.
_al._CITY["_stub_"] = [(1, 1)]
_al._DISTRICT_BY_CITY[18] = {_al.norm_ar("حي الروضة")}
_al._DISTRICT_AR_BY_NORM[_al.norm_ar("حي الروضة")] = "حي الروضة"
_al.to_catalog = lambda city_ar, region_hint=None: (18, 2) if city_ar == "جدة" else (None, None)

from scrapers.common import normalize  # noqa: E402
from scrapers.remal.run import CITY_SLUG, OFFER_BUY, OFFER_RENT, TYPE_SLUG, map_listing  # noqa: E402


def _post(classes, title="", body="", pid=1):
    return {"link": "https://www.remalre.com/Real-estate/x/", "slug": "x", "id": pid,
            "class_list": ["estate"] + list(classes),
            "title": {"rendered": title}, "content": {"rendered": body}}

# ── 1. EVERY SLUG OVERRIDE AGREES WITH THE HOUSE MAP'S SINGULAR ─────────────────────────────────
SINGULAR = {"lands": "أرض", "villas": "فيلا", "appartments": "شقة",
            "offices": "مكتب", "building": "عمارة", "farm": "مزرعة"}
for slug, canon in TYPE_SLUG.items():
    assert normalize.map_type_exact(SINGULAR[slug]) == canon, (
        f"{slug}->{canon} disagrees with the house map for {SINGULAR[slug]}")
for slug, ar in CITY_SLUG.items():
    assert normalize.map_city(ar), f"{slug} -> {ar} is not resolvable by the shared city map"

# ── 2. THE HAPPY PATH, AND LOWERCASE CATEGORY ROUTING ───────────────────────────────────────────
row, cat = map_listing(_post(["property-type-villas", "city-jeddah", "offer-type-for-sell"]))
assert row is not None and row["property_type"] == "Villa" and row["city"] == "Jeddah"
assert row["transaction_type"] == "Buy"
assert cat == "residential", f"category must be lowercase for the run's split, got {cat!r}"
row, cat = map_listing(_post(["property-type-offices", "city-jeddah", "offer-type-for-sell"]))
assert cat == "commercial", "commercial types must route to the commercial table"

# ── 3. BROKEN NUMERIC SLUGS ARE SKIPPED, NEVER GUESSED ──────────────────────────────────────────
assert map_listing(_post(["property-type-357", "city-jeddah", "offer-type-for-sell"]))[0] is None
row, _ = map_listing(_post(["property-type-villas", "city-364", "offer-type-for-sell"]))
assert row is not None and row["city"] is None, "an unresolvable city slug yields NO city"

# ── 4. OFFER TYPE ───────────────────────────────────────────────────────────────────────────────
for o in OFFER_BUY:
    assert map_listing(_post(["property-type-villas", "city-jeddah", f"offer-type-{o}"]))[0]["transaction_type"] == "Buy"
for o in OFFER_RENT:
    assert map_listing(_post(["property-type-villas", "city-jeddah", f"offer-type-{o}"]))[0]["transaction_type"] == "Rent"
# `commercial` is a CATEGORY the site mis-filed as an offer type — it states no transaction
assert map_listing(_post(["property-type-villas", "city-jeddah", "offer-type-commercial"]))[0] is None
assert map_listing(_post(["property-type-villas", "city-jeddah"]))[0] is None

# ── 5. PRICE / AREA = SOURCE ────────────────────────────────────────────────────────────────────
row, _ = map_listing(_post(["property-type-villas", "city-jeddah", "offer-type-for-sell"],
                           title="فيلا للبيع", body="السعر: 5,000,000 ريال المساحة 400 متر"))
assert row["price_total"] == 5000000 and row["area_m2"] == 400
assert row["price_per_meter"] is None, "price_per_meter is a calculation and is never stored"
row, _ = map_listing(_post(["property-type-villas", "city-jeddah", "offer-type-for-sell"],
                           title="فيلا للبيع", body="فيلا جميلة بموقع مميز"))
assert row["price_total"] is None and row["price_annual"] is None
# a rent row with no period token keeps rent_period NULL — never a manufactured 'annual'
row, _ = map_listing(_post(["property-type-appartments", "city-jeddah", "offer-type-for-rent"],
                           title="شقة للإيجار", body="السعر: 50,000 ريال"))
assert row["rent_period"] is None
row, _ = map_listing(_post(["property-type-appartments", "city-jeddah", "offer-type-for-rent"],
                           title="شقة للإيجار", body="السعر: 50,000 ريال سنوياً"))
assert row["rent_period"] == "annual"

# ── 5b. AREA — the real formats this source actually uses (measured live 2026-09-11: real posts
# 6593/6544/6532), not just the plain "مساحة N" the regex originally caught. Fixed 2026-09-11 —
# 29/87 -> 52/87 posts recovered.
row, _ = map_listing(_post(["property-type-lands", "city-jeddah", "offer-type-for-sell"],
                           title="أرض للبيع", body="* المساحة/900م2<br>* على 3 واجهات"))
assert row["area_m2"] == 900, "slash-separated «المساحة/900م2» must be caught"
row, _ = map_listing(_post(["property-type-lands", "city-jeddah", "offer-type-for-sell"],
                           title="أرض للبيع", body="مساحات 600م2"))
assert row["area_m2"] == 600, "plural «مساحات» (no separator at all) must be caught"
row, _ = map_listing(_post(["property-type-lands", "city-jeddah", "offer-type-for-sell"],
                           title="أرض للبيع", body="مساحة/ 888م2"))
assert row["area_m2"] == 888, "slash+space «مساحة/ 888م2» must be caught"

# ── 6. DISTRICT — recognized ONLY via catalog match, the raw term id is NEVER the source ────────
# The raw numeric term id (248) must never itself become the district, no matter what — that half
# of the original design is unchanged.
row, _ = map_listing(_post(["property-type-villas", "city-jeddah", "offer-type-for-sell",
                            "neighborhood-248", "street-384"], title="فيلا في حي الروضة"))
assert row["additional_info"]["neighborhood_ids"] == ["248"], "the raw ids stay audit-only, never a district"
# But the title's own free text names a REAL, catalog-confirmed Jeddah district (حي الروضة, stubbed
# above from the actual catalog) — find_district_in_text() recognizes it, exactly as it would live.
assert row["neighborhood"] == "حي الروضة", (
    "a real, catalog-confirmed district plainly stated in the title must be recognized, not discarded")
assert row["city_ar"] == "جدة" and row["city_id"] == 18 and row["region_id"] == 2, (
    "the Arabic-native shadow columns must be populated alongside neighborhood"
)
# A subdivision-PLAN mention is never mistaken for a district, even sitting right next to one.
row, _ = map_listing(_post(["property-type-villas", "city-jeddah", "offer-type-for-sell"],
                           title="فيلا للبيع في مخطط الياسمين"))
assert row["neighborhood"] is None, "a مخطط (plan) name must never be invented as a district"
# Nothing recognizable at all → stays honestly unknown, never guessed.
row, _ = map_listing(_post(["property-type-villas", "city-jeddah", "offer-type-for-sell"],
                           title="فيلا فاخرة للبيع بموقع مميز"))
assert row["neighborhood"] is None, "no candidate text present → NULL, never invented"

# ── 7. IMAGES BIND BY PARENT, AND THE PAGE IS NEVER SCRAPED ─────────────────────────────────────
row, _ = map_listing(_post(["property-type-villas", "city-jeddah", "offer-type-for-sell"], pid=42),
                     images={42: ["https://www.remalre.com/wp-content/uploads/a.jpg"]})
assert row["photo_urls"] == ["https://www.remalre.com/wp-content/uploads/a.jpg"]
# a listing with no attachments keeps an EMPTY list — it never borrows another listing's photo
row, _ = map_listing(_post(["property-type-villas", "city-jeddah", "offer-type-for-sell"], pid=99),
                     images={42: ["https://www.remalre.com/wp-content/uploads/a.jpg"]})
assert row["photo_urls"] == []

import inspect  # noqa: E402
from scrapers.remal import run as _run  # noqa: E402
_img = inspect.getsource(_run.fetch_images)
assert "media?parent=" in _img, "images must bind by attachment parent"
assert 'media_type") == "image"' in _img, "a video attachment must never be stored as a photo"
assert "fetch_detail" not in _img and "<img" not in _img, (
    "the rendered page carries OTHER listings' photos — it must not be scraped for images")

print("ok: remal slugs map exactly, broken slugs are skipped, district is never invented, "
      "images bind by attachment parent")
