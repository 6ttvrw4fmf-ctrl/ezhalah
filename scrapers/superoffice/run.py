"""SuperOffice («سوبر أوفيس», superoffice.sa) — a Riyadh serviced-office operator. Onboarding 2026-09-27
(owner: «yeah lets add it» — the AVAILABLE private offices only).

SOURCE SHAPE (measured live 2026-09-27)
=======================================
Server-rendered Laravel HTML. /sitemap.xml lists 184 /ar/office-details/<slug> pages, EACH TWICE
(368 <loc> lines; deduped), + the /en/ copies (never walked). Each page's `<div class="content-one">` carries, in order:
  the office's own address line («صيدا ، الدريهمية ، الرياض 12791»), <h2> the name («مكتب خاص A-13»),
  <div class="price"> «2719.30 ريال / شهر», then an actions row whose FIRST button is the status:
  «احجز» (a /book/<n> link — available) or «محجوز» (booked). The breadcrumb's middle crumb is the
  space kind: «مكاتب خاصة» (private office) or «غرفة الاجتماعات» (meeting room, no monthly price).
Measured: 177 private offices (12 «احجز», 165 «محجوز») + 7 meeting rooms, 3 branches in Riyadh.

TRAPS
-----
1. ONLY «مكاتب خاصة» + «احجز» is a listing. A booked office is let; a meeting room is hourly and has
   no monthly price — both skipped with a counted reason, never guessed. A booked office that frees
   up simply appears on the next crawl; one that gets booked is pruned by the seen-set.
2. PRICE = SOURCE: «3499.76 ريال / شهر» → to_int truncates the halalas (3,499) and the shared
   rent_period_from_ad reads «شهر» → monthly (stored ×12, the fleet convention).
3. DISTRICT comes from the page's OWN address line, not the branch's marketing name: the «السويدي»
   branch's address says «الدريهمية». The line is read one «،» part at a time (the whole line never
   matches) and road/building parts are skipped («طريق الملك عبد العزيز» is not the district
   الملك عبدالعزيز). The branch name is kept in additional_info.
4. No area is published — capacity is in persons on the cards only → area_m2 NULL.
5. The map iframe's coordinates are a zoomed-out VIEWPORT centre (≈25 km off) → never stored.
6. PDPL: the 920 number and info@ address are the company's switchboard in the page chrome — never read.
"""
from __future__ import annotations

import argparse
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
from scrapers.common.arabic_location import find_district_in_text, to_catalog  # noqa: E402
from scrapers.common.pii import redact_capture, redact_pii, strip_pii_fields  # noqa: E402

BASE = "https://superoffice.sa"
SOURCE = "سوبر أوفيس"
PREFIX = "SPO"
SLUG = "superoffice"
IMPERSONATE = "chrome"
CITY_AR = "الرياض"          # every branch is in Riyadh; the address line must still name it

_URL_RE = re.compile(r"<loc>(https://superoffice\.sa/ar/office-details/[^<]+)</loc>")
_ROAD_RE = re.compile(r"(طريق|شارع|المبنى|مبنى)\b")
_BRANCHES = {"العارض": "al-aarid", "السويدي": "suwaidi", "الروضة": "rawdah"}


class Gone(Exception):
    pass


def get(s: cc.Session, url: str) -> str:
    for attempt in range(3):
        try:
            r = s.get(url, impersonate=IMPERSONATE, timeout=40)
            if r.status_code == 404:
                raise Gone(url)
            r.raise_for_status()
            return r.text
        except Gone:
            raise
        except Exception:  # noqa: BLE001
            if attempt == 2:
                raise
            time.sleep(2 + attempt * 3)
    return ""


def _text(s: str) -> str:
    return re.sub(r"\s+", " ", ihtml.unescape(re.sub(r"<[^>]+>", " ", s))).strip()


def _grab(pattern: str, s: str) -> str:
    m = re.search(pattern, s, re.S)
    return m.group(1) if m else ""


