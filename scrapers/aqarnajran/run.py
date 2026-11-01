"""عقار نجران — aqarnajran.com. 41 listings, onboarding 2026-09-19.

SOURCE SHAPE (probed live before any code):
  · WordPress with the REST API open: /wp-json/wp/v2/posts returns the whole catalogue
    (x-wp-total: 41) with the rendered body. No HTML scraping and no sitemap walk needed, so the
    page's navigation chrome — a sidebar listing «فلل للبيع / استراحات للبيع / أراضي للإيجار …»
    for the whole site — never enters the parse at all. That chrome is the trap on this source:
    it names a dozen property types on EVERY page, so a type regex over the rendered page would
    read the menu, not the listing.
  · Each post body is a two-column table rendered as a flat run of labelled pairs:
        البند التفاصيل
        العنوان  أرض للبيع في حي مخطط الاثايبة نجران مساحة 700 متر
        نوع العقار  أرض سكنية
        المساحة  700 متر مربع
        السعر  900,000 ريال            ← or «4,500 ريال شهريًا» for a rental
        الموقع  حي مخطط الاثايبة – نجران
        تفاصيل إضافية  …
  · The whole catalogue is نجران, and «الموقع» states «حي X – نجران»: district then city.
  · Rent posts carry the period IN the price cell («شهريًا»), which normalize.rent_period_and_annual
    reads from the same text — never defaulted.
"""
from __future__ import annotations

import argparse
import html as ihtml
import re
import sys
from pathlib import Path
from typing import Any, Optional

from curl_cffi import requests as cc

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from scrapers.common import db, normalize  # noqa: E402
from scrapers.common.arabic_location import find_district_in_text, to_catalog  # noqa: E402
from scrapers.common.http import retry_smarter_session  # noqa: E402
from scrapers.common.http_liveness import LivenessProbe, stored_listing_url  # noqa: E402

BASE = "https://aqarnajran.com"
SOURCE = "Aqar Najran"
PREFIX = "ANJ"
_AR_DIGITS = str.maketrans("٠١٢٣٤٥٦٧٨٩", "0123456789")


def session() -> cc.Session:
    s = cc.Session(impersonate="chrome124")
    s.headers.update({"Accept": "application/json", "Accept-Language": "ar,en;q=0.7"})
    return s


def walk_session() -> cc.Session:
    # 2026-10-05 (Scraping Engineer): one pinned profile, no retry — a single refused handshake or
    # stalled connect failed the whole night (10-05 04:23 «wp-json returned no posts», ok 10-04 with
    # 39 rows). Probe 3 profiles DIRECT, then the residential proxy (`proxy: true` → WASALT_PROXY_URL,
    # spent only when DIRECT is refused), and keep the session that is served. The attempt log is the
    # step-6 evidence if the site is truly down.
    s, tried = retry_smarter_session(f"{BASE}/wp-json/wp/v2/posts?per_page=1&_fields=id", headers=dict(session().headers))
    print(f"{SOURCE}: probe {' '.join(tried)}", flush=True)
    return s


def body_text(rendered_html: str) -> str:
    b = re.sub(r"<(script|style)\b[^>]*>.*?</\1>", " ", rendered_html, flags=re.S | re.I)
    return re.sub(r"\s+", " ", ihtml.unescape(re.sub(r"<[^>]+>", " ", b))).strip()


# The table's own field names — a value ends where the next one begins. Closed set: the body is a
# fixed two-column table, so an open-ended "until punctuation" read would swallow the next row.
_FIELDS = ("البند", "التفاصيل", "العنوان", "نوع العقار", "المساحة", "السعر", "الموقع",
           "تفاصيل إضافية", "للتواصل", "الغرف", "دورات المياه")


def field(text: str, name: str) -> Optional[str]:
    stop = "|".join(re.escape(f) for f in _FIELDS)
    m = re.search(re.escape(name) + r"\s*:?\s*(.{1,120}?)(?=\s*(?:" + stop + r")\b|\s*$)", text)
    if not m:
        return None
    v = re.sub(r"\s+", " ", m.group(1)).strip(" .،-:")
    return v or None


