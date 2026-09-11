"""آمال للخدمات العقارية — amaall.com (Houzez WordPress theme, `properties` post type).

THE FIRST THING THIS SCRAPER DOES IS THROW HALF THE SOURCE AWAY, AND THAT IS THE POINT.
/wp-json/wp/v2/properties returns 135 posts. They are NOT 135 listings — they are ~67 listings
published TWICE, once in Arabic and once in English:

    68 posts under /en/  +  67 posts without  =  135

Measured 2026-09-06: of 55 distinct price/size/bedroom signatures, 39 appear more than once, and
every duplicate pair is exactly one EN post and one AR post (price 9,500,000 → EN 23773 + AR 23751;
950,000 → EN 23661 + AR 23640; 9,225,000 → EN 23484 + AR 23478). Ingesting all 135 would put every
آمال property on the site twice — the duplicate-manufacturing failure that got `toor` rejected
outright during the same audit. Only the ARABIC posts are ingested; Ezhalah is an Arabic product
and the Arabic post is the canonical one.

THE COORDINATES ARE NOT A LOCATION. fave_property_location reads `25.68654,-80.431345` on several
posts — a NEGATIVE longitude, i.e. Florida, not Saudi Arabia. It is a theme default, exactly the
class of signal that got danaalkhair deferred. Location comes ONLY from the property_city taxonomy;
no coordinate is ever consulted, and neither is the title.

«حي النعيم» IS A DISTRICT SITTING IN THE CITY TAXONOMY (their data-entry slip, 1 post). It is
refused rather than allowed to invent a city called "An Naeem District" — the shared resolver
returns nothing for it, and this scraper does not second-guess that.

SOLD IS PUBLISHED AND HONOURED. property_status carries تم البيع (11), تم التأجير (3) and
تم التأجير بالكامل (1) alongside للبيع (36) and للإيجار (3). Those 15 are ingested with
active=false — the source DID publish them, and hiding them from search is what `active` is for.

TYPES: سكني / تجاري are CATEGORIES, not types — nearly every post carries one alongside its real
type, so they are skipped when picking the type and never stored as one.
"""
from __future__ import annotations

import argparse
import hashlib
import html as ihtml
import os
import re
import sys
from pathlib import Path
from typing import Any, Optional

from curl_cffi import requests as cc

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from scrapers.common import db, normalize  # noqa: E402
from scrapers.common.arabic_location import to_catalog  # noqa: E402

BASE = "https://www.amaall.com"
REST = f"{BASE}/wp-json/wp/v2"
SOURCE = "Amaall"
PREFIX = "AML"
LAST_FETCH_NOTE = ""

TAXONOMIES = ("property_type", "property_status", "property_city", "property_state",
              "property_feature", "property_label", "property_area")

# Two vetted additions to the house taxonomy. Each has exactly one canonical answer and is not a
# combined bucket: «أرض سكنية» and «عمارة سكنية» are the plain qualified forms of أرض / عمارة, and
# «محطة وقود» is the same thing the house map already calls «محطة بنزين» (Gas Station).
# EXACT-ONLY otherwise — no fuzzy fallback. normalize.map_type() mis-files combined Arabic category
# names (proven on alta: "محلات ومعارض" → "Residential Land"), and a wrong type is invisible.
TYPE_OVERRIDES = {
    "أرض سكنية": "Residential Land",
    "عمارة سكنية": "Building",
    "محطة وقود": "Gas Station",
}

# CATEGORIES the site files under property_type. Never a type; skipped when picking one.
TYPE_CATEGORY_TERMS = ("سكني", "تجاري")

# Refused rather than guessed: «إداري» (administrative — an office? an admin building? no single
# answer) and «كشك» (kiosk — the house taxonomy has no such type). Skipped and counted every run.
TYPE_UNMAPPABLE = ("إداري", "كشك")

