"""القاسم العقارية — alqasem.com.sa. WordPress + Elementor (static pages), Riyadh brokerage, sale + rent.

SOURCE SHAPE (measured live 2026-09-24, before any code):
  · ROUTE. The REST API is walled: /wp-json/wp/v2/property and ?rest_route= both answer HTTP 403
    from a security plugin («your request looks suspiciously similar to automated requests»), for
    every fingerprint. The Rank Math sitemap /property-sitemap.xml is plain XML: 30 <loc>, one is
    the archive root → 29 listing URLs. CROSS-CHECK: the /property/ archive (3 pages, every page
    renders the same full list) links exactly those 29 listing slugs plus 13 taxonomy pages
    (pro-cat-*/pro-city-*/pro-type-*) — sitemap == archive, 29 == 29, so the sitemap IS the
    catalogue here. The run refuses to prune when the two disagree.
  · PAGE. One Elementor template; facts are label/value lines in three blocks (read as text lines):
      header       h1 title · optional location line («الرياض - اليرموك», «حي حطين, مدينة الرياض»,
                   «قريبة من طريق الملك فهد») · price «1200000 ر.س».
      تفاصيل عامة  نوع العقار (شقة/فيلا/عماير/ارض) · المساحة «182 م» · غرف «3 غرف» · حمامات
                   «4 حمام» · مميزات عامة «مصعد, موقف خاص» — a label with no value is followed
                   directly by the next label.
      تفاصيل إضافية  «العرض: 12 م» (street width) · «رقم الترخيص: 7200672926» (the AD licence) ·
                   «إستخدام العقار : سكني» · «حالة العقار: جديد/قديم» · «وجهة العقار: شرق» ·
                   «عدد كهرباء:نعم» · «عدد مياة:نعم».
    The WordPress post id is the body class `postid-2700` → ad_number QSM2700.
  · DEAL. Only the title/URL says it: «للبيع» / «للإيجار» / «للايجار»; «فرصة استثمارية مميزة!» says
    it in its first description line («فيلا للبيع (على السوم)» — the site still prints a figure,
    1400000, and that figure is what is stored).
  · RENT PERIOD = SOURCE. The price block has no period. «شقة للإيجار في شارع طنجة» writes
    «الايجار السنوي: 45 الف» in its prose → annual; a rent ad whose prose is silent stays NULL with
    the figure unconverted (normalize.rent_period_and_annual).
  · CITY. Only the location line names one. «حي عليشة» alone (a district, no city) and
    «قريبة من طريق الملك فهد» cannot be placed → city_not_in_catalog, never defaulted to Riyadh.
    «مدينة الرياض» is read with its «مدينة» word stripped. A «قريب…» proximity phrase is cut before
    the district lookup («قريبة من طريق الملك فهد» matched «حي الملك فهد»).
  · PDPL. Descriptions end with a broker block: «للتواصل والاستفسار:» then «أ/ رعد 0554343045» …
    and on 2835 a bare «أ/ محمد» (a name with no number). The block is cut from its header to the
    end of the text (measured: on every page that has one it is the last block); an honorific or
    phone line anywhere is dropped whole; redact_pii runs on the rest.
  · PHOTOS. Gallery <img> under /wp-content/uploads/ with Arabic file names → percent-encoded.
    Fetched …/%D9%86%D8%B3%D8%AE%D8%A9-%D9%85%D9%86-DJI_0445-1024x768.jpg → 200 image/jpeg 103 kB.
  · REMOVAL ORACLE (measured 2026-09-24): an unknown slug answers a REAL HTTP 404 whose <title> is
    «الصفحة غير موجودة - شركة القاسم العقارية» (3/3 invented slugs); a live listing answers 200 with
    body class `single-property postid-N` (3/3 controls). No sold/rented marker exists on the site
    (0 of 29 pages), so removal is the 404. 403/429/5xx → no opinion (shared law).
    A prune candidate is by definition absent from this run's URL map, so the probe uses the
    WordPress id route /?p=<id> — measured 2026-09-24: 2700/2176/2760 → 200, landed on their
    /property/<slug>/ page with `postid-N` (live, 3/3); 999999/1/424242 → HTTP 404 with the
    not-found title (gone, 3/3).
"""
from __future__ import annotations

