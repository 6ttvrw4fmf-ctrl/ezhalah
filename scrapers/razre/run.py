"""راز العقارية / راز الماسية العقارية (razre) — www.razre.sa. A Jeddah developer's own site.

THE SITE WAS REBUILT ON 2026-10-20 (backlog 792/796). Until then it was a Wix site read through the
wix-data collections API; that API, its `signedAppRenderInfo` token and the /onepro-1/ and /com/ pages
are gone (the old paths answer 200 but are redirect shells whose canonical is /projects/…, with no
unit on them). The Wix-era notes — the traps, the open questions, the 2026-09-24 coverage — are in
this file's git history before this rewrite; the mapper rules below are the ones that still hold.

SOURCE SHAPE (measured from CI, probe jobs 120384215404 and 120413670468, 2026-10-23)
-------------------------------------------------------------------------------------
A custom static site. Nothing is rendered by an API we call: every number is in the project page's
own HTML.
  /sitemap.xml         — 27 project pages https://www.razre.sa/projects/<slug>/ (plus /en/, /districts/,
                         /careers/, /news/ — not read). robots.txt disallows /api/ and we never call it.
  /projects/<slug>/    — one page per project, carrying three machine-readable blocks:
    1. an inline JSON  {"project": {"slug","name_ar","name_latin","district","path",…},
                        "units": [[…15 positions…], …]}  — EVERY unit of the project, sold ones too
       (raz-55: 46 records = LD numberOfAccommodationUnits 46; «متاح 17، محجوز 0، مباع 29»).
       A unit is a positional array:
         0 id ("u23")   1 building ("55")   2 floor number (1)   3 floor label («الأول»)
         4 unit number ("B1")   5 type (apartment | annex)   6 area m² (106)
         7 rooms (3)   8 bathrooms (3)   9 an unlabelled count (1, kept raw)
         10 facing («أمامية»)   11 view   12 model ("B")   13 status (available | sold | reserved)
         14 price (583000, or null)
       Positions 7 and 8 are read as the Wix-era «الغرف» and «دورات المياه»: the 31 raz-55 rows the
       old site published hold 106 m² → 3 / 3 and 80–85 m² → 2 / 2, exactly what the new array says.
       Position 9 has no label anywhere on the page, so it is kept raw and decides nothing.
    2. the site config  {"lead": {"projects": [{"s": slug, "n", "d", "st": selling|soon|sold_out}]}}
       — the project's OWN status badge («بدأ البيع» on the page is st=selling).
    3. LD-JSON, the ApartmentComplex node: addressLocality («جدة»), geo (the node with «hasMap»; the
       district Place printed beside it has a geo too and is never read), image[], and
       numberOfAccommodationUnits — the count that proves the units JSON is complete.

MAPPER RULES (unchanged from the Wix era, each one measured then)
-----------------------------------------------------------------
· ROW GRAIN IS THE UNIT; listing_url IS THE PROJECT PAGE, the URL the site itself gives the project.
  ad_number = "RAZ-" + slug + "-" + the unit's own id: the id alone is not proven unique across
  projects, and the unit number repeats per floor model, so neither alone is an identity.
· The project's own status: selling → build; soon → SKIP off_plan_project; sold_out → SKIP
  project_sold_out; anything else skips with its own named reason.
· The unit's own status: available → build; sold → SKIP unit_sold; reserved → SKIP unit_reserved.
· PRICE IS THE SOURCE'S FIGURE, never computed. A null price on an available unit is an
  AUTHORITATIVE_NULL (the JSON is complete and the field is present and empty).
· NO RENT ON THIS SITE: transaction_type Buy, price_total only; rent_period / price_annual never written.
· `rooms` is TOTAL rooms (the old «الغرف»), never bedrooms — it goes to additional_info and the
  bedrooms column stays NULL. «الجهة» (أمامية / خلفية / داخلية …) is not a compass bearing; it is
  kept verbatim and the direction column is never written.
· TYPE: apartment → شقة → Apartment; annex → ملحق → Floor (the fleet's shipped mapping, 3 platforms).
· CITY comes only from the project's own LD addressLocality, matched as a named value; the district
  never supplies it (السلامة, الروضة, النهضة exist in several cities).
· PDPL: the page carries the developer's phone and WhatsApp; the config block is never stored, every
  stored payload is built from an allowlist and every free-text value goes through redact_pii().

REMOVAL ORACLE (the project page, read back from the row's stored listing_url)
------------------------------------------------------------------------------
    404 / 410                                        → gone
    200, the unit is in the units JSON, available    → live
    200, the unit is in the units JSON, sold/reserved → gone (the source's own statement)
    200, the unit is ABSENT and the JSON is COMPLETE
         (len(units) == LD numberOfAccommodationUnits) → gone
    anything else (no JSON, an incomplete list, a Wix-era redirect shell)  → UNKNOWN
The Wix-era rows (ad_number RAZ<uuid>, listing_url /onepro-1/… or /com/…) are therefore never killed
by this crawl: their stored page is a redirect shell with no units, so the probe has no opinion. They
are the Lifecycle Engineer's (backlog 793).
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
from scrapers.common.http import TRANSIENT_STATUSES  # noqa: E402
from scrapers.common.http_liveness import LivenessProbe, stored_listing_url  # noqa: E402
from scrapers.common.pii import redact_pii, strip_pii_fields  # noqa: E402
from scrapers.common.source_pin import pin_dict  # noqa: E402

BASE = "https://www.razre.sa"
SITEMAP = f"{BASE}/sitemap.xml"
# Kept as the Wix-era name the cards already show (the rebuilt site calls itself «راز الماسية
# العقارية»); renaming a platform's card label is a separate decision, not part of a fetch rewrite.
SOURCE = "راز العقارية"
PREFIX = "RAZ"
SLUG = "razre"

_PROJECT_URL_RE = re.compile(r"^https://www\.razre\.sa/projects/([a-z0-9][a-z0-9-]*)/$")
_LOC_RE = re.compile(r"<loc>\s*([^<\s]+)\s*</loc>")
_SCRIPT_RE = re.compile(r"<script\b([^>]*)>(.*?)</script>", re.S | re.I)

_PROJECT_STATUS_SKIP = {"soon": "off_plan_project", "sold_out": "project_sold_out"}
_UNIT_STATUS_SKIP = {"sold": "unit_sold", "reserved": "unit_reserved"}
_TYPE_AR = {"apartment": "شقة", "annex": "ملحق"}
_TYPE_OVERRIDES = {"ملحق": "Floor"}
_CITY_AR = {"جدة": "جدة", "جده": "جدة", "jeddah": "جدة"}
_UNIT_LEN = 15


def _tally(skipped: dict[str, int]) -> str:
    return " ".join(f"{k}={v}" for k, v in sorted(skipped.items(), key=lambda kv: -kv[1]))


def _clean(v) -> Optional[str]:
    s = str(v).strip() if v is not None else ""
    return s or None


def _pos(v) -> Optional[int]:
    if isinstance(v, bool) or not isinstance(v, (int, float)):
        return None
    return int(round(v)) if v > 0 else None


def _floor(v) -> Optional[int]:
    """The unit's floor number; 0 (ground) is a real answer, a negative or absurd one is not."""
    if isinstance(v, bool) or not isinstance(v, int):
        return None
    return v if 0 <= v <= 100 else None