# TITLE-TYPE FALLBACK, used ONLY when the taxonomy states no real type.
#
# 16 of the 67 Arabic posts carry ONLY the category «سكني» in property_type — the source never
# files a type — yet their own title says it plainly: «عمارة سكنية مميزة للبيع…», «شقة سكنية مميزة
# للبيع…», «فيلا مميزة للبيع…», «ارض مميزة للبيع…». That is the SOURCE'S OWN WORDS about its own
# listing, not an inference by us, and reading a type out of the title is established practice here
# (scrapers/awal/run.py's _map_type does the same). Without it this platform loses a quarter of its
# inventory to a field the site simply does not fill in.
#
# Deliberately narrow: an exact word the house map already knows, first match wins, and ONLY when
# the taxonomy gave nothing. Anything else still ends in the skip counter.
TITLE_TYPE_WORDS = ("عمارة", "شقة", "فيلا", "أرض", "ارض", "مزرعة", "استراحة",
                    "معرض", "مكتب", "ورشة", "مستودع", "محل", "دور")

# STATUS IS NEVER READ FROM THE TITLE. Measured case: «شقة مميزة للبيع …» whose property_status is
# «تم التأجير». The title is the original ad copy; the taxonomy is the CURRENT state. Trusting the
# title there would put a rented property back on the market.

# Statuses meaning the listing has left the market. Everything else — including a post with NO
# status — is active: absence of a sold marker is not evidence of a sale.
GONE_STATUSES = ("تم البيع", "تم التأجير", "تم التأجير بالكامل")

_PHONE_RE = re.compile(r"(?:\+?966|00966|0)?5\d{8}\b")
_PHONE_LOOSE = re.compile(r"(?:[\d٠-٩][\s\-]?){9,}")


def session() -> cc.Session:
    s = cc.Session(impersonate="chrome124")
    s.headers.update({"Accept": "application/json,text/html;q=0.9",
                      "Accept-Language": "ar,en-US;q=0.7,en;q=0.6"})
    purl = os.environ.get("WASALT_PROXY_URL", "").strip()
    if purl:
        s.proxies = {"http": purl, "https": purl}
    return s


