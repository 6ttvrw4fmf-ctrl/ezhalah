"""علم الريادة الإدارية — eilmalriyada.com. 283 listings (208 rent + 75 sale), onboarding 2026-09-24.

SOURCE SHAPE (probed live before any code — every number below is measured, not estimated):
  · A React SPA whose shell (6.8 KB, one script) carries no data. The verifier saw no API in the
    browser and proposed rendering 303 pages; that is wrong. The lazy chunk for the
    /real-estate/view/:id route (static/js/511.f72976be.chunk.js) hard-codes
    `baseURL: "https://api.eilmalriyada.com/api"` and two calls: GET /recent/<id> (the view page)
    and GET /properties?city=… (city pages; answers {"data":[],"total":0} for every city tried).
      GET https://api.eilmalriyada.com/api/recent        → a JSON array of the WHOLE catalogue
                                                            (283 records, 1.3 MB, no paging — a
                                                            `?page=2` returns the same array)
      GET https://api.eilmalriyada.com/api/recent/<id>   → the same record + `recent_imags` (gallery)
    No auth, no challenge. Detail is fetched per listing ONLY for its gallery (cover is in the
    list), and a row built from its own record is stamped direct-alive.

  · THE SITEMAP IS STALE BOTH WAYS: 303 /real-estate/view/<id> URLs, of which 127 are not on the
    API (GET /recent/<id> → 404) and 107 API ids are not in it. Never enumerate from it.

  · LISTING URL: https://eilmalriyada.com/real-estate/view/<id> (the og:url the server injects
    per listing). A PHP «SEO Handler» injects the listing's own <title>/og:* into the shell, so a
    live id serves `<title>أرض تجارية استراتيجية</title>` (id 134) while a GONE id (136) serves
    the bare shell with `<title>Elim Alriyada</title>` and HTTP 200. The HTML is not the oracle.

  · FIELDS (all strings; the CMS writes «.» or «0» for «not filled»):
      category «للإيجار» 208 / «للبيع» 75 — the deal.
      type — 19 spellings; «فيلا» 157, «شقة» 63, «أرض» 30, «تاون هاوس» 6, «شقق مفروشة» 5, «دور» 5,
             «مكتب» 4, plus singletons (see TYPE_OVERRIDES; «مجمع سياحي/سياحي مشروع تجاري/سويت» →
             unmapped → SKIP).
      price — «N ريال» 277, «N SAR» 2, «N ريال/م²» 1 (a RATE → price_per_meter), «N ريال شهرياً» 1
             (its own period), and two cells with no number at all («مجمع سياحي», «مشروع تجاري»):
             the source states no price → AUTHORITATIVE_NULL.
      location — «حي X - City» (240 Riyadh, 15 Khobar, 11 «القصيم» which is a REGION and not a
             catalog city → SKIP, 9 Dammam, …). The part before the dash is the card's
             neighbourhood; «ضاحية خزام» (66 rows) is a suburb, not a catalog district → district_ar
             NULL with the text kept.
      property_area «8,250m²» (264), bare «N» (17), one range «N-Nm²» → NULL, raw kept.
      bedrooms/bathrooms — digits, or «.»/«0» (unset) or «+4» (open bound) → NULL.
      property_age — «0» 141 (UNSET, not «new»), «حديث» 66 (not in the vocabulary → NULL),
             «جديد/جديدة» 40 → 0, «3 سنوات» → 3, «15سنة» → 15, «6 أشهر فقط»/«سنتين ونصف» → NULL
             (not whole years), «على الخارطة» 1 → the listing is OFF-PLAN → SKIP.
      street_direction — «0»/«.» 202; the rest carry tatweel («شرقـاً», «غـربــاً») which is
             stripped before one_direction; «زاوية»/two bearings → NULL, raw kept.
      street_width «20m» 50, «30m» 25 … «0» 160; «20m-6m» → NULL.
      license_number — the REGA ad licence when it is digits; «.» otherwise.
      description — prose; one carries a phone number → redact_pii. map_location is a maps link.
      cover — `images/recent/<file>` under https://api.eilmalriyada.com/ (200 image/png fetched);
             gallery paths carry Arabic filenames («منشورات تيك توك (80).jpg») → percent-encoded.

  · RENT PERIOD: the price cell states one only on the «شهرياً» row. 86 of 208 rent descriptions
    bind «السنوي» to «الإيجار» («الإيجار السنوي: 100,000 ريال»); ids 245/246 ALSO state «الإيجار
    نصف السنوي 52,000». The period is read only from a token bound to the rent word or the
    currency, preferring the one adjacent to THIS row's figure — so 245 stays annual (its 100,000
    sits by «السنوي») and a neighbourhood's «اليومية» never counts. MEASURED on the 204 mapped
    rent rows: 77 annual, 2 monthly, 125 → NULL with the figure unconverted. Never defaulted.

  · RESULT of the full walk (2026-09-24): 283 records → 266 mapped (254 residential + 12
    commercial); skipped city_not_in_catalog 13 («القصيم» 11, «القويعية», «محافظة تربة»),
    type_unmapped 3, off_plan 1.

TRANSPORT (2026-09-24, first cloud crawl): api.eilmalriyada.com answered HTTP 403 to GitHub's
    datacenter IP and 200 to a residential IP on EVERY TLS profile (chrome, safari17_0, firefox133,
    edge101, safari15_5) — an IP block, not a handshake. The cloud run goes through the Saudi
    residential proxy (matrix `proxy: true` -> WASALT_PROXY_URL / SCRAPE_PROXY_URL); a local run
    with neither set hits the API directly.

REMOVAL ORACLE (measured 2026-09-24 on GET /api/recent/<id>):
  gone — 136, 169, 170 (sitemap ids absent from the catalogue): HTTP 404
         {"message":"العقار غير موجود"} (100 bytes); id 999999 the same.
  live — 134, 403, 664 (controls from the catalogue): HTTP 200, {"id": <same>, …}.
  So: 404 + «غير موجود» → GONE; 200 echoing our id → LIVE; anything else → no opinion. Prune runs
  only after the one-shot catalogue parsed as a non-empty array AND three rows parsed live this run
  answer LIVE through the same route (fails CLOSED).
"""
from __future__ import annotations
import os

