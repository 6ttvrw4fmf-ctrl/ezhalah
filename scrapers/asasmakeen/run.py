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
  NO PIN on the unit page and NO REGA licence (licence NULL). The district is the page's own «الحي» line / project
  district. THE PIN IS THE PARENT PROJECT'S (AGENTS «look in four places», 2026-11-05): every unit page lists the
  projects as <option data-slug=…>«مكين 90 - حي المنار»</option>, and the project page /ar/مشاريعنا/<slug> (robots
  allows it; sitemap-projects-ar.xml) draws «موقع المشروع» with a Google directions link «destination=<lat>,<lng>»
  — the building's own pin (the embed beside it is the map CENTRE, usually +0.0026° east of the pin: never read).
  The unit inherits it as additional_info latitude/longitude + pin_scope «project» (one pair shared by the whole
  building is the source's truth — the pin loader keeps treating a shared pair as shared). A project page with no
  map → no pin (pin_absent). CITY: the title («… بشمال الرياض …») or, when the title names none («شقة 212م بحي
  المنار», 28 units of مكين 90), the project's own «معلومات عن المشروع» text («… شرق مدينة الرياض») — never the
  footer's company address.
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
from scrapers.facts.one_reader import amenity_answers  # noqa: E402
from scrapers.common.pii import redact_pii  # noqa: E402
from scrapers.common.source_pin import pin_dict  # noqa: E402
from scrapers.common.http_liveness import stored_listing_url  # noqa: E402

PROSE_COLS = ("kitchen", "parking", "elevator", "maid_room", "driver_room", "air_conditioner", "private_entrance", "furnished", "balcony_terrace", "laundry_room")
SOURCE = "Asas Makeen"
SLUG = "asasmakeen"
PREFIX = "ASM"
RES_TABLE = "asasmakeen_residential_listings"
OFFPLAN_TABLE = "asasmakeen_offplan_units"
SITE = "https://asasmakeen.com"
SITEMAP = SITE + "/sitemap-units-ar.xml"
PROJECTS_SITEMAP = SITE + "/sitemap-projects-ar.xml"
OFFPLAN_PAGES = (SITE + "/ar/" + quote("مشاريعنا") + "/" + quote("بيع-على-الخارطة"),
                 SITE + "/ar/" + quote("مشاريعنا") + "/" + quote("تحت-الإنشاء"))
UNIT_PATH = "/ar/" + quote("وحدة") + "/"
PROJECT_PATH = "/ar/" + quote("مشاريعنا") + "/"

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
_SLUG_RE = re.compile(r'data-slug="([^"]+)">\s*([^<]+?)\s*</option>')
_DEST_RE = re.compile(r'project-location-map__directions"\s+href="[^"]*destination=(-?\d{1,2}\.\d+)%2C(-?\d{1,3}\.\d+)"')
_H1_RE = re.compile(r"<h1[^>]*>(.*?)</h1>", re.S)
_ABOUT_RE = re.compile(r'معلومات عن المشروع</h2>\s*<div class="fs-5 lh-lg">(.*?)</div>', re.S)
_FLOOR = {"الأرضي": 0, "الأول": 1, "الثاني": 2, "الثالث": 3, "الرابع": 4, "الخامس": 5, "الروف": None, "الملحق": None}
_WORD_BATHS = (("دورتان", 2), ("دورتين", 2), ("دورة", 1))


def _allowed(url: str) -> bool:
    return url in (SITEMAP, PROJECTS_SITEMAP) or url in OFFPLAN_PAGES or url.startswith(SITE + UNIT_PATH) or url.startswith(SITE + PROJECT_PATH)


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


def project_slugs(page: str) -> dict[str, str]:
    """«مكين 90 - حي المنار» → «مكين-90»: the project picker every unit page carries."""
    return {_text(name).partition(" - ")[0].strip(): _html.unescape(slug) for slug, name in _SLUG_RE.findall(page)}


def parse_project(page: str) -> dict:
    """The project page's own pin (directions link) and whether its own description names Riyadh."""
    m = _DEST_RE.search(page)
    about = _text(_g(_ABOUT_RE, page))
    return {"pin": pin_dict(m.group(1), m.group(2)) if m else {}, "riyadh": "الرياض" in about,
            "name": _text(_g(_H1_RE, page))}


def offplan_projects(get=H.get_text) -> set[str]:
    out: set[str] = set()
    for u in OFFPLAN_PAGES:
        out |= {_text(n) for n in re.findall(r"<h[2-5][^>]*>\s*([^<]{2,60}?)\s*</h[2-5]>", get(u, allowed=_allowed))
                if "الريادة" not in n}
    return out


def map_unit(uid: str, url: str, u: dict, project: Optional[dict] = None) -> tuple[Optional[dict], str]:
    """`project` = parse_project() of the unit's project page read this crawl (None = not read: no pin
    claim either way)."""
    deal = {"بيع": "Buy", "تأجير": "Rent"}.get(u["badge"])
    if not deal:
        return None, f"badge_{u['badge'] or 'none'}"
    ptype = N.map_type(u["title"])
    if ptype != "Apartment":
        return None, f"type_{ptype or 'unmapped'}"
    district = (u["labelled"].get("الحي") or u["project_district"].removeprefix("حي ").strip()) or None
    city = "الرياض" if "الرياض" in u["title"] or (project or {}).get("riyadh") else None
    r = resolve(city, district) if city else {}
    cid = r.get("city_id")
    price = N.to_int(u["price_raw"])
    desc = redact_pii("\n".join(u["specs"]), keep_lines=True) or None
    area = N.to_int(re.sub(r"م2|م²", "", u["labelled"].get("المساحة", "")))
    # ONE READER (owner 2026-11-03): prose amenities come from the Advanced Filter's word reader, never normalize.prose_amenities.
    prose = amenity_answers("\n".join(u["features"]), PROSE_COLS, {"balcony": "balcony_terrace"})
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
            "price_label": u["price_raw"] or None}
    if project is not None:
        info.update({**project["pin"], "pin_scope": "project", "pin_source": "parent project page (directions link)"}
                    if project["pin"] else {"pin_absent": True, "pin_source": "none (the project page draws no map)"})
    row["additional_info"] = {k: v for k, v in info.items() if v not in (None, "", [], {})}
    row["source_capture"] = {"schema": "asasmakeen.unit.v1", "item": {k: v for k, v in u.items() if k != "images"},
                             "images": u["images"]}
    return row, ""