# ── PAGE PARSE (pure: the tests feed it saved HTML) ──────────────────────────────────────────────
def project_urls(sitemap_xml: str) -> list[str]:
    """The Arabic project pages the sitemap lists, in its order, without duplicates."""
    out: list[str] = []
    for loc in _LOC_RE.findall(sitemap_xml or ""):
        if _PROJECT_URL_RE.match(loc) and loc not in out:
            out.append(loc)
    return out


def _json_scripts(html: str) -> list[Any]:
    found = []
    for attrs, body in _SCRIPT_RE.findall(html or ""):
        body = body.strip()
        if not body.startswith(("{", "[")):
            continue
        try:
            found.append(json.loads(body))
        except ValueError:
            continue
    return found


def _ld_nodes(blocks: list[Any]) -> list[dict]:
    nodes: list[dict] = []
    for b in blocks:
        for top in (b if isinstance(b, list) else [b]):
            if isinstance(top, dict):
                graph = top.get("@graph")
                nodes.extend(n for n in (graph if isinstance(graph, list) else [top]) if isinstance(n, dict))
    return nodes


def parse_project_page(html: str) -> Optional[dict]:
    """{"project", "units", "status", "complex"} from a project page, or None when the page does not
    carry the units JSON (a redirect shell, an error page, a layout change)."""
    blocks = _json_scripts(html)
    data = next((b for b in blocks if isinstance(b, dict) and isinstance(b.get("project"), dict)
                 and isinstance(b.get("units"), list)), None)
    if data is None:
        return None
    project = data["project"]
    slug = _clean(project.get("slug"))
    status = None
    for b in blocks:
        lead = b.get("lead") if isinstance(b, dict) else None
        projects = lead.get("projects") if isinstance(lead, dict) else None
        for p in projects if isinstance(projects, list) else []:
            if isinstance(p, dict) and _clean(p.get("s")) == slug:
                status = _clean(p.get("st"))
    complex_node = next((n for n in _ld_nodes(blocks) if n.get("@type") == "ApartmentComplex"
                         and "hasMap" in n), None) or next(
        (n for n in _ld_nodes(blocks) if n.get("@type") == "ApartmentComplex"), None)
    return {"project": project, "units": data["units"], "status": status, "complex": complex_node or {}}


