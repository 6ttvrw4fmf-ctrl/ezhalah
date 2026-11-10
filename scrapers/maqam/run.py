"""شركة مقام للتطوير العقاري (maqamco.sa) — the developer's OWN site, rebuilt in November 2026.

WHAT CHANGED (measured live 2026-11-07, Playwright + honest UA «Ezhalah-bot/1.0», ≤ 1 request a second).
The office left the Nuzul storefront. property.maqamco.sa/properties/<id> now 308s to
maqamco.sa/properties/<id>, which answers «رمز الخطأ 404» — so all 42 served cards were dead links
(ops_served_link_check 2026-11-07: 20/20 dead). The old Nuzul API (maqamco.nzl-backend.com) still
answers 130 items «available», so the crawl and its oracle kept calling every dead card live: the API
is an abandoned back office, not what a customer sees. It is no longer read.

THE NEW SITE (robots.txt: Allow / · Disallow /portal /api/ /mcp /feedback)
  /sitemap.xml          the site's own complete list: /units/<n> (83 on 2026-11-07) + /projects/<n> (16).
  /units/<n>            server-rendered, a schema.org Product JSON-LD (name, sku = unit number, image[],
                        offers.price + availability) and the labels: the status badge first
                        («متاحة» / «محجوزة» / «مباعة» / «غير متاحة»), «رقم الوحدة», the type line
                        «شقة في عمارة · سكني», «ضمن مشروع X», «حي Y، الرياض، …», «المساحة», «غرف النوم»,
                        «دورات المياه», «الدور», «سعر الوحدة» (a figure or «السعر عند الطلب»), «مميزات الوحدة»,
                        and a Google Maps link carrying !3d<lat>!4d<lng>.
  /projects/<n>         the project card: its status first («متاح» / «على الخارطة» / «قريباً» / «مباع»).
                        A project with NO unit of its own that is «متاح» with «الأسعار تبدأ من» is sold
                        WHOLE (e.g. «مقام 13 البيع بالكامل», one building) — that page is the ad.
Every unit is a SALE (no rent word on any unit page). Off-plan («على الخارطة», e.g. مقام 19) is skipped
(owner 10-25: off-plan stored but hidden). Only «متاحة»/«متاح» is published.

KEYS. MQMU<unit id> / MQMP<project id>, listing_url = the page itself. The 42 old Nuzul rows (MQM<nuzul id>)
cannot appear again: after a COMPLETE walk they are hidden one by one only when their stored URL lands on
a 404 (redirects followed: that is the click a customer makes) while two live units from this run answer
before and after; each leaves an evidence row naming the new unit when the same unit number is on the
new site in the same district (owner 2026-11-07 «all links must work», Dwelleo precedent 11-05).

    python -m scrapers.maqam.run --dry-run
    python -m scrapers.maqam.run
"""
from __future__ import annotations

import argparse
import html as _html
import json
import re
import sys
import time
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Optional

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from curl_cffi import requests as cc  # noqa: E402 — honest client: no impersonate argument

from scrapers.common import db, honest_fetch as H, normalize as N  # noqa: E402
from scrapers.common.arabic_location import catalog_district, resolve  # noqa: E402
from scrapers.common.pii import redact_capture, redact_pii  # noqa: E402
from scrapers.common.page_pin import (  # noqa: E402
    _maps_url_in, pin_from_html, pin_from_short_link, short_maps_link)
from scrapers.common.source_pin import pin_dict  # noqa: E402

SOURCE = "شركة مقام للتطوير العقاري"
PLATFORM = SLUG = "maqam"
PREFIX = "MQM"
SITE = "https://maqamco.sa"
RES_TABLE = "maqam_residential_listings"
COM_TABLE = "maqam_commercial_listings"
OWNER_FOLLOW_SOURCE = "owner 2026-11-07: all links must work — the site moved"
_DISALLOW = ("/portal", "/api/", "/mcp", "/feedback")
_LIVE_UNIT, _LIVE_PROJECT = "متاحة", "متاح"
_TYPES = {"شقة في عمارة": "Apartment", "شقة": "Apartment", "فيلا": "Villa", "فلة": "Villa", "دور": "Floor",
          "عمارة": "Building", "أرض": "Residential Land", "دبلكس": "Duplex", "مكتب": "Office", "معرض": "Showroom"}
