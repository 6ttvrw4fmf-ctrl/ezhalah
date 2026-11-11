"""Manzo (manzo.com.sa, «شركة مانزو بروبتك») — Onboarding 2026-09-27 (wave 3, batch 5).

manzoproptech.com.sa redirects to manzo.com.sa. Owner 2026-09-27: include it — one real listing is still
a real listing.

SOURCE SHAPE (measured live 2026-09-27)
=======================================
Open JSON API (no key):
  list    https://api.manzo.com.sa/property/v1/properties/search/?page=N   {results[], pagination{total_count, has_next}}
  detail  https://api.manzo.com.sa/property/v1/properties/details/s/<slug>/
  page    https://manzo.com.sa/ar/property/<slug>
Measured: total_count 1 — an apartment for rent in الظهران, 48,000 / year (pricing_options period
«annual», rent_duration «annual»), REGA ad licence 7201141490 (status active).

AGE: `property_age` is a BUILD YEAR (2019) → normalize.age_from_completion_year.
PHOTOS: served from media-stg.manzo.com.sa; verified 200 image/jpeg (the same bytes as media.manzo.com.sa).
PDPL: `lister_info` (name, profile picture) and the parcel `borders` are never stored.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import re
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any, Optional

from curl_cffi import requests as cc

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from scrapers.common import db, normalize  # noqa: E402
from scrapers.common.arabic_location import find_district_in_text, to_catalog  # noqa: E402
from scrapers.common.pii import redact_pii, strip_pii_fields  # noqa: E402
from scrapers.common.http import retry_smarter_session  # noqa: E402
from scrapers.common.posting_date import site_posting_date  # noqa: E402

API = "https://api.manzo.com.sa/property/v1/properties"
SITE = "https://manzo.com.sa/ar/property/"
SOURCE = "مانزو"
PREFIX = "MNZ"
SLUG = "manzo"

_TYPE_AR = {"Apartment": "شقة", "Villa": "فيلا", "Floor": "دور", "Land": "ارض", "Office": "مكتب",
            "Shop": "محل", "Building": "عمارة", "Warehouse": "مستودع", "Studio": "استوديو"}
_DEAL = {"long_term_rent": "Rent", "sale": "Buy", "sell": "Buy"}
_FEATURE_COLUMNS = {"elevator": "elevator", "maid_room": "maid_room", "central_ac": "air_conditioner",
                    "covered_parking": "parking", "laundry_room": "laundry_room", "balcony": "balcony_terrace"}
_NEVER_STORE = {"lister_info", "borders", "commission", "deep_link", "share_image", "share_title",
                "share_description", "connectivity", "nearby_pois"}


def get_json(s: cc.Session, url: str) -> Any:
    for attempt in range(3):
        try:
            r = s.get(url, timeout=40)
            r.raise_for_status()
            return r.json()
        except Exception:  # noqa: BLE001
            if attempt == 2:
                raise
            time.sleep(2 + attempt * 3)


# THE WALK FOLLOWS THE SOURCE'S OWN PAGINATION (crawl-health 2026-11-04). It used to stop at `range(1, 50)` — page 49 —
# whatever the API said. Measured 2026-11-04: total_count 982, page_size 20, total_pages 50, so page 50 was never read,
# the walk could never reach the declared total, `complete` stayed false and the absence prune never ran again
# (alert zero_new_stall:manzo). The walk now reads until has_next is false; WALK_PAGE_CEILING only stops a source
# that never says «last page», and a walk it cuts short is short of the declared total, so it prunes nothing.
WALK_PAGE_CEILING = 1000


def walk(s: cc.Session, fetch=None) -> tuple[list[dict], int]:
    fetch = fetch or get_json
    rows: list[dict] = []
    total = 0
    for page in range(1, WALK_PAGE_CEILING + 1):
        d = fetch(s, f"{API}/search/?page={page}")
        pg = d.get("pagination") or {}
        total = int(pg.get("total_count") or 0)
        rows += d.get("results") or []
        if not pg.get("has_next"):
            break
    return rows, total


# THE CRAWL FITS ITS SLOT (2026-10-30). The catalogue grew to 856 ads and each detail record was read one after another,
# so the run outgrew its 10-minute job and was cancelled every time: no manzo crawl finished after 10-28 08:44, and the
# ad text (#9404) and feature boxes never reached a row. Ten workers (the API answers ~2 s a record: four still took 7.5 min),
# each with its own session on the profile and route
# the probe chose, read the same records in the same order; a record that fails is None, counted unreadable as before.
# 2026-11-05 (♻️): ten workers drew HTTP 429 on 432 of 1,062 records (11-04 12:27) and the retries ran the job past its
# slot three times. Five keep the read inside a 30-min slot (1,062 x ~2 s / 5 ≈ 7 min) with far fewer refusals.
DETAIL_WORKERS = 5


# WHY a detail record could not be read (crawl-health 2026-11-04). The 11-03 run could not read 342 of 856 records and
# said only «342 unreadable»: no status, no exception, nothing in the row. The breakdown now rides into the job log and
# scrape_runs.notes, so the next shortfall says whether the API refused (429/403), timed out or answered 5xx.
UNREADABLE_WHY: dict[str, int] = {}
_why_lock = threading.Lock()


def _note_unreadable(e: BaseException) -> None:
    resp = getattr(e, "response", None)
    code = getattr(resp, "status_code", None)
    key = f"http_{code}" if code else type(e).__name__
    with _why_lock:
        UNREADABLE_WHY[key] = UNREADABLE_WHY.get(key, 0) + 1


def unreadable_summary() -> str:
    with _why_lock:
        return ",".join(f"{k}={v}" for k, v in sorted(UNREADABLE_WHY.items(), key=lambda kv: -kv[1]))


def read_details(s: cc.Session, listing: list[dict], fetch=None) -> list[Optional[dict]]:
    fetch = fetch or get_json
    local = threading.local()

    def one(p: dict) -> Optional[dict]:
        sess = getattr(local, "s", None)
        if sess is None:
            sess = local.s = (cc.Session(impersonate=s.impersonate, proxies=s.proxies or None)
                              if isinstance(s, cc.Session) else s)
        try:
            d = fetch(sess, f"{API}/details/s/{p['slug']}/")
            return d.get("data") or d
        except Exception as e:  # noqa: BLE001
            _note_unreadable(e)
            return None

    with ThreadPoolExecutor(DETAIL_WORKERS) as ex:
        out = list(ex.map(one, listing))
    return retry_refused(s, listing, out, fetch=fetch)


# A REFUSED RECORD IS RE-ASKED, SLOWLY, BEFORE THE WALK IS CALLED INCOMPLETE (⚡ 2026-11-06, alert
# run_killed_by_timeout:manzo). Five workers still drew HTTP 429 on 300 of 1,279 records (11-06 05:19, 13 of its 30
# minutes used), so `complete` stayed false and the absence prune never ran. After the pool, every record that failed
# is read again ONE AT A TIME with a pause, and a 429 waits for the API's own Retry-After (capped) before one more try.
# The pass stops at RETRY_BUDGET_S so the job still ends inside its slot; a record not re-read in time stays unreadable
# (`why=retry_budget`) and the walk stays incomplete — never a guess, never a prune on a partial read.
RETRY_PAUSE_S = 1.5
RETRY_BUDGET_S = 25 * 60
RETRY_AFTER_CAP_S = 30.0


def _retry_after(e: BaseException) -> float:
    resp = getattr(e, "response", None)
    try:
        v = float((getattr(resp, "headers", None) or {}).get("Retry-After") or 0)
    except (TypeError, ValueError):
        v = 0.0
    return min(max(v, 5.0), RETRY_AFTER_CAP_S)


def retry_refused(s: cc.Session, listing: list[dict], out: list[Optional[dict]], fetch=None,
                  *, clock=time.monotonic, sleep=time.sleep) -> list[Optional[dict]]:
    fetch = fetch or get_json
    todo = [i for i, d in enumerate(out) if d is None]
    if not todo:
        return out
    with _why_lock:
        UNREADABLE_WHY.clear()           # the counts now describe what is STILL unreadable after this pass
    start = clock()
    recovered = 0
    for n, i in enumerate(todo):
        if clock() - start > RETRY_BUDGET_S:
            with _why_lock:
                UNREADABLE_WHY["retry_budget"] = UNREADABLE_WHY.get("retry_budget", 0) + len(todo) - n
            break
        url = f"{API}/details/s/{listing[i]['slug']}/"
        for attempt in range(2):
            try:
                d = fetch(s, url)
                out[i] = d.get("data") or d
                recovered += 1
                break
            except Exception as e:  # noqa: BLE001
                code = getattr(getattr(e, "response", None), "status_code", None)
                if attempt == 0 and code == 429:
                    sleep(_retry_after(e))
                    continue
                _note_unreadable(e)
                break
        sleep(RETRY_PAUSE_S)
    print(f"  manzo: re-asked {len(todo)} refused record(s) one at a time, recovered {recovered}", flush=True)
    return out


def source_published_empty(listing: list, declared: int) -> bool:
    """True only when the walk got an ANSWER that is empty by the source's own count. Anything else
    (rows present, or a count the walk did not reach) is not an empty source."""
    return not listing and declared == 0


def _f(v: Any) -> Optional[float]:
    try:
        f = float(v)
        return f if f > 0 else None
    except (TypeError, ValueError):
        return None


def listed_ad_number(d: dict, p: dict) -> str:
    """The ad_number map_property would give this record, for a record it may refuse to map."""
    return f"{PREFIX}{d.get('property_id') or d.get('slug') or p.get('slug')}"


# A live, listable ad. Manzo renamed «active» to «available» around 2026-10-13: measured 2026-10-27, all 766
# listed records read «available», 40/40 sampled carry an active REGA ad licence and their pages answer 200.
# Owner 2026-10-27: take them «if they are live and are part of our rules». Anything else (rented, paused…)
# is still skipped.
LIVE_STATUSES = {"active", "available"}


def map_property(d: dict) -> tuple[Optional[tuple[dict, str]], str]:
    if d.get("display_status") not in LIVE_STATUSES:
        return None, f"status_{d.get('display_status')}"
    deal = _DEAL.get(d.get("property_type") or "")
    if not deal:
        return None, f"deal_unmapped_{d.get('property_type')}"
    ptype = normalize.map_type_exact(_TYPE_AR.get(d.get("property_category") or ""))
    if not ptype:
        return None, f"type_unmapped_{d.get('property_category')}"
    category = normalize.category_for_type(ptype).lower()

    title = d.get("title_ar") or d.get("title") or ""
    price = normalize.to_int(str(d.get("price"))) if _f(d.get("price")) else None
    row_price: dict[str, Any] = {}
    if deal == "Buy":
        row_price["price_total"] = price
    else:
        primary = next((o for o in d.get("pricing_options") or [] if o.get("primary")), {})
        card = {"annual": "annual", "monthly": "monthly"}.get(primary.get("period") or d.get("rent_duration") or "")
        row_price["rent_period"], row_price["price_annual"] = normalize.rent_period_from_ad(price, title, card, title)

    city_ar = d.get("city")
    city_id, region_id = to_catalog(city_ar) if city_ar else (None, None)
    # The source publishes the district as district.name_ar (2026-10-27: 701 of 702 rows had none because this
    # was never read). Matched to our catalogue the same way holoul does; the raw name is kept either way.
    district_raw = ((d.get("district") or {}).get("name_ar") or "").strip() or None
    district_ar = find_district_in_text(district_raw, city_id) if (city_id and district_raw) else None
    lng, lat = ((d.get("coordinates") or {}).get("coordinates") or [None, None])[:2]
    apt = d.get("apartment") or {}
    photos = list(dict.fromkeys(d.get("property_images") or ([d["main_image_url"]] if d.get("main_image_url") else [])))
    # Manzo serves a stock «Contact Lister for Photos» image (/property_media/placeholders/no_photos.jpg) for ads
    # with no photos; 266 of 716 ads carried only that on 2026-10-27. It is not a photo of the property, so it is
    # never stored: the card then shows Ezhalah's own «لا توجد صورة» like every other photo-less ad.
    photos = [u for u in photos if u and "/placeholders/" not in u]
    row: dict[str, Any] = {
        "ad_number": f"{PREFIX}{d.get('property_id') or d['slug']}",
        "listing_url": SITE + d["slug"],
        "source": SOURCE,
        "active": True,
        "title": redact_pii(title) or None,
        # The lister's own prose (shown under «المميزات» on the ad page). The detail API has always carried it
        # as `description` — kept in source_capture, never mapped, so `description` was empty on 708 of 708
        # (2026-10-30). Verbatim, phones/emails redacted (PDPL); silence stays NULL, never ''.
        "description": (redact_pii(d.get("description")) or None) if isinstance(d.get("description"), str) else None,
        "property_type": ptype,
        "transaction_type": "Rent" if deal == "Rent" else "Buy",   # deal is validated above
        "city": normalize.map_city(city_ar) if city_ar else None,
        "city_ar": city_ar,
        "city_id": city_id,
        "region_id": region_id,
        "district_ar": district_ar,
        "neighborhood": district_raw,
        "area_m2": _f(d.get("area")),
        "bedrooms": apt.get("bedrooms") or None,
        "bathrooms": apt.get("bathrooms") or None,
        "property_age": normalize.age_from_completion_year(d.get("property_age"), this_year=dt.date.today().year),
        "license_number": d.get("ad_licence_number"),
        # THE SITE'S OWN POSTING DATE (docs/ARCHITECTURE.md §20). The detail record's `listing_date` is what the ad
        # page prints as JSON-LD datePosted — measured 2026-11-09 on JoZJ5Qoy (2026-11-07T14:42:47.378618Z both) and
        # on VPWG5qo8, unchanged from the value first captured 2026-10-11; none of 1,446 is later than our first sighting.
        # Never ad_licence_expires_at (the REGA licence) or deed_date.
        "date_added": site_posting_date(d.get("listing_date")),
        "photo_urls": photos,  # [] (never None): the upsert skips None, so an ad that lost its photos kept the old ones (2026-10-27)
        **row_price,
    }
    for flag, col in (("electricity_access", "electricity"), ("water_access", "water_supply"), ("sewage_system", "sanitation")):
        if d.get(flag) is True:
            row[col] = True
    # The apartment's feature checklist (apartment.features) was kept in additional_info but never mapped, so all 708
    # ads answered no Advanced Filter amenity (2026-10-30). Only a TICKED box is the source saying yes. An unticked box
    # is not a «no»: every key is false on ads whose own description says furnished, with a kitchen, and 656 of 659
    # apartments leave «elevator» unticked. So it stays NULL (unknown), never false.
    for key, col in _FEATURE_COLUMNS.items():
        if (apt.get("features") or {}).get(key) is True:
            row[col] = True
    stored = row.get("price_total") if deal == "Buy" else row.get("price_annual")
    row["price_evidence"] = normalize.price_evidence(
        field="price", raw=d.get("price"), stored=stored, kind="total" if deal == "Buy" else "annual",
        unit="total", origin="api", authoritative_absent=False)
    info = {
        "source_id": d.get("property_id"),
        "slug": d.get("slug"),
        "build_year": d.get("property_age"),
        "rent_duration": d.get("rent_duration"),
        "apartment_features": {k: v for k, v in (apt.get("features") or {}).items() if v is True} or None,
        "living_rooms": apt.get("living_rooms"),
        "ad_licence_status": d.get("ad_licence_status"),
        "latitude": lat,
        "longitude": lng,
    }
    row["additional_info"] = strip_pii_fields({k: v for k, v in info.items() if v not in (None, "", [], {})})
    cap = {k: v for k, v in d.items() if k not in _NEVER_STORE}
    row["source_capture"] = strip_pii_fields({"schema": "manzo.property.v1", "record": cap})
    return (row, category), ""


# ── removal oracle: «is this 200 page THIS ad, still published?» ─────────────────────────────────
# Measured 2026-11-10 with a browser on the five ads that sat at 4 strikes with their pages up (P1
# served_after_source_gone:manzo — MNZ2006, MNZ2010, MNZ2375, MNZ1892, MNZ1893): each answers 200 and
# prints a schema.org block `"@type":"RealEstateListing"` whose "url" is the page's own address, with
# a "datePosted". A removed ad (MNZ1403, MNZ3148) and a made-up slug answer HTTP 404 «عقار | مانزو»
# with NO such block — while still printing a canonical link to the asked address, so the canonical
# alone proves nothing. LIVE = that block, naming this row's own stored address. Anything else: no
# opinion.
_LD_RE = re.compile(r'<script type="application/ld\+json"[^>]*>(.*?)</script>', re.S)


def _own_path(url: Any) -> str:
    from urllib.parse import unquote, urlparse
    return unquote(urlparse(str(url or "")).path).rstrip("/")


def page_is_this_live_ad(_ad_number: str, row: Optional[dict], body: str) -> bool:
    want = _own_path((row or {}).get("listing_url"))
    if not want.startswith("/ar/property/"):
        return False
    for raw in _LD_RE.findall(body or ""):
        try:
            d = json.loads(raw)
        except ValueError:
            continue
        if isinstance(d, dict) and d.get("@type") == "RealEstateListing" and d.get("datePosted") \
                and _own_path(d.get("url")) == want:
            return True
    return False


def _oracle(tbl: str, seen):
    return db.own_page_status_oracle(db.sb(), tbl, seen, live_page=page_is_this_live_ad)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--type", default="all")
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()
    dry = a.dry_run

    # 3 browser profiles DIRECT, then the residential proxy when the job has it (owner 10-05:
    # every crawler on the shared resilient path; backlog 63). The session owns the profile.
    s, tried = retry_smarter_session(API, timeout=40)
    print(f"  route: {' · '.join(tried)}", flush=True)
    listing, declared = walk(s)
    print(f"{SOURCE}: {len(listing)} propert(ies) (API declares total_count={declared})", flush=True)

    run_id = None if dry else db.begin_run(SLUG)
    res: list[dict] = []
    com: list[dict] = []
    skipped: dict[str, int] = {}
    unreadable = 0
    # Every ad the source's own list served AND whose own record we read, mapped or not (2026-10-13).
    # On 10-13 the walk read 29 records and mapped 0 (status «available» x28, a value nobody measured),
    # so the seen set was empty, strike_read_gone had no control and returned «nothing seen», and
    # MNZ1403 — its own page 404 — stayed on screen. Being listed never stamps a row alive; it only
    # keeps a row from being read as unseen and lets the own-page oracle find a known-live control.
    listed: set[str] = set()
    try:
        for p, d in zip(listing, read_details(s, listing)):
            if d is None:
                unreadable += 1
                continue
            listed.add(listed_ad_number(d, p))
            got, why = map_property(d)
            if not got:
                skipped[why] = skipped.get(why, 0) + 1
                continue
            row, cat = got
            (com if cat == "commercial" else res).append(row)
        if skipped:
            print("  skipped (not guessed): "
                  + ", ".join(f"{k}x{v}" for k, v in sorted(skipped.items())), flush=True)
        if dry:
            print(f"DRY: {len(res)} residential + {len(com)} commercial ({unreadable} unreadable)")
            for row in res + com:
                print("   ", json.dumps({k: row.get(k) for k in
                      ("ad_number", "property_type", "price_annual", "rent_period", "area_m2", "bedrooms",
                       "property_age", "city_id", "license_number")}, ensure_ascii=False)[:230])
            return 0

        db.upsert_manzo_residential_batch(res)
        db.upsert_manzo_commercial_batch(com)
        superseded = db.retire_superseded_siblings(
            res_table="manzo_residential_listings", com_table="manzo_commercial_listings",
            res_ads={r["ad_number"] for r in res}, com_ads={r["ad_number"] for r in com}, source=SOURCE)
        if superseded:
            print(f"  retired {superseded} superseded sibling row(s) after a category flip", flush=True)
        complete = unreadable == 0 and len(listing) >= declared > 0
        seen_all = {r["ad_number"] for r in res + com} | listed
        for tbl, rr in (("manzo_residential_listings", res), ("manzo_commercial_listings", com)):
            if rr and complete:
                seen = {r["ad_number"] for r in rr}
                n = db.prune_unseen(tbl, seen, source=SOURCE, verify_gone=_oracle(tbl, seen))
                if n < 0:
                    print(f"  ⚠ {tbl}: prune guard tripped — reading the unseen ads' own pages", flush=True)
                    n = db.strike_read_gone(tbl, seen_all, SOURCE, verify_gone=_oracle(tbl, seen_all))
                elif n:
                    print(f"  pruned {n} from {tbl}", flush=True)
            elif seen_all:
                # 2026-10-12: a 2-ad catalogue whose walk never matched the API's count skipped the
                # prune every night, so MNZ1403 (its own page 404, dead-visible 10-11 and 10-12)
                # froze at 2 strikes, on screen. Absence still decides nothing: only an unseen ad
                # whose OWN page reads gone (a seen ad answering live first) takes a strike.
                n = db.strike_read_gone(tbl, seen_all, SOURCE, verify_gone=_oracle(tbl, seen_all))
                if n > 0:
                    print(f"  pruned {n} from {tbl}", flush=True)
        if not complete:
            print(f"  absence prune skipped: {unreadable} unreadable detail(s) or a short walk "
                  f"(listed {len(listing)}, API total {declared}); own-page readings only"
                  f"{' — unreadable: ' + unreadable_summary() if unreadable else ''}", flush=True)
        # The API ANSWERED (a failed fetch raises above) and itself declares total_count=0 with no
        # results: the source published its own empty catalogue (2026-10-01/02: its one ad came
        # down). That is an answer, not a blocked crawl, so the run is not demoted to red for it.
        source_empty = source_published_empty(listing, declared)
        if source_empty:
            print("ℹ 0 rows, and the API itself declares total_count=0: the source published an empty "
                  "catalogue. Reporting healthy rather than red — this is not a blocked crawl.", flush=True)
        healthy = db.end_run(run_id, ok=True, rows_seen=len(listing), rows_upserted=len(res) + len(com),
                             allow_empty=source_empty,
                             notes=("source-published empty (API total_count=0)" if source_empty else
                                    (f"listed={len(listing)} declared={declared} unreadable={unreadable}"
                                     f"{' why=' + unreadable_summary() if unreadable else ''}"
                                     " | prune withheld: walk incomplete") if not complete else None),
                             check_tables=["manzo_residential_listings", "manzo_commercial_listings"])
        if not healthy:
            print("✗ run demoted to unhealthy by end_run()", flush=True)
            return 1
        print(f"✓ {SOURCE}: {len(res)} residential + {len(com)} commercial upserted", flush=True)
        return 0
    except Exception as e:  # noqa: BLE001
        if run_id:
            db.end_run(run_id, ok=False, rows_seen=len(listing), rows_upserted=0, notes=str(e)[:300])
        raise


if __name__ == "__main__":
    raise SystemExit(main())
