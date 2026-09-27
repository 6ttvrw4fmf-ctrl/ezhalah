"""آل متعب العقارية — almuteb.sa. 10 listings, onboarding 2026-09-24.

SOURCE SHAPE (measured live 2026-09-24, nothing below is assumed):
  · A stock WordPress + Houzez theme with an OPEN REST API. The whole catalogue is one call:
    /wp-json/wp/v2/properties?per_page=100 → x-wp-total: 10, all status «publish». No challenge,
    no auth, plain curl_cffi chrome impersonation answers 200 on REST, HTML and images.
  · Everything the detail page prints is in the REST record — the page is Houzez rendering the
    same `property_meta` (fave_property_price → «السعر SAR2,090,000», fave_property_land →
    «مساحة الأرض 275», fave_property_bedrooms/bathrooms → «غرف النوم 4 / الحمامات 5»), so the
    detail page is NOT fetched. Taxonomies (ids on the post, names via /wp/v2/<tax>):
      property_status  62 «للبيع» (10) · 61 «للإيجار» (0)             → the deal
      property_type    79 «فيلا» (3) · 81 «أدوار» (6) · 103 «تاون هاووس» (1) — AND the project
                       names 107-110 «لافنير آل متعب 46/70/72/79» sit in the SAME taxonomy, so a
                       post carries [79, 107]: the type is the first term that maps, never index 0.
      property_city    83 «الرياض» (10)                                → the city, 10/10
      property_area    «حي البيان» 4 · «حي الصفا» 1 · «حي العارض» 2 · «حي المصيف» 1 (8/10); the two
                       without a term say it in the body («دور ثاني بحي المصيف») → prose fallback.
      property_feature بلكونة/تراس/غرفة خادمة/غرفة غسيل/مجلس/مدخل خاصِ/مدخل سيارة/مساحة خضراء/مصعد/
                       مقلط — named → True, never negated by the source → False never occurs here.
  · THE BODY IS ONE LINE («فلل بحي الصفا», «دور ثاني بحي المصيف», «أدوار بحي البيان»): no price,
    no licence, no phone, no period word in any of the 10. The «دور أرضي/أول/ثاني» in it is the
    unit's FLOOR, read into floor_number only when the type is Floor.
  · PRICE = fave_property_price, digits only («2090000»), printed as SAR2,090,000. 10/10 priced.
    All 10 are for-sale → price_total. A rent term never occurred; if one appears, the period is
    read ONLY from the ad's own words (price postfix, title, body) and stays NULL when silent.
  · AREA: fave_property_land on 10/10 (printed «مساحة الأرض»), fave_property_size on 1/10 (19957).
    area_m2 = size when the source prints one, else the land figure — both kept raw in
    additional_info so the label the site used is never lost.
  · ONE POST CARRIES A HOUZEZ MULTI-UNIT (19957: «دور أرضي», price 992000, 3/3, 150 m²) — a second
    advertised unit with its own price inside the same page. Owner rule (compound sites): each
    unit type is one listing → ad_number MTB19957-U0, listing_url = the post's page.
  · GEOLOCATION is a real Riyadh pin on 10/10 but is not stored (no column); the reverse-geocoded
    fave_property_map_address («إبراهيم الكوارني, الشرق, محافظة رماح») is a geocoder string, not
    the ad's district, and is never used for location.
  · PHOTOS: fave_property_images holds the gallery attachment ids (36 across the 10); resolved via
    /wp/v2/media?include=… (36/36 image/png|jpeg). Paths are Arabic («72-الدور-الثاني-03-scaled.png»)
    → percent-encoded. Fetched one: 200 image/png 2.1 MB.
  · REMOVAL ORACLE (per-id REST re-read, the same signal as scrapers/masar): a property this
    route does not hold answers HTTP 404 {"code":"rest_post_invalid_id"}. NO listing has ever been
    deleted from this site — the Wayback CDX holds exactly the 10 current URLs — so the 404 was
    measured on 4/4 non-property ids here (19998, 19996, 19994, 18802) and on 3/3 REAL deleted
    listings of the sibling Houzez/WP install aalbarrak.com (20017, 20250, 19891 — same WP core
    code path). Live controls 3/3 (19999, 19997, 19995): 200 with status «publish». A trashed or
    draft post answers 401 → the law reads that as no opinion, never a death.
    A UNIT row (MTB<post>-U<i>) is alive only while the parent's fave_multi_units still holds
    index i (measured: 19957 holds exactly one unit today); a publish parent whose unit list no
    longer reaches i is a dead unit, never a self-heal.
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

BASE = "https://almuteb.sa"
SOURCE = "آل متعب العقارية"
PREFIX = "MTB"
REST = f"{BASE}/wp-json/wp/v2"

# The site's exact spellings that the shared map does not know. «تاون هاووس» folds into Villa the
# way the fleet's canonical fold does (normalize: Townhouse → Villa); «أدوار» is the plural of دور.
TYPE_OVERRIDES = {"أدوار": "Floor", "دور أرضي": "Floor", "دور أول": "Floor", "دور ثاني": "Floor",
                  "تاون هاووس": "Villa", "فلل": "Villa"}
TAXONOMIES = ("property_type", "property_status", "property_city", "property_area",
              "property_feature")

# property_feature term → tri-state amenity column. Only NAMED features exist on this source, so
# only True is ever written; absence is NULL (the key is left out), never False.
FEATURE_COLS = {"مصعد": "elevator", "غرفة خادمة": "maid_room", "مدخل خاص": "private_entrance",
                "مدخل سيارة": "car_entrance", "بلكونة": "balcony_terrace", "تراس": "balcony_terrace",
                "غرفة غسيل": "laundry_room"}

_DEAL = {"للبيع": "Buy", "للإيجار": "Rent", "للايجار": "Rent"}
_CLOSED_RE = re.compile(r"تم\s*البيع|تم\s*الإيجار|تم\s*الايجار|تم\s*التأجير|مباع|مؤجر")
_AUCTION_RE = re.compile(r"مزاد")
_FLOOR_RE = re.compile(r"دور\s+(?:ال)?(أرضي|ارضي|أول|اول|ثاني|ثالث|رابع)")
_FLOOR_N = {"أرضي": 0, "ارضي": 0, "أول": 1, "اول": 1, "ثاني": 2, "ثالث": 3, "رابع": 4}
_ANNUAL_RE = re.compile(r"سنوي|سنويا|سنوياً|بالسنة|في السنة")
_MONTHLY_RE = re.compile(r"شهري|شهريا|شهرياً|بالشهر|في الشهر")
# scrapers.common.pii misses Arabic-Indic mobiles («٠٥٦١١١٤٨٨٨» is live on the sibling site);
# Arabic-notation parity is a standing rule, so the gap is closed here until pii.py is (open issue).
_AR_PHONE_RE = re.compile(r"[٠]?٥[٠-٩]{8}")


def session() -> cc.Session:
    # impersonate OWNS the User-Agent — never set one (the rakez lesson). Only Accept-* are ours.
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


def _floor(text: str) -> Optional[int]:
    m = _FLOOR_RE.search(text)
    return _FLOOR_N[m.group(1)] if m else None


def rent_fields(price: Optional[int], words: str) -> tuple[Optional[str], Optional[int]]:
    """PERIOD = SOURCE. A text that states BOTH yearly and monthly for one figure → NULL period,
    figure unconverted; otherwise the shared reader (silent → (None, price); daily → (None, None))."""
    if _ANNUAL_RE.search(words) and _MONTHLY_RE.search(words):
        return None, price
    return normalize.rent_period_and_annual(price, words)


def _period_words(post: dict) -> str:
    """The only words a rent period may be read from: the price postfix, the title, the body."""
    return " ".join(filter(None, (_meta(post, "fave_property_price_postfix"),
                                  _strip((post.get("title") or {}).get("rendered")),
                                  _strip((post.get("content") or {}).get("rendered")))))


def multi_units(raw: Optional[str]) -> list[dict[str, str]]:
    """Houzez's PHP-serialised fave_multi_units → [{title, price, beds, baths, size}, …]."""
    out = []
    for chunk in re.split(r"i:\d+;a:\d+:\{", raw or "")[1:]:
        d = {k.removeprefix("fave_mu_"): v
             for k, v in re.findall(r's:\d+:"(fave_mu_\w+)";s:\d+:"([^"]*)"', chunk)}
        if d.get("title"):
            out.append(d)
    return out


