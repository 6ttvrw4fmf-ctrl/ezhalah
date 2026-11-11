"""Keller Williams Saudi Arabia (kwsaudiarabia.com) — the STAGED ingest (owner order 2026-11-05). Rows are stored
in tables no search arm reads; NOTHING reaches a customer until the owner launches it
(docs/ops/FIVE_SOURCES_LAUNCH.md).

SOURCE SHAPE (measured live 2026-11-05)
=======================================
The site's own list is a JSON API the page itself calls: POST https://api.kw-saudiarabia.com/api/listings/list/properties
with {"page": N, "limit": 50} → {"pagination": {total_items, has_next_page, …}, "data": [listing, …]}. The plain list is
the WHOLE inventory (155 on 2026-11-05: 126 «For Sale», 27 «For Rent», 2 «Off Market»; {"forrent": true} returns
exactly the 27 rent ads, a subset). api.kw-saudiarabia.com/robots.txt and kwsaudiarabia.com/robots.txt are 404 (no
rule); we read only this list, 1 request a second, with our own bot UA. No ad page is fetched.
  _id / list_id     the ad's id → ad_number «KW<_id>»; list_uuid → the public page /propertydetails/<list_uuid>
  list_category     For Sale → Buy, For Rent → Rent, Off Market → not listed (skipped, counted)
  current_list_price PRICE = SOURCE. marketing_info.display_list_price false → price on request.
                    No period field exists: a rent's period is the one the ad's own text ties to THIS price
                    (normalize.stated_rent_period); silent → rent_period NULL, the figure kept as published
                    (the search index's judge_silent_rent_period_ar labels it at launch, flagged judged).
  prop_type / prop_subtype KW's own form fields are loose («Commercial / Other» on 15 land ads): the type is the ad
                    TITLE's own Arabic word (normalize.map_type, the fleet map), else the subtype; KW's «Commercial» /
                    «Business Opportunity» filing makes a bare «أرض» Commercial Land (the source's own usage call).
  mls_number        the REGA ad licence (155 of 155) → license_number (the 10 digits; «6200757750/2» kept raw).
  list_address.coordinates_gp → the pin (155 of 155). location.neighborhoods[0].neigh_name → the district text.
  list_desc / list_desc_en the FULL description (agent phones redacted). total_bed / total_bath / living_area.
PDPL: list_agent_office, co_list_agent_office, sell_agent_office, brokerage, commissions and every agent/office
name, phone, email are dropped before storage (strip_pii_fields + the explicit list below); free text goes through
the shared idempotent redactor and the tables' zz_redact_pii trigger.

LIVENESS («own full list = the check»): the walk is COMPLETE when every page was read and the unique ads reach the
list's own total_items. Only a complete walk prunes; an ad absent from 3 complete walks goes inactive.

    python -m scrapers.kellerwilliams.run --dry-run
    python -m scrapers.kellerwilliams.run
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
from scrapers.common.arabic_location import catalog_district, find_district_in_text, resolve  # noqa: E402
from scrapers.facts.one_reader import amenity_answers  # noqa: E402
from scrapers.common.pii import redact_capture, redact_pii, strip_pii_fields  # noqa: E402
from scrapers.common.source_pin import pin_dict  # noqa: E402

PROSE_COLS = ("kitchen", "parking", "elevator", "maid_room", "driver_room", "air_conditioner", "private_entrance", "furnished", "balcony_terrace", "laundry_room")
SOURCE = "Keller Williams"
SLUG = "kellerwilliams"
PREFIX = "KW"
RES_TABLE = "kellerwilliams_residential_listings"
COM_TABLE = "kellerwilliams_commercial_listings"
API = "https://api.kw-saudiarabia.com/api/listings/list/properties"
SITE = "https://kwsaudiarabia.com"
PAGE_SIZE = 50

_DEAL = {"For Sale": "Buy", "For Rent": "Rent"}
_SUBTYPE = {"Apartment": "Apartment", "Condominium": "Apartment", "Duplex": "Duplex", "Townhouse": "تاون هاوس",
            "Single Family Detached": "Villa", "Industrial": "Warehouse", "Retail": "Shop", "Farm": "Farm",
            "Unimproved Land": "Residential Land"}
_COMMERCIAL_FILING = ("Commercial", "Business Opportunity")
RESIDENTIAL = {"Apartment", "Villa", "Floor", "Room", "Building", "Rest House", "Chalet", "Camp", "Residential Land",
               "Duplex", "Compound", "تاون هاوس"}
_NO_ROOMS = {"Residential Land", "Commercial Land", "Warehouse", "Shop", "Farm", "Office", "Showroom"}
_CITY_EN = {"Riyadh": "الرياض", "Jeddah": "جدة", "At Taif": "الطائف", "Taif": "الطائف", "Buraidah": "بريدة",
            "Makkah": "مكة", "Madinah": "المدينة المنورة", "Dammam": "الدمام", "Khobar": "الخبر"}
# never stored, at any depth (strip_pii_fields drops agent/broker/phone/email keys too — this is belt and braces)
_NEVER_STORE = ("list_agent_office", "co_list_agent_office", "sell_agent_office", "co_sell_agent_office",
                "brokerage", "commissions", "kw_created_by", "kw_updated_by", "list_kw_uid", "co_list_kw_uid",
                "sell_kw_uid", "list_team_id", "syndicate")
_FEATURES = {("interior_features", "has_elevator"): "elevator", ("structure", "has_parking"): "parking"}



# The unit's FLOOR, from the ad's own labelled line only (🔬 2026-11-09 blind-spot hunt): the API carries no floor
# (`structure.stories` is null) and 0 of 163 ads had one, while 5 state it — «الدور: الرابع (4th Floor)»
# (kellerwilliams_residential_listings:24214414, payload re-read 2026-11-09). A bare «الدور» in a sentence, a floor
# COUNT («3 أدوار») or two different stated floors stay NULL (silence is never a guess). Flats and floors only.
_FLOOR_ORD = {"الارضي": 0, "الأرضي": 0, "ارضي": 0, "أرضي": 0, "الاول": 1, "الأول": 1, "الثاني": 2, "الثالث": 3,
              "الرابع": 4, "الخامس": 5, "السادس": 6, "السابع": 7, "الثامن": 8, "التاسع": 9, "العاشر": 10}
_FLOOR_LABEL = re.compile(r"(?<![\u0621-\u064A])الدور\s*[:：]\s*("
                          + "|".join(sorted(map(re.escape, _FLOOR_ORD), key=len, reverse=True))
                          + r"|[0-9٠-٩]{1,2})(?![\u0621-\u064A0-9٠-٩])")
_FLOOR_TYPES = ("Apartment", "Floor", "Studio", "Duplex", "Office")


def floor_of(desc: Optional[str], ptype: Optional[str]) -> Optional[int]:
    if not desc or ptype not in _FLOOR_TYPES:
        return None
    found = set()
    for m in _FLOOR_LABEL.finditer(desc):
        v = m.group(1)
        found.add(_FLOOR_ORD[v] if v in _FLOOR_ORD else int(v.translate(str.maketrans("٠١٢٣٤٥٦٧٨٩", "0123456789"))))
    return found.pop() if len(found) == 1 else None

def _allowed(url: str) -> bool:
    return url == API


def walk(log=print) -> dict:
    """Every page of the site's own list. {"total", "pages", "pages_read", "items": {id: listing}}."""
    items: dict[str, dict] = {}
    totals: list[int] = []
    page, pages = 1, 0
    while True:
        j = H.post_json(API, {"page": page, "limit": PAGE_SIZE}, allowed=_allowed)
        pg = j.get("pagination") or {}
        if page == 1:
            pages = int(pg.get("total_pages") or 0)
        if pg.get("total_items") is not None:
            totals.append(int(pg["total_items"]))
        for it in j.get("data") or []:
            if isinstance(it, dict) and it.get("_id") is not None:
                items[str(it["_id"])] = it
        log(f"  page {page}/{pages}: {len(j.get('data') or [])} items, {len(items)} unique")
        if not pg.get("has_next_page") or page >= max(pages, 1) or page >= 40:
            break
        page += 1
    return {"total": min(totals) if totals else 0, "pages": pages, "pages_read": page, "items": items}