_FLOORS = {"الأرضي": 0, "الدور الأرضي": 0, "الأول": 1, "الدور الأول": 1, "الثاني": 2, "الدور الثاني": 2,
           "الثالث": 3, "الدور الثالث": 3, "الرابع": 4, "الدور الرابع": 4}
_PIN = re.compile(r"!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)")
_LD = re.compile(r'<script type="application/ld\+json">(.*?)</script>', re.S)


def _allowed(url: str) -> bool:
    if not url.startswith(SITE + "/"):
        return False
    return not url[len(SITE):].startswith(_DISALLOW)


def page_lines(page: str) -> list[str]:
    """The <main> block's visible text, one label or value per line."""
    m = re.search(r"<main.*?</main>", page, re.S)
    body = re.sub(r"<(script|style)[^>]*>.*?</\1>", "", m.group(0) if m else page, flags=re.S)
    return [s.strip() for s in _html.unescape(re.sub(r"<[^>]+>", "\n", body)).split("\n") if s.strip()]


def _after(lines: list[str], label: str) -> Optional[str]:
    return lines[lines.index(label) + 1] if label in lines and lines.index(label) + 1 < len(lines) else None


def _num(v: Any) -> Optional[float]:
    """The FIRST figure in the text («1,227,000 ر.س» → 1227000, «ر.س 897,000» → 897000), never digits glued together."""
    m = re.search(r"\d[\d,]*(?:\.\d+)?", str(v or "").translate(N._TRANS))
    f = float(m.group(0).replace(",", "")) if m else 0.0
    return f if f > 0 else None


def _product(page: str) -> dict:
    for blob in _LD.findall(page):
        try:
            data = json.loads(blob)
        except ValueError:
            continue
        for d in data if isinstance(data, list) else [data]:
            if isinstance(d, dict) and d.get("@type") == "Product":
                return d
    return {}


def parse_unit(page: str) -> Optional[dict]:
    """The unit's own facts, or None when the page is not a unit page."""
    lines = page_lines(page)
    if "وحدات أخرى في المشروع" in lines:               # sibling cards follow: never read them as ours
        lines = lines[:lines.index("وحدات أخرى في المشروع")]
    i = next((k for k, s in enumerate(lines) if s.startswith("رقم الوحدة")), None)
    if i is None or i == 0 or i + 3 >= len(lines):
        return None
    if ":" not in lines[i]:
        return None
    unit_no = lines[i].split(":", 1)[1].strip() or lines[i + 1]
    j = i + (1 if lines[i].rstrip().endswith(":") else 0)
    name, type_line = lines[j + 1], lines[j + 2]
    cat = lines[j + 4] if j + 4 < len(lines) and lines[j + 3] == "·" else None
    place = next((s for s in lines if "المملكة العربية السعودية" in s), None)
    parts = [p.strip() for p in (place or "").split("،")]
    pin = _PIN.search(page)
    return {"status": lines[i - 1], "unit_number": unit_no, "name": name, "type_ar": type_line, "category_ar": cat,
            "project": _after(lines, "ضمن مشروع"), "district": parts[0] if len(parts) > 1 else None,
            "city": parts[1] if len(parts) > 2 else None, "area": _after(lines, "المساحة"),
            "bedrooms": _after(lines, "غرف النوم"), "bathrooms": _after(lines, "دورات المياه"),
            "floor": _after(lines, "الدور"), "price_text": _after(lines, "سعر الوحدة"),
            "features": "\n".join(lines[lines.index("مميزات الوحدة") + 1:lines.index("بيانات العقار")])
            if "مميزات الوحدة" in lines and "بيانات العقار" in lines[lines.index("مميزات الوحدة"):] else
            _after(lines, "مميزات الوحدة"), "built_area": _after(lines, "مساحة البناء"),
            "pin": (pin.group(1), pin.group(2)) if pin else None, "ld": _product(page)}