def map_listing(post: dict, tax: dict, photos: list[str]) -> tuple[Optional[dict], str, str]:
    if (post.get("status") or "").lower() != "publish":
        return None, "residential", f"status_{post.get('status')}"
    title = _strip((post.get("title") or {}).get("rendered"))
    body = _strip((post.get("content") or {}).get("rendered"))
    words = f"{title} {body}"
    if _AUCTION_RE.search(words):
        return None, "residential", "auction"

    status_ar = _names(post, tax, "property_status")
    if any(_CLOSED_RE.search(s) for s in status_ar) or _CLOSED_RE.search(words):
        return None, "residential", "sold_or_rented"
    deal = next((_DEAL[s] for s in status_ar if s in _DEAL), None) \
        or next((d for w, d in _DEAL.items() if w in title), None)
    if not deal:
        return None, "residential", "no_deal_stated"

    types_ar = _names(post, tax, "property_type")
    type_ar, property_type = next(((t, normalize.map_type_exact(t, TYPE_OVERRIDES)) for t in types_ar
                                   if normalize.map_type_exact(t, TYPE_OVERRIDES)), (None, None))
    if not property_type:
        return None, "residential", "type_unmapped"
    category = normalize.category_for_type(property_type).lower()

    city_ar = next(iter(_names(post, tax, "property_city")), None)
    if not city_ar:
        return None, category, "city_not_stated"
    city_id, region_id = to_catalog(city_ar)
    if not city_id:
        return None, category, "city_not_in_catalog"
    # District: the property_area term (8/10), else the ad's own «بحي المصيف». Either way it must
    # survive find_district_in_text() against THIS city's catalog; neighborhood keeps the raw text.
    area_term = next(iter(_names(post, tax, "property_area")), None)
    district_ar = find_district_in_text(area_term or words, city_id)

    price = normalize.to_int(_meta(post, "fave_property_price"))
    size, land = normalize.to_int(_meta(post, "fave_property_size")), normalize.to_int(_meta(post, "fave_property_land"))
    features = _names(post, tax, "property_feature")
    amen = {FEATURE_COLS[k]: True for f in features for k in FEATURE_COLS
            if k in re.sub(r"[\u064B-\u0652]", "", f)}
    row: dict[str, Any] = {
        "ad_number": f"{PREFIX}{post['id']}",
        "listing_url": post["link"],
        "source": SOURCE,
        "active": True,
        "title": title or None,
        "description": _redact(body),
        "property_type": property_type,
        "transaction_type": "Rent" if deal == "Rent" else "Buy",
        "city": normalize.map_city(city_ar),
        "city_ar": city_ar,
        "city_id": city_id,
        "region_id": region_id,
        "district_ar": district_ar,
        "neighborhood": area_term or (re.search(r"ب?(حي\s+\S+)", body) or [None, None])[1],
        "area_m2": size or land,
        "bedrooms": normalize.to_int(_meta(post, "fave_property_bedrooms")),
        "bathrooms": normalize.to_int(_meta(post, "fave_property_bathrooms")),
        # «دور ثاني بحي المصيف» in the body, else the type term itself (104-106 «دور أرضي/أول/ثاني»).
        "floor_number": _floor(f"{words} {type_ar}") if property_type == "Floor" else None,
        "property_age": normalize.age_from_labelled_prose(words),
        "license_number": normalize.ad_licence_from_prose(words),
        "photo_urls": photos[:20] or None,
        **amen,
    }
    if deal == "Rent":
        row["rent_period"], row["price_annual"] = rent_fields(price, _period_words(post))
    else:
        row["price_total"] = price
    row["additional_info"] = {k: v for k, v in {
        "type_ar": type_ar, "type_terms_ar": types_ar, "status_ar": status_ar,
        "features_ar": features or None, "district_term": area_term,
        "land_area_m2": land, "size_m2": size,
        "price_raw": _meta(post, "fave_property_price"),
        "price_postfix": _meta(post, "fave_property_price_postfix"),
        "published_at": post.get("date_gmt"), "modified_at": post.get("modified_gmt"),
        "photo_count": len(photos) or None,
    }.items() if v is not None}
    return row, category, ""


