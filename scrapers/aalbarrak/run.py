"""البراك للعقارات — aalbarrak.com. 10 listings, onboarding 2026-09-24.

SOURCE SHAPE (measured live 2026-09-24):
  · WordPress + Houzez with an OPEN REST API: /wp-json/wp/v2/properties?per_page=100 →
    x-wp-total: 10, all «publish». wp-sitemap-posts-property-1.xml lists the same 10 URLs. Plain
    curl_cffi chrome impersonation answers 200 everywhere; no challenge.
  · Taxonomies (ids on the post, names via /wp/v2/<tax>):
      property_status  20 «للبيع» (5) · 19 «للإيجار» (5) · 75 «تم البيع» (0) · 74 «تم الايجار» (0)
                       → the deal; the two «تم …» terms are the source's own SOLD/RENTED flag and
                       are a skip here and a death in the oracle.
      property_type    the real types «فيلا» 5 «شقة» 3 «دور» 1 «عمارة سكنية» 1 sit in the SAME
                       taxonomy as the deal words «للبيع» (5) «للإيجار» (4) and «قريبا للبيع» (0),
                       so a post carries [52, 66]: the type is the first term that MAPS, and
                       «قريبا للبيع» is a coming-soon marker → skip.
      property_city    18 «الرياض» on 6/10; the other 4 have no term. Every title is formulaic
                       «دور للإيجار في شارع محمد السواني, حي القيروان, مدينة الرياض, منطقة الرياض»
                       so the city is RECOGNISED from the title against a closed Saudi city set
                       when the term is missing — never inferred from a district or the office.
      property_area    empty; the district is the title's own «حي القيروان» → find_district_in_text.
      property_feature all counts 0 → amenities come from the prose only (amenities_from_text).
  · PRICE = fave_property_price, printed as «100,000 ريال للإيجار». Stored with commas on some
    («3,700,000», «65,000») → to_int. 9/10 priced; 20609 has none AND opens «بدأ البيع فلل و
    أدوار النرجس 33» (a project whose sale just started, no priced unit) → skip
    off_plan_unpriced. 20465 is the same project text WITH a price and «يوجد شهادة إتمام بناء»
    → kept.
  · RENT PERIOD: 5 rent ads; NONE states a period anywhere (no price postfix, no سنوي/شهري in
    title, body or the rendered page — measured on all 5) → rent_period NULL, price_annual = the
    figure unconverted. Defaulting annual here would be an invented 12× on a monthly ad.
  · AREA: fave_property_land on 10/10, printed by the theme as «181 مساحة متر مربع»; no size field.
  · ROOMS: fave_property_bedrooms on 7/10, bathrooms on 4/10. The prose itemises floors («الدور
    الأول: غرفة نوم ماستر ثلاثة غرف نوم …») so a prose count is used ONLY when the ad mentions a
    bedroom group exactly once (20657 «يحتوي على ٣ غرف نوم» → 3); structured fields win when set.
  · PROSE FACTS, all live: «رقم ترخيص الإعلان 7200922698» (20583) → license_number; «عمر العقار
    4 سنوات» → property_age (the «ضمان 15 سنة» warranties on 20651 are refused by the labelled
    reader); «شارع 15 جنوبي» → street_width_m/direction; «تأسيس مصعد» (prepared, 20609/20465) must
    stay NULL; phones in BOTH notations («0559393694», «٠٥٦١١١٤٨٨٨») → redacted.
  · GEOLOCATION is the Houzez DEFAULT PIN (25.68654,-80.431345 = Miami) on 10/10 → never stored.
  · PHOTOS: no fave_property_images; each post's gallery is its own attachments →
    /wp/v2/media?parent=<ids>&media_type=image (41 across the 10; 4-5 per post). Fetched one:
    200 image/webp 62 KB.
  · REMOVAL ORACLE (per-id REST re-read): 3/3 REAL deleted listings found through the Wayback CDX
    (post ids 20017, 20250, 19891 — «أرض للبيع …» pages of 2024) answer HTTP 404
    {"code":"rest_post_invalid_id"} on /wp/v2/properties/<id> (and 404 on their HTML URL);
    3/3 live controls (20657, 20651, 20643) answer 200 «publish». A 200 whose property_status
    holds «تم البيع/تم الايجار» is also gone. A draft/trashed post answers 401 → no opinion.
"""
from __future__ import annotations