_TYPE_AR = {
    "أرض سكنية": "أرض", "ارض سكنية": "أرض", "أرض تجارية": "أرض تجارية",
    "ارض تجارية": "أرض تجارية", "أرض زراعية": "أرض زراعية", "أرض": "أرض", "ارض": "أرض",
    "فيلا": "فيلا", "فلة": "فيلا", "فلل": "فيلا", "بيت": "بيت", "بيوت": "بيت",
    "دور": "دور", "أدوار": "دور", "شقة": "شقة", "شقه": "شقة", "شقق": "شقة",
    "عمارة": "عمارة", "عماره": "عمارة", "استراحة": "استراحة", "استراحه": "استراحة",
    "شاليه": "شاليه", "شاليهات": "شاليه", "مزرعة": "مزرعة", "مزارع": "مزرعة",
    "مخيم": "مخيم", "مخيمات": "مخيم", "غرفة": "غرفة", "غرفه": "غرفة", "غرف": "غرفة",
    "محل": "محل", "محلات": "محل", "معرض": "معرض", "مكتب": "مكتب",
    "مستودع": "مستودع", "مستودعات": "مستودع", "مخزن": "مستودع",
    "استراحات": "استراحة", "عمائر": "عمارة",
}
_TYPE_TOKENS = sorted(_TYPE_AR, key=len, reverse=True)


def parse_type_ar(text: str) -> Optional[str]:
    """From «نوع العقار» ONLY — never the page, never the title.

    The site's navigation names a dozen types on every page («فلل للبيع، استراحات للبيع، أراضي
    للإيجار…»); a scan over anything wider than this one cell reads the menu. The cell may append
    the deal word («دور للإيجار»), so the type is the leading token of the cell.
    """
    cell = field(text, "نوع العقار")
    if cell:
        for tok in _TYPE_TOKENS:
            if cell.startswith(tok):
                return _TYPE_AR[tok]
        # «أخرى» — the SOURCE itself says it does not know. Honest unknown, never bucketed.
        return None
    return None


def type_from_title(title: str) -> Optional[str]:
    """Fallback when the «نوع العقار» cell is absent: the post's OWN title states it
    («أرض للبيع في حي مخطط ابن جارالله نجران»). Safe here precisely because it reads the post
    title and not the page — the site's navigation names a dozen types on every page, which is
    why nothing wider than these two source-stated strings is ever scanned."""
    for tok in _TYPE_TOKENS:
        if re.match(r"\s*" + re.escape(tok) + r"(?![\u0621-\u064A])", title or ""):
            return _TYPE_AR[tok]
    return None


def parse_deal(text: str, title: str) -> Optional[str]:
    for src in (field(text, "نوع العقار") or "", title):
        if re.search(r"للإيجار|للايجار", src):
            return "Rent"
        if re.search(r"للبيع", src):
            return "Buy"
    return None


_MONEY_RE = re.compile(r"([\d٠-٩][\d٠-٩,\.]*)\s*(?:ريال|ر\.س|SAR)")
_AREA_RE = re.compile(r"([\d٠-٩][\d٠-٩,\.]*)\s*(?:متر|م²|م2)")


def _num(m: Optional[re.Match]) -> Optional[int]:
    if not m:
        return None
    try:
        n = int(float(m.group(1).translate(_AR_DIGITS).replace(",", "")))
        return n if n > 0 else None
    except ValueError:
        return None


