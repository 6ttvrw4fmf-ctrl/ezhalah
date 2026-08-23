"""Raghdan (raghdan.sa / رغدان للعقارات) scraper — Saudi Next.js platform, JSON-LD detail pages.

رغدان للعقارات is a Saudi real-estate brokerage platform (mostly Makkah + Riyadh listings, plus
Eastern Province / Madinah). Saudi-owned + REGA-registered brokers → passes the Saudi-only rule.
No auth, no proxy, cloud-friendly. ~1,065 listings advertised; the public sitemap currently
surfaces ~355 `/ar/property/<firebaseId>/` URLs (Firebase push-IDs, ~20-char alnum).

Data path: NO public JSON list API. Enumerate /ar/property/<id>/ URLs from sitemap.xml (EXCLUDING
the /ar/properties/ plural index, /ar/market/, /ar/news/, /ar/public-profile/ etc.), then fetch
each detail page. Each active page embeds <script type="application/ld+json"> blocks:
  • RealEstateListing → name, description, offers(price, priceCurrency SAR, businessFunction
    Sell|LeaseOut), floorSize(value + unitCode MTK = m²), numberOfRooms, address(streetAddress,
    addressLocality=city, addressRegion=region, postalCode), geo lat/long, image[] (full Firebase
    Storage URLs with embedded ?alt=media&token=… → public), AND a broker{RealEstateAgent name+addr}.
  • BreadcrumbList → city / district.

PRICE SEMANTICS (re-verified 2026-07-26 against 227 live Firestore docs):
  • Buy + LAND (ارض): offers.price is the PER-METER rate → price_per_meter ONLY.
  • Buy + building/apartment/etc.: offers.price is the TOTAL → price_total ONLY.
  • Rent: offers.price is the ANNUAL total.
  We store ONLY the number the source published, in the column it belongs to, and leave the other
  NULL. We do NOT compute total = rate × area, nor rate = total / area: both fabricate a figure the
  source never printed into a source-named column (listing-fidelity rule; same violation fixed for
  aqar in PR#216). A land card with no total is not price-less — ResultCard renders the published
  «سعر المتر» whenever the price line would read «السعر عند الطلب».
  NOTE: the Firestore document also carries `landTotalPrice` for land rows. Reading it would give
  those rows a REAL source total, but it needs a second egress host + owner approval, so it is a
  deliberate follow-up rather than a silent fallback here (a fallback is exactly where the multiply
  would creep back).

DESCRIPTION free-text carries structured specs (no agent contact):
  "المساحة 148.62 م²، عدد الغرف 4، العمر: جديد، الواجهة: شرقية"
  → area / rooms / age-text / facade. (numberOfRooms is also a top-level JSON-LD field.)

PDPL: the JSON-LD `broker` block exposes the brokerage NAME + address — we NEVER store the name.
`address.streetAddress` is free-text that on this source is frequently a PERSON name (e.g.
"نصر الجيلاني", "أيمن الحبشي") rather than a verifiable street — under the absolute PDPL rule we
DROP it entirely (can't tell an owner/advertiser name from an official street name). We also REDACT
any phone / wa.me from title + description as a belt-and-braces measure.

Field map (Raghdan → our schema):
  offers.price (+ businessFunction) → price_total | price_annual | price_per_meter (see above)
  floorSize.value (MTK)             → area_m2
  numberOfRooms / "عدد الغرف"        → bedrooms (residential only)
  name first word / breadcrumb      → property_type (TYPE_MAP) + res/com routing
  Sell→Buy / LeaseOut→Rent          → transaction_type
  addressLocality (AR)              → city (normalize.map_city) ; addressRegion (AR) → region
  breadcrumb district               → neighborhood
  geo lat/lng, postal, street, age  → additional_info / columns

Usage:  python -m scrapers.raghdan.run [--limit N] [--type residential|commercial|all]
"""
from __future__ import annotations

import argparse
import html as ihtml
import json
import os
import re
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any, Optional

from curl_cffi import requests as cc

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT.parent) not in sys.path:
    sys.path.insert(0, str(ROOT.parent))

from scrapers.common import db, normalize  # noqa: E402

BASE = "https://raghdan.sa"
SITEMAP = f"{BASE}/sitemap.xml"
WORKERS = int(os.environ.get("RAGHDAN_WORKERS", "4"))

