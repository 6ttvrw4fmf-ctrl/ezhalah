"""Rich enricher for the Aqar residential pipeline.

Returns a dict ready for `db.upsert_aqar_residential()` — every column the new
`aqar_residential_listings` table has. Each field is grabbed from the page with a
targeted regex; missing values stay None (or False for boolean features).
"""
from __future__ import annotations

import json as _json
import re
from typing import Any, Optional
from urllib.parse import urlparse, unquote

from scrapers.common.http import get
from scrapers.common import normalize as N


# PDPL: never store broker/advertiser contact. Strip Saudi mobile numbers from any free text we keep.
_PII_PHONE_RE = re.compile(r"(?:(?:\+|00)?966|0)5\d{8}")


def _redact_pii(s: str) -> str:
    return _PII_PHONE_RE.sub("[redacted]", s)


LISTING_ID_RE = re.compile(r"-(\d{6,})/?$")

# (column_name, list-of-Arabic-patterns) — a COARSE prose signal, used ONLY as a positive hint for
# columns aqar does not publish structurally. See _structured_amenities() below: where aqar states a
# field explicitly we take its value and NEVER fall back to these patterns, because prose matching
# cannot distinguish "has a lift" from «لا يوجد مصعد» and, worse, cannot distinguish "not mentioned"
# from "does not have one".
FEATURE_PATTERNS: list[tuple[str, list[str]]] = [
    ("elevator",                   [r"مصعد"]),
    ("kitchen",                    [r"مطبخ"]),
    ("car_entrance",               [r"مدخل\s*سيارة", r"مدخل\s*للسيارة", r"كراج"]),
    ("maid_room",                  [r"غرفة\s*خادم(?:ة|ه)", r"غرفة\s*شغّ?الة"]),
    ("driver_room",                [r"غرفة\s*سائق"]),
    ("water_supply",               [r"توفر\s*الماء", r"\bالماء\b", r"\bمياه\b"]),
    ("air_conditioner",            [r"مكيف", r"تكييف"]),
    ("electricity",                [r"توفر\s*الكهرباء", r"كهرباء"]),
    ("sanitation",                 [r"صرف\s*صحي"]),
    ("private_entrance",           [r"مدخل\s*خاص", r"مدخل\s*مستقل"]),
    ("extension",                  [r"إمكانية\s*التوسعة", r"امكانية\s*التوسعة", r"قابلة\s*للتوسعة"]),
    ("special_surface",            [r"واجهة\s*مميزة", r"وجه\s*مميز"]),
    ("special_position",           [r"موقع\s*مميز"]),
]


def _flag(html: str, patterns: list[str]) -> bool:
    return any(re.search(p, html) for p in patterns)


# Grouped-integer token (comma fix 2026-07-17): the old capture `(\d+)` stopped at the FIRST
# thousands separator, so "المساحة 717,928" parsed as area_m2=717 (live ad 6693642; 6708090 gave
# 739 for 739,100) — and the trg_aqar_parse trigger then derived Buy price_per_meter from the
# truncated area (717928/717 → 1001 §/m² where the page says 1 §/m²). Live pages group with the
# ASCII comma AND the Arabic thousands separator ٬ U+066C ("المساحة: ١٨٬٨٣٧٫١٩ م²", ad 6658941,
# stored as 18) — Python's \d already matches Arabic-Indic digits and int() parses them, so ONLY
# the separator was breaking those too. First alternative: strictly-grouped thousands
# (1-3 digits, then [,٬]-separated 3-digit groups, not followed by another digit); fallback: the
# old plain `\d+`. Strict 3-digit grouping means every shape the old parse handled correctly
# still parses identically ("3,4" stays 3; malformed "717,9282" stays 717) — the ONLY behaviour
# change is consuming real thousands-grouped numbers in full. Decimals (".", ٫ U+066B) still
# terminate the match, truncating toward zero exactly as before (int column).
_GROUPED_INT = r"(\d{1,3}(?:[,٬]\d{3})+(?!\d)|\d+)"
_SEP_RE = re.compile(r"[,٬]")



# ── Amenities: aqar's own structured keys, never prose ───────────────────────────────────────────
# aqar renders an ~88-key listing object into the page's Next.js RSC flight payload. Six amenity
# facts are explicit 0/1 there, and reading them is the only way to tell "aqar says NO" apart from
# "aqar did not say" — a distinction prose matching structurally cannot make.
#
# Measured 2026-08-05 across 108 live pages + the whole active cohort, which is what forced this fix:
#   • `_flag()` returned a bare bool, so every amenity was 100% populated and NEVER NULL;
#   • `parking` was true on 4,880/5,216 (93.6%) of the June stub rows vs 1,016/7,028 (14.5%) of
#     healthy rows. A 6.5x gap in the same market is not a real difference; both figures were
#     manufactured by the «مواقف» prose pattern firing on whatever text happened to be stored.
#   • stub `parking` values are not even reproducible from the text we stored (921/5,216), whereas
#     healthy rows reproduce 7,028/7,028.
#
# That fix drew the right conclusion (stop trusting prose) from a WRONG premise: it asserted "aqar
# publishes NO parking field at all" and pinned the column to NULL forever. aqar does publish it —
# as `listing.extended_details.special_parking`, one level deeper than this parser was looking.
# Re-measured 2026-08-09 against 24 live pages: 19 of 20 stored values disagreed with the source,
# INCLUDING a row stored `false` where aqar published `true`. The lesson is in
# docs/ops/ADVANCED_FILTER_SOURCE_TRUTH.md: "the source doesn't publish it" must be proven by
# reading the payload, never inferred from the field's absence in the part of it we happen to parse.
#
# Mapping (aqar key -> our column). Anything not listed is NOT published by aqar structurally.
_STRUCTURED_AMENITY_KEYS: dict[str, str] = {
    "lift": "elevator",
    "ketchen": "kitchen",          # aqar's own spelling
    "ac": "air_conditioner",
    "car_entrance": "car_entrance",
    "furnished": "furnished",
}
# aqar nests a second block of facts under `listing.extended_details`, as native JSON booleans with
# the same true/false/null semantics as the flat keys above. Verified across 24 live pages
# (2026-08-09): every key below is bool-or-null — `fiber_optic` was observed BOTH true and false, so
# these carry real negatives that prose could never produce. Only boolean keys are mapped; the block
# also carries strings (`ac_type`, `project_name`), counts, and broker PII we deliberately never read.
_EXTENDED_DETAIL_KEYS: dict[str, str] = {
    "special_parking":            "parking",
    "fiber_optic":                "optical_fibers",
    "laundry_room":               "laundry_room",
    "balcony":                    "balcony_terrace",
    "roof_villa":                 "villa_on_roof",
    "apartment_in_project":       "apartment_in_project",
    "separated_water_meter":      "separate_water_meter",
    "separated_electrical_meter": "separate_electricity_meter",
}
# Either of aqar's two entrance flags means a private/independent entrance.
_PRIVATE_ENTRANCE_KEYS = ("special_entrance", "two_entrances")

