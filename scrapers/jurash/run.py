"""Jurash (jurash.sa / شركة جرش العقارية — "Jurash Real Estate") scraper — Saudi PHP/UIkit
brokerage site, static-HTML detail-page parse.

شركة جرش العقارية is a Saudi-registered real-estate company in Asir (Khamis Mushait / Abha /
mid-region القحمة). Saudi-owned → passes the Saudi-only rule. Boutique catalog (~11 active
listings). No auth, no proxy, cloud-friendly (server-rendered PHP, UIkit front-end).

Data path (auth-free, all static HTML):
  (1) Enumerate every /property/<id>/<ar-slug> link from the listings index الْعقارات
        (https://jurash.sa/العقارات), paginated via ?p=N (the site's own `change-page` JS uses
        the `p` query param). The stale /sitemap.xml carries DEAD ids (302 → /error), so we DON'T
        use it — the index is the live source of truth.
  (2) Fetch each detail page. Every detail page renders a server-side print_r() debug dump of the
        property record straight into the HTML — a clean `[key] => value` block we regex out:
          pt_id/pt_reference  → ad_number (JR{id})
          type  (فيلا/شقة/عمارة/الأرض)        → property_type (TYPE_MAP_AR; "الأرض"→ال-stripped)
          status (للبيع/للإيجار/تم البيع)      → transaction_type Buy|Rent ; "تم البيع"/"مؤجر"→ GONE
          pt_price                            → price_total | price_annual
          pt_size (م²)                         → area_m2 (falls back to "مساحة الأرض/البناء" in desc)
          pt_beds / pt_baths                   → bedrooms / bathrooms (residential only)
          pt_floor                             → additional_info.floor_number
          pt_garages (free text)               → parking (bool) + additional_info.parking_note
          city (خميس مشيط/ابها)                 → city (normalize.map_city) ; region DERIVED
          pt_latitude / pt_longitude           → additional_info lat/lng
          pt_video (YouTube id)                → video_url
          conditions (جديد/مستعمل)             → additional_info.condition_ar
          tr_title / tr_description (Arabic)    → title / description (phone-redacted)
      Gallery: the `<div uk-lightbox>` block holds this listing's own /images/*.jpeg gallery
        (the related-listings carousel `uk-slider` comes AFTER it — we stop there). Logos/icons
        excluded.

LOCATION: city (Arabic) → normalize.map_city → English; region is then DERIVED from the city via
  normalize.region_for_city (NOT scraped). District comes from the title's "حي …". All listings
  are Asir (Khamis Mushait / Abha / mid-region القحمة → mapped to its parent city).

REGA: the description carries "رقم ترخيص الإعلان: <license>" (FAL ad licence) → parsed into
  additional_info.rega_ad_license_number and sets rega_location_verified = True. We read ONLY the
  licence NUMBER, never any person/owner identity.

⛔⛔ PDPL ABSOLUTE — we NEVER store an advertiser/agent/owner PERSON name or ANY phone number.
  Each description ends with a "للتواصل واتساب: 966509663434 …" contact line; we REDACT every
  phone shape (05x / +9665 / bare 966xxxxxxxxx / 9200 / 920 / 800 / wa.me / واتساب) AND drop the
  "للتواصل"/"للحجز"/"للاستفسار" contact line entirely from title + description before storing.
  A registered COMPANY name (شركة جرش …) is allowed and isn't even persisted. National ID /
  deed-owner identity is never present and never stored.

Usage:  python -m scrapers.jurash.run [--limit N] [--type residential|commercial|all]
"""
from __future__ import annotations

import argparse
import html as ihtml
import os
import re
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any, Optional
from urllib.parse import quote, unquote

from curl_cffi import requests as cc

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT.parent) not in sys.path:
    sys.path.insert(0, str(ROOT.parent))

from scrapers.common import db, normalize  # noqa: E402

BASE = "https://jurash.sa"
INDEX = f"{BASE}/العقارات"
WORKERS = int(os.environ.get("JURASH_WORKERS", "5"))
MAX_PAGES = int(os.environ.get("JURASH_MAX_PAGES", "25"))