# Arabic property-type word (first token of `name`, or breadcrumb) → canonical English type.
#
# 2026-08-09: this used to be a FULL private copy of the canonical map, and it had silently drifted
# from `normalize.TYPE_MAP_AR` — 12 shared keys were missing here, so raghdan alone failed to map
# "إستراحة" (hamza-alif spelling; the bare-alif "استراحة" was present) and stored the whole page
# TITLE as the property type instead: 2 live rows carried
# type_ar = "إستراحة للبيع في الودي، حائل". Same drift also left "أرض تجارية" / "أرض زراعية"
# unmapped, which would have substring-matched the bare "أرض" and misfiled commercial and
# agricultural land as Residential Land — the exact reconflation the Farm/Agriculture-Plot split
# exists to prevent.
#
# The fix is to stop maintaining a second copy: raghdan now flows through the shared map and keeps
# ONLY its genuine deltas below, per the map_type_exact overrides contract (exact-match, conflicts
# and platform-only vocabulary only, defined in the scraper). Differential-tested against all 169
# distinct live raghdan titles: 2 changes, both the إستراحة fix, zero other movement.
TYPE_OVERRIDES_AR = {
    # raghdan-only vocabulary (absent from the shared map)
    "روف": "Floor", "بناية": "Building", "برج": "Building", "اراضي": "Residential Land",
    "محطة": "Gas Station", "مجمع": "Commercial Building",
    # genuine conflicts with the shared map — raghdan's brokerage vocabulary treats these as a
    # standalone house, not a villa. Kept as-is (owner rule: never silently re-decide a mapping
    # conflict); flip only on an explicit taxonomy decision.
    "بيت": "House", "منزل": "House",
}
COMMERCIAL_TYPES = {
    "Shop", "Office", "Warehouse", "Showroom", "Workshop", "Factory", "Hotel",
    "Gas Station", "Commercial Building", "Commercial Land",
}
# Land types: for these, a Buy `offers.price` is the PER-METER rate, not the total.
LAND_TYPES = {"Residential Land", "Commercial Land", "Farm"}

# addressRegion (AR) → canonical English region. Raghdan uses "منطقة …" / "المنطقة الشرقية" labels.
REGION_AR = {
    "الرياض": "Riyadh", "مكة": "Makkah", "مكه": "Makkah", "المدينة": "Madinah",
    "الشرقية": "Eastern Province", "القصيم": "Qassim", "عسير": "Asir", "تبوك": "Tabuk",
    "حائل": "Hail", "جازان": "Jazan", "نجران": "Najran", "الباحة": "Al Bahah",
    "الحدود الشمالية": "Northern Borders", "الجوف": "Al Jawf",
}
# city (English canonical) → region, used when addressRegion is missing.
CITY_TO_REGION = {
    "Riyadh": "Riyadh", "Al Kharj": "Riyadh", "Diriyah": "Riyadh",
    "Jeddah": "Makkah", "Mecca": "Makkah", "Taif": "Makkah",
    "Medina": "Madinah", "Yanbu": "Madinah",
    "Dammam": "Eastern Province", "Khobar": "Eastern Province", "Dhahran": "Eastern Province",
    "Hofuf": "Eastern Province", "Jubail": "Eastern Province", "Qatif": "Eastern Province",
    "Hafar Al Batin": "Eastern Province",
    "Buraidah": "Qassim", "Unaizah": "Qassim", "Abha": "Asir", "Khamis Mushait": "Asir",
    "Tabuk": "Tabuk", "Hail": "Hail", "Jazan": "Jazan", "Najran": "Najran",
    "Al Baha": "Al Bahah", "Arar": "Northern Borders", "Sakaka": "Al Jawf",
}

# Arabic age phrase (from "العمر: …") → years. "جديد"/"اقل من سنة" → 0; the rest are coarse buckets.
AGE_AR = {
    "جديد": 0, "جديده": 0, "اقل من سنة": 0, "أقل من سنة": 0,
    "سنة": 1, "سنه": 1, "سنتين": 2, "ثلاث سنوات": 3, "اربع سنوات": 4, "أربع سنوات": 4,
    "خمس سنوات": 5, "ست سنوات": 6, "سبع سنوات": 7, "ثمان سنوات": 8, "تسع سنوات": 9,
    "عشر سنوات": 10,
}

# Phone / contact patterns to REDACT from title + description (PDPL belt-and-braces).
_PHONE_RE = re.compile(
    r"(?:\+?9665\d{8}"
    r"|00966\d{9}"
    r"|0?5\d{8}"
    r"|9200\d{4,}"
    r"|wa\.me/\S+"
    r"|واتس\S*\s*\d[\d\s\-]{6,})"
)
_PHONE_LOOSE = re.compile(r"[\(\[\{«]{1,3}\s*0?5[\d\s\.\-]{7,}\s*[\)\]\}»]{1,3}")

