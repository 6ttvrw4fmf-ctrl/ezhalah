"""عقار الرياض — aqaralriyadh.com. A small Riyadh brokerage blog on WordPress. Onboarding 2026-09-24.

SOURCE SHAPE (measured live 2026-09-24, before any code)
========================================================
· The ads are ordinary WordPress POSTS. `GET /wp-json/wp/v2/posts?per_page=100` answers with
  `x-wp-total: 14` / `x-wp-totalpages: 1` and 14 published posts; `wp/v2/types` exposes only the
  stock types (no listing CPT). Every title reads «شقة للإيجار في حي X – الرياض».
· Each post body is ONE labelled paragraph followed by prose:
      <strong>المدينة:</strong> الرياض<br><strong>الحي:</strong> حي الجنادرية<br>
      <strong>السعر:</strong> 52,000 ريال سنويًا<br><strong>المساحة:</strong> 134 م²<br>
      <strong>عدد الغرف:</strong> 3 غرف<br><strong>الصالات:</strong> صالة<br>
      <strong>دورات المياه:</strong> 3   (+ optionally المطبخ / الدور / المصعد / موقف سيارة)
  Measured over the 14 posts: المدينة 14, الحي 14, السعر 14 (all «… ريال سنويًا»), المساحة 14,
  عدد الغرف 14 («3 غرف», «غرفتان» — the dual is written as a WORD), الصالات 14 («صالة», «صالتان»,
  «صالة كبيرة», «صالة واحدة»), دورات المياه 14, المطبخ 5 («مجهز», «راكب», «مجهز بالكامل»),
  الدور 4 («الأول», «الثاني», «الثالث»), المصعد 2 («متوفر»), موقف سيارة 2 («خاص»).
· TYPE + DEAL come from the post's CATEGORY, a closed taxonomy of «<plural type> للإيجار/للبيع»
  (34 terms: شقق/فلل/أدوار/أراضي/استراحات/… × للإيجار/للبيع, plus «شقق مفروشة», «عقارات
  استثمارية …», «مجمعات …»). Every post carries [1 «الكل», 175 «شقق للإيجار»]. «الكل» is ignored;
  a post with no other category, or two, is skipped rather than guessed.
· PERIOD: the source's own «سنويًا» beside every price → rent_period_and_annual reads «سنوي»
  inside it. A price without a period word would stay NULL-period (never defaulted).
· PHOTOS: none. featured_media is 0 on 14/14, the bodies carry no <img>, the page has no og:image.
  Source-does-not-publish.
· LICENCE / PII: no «رقم ترخيص», no phone, no e-mail in any of the 14 bodies (scanned). EVERY value
  of the labelled block is passed through pii.redact_pii inside labelled_fields() (a «للتواصل:» cell
  the brokerage adds to its template would otherwise land verbatim in additional_info), and the
  prose through the same function before it is stored.
· AREA: «134 م²» on 14/14 today. The cell is read as its FIRST number only — to_int would fold the
  ASCII unit digit of a «134 م2» spelling into the figure (1342).
· listing_url = the post's own `link` (checked: HTTP 200 and the page carries the post title).

REMOVAL ORACLE (measured 2026-09-24)
  `GET /wp-json/wp/v2/posts/<id>`: 15 ids that are not posts (1, 100, 311, 313, 317, 318, 319, 323,
  324, 325, 329, 330, 331, 335, 400) → HTTP 404 {"code":"rest_post_invalid_id"} — 15/15; the 3 live
  controls (332, 333, 334) → HTTP 200 with "status":"publish" — 3/3. The page side agrees:
  /?p=311 → 404, /?p=332 → 200 (redirects to the pretty link). A 401/403 (a post moved to draft or
  trash answers rest_forbidden to anonymous readers) is UNKNOWN under the shared law, never a kill.
  prune_unseen runs only after a complete, non-limited enumeration, with that probe as verify_gone.

WRITES go through db._wasalt_batch on the two aqaralriyadh tables (the public
upsert_aqaralriyadh_*_batch wrappers are added centrally later, with the tables).
"""
from __future__ import annotations

