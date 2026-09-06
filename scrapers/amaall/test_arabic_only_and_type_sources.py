"""آمال publishes every listing TWICE — once in Arabic, once in English.

THE DEFECT THIS PREVENTS, measured 2026-09-06 before a line of the scraper was written:
/wp-json/wp/v2/properties returns 135 posts = 68 under /en/ + 67 without. Of 55 distinct
price/size/bedroom signatures, 39 appear more than once, and every duplicate pair is exactly one EN
post and one AR post (9,500,000 → EN 23773 + AR 23751). Ingesting all 135 would show every آمال
property twice on the site — the duplicate-manufacturing failure that got `toor` rejected in the
same audit.

Also pinned, because each silently corrupts rather than crashes:
  · STATUS MUST NEVER COME FROM THE TITLE. A real post reads «شقة مميزة للبيع …» while its
    property_status is «تم التأجير». The title is the original ad copy; the taxonomy is the CURRENT
    state. Reading the title there would put a rented property back on the market.
  · The TITLE-TYPE fallback is allowed ONLY when the taxonomy filed no real type, and must not
    rescue a type we deliberately refuse (إداري / كشك).
  · Coordinates are never a location: fave_property_location is `25.68654,-80.431345` on several
    posts — negative longitude, i.e. Florida. Same class of default pin that got danaalkhair
    deferred.
"""
import sys
import types
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
sys.modules.setdefault("scrapers.common.db", types.ModuleType("scrapers.common.db"))

from scrapers.amaall.run import (  # noqa: E402
    TITLE_TYPE_WORDS, TYPE_CATEGORY_TERMS, TYPE_OVERRIDES, TYPE_UNMAPPABLE,
    is_arabic_post, map_listing,
)
from scrapers.common import normalize  # noqa: E402

# ── 1. THE LANGUAGE SPLIT ───────────────────────────────────────────────────────────────────────
assert is_arabic_post({"link": "https://www.amaall.com/projects/شقة-للبيع/"}) is True
assert is_arabic_post({"link": "https://www.amaall.com/en/projects/apartment-for-sale/"}) is False
assert is_arabic_post({"link": ""}) is True          # no link → not an English duplicate


def _tax(types_=(), statuses=(), cities=()):
    return {
        "property_type":   {i: n for i, n in enumerate(types_, start=1)},
        "property_status": {i: n for i, n in enumerate(statuses, start=1)},
        "property_city":   {i: n for i, n in enumerate(cities, start=1)},
        "property_state": {}, "property_feature": {}, "property_label": {},
    }


def _post(types_=(), statuses=(), cities=(), title="", link="https://www.amaall.com/projects/x/"):
    p = {"link": link, "slug": "x", "id": 1,
         "property_type":   list(range(1, len(types_) + 1)),
         "property_status": list(range(1, len(statuses) + 1)),
         "property_city":   list(range(1, len(cities) + 1)),
         "title": {"rendered": title}, "content": {"rendered": ""}, "property_meta": {}}
    return map_listing(p, _tax(types_, statuses, cities))

# An English post is never ingested, no matter how complete it looks.
assert _post(("شقة",), ("للبيع",), ("جدة",), "Apartment",
             link="https://www.amaall.com/en/projects/apartment/")[0] is None

# ── 2. CATEGORY TERMS ARE NOT TYPES ─────────────────────────────────────────────────────────────
for cat in TYPE_CATEGORY_TERMS:
    assert normalize.map_type_exact(cat) is None, f"{cat} must not be a canonical type"
# a post carrying ONLY a category, with no title clue, is skipped rather than guessed
assert _post(("سكني",), ("للبيع",), ("جدة",), "أرضين 102 مميزة")[0] is not None  # title says أرض
assert _post(("سكني",), ("للبيع",), ("جدة",), "عرض مميز")[0] is None             # nothing to read

# ── 3. THE TITLE-TYPE FALLBACK ──────────────────────────────────────────────────────────────────
row, cat = _post(("سكني",), ("للبيع",), ("جدة",), "عمارة سكنية مميزة للبيع على الدائري الثالث")
assert row is not None and row["property_type"] == "Building"
assert row["additional_info"]["type_source"] == "title"
# the taxonomy WINS when it states a real type — the title never overrides it
row, _ = _post(("شقة",), ("للبيع",), ("جدة",), "فيلا مميزة للبيع")
assert row["property_type"] == "Apartment", "taxonomy must win over the title"
assert row["additional_info"]["type_source"] == "taxonomy"
# a REFUSED taxonomy type is not rescued by the title
assert _post(("كشك", "تجاري"), ("للإيجار",), ("جدة",), "محل مميز للإيجار")[0] is None
assert _post(("إداري", "تجاري"), ("للبيع",), ("جدة",), "مكتب للبيع")[0] is None
# every fallback word must be a type the house map already knows
for w in TITLE_TYPE_WORDS:
    assert normalize.map_type_exact(w), f"{w} is not an exact canonical type"