LDJSON_RE = re.compile(r'<script type="application/ld\+json">(.*?)</script>', re.S)
# Firebase push-IDs are ~20 chars of [A-Za-z0-9_-]; allow a tolerant 12–40 range.
PROP_URL_RE = re.compile(r"https://raghdan\.sa/ar/property/[A-Za-z0-9_-]{12,40}/?$")

_local = threading.local()


def _session() -> cc.Session:
    s = getattr(_local, "s", None)
    if s is None:
        s = cc.Session(impersonate="chrome124")
        s.headers.update({
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "ar,en-US;q=0.7,en;q=0.6",
        })
        _local.s = s
    return s


def session() -> cc.Session:
    return cc.Session(impersonate="chrome124")


def _int(v: Any) -> Optional[int]:
    n = normalize.to_int(v)
    return n if n else None


def _float(v: Any) -> Optional[float]:
    if v in (None, "", "—"):
        return None
    try:
        s = str(v).translate(normalize._TRANS)
        s = re.sub(r"[^\d.]", "", s)
        return float(s) if s else None
    except (TypeError, ValueError):
        return None


def _strip_tags(s: str) -> str:
    # ihtml.unescape FIRST, matching abeea/alkhaas/awal/eastabha — raghdan was the only scraper in
    # the fleet missing it, so entities reached the database raw. Found 2026-08-11 in a deed-location
    # value that stored «قطعة الأرض &quot;2558&quot;» instead of the quotation marks the deed shows.
    # Unescaping before tag-stripping is deliberate and safe here: the order cannot resurrect a tag,
    # because the regex that follows removes anything an entity could decode into.
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", ihtml.unescape(s or ""))).strip()


def _redact(text: Optional[str]) -> Optional[str]:
    if not text:
        return text
    t = _PHONE_LOOSE.sub(" ", text)
    t = _PHONE_RE.sub(" ", t)
    t = re.sub(r"\s{2,}", " ", t).strip()
    return t or None


# ── Sitemap enumeration ───────────────────────────────────────────────────────
# raghdan.sa's sitemap.xml is intermittently unreachable to automated fetchers (2026-08-23: 2
# consecutive daily CI runs logged "Raghdan: 0 candidate listings" while a direct probe from a
# different network fetched the same sitemap successfully with 376 property URLs moments later —
# and a same-network repeat request then timed out again). Same lesson as jazwtn's 07-23→08-03
# incidents: never conclude "blocked" or "empty catalog" from one response. Retry across TLS
# fingerprints with backoff, treat a 0-entry body as a FAILED attempt (not a healthy empty
# catalog), and RAISE after exhausting attempts so the run fails LOUD with a real reason instead of
# silently reporting an empty catalog (the old bare `except Exception: pass` swallowed the actual
# error — timeout vs reset vs decoy body were all indistinguishable from a genuinely empty source).
_SITEMAP_IMPERSONATES = ("chrome124", "chrome131", "chrome136", "safari184", None)


def sitemap_urls(s: cc.Session) -> list[str]:
    """Return de-duped /ar/property/<firebaseId>/ URLs from sitemap.xml (one big urlset).
    EXCLUDES the /ar/properties/ plural index, /ar/market/, /ar/news/, /ar/public-profile/ …
    Retries across TLS fingerprints with backoff; raises after exhausting them so the run is
    marked failed instead of silently reporting an empty catalog (see module note above)."""
    last_err: Optional[Exception] = None
    for attempt, imp in enumerate(_SITEMAP_IMPERSONATES):
        try:
            sess = s if attempt == 0 else (cc.Session(impersonate=imp) if imp else cc.Session())
            body = sess.get(SITEMAP, timeout=30).text
            seen: set[str] = set()
            urls: list[str] = []
            for u in re.findall(r"<loc>([^<]+)</loc>", body):
                if PROP_URL_RE.match(u):
                    u = u if u.endswith("/") else u + "/"
                    if u not in seen:
                        seen.add(u)
                        urls.append(u)
            if urls:
                if attempt:
                    print(f"  sitemap recovered on retry {attempt + 1} "
                          f"(impersonate={imp}, {len(body)} bytes, {len(urls)} urls)")
                return urls
            print(f"  sitemap attempt {attempt + 1} (impersonate={imp}): {len(body)} bytes, "
                  f"0 property urls — decoy body, retrying")
        except Exception as e:  # curl 28/35 timeouts/resets land here
            last_err = e
            print(f"  sitemap attempt {attempt + 1} (impersonate={imp}) failed: {e}")
        time.sleep(4 * (attempt + 1))
    raise RuntimeError(
        f"raghdan sitemap: no property urls after {len(_SITEMAP_IMPERSONATES)} fingerprint attempts"
        + (f" (last error: {last_err})" if last_err else " (all attempts returned decoy bodies)"))