import argparse
import json
import re
import sys
import time
from pathlib import Path
from typing import Any, Optional
from urllib.parse import quote

from curl_cffi import requests as cc

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from scrapers.common import db, normalize  # noqa: E402
from scrapers.common.arabic_location import find_district_in_text, to_catalog  # noqa: E402
from scrapers.common.http_liveness import LivenessProbe  # noqa: E402
from scrapers.common.pii import redact_pii  # noqa: E402

BASE = "https://eilmalriyada.com"
API = "https://api.eilmalriyada.com/api"
ASSETS = "https://api.eilmalriyada.com/"
SOURCE = "علم الريادة الإدارية"
PREFIX = "ELR"
ORACLE = "api.eilmalriyada.com/api/recent/<id>"      # what mark_direct_alive certifies was read
PAUSE = 0.6
DETAIL_MISSES: dict[str, int] = __import__("collections").Counter()   # reason → count, per process


# ── transport ─────────────────────────────────────────────────────────────────────────────────────
_PROXY = (os.environ.get("SCRAPE_PROXY_URL") or os.environ.get("WASALT_PROXY_URL") or "").strip()
_PROXIES = {"http": _PROXY, "https": _PROXY} if _PROXY else None


def session() -> cc.Session:
    # impersonate OWNS the User-Agent — only Accept-* and the SPA's own Origin/Referer are ours.
    # Through the Saudi residential proxy the gateway RESETS a post-quantum ClientHello (the fleet's
    # measured gotcha, docs/ops/VERIFYING_PRODUCTION.md; wasalt pins chrome124 for the same reason):
    # the 2026-09-24 re-crawl through the proxy with the newest «chrome» alias died as an SSLError /
    # a 90 s connect timeout. Pre-PQ chrome124 when proxied; the site's own measured profile otherwise.
    s = cc.Session(impersonate="chrome124" if _PROXY else "chrome", proxies=_PROXIES)
    s.headers.update({"Accept": "application/json", "Accept-Language": "ar,en;q=0.7",
                      "Origin": "https://www.eilmalriyada.com", "Referer": "https://www.eilmalriyada.com/"})
    return s