def unit_rows(row: dict, post: dict) -> list[dict]:
    """One listing per Houzez multi-unit (owner's compound rule): the parent row with the unit's
    own title/price/rooms/size, keyed MTB<post>-U<i>, landing on the same page."""
    out = []
    for i, u in enumerate(multi_units(_meta(post, "fave_multi_units"))):
        t = normalize.map_type_exact(u["title"], TYPE_OVERRIDES) or row["property_type"]
        r = {**row, "ad_number": f"{row['ad_number']}-U{i}", "title": f"{row['title']} — {u['title']}",
             "property_type": t, "floor_number": _floor(u["title"]) if t == "Floor" else None,
             "bedrooms": normalize.to_int(u.get("beds")), "bathrooms": normalize.to_int(u.get("baths")),
             "area_m2": normalize.to_int(u.get("size")) or row["area_m2"],
             "additional_info": {**row["additional_info"], "unit_of": row["ad_number"], "unit_raw": u}}
        unit_price = normalize.to_int(u.get("price"))       # no fave_mu_price → NULL, never the parent's
        if "price_total" in row:
            r["price_total"] = unit_price
        else:
            r["rent_period"], r["price_annual"] = rent_fields(unit_price, _period_words(post))
        out.append(r)
    return out


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
    """Every property post, paged; returns (posts, x-wp-total) so main() can prove completeness."""
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
    """post id → gallery image urls, via the ids Houzez keeps in fave_property_images."""
    want: dict[int, list[int]] = {}
    for p in posts:
        ids = [int(x) for x in ((p.get("property_meta") or {}).get("fave_property_images") or [])
               if str(x).isdigit()]
        if ids:
            want[p["id"]] = ids
    all_ids = sorted({i for ids in want.values() for i in ids})
    url_of: dict[int, str] = {}
    for i in range(0, len(all_ids), 100):
        batch, _ = _json(s, f"{REST}/media", include=",".join(map(str, all_ids[i:i + 100])),
                         per_page=100, _fields="id,source_url,media_type")
        for m in batch or []:
            if m.get("media_type") == "image" and str(m.get("source_url", "")).startswith("http"):
                url_of[m["id"]] = quote(m["source_url"], safe=":/%?=&")
    return {pid: [url_of[i] for i in ids if i in url_of] for pid, ids in want.items()}


