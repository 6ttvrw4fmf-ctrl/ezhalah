"""راكز العقارية — rakez.sa (WordPress + Bricks, ACF-backed `unit` and `project` post types).

A Riyadh-led developer/marketer. Unlike every sibling platform, the thing for sale here is a UNIT
inside a PROJECT, and the two live in different post types:

  /wp-json/wp/v2/unit?per_page=100      14,319 units. acf carries the whole listing:
      unit_project (→ the parent project's id), unit_status, price, rooms_count, area, floor,
      code, description_ar. 98% of units publish a real price (549,000 – 3,820,000 measured).
  /wp-json/wp/v2/project?per_page=100   435 projects: the photo, the location taxonomy, the type.

THE CARD LINKS TO THE PROJECT, NEVER TO THE UNIT — verified 2026-09-14, and this is not a stylistic
choice. `unit.link` (https://rakez.sa/en/unit/<slug>/) SILENTLY REDIRECTS TO THE HOME PAGE: it
answers HTTP 200 with `final_url = https://rakez.sa/en/` and `<title>Home - Rakez`. Sending a user
there is the 404-class defect the owner reported on aqaralsaudia. The project page is real and
carries the unit: https://rakez.sa/ar/project/66800/ answers 200 and its unit table prints
«#F1-144-3 متاحة 1,350,000 ريال 2 160.49 م² rooftop» — the unit's own code, price, rooms, area and
floor, exactly as stored here. So the code is kept in additional_info and the link goes to a page
that genuinely shows it.

ARABIC IS A SEPARATE POST, REACHED BY A DETERMINISTIC BRIDGE. This is a WPML site: each project
exists twice, with DIFFERENT ids, and `unit.acf.unit_project` always points at the ENGLISH one
(measured: 0 of 158 sampled unit_project ids appear in the Arabic project list). The English record
carries the photo; only the Arabic record carries Arabic district/city/type. There is no
`translations` field, `?lang=ar` on a project id returns the English post, and the term slugs do not
align, so none of the usual shortcuts work. What DOES work: /ar/project/<english id>/ serves the
Arabic page, whose body class names the Arabic post — `postid-66825` for English 66800. That id is
an exact value read from the source, never a fuzzy title match (SIMILARITY IS NOT SAMENESS).

LOCATION COMES FROM A HIERARCHY WALK, NOT FROM PARSING. rakez's `city` taxonomy is a TREE:
الياسمين → شمال الرياض → الرياض, العليا → وسط الرياض → الرياض. The deepest term attached to a
project is the district; walking `parent` upward finds the city. The walk is catalog-validated at
every level rather than trusting the root, because one root is a REGION not a city (البندرية's
chain ends at الشرقية, the Eastern Province, skipping الخبر entirely). Anything that fails to
validate stays NULL.

DEAL IS BUY. This is a developer selling freehold; there is no rent anywhere on the site (the
offer-group taxonomy reads البيع على الخارطة / الأراضي / by rakez / سكف — all sale).

WHAT IS EXCLUDED, AND WHY:
  · unit_status other than 'available' — 'reserved' and 'sold-out' are the source stating the unit
    is not purchasable (measured 422/72/6 in a 500-unit sample).
  · projects whose property-status is «قريبا» (coming soon) or «وقف التسويق» (marketing stopped) —
    the same shape as aqaralsaudia's «قيد الإنشاء» exclusion. «تم البيع» is excluded for the same
    reason. Only «متاح» projects contribute units.
"""
from __future__ import annotations

import argparse
import html as ihtml
import re
import sys
import time
from pathlib import Path
from typing import Any, Optional

from curl_cffi import requests as cc

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from scrapers.common import db, normalize  # noqa: E402
from scrapers.common.arabic_location import (  # noqa: E402
    _REGION_AR_FOR, find_district_in_text, norm_ar, to_catalog,
)

