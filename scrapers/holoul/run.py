"""Holoul (holoul.io) — developer units for sale. Onboarding 2026-09-27 (wave 3, batch 5).

SOURCE SHAPE (measured live 2026-09-27)
=======================================
The public site is a Nuxt app over an anonymous JSON API (same origin, app.holoul.io):
  list  https://app.holoul.io/customer/api/v1/units/?page=N&per_page=100   {pages, total, result[]}
  page  https://app.holoul.io/units/<uuid>   (NOT /ar/units/ — that path is a 404 shell)
`Accept-Language: ar` returns Arabic names (city الرياض, district الرمال, type دور/شقة).

TRAP 1 — every query parameter (?status=, ?project_number=, …) is SILENTLY IGNORED: the feed always
returns the whole table (238 when measured: drafts, unlisted projects, test rows). The filter is applied
here: the PROJECT must be `listed` and the UNIT must be `listed` (44), and the unit must carry a REGA ad
licence — the 4 units of P100069 have placeholder deeds (000000 / 123456) and no licence, the same
demo-row signature as Muajarh's. A unit whose own record states no advertisement type (10 of P100168)
is skipped, not assumed to be a sale. → 30 rows.
TRAP 2 — MONEY IS IN HALALAS: price 78,500,000 → the page prints SAR 785,000; price_per_meter
487,577 → SAR 4,875.77 (published, never computed here).
AREA: the unit's floor-plan design `total_area` (the unit row itself has none).
The 12 units of P100139 «أدوار حي بدر» are genuinely separate floors with their own pages (same price,
two alternating plans) — kept, they are what the source sells.

PDPL: the licence block names the advertiser and his phone, and the deed number — never stored.
"""
from __future__ import annotations

import argparse
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
from scrapers.common.http import retry_smarter_session  # noqa: E402
from scrapers.common.http_liveness import LivenessProbe  # noqa: E402
from scrapers.common.pii import redact_pii, strip_pii_fields  # noqa: E402
from scrapers.common.source_pin import pin_dict  # noqa: E402

API = "https://app.holoul.io/customer/api/v1/units/"
SITE = "https://app.holoul.io/units/"   # /ar/units/<id> answers 404 (found in the 2026-09-27 real-user click-through)
SOURCE = "حلول"
PREFIX = "HLL"
SLUG = "holoul"
_UTILITIES = {"electricity": "electricity", "water": "water_supply", "sanitation": "sanitation",
              "كهرباء": "electricity", "مياه": "water_supply", "صرف صحي": "sanitation"}
_NEVER_STORE = {"nhc_advertiser_name", "nhc_advertiser_phone", "nhc_advertiser_id", "deed_number",
                "nhc_location_desc_on_moj_deed", "nhc_borders", "nhc_rer_boarders", "agency"}


PER_PAGE = 20     # 2026-10-26: per_page=100 page 1 was 658 KB / 8.2 s against ~1 s for a 10-row page; the
                  # nightly read «HTTP Error 504» 10-21 → 10-25 while every page answered when asked smaller
RETRY_WAITS = (5, 15, 30)


def walk(s: cc.Session) -> tuple[list[dict], int]:
    """Every unit record, in small pages. A 5xx/transport error on a page is retried with a growing wait,
    and the error that finally escapes names the page, so a failed run says WHERE it failed."""
    rows: list[dict] = []
    total = 0
    for page in range(0, 500):
        for attempt in range(len(RETRY_WAITS) + 1):
            try:
                r = s.get(f"{API}?page={page}&per_page={PER_PAGE}", timeout=60,
                          headers={"Accept-Language": "ar"})
                r.raise_for_status()
                d = r.json()
                break
            except Exception as e:  # noqa: BLE001
                if attempt == len(RETRY_WAITS):
                    raise RuntimeError(f"units page {page} (per_page={PER_PAGE}) failed "
                                       f"{attempt + 1}x: {e}") from e
                time.sleep(RETRY_WAITS[attempt])
        total = int(d.get("total") or 0)
        rows += d.get("result") or []
        if page + 1 >= int(d.get("pages") or 1):
            break
    return rows, total