def declared_units(page: dict) -> Optional[int]:
    n = (page.get("complex") or {}).get("numberOfAccommodationUnits")
    v = n.get("value") if isinstance(n, dict) else n
    return v if isinstance(v, int) and not isinstance(v, bool) else None


def page_lists_every_unit(page: dict) -> bool:
    """True only when the page's own unit list is as long as the count its LD-JSON declares."""
    n = declared_units(page)
    return n is not None and n == len(page.get("units") or [])


def _city(complex_node: dict) -> tuple[Optional[str], Optional[str]]:
    addr = complex_node.get("address") if isinstance(complex_node, dict) else None
    raw = _clean(addr.get("addressLocality")) if isinstance(addr, dict) else None
    return (_CITY_AR.get((raw or "").lower()) if raw else None), raw


def _photos(complex_node: dict) -> Optional[list[str]]:
    imgs = complex_node.get("image") if isinstance(complex_node, dict) else None
    imgs = imgs if isinstance(imgs, list) else ([imgs] if isinstance(imgs, str) else [])
    out = [u for u in imgs if isinstance(u, str) and u.startswith(BASE + "/media/")]
    return out or None


def _pin(complex_node: dict) -> dict:
    geo = complex_node.get("geo") if isinstance(complex_node, dict) else None
    return pin_dict(geo.get("latitude"), geo.get("longitude")) if isinstance(geo, dict) else {}