def map_listing(post: dict) -> tuple[Optional[dict], str, str]:
    title = re.sub(r"\s+", " ", ihtml.unescape(
        re.sub(r"<[^>]+>", " ", post.get("title", {}).get("rendered", "")))).strip()
    text = body_text(post.get("content", {}).get("rendered", ""))
    if not text or not title:
        return None, "residential", "empty_body"

    type_ar = parse_type_ar(text) or type_from_title(title)
    if not type_ar:
        return None, "residential", "type_unmapped"
    property_type = normalize.map_type_exact(type_ar)
    if not property_type:
        return None, "residential", "type_unmapped"
    category = normalize.category_for_type(property_type).lower()

    deal = parse_deal(text, title)
    if not deal:
        return None, category, "no_deal"

    loc = field(text, "الموقع") or ""
    city_ar = district_raw = None
    parts = [p.strip(" .،") for p in re.split(r"\s*[–—-]\s*", loc) if p.strip(" .،")]
    if parts and to_catalog(parts[-1])[0]:
        city_ar = parts[-1]
        district_raw = " ".join(parts[:-1]).strip() or None
    if not city_ar:
        # «الموقع» sometimes carries only the district («حي مخطط ابن جارالله») or is absent, while
        # the post's own TITLE names the city. Take the first catalog-placeable token from the
        # title — still the source's own word, never an assumption that "this site is all نجران".
        for tok in re.split(r"[\s،.,–—-]+", title):
            if len(tok) >= 3 and to_catalog(tok)[0]:
                city_ar = tok
                district_raw = district_raw or (loc.strip() or None)
                break
    if not city_ar:
        return None, category, "no_city"
    city_id, region_id = to_catalog(city_ar)
    district_ar = find_district_in_text(district_raw, city_id) if (district_raw and city_id) else None

    price_cell = field(text, "السعر") or ""
    price = _num(_MONEY_RE.search(price_cell))
    area = _num(_AREA_RE.search(field(text, "المساحة") or ""))

    row: dict[str, Any] = {
        "ad_number": f"{PREFIX}{post['id']}",
        "listing_url": post.get("link"),
        "source": SOURCE,
        "active": True,
        "title": title,
        "property_type": property_type,
        # Written as a total expression, not the bare `deal`: a transaction_type that is
        # not provably Buy/Rent can reach the index as NULL, and a null deal is
        # quarantined out of search entirely (the 2026-07-16 null-deal recovery).
        "transaction_type": "Rent" if deal == "Rent" else "Buy",
        "city": normalize.map_city(city_ar),
        "city_ar": city_ar,
        "city_id": city_id,
        "region_id": region_id,
        "district_ar": district_ar,
        "neighborhood": district_raw,
        "area_m2": area,
        "photo_urls": photos(post),
    }

    # The «تفاصيل إضافية» cell is this template's only structured-ish field: «3 غرف وصالة ومطبخ مع
    # تشطيب راقٍ، موقع هادئ وقريب من المدارس». It was read and filed in additional_info, where the
    # Advanced Filter cannot see it, so all 39 rows carried bedrooms=NULL. The leading «N غرف …
    # وصالة» is the Saudi layout idiom and is read as the bedroom count; prose that merely mentions
    # rooms matches nothing and stays NULL. Amenities the cell NAMES are written; the rest stay NULL.
    extra = field(text, "تفاصيل إضافية")
    if extra:
        for k, v in normalize.rooms_from_phrase(extra).items():
            row.setdefault(k, v)
        for col, val in normalize.amenities_from_text(extra).items():
            row.setdefault(col, val)
    # Some listings use explicit table rows instead of the packed cell.
    for label, col in (("الغرف", "bedrooms"), ("دورات المياه", "bathrooms")):
        v = normalize.to_int(field(text, label) or "")
        if v is not None:
            row[col] = v
    if deal == "Rent":
        # The period is stated IN the price cell («4,500 ريال شهريًا»); read from that cell so a
        # «سنوي» elsewhere in the description cannot set the period for a monthly rent.
        rent_period, price_annual = normalize.rent_period_and_annual(price, price_cell)
        row["price_annual"] = price_annual
        if rent_period:
            row["rent_period"] = rent_period
    else:
        row["price_total"] = price
    row["additional_info"] = {k: v for k, v in {
        "type_ar": type_ar,
        "extra_details": field(text, "تفاصيل إضافية"),
        "price_cell": price_cell or None,
    }.items() if v is not None}
    return row, category, ""


_IMG_RE = re.compile(r'<img[^>]+src="([^"]+)"')


# THE PHOTO LIVES IN THE FEATURED IMAGE (measured 2026-10-07). All 39 active rows carried no photo
# while every re-read page (source-reread 37577198963, 4/4) shows one: og:image and three JSON-LD
# image entries. The posts keep their photo as the WordPress featured image (`featured_media`),
# which the body-only read never asked for. It is now fetched per post from /wp/v2/media/<id>
# (41 posts, so 41 small reads) and put first; body images still follow. A media read that fails is
# simply absent — never a guess, never the site logo.
def _usable_photo(u: Optional[str]) -> bool:
    return bool(u) and "/wp-content/uploads/" in u and "logo" not in u.lower()