# ── 4. STATUS COMES ONLY FROM THE TAXONOMY ──────────────────────────────────────────────────────
# the measured live case: title says للبيع, taxonomy says تم التأجير → INACTIVE, and a Rent row.
row, _ = _post(("شقة",), ("تم التأجير",), ("جدة",), "شقة مميزة للبيع في شارع الفروانية")
assert row["active"] is False, "a rented listing must not be re-opened by its title"
assert row["transaction_type"] == "Rent"
for gone in ("تم البيع", "تم التأجير", "تم التأجير بالكامل"):
    assert _post(("شقة",), (gone,), ("جدة",), "شقة")[0]["active"] is False
assert _post(("شقة",), ("للبيع",), ("جدة",), "شقة")[0]["active"] is True
# no status at all → no stated transaction → not ingestible (we cannot say buy or rent)
assert _post(("شقة",), (), ("جدة",), "شقة للبيع")[0] is None

# ── 5. LOCATION: TAXONOMY ONLY, AND A DISTRICT IS NOT A CITY ────────────────────────────────────
assert _post(("شقة",), ("للبيع",), ("جدة",), "شقة")[0]["city"] == "Jeddah"
# «حي النعيم» is a DISTRICT the site mis-filed into the city taxonomy — it must not become a city
assert normalize.map_city("حي النعيم") is None
row, _ = _post(("شقة",), ("للبيع",), ("حي النعيم",), "شقة")
assert row["city"] is None, "a district in the city taxonomy must not invent a city"
# the Florida default pin is never consulted — a post with ONLY coordinates has no city
p = {"link": "https://www.amaall.com/projects/x/", "slug": "x", "id": 1,
     "property_type": [1], "property_status": [1], "property_city": [],
     "title": {"rendered": "شقة"}, "content": {"rendered": ""},
     "property_meta": {"fave_property_location": ["25.68654,-80.431345,15"]}}
row, _ = map_listing(p, _tax(("شقة",), ("للبيع",)))
assert row["city"] is None and row["region"] is None

# ── 6. PRICE / PERIOD = SOURCE ──────────────────────────────────────────────────────────────────
p = {"link": "https://www.amaall.com/projects/x/", "slug": "x", "id": 1,
     "property_type": [1], "property_status": [1], "property_city": [1],
     "title": {"rendered": "شقة"}, "content": {"rendered": ""},
     "property_meta": {"fave_property_price": ["9,500,000"], "fave_property_size": ["300"]}}
row, _ = map_listing(p, _tax(("شقة",), ("للبيع",), ("جدة",)))
assert row["price_total"] == 9500000, row["price_total"]   # comma format parsed, value verbatim
assert row["area_m2"] == 300
assert row["price_per_meter"] is None, "price_per_meter is a calculation and is never stored"
# a rent row with no period token keeps rent_period NULL — never a manufactured 'annual'
row, _ = _post(("شقة",), ("للإيجار",), ("جدة",), "شقة للإيجار")
assert row["rent_period"] is None and row["price_annual"] is None

# ── 7. OVERRIDES ARE REAL, AND DO NOT COLLIDE WITH THE REFUSE LIST ──────────────────────────────
assert not (set(TYPE_OVERRIDES) & set(TYPE_UNMAPPABLE))
assert TYPE_OVERRIDES["أرض سكنية"] == normalize.map_type_exact("أرض")
assert TYPE_OVERRIDES["عمارة سكنية"] == normalize.map_type_exact("عمارة")
assert TYPE_OVERRIDES["محطة وقود"] == normalize.map_type_exact("محطة بنزين")

# ── 8. IMAGES: video attachments are never photos ───────────────────────────────────────────────
import inspect  # noqa: E402
from scrapers.amaall import run as _run  # noqa: E402
_img = inspect.getsource(_run.fetch_images)
assert 'media_type") == "image"' in _img, (
    "this source attaches WhatsApp videos to listings — 2 video/mp4 among 74 attachments were "
    "measured; a video stored as a photo renders as a broken card")
assert "parent=" in _img, "images must bind by attachment parent, never by scraping the page"

print("ok: amaall is Arabic-only, status is taxonomy-only, title-type is a fallback, "
      "city never comes from a Florida pin, videos are not photos")