_LISTING_OBJ_RE = re.compile(r'"listing"\s*:\s*\{')


def _listing_json(html: str) -> Optional[dict[str, Any]]:
    """The listing object aqar embeds in its RSC flight payload, or None if it is not present.

    None means we could not read aqar's structured data on this fetch — NOT that the flat lacks
    amenities. Callers must treat it as unknown.
    """
    if not html or '"listing"' not in html and '\\"listing\\"' not in html:
        return None
    # The payload arrives as JS string literals inside self.__next_f.push([1,"..."]) chunks; joining
    # them and unescaping reconstitutes the JSON. Fall back to the raw html for already-plain markup.
    chunks = re.findall(r'self\.__next_f\.push\(\[1,\s*"((?:[^"\\]|\\.)*)"\]\)', html, re.S)
    blob = "".join(chunks) if chunks else html
    if chunks:
        blob = blob.encode("utf-8", "surrogatepass").decode("unicode_escape", "ignore")
        # `unicode_escape` decodes byte-by-byte as latin-1, so every multi-byte UTF-8 sequence comes
        # back as one char per BYTE — «سنوي» arrived as "Ø³Ù\x86Ù\x88Ù\x8a". Round-tripping through
        # latin-1 reassembles the original bytes and decodes them as the UTF-8 they always were.
        # Booleans and numbers were never affected, which is why the amenity read worked regardless;
        # it matters the moment we read an Arabic value such as `rent_period_text`. (2026-08-09)
        try:
            blob = blob.encode("latin-1", "ignore").decode("utf-8", "ignore")
        except UnicodeError:      # already clean on some payload shapes — keep what we have
            pass
    for m in _LISTING_OBJ_RE.finditer(blob):
        start = blob.index("{", m.start() + len('"listing"'))
        depth = 0
        for i in range(start, min(len(blob), start + 200_000)):
            ch = blob[i]
            if ch == "{":
                depth += 1
            elif ch == "}":
                depth -= 1
                if depth == 0:
                    try:
                        obj = _json.loads(blob[start:i + 1])
                    except Exception:  # noqa: BLE001
                        break
                    # The first `"listing":{` in the payload is an i18n label bundle with no id.
                    if isinstance(obj, dict) and obj.get("id") is not None:
                        return obj
                    break
    return None


def _structured_price(obj: Optional[dict[str, Any]]) -> tuple[Optional[int], bool]:
    """aqar's OWN published price, plus whether aqar settled the question at all.

    Returns `(price, authoritative)`. `authoritative=True` means aqar's payload answered — either
    it published a number, or it published that this listing has no price — and the prose scan must
    not second-guess it. `authoritative=False` means the payload was unreadable on this fetch, so
    the legacy prose path stays in charge and behaviour is unchanged.

    Evidence (2026-08-09, 150 live listings probed on a runner aqar serves): the structured `price`
    and the number aqar RENDERS in its price slot agreed **84/84** times. Every apparent
    disagreement was an «N شهريا» RNPL financing instalment — never the rent.

    `published: false` is the one case where the payload carries a number aqar does NOT show: the
    price slot renders «طلب تسويق» and the human sees no figure (21/150 sampled listings, all of
    them `published: false`, `status: 0`, `closed: false`). Importing that number would put a price
    on our card that the source page does not display, so it stays NULL — aqar's non-publication is
    itself the published fact.
    """
    if not obj:
        return None, False
    if "price" not in obj:
        return None, False                    # payload present but priceless shape — don't claim it
    if obj.get("published") is False:
        return None, True
    raw = obj.get("price")
    if isinstance(raw, bool) or not isinstance(raw, (int, float)):
        return None, True                     # aqar states there is no price
    v = int(raw)
    return (v if v > 0 else None), True


# aqar's rent-period enum. Only values PROVEN against a rendered page are mapped; an unmapped value
# falls through to the rendered word rather than guessing a period.
#   3 → annual  (77/150 live listings, every one rendering «N سنوي»)
#   2 → monthly (ad 6586188: enum 2, price_text "6,500", page renders «6,500 شهري»)
# aqar DOES publish monthly residential rentals, so the retired `rent_period = "annual"` default was
# not merely unevidenced — it filed a monthly rent as a yearly one, understating it 12×. The same
# defect souq24 had. An unknown future value must stay unmapped: mislabelling the period is worse
# than admitting we do not know it.
_RENT_PERIOD_ENUM: dict[int, str] = {2: "monthly", 3: "annual"}

# The period word aqar prints next to a specific figure, matched with and without thousands commas.
_PERIOD_WORDS = (("سنوي", "annual"), ("شهري", "monthly"))


