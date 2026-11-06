"""Almajdiah (almajdiah.com) RENTALS — the STAGED ingest (owner order 2026-11-05). Rows are stored in a table no
search arm reads; NOTHING reaches a customer until the owner launches it (docs/ops/FIVE_SOURCES_LAUNCH.md).
SALES ARE ON HOLD (owner 2026-11-05): the developer's sale units carry no built / off-plan marker and no licence.

SOURCE SHAPE (measured live 2026-11-05; robots.txt of almajdiah.com and etmaam.almajdiah.com: «Disallow:» = all allowed)
=====================================================================================================================
The site's rental pages read a public JSON API, and so do we (1 request a second, our own bot UA):
  GET https://etmaam.almajdiah.com/api/client/v1/rental-request?page=N
      response.rental_projects {data: [project], meta {last_page, total}} (35 projects, 15 a page) and
      response.outer_units [unit] (units outside a project, 3 on 2026-11-05 — the same list on every page)
  GET https://etmaam.almajdiah.com/api/client/v1/rental-request/<project id>?page=N
      response.units {data: [unit], meta {last_page, total}} (56 units over the 35 projects)
TLS: almajdiah.com and etmaam.almajdiah.com carry valid Let's Encrypt certificates (verified, never skipped);
WWW.almajdiah.com answers with a SELF-SIGNED certificate for an IP (browsers warn) — so every link we store uses the
bare host https://almajdiah.com/…, never www.
A unit has NO page of its own: it is a card on its project's page https://almajdiah.com/rentals/<project id>?platform=web
(outer units: https://almajdiah.com/view/rentals/list). Each card shows «ترخيص الاعلان», the district and the one-payment
price; «تفاصيل أكثر» shows «دفعة: 70,000 / دفعتين: 72,000 / التأمين: 3,000» and the room facts below.
  one_batches_price  the price for ONE payment = the card's price → PRICE = SOURCE. No period word anywhere on the
                     page or in the API: PERIOD = SOURCE = silent → rent_period NULL (judged at launch by the search
                     index's judge_silent_rent_period_ar, flagged judged). two_batches_price + insurance are kept.
  rental_license     the REGA ad licence → license_number when it is 10 digits (54 of 59 on 2026-11-05; 5 carry «--» /
                     «000» / «...», printed «ترخيص الاعلان:--» on the card → NULL, raw kept). An expired one is not listed.
  bedrooms_count, bathrooms_count, total_area, floor_text, is_furnished, is_has_kitchen, is_has_air_conditioning,
  is_has_maid_room, is_has_storage_room, is_has_roof, is_has_rather (balcony), parking_text, halls_design_text.
  Type: the API has no type word. Every unit is «المبنى : X · الوحدة : N» on a stated floor of a residential building
  (project_category_id 1 / 8) → Apartment; that judgment is recorded per row (additional_info.type_basis).
  Location: regionBlock = the district, area = the city; unit_map_url / project latitude,longitude = the pin.
PDPL: the API carries no person; free text goes through the shared redactor + the tables' zz_redact_pii trigger.

LIVENESS («own full list = the check»): COMPLETE = every project page read to its last_page and the project count
reached meta.total. Only a complete walk prunes; absent from 3 complete walks = inactive.

    python -m scrapers.almajdiah.run --dry-run
    python -m scrapers.almajdiah.run
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from collections import Counter
from pathlib import Path
from typing import Any, Optional

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from scrapers.common import db, honest_fetch as H, normalize as N  # noqa: E402
from scrapers.common.arabic_location import catalog_district, resolve  # noqa: E402
from scrapers.common.pii import redact_capture, redact_pii, strip_pii_fields  # noqa: E402
from scrapers.common.source_pin import pin_dict  # noqa: E402

SOURCE = "Almajdiah"
SLUG = "almajdiah"
PREFIX = "AMJ"
RES_TABLE = "almajdiah_residential_listings"
API = "https://etmaam.almajdiah.com/api/client/v1/"
SITE = "https://almajdiah.com"          # NEVER www.: its certificate is self-signed for an IP
_PIN_RE = re.compile(r"(-?\d{1,2}\.\d+),\s*(-?\d{1,3}\.\d+)")
_FLAGS = {"is_has_kitchen": "kitchen", "is_has_air_conditioning": "air_conditioner", "is_has_maid_room": "maid_room",
          "is_has_storage_room": "laundry_room", "is_has_rather": "balcony_terrace", "is_furnished": "furnished"}
_FLOOR = {"الطابق الأرضي": 0, "الطابق الأول": 1, "الطابق الثاني": 2, "الطابق الثالث": 3, "الطابق الرابع": 4}


def _allowed(url: str) -> bool:
    return url.startswith(API + "rental-request")


def walk(log=print) -> dict:
    projects: dict[int, dict] = {}
    outer: dict[str, dict] = {}
    page, last, total = 1, 1, 0
    while page <= last and page <= 20:
        r = H.get_json(f"{API}rental-request?page={page}", allowed=_allowed)["response"]
        rp = r["rental_projects"]
        last, total = int(rp["meta"]["last_page"]), int(rp["meta"]["total"])
        projects.update({p["id"]: p for p in rp["data"]})
        outer.update({str(u["id"]): u for u in r.get("outer_units") or []})
        page += 1
    units: dict[str, tuple[dict, Optional[dict]]] = {k: (u, None) for k, u in outer.items()}
    pages_ok = True
    for pid, p in projects.items():
        page, plast = 1, 1
        while page <= plast and page <= 40:
            u = H.get_json(f"{API}rental-request/{pid}?page={page}", allowed=_allowed)["response"].get("units")
            if not u:
                pages_ok = False
                break
            plast = int(u["meta"]["last_page"])
            units.update({str(x["id"]): (x, p) for x in u["data"]})
            page += 1
    log(f"  {len(projects)} of {total} projects, {len(outer)} outer units, {len(units)} units")
    return {"projects": projects, "total_projects": total, "units": units, "pages_ok": pages_ok}


def complete(w: dict) -> bool:
    return w["pages_ok"] and w["total_projects"] > 0 and len(w["projects"]) >= w["total_projects"] and bool(w["units"])


def _int(v: Any) -> Optional[int]:
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return int(round(f)) if f > 0 else None


def map_unit(u: dict, project: Optional[dict]) -> tuple[Optional[dict], str]:
    if u.get("is_rental_license_expired"):
        return None, "licence_expired_at_source"
    if not (u.get("building_name") or u.get("unit_number") or u.get("floor_text") or " - " in (u.get("unit_name") or "")):
        return None, "type_unknown"
    city = (u.get("area") or (project or {}).get("location", {}).get("address", "").split(" - ")[0] or "").strip() or None
    district = (u.get("regionBlock") or "").strip() or None
    r = resolve(city, district) if city else {}
    cid = r.get("city_id")
    m = _PIN_RE.search(u.get("unit_map_url") or "")
    ploc = (project or {}).get("location") or {}
    pin = pin_dict(m.group(1), m.group(2)) if m else pin_dict(ploc.get("latitude"), ploc.get("longitude"))
    price = _int(u.get("one_batches_price"))
    lic = str(u.get("rental_license") or "").strip()
    desc = redact_pii(u.get("unit_description"), keep_lines=True) or None
    title = redact_pii(u.get("unit_name")) or None
    flags = {col: bool(u[k]) for k, col in _FLAGS.items() if u.get(k) in (0, 1)}
    pid = (u.get("project") or {}).get("id") or (project or {}).get("id")
    row: dict[str, Any] = {
        "ad_number": f"{PREFIX}{u['id']}",
        "listing_url": f"{SITE}/rentals/{pid}?platform=web" if pid else f"{SITE}/view/rentals/list",
        "source": SOURCE, "active": True, "title": title, "description": desc,
        "property_type": "Apartment", "transaction_type": "Rent",
        "city": N.map_city(r.get("city_ar") or city) if city else None, "city_ar": r.get("city_ar") or city,
        "city_id": cid, "region_id": r.get("region_id"), "neighborhood": district,
        "district_ar": catalog_district(cid, district) if (cid and district) else None,
        "area_m2": _int(u.get("total_area")), "bedrooms": _int(u.get("bedrooms_count")),
        "bathrooms": _int(u.get("bathrooms_count")), "floor_number": _FLOOR.get(u.get("floor_text") or ""),
        "parking": True if "موقف" in (u.get("parking_text") or "") else None,
        # 54 of 59 carry a 10-digit REGA licence; 5 carry a placeholder («--», «000», «...») — the card prints «--»: none
        "license_number": lic if re.fullmatch(r"\d{10}", lic) else None,
        "photo_urls": [i for i in (u.get("images") or []) if isinstance(i, str)] or None,
        "project_name": ((u.get("project") or {}).get("display_name") or {}).get("ar") or (project or {}).get("name"),
        # PRICE = SOURCE (the one-payment figure the card shows); PERIOD = SOURCE = silent
        "rent_period": None,
        "price_annual": price if price else db.AUTHORITATIVE_NULL,
        "price_evidence": {**N.price_evidence(field="one_batches_price", raw=u.get("one_batches_price"), stored=price,
                                              kind="annual", unit="total", origin="api", authoritative_absent=not price),
                           "period_stated": False},
        **flags,
    }
    info = {
        "source_id": str(u["id"]), "unit_kind": u.get("type"), "unit_name": u.get("unit_name"),
        "building_name": u.get("building_name"), "unit_number": u.get("unit_number"),
        "rega_ad_license_number": row["license_number"], "rental_license_raw": lic or None,
        "is_rental_license_expired": u.get("is_rental_license_expired"),
        "price_one_payment": u.get("one_batches_price"), "price_two_payments": u.get("two_batches_price"),
        "insurance": u.get("insurance"), "payment_terms": "دفعة / دفعتين",
        "floor_text": u.get("floor_text"), "halls_design_text": u.get("halls_design_text"),
        "parking_text": u.get("parking_text"), "has_roof": u.get("is_has_roof"),
        "kitchen_has_appliances": u.get("is_kitchen_has_apps"), "address": u.get("address"),
        "project_id": pid, "project_code": (project or {}).get("code"),
        "project_description": redact_pii((project or {}).get("description"), keep_lines=True),
        "type_basis": "a unit of a residential building on a stated floor («المبنى · الوحدة · الطابق»); the API has no type word",
        **pin,
    }
    row["additional_info"] = strip_pii_fields({k: v for k, v in info.items() if v not in (None, "", [], {})})
    kept = {k: v for k, v in u.items() if k != "project"}
    row["source_capture"] = {"schema": "almajdiah.rental.v1", "item": redact_capture(strip_pii_fields(kept)),
                             "project": redact_capture(strip_pii_fields({k: (project or {}).get(k) for k in
                                                                         ("id", "name", "code", "status", "location")}))}
    return row, ""


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--save", default="")
    a = ap.parse_args()
    run_id = None if a.dry_run else db.begin_run(SLUG)
    w: dict = {"units": {}}
    try:
        w = walk()
        rows, skipped = [], Counter()
        for u, p in w["units"].values():
            row, why = map_unit(u, p)
            (rows.append(row) if row else skipped.update([why]))
        ok = complete(w)
        cover = {"units": len(w["units"]), "projects": f"{len(w['projects'])}/{w['total_projects']}", "complete": ok}
        print(f"  coverage: {json.dumps(cover)}\n  mapped: {len(rows)} rent units; skipped (not guessed): {dict(skipped)}",
              flush=True)
        if a.save:
            Path(a.save).write_text(json.dumps(rows, ensure_ascii=False, default=str))
        if a.dry_run:
            return 0
        db.upsert_almajdiah_residential_batch(rows)
        note = f"coverage {json.dumps(cover)}; "
        if rows and ok:
            note += f"pruned={db.prune_unseen(RES_TABLE, {r['ad_number'] for r in rows}, source=SOURCE, verify_gone=_gone)}"
        else:
            note += "NOT pruned (walk incomplete or empty)"
        healthy = db.end_run(run_id, ok=True, rows_seen=len(w["units"]), rows_upserted=len(rows), notes=note[:900],
                             check_tables=["almajdiah_residential_listings"])
        if not healthy:
            print("✗ run demoted to unhealthy by end_run()", flush=True)
            return 1
        print(f"✓ {SOURCE}: {len(rows)} rent units upserted (STAGED — not searchable)", flush=True)
        return 0
    except Exception as e:  # noqa: BLE001
        if run_id:
            db.end_run(run_id, ok=False, rows_seen=len(w["units"]), rows_upserted=0, notes=f"{type(e).__name__}: {e}"[:300])
        raise


def _gone(ad_number: str) -> tuple[str, str]:
    """prune_unseen's answer at grace. Absence from a list is a CANDIDATE, never a kill (LISTING_LIVENESS.md §2:
    only a DIRECT reading of the ad's own page may deactivate). Until this site has a measured own-page oracle the
    strike is held: UNKNOWN. ♻️ 2026-11-06 — it used to return «gone» here, an absence-only kill."""
    return "unknown", "absent from 3 consecutive COMPLETE walks of the site's own full rental list; no own-page oracle yet — held (absence never kills)"


if __name__ == "__main__":
    raise SystemExit(main())