# resolved `type` label (Arabic) → canonical English. "الأرض" carries the definite article ال.
TYPE_MAP_AR = {
    "شقة": "Apartment", "شقه": "Apartment", "استوديو": "Apartment",
    "فيلا": "Villa", "فلة": "Villa", "دوبلكس": "Villa", "قصر": "Villa",
    "دور": "Floor", "روف": "Floor", "بيت": "House", "منزل": "House",
    "عمارة": "Building", "عماره": "Building", "بناية": "Building",
    "أرض": "Residential Land", "ارض": "Residential Land",
    "استراحة": "Rest House", "استراحه": "Rest House", "إستراحة": "Rest House",
    "شاليه": "Chalet", "مزرعة": "Farm", "مزرعه": "Farm", "غرفة": "Room", "غرفه": "Room",
    # commercial
    "محل": "Shop", "مكتب": "Office", "مستودع": "Warehouse", "معرض": "Showroom",
    "ورشة": "Workshop", "ورشه": "Workshop", "مصنع": "Factory",
    "أرض تجارية": "Commercial Land", "ارض تجارية": "Commercial Land",
    "عمارة تجارية": "Commercial Building", "برج": "Commercial Building",
}
COMMERCIAL_TYPES = {
    "Shop", "Office", "Warehouse", "Showroom", "Workshop", "Factory",
    "Commercial Land", "Commercial Building",
}
LAND_TYPES = {"Residential Land", "Commercial Land", "Farm"}
# status / sold markers that mean the listing is no longer available.
GONE_STATUS = ("تم البيع", "تم التأجير", "مباع", "مؤجر", "محجوز", "sold", "rented")

# Phone / contact patterns to REDACT (PDPL). Jurash inlines a "واتساب: 966509663434" line, so the
# bare-966 (no +) shape is the key one; we cover every other shape defensively too.
_PHONE_RE = re.compile(
    r"(?:\+?00?966\d{8,9}"                 # +966xxxxxxxx / 00966xxxxxxxxx
    r"|\b966\d{8,9}\b"                     # bare 966xxxxxxxx(x) (e.g. 966509663434)
    r"|0?5\d(?:[\s\.\-]?\d){7}"            # 05xxxxxxxx / 5xxxxxxxx, separators allowed
    r"|\b9200\d{4}\b"                      # 9200xxxx short-codes
    r"|\b920\d{6}\b"                       # 920xxxxxx unified numbers
    r"|\b800\d{7}\b"                       # 800xxxxxxx toll-free
    r"|wa\.me/\S+"
    r"|واتس\S*\s*\d[\d\s\-]{6,})"
)
_PHONE_LOOSE = re.compile(r"[\(\[\{«]{1,3}\s*0?5[\d\s\.\-]{7,}\s*[\)\]\}»]{1,3}")
# the whole contact / call-to-action line ("للتواصل واتساب: …", "للحجز والاستفسار …").
_CONTACT_LINE = re.compile(r"\s*(?:للتواصل|للحجز|للاستفسار|للإستفسار|تواصل معنا|اتصل)[^\n]*", re.I)
# REGA ad licence number, e.g. "رقم ترخيص الإعلان: 7200997489" (may be "-7200..." or a hyphen-pair).
REGA_RE = re.compile(r"رقم\s*ترخيص\s*الإعلان\s*[:\-؛]*\s*-?([\d٠-٩][\d٠-٩\-]{5,})")
# "مساحة الأرض: 800 م²" / "مساحة البناء: 544 م²" / "المساحة: 350 م²" — fallback when pt_size is "-".
AREA_RE = re.compile(r"مساح[ةه][^\d٠-٩:：]{0,12}[:：]?\s*([\d٠-٩][\d٠-٩.,]*)\s*(?:م²|م2|م\b|متر)")
# district from the title: "… حي الراقي …" / "بحي الظرفة" — stop at structural connectors.
_DIST_STOP = ("خميس", "بخميس", "ابها", "بابها", "أبها", "مدينة", "بمدينة", "منطقة", "مركز",
              "للبيع", "للايجار", "للإيجار", "شارع", "بمنطقة")