def fetch_one(url: str) -> Optional[tuple[str, str]]:
    s = _session()
    for attempt in range(3):
        try:
            r = s.get(url, timeout=45, allow_redirects=True)
        except Exception:
            time.sleep(1.2 * (attempt + 1))
            continue
        if r.status_code == 200 and "/ar/property/" in str(r.url):
            return r.text, url
        if r.status_code in (429, 502, 503, 504):
            time.sleep(2.0 * (attempt + 1))
            continue
        if r.status_code in (404, 410):
            return None
        time.sleep(1.0 * (attempt + 1))
    return None


# ── Parsing ────────────────────────────────────────────────────────────────────
def _ld_blocks(body: str) -> tuple[Optional[dict], Optional[dict]]:
    """Return (RealEstateListing, BreadcrumbList) from the page's ld+json scripts."""
    listing = breadcrumb = None
    for raw in LDJSON_RE.findall(body):
        try:
            d = json.loads(raw)
        except Exception:
            continue
        t = d.get("@type")
        if t == "RealEstateListing":
            listing = d
        elif t == "BreadcrumbList":
            breadcrumb = d
    return listing, breadcrumb


def _breadcrumb_district(bc: Optional[dict]) -> Optional[str]:
    """The 4th crumb (under city) is the district/neighborhood; the 5th is the listing itself.

    When raghdan's CMS doesn't tag a district, the breadcrumb collapses to 4 crumbs instead — but
    the title crumb itself embeds the district: "ارض للبيع في مغرزات، الرياض" (re-verified live
    2026-08-04). Extract the text between "في" and the following Arabic comma. This is a raw,
    unvalidated extraction — landmarks ("مطار الملك خالد الدولي") or placeholders ("غير محدد") can
    come out of it too, but downstream district resolution (resolve_district_ar) only accepts a
    value already attested in loc_canonical_district for the listing's city, so anything that
    isn't a real district for this city safely resolves to NULL rather than leaking onto the card.
    """
    if not bc:
        return None
    items = bc.get("itemListElement") or []
    # crumbs: [home, العقارات, city, district, listing]
    if len(items) >= 5:
        name = (items[3].get("name") or "").strip()
        # the district crumb's name is the bare neighborhood (e.g. "النرجس")
        if name and "للبيع" not in name and "للإيجار" not in name:
            return name
    elif len(items) == 4:
        # crumbs: [home, العقارات, city, title] — title is "<type> لل.. في <district>، <city>"
        title = items[3].get("name") or ""
        m = re.search(r"في\s+([^،]+)،", title)
        if m:
            return m.group(1).strip()
    return None


# The rendered "الموقع" card, e.g.
#   <span ...>المنطقة<!-- -->:</span><span ...>منطقة مكة المكرمة</span>
#   <span ...>المدينة<!-- -->:</span><span ...>جدة</span>
#   <span ...>الحى<!-- -->:</span><span ...>النعيم</span>
_LOC_CARD_RE = re.compile(r">\s*الموقع\s*<")
_LOC_FIELD_RE = {
    "region": re.compile(r">المنطقة<!-- -->:</span><span[^>]*>(.*?)</span>", re.S),
    "city": re.compile(r">المدينة<!-- -->:</span><span[^>]*>(.*?)</span>", re.S),
    "district": re.compile(r">الحى<!-- -->:</span><span[^>]*>(.*?)</span>", re.S),
    "postal": re.compile(r">الرمز البريدي<!-- -->:</span><span[^>]*>(.*?)</span>", re.S),
}


def _rendered_location(body: str) -> dict[str, str]:
    """Arabic region/city/district from the server-rendered «الموقع» card.

    Raghdan serves TWO page shapes. On the REGA-sourced shape (numeric ad ids), the JSON-LD
    `address` carries `addressCountry: "SA"` and NOTHING else — no locality, no region — while the
    page body renders the full location. The scraper only ever read JSON-LD, so those listings were
    stored with city/region/neighborhood all NULL and became unreachable by every city filter:
    172 of raghdan's 361 live rows on 2026-08-09.

    This is a CAPTURE gap, not missing source data — the values below are read verbatim from the
    page the user sees, never inferred. Everything downstream is unchanged: the strings still go
    through normalize.map_city / REGION_AR / the district catalog, so an unrecognised value still
    resolves to an honest NULL rather than leaking onto the card.

    Scoped to the text AFTER the «الموقع» heading on purpose: an earlier «العنوان» card repeats a
    (usually blank) «المدينة» label, and reading that one back would overwrite a good city with "".
    """
    m = _LOC_CARD_RE.search(body)
    if not m:
        return {}
    tail = body[m.end():]
    out: dict[str, str] = {}
    for key, rx in _LOC_FIELD_RE.items():
        hit = rx.search(tail)
        if not hit:
            continue
        val = _strip_tags(hit.group(1)).strip()
        # "غير محدد" is raghdan's own placeholder — an explicit "unspecified", not a value.
        if val and val != "غير محدد":
            out[key] = val
    return out


