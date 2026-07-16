"""Al Khaas (alkhaas.net / مكتب الخاص للعقارات) scraper — Saudi static-HTML broker site.

مكتب الخاص للعقارات ("للخاص للاستثمار العقاري") is a Saudi real-estate brokerage in Unaizah,
Al-Qassim region — own inventory, ~239 live ad pages. Saudi-owned → passes the Saudi-only rule.
No auth, no proxy, plain server-rendered HTML (a small custom PHP-ish app, no REST/JSON API).

Data path (auth-free, static HTML):
  Each listing lives at https://alkhaas.net/ads/<id>. The site exposes three category index
  pages — /category/0 (للبيع · Buy), /category/1 (للايجار · Rent), /category/2 (للاستثمار ·
  Invest) — but they render only the FRONT page of each category (no working pagination), so they
  surface ~33 of the ~239 listings. The ad ids are sequential and dense in the 31..1004 range, so
  we ENUMERATE the id range and keep every page that renders the detail table. A missing/invalid
  id silently serves the homepage shell (no detail table) — we detect that by the absence of the
  "<th>نوع العقار</th>" row and skip it.

Each /ads/<id> detail page carries a clean spec table of <th>LABEL</th><td>VALUE</td> pairs:
  عنوان الاعلان   → title
  نوع العقار  بيع|ايجار|استثمار → transaction_type (بيع/استثمار → Buy, ايجار → Rent)
  قسم العقار      → property_type (SECTION_MAP_AR; plural Arabic section words)
  المنطقة (منطقة القصيم) → region (normalize.region_for_city from the city; label kept in additional_info)
  المدينة (عنيزة)  → city (normalize.map_city)
  المساحة          → area_m2
  السعر            → price (the asking/main price)
  السوم            → the seller's reduced/offer price (kept in additional_info, NOT the headline)
…followed by a free-text description block (<div class="col-sm-12">) and a royalSlider gallery of
//alkhaas.net/uploads/<hash>.jpg images. The description sometimes embeds a TikTok/YouTube video
link (→ video_url) and a REGA ad licence ("ترخيص رقم: 7200959712" → rega_location_verified).

PRICE magnitude: values come as "275 الف" (=275,000), "120 الف", or "930000 الف ريال" (already
full — the "الف" is decorative). Rule: take the leading number; multiply by 1000 ONLY when the
"الف/الاف" unit word is present AND the number is small (< 10,000); otherwise the unit is noise and
we keep the number as-is.

⛔⛔ PDPL ABSOLUTE — the site's page CHROME (header/footer) hard-codes the office's mobile numbers
(05x …) on every page. We parse ONLY the listing's own table + description block, never the page
chrome, and we additionally REDACT any 05x / +9665 / 9200 / 920 / wa.me / واتساب pattern from the
title + description before storing. We never store any advertiser/owner person name or national ID.
The "رقم المعلن العقاري" / "ترخيص رقم" that appear in the body are REGA broker/ad LICENCE numbers
(company-level registration), not a person — those are allowed and captured into additional_info.

Usage:  python -m scrapers.alkhaas.run [--limit N] [--type residential|commercial|all]
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

from curl_cffi import requests as cc

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT.parent) not in sys.path:
    sys.path.insert(0, str(ROOT.parent))

from scrapers.common import db, normalize  # noqa: E402

BASE = "https://alkhaas.net"
WORKERS = int(os.environ.get("ALKHAAS_WORKERS", "8"))
# Dense id window for this broker (observed valid ids 31..1004). A small headroom (+30) future-proofs
# new listings without a meaningful extra cost (missing ids serve a cheap shell page).
ID_START = int(os.environ.get("ALKHAAS_ID_START", "1"))
ID_END = int(os.environ.get("ALKHAAS_ID_END", "1040"))

# قسم العقار (Arabic plural section word) → canonical English property type. The site groups by
# plural-noun "sections", so these are NOT the singular words in normalize.TYPE_MAP_AR.
SECTION_MAP_AR = {
    "أراضي سكنية": "Residential Land", "اراضي سكنية": "Residential Land",
    "فلل": "Villa",
    "دبلوكسات": "Villa", "دبلكسات": "Villa", "دوبلكسات": "Villa",
    "شقق": "Apartment",
    "أدوار": "Floor", "ادوار": "Floor",
    "استراحات": "Rest House", "إستراحات": "Rest House",
    "شاليهات": "Chalet",
    "مزارع": "Farm",
    "أراضي زراعية": "Farm", "اراضي زراعية": "Farm",
    # commercial
    "أراضي تجارية": "Commercial Land", "اراضي تجارية": "Commercial Land",
    "عمائر تجارية": "Commercial Building", "عمارات تجارية": "Commercial Building",
    "محلات": "Shop",
    "مستودعات": "Warehouse",
    "معارض": "Showroom",
    "مكاتب": "Office",
}
COMMERCIAL_TYPES = {
    "Shop", "Office", "Showroom", "Warehouse", "Commercial Land", "Commercial Building",
}

# transaction word (نوع العقار) → Buy/Rent. استثمار (invest) is a SALE offer → Buy.
RENT_WORDS = ("ايجار", "إيجار", "للايجار", "للإيجار")

# Phone / contact patterns to REDACT (PDPL). Hardened battery: the office's mobiles are hard-coded
# in the page chrome and a future template change could inline them into the body; cover every shape.
_PHONE_RE = re.compile(
    r"(?:\+?(?:00)?966\d{8,9}"             # +966xxxxxxxx / 00966xxxxxxxxx / 966xxxxxxxx
    r"|0?5\d(?:[\s\.\-]?\d){7}"            # 05xxxxxxxx / 5xxxxxxxx, separators allowed
    r"|\b9200\d{4}\b"                      # 9200xxxx short-codes
    r"|\b920\d{6}\b"                       # 920xxxxxx unified numbers
    r"|\b800(?:[\s\.\-]?\d){7}\b"          # 800xxxxxxx toll-free, separators allowed
    r"|wa\.me/\S+"
    r"|واتس\S*\s*\d[\d\s\-]{6,})"
)
_PHONE_LOOSE = re.compile(r"[\(\[\{«]{1,3}\s*0?5[\d\s\.\-]{7,}\s*[\)\]\}»]{1,3}")

# spec-table <th>LABEL</th><td>VALUE</td>
ROW_RE = re.compile(r"<th>(.*?)</th>\s*<td>(.*?)</td>", re.S)
# free-text description block
DESC_RE = re.compile(r'<div class="col-sm-12">(.*?)</div>', re.S)
# gallery big images
IMG_RE = re.compile(r'data-rsbigimg="(//alkhaas\.net/uploads/[^"]+)"')
UPLOAD_RE = re.compile(r'(?:src|href)="(//alkhaas\.net/uploads/[^"]+\.(?:jpe?g|png|webp))"', re.I)
# REGA ad licence number in the body
LICENSE_RE = re.compile(r"ترخيص\s*رقم\s*[:：]?\s*(\d{6,})")
# real-estate advertiser registration number (REGA broker reg — company-level, not a person)
ADV_REG_RE = re.compile(r"المعلن\s*العقاري\s*[:：]?\s*(\d{5,})")
# video links (TikTok / YouTube) embedded in the body
VIDEO_RE = re.compile(r'href="(https?://[^"]*(?:tiktok|youtu\.be|youtube)[^"]*)"', re.I)
# bedrooms / bathrooms hints in the free-text body (best-effort, residential only)
BEDS_RE = re.compile(r"([\d٠-٩]{1,2})\s*غرف")
BATHS_RE = re.compile(r"([\d٠-٩]{1,2})\s*دور(?:ات|تي?ن?)\s*(?:مياه|مياة|المياه)")

_BAD_IMG = ("logo", "icon", "placeholder", "no-image", "no_image", "favicon",
            "/public/images/", "ico.png", "pic5.png")

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


def _clean(s: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", ihtml.unescape(s or ""))).strip()


def _to_int(v: Any) -> Optional[int]:
    n = normalize.to_int(v)
    return n if n else None


def _to_float(v: Any) -> Optional[float]:
    if v in (None, "", "—"):
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
    t = _PHONE_LOOSE.sub(" ", text)
    t = _PHONE_RE.sub(" ", t)
    t = re.sub(r"_?للاتصال[^_\n]*", " ", t)
    t = re.sub(r"\s{2,}", " ", t).strip()
    return t or None


def _price(raw: Optional[str]) -> Optional[int]:
    """'275 الف' → 275000 ; '930000 الف ريال' → 930000 (الف decorative) ; '16000' → 16000.

    The price cell is FREE TEXT and sometimes carries a second number after Arabic words, e.g.
    "700000 ريال غير قيمة البنك 175000 ريال" — we must take only the FIRST numeric run (the asking
    price) rather than concatenate every digit (which `to_int` would, giving 700000175000)."""
    if not raw:
        return None
    s = str(raw).translate(normalize._TRANS)
    m = re.search(r"\d[\d,]*", s)
    if not m:
        return None
    try:
        n = int(m.group(0).replace(",", ""))
    except ValueError:
        return None
    if not n:
        return None
    has_thousand = ("الف" in raw or "الاف" in raw or "ألف" in raw)
    if has_thousand and n < 10000:
        n *= 1000
    return n if n >= 1000 else None


# ── Fetch ──────────────────────────────────────────────────────────────────────
def fetch_one(adid: int) -> Optional[tuple[int, str]]:
    """Fetch /ads/<id>. Returns (id, body) only when the detail table is present (i.e. a real
    listing), else None (missing ids serve the homepage shell)."""
    s = _session()
    url = f"{BASE}/ads/{adid}"
    for attempt in range(3):
        try:
            r = s.get(url, timeout=40, allow_redirects=True)
        except Exception:
            time.sleep(1.0 * (attempt + 1))
            continue
        if r.status_code == 200 and "<th>نوع العقار</th>" in r.text and "تفاصيل العقار" in r.text:
            return adid, r.text
        if r.status_code == 200:
            return None  # valid response, just not a listing page → skip cheaply
        time.sleep(1.0 * (attempt + 1))
    return None


def _spec_table(body: str) -> dict[str, str]:
    """Parse the listing's own <th>/<td> spec table. We slice from 'تفاصيل العقار' to the end of
    that table so we never pick up any unrelated table elsewhere on the page."""
    i = body.find("تفاصيل العقار")
    seg = body[i:] if i != -1 else body
    end = seg.find("</table>")
    if end != -1:
        seg = seg[: end + 8]
    out: dict[str, str] = {}
    for m in ROW_RE.finditer(seg):
        out[_clean(m.group(1))] = _clean(m.group(2))
    return out


def _description(body: str) -> tuple[Optional[str], Optional[str], Optional[str], Optional[str]]:
    """Return (description, video_url, rega_license, advertiser_reg) from the free-text block.
    The description is phone-redacted; the licence/adv-reg numbers are captured BEFORE redaction so
    a legit company REGA number is preserved in additional_info."""
    m = DESC_RE.search(body)
    raw = m.group(1) if m else ""
    video = None
    vm = VIDEO_RE.search(raw)
    if vm:
        video = ihtml.unescape(vm.group(1)).strip()
    text = _clean(raw)
    lic = LICENSE_RE.search(text)
    adv = ADV_REG_RE.search(text)
    rega_license = lic.group(1) if lic else None
    adv_reg = adv.group(1) if adv else None
    # strip the video URL + bare "لمشاهدة الفيديو" label out of the stored description
    text = re.sub(r"https?://\S+", " ", text)
    text = re.sub(r"لمشاهدة\s+الفيديو\s*[:：]?", " ", text)
    desc = _redact(text)
    return desc, video, rega_license, adv_reg


def _images(body: str) -> list[str]:
    out: list[str] = []
    seen: set[str] = set()

    def add(u: str) -> None:
        u = u.strip()
        if not u:
            return
        if u.startswith("//"):
            u = "https:" + u
        low = u.lower()
        if any(b in low for b in _BAD_IMG):
            return
        if u not in seen:
            seen.add(u)
            out.append(u)

    for u in IMG_RE.findall(body):
        add(u)
    for u in UPLOAD_RE.findall(body):
        add(u)
    return out[:25]


def map_listing(adid: int, body: str) -> tuple[Optional[dict], str]:
    f = _spec_table(body)
    if not f:
        return None, "residential"

    title_raw = f.get("عنوان الاعلان") or ""
    section = f.get("قسم العقار") or ""
    txn = f.get("نوع العقار") or ""
    city_ar = f.get("المدينة") or ""
    region_ar = f.get("المنطقة") or ""

    mapped_type = SECTION_MAP_AR.get(section.strip()) or normalize.map_type(title_raw)
    # Unmapped type → STORE the raw section/title text, never a guessed default (owner directive
    # 2026-07-16: never confidently misclassify — the raw value trips the DB novel-type detector,
    # which quarantines + alerts). The legacy value below feeds ONLY the routing/sanity rules.
    property_type = mapped_type or "Residential Land"  # type-truth: routing-legacy only — never stored
    stored_property_type = mapped_type or section.strip() or title_raw.strip() or "unknown"
    category = "commercial" if property_type in COMMERCIAL_TYPES else "residential"

    is_rent = any(w in txn for w in RENT_WORDS)

    # ── price (السعر headline; السوم is the reduced/offer price → additional_info) ──
    price = _price(f.get("السعر"))
    som = _price(f.get("السوم"))
    # some rent rows only fill السعر; some sale rows only fill السوم — use السوم as a price fallback
    headline = price or som

    area = _to_float(f.get("المساحة"))
    ppm = None
    if headline and area and not is_rent and area > 0:
        ppm = round(headline / area)

    # ── location (this broker is Unaizah / Qassim only, but resolve generically) ──
    # Forward-fix (2026-07-10 location-data-quality audit): removed the hardcoded "Unaizah" default —
    # it silently invented a city for the rare listing whose source page had no location data at all.
    # An honest None is correct here; normalize.region_for_city(None) already returns None safely.
    city = normalize.map_city(city_ar) if city_ar and city_ar.strip("_ ") else None
    region = normalize.region_for_city(city)

    # ── description / video / licence ──
    description, video_url, rega_license, adv_reg = _description(body)
    own_text = f"{title_raw}\n{description or ''}"

    # ── bedrooms / bathrooms (residential, best-effort from free text) ──
    bedrooms = baths = None
    if category == "residential" and property_type not in ("Residential Land", "Farm"):
        bm = BEDS_RE.search(own_text)
        if bm:
            n = _to_int(bm.group(1))
            if n and 0 < n <= 20:
                bedrooms = n
        tm = BATHS_RE.search(own_text)
        if tm:
            n = _to_int(tm.group(1))
            if n and 0 < n <= 20:
                baths = n

    title = _redact(title_raw) or title_raw

    info: dict[str, Any] = {
        "section_ar": section or None,
        "transaction_ar": txn or None,
        "city_ar": (city_ar if city_ar.strip("_ ") else None),
        "region_ar": (region_ar if region_ar.strip("_ ") else None),
        "som_price": som if som and som != headline else None,
        "advertiser_registration_number": adv_reg,
        "is_investment": ("استثمار" in txn) or None,
    }
    info = {k: v for k, v in info.items() if v not in (None, "", [], "—")}

    row: dict[str, Any] = {
        "ad_number": f"AKH{adid}",
        "listing_url": f"{BASE}/ads/{adid}",
        "source": "Al Khaas",
        "active": True,
        "property_type": stored_property_type,
        "transaction_type": "Rent" if is_rent else "Buy",
        "area_m2": int(round(area)) if area else None,
        "bedrooms": bedrooms,
        "bathrooms": baths,
        "price_total": headline if not is_rent else None,
        "price_annual": headline if is_rent else None,
        "price_per_meter": ppm,
        "rent_period": "annual" if is_rent else None,
        "city": city,
        "region": region,
        "neighborhood": None,
        "rega_location_verified": bool(rega_license),
        "video_url": video_url,
        "title": title,
        "description": description,
        "photo_urls": _images(body),
        "additional_info": info,
    }
    if rega_license:
        row["additional_info"]["rega_ad_license_number"] = rega_license
    return row, category


# ── Main ──────────────────────────────────────────────────────────────────────
def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--type", choices=["residential", "commercial", "all"], default="all")
    ap.add_argument("--limit", type=int, default=0,
                    help="validation run: upsert only the first N parsed listings, NO prune")
    args = ap.parse_args()

    ids = list(range(ID_START, ID_END + 1))
    print(f"Al Khaas: scanning ids {ID_START}..{ID_END} ({WORKERS} workers)"
          f"{' [LIMIT ' + str(args.limit) + ']' if args.limit else ''}")

    run_id = None if args.limit else db.begin_run("alkhaas")
    res: list[dict] = []
    com: list[dict] = []
    seen = 0
    try:
        res_buf: list[dict] = []
        com_buf: list[dict] = []

        def flush() -> None:
            nonlocal res_buf, com_buf
            if res_buf:
                db.upsert_alkhaas_residential_batch(res_buf)
                res_buf = []
            if com_buf:
                db.upsert_alkhaas_commercial_batch(com_buf)
                com_buf = []

        with ThreadPoolExecutor(max_workers=WORKERS) as ex:
            for result in ex.map(fetch_one, ids):
                if not result:
                    continue
                adid, body = result
                row, cat = map_listing(adid, body)
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
            print(f"✓ Al Khaas VALIDATION: {len(res)} residential + {len(com)} commercial upserted (no prune)")
            for r in (res + com)[:8]:
                print("  ", {k: r.get(k) for k in (
                    "ad_number", "property_type", "transaction_type", "city", "region",
                    "area_m2", "bedrooms", "price_total", "price_annual", "price_per_meter")})
                print("     photo:", (r["photo_urls"] or ["(none)"])[0][:74])
            return 0

        # Full run: prune listings active before but not seen this crawl (full id sweep).
        pruned = 0
        for tbl, rows_seen in (("alkhaas_residential_listings", res),
                               ("alkhaas_commercial_listings", com)):
            n = db.prune_unseen(tbl, {r["ad_number"] for r in rows_seen}, source="Al Khaas")
            if n < 0:
                print(f"⚠ {tbl}: prune guard tripped (0 scraped or collapse) — kept existing active")
            else:
                pruned += n
        print(f"✓ Al Khaas: {len(res)} residential + {len(com)} commercial upserted, {pruned} stale pruned")
        db.end_run(run_id, ok=True, rows_seen=seen, rows_upserted=seen, notes=f"pruned={pruned}", check_tables=["alkhaas_residential_listings", "alkhaas_commercial_listings"])
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