def projects_from_listing(page: str) -> dict[int, dict]:
    """The /projects page's own project records (its Next.js payload: id, title, status, statusLabel, price,
    neighborhood, city, unitsArea, mapUrl …) — every card a visitor sees, one request for all of them. The
    project PAGES render client-side (their <main> is «جاري تحميل المشروع…»), so they are never parsed."""
    try:
        chunks = re.findall(r'self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)', page)
        s = "".join(json.loads(c) for c in chunks)
        i = s.find('"statusLabel"')
        start = s.rfind('[{"id":', 0, i) if i >= 0 else -1
        if start < 0:
            return {}
        arr, _ = json.JSONDecoder().raw_decode(s, start)
    except ValueError:                                  # a changed payload: walk incomplete, oracle unknown
        return {}
    return {int(p["id"]): p for p in arr if isinstance(p, dict) and str(p.get("id", "")).isdigit()}


def walk(get: Callable[[str], str] = lambda u: H.get_text(u, allowed=_allowed), log=print) -> dict:
    sm = get(f"{SITE}/sitemap.xml")
    locs = re.findall(r"<loc>\s*([^<\s]+)\s*</loc>", sm)
    unit_ids = sorted({int(m.group(1)) for u in locs if (m := re.search(r"/units/(\d+)$", u))})
    project_ids = sorted({int(m.group(1)) for u in locs if (m := re.search(r"/projects/(\d+)$", u))})
    bad: Counter = Counter()
    projects = projects_from_listing(get(f"{SITE}/projects"))
    if set(projects) != set(project_ids):
        bad["project_list_mismatch"] += 1
    units: dict[int, dict] = {}
    for uid in unit_ids:
        u = parse_unit(get(f"{SITE}/units/{uid}"))
        if u is None:
            bad["unit_unparsed"] += 1
            continue
        units[uid] = u
    log(f"  sitemap: {len(unit_ids)} units + {len(project_ids)} projects; /projects lists {len(projects)}")
    return {"units": units, "projects": projects, "listed": len(unit_ids),
            "listed_projects": len(project_ids), "bad": dict(bad)}


def complete(w: dict) -> bool:
    return not w["bad"] and len(w["units"]) == w["listed"] > 0 and len(w["projects"]) == w["listed_projects"] > 0


def _common(ad: str, url: str, name: str, ptype: str, city: Optional[str], district: Optional[str],
            pin: Optional[tuple], price_raw: Any) -> dict:
    r = resolve(city, district) if city else {}
    cid = r.get("city_id")
    price = _num(price_raw) if price_raw and "الطلب" not in str(price_raw) else None
    return {
        "ad_number": ad, "listing_url": url, "source": SOURCE, "active": True, "title": redact_pii(name) or None,
        "property_type": ptype, "transaction_type": "Buy",
        "city": N.map_city(r.get("city_ar") or city) if city else None, "city_ar": r.get("city_ar") or city,
        "city_id": cid, "region_id": r.get("region_id"), "neighborhood": district,
        "district_ar": catalog_district(cid, district) if (cid and district) else None,
        # PRICE = SOURCE: the page's own figure; «السعر عند الطلب» / none shown → NULL, never 0
        "price_total": int(price) if price else db.AUTHORITATIVE_NULL,
        "price_evidence": N.price_evidence(field="سعر الوحدة / offers.price", raw=price_raw,
                                           stored=int(price) if price else None, kind="total", unit="total",
                                           origin="structured", authoritative_absent=not price),
        "_pin": pin_dict(*pin) if pin else {}, "_por": bool(price_raw and "الطلب" in str(price_raw)),
    }


_SHORT_PIN_CACHE: dict[str, Optional[tuple]] = {}
_REDIRECTS = (301, 302, 303, 307, 308)