def map_listing(unit: Any, page: dict, url: str) -> tuple[Optional[dict], str, str]:
    """(row, category, skip_reason) for ONE unit array. row is None exactly when a reason is set."""
    if not isinstance(unit, list) or len(unit) < _UNIT_LEN:
        return None, "residential", "unit_shape_changed"
    (uid, building, floor_no, floor_label, unit_no, type_en, area, rooms, baths, extra,
     facing, view, model, ustatus, price) = unit[:_UNIT_LEN]
    uid = _clean(uid)
    project = page["project"]
    slug = _clean(project.get("slug"))
    if not uid or not slug or not re.fullmatch(r"[A-Za-z0-9_-]+", uid):
        return None, "residential", "no_id"

    pstatus = page.get("status")
    if pstatus != "selling":
        return None, "residential", _PROJECT_STATUS_SKIP.get(pstatus or "",
                                                            f"project_status_unknown_{pstatus or 'blank'}")
    ustatus = _clean(ustatus)
    if ustatus != "available":
        return None, "residential", _UNIT_STATUS_SKIP.get(ustatus or "",
                                                         f"unit_status_unknown_{ustatus or 'blank'}")

    type_ar = _TYPE_AR.get(_clean(type_en) or "")
    property_type = normalize.map_type_exact(type_ar, _TYPE_OVERRIDES) if type_ar else None
    if not property_type:
        return None, "residential", f"type_unmapped_{_clean(type_en) or 'blank'}"
    category = normalize.category_for_type(property_type).lower()

    cx = page.get("complex") or {}
    city_ar, city_raw = _city(cx)
    if not city_ar:
        return None, category, (f"city_unmapped_{city_raw}" if city_raw else "city_unstated")
    city_id, region_id = to_catalog(city_ar, None)
    if not city_id:
        return None, category, "city_not_in_catalog"

    district_raw = redact_pii(_clean(project.get("district")))
    district_ar = find_district_in_text(district_raw, city_id)
    name = redact_pii(_clean(project.get("name_ar")))
    unit_no = redact_pii(_clean(unit_no))
    building = redact_pii(_clean(building))
    floor_label = redact_pii(_clean(floor_label))
    title = " - ".join(p for p in (
        " ".join(x for x in (type_ar, unit_no) if x),
        f"مبنى {building}" if building else None,
        f"الدور {floor_label}" if floor_label else None,
        name) if p)

    price_v = price if isinstance(price, (int, float)) and not isinstance(price, bool) and price > 0 else None
    price_v = int(price_v) if price_v is not None else None
    row: dict[str, Any] = {
        "ad_number": f"{PREFIX}-{slug}-{uid}",
        "listing_url": url,
        "source": SOURCE,
        "active": True,
        "title": title,
        "property_type": property_type,
        "transaction_type": "Buy",
        "city": normalize.map_city(city_ar),
        "city_ar": city_ar,
        "city_id": city_id,
        "region_id": region_id,
        "district_ar": district_ar,
        "neighborhood": district_raw,
        "project_name": name,
        "area_m2": _pos(area),
        "bathrooms": _pos(baths),
        "floor_number": _floor(floor_no),
        "photo_urls": _photos(cx),
        "price_total": price_v if price_v is not None else db.AUTHORITATIVE_NULL,
    }
    row["price_evidence"] = normalize.price_evidence(
        field="units[14]", raw=price, stored=price_v, kind="total", unit="total", origin="structured",
        authoritative_absent=price_v is None)
    row["images_evidence"] = {"observed": True, "container_present": "image" in cx,
                              "key_present": bool(cx.get("image")), "count": len(row["photo_urls"] or []),
                              "source_field": "ld_json.image"}
    amenities = [redact_pii(_clean(a.get("name"))) for a in cx.get("amenityFeature") or []
                 if isinstance(a, dict) and a.get("value") is True and _clean(a.get("name"))]
    info = {
        "source_record_id": uid,
        "project_slug": slug,
        "project_status": pstatus,
        "unit_status": ustatus,
        "unit_number": unit_no,
        "unit_model": redact_pii(_clean(model)),
        "unit_building": building,
        "floor_ar": floor_label,
        "type_ar": type_ar,
        "total_rooms": _pos(rooms),                       # TOTAL rooms, never bedrooms
        "unit_field_9_raw": extra,                        # unlabelled on the page; decides nothing
        "facing_ar": redact_pii(_clean(facing)),          # never a compass bearing
        "view_ar": redact_pii(_clean(view)),
        "source_area_raw": area,
        "project_units_total": declared_units(page),
        "project_amenities_ar": amenities or None,
        **_pin(cx),
    }
    row["additional_info"] = strip_pii_fields({k: v for k, v in info.items() if v is not None})
    row["source_capture"] = strip_pii_fields({
        "schema": "razre.project-page.units.v2",
        "unit": [redact_pii(v) if isinstance(v, str) else v for v in unit[:_UNIT_LEN]],
        "project": {k: redact_pii(project[k]) if isinstance(project[k], str) else project[k]
                    for k in ("slug", "name_ar", "name_latin", "district", "path") if k in project},
    })
    return row, category, ""


