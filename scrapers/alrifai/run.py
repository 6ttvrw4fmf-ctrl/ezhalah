"""الرفاعي للعقار — alrifai.com.sa. 21 listings, onboarding 2026-09-24.

SOURCE SHAPE (measured live 2026-09-24):
  · A custom PHP site of a contractor («مؤسسة حاتم محمد الرفاعي للمقاولات») selling units in its
    own Jeddah projects. No WordPress, no API, no JS needed: plain curl_cffi chrome answers 200.
  · CATALOGUE = index.php?page=properties — ONE unpaginated page (no pager markup, no ?p= links),
    the site's own «العروض». 21 distinct detail links: ids 61,66,67,78,81-94,104,109,110. The
    home page shows a strip of the same ids. Filters on the page are TYPE classes (.apprtment/
    .house/.villa) — no deal filter exists.
  · DETAIL = index.php?page=property-detail&id=<n>, server-rendered:
      <h2> title («شقة للبيع 5غرف حي البوادي», «شقق للتمليك 4 غرف حي النعيم», «شقة 3 غرف حي البوادي»)
      div.location «جدة - حي البوادي» → city «جدة» (21/21), district «حي X» (21/21)
      ul.property-info, keyed by ICON class: flaticon-dimension «136 متر مربع», flaticon-bed
        «5 غرف», flaticon-bathtub «3 حمامات», flaticon-sketch «1 مطبخ», flaticon-car «1 موقف خاص»
      div.price «630,000 ريال» under the label «فقط بـ»; blockquote description («شقة امامية غربية
        جنوبية 5 غرف مشروع 118»); ul.list-style-one features («إتحاد ملاك.», «ضمان على الهيكل :
        10 سنوات.» — a WARRANTY, never the age; «فقط بـ 630,000»).
  · DEAL: the site has ZERO rent words anywhere (home, catalogue, every detail page: 0×
    للإيجار/ايجار). Sale is stated per listing by «للبيع/للتمليك/تمليك» in the title on 12/21;
    the other 9 titles («شقة 3 غرف حي البوادي») say neither, and a deal the listing does not
    state is NOT guessed from the site's business or the price magnitude → skip no_deal_stated,
    tallied. (bossbih carries the same rule.)
  · PRICE = div.price exactly («630,000 ريال» → 630000), sale → price_total. A «متر» inside the
    price cell would be a per-metre rate → price_per_meter with a NULL total; none occurs today.
  · DIRECTION: the description names 2-3 facades («غربية جنوبية») → one_direction keeps a single
    stated bearing only, else NULL. LICENCE: no «ترخيص» anywhere → source does not publish.
  · PHOTOS ARE BROKEN AT THE SOURCE: every image is app/thumbnail.php?i=…&t=offers&f=offers_imageN
    which answers HTTP 200 text/html with 4 bytes of whitespace to every transport tried (chrome/
    safari impersonation, warmed session cookie «Alrifai», Referer, image Accept, Sec-Fetch-Dest:
    image) AND in a real Chrome the carousel <img> elements complete with naturalWidth 0 (id 104,
    5/5). A 200 is not an image → photo_urls NULL; the count is kept in additional_info.
  · REMOVAL ORACLE, two measured shapes:
      1. an id the site never held renders the EMPTY SHELL: <h2></h2>, empty location, «متر مربع»
         with no number, no price — HTTP 200, ~25.6 KB (4/4: ids 0, 150, 999, 5000) → GONE.
      2. an id DE-LISTED from the catalogue keeps rendering a FULL page (3/3: 62, 70, 100 — real
         priced units «شقق للبيع مع سطح (روف) 970,000 ريال», no sold marker), so the page alone
         cannot say it is gone. The catalogue is complete (single page) and is the site's own
         notion of what is on offer, so absence from it is the death signal for a full page —
         gated by an in-run positive control: the catalogue must parse ≥1 card AND still list at
         least one id this run saw, else UNKNOWN (fails closed). Live controls 21/21: full page
         and present in the catalogue.
"""
from __future__ import annotations

import argparse
import html as _html
import re
import sys
import time
from pathlib import Path
from typing import Any, Optional

from curl_cffi import requests as cc

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from scrapers.common import db, normalize  # noqa: E402
from scrapers.common.arabic_location import find_district_in_text, to_catalog  # noqa: E402
from scrapers.common.http_liveness import BLOCKED_OR_THROTTLED  # noqa: E402
from scrapers.common.pii import redact_pii  # noqa: E402

BASE = "https://alrifai.com.sa"
SOURCE = "الرفاعي للعقار"
PREFIX = "RFI"
CATALOGUE = f"{BASE}/index.php?page=properties"