def _period_beside(price: Optional[int], text: str, is_rnpl_page: bool = False) -> Optional[str]:
    """The billing period aqar prints beside THIS listing's published figure, or None.

    Anchored on the figure itself rather than on "the first period word on the page". That anchoring
    is the whole point: aqar's pages also carry «N شهريا» RNPL financing lines and a strip of related
    listings, and an unanchored scan reads those as this listing's period. Searching the FULL page
    text is therefore safe here, and necessary — the price headline is not always above the
    «تفاصيل الإعلان» anchor, which left 104 live rows with a published price and no period.
    """
    if not price:
        return None
    grouped = f"{price:,}"
    for pattern, period in _PERIOD_WORDS:
        if period == "monthly" and is_rnpl_page:
            continue          # on a financing page every «شهري» is an instalment, never the rent
        for num in {str(price), grouped}:
            if re.search(rf"{re.escape(num)}\s*[§ر﷼]?\s*/?\s*{pattern}", text):
                return period
    return None


def _tri_state(raw: Any) -> Optional[bool]:
    """aqar's 0/1/None -> False/True/UNKNOWN. Anything unrecognised is UNKNOWN, never False."""
    if raw is None or raw == "":
        return None
    if isinstance(raw, bool):
        return raw
    if isinstance(raw, (int, float)):
        return bool(raw)
    t = str(raw).strip().lower()
    if t in ("1", "true", "yes"):
        return True
    if t in ("0", "false", "no"):
        return False
    return None


def _extended_details(obj: dict[str, Any]) -> dict[str, Any]:
    """aqar's `extended_details` block, or {} when this listing has none.

    aqar sends it as a nested object on most pages but as a JSON *string* on some; {} means the
    block is absent, which — like a null value inside it — is UNKNOWN, never False.
    """
    ext = obj.get("extended_details")
    if isinstance(ext, str):
        try:
            ext = _json.loads(ext)
        except (ValueError, TypeError):
            return {}
    return ext if isinstance(ext, dict) else {}


def _amenities(html: str, text: str, obj: Optional[dict[str, Any]] = None) -> dict[str, Optional[bool]]:
    """Every amenity column, with UNKNOWN (None) wherever aqar does not state a value.

    `obj` lets the caller pass the already-parsed listing payload so a page is not unescaped twice.
    """
    if obj is None:
        obj = _listing_json(html)
    out: dict[str, Optional[bool]] = {}
    # Seed EVERY column we may emit — including ones with no prose pattern, e.g. `furnished` — so a
    # missing structured key yields UNKNOWN rather than an absent dict entry.
    for col in ([c for c, _ in FEATURE_PATTERNS] + list(_STRUCTURED_AMENITY_KEYS.values())
                + list(_EXTENDED_DETAIL_KEYS.values()) + ["private_entrance"]):
        out[col] = None                      # default is UNKNOWN, not False
    if obj:
        for key, col in _STRUCTURED_AMENITY_KEYS.items():
            if key in obj:
                out[col] = _tri_state(obj.get(key))
        ext = _extended_details(obj)
        for key, col in _EXTENDED_DETAIL_KEYS.items():
            if key in ext:
                out[col] = _tri_state(ext.get(key))
        vals = [_tri_state(obj.get(k)) for k in _PRIVATE_ENTRANCE_KEYS if k in obj]
        if vals:
            out["private_entrance"] = True if any(v is True for v in vals) else (
                False if all(v is False for v in vals) else None)
    # Remaining columns have no structured counterpart. A prose hit is still evidence the listing
    # ADVERTISES the feature, so keep True; but silence stays UNKNOWN rather than becoming False.
    # A column aqar publishes structurally NEVER falls back to prose: a structured null means "aqar
    # did not say", and a prose hit must not overwrite that with a confident True.
    structured = (set(_STRUCTURED_AMENITY_KEYS.values()) | set(_EXTENDED_DETAIL_KEYS.values())
                  | {"private_entrance"})
    for col, pats in FEATURE_PATTERNS:
        if col in structured:
            continue
        out[col] = True if _flag(text, pats) else None
    return out

def _int_after_label(html: str, *labels: str) -> Optional[int]:
    """Find the first number that appears right after ANY of the given Arabic labels."""
    for lbl in labels:
        m = re.search(rf"{lbl}[\s:]*?{_GROUPED_INT}", html)
        if m:
            return int(_SEP_RE.sub("", m.group(1)))
    return None


def _int_after_label_in_spec_table(text: str, *labels: str) -> Optional[int]:
    """Like `_int_after_label`, but restricted to Aqar's structured «تفاصيل الإعلان» block (same
    anchor `_property_age_from_text` uses below) — for room-count fields whose Arabic label words
    (دورات المياه / ماستر / صالة / مجلس) also show up in the seller's free-text description, ABOVE
    the anchor, in a completely different role. In free text the natural Arabic order is
    NUMBER-then-label ("3 حمامات" = 3 bathrooms), so an unanchored "label THEN number" match there
    grabs whatever unrelated figure happens to follow the label word, not a room count. Confirmed
    live: ad 6689949 bathrooms=550 — description reads "...مطبخ 3 حمامات \n550 الف ريال" (a
    DIFFERENT unit's price, on the next line); ad 6657497 master_bedrooms=1900 — description reads
    "🛏️ الماستر: 1900 ريال شهرياً" (a room-type's monthly rent, and this listing's structured table
    has no غرف ماستر field at all); ad 6579190 halls=206 — description reads "مساحة كل صالة 206 م"
    (area per hall, equal to area_m2). Anchoring to the structured block only — exactly like
    property_age already does — means the label can only match Aqar's own spec-table row, or
    nothing (field genuinely absent from that listing's structured table)."""
    if not text:
        return None
    i = text.find(_AGE_BLOCK_ANCHOR)
    if i < 0:
        return None
    return _int_after_label(text[i:], *labels)


