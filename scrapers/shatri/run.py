"""الشاطري للتطوير العقاري — shatrirealestate.com. WordPress + Houzez, sale-only developer (Jeddah).

SOURCE SHAPE (measured live 2026-09-24, before any code):
  · ROUTE. Pretty REST works: /wp-json/wp/v2/properties?per_page=100 → X-WP-Total: 74, one page.
    Every fact is IN the JSON — `property_meta` carries the raw Houzez post-meta (fave_property_price,
    fave_property_size, fave_property_bedrooms, fave_property_bathrooms, fave_property_rooms,
    fave_property_garage, fave_property_year, fave_property_images, fave_property_address,
    fave_property_map_address, fave_property_location) and `content.rendered` is the same prose the
    HTML page shows (checked on 22248: page block «السعر 800,000 ريـال · مساحة العقار 270 م2 · غرف 5
    · دورات مياه 3» == meta 800000/270/5/3). The HTML page is never fetched for facts.
  · TAXONOMIES (fetched, ids are install-local):
      property_status  «جاهز للبيع» 50 · «قيد الانشاء» 7 · «اعادة بيع» 0. No rent status exists.
      property_label   «تم البيع» 22 (SOLD — skipped) · «افراغ فوري» 31 · «استثمار عقاري» 7 ·
                       «عرض الموسم» 7 · «قابل للتفاوض» 2.
      property_type    marketing buckets, several per post («شقة تمليك», «شقق تمليك للبيع جدة»,
                       «شقق تمليك البيلسان جدة», «عقارات وشقق تمليك في حي المروة بجدة», «شقق تحت
                       الانشاء جدة», «شقق تمليك حي الصفا», «شقق تمليك المدينة المنورة», «عمائر
                       للبيع», «فيلا سكنية», «ملحق سكني», «محلات», «محلات للبيع»). Each spelling is
                       named in TYPE_OVERRIDES; a post whose terms map to MORE than one canonical
                       type (5 posts carry «شقة تمليك» AND «عمائر للبيع») is resolved only by the
                       type word its own title leads with, else skipped type_ambiguous.
      property_city    «جــدة» (with tatweel) 61 · «الرياض» 4 · «المدينة المنورة» 1 · unset 8.
      property_area    10 Jeddah district names («المروة» 24, «المنار» 12, «الصفا» 9 …).
      property_feature 16 terms; the ones that are COLUMN facts: «موقف خاص» → parking,
                       «غرفة خادمة» → maid_room, «مياة وصرف عام» → water_supply + sanitation.
                       «توصيلات مكييف» (connections only) and «تاسيس بيت ذكي» are PREPARED, not
                       present → NULL; «بالقرب من حديقه» is the neighbourhood's → NULL.
  · PRICE TRAPS. fave_property_price is a string: 66/74 set; 62 plain digits, «750,000 ريـال» ×2,
    «1,500,000 ريال» ×1 — and ONE word numeral «مليون و500 الف» (18361, a sold post) which normalize.to_int reads
    as 500. parse_price() therefore accepts a value only when, after removing separators and the
    currency word, nothing but digits remains; the word form publishes NO price and keeps the raw.
    No per-metre phrasing exists in any body (grep «للمتر|سعر المتر» = 0 hits). Nothing is derived.
  · UNDER CONSTRUCTION. «قيد الانشاء» posts WITH a price (6) are priced units and are published with
    the status recorded; 21820 («شقق فندقية برج الشاطري», no price, no unit) is skipped
    off_plan_unpriced.
  · CITY. 8 posts have no property_city; their title («… حي المنار جدة», «… بجدة») or address meta
    («حي المروة, جدة السعودية») names it. to_catalog decides; «جــدة» resolves (tatweel folded).
  · PHOTOS: featured_media + fave_property_images are ATTACHMENT IDS → /wp/v2/media?include=… .
    Confirmed: media 22253 → …/WhatsApp-Image-1447-11-18-at-19.51.34-1.jpeg, image/jpeg.
  · PDPL: bodies carry no phone/email (measured 0 hits); redact_pii runs regardless.
  · REMOVAL ORACLE (measured 2026-09-24): GET /wp-json/wp/v2/properties/<id> answers HTTP 404
    {"code":"rest_post_invalid_id"} for ids the route does not hold (1, 99999999, and the attachment
    id 22253 — 3/3), and 200 with its own id + status «publish» for live ids (22251, 22248, 22238 —
    3/3). A SOLD post stays 200 with label «تم البيع» — the same skip the crawl applies, so the
    signal reads it as gone. A 401/403/429/5xx or a non-JSON body is no opinion (shared law).
"""
from __future__ import annotations

