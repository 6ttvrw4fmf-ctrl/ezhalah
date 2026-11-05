"""Asas Makeen (asasmakeen.com) — the STAGED ingest (owner order 2026-11-05). Rows are stored in tables no search
arm reads; NOTHING reaches a customer until the owner launches it (docs/ops/FIVE_SOURCES_LAUNCH.md).

SOURCE SHAPE (measured live 2026-11-05; robots.txt allows /sitemap-units-ar.xml and the unit pages, disallows /api/)
=================================================================================================================
The site's own complete unit list is https://asasmakeen.com/sitemap-units-ar.xml (554 unit pages on 2026-11-05, all
Riyadh apartments). Each page /ar/وحدة/<id>/<slug> is server-rendered HTML; its .apartment-unit-detail__info block is
the whole ad:
  badge             «بيع» (sale) or «تأجير» (rent) — the side.
  h2 / p.text-muted the title («شقة 142م بشمال الرياض حي العارض») and the unit code («مكين 34 - A10»).
  «في مشروع: X — حي Y» the project and its district.
  .unit-price-current «80,000ريال» → PRICE = SOURCE. A rent shows only «إيجار», never a period word: PERIOD = SOURCE =
                    silent → rent_period NULL (judged at launch by the search index, flagged judged). A unit with NO
                    price block (2 rent units on 2026-11-05) is price on request, still listed.
  ul.apartment-unit-detail__specs  «عدد الغرف: 3», «الدور: الأرضي», «المساحة: 142 م2», «الحي: العارض» and the unit's
                    feature lines («3 دورات مياة», «راكب المطبخ», «غرفة خادمة», «شقة مؤثثة», «بلكونة» …). BATHROOMS ARE
                    ONLY IN THESE LINES (no field): «N دورات مياة» / «دورتان مياة» / «دورة مياة». The lines ARE the ad's
                    text → stored as the description (the facts readers read them at launch) and read here too.
  NO PIN anywhere on the page (no map, no coordinates, no JSON; the only map link is the company's office) and NO
  REGA licence: pin_source none, licence NULL. The district is the page's own «الحي» line / project district.
OFF-PLAN (owner 2026-10-25: stored, hidden): a unit whose project is listed on the site's own «بيع على الخارطة»
(/ar/مشاريعنا/بيع-على-الخارطة — «طليعة المشرقية» on 2026-11-05) or «تحت الإنشاء» page goes to
asasmakeen_offplan_units, never a listing. Both pages are read every run, so the split follows the site.

LIVENESS («own full list = the check»): COMPLETE = every sitemap URL answered 200 with a parseable unit block.
A page that is gone (404/410 or no unit block) is not listed. Only a complete walk prunes; 3 complete misses = inactive.

    python -m scrapers.asasmakeen.run --dry-run [--limit 20]
    python -m scrapers.asasmakeen.run
"""
from __future__ import annotations

import argparse
import html as _html
import json
import re
import sys
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional
from urllib.parse import quote, unquote

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from scrapers.common import db, honest_fetch as H, normalize as N  # noqa: E402
from scrapers.common.arabic_location import catalog_district, resolve  # noqa: E402
from scrapers.common.pii import redact_pii  # noqa: E402

SOURCE = "Asas Makeen"
SLUG = "asasmakeen"
PREFIX = "ASM"
RES_TABLE = "asasmakeen_residential_listings"
OFFPLAN_TABLE = "asasmakeen_offplan_units"
SITE = "https://asasmakeen.com"
SITEMAP = SITE + "/sitemap-units-ar.xml"
OFFPLAN_PAGES = (SITE + "/ar/" + quote("مشاريعنا") + "/" + quote("بيع-على-الخارطة"),
                 SITE + "/ar/" + quote("مشاريعنا") + "/" + quote("تحت-الإنشاء"))
UNIT_PATH = "/ar/" + quote("وحدة") + "/"

_INFO_RE = re.compile(r'class="apartment-unit-detail__info">(.*?)apartment-unit-detail__cta', re.S)
_BADGE_RE = re.compile(r'<span class="badge [^"]*mb-3">\s*([^<]+?)\s*</span>')
_H2_RE = re.compile(r"<h2[^>]*>\s*(.*?)\s*</h2>", re.S)
_CODE_RE = re.compile(r'<p class="text-muted small mb-2">\s*(.*?)\s*</p>', re.S)
_PROJECT_RE = re.compile(r"<strong>في مشروع:</strong>\s*(.*?)\s*</p>", re.S)
_PRICE_RE = re.compile(r'class="unit-price-current[^"]*">\s*([^<]*?)\s*</span>')
_SPECS_RE = re.compile(r'<ul class="list-unstyled apartment-unit-detail__specs[^"]*">(.*?)</ul>', re.S)
_LI_RE = re.compile(r"<li>(.*?)</li>", re.S)
_IMG_RE = re.compile(r'href="(https://asasmakeen\.com/uploads/products/[^"]+)"\s+data-fancybox="unit-gallery"')
_MAIN_IMG_RE = re.compile(r'class="apartment-unit-detail__main-img" src="([^"]+)"')
_FLOOR = {"الأرضي": 0, "الأول": 1, "الثاني": 2, "الثالث": 3, "الرابع": 4, "الخامس": 5, "الروف": None, "الملحق": None}
_WORD_BATHS = (("دورتان", 2), ("دورتين", 2), ("دورة", 1))


