"""حصاد الاقتصادية للعقارات — hasaadestate.com. A Jeddah developer's WordPress site. Onboarding
2026-09-24.

SOURCE SHAPE (measured live 2026-09-24, before any code)
========================================================
· projects-sitemap.xml lists 13 URLs: the /projects/ index, 2 English duplicates under /en/, and
  10 Arabic project pages. There is no REST route for them (wp/v2/types has no project CPT), and
  the price list is in the server-rendered HTML — no JS needed.
· A project page is a COMPOUND page. Its «الوحدات» tabs hold one card per UNIT MODEL:
      <div class="item green|red"> … <span class="status">متاح|مباع</span>
         <h3>نموذج B – جوار 19</h3> <p>950,000 ريال</p>
         <li>…<span>3 غرف نوم</span></li> <li>…<span>مجلس</span></li> … (a spec chip list)
         … data-target="#unit-modal-8625"
  and a modal per model (`id="unit-modal-<id>"`) that repeats the name and price and carries
  «المساحة الداخلية <p>172 م2</p>». The modal id is the model's own WordPress post id (the site's
  units-sitemap lists 57 /units/<slug>/ pages, which are bare floor-plan pages without a price).
  THE ROW GRAIN IS THE UNIT MODEL (the owner's compound rule): ad_number = HSD<project post
  id>U<unit post id>, listing_url = the project page, where the price is shown.
· Project facts: body class `postid-<n>`; `.details` status chip («متاح» / «غير متاح»); `.title_single`
  <h2> title and <p>«جدة - السلامة» (city - district); «N وحدة سكنية». The TYPE is the title's own
  first word: «شقق جوار 19» → شقة, «فلل كورتيارد» → فيلا; a title without one is not guessed.
· Measured over the 10 Arabic pages: 7 carry a price list — جوار 23 (5 models, but the title says
  «(قريبا)» and the project chip says «غير متاح»), جوار 24 (8 models, title «مشروع تحت الإنشاء»,
  every price EMPTY), جوار 20 (2), جوار 19 (3, one «مباع»), جوار 22 (4, one «مباع»), مسكني 8 (2,
  both PRICE RANGES «1,100,000 - 1,150,000»), السلام 2 (2, ranges), جوار 21 (3, two «مباع»);
  فلل كورتيارد and واجهة حصاد have no unit list at all.
· SKIPS, never guesses: a «قريبا» title or a «غير متاح» project chip → coming_soon; «تحت الإنشاء» →
  under_construction (off-plan); «مباع» → sold; a project with no unit list → no_units.
· PRICE = SOURCE: «950,000 ريال» → 950000. A RANGE («1,100,000 - 1,150,000», «990,000 -980,000»)
  is not one figure: price_total stays NULL and the range is kept verbatim in the price evidence
  and additional_info — never the low bound, never a midpoint. An empty price → NULL, found=False.
· SPEC CHIPS: «3 غرف نوم» → bedrooms, «4 دورات مياه» → bathrooms, «مجلس» → reception_rooms_majlis,
  «غرفة معيشة»/«صالة معيشة» → halls; «مطبخ», «غرفة خادمة», «شرفة», «غرفة غسيل»/«غسيل» through
  amenities_from_text (joined on «، »). «صالون», «غرفة طعام», «سطح», «مخزن» have no column and are
  kept in additional_info. Nothing is negated on this source, so nothing is ever False.
· PHOTOS: the project gallery — JPEG/WebP files under /wp-content/uploads/ served directly or via
  the i0.wp.com proxy (checked: 200 image/webp). Paths carry Arabic and are percent-encoded. The
  spec-chip PNG icons and the SVG feature art are not photos.
· PII / LICENCE: no phone, e-mail or licence number on any project page.

REMOVAL ORACLE (measured 2026-09-24)
  /?p=<project post id>: 3 live projects (8404, 8138, 8292) → HTTP 200 redirecting to the project
  page, which carries its unit cards — 3/3; 5 ids that are not posts (1, 2, 500, 8000, 9000) → HTTP
  404 — 5/5; a fabricated /projects/<slug>/ → 404. Both 404 shapes are WordPress's own template:
  `<body class="rtl error404 wp-theme-HASAAD">` (re-measured 2026-09-24 on /?p=8000 and
  /projects/nonexistent-xyz/), and that marker is REQUIRED — a 404 without it (a WAF, a CDN edge)
  says nothing. A unit's fate is read from its project page: page 404 + error404 → GONE; page 200
  with `unit-modal-<unit id>` and status «متاح» → LIVE; page 200 for THIS project (postid-<id>) but
  the unit absent or «مباع» → GONE; anything else → no opinion.

WRITES go through db._wasalt_batch on the two hasaad tables (the public upsert_hasaad_*_batch
wrappers are added centrally later, with the tables).
"""
from __future__ import annotations

