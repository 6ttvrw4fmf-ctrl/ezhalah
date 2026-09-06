"""Aqargate (aqargate.com) scraper — Saudi Houzez WordPress site, clean public REST API.

No auth, no token, no rate-limit. Listings are a WordPress custom post type exposed at
/wp-json/wp/v2/properties (paginated, X-WP-TotalPages header). ~257 listings. Each carries the full
Saudi REGA ad data under property_meta.advertisement_response (price, area, rooms, plan/land number,
license, and a clean {region, city, district} location). The featured image is a direct `thumbnail` URL;
the FULL gallery lives behind /wp-json/wp/v2/media?parent=<post id> (the Houzez fave_property_images
list is not exposed in the properties payload — see fetch_gallery).

Field map (Aqargate property → our schema):
  property_type_text (Arabic)        → property_type (TYPE_MAP_AR) + residential/commercial routing
  property_status_text  بيع|إيجار     → transaction_type Buy|Rent
  ad.location.city (Arabic)          → city (normalize.map_city → canonical English)
  ad.location.district               → neighborhood
  ad.propertyPrice / landTotalAnnualRent → price_total | price_annual
  ad.propertyArea / numberOfRooms    → area_m2 / bedrooms
  media?parent=<id> attachments      → photo_urls (featured first, then source's ascending-id order;
                                       `thumbnail` is the fallback when the parent query fails/is empty)
  ad.propertyAge/Face/planNumber/... → additional_info (Age, Facade, Plan/Land number, Street width, Usage)
  link, fave_property_id             → listing_url, ad_number

Usage:  python -m scrapers.aqargate.run [--limit-test 1] [--type residential|commercial|all]
"""
from __future__ import annotations

import argparse
import os
import sys
import time
from pathlib import Path
from typing import Any, Optional

from curl_cffi import requests as cc

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT.parent) not in sys.path:
    sys.path.insert(0, str(ROOT.parent))

import copy

from scrapers.common import db, normalize
from scrapers.common.arabic_location import to_catalog

# PDPL: advertiser/agent identity + contact inside advertisement_response — never stored.
_PII = {"advertiserId", "advertiserName", "responsibleEmployeeName",
        "responsibleEmployeePhoneNumber", "phoneNumber"}

API = "https://aqargate.com/wp-json/wp/v2/properties"
MEDIA_API = "https://aqargate.com/wp-json/wp/v2/media"
HEADERS = {"Accept": "application/json"}
MIN_INTERVAL = float(os.environ.get("SCRAPE_MIN_INTERVAL", "0.3"))
PER_PAGE = 100  # WordPress REST cap

# Aqargate property_type (Arabic) → our canonical taxonomy.
TYPE_MAP_AR = {
    "شقة": "Apartment", "شقَّة صغيرة (استوديو)": "Apartment", "شقة مفروشة": "Apartment", "روف": "Floor",
    "فيلا": "Villa", "قصر": "Villa", "دور": "Floor", "عمارة": "Building", "برج": "Building",
    "ارض": "Residential Land", "أرض": "Residential Land", "مزرعة": "Farm", "إستراحة": "Rest House",
    "استراحة": "Rest House", "شاليه": "Chalet", "غرفة": "Room", "مجمع": "Compound",
    # commercial
    "مكتب": "Office", "معرض": "Showroom", "محطة": "Gas Station", "مستودع": "Warehouse",
    "مصنع": "Factory", "ورشة": "Workshop", "فندق": "Hotel", "كشك": "Kiosk", "موقف سيارات": "Parking",
    "مدرسة": "School", "مستشفى، مركز صحي": "Health Center", "سينما": "Cinema", "صراف": "Bank",
    "برج اتصالات": "Telecom Tower", "محطة كهرباء": "Commercial Building",
}
COMMERCIAL_TYPES = {
    "Office", "Showroom", "Gas Station", "Warehouse", "Factory", "Workshop", "Hotel", "Kiosk",
    "Parking", "School", "Health Center", "Cinema", "Bank", "Telecom Tower", "Commercial Building",
    "Commercial Land",
}

_last = 0.0


def _throttle() -> None:
    global _last
    wait = _last + MIN_INTERVAL - time.monotonic()
    if wait > 0:
        time.sleep(wait)
    _last = time.monotonic()