def _name(v: Any) -> Optional[str]:
    return (v or {}).get("name") if isinstance(v, dict) else None


def _sar(halalas: Any) -> Optional[int]:
    try:
        v = int(halalas)
    except (TypeError, ValueError):
        return None
    # the fleet's price columns are integers; like normalize.to_int everywhere else this keeps whole
    # riyals (4,875.77 → 4,875) and the exact halalas stay in source_capture
    return v // 100 if v > 0 else None


def map_unit(u: dict) -> tuple[Optional[tuple[dict, str]], str]:
    proj = u.get("project") or {}
    if proj.get("status") != "listed" or u.get("status") != "listed":
        return None, f"not_listed_{proj.get('status')}_{u.get('status')}"
    if not u.get("nhc_ad_license_number"):
        return None, "no_rega_licence_demo_row"
    ad_type = _name(u.get("nhc_advertisement_type"))
    if ad_type not in ("Sale", "بيع"):
        return None, f"ad_type_unstated_{ad_type}"
    type_ar = _name(u.get("nhc_property_type"))
    ptype = normalize.map_type_exact(type_ar)
    if not ptype:
        return None, f"type_unmapped_{type_ar}"
    category = normalize.category_for_type(ptype).lower()

    design = u.get("design") or {}
    city_ar, district_raw = _name(proj.get("nhc_city")), _name(proj.get("nhc_district"))
    city_id, region_id = to_catalog(city_ar) if city_ar else (None, None)
    district_ar = find_district_in_text(district_raw, city_id) if (city_id and district_raw) else None
    price = _sar(u.get("price"))
    ppm = _sar(u.get("price_per_meter"))
    pics = [m.get("object_url") or m.get("url") for m in (u.get("media_attachments") or [])
            if isinstance(m, dict) and m.get("type") == "picture"]
    photos = [p for p in ([u.get("main_picture")] + pics) if p]
    area = design.get("total_area")
    row: dict[str, Any] = {
        "ad_number": f"{PREFIX}{u['id']}",
        "listing_url": SITE + u["id"],
        "source": SOURCE,
        "active": True,
        "title": redact_pii(f"{proj.get('title') or ''} — {u.get('title') or ''}".strip(" —")) or None,
        "property_type": ptype,
        "transaction_type": "Buy",
        "price_total": price,
        "price_per_meter": ppm,
        "city": normalize.map_city(city_ar) if city_ar else None,
        "city_ar": city_ar,
        "city_id": city_id,
        "region_id": region_id,
        "district_ar": district_ar,
        "neighborhood": district_raw,
        "area_m2": float(area) if area else None,
        "bedrooms": u.get("bedrooms") or design.get("bedrooms") or None,
        "bathrooms": u.get("bathrooms") or design.get("bathrooms") or None,
        "property_age": normalize.exact_age({"new": "جديد"}.get(_name(u.get("nhc_age")) or "", _name(u.get("nhc_age")))),
        "floor_number": u.get("floor") if isinstance(u.get("floor"), int) else None,
        "license_number": u.get("nhc_ad_license_number"),
        "license_expiry": u.get("nhc_end_at"),
        "photo_urls": list(dict.fromkeys(photos)) or None,
    }
    for util in u.get("nhc_utilities") or []:
        col = _UTILITIES.get((_name(util) or "").strip().lower()) or _UTILITIES.get((_name(util) or "").strip())
        if col:
            row[col] = True
    row["price_evidence"] = normalize.price_evidence(
        field="price (halalas)", raw=u.get("price"), stored=price, kind="total", unit="total",
        origin="api", authoritative_absent=False)
    info = {
        "source_id": u["id"],
        "project_number": proj.get("number"),
        "project_title": proj.get("title"),
        "unit_number": u.get("number"),
        "design_title": design.get("title"),
        "living_rooms": u.get("living_rooms") or design.get("living_rooms"),
        "usage": [_name(x) for x in (u.get("nhc_usage") or [])] or None,
        "project_features": [_name(x) for x in (proj.get("features") or [])] or None,
        # The unit's OWN location from the API (audit 2026-10-21): «location»: {latitude, longitude} — the
        # building's national-address point (24.500621,46.735823 for «أدوار بدر»). The page's other pair is
        # the company office («مركز بيور»), never read.
        **pin_dict((u.get("location") or {}).get("latitude"), (u.get("location") or {}).get("longitude")),
    }
    row["additional_info"] = strip_pii_fields({k: v for k, v in info.items() if v not in (None, "", [])})
    cap = {k: v for k, v in u.items() if k.startswith("nhc_") and k not in _NEVER_STORE}
    row["source_capture"] = strip_pii_fields({"schema": "holoul.units.v1", "licence": cap,
                                              "price_halalas": u.get("price"),
                                              "price_per_meter_halalas": u.get("price_per_meter")})
    return (row, category), ""


