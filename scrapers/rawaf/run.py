"""رواف (Rawaf) — rawaf.ai. New-build project marketplace, onboarding 2026-09-26.

SOURCE SHAPE (measured live 2026-09-26 across all 11 projects / 215 units before any code)
===========================================================================================
Public JSON API on the PRODUCTION host, no auth:

    GET /api/deals?page=0        → the 11 projects ("deals")
    GET /api/deals/<projectId>   → that project's individual UNITS

*** DO NOT PROBE beta.rawaf.ai. *** That host is a stale dev deployment whose backend answers 502
on every /api path while nginx serves the SPA shell as the error body — it reads exactly like a
dead site. The first probe of this platform concluded "Rawaf is down" from that host and was wrong:
production rawaf.ai works, and the resource is called `deals`, not properties/listings/ads.

*** PAGINATION IS A NO-OP. *** `?page=0,1,2,3…` all return the SAME 11 projects (verified by
comparing projectId lists). One GET is therefore the complete project enumeration; it is NOT paged,
so no loop may assume more pages exist.

*** 215 IS NOT AN INVENTORY — 19 IS. *** The roster carried Rawaf as "215 listings". That is
`sum(totalUnits)`: every unit these projects have EVER contained. Measured per unit status across
all 11 projects: SOLD 171, NOT_AVAILABLE 25, **AVAILABLE 19** — and 19 is exactly what the
projects' own `remainingUnits` adds up to and what the homepage prints ("19 / من 24 وحدة"). Under
the owner's ready-only rule only AVAILABLE is listed; SOLD and NOT_AVAILABLE are skipped and
counted, never inferred.

Everything needed is structured on the unit, so nothing is parsed out of prose:
  status  AVAILABLE/SOLD/NOT_AVAILABLE      price (all 19 available carry one)
  area    bedroom  bathroom  floor          parking maidRoom majlis laundrayRoom storageRoom
  type    APARTMENT/TOWNHOUSE/FLOOR/VILLA   contractType SALE (215/215)   city الرياض (215/215)

TYPE: the enum is UPPERCASE and `normalize.map_type_en` only matches Title Case (measured:
'APARTMENT'→None, 'Apartment'→Apartment), so it is title-cased before mapping. TOWNHOUSE resolves
to Villa, which is the app's own mapping for تاون هاوس (src/data/propertyTypes.ts:180).

BEDROOMS ARE REAL HERE. Unlike wahadat/iBaax/tuba, the field is literally named `bedroom` (with a
separate `bathroom`, `majlis`, `diningRoom`, `salah`), so it is a bedroom count and is stored as
one. All 19 available units carry it.

LISTING URL: there is no per-unit page. The site's own links are `/project/<projectId>`, so every
unit of a project points at that project's real page — the same honest choice made for wahadat,
never a fabricated per-unit fragment.
"""
from __future__ import annotations

import argparse
import json
import sys
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Any, Optional

from curl_cffi import requests as cc

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from scrapers.common import db, normalize  # noqa: E402
from scrapers.common.arabic_location import find_district_in_text, to_catalog  # noqa: E402
from scrapers.common.pii import redact_pii, strip_pii_fields  # noqa: E402

BASE = "https://rawaf.ai"
SOURCE = "رواف"
PREFIX = "RWF"
SLUG = "rawaf"
IMPERSONATE = "chrome"
TIMEOUT = 40

# *** THIS ENDPOINT SERVES JSON OR XML AND CHANGES ITS MIND. *** It returned clean JSON while this
# scraper was being measured and then, within the same hour, began answering
# `Content-Type: application/xhtml+xml` with a `<List><item>…` body — to plain curl WITH
# `Accept: application/json`, and to curl_cffi on every impersonation profile (chrome, safari,
# firefox, none) and with default_headers disabled. So the format is NOT something the client can
# negotiate reliably, and a scraper that assumes either one will die at random. Both are parsed;
# the field names are identical in each.
JSON_HEADERS = {"Accept": "application/json"}

READY_STATUS = "AVAILABLE"          # the owner's ready-only rule, in the source's own vocabulary


def _xml_to_obj(el):
    """One <item>/element into the same dict/list/scalar shape the JSON form produces.

    Repeated child tags become a list (that is how the XML renders arrays such as
    propertyImages); a childless element becomes its text, with 'true'/'false' normalised to bool
    so downstream flag handling is identical across both encodings.
    """
    kids = list(el)
    if not kids:
        t = (el.text or "").strip()
        if t.lower() == "true":
            return True
        if t.lower() == "false":
            return False
        return t
    out: dict[str, Any] = {}
    for k in kids:
        v = _xml_to_obj(k)
        if k.tag in out:
            if not isinstance(out[k.tag], list):
                out[k.tag] = [out[k.tag]]
            out[k.tag].append(v)
        else:
            out[k.tag] = v
    return out