# The «تفاصيل الإعلان» heading opens Aqar's STRUCTURED attribute table. Everything before it is nav,
# breadcrumbs, price and the seller's free-text description — and the description routinely states an
# age of its own that CONTRADICTS the dropdown (live: 462 rows where the description says e.g.
# «عمر العقار 27 سنه» while the structured field says «أكثر من 10 سنوات»). Anchoring here is what keeps
# the two apart; an unanchored search reads whichever comes first, which is the description.
_AGE_BLOCK_ANCHOR = "تفاصيل الإعلان"
_AGE_LABEL_RE = re.compile(r"عمر\s*العقار[\s:]*([^\n]{0,24})")


def _property_age_from_text(text: str) -> Optional[int]:
    """Aqar's «عمر العقار» → an exact age in years, or None if it cannot be known.

    Replaces a plain `_int_after_label(text, r"عمر\\s*العقار")`. That helper's regex could only match a
    Latin digit, so Aqar's three NON-numeric dropdown values were unparseable by construction and became
    NULL: live production held 21,035 ACTIVE listings whose own structured block says «جديد» with a NULL
    age. The vocabulary itself lives in normalize.parse_property_age because it is shared across
    platforms, not an Aqar quirk.
    """
    if not text:
        return None
    i = text.find(_AGE_BLOCK_ANCHOR)
    if i < 0:
        return None          # no structured block → the only «عمر العقار» here would be the seller's
                             # free text, which is not the authoritative field. Unknown beats wrong.
    m = _AGE_LABEL_RE.search(text, i)
    return N.parse_property_age(m.group(1)) if m else None


# The labels aqar prints in its specification block. De-tagged, that block is one long run of
# «label value label value …», so a capture that does not STOP at the next label swallows the rest of
# the table and then the seller's blurb.
_SPEC_LABELS = (
    "الواجهة", "واجهة العقار", "غرف النوم", "غرف نوم", "الصالات", "دورات المياه", "عرض الشارع",
    "عمر العقار", "المساحة", "المميزات", "نوع السكن", "اسم المشروع", "الشارع", "اسم الشارع",
    "رقم المبنى", "الرمز البريدي", "الرقم الإضافي", "تاريخ الإعلان", "تاريخ الإضافة", "آخر تحديث",
    "رخصة الإعلان", "رقم الرخصة", "السعر", "سعر المتر", "مصدر الإعلان", "الفئة المستهدفة",
    "عدد الشقق", "الدور", "مكونات", "تفاصيل الإعلان", "المطبخ", "المصعد", "مواقف",
)
_SPEC_BOUNDARY_RE = re.compile("|".join(re.escape(s) for s in _SPEC_LABELS))


def _text_after_label(html: str, *labels: str, max_len: int = 80) -> Optional[str]:
    """The value aqar prints after `label`, cut at the next spec label.

    SOURCE IS TRUTH (owner rule, 2026-08-09). Without the cut this returned up to `max_len`
    characters of whatever followed, which on aqar's de-tagged spec table is the NEXT field and then
    the seller's free text. Live proof from the 2026-08-09 recovery dry-run: `direction` came back as
    «شمال غرف النوم 5 الصالات 2 دورات المياه 4 عرض الشارع 20 م عمر العقار 3 سنوات الم» — the real
    facing is «شمال» and everything after it is three other fields plus prose. Storing that is
    exactly the "never take a value from the description" failure, in a text column.
    """
    for lbl in labels:
        m = re.search(rf"{lbl}[\s:]*([^\n<]{{1,{max_len}}})", html)
        if m:
            v = m.group(1)
            cut = _SPEC_BOUNDARY_RE.search(v)
            if cut:
                v = v[:cut.start()]
            v = re.sub(r"\s+", " ", v).strip(" :-،")
            if v:
                return v
    return None


# ── price_per_meter extraction (fix 2026-07-16, bug B2 — the daily flap loop) ────────────────────
# The old pattern `(\d[\d,]{1,})\s*[§ر﷼]?\s*/?\s*(?:متر|م²)` made both the currency and the slash
# OPTIONAL, so it matched any bare "N م²" — i.e. the AREA token. Aqar's spec row reads
# "المساحة 717,928 م² سعر المتر 1 §": the real per-meter value comes AFTER its label, so the first
# regex hit was the area. Harvested proof (live DB, 2026-07-16): on ad 6693642 the old parse gave
# 717,928 (the area) where the page says سعر المتر = 1 §. For land with area > 300k m² that bogus
# ppm tripped _sanitize_price (hide) → the trg_aqar_parse trigger stored SANE prices anyway (it
# recomputes Buy ppm as price_total/area) → the 05:20 auto_recover_false_inactive cron saw sane
# stored prices and resurrected the row → next day's enrich re-poisoned it: a daily flap on 18
# live rows. The extraction is now anchored to the سعر المتر LABEL (value FOLLOWING the label);
# a legacy rate-shaped fallback (explicit slash, "N §/متر") is kept for label-less pages, guarded
# by reject-if-equal-to-the-area-token as defense in depth.
_PPM_LABEL_RE = re.compile(  # (?<!متوسط ) skips market-average stats ("متوسط سعر المتر ...")
    r"(?<!متوسط )سعر\s*المتر(?:\s*المربع)?\s*:?\s*(\d[\d,]*(?:\.\d+)?)"
)
_PPM_RATE_RE = re.compile(r"(\d[\d,]*(?:\.\d+)?)\s*[§ر﷼]?\s*/\s*(?:متر|م²)")
_AREA_TOKEN_RE = re.compile(r"المساحة(?:\s*(?:الكلية|الإجمالية))?\s*:?\s*(\d[\d,]*(?:\.\d+)?)")