DISTRICT_RE = re.compile(r"ب?حي\s+(.+?)(?:\s+(?:" + "|".join(_DIST_STOP) + r")\b|[\(\)،,–\-|]|$)")

_BAD_IMG = ("logo", "icon", "placeholder", "no-image", "no_image", "favicon", "cover-og",
            "/area.", "/baths.", "/beds.", "/floor.", "/garage.", "spinner", "avatar")

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


def _to_int(v: Any) -> Optional[int]:
    n = normalize.to_int(v)
    return n if n else None


def _to_float(v: Any) -> Optional[float]:
    if v in (None, "", "-", "—"):
        return None
    s = str(v).translate(normalize._TRANS)
    s = re.sub(r"[^\d.]", "", s)
    try:
        return float(s) if s else None
    except ValueError:
        return None


def _redact(text: Optional[str]) -> Optional[str]:
    if not text:
        return text
    t = _CONTACT_LINE.sub(" ", text)
    t = _PHONE_LOOSE.sub(" ", t)
    t = _PHONE_RE.sub(" ", t)
    t = re.sub(r"رقم\s*ترخيص\s*الإعلان\s*[:\-؛]*\s*-?[\d٠-٩][\d٠-٩\-]{5,}", " ", t)
    t = re.sub(r"[ \t]{2,}", " ", t)
    t = re.sub(r"\n{3,}", "\n\n", t)
    return t.strip() or None


# ── Listing-index enumeration ──────────────────────────────────────────────────
def index_urls(s: cc.Session) -> list[str]:
    """Return every live /property/<id>/<slug> URL across the paginated listings index.
    Dedup on the numeric id (the index repeats the same card in a few widgets)."""
    out: list[str] = []
    seen: set[str] = set()
    for page in range(1, MAX_PAGES + 1):
        try:
            r = s.get(f"{INDEX}?p={page}", timeout=30)
        except Exception:
            break
        if r.status_code != 200:
            break
        hrefs = re.findall(r'href="(https://jurash\.sa/property/\d+/[^"]+)"', r.text)
        new_here = 0
        for h in hrefs:
            pid = h.split("/property/")[1].split("/")[0]
            if pid in seen:
                continue
            seen.add(pid)
            out.append(h)
            new_here += 1
        # stop when this page added nothing and there is no further `change-page` target.
        if new_here == 0 and f'data-page="{page + 1}"' not in r.text:
            break
        if f'data-page="{page + 1}"' not in r.text:
            break
    return out


def _encode_url(url: str) -> str:
    """The index emits raw-Arabic hrefs; encode the slug path segment for the request."""
    try:
        pid, slug = url.split("/property/")[1].split("/", 1)
        return f"{BASE}/property/{pid}/{quote(unquote(slug), safe='')}"
    except Exception:
        return url


def fetch_one(url: str) -> Optional[tuple[str, str]]:
    s = _session()
    req = _encode_url(url)
    pid = url.split("/property/")[1].split("/")[0]
    for attempt in range(3):
        try:
            r = s.get(req, timeout=45, allow_redirects=True)
        except Exception:
            time.sleep(1.2 * (attempt + 1))
            continue
        # a dead id 302s to /error → its real page-body never renders the print_r dump.
        if r.status_code == 200 and len(r.text) > 3000 and f"[pt_id] => {pid}" in r.text:
            return r.text, url
        time.sleep(1.0 * (attempt + 1))
    return None


# ── Parsing ────────────────────────────────────────────────────────────────────
def _dump_fields(body: str) -> dict[str, str]:
    """Pull the server-side print_r() dump's named `[key] => value` pairs (first occurrence wins).

    Single-line scalar fields stop at the first newline. `tr_description` (and `tr_title`) are
    MULTI-LINE: print_r renders them up to the next dump key, which is a numeric duplicate marker
    "[NN] =>" — so we capture greedily up to that marker to keep the whole description (the REGA
    licence line + the contact line live at its tail, and we still REDACT the contact line later).
    """
    out: dict[str, str] = {}
    for k, v in re.findall(r"\[([a-zA-Z_][a-zA-Z0-9_]*)\]\s*=>\s*([^\n\[]*)", body):
        if k not in out:
            out[k] = ihtml.unescape(v.strip())
    for key in ("tr_description", "tr_title"):
        m = re.search(
            r"\[" + key + r"\]\s*=>\s*(.*?)\n\s*\[(?:\d+|tr_[a-z_]+|slug|status|city|zone|type|"
            r"conditions)\]\s*=>",
            body, re.S,
        )
        if m:
            val = ihtml.unescape(m.group(1).strip())
            if val:
                out[key] = val
    return out