def _allowed(url: str) -> bool:
    return url == SITEMAP or url in OFFPLAN_PAGES or url.startswith(SITE + UNIT_PATH)


def _text(fragment: str) -> str:
    return re.sub(r"\s+", " ", _html.unescape(re.sub(r"<[^>]+>", " ", fragment))).strip()


def baths_from_lines(lines: list[str]) -> Optional[int]:
    """«3 دورات مياة» / «دورتان مياة» / «دورة مياة» — the page's only bathroom statement. Two different counts = none."""
    found = set()
    for ln in lines:
        if not re.search(r"مي[اآ][هة]", ln):
            continue
        n = N.baths_from_leading_count(ln)
        if n is None:
            n = next((v for w, v in _WORD_BATHS if re.search(rf"(?<!\w){w}\s*(?:ال)?مي[اآ][هة]", ln)), None)
        if n:
            found.add(n)
    return found.pop() if len(found) == 1 else None


def _g(rx: re.Pattern, s: str) -> str:
    m = rx.search(s)
    return m.group(1) if m else ""


def parse_unit(page: str) -> Optional[dict]:
    m = _INFO_RE.search(page)
    if not m:
        return None
    blk = m.group(1)
    specs = [_text(x) for x in _LI_RE.findall(_g(_SPECS_RE, blk))]
    labelled = {k.strip(): v.strip() for k, _, v in (ln.partition(":") for ln in specs) if _ and v.strip()}
    project = _text(_g(_PROJECT_RE, blk))
    pname, _, pdist = project.partition("—")
    images = _IMG_RE.findall(page)
    main = _MAIN_IMG_RE.search(page)
    if main and main.group(1) not in images and not main.group(1).endswith("default.png"):
        images.insert(0, main.group(1))
    return {"badge": _text(_g(_BADGE_RE, blk)),
            "title": _text(_g(_H2_RE, blk)),
            "code": _text(_g(_CODE_RE, blk)),
            "project": pname.strip(), "project_district": pdist.strip(),
            "price_raw": _text(_g(_PRICE_RE, blk)),
            "specs": specs, "labelled": labelled, "features": [ln for ln in specs if ":" not in ln],
            "rent_badge": "unit-price-rent-badge" in blk, "images": images}


def offplan_projects(get=H.get_text) -> set[str]:
    out: set[str] = set()
    for u in OFFPLAN_PAGES:
        out |= {_text(n) for n in re.findall(r"<h[2-5][^>]*>\s*([^<]{2,60}?)\s*</h[2-5]>", get(u, allowed=_allowed))
                if "الريادة" not in n}
    return out


def map_unit(uid: str, url: str, u: dict) -> tuple[Optional[dict], str]:
    deal = {"بيع": "Buy", "تأجير": "Rent"}.get(u["badge"])
    if not deal:
        return None, f"badge_{u['badge'] or 'none'}"
    ptype = N.map_type(u["title"])
    if ptype != "Apartment":
        return None, f"type_{ptype or 'unmapped'}"
    district = (u["labelled"].get("الحي") or u["project_district"].removeprefix("حي ").strip()) or None
    city = "الرياض" if "الرياض" in u["title"] else None
    r = resolve(city, district) if city else {}
    cid = r.get("city_id")
    price = N.to_int(u["price_raw"])
    desc = redact_pii("\n".join(u["specs"]), keep_lines=True) or None
    area = N.to_int(re.sub(r"م2|م²", "", u["labelled"].get("المساحة", "")))
    prose = N.prose_amenities("\n".join(u["features"]))
    row: dict[str, Any] = {
        "ad_number": f"{PREFIX}{uid}", "listing_url": url, "source": SOURCE, "active": True,
        "title": redact_pii(u["title"]) or None, "description": desc,
        "property_type": "Apartment", "transaction_type": "Rent" if deal == "Rent" else "Buy",
        "city": N.map_city(r.get("city_ar") or city) if city else None, "city_ar": r.get("city_ar") or city,
        "city_id": cid, "region_id": r.get("region_id"), "neighborhood": district,
        "district_ar": catalog_district(cid, district) if (cid and district) else None,
        "area_m2": area, "bedrooms": N.to_int(u["labelled"].get("عدد الغرف")),
        "bathrooms": baths_from_lines(u["features"]), "floor_number": _FLOOR.get(u["labelled"].get("الدور", "")),
        "project_name": u["project"] or None, "photo_urls": u["images"] or None,
        **prose,
    }
    if deal == "Buy":
        row["price_total"] = price if price else db.AUTHORITATIVE_NULL
    else:
        row["rent_period"], row["price_annual"] = None, (price if price else db.AUTHORITATIVE_NULL)
    row["price_evidence"] = {**N.price_evidence(field=".unit-price-current", raw=u["price_raw"] or None, stored=price,
                                                kind="total" if deal == "Buy" else "annual", unit="total",
                                                origin="structured", authoritative_absent=not price),
                             **({"period_stated": False} if deal == "Rent" else {})}
    info = {"source_id": uid, "unit_code": u["code"] or None, "project": u["project"] or None,
            "project_district": u["project_district"] or None, "floor_label": u["labelled"].get("الدور"),
            "area_label": u["labelled"].get("المساحة"), "features": u["features"] or None,
            "price_label": u["price_raw"] or None, "pin_source": "none (no map or coordinates on the unit page)"}
    row["additional_info"] = {k: v for k, v in info.items() if v not in (None, "", [], {})}
    row["source_capture"] = {"schema": "asasmakeen.unit.v1", "item": {k: v for k, v in u.items() if k != "images"},
                             "images": u["images"]}
    return row, ""