def fetch_catalogue(s: cc.Session) -> list[dict]:
    """The whole catalogue in one call. Anything but a non-empty JSON array raises: a blocked or
    changed endpoint must fail the run, never read as an empty source."""
    r = s.get(f"{API}/recent", timeout=90)
    if r.status_code != 200:
        raise RuntimeError(f"/recent: HTTP {r.status_code}")
    try:
        j = r.json()
    except ValueError:
        raise RuntimeError("/recent: not JSON — challenge or outage") from None
    if not isinstance(j, list) or not j:
        raise RuntimeError("/recent answered no records — treated as blocked, not empty")
    return [x for x in j if isinstance(x, dict)]


def fetch_detail(s: cc.Session, pid: int) -> Optional[dict]:
    """This listing's own record (adds the gallery), or None when unreadable. A None only costs the
    gallery and the direct-alive stamp — the row is still built from the catalogue record.
    MEASURED 2026-09-24: a first full walk at 0.4 s spacing lost 99 of 283 details mid-run while
    the same ids answered 200 minutes later; a second at 0.6 s with one 3 s retry still lost 8 to
    HTTP 429 — the host throttles a burst. So: three attempts, backing off 8 s then 16 s; the miss
    reason is kept in DETAIL_MISSES so the run notes say what happened."""
    status, body = None, ""
    for attempt in range(3):
        try:
            r = s.get(f"{API}/recent/{pid}", timeout=45)
            status, body = r.status_code, r.text
        except Exception as e:  # noqa: BLE001
            status, body = None, f"{type(e).__name__}"
        if status == 200:
            try:
                j = r.json()
            except ValueError:
                j = None
            if isinstance(j, dict) and j.get("id") == pid:
                return j
        if attempt < 2:
            time.sleep(8.0 * (attempt + 1))
    DETAIL_MISSES[f"HTTP {status}" if status else body] += 1
    return None


# ── field readers ─────────────────────────────────────────────────────────────────────────────────
def _unset(v) -> bool:
    return v is None or str(v).strip() in ("", ".", "0", "null")


def _count(v) -> Optional[int]:
    """A digit cell → int. «.»/«0» (unset) and «+4» (an open bound) → None."""
    if _unset(v) or "+" in str(v):
        return None
    return normalize.to_int(v)


def parse_area(raw) -> Optional[int]:
    """«8,250m²» / «250 m²» / «250» → int; a range («300-350m²») → None (raw kept by the caller)."""
    if _unset(raw) or "-" in str(raw):
        return None
    n = normalize.to_int(raw)
    return n if n and n > 0 else None


def parse_age(raw) -> Optional[int]:
    """Exact whole years only. «0» is the CMS's unset value (141 rows), not «new»; «حديث» is not in
    the shared vocabulary; months and «ونصف» are not whole years; open bounds → NULL."""
    if _unset(raw):
        return None
    t = re.sub(r"(\d)(?=[ء-ي])", r"\1 ", str(raw)).strip()
    if re.search(r"شهر|أشهر|ونصف|month", t):
        return None
    return normalize.exact_age(t)


def parse_direction(raw) -> Optional[str]:
    if _unset(raw):
        return None
    return normalize.one_direction(str(raw).replace("ـ", ""))


_PRICE_RE = re.compile(r"([\d٠-٩][\d٠-٩,\.]*)")