import argparse
import html as ihtml
import re
import sys
import time
import urllib.parse
from pathlib import Path
from typing import Any, Optional

from curl_cffi import requests as cc

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from scrapers.common import db, normalize  # noqa: E402
from scrapers.common.arabic_location import city_ar_for, find_district_in_text, to_catalog  # noqa: E402
from scrapers.common.http_liveness import LivenessProbe  # noqa: E402
from scrapers.common.pii import redact_pii  # noqa: E402

BASE = "https://alqasem.com.sa"
SOURCE = "القاسم العقارية"
PREFIX = "QSM"
RES_TABLE = "alqasem_residential_listings"
COM_TABLE = "alqasem_commercial_listings"
SITEMAP = f"{BASE}/property-sitemap.xml"
ARCHIVE = f"{BASE}/property/"
_PAUSE = 1.0

TYPE_OVERRIDES = {"عماير": "Building", "عمائر": "Building"}
RENT_RE = re.compile(r"للإيجار|للايجار|للأيجار")
SALE_RE = re.compile(r"للبيع")
CLOSED_RE = re.compile(r"تم\s*البيع|تم\s*الإيجار|تم\s*الايجار|تم\s*التأجير|مباع|مؤجر")
PRICE_LINE_RE = re.compile(r"^\s*([\d,.]+)\s*ر\.س\s*$")
PHONE_RE = re.compile(r"(?:\+?966|00966|0)5\d{8}|\b9200\d{5}\b")
CONTACT_RE = re.compile(r"لتواصل|للاستفسار|للإستفسار")          # «للتواصل والاستفسار:», «لتواصل …» (2951 typo)
HONORIFIC_RE = re.compile(r"^\s*[أامد]\s*[/.]\s*\S+")            # «أ/ محمد», «أ.عمر: …», «م/ …», «د. …»
GENERAL_LABELS = ("نوع العقار", "المساحة", "غرف", "حمامات", "مميزات عامة")
YES_NO = {"نعم": True, "لا": False}
NOT_FOUND_TITLE = "الصفحة غير موجودة"


def session() -> cc.Session:
    # impersonate owns the User-Agent — never set one here.
    s = cc.Session(impersonate="chrome")
    s.headers.update({"Accept-Language": "ar,en;q=0.7"})
    return s


def fetch(s: cc.Session, url: str) -> str:
    r = s.get(url, timeout=60)
    if r.status_code != 200:
        raise RuntimeError(f"{url} → HTTP {r.status_code}")
    return r.text


def html_text(raw: Optional[str]) -> str:
    if not raw:
        return ""
    t = re.sub(r"(?is)<(script|style|svg).*?</\1>", " ", raw)
    t = re.sub(r"(?i)<br\s*/?>|</(p|div|li|h[1-6]|tr|span)>", "\n", t)
    t = ihtml.unescape(re.sub(r"(?s)<[^>]+>", " ", t))
    t = re.sub(r"[ \t\xa0]+", " ", t)
    return re.sub(r"\n\s*\n+", "\n", t).strip()


def listing_urls_from_sitemap(xml: str) -> list[str]:
    locs = [ihtml.unescape(u) for u in re.findall(r"<loc>\s*(.*?)\s*</loc>", xml)]
    return [u for u in locs if u.rstrip("/") != ARCHIVE.rstrip("/") and "/property/" in u]


def listing_urls_from_archive(page_html: str) -> set[str]:
    """The archive's own listing links (taxonomy pages pro-cat/pro-city/pro-type excluded)."""
    return {u for u in re.findall(r'href="(https://alqasem\.com\.sa/property/[^"/]+/)"', page_html)
            if "/property/pro-" not in u}


def _section(lines: list[str], start: str, stop: tuple[str, ...]) -> list[str]:
    out, on = [], False
    for ln in lines:
        if not on:
            on = ln.strip() == start
            continue
        if ln.strip() in stop:
            break
        out.append(ln.strip())
    return out


