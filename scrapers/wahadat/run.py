"""وحدات (Wahadat) — wahadat.sa. Project→unit developer platform, onboarding 2026-09-26.

SOURCE SHAPE (measured live 2026-09-26 on 14 sampled project pages before any code was written)
================================================================================================
Next.js App Router. There is NO `__NEXT_DATA__`; every page ships its data as RSC flight rows
(`self.__next_f.push([1,"<json-string>"])`). Concatenating those strings AFTER `json.loads` on each
one (they are JSON string literals — a `unicode_escape` pass mangles the Arabic) yields ~133 KB of
plain text per project page that contains two complete objects:

  · the PROJECT  — name/name_ar, city, neighborhood, types[], category, advertisement_purpose,
                   license_number, latitude/longitude, is_active, start_area, phone_number
  · `unitsData`  — the per-unit array, which is what we actually list:
        {"name":"A1","status":"available","price":2139000,"meter_price":8564.56,
         "floor":"G","area":249.75,"rooms":4,"toilets":5,
         "has_private_sitting_room":true,"has_basement_parking":true,"sold_at":null}

INVENTORY = THE SITEMAP. `https://wahadat.sa/sitemap.xml` lists exactly 100 `/project/<slug>` URLs
(plus 36 `/projects/*` category pages and 7 static pages, all skipped). It is therefore a complete
enumeration and a removal oracle: a project that leaves the sitemap is gone.

WHY THE PAGES AND NOT THE API (two independent reasons, both checked):
  1. `wahadat.sa/robots.txt` Disallows `/api/`. The pages are explicitly not disallowed.
  2. The project object's own `absolute_url` points at `https://pro.wahadat.sa/ar/project/api/
     projects/<uuid>/`, a DIFFERENT host (whose robots.txt is a 404, i.e. nothing declared) — but
     it answers **403** to an unauthenticated GET, so it is not usable anyway.
  The page already carries the full structured payload, so nothing is lost by reading it.

*** READY UNITS ONLY — OWNER RULE, 2026-09-25 ***
The owner's instruction for this platform was explicit: «make sure u r not getting the proejcts they
want to built we want projects that r ready». The source states this itself, per UNIT, in
`status`: measured across the 14 sampled projects — `available` ×90, `reserved` ×28, `sold` ×10.
Only `available` is listed. `reserved` and `sold` are skipped and COUNTED, never inferred from
prose, and the site's own `/sold-out` page corroborates that sold stock is tracked separately.
A project whose units are all reserved/sold contributes nothing rather than contributing a shell.

*** THE TYPE FIELD IS ARABIC, AND «ڤيلا» IS SPELLED WITH ڤ (U+06A4) ***
The owner warned the property type would be "in english" with «تاون هاوس» written in Arabic inside
it. Measured, it is Arabic throughout: «دور» ×90, «تاون هاوس» ×30, «ڤيلا» ×10, «شقة» ×10. Two traps:
  · «تاون هاوس» IS already in `src/data/propertyTypes.ts` (→ Villa), so it needs no new mapping.
  · «ڤيلا» uses ڤ (FEH WITH THREE DOTS ABOVE), NOT the standard «فيلا» our taxonomy knows. Left
    alone it would resolve to nothing and those units would land type-less. `_norm_type` rewrites
    ڤ→ف so the source's own word reaches the taxonomy unchanged in meaning.

BEDROOMS STAY EMPTY. The unit payload's `rooms` is never labelled as bedrooms anywhere on the page
or in the data (no «غرف النوم» string exists in either), and the whole fleet has been bitten by
exactly this (tuba's 150 «غرف النوم» on an office, iBaax's rooms≠bedrooms, villassa's «عدد الغرف»).
So `rooms` is kept verbatim as `source_rooms` in additional_info and `bedrooms` is left NULL rather
than guessed. `toilets` IS unambiguous and maps to bathrooms.

PRICE = SOURCE. `price` is the unit's own printed figure, stored verbatim as `price_total` for a
sale. `meter_price` is the source's own published per-metre rate and is stored as
`price_per_meter` — never multiplied into, or derived from, the total.

PDPL. The project object carries `phone_number` (and the owner block a contact name). Neither is
ever stored: everything written goes through `strip_pii_fields`/`redact_pii`.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any, Optional

from curl_cffi import requests as cc

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from scrapers.common import db, normalize  # noqa: E402
from scrapers.common.arabic_location import find_district_in_text, to_catalog  # noqa: E402
from scrapers.common.pii import redact_pii, strip_pii_fields  # noqa: E402

BASE = "https://wahadat.sa"
SITEMAP = f"{BASE}/sitemap.xml"
SOURCE = "وحدات"
PREFIX = "WHD"
SLUG = "wahadat"

IMPERSONATE = "chrome"
TIMEOUT = 40

# The one status the owner's ready-only rule admits. Measured values: available/reserved/sold.
READY_STATUS = "available"

# «تاون هاوس» is NOT in the scrapers' own map_type_exact table, but the SHIPPED APP already maps it
# (src/data/propertyTypes.ts:180 — «تاون هاوس»: 'Villa', and Villa's rawTypes list includes it). So
# this override does not invent a classification; it closes a backend/frontend gap that would
# otherwise skip every townhouse on this source (30 of 128 units measured 2026-09-26).
_TYPE_OVERRIDES = {"تاون هاوس": "Villa"}

_FLIGHT = re.compile(r'self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)', re.S)


def flight_text(html: str) -> str:
    """The page's RSC payload as one plain string.

    Each pushed chunk is a JSON *string literal*; `json.loads` on each is what restores real UTF-8.
    A blanket `unicode_escape` decode mangles every Arabic character (measured), so it is not used.
    """
    out = []
    for lit in _FLIGHT.findall(html):
        try:
            out.append(json.loads(lit))
        except Exception:
            continue
    return "".join(out)


def _json_after(text: str, key: str, start: int = 0) -> tuple[Optional[Any], int]:
    """Decode the JSON value that follows `"key":` at/after `start`, using a real JSON scanner.

    Brace-counting breaks on braces inside Arabic strings and on escaped quotes; `json.JSONDecoder
    .raw_decode` is the actual grammar, so it stops exactly where the value ends.
    """
    i = text.find(f'"{key}":', start)
    if i < 0:
        return None, -1
    j = i + len(key) + 3
    try:
        val, end = json.JSONDecoder().raw_decode(text, j)
    except ValueError:
        return None, i + 1
    return val, end


def _norm_type(raw: Optional[str]) -> Optional[str]:
    """The source's own type word, with «ڤيلا» folded to «فيلا».

    ڤ (U+06A4) is a Persian/loanword letter the Saudi taxonomy never uses; «ڤيلا» and «فيلا» are the
    same word. Only that one letter is rewritten — the word is not translated or re-classified.
    """
    t = (raw or "").strip()
    return t.replace("ڤ", "ف") or None


def parse_project(html: str, url: str) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    """(project, units) from one project page's flight payload."""
    txt = flight_text(html)
    proj: dict[str, Any] = {}
    for k in ("name_ar", "name", "city", "neighborhood", "category",
              "advertisement_purpose", "license_number", "latitude", "longitude",
              "is_active", "slug", "about_ar"):
        v, _ = _json_after(txt, k)
        if v is not None and k not in proj:
            proj[k] = v
    types, _ = _json_after(txt, "types")
    proj["types"] = [t.get("name") for t in (types or []) if isinstance(t, dict) and t.get("name")]
    units, _ = _json_after(txt, "unitsData")
    proj["url"] = url
    return proj, [u for u in (units or []) if isinstance(u, dict)]