def parse_price_cell(raw: Optional[str]) -> tuple[Optional[int], str]:
    """(amount, unit) from the price cell: unit is 'per_meter' for «N ريال/م²», else 'total'.
    A cell with no digits («مجمع سياحي») → (None, 'absent'): the source states no price."""
    t = str(raw or "")
    m = _PRICE_RE.search(t)
    if not m:
        return None, "absent"
    n = normalize.to_int(m.group(1))
    return n, "per_meter" if re.search(r"/\s*م|sqm|/\s*م²|للمتر", t) else "total"


# ── rent period, bound to the rent word / the figure ──────────────────────────────────────────────
_PERIOD_TOKEN_RE = re.compile(r"(نصف\s*سنوي|ربع\s*سنوي|سنوي|شهري|يومي|أسبوعي|اسبوعي)")
_ANCHOR_RE = re.compile(r"يجار|اجار|إجار|ريال|﷼|سعر|SAR", re.I)


def _figure_forms(price: Optional[int]) -> list[str]:
    if not price:
        return []
    forms = [f"{price:,}", str(price)]
    if price % 1000 == 0:
        k = price // 1000
        forms += [f"{k} الف", f"{k} ألف", f"{k}الف", f"{k}ألف"]
    if price == 1_000_000:
        forms.append("مليون")
    return forms


def rent_period_stated(price: Optional[int], text: Optional[str]) -> tuple[Optional[str], Optional[int]]:
    """(rent_period, price_annual) from a period token the ad binds to its RENT or its CURRENCY.
    A token adjacent to THIS row's figure outranks one elsewhere; two different periods at the
    same rank → NULL, figure unconverted. The shared helper does the conversion, so يومي/أسبوعي/
    نصف سنوي land as (None, None)."""
    t = re.sub(r"\s+", " ", text or "")
    figs = _figure_forms(price)
    bound: list[tuple[str, bool]] = []
    for m in _PERIOD_TOKEN_RE.finditer(t):
        before, after = t[max(0, m.start() - 24):m.start()], t[m.end():m.end() + 16]
        if not (_ANCHOR_RE.search(before) or _ANCHOR_RE.search(after)):
            continue
        near = any(f in before or f in after for f in figs)
        bound.append((re.sub(r"\s+", " ", m.group(1)), near))
    if not bound:
        return None, price
    near = {tok for tok, n in bound if n}
    chosen = near or {tok for tok, _ in bound}
    if len(chosen) != 1:
        return None, price
    return normalize.rent_period_and_annual(price, chosen.pop())


# ── mapping ───────────────────────────────────────────────────────────────────────────────────────
# The site's exact spellings. Exact-match only; the fleet folds a townhouse into Villa
# (normalize.TYPE_MAP line ~308) and a complex into Commercial Building.
TYPE_OVERRIDES = {
    "تاون هاوس": "Villa", "شقق مفروشة": "Apartment", "فيلا دوبلكس": "Duplex", "شقة دوبلكس": "Duplex",
    "معارض تجارية": "Showroom", "معرض تجاري": "Showroom", "مجمع تجاري": "Commercial Building",
    "دور سكني": "Floor", "استديو": "Studio",
}
_LAND_TYPES = {"Residential Land", "Commercial Land"}
_AUCTION_RE = re.compile(r"مزاد")
_CLOSED_NAME_RE = re.compile(r"تم\s*البيع|تم\s*الإيجار|تم\s*الايجار|تم\s*التأجير|مباع(?![ء-ي])|مؤجر(?![ء-ي])")
_OFFPLAN_RE = re.compile(r"على\s*الخارطة|(?<![ء-ي])قريب[اً]+(?![ء-ي])")


def photo_urls(it: dict, detail: Optional[dict]) -> list[str]:
    paths = [it.get("cover")] + [g.get("url") for g in ((detail or {}).get("recent_imags") or [])
                                 if isinstance(g, dict)]
    out: list[str] = []
    for p in paths:
        if isinstance(p, str) and p.strip():
            u = ASSETS + quote(p.strip().lstrip("/"))
            if u not in out:
                out.append(u)
    return out