def _project(slug: str) -> Optional[dict]:
    try:
        return parse_project(H.get_text(SITE + PROJECT_PATH + quote(slug), allowed=_allowed))
    except H.Blocked as e:
        if " 404 " in str(e) or " 410 " in str(e):
            return None                 # a gone project page: its units carry no pin claim either way
        raise


def walk(limit: int = 0, log=print) -> dict:
    sm = H.get_text(SITEMAP, allowed=_allowed)
    urls = list(dict.fromkeys(_html.unescape(x) for x in re.findall(r"<loc>\s*([^<]+?)\s*</loc>", sm)))
    urls = [u for u in urls if u.startswith(SITE + UNIT_PATH)]
    listed = len(urls)
    if limit:
        urls = urls[:limit]
    units: dict[str, tuple[str, dict]] = {}
    slugs: dict[str, str] = {}
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
        slugs.update(project_slugs(page))
        p = parse_unit(page)
        if p is None:
            bad["no_unit_block"] += 1
            continue
        units[uid] = (u, p)
        if i % 100 == 0:
            log(f"  {i}/{len(urls)} pages read")
    projects: dict[str, dict] = {}
    names = {p["project"] for _, p in units.values()} - {""}
    if names - slugs.keys():
        # an older project («مكين 34») is no longer in the picker; the site's project sitemap still lists its page
        # («مكين-34-شقق-حي-العارض»). A candidate counts only when the page's own <h1> is the project's name.
        sm = H.get_text(PROJECTS_SITEMAP, allowed=_allowed)
        listed_slugs = [unquote(x).rsplit("/", 1)[1] for x in re.findall(r"<loc>\s*([^<]+?)\s*</loc>", sm)]
        for name in sorted(names - slugs.keys()):
            stem = name.replace(" ", "-")
            for cand in (x for x in listed_slugs if x == stem or x.startswith(stem + "-")):
                got = _project(cand)
                if got and got["name"] == name:
                    projects[name] = got
                    break
    for name in sorted(names & slugs.keys()):
        got = _project(slugs[name])
        if got:
            projects[name] = got
    return {"listed": listed, "read": len(urls), "units": units, "bad": bad, "limited": bool(limit), "projects": projects}


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
            row, why = map_unit(uid, url, u, w["projects"].get(u["project"]))
            (rows.append(row) if row else skipped.update([why]))
        # A sitemap unit whose OWN page answers 404/410 is a removed ad, not an unreadable walk: it must not freeze every
        # prune (the mrajhi lesson of 2026-11-07; ♻️ 2026-11-13). Any other bad page still makes the walk incomplete.
        gone404 = w["bad"].get("gone_404", 0)
        ok = not w["limited"] and not (set(w["bad"]) - {"gone_404"}) and len(w["units"]) + gone404 == w["listed"] > 0
        cover = {"sitemap": w["listed"], "read": w["read"], "parsed": len(w["units"]), "bad": dict(w["bad"]),
                 "complete": ok, "offplan_projects": sorted(off),
                 "project_pins": sum(1 for p in w["projects"].values() if p["pin"]), "projects_read": len(w["projects"])}
        print(f"  coverage: {json.dumps(cover, ensure_ascii=False)}\n  mapped: {len(rows)} listings "
              f"({Counter(r['transaction_type'] for r in rows)}); off-plan stored hidden: {len(offplan)}; "
              f"skipped (not guessed): {dict(skipped)}", flush=True)
        if a.save:
            Path(a.save).write_text(json.dumps({"rows": rows, "offplan": offplan}, ensure_ascii=False, default=str))
        if a.dry_run:
            return 0
        db.upsert_asasmakeen_residential_batch(rows)
        db.upsert_asasmakeen_offplan(offplan)
        note = f"coverage {json.dumps(cover, ensure_ascii=False)}; offplan={len(offplan)}; "
        _GONE[0] = _make_gone(next((r["listing_url"] for r in rows), None))
        if rows and ok:
            note += f"pruned={db.prune_unseen(RES_TABLE, {r['ad_number'] for r in rows}, source=SOURCE, verify_gone=_gone)}"
        else:
            note += "NOT pruned (walk incomplete or empty)"
        healthy = db.end_run(run_id, ok=True, rows_seen=len(w["units"]), rows_upserted=len(rows), notes=note[:900],
                             check_tables=["asasmakeen_residential_listings"])
        if not healthy:
            print("✗ run demoted to unhealthy by end_run()", flush=True)
            return 1
        print(f"✓ {SOURCE}: {len(rows)} listings + {len(offplan)} off-plan upserted", flush=True)
        return 0
    except Exception as e:  # noqa: BLE001
        if run_id:
            db.end_run(run_id, ok=False, rows_seen=len(w["units"]), rows_upserted=0, notes=f"{type(e).__name__}: {e}"[:300])
        raise