def _description(fields: dict[str, str]) -> Optional[str]:
    return _redact(fields.get("tr_description"))


def _images(body: str) -> list[str]:
    """Gallery images from THIS listing's `<div uk-lightbox>` block only (the related-listings
    `uk-slider` carousel that follows is excluded). Dedupe, drop logos/icons/UI sprites."""
    i = body.find("uk-lightbox")
    if i == -1:
        return []
    end = body.find("uk-slider", i)
    if end == -1:
        end = i + 20000
    block = body[i:end]
    out: list[str] = []
    seen: set[str] = set()
    for u in re.findall(
        r'<a\s+href="(https://jurash\.sa/images/[^"]+?\.(?:jpe?g|png|webp))"', block, re.I
    ):
        low = u.lower()
        if any(b in low for b in _BAD_IMG):
            continue
        if u not in seen:
            seen.add(u)
            out.append(u)
    return out[:25]


def map_listing(body: str, url: str) -> tuple[Optional[dict], str, bool]:
    """Return (row, category, gone). gone=True → sold/rented → mark inactive / skip."""
    f = _dump_fields(body)
    pid = f.get("pt_id") or f.get("pt_reference") or f.get("tr_property")
    if not pid:
        return None, "residential", False

    # ── type + category ──
    type_ar = (f.get("type") or "").strip()
    # strip a leading definite article ("الأرض" → "أرض")
    type_key = type_ar
    if type_key.startswith("ال") and type_key not in TYPE_MAP_AR:
        type_key = type_key[2:]
    mapped_type = TYPE_MAP_AR.get(type_ar) or TYPE_MAP_AR.get(type_key) \
        or normalize.map_type(type_ar) or normalize.map_type(f.get("tr_title", ""))
    # Unmapped type → STORE the raw type/title text, never a guessed default (owner directive
    # 2026-07-16: never confidently misclassify — the raw value trips the DB novel-type detector,
    # which quarantines + alerts). The legacy value below feeds ONLY the routing/sanity rules.
    property_type = mapped_type or "Residential Land"  # type-truth: routing-legacy only — never stored
    stored_property_type = mapped_type or type_ar or f.get("tr_title", "").strip() or "unknown"
    category = "commercial" if property_type in COMMERCIAL_TYPES else "residential"
    is_land = property_type in LAND_TYPES

    # ── transaction type + availability ──
    status = (f.get("status") or "").strip()
    gone = any(g in status for g in GONE_STATUS) or str(f.get("pt_sold", "0")).strip() == "1"
    is_rent = ("إيجار" in status or "ايجار" in status) and "بيع" not in status

    title_raw = f.get("tr_title") or ""
    description = _description(f)

    # ── price ──
    price = _to_int(f.get("pt_price"))
    if price is not None and price < 1000:
        price = None

    # ── area (pt_size, else description مساحة) ──
    area = _to_float(f.get("pt_size"))
    if area is None:
        am = AREA_RE.search(f.get("tr_description") or "")
        area = _to_float(am.group(1)) if am else None
    price_per_meter = None
    if price and area and not is_rent and not is_land:
        price_per_meter = round(price / area)
    elif is_land and price and area:
        price_per_meter = round(price / area)

    # ── beds / baths (residential, sane range) ──
    bedrooms = baths = None
    if category == "residential" and not is_land:
        b = _to_int(f.get("pt_beds"))
        if b and 0 < b <= 40:
            bedrooms = b
        bt = _to_int(f.get("pt_baths"))
        if bt and 0 < bt <= 40:
            baths = bt

    # ── floor / parking ──
    floor_no = _to_int(f.get("pt_floor"))
    garage_txt = (f.get("pt_garages") or "").strip()
    parking = bool(garage_txt and garage_txt not in ("-", "—", "0"))

    # ── location ── city (Arabic) → English; region DERIVED from the city.
    city_ar = (f.get("city") or "").strip()
    city = normalize.map_city(city_ar) or normalize.map_city(title_raw) or "Khamis Mushait"
    region = normalize.region_for_city(city) or "Asir"

    district = None
    dm = DISTRICT_RE.search(title_raw) or (DISTRICT_RE.search(description) if description else None)
    if dm:
        district = dm.group(1).strip(" -،,|") or None

    # ── REGA ad licence (number only — never any person identity) ──
    rega_lic = None
    rm = REGA_RE.search(f.get("tr_description") or "")
    if rm:
        rega_lic = rm.group(1).strip("-").translate(normalize._TRANS)

    # ── video (YouTube id → full URL) ──
    vid = (f.get("pt_video") or "").strip()
    vid = vid.split("?")[0].split("&")[0]
    video_url = f"https://www.youtube.com/watch?v={vid}" if vid and vid not in ("-", "") else None

    title = _redact(title_raw) or title_raw

    info: dict[str, Any] = {
        "city_ar": city_ar or None,
        "district_ar": district,
        "type_ar": type_ar or None,
        "condition_ar": (f.get("conditions") or None),
        "floor_number": floor_no,
        "parking_note": garage_txt or None,
        "rega_ad_license_number": rega_lic,
        "latitude": _to_float(f.get("pt_latitude")),
        "longitude": _to_float(f.get("pt_longitude")),
        "reference": (f.get("pt_reference") or None),
        "is_featured": str(f.get("pt_featured", "0")).strip() == "1",
        "status_ar": status or None,
    }
    info = {k: v for k, v in info.items() if v not in (None, "", "-", "—", [])}

    row: dict[str, Any] = {
        "ad_number": f"JR{pid}",
        "listing_url": url,
        "source": "Jurash",
        "active": not gone,
        "property_type": stored_property_type,
        "transaction_type": "Rent" if is_rent else "Buy",
        "area_m2": int(round(area)) if area else None,
        "bedrooms": bedrooms,
        "bathrooms": baths,
        "parking": parking,
        "price_total": price if not is_rent else None,
        "price_annual": price if is_rent else None,
        "price_per_meter": price_per_meter,
        "rent_period": "annual" if is_rent else None,
        "city": city,
        "region": region,
        "neighborhood": district,
        "rega_location_verified": bool(rega_lic),
        "title": title,
        "description": description,
        "video_url": video_url,
        "photo_urls": _images(body),
        "additional_info": info,
    }
    return row, category, gone