def resolve_type(proj: dict[str, Any]) -> tuple[Optional[str], str]:
    """(canonical English type, skip_reason) for a project's single declared type.

    `category_for_type` takes the CANONICAL ENGLISH name, not the Arabic word — handing it Arabic
    returns "Commercial" for everything (it is a set-membership test), which would have filed every
    residential دور into the commercial table. So the Arabic word is resolved through
    `map_type_exact` first, and an unmapped word SKIPS the unit with a counted reason.
    """
    names = [t for t in (proj.get("types") or []) if (t or "").strip()]
    if len(names) != 1:
        return None, f"type_count_{len(names)}"
    raw = _norm_type(names[0])
    en = normalize.map_type_exact(raw, _TYPE_OVERRIDES)
    if not en:
        return None, f"type_unmapped_{raw}"
    return en, ""


def map_unit(proj: dict[str, Any], u: dict[str, Any], ptype: str) -> tuple[dict[str, Any], str]:
    """(row, category) for ONE unit already proven `status == available` and type-resolved."""
    category = normalize.category_for_type(ptype).lower()

    city_ar = (proj.get("city") or "").strip() or None
    hood = (proj.get("neighborhood") or "").strip() or None
    city_id, region_id = to_catalog(city_ar) if city_ar else (None, None)
    district_ar = find_district_in_text(hood, city_id) if (hood and city_id) else None

    purpose = (proj.get("advertisement_purpose") or "").strip().lower()
    deal = "Rent" if purpose == "rent" else "Buy"

    price = u.get("price")
    price = price if isinstance(price, (int, float)) and price > 0 else None
    ppm = u.get("meter_price")
    ppm = ppm if isinstance(ppm, (int, float)) and ppm > 0 else None
    area = u.get("area")
    area = area if isinstance(area, (int, float)) and area > 0 else None

    uid = str(u.get("id") or "").replace("-", "")[:12]
    title = redact_pii(" ".join(x for x in [proj.get("name_ar") or proj.get("name"),
                                            u.get("name_ar") or u.get("name")] if x)) or None

    row: dict[str, Any] = {
        "ad_number": f"{PREFIX}{uid}",
        # No per-unit page exists on this platform (the unit API is on pro.wahadat.sa and answers
        # 403), so every unit of a project links to that project's own page — a real page the user
        # can read, listing that unit, not a fabricated deep link.
        "listing_url": proj.get("url"),
        "source": SOURCE,
        "active": True,
        "title": title,
        "property_type": ptype,
        "transaction_type": "Rent" if deal == "Rent" else "Buy",
        "city": normalize.map_city(city_ar) if city_ar else None,
        "city_ar": city_ar,
        "city_id": city_id,
        "region_id": region_id,
        "district_ar": district_ar,
        "neighborhood": hood,
        "area_m2": area,
        # bedrooms deliberately absent — see the module docstring: `rooms` is not a bedroom count.
        "bathrooms": u.get("toilets") if isinstance(u.get("toilets"), int) else None,
        "parking": True if u.get("has_basement_parking") else None,
        "license_number": proj.get("license_number") or None,
        "latitude": proj.get("latitude"),
        "longitude": proj.get("longitude"),
    }
    if deal == "Buy":
        row["price_total"] = price
    else:
        row["price_annual"] = price
    if ppm is not None:
        row["price_per_meter"] = ppm

    row["price_evidence"] = normalize.price_evidence(
        field="price", raw=str(u.get("price")), stored=price,
        kind="total" if deal == "Buy" else "annual", unit="total", origin="api",
        authoritative_absent=(u.get("price") is None))

    info = {
        "unit_name": u.get("name_ar") or u.get("name"),
        "unit_status": u.get("status"),
        "source_rooms": u.get("rooms"),          # NOT bedrooms — see docstring
        "floor_label": u.get("floor"),
        "project_name": proj.get("name_ar") or proj.get("name"),
        "project_types": proj.get("types") or None,
        "meter_price_source": ppm,
        "has_private_sitting_room": u.get("has_private_sitting_room"),
    }
    row["additional_info"] = strip_pii_fields({k: v for k, v in info.items() if v is not None})
    row["source_capture"] = strip_pii_fields({"schema": "wahadat.rsc-unitsData.v1", **u})
    return row, category