import argparse
import html as ihtml
import json
import re
import sys
from pathlib import Path
from typing import Any, Optional

from curl_cffi import requests as cc

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from scrapers.common import db, normalize  # noqa: E402
from scrapers.common.arabic_location import find_district_in_text, to_catalog  # noqa: E402
from scrapers.common.http_liveness import LivenessProbe  # noqa: E402
from scrapers.common.pii import redact_pii  # noqa: E402

BASE = "https://aqaralriyadh.com"
SOURCE = "عقار الرياض"
PREFIX = "AQR"
POSTS = f"{BASE}/wp-json/wp/v2/posts"
FIELDS = "id,link,title,content,status,categories"

# The category taxonomy's PLURAL type words → canonical type (map_type_exact's per-platform
# escape hatch; exact match only). Absent on purpose: «استوديو», «دوبلكس», «مجمعات», «عقارات
# استثمارية» (investment deals are out of scope), «شقق مفروشة» (no deal stated).
_TYPE_OVERRIDES = {
    "شقق": "Apartment", "فلل": "Villa", "أدوار": "Floor", "أراضي": "Residential Land",
    "استراحات": "Rest House", "بيوت": "Villa", "شاليهات": "Chalet", "غرف": "Room",
    "قصور": "Villa", "محلات": "Shop", "مزارع": "Farm", "مستودعات": "Warehouse", "مصانع": "Factory",
}
_CATEGORY_RE = re.compile(r"^(.+?)\s+(للإيجار|للايجار|للبيع)$")

_TRANS = str.maketrans("٠١٢٣٤٥٦٧٨٩", "0123456789")
_AR_WORD_NUM = {
    "واحد": 1, "واحدة": 1, "واحده": 1, "اثنان": 2, "اثنين": 2, "اثنتان": 2, "اثنتين": 2,
    "ثلاث": 3, "ثلاثة": 3, "ثلاثه": 3, "اربع": 4, "أربع": 4, "اربعة": 4, "أربعة": 4,
    "خمس": 5, "خمسة": 5, "ست": 6, "ستة": 6, "سبع": 7, "سبعة": 7, "ثمان": 8, "ثماني": 8,
    "ثمانية": 8, "تسع": 9, "تسعة": 9, "عشر": 10, "عشرة": 10,
}
# «غرفتان» / «صالتين» / «دورتان» — the count is fused into the noun's dual form.
_DUAL_RE = re.compile(r"^(?:غرف|صال|دور)(?:تان|تين)$")
_SINGULAR = {"غرفة", "غرفه", "صالة", "صاله", "دورة", "دوره"}
_FLOOR = {"الأرضي": 0, "الارضي": 0, "الأول": 1, "الاول": 1, "الثاني": 2, "الثالث": 3,
          "الرابع": 4, "الخامس": 5, "السادس": 6}
_NEGATED = ("بدون", "لا يوجد", "لايوجد", "غير")
_PRESENT = ("متوفر", "يوجد", "مجهز", "راكب", "خاص", "مشترك", "نعم", "بالكامل")


def session() -> cc.Session:
    s = cc.Session(impersonate="chrome")   # impersonate OWNS the User-Agent — never set one here
    s.headers.update({"Accept": "application/json", "Accept-Language": "ar,en;q=0.7"})
    return s


def plain(s: Optional[str]) -> str:
    return re.sub(r"\s+", " ", ihtml.unescape(re.sub(r"<[^>]+>", " ", s or ""))).strip()