import argparse
import html as _html
import json
import re
import sys
from pathlib import Path
from typing import Any, Optional
from urllib.parse import quote

from curl_cffi import requests as cc

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from scrapers.common import db, normalize  # noqa: E402
from scrapers.common.arabic_location import find_district_in_text, to_catalog  # noqa: E402
from scrapers.common.http_liveness import LivenessProbe  # noqa: E402
from scrapers.common.pii import redact_pii  # noqa: E402

BASE = "https://aalbarrak.com"
SOURCE = "البراك للعقارات"
PREFIX = "BRK"
REST = f"{BASE}/wp-json/wp/v2"

TYPE_OVERRIDES = {"عمارة سكنية": "Building", "شقة سكنية": "Apartment", "أرض سكنية": "Residential Land",
                  "محل تجاري": "Shop"}
TAXONOMIES = ("property_type", "property_status", "property_city", "property_area", "property_feature")
_DEAL = {"للبيع": "Buy", "للإيجار": "Rent", "للايجار": "Rent"}
_COMING_SOON_RE = re.compile(r"(?<![ء-ي])قريبا|(?<![ء-ي])قريباً|على الخارطة|علي الخارطة")  # not «تقريبا»
_SALES_START_RE = re.compile(r"بدأ\s*البيع")
# Checked against title+body (like almuteb's twin) so a closed marker stated only in the body
# still skips the ad (reviewer 2026-09-24: this scraper used to check the title alone). The
# (?!ة) exclusions stay deliberate: the feminine forms «مباعة»/«مؤجرة» describe an occupied/sold
# UNIT inside a still-for-sale listing's own prose (a tenant-occupancy disclosure), never the
# listing's own closed-deal status — masc «مباع»/«مؤجر» is the status marker.
_CLOSED_RE = re.compile(r"تم\s*البيع|تم\s*الإيجار|تم\s*الايجار|تم\s*التأجير|مباع(?!ة)|مؤجر(?!ة)")
_AUCTION_RE = re.compile(r"مزاد")
_FLOOR_RE = re.compile(r"دور\s+(?:ال)?(أرضي|ارضي|أول|اول|ثاني|ثالث|رابع)")
_FLOOR_N = {"أرضي": 0, "ارضي": 0, "أول": 1, "اول": 1, "ثاني": 2, "ثالث": 3, "رابع": 4}
_ANNUAL_RE = re.compile(r"سنوي|سنويا|سنوياً|بالسنة|في السنة")
_MONTHLY_RE = re.compile(r"شهري|شهريا|شهرياً|بالشهر|في الشهر")
_BEDS_RE = re.compile(r"غرف(?:ة|تين|)\s*نوم")
# scrapers.common.pii misses Arabic-Indic mobiles (live here: «٠٥٦١١١٤٨٨٨» on 20637/20590) —
# Arabic-notation parity is a standing rule, closed locally until pii.py is (open issue).
_AR_PHONE_RE = re.compile(r"[٠]?٥[٠-٩]{8}")
# The closed set of city names a title here could carry; longest first so «المدينة المنورة» wins.
# Anchored on the title's own «مدينة X» segment: a street or district named after another city
# («شارع الرياض, حي X, مدينة جدة») must never place the listing.
_CITIES = ("المدينة المنورة", "مكة المكرمة", "خميس مشيط", "حفر الباطن", "الرياض", "جدة", "الدمام",
           "الخبر", "الظهران", "الطائف", "بريدة", "عنيزة", "حائل", "تبوك", "أبها", "نجران", "جازان",
           "الباحة", "سكاكا", "عرعر", "القطيف", "الأحساء", "الهفوف", "ينبع", "الجبيل", "الخرج", "مكه")