def complete(w: dict) -> bool:
    return w["total"] > 0 and w["pages_read"] >= w["pages"] and len(w["items"]) >= w["total"]


def _int(v: Any) -> Optional[int]:
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return int(round(f)) if f > 0 else None


MULTI_USE = re.compile(r"متعدد[ةه]? ?الاستخدام")   # owner 2026-09-27 (OpenSooq rule): multi-use land = BOTH tables


def _head(x: dict) -> str:
    """The ad's own headline: its title, else the first line of its description (8 ads have no title)."""
    title = x.get("listing_title") or (x.get("list_address") or {}).get("unit_number") or ""
    first = next((ln for ln in (x.get("list_desc") or "").splitlines() if ln.strip()), "")[:120]
    return (title or first).replace("آرض", "أرض")


def type_of(x: dict) -> Optional[str]:
    head = _head(x)
    t = N.map_type(head) or _SUBTYPE.get(x.get("prop_subtype") or "")
    if t == "Residential Land" and x.get("prop_type") in _COMMERCIAL_FILING and "سكني" not in head:
        t = "Commercial Land"
    return t


def location(x: dict) -> dict[str, Any]:
    addr = x.get("list_address") or {}
    loc = x.get("location") or {}
    city = (addr.get("city") or "").strip()
    city = _CITY_EN.get(city, city) or None
    neigh = ((loc.get("neighborhoods") or [{}])[0] or {}).get("neigh_name")
    neigh = (neigh or "").strip() or None
    r = resolve(city, neigh, region_hint=loc.get("region")) if city else {}
    if city and not r.get("city_id"):   # KW's region field is a free form (Madinah ads filed «مكة المكرمة»)
        r = resolve(city, neigh)
    cid = r.get("city_id")
    gp = addr.get("coordinates_gp") or {}
    return {"city_ar": r.get("city_ar") or city, "city_id": cid, "region_id": r.get("region_id"),
            "neighborhood": neigh, "district_ar": catalog_district(cid, neigh) if (cid and neigh) else None,
            "pin": pin_dict(gp.get("lat"), gp.get("lon"))}