# ── LIVENESS: the unit's OWN API record (measured 2026-10-27) ───────────────────────────────────
# GET https://app.holoul.io/customer/api/v1/units/<uuid>  (NO trailing slash — with one, every id,
# live or not, answers Django's generic HTML «Not Found» page, which is a ROUTE miss, not an answer):
#   live unit   → 200 JSON whose `id` is this uuid, status «listed», project.status «listed»
#   unknown id  → 404 JSON {"error": ["unit__not_found"]}            → GONE (the source's own words)
#   a 200 for this uuid whose unit or project is no longer «listed»   → GONE (the source unlisted it;
#                 the crawl skips exactly these as not_listed_*)
#   anything else (the HTML route 404, 403/429/5xx, timeout, another id, no licence) → UNKNOWN
# nhc_end_at is NOT read (owner decision 2026-10-02, lifecycle-gaps.txt: every kept row carries a past
# nhc_end_at and the site does not act on it).
UNIT_API = API   # .../units/  + <uuid>
_UUID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")


def _signal_for(uid: str):
    def _signal(status, body, _moved):
        try:
            j = json.loads(body)
        except (ValueError, TypeError):
            return None                       # an HTML page (the route-miss 404) is no answer
        if not isinstance(j, dict):
            return None
        if status == 404 and "unit__not_found" in (j.get("error") or []):
            return "gone"
        if status != 200 or j.get("id") != uid:
            return None
        proj = j.get("project") if isinstance(j.get("project"), dict) else {}
        if j.get("status") is None or proj.get("status") is None:
            return None                       # a record without its status fields says nothing
        if j.get("status") != "listed" or proj.get("status") != "listed":
            return "gone"
        if not j.get("nhc_ad_license_number"):
            return None                       # unlicensed: not inventory we would show, not a removal
        return "live"
    return _signal


def _uid(ad_number: str) -> Optional[str]:
    uid = ad_number[len(PREFIX):] if ad_number.startswith(PREFIX) else ""
    return uid if _UUID_RE.match(uid) else None