import argparse
import html as ihtml
import re
import sys
import time
from pathlib import Path
from typing import Any, Optional
from urllib.parse import quote, urlsplit, urlunsplit

from curl_cffi import requests as cc

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from scrapers.common import db, normalize  # noqa: E402
from scrapers.common.arabic_location import find_district_in_text, to_catalog  # noqa: E402
from scrapers.common.http_liveness import LivenessProbe  # noqa: E402

BASE = "https://hasaadestate.com"
SOURCE = "حصاد الاقتصادية للعقارات"
PREFIX = "HSD"
SITEMAP = f"{BASE}/projects-sitemap.xml"
PAUSE = 0.8

# The project title's own leading type word (plural) → canonical type. Exact match only.
_TYPE_OVERRIDES = {"شقق": "Apartment", "فلل": "Villa", "فيلا": "Villa", "شقة": "Apartment"}
_COMING_SOON = ("قريبا", "قريباً", "قريبًا")
_UNDER_CONSTRUCTION = ("تحت الإنشاء", "تحت الانشاء", "على الخارطة", "على الخريطة")
_SOLD = ("مباع", "تم البيع")
_TRANS = str.maketrans("٠١٢٣٤٥٦٧٨٩", "0123456789")

_POSTID_RE = re.compile(r"\bpostid-(\d+)\b")
_STATUS_CHIP_RE = re.compile(r'<div class="details">.*?<p>(.*?)</p>', re.S)
_TITLE_RE = re.compile(r'<div class="title_single">\s*<h2>(.*?)</h2>\s*<p>(.*?)</p>', re.S)
_ITEM_RE = re.compile(r'<div class="item (green|red)">(.*?)data-target="#unit-modal-(\d+)"', re.S)
_ITEM_STATUS_RE = re.compile(r'class="status">(.*?)<', re.S)
_ITEM_NAME_RE = re.compile(r"<h3>(.*?)</h3>", re.S)
_ITEM_PRICE_RE = re.compile(r"<h3>.*?</h3>\s*<p>(.*?)</p>", re.S)
_ITEM_SPEC_RE = re.compile(r"<span>([^<]*)</span>\s*</li>")
_AREA_RE = re.compile(r"<h2>المساحة الداخلية</h2>\s*<p>([^<]*)</p>")
_BEDS_RE = re.compile(r"([\d٠-٩]{1,2})\s*غرف(?:ة|ه)?\s*نوم")
_BATHS_RE = re.compile(r"([\d٠-٩]{1,2})\s*دور(?:ات|ة|ه)\s*مياه")
_UNITS_RE = re.compile(r"([\d٠-٩]{1,4})\s*وحد(?:ة|ات)\s*سكنية")
_PHOTO_RE = re.compile(r'(?:src|href)="(https?://(?:i\d\.wp\.com/)?hasaadestate\.com/wp-content/uploads/[^"]+?\.(?:jpe?g|webp))(?:\?[^"]*)?"', re.I)


def session() -> cc.Session:
    s = cc.Session(impersonate="chrome")   # impersonate OWNS the User-Agent — never set one here
    s.headers.update({"Accept": "text/html,application/xhtml+xml", "Accept-Language": "ar,en;q=0.7"})
    return s


def plain(s: Optional[str]) -> str:
    return re.sub(r"\s+", " ", ihtml.unescape(re.sub(r"<[^>]+>", " ", s or ""))).strip()


