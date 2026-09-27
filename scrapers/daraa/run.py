"""Dara («دارا للتطوير العقاري», daraa.sa) — a Makkah apartment-building developer. Onboarding
2026-09-27 (batch 7).

SOURCE SHAPE (measured live 2026-09-27)
=======================================
A Next.js App Router site; no sitemap (404), no public JSON API (the data is fetched server-side
from api.daraa.sa). Arabic is served when the request carries the cookie `locale=ar` (/ar/… is 404).
  list    /projects?page=N — the RSC flight carries `"initialProjects":[{image, title, subtitle,
          link:"/projects/<id>", isSoldOut, extraInfo:[…]}]` and `"initialTotalPages":2`.
          Measured: 33 projects (ids 205027…205060; 205032 is not listed and serves an empty page).
  detail  /projects/<id> — hero status tags (the same words as extraInfo), <h1> name, a spec strip
          «الفئة: شقة · المسافة إلى الحرم المكي: 3 إلى 5 كم · الحي: بطحاء قريش», the description (an
          RSC text row, `"__html":"$29"` → `29:T<hex>,…`), amenity cards («مصعد: متوفره», «مواقف: موقف
          خاص»), a gallery `"images":[…]`, and on newer projects a construction timeline.
STATUS (list extraInfo, Arabic): 22 isSoldOut · 6 «شقق / جاهزة للإفراغ» · 3 «شقق / سجل إهتمامك»
(timelines: «مراحل البناء», «نسبة انجاز 85%», «على مشارف التسليم» — still being built) · 2 «بيع على
الخارطة / رقم الترخيص …» (off-plan). No page shows a price, a unit list, a room count or an area.

OWNER RULE (2026-09-13, completed projects ARE listings): a BUILT project is a real listing; off-plan /
unbuilt is excluded — judged on the page, not the word «مشروع». Kept = not sold AND the site's own
status says ready («جاهزة للإفراغ» — ready for title transfer); everything else is a counted skip.
One row per project: no page lists units. If a detail page ever prints a price (ريال / ر.س), the row is
SKIPPED as `unit_prices_unparsed` rather than published without them — that page needs per-unit rows.
DEAL: «جاهزة للإفراغ» (ready for deed transfer) and «تملّك» — the site sells; never rents → Buy.
PRICE: none anywhere → NULL (authoritative absence; the card shows «السعر عند الطلب»).
CITY: Dara builds only in Makkah — the footer's single location is «مكة المكرمة», the site's district
filter lists only Makkah districts, and every project states «المسافة إلى الحرم المكي». The city is
set ONLY when the page's own spec strip carries that Makkah-Haram field; otherwise `city_unstated`.
PDPL: the site's phone/WhatsApp/email and the inquiry form are never read.
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

BASE = "https://daraa.sa"
SOURCE = "دارا للتطوير العقاري"
PREFIX = "DRA"
SLUG = "daraa"
IMPERSONATE = "chrome"
COOKIES = {"locale": "ar"}
CITY_AR = "مكة المكرمة"
_HARAM_KEY = "الحرم المكي"

_READY = "جاهز"                       # «جاهزة للإفراغ»
_OFF_PLAN = "على الخارطة"             # «بيع على الخارطة»
_REGISTER = "سجل"                     # «سجل إهتمامك» — pre-completion sales, timelines show construction
_SOLD_RE = re.compile(r"مُباع|مباع")
_PRICE_RE = re.compile(r"ريال|ر\.س|SAR", re.I)


def get(s: cc.Session, url: str) -> str:
    for attempt in range(3):
        try:
            r = s.get(url, impersonate=IMPERSONATE, timeout=40, cookies=COOKIES)
            r.raise_for_status()
            return r.text
        except Exception:  # noqa: BLE001
            if attempt == 2:
                raise
            time.sleep(2 + attempt * 3)
    return ""


def flight(page: str) -> str:
    return "".join(json.loads('"' + c + '"') for c in re.findall(r'self\.__next_f\.push\(\[1,"(.*?)"\]\)', page, re.S))


def _array_after(blob: str, key: str) -> list:
    i = blob.find(key)
    if i < 0:
        return []
    j, depth = i + len(key) - 1, 0
    for k in range(j, len(blob)):
        if blob[k] == "[":
            depth += 1
        elif blob[k] == "]":
            depth -= 1
            if depth == 0:
                return json.loads(blob[j:k + 1])
    return []


def list_page(page: str) -> tuple[list[dict], Optional[int]]:
    blob = flight(page)
    total = re.search(r'"initialTotalPages":(\d+)', blob)
    return _array_after(blob, '"initialProjects":['), int(total.group(1)) if total else None


def walk(s: cc.Session) -> tuple[list[dict], bool]:
    """All project cards over every list page; complete = every declared page was read."""
    cards: dict[str, dict] = {}
    got, total = list_page(get(s, f"{BASE}/projects?page=1"))
    pages = 1
    for c in got:
        cards.setdefault(c.get("link") or "", c)
    for p in range(2, (total or 1) + 1):
        more, _ = list_page(get(s, f"{BASE}/projects?page={p}"))
        pages += 1
        for c in more:
            cards.setdefault(c.get("link") or "", c)
        time.sleep(0.3)
    cards.pop("", None)
    return list(cards.values()), total is not None and pages == total and len(cards) > 0


def _rsc_text(blob: str, ref: str) -> str:
    """An RSC text row `<ref>:T<hex byte length>,<text>` — how the description html is shipped."""
    b = blob.encode()
    m = re.search(rb"(?:^|\n)" + re.escape(ref.encode()) + rb":T([0-9a-f]+),", b)
    return b[m.end():m.end() + int(m.group(1), 16)].decode("utf-8", "ignore") if m else ""


def _plain(s: str) -> str:
    return re.sub(r"\s+", " ", ihtml.unescape(re.sub(r"<[^>]+>", " ", s))).strip()


def parse_detail(page: str) -> dict[str, Any]:
    blob = flight(page)
    h1 = re.search(r'\["\$","h1",null,\{"className":"[^"]*","children":"((?:[^"\\]|\\.)*)"', blob)
    desc_ref = re.search(r'"dangerouslySetInnerHTML":\{"__html":"\$(\w+)"\}', blob)
    return {
        "tags": re.findall(r'\["\$","span","\d+",\{"className":"bg-accent text-background[^"]*","children":"([^"]*)"\}\]', blob),
        "title": json.loads(f'"{h1.group(1)}"').strip() if h1 else None,
        "specs": {k.strip(): v.strip() for k, v in re.findall(
            r'"children":"([^"]+)"\}\],\["\$","span",null,\{"className":"text-lg font-bold[^"]*","children":"([^"]+)"', blob)},
        "amenities": {k.strip(): v.strip() for k, v in re.findall(
            r'"children":"([^"]+)"\}\],\["\$","span",null,\{"className":"text-sm font-bold text-accent","children":"([^"]+)"', blob)},
        "images": (lambda m: json.loads(m.group(1)) if m else [])(re.search(r'"images":(\[[^\]]*\])', blob)),
        "description": _plain(_rsc_text(blob, desc_ref.group(1))) if desc_ref else "",
    }


def card_verdict(card: dict) -> str:
    """'' when the LIST card is a ready, unsold project worth a detail fetch; else the skip reason."""
    info = [str(x) for x in card.get("extraInfo") or []]
    if card.get("isSoldOut"):
        return "sold"
    if any(_OFF_PLAN in x for x in info):
        return "off_plan"
    if any(_READY in x for x in info):
        return ""
    if any(_REGISTER in x for x in info):
        return "not_ready_register_interest"
    return "not_ready_" + ("/".join(info) or "no_status")


def map_project(card: dict, d: dict[str, Any]) -> tuple[Optional[tuple[dict, str]], str]:
    why = card_verdict(card)
    if why:
        return None, why
    tags = d.get("tags") or []
    if not any(_READY in t for t in tags) or any(_SOLD_RE.search(t) or _OFF_PLAN in t for t in tags):
        return None, "detail_status_disagrees"
    text = f"{d.get('title') or ''} {d.get('description') or ''} {' '.join(f'{k} {v}' for k, v in (d.get('amenities') or {}).items())}"
    if _PRICE_RE.search(text):
        return None, "unit_prices_unparsed"
    specs = d.get("specs") or {}
    type_ar = specs.get("الفئة")
    ptype = normalize.map_type_exact(type_ar)
    if not ptype:
        return None, f"type_unmapped_{type_ar}"
    haram = next((v for k, v in specs.items() if _HARAM_KEY in k), None)
    if not haram:
        return None, "city_unstated"
    city_id, region_id = to_catalog(CITY_AR)
    district_raw = specs.get("الحي") or None
    district_ar = find_district_in_text("حي " + district_raw, city_id) if (city_id and district_raw) else None
    pid = re.sub(r"\D", "", card.get("link") or "")
    title = d.get("title") or (card.get("title") or "").strip()
    photos = list(dict.fromkeys(u for u in (d.get("images") or []) if isinstance(u, str) and u.startswith("http")))
    row: dict[str, Any] = {
        "ad_number": f"{PREFIX}{pid}",
        "listing_url": f"{BASE}/projects/{pid}",
        "source": SOURCE,
        "active": True,
        "title": redact_pii(title) or None,
        "description": redact_pii((d.get("description") or "")[:4000]) or None,
        "project_name": redact_pii(title) or None,
        "property_type": ptype,
        "transaction_type": "Buy",
        "price_total": None,
        "city": normalize.map_city(CITY_AR),
        "city_ar": CITY_AR,
        "city_id": city_id,
        "region_id": region_id,
        "district_ar": district_ar,
        "neighborhood": district_raw,
        "photo_urls": photos,
    }
    for k, v in (d.get("amenities") or {}).items():
        row.update(normalize.amenities_from_text(f"{k} {v}"))
    row["price_evidence"] = normalize.price_evidence(
        field="(none — the site publishes no price)", raw=None, stored=None, kind="total", unit="total",
        origin="structured", authoritative_absent=True)
    info = {"source_id": pid, "status_ar": tags, "type_ar": type_ar, "distance_to_haram_ar": haram,
            "amenities_ar": d.get("amenities") or None}
    row["additional_info"] = redact_capture(strip_pii_fields({k: v for k, v in info.items() if v not in (None, "", [], {})}))
    row["source_capture"] = redact_capture(strip_pii_fields({"schema": "daraa.project.v1", "card": card, "tags": tags,
                                              "specs": specs, "amenities": d.get("amenities")}))
    return (row, normalize.category_for_type(ptype).lower()), ""


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--type", default="all")
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()
    dry = a.dry_run

    s = cc.Session()
    cards, walked_all = walk(s)
    print(f"{SOURCE}: {len(cards)} project(s) on its list (all pages read: {walked_all})", flush=True)

    run_id = None if dry else db.begin_run(SLUG)
    res: list[dict] = []
    com: list[dict] = []
    skipped: dict[str, list[str]] = {}
    unreadable = 0
    try:
        for card in cards:
            pid = re.sub(r"\D", "", card.get("link") or "")
            why = card_verdict(card)
            if not why:
                try:
                    got, why = map_project(card, parse_detail(get(s, f"{BASE}/projects/{pid}")))
                except Exception:  # noqa: BLE001
                    unreadable += 1
                    continue
                time.sleep(0.3)
                if got:
                    row, cat = got
                    (com if cat == "commercial" else res).append(row)
                    continue
            skipped.setdefault(why, []).append(pid)
        for k, v in sorted(skipped.items()):
            print(f"  skipped {k} x{len(v)}: {' '.join(v)}", flush=True)
        if dry:
            print(f"DRY: {len(res)} residential + {len(com)} commercial ({unreadable} unreadable)")
            for row in res + com:
                print("   ", json.dumps({k: row.get(k) for k in ("ad_number", "title", "property_type", "transaction_type",
                      "price_total", "city_id", "district_ar", "elevator", "parking")}, ensure_ascii=False)[:260])
                print("      photos:", len(row["photo_urls"]))
            return 0

        db.upsert_daraa_residential_batch(res)
        db.upsert_daraa_commercial_batch(com)
        superseded = db.retire_superseded_siblings(
            res_table="daraa_residential_listings", com_table="daraa_commercial_listings",
            res_ads={r["ad_number"] for r in res}, com_ads={r["ad_number"] for r in com}, source=SOURCE)
        if superseded:
            print(f"  retired {superseded} superseded sibling row(s) after a category flip", flush=True)
        complete = walked_all and unreadable == 0
        for tbl, rr in (("daraa_residential_listings", res), ("daraa_commercial_listings", com)):
            if rr and complete:
                n = db.prune_unseen(tbl, {r["ad_number"] for r in rr}, source=SOURCE)
                if n < 0:
                    print(f"  ⚠ {tbl}: prune guard tripped — kept existing active rows", flush=True)
                elif n:
                    print(f"  pruned {n} from {tbl}", flush=True)
        if not complete:
            print(f"  NOT pruning: list complete={walked_all}, {unreadable} detail page(s) unreadable", flush=True)
        healthy = db.end_run(run_id, ok=True, rows_seen=len(cards), rows_upserted=len(res) + len(com),
                             check_tables=["daraa_residential_listings", "daraa_commercial_listings"])
        if not healthy:
            print("✗ run demoted to unhealthy by end_run()", flush=True)
            return 1
        print(f"✓ {SOURCE}: {len(res)} residential + {len(com)} commercial upserted", flush=True)
        return 0
    except Exception as e:  # noqa: BLE001
        if run_id:
            db.end_run(run_id, ok=False, rows_seen=len(cards), rows_upserted=0, notes=str(e)[:300])
        raise


if __name__ == "__main__":
    raise SystemExit(main())