def _pin_sold_inactive(table: str, ad_numbers: list[str]) -> None:
    """Make source-confirmed SOLD/RENTED rows inactive NOW and survivors of the nightly
    auto_recover_false_inactive() sweep.

    Jurash's flow SKIPS gone rows (they are never upserted — see the `if gone: continue` in main),
    so a listing the site explicitly marks sold/rented used to stay ACTIVE for 3 more crawls
    until prune_unseen()'s 3-strike counter caught it as \"unseen\". This pin closes that window:
    active=false + missing_count=3 (the existing prune 3-strike threshold) the same crawl the
    source says gone. Writing missing_count=3 together with active=false also guarantees the row
    can never sit in the state the 05:20 UTC auto-recover sweep resurrects (active=false AND
    coalesce(missing_count,0)=0 AND a fresh last_seen_at — the exact state 900+ dealapp rows were
    stuck in on 2026-07-16). prune_unseen() never undoes the pin: it only selects active=true
    rows. When a listing is later relisted, its next upsert carries active=true and the upsert's
    own missing_count=0 reset applies — the pin is only written for ids that are gone THIS
    crawl."""
    for i in range(0, len(ad_numbers), 200):
        db._execute(
            db.sb().table(table).update({"active": False, "missing_count": 3})
            .in_("ad_number", ad_numbers[i:i + 200]),
            what=table + ".sold_pin",
        )