# ── FETCH ────────────────────────────────────────────────────────────────────────────────────────
def session() -> cc.Session:
    s = cc.Session(impersonate="chrome")     # impersonate OWNS the User-Agent
    s.headers.update({"Accept-Language": "ar,en;q=0.7", "Referer": BASE + "/"})
    return s


def _get(s: cc.Session, url: str):
    r = None
    for _ in range(3):
        r = s.get(url, timeout=45)
        if r.status_code not in TRANSIENT_STATUSES:
            break
    return r


def crawl(s: cc.Session, limit: int = 0) -> tuple[list[dict], list[dict], dict, bool]:
    """(residential, commercial, skip tally, catalogue complete)."""
    r = _get(s, SITEMAP)
    if r is None or r.status_code != 200:
        raise RuntimeError(f"{SITEMAP} returned {getattr(r, 'status_code', 'no response')}")
    urls = project_urls(r.text)
    if not urls:
        raise RuntimeError(f"{SITEMAP} lists no /projects/<slug>/ page — the site's layout changed")
    print(f"  sitemap: {len(urls)} project pages", flush=True)
    res: list[dict] = []
    com: list[dict] = []
    skipped: dict[str, int] = {}
    complete = True
    for url in urls:
        p = _get(s, url)
        page = parse_project_page(p.text) if p is not None and p.status_code == 200 else None
        if page is None:
            complete = False
            why = f"page_{getattr(p, 'status_code', 'none')}" if p is None or p.status_code != 200 else "page_no_units_json"
            skipped[why] = skipped.get(why, 0) + 1
            print(f"  ⚠ {url}: {why}", flush=True)
            continue
        # A page whose unit list is shorter than its own LD count does NOT make the catalogue
        # incomplete: absence on such a page is already UNKNOWN in _signal, so the prune cannot
        # kill through it. Only an unreadable page does. (raz-elevate, «soon», publishes 0 units
        # and no count; gating on it kept every prune off from the first crawl, 2026-10-24.)
        print(f"  {page['project'].get('slug')}: status={page['status']} units={len(page['units'])} "
              f"declared={declared_units(page)}", flush=True)
        for unit in page["units"]:
            row, cat, why = map_listing(unit, page, url)
            if not row:
                skipped[why] = skipped.get(why, 0) + 1
                continue
            (com if cat == "commercial" else res).append(row)
            if limit and len(res) + len(com) >= limit:
                return res, com, skipped, False
    if skipped.get("unit_shape_changed"):
        raise RuntimeError(f"{skipped['unit_shape_changed']} unit arrays no longer have {_UNIT_LEN} positions")
    return res, com, skipped, complete


# ── LIVENESS ─────────────────────────────────────────────────────────────────────────────────────
def _signal(uid: str):
    def signal(status, body, _moved) -> Optional[str]:
        if status in (404, 410):
            return "gone"
        if status != 200:
            return None
        page = parse_project_page(body)
        if page is None:
            return None                         # a redirect shell or a layout change — no opinion
        for unit in page["units"]:
            if isinstance(unit, list) and len(unit) >= _UNIT_LEN and _clean(unit[0]) == uid:
                return "live" if _clean(unit[13]) == "available" else "gone"
        return "gone" if page_lists_every_unit(page) else None
    return signal


def _uid(ad_number: str) -> str:
    """The unit id of a v2 ad number «RAZ-<slug>-<uid>»; "" for anything else (a Wix-era row)."""
    if not ad_number.startswith(PREFIX + "-"):
        return ""
    return ad_number.rsplit("-", 1)[-1]