def _clean(s: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", ihtml.unescape(s or ""))).strip()


def _redact(text: Optional[str]) -> Optional[str]:
    if not text:
        return text
    t = _PHONE_LOOSE.sub(" ", _PHONE_RE.sub(" ", text))
    t = re.sub(r"_?للتواصل[^_\n]*", " ", t)
    t = re.sub(r"_?للاتصال[^_\n]*", " ", t)
    return re.sub(r"\s{2,}", " ", t).strip() or None


def _meta1(meta: dict, key: str) -> Any:
    """WP serialises single-value meta as a 1-element list; unwrap without assuming either shape.
    NOT for genuinely multi-valued meta — that mistake cost shmoualshmal 9 of its 10 photos."""
    v = meta.get(key)
    if isinstance(v, list):
        return v[0] if v else None
    return v


def is_arabic_post(p: dict) -> bool:
    """The AR/EN split is carried in the permalink: English posts live under /en/. See the module
    docstring — taking both languages doubles every listing."""
    return "/en/" not in (p.get("link") or "")


def fetch_taxonomies(s: cc.Session) -> dict[str, dict[int, str]]:
    out: dict[str, dict[int, str]] = {}
    for tax in TAXONOMIES:
        try:
            r = s.get(f"{REST}/{tax}?per_page=100", timeout=30)
            if r.status_code != 200:
                continue
            terms = r.json()
        except Exception:
            continue
        if isinstance(terms, list):
            out[tax] = {t["id"]: t.get("name") for t in terms
                        if isinstance(t, dict) and isinstance(t.get("id"), int)}
    return out


def fetch_listings(s: cc.Session) -> list[dict]:
    global LAST_FETCH_NOTE
    LAST_FETCH_NOTE = "no pages attempted"
    out: list[dict] = []
    for page in range(1, 30):
        try:
            r = s.get(f"{REST}/properties?per_page=100&page={page}", timeout=40)
        except Exception as e:
            LAST_FETCH_NOTE = f"page {page} raised {type(e).__name__}: {str(e)[:120]}"
            break
        if r.status_code != 200:
            LAST_FETCH_NOTE = f"page {page} returned HTTP {r.status_code}"
            break
        try:
            batch = r.json()
        except Exception:
            LAST_FETCH_NOTE = f"page {page} body was not JSON (parked/blocked/truncated)"
            break
        if not isinstance(batch, list) or not batch:
            LAST_FETCH_NOTE = f"page {page} returned an empty list (end of source)"
            break
        out.extend(x for x in batch if isinstance(x, dict))
        if len(batch) < 100:
            break
    return out


def fetch_images(s: Optional[cc.Session], posts: list[dict]) -> dict[int, list[str]]:
    """{wp_post_id: [full-size image url, ...]} bound by ATTACHMENT PARENT.

    media_type is filtered to 'image' because this source attaches VIDEO to its listings —
    measured 2 video/mp4 among 74 attachments across 6 posts (WhatsApp-Video-*.mp4). A video url
    stored as a photo renders as a broken card, which is how sadin shipped its defect.
    """
    out: dict[int, list[str]] = {}
    if s is None:
        return out
    for p in posts:
        pid = p.get("id")
        if not isinstance(pid, int):
            continue
        try:
            r = s.get(f"{REST}/media?parent={pid}&per_page=100"
                      "&orderby=date&order=asc&_fields=id,source_url,media_type", timeout=40)
            if r.status_code != 200:
                continue
            media = r.json()
        except Exception:
            continue
        if not isinstance(media, list):
            continue
        urls = [m["source_url"] for m in media
                if isinstance(m, dict) and m.get("media_type") == "image" and m.get("source_url")]
        if urls:
            out[pid] = list(dict.fromkeys(urls))
    return out


def map_listing(p: dict, tax: dict[str, dict[int, str]],
                images: Optional[dict[int, list[str]]] = None) -> tuple[Optional[dict], str]:
    link = p.get("link")
    if not link or not is_arabic_post(p):
        return None, "residential"      # English duplicate — see the module docstring

    def terms(key: str) -> list[str]:
        names = tax.get(key) or {}
        return [n for n in (names.get(i) for i in (p.get(key) or [])) if n]

    statuses = terms("property_status")
    is_rent = any("إيجار" in st or "تأجير" in st for st in statuses)
    is_buy = any("بيع" in st for st in statuses)
    if not (is_rent or is_buy):
        return None, "residential"
    gone = any(g in st for st in statuses for g in GONE_STATUSES)

    title = _clean((p.get("title") or {}).get("rendered", ""))

    # EXACT ONLY (+ the vetted overrides); categories and refused terms are skipped.
    raw_type = next((t for t in terms("property_type")
                     if t not in TYPE_CATEGORY_TERMS and t not in TYPE_UNMAPPABLE
                     and (t in TYPE_OVERRIDES or normalize.map_type_exact(t))), None)
    property_type = (TYPE_OVERRIDES.get(raw_type) or normalize.map_type_exact(raw_type)) if raw_type else None
    type_from = "taxonomy" if property_type else None

    if not property_type:
        # The taxonomy filed only a category. Read the type from the source's OWN title — see
        # TITLE_TYPE_WORDS. A refused taxonomy term (إداري/كشك) is NOT rescued this way: if the
        # source named a type we will not map, the title must not talk us out of that refusal.
        if not any(t in TYPE_UNMAPPABLE for t in terms("property_type")):
            for w in TITLE_TYPE_WORDS:
                if w in title:
                    cand = normalize.map_type_exact(w)
                    if cand:
                        property_type, raw_type, type_from = cand, w, "title"
                        break

    if not property_type:
        return None, "residential"
    category = normalize.category_for_type(property_type).lower()

    # LOCATION = the city taxonomy ONLY. No coordinate (theme default lands in Florida), no title.
    # A term the shared resolver does not know — «حي النعيم» is a DISTRICT the site mis-filed here
    # — yields no city rather than inventing one.
    raw_city = next((c for c in terms("property_city") if normalize.map_city(c)), None)
    city = normalize.map_city(raw_city) if raw_city else None
    region = normalize.region_for_city(city)

    # Arabic-native shadow (2026-09-11, same pattern azdad/abwbna/alobid/bahadhabab already carry):
    # raw_city IS already the site's own Arabic city term (see above), so city_id/region_id resolve
    # through the same shared to_catalog() 6 other scrapers use — never a hand-rolled/ambiguous
    # mapping. This is what lets listing_native_location_v1 (the native resolver) see amaall's own
    # city at all, instead of falling through to a text-matching fallback.
    city_id, region_id = to_catalog(raw_city) if raw_city else (None, None)

    # DISTRICT — the `property_area` taxonomy IS the site's «تسمية الحي» field (Houzez theme;
    # confirmed live 2026-09-11, term 60 on a real post resolves to «حي العزيزية», the exact text
    # the page itself labels «تسمية الحي»). It was simply never in TAXONOMIES, so every amaall
    # listing shipped with neighborhood=None though the source states it plainly.
    raw_neighborhood = (terms("property_area") or [None])[0]

    meta = p.get("property_meta") or {}
    price = normalize.to_int(_meta1(meta, "fave_property_price"))
    # AREA — Houzez splits size across TWO meta keys depending on listing shape: fave_property_size
    # for a built area (villa/apartment), fave_property_land for a bare plot. A land listing (most
    # of this platform's inventory) has NO fave_property_size at all, so area_m2 was silently None
    # for it even though the source states the size plainly (confirmed live: post 19900, «حي
    # العزيزية» land ad — fave_property_size absent, fave_property_land="552", page shows «مساحة
    # العقار: 552 متر مربع»). Falls back to land ONLY when size is absent/unparseable — never
    # overrides a real size value.
    #
    # The two keys get DIFFERENT parsers on purpose. fave_property_size sometimes holds garbage
    # unrelated to area (post 19413: "465 غرفة" — a room count, not a size) — to_int_numeric's
    # strict float parse correctly refuses that (None), and must keep refusing it. fave_property_land
    # is a simpler field (a number, sometimes with a bare unit suffix like "529 م" — post 20915) —
    # to_int() strips that suffix safely; using it here does not reopen the size field's garbage risk
    # because it only ever runs on land, never on size.
    area = (normalize.to_int_numeric(_meta1(meta, "fave_property_size"))
            or normalize.to_int(_meta1(meta, "fave_property_land")))
    beds = normalize.to_int(_meta1(meta, "fave_property_bedrooms"))
    baths = normalize.to_int(_meta1(meta, "fave_property_bathrooms"))

    body = _clean((p.get("content") or {}).get("rendered", ""))

    # PERIOD = SOURCE — no token in the source's own text means NULL, never a manufactured 'annual'.
    rent_period, price_annual = (None, None)
    if is_rent:
        rent_period, price_annual = normalize.rent_period_and_annual(price, f"{title} {body}")

    info = {
        "city_ar": raw_city,
        "type_ar": raw_type,
        "type_source": type_from,
        "status_ar": statuses or None,
        "state_ar": (terms("property_state") or [None])[0],
        "features_ar": terms("property_feature") or None,
        "wp_id": p.get("id"),
        "slug": p.get("slug") or None,
        "price_published": bool(price),
        "language": "ar",
    }

    row: dict[str, Any] = {
        "ad_number": f"{PREFIX}{int(hashlib.md5((p.get('slug') or str(p.get('id'))).encode()).hexdigest()[:12], 16)}",
        "listing_url": link,
        "source": SOURCE,
        "active": not gone,
        "property_type": property_type,
        "transaction_type": "Rent" if is_rent else "Buy",
        "area_m2": area,
        "bedrooms": beds,
        "bathrooms": baths,
        "price_total": None if is_rent else price,
        "price_annual": price_annual,
        "price_per_meter": None,
        "rent_period": rent_period,
        "city": city,
        "region": region,
        "neighborhood": raw_neighborhood,
        # Arabic-native shadow — see the comment above raw_city/city_id/region_id.
        "city_ar": raw_city,
        "district_ar": raw_neighborhood,
        "city_id": city_id,
        "region_id": region_id,
        "rega_location_verified": False,
        "title": title,
        "description": _redact(body),
        "photo_urls": (images or {}).get(p.get("id"), []),
        "additional_info": {k: v for k, v in info.items() if v not in (None, "", [], {})},
    }
    return row, category


def _pin_sold_inactive(table: str, ad_numbers: list[str]) -> None:
    """Keep source-confirmed sold/rented rows inactive through the nightly
    auto_recover_false_inactive() sweep, which re-activates any active=false row with
    coalesce(missing_count,0)=0 — and the shared batch upsert always writes missing_count=0.
    Measured on alta 2026-09-05: 9 rows marked تم البيع came back active=true within the hour."""
    for i in range(0, len(ad_numbers), 200):
        db._execute(
            db.sb().table(table).update({"active": False, "missing_count": 3})
            .in_("ad_number", ad_numbers[i:i + 200]),
            what=table + ".sold_pin",
        )


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--type", choices=["residential", "commercial", "all"], default="all")
    ap.add_argument("--limit", type=int, default=0,
                    help="validation run: upsert only the first N parsed listings, NO prune")
    args = ap.parse_args()

    s = session()
    run_id = None if args.limit else db.begin_run("amaall")
    res: list[dict] = []
    com: list[dict] = []
    sold_res: list[str] = []
    sold_com: list[str] = []
    gone_ct = 0
    try:
        tax = fetch_taxonomies(s)
        posts = fetch_listings(s)
        if not posts:
            raise RuntimeError(f"REST returned no listings — {LAST_FETCH_NOTE}")
        total = len(posts)
        posts = [p for p in posts if is_arabic_post(p)]
        print(f"{SOURCE}: {total} posts -> {len(posts)} ARABIC "
              f"({total - len(posts)} English duplicates dropped)"
              f"{' [LIMIT ' + str(args.limit) + ']' if args.limit else ''}")
        if args.limit:
            posts = posts[: args.limit]
        images = fetch_images(s, posts)

        unmapped: dict[str, int] = {}
        for p in posts:
            row, cat = map_listing(p, tax, images)
            if not row:
                names = tax.get("property_type") or {}
                for tid in (p.get("property_type") or []):
                    nm = names.get(tid)
                    if nm and nm not in TYPE_CATEGORY_TERMS:
                        unmapped[nm] = unmapped.get(nm, 0) + 1
                continue
            if not row["active"]:
                gone_ct += 1
            if args.type != "all" and cat != args.type:
                continue
            (com if cat == "commercial" else res).append(row)
            if not row["active"]:
                (sold_com if cat == "commercial" else sold_res).append(row["ad_number"])

        if res:
            db.upsert_amaall_residential_batch(res)
        if com:
            db.upsert_amaall_commercial_batch(com)
        # Immediately after the upsert (which reset missing_count to 0) — see _pin_sold_inactive.
        if sold_res:
            _pin_sold_inactive("amaall_residential_listings", sold_res)
        if sold_com:
            _pin_sold_inactive("amaall_commercial_listings", sold_com)

        if unmapped:
            print("  skipped (no canonical type, not guessed): "
                  + ", ".join(f"{k}x{v}" for k, v in sorted(unmapped.items(), key=lambda x: -x[1])))

        if args.limit:
            print(f"✓ {SOURCE} VALIDATION: {len(res)} residential + {len(com)} commercial "
                  f"({gone_ct} sold/rented → active=false) (no prune)")
            for r in (res + com)[:8]:
                print(f"   {r['ad_number']} act={str(r['active']):5s} {r['transaction_type']:5s} "
                      f"{str(r['property_type']):17s} {str(r['city']):10s} "
                      f"px={str(r['price_total']):>10} imgs={len(r['photo_urls'])}")
        else:
            n = len(res) + len(com)
            healthy = db.end_run(run_id, ok=True, rows_seen=n, rows_upserted=n,
                                 check_tables=["amaall_residential_listings",
                                               "amaall_commercial_listings"])
            if not healthy:
                print("✗ run demoted to unhealthy by end_run()'s RC-B guard — failing CI "
                      "instead of reporting a silent success.", flush=True)
                return 1
            print(f"✓ {SOURCE}: {len(res)} residential + {len(com)} commercial upserted "
                  f"({gone_ct} sold/rented)")
        return 0
    except Exception as e:
        if run_id:
            db.end_run(run_id, ok=False, rows_seen=0, rows_upserted=0, notes=str(e)[:300])
        print(f"✗ {SOURCE}: {e}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