def parse_price_per_meter(text: str) -> Optional[int]:
    """Extract the listing's سعر المتر from de-tagged page text, or None if the page shows none.

    Precedence: (1) the number FOLLOWING a سعر المتر label — the canonical spec-row shape every
    aqar page uses ("سعر المتر 1,093.74 §" / "سعر المتر : 1800﷼"); (2) an explicit rate shape
    "N §/متر" or "N/م²" (slash REQUIRED — a bare "N م²" is an area, never a rate), rejected if the
    value equals the page's area token. A label-anchored value is taken as-is even if it looks
    odd — it is what the source printed (price-fidelity rule); the >300k/m² typo gate in
    _sanitize_price stays the single arbiter of hiding."""
    m = _PPM_LABEL_RE.search(text)
    if m:
        return N.to_int(m.group(1))
    m = _PPM_RATE_RE.search(text)
    if m:
        v = N.to_int(m.group(1))
        ma = _AREA_TOKEN_RE.search(text)
        area = N.to_int(ma.group(1)) if ma else None
        if v is not None and (area is None or v != area):
            return v
    return None


def _html_to_text(html: str) -> str:
    """Strip HTML tags + collapse whitespace so 'غرف النوم<span>3</span>' becomes
    'غرف النوم 3' — which our label+number regexes can match."""
    # Drop scripts/styles entirely (we don't want their content)
    s = re.sub(r"<(script|style)[^>]*>.*?</\1>", " ", html, flags=re.DOTALL | re.IGNORECASE)
    # Drop all remaining tags
    s = re.sub(r"<[^>]+>", " ", s)
    # Collapse whitespace
    s = re.sub(r"\s+", " ", s)
    return s