SITE = "https://rakez.sa"
REST = f"{SITE}/wp-json/wp/v2"
PER_PAGE = 100
# NO User-Agent HERE, deliberately. curl_cffi's `impersonate=` sets a COMPLETE, internally
# consistent browser header set at the C layer (UA, sec-ch-ua, Accept, …) to match the TLS/JA3
# fingerprint it presents. Overriding just the UA makes the fingerprint and the header disagree,
# which is exactly what bot detection looks for: rakez.sa (Cloudflare) answered 403 to every single
# endpoint with a hardcoded UA and 200 without it, TLS fingerprint otherwise identical (measured
# 2026-09-14). All 46 sibling scrapers already leave the UA alone; these two were the exception.
# Accept-Language is safe and stays — it was verified not to be the trigger.
HEADERS = {
    "Accept-Language": "ar,en;q=0.8",
}

INGESTIBLE_UNIT_STATUS = "available"


def _unit_status(acf: dict) -> str:
    """Lower-cased unit_status. The source publishes BOTH 'available' and 'Available' (4 units of
    14,319, measured 2026-09-14) — an exact comparison silently dropped those four."""
    return str((acf or {}).get("unit_status") or "").strip().lower()


# The source's own project-level status vocabulary. Only «متاح» contributes units.
PROJECT_STATUS_OK = {"متاح"}
PROJECT_STATUS_EXCLUDED = {"قريبا", "وقف التسويق", "تم البيع"}

# rakez's property-type taxonomy, in its own Arabic wording → our canonical type.
_TYPE_MAP = {
    "أدوار": "دور",
    "شقق": "شقة",
    "فلل": "فيلا",
    "تاون هاوس": "تاون هاوس",
    "بنتهاوس": "شقة",       # a penthouse is sold as an apartment in this catalogue
    "رووف": "شقة",
    "ستوديو": "شقة",
    "أرض": "أرض",
    "أبراج": "عمارة",
}

# `floor` is NOT reliably a floor on this source — the same field also carries property types and
# free text ('Villa', 'شقة', 'بنتهاوس', 'الدور الأرضي ونصف الأول', and a literal False). Only the
# values below are read as a floor NUMBER; everything else leaves floor_number NULL and is kept
# verbatim in additional_info instead.
_FLOOR_ORDINALS = {
    "ground": 0, "الأرضي": 0, "الارضي": 0,
    "first": 1, "الأول": 1, "الاول": 1,
    "second": 2, "الثاني": 2,
    "third": 3, "الثالث": 3,
    "fourth": 4, "الرابع": 4,
    "fifth": 5, "الخامس": 5,
    "sixth": 6, "السادس": 6,
}

LAST_FETCH_NOTE = "no pages attempted"


def session() -> cc.Session:
    s = cc.Session(impersonate="chrome124")
    s.headers.update(HEADERS)
    return s


def _clean(s: Optional[str]) -> Optional[str]:
    if not s:
        return None
    t = ihtml.unescape(re.sub(r"<[^>]+>", " ", str(s)))
    t = re.sub(r"\s+", " ", t).strip()
    return t or None


def _to_int(v: Any) -> Optional[int]:
    if v is None or v is False or v is True:
        return None
    s = str(v).translate(str.maketrans("٠١٢٣٤٥٦٧٨٩", "0123456789"))
    s = re.sub(r"[,\s]", "", s)
    m = re.match(r"^(\d+)(?:\.\d+)?$", s)
    if not m:
        return None
    n = int(m.group(1))
    return n if n > 0 else None


def _paged(s: cc.Session, path: str, note: str, extra: str = "") -> list[dict]:
    """Every page of a REST collection, with the retry every sibling scraper learned to need."""
    global LAST_FETCH_NOTE
    out: list[dict] = []
    for page in range(1, 200):
        r = None
        last_exc: Optional[Exception] = None
        for attempt in range(3):
            try:
                r = s.get(f"{REST}/{path}?per_page={PER_PAGE}&page={page}{extra}", timeout=60)
                break
            except Exception as e:
                last_exc = e
                if attempt < 2:
                    time.sleep(3 * (attempt + 1))
        if r is None:
            LAST_FETCH_NOTE = (f"{note} page {page} raised {type(last_exc).__name__} on all 3 "
                               f"attempts: {str(last_exc)[:100]}")
            break
        if r.status_code == 400:           # WP answers 400 past the last page
            break
        if r.status_code != 200:
            LAST_FETCH_NOTE = f"{note} page {page} returned HTTP {r.status_code}"
            break
        try:
            batch = r.json()
        except Exception:
            LAST_FETCH_NOTE = f"{note} page {page} body was not JSON"
            break
        if not isinstance(batch, list) or not batch:
            break
        out.extend(x for x in batch if isinstance(x, dict))
        if len(batch) < PER_PAGE:
            break
    return out