def count(raw: Optional[str]) -> Optional[int]:
    """«3 غرف» → 3, «غرفتان» → 2, «صالة كبيرة» → 1, «ثلاث غرف» → 3, «لا يوجد» → None.
    Arabic-Indic digits and word numerals both count (notation parity)."""
    if not raw:
        return None
    s = str(raw).translate(_TRANS).strip()
    m = re.search(r"\d+", s)
    if m:
        n = int(m.group())
        return n if 0 < n <= 30 else None
    words = s.split()
    for w in words:
        if w in _AR_WORD_NUM:
            return _AR_WORD_NUM[w]
    if _DUAL_RE.match(words[0]):
        return 2
    return 1 if words[0] in _SINGULAR else None


def first_int(raw: Optional[str]) -> Optional[int]:
    """«134 م²» → 134 and «134 م2» → 134: only the FIRST number of a cell, so a unit's own digit is
    never folded into the figure (to_int('134 م2') == 1342)."""
    m = re.search(r"\d[\d,]*", (raw or "").translate(_TRANS))
    return normalize.to_int(m.group()) if m else None


def yes_no(raw: Optional[str]) -> Optional[bool]:
    """A labelled amenity cell: «متوفر» / «مجهز» / «خاص» → True, «لا يوجد» / «بدون» / «غير …» →
    False, anything else (silent, or a word we do not know) → None."""
    if not raw:
        return None
    s = str(raw).strip()
    if any(n in s for n in _NEGATED):
        return False
    return True if any(p in s for p in _PRESENT) else None


def labelled_fields(content_html: str) -> tuple[dict[str, str], str]:
    """({label: value}, prose). The first paragraph is the labelled block, split on <br>; every
    later paragraph is the description. Every value is PII-redacted HERE, at the one place the block
    is read, so no consumer (columns, evidence, additional_info) can leak a contact cell."""
    paras = re.findall(r"<p[^>]*>(.*?)</p>", content_html or "", re.S)
    facts: dict[str, str] = {}
    prose: list[str] = []
    for p in paras:
        lines = re.split(r"<br\s*/?>", p)
        got = 0
        for line in lines:
            m = re.match(r"\s*<strong>\s*(.*?)\s*[:：]?\s*</strong>\s*[:：]?\s*(.*)$", line, re.S)
            if m:
                facts[plain(m.group(1)).rstrip(":：").strip()] = redact_pii(plain(m.group(2))) or ""
                got += 1
        if not got:
            text = plain(p)
            if text:
                prose.append(text)
    return facts, "\n".join(prose)


def fetch_categories(s: cc.Session) -> dict[int, str]:
    r = s.get(f"{BASE}/wp-json/wp/v2/categories", params={"per_page": 100, "_fields": "id,name"},
              timeout=40)
    r.raise_for_status()
    return {int(c["id"]): ihtml.unescape(c["name"]).strip() for c in r.json()}


def fetch_posts(s: cc.Session, limit: int = 0) -> tuple[list[dict], int]:
    """Every published post, plus the source's own x-wp-total as the completeness check."""
    out: list[dict] = []
    total = 0
    page = 1
    while True:
        r = s.get(POSTS, params={"per_page": 100, "page": page, "_fields": FIELDS}, timeout=40)
        if r.status_code != 200:
            raise RuntimeError(f"posts page {page} → HTTP {r.status_code}")
        total = int(r.headers.get("x-wp-total") or total or 0)
        pages = int(r.headers.get("x-wp-totalpages") or 1)
        out.extend(r.json())
        if limit and len(out) >= limit:
            return out[:limit], total
        if page >= pages:
            return out, total
        page += 1