def parse_page(url: str, page: str) -> dict[str, Any]:
    crumbs = [_text(c).lstrip("/ ").strip() for c in re.findall(
        r"<li>(.*?)</li>", _grab(r'<ul class="bread-crumb[^"]*">(.*?)</ul>', page), re.S)]
    b = _grab(r'<div class="content-one">(.*?)<h3 class="service_title"', page) or _grab(
        r'<div class="content-one">(.*)', page)
    act = re.search(r'<div class="actions_div">\s*<a([^>]*)>(.*?)</a>', b, re.S)
    return {
        "url": url,
        "slug": url.rsplit("/", 1)[-1],
        "kind": crumbs[1] if len(crumbs) >= 3 else None,
        "address": _text(_grab(r'<div class="text">(.*?)</div>', b)) or None,
        "name": _text(_grab(r"<h2>(.*?)</h2>", b)) or None,
        "price_text": _text(_grab(r'<div class="price">(.*?)</div>', b)) or None,
        "status": _text(act.group(2)) if act else None,
        "book_link": bool(act and "/book/" in act.group(1)),
        "description": _text(b.split("</div>", 3)[-1]) if act else "",   # the prose after the actions row
        "services": [x for x in (_text(li) for li in re.findall(
            r"<li>(.*?)</li>", _grab(r'<ul class="service_ul">(.*?)</ul>', page), re.S)) if x],
        "photos": list(dict.fromkeys(re.findall(r'<img src="(https://superoffice\.sa/uploads/offices/[^"]+)"',
                                                _grab(r'<div class="carousel-outer">(.*?)<div class="auto-container">', page)))),
    }