def _page(url: str) -> tuple[Optional[int], str]:
    """The ad page's own HTTP status and body (honest client, its 1 s gap); (None, "") when unreadable or walled."""
    try:
        r = H.request("GET", url, allowed=_allowed, accept="text/html")
        return r.status_code, r.text or ""
    except H.Blocked as e:
        m = re.search(r"HTTP (404|410) at ", str(e))
        return (int(m.group(1)), "") if m else (None, "")
    except Exception:  # noqa: BLE001 — unreadable is no opinion
        return None, ""


def _make_gone(control_url: Optional[str], page=_page, url_for=None):
    """prune_unseen's answer at grace, from the ad's OWN page (LISTING_LIVENESS.md §2; ♻️ 2026-11-13). Until today it
    held every candidate UNKNOWN, so ASM2676 (24218552) sat at 3 strikes, served, while its page answered 404 to the
    09:05 dead-visible score (2 of 10 sampled gone). 404/410 is gone, 200 WITH the unit block is live, anything else
    (a 200 shell, a wall, a timeout) is unknown — and a removal counts only while this run's control unit reads live."""
    memo: dict[str, bool] = {}
    url_for = url_for or stored_listing_url((RES_TABLE,))

    def gone(ad_number: str) -> tuple[str, str]:
        url = url_for(ad_number)
        if not url or not url.startswith(SITE + UNIT_PATH):
            return "unknown", f"{ad_number!r} has no stored {SITE}{UNIT_PATH} page to read"
        st, body = page(url)
        if st == 200 and parse_unit(body) is not None:
            return "live", f"{url} answers 200 with its unit block"
        if st not in (404, 410):
            return "unknown", f"{url} answered {st}" + (" without a unit block" if st == 200 else "")
        if "v" not in memo:
            cst, cbody = page(control_url) if control_url else (None, "")
            memo["v"] = cst == 200 and parse_unit(cbody) is not None
        if not memo["v"]:
            return "unknown", f"{url} answers {st} but the control {control_url} did not read live"
        return "gone", f"{url} answers HTTP {st} (control {control_url} live)"
    return gone


_GONE = [_make_gone(None)]          # main() binds this run's control before any prune


def _gone(ad_number: str) -> tuple[str, str]:
    return _GONE[0](ad_number)


if __name__ == "__main__":
    raise SystemExit(main())