def fetch_units(s: cc.Session) -> list[dict]:
    global LAST_FETCH_NOTE
    LAST_FETCH_NOTE = "no pages attempted"
    units = _paged(s, "unit", "unit")
    if units:
        LAST_FETCH_NOTE = f"read {len(units)} units"
    return units


def fetch_projects(s: cc.Session, lang: str = "") -> dict[int, dict]:
    extra = "&_embed=wp:term,wp:featuredmedia" + (f"&lang={lang}" if lang else "")
    return {p["id"]: p for p in _paged(s, "project", f"project[{lang or 'en'}]", extra)
            if isinstance(p.get("id"), int)}


def fetch_city_terms(s: cc.Session) -> dict[int, dict]:
    """The Arabic `city` taxonomy as a TREE — {id: {name, parent}}. The tree is the whole point:
    a project is tagged with a leaf (the district) and the city is found by walking `parent`."""
    return {t["id"]: {"name": _clean(t.get("name")) or "", "parent": t.get("parent") or 0}
            for t in _paged(s, "city", "city", "&lang=ar") if isinstance(t.get("id"), int)}


_POSTID = re.compile(r"postid-(\d+)")


def arabic_project_id(s: cc.Session, en_id: int) -> Optional[int]:
    """The Arabic twin's post id, read out of the Arabic page's own body class.

    /ar/project/<english id>/ serves the Arabic post (verified: 66800 → postid-66825). This is an
    EXACT id printed by the source, not a title similarity — the only deterministic bridge this
    site offers, since it exposes no translations field and its term slugs do not align.
    """
    # RETRIED, because a single miss is not cheap here: a project with no Arabic twin yields no
    # Arabic property-type, so map_unit() skips EVERY unit under it — one flaky fetch silently
    # costs ~14 listings, and 274 fetches make that near-certain over a run.
    r = None
    for attempt in range(3):
        try:
            r = s.get(f"{SITE}/ar/project/{en_id}/", timeout=45)
            if r.status_code == 200:
                break
            r = None
        except Exception:
            r = None
        if attempt < 2:
            time.sleep(2 * (attempt + 1))
    if r is None:
        return None
    m = _POSTID.search(r.text)
    if not m:
        return None
    ar_id = int(m.group(1))
    return ar_id if ar_id != en_id else None


def _terms_of(project: Optional[dict], taxonomy: str) -> list[dict]:
    if not project:
        return []
    out = []
    for group in (project.get("_embedded") or {}).get("wp:term") or []:
        for t in group or []:
            if isinstance(t, dict) and t.get("taxonomy") == taxonomy:
                out.append(t)
    return out


def _photo(*projects: Optional[dict]) -> list[str]:
    """The first featured image any of the given project records carries. Units have none of their
    own (featured_media is 0 on every unit), so the photo is inherited from the parent — and a
    parent with no photo yields an empty list, never a placeholder."""
    for p in projects:
        for group in (p or {}).get("_embedded", {}).get("wp:featuredmedia") or []:
            if isinstance(group, dict) and group.get("source_url"):
                return [group["source_url"]]
    return []


def _bare_region_labels() -> dict[str, int]:
    """{normalised bare region name → region_id}, e.g. «الشرقية»→5, «الرياض»→1.

    to_catalog() already refuses an explicit «منطقة X» label (the 2026-08-10 rule: region known,
    city UNKNOWN). rakez writes the BARE form — its tree's roots are الرياض, جدة, الشرقية, مكة … —
    so that guard never fires here and «الشرقية» matched a homonym: loc_catalog_city really does
    contain a village called الشرقية (id 14645, region 6), and 182 Khobar/Dammam units would have
    been filed under it instead of the Eastern Province.
    """
    out: dict[str, int] = {}
    for rid, ar in (_REGION_AR_FOR or {}).items():
        out[norm_ar(re.sub(r"^(ال)?منطقة\s+", "", ar or ""))] = rid
    return out