def _encode(url: str) -> str:
    """Percent-encode a non-ASCII path («…/uploads/2025/10/اغفتاغ.jpeg») so it survives an <img>."""
    p = urlsplit(url)
    return urlunsplit((p.scheme, p.netloc, quote(p.path, safe="/%"), p.query, ""))


def first_int(raw: Optional[str]) -> Optional[int]:
    """«172 م2» → 172. to_int would fold the unit's own digit in («172» + «2» → 1722), so only the
    FIRST number of the cell is read."""
    m = re.search(r"[\d٠-٩][\d٠-٩,]*", (raw or "").translate(_TRANS))
    return normalize.to_int(m.group(0)) if m else None


def parse_price(raw: Optional[str]) -> tuple[Optional[int], bool]:
    """(figure, is_range). «950,000 ريال» → (950000, False); «1,100,000 - 1,150,000» → (None, True);
    empty → (None, False). Never the low bound of a range."""
    s = (raw or "").translate(_TRANS)
    nums = re.findall(r"\d[\d,]*", s)
    if len(nums) > 1:
        return None, True
    return (normalize.to_int(nums[0]) if nums else None), False


def fetch_project_urls(s: cc.Session, limit: int = 0) -> list[str]:
    r = s.get(SITEMAP, timeout=40)
    if r.status_code != 200:
        raise RuntimeError(f"projects sitemap → HTTP {r.status_code}")
    urls = [u for u in re.findall(r"<loc>([^<]+)</loc>", r.text)
            if "/projects/" in u and "/en/" not in u and u.rstrip("/") != f"{BASE}/projects"]
    urls = sorted(dict.fromkeys(urls))
    return urls[:limit] if limit else urls


def parse_project(page_html: str) -> dict[str, Any]:
    """The project-level facts and every unit card, exactly as the page states them."""
    m = _POSTID_RE.search(page_html)
    tm = _TITLE_RE.search(page_html)
    title = plain(tm.group(1)) if tm else ""
    where = plain(tm.group(2)) if tm else ""
    city, _, district = (x.strip() for x in where.partition("-")) if "-" in where else (where, "", "")
    cm = _STATUS_CHIP_RE.search(page_html)
    um = _UNITS_RE.search(plain(page_html))
    areas: dict[str, str] = {}
    for k, seg in zip(*[iter(re.split(r'id="unit-modal-(\d+)"', page_html)[1:])] * 2):
        am = _AREA_RE.search(seg)
        if am and plain(am.group(1)) and k not in areas:
            areas[k] = plain(am.group(1))
    units = []
    for cls, body, uid in _ITEM_RE.findall(page_html):
        st = _ITEM_STATUS_RE.search(body)
        nm = _ITEM_NAME_RE.search(body)
        pr = _ITEM_PRICE_RE.search(body)
        units.append({
            "id": uid, "css": cls,
            "status": plain(st.group(1)) if st else "",
            "name": plain(nm.group(1)) if nm else "",
            "price_raw": plain(pr.group(1)) if pr else "",
            "specs": [plain(x) for x in _ITEM_SPEC_RE.findall(body) if plain(x)],
            "area_raw": areas.get(uid),
        })
    photos = []
    for u in _PHOTO_RE.findall(page_html):
        e = _encode(u)
        if e not in photos:
            photos.append(e)
    return {"post_id": m.group(1) if m else None, "title": title, "city": city, "district": district,
            "status_chip": plain(cm.group(1)) if cm else "", "units": units, "photos": photos,
            "units_total": normalize.to_int(um.group(1)) if um else None}