def map_listing(it: dict, detail: Optional[dict]) -> tuple[Optional[dict], str, str]:
    pid = it.get("id")
    if not isinstance(pid, int):
        return None, "residential", "no_id"

    name = re.sub(r"\s+", " ", it.get("name") or "").strip()
    description = redact_pii(re.sub(r"[ \t]+", " ", (it.get("description") or "").replace("\r", "")).strip())
    body = f"{name} {description or ''}"
    age_raw = (it.get("property_age") or "").strip()
    if _AUCTION_RE.search(body):
        return None, "residential", "auction"
    if _CLOSED_NAME_RE.search(name):
        return None, "residential", "sold_or_rented"
    if _OFFPLAN_RE.search(name) or _OFFPLAN_RE.search(age_raw):
        return None, "residential", "off_plan"

    deal = {"للإيجار": "Rent", "للبيع": "Buy"}.get((it.get("category") or "").strip())
    if not deal:
        return None, "residential", "deal_unknown"

    type_ar = re.sub(r"\s+", " ", it.get("type") or "").strip()
    property_type = normalize.map_type_exact(type_ar, TYPE_OVERRIDES)
    if property_type == "Residential Land" and "تجاري" in name:
        property_type = "Commercial Land"           # «أرض تجارية استراتيجية» — the source's own word
    if not property_type:
        return None, "residential", "type_unmapped"
    category = normalize.category_for_type(property_type).lower()
    is_land = property_type in _LAND_TYPES

    location = re.sub(r"\s+", " ", it.get("location") or "").strip()
    hood, _, city_ar = location.rpartition("-")
    hood, city_ar = hood.strip(), city_ar.strip()
    if not city_ar:
        return None, category, "city_not_stated"
    city_id, region_id = to_catalog(city_ar)
    if not city_id:
        return None, category, "city_not_in_catalog"
    district_ar = find_district_in_text(hood or location, city_id)

    amount, unit = parse_price_cell(it.get("price"))
    price_cell = str(it.get("price") or "")
    sw_raw, dir_raw, area_raw = it.get("street_width"), it.get("street_direction"), it.get("property_area")
    licence = str(it.get("license_number") or "").strip()

    row: dict[str, Any] = {
        "ad_number": f"{PREFIX}{pid}",
        "listing_url": f"{BASE}/real-estate/view/{pid}",
        "source": SOURCE,
        "active": True,
        "title": name or None,
        "description": description,
        **normalize.amenities_from_text(description),
        "property_type": property_type,
        "transaction_type": "Rent" if deal == "Rent" else "Buy",
        "city": normalize.map_city(city_ar),
        "city_ar": city_ar,
        "city_id": city_id,
        "region_id": region_id,
        "district_ar": district_ar,
        "neighborhood": hood or None,
        "area_m2": parse_area(area_raw),
        "bedrooms": None if is_land else _count(it.get("bedrooms")),
        "bathrooms": None if is_land else _count(it.get("bathrooms")),
        "property_age": parse_age(age_raw),
        "street_width_m": None if _unset(sw_raw) else normalize.one_street_width(sw_raw),
        "direction": parse_direction(dir_raw),
        "license_number": licence if re.fullmatch(r"\d{6,}", licence) else None,
        "photo_urls": photo_urls(it, detail)[:20] or None,
    }
    # type_ar/name can state furnished ("شقق مفروشة") more explicitly than the free-text
    # description, so it wins — but a bare substring check ignored a negation sitting in the
    # SAME field ("فيلا غير مفروشة"). Route it through the same negation-aware amenities_from_text
    # normalize.py already uses for the description, instead of a second unsafe bypass.
    type_name_furnished = normalize.amenities_from_text(f"{type_ar} {name}").get("furnished")
    if type_name_furnished is not None:
        row["furnished"] = type_name_furnished

    if unit == "per_meter":
        row["price_per_meter"] = amount
        if deal == "Rent":
            row["rent_period"], row["price_annual"] = None, None
        ev = normalize.price_evidence(field="price", raw=price_cell, stored=amount, kind="per_meter",
                                      unit="per_meter", origin="api")
    elif deal == "Buy":
        row["price_total"] = amount if unit == "total" else db.AUTHORITATIVE_NULL
        ev = normalize.price_evidence(field="price", raw=price_cell, stored=amount, kind="total",
                                      unit="total", origin="api", authoritative_absent=unit == "absent")
    else:
        if unit == "absent":
            row["rent_period"], row["price_annual"] = None, db.AUTHORITATIVE_NULL
        else:
            row["rent_period"], row["price_annual"] = rent_period_stated(amount, f"{price_cell} {body}")
        ev = normalize.price_evidence(field="price", raw=price_cell, stored=amount,
                                      kind=row["rent_period"] or "total", unit="total", origin="api",
                                      authoritative_absent=unit == "absent")

    row["additional_info"] = {k: v for k, v in {
        "type_ar": type_ar, "type_en": it.get("type_en") or None,
        "name_en": it.get("name_en") or None, "location_en": it.get("location_en") or None,
        "price_raw": price_cell or None, "price_en": it.get("price_en") or None,
        "price_evidence": ev,
        "area_raw": None if _unset(area_raw) else area_raw,
        "age_raw": None if _unset(age_raw) else age_raw,
        "direction_raw": None if _unset(dir_raw) else dir_raw,
        "street_width_raw": None if _unset(sw_raw) else sw_raw,
        "land_length": None if _unset(it.get("land_length")) else it.get("land_length"),
        "land_width": None if _unset(it.get("land_width")) else it.get("land_width"),
        "bedrooms_raw": None if _unset(it.get("bedrooms")) else it.get("bedrooms"),
        "bathrooms_raw": None if _unset(it.get("bathrooms")) else it.get("bathrooms"),
        "map_location": it.get("map_location") or None,
        "pdf_url": (ASSETS + quote(it["filePdfRecent"].lstrip("/"))) if it.get("filePdfRecent") else None,
        "created_at": it.get("created_at") or None, "updated_at": it.get("updated_at") or None,
        "photo_count": len(photo_urls(it, detail)) or None,
    }.items() if v is not None}
    return row, category, ""