def _city_or_region_homonym(name: str) -> tuple[Optional[int], Optional[int]]:
    """to_catalog(), except a name that is ALSO a bare region label must resolve to a city IN THAT
    REGION or not at all.

    «الرياض» is both region 1 and a real city in region 1 → accepted. «جازان», «تبوك», «نجران»,
    «الباحة» likewise. «الشرقية» is region 5 but the only city of that name sits in region 6 → a
    homonym, refused, and the location stays NULL rather than being placed 700km away.
    """
    cid, rid = to_catalog(name)
    if not cid:
        return None, None
    label_region = _bare_region_labels().get(norm_ar(name))
    if label_region is not None and rid != label_region:
        return None, None
    return cid, rid


def resolve_location(term_ids: list[int], tree: dict[int, dict]) -> tuple[Optional[str], Optional[int],
                                                                         Optional[int], Optional[str]]:
    """(city_ar, city_id, region_id, district_ar) from the taxonomy TREE.

    The deepest tagged term is the district candidate; walking `parent` upward gives its ancestry.
    Every level is checked against OUR catalog rather than trusting the tree's own root, because
    one root is a REGION and not a city: البندرية's chain ends at الشرقية (the Eastern Province),
    skipping الخبر. Nothing that fails to validate is guessed at.
    """
    def depth(tid: int) -> int:
        d, seen = 0, set()
        while tid in tree and tid not in seen and tree[tid]["parent"]:
            seen.add(tid); tid = tree[tid]["parent"]; d += 1
        return d

    tagged = [t for t in term_ids if t in tree]
    if not tagged:
        return None, None, None, None
    leaf = max(tagged, key=depth)

    # ancestry, leaf first
    chain, tid, seen = [], leaf, set()
    while tid in tree and tid not in seen:
        seen.add(tid); chain.append(tree[tid]["name"]); tid = tree[tid]["parent"]

    city_ar = city_id = region_id = None
    for name in chain[1:] or chain:            # a city is never the leaf unless the leaf is all we have
        cid, rid = _city_or_region_homonym(name)
        if cid:
            city_ar, city_id, region_id = name, cid, rid
            break
    if not city_id:
        return None, None, None, None

    district_ar = find_district_in_text(chain[0], city_id) if chain else None
    return city_ar, city_id, region_id, district_ar


def _floor_number(raw: Any) -> Optional[int]:
    if raw is None or raw is False or raw is True:
        return None
    key = str(raw).strip().lower()
    if key in _FLOOR_ORDINALS:
        return _FLOOR_ORDINALS[key]
    return _FLOOR_ORDINALS.get(str(raw).strip())


def map_unit(unit: dict, en_project: Optional[dict], ar_project: Optional[dict],
             tree: dict[int, dict]) -> tuple[Optional[dict], str]:
    uid = unit.get("id")
    acf = unit.get("acf") or {}
    if not isinstance(uid, int) or not isinstance(acf, dict):
        return None, ""
    if _unit_status(acf) != INGESTIBLE_UNIT_STATUS:
        return None, ""
    en_id = acf.get("unit_project")
    if not isinstance(en_id, int):
        return None, ""

    # the project's own status gates the whole project
    statuses = {_clean(t.get("name")) for t in _terms_of(ar_project, "property-status")}
    statuses |= {_clean(t.get("name")) for t in _terms_of(en_project, "property-status")}
    if statuses and not (statuses & PROJECT_STATUS_OK):
        return None, ""

    raw_type = next((_clean(t.get("name")) for t in _terms_of(ar_project, "property-type")), None)
    property_type = normalize.map_type_exact(_TYPE_MAP.get(raw_type or "", "")) if raw_type else None
    if not property_type:
        return None, ""                       # unmapped type → skipped, never assumed

    city_term_ids = [t["id"] for t in _terms_of(ar_project, "city") if isinstance(t.get("id"), int)]
    city_ar, city_id, region_id, district_ar = resolve_location(city_term_ids, tree)

    price = _to_int(acf.get("price"))
    area = _to_int(acf.get("area"))
    bedrooms = _to_int(acf.get("rooms_count"))
    floor_number = _floor_number(acf.get("floor"))

    project_title = _clean(((ar_project or en_project or {}).get("title") or {}).get("rendered"))
    features = [_clean(t.get("name")) for t in _terms_of(ar_project, "feature")]
    features = [f for f in features if f]

    category = ("Residential" if normalize.category_for_type(property_type) == "Residential"
                else "Commercial")

    row = {
        "ad_number": f"RKZ{uid}",
        # THE PROJECT PAGE, deliberately — unit.link redirects to the home page (see module docstring).
        "listing_url": f"{SITE}/ar/project/{en_id}/",
        "source": "Rakez",
        "active": True,
        "property_type": property_type,
        "transaction_type": "Buy",
        "area_m2": area,
        "bedrooms": bedrooms,
        "bathrooms": None,                    # not published per unit; never inferred from rooms
        "floor_number": floor_number,
        "price_total": price,
        "price_annual": None,
        "city": normalize.map_city(city_ar) if city_ar else None,
        "neighborhood": district_ar,
        "title": _clean(((unit.get("title") or {}).get("rendered"))) or project_title,
        "description": _clean(acf.get("description_ar")),
        "photo_urls": _photo(ar_project, en_project),
        "city_ar": city_ar,
        "district_ar": district_ar,
        "city_id": city_id,
        "region_id": region_id,
        "additional_info": {k: v for k, v in {
            "unit_code": _clean(acf.get("code")),
            "project_id": en_id,
            "project_title_ar": project_title,
            "floor_raw": _clean(acf.get("floor")),
            "features_ar": features or None,
            "source_unit_status": acf.get("unit_status"),
        }.items() if v not in (None, "", [], {})},
    }
    return row, category.lower()