def session() -> cc.Session:
    s = cc.Session(impersonate="chrome124")
    s.headers.update(HEADERS)
    return s


def _oracle_session():
    """Transport seam for `_verify_gone`. A test replaces this to execute the oracle against
    injected responses — the decision itself lives in the pure `_gone_verdict`."""
    return session()


def fetch_page(s: cc.Session, page: int) -> tuple[list[dict], int]:
    _throttle()
    for attempt in range(3):
        try:
            r = s.get(f"{API}?page={page}&per_page={PER_PAGE}", timeout=30)
        except Exception:
            time.sleep(2 * (attempt + 1)); continue
        if r.status_code == 400:  # past the last page
            return [], 0
        if r.status_code != 200:
            time.sleep(2 * (attempt + 1)); continue
        total_pages = int(r.headers.get("X-WP-TotalPages") or 1)
        return (r.json() or []), total_pages
    return [], 0


# ── The liveness oracle ─────────────────────────────────────────────────────────────────────────
# WordPress post statuses that mean "this ad is no longer offered". `expired` is the one Houzez
# actually uses when a listing lapses (measured 2026-09-06: 7/7 rows this crawl had aged out were
# `expired` at source, while 7/8 known-live rows were `publish`). The others are WP's own
# not-publicly-visible states and mean the same thing for our purposes.
GONE_STATUSES = frozenset({"expired", "draft", "pending", "private", "trash", "future"})
LIVE_STATUSES = frozenset({"publish"})


def _gone_verdict(status: Optional[int], payload: Any, pid: str) -> Optional[tuple[str, str]]:
    """The oracle's DECISION, separated from its transport so it can be executed exhaustively.

    Pure: no I/O, no session, no clock. Returns a (verdict, reason) pair, or None meaning
    "no answer yet — the caller may retry". A None from here NEVER means death; the caller turns an
    exhausted retry budget into 'unknown'.

    `payload` is the parsed JSON body, or None when the body could not be parsed at all.
    """
    if status is None:
        return None                                   # network/timeout → retry, then 'unknown'
    if status == 404:
        code = (payload or {}).get("code") if isinstance(payload, dict) else None
        if code == "rest_post_invalid_id":
            return "gone", "wp post deleted (404 rest_post_invalid_id)"
        # A 404 the API does not attribute to the post id is about our read, not the listing.
        # (LISTING_LIVENESS.md §5.4: gathern expresses BLOCKING as its own 404 — a bare status
        # code is not automatically a not-found, so the API's own reason has to agree.)
        return "unknown", f"404 without rest_post_invalid_id (code={code!r})"
    if status != 200:
        return None                                   # 401/403/408/429/5xx/3xx → retry, then 'unknown'
    if not isinstance(payload, dict):
        return "unknown", "200 with unparseable body"
    if str(payload.get("id") or "") != pid:
        return "unknown", f"200 for a different post (asked {pid}, got {payload.get('id')!r})"
    st = str(payload.get("status") or "").strip().lower()
    if st in LIVE_STATUSES:
        return "live", f"wp status={st}"
    if st in GONE_STATUSES:
        return "gone", f"wp status={st}"
    return "unknown", f"unrecognised wp status={st!r}"