# ── The server-rendered spec / licence / deed / utilities panel ────────────────
# Same class of capture gap as _rendered_location above: the JSON-LD carries only area, rooms and a
# prose description, while the page the user sees renders a full REGA-grade panel. Until 2026-08-11
# the scraper read none of it, so raghdan held 0/71 ad licences, 0 street widths and 0 utilities on
# its searchable annual-rent apartments — not because the source is silent, but because we never
# looked. Every value below is read verbatim from the rendered page; nothing is inferred.
_LABEL_TPL = r">{}<!-- -->:</span>\s*<span[^>]*>(.*?)</span>"
_SPEC_FIELDS = {
    "street_width":    "عرض الشارع",
    "street_name":     "شارع",
    "ad_license":      "رقم ترخيص الإعلان",
    "brokerage_license": "رقم رخصة الوساطة",
    "deed_type":       "نوع الصك",
    "plan_number":     "رقم المخطط",
    "parcel_number":   "رقم القطعة",
    "deed_location":   "وصف الموقع حسب الصك",
    "building_code":   "مطابقة كود البناء السعودي",
    "ad_source":       "مصدر الإعلان",
    "license_expiry":  "تاريخ انتهاء صلاحية الإعلان",
    "published_at":    "تاريخ النشر",
    "registry_restrictions": "قيود السجل العقاري",
    "obligations":     "الالتزامات على العقار",
    "warranties":      "الضمانات ومدتها",
}
_SPEC_RE = {k: re.compile(_LABEL_TPL.format(re.escape(v)), re.S) for k, v in _SPEC_FIELDS.items()}

# «المرافق» is a positive-only list, so a utility that is not listed means the seller did not say —
# NULL, never false. Scoped to the «مرافق العقار واستخداماته» card because the page footer carries
# an unrelated «المرافق» string in its newsletter block.
_UTIL_CARD_RE = re.compile(r"مرافق العقار واستخداماته(.{0,1200}?)إستخدام العقار", re.S)
_UTILITIES = {
    "كهرباء": "electricity",
    "مياه": "water_supply",
    "صرف صحي": "sanitation",
    "ألياف ضوئية": "optical_fibers",
}


def _rendered_specs(body: str) -> dict[str, str]:
    """Label → verbatim value from the rendered spec/licence/deed cards. Placeholders drop out."""
    out: dict[str, str] = {}
    for key, rx in _SPEC_RE.items():
        m = rx.search(body)
        if not m:
            continue
        val = _strip_tags(m.group(1)).strip()
        # raghdan's own placeholders for "nothing here" — an absent value, not a value.
        if val and val not in ("غير محدد", "-", "—"):
            out[key] = val
    return out


def _rendered_utilities(body: str) -> dict[str, bool]:
    m = _UTIL_CARD_RE.search(body)
    if not m:
        return {}
    card = _strip_tags(m.group(1))
    return {col: True for ar, col in _UTILITIES.items() if ar in card}


def _spec_int(v: Optional[str]) -> Optional[int]:
    """«عرض الشارع» and «رقم القطعة» print a literal 0 when the seller left them blank. Storing 0
    would claim a zero-metre street; 0 here means "not stated", so it must stay NULL."""
    n = _int(v)
    return n if n and n > 0 else None


def _map_type(*candidates: str) -> Optional[str]:
    """Whole string then first token, exact-first then substring — via the SHARED canonical map
    (normalize.map_type) with TYPE_OVERRIDES_AR as the exact-match override layer."""
    for c in candidates:
        if not c:
            continue
        c = c.strip()
        first = c.split(" ")[0] if " " in c else c
        for cand in (c, first):
            hit = normalize.map_type_exact(cand, TYPE_OVERRIDES_AR)
            if hit:
                return hit
        hit = normalize.map_type(c, TYPE_OVERRIDES_AR)
        if hit:
            return hit
    return None


def _images(ld: Optional[dict]) -> list[str]:
    """Full-size Firebase Storage URLs from JSON-LD image[]. Tokens are embedded (public).
    Drops obvious logos/placeholders; no size-suffix stripping needed (Firebase serves originals)."""
    out: list[str] = []
    seen: set[str] = set()
    BAD = ("logo", "placeholder", "no_image", "no-image", "noimage", "default-")
    for u in (ld.get("image") if ld else None) or []:
        if not isinstance(u, str) or not u.startswith("http"):
            continue
        if any(b in u.lower() for b in BAD):
            continue
        if u in seen:
            continue
        seen.add(u)
        out.append(u)
    return out[:25]