# ── Main ────────────────────────────────────────────────────────────────────────
def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--type", choices=["residential", "commercial", "all"], default="all")
    ap.add_argument("--limit", type=int, default=0,
                    help="validation run: upsert only the first N parsed listings, NO prune")
    args = ap.parse_args()

    s = session()
    urls = index_urls(s)
    if not urls:
        print("✗ Jurash: listings index returned no URLs")
        return 1
    if args.limit:
        urls = urls[: max(args.limit * 2, 20)]
    print(f"Jurash: {len(urls)} candidate listings ({WORKERS} workers)"
          f"{' [LIMIT ' + str(args.limit) + ']' if args.limit else ''}")

    run_id = None if args.limit else db.begin_run("jurash")
    res: list[dict] = []
    com: list[dict] = []
    sold_res: list[str] = []
    sold_com: list[str] = []
    gone_ct = 0
    seen = 0
    try:
        res_buf: list[dict] = []
        com_buf: list[dict] = []

        def flush() -> None:
            nonlocal res_buf, com_buf
            if res_buf:
                db.upsert_jurash_residential_batch(res_buf)
                res_buf = []
            if com_buf:
                db.upsert_jurash_commercial_batch(com_buf)
                com_buf = []

        with ThreadPoolExecutor(max_workers=WORKERS) as ex:
            for result in ex.map(fetch_one, urls):
                if not result:
                    continue
                body, u = result
                row, cat, gone = map_listing(body, u)
                if not row:
                    continue
                if gone:
                    gone_ct += 1
                    # remember the id so any EXISTING row is pinned inactive after the upserts
                    (sold_com if cat == "commercial" else sold_res).append(row["ad_number"])
                    continue  # don't list sold/rented
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
        # Pin sold/rented rows immediately after the upserts: gone rows are never upserted here,
        # but without the pin an already-listed row stays active for 3 more crawls (prune's
        # 3-strike) while the site explicitly says gone. See _pin_sold_inactive.
        if sold_res:
            _pin_sold_inactive("jurash_residential_listings", sold_res)
        if sold_com:
            _pin_sold_inactive("jurash_commercial_listings", sold_com)

        if args.limit:
            print(f"✓ Jurash VALIDATION: {len(res)} residential + {len(com)} commercial upserted "
                  f"({gone_ct} sold/rented pinned inactive, no prune)")
            for r in (res + com)[:8]:
                print("  ", {k: r.get(k) for k in (
                    "ad_number", "property_type", "transaction_type", "city", "region",
                    "neighborhood", "area_m2", "bedrooms", "price_total", "price_annual",
                    "price_per_meter")})
                print("     photos:", len(r["photo_urls"]),
                      "| first:", (r["photo_urls"] or ["(none)"])[0][:64])
            return 0

        # Full run: prune listings active before but not seen this crawl (we fetched the FULL index).
        # Gone rows are already active=false + missing_count=3 by now; prune_unseen never touches
        # them (it only reads active=true rows), so their absence from the seen set is harmless.
        pruned = 0
        for tbl, rows_seen in (("jurash_residential_listings", res),
                               ("jurash_commercial_listings", com)):
            n = db.prune_unseen(tbl, {r["ad_number"] for r in rows_seen}, source="Jurash")
            if n < 0:
                print(f"⚠ {tbl}: prune guard tripped (0 scraped or collapse) — kept existing active")
            else:
                pruned += n
        print(f"✓ Jurash: {len(res)} residential + {len(com)} commercial upserted, "
              f"{gone_ct} sold/rented pinned inactive, {pruned} stale pruned")
        db.end_run(run_id, ok=True, rows_seen=seen, rows_upserted=seen,
                   notes=f"gone={gone_ct} pruned={pruned}", check_tables=["jurash_residential_listings", "jurash_commercial_listings"])
        return 0
    except Exception as e:
        if run_id:
            db.end_run(run_id, ok=False, rows_seen=seen, rows_upserted=0, notes=str(e)[:300])
        print(f"✗ {e}")
        import traceback
        traceback.print_exc()
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