def map_listing(post: dict, categories: dict[int, str]) -> tuple[Optional[dict], str, str]:
    pid = post.get("id")
    if not pid:
        return None, "residential", "no_id"
    if (post.get("status") or "") != "publish":
        return None, "residential", f"status_{post.get('status') or 'blank'}"
    link = (post.get("link") or "").strip()
    if not link.startswith("http"):
        return None, "residential", "no_link"

    # TYPE + DEAL from the category — exactly one real category, or nothing.
    cats = [categories.get(int(c), "") for c in (post.get("categories") or []) if int(c) != 1]
    cats = [c for c in cats if c]
    if len(cats) != 1:
        return None, "residential", "category_ambiguous" if cats else "no_category"
    m = _CATEGORY_RE.match(cats[0])
    if not m:
        return None, "residential", "category_unmapped"
    property_type = normalize.map_type_exact(m.group(1), overrides=_TYPE_OVERRIDES)
    if not property_type:
        return None, "residential", "type_unmapped"
    category = normalize.category_for_type(property_type).lower()
    deal = "Buy" if m.group(2) == "للبيع" else "Rent"

    facts, prose = labelled_fields((post.get("content") or {}).get("rendered") or "")
    city_raw = facts.get("المدينة")
    if not city_raw:
        return None, category, "no_city"
    city_id, region_id = to_catalog(city_raw)
    if not city_id:
        return None, category, "city_not_in_catalog"
    district_raw = facts.get("الحي") or None
    district_ar = find_district_in_text(district_raw, city_id) if district_raw else None

    price_raw = facts.get("السعر")
    price = normalize.to_int(price_raw) if price_raw else None
    title = plain((post.get("title") or {}).get("rendered"))
    row: dict[str, Any] = {
        "ad_number": f"{PREFIX}{pid}",
        "listing_url": link,
        "source": SOURCE,
        "active": True,
        "title": title or None,
        "description": redact_pii(prose) if prose else None,
        "property_type": property_type,
        "transaction_type": "Rent" if deal == "Rent" else "Buy",
        "city": normalize.map_city(city_raw),
        "city_ar": city_raw,
        "city_id": city_id,
        "region_id": region_id,
        "district_ar": district_ar,
        "neighborhood": district_raw,
        "area_m2": first_int(facts.get("المساحة")),
        "bedrooms": count(facts.get("عدد الغرف")),
        "halls": count(facts.get("الصالات")),
        "bathrooms": count(facts.get("دورات المياه")),
        "floor_number": _FLOOR.get((facts.get("الدور") or "").strip()) if facts.get("الدور") else None,
        "photo_urls": None,      # source-does-not-publish (featured_media 0, no <img>, no og:image)
        "price_evidence": normalize.price_evidence(
            field="content «السعر:»", raw=price_raw, stored=price,
            kind="annual" if deal == "Rent" else "total", origin="structured"),
    }
    for col, label in (("kitchen", "المطبخ"), ("elevator", "المصعد"), ("parking", "موقف سيارة")):
        v = yes_no(facts.get(label))
        if v is not None:
            row[col] = v
    if deal == "Rent":
        # The period is the source's own word beside the figure («52,000 ريال سنويًا»); silent → NULL.
        period, annual = normalize.rent_period_and_annual(price, price_raw)
        row["price_annual"] = annual
        if period:
            row["rent_period"] = period
    else:
        row["price_total"] = price
    row["additional_info"] = {k: v for k, v in {
        "post_id": pid,
        "category": cats[0],
        "labelled_fields": facts,          # the source's own block, every value redacted in labelled_fields()
        "price_raw": price_raw,
    }.items() if v not in (None, "", {}, [])}
    return row, category, ""


# ── LIVENESS ────────────────────────────────────────────────────────────────────────────────────
_AD_NUMBER = re.compile(rf"^{PREFIX}(\d+)$")


def _signal(status, body, _moved):
    if status == 404 and "rest_post_invalid_id" in body:
        return "gone"
    if status == 200:
        try:
            j = json.loads(body)
        except (ValueError, TypeError):
            return None
        if isinstance(j, dict) and j.get("status") == "publish" and j.get("id"):
            return "live"
    return None


def _url_for(ad_number: str) -> Optional[str]:
    m = _AD_NUMBER.match(ad_number)
    return f"{POSTS}/{m.group(1)}" if m else None