def _honest_resolve(url: str, hops: int = 4, sleep: Any = None, get: Any = None) -> Optional[str]:
    """The URL a short Maps link lands on, read with the OWNER'S HONEST CLIENT rules (CodeRabbit, PR #11247):
    our own bot UA, no impersonation, no proxy, one request START per H.MIN_GAP_S (the same clock as every
    other maqam read), only the 3xx Location header is read (Maps itself is never loaded), and a wall or any
    non-redirect answer stops the hop — None, never a retry around it."""
    get, sleep = get or cc.get, sleep or time.sleep
    cur = url
    for _ in range(hops):
        wait = H.MIN_GAP_S - (time.time() - H._last[0])
        if wait > 0:
            sleep(wait)
        H._last[0] = time.time()
        try:
            r = get(cur, headers={"User-Agent": H.UA}, allow_redirects=False, timeout=20)
        except Exception:  # noqa: BLE001 — a failed hop is «no pin this fetch», never a crash
            return None
        loc = r.headers.get("location") or r.headers.get("Location")
        if r.status_code in _REDIRECTS and loc:
            cur = loc
            if _maps_url_in(cur):
                return cur
            continue
        return None          # a wall, a challenge, a 200 page: stop, never bypass, never read Maps
    return None


def _project_pin(p: Optional[dict]) -> Optional[tuple]:
    """The project's own pin from its /projects record's mapUrl: the «!3d…!4d…» place shape, else any shape
    pin_from_html reads («?q=», «@lat,lng», «ll=»), else a maps.app.goo.gl link followed by the honest
    resolver — ONCE per link per run (every unit of a project shares its project's link). None otherwise."""
    url = (p or {}).get("mapUrl") or ""
    m = _PIN.search(url)
    if m:
        return m.group(1), m.group(2)
    got = pin_from_html(url) if url else {}
    if not got:
        short = short_maps_link(url)
        if not short:
            return None
        if short not in _SHORT_PIN_CACHE:
            hit = pin_from_short_link(short, _honest_resolve)
            _SHORT_PIN_CACHE[short] = ((hit["latitude"], hit["longitude"])
                                       if hit.get("latitude") is not None else None)
        return _SHORT_PIN_CACHE[short]
    return (got["latitude"], got["longitude"]) if got.get("latitude") is not None else None


def map_unit(uid: int, u: dict, projects_by_name: dict[str, dict]) -> tuple[Optional[tuple[dict, str]], str]:
    if u["status"] != _LIVE_UNIT:
        return None, f"status_{u['status']}"
    proj = projects_by_name.get(u.get("project") or "")
    if u.get("project") and proj is None:              # its project's status (off-plan?) is unknown: never guessed
        return None, "project_unmatched"
    if proj and proj.get("status") == "off_plan":
        return None, "offplan"
    ptype = _TYPES.get(u["type_ar"])
    if not ptype:
        return None, f"type_unknown_{u['type_ar']}"
    named = next((v for k, v in _TYPES.items() if u["name"].startswith(k)), None)
    if named and named != ptype:                       # «فلة الروضة 101» typed «شقة في عمارة»: never guessed
        return None, "type_conflict"
    cat = "commercial" if (u.get("category_ar") or "").startswith("تجاري") else "residential"
    ld = u.get("ld") or {}
    price_raw = (ld.get("offers") or {}).get("price") or u.get("price_text")
    # A unit page with no Maps link (مقام 17's units, re-read 42451335417) takes its PROJECT's own pin — the
    # parent page is place 4 of the four-place rule (rakez precedent). Never a city centre, never geocoded.
    unit_pin = u.get("pin") or _project_pin(proj)
    row = _common(f"{PREFIX}U{uid}", f"{SITE}/units/{uid}", f"{u['name']} ({u['unit_number']})", ptype,
                  u.get("city"), u.get("district"), unit_pin, price_raw)
    area = _num((u.get("area") or "").replace("م²", ""))
    beds, baths = _num(u.get("bedrooms")), _num(u.get("bathrooms"))
    pin, por = row.pop("_pin"), row.pop("_por")
    row.update({
        "area_m2": round(area, 2) if area else None,                  # verbatim to the cent (159.48000000000002)
        "bedrooms": int(beds) if beds and ptype != "Building" else None,   # 0 is the form default, never a count
        "bathrooms": int(baths) if baths else None,
        "floor_number": _FLOORS.get((u.get("floor") or "").strip()),
        "project_name": u.get("project"),
        "description": redact_pii(u.get("features"), keep_lines=True) or None,
        "photo_urls": [x for x in (ld.get("image") or []) if isinstance(x, str) and x.startswith(SITE)] or None,
    })
    info = {"source_id": str(uid), "unit_number": u["unit_number"], "status_ar": u["status"],
            "type_ar": u["type_ar"], "category_ar": u.get("category_ar"), "floor_text": u.get("floor"),
            "built_area_text": u.get("built_area"), "price_text": u.get("price_text"),
            "price_on_request": True if por else None, "project_status_ar": (proj or {}).get("statusLabel"), **pin}
    row["additional_info"] = {k: v for k, v in info.items() if v not in (None, "", [], {})}
    row["source_capture"] = {"schema": "maqamco.unit.v1", "unit": redact_capture({k: v for k, v in u.items() if k != "ld"}),
                             "jsonld": redact_capture(ld)}
    return (row, cat), ""