def price_fields(x: dict, deal: str, text: str) -> dict[str, Any]:
    shown = (x.get("marketing_info") or {}).get("display_list_price") is not False
    value = _int(x.get("current_list_price")) if shown else None
    out: dict[str, Any] = {}
    if deal == "Buy":
        out["price_total"] = value if value else db.AUTHORITATIVE_NULL
        stored, kind = value, "total"
    elif not value:
        out["price_annual"], stored, kind = db.AUTHORITATIVE_NULL, None, "annual"
    else:
        period = N.stated_rent_period(value, text)          # the ad's own words tied to THIS figure, or silence
        out["rent_period"], out["price_annual"] = N.rent_period_and_annual(
            value, {"monthly": "شهري", "annual": "سنوي"}.get(period or ""))
        stored, kind = out["price_annual"], period or "unstated"
    out["price_evidence"] = N.price_evidence(field="current_list_price", raw=x.get("current_list_price"),
                                             stored=stored, kind=kind if kind != "unstated" else "annual",
                                             unit="total", origin="api", authoritative_absent=not value)
    if deal == "Rent" and value and not out.get("rent_period"):
        out["price_evidence"]["period_stated"] = False
    return out


def agent_names(x: dict) -> list[str]:
    """The ad's OWN agent / co-agent names (full, and first + last), read from the person objects before they are dropped.
    An agent signs the free text without a label («…contact the number provided below\nRabie Akkad.», found 2026-11-05
    in 2 stored English descriptions) — the shared redactor only removes LABELLED names, so these are removed by value."""
    out: set[str] = set()
    for key, pre in (("list_agent_office", "list_agent_"), ("co_list_agent_office", "co_list_agent_"),
                     ("sell_agent_office", "sell_agent_"), ("co_sell_agent_office", "co_sell_agent_")):
        o = x.get(key) or {}
        full = (o.get(pre + "full_name") or "").strip()
        fl = f"{(o.get(pre + 'first_name') or '').strip()} {(o.get(pre + 'last_name') or '').strip()}".strip()
        out |= {n for n in (full, fl) if len(n) >= 4 and " " in n}
    return sorted(out, key=len, reverse=True)


def scrub_names(v: Any, names: list[str]) -> Any:
    """Every string in v with each of the ad's own agent names replaced by «[redacted]» (case-insensitive). Idempotent."""
    if not names:
        return v
    if isinstance(v, str):
        for n in names:
            v = re.sub(re.escape(n), "[redacted]", v, flags=re.I)
        return v
    if isinstance(v, dict):
        return {k: scrub_names(w, names) for k, w in v.items()}
    if isinstance(v, list):
        return [scrub_names(w, names) for w in v]
    return v