def _desc_specs(desc: str) -> dict[str, str]:
    """Parse 'المساحة 148.62 م²، عدد الغرف 4، العمر: جديد، الواجهة: شرقية' into parts."""
    out: dict[str, str] = {}
    if not desc:
        return out
    for seg in re.split(r"[،,]", desc):
        seg = seg.strip()
        if seg.startswith("المساحة"):
            out["area"] = seg
        elif seg.startswith("عدد الغرف"):
            out["rooms"] = re.sub(r"[^\d]", "", seg.translate(normalize._TRANS))
        elif seg.startswith("العمر"):
            out["age"] = seg.split(":", 1)[-1].strip()
        elif seg.startswith("الواجهة"):
            out["facade"] = seg.split(":", 1)[-1].strip()
    return out


def map_listing(body: str, url: str) -> tuple[Optional[dict], str]:
    if "هذا الإعلان" in body and "منتهي" in body:
        return None, "residential"
    ld, bc = _ld_blocks(body)
    if not ld:
        return None, "residential"

    m = re.search(r"/ar/property/([A-Za-z0-9_-]+)/?$", url)
    if not m:
        return None, "residential"
    fid = m.group(1)
    listing_url = f"{BASE}/ar/property/{fid}/"

    name = ld.get("name") or ""
    description_raw = ld.get("description") or ""
    specs = _desc_specs(description_raw)

    # ── type + category ──
    mapped_type = _map_type(name, _breadcrumb_district(bc) or "")
    # Unmapped type → STORE the raw listing name, never a guessed default (owner directive
    # 2026-07-16: never confidently misclassify — the raw value trips the DB novel-type detector,
    # which quarantines + alerts). The legacy value below feeds ONLY the routing/sanity rules.
    property_type = mapped_type or "Residential Land"  # type-truth: routing-legacy only — never stored
    stored_property_type = mapped_type or name.strip() or "unknown"
    category = "commercial" if property_type in COMMERCIAL_TYPES else "residential"

    # ── transaction type (businessFunction Sell|LeaseOut; name للبيع|للإيجار) ──
    offers = ld.get("offers") or {}
    bf = (offers.get("businessFunction") or "").lower()
    is_rent = "leaseout" in bf or "lease" in bf or "للإيجار" in name or "للايجار" in name
    if "sell" in bf or "للبيع" in name:
        is_rent = False

    # ── area ──
    fs = ld.get("floorSize") or {}
    area = _float(fs.get("value")) if isinstance(fs, dict) else None
    if not area:
        area = _float(re.sub(r"[^\d.]", " ", specs.get("area", "")).strip().split(" ")[0]) if specs.get("area") else None

    # ── price ──
    raw_price = _int(offers.get("price"))
    price_total = price_annual = price_per_meter = None
    # rent_period stays None: raghdan publishes NO rental period anywhere — the JSON-LD offers
    # block carries price only and the page prints a bare figure («٩٥ ألف»), so any period label
    # would be manufactured (2026-08-11 audit: 127 rent rows carried a hardcoded سنوي the source
    # never stated). The file-header note that offers.price is annual is a one-time engineering
    # assertion about Firestore docs this scraper does not read — not a per-listing source signal.
    rent_period = None
    if raw_price:
        if is_rent:
            price_annual = raw_price
        elif property_type in LAND_TYPES:
            # Buy + land: offers.price is the PER-METER rate. Store it as the rate and leave
            # price_total NULL — the source did not print a total here (see PRICE SEMANTICS above).
            price_per_meter = raw_price
        else:
            # Buy + building/unit: offers.price is the TOTAL. Store it as the total and leave
            # price_per_meter NULL — deriving it would fabricate a rate the source never printed.
            price_total = raw_price

    # NO magnitude gate. A sub-1000 total is stored exactly as the source published it, same as the
    # land per-meter rate directly above.
    #
    # Removed 2026-08-09. This block used to null any total under 1,000 SAR as an "absurdly low
    # data-entry slip". That is a plausibility judgement on a source-published price, which the
    # standing owner rule (2026-08-03) forbids: if the platform displays it, we display it, and it
    # stays searchable at any magnitude. It also made raghdan the only scraper silently disagreeing
    # with the PRICE = SOURCE invariant, and it is unfalsifiable by design — a discarded price
    # leaves no evidence, so a genuinely cheap listing and a source typo become indistinguishable
    # downstream. Wrong prices are corrected against the SOURCE PAGE, never inferred from magnitude;
    # the «سعر المتر 1» placeholder case is handled at DISPLAY (ResultCard), altering no stored data.

    # ── location ──
    addr = ld.get("address") or {}
    raw_city = (addr.get("addressLocality") or "").strip()
    raw_region = (addr.get("addressRegion") or "").strip()
    # JSON-LD is authoritative when it carries the fields; the rendered «الموقع» card is the
    # fallback for the REGA-sourced page shape, which publishes location ONLY in the body.
    rendered = _rendered_location(body) if not (raw_city and raw_region) else {}
    raw_city = raw_city or rendered.get("city", "")
    raw_region = raw_region or rendered.get("region", "")
    # Forward-fix (2026-07-10 location-data-quality audit): removed the "Other" fallback AND the
    # subsequent "if region and city == 'Other': city = region" block below it — that block used to
    # silently surface a REGION NAME as the city label whenever city resolution failed but region
    # resolution succeeded. A region name is not a city; an honest None is correct, and the raw
    # Arabic signal this scraper captures elsewhere is unchanged for a DB-side resolver to use.
    city = normalize.map_city(raw_city)
    region = None
    for ar, en in REGION_AR.items():
        if ar in raw_region:
            region = en
            break
    if not region:
        region = CITY_TO_REGION.get(city)
    district = _breadcrumb_district(bc) or rendered.get("district")

    # ── PDPL-safe text (broker.name is DROPPED entirely; phones redacted) ──
    title = _redact(_strip_tags(name))
    description = _redact(description_raw)

    # ── property age (from "العمر: …" text) ──
    age_text = specs.get("age")
    property_age = AGE_AR.get(age_text) if age_text else None

    geo = ld.get("geo") or {}
    # NOTE: address.streetAddress is DROPPED for PDPL — too often a person name, not a street.

    info: dict[str, Any] = {
        "firebase_id": fid,
        "city_ar": raw_city or None,
        "region_ar": raw_region or None,
        "district_ar": district,
        "facade": specs.get("facade"),
        "age_text": age_text,
        "latitude": geo.get("latitude"),
        "longitude": geo.get("longitude"),
        "postal_code": addr.get("postalCode"),
        "price_currency": offers.get("priceCurrency"),
        "availability": offers.get("availability"),
        "business_function": offers.get("businessFunction"),
    }
    # ── the rendered spec / licence / deed panel (see _rendered_specs) ──
    sp = _rendered_specs(body)
    info.update({
        # `rega_ad_license_number` is the key listing_extra_attrs already reads for other platforms.
        # The AD licence only — NOT «رقم رخصة الوساطة», which is the brokerage's own company licence
        # and is identical on every raghdan listing. Two different licences; never merged.
        "rega_ad_license_number": sp.get("ad_license"),
        "brokerage_license_number": sp.get("brokerage_license"),
        "deed_location_text": sp.get("deed_location"),
        "deed_type": sp.get("deed_type"),
        "plan_number": sp.get("plan_number"),
        "parcel_number": sp.get("parcel_number") if _spec_int(sp.get("parcel_number")) else None,
        "saudi_building_code": sp.get("building_code"),
        "ad_source": sp.get("ad_source"),
        "license_expiry": sp.get("license_expiry"),
        "registry_restrictions": sp.get("registry_restrictions"),
        "obligations": sp.get("obligations"),
        "warranties": sp.get("warranties"),
        # kept as source text in JSONB rather than the typed `date_added` column: raghdan prints
        # DD/MM/YYYY, and dropping that into a column other platforms fill in a different shape
        # would create a field nobody can parse without knowing the platform first.
        "published_at": sp.get("published_at"),
    })
    info = {k: v for k, v in info.items() if v not in (None, "", "—")}

    row: dict[str, Any] = {
        "ad_number": f"RG{fid}",
        "listing_url": listing_url,
        "source": "Raghdan",
        "active": True,
        "property_type": stored_property_type,
        "transaction_type": "Rent" if is_rent else "Buy",
        "area_m2": round(area) if area else None,
        # Both "عدد الغرف" (specs.rooms) and schema.org's numberOfRooms are generic total-room-count
        # fields, never bedroom-specific — raghdan exposes no separate bedroom field, and its
        # REGA-sourced pages never display one either (live-confirmed 2026-07-28: 0/3 sampled pages
        # carry a "غرف النوم" label). Owner decision: null rather than store an unverifiable figure.
        "bedrooms": None,
        "property_age": property_age,
        "direction": specs.get("facade") or None,
        "price_total": price_total,
        "price_annual": price_annual,
        "price_per_meter": price_per_meter,
        "rent_period": rent_period,
        "city": city,
        "region": region,
        "neighborhood": district,
        "zip_code": addr.get("postalCode") or None,
        # «شارع» is NOT stored. This scraper already drops address.streetAddress because on raghdan
        # that field is frequently a PERSON name rather than a street, and we cannot tell an owner
        # or advertiser name from an official street name. The «شارع» card carries the same free
        # text with the same ambiguity (live values seen: "رقم 469", "محمد بن عبدالعزيز الدغيثر"),
        # so the same absolute PDPL decision applies. Nothing downstream reads street_name.
        "street_width_m": _spec_int(sp.get("street_width")),
        "title": title,
        "description": description,
        "photo_urls": _images(ld),
        "additional_info": info,
        # utilities: listed ⇒ True, not listed ⇒ absent ⇒ NULL (never False)
        **_rendered_utilities(body),
    }
    return row, category