_CITY_RE = re.compile(r"مدينة\s+(" + "|".join(re.escape(c) for c in sorted(_CITIES, key=len, reverse=True)) + ")")


def session() -> cc.Session:
    # impersonate OWNS the User-Agent — never set one. Only Accept-* are ours.
    s = cc.Session(impersonate="chrome")
    s.headers.update({"Accept": "application/json, text/html;q=0.9, */*;q=0.8",
                      "Accept-Language": "ar,en;q=0.7"})
    return s


def _strip(h: Optional[str]) -> str:
    return re.sub(r"\s+", " ", _html.unescape(re.sub(r"<[^>]+>", " ", h or ""))).strip()


def _redact(text: Optional[str]) -> Optional[str]:
    out = redact_pii(text)
    return _AR_PHONE_RE.sub("[redacted]", out) if isinstance(out, str) else out


def _meta(post: dict, key: str) -> Optional[str]:
    v = (post.get("property_meta") or {}).get(key)
    if isinstance(v, list):
        v = v[0] if v else None
    return str(v).strip() if v not in (None, "") else None


def _names(post: dict, tax: dict, key: str) -> list[str]:
    return [tax.get(key, {}).get(i) for i in (post.get(key) or []) if tax.get(key, {}).get(i)]


def rent_fields(price: Optional[int], words: str) -> tuple[Optional[str], Optional[int]]:
    """PERIOD = SOURCE: both yearly and monthly named for one figure → NULL period, figure kept;
    else the shared reader (silent → (None, price); daily/weekly → (None, None))."""
    if _ANNUAL_RE.search(words) and _MONTHLY_RE.search(words):
        return None, price
    return normalize.rent_period_and_annual(price, words)


_AR_WORD_NUM = {"ثلاث": 3, "ثلاثة": 3, "ثلاثه": 3, "اربع": 4, "أربع": 4, "اربعة": 4, "أربعة": 4,
                "خمس": 5, "خمسة": 5, "ست": 6, "ستة": 6}
# «٣ غرف نوم», «ثلاث غرف نوم», or the dual «غرفتين نوم» (= 2, its count is the suffix, not a prefix).
_BEDS_COUNT_RE = re.compile(r"(?:([\d٠-٩]{1,2})|(" + "|".join(_AR_WORD_NUM) + r"))\s*غرف(?:ة|تين|)\s*نوم"
                            r"|(?<![ء-ي])(غرفتين)\s*نوم")


def prose_bedrooms(body: str) -> Optional[int]:
    """A prose bedroom count ONLY when the ad states one bedroom group once — an ad that itemises
    floors («الدور الأول: … ثلاثة غرف نوم … السطح: غرفتين نوم») understates the unit on every
    single match, so it stays NULL (masar's measured rule). Digits in both notations and the word
    numerals count (20657 writes «٣ غرف نوم»)."""
    if len(_BEDS_RE.findall(body)) != 1:
        return None
    m = _BEDS_COUNT_RE.search(body)
    if not m:
        return None
    if m.group(1):
        return normalize.to_int(m.group(1))
    return _AR_WORD_NUM.get(m.group(2)) if m.group(2) else 2


# «تأسيس مصعد» / «مصعد مؤسس» is a PREPARED shaft, not an elevator (live on 20609/20465); the shared
# reader knows the second spelling only, so the first is blanked before it looks (open issue).
_PREPARED_RE = re.compile(r"تأسيس\s+(?:ال)?مصعد|تاسيس\s+(?:ال)?مصعد|مصعد\s+مؤسس")


def city_in_title(title: str) -> Optional[str]:
    m = _CITY_RE.search(title)
    return m.group(1) if m else None