def enrich_residential(url: str, *, type_slug: str, deal_slug: str) -> Optional[dict[str, Any]]:
    """Fetch one Aqar residential listing and return the row dict, or None on failure."""
    r = get(url)
    if r is None:
        return None
    html = r.text
    # `html` is kept for image-URL extraction (URLs survive tag-stripping fine, but the
    # regex was already written against the raw markup). `text` is the de-tagged plain
    # version we run all label+number regexes against from now on.
    text = _html_to_text(html)
    # aqar's structured listing payload, parsed ONCE and shared by the price and amenity reads.
    # None means we could not read it on this fetch — never that the listing lacks these fields.
    obj = _listing_json(html)

    # ad_number — always the trailing numeric segment of the URL.
    m = LISTING_ID_RE.search(url)
    if not m:
        return None
    ad_number = m.group(1)

    # Map our slug → canonical type, then localize deal.
    property_type = N.SLUG_TO_TYPE.get(type_slug)
    transaction_type = "Rent" if deal_slug == "rent" else "Buy"

    # Land ZONING split: Aqar lumps every plot under one أراضي category (→ "Residential Land"). Read the
    # listing text to tag the real zoning so commercial/industrial/agricultural plots aren't all labelled
    # residential. Most-specific wins; no keyword → residential (Aqar's default). (user: split the land.)
    if property_type == "Residential Land":
        if re.search(r"صناعي", text):
            property_type = "Industrial Land"
        elif re.search(r"زراعي|مزرع", text):
            property_type = "Agriculture Plot"
        elif re.search(r"تجاري", text):
            property_type = "Commercial Land"

    # ─── Basic info ──────────────────────────────────────────────────────────
    area_m2           = _int_after_label(text, r"المساحة\s*(?:الكلية|الإجمالية)?", r"\bالمساحة\b")
    interior_space_m2 = _int_after_label(text, r"المساحة\s*الداخلية", r"مساحة\s*البناء")
    outdoor_area_m2   = _int_after_label(text, r"المساحة\s*الخارجية", r"مساحة\s*خارجية")
    # "عدد الغرف" (a generic total-room-count fallback) removed 2026-07-28 — same unconditional-
    # fallback shape as the abeea/muktamel area_m2 bug (PR#259): "غرف النوم" is bedroom-specific and
    # trusted, but silently falling back to a total-room count when it's absent mislabels total
    # rooms as bedrooms. Owner decision: leave NULL when the page doesn't state bedrooms specifically
    # rather than guess from a generic room count.
    bedrooms          = _int_after_label_in_spec_table(text, r"غرف\s*النوم")
    bathrooms         = _int_after_label_in_spec_table(text, r"دورات\s*المياه", r"الحمامات", r"حمامات")
    master_bedrooms   = _int_after_label_in_spec_table(text, r"غرف\s*ماستر", r"غرفة\s*ماستر", r"ماستر")
    halls             = _int_after_label_in_spec_table(text, r"صالات", r"صالة", r"غرفة\s*المعيشة", r"المعيشة")
    reception_majlis  = _int_after_label_in_spec_table(text, r"مجالس", r"مجلس")
    property_age      = _property_age_from_text(text)
    street_width_m    = _int_after_label(text, r"عرض\s*الشارع")
    direction         = _text_after_label(text, r"الواجهة", r"واجهة\s*العقار")
    residence_type    = _text_after_label(text, r"نوع\s*السكن")
    project_name      = _text_after_label(text, r"اسم\s*المشروع")

    # ─── Pricing ─────────────────────────────────────────────────────────────
    price_annual: Optional[int] = None
    price_total:  Optional[int] = None
    price_per_meter: Optional[int] = None
    # The listing's billing period. Aqar shows rent as "69,000 §/سنوي" (yearly) OR "5,000 §/شهري"
    # (monthly). We keep the ORIGINAL period so the app can filter "per month" to true monthly rentals
    # instead of converting everything to yearly and losing the distinction.
    #
    # It used to DEFAULT to "annual" for every Rent listing ("the Saudi norm"). That is a guess
    # wearing a value's clothes: on a page where aqar states no period, and on a page with no price
    # at all, we still asserted "annual". It now starts UNKNOWN and is set only from evidence —
    # aqar's own `rent_period` enum, or the period word aqar renders beside this listing's price.
    # (This costs aqar nothing in practice: its residential rent product is annual, 0 of 23,907 live
    # rows are monthly, and its UI renders «سنوي» — so the value is now the same but EVIDENCED.)
    rent_period: Optional[str] = None

    # Cross-listing contamination guard (2026-07-27 audit, live-proven on 6723041): the de-tagged
    # page text INCLUDES the related-listings strip at the bottom, so on a PRICE-LESS listing the
    # first «N §/سنوي» match came from a DIFFERENT listing's strip card (stored 1,500 belonged to a
    # حي الحزم الجنوبي listing, not this one). The listing's own price headline sits BEFORE the
    # «تفاصيل الإعلان» section header — search only that prefix when the marker exists (legacy
    # full-text fallback otherwise); a price-less page then stays honestly NULL. Also strip the
    # RNPL financing teaser («… ابتداءً من N § شهريا») first: N is an installment, not the rent,
    # and «شهريا» matches the شهري pattern (3 live rows stored installment×12 as price_annual —
    # the installment already has its own home in rent_now_pay_later_monthly).
    price_text = text.split(_AGE_BLOCK_ANCHOR, 1)[0] if _AGE_BLOCK_ANCHOR in text else text
    price_text = re.sub(r"ابتداء\S*\s*من\s*\d[\d,]*\s*[§ر﷼]?\s*شهري\w*", " ", price_text)
    # PRICE = SOURCE, layer 2+4 (owner invariant 2026-08-04). Everything below scans price_text,
    # and price_text is NOT the price element — it is the whole pre-«تفاصيل الإعلان» prefix, which
    # carries the seller's free-text blurb. Two real classes were repaired live on 2026-08-04
    # because of that:
    #   • PROSE NUMBERS became the price — «الدخل السنوي 67,500» on an ad priced 3,700,000;
    #     «مؤجر بالكامل بإجمالي دخل 594,000» on one priced 6,500,000; «يوجد رهن بقيمة 70,000»
    #     (a mortgage) on one priced 4,000,000. 47 rows, ratios 10x-200x.
    #   • A PER-METRE RATE became the total — «سعر المتر 5,000» stored as the whole price.
    # The DB trigger already strips rate expressions (migration 20260803185847), but that fix is
    # half a fix: trg_aqar_parse only OVERWRITES price_total when aqar_parse returns non-null, so
    # on a rate-only ad the scraper's value survives unopposed. Strip the same shapes here.
    #
    # Income/mortgage/instalment prose is removed by LABEL — these labels mark a number that is
    # explicitly NOT the asking price. Anything not recognised is left alone: the aim is to remove
    # known non-prices, never to guess which number is the price.
    price_text = re.sub(r"(?:سعر\s*)?(?:ال)?متر[\s:]{0,6}\d[\d,]*(?:\.\d+)?\s*(?:§|ريال|﷼)", " ", price_text)
    price_text = re.sub(r"\d[\d,]*(?:\.\d+)?\s*(?:§|ريال|﷼)\s*(?:لل|ال)?\s*متر", " ", price_text)
    price_text = re.sub(
        r"(?:الدخل|دخل|عائد|إيراد|ايراد|رهن|قسط|دفعة|تأمين|عربون|عمولة)"
        r"[^0-9\n]{0,25}\d[\d,]*(?:\.\d+)?\s*(?:§|ريال|﷼)?", " ", price_text)
    # RNPL pages sell an ANNUAL lease paid in monthly installments — any «N شهري» figure there is the
    # installment, never the listing's rent period. The teaser-strip above only catches the «ابتداءً
    # من» form; this flag guards installment lines printed WITHOUT that prefix, which used to classify
    # the listing as monthly with price_annual = installment×12 (8 legacy rows; bug-hunt 2026-07-30).
    # `/rnpl/` is the bulletproof signal (Aqar embeds it only when financing is enabled).
    is_rnpl_page = "/rnpl/" in html

    mp_yr = re.search(r"(\d[\d,]{2,})\s*[§ر﷼]?\s*/?\s*سنوي", price_text)
    mp_mo = re.search(r"(\d[\d,]{2,})\s*[§ر﷼]?\s*/?\s*شهري", price_text)

    # PRICE = SOURCE, primary path (2026-08-09). aqar publishes the price as a STRUCTURED field in
    # its RSC payload; everything above is a regex over rendered prose, kept only as the fallback for
    # a fetch whose payload we could not read. Reading the structured field fixes three proven live
    # classes at once, all verified against the source page on a runner aqar serves:
    #   • a stale/mis-parsed stored price (6663318 held 550, aqar publishes 16,000; 6632651 held
    #     24,000, aqar publishes 25,000);
    #   • a published price we simply missed (6803307 renders «21,600 سنوي», we held NULL);
    #   • an INVENTED price — on 6689796 aqar publishes no price at all and the prose scan lifted
    #     2,000 out of a neighbouring related-listing card, because the cross-listing guard only
    #     works when the «تفاصيل الإعلان» anchor is present and that page has none.
    # When aqar's payload speaks, it is the last word in BOTH directions: a number becomes the price,
    # and "no price" becomes NULL rather than an excuse to go hunting through prose.
    s_price, s_authoritative = _structured_price(obj)

    if s_authoritative:
        if transaction_type == "Rent":
            price_annual = s_price
            # The period aqar states for THIS listing: its own enum, else the word it prints next to
            # this listing's published figure. `_period_beside` is anchored on that figure, so a
            # «N شهريا» financing line or a neighbouring listing card can never supply the answer.
            rent_period = _RENT_PERIOD_ENUM.get((obj or {}).get("rent_period")) \
                or _period_beside(s_price, text, is_rnpl_page)
            if rent_period == "monthly" and price_annual:
                # price_annual holds the ANNUAL figure by schema contract and the app divides by 12
                # to display a monthly price, so ×12 round-trips back to exactly what aqar printed.
                price_annual = s_price * 12
        else:
            price_total = s_price
    else:
        if mp_yr:
            price_annual = N.to_int(mp_yr.group(1))
            rent_period = "annual"

        if not price_annual and mp_mo and not is_rnpl_page:
            # No yearly price, but a "/شهري" figure → this is a genuinely MONTHLY rental. Tag it and
            # store the annualized figure too (monthly × 12) so sorting/compare still works. The app
            # divides it back by 12 for the monthly display.
            v = N.to_int(mp_mo.group(1))
            if v:
                price_annual = v * 12
                rent_period = "monthly"

    # Anchored to the سعر المتر label — the old any-"N م²" pattern grabbed the AREA token and
    # caused the daily hide/recover flap on big-area land (see parse_price_per_meter above).
    price_per_meter = parse_price_per_meter(text)

    if transaction_type == "Buy":
        # Aqar Buy prices show up as "1,200,000 §" / "299,000 §" / sometimes plain "1200000 §".
        # Try several formats; sanity-check that the number is >= 50K SAR (rules out per-meter
        # figures and stray numbers that happen to sit next to the riyal symbol). Searched on
        # price_text (pre-«تفاصيل الإعلان» prefix) — same cross-listing strip guard as rent above:
        # a price-less Buy page must stay NULL, not inherit a related-listing card's price.
        # NOTE the currency class differs on the LAST pattern — this is deliberate, not an oversight.
        # The first two require comma-grouped digits, so a bare identifier can never match them and
        # the loose «ر» is harmless there. The third matches an UNGROUPED 6-9 digit run, which is
        # exactly the shape of a REGA advertisement licence: the page prints
        #     «رخصة الإعلان 7100267943 رابط رخصة الإعلان»
        # and with «ر» in the class, `(\d{6,9})\s*[§ر﷼]` captured the licence's last 9 digits from the
        # ر of the FOLLOWING word «رابط» — storing 100267943 as the price. 303 live rows landed in
        # [100,000,000-101,000,000) that way (a 128 m² Jeddah apartment priced at 100.2M), and
        # price_per_meter was then derived from it. Requiring a real currency SYMBOL (§/﷼) here kills
        # the whole class; the ≥50,000 floor and the price_text anchoring below are kept unchanged.
        for pat in (
            r"(\d{1,3}(?:,\d{3}){2,3})\s*[§ر﷼]",  # 1,200,000 §
            r"(\d{1,3}(?:,\d{3}){1,3})\s*[§ر﷼]",  # 299,000 §
            r"(\d{6,9})\s*[§﷼]",                   # 1200000 § — symbol ONLY, never a bare «ر»
        ):
            mp_total = re.search(pat, price_text)
            if mp_total:
                v = N.to_int(mp_total.group(1))
                if v and v >= 50_000:
                    price_total = v
                    break

    # The bulletproof signal is the internal route URL `/rnpl/seek?id=...` which Aqar
    # only embeds when this financing option is enabled for the listing. We check the
    # raw HTML (not the de-tagged text) so the URL stays intact. Text-form variants are
    # a backup. (user request: pick up the actual Arabic wording used by Aqar.)
    rent_now_pay_later = (
        "/rnpl/" in html
        or _flag(text, [
            r"استأجر\s*الآن(?:\s*و?)?\s*(?:ا?دفع|أدفع)?\s*لاحق",  # "استأجر الآن وأدفع لاحقًا" + variants
            r"إيجار\s*الآن[^.<\n]{0,30}لاحق",
            r"ادفع\s*لاحقاً?",
            r"تمكين",
            r"rent\s*now\s*pay\s*later",
        ])
    )

    # When RNPL is offered Aqar prints the starting monthly installment like
    # "استأجر الآن وأدفع لاحقًا ابتداءً من 8,025 § شهريا". Capture that monthly figure so the app can
    # surface a "from SAR X/month" badge on the listing card. (user request.)
    rent_now_pay_later_monthly: Optional[int] = None
    if rent_now_pay_later:
        # Look for the "starting from N شهريا" snippet near the RNPL phrase. Two patterns: the
        # explicit "ابتداءً من" prefix, OR a bare "N § شهريا" / "N شهرياً" near the RNPL trigger.
        for pat in (
            r"ابتداء[ًاء]?\s*من\s*(\d[\d,]{2,})\s*[§ر﷼]?\s*شهري",
            r"(\d[\d,]{2,})\s*[§ر﷼]?\s*/?\s*شهري[ا]?\b",
        ):
            mp_rnpl = re.search(pat, text)
            if mp_rnpl:
                v = N.to_int(mp_rnpl.group(1))
                # Sanity-check: RNPL installments are reasonable monthly rents, not annual figures.
                if v and 500 <= v <= 100_000:
                    rent_now_pay_later_monthly = v
                    break

    # ─── Location ────────────────────────────────────────────────────────────
    # The URL slug always tells us the city + neighborhood reliably.
    city_ar = None
    md_city = re.search(r"/([^/]+?)/", url.split("aqar.fm")[-1].lstrip("/"))
    if md_city:
        city_ar = md_city.group(1)
    # Every city in our scrape matrix is in CITY_MAP_AR, so this maps cleanly. Fall back to
    # "Other" (NOT "Riyadh") if an unexpected slug ever appears — silently defaulting to Riyadh
    # is what buried 70+ towns inside Riyadh before. "Other" is a loud, harmless signal instead.
    city = N.map_city(city_ar or "") or "Other"

    # Region is DERIVED from the (reliable, URL-slug-based) city — NOT scraped from the page. The
    # page's "المنطقة" label proved fragile: when the layout differed it captured the <title>/
    # breadcrumb blob and leaked it into region for ~2.6k listings. City is trustworthy; region
    # follows from it via the canonical CITY_TO_REGION map. (June 2026 region audit.)
    region = N.region_for_city(city)
    neighborhood = None
    md_nbhd = re.search(r"/(?:حي|الحي)-([^/]+?)/", url)
    if md_nbhd:
        neighborhood = "حي " + md_nbhd.group(1).replace("-", " ")

    street_name       = _text_after_label(text, r"الشارع", r"اسم\s*الشارع")
    building_number   = _text_after_label(text, r"رقم\s*المبنى",  max_len=20)
    zip_code          = _text_after_label(text, r"الرمز\s*البريدي", max_len=20)
    additional_number = _text_after_label(text, r"الرقم\s*الإضافي", max_len=20)
    rega_verified     = _flag(text, [r"موقع\s*موثق", r"REGA", r"الهيئة\s*العامة\s*للعقار"])

    # ─── Features ────────────────────────────────────────────────────────────
    # SOURCE FIDELITY (owner rule, 2026-08-05): aqar publishes most amenities as explicit 0/1 keys in
    # its own page payload. Read THOSE. A key aqar does not publish stays UNKNOWN (None) — it is never
    # turned into False, and never guessed from prose.
    features = _amenities(html, text, obj)

    # ─── Media & Metadata ────────────────────────────────────────────────────
    # ALL listing photos (no cap). Scoped to images.aqar.fm — the gallery CDN — so the broker
    # avatar on cdn.aqar.fm/users/* (PII) and the REGA s3 license icons are NOT swept in.
    # (capture-complete contract: store every photo URL the source exposes; the old [:30] cap was
    # silently dropping galleries — observed up to 65 distinct image URLs on a single listing.)
    photos = list(dict.fromkeys(re.findall(r'https://images\.aqar\.fm[^"\'\s]+', html)))
    mv = re.search(r'https://[^"\'\s]+\.(?:mp4|webm|mov)', html, re.IGNORECASE)
    video_url = mv.group(0) if mv else None
    mt = re.search(r"<title>(.*?)</title>", html, re.DOTALL)
    title = mt.group(1).strip() if mt else None
    md = re.search(r'<meta\s+name="description"\s+content="([^"]+)"', html)
    description = md.group(1).strip() if md else None
    date_added  = _text_after_label(text, r"تاريخ\s*الإعلان", r"تاريخ\s*الإضافة")
    last_update = _text_after_label(text, r"آخر\s*تحديث")

    # ── Complete-source capture (capture-once contract) ──────────────────────────
    # Stored in the DEDICATED `source_capture` column — NOT `additional_info` (which the app selects
    # on every search and renders as the {key,label,value} panel; Aqar keeps that NULL). source_capture
    # is never selected by the client, so this adds zero query weight to live search.
    # Aqar pages carry no clean JSON-LD/__NEXT_DATA__ blob and expose no coordinates; the de-tagged
    # visible `text` already holds every field the page shows (title, description, all specs, location
    # text, features, dates). Store it verbatim — minus Saudi phone numbers (PDPL) — so any field we
    # don't promote to a dedicated column today stays recoverable from stored data WITHOUT a re-scrape.
    # `url_path` keeps the full Arabic location hierarchy the slug encodes. Images = URLs only.
    # (The richer Next.js `self.__next_f` RSC flight payload is a future option, stored PII-redacted, if
    # a NON-visible structured field is ever needed; the visible text covers all Aqar displays today.)
    source_capture = {
        "schema": "aqar.v2-fulltext",
        "source_text": _redact_pii(text),
        "url_path": unquote(urlparse(url).path),
        "image_count": len(photos),
    }

    return {
        "ad_number":               ad_number,
        "listing_url":             url,
        "active":                  True,
        # basic
        "property_type":           property_type,
        "transaction_type":        transaction_type,
        "area_m2":                 area_m2,
        "interior_space_m2":       interior_space_m2,
        "outdoor_area_m2":         outdoor_area_m2,
        "bedrooms":                bedrooms,
        "bathrooms":               bathrooms,
        "master_bedrooms":         master_bedrooms,
        "halls":                   halls,
        "reception_rooms_majlis":  reception_majlis,
        "property_age":            property_age,
        "direction":               direction,
        "street_width_m":          street_width_m,
        "residence_type":          residence_type,
        "project_name":            project_name,
        # pricing
        "price_annual":            price_annual,
        "price_total":             price_total,
        "price_per_meter":         price_per_meter,
        "rent_period":             rent_period,
        # PRICE = SOURCE evidence (owner invariant 2026-08-04). aqar publishes no structured price
        # field — the number lives only in the rendered price slot — so the evidence IS that slot's
        # text, verbatim. This is what makes a truncation provable from the DB alone: the 48 rows
        # repaired on 2026-08-04 stored 440 while their own price slot read «440,000», and proving
        # that needed 600+ live page fetches because no evidence had been kept.
        # Folded into source_capture["price_evidence"] by db._fold_price_evidence().
        "price_evidence":          N.price_evidence(
            field="price slot (rendered text)",
            raw=(price_text or "").strip()[:120] or None,
            stored=price_total if price_total is not None else price_annual,
            kind="total" if price_total is not None else "annual",
            unit="total",
            origin="spec_table",
        ),
        "rent_now_pay_later":         rent_now_pay_later,
        "rent_now_pay_later_monthly": rent_now_pay_later_monthly,
        # location
        "city":                    city,
        "region":                  region,
        "neighborhood":            neighborhood,
        "street_name":             street_name,
        "building_number":         building_number,
        "zip_code":                zip_code,
        "additional_number":       additional_number,
        "rega_location_verified":  rega_verified,
        # features
        **features,
        # media
        "photo_urls":              photos,
        "video_url":               video_url,
        "title":                   title,
        "description":             description,
        "date_added":              date_added,
        "last_update":             last_update,
        # complete-source capture (full visible content + location path, PII-redacted). Dedicated
        # column the client never selects; keeps `additional_info` NULL for Aqar as the app expects.
        "source_capture":          source_capture,
    }