def parse_page(page_html: str) -> dict[str, Any]:
    """The page's own fields, verbatim — nothing normalised here."""
    text = html_text(page_html)
    lines = [ln.strip() for ln in text.split("\n") if ln.strip()]
    m = re.search(r"postid-(\d+)", page_html)
    h1 = re.search(r"<h1[^>]*>(.*?)</h1>", page_html, re.S)
    title = html_text(h1.group(1)) if h1 else None
    header: dict[str, Any] = {"post_id": int(m.group(1)) if m else None, "title": title,
                              "location": None, "price_raw": None}
    # header: title, then (optionally) a location line, then the price line.
    try:
        i = lines.index(title) if title else -1
    except ValueError:
        i = -1
    for ln in lines[i + 1:i + 4]:
        pm = PRICE_LINE_RE.match(ln)
        if pm:
            header["price_raw"] = pm.group(1)
            break
        if ln.strip() != "تفاصيل عامة" and header["location"] is None:
            header["location"] = ln.strip()
    gen: dict[str, Optional[str]] = {}
    g = _section(lines, "تفاصيل عامة", ("معلومات العقار",))
    for k, ln in enumerate(g):
        if ln in GENERAL_LABELS:
            nxt = g[k + 1] if k + 1 < len(g) else None
            gen[ln] = nxt if nxt and nxt not in GENERAL_LABELS else None
    desc = "\n".join(_section(lines, "تفاصيل العقار", ("تفاصيل إضافية", "ملاحظات إضافية")))
    extra: dict[str, str] = {}
    for ln in _section(lines, "تفاصيل إضافية", ("ملاحظات إضافية", "تحميل ملف المشروع", "تواصل معنا")):
        if ":" in ln:
            k, v = ln.split(":", 1)
            extra[k.strip()] = v.strip()
    photos: list[str] = []
    # Smush lazy-loads the gallery (real URL in data-src, src is a 1×1 SVG) and some galleries are
    # lightbox <a href>s — so any uploads URL counts, minus the site logo/icon thumbnails.
    for u in re.findall(r'(https://alqasem\.com\.sa/wp-content/uploads/[^"\'\s)]+\.(?:jpe?g|png|webp))',
                        page_html, re.I):
        u = ihtml.unescape(u)
        if re.search(r"cropped-|logo|-\d{2,3}x\d{2,3}\.(?:png|webp)$", u, re.I):
            continue
        enc = urllib.parse.quote(u, safe=":/%")
        if enc not in photos:
            photos.append(enc)
    return {**header, "general": gen, "description": desc, "extra": extra, "photos": photos}


def clean_description(desc: str) -> Optional[str]:
    """PDPL: the broker block is the tail of every description that has one («للتواصل والاستفسار:»
    then «أ/ فيصل 0550886939» … «أ/ محمد» — the last name carries NO number, live on 2835), so the
    cut runs from the contact header to the end; an honorific line or a phone line anywhere is
    dropped whole; redact_pii covers the rest."""
    kept: list[str] = []
    for ln in (desc or "").split("\n"):
        if CONTACT_RE.search(ln):
            break
        if PHONE_RE.search(ln) or HONORIFIC_RE.match(ln):
            continue
        kept.append(ln)
    return redact_pii("\n".join(kept).strip()) or None


def resolve_city(loc: Optional[str]) -> tuple[Optional[int], Optional[int], Optional[str]]:
    if not loc:
        return None, None, None
    for seg in re.split(r"[-–,،|/]", loc):
        seg = re.sub(r"^\s*مدينة\s+", "", seg.strip())
        if not seg or re.match(r"(?:حي|حى|بحي)\s", seg):
            continue
        cid, rid = to_catalog(seg)
        if cid:
            return cid, rid, city_ar_for(cid) or seg
    return None, None, None


