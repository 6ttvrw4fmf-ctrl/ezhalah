"""أملاك الأحساء (amlakalahsa.com) — WordPress + ACF, single Al-Ahsa office.

Verified live 2026-09-12 (52/52 currently-published land+home posts mapped with 0 skips; land has
6 pages / ~260 posts total, all Al-Ahsa).

Pins the decisions that would silently corrupt data if a future edit got them wrong:
  - the `plan` custom post type is NEVER a listing — it's a subdivision-plan reference document
    (plan-pdf-url/plan-num/map-cords fields, no price/district/rooms at all). Only land/home/farm/
    shop/building/apartment are queried; `plan` is excluded from LISTING_TYPES outright.
  - district («pw-dis») is ALREADY a clean, dedicated field the office typed directly — stored
    verbatim, never re-parsed, never invented when absent.
  - city («pw-map.city») is optional Google-geocoded data — absent on real listings (measured: 2/2
    sampled `home` posts had no pw-map at all) — must stay NULL, never guessed.
  - Al-Ahsa's own towns (الهفوف) are same-name-twins with a DIFFERENT region's city of the same
    name — to_catalog() needs the geocoded region (pw-map.state) as a disambiguating hint, or a
    real, correctly-spelled city silently resolves to nothing.
  - deal («pw-cnt») is exact-match only — every sampled row across 260+ land posts says "للبيع"; an
    unrecognized value is refused, never assumed to be Buy.
  - price/area are stored exactly as ACF publishes them (already numeric, no parsing needed) —
    never recalculated.
  - images bind by ATTACHMENT PARENT (`media?parent=<id>`), never the rendered page.
"""
import sys
import types
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
sys.modules.setdefault("scrapers.common.db", types.ModuleType("scrapers.common.db"))

import scrapers.common.arabic_location as _al  # noqa: E402
# Al-Ahsa's «الهفوف» real twin ambiguity: city_id 12 (Eastern Province, region 5) vs a DIFFERENT
# city_id sharing the same name elsewhere — to_catalog() must refuse without a region hint and
# resolve correctly WITH one, exactly the measured live behavior this pins.
_al.to_catalog = lambda city_ar, region_hint=None: (
    (12, 5) if city_ar == "الهفوف" and region_hint == "المنطقة الشرقية" else (None, None)
)

from scrapers.amlakalahsa.run import LISTING_TYPES, map_listing, _clean_geocode_text, _first_street_width, _clean, _redact  # noqa: E402


def _post(pid=1, post_type="land", title="", acf=None, content=""):
    return {"id": pid, "type": post_type, "link": f"https://amlakalahsa.com/{post_type}/x-{pid}/",
            "title": {"rendered": title}, "content": {"rendered": content}, "acf": acf or {}}


# ── 1. `plan` is never a listing type, never queried ────────────────────────────────────────────
assert "plan" not in LISTING_TYPES, "plan (subdivision-plan documents) must never be scraped as a listing"
assert set(LISTING_TYPES) == {"land", "home", "farm", "shop", "building", "apartment"}

# ── 2. THE HAPPY PATH — the real measured example (post 19602) ─────────────────────────────────
row, cat = map_listing(_post(pid=19602, title="للبيع ارض في حي الورود الغربي", acf={
    "pw-typ": "ارض", "pw-cnt": "للبيع", "pw-dis": "الورود", "pw-prc": 250000, "pw-squ": "360",
    "pw-str": "15", "pw-map": {"city": "الهفوف", "state": "المنطقة الشرقية"},
}), {19602: ["https://amlakalahsa.com/wp-content/uploads/x.jpg"]})
assert row is not None and cat == "residential"
assert row["property_type"] == "Residential Land"
assert row["transaction_type"] == "Buy"
assert row["price_total"] == 250000 and row["price_annual"] is None
assert row["area_m2"] == 360 and row["street_width_m"] == 15
assert row["neighborhood"] == "الورود", "district is stored verbatim from the clean pw-dis field"
assert row["city_ar"] == "الهفوف" and row["city_id"] == 12 and row["region_id"] == 5
assert row["photo_urls"] == ["https://amlakalahsa.com/wp-content/uploads/x.jpg"]
assert row["ad_number"] == "AMH19602"

# ── 3. NO pw-map at all (the measured `home` shape) → city stays honestly NULL, but region_id
#    now defaults to Eastern Province — owner-confirmed 2026-09-12: this office is Al-Ahsa-only,
#    entirely within one region, so region is a known FACT even when the exact town isn't. ────────
row, _ = map_listing(_post(pid=2, post_type="home", acf={
    "pw-typ": "منزل", "pw-cnt": "للبيع", "pw-dis": "الجشة", "pw-prc": 970000, "pw-squ": "325",
}), {})
assert row["property_type"] == "Villa"
assert row["city_ar"] is None and row["city_id"] is None, (
    "a listing with no geocoded address must never have a CITY guessed onto it")
assert row["region_id"] == 5, "region IS known (Al-Ahsa-only office) even without a geocode"
assert row["neighborhood"] == "الجشة"
assert row["photo_urls"] == [], "no attachment found -> empty list, never borrowed from elsewhere"

# ── 4. an unmapped raw property type is refused, never guessed ─────────────────────────────────
row, _ = map_listing(_post(acf={"pw-typ": "شيء غريب غير معروف", "pw-cnt": "للبيع", "pw-prc": 1000}), {})
assert row is None

# ── 5. an unrecognized deal value is refused, never assumed Buy ────────────────────────────────
row, _ = map_listing(_post(acf={"pw-typ": "ارض", "pw-cnt": "تبادل", "pw-prc": 1000}), {})
assert row is None