def photos(post: dict) -> Optional[list[str]]:
    body = [u for u in _IMG_RE.findall(post.get("content", {}).get("rendered", ""))
            if _usable_photo(u) and not re.search(r"-\d{2,3}x\d{2,3}\.(?:png|jpe?g|webp)$", u)]
    featured = post.get("_featured_photo")
    urls = list(dict.fromkeys(([featured] if _usable_photo(featured) else []) + body))
    return urls[:20] or None


def attach_featured_photos(s: cc.Session, posts: list[dict]) -> int:
    """Set post['_featured_photo'] from each post's featured_media; returns how many were read."""
    got = 0
    for post in posts:
        mid = post.get("featured_media")
        if not isinstance(mid, int) or mid <= 0:
            continue
        try:
            r = s.get(f"{BASE}/wp-json/wp/v2/media/{mid}", params={"_fields": "source_url"}, timeout=40)
            url = (r.json() or {}).get("source_url") if r.status_code == 200 else None
        except Exception:  # noqa: BLE001 — a failed media read leaves the post without that photo
            url = None
        if _usable_photo(url):
            post["_featured_photo"] = url
            got += 1
    return got


# Why a REST walk may not be the whole catalogue. Non-empty → no prune this run.
INCOMPLETE: list[str] = []

# ── REMOVAL (measured 2026-10-02). Until then this crawler had NO removal step at all: a deleted
# post stayed active here for good.
#
# There is no dead cohort to measure on: all 39 active rows were re-seen that day, and the site's 41
# posts were last modified 2026-02-03. What the post's OWN url answers: 14 of 14 random catalogue
# posts → 200 rendering the «البند / التفاصيل» table; a slug that never existed, a real slug with a
# mangled tail and a wrong ?p= id → 404 (3 of 3) on a page without that table. No sold/rented
# wording is on any of the 41 records. So a hard 404/410 is GONE, a 200 with the table is LIVE, and
# everything else — a 200 without the table, every block — is UNKNOWN.
_TABLE_HEAD_RE = re.compile(r"البند\s+التفاصيل")
RES_TABLE, COM_TABLE = "aqarnajran_residential_listings", "aqarnajran_commercial_listings"


def _signal(status, body, moved) -> Optional[str]:
    """'live' | 'gone' | None — only what this post's own URL affirmatively answers."""
    if status in (404, 410):
        return "gone"
    if status != 200 or moved:
        return None
    return "live" if _TABLE_HEAD_RE.search(body_text(body)) else None


def _make_verify_gone(control: Optional[dict]):
    """The removal oracle for db.prune_unseen. A 404 is believed only while a known-live ad from
    this run (`control`) still reads live through the same session."""
    url_for = stored_listing_url((RES_TABLE, COM_TABLE))
    s = session()

    def probe(ad_number: str, canary=None):
        return LivenessProbe(platform="aqarnajran", signal=_signal, session=lambda: s,
                             url_for=url_for, canary=canary).verify_gone(ad_number)

    def canary() -> tuple[bool, str]:
        if not control:
            return False, "no row from this run to use as a positive control"
        verdict, why = probe(control["ad_number"])
        return verdict == "live", f"positive control {control['ad_number']}: {why}"

    return lambda ad_number: probe(ad_number, canary=canary)