def map_listing(x: dict) -> tuple[Optional[tuple[dict, str]], str]:
    deal = _DEAL.get(x.get("list_category") or "")
    if not deal:
        return None, f"category_{x.get('list_category')}"
    if x.get("is_deleted") or (x.get("list_status") or "Active") != "Active":
        return None, f"status_{x.get('list_status')}"
    ptype = type_of(x)
    if not ptype:
        return None, f"type_unmapped_{x.get('prop_type')}/{x.get('prop_subtype')}"
    x = scrub_names(x, agent_names(x))          # the agents' own names out of EVERY free text, before anything is read
    title = redact_pii(x.get("listing_title") or (x.get("list_address") or {}).get("unit_number")) or None
    desc = redact_pii(x.get("list_desc"), keep_lines=True) or None
    loc = location(x)
    # No structured neighbourhood (`location` is null on some records) → the ad's OWN title/description, matched
    # catalogue-exact only (find_district_in_text: never guessed). 2026-11-07: KW2074755354940342 «فيلا في حي
    # الرائد» served with no district; 🔧 measured 16 of 189 KW cards district-less (new-site parity).
    if not loc["district_ar"] and loc["city_id"]:
        named = find_district_in_text(f"{title or ''}\n{desc or ''}", loc["city_id"])
        if named:
            loc = {**loc, "district_ar": named}
    st = x.get("structure") or {}
    # The ad page prints the LOT size («Acre 1225 sqm»), the API also carries living_area. A unit inside a building
    # (Apartment, Floor) is its living area — its «lot» is the whole building's plot (607 m² on a 109 m² flat); every
    # other type (villa, land, building …) is the lot the page prints. Both are kept in additional_info.
    area = None
    order = (("living_area", "living_area_units"), ("lot_size_area", "lot_size_units"))
    for k, u in (order if ptype in ("Apartment", "Floor") else order[::-1]):
        if (x.get(u) or "sqm") == "sqm" and _int(x.get(k)):
            area = _int(x.get(k))
            break
    rooms = ptype not in _NO_ROOMS
    feats = {col: True for (grp, key), col in _FEATURES.items()
             if (st.get(key) if grp == "structure" else (st.get(grp) or {}).get(key)) is True}
    # ONE READER (owner 2026-11-03): prose amenities come from the Advanced Filter's word reader, never normalize.prose_amenities.
    prose = {c: v for c, v in amenity_answers(f"{title or ''}\n{desc or ''}", PROSE_COLS, {"balcony": "balcony_terrace"}).items()
             if c not in feats}
    lic = str(x.get("mls_number") or "").strip()
    floor = floor_of(desc, ptype)
    row: dict[str, Any] = {
        "ad_number": f"{PREFIX}{x['_id']}",
        "listing_url": f"{SITE}/propertydetails/{x['list_uuid']}" if x.get("list_uuid") else None,
        "source": SOURCE, "active": True, "title": title, "description": desc,
        "property_type": ptype, "transaction_type": "Rent" if deal == "Rent" else "Buy",
        "city": N.map_city(loc["city_ar"]) if loc["city_ar"] else None, "city_ar": loc["city_ar"],
        "city_id": loc["city_id"], "region_id": loc["region_id"], "district_ar": loc["district_ar"],
        "neighborhood": loc["neighborhood"], "area_m2": area,
        "bedrooms": _int(x.get("total_bed")) if rooms else None,
        "bathrooms": _int(x.get("total_bath")) if rooms else None,
        "license_number": (re.match(r"\d{10}", lic) or [None])[0], "floor_number": floor,
        "photo_urls": [p.get("ph_url") for p in (x.get("photos") or []) if isinstance(p, dict) and p.get("ph_url")] or None,
        "date_added": x.get("list_dt"), "last_update": x.get("kw_updated_at"),
        **prose, **feats, **price_fields(x, deal, f"{title or ''}\n{desc or ''}"),
    }
    info = {
        "source_id": str(x["_id"]), "list_uuid": x.get("list_uuid"), "mls_number": lic or None,
        "rega_ad_license_number": row["license_number"], "kw_prop_type": x.get("prop_type"),
        "kw_prop_subtype": x.get("prop_subtype"), "kw_list_category": x.get("list_category"),
        "kw_list_type": x.get("list_type"), "price_value": x.get("current_list_price"),
        "lease_price": x.get("lease_price"), "original_list_price": x.get("original_list_price"),
        "price_history": x.get("price_history"), "year_built": x.get("year_built"),
        "living_area": x.get("living_area"), "lot_size_area": x.get("lot_size_area"),
        "total_bed": x.get("total_bed"), "total_bath": x.get("total_bath"), "full_bath": x.get("full_bath"),
        "half_bath": x.get("half_bath"), "contract_expiry_dt": x.get("contract_expiry_dt"),
        "address": redact_pii((x.get("list_address") or {}).get("full_street_address")),
        "region": (x.get("location") or {}).get("region"), "subdivision": (x.get("location") or {}).get("subdivision"),
        "directions": (x.get("location") or {}).get("prop_directions"),
        "description_en": redact_pii(x.get("list_desc_en"), keep_lines=True),
        "structure": {k: v for k, v in st.items() if v not in (None, False, [], {})} or None,
        "virtual_tours": [v.get("vt_url") for v in (x.get("virtual_tours") or []) if isinstance(v, dict)] or None,
        **loc["pin"],
    }
    row["additional_info"] = strip_pii_fields({k: v for k, v in info.items() if v not in (None, "", [], {})})
    kept = {k: v for k, v in x.items() if k not in _NEVER_STORE}
    row["source_capture"] = {"schema": "kellerwilliams.list.v1", "item": redact_capture(strip_pii_fields(kept))}
    return (row, "residential" if ptype in RESIDENTIAL else "commercial"), ""


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--save", default="", help="also write the mapped rows to this JSON file (hand checks)")
    a = ap.parse_args()
    run_id = None if a.dry_run else db.begin_run(SLUG)
    w: dict = {"items": {}}
    try:
        w = walk()
        res, com, skipped = [], [], Counter()
        for x in w["items"].values():
            got, why = map_listing(x)
            if not got:
                skipped[why] += 1
                continue
            (res if got[1] == "residential" else com).append(got[0])
            if got[0]["property_type"] == "Commercial Land" and MULTI_USE.search(_head(x) + (x.get("list_desc") or "")):
                res.append({**got[0], "property_type": "Residential Land"})   # same ad, answers both searches
        ok = complete(w)
        cover = {"unique": len(w["items"]), "total_items": w["total"], "pages": f"{w['pages_read']}/{w['pages']}",
                 "complete": ok}
        print(f"  coverage: {json.dumps(cover)}\n  mapped: {len(res)} residential + {len(com)} commercial; "
              f"skipped (not guessed): {dict(skipped)}", flush=True)
        if a.save:
            Path(a.save).write_text(json.dumps(res + com, ensure_ascii=False, default=str))
        if a.dry_run:
            return 0
        return _store(run_id, res, com, ok, cover, rows_seen=len(w["items"]))
    except Exception as e:  # noqa: BLE001 — a wall or any error: record it, prune nothing
        if run_id:
            db.end_run(run_id, ok=False, rows_seen=len(w["items"]), rows_upserted=0, notes=f"{type(e).__name__}: {e}"[:300])
        raise