# ── 6. the invisible-character cleanup (still worth keeping even though norm_ar() already handles
#    matching) never mangles a clean string, and does strip a real LRM-contaminated one ───────────
assert _clean_geocode_text("الهفوف‎") == "الهفوف"
assert _clean_geocode_text("الهفوف") == "الهفوف"
assert _clean_geocode_text(None) is None
assert _clean_geocode_text("") is None

# ── 7. a compound street-width ("15 * 10", a corner plot's two frontages) must NEVER be
#    concatenated into a fabricated number — measured live on 40/262 real rows, e.g. pw-str
#    "15 * 10" naively became the smallint 1510 (a physically-absurd street width) before this fix.
assert _first_street_width("15 * 10") == 15
assert _first_street_width("40 * 20 ") == 40
assert _first_street_width("20 * 8 * مرفق") == 20
assert _first_street_width("15") == 15
assert _first_street_width(None) is None
assert _first_street_width("") is None
row, _ = map_listing(_post(acf={"pw-typ": "ارض", "pw-cnt": "للبيع", "pw-prc": 1, "pw-str": "15 * 10"}), {})
assert row["street_width_m"] == 15, "must never store the concatenated 1510"

# ── 8. direction (pw-front) and price-per-meter (pw-prc-mtr) — added 2026-09-13 after an audit
#    found both were captured raw in source_capture but never read into their own columns, even
#    though 37/262 and 82/262 real rows carry them. pw-front is a single-element JSON array
#    ("["شمالي"]") on every real row observed — used as-is, never re-parsed. pw-prc-mtr's ACF
#    "not set" sentinel is a NEGATIVE integer (-1/-2/-5, measured on 4 rows) rather than blank —
#    normalize.to_int() strips the sign, which would otherwise fabricate a positive price from it.
row, _ = map_listing(_post(acf={
    "pw-typ": "ارض", "pw-cnt": "للبيع", "pw-prc": 1, "pw-front": ["شمالي"], "pw-prc-mtr": "1350",
}), {})
assert row["direction"] == "شمالي"
assert row["price_per_meter"] == 1350

row, _ = map_listing(_post(acf={"pw-typ": "ارض", "pw-cnt": "للبيع", "pw-prc": 1, "pw-prc-mtr": "-2"}), {})
assert row["price_per_meter"] is None, "ACF's negative 'not set' sentinel must never become a fabricated price"
assert row["direction"] is None, "no pw-front at all -> honestly NULL, never guessed"

row, _ = map_listing(_post(acf={"pw-typ": "ارض", "pw-cnt": "للبيع", "pw-prc": 1, "pw-front": [], "pw-prc-mtr": ""}), {})
assert row["direction"] is None and row["price_per_meter"] is None

# ── 9. description (content.rendered) — added 2026-09-13 after an audit found WP REST returns it
#    unconditionally on every post, but only the ACF block ever reached source_capture/the row.
#    Real shape measured live: HTML paragraphs restating the spec in prose, e.g.
#    '<p class="wp-block-paragraph">للبيع ارض ...</p>'. Stored cleaned + PII-redacted, never re-parsed.
assert _clean('<p class="wp-block-paragraph">للبيع ارض</p>\n\n\n\n<p>مساحة 360</p>') == 'للبيع ارض مساحة 360'
assert _clean('') == '' and _clean(None) == ''
assert _redact('تواصل 0512345678 للبيع') == 'تواصل للبيع', "a real Saudi mobile number must never reach storage"
assert _redact('') == '' and _redact(None) is None, "falsy input passes through unchanged, never coerced"

row, _ = map_listing(_post(
    acf={"pw-typ": "ارض", "pw-cnt": "للبيع", "pw-prc": 1},
    content='<p class="wp-block-paragraph">للبيع ارض في حي الورود رقم 219 اتصل 0512345678</p>',
), {})
assert row["description"] == "للبيع ارض في حي الورود رقم 219 اتصل", "cleaned of HTML, and the phone number is gone"
assert "0512345678" not in row["description"]

row, _ = map_listing(_post(acf={"pw-typ": "ارض", "pw-cnt": "للبيع", "pw-prc": 1}, content=""), {})
assert row["description"] is None, "no content at all -> honestly NULL, never fabricated"

# ── 10. pw-prc=0 means "على السوم" (price on request), NEVER a real SAR 0 listing — added
#     2026-09-13 after finding it live-tested as a real user: a card displayed "ر.س 0" for a plot
#     whose own description says "على السوم". Measured live: 18/262 rows, all 18 negotiable, raw
#     pw-prc literally "0" in every one — never blank, so this can't be caught by a truthiness
#     check on the RAW value alone; it has to happen after to_int() parses it to the integer 0.
row, _ = map_listing(_post(acf={"pw-typ": "ارض", "pw-cnt": "للبيع", "pw-prc": 0, "pw-squ": "600"}), {})
assert row["price_total"] is None, "pw-prc=0 (\"على السوم\") must never store/display as a real SAR 0"
row, _ = map_listing(_post(acf={"pw-typ": "ارض", "pw-cnt": "للبيع", "pw-prc": 250000, "pw-squ": "600"}), {})
assert row["price_total"] == 250000, "a real positive price must still pass through untouched"

print("ok: amlakalahsa excludes the plan CPT, district is verbatim from its own clean field, "
      "city stays NULL without a geocode rather than guessed, the Al-Ahsa same-name-twin resolves "
      "only with its region hint, unmapped type/deal values are refused rather than assumed, "
      "direction/price-per-meter are captured without ever fabricating a value from ACF's sentinels, "
      "description is captured cleaned + PII-redacted from content.rendered, and pw-prc=0 "
      "(\"على السوم\") is stored as an honest NULL rather than a fabricated SAR 0")