def fetch_posts(s: cc.Session, limit: int = 0) -> list[dict]:
    INCOMPLETE.clear()
    out: list[dict] = []
    page = 1
    total = None        # the source's own count of its catalogue (x-wp-total: 41 on 2026-10-02)
    while True:
        r = s.get(f"{BASE}/wp-json/wp/v2/posts",
                  params={"per_page": 50, "page": page,
                          "_fields": "id,link,title,content,date_gmt,modified_gmt,featured_media"}, timeout=40)
        if r.status_code != 200:
            if page == 1:
                # Page 1 refused is a fact about our access, never "the site has no posts": say what
                # the source answered (it used to break silently into «wp-json returned no posts»).
                raise RuntimeError(f"wp-json posts page 1 → HTTP {r.status_code}")
            break
        total = r.headers.get("x-wp-total")
        batch = r.json()
        if not batch:
            break
        out.extend(batch)
        if limit and len(out) >= limit:
            return out[:limit]
        if len(batch) < 50:
            break
        page += 1
    if str(len(out)) != str(total):     # a missing header is "cannot tell", never "complete"
        INCOMPLETE.append(f"read {len(out)} posts, x-wp-total says {total}")
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--type", choices=["residential", "commercial", "all"], default="all")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    s = walk_session()
    dry = args.dry_run or bool(args.limit)
    run_id = None if dry else db.begin_run("aqarnajran")
    res: list[dict] = []
    com: list[dict] = []
    try:
        posts = fetch_posts(s, limit=args.limit)
        if not posts:
            raise RuntimeError("wp-json returned no posts")
        print(f"{SOURCE}: {len(posts)} posts discovered", flush=True)
        print(f"  featured photos read: {attach_featured_photos(s, posts)}", flush=True)
        skipped: dict[str, int] = {}
        for p in posts:
            row, cat, why = map_listing(p)
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
            for r0 in (res + com)[:12]:
                print(f"   {r0['ad_number']:>10} {r0['transaction_type']:4} {str(r0['property_type']):16} "
                      f"{str(r0['city_ar']):8} d={str(r0['district_ar'])[:14]:14} "
                      f"a={str(r0['area_m2']):>6} "
                      f"px={r0.get('price_total')} "
                      f"pa={r0.get('price_annual')}")
            return 0
        if res:
            db.upsert_aqarnajran_residential_batch(res)
        if com:
            db.upsert_aqarnajran_commercial_batch(com)
        superseded = db.retire_superseded_siblings(
            res_table="aqarnajran_residential_listings",
            com_table="aqarnajran_commercial_listings",
            res_ads={r["ad_number"] for r in res}, com_ads={r["ad_number"] for r in com},
            source=SOURCE)
        if superseded:
            print(f"  retired {superseded} superseded sibling row(s) after a category flip")

        # REMOVAL. An ad missing from this run is only a CANDIDATE: at three misses its own URL is
        # re-read, and it is hidden only on a 404 (_signal). An ad that still renders heals the row
        # — including one the crawler skips on purpose, which is not gone. No prune on a partial
        # walk or a single-vertical run (--limit never gets here: it is a dry run).
        pruned = 0
        if INCOMPLETE:
            print(f"  ⚠ REST walk incomplete — no prune: {'; '.join(INCOMPLETE)}")
        elif args.type == "all":
            verify_gone = _make_verify_gone((res + com)[0] if (res or com) else None)
            for tbl, rows in ((RES_TABLE, res), (COM_TABLE, com)):
                k = db.prune_unseen(tbl, {r["ad_number"] for r in rows}, source=SOURCE,
                                    verify_gone=verify_gone)
                if k < 0:
                    print(f"  ⚠ {tbl}: prune guard tripped — kept existing active rows")
                else:
                    pruned += k
        skip_notes = ", ".join(f"{k}x{v}" for k, v in sorted(skipped.items(), key=lambda x: -x[1]))
        healthy = db.end_run(run_id, ok=True, rows_seen=len(posts), rows_upserted=len(res) + len(com),
                             notes=f"pruned={pruned} skipped: {skip_notes or 'none'}"[:300],
                             check_tables=["aqarnajran_residential_listings",
                                           "aqarnajran_commercial_listings"])
        if not healthy:
            print("✗ run demoted to unhealthy by end_run()'s RC-B guard", flush=True)
            return 1
        print(f"✓ {SOURCE}: {len(res)} residential + {len(com)} commercial upserted")
        return 0
    except Exception as e:
        if run_id:
            db.end_run(run_id, ok=False, rows_seen=0, rows_upserted=0, notes=str(e)[:300])
        print(f"✗ {SOURCE}: {e}", flush=True)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