def walk(limit: int = 0, log=print) -> dict:
    sm = H.get_text(SITEMAP, allowed=_allowed)
    urls = list(dict.fromkeys(_html.unescape(x) for x in re.findall(r"<loc>\s*([^<]+?)\s*</loc>", sm)))
    urls = [u for u in urls if u.startswith(SITE + UNIT_PATH)]
    listed = len(urls)
    if limit:
        urls = urls[:limit]
    units: dict[str, tuple[str, dict]] = {}
    bad: Counter = Counter()
    for i, u in enumerate(urls, 1):
        uid = unquote(u)[len(SITE + "/ar/وحدة/"):].split("/")[0]
        try:
            page = H.get_text(u, allowed=_allowed)
        except H.Blocked as e:
            if " 404 " in str(e) or " 410 " in str(e):
                bad["gone_404"] += 1
                continue
            raise
        p = parse_unit(page)
        if p is None:
            bad["no_unit_block"] += 1
            continue
        units[uid] = (u, p)
        if i % 100 == 0:
            log(f"  {i}/{len(urls)} pages read")
    return {"listed": listed, "read": len(urls), "units": units, "bad": bad, "limited": bool(limit)}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--save", default="")
    a = ap.parse_args()
    run_id = None if a.dry_run else db.begin_run(SLUG)
    w: dict = {"units": {}}
    try:
        off = offplan_projects()
        w = walk(a.limit)
        rows, offplan, skipped = [], [], Counter()
        now = datetime.now(timezone.utc).isoformat()
        for uid, (url, u) in w["units"].items():
            if u["project"] in off:
                offplan.append({"ad_number": f"{PREFIX}{uid}", "listing_url": url, "project": u["project"],
                                "side": u["badge"], "record": u, "last_seen_at": now})
                continue
            row, why = map_unit(uid, url, u)
            (rows.append(row) if row else skipped.update([why]))
        ok = not w["limited"] and not w["bad"] and len(w["units"]) == w["listed"] > 0
        cover = {"sitemap": w["listed"], "read": w["read"], "parsed": len(w["units"]), "bad": dict(w["bad"]),
                 "complete": ok, "offplan_projects": sorted(off)}
        print(f"  coverage: {json.dumps(cover, ensure_ascii=False)}\n  mapped: {len(rows)} listings "
              f"({Counter(r['transaction_type'] for r in rows)}); off-plan stored hidden: {len(offplan)}; "
              f"skipped (not guessed): {dict(skipped)}", flush=True)
        if a.save:
            Path(a.save).write_text(json.dumps({"rows": rows, "offplan": offplan}, ensure_ascii=False, default=str))
        if a.dry_run:
            return 0
        db._wasalt_batch(RES_TABLE, rows)
        for i in range(0, len(offplan), 200):
            db._execute(db.sb().table(OFFPLAN_TABLE).upsert(offplan[i:i + 200], on_conflict="ad_number"), what=OFFPLAN_TABLE)
        note = f"coverage {json.dumps(cover, ensure_ascii=False)}; offplan={len(offplan)}; "
        if rows and ok:
            note += f"pruned={db.prune_unseen(RES_TABLE, {r['ad_number'] for r in rows}, source=SOURCE, verify_gone=_gone)}"
        else:
            note += "NOT pruned (walk incomplete or empty)"
        healthy = db.end_run(run_id, ok=True, rows_seen=len(w["units"]), rows_upserted=len(rows), notes=note[:900],
                             check_tables=["asasmakeen_residential_listings"])
        if not healthy:
            print("✗ run demoted to unhealthy by end_run()", flush=True)
            return 1
        print(f"✓ {SOURCE}: {len(rows)} listings + {len(offplan)} off-plan upserted (STAGED — not searchable)", flush=True)
        return 0
    except Exception as e:  # noqa: BLE001
        if run_id:
            db.end_run(run_id, ok=False, rows_seen=len(w["units"]), rows_upserted=0, notes=f"{type(e).__name__}: {e}"[:300])
        raise


def _gone(ad_number: str) -> tuple[str, str]:
    return "gone", "absent from 3 consecutive COMPLETE reads of the site's own unit sitemap"


if __name__ == "__main__":
    raise SystemExit(main())
