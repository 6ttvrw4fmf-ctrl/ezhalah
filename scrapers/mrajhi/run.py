"""Al Rajhi Development & Investment (mrajhi.com.sa) — the STAGED ingest (owner order 2026-11-05). Rows are stored in
a table no search arm reads; NOTHING reaches a customer until the owner launches it (docs/ops/FIVE_SOURCES_LAUNCH.md).
DUPLICATES (owner 2026-11-05): 38 of the 39 units are also on Property Finder — KEEP BOTH copies (fleet rule: every
site keeps its own copy; a later «this ad is also on X» notice is the owner's plan).

SOURCE SHAPE (measured live 2026-11-05; robots.txt: Allow /units/, Disallow /api/)
=================================================================================
The site's own complete list is https://mrajhi.com.sa/sitemap.xml (39 /units/<code> pages on 2026-11-05, all yearly
rentals in Riyadh). Each unit page carries a schema.org RealEstateListing JSON-LD block and server-rendered labels:
  JSON-LD           name, description (the FULL ad text), url, datePosted, offers.price + offers.description
                    («إيجار سنوي» = the period, stated) → PRICE = SOURCE, PERIOD = SOURCE.
  labels            «إيجار سنوي» badge, the type word («فيلا» / «شقة» …), «مشروع X · رقم المشروع: N»,
                    «السعودية • الرياض • <district>», «N غرف نوم», «N دورات مياه», «N صالات», «<floor> الدور»,
                    «التفاصيل المالية»: السعر الأساسي / مبلغ التأمين / رسوم المياه / عمولة العقد (kept), «موقع العقار»,
                    «رقم رخصة الإعلان» (REGA, 39 of 39) → license_number, «تاريخ الإضافة», «رمز الوحدة».
  pin               the page's own map embed «maps?q=<lat>,<lng>» → the pin.
PDPL — NEVER STORED: the page's «أرقام الحراس» block (a building guard's NAME and mobile, «للمعاينة فقط») is never
read: the label reader stops at «أرقام الحراس» and resumes at «رقم رخصة الإعلان»; no raw HTML is kept. The company's
own switchboard numbers and every phone inside the description are redacted by the shared redactor + zz_redact_pii.

LIVENESS («own full list = the check»): COMPLETE = every sitemap unit answered 200 with its JSON-LD. Only a complete
walk prunes; 3 complete misses = inactive.

    python -m scrapers.mrajhi.run --dry-run
    python -m scrapers.mrajhi.run
"""
from __future__ import annotations

import argparse
import html as _html
import json
import re
import sys
from collections import Counter
from pathlib import Path
from typing import Any, Optional

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from scrapers.common import db, honest_fetch as H, normalize as N  # noqa: E402
from scrapers.common.arabic_location import catalog_district, resolve  # noqa: E402
from scrapers.facts.one_reader import amenity_answers  # noqa: E402
from scrapers.common.pii import redact_pii  # noqa: E402
from scrapers.common.source_pin import pin_dict  # noqa: E402

PROSE_COLS = ("kitchen", "parking", "elevator", "maid_room", "driver_room", "air_conditioner", "private_entrance", "furnished", "balcony_terrace", "laundry_room")
SOURCE = "Al Rajhi Development"
SLUG = "mrajhi"
PREFIX = "MRJ"
RES_TABLE = "mrajhi_residential_listings"
COM_TABLE = "mrajhi_commercial_listings"
SITE = "https://mrajhi.com.sa"
SITEMAP = SITE + "/sitemap.xml"
_LD_RE = re.compile(r'<script type="application/ld\+json">(.*?)</script>', re.S)
_PIN_RE = re.compile(r"maps\?q=(-?\d{1,2}\.\d+),(-?\d{1,3}\.\d+)")
_IMG_RE = re.compile(r'https://[a-z0-9]+\.supabase\.co/storage/v1/object/public/units/[^"\\\s)]+?\.(?:jpe?g|png|webp)')
_PERIOD = {"إيجار سنوي": "سنوي", "إيجار شهري": "شهري"}
_FLOOR = {"الأرضي": 0, "الأول": 1, "الثاني": 2, "الثالث": 3, "الرابع": 4}
_PII_START, _PII_END = "أرقام الحراس", "رقم رخصة الإعلان"


def _allowed(url: str) -> bool:
    return url == SITEMAP or re.fullmatch(re.escape(SITE) + r"/units/[A-Za-z0-9_-]+", url) is not None


def page_lines(page: str) -> list[str]:
    """The page's visible text, one label per line, with the guards' block (name + phone) CUT OUT."""
    body = re.sub(r"<(script|style|svg)[^>]*>.*?</\1>", "", page, flags=re.S)
    lines = [x.strip() for x in _html.unescape(re.sub(r"<[^>]+>", "\n", body)).split("\n") if x.strip()]
    if _PII_START in lines:
        i = lines.index(_PII_START)
        j = lines.index(_PII_END, i) if _PII_END in lines[i:] else len(lines)
        lines = lines[:i] + lines[j:]
    return lines