TYPE_OVERRIDES = {"شقق": "Apartment", "شقة": "Apartment", "فلل": "Villa", "أدوار": "Floor"}
# Deal words are WHOLE words: the bare «بيع» must never fire inside «الربيع» (a district) or
# «المبيعات» (a sales office) — that would file an unstated deal as a sale.
_RENT_RE = re.compile(r"للإيجار|للايجار|(?<![ء-ي])(?:ال)?[إا]يجار(?![ء-ي])")
_SALE_RE = re.compile(r"للبيع|للتمليك|(?<![ء-ي])(?:ال)?(?:تمليك|بيع)(?![ء-ي])")
_CLOSED_RE = re.compile(r"تم\s*البيع|تم\s*الإيجار|تم\s*الايجار|مباع|محجوز")
_AUCTION_RE = re.compile(r"مزاد")
_OFFPLAN_RE = re.compile(r"(?<![ء-ي])قريبا|(?<![ء-ي])قريباً|على الخارطة|تحت الإنشاء|تحت الانشاء")  # not «تقريبا»
_ID_RE = re.compile(r'href="index\.php\?page=property-detail&(?:amp;)?id=(\d+)"')
_ICON_LI_RE = re.compile(r'<li><i class="flaticon-([a-z]+)"></i>\s*(.*?)</li>', re.S)
_AR_PHONE_RE = re.compile(r"[٠]?٥[٠-٩]{8}")


def session() -> cc.Session:
    # impersonate OWNS the User-Agent — never set one. Only Accept-* are ours.
    s = cc.Session(impersonate="chrome")
    s.headers.update({"Accept-Language": "ar,en;q=0.7"})
    return s


def _strip(h: Optional[str]) -> str:
    return re.sub(r"\s+", " ", _html.unescape(re.sub(r"<[^>]+>", " ", h or ""))).strip()


def _redact(text: Optional[str]) -> Optional[str]:
    out = redact_pii(text)
    return _AR_PHONE_RE.sub("[redacted]", out) if isinstance(out, str) else out


def catalogue_ids(page_html: str) -> list[str]:
    """The catalogue's detail-link ids, in page order, de-duplicated (each card links twice)."""
    return list(dict.fromkeys(_ID_RE.findall(page_html)))


def parse_detail(page_html: str) -> dict[str, Any]:
    """The listing's own fields from its page. `title` is '' on the empty shell (never-held id)."""
    i = page_html.find('class="about-property')
    box = page_html[i:i + 6000] if i >= 0 else ""
    m = re.search(r"<h2>(.*?)</h2>", box, re.S)
    loc = re.search(r'class="location">(.*?)</div>', box, re.S)
    price = re.search(r'class="price">(.*?)</div>', page_html, re.S)
    desc = re.search(r"<blockquote>(.*?)</blockquote>", page_html, re.S)
    feats = re.search(r'class="list-style-one">(.*?)</ul>', page_html, re.S)
    return {
        "title": _strip(m.group(1)) if m else "",
        "location": _strip(loc.group(1)) if loc else "",
        "info": {icon: _strip(txt) for icon, txt in _ICON_LI_RE.findall(box)},
        "price_text": _strip(price.group(1)) if price else "",
        "description": _strip(desc.group(1)) if desc else "",
        "features": [_strip(x) for x in re.findall(r"<li>(.*?)</li>", feats.group(1), re.S)] if feats else [],
        "photo_count": len(set(re.findall(r'thumbnail\.php\?i=[^"&]+', page_html))),
    }


def _flag(text: Optional[str]) -> Optional[bool]:
    """«1 مطبخ» → True, «0 موقف» → False, no cell → None (absent, never False)."""
    n = normalize.to_int(text) if text else None
    return None if n is None else n > 0