def _make_verify_gone(control: Optional[dict]):
    url_for = stored_listing_url((f"{SLUG}_residential_listings", f"{SLUG}_commercial_listings"))

    def canary() -> tuple[bool, str]:
        if not control:
            return False, "no row from this run to use as a positive control"
        verdict, why = LivenessProbe(
            platform=SLUG, signal=_signal(_uid(control["ad_number"])), session=session,
            url_for=lambda _ad: control["listing_url"]).verify_gone(control["ad_number"])
        return verdict == "live", f"positive control {control['ad_number']}: {why}"

    def probe(ad_number: str):
        uid = _uid(ad_number)
        if not uid:
            return "unknown", f"{ad_number!r} is a Wix-era row; its page no longer lists units"
        url = url_for(ad_number)
        return LivenessProbe(platform=SLUG, signal=_signal(uid), session=session,
                             url_for=lambda _ad: url, canary=canary).verify_gone(ad_number)

    return probe


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--type", choices=["residential", "commercial", "all"], default="all")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    s = session()
    dry = args.dry_run or bool(args.limit)
    # begin_run BEFORE the fetch: a source that goes dark must still leave a scrape_runs row.
    run_id = None if dry else db.begin_run(SLUG)
    skipped: dict[str, int] = {}
    try:
        res, com, skipped, complete = crawl(s, limit=args.limit)
        if not (res or com):
            raise RuntimeError("no unit mapped from any project page — skips: " + (_tally(skipped) or "none"))
        if args.type != "all":
            res, com = (res, []) if args.type == "residential" else ([], com)
        notes = _tally(skipped)
        if skipped:
            print("  skipped (not guessed): " + notes)
        if dry:
            print(f"✓ {SOURCE} VALIDATION: {len(res)} residential + {len(com)} commercial "
                  f"(nothing written)")
            for r0 in (res + com)[:30]:
                print(f"   {r0['ad_number'][:22]:>22} {r0['transaction_type']:4} "
                      f"{str(r0['property_type']):10} {str(r0['city_ar']):6} "
                      f"d={str(r0['district_ar'])[:10]:10} a={str(r0['area_m2']):>5} "
                      f"ba={str(r0.get('bathrooms')):>3} fl={str(r0.get('floor_number')):>3} "
                      f"pt={r0.get('price_total')} ph={len(r0.get('photo_urls') or [])} "
                      f"| {r0['title'][:44]}")
            return 0
        db._wasalt_batch(f"{SLUG}_residential_listings", res)
        db._wasalt_batch(f"{SLUG}_commercial_listings", com)
        superseded = db.retire_superseded_siblings(
            res_table=f"{SLUG}_residential_listings", com_table=f"{SLUG}_commercial_listings",
            res_ads={r["ad_number"] for r in res}, com_ads={r["ad_number"] for r in com},
            source=SOURCE)
        if superseded:
            print(f"  retired {superseded} superseded sibling row(s) after a category flip")
        pruned = 0
        if args.type == "all" and complete:
            verify_gone = _make_verify_gone((res + com)[0] if (res or com) else None)
            for tbl, rows in ((f"{SLUG}_residential_listings", res),
                              (f"{SLUG}_commercial_listings", com)):
                n = db.prune_unseen(tbl, {r["ad_number"] for r in rows}, source=SOURCE,
                                    verify_gone=verify_gone)
                if n < 0:
                    print(f"  ⚠ {tbl}: prune guard tripped — kept existing active rows")
                else:
                    pruned += n
        elif args.type == "all":
            print("  prune skipped: a project page was unreadable or its unit list is incomplete")
        healthy = db.end_run(run_id, ok=True, rows_seen=len(res) + len(com) + sum(skipped.values()),
                             rows_upserted=len(res) + len(com),
                             notes=f"pruned={pruned} complete={complete} {notes}"[:300],
                             check_tables=["razre_residential_listings",
                                           "razre_commercial_listings"])
        if not healthy:
            print("✗ run demoted to unhealthy by end_run()'s RC-B guard", flush=True)
            return 1
        print(f"✓ {SOURCE}: {len(res)} residential + {len(com)} commercial upserted")
        return 0
    except Exception as e:
        if run_id:
            db.end_run(run_id, ok=False, rows_seen=0, rows_upserted=0,
                       notes=(f"{e}"[:250] + " | skips: " + (_tally(skipped) or "none"))[:300])
        print(f"✗ {SOURCE}: {e}", flush=True)
        return 1


# Owner 2026-10-13: every site keeps its COMPLETE source record (PDPL-clean) beside the mapped columns.
from scrapers.common.capture import capture_source_items  # noqa: E402
capture_source_items(globals())


if __name__ == "__main__":
    raise SystemExit(main())