def _after(lines: list[str], label: str, k: int = 1) -> Optional[str]:
    return lines[lines.index(label) + k] if label in lines and lines.index(label) + k < len(lines) else None


def _before(lines: list[str], label: str) -> Optional[str]:
    return lines[lines.index(label) - 1] if label in lines and lines.index(label) > 0 else None


def parse_unit(page: str) -> Optional[dict]:
    ld = next((d for d in (json.loads(x) for x in _LD_RE.findall(page)) if d.get("@type") == "RealEstateListing"), None)
    if not ld:
        return None
    ln = page_lines(page)
    head = ln.index("عنوان الإعلان العقاري") if "عنوان الإعلان العقاري" in ln else -1
    proj = ln.index("رقم المشروع") if "رقم المشروع" in ln else -1
    m = _PIN_RE.search(page)
    return {
        "ld": ld,
        "period_badge": ln[head - 2] if head >= 2 else None, "type_word": ln[head - 1] if head >= 1 else None,
        "title": ln[head + 1] if head >= 0 else ld.get("name"), "project": ln[head + 2] if head >= 0 else None,
        "project_no": ln[proj + 2] if proj >= 0 else None,
        # «رقم المشروع : N السعودية • الرياض • العليا» — a unit with no district prints only «الرياض» (no «•» run)
        "place": [x for x in ln[proj + 3: (ln.index("غرف نوم") - 1 if "غرف نوم" in ln else proj + 8)] if x != "•"]
                 if proj >= 0 else [],
        "bedrooms": _before(ln, "غرف نوم"), "bathrooms": _before(ln, "دورات مياه"), "halls": _before(ln, "صالات"),
        "floor": _before(ln, "الدور"),
        "finance": {k: _after(ln, k) for k in ("السعر الأساسي", "مبلغ التأمين", "رسوم المياه", "عمولة العقد", "السعر المطلوب")},
        "period_label": _after(ln, "السعر المطلوب", 3), "location_text": _after(ln, "موقع العقار"),
        "license": _after(ln, "رقم رخصة الإعلان"), "date_added": _after(ln, "تاريخ الإضافة"),
        "unit_code": _after(ln, "رمز الوحدة"), "available": next((x for x in ln if "متاحة حاليًا" in x), None),
        "pin": (m.group(1), m.group(2)) if m else None,
        "images": list(dict.fromkeys(_IMG_RE.findall(page))),
    }


def map_unit(code: str, url: str, u: dict) -> tuple[Optional[tuple[dict, str]], str]:
    ld = u["ld"]
    offer = ld.get("offers") or {}
    word = _PERIOD.get((offer.get("description") or u["period_label"] or u["period_badge"] or "").strip())
    if not word:
        return None, f"not_a_stated_rent_{offer.get('description')}"
    ptype = N.map_type(u["type_word"] or "") or N.map_type(ld.get("name") or "")
    if not ptype:
        return None, f"type_unmapped_{u['type_word']}"
    addr = ld.get("address") or {}
    place = [x for x in u["place"] if x != "السعودية"]
    city = (addr.get("addressLocality") or (place[0] if place else "") or "").strip() or None
    district = (addr.get("streetAddress") or (place[1] if len(place) > 1 else "") or "").strip() or None
    r = resolve(city, district) if city else {}
    cid = r.get("city_id")
    price = N.to_int(offer.get("price"))
    desc = redact_pii(ld.get("description"), keep_lines=True) or None
    title = redact_pii(u["title"] or ld.get("name")) or None
    period, annual = N.rent_period_and_annual(price, word) if price else (None, None)
    pin = pin_dict(*u["pin"]) if u["pin"] else {}
    # ONE READER (owner 2026-11-03): prose amenities come from the Advanced Filter's word reader, never normalize.prose_amenities.
    prose = amenity_answers(f"{title or ''}\n{desc or ''}", PROSE_COLS, {"balcony": "balcony_terrace"})
    row: dict[str, Any] = {
        "ad_number": f"{PREFIX}{code}", "listing_url": url, "source": SOURCE, "active": True,
        "title": title, "description": desc, "property_type": ptype, "transaction_type": "Rent",
        "city": N.map_city(r.get("city_ar") or city) if city else None, "city_ar": r.get("city_ar") or city,
        "city_id": cid, "region_id": r.get("region_id"), "neighborhood": district,
        "district_ar": catalog_district(cid, district) if (cid and district) else None,
        "bedrooms": N.to_int(u["bedrooms"]) or N.to_int(ld.get("numberOfRooms")),
        "bathrooms": N.to_int(u["bathrooms"]) or N.to_int(ld.get("numberOfBathroomsTotal")),
        "halls": N.to_int(u["halls"]), "floor_number": _FLOOR.get(u["floor"] or ""),
        "license_number": (u["license"] or "").strip() if re.fullmatch(r"\d{10}", (u["license"] or "").strip()) else None,
        "project_name": u["project"], "photo_urls": u["images"] or ([ld["image"]] if ld.get("image") else None),
        "date_added": ld.get("datePosted"),
        "rent_period": period, "price_annual": annual if price else db.AUTHORITATIVE_NULL,
        "price_evidence": N.price_evidence(field="ld+json offers.price", raw=offer.get("price"), stored=annual,
                                           kind={"سنوي": "annual", "شهري": "monthly"}[word], unit="total",
                                           origin="structured", authoritative_absent=not price),
        **prose,
    }
    info = {"source_id": code, "rega_ad_license_number": row["license_number"], "period_label": offer.get("description"),
            "type_word": u["type_word"], "project_number": u["project_no"], "unit_code": u["unit_code"],
            "finance": {k: N.to_int(v) for k, v in u["finance"].items() if v} or None,
            "location_text": redact_pii(u["location_text"]), "date_added_label": u["date_added"],
            "units_available_label": u["available"], **pin}
    row["additional_info"] = {k: v for k, v in info.items() if v not in (None, "", [], {})}
    row["source_capture"] = {"schema": "mrajhi.unit.v1",
                             "ld": {k: v for k, v in ld.items() if k not in ("provider", "description")},
                             "labels": {k: v for k, v in u.items() if k not in ("ld", "images")}}
    return (row, "residential" if N.category_for_type(ptype) == "Residential" or ptype == "Duplex" else "commercial"), ""