def map_listing(url: str, page_html: str) -> tuple[Optional[dict], str, str]:
    """One listing page → (row, category, skip_reason); row is None exactly when skip_reason is set."""
    p = parse_page(page_html)
    if not p["post_id"]:
        return None, "residential", "no_post_id"
    title = p["title"] or ""
    desc = p["description"]
    if CLOSED_RE.search(title):
        return None, "residential", "sold_or_rented"
    deal_src = title if (RENT_RE.search(title) or SALE_RE.search(title)) else desc.split("\n")[0] if desc else ""
    deal = "Rent" if RENT_RE.search(deal_src) else "Buy" if SALE_RE.search(deal_src) else None
    if not deal:
        return None, "residential", "deal_unknown"
    type_ar = p["general"].get("نوع العقار")
    ptype = normalize.map_type_exact(type_ar, TYPE_OVERRIDES)
    if not ptype:
        return None, "residential", f"type_unmapped[{type_ar or 'none'}]"
    usage = p["extra"].get("إستخدام العقار") or p["extra"].get("استخدام العقار")
    if ptype == "Residential Land" and usage and "سكني" not in usage:
        ptype = "Commercial Land"                       # the source's own usage field («إداري» on 2176)
    category = normalize.category_for_type(ptype).lower()
    city_id, region_id, city_ar = resolve_city(p["location"])
    if not city_id:
        return None, category, "city_not_in_catalog"
    loc_for_district = re.split(r"قريب", p["location"])[0]
    price = normalize.to_int(p["price_raw"])
    features = p["general"].get("مميزات عامة") or ""
    body = clean_description(desc)
    dwelling = ptype in ("Apartment", "Villa", "Duplex", "Floor", "Studio")
    row: dict[str, Any] = {
        "ad_number": f"{PREFIX}{p['post_id']}",
        "listing_url": url, "source": SOURCE, "active": True,
        "title": title or None, "description": body,
        **normalize.amenities_from_text(features + "\n" + (body or "")),
        "property_type": ptype, "transaction_type": "Rent" if deal == "Rent" else "Buy",
        "city": normalize.map_city(city_ar), "city_ar": city_ar, "city_id": city_id, "region_id": region_id,
        "district_ar": find_district_in_text(loc_for_district, city_id), "neighborhood": p["location"],
        "area_m2": normalize.to_int(p["general"].get("المساحة")),
        "bedrooms": normalize.to_int(p["general"].get("غرف")) if dwelling else None,
        "bathrooms": normalize.to_int(p["general"].get("حمامات")) if dwelling else None,
        "street_width_m": normalize.one_street_width(p["extra"].get("العرض")),
        "direction": normalize.one_direction(p["extra"].get("وجهة العقار")),
        # «حالة العقار: جديد/قديم» is a condition label; «جديد» is the shared vocabulary's 0 for a
        # building. Land has no age, so the label stays in additional_info there.
        "property_age": normalize.exact_age(p["extra"].get("حالة العقار")) if "Land" not in ptype else None,
        "license_number": normalize.ad_licence_from_prose("ترخيص: " + p["extra"]["رقم الترخيص"])
        if p["extra"].get("رقم الترخيص") else None,
        "photo_urls": p["photos"][:20] or None,
    }
    for label, col in (("عدد كهرباء", "electricity"), ("عدد مياة", "water_supply"), ("عدد مياه", "water_supply")):
        v = YES_NO.get((p["extra"].get(label) or "").strip())
        if v is not None:
            row[col] = v
    if deal == "Rent":
        period, annual = normalize.rent_period_and_annual(price, body)
        row["price_annual"] = annual
        if period:
            row["rent_period"] = period
    else:
        row["price_total"] = price
    row["additional_info"] = {k: v for k, v in {
        "wp_post_id": p["post_id"], "type_ar": type_ar, "usage_ar": usage,
        "condition_ar": p["extra"].get("حالة العقار"), "features_ar": features or None,
        "price_raw": p["price_raw"], "street_width_raw": p["extra"].get("العرض"),
        "facade_raw": p["extra"].get("وجهة العقار"),
        "advertiser_role": p["extra"].get("صفة المعلن"),
    }.items() if v is not None}
    return row, category, ""


# ── LIVENESS (see the docstring's measured oracle) ───────────────────────────────────────────────
def _signal_for(pid: int):
    def _signal(status, body, _moved):
        if status == 404 and NOT_FOUND_TITLE in (body or ""):
            return "gone"
        if status == 200 and re.search(rf"single-property[^\"]*postid-{pid}\b", body or ""):
            return "live"
        return None
    return _signal