def _decode(resp) -> Optional[list[dict]]:
    """The endpoint's list payload, whether it came back as JSON or as <List><item>…</item></List>."""
    body = (resp.text or "").lstrip()
    if body.startswith("[") or body.startswith("{"):
        try:
            d = resp.json()
        except Exception:  # noqa: BLE001
            return None
        return d if isinstance(d, list) else None
    if body.startswith("<"):
        try:
            root = ET.fromstring(resp.content)
        except ET.ParseError:
            return None
        items = root.findall("item") or list(root)
        out = [_xml_to_obj(i) for i in items]
        return [o for o in out if isinstance(o, dict)]
    return None


def _num(v) -> Optional[float]:
    if isinstance(v, bool) or v is None:
        return None
    if isinstance(v, (int, float)):
        return float(v) if v > 0 else None
    try:
        f = float(str(v).replace(",", "").strip())
        return f if f > 0 else None
    except ValueError:
        return None


def _int(v) -> Optional[int]:
    f = _num(v)
    return int(f) if f is not None else None


def _flag(v) -> Optional[bool]:
    """True only when the source says so; None when it says nothing. Never False-by-default."""
    if v is True:
        return True
    if isinstance(v, str):
        t = v.strip().lower()
        if t == "true":
            return True
        if t == "false":
            return False
        return None
    if isinstance(v, (int, float)) and not isinstance(v, bool):
        return True if v > 0 else None
    return None


def fetch_projects(s: cc.Session) -> list[dict]:
    r = s.get(f"{BASE}/api/deals?page=0", headers=JSON_HEADERS,
              impersonate=IMPERSONATE, timeout=TIMEOUT)
    r.raise_for_status()
    return _decode(r) or []


def fetch_units(s: cc.Session, project_id) -> tuple[list[dict], Optional[str]]:
    """(units, failure_reason). A project that does not serve a JSON array yields a REASON, never
    a silent empty list: measured, at least one projectId answers 200 with a non-JSON body, and
    treating that as "this project has no units" would quietly shrink the catalogue and let
    prune_unseen retire live stock on the next run."""
    r = s.get(f"{BASE}/api/deals/{project_id}", headers=JSON_HEADERS,
              impersonate=IMPERSONATE, timeout=TIMEOUT)
    if r.status_code != 200:
        return [], f"http_{r.status_code}"
    d = _decode(r)
    if d is None:
        return [], "undecodable_body"
    return d, None