# ── liveness ──────────────────────────────────────────────────────────────────────────────────────
def _signal_for(pid: int):
    def _signal(status, body, _moved):
        try:
            j = json.loads(body)
        except (ValueError, TypeError):
            return None
        if not isinstance(j, dict):
            return None
        if status == 404 and "غير موجود" in str(j.get("message", "")):
            return "gone"
        if status == 200 and j.get("id") == pid:
            return "live"
        return None
    return _signal


def _verify_gone(ad_number: str) -> tuple[str, str]:
    pid = ad_number[len(PREFIX):]
    if not pid.isdigit():
        return "unknown", f"{ad_number!r} is not a {PREFIX}<id> ad number"
    return LivenessProbe(platform="eilmalriyada", signal=_signal_for(int(pid)), session=session,
                         url_for=lambda _a: f"{API}/recent/{pid}").verify_gone(ad_number)


def _controls_live(ad_numbers: list[str]) -> bool:
    """In-run positive control: three rows parsed live THIS run must answer LIVE through the same
    oracle, else the transport may not testify about anyone's absence. Fails closed."""
    if len(ad_numbers) < 3:
        return False
    for ad in ad_numbers[:3]:
        verdict, why = _verify_gone(ad)
        if verdict != "live":
            print(f"  ⚠ oracle control {ad} answered {verdict} ({why}) — prune withheld", flush=True)
            return False
        time.sleep(PAUSE)
    return True


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--type", choices=["residential", "commercial", "all"], default="all")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    s = session()
    dry = args.dry_run or bool(args.limit)
    run_id = None if dry else db.begin_run("eilmalriyada")
    res: list[dict] = []
    com: list[dict] = []
    skipped: dict[str, int] = {}
    items: list[dict] = []
    try:
        items = fetch_catalogue(s)
        if args.limit:
            items = items[:args.limit]
        print(f"{SOURCE}: {len(items)} records in the catalogue", flush=True)
        for it in items:
            detail = fetch_detail(s, it["id"]) if isinstance(it.get("id"), int) else None
            time.sleep(PAUSE)
            row, cat, why = map_listing(it, detail)
            if not row:
                skipped[why] = skipped.get(why, 0) + 1
                continue
            if detail is not None:
                db.mark_direct_alive(row, oracle=ORACLE)     # built from its own record, fetched by id
            else:
                skipped["detail_miss"] = skipped.get("detail_miss", 0) + 1
            if args.type != "all" and cat != args.type:
                continue
            (com if cat == "commercial" else res).append(row)
        notes = ", ".join(f"{k}x{v}" for k, v in sorted(skipped.items(), key=lambda x: -x[1]))
        if DETAIL_MISSES:
            notes += " [detail misses: " + ", ".join(f"{k}x{v}" for k, v in DETAIL_MISSES.items()) + "]"
        if skipped:
            print("  skipped (not guessed): " + notes)
        if dry:
            print(f"✓ {SOURCE} VALIDATION: {len(res)} residential + {len(com)} commercial (nothing written)")
            for r0 in (res + com)[:12]:
                print(f"   {r0['ad_number']:>7} {r0['transaction_type']:4} {str(r0['property_type']):16} "
                      f"{str(r0['city_ar']):8} d={str(r0['district_ar'])[:12]:12} a={str(r0['area_m2']):>6} "
                      f"bd={str(r0['bedrooms']):>4} pt={r0.get('price_total')} pa={r0.get('price_annual')} "
                      f"rp={r0.get('rent_period')} ppm={r0.get('price_per_meter')} "
                      f"ph={len(r0.get('photo_urls') or [])}")
            return 0

        # The public upsert_eilmalriyada_*_batch wrappers are added centrally later; this is the
        # same shared batch writer they will wrap.
        db._wasalt_batch("eilmalriyada_residential_listings", res)
        db._wasalt_batch("eilmalriyada_commercial_listings", com)
        superseded = db.retire_superseded_siblings(
            res_table="eilmalriyada_residential_listings", com_table="eilmalriyada_commercial_listings",
            res_ads={r["ad_number"] for r in res}, com_ads={r["ad_number"] for r in com},
            source=SOURCE)
        if superseded:
            print(f"  retired {superseded} superseded sibling row(s) after a category flip")
        # PRUNE — the catalogue is one complete array (--limit never reaches here; a --type run
        # leaves the other table's seen-set empty by construction), and only once the in-run
        # positive control passed. prune_unseen's own breakers sit on top.
        pruned = 0
        if args.type == "all" and _controls_live([r["ad_number"] for r in res + com]):
            for tbl, rows in (("eilmalriyada_residential_listings", res),
                              ("eilmalriyada_commercial_listings", com)):
                n = db.prune_unseen(tbl, {r["ad_number"] for r in rows}, source=SOURCE,
                                    verify_gone=_verify_gone)
                if n < 0:
                    print(f"  ⚠ {tbl}: prune guard tripped — kept existing active rows")
                else:
                    pruned += n
        misses = skipped.get("detail_miss", 0)
        healthy = db.end_run(run_id, ok=True, rows_seen=len(items), rows_upserted=len(res) + len(com),
                             notes=f"pruned={pruned}; {notes}"[:300],
                             degraded=misses * 5 > len(items),          # >20 % rows without their own record
                             check_tables=["eilmalriyada_residential_listings",
                                           "eilmalriyada_commercial_listings"])
        if not healthy:
            print("✗ run demoted to unhealthy by end_run()", flush=True)
            return 1
        print(f"✓ {SOURCE}: {len(res)} residential + {len(com)} commercial upserted")
        return 0
    except Exception as e:
        if run_id:
            tally = ";".join(f"{k}={v}" for k, v in skipped.items())
            db.end_run(run_id, ok=False, rows_seen=len(items), rows_upserted=0,
                       notes=f"{e}"[:200] + (f" | skips: {tally}" if tally else ""))
        print(f"✗ {SOURCE}: {e}", flush=True)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