def _make_verify_gone(url_by_ad: dict[str, str]):
    def verify_gone(ad_number: str) -> tuple[str, str]:
        pid = ad_number[len(PREFIX):]
        if not pid.isdigit():
            return "unknown", f"{ad_number!r} is not a {PREFIX}<post id> ad number"
        return LivenessProbe(platform="alqasem", signal=_signal_for(int(pid)), session=session,
                             url_for=lambda ad: url_by_ad.get(ad) or f"{BASE}/?p={pid}").verify_gone(ad_number)
    return verify_gone


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--type", choices=["residential", "commercial", "all"], default="all")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()
    s = session()
    dry = args.dry_run or bool(args.limit)
    run_id = None if dry else db.begin_run("alqasem")
    res: list[dict] = []
    com: list[dict] = []
    skipped: dict[str, int] = {}
    try:
        urls = listing_urls_from_sitemap(fetch(s, SITEMAP))
        if not urls:
            raise RuntimeError("property-sitemap.xml lists no listings")
        time.sleep(_PAUSE)
        archive = listing_urls_from_archive(fetch(s, ARCHIVE))
        complete = archive == set(urls)
        print(f"{SOURCE}: sitemap {len(urls)} listings, archive {len(archive)} "
              f"({'match' if complete else 'MISMATCH — no prune this run'})", flush=True)
        if args.limit:
            urls = urls[:args.limit]
        # The stored listing_url is the sitemap's (a real page a user lands on); it also drives the probe.
        url_by_ad: dict[str, str] = {}
        for u in urls:
            time.sleep(_PAUSE)
            row, cat, why = map_listing(u, fetch(s, u))
            if not row:
                skipped[why] = skipped.get(why, 0) + 1
                continue
            url_by_ad[row["ad_number"]] = u
            if args.type != "all" and cat != args.type:
                continue
            (com if cat == "commercial" else res).append(row)
        notes = ", ".join(f"{k}x{v}" for k, v in sorted(skipped.items(), key=lambda x: -x[1]))
        if skipped:
            print(f"  skipped (not guessed): {notes}")
        if dry:
            print(f"✓ {SOURCE} VALIDATION: {len(res)} residential + {len(com)} commercial (nothing written)")
            for r0 in res + com:
                print(f"   {r0['ad_number']:>8} {r0['transaction_type']:4} {r0['property_type']:16} {r0['city_ar']:8} "
                      f"d={str(r0['district_ar']):14} a={str(r0['area_m2']):>5} "
                      f"p={str(r0.get('price_total') or r0.get('price_annual')):>8} per={r0.get('rent_period')} "
                      f"b={r0['bedrooms']}/{r0['bathrooms']} w={r0['street_width_m']} dir={r0['direction']} "
                      f"lic={r0['license_number']} ph={len(r0['photo_urls'] or [])}")
            return 0
        # public upsert_alqasem_*_batch wrappers are added centrally later; the shared batch writer is used directly.
        db._wasalt_batch(RES_TABLE, res)
        db._wasalt_batch(COM_TABLE, com)
        superseded = db.retire_superseded_siblings(res_table=RES_TABLE, com_table=COM_TABLE,
                                                   res_ads={r["ad_number"] for r in res},
                                                   com_ads={r["ad_number"] for r in com}, source=SOURCE)
        pruned = 0
        # Prune only after a COMPLETE enumeration with the in-run positive control (sitemap == archive).
        if args.type == "all" and complete and (res or com):
            verify_gone = _make_verify_gone(url_by_ad)
            for tbl, rows in ((RES_TABLE, res), (COM_TABLE, com)):
                n = db.prune_unseen(tbl, {r["ad_number"] for r in rows}, source=SOURCE, verify_gone=verify_gone)
                pruned += max(n, 0)
        healthy = db.end_run(run_id, ok=True, rows_seen=len(urls), rows_upserted=len(res) + len(com),
                             check_tables=["alqasem_residential_listings", "alqasem_commercial_listings"],
                             notes=f"pruned={pruned} superseded={superseded} {notes}"[:300])
        print(f"✓ {SOURCE}: {len(res)} residential + {len(com)} commercial upserted")
        return 0 if healthy else 1
    except Exception as e:
        if run_id:
            db.end_run(run_id, ok=False, rows_seen=0, rows_upserted=0,
                       notes=(f"{e} | skips: " + ", ".join(f"{k}x{v}" for k, v in skipped.items()))[:300])
        print(f"✗ {SOURCE}: {e}", flush=True)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