def walk(log=print) -> dict:
    sm = H.get_text(SITEMAP, allowed=_allowed)
    urls = [u for u in dict.fromkeys(re.findall(r"<loc>\s*([^<]+?)\s*</loc>", sm)) if "/units/" in u and _allowed(u)]
    units, bad = {}, Counter()
    for u in urls:
        try:
            p = parse_unit(H.get_text(u, allowed=_allowed))
        except H.Blocked as e:
            if " 404 " in str(e) or " 410 " in str(e):
                bad["gone_404"] += 1
                continue
            raise
        if p is None:
            bad["no_listing_jsonld"] += 1
            continue
        units[u.rsplit("/", 1)[1]] = (u, p)
    log(f"  {len(units)} of {len(urls)} unit pages parsed")
    return {"listed": len(urls), "units": units, "bad": bad}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--save", default="")
    a = ap.parse_args()
    run_id = None if a.dry_run else db.begin_run(SLUG)
    w: dict = {"units": {}}
    try:
        w = walk()
        res, com, skipped = [], [], Counter()
        for code, (url, u) in w["units"].items():
            got, why = map_unit(code, url, u)
            if not got:
                skipped[why] += 1
                continue
            (res if got[1] == "residential" else com).append(got[0])
        ok = not w["bad"] and len(w["units"]) == w["listed"] > 0
        cover = {"sitemap_units": w["listed"], "parsed": len(w["units"]), "bad": dict(w["bad"]), "complete": ok}
        print(f"  coverage: {json.dumps(cover)}\n  mapped: {len(res)} residential + {len(com)} commercial; "
              f"skipped (not guessed): {dict(skipped)}", flush=True)
        if a.save:
            Path(a.save).write_text(json.dumps(res + com, ensure_ascii=False, default=str))
        if a.dry_run:
            return 0
        db.upsert_mrajhi_residential_batch(res)
        db.upsert_mrajhi_commercial_batch(com)
        notes = [f"coverage {json.dumps(cover)}"]
        sup = db.retire_superseded_siblings(res_table=RES_TABLE, com_table=COM_TABLE, res_ads={r["ad_number"] for r in res},
                                            com_ads={r["ad_number"] for r in com}, source=SOURCE)
        if sup:
            notes.append(f"superseded={sup}")
        for tbl, rows in ((RES_TABLE, res), (COM_TABLE, com)):
            if rows and ok:
                notes.append(f"{tbl} pruned={db.prune_unseen(tbl, {r['ad_number'] for r in rows}, source=SOURCE, verify_gone=_gone)}")
        healthy = db.end_run(run_id, ok=True, rows_seen=len(w["units"]), rows_upserted=len(res) + len(com),
                             notes="; ".join(notes)[:900], check_tables=["mrajhi_residential_listings", "mrajhi_commercial_listings"])
        if not healthy:
            print("✗ run demoted to unhealthy by end_run()", flush=True)
            return 1
        print(f"✓ {SOURCE}: {len(res)} residential + {len(com)} commercial upserted (STAGED — not searchable)", flush=True)
        return 0
    except Exception as e:  # noqa: BLE001
        if run_id:
            db.end_run(run_id, ok=False, rows_seen=len(w["units"]), rows_upserted=0, notes=f"{type(e).__name__}: {e}"[:300])
        raise


def _gone(ad_number: str) -> tuple[str, str]:
    return "gone", "absent from 3 consecutive COMPLETE reads of the site's own unit sitemap"


if __name__ == "__main__":
    raise SystemExit(main())