import argparse
import datetime as dt
import html as ihtml
import json
import re
import sys
import time
from pathlib import Path
from typing import Any, Optional

from curl_cffi import requests as cc

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from scrapers.common import db, normalize  # noqa: E402
from scrapers.common.arabic_location import city_ar_for, find_district_in_text, to_catalog  # noqa: E402
from scrapers.common.http_liveness import LivenessProbe  # noqa: E402
from scrapers.common.pii import redact_pii  # noqa: E402

BASE = "https://shatrirealestate.com"
SOURCE = "الشاطري للتطوير العقاري"
PREFIX = "SHT"
RES_TABLE = "shatri_residential_listings"
COM_TABLE = "shatri_commercial_listings"

# The source's exact term spellings (marketing buckets) → canonical. Exact match only.
TYPE_OVERRIDES = {
    "شقة تمليك": "Apartment", "شقق تمليك للبيع جدة": "Apartment",
    "شقق تمليك البيلسان جدة": "Apartment", "عقارات وشقق تمليك في حي المروة بجدة": "Apartment",
    "شقق تحت الانشاء جدة": "Apartment", "شقق تمليك حي الصفا": "Apartment",
    "شقق تمليك المدينة المنورة": "Apartment",
    "عمائر للبيع": "Building", "فيلا سكنية": "Villa", "محلات": "Shop", "محلات للبيع": "Shop",
    # «ملحق سكني» (a roof annex) has no canonical type; every post carrying it also carries
    # «شقة تمليك», which is what the source itself calls the unit. Alone it is type_unmapped.
}
# When a post's terms map to several canonical types, only its own title may pick one.
_TITLE_TYPE_WORD = {"Building": r"عمار[ةه]|عمائر", "Apartment": r"شق[ةه]|شقق|ملحق", "Villa": r"فيلا|فله|فيلة",
                    "Shop": r"محل"}
_TITLE_LEAD_TYPE = {"فلل": "Villa", "فيلا": "Villa", "أدوار": "Floor", "ادوار": "Floor", "دور": "Floor",
                    "عمارة": "Building", "عماره": "Building", "عمائر": "Building", "شقة": "Apartment",
                    "شقه": "Apartment", "شقق": "Apartment"}
SOLD_LABEL = "تم البيع"
UNDER_CONSTRUCTION = "قيد الانشاء"
FEATURE_COL = {"موقف خاص": ("parking",), "غرفة خادمة": ("maid_room",),
               "مياة وصرف عام": ("water_supply", "sanitation")}
RENT_RE = re.compile(r"للإيجار|للايجار|للأيجار|إيجار|ايجار")
_CURRENCY_RE = re.compile(r"ريـ?ال|ر\.س|SAR|﷼|sar", re.I)
_PAUSE = 0.6


def session() -> cc.Session:
    # impersonate owns the User-Agent — never set one here.
    s = cc.Session(impersonate="chrome")
    s.headers.update({"Accept": "application/json", "Accept-Language": "ar,en;q=0.7"})
    return s


def _api(s: cc.Session, route: str, **params: Any) -> tuple[Any, dict]:
    """GET one REST route → (json, headers). Raises on anything that is not JSON 200."""
    r = s.get(f"{BASE}/wp-json{route}", params=params, timeout=60)
    if r.status_code != 200:
        raise RuntimeError(f"{route} → HTTP {r.status_code}")
    if "json" not in (r.headers.get("content-type") or "").lower():
        raise RuntimeError(f"{route} → not JSON: {r.text[:120]!r}")
    return r.json(), dict(r.headers)


def html_text(raw: Optional[str]) -> str:
    if not raw:
        return ""
    t = re.sub(r"(?is)<(script|style).*?</\1>", " ", raw)
    t = re.sub(r"(?i)<br\s*/?>|</(p|div|li|h[1-6]|tr)>", "\n", t)
    t = ihtml.unescape(re.sub(r"(?s)<[^>]+>", " ", t))
    t = re.sub(r"[ \t\xa0]+", " ", t)
    return re.sub(r"\n\s*\n+", "\n", t).strip()


def _meta1(meta: dict, key: str) -> Optional[str]:
    v = (meta or {}).get(key)
    if isinstance(v, list):
        v = v[0] if v else None
    v = str(v).strip() if v is not None else ""
    return v or None