def _store(run_id, res, com, complete_walk, cover, *, rows_seen) -> int:
    db.upsert_kellerwilliams_residential_batch(res)
    db.upsert_kellerwilliams_commercial_batch(com)
    notes = [f"coverage {json.dumps(cover)}"]
    sup = db.retire_superseded_siblings(res_table=RES_TABLE, com_table=COM_TABLE, res_ads={r["ad_number"] for r in res},
                                        com_ads={r["ad_number"] for r in com}, source=SOURCE)
    if sup:
        notes.append(f"superseded={sup}")
    for tbl, rows in ((RES_TABLE, res), (COM_TABLE, com)):
        if rows and complete_walk:
            notes.append(f"{tbl} pruned={db.prune_unseen(tbl, {r['ad_number'] for r in rows}, source=SOURCE, verify_gone=_gone)}")
        else:
            notes.append(f"{tbl} NOT pruned (walk incomplete or empty)")
    print("  " + "; ".join(notes[1:]), flush=True)
    healthy = db.end_run(run_id, ok=True, rows_seen=rows_seen, rows_upserted=len(res) + len(com),
                         notes="; ".join(notes)[:900], check_tables=["kellerwilliams_residential_listings", "kellerwilliams_commercial_listings"])
    if not healthy:
        print("✗ run demoted to unhealthy by end_run()", flush=True)
        return 1
    print(f"✓ {SOURCE}: {len(res)} residential + {len(com)} commercial upserted", flush=True)
    return 0


def _gone(ad_number: str) -> tuple[str, str]:
    """prune_unseen's answer at grace. Absence from a list is a CANDIDATE, never a kill (LISTING_LIVENESS.md §2:
    only a DIRECT reading of the ad's own page may deactivate). Until this site has a measured own-page oracle the
    strike is held: UNKNOWN. ♻️ 2026-11-06 — it used to return «gone» here, an absence-only kill."""
    return "unknown", "absent from 3 consecutive COMPLETE walks of the site's own full list; no own-page oracle yet — held (absence never kills)"


if __name__ == "__main__":
    raise SystemExit(main())