def map_whole_project(pid: int, p: dict, unit_projects: set[str]) -> tuple[Optional[tuple[dict, str]], str]:
    """A project sold WHOLE — no unit page names it, its card says «متاح» with a price (on 2026-11-07 only
    «مقام 13 البيع بالكامل», one mixed-use building at 11,500,000): the project page is the ad."""
    if p.get("title") in unit_projects:
        return None, "project_with_units"
    if p.get("statusLabel") != _LIVE_PROJECT:
        return None, f"project_status_{p.get('status')}"
    if p.get("hidePrice") or not _num(p.get("price")):
        return None, "project_without_price"
    row = _common(f"{PREFIX}P{pid}", f"{SITE}/projects/{pid}", p.get("title") or "", "Building", p.get("city"),
                  p.get("neighborhood"), _project_pin(p), p.get("price"))
    pin, _ = row.pop("_pin"), row.pop("_por")
    area = _num((p.get("unitsArea") or "").replace("م²", ""))
    row.update({"area_m2": round(area, 2) if area else None, "project_name": p.get("title"),
                "description": redact_pii(p.get("description"), keep_lines=True) or None,
                "photo_urls": [SITE + x for x in (p.get("gallery") or []) if isinstance(x, str) and x.startswith("/")] or None})
    info = {"source_id": f"project/{pid}", "status_ar": p.get("statusLabel"), "sold_whole": True,
            "type_ar": p.get("propertyType"), "total_area_text": p.get("area"), "units_count_text": p.get("totalUnitsCount"),
            "price_text": p.get("price"), **pin}
    row["additional_info"] = {k: v for k, v in info.items() if v not in (None, "", [], {})}
    row["source_capture"] = {"schema": "maqamco.project.v1", "project": redact_capture(p)}
    return (row, "residential"), ""


# ── LIVENESS: the ad's own page ────────────────────────────────────────────────────────────────
def _status(url: str) -> tuple[Optional[int], str]:
    """(final HTTP status after redirects, page text) of one polite read; (None, '') when unreadable or walled."""
    wait = H.MIN_GAP_S - (time.time() - H._last[0])
    if wait > 0:
        time.sleep(wait)
    H._last[0] = time.time()
    try:
        r = cc.get(url, headers={"User-Agent": H.UA, "Accept": "text/html", "Accept-Language": "ar"},
                   timeout=40, allow_redirects=True)
    except Exception:  # noqa: BLE001 — unreadable is no opinion
        return None, ""
    low = (r.text or "")[:4000].lower()
    if r.status_code in (401, 403, 429, 503) or any(w in low for w in H.WALL_WORDS):
        return None, ""
    return r.status_code, r.text or ""