def parse_price(raw: Optional[str]) -> Optional[int]:
    """The figure the source printed, or None. «750,000 ريـال» → 750000; «مليون و500 الف» → None
    (a word numeral: to_int would publish 500 — the raw is kept in additional_info instead);
    «750000.50» → 750000 via normalize.to_int (a bare '.'-strip would have stored 75000050)."""
    if not raw:
        return None
    s = _CURRENCY_RE.sub("", str(raw)).translate(normalize._TRANS)
    if re.search(r"[^\d\s,٬.٫]", s):
        return None                                   # a word numeral (or any letter) is not a figure
    # The shared rule: «750000.50» → 750000 (1-2 decimals = halalas), never ×100; 0 = WP "not set".
    return normalize.to_int(s) or None


def resolve_type(type_terms: list[str], title: str) -> tuple[Optional[str], str]:
    """(canonical_type, skip_reason). Several canonical candidates → the title's own leading type
    word decides; none/many → skipped, never folded into a neighbour."""
    cands = {normalize.map_type_exact(t, TYPE_OVERRIDES) for t in type_terms}
    cands.discard(None)
    if not cands and not type_terms:
        # 4 posts carry NO type term; their title's own leading noun is the source's type word
        # («فلل للبيع في الرياض – مشروع أركان المها» → Villa). A title that does not lead with one
        # («استثمار عقاري بجدة») stays unmapped.
        first = (title or "").split()[:1]
        cands = {_TITLE_LEAD_TYPE[first[0]]} if first and first[0] in _TITLE_LEAD_TYPE else set()
    if not cands:
        return None, f"type_unmapped[{', '.join(type_terms) or 'none'}]"
    if len(cands) == 1:
        return cands.pop(), ""
    hits = [c for c in cands if re.search(_TITLE_TYPE_WORD.get(c, r"$^"), title or "")]
    if len(hits) == 1:
        return hits[0], ""
    return None, f"type_ambiguous[{', '.join(sorted(cands))}]"


def resolve_city(city_term: Optional[str], texts: list[str]) -> tuple[Optional[int], Optional[int], Optional[str]]:
    """(city_id, region_id, city_ar) — the taxonomy term first, then any Arabic word of the
    address/title («بجدة» → «جدة»). to_catalog decides; nothing is defaulted."""
    cands = [city_term] if city_term else []
    for t in texts:
        # «حي الصفا بجدة»: الصفا is ALSO a catalog city, so a district phrase must never be scanned
        # as a city candidate (measured on 22208, which resolved to the town الصفا, not جدة).
        t = re.sub(r"(?:بحي|حي|حى)\s+\S+", " ", t or "")
        for w in re.findall(r"[\u0621-\u064a\u0671-\u06d3]{3,}", t):
            # The STRIPPED form first: «بجدة» is itself a catalog village (region 7), so trying the
            # prefixed word first published a Jeddah flat 800 km away.
            w2 = w[1:] if w[0] in "بل" and len(w) > 3 else w
            for c in (w2, w):
                if c not in cands:
                    cands.append(c)
    for c in cands:
        cid, rid = to_catalog(c)
        if cid:
            return cid, rid, city_ar_for(cid) or c
    return None, None, None