def _verify_gone(ad_number: str) -> tuple[str, str]:
    """DIRECT per-listing liveness oracle for `db.prune_unseen(verify_gone=...)`.

    WHY THIS EXISTS. Until 2026-09-06 this scraper prune'd on crawl ABSENCE alone — its own comment
    read "we fetched the COMPLETE catalog, so any row not seen this run is gone". That is exactly the
    inference `docs/ops/LISTING_LIVENESS.md` §1-§3 forbids: absence is `EvidenceKind.ABSENCE`, a
    candidate signal and never a verdict, because a partial page, a throttled run or a source-side
    index gap is indistinguishable from a removal. It produced a standing P1
    `unknown_treated_as_dead` alert (7 rows deactivated in 48h with no source verdict recorded).

    CONTROL-VALIDATED AGAINST THE FAILURE MODE THIS PLATFORM ACTUALLY USES, which is the lesson
    abeea's oracle paid for (see scrapers/abeea/run.py): aqargate does NOT usually delete a lapsed
    post — it flips the WordPress `status` from `publish` to `expired`, and the post keeps returning
    HTTP 200. A naive "200 ⇒ live, 404 ⇒ gone" oracle would therefore call every expired ad ALIVE.
    It does *sometimes* hard-delete (2/3 struck rows on 2026-09-06 returned 404
    `rest_post_invalid_id`), so both limbs are real and both are affirmative.

    Measured 2026-09-06 over the whole catalogue: 200 published ids at source vs 143 active rows
    here; the only 3 active rows absent from the published set were exactly the 3 rows carrying
    strikes, and all 3 were `expired`/deleted at source. Absence and source truth agreed — but
    nothing was RECORDING that, which is what made every deactivation unevidenced.

    Verdicts, per the three-valued law — anything that is not an affirmative answer is 'unknown',
    and 'unknown' holds the strike without deactivating:
      'live'    — HTTP 200 and the post's own status is `publish`
      'gone'    — HTTP 200 with a GONE_STATUSES status, or a 404 the API itself attributes to an
                  invalid post id (the post was deleted)
      'unknown' — timeout, connection error, 401/403/408/429, any 5xx, an unparseable body, a
                  status string we do not recognise, or an id mismatch. NEVER death.
    """
    pid = (ad_number or "")[2:] if (ad_number or "").upper().startswith("AG") else (ad_number or "")
    if not pid.isdigit():
        return "unknown", f"ad_number {ad_number!r} does not carry a numeric WP post id"
    s = _oracle_session()
    last = "no attempt made"
    for attempt in range(2):
        _throttle()
        status: Optional[int] = None
        payload: Any = None
        try:
            r = s.get(f"{API}/{pid}", timeout=30)
            status = r.status_code
            last = f"HTTP {status}"
            try:
                payload = r.json()
            except Exception:  # noqa: BLE001 — an unreadable body is not an answer
                payload = None
        except Exception as e:  # noqa: BLE001 — an unreachable source is never proof of death
            last = f"{type(e).__name__}: {e}"
        decided = _gone_verdict(status, payload, pid)
        if decided is not None:
            return decided
        time.sleep(1.2 * (attempt + 1))
    return "unknown", f"no answer after 2 attempts ({last})"


def fetch_gallery(s: cc.Session, post_id: Any, featured_id: Any) -> Optional[list[str]]:
    """Full gallery for one property via the WP media endpoint. The Houzez gallery
    (fave_property_images) is NOT in the properties payload, but every gallery photo IS a media
    attachment whose parent is the property post id — verified live 2026-09-05 on 3 listings
    (e.g. 57251: `thumbnail` is false yet 34 live attachments; the thumbnail-only path stored it
    with 0 images and capped every multi-photo gallery to 1). Order = the source's own: ascending
    attachment id with the featured image first (it is the card thumbnail on the site).

    Returns None — meaning "caller keeps the thumbnail fallback" — on request failure AND on an
    empty-but-successful parent query: ~27% of listings (live 2026-09-05: 55102, 51336, 52193,
    53809) upload their media UNATTACHED (post:null), so an empty result is not "no photos" and
    storing [] there would hide a source-published photo. Genuinely imageless rows (e.g. 53151)
    still end at [] because their `thumbnail` is false too. Non-image attachments are excluded by
    mime_type. Cost: one throttled GET per listing (~200 rows × 0.3s ≈ 60s/run, no auth)."""
    if not post_id:
        return None
    _throttle()
    try:
        r = s.get(f"{MEDIA_API}?parent={post_id}&per_page=100&orderby=id&order=asc"
                  "&_fields=id,source_url,mime_type", timeout=30)
        if r.status_code != 200:
            return None
        atts = [a for a in (r.json() or [])
                if str(a.get("mime_type") or "").startswith("image/")
                and isinstance(a.get("source_url"), str)]
    except Exception:
        return None
    if not atts:
        return None
    atts.sort(key=lambda a: (a.get("id") != featured_id, a.get("id") or 0))
    return [a["source_url"] for a in atts]


def _int(v: Any) -> Optional[int]:
    try:
        return int(float(v)) if v not in (None, "", 0, "0") else None
    except (TypeError, ValueError):
        return None