def map_unit(proj: dict, u: dict) -> Optional[tuple[dict[str, Any], str]]:
    """(row, category) for ONE unit already proven status == AVAILABLE, or None if unmappable."""
    raw_type = (u.get("type") or "").strip()
    ptype = normalize.map_type_en(raw_type.title()) if raw_type else None
    if not ptype:
        return None
    category = normalize.category_for_type(ptype).lower()

    pid = proj.get("projectId")
    uid = u.get("propertyId") or u.get("id")

    city_ar = (u.get("city") or proj.get("city") or "").strip() or None
    city_id, region_id = to_catalog(city_ar) if city_ar else (None, None)
    dist_obj = proj.get("district") if isinstance(proj.get("district"), dict) else {}
    district_ar = (dist_obj.get("arabicName") or "").strip() or None
    loc_text = " ".join(str(x) for x in (proj.get("title"), proj.get("location"),
                                         u.get("projectLocation"), district_ar) if x)
    if city_id and not district_ar:
        district_ar = find_district_in_text(loc_text, city_id)

    # contractType is SALE on 215/215 measured; written from the source's value, not assumed.
    deal = "Rent" if (u.get("contractType") or "").upper() == "RENT" else "Buy"
    price = _num(u.get("price"))

    row: dict[str, Any] = {
        "ad_number": f"{PREFIX}{uid}",
        # No per-unit page exists; the site's own link for this stock is the project page.
        "listing_url": f"{BASE}/project/{pid}",
        "source": SOURCE,
        "active": True,
        "title": redact_pii(" ".join(x for x in (proj.get("title"), u.get("building")) if x)) or None,
        "property_type": ptype,
        "transaction_type": deal,
        "city": normalize.map_city(city_ar) if city_ar else None,
        "city_ar": city_ar,
        "city_id": city_id,
        "region_id": region_id,
        "district_ar": district_ar,
        "area_m2": _num(u.get("area")),
        # `bedroom` is a real bedroom count on this source — see the module docstring.
        "bedrooms": _int(u.get("bedroom")),
        "bathrooms": _int(u.get("bathroom")),
        "floor_number": _int(u.get("floor")),
        "parking": _flag(u.get("parking")),
        "maid_room": _flag(u.get("maidRoom")),
        "kitchen": _flag(u.get("ketchin")),
        "furnished": _flag(u.get("furnitured")),
        "latitude": proj.get("locationLatitude"),
        "longitude": proj.get("locationLongitude"),
        "license_number": proj.get("adLicenseNumber") or None,
        "photo_urls": [p for p in (u.get("propertyImages") or []) if isinstance(p, str)] or None,
    }
    if deal == "Buy":
        row["price_total"] = price
    else:
        row["price_annual"] = price

    row["price_evidence"] = normalize.price_evidence(
        field="price", raw=str(u.get("price")), stored=price,
        kind="total" if deal == "Buy" else "annual", unit="total", origin="api",
        authoritative_absent=(u.get("price") is None))

    info = {
        "unit_status": u.get("status"),
        "unit_type_raw": raw_type,
        "project_id": pid,
        "project_title": proj.get("title"),
        "project_remaining_units": proj.get("remainingUnits"),
        "project_total_units": proj.get("totalUnits"),
        "developer": proj.get("developer"),
        "majlis": u.get("majlis"),
        "dining_room": u.get("diningRoom"),
        "storage_room": u.get("storageRoom"),
        "laundry_room": u.get("laundrayRoom"),
        "verified": u.get("verified"),
    }
    row["additional_info"] = strip_pii_fields({k: v for k, v in info.items() if v is not None})
    row["source_capture"] = strip_pii_fields({"schema": "rawaf.api-deals-unit.v1", **u})
    return row, category


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--type", default="all")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()
    dry = a.dry_run

    s = cc.Session()
    projects = fetch_projects(s)
    if a.limit:
        projects = projects[: a.limit]
    print(f"{SOURCE}: {len(projects)} project(s)", flush=True)

    run_id = None if dry else db.begin_run(SLUG)
    res: list[dict] = []
    com: list[dict] = []
    skipped: dict[str, int] = {}
    seen_units = 0
    try:
        bad_projects = 0
        for proj in projects:
            units, why = fetch_units(s, proj.get("projectId"))
            if why:
                bad_projects += 1
                k = f"project_unreadable_{why}"
                skipped[k] = skipped.get(k, 0) + 1
                continue
            seen_units += len(units)
            for u in units:
                st = (u.get("status") or "").upper()
                if st != READY_STATUS:                    # owner rule: ready stock only
                    k = f"not_ready_{st.lower() or 'unstated'}"
                    skipped[k] = skipped.get(k, 0) + 1
                    continue
                got = map_unit(proj, u)
                if got is None:
                    k = f"type_unmapped_{(u.get('type') or 'none')}"
                    skipped[k] = skipped.get(k, 0) + 1
                    continue
                row, cat = got
                (com if cat == "commercial" else res).append(row)

        if skipped:
            print("  skipped (not guessed): "
                  + ", ".join(f"{k}x{v}" for k, v in sorted(skipped.items())), flush=True)
        if dry:
            print(f"DRY: {len(res)} residential + {len(com)} commercial from {seen_units} units")
            for row in (res[:4] + com[:1]):
                print("   ", json.dumps({k: row.get(k) for k in
                      ("ad_number", "property_type", "transaction_type", "price_total",
                       "area_m2", "bedrooms", "bathrooms", "city_ar", "district_ar",
                       "listing_url")}, ensure_ascii=False)[:200])
            return 0

        # A prune on a partial sweep would retire live stock. If any project failed to serve its
        # units this run, the catalogue is INCOMPLETE and prune_unseen must not run.
        complete = (bad_projects == 0)
        db.upsert_rawaf_residential_batch(res)
        db.upsert_rawaf_commercial_batch(com)
        for tbl, rr in (("rawaf_residential_listings", res),
                        ("rawaf_commercial_listings", com)):
            if rr and complete:
                n = db.prune_unseen(tbl, {r["ad_number"] for r in rr}, source=SOURCE,
                                    reason="unit no longer AVAILABLE in the complete /api/deals sweep")
                if n:
                    print(f"  pruned {n} from {tbl}", flush=True)
        if not complete:
            print(f"  NOT pruning: {bad_projects} project(s) did not serve their units this run",
                  flush=True)
        db.end_run(run_id, ok=True, rows_seen=seen_units, rows_upserted=len(res) + len(com))
        print(f"✓ {SOURCE}: {len(res)} residential + {len(com)} commercial upserted", flush=True)
        return 0
    except Exception as e:  # noqa: BLE001
        if run_id:
            db.end_run(run_id, ok=False, rows_seen=seen_units, rows_upserted=0, error=str(e)[:500])
        raise


if __name__ == "__main__":
    raise SystemExit(main())