def map_listing(post: dict, terms: dict[str, dict[int, str]], media: dict[int, str],
                *, this_year: Optional[int] = None) -> tuple[Optional[dict], str, str]:
    """One WP post → (row, category, skip_reason); row is None exactly when skip_reason is set."""
    if (post.get("status") or "") != "publish":
        return None, "residential", f"wp_status_{post.get('status')}"

    def names(tax: str) -> list[str]:
        table = terms.get(tax) or {}
        return [table[t] for t in (post.get(tax) or []) if t in table]

    labels, status = names("property_label"), names("property_status")
    if SOLD_LABEL in labels:
        return None, "residential", "sold"
    title = html_text((post.get("title") or {}).get("rendered"))
    ptype, why = resolve_type(names("property_type"), title)
    if not ptype:
        return None, "residential", why
    category = normalize.category_for_type(ptype).lower()
    meta = post.get("property_meta") or {}
    price_raw = _meta1(meta, "fave_property_price")
    price = parse_price(price_raw)
    if UNDER_CONSTRUCTION in status and price is None:
        return None, category, "off_plan_unpriced"
    body = redact_pii(html_text((post.get("content") or {}).get("rendered"))) or ""
    # Houzez free-text fields an agent can type — redact same as body (PDPL, rule 8) before they
    # reach city/district matching, neighborhood or additional_info.
    addr = [redact_pii(_meta1(meta, "fave_property_address")) or None,
            redact_pii(_meta1(meta, "fave_property_map_address")) or None]
    city_id, region_id, city_ar = resolve_city(next(iter(names("property_city")), None),
                                               [a for a in addr if a] + [title])
    if not city_id:
        return None, category, "city_not_in_catalog"
    area_term = next(iter(names("property_area")), None)
    district = None
    # The title contributes ONLY its own «حي X» phrase: scanning the whole title matched the
    # project name «مشروع الراية» as the Riyadh district «حي الراية» (22159).
    title_hy = re.search(r"(?:بحي|حي|حى)\s+\S+", title or "")
    for text in (area_term, addr[0], title_hy.group(0) if title_hy else None):
        district = find_district_in_text(text, city_id) if text else None
        if district:
            break

    photo_ids = [int(post["featured_media"])] if post.get("featured_media") else []
    for chunk in (_meta1(meta, "fave_property_images") or "").split(","):
        if chunk.strip().isdigit() and int(chunk) not in photo_ids:
            photo_ids.append(int(chunk))
    dwelling = ptype in ("Apartment", "Villa", "Duplex", "Floor", "Studio")
    beds, baths = normalize.to_int(_meta1(meta, "fave_property_bedrooms")), normalize.to_int(_meta1(meta, "fave_property_bathrooms"))
    garage = normalize.to_int(_meta1(meta, "fave_property_garage"))
    row: dict[str, Any] = {
        "ad_number": f"{PREFIX}{post['id']}",
        "listing_url": ihtml.unescape(post["link"]),
        "source": SOURCE, "active": True,
        "title": title or None, "description": body or None,
        **normalize.amenities_from_text(body),
        "property_type": ptype,
        "transaction_type": "Rent" if RENT_RE.search(title) else "Buy",
        "city": normalize.map_city(city_ar), "city_ar": city_ar, "city_id": city_id, "region_id": region_id,
        "district_ar": district, "neighborhood": area_term or addr[0],
        "area_m2": normalize.to_int(_meta1(meta, "fave_property_size")),
        "bedrooms": beds if dwelling else None, "bathrooms": baths if dwelling else None,
        "property_age": normalize.age_from_completion_year(_meta1(meta, "fave_property_year"),
                                                          this_year=this_year or dt.date.today().year),
        "license_number": normalize.ad_licence_from_prose(body),
        "photo_urls": [media[i] for i in photo_ids if media.get(i)][:20] or None,
    }
    if garage:
        row["parking"] = True
    for feat in names("property_feature"):
        for col in FEATURE_COL.get(feat, ()):
            row.setdefault(col, True)
    if row["transaction_type"] == "Rent":
        period, annual = normalize.rent_period_and_annual(price, body)
        row["price_annual"] = annual
        if period:
            row["rent_period"] = period
    else:
        row["price_total"] = price
    row["additional_info"] = {k: v for k, v in {
        "wp_post_id": post["id"], "source_property_id": _meta1(meta, "fave_property_id"),
        "type_terms": ", ".join(names("property_type")) or None,
        "status_ar": ", ".join(status) or None, "labels_ar": ", ".join(labels) or None,
        "features_ar": ", ".join(names("property_feature")) or None,
        "price_raw": price_raw, "price_unparsed": price_raw if price_raw and price is None else None,
        "year_raw": _meta1(meta, "fave_property_year"),
        "rooms": normalize.to_int(_meta1(meta, "fave_property_rooms")),
        "bedrooms_raw": beds if not dwelling else None, "bathrooms_raw": baths if not dwelling else None,
        "garage": garage, "address": addr[0], "map_address": addr[1],
        "geo": _meta1(meta, "fave_property_location"), "video_url": _meta1(meta, "fave_video_url"),
        "modified": post.get("modified"),
    }.items() if v is not None}
    return row, category, ""


def fetch_terms(s: cc.Session) -> dict[str, dict[int, str]]:
    out: dict[str, dict[int, str]] = {}
    for tax in ("property_type", "property_status", "property_label", "property_city",
                "property_area", "property_feature"):
        data, _ = _api(s, f"/wp/v2/{tax}", per_page=100)
        out[tax] = {t["id"]: ihtml.unescape((t.get("name") or "").strip()) for t in data if t.get("id")}
        time.sleep(_PAUSE)
    return out


def fetch_posts(s: cc.Session, limit: int = 0) -> tuple[list[dict], int]:
    """All published properties (+ the X-WP-Total the site itself states, the completeness check)."""
    posts: list[dict] = []
    page, total = 1, 0
    while True:
        batch, hdr = _api(s, "/wp/v2/properties", per_page=100, page=page)
        total = int({k.lower(): v for k, v in hdr.items()}.get("x-wp-total") or total or 0)
        posts.extend(batch)
        if len(batch) < 100 or (limit and len(posts) >= limit):
            break
        page += 1
        time.sleep(_PAUSE)
    return (posts[:limit] if limit else posts), total