def _price_int(v: Any) -> Optional[int]:
    """Price-specific _int: ROUNDS HALF-UP instead of truncating. aqargate's own page badge rounds
    its price meta for display the PHP number_format way (live 2026-08-03: meta 2388.79 → badge
    «2,389», 388.52 → «389», 14.5 → «15», 703.5 → «704»); int(float()) floored these to 1 SAR
    under the displayed price. Python's round() is banker's (14.5→14) — not what the site shows,
    hence the explicit +0.5 floor."""
    try:
        if v in (None, "", 0, "0"):
            return None
        x = float(v)
        return int(x + 0.5) if x >= 0 else None
    except (TypeError, ValueError):
        return None


def _text(v: Any) -> Optional[str]:
    if isinstance(v, list):
        return v[0] if v else None
    return v if isinstance(v, str) else None


def _val(v: Any) -> Optional[str]:
    """Clean a scalar into a display string, or None if empty/placeholder."""
    if v in (None, "", 0, "0", []):
        return None
    s = str(v).strip()
    return s or None


def _additional_info(ar: dict) -> list[dict[str, Any]]:
    """Card 'Additional Information' panel — ONLY the fields we show for the other sources
    (mirrors the Wasalt set: usage / age / facade / ad source / plan & land number / street /
    services / obligations / license date). NEVER include the advertiser or responsible-person
    name or phone number — that is personal data (PDPL)."""
    rows: list[dict[str, Any]] = []

    def add(key: str, label: str, value: Optional[str]) -> None:
        if value:
            rows.append({"key": key, "label": label, "value": value})

    usages = ar.get("propertyUsages")
    usage = (", ".join(str(u) for u in usages) if isinstance(usages, list) and usages
             else _val(usages) or _val(ar.get("mainLandUseTypeName")))
    add("usage", "Property usage", usage)
    add("propertyAge", "Age", _val(ar.get("propertyAge")))
    add("propertyFace", "Facade", _val(ar.get("propertyFace")))
    add("adSource", "Ad source", _val(ar.get("adSource")))
    add("planNumber", "Plan number", _val(ar.get("planNumber")))
    add("landNumber", "Land number", _val(ar.get("landNumber")))
    add("streetWidth", "Street width", _val(ar.get("streetWidth")))
    utils = ar.get("propertyUtilities")
    if isinstance(utils, list) and utils:
        add("services", "Property services", "، ".join(str(u) for u in utils))
    add("obligations", "Other obligations on the property", _val(ar.get("obligationsOnTheProperty")))
    add("regaAdvLicDate", "License Issuance Date", _val(ar.get("creationDate")))
    return rows


def _rent_annualize(
    rent: Optional[int], has_annual_field: bool, title_text: str,
) -> tuple[Optional[int], Optional[str]]:
    """rent_period was previously hardcoded "annual" unconditionally — this scraper had zero logic
    to detect a monthly rental even though the source's own WordPress title already carries the
    signal (found live 2026-07-28: ad AG51935's title reads "...للإيجار الشهري..." — monthly — yet
    was stored price_annual=16,000/rent_period='annual', understating the true annual cost ~12x;
    confirmed not a one-off via `title ilike '%شهري%' and rent_period='annual'`). landTotalAnnualRent
    is an explicit annual-rate field when present, so it's trusted as-is; the monthly-title detection
    only applies to the propertyPrice fallback, which carries no period info of its own."""
    if rent is None:
        return None, None
    if not has_annual_field and "شهري" in title_text:
        return rent * 12, "monthly"
    return rent, "annual"