def read_own_page(ad_number: str, listing_url: Optional[str] = None,
                  status: Callable[[str], tuple[Optional[int], str]] = _status) -> tuple[str, str]:
    """live / gone / unknown from the card's OWN link. New keys read their page's badge; an old Nuzul
    key (MQM<digits>) reads its stored URL — a 404 there is exactly what the customer gets."""
    m = re.fullmatch(rf"{PREFIX}(U|P)?(\d+)", ad_number or "")
    if not m:
        return "unknown", f"{ad_number!r} is not a maqam ad number"
    kind, n = m.groups()
    url = {"U": f"{SITE}/units/{n}", "P": f"{SITE}/projects/{n}"}.get(kind or "", listing_url or
                                                                    f"https://property.maqamco.sa/properties/{n}")
    st, page = status(url)
    if st == 404:
        return "gone", f"{url} answers HTTP 404"
    if st != 200:
        return "unknown", f"{url} answered {st}"
    if not kind:
        return "unknown", f"old Nuzul URL {url} answered 200"
    if kind == "U":
        badge = (parse_unit(page) or {}).get("status")
    else:                                              # project pages render client-side: read its card
        lst, lpage = status(f"{SITE}/projects")
        badge = (projects_from_listing(lpage).get(int(n)) or {}).get("statusLabel") if lst == 200 else None
    if badge is None:
        return "unknown", f"{url} answered 200 but its badge was not read"
    live = badge == (_LIVE_UNIT if kind == "U" else _LIVE_PROJECT)
    return ("live" if live else "gone"), f"{url} badge «{badge}»"


def _make_verify_gone(control: Optional[dict] = None, status: Callable[[str], tuple[Optional[int], str]] = _status):
    """The one-argument oracle (fleet_liveness): a removal counts only while the control row reads live."""
    memo: dict[str, bool] = {}

    def control_ok() -> bool:
        if "v" not in memo:
            memo["v"] = bool(control) and read_own_page(str(control.get("ad_number") or ""),
                                                        control.get("listing_url"), status)[0] == "live"
        return memo["v"]

    def verify(ad_number: str) -> tuple[str, str]:
        verdict, why = read_own_page(ad_number, None, status)
        if verdict == "gone" and not control_ok():
            return "unknown", f"control not live, removal withheld ({why})"
        return verdict, why
    return verify


def follow_source_hide(table: str, seen: set[str], controls: list[dict], new_by_unit: dict[tuple, str],
                       status: Callable[[str], tuple[Optional[int], str]] = _status) -> tuple[int, int, str]:
    """After the collapse guard refused a COMPLETE walk: hide each unseen row whose OWN stored link reads
    gone, with 2 live controls before and after. Evidence per row in ops_stale_inactivation_probe."""
    if len(controls) < 2:
        return 0, 0, "fewer than 2 live controls from this run"
    ok = lambda: all(read_own_page(r["ad_number"], r["listing_url"], status)[0] == "live" for r in controls[:2])  # noqa: E731
    c = db.sb()
    rows = db._execute(c.table(table).select("ad_number,listing_url,district_ar,source_capture").eq("active", True)
                       .eq("source", SOURCE), what=table + ".follow_source_select").data or []
    unseen = [r for r in rows if r["ad_number"] not in seen]
    if not unseen:
        return 0, 0, "nothing unseen"
    if not ok():
        return 0, len(unseen), "controls not live before: stopped"
    proven, evidence = [], []
    for r in unseen:
        verdict, why = read_own_page(r["ad_number"], r.get("listing_url"), status)
        un = str(((r.get("source_capture") or {}).get("item") or {}).get("unit_number")
                 or (r.get("source_capture") or {}).get("unit_number") or "")
        moved = new_by_unit.get((r.get("district_ar"), un))
        (proven.append(r["ad_number"]) if verdict == "gone" else None)
        evidence.append({"source_table": table, "ad_number": r["ad_number"], "listing_url": r.get("listing_url") or "",
                         "verdict": "GONE" if verdict == "gone" else "UNKNOWN", "oracle": "maqam.follow_source",
                         "note": (f"{OWNER_FOLLOW_SOURCE} | {why} | "
                                  + (f"same unit {un} now served as {moved}" if moved else "no unit with this number in this district on the new site"))[:500]})
    if not ok():
        return 0, len(unseen), "controls not live after: hides withheld"
    try:                                               # evidence FIRST: no hide without its record
        db._execute(c.table("ops_stale_inactivation_probe").insert(evidence), what="ops_stale_inactivation_probe.insert")
    except Exception as e:  # noqa: BLE001
        return 0, len(unseen), f"evidence not written ({type(e).__name__}): hides withheld"
    now = datetime.now(timezone.utc).isoformat()
    if proven:
        db._execute(c.table(table).update({"active": False, "deactivated_at": now, "last_liveness_probe_at": now})
                    .in_("ad_number", proven).eq("active", True), what=table + ".follow_source_hide")
    return len(proven), len(unseen) - len(proven), "done"