def map_units(url: str, project: dict[str, Any]) -> tuple[list[dict], dict[str, int]]:
    """Every UNIT MODEL of one project page as its own row, plus the skip tally for the page."""
    skips: dict[str, int] = {}

    def skip(why: str, n: int = 1) -> tuple[list[dict], dict[str, int]]:
        skips[why] = skips.get(why, 0) + n
        return [], skips

    pid = project.get("post_id")
    if not pid:
        return skip("no_post_id")
    units = project.get("units") or []
    if not units:
        return skip("no_units")
    title = project.get("title") or ""
    if any(w in title for w in _COMING_SOON) or project.get("status_chip") == "غير متاح":
        return skip("coming_soon", len(units))
    if any(w in title for w in _UNDER_CONSTRUCTION):
        return skip("under_construction", len(units))
    type_word = title.split()[0] if title else ""
    property_type = normalize.map_type_exact(type_word, overrides=_TYPE_OVERRIDES)
    if not property_type:
        return skip("type_unmapped", len(units))
    city_raw = project.get("city") or ""
    if not city_raw:
        return skip("no_city", len(units))
    city_id, region_id = to_catalog(city_raw)
    if not city_id:
        return skip("city_not_in_catalog", len(units))
    district_raw = project.get("district") or None
    district_ar = find_district_in_text(district_raw, city_id) if district_raw else None
    category = normalize.category_for_type(property_type).lower()

    rows: list[dict] = []
    for u in units:
        if any(w in u["status"] for w in _SOLD) or u["css"] == "red":
            skips["sold"] = skips.get("sold", 0) + 1
            continue
        price, is_range = parse_price(u["price_raw"])
        spec_text = "، ".join(u["specs"])
        bm = _BEDS_RE.search(spec_text)
        tm = _BATHS_RE.search(spec_text)
        row: dict[str, Any] = {
            "ad_number": f"{PREFIX}{pid}U{u['id']}",
            "listing_url": url,
            "source": SOURCE,
            "active": True,
            "title": " – ".join(x for x in (u["name"], title) if x) or None,
            "property_type": property_type,
            "transaction_type": "Buy",
            "city": normalize.map_city(city_raw),
            "city_ar": city_raw,
            "city_id": city_id,
            "region_id": region_id,
            "district_ar": district_ar,
            "neighborhood": district_raw,
            "area_m2": first_int(u.get("area_raw")),
            "bedrooms": normalize.to_int(bm.group(1)) if bm else None,
            "bathrooms": normalize.to_int(tm.group(1)) if tm else None,
            "reception_rooms_majlis": 1 if "مجلس" in u["specs"] else None,
            "halls": 1 if any(x in ("غرفة معيشة", "صالة معيشة", "صالة") for x in u["specs"]) else None,
            "price_total": price,
            "photo_urls": (project.get("photos") or [])[:20] or None,
            "price_evidence": normalize.price_evidence(
                field="unit card <p> after <h3>", raw=u["price_raw"] or None, stored=price,
                kind="total", origin="structured"),
            **normalize.amenities_from_text(spec_text),
        }
        row["additional_info"] = {k: v for k, v in {
            "project_post_id": pid, "unit_post_id": u["id"], "project_title": title,
            "model_name": u["name"], "price_raw": u["price_raw"] or None,
            "price_range": u["price_raw"] if is_range else None,
            "area_raw": u.get("area_raw"), "specs": u["specs"],
            "project_units_total": project.get("units_total"),
            "project_status": project.get("status_chip") or None,
        }.items() if v not in (None, "", {}, [])}
        rows.append(row)
    return rows, skips


# ── LIVENESS ────────────────────────────────────────────────────────────────────────────────────
_AD_NUMBER = re.compile(rf"^{PREFIX}(\d+)U(\d+)$")


def _signal_for(project_id: str, unit_id: str):
    def _signal(status, body, _moved):
        if status == 404:
            # Only WordPress's own 404 template is a death; a bare 404 from a WAF/CDN says nothing.
            return "gone" if "error404" in body else None
        if status != 200 or f"postid-{project_id}" not in body:
            return None
        # The cards are read in sequence (one match per card), then THIS unit's card is picked by
        # its own modal id — a leftmost search would hand back the previous card's status.
        mine = [(css, card) for css, card, uid in _ITEM_RE.findall(body) if uid == unit_id]
        if not mine:
            return "gone"                                  # the project page no longer lists it
        css, card = mine[0]
        st = _ITEM_STATUS_RE.search(card)
        word = plain(st.group(1)) if st else ""
        if css == "green" and word == "متاح":
            return "live"
        if css == "red" or any(w in word for w in _SOLD):
            return "gone"
        return None
    return _signal