def sitemap_projects(sess) -> list[str]:
    r = sess.get(SITEMAP, impersonate=IMPERSONATE, timeout=TIMEOUT)
    r.raise_for_status()
    return sorted({m for m in re.findall(r"<loc>(https://wahadat\.sa/project/[^<]+)</loc>", r.text)})


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--type", default="all")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()
    dry = a.dry_run

    sess = cc.Session()
    urls = sitemap_projects(sess)
    if a.limit:
        urls = urls[: a.limit]
    print(f"{SOURCE}: {len(urls)} project(s) in sitemap", flush=True)

    run_id = None if dry else db.begin_run(SLUG)
    res: list[dict] = []
    com: list[dict] = []
    skipped: dict[str, int] = {}
    seen_projects = 0
    try:
        for u in urls:
            try:
                r = sess.get(u, impersonate=IMPERSONATE, timeout=TIMEOUT)
                if r.status_code != 200:
                    skipped[f"http_{r.status_code}"] = skipped.get(f"http_{r.status_code}", 0) + 1
                    continue
                proj, units = parse_project(r.text, u)
            except Exception as e:                      # noqa: BLE001
                skipped[f"fetch_{type(e).__name__}"] = skipped.get(f"fetch_{type(e).__name__}", 0) + 1
                continue
            seen_projects += 1
            ptype, why = resolve_type(proj)
            if not ptype:
                skipped[why] = skipped.get(why, 0) + len(units) or 1
                continue
            for unit in units:
                st = (unit.get("status") or "").strip().lower()
                if st != READY_STATUS:                  # owner rule: ready units only
                    k = f"not_ready_{st or 'unstated'}"
                    skipped[k] = skipped.get(k, 0) + 1
                    continue
                row, cat = map_unit(proj, unit, ptype)
                if not row["ad_number"].strip(PREFIX):
                    skipped["no_unit_id"] = skipped.get("no_unit_id", 0) + 1
                    continue
                (com if cat == "commercial" else res).append(row)

        if skipped:
            print("  skipped (not guessed): "
                  + ", ".join(f"{k}x{v}" for k, v in sorted(skipped.items())), flush=True)
        if dry:
            print(f"DRY: {len(res)} residential + {len(com)} commercial from {seen_projects} projects")
            for row in (res[:3] + com[:1]):
                print("   ", json.dumps({k: row.get(k) for k in
                      ("ad_number", "property_type", "transaction_type", "price_total",
                       "price_per_meter", "area_m2", "bathrooms", "city_ar", "district_ar")},
                      ensure_ascii=False))
            return 0

        db.upsert_wahadat_residential_batch(res)
        db.upsert_wahadat_commercial_batch(com)
        for tbl, rows in (("wahadat_residential_listings", res),
                          ("wahadat_commercial_listings", com)):
            if rows:
                n = db.prune_unseen(tbl, {r["ad_number"] for r in rows}, source=SOURCE,
                                    reason="absent from wahadat sitemap crawl")
                if n:
                    print(f"  pruned {n} from {tbl}", flush=True)
        db.end_run(run_id, ok=True, rows_seen=seen_projects,
                   rows_upserted=len(res) + len(com))
        print(f"✓ {SOURCE}: {len(res)} residential + {len(com)} commercial upserted", flush=True)
        return 0
    except Exception as e:                              # noqa: BLE001
        if run_id:
            db.end_run(run_id, ok=False, rows_seen=seen_projects, rows_upserted=0, error=str(e)[:500])
        raise


if __name__ == "__main__":
    raise SystemExit(main())