def _make_verify_gone(session_fn, control_ad: Optional[str]):
    """verify_gone(ad_number) for prune_unseen and stamp_seen_alive. A removal is withheld unless
    `control_ad` (a unit THIS crawl just served) reads live through the same oracle (fails CLOSED)."""
    state: dict[str, tuple[bool, str]] = {}

    def one(ad_number: str):
        uid = _uid(ad_number)
        if not uid:
            return "unknown", f"{ad_number!r} is not an {PREFIX}<uuid> ad number"
        return LivenessProbe(platform=SLUG, signal=_signal_for(uid), session=session_fn,
                             url_for=lambda _ad: UNIT_API + uid).verify_gone(ad_number)

    def canary() -> tuple[bool, str]:
        if "v" not in state:
            if not control_ad:
                state["v"] = (False, "no unit from this crawl to use as a live control")
            else:
                verdict, why = one(control_ad)
                state["v"] = (verdict == "live", f"control {control_ad}: {verdict} ({why})")
        return state["v"]

    def verify_gone(ad_number: str):
        verdict, why = one(ad_number)
        if verdict == "gone":
            ok, cwhy = canary()
            if not ok:
                return "unknown", f"removal withheld — {cwhy} (would have been: {why})"
        return verdict, why
    return verify_gone


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--type", default="all")
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()
    dry = a.dry_run

    # 3 browser profiles DIRECT, then the residential proxy when the job has it (owner 10-05:
    # every crawler on the shared resilient path; backlog 63). The session owns the profile.
    # The run is registered BEFORE the first fetch (2026-10-23): on 10-22 and 10-23 every route
    # answered 504 and walk() raised before begin_run, so no scrape_runs row existed and the
    # early-warning robot could only say «no run recorded» instead of naming the 504.
    run_id = None if dry else db.begin_run(SLUG)
    units: list[dict] = []
    res: list[dict] = []
    com: list[dict] = []
    skipped: dict[str, int] = {}
    try:
        s, tried = retry_smarter_session(f"{API}?page=0&per_page=1", timeout=40, headers={"Accept-Language": "ar"})
        print(f"  route: {' · '.join(tried)}", flush=True)
        units, declared = walk(s)
        print(f"{SOURCE}: {len(units)} unit record(s) (API declares total={declared})", flush=True)
        for u in units:
            got, why = map_unit(u)
            if not got:
                skipped[why] = skipped.get(why, 0) + 1
                continue
            row, cat = got
            (com if cat == "commercial" else res).append(row)
        if skipped:
            print("  skipped (not guessed): "
                  + ", ".join(f"{k}x{v}" for k, v in sorted(skipped.items())), flush=True)
        if dry:
            print(f"DRY: {len(res)} residential + {len(com)} commercial")
            for row in (res + com)[:40]:
                print("   ", json.dumps({k: row.get(k) for k in
                      ("ad_number", "property_type", "price_total", "price_per_meter", "area_m2",
                       "bedrooms", "property_age", "city_id", "district_ar")}, ensure_ascii=False)[:230])
            return 0

        db.upsert_holoul_residential_batch(res)
        db.upsert_holoul_commercial_batch(com)
        superseded = db.retire_superseded_siblings(
            res_table="holoul_residential_listings", com_table="holoul_commercial_listings",
            res_ads={r["ad_number"] for r in res}, com_ads={r["ad_number"] for r in com}, source=SOURCE)
        if superseded:
            print(f"  retired {superseded} superseded sibling row(s) after a category flip", flush=True)
        complete = len(units) >= declared > 0
        seen_all = sorted(r["ad_number"] for r in res + com)
        verify_gone = _make_verify_gone(lambda: s, seen_all[0] if seen_all else None)
        for tbl, rr in (("holoul_residential_listings", res), ("holoul_commercial_listings", com)):
            if rr and complete:
                n = db.prune_unseen(tbl, {r["ad_number"] for r in rr}, source=SOURCE,
                                    verify_gone=verify_gone)
                if n < 0:
                    print(f"  ⚠ {tbl}: prune guard tripped — kept existing active rows", flush=True)
                elif n:
                    print(f"  pruned {n} from {tbl}", flush=True)
            if rr:
                # Every unit this crawl served gets its OWN record read (2026-10-27): the list is
                # re-read in full nightly, so no row ever reached grace and none was ever verified.
                # Only a 'live' answer writes (the contract's stamp); nothing here can hide a unit.
                db.stamp_seen_alive(tbl, {r["ad_number"] for r in rr}, verify_gone, source=SOURCE)
        if not complete:
            print("  NOT pruning: the walk fell short of the declared total", flush=True)
        healthy = db.end_run(run_id, ok=True, rows_seen=len(units), rows_upserted=len(res) + len(com),
                             check_tables=["holoul_residential_listings", "holoul_commercial_listings"])
        if not healthy:
            print("✗ run demoted to unhealthy by end_run()", flush=True)
            return 1
        print(f"✓ {SOURCE}: {len(res)} residential + {len(com)} commercial upserted", flush=True)
        return 0
    except Exception as e:  # noqa: BLE001
        if run_id:
            db.end_run(run_id, ok=False, rows_seen=len(units), rows_upserted=0, notes=str(e)[:300])
        raise


if __name__ == "__main__":
    raise SystemExit(main())