def map_listing(pid: str, d: dict[str, Any]) -> tuple[Optional[dict], str, str]:
    if not d.get("title"):
        return None, "residential", "empty_shell"
    title, desc, feats = d["title"], d.get("description") or "", d.get("features") or []
    words = " ".join([title, desc, *feats])
    if _AUCTION_RE.search(words):
        return None, "residential", "auction"
    if _CLOSED_RE.search(words):
        return None, "residential", "sold_or_rented"
    if _OFFPLAN_RE.search(words):
        return None, "residential", "off_plan"

    head = title.split()[0] if title.split() else ""
    property_type = normalize.map_type_exact(head, TYPE_OVERRIDES)
    if not property_type:
        return None, "residential", "type_unmapped"
    category = normalize.category_for_type(property_type).lower()

    # Deal from the listing's OWN words only; neither / both → not stated → skip, never guessed.
    rent, sale = bool(_RENT_RE.search(words)), bool(_SALE_RE.search(words))
    if rent == sale:
        return None, category, "no_deal_stated" if not rent else "deal_ambiguous"
    deal = "Rent" if rent else "Buy"

    city_raw, _, district_raw = (d.get("location") or "").partition("-")
    city_raw, district_raw = city_raw.strip(), district_raw.strip() or None
    if not city_raw:
        return None, category, "city_not_stated"
    city_id, region_id = to_catalog(city_raw)
    if not city_id:
        return None, category, "city_not_in_catalog"

    info = d.get("info") or {}
    price = normalize.to_int(d.get("price_text"))
    per_metre = bool(re.search(r"متر|/\s*م", d.get("price_text") or ""))
    row: dict[str, Any] = {
        "ad_number": f"{PREFIX}{pid}",
        "listing_url": f"{BASE}/index.php?page=property-detail&id={pid}",
        "source": SOURCE,
        "active": True,
        "title": title,
        "description": _redact(" ".join(filter(None, [desc, *feats]))),
        "property_type": property_type,
        "transaction_type": "Rent" if deal == "Rent" else "Buy",
        "city": normalize.map_city(city_raw),
        "city_ar": city_raw,
        "city_id": city_id,
        "region_id": region_id,
        "district_ar": find_district_in_text(district_raw, city_id) if district_raw else None,
        "neighborhood": district_raw,
        "area_m2": normalize.to_int(info.get("dimension")),
        "bedrooms": normalize.to_int(info.get("bed")),
        "bathrooms": normalize.to_int(info.get("bathtub")),
        "property_age": normalize.age_from_labelled_prose(words),
        "direction": normalize.one_direction(desc) if desc else None,
        "license_number": normalize.ad_licence_from_prose(words),
        "photo_urls": None,
    }
    for col, val in (("kitchen", _flag(info.get("sketch"))), ("parking", _flag(info.get("car")))):
        if val is not None:
            row[col] = val
    if deal == "Rent":
        row["rent_period"], row["price_annual"] = (None, None) if per_metre else \
            normalize.rent_period_and_annual(price, words)
    else:
        row["price_total"] = None if per_metre else price
    row["price_per_meter"] = price if per_metre else None
    row["additional_info"] = {k: v for k, v in {
        "type_ar": head, "price_raw": d.get("price_text") or None, "features_ar": feats or None,
        "kitchens_raw": info.get("sketch"), "parking_raw": info.get("car"),
        "project": (re.search(r"مشروع\s*([\d٠-٩]+)", words) or [None, None])[1],
        "photo_count_at_source_unrenderable": d.get("photo_count") or None,
    }.items() if v is not None}
    return row, category, ""


# ── fetch ─────────────────────────────────────────────────────────────────────────────────────────
def fetch(s: cc.Session, url: str) -> tuple[Optional[int], str]:
    try:
        r = s.get(url, timeout=45)
        return r.status_code, r.text or ""
    except Exception:  # noqa: BLE001
        return None, ""


def detail_url(pid: str) -> str:
    return f"{BASE}/index.php?page=property-detail&id={pid}"


# ── LIVENESS ─────────────────────────────────────────────────────────────────────────────────────
_SEEN_THIS_RUN: set[str] = set()
_CATALOGUE_CACHE: dict[str, Any] = {}


def _catalogue_ids_cached(s: cc.Session) -> Optional[set[str]]:
    """The catalogue's ids, fetched once per prune; None when it cannot bear a verdict (unreadable,
    no cards, or none of THIS run's ids in it — the positive control that fails closed)."""
    if "ids" not in _CATALOGUE_CACHE:
        status, body = fetch(s, CATALOGUE)
        ids = set(catalogue_ids(body)) if status == 200 else set()
        _CATALOGUE_CACHE["ids"] = ids if ids and (ids & _SEEN_THIS_RUN) else None
    return _CATALOGUE_CACHE["ids"]