# ── LIVENESS ─────────────────────────────────────────────────────────────────────────────────────
def _signal_for(pid: int, tax: dict, unit: Optional[int] = None):
    """`unit` = the -U<i> index of a multi-unit row: the parent may live on while the unit is gone."""
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
        if unit is not None and unit >= len(multi_units(_meta(j, "fave_multi_units"))):
            return "gone"       # the post lives on, the unit was removed from it
        return "live"
    return _signal


def _verify_gone_with(tax: dict):
    def _verify_gone(ad_number: str) -> tuple[str, str]:
        pid, _, unit = ad_number[len(PREFIX):].partition("-U")
        if not pid.isdigit() or (unit and not unit.isdigit()):
            return "unknown", f"{ad_number!r} is not a {PREFIX}<post id>[-U<i>] ad number"
        return LivenessProbe(platform="almuteb", signal=_signal_for(int(pid), tax, int(unit) if unit else None),
                             session=session,
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
    run_id = None if dry else db.begin_run("almuteb")
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
            (com if cat == "commercial" else res).extend([row, *unit_rows(row, p)])
        if skipped:
            print("  skipped (not guessed): "
                  + ", ".join(f"{k}x{v}" for k, v in sorted(skipped.items(), key=lambda x: -x[1])))
        if dry:
            print(f"✓ {SOURCE} VALIDATION: {len(res)} residential + {len(com)} commercial (nothing written)")
            for r0 in (res + com)[:15]:
                print(f"   {r0['ad_number']:>11} {r0['transaction_type']:4} {str(r0['property_type']):10} "
                      f"{str(r0['city_ar']):7} d={str(r0['district_ar'])[:12]:12} a={str(r0['area_m2']):>4} "
                      f"bd={str(r0['bedrooms']):>2} ba={str(r0['bathrooms']):>2} fl={str(r0['floor_number']):>4} "
                      f"pt={r0.get('price_total')} pa={r0.get('price_annual')} rp={r0.get('rent_period')} "
                      f"ph={len(r0.get('photo_urls') or [])}")
            return 0
        # The public upsert_almuteb_*_batch wrappers are added centrally later; this is the same
        # funnel they wrap.
        db._wasalt_batch("almuteb_residential_listings", res)
        db._wasalt_batch("almuteb_commercial_listings", com)
        superseded = db.retire_superseded_siblings(
            res_table="almuteb_residential_listings", com_table="almuteb_commercial_listings",
            res_ads={r["ad_number"] for r in res}, com_ads={r["ad_number"] for r in com}, source=SOURCE)
        if superseded:
            print(f"  retired {superseded} superseded sibling row(s) after a category flip")
        # PRUNE only after a COMPLETE enumeration (x-wp-total parity, --type all, no --limit), and
        # only through the measured per-id oracle. prune_unseen's own breakers sit on top.
        pruned = 0
        if args.type == "all" and complete:
            for tbl, rows in (("almuteb_residential_listings", res), ("almuteb_commercial_listings", com)):
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
                             check_tables=["almuteb_residential_listings", "almuteb_commercial_listings"])
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