_probe = LivenessProbe(platform="aqaralriyadh", signal=_signal, session=session, url_for=_url_for)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--type", choices=["residential", "commercial", "all"], default="all")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    s = session()
    dry = args.dry_run or bool(args.limit)
    run_id = None if dry else db.begin_run("aqaralriyadh")
    res: list[dict] = []
    com: list[dict] = []
    skipped: dict[str, int] = {}
    seen = 0
    try:
        categories = fetch_categories(s)
        posts, total = fetch_posts(s, limit=args.limit)
        print(f"{SOURCE}: {len(posts)} posts fetched (site says x-wp-total={total})", flush=True)
        if not posts:
            raise RuntimeError("the posts endpoint returned no posts")
        for post in posts:
            seen += 1
            row, cat, why = map_listing(post, categories)
            if not row:
                skipped[why] = skipped.get(why, 0) + 1
                continue
            if args.type != "all" and cat != args.type:
                continue
            (com if cat == "commercial" else res).append(row)

        notes = ", ".join(f"{k}x{v}" for k, v in sorted(skipped.items(), key=lambda x: -x[1]))
        if skipped:
            print(f"  skipped (not guessed): {notes}", flush=True)
        if dry:
            print(f"✓ {SOURCE} VALIDATION: {len(res)} residential + {len(com)} commercial "
                  f"(nothing written)")
            for r0 in (res + com)[:14]:
                print(f"   {r0['ad_number']:>7} {r0['transaction_type']:4} {r0['property_type']:10} "
                      f"{r0['city_ar']:7} d={str(r0['district_ar'])[:14]:14} a={str(r0['area_m2']):>4} "
                      f"bd={str(r0['bedrooms']):>2} ba={str(r0['bathrooms']):>2} h={r0['halls']} "
                      f"p={r0.get('price_total') or r0.get('price_annual')} rp={r0.get('rent_period')}")
            return 0

        # The public upsert_aqaralriyadh_*_batch wrappers are added centrally with the tables.
        db._wasalt_batch("aqaralriyadh_residential_listings", res)
        db._wasalt_batch("aqaralriyadh_commercial_listings", com)
        superseded = db.retire_superseded_siblings(
            res_table="aqaralriyadh_residential_listings",
            com_table="aqaralriyadh_commercial_listings",
            res_ads={r["ad_number"] for r in res}, com_ads={r["ad_number"] for r in com},
            source=SOURCE)
        if superseded:
            print(f"  retired {superseded} superseded sibling row(s) after a category flip")
        pruned = 0
        # Only after a COMPLETE enumeration (x-wp-total agrees with what we fetched), never --type.
        if args.type == "all" and len(posts) >= total:
            for tbl, rows in (("aqaralriyadh_residential_listings", res),
                              ("aqaralriyadh_commercial_listings", com)):
                n = db.prune_unseen(tbl, {r["ad_number"] for r in rows}, source=SOURCE,
                                    verify_gone=_probe.verify_gone)
                if n < 0:
                    print(f"  ⚠ {tbl}: prune guard tripped — kept existing active rows")
                else:
                    pruned += n
        healthy = db.end_run(run_id, ok=True, rows_seen=seen, rows_upserted=len(res) + len(com),
                             notes=f"pruned={pruned} {notes}"[:300],
                             check_tables=["aqaralriyadh_residential_listings",
                                           "aqaralriyadh_commercial_listings"])
        if not healthy:
            print("✗ run demoted to unhealthy by end_run()'s RC-B guard", flush=True)
            return 1
        print(f"✓ {SOURCE}: {len(res)} residential + {len(com)} commercial upserted")
        return 0
    except Exception as e:
        if run_id:
            db.end_run(run_id, ok=False, rows_seen=seen, rows_upserted=0, notes=str(e)[:300])
        print(f"✗ {SOURCE}: {e}", flush=True)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