def map_listing(post: dict, tax: dict, photos: list[str]) -> tuple[Optional[dict], str, str]:
    if (post.get("status") or "").lower() != "publish":
        return None, "residential", f"status_{post.get('status')}"
    title = _strip((post.get("title") or {}).get("rendered"))
    body = _strip((post.get("content") or {}).get("rendered"))
    words = f"{title} {body}"
    if _AUCTION_RE.search(words):
        return None, "residential", "auction"

    status_ar = _names(post, tax, "property_status")
    types_ar = _names(post, tax, "property_type")
    if any(_CLOSED_RE.search(s) for s in status_ar) or _CLOSED_RE.search(words):
        return None, "residential", "sold_or_rented"
    if any(_COMING_SOON_RE.search(t) for t in types_ar) or _COMING_SOON_RE.search(title):
        return None, "residential", "coming_soon"
    deal = next((_DEAL[s] for s in status_ar if s in _DEAL), None) \
        or next((d for w, d in _DEAL.items() if w in title), None)
    if not deal:
        return None, "residential", "no_deal_stated"

    type_ar, property_type = next(((t, normalize.map_type_exact(t, TYPE_OVERRIDES)) for t in types_ar
                                   if normalize.map_type_exact(t, TYPE_OVERRIDES)), (None, None))
    if not property_type:
        return None, "residential", "type_unmapped"
    category = normalize.category_for_type(property_type).lower()

    price = normalize.to_int(_meta(post, "fave_property_price"))
    if price is None and _SALES_START_RE.search(body):
        return None, category, "off_plan_unpriced"

    city_ar = next(iter(_names(post, tax, "property_city")), None) or city_in_title(title)
    if not city_ar:
        return None, category, "city_not_stated"
    city_id, region_id = to_catalog(city_ar)
    if not city_id:
        return None, category, "city_not_in_catalog"
    # The district is matched from the title's own «حي X» phrase only — never from the street segment
    # («شارع الملقا, حي النرجس» must not file the listing under الملقا).
    hood = re.search(r"حي\s+[ء-ي]+(?:\s+[ء-ي]+)?", title)
    district_ar = find_district_in_text(hood.group(0), city_id) if hood else None

    street_w, facade = normalize.street_from_prose(body)
    land = normalize.to_int(_meta(post, "fave_property_land"))
    row: dict[str, Any] = {
        "ad_number": f"{PREFIX}{post['id']}",
        "listing_url": post["link"],
        "source": SOURCE,
        "active": True,
        "title": title or None,
        "description": _redact(body),
        # Tri-state from the ad's prose: named → True, «غير مفروشة» → False, «تأسيس مصعد» → NULL.
        **normalize.amenities_from_text(_PREPARED_RE.sub(" ", body)),
        "property_type": property_type,
        "transaction_type": "Rent" if deal == "Rent" else "Buy",
        "city": normalize.map_city(city_ar),
        "city_ar": city_ar,
        "city_id": city_id,
        "region_id": region_id,
        "district_ar": district_ar,
        "neighborhood": hood.group(0) if hood else None,
        "area_m2": land,
        "bedrooms": normalize.to_int(_meta(post, "fave_property_bedrooms")) or prose_bedrooms(body),
        "bathrooms": normalize.to_int(_meta(post, "fave_property_bathrooms")),
        "floor_number": (lambda m: _FLOOR_N[m.group(1)] if m else None)(_FLOOR_RE.search(words))
        if property_type == "Floor" else None,
        "property_age": normalize.age_from_labelled_prose(body),
        "street_width_m": street_w,
        "direction": normalize.one_direction(facade) if facade else None,
        "license_number": normalize.ad_licence_from_prose(body),
        "photo_urls": photos[:20] or None,
    }
    if deal == "Rent":
        row["rent_period"], row["price_annual"] = rent_fields(
            price, f"{_meta(post, 'fave_property_price_postfix') or ''} {words}")
    else:
        row["price_total"] = price
    row["additional_info"] = {k: v for k, v in {
        "type_ar": type_ar, "type_terms_ar": types_ar, "status_ar": status_ar,
        "land_area_m2": land, "price_raw": _meta(post, "fave_property_price"),
        "price_postfix": _meta(post, "fave_property_price_postfix"),
        "rooms_raw": _meta(post, "fave_property_rooms"),
        "published_at": post.get("date_gmt"), "modified_at": post.get("modified_gmt"),
        "photo_count": len(photos) or None,
    }.items() if v is not None}
    return row, category, ""