def fetch_media(s: cc.Session, ids: list[int]) -> dict[int, str]:
    out: dict[int, str] = {}
    ids = sorted({i for i in ids if i})
    for i in range(0, len(ids), 50):
        data, _ = _api(s, "/wp/v2/media", include=",".join(map(str, ids[i:i + 50])), per_page=100,
                       _fields="id,source_url")
        out.update({int(m["id"]): m["source_url"] for m in data if m.get("id") and m.get("source_url")})
        time.sleep(_PAUSE)
    return out


def _photo_ids(post: dict) -> list[int]:
    ids = [int(post["featured_media"])] if post.get("featured_media") else []
    for chunk in (_meta1(post.get("property_meta") or {}, "fave_property_images") or "").split(","):
        if chunk.strip().isdigit():
            ids.append(int(chunk))
    return ids


# ── LIVENESS (see the docstring's measured oracle) ───────────────────────────────────────────────
def _signal_for(pid: int, label_names: dict[int, str]):
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
        if (j.get("status") or "") != "publish":
            return "gone"
        if SOLD_LABEL in [label_names.get(t) for t in (j.get("property_label") or [])]:
            return "gone"
        return "live"
    return _signal


def _make_verify_gone(terms: dict[str, dict[int, str]]):
    labels = terms.get("property_label") or {}

    def verify_gone(ad_number: str) -> tuple[str, str]:
        pid = ad_number[len(PREFIX):]
        if not pid.isdigit():
            return "unknown", f"{ad_number!r} is not a {PREFIX}<post id> ad number"
        return LivenessProbe(platform="shatri", signal=_signal_for(int(pid), labels), session=session,
                             url_for=lambda _ad: f"{BASE}/wp-json/wp/v2/properties/{pid}").verify_gone(ad_number)
    return verify_gone


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--type", choices=["residential", "commercial", "all"], default="all")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()
    s = session()
    dry = args.dry_run or bool(args.limit)
    run_id = None if dry else db.begin_run("shatri")
    res: list[dict] = []
    com: list[dict] = []
    skipped: dict[str, int] = {}
    try:
        terms = fetch_terms(s)
        posts, total = fetch_posts(s, limit=args.limit)
        if not posts:
            raise RuntimeError("/wp/v2/properties returned no posts")
        print(f"{SOURCE}: {len(posts)} posts (X-WP-Total {total})", flush=True)
        media = fetch_media(s, [i for p in posts for i in _photo_ids(p)])
        for p in posts:
            row, cat, why = map_listing(p, terms, media)
            if not row:
                skipped[why] = skipped.get(why, 0) + 1
                continue
            if args.type != "all" and cat != args.type:
                continue
            (com if cat == "commercial" else res).append(row)
        notes = ", ".join(f"{k}x{v}" for k, v in sorted(skipped.items(), key=lambda x: -x[1]))
        if skipped:
            print(f"  skipped (not guessed): {notes}")
        if dry:
            print(f"✓ {SOURCE} VALIDATION: {len(res)} residential + {len(com)} commercial (nothing written)")
            for r0 in (res + com)[:40]:
                print(f"   {r0['ad_number']:>9} {r0['property_type']:10} {r0['city_ar']:8} d={str(r0['district_ar']):14} "
                      f"a={str(r0['area_m2']):>5} p={str(r0.get('price_total') or r0.get('price_annual')):>9} "
                      f"b={r0['bedrooms']} age={r0['property_age']} ph={len(r0['photo_urls'] or [])}")
            return 0
        # public upsert_shatri_*_batch wrappers are added centrally later; the shared batch writer is used directly.
        db._wasalt_batch(RES_TABLE, res)
        db._wasalt_batch(COM_TABLE, com)
        superseded = db.retire_superseded_siblings(res_table=RES_TABLE, com_table=COM_TABLE,
                                                   res_ads={r["ad_number"] for r in res},
                                                   com_ads={r["ad_number"] for r in com}, source=SOURCE)
        pruned = 0
        # Only a COMPLETE enumeration may prune: every post the site counts was read this run.
        if args.type == "all" and total and len(posts) >= total:
            verify_gone = _make_verify_gone(terms)
            for tbl, rows in ((RES_TABLE, res), (COM_TABLE, com)):
                n = db.prune_unseen(tbl, {r["ad_number"] for r in rows}, source=SOURCE, verify_gone=verify_gone)
                pruned += max(n, 0)
        healthy = db.end_run(run_id, ok=True, rows_seen=len(posts), rows_upserted=len(res) + len(com),
                             check_tables=["shatri_residential_listings", "shatri_commercial_listings"],
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