def main(argv: Optional[list[str]] = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--type", choices=["residential", "commercial", "all"], default="all")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--save", default="")
    a = ap.parse_args(argv)
    run_id = None if a.dry_run else db.begin_run(PLATFORM)
    w: dict = {"units": {}}
    try:
        w = walk()
        by_name = {p["title"]: p for p in w["projects"].values() if p.get("title")}
        unit_projects = {u["project"] for u in w["units"].values() if u.get("project")}
        res, com, skipped = [], [], Counter()
        for uid, u in w["units"].items():
            got, why = map_unit(uid, u, by_name)
            if got:
                (res if got[1] == "residential" else com).append(got[0])
            else:
                skipped[why] += 1
        for pid, p in w["projects"].items():
            got, why = map_whole_project(pid, p, unit_projects)
            if got:
                res.append(got[0])
            elif why != "project_with_units":
                skipped[why] += 1
        ok = complete(w)
        cover = {"units": f"{len(w['units'])}/{w['listed']}", "projects": f"{len(w['projects'])}/{w['listed_projects']}",
                 "bad": w["bad"], "complete": ok}
        print(f"  coverage: {json.dumps(cover, ensure_ascii=False)}\n  mapped: {len(res)} residential + {len(com)} "
              f"commercial; skipped (not guessed): {dict(skipped)}", flush=True)
        if a.save:
            Path(a.save).write_text(json.dumps(res + com, ensure_ascii=False, default=str))
        if a.dry_run:
            return 0
        if not (res or com):
            raise RuntimeError("the new site listed no publishable ad")
        if a.type != "all":
            res, com = (res, []) if a.type == "residential" else ([], com)
        db.upsert_maqam_residential_batch(res)
        db.upsert_maqam_commercial_batch(com)
        notes = [f"coverage {json.dumps(cover, ensure_ascii=False)}", f"skipped {dict(skipped)}"]
        sup = db.retire_superseded_siblings(res_table=RES_TABLE, com_table=COM_TABLE, res_ads={r["ad_number"] for r in res},
                                            com_ads={r["ad_number"] for r in com}, source=SOURCE)
        if sup:
            notes.append(f"superseded={sup}")
        degraded = False
        if a.type == "all" and ok:
            seen = {r["ad_number"] for r in res + com}
            controls = [r for r in res + com if r["ad_number"].startswith(PREFIX + "U")][:2]
            new_by_unit = {(r.get("district_ar"), r["additional_info"].get("unit_number")): r["ad_number"] for r in res + com}
            verify = _make_verify_gone(controls[0] if controls else None)
            for tbl, rows in ((RES_TABLE, res), (COM_TABLE, com)):
                n = db.prune_unseen(tbl, {r["ad_number"] for r in rows}, SOURCE, verify_gone=verify)
                if n < 0:
                    h, k, why = follow_source_hide(tbl, seen, controls, new_by_unit)
                    notes.append(f"{tbl} guard refused → {OWNER_FOLLOW_SOURCE}: hidden={h} kept={k} ({why})")
                    degraded = degraded or k > 0
                else:
                    notes.append(f"{tbl} pruned={n}")
        else:
            notes.append("NOT pruned (" + ("walk incomplete" if not ok else f"--type {a.type}") + ")")
        healthy = db.end_run(run_id, ok=True, rows_seen=len(w["units"]), rows_upserted=len(res) + len(com),
                             degraded=degraded, notes="; ".join(notes)[:900],
                             check_tables=["maqam_residential_listings", "maqam_commercial_listings"])
        if not healthy:
            print("✗ run demoted to unhealthy by end_run()", flush=True)
            return 1
        print(f"✓ {SOURCE}: {len(res)} residential + {len(com)} commercial upserted | " + "; ".join(notes[2:]), flush=True)
        return 0
    except Exception as e:  # noqa: BLE001
        if run_id:
            db.end_run(run_id, ok=False, rows_seen=len(w["units"]), rows_upserted=0, notes=f"{type(e).__name__}: {e}"[:300])
        print(f"✗ {SOURCE}: {e}", flush=True)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