# ── fetch ─────────────────────────────────────────────────────────────────────────────────────────
def _json(s: cc.Session, url: str, **params) -> tuple[Optional[list], Optional[str]]:
    r = s.get(url, params=params, timeout=60)
    if r.status_code != 200:
        return None, None
    try:
        j = r.json()
    except ValueError:
        return None, None
    return (j if isinstance(j, list) else None), r.headers.get("x-wp-total")


def fetch_taxonomies(s: cc.Session) -> dict[str, dict[int, str]]:
    tax: dict[str, dict[int, str]] = {}
    for t in TAXONOMIES:
        terms, _ = _json(s, f"{REST}/{t}", per_page=100, _fields="id,name")
        tax[t] = {x["id"]: _strip(x["name"]) for x in (terms or [])}
    return tax


def fetch_listings(s: cc.Session, limit: int = 0) -> tuple[list[dict], Optional[int]]:
    out: list[dict] = []
    total = None
    for page in range(1, 21):
        batch, hdr = _json(s, f"{REST}/properties", per_page=100, page=page)
        total = int(hdr) if hdr and hdr.isdigit() else total
        if not batch:
            break
        out.extend(batch)
        if len(batch) < 100 or (limit and len(out) >= limit):
            break
    return (out[:limit] if limit else out), total


def fetch_photos(s: cc.Session, posts: list[dict]) -> dict[int, list[str]]:
    """post id → its image attachments (featured image first)."""
    by_post: dict[int, list[str]] = {}
    ids = [p["id"] for p in posts]
    for i in range(0, len(ids), 50):
        for page in range(1, 11):
            batch, _ = _json(s, f"{REST}/media", parent=",".join(map(str, ids[i:i + 50])),
                             media_type="image", per_page=100, page=page, orderby="id", order="asc",
                             _fields="id,post,source_url")
            for m in batch or []:
                if str(m.get("source_url", "")).startswith("http") and m.get("post"):
                    by_post.setdefault(int(m["post"]), []).append(quote(m["source_url"], safe=":/%?=&"))
            if not batch or len(batch) < 100:
                break
    featured = {p["id"]: p.get("featured_media") for p in posts}
    for pid, urls in by_post.items():
        fm = featured.get(pid)
        urls.sort(key=lambda u: 0 if fm and f"/{fm}" in u else 1)
    return by_post


# ── LIVENESS ─────────────────────────────────────────────────────────────────────────────────────
def _signal_for(pid: int, tax: dict):
    closed_ids = {i for i, n in tax.get("property_status", {}).items() if _CLOSED_RE.search(n)}

    def _signal(status, body, _moved):
        try:
            j = json.loads(body)
        except (ValueError, TypeError):
            return None
        if not isinstance(j, dict):
            return None
        if status == 404 and j.get("code") == "rest_post_invalid_id":
            return "gone"
        if status != 200 or j.get("id") != pid:
            return None
        if (j.get("status") or "").lower() != "publish" or set(j.get("property_status") or []) & closed_ids:
            return "gone"
        return "live"
    return _signal