# ── Main ────────────────────────────────────────────────────────────────────────
def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--type", choices=["residential", "commercial", "all"], default="all")
    ap.add_argument("--limit", type=int, default=0,
                    help="small validation run: upsert only the first N parsed listings, NO prune")
    args = ap.parse_args()

    s = session()
    # begin_run BEFORE the sitemap fetch (same fix as jazwtn 2026-07-27): sitemap_urls() can now
    # raise (see its module note), and that raise must still land a scrape_runs row via the
    # except-arm below, not vanish before any row exists.
    run_id = None if args.limit else db.begin_run("raghdan")
    res: list[dict] = []
    com: list[dict] = []
    seen = 0
    try:
        urls = sitemap_urls(s)
        if args.limit:
            urls = urls[: max(args.limit * 3, 30)]
        print(f"Raghdan: {len(urls)} candidate listings ({WORKERS} workers)"
              f"{' [LIMIT ' + str(args.limit) + ']' if args.limit else ''}")

        res_buf: list[dict] = []
        com_buf: list[dict] = []

        def flush() -> None:
            nonlocal res_buf, com_buf
            if res_buf:
                db.upsert_raghdan_residential_batch(res_buf)
                res_buf = []
            if com_buf:
                db.upsert_raghdan_commercial_batch(com_buf)
                com_buf = []

        with ThreadPoolExecutor(max_workers=WORKERS) as ex:
            for result in ex.map(fetch_one, urls):
                if not result:
                    continue
                body, u = result
                row, cat = map_listing(body, u)
                if not row:
                    continue
                if args.type != "all" and cat != args.type:
                    continue
                (com_buf if cat == "commercial" else res_buf).append(row)
                (com if cat == "commercial" else res).append(row)
                seen += 1
                if len(res_buf) + len(com_buf) >= 50:
                    flush()
                    print(f"  …{seen} upserted", flush=True)
                if args.limit and seen >= args.limit:
                    break
        flush()

        if args.limit:
            print(f"✓ Raghdan VALIDATION: {len(res)} residential + {len(com)} commercial upserted (no prune)")
            for r in (res + com)[:6]:
                print("  ", {k: r.get(k) for k in (
                    "ad_number", "property_type", "transaction_type", "city", "region",
                    "neighborhood", "area_m2", "bedrooms", "price_total", "price_annual",
                    "price_per_meter", "rent_period")})
                print("     photo:", (r["photo_urls"] or ["(none)"])[0][:80])
            return 0

        # Full run: prune listings that were active before but weren't seen this crawl.
        pruned = 0
        for tbl, rows_seen in (("raghdan_residential_listings", res),
                               ("raghdan_commercial_listings", com)):
            n = db.prune_unseen(tbl, {r["ad_number"] for r in rows_seen}, source="Raghdan")
            if n < 0:
                print(f"⚠ {tbl}: prune guard tripped (0 scraped or collapse) — kept existing active")
            else:
                pruned += n
        print(f"✓ Raghdan: {len(res)} residential + {len(com)} commercial upserted, {pruned} stale pruned")
        healthy = db.end_run(run_id, ok=True, rows_seen=seen, rows_upserted=seen, notes=f"pruned={pruned}", check_tables=["raghdan_residential_listings", "raghdan_commercial_listings"])
        if not healthy:
            print("✗ run demoted to unhealthy by end_run()'s RC-B guard — failing CI instead of a silent success.", flush=True)
        return 0 if healthy else 1
    except Exception as e:
        if run_id:
            db.end_run(run_id, ok=False, rows_seen=seen, rows_upserted=0, notes=str(e)[:300])
        print(f"✗ {e}")
        import traceback
        traceback.print_exc()
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