def map_listing(p: dict, s: Optional[cc.Session] = None) -> tuple[Optional[dict], str]:
    meta = p.get("property_meta") or {}
    ar = meta.get("advertisement_response") or {}
    pid = _text(meta.get("fave_property_id")) or str(p.get("id") or "")
    if not pid:
        return None, "residential"
    type_ar = (_text(p.get("property_type_text")) or "").strip()
    property_type = TYPE_MAP_AR.get(type_ar, type_ar or None)
    is_rent = (_text(p.get("property_status_text")) or "").strip() == "إيجار"
    loc = ar.get("location") or {}
    # Land in a commercial usage → Commercial Land
    if property_type == "Residential Land":
        usages = " ".join(str(u) for u in (ar.get("propertyUsages") or []))
        if "تجاري" in usages:
            property_type = "Commercial Land"
    category = "commercial" if property_type in COMMERCIAL_TYPES else "residential"

    # Forward-fix (2026-07-10 location-data-quality audit): an honest None beats the literal "Other"
    # sentinel on this legacy column — the additive city_ar/city_id columns below already resolve
    # most rows independently; this just closes the remaining leak on the raw-column read path.
    city = normalize.map_city(loc.get("city") or "")

    # Native STRUCTURED Arabic (ADDITIVE — live city/neighborhood above untouched). Aqargate's REST
    # carries a clean {region, city, district} in Arabic → resolve catalog IDs with the region as the
    # twin-disambiguation hint (no parser, no loose matching). source_capture = the whole WordPress
    # property MINUS advertiser PII (nested in advertisement_response). Numbers/photos unchanged.
    city_ar = (loc.get("city") or "").strip() or None
    region_ar = (loc.get("region") or "").strip() or None
    district_ar = (loc.get("district") or "").strip() or None
    cid, rid = to_catalog(city_ar, region_hint=region_ar)
    cap = copy.deepcopy(p)
    _arc = (cap.get("property_meta") or {}).get("advertisement_response")
    if isinstance(_arc, dict):
        for _k in _PII:
            _arc.pop(_k, None)

    price = ar.get("propertyPrice") or ar.get("landTotalPrice")
    # propertyPrice is the DISPLAYED figure (fave_property_price mirrors it on the page badge).
    # landTotalAnnualRent is the source backend's own price×area derivation on land ads — live
    # 2026-08-03, ids 583516/583517: page displays 150,000 (propertyPrice) while
    # landTotalAnnualRent=90,000,000 = 150,000×600m². Display wins; the derived field is only a
    # fallback when no displayed price exists.
    rent = ar.get("propertyPrice") or ar.get("landTotalAnnualRent")
    title_text = (p.get("title") or {}).get("rendered") or ""
    rent_annual, rent_period = _rent_annualize(
        _price_int(rent), has_annual_field=ar.get("landTotalAnnualRent") is not None, title_text=title_text,
    ) if is_rent else (None, None)
    thumb = p.get("thumbnail")
    # Gallery from the media endpoint; None (fetch failed OR empty parent query) keeps the old
    # thumbnail fallback so failure degrades to FEWER images, never [] over a live photo.
    gallery = fetch_gallery(s, p.get("id"), p.get("featured_media")) if s is not None else None
    row = {
        "ad_number": f"AG{pid.replace('AG-', '').replace('AG', '')}",
        "listing_url": p.get("link"),
        "source": "Aqargate",
        "active": True,
        "property_type": property_type,
        "transaction_type": "Rent" if is_rent else "Buy",
        "area_m2": _int(ar.get("propertyArea")),
        # numberOfRooms is REGA's generic room count, not bedroom-specific — aqargate never exposes
        # a separate bedroom field (unlike wasalt's REGA payload, which carries a distinct
        # noOfBedrooms). Storing it as `bedrooms` mislabels total rooms as bedroom count; owner
        # decision 2026-07-28: null rather than store an unverifiable figure (live-confirmed wrong
        # on ad 5435594 — DB said 11 bedrooms, the listing's own description said 5).
        "bedrooms": None,
        "bathrooms": _int(ar.get("numberOfBathrooms")),
        # On Buy LAND ads `propertyPrice` is the UNIT RATE, not the asking price. The page's own REGA
        # table labels it «سعر الوحدة» and sellers write «N ريال للمتر» in the description — verified
        # live 2026-08-09 on AG55663: «سعر الوحدة 2817», «2817 ريال للمتر», area 1,740 m².
        #
        # It used to be stored in price_total under a "copy-the-display" rule, because aqargate's own
        # badge renders it under the bare label «السعر». That is precisely the total↔per-m² confusion
        # the owner's 2026-08-09 rule forbids: a 1,740 m² plot appeared in search at 2,817 SAR.
        #
        # And we do NOT substitute `landTotalPrice`: it equals propertyPrice × propertyArea exactly on
        # 30 of 31 live rows, so it is aqargate's own arithmetic, not an independently published
        # price. Adopting it would be the banned rate × area multiplication with an extra step.
        # The honest state is what the source actually gives us: a RATE, and no total.
        # (This also defuses 18 further rows whose wrong totals were only hidden by the sub-1000
        # suppression retired on 2026-08-05 — they would otherwise surface on the next run, e.g.
        # AG52441 offering a 106,474 m² plot for "40 SAR".)
        "price_total": None if (is_rent or ar.get("landTotalPrice") is not None)
                       else _price_int(price),
        "price_per_meter": _price_int(ar.get("propertyPrice"))
            if (not is_rent and ar.get("landTotalPrice") is not None) else None,
        "price_annual": rent_annual,
        "rent_period": rent_period,
        "city": city,
        "neighborhood": loc.get("district") or None,
        "title": (p.get("title") or {}).get("rendered"),
        "photo_urls": gallery if gallery is not None
                      else ([thumb] if isinstance(thumb, str) and thumb.startswith("http") else []),
        "property_age": _int(ar.get("propertyAge")),
        "rega_location_verified": bool(ar.get("adLicenseNumber")),
        "additional_info": _additional_info(ar),
        # ── Arabic-native structured (additive, shadow) + complete-source capture ──
        "city_ar": city_ar,
        "district_ar": district_ar,
        "city_id": cid,
        "region_id": rid,
        "source_capture": cap,
    }
    return row, category


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--type", choices=["residential", "commercial", "all"], default="all")
    p.add_argument("--limit-test", type=int, default=0, help="dry-run: process N pages, no DB write")
    args = p.parse_args()

    s = session()
    _, total_pages = fetch_page(s, 1)
    print(f"Aqargate: {total_pages} pages (per_page={PER_PAGE})")
    run_id = None if args.limit_test else db.begin_run("aqargate")
    res: list[dict] = []
    com: list[dict] = []
    seen = 0
    try:
        for page in range(1, total_pages + 1):
            listings, _ = fetch_page(s, page)
            if not listings:
                break
            for p_ in listings:
                row, cat = map_listing(p_, s)
                if not row or not row.get("property_type"):
                    continue
                if args.type != "all" and cat != args.type:
                    continue
                (com if cat == "commercial" else res).append(row)
                seen += 1
            if args.limit_test and page >= args.limit_test:
                break
        if args.limit_test:
            print(f"DRY RUN — would upsert {len(res)} residential + {len(com)} commercial")
            for r in res[:4]:
                print("  ", {k: r[k] for k in ("ad_number", "property_type", "transaction_type", "city", "neighborhood", "area_m2", "price_total")})
                print("     photo:", (r["photo_urls"] or ["(none)"])[0][:80])
            return 0
        if res: db.upsert_aqargate_residential_batch(res)
        if com: db.upsert_aqargate_commercial_batch(com)
        # FULL-REFRESH prune: we re-read the COMPLETE catalog, so a row not seen this run is a
        # strong CANDIDATE for removal — never a verdict. Absence is EvidenceKind.ABSENCE
        # (LISTING_LIVENESS.md §1-§3) and may select which rows to re-probe, nothing more; only
        # _verify_gone's affirmative per-listing answer may deactivate. Before 2026-09-06 this
        # pruned on absence alone, which is what raised the standing unknown_treated_as_dead P1.
        pruned = 0
        for tbl, rows_seen in (("aqargate_residential_listings", res), ("aqargate_commercial_listings", com)):
            n = db.prune_unseen(tbl, {r["ad_number"] for r in rows_seen}, source="Aqargate",
                                verify_gone=_verify_gone)
            if n < 0:
                print(f"⚠ {tbl}: prune guard tripped (0 scraped or collapse) — kept existing active")
            else:
                pruned += n
        print(f"✓ Aqargate: {len(res)} residential + {len(com)} commercial upserted, {pruned} stale pruned")
        healthy = db.end_run(run_id, ok=True, rows_seen=seen, rows_upserted=seen, notes=f"pruned={pruned}", check_tables=["aqargate_residential_listings", "aqargate_commercial_listings"])
        if not healthy:
            print("✗ run demoted to unhealthy by end_run()'s RC-B guard — failing CI instead of a silent success.", flush=True)
        return 0 if healthy else 1
    except Exception as e:
        if run_id:
            db.end_run(run_id, ok=False, rows_seen=seen, rows_upserted=0, notes=str(e)[:300])
        print(f"✗ {e}")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