def _verify_gone_with(tax: dict):
    def _verify_gone(ad_number: str) -> tuple[str, str]:
        pid = ad_number[len(PREFIX):]
        if not pid.isdigit():
            return "unknown", f"{ad_number!r} is not a {PREFIX}<post id> ad number"
        return LivenessProbe(platform="aalbarrak", signal=_signal_for(int(pid), tax), session=session,
                             url_for=lambda _ad: f"{REST}/properties/{pid}").verify_gone(ad_number)
    return _verify_gone


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--type", choices=["residential", "commercial", "all"], default="all")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    s = session()
    dry = args.dry_run or bool(args.limit)
    run_id = None if dry else db.begin_run("aalbarrak")
    res: list[dict] = []
    com: list[dict] = []
    skipped: dict[str, int] = {}
    posts: list[dict] = []
    try:
        tax = fetch_taxonomies(s)
        posts, total = fetch_listings(s, limit=args.limit)
        if not posts:
            raise RuntimeError("/wp-json/wp/v2/properties returned no posts")
        complete = not args.limit and total == len(posts)
        print(f"{SOURCE}: {len(posts)} listings discovered (x-wp-total {total})", flush=True)
        photos = fetch_photos(s, posts)
        for p in posts:
            row, cat, why = map_listing(p, tax, photos.get(p["id"], []))
            if not row:
                skipped[why] = skipped.get(why, 0) + 1
                continue
            if args.type != "all" and cat != args.type:
                continue
            (com if cat == "commercial" else res).append(row)
        if skipped:
            print("  skipped (not guessed): "
                  + ", ".join(f"{k}x{v}" for k, v in sorted(skipped.items(), key=lambda x: -x[1])))
        if dry:
            print(f"✓ {SOURCE} VALIDATION: {len(res)} residential + {len(com)} commercial (nothing written)")
            for r0 in (res + com)[:15]:
                print(f"   {r0['ad_number']:>9} {r0['transaction_type']:4} {str(r0['property_type']):10} "
                      f"{str(r0['city_ar']):7} d={str(r0['district_ar'])[:12]:12} a={str(r0['area_m2']):>4} "
                      f"bd={str(r0['bedrooms']):>4} ba={str(r0['bathrooms']):>4} age={str(r0['property_age']):>4} "
                      f"st={str(r0['street_width_m']):>4}/{str(r0['direction']):5} lic={r0['license_number']} "
                      f"pt={r0.get('price_total')} pa={r0.get('price_annual')} rp={r0.get('rent_period')} "
                      f"ph={len(r0.get('photo_urls') or [])}")
            return 0
        # The public upsert_aalbarrak_*_batch wrappers are added centrally later; same funnel.
        db._wasalt_batch("aalbarrak_residential_listings", res)
        db._wasalt_batch("aalbarrak_commercial_listings", com)
        superseded = db.retire_superseded_siblings(
            res_table="aalbarrak_residential_listings", com_table="aalbarrak_commercial_listings",
            res_ads={r["ad_number"] for r in res}, com_ads={r["ad_number"] for r in com}, source=SOURCE)
        if superseded:
            print(f"  retired {superseded} superseded sibling row(s) after a category flip")
        pruned = 0
        if args.type == "all" and complete:
            for tbl, rows in (("aalbarrak_residential_listings", res), ("aalbarrak_commercial_listings", com)):
                n = db.prune_unseen(tbl, {r["ad_number"] for r in rows}, source=SOURCE,
                                    verify_gone=_verify_gone_with(tax))
                if n < 0:
                    print(f"  ⚠ {tbl}: prune guard tripped — kept existing active rows")
                else:
                    pruned += n
        elif args.type == "all":
            print(f"  ⚠ enumeration incomplete ({len(posts)} of x-wp-total {total}) — no prune")
        notes = ", ".join(f"{k}x{v}" for k, v in sorted(skipped.items(), key=lambda x: -x[1]))
        healthy = db.end_run(run_id, ok=True, rows_seen=len(posts), rows_upserted=len(res) + len(com),
                             notes=f"pruned={pruned}; complete={complete}; {notes}"[:300],
                             check_tables=["aalbarrak_residential_listings", "aalbarrak_commercial_listings"])
        if not healthy:
            print("✗ run demoted to unhealthy by end_run()'s RC-B guard", flush=True)
            return 1
        print(f"✓ {SOURCE}: {len(res)} residential + {len(com)} commercial upserted")
        return 0
    except Exception as e:
        if run_id:
            notes = f"{e}"[:200] + " | skips: " + ",".join(f"{k}x{v}" for k, v in skipped.items())
            db.end_run(run_id, ok=False, rows_seen=len(posts), rows_upserted=0, notes=notes[:300])
        print(f"✗ {SOURCE}: {e}", flush=True)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