def _verify_gone(ad_number: str) -> tuple[str, str]:
    m = _AD_NUMBER.match(ad_number)
    if not m:
        return "unknown", f"{ad_number!r} is not a {PREFIX}<project>U<unit> ad number"
    pid, uid = m.groups()
    return LivenessProbe(platform="hasaad", signal=_signal_for(pid, uid), session=session,
                         url_for=lambda _ad: f"{BASE}/?p={pid}").verify_gone(ad_number)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--type", choices=["residential", "commercial", "all"], default="all")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    s = session()
    dry = args.dry_run or bool(args.limit)
    run_id = None if dry else db.begin_run("hasaad")
    res: list[dict] = []
    com: list[dict] = []
    skipped: dict[str, int] = {}
    seen = 0
    pages_ok = 0
    try:
        urls = fetch_project_urls(s, limit=args.limit)
        if not urls:
            raise RuntimeError("projects sitemap listed no Arabic /projects/ pages")
        print(f"{SOURCE}: {len(urls)} project pages discovered", flush=True)
        for u in urls:
            try:
                r = s.get(u, timeout=45)
            except Exception:   # noqa: BLE001
                skipped["unreachable"] = skipped.get("unreachable", 0) + 1
                continue
            time.sleep(PAUSE)
            if r.status_code != 200:
                skipped[f"http_{r.status_code}"] = skipped.get(f"http_{r.status_code}", 0) + 1
                continue
            pages_ok += 1
            project = parse_project(r.text)
            seen += len(project["units"])
            rows, skips = map_units(u, project)
            for k, v in skips.items():
                skipped[k] = skipped.get(k, 0) + v
            for row in rows:
                cat = normalize.category_for_type(row["property_type"]).lower()
                if args.type != "all" and cat != args.type:
                    continue
                (com if cat == "commercial" else res).append(row)

        notes = ", ".join(f"{k}x{v}" for k, v in sorted(skipped.items(), key=lambda x: -x[1]))
        if skipped:
            print(f"  skipped (not guessed): {notes}", flush=True)
        if dry:
            print(f"✓ {SOURCE} VALIDATION: {len(res)} residential + {len(com)} commercial "
                  f"units on {pages_ok}/{len(urls)} pages (nothing written)")
            for r0 in (res + com)[:14]:
                print(f"   {r0['ad_number']:>12} {r0['property_type']:9} {r0['city_ar']:5} "
                      f"d={str(r0['district_ar'])[:12]:12} a={str(r0['area_m2']):>4} "
                      f"bd={str(r0['bedrooms']):>2} ba={str(r0['bathrooms']):>2} "
                      f"p={r0.get('price_total')} rng={r0['additional_info'].get('price_range')} "
                      f"ph={len(r0.get('photo_urls') or [])} | {r0['title'][:40]}")
            return 0

        # The public upsert_hasaad_*_batch wrappers are added centrally with the tables.
        db._wasalt_batch("hasaad_residential_listings", res)
        db._wasalt_batch("hasaad_commercial_listings", com)
        superseded = db.retire_superseded_siblings(
            res_table="hasaad_residential_listings", com_table="hasaad_commercial_listings",
            res_ads={r["ad_number"] for r in res}, com_ads={r["ad_number"] for r in com},
            source=SOURCE)
        if superseded:
            print(f"  retired {superseded} superseded sibling row(s) after a category flip")
        pruned = 0
        # Only after EVERY sitemap page was read (a missed page must never read as absence).
        if args.type == "all" and pages_ok == len(urls):
            for tbl, rows in (("hasaad_residential_listings", res),
                              ("hasaad_commercial_listings", com)):
                n = db.prune_unseen(tbl, {r["ad_number"] for r in rows}, source=SOURCE,
                                    verify_gone=_verify_gone)
                if n < 0:
                    print(f"  ⚠ {tbl}: prune guard tripped — kept existing active rows")
                else:
                    pruned += n
        healthy = db.end_run(run_id, ok=True, rows_seen=seen, rows_upserted=len(res) + len(com),
                             notes=f"pruned={pruned} pages={pages_ok}/{len(urls)} {notes}"[:300],
                             check_tables=["hasaad_residential_listings",
                                           "hasaad_commercial_listings"])
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