def verify_gone(ad_number: str, s: Optional[cc.Session] = None) -> tuple[str, str]:
    """The measured oracle under the liveness law: blocked/5xx/no answer → unknown; the empty
    shell → gone; a full page → gone only when the complete catalogue (positive-controlled) no
    longer lists it, live when it does."""
    pid = ad_number[len(PREFIX):]
    if not pid.isdigit():
        return "unknown", f"{ad_number!r} is not a {PREFIX}<id> ad number"
    s = s or session()
    status, body = fetch(s, detail_url(pid))
    if status is None:
        return "unknown", "no answer from the source"
    if status in BLOCKED_OR_THROTTLED or status >= 500 or not body:
        return "unknown", f"HTTP {status} is about our access or the source, not the listing"
    if status != 200:
        return "unknown", f"HTTP {status}, no opinion"
    if not parse_detail(body)["title"]:
        return "gone", "source renders the empty shell for this id (HTTP 200, no title/price)"
    ids = _catalogue_ids_cached(s)
    if ids is None:
        return "unknown", "catalogue unreadable or failed its positive control — held"
    if pid in ids:
        return "live", "page renders and the catalogue still lists it"
    return "gone", "page still renders but the site's complete catalogue no longer lists it"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--type", choices=["residential", "commercial", "all"], default="all")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    s = session()
    dry = args.dry_run or bool(args.limit)
    run_id = None if dry else db.begin_run("alrifai")
    res: list[dict] = []
    com: list[dict] = []
    skipped: dict[str, int] = {}
    ids: list[str] = []
    try:
        status, body = fetch(s, CATALOGUE)
        ids = catalogue_ids(body) if status == 200 else []
        if not ids:
            raise RuntimeError(f"catalogue answered HTTP {status} with no detail links")
        if args.limit:
            ids = ids[:args.limit]
        print(f"{SOURCE}: {len(ids)} listings discovered", flush=True)
        fetched = 0
        for pid in ids:
            st, page = fetch(s, detail_url(pid))
            time.sleep(0.6)
            if st != 200 or not page:
                skipped["fetch_failed"] = skipped.get("fetch_failed", 0) + 1
                continue
            fetched += 1
            row, cat, why = map_listing(pid, parse_detail(page))
            if not row:
                skipped[why] = skipped.get(why, 0) + 1
                continue
            if args.type != "all" and cat != args.type:
                continue
            (com if cat == "commercial" else res).append(row)
        complete = not args.limit and fetched == len(ids)
        if skipped:
            print("  skipped (not guessed): "
                  + ", ".join(f"{k}x{v}" for k, v in sorted(skipped.items(), key=lambda x: -x[1])))
        if dry:
            print(f"✓ {SOURCE} VALIDATION: {len(res)} residential + {len(com)} commercial (nothing written)")
            for r0 in (res + com)[:25]:
                print(f"   {r0['ad_number']:>7} {r0['transaction_type']:4} {str(r0['property_type']):10} "
                      f"{str(r0['city_ar']):5} d={str(r0['district_ar'])[:12]:12} a={str(r0['area_m2']):>4} "
                      f"bd={str(r0['bedrooms']):>2} ba={str(r0['bathrooms']):>2} k={str(r0.get('kitchen'))[:1]} "
                      f"p={str(r0.get('parking'))[:1]} dir={str(r0['direction']):5} "
                      f"pt={r0.get('price_total')} ppm={r0.get('price_per_meter')} | {r0['title'][:34]}")
            return 0
        # The public upsert_alrifai_*_batch wrappers are added centrally later; same funnel.
        db._wasalt_batch("alrifai_residential_listings", res)
        db._wasalt_batch("alrifai_commercial_listings", com)
        superseded = db.retire_superseded_siblings(
            res_table="alrifai_residential_listings", com_table="alrifai_commercial_listings",
            res_ads={r["ad_number"] for r in res}, com_ads={r["ad_number"] for r in com}, source=SOURCE)
        if superseded:
            print(f"  retired {superseded} superseded sibling row(s) after a category flip")
        pruned = 0
        if args.type == "all" and complete:
            _SEEN_THIS_RUN.update(ids)
            _CATALOGUE_CACHE.clear()
            for tbl, rows in (("alrifai_residential_listings", res), ("alrifai_commercial_listings", com)):
                n = db.prune_unseen(tbl, {r["ad_number"] for r in rows}, source=SOURCE, verify_gone=verify_gone)
                if n < 0:
                    print(f"  ⚠ {tbl}: prune guard tripped — kept existing active rows")
                else:
                    pruned += n
        elif args.type == "all":
            print(f"  ⚠ enumeration incomplete ({fetched} of {len(ids)} pages read) — no prune")
        notes = ", ".join(f"{k}x{v}" for k, v in sorted(skipped.items(), key=lambda x: -x[1]))
        healthy = db.end_run(run_id, ok=True, rows_seen=len(ids), rows_upserted=len(res) + len(com),
                             notes=f"pruned={pruned}; complete={complete}; {notes}"[:300],
                             check_tables=["alrifai_residential_listings", "alrifai_commercial_listings"])
        if not healthy:
            print("✗ run demoted to unhealthy by end_run()'s RC-B guard", flush=True)
            return 1
        print(f"✓ {SOURCE}: {len(res)} residential + {len(com)} commercial upserted")
        return 0
    except Exception as e:
        if run_id:
            notes = f"{e}"[:200] + " | skips: " + ",".join(f"{k}x{v}" for k, v in skipped.items())
            db.end_run(run_id, ok=False, rows_seen=len(ids), rows_upserted=0, notes=notes[:300])
        print(f"✗ {SOURCE}: {e}", flush=True)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