def _verify_gone(ad_number: str) -> tuple[str, str]:
    """Absence NEVER deactivates on its own. A unit is gone when the source says so — either the
    post is deleted, or its own unit_status has left 'available'. Anything else is UNKNOWN."""
    uid = ad_number.replace("RKZ", "")
    try:
        r = cc.get(f"{REST}/unit/{uid}", headers=HEADERS, timeout=30)
    except Exception as e:
        return "unknown", f"probe raised {type(e).__name__}: {str(e)[:90]}"
    try:
        body = r.json()
    except Exception:
        return "unknown", f"REST {r.status_code} with an unparseable body"
    if r.status_code == 404:
        if isinstance(body, dict) and body.get("code") == "rest_post_invalid_id":
            return "gone", "REST 404 rest_post_invalid_id — the unit was deleted at source"
        return "unknown", "404 without rest_post_invalid_id"
    if r.status_code == 200 and isinstance(body, dict):
        if str(body.get("id")) != str(uid):
            return "unknown", f"id mismatch: asked {uid}, got {body.get('id')}"
        st = _unit_status(body.get("acf") or {})
        if st == INGESTIBLE_UNIT_STATUS:
            return "live", "REST 200 unit_status=available"
        if st in ("reserved", "sold-out"):
            return "gone", f"REST 200 but unit_status={st} — no longer purchasable"
        return "unknown", f"unrecognised unit_status={st!r}"
    return "unknown", f"REST {r.status_code}"


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--limit-test", type=int, default=0,
                   help="If >0, only process this many units and DON'T upsert (dry run).")
    args = p.parse_args()

    s = session()
    run_id = None if args.limit_test else db.begin_run("rakez")
    res_rows: list[dict] = []
    com_rows: list[dict] = []
    seen = 0
    skipped_status = skipped_project = skipped_type = 0
    try:
        tree = fetch_city_terms(s)
        en_projects = fetch_projects(s)
        ar_projects = fetch_projects(s, lang="ar")
        units = fetch_units(s)
        # FAIL VISIBLY on any empty prerequisite. A unit carries nothing but numbers: its type and
        # its location come from the project and the location tree. If either of those came back
        # empty while the units did not, EVERY unit maps to None — a run that looks merely
        # disappointing (0 rows, ok=true) while actually being a total fetch failure, and one that
        # then hands prune_unseen an empty seen-set. Each is named separately so the log says which
        # leg broke instead of "no listings".
        if not units:
            raise RuntimeError(f"REST returned no units — {LAST_FETCH_NOTE}")
        if not en_projects:
            raise RuntimeError("fetched units but ZERO projects — every unit would be unmappable "
                               f"(type and location live on the project). {LAST_FETCH_NOTE}")
        if not tree:
            raise RuntimeError("fetched units but ZERO location terms — every unit would be "
                               f"location-less. {LAST_FETCH_NOTE}")
        if not ar_projects:
            raise RuntimeError("fetched units but ZERO Arabic projects — nothing could be typed or "
                               f"located in Arabic. {LAST_FETCH_NOTE}")
        print(f"Rakez: {len(units)} units, {len(en_projects)} projects, {len(tree)} location terms")

        if args.limit_test:
            units = units[: args.limit_test]

        # Bridge EN→AR once per project that units actually reference — not for all 435.
        needed = sorted({(u.get("acf") or {}).get("unit_project") for u in units
                         if isinstance((u.get("acf") or {}).get("unit_project"), int)})
        bridge: dict[int, Optional[dict]] = {}
        for n, en_id in enumerate(needed):
            ar_id = arabic_project_id(s, en_id)
            bridge[en_id] = ar_projects.get(ar_id) if ar_id else None
            if n % 50 == 0:
                print(f"  bridged {n}/{len(needed)} projects to their Arabic twin")
            time.sleep(0.2)
        bridged = sum(1 for v in bridge.values() if v)
        print(f"  Arabic twin found for {bridged}/{len(needed)} projects")
        # A missing twin is not cosmetic: those units cannot be typed or located, so they are all
        # dropped. Say so loudly rather than letting the row count quietly come up short.
        if bridged < len(needed):
            lost = sorted(k for k, v in bridge.items() if not v)
            print(f"  ⚠ {len(needed) - bridged} project(s) had no reachable Arabic twin after 3 "
                  f"attempts — every unit under them is skipped: {lost[:10]}")

        for u in units:
            acf = u.get("acf") or {}
            if _unit_status(acf) != INGESTIBLE_UNIT_STATUS:
                skipped_status += 1
                continue
            en_id = acf.get("unit_project")
            row, cat = map_unit(u, en_projects.get(en_id), bridge.get(en_id), tree)
            if not row:
                skipped_project += 1
                continue
            (com_rows if cat == "commercial" else res_rows).append(row)
            seen += 1

        print(f"  skipped {skipped_status} not-available units, "
              f"{skipped_project} on excluded/unmapped projects")

        if args.limit_test:
            print(f"DRY RUN — would upsert {len(res_rows)} residential + {len(com_rows)} commercial")
            for r in (res_rows + com_rows)[:8]:
                print("  ", {k: r[k] for k in ("ad_number", "property_type", "city_ar", "city_id",
                                               "district_ar", "area_m2", "bedrooms", "price_total")})
                print("     url:", r["listing_url"], "| photos:", len(r["photo_urls"]))
            return 0

        if res_rows:
            db.upsert_rakez_residential_batch(res_rows)
        if com_rows:
            db.upsert_rakez_commercial_batch(com_rows)

        superseded = db.retire_superseded_siblings(
            res_table="rakez_residential_listings", com_table="rakez_commercial_listings",
            res_ads={r["ad_number"] for r in res_rows},
            com_ads={r["ad_number"] for r in com_rows}, source="Rakez")

        pruned = 0
        for tbl, rows in (("rakez_residential_listings", res_rows),
                          ("rakez_commercial_listings", com_rows)):
            n = db.prune_unseen(tbl, {r["ad_number"] for r in rows}, source="Rakez",
                                verify_gone=_verify_gone)
            if n < 0:
                print(f"⚠ {tbl}: prune guard tripped — kept existing active")
            else:
                pruned += n

        print(f"✓ Rakez: {len(res_rows)} residential + {len(com_rows)} commercial upserted, "
              f"{pruned} stale pruned, {superseded} superseded sibling(s) retired")
        healthy = db.end_run(run_id, ok=True, rows_seen=seen,
                             rows_upserted=len(res_rows) + len(com_rows),
                             notes=(f"pruned={pruned} superseded={superseded} "
                                    f"not_available={skipped_status} excluded={skipped_project} "
                                    f"bridged={bridged}/{len(needed)}"),
                             check_tables=["rakez_residential_listings",
                                           "rakez_commercial_listings"])
        return 0 if healthy else 1
    except Exception as e:
        if run_id:
            db.end_run(run_id, ok=False, rows_seen=seen, rows_upserted=0, notes=str(e)[:300])
        print(f"✗ {e}")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