def map_page(d: dict[str, Any]) -> tuple[Optional[tuple[dict, str]], str]:
    if d.get("kind") != "مكاتب خاصة":
        return None, f"kind_{d.get('kind') or 'none'}"
    if d.get("status") != "احجز" or not d.get("book_link"):
        return None, f"status_{d.get('status') or 'none'}"
    ptype = normalize.map_type_exact("مكتب")
    title = d.get("name") or ""
    price_text = d.get("price_text") or ""
    price = normalize.to_int(price_text)
    price = price if price and price > 0 else None
    # «ريال / شهر» is the ad's own words about THIS price → the shared rule reads it
    period, annual = normalize.rent_period_from_ad(price, price_text, None, title)

    addr = d.get("address") or ""
    city_ar = CITY_AR if CITY_AR in addr else None
    if not city_ar:
        return None, "city_not_in_address"
    city_id, region_id = to_catalog(city_ar)
    # one address PART at a time (the whole line never matches), road/building parts never read; a
    # line naming two districts is ambiguous → NULL
    hits = {find_district_in_text(part.strip(), city_id) for part in addr.split("،")
            if city_id and part.strip() and CITY_AR not in part and not _ROAD_RE.match(part.strip())} - {None}
    district_ar = hits.pop() if len(hits) == 1 else None
    branch = next((ar for ar, en in _BRANCHES.items() if ar in d["slug"] or en in d["slug"].lower()), None)
    row: dict[str, Any] = {
        "ad_number": f"{PREFIX}{d['slug']}",
        "listing_url": d["url"],
        "source": SOURCE,
        "active": True,
        "title": redact_pii(title) or None,
        "description": redact_pii(d.get("description", "")[:4000]) or None,
        "property_type": ptype,
        "transaction_type": "Rent",
        "city": normalize.map_city(city_ar),
        "city_ar": city_ar,
        "city_id": city_id,
        "region_id": region_id,
        "district_ar": district_ar,
        "neighborhood": district_ar,
        "area_m2": None,
        "license_number": None,
        "photo_urls": d.get("photos") or list(),
        "rent_period": period,
        "price_annual": annual,
    }
    for sv in d.get("services") or []:
        row.update(normalize.amenities_from_text(sv))
    if "أثاث" in (d.get("services") or []):      # the office's own service list: «أثاث» (furniture)
        row["furnished"] = True
    row["price_evidence"] = normalize.price_evidence(
        field="div.price", raw=price_text, stored=annual, kind="annual", unit="total",
        origin="html", authoritative_absent=False)
    info = {
        "source_slug": d["slug"],
        "space_kind_ar": d.get("kind"),
        "branch": branch,
        "address_ar": addr or None,
        "price_text": price_text or None,
        "services_ar": d.get("services") or None,
    }
    row["additional_info"] = redact_capture(strip_pii_fields({k: v for k, v in info.items() if v not in (None, "", [], {})}))
    row["source_capture"] = redact_capture(strip_pii_fields({"schema": "superoffice.html.v1", **{
        k: d.get(k) for k in ("kind", "address", "name", "price_text", "status", "services")}}))
    return (row, normalize.category_for_type(ptype).lower()), ""


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--type", default="all")
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()
    dry = a.dry_run

    s = cc.Session()
    urls = list(dict.fromkeys(_URL_RE.findall(get(s, f"{BASE}/sitemap.xml"))))
    print(f"{SOURCE}: {len(urls)} Arabic office page(s) on its sitemap", flush=True)

    run_id = None if dry else db.begin_run(SLUG)
    res: list[dict] = []
    com: list[dict] = []
    skipped: dict[str, int] = {}
    unreadable = 0
    try:
        for url in urls:
            try:
                d = parse_page(url, get(s, url))
            except Gone:
                skipped["gone_404"] = skipped.get("gone_404", 0) + 1
                continue
            except Exception:  # noqa: BLE001
                unreadable += 1
                continue
            got, why = map_page(d)
            if not got:
                skipped[why] = skipped.get(why, 0) + 1
                continue
            row, cat = got
            (com if cat == "commercial" else res).append(row)
            time.sleep(0.3)
        if skipped:
            print("  skipped (not guessed): "
                  + ", ".join(f"{k}x{v}" for k, v in sorted(skipped.items())), flush=True)
        if dry:
            print(f"DRY: {len(res)} residential + {len(com)} commercial ({unreadable} unreadable)")
            for row in res + com:
                print("   ", json.dumps({k: row.get(k) for k in
                      ("ad_number", "property_type", "price_annual", "rent_period", "district_ar", "neighborhood",
                       "furnished")}, ensure_ascii=False)[:260], len(row["photo_urls"]))
            return 0

        db.upsert_superoffice_residential_batch(res)
        db.upsert_superoffice_commercial_batch(com)
        superseded = db.retire_superseded_siblings(
            res_table="superoffice_residential_listings", com_table="superoffice_commercial_listings",
            res_ads={r["ad_number"] for r in res}, com_ads={r["ad_number"] for r in com}, source=SOURCE)
        if superseded:
            print(f"  retired {superseded} superseded sibling row(s) after a category flip", flush=True)
        complete = unreadable == 0 and len(urls) > 0
        for tbl, rr in (("superoffice_residential_listings", res), ("superoffice_commercial_listings", com)):
            if rr and complete:
                n = db.prune_unseen(tbl, {r["ad_number"] for r in rr}, source=SOURCE)
                if n < 0:
                    print(f"  ⚠ {tbl}: prune guard tripped — kept existing active rows", flush=True)
                elif n:
                    print(f"  pruned {n} from {tbl}", flush=True)
        if not complete:
            print(f"  NOT pruning: {unreadable} of {len(urls)} page(s) unreadable", flush=True)
        healthy = db.end_run(run_id, ok=True, rows_seen=len(urls), rows_upserted=len(res) + len(com),
                             check_tables=["superoffice_residential_listings", "superoffice_commercial_listings"])
        if not healthy:
            print("✗ run demoted to unhealthy by end_run()", flush=True)
            return 1
        print(f"✓ {SOURCE}: {len(res)} residential + {len(com)} commercial upserted", flush=True)
        return 0
    except Exception as e:  # noqa: BLE001
        if run_id:
            db.end_run(run_id, ok=False, rows_seen=len(urls), rows_upserted=0, notes=str(e)[:300])
        raise


if __name__ == "__main__":
    raise SystemExit(main())
