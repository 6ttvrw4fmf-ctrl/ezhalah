"""المسوق الافتراضي (Virtual Marketer) — vm-ksa.com. Onboarding 2026-09-26 (wave 3).

SOURCE SHAPE (measured live 2026-09-26 before any code was written)
=====================================================================
Next.js App Router. Listing index `/ar/ads?page=N` — 15 ads per page, and the page's own flight
payload declares `"total":163`, which matched the roster's 163 exactly. Unlike maqrat and rawaf,
pagination is REAL here: pages 1, 2, 3 each returned 15 NEW ids (789…854). No sitemap exists
(/sitemap.xml 404; /ar/sitemap.xml serves an HTML page), so the index pages ARE the enumeration.

FRESHNESS WAS CHECKED BEFORE BUILDING, because saaei's 1,039 turned out to be expired ads. The 45
ads on pages 1-3 read «منذ يوم» … «منذ شهرين»: live inventory, not an archive.

Each ad page `/ar/ads/<id>` carries the full ad as an RSC object {"id":<id>, …}. Fields are
structured — nothing is mined from prose:
  price_without_format "2000"                 → the price, verbatim
  price "SAR 2,000.00 /شهري"                  → carries the source's OWN period token
  property_type_enum rent|sale                → deal
  property_type_duration_enum month|year|…    → period, cross-checked against the token
  license_number, link (REGA ad-licence URL)  → kept
  zone/city/district/category/images_ads/attributes → RSC POINTERS ("$37") into the same payload

*** RSC POINTERS MUST BE RESOLVED, NOT STORED. *** `city` arrives as the literal string "$37".
Flight rows are `<hexid>:<json>`; "$37" is row 37. Storing the pointer would put "$37" in a city
column. `resolve()` looks each one up; an unresolvable pointer becomes None, never the pointer.

*** THE PAGE ALSO CONTAINS RELATED ADS WITH THE SAME SHAPE. *** The first object with a price on
ad 854's page was ad 592 (a related ad). The main ad is found by its own id, never by position.

PERIOD = SOURCE via normalize.rent_period_and_annual on the source's own price string: «شهري» →
'monthly' stored ×12 (the fleet's storage convention, divided back for display); «سنوي» → annual;
daily/weekly have no bucket and get no invented annual figure. The structured duration enum is
used only as a CROSS-CHECK — a disagreement skips the ad rather than picking one.

*** PDPL. *** The ad carries `identity_number` (the advertiser's registration number), `customer`
(the advertiser's name) and `advertiser_data`. None of these is ever stored — they are excluded
from source_capture explicitly, not merely left unread.
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
from scrapers.common.pii import redact_pii, strip_pii_fields  # noqa: E402

BASE = "https://vm-ksa.com"
SOURCE = "المسوق الافتراضي"
PREFIX = "VMK"
SLUG = "vmksa"
IMPERSONATE = "chrome"
TIMEOUT = 40

# Never persisted, not even inside source_capture (PDPL).
_PII_KEYS = {"identity_number", "customer", "advertiser_data", "can", "relatedAds", "is_favorite"}

_FLIGHT = re.compile(r'self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)', re.S)
_PTR = re.compile(r"\$[0-9a-f]+")
_DEC = json.JSONDecoder()

# Period vocabulary on the structured enum, used only to cross-check the price-string token.
_ENUM_PERIOD = {"month": "monthly", "year": "annual"}


def flight(html: str) -> str:
    """The page's RSC payload as one string — json.loads PER CHUNK (a blanket unicode_escape
    mangles every Arabic character; measured on wahadat, same framework)."""
    out = []
    for lit in _FLIGHT.findall(html):
        try:
            out.append(json.loads(lit))
        except Exception:  # noqa: BLE001
            continue
    return "".join(out)


_ROWB = re.compile(rb"([0-9a-f]+):(?:T([0-9a-f]+),)?")


def rows_of(raw: str) -> dict[str, Any]:
    """Flight rows by id. Two row shapes, and the second is why a line-based reader fails:
      `<id>:<json>\n`            — one JSON value per line (`I[…]`/`HL[…]` module rows are skipped);
      `<id>:T<hexlen>,<text>`     — a TEXT row: exactly <hexlen> UTF-8 BYTES, with NO newline after,
                                    so the next row starts mid-line. Long descriptions arrive this way
                                    ("description":"$37" → `37:T6ec,🏢 كولابز …`), measured 2026-09-26.
    Parsed sequentially over the UTF-8 bytes so a text row's length is honoured exactly."""
    b = raw.encode("utf-8")
    rows: dict[str, Any] = {}
    i, n = 0, len(b)
    while i < n:
        m = _ROWB.match(b, i)
        if not m:
            j = b.find(b"\n", i)
            i = n if j < 0 else j + 1
            continue
        rid = m.group(1).decode()
        if m.group(2):
            end = m.end() + int(m.group(2), 16)
            rows[rid] = b[m.end():end].decode("utf-8", "replace")
            i = end
            continue
        j = b.find(b"\n", m.end())
        j = n if j < 0 else j
        try:
            rows[rid] = json.loads(b[m.end():j])
        except ValueError:
            pass
        i = j + 1
    return rows


def resolve(v, rows: dict[str, Any]):
    """An RSC pointer "$37" → row 37's value; anything else unchanged; unresolvable → None."""
    if isinstance(v, str) and _PTR.fullmatch(v):
        return rows.get(v[1:])
    return v


def main_ad(raw: str, ad_id: int) -> Optional[dict]:
    """The page's OWN ad, found by its id — related ads share the shape (see docstring)."""
    for m in re.finditer(r'\{"id":%d[,}]' % ad_id, raw):
        try:
            obj, _ = _DEC.raw_decode(raw, m.start())
        except ValueError:
            continue
        if isinstance(obj, dict) and "price_without_format" in obj:
            return obj
    return None


def _name(v) -> Optional[str]:
    if isinstance(v, dict):
        v = v.get("name")
    return v.strip() if isinstance(v, str) and v.strip() else None


def list_ids(s: cc.Session) -> tuple[list[int], Optional[int]]:
    """Walk pages 1..lastPage as the page's own pagination object declares them, and union the
    ids. A "stop at the first page with nothing new" rule found 120 of 163 on 2026-09-26: the
    order shifted mid-walk (a page repeated ids from the page before). If the union is still short
    of the declared total, walk once more — a second pass reads the shifted rows.

    A page inside 1..lastPage that yields ZERO ids is a throttled shell, not an empty page, and is
    re-fetched with a pause. CI read 154 of the declared 190 on three straight runs (2026-09-26..28)
    because such a page was taken as-is: a 2026-09-28 walk got 0 ids from pages 12 and 13 first,
    then 15 and 10 on a retry. A union still short of the declared total is returned short — the
    caller then withholds prune and flags the run; it is never read as the whole index."""
    ids: dict[int, None] = {}
    declared = last = None
    for _ in range(2):
        page = 1
        while page <= (last or 1) and page <= 60:
            got: list[int] = []
            for attempt in range(3):
                if attempt:
                    time.sleep(3 * attempt)
                try:
                    h = s.get(f"{BASE}/ar/ads?page={page}", impersonate=IMPERSONATE, timeout=TIMEOUT).text
                except Exception:  # noqa: BLE001
                    continue
                m = re.search(r'"pagination":\{"total":(\d+),"lastPage":(\d+)', flight(h))
                if m:
                    declared, last = int(m.group(1)), int(m.group(2))
                got = [int(x) for x in re.findall(r"/ads/(\d+)", h)]
                if got:
                    break
            ids.update(dict.fromkeys(got))
            page += 1
        if declared is not None and len(ids) >= declared:
            break
    return list(ids), declared


# The ad's REGA licence block, by the site's own option NAME. These are never stored anywhere,
# not even inside source_capture: the ad officer's personal name and mobile (PDPL), and the title-
# deed number (a property registry id we have no use for).
_NEVER_STORE_OPTIONS = {"مسؤول الاعلان", "رقم مسؤول الاعلان", "رقم صك الملكية"}

# «خدمات العقار» is a multi-select: a named service → True; an unnamed one stays None (UNKNOWN),
# never False — a list that does not mention water does not say there is none.
_SERVICES = {"كهرباء": "electricity", "مياه": "water_supply", "صرف صحي": "sanitation"}

# Ready units only. Ad 813 (2026-09-26) is an apartment block «( تحت الإنشاء )».
_OFFPLAN_RE = re.compile(r"تحت\s*ال[إا]نشاء|قيد\s*ال[إا]نشاء|على\s*الخارطة|على\s*المخطط")

_DEAL = {"إيجار": "rent", "بيع": "sale"}


def named_options(ad: dict, rows: dict[str, Any]) -> dict[str, Any]:
    """{option name: selected value} for the ad's licence block. `options` is a pointer to a list of
    pointers, each an object {"option": <name>, "selected_value": …}."""
    opts = resolve(ad.get("options"), rows)
    out: dict[str, Any] = {}
    for o in opts if isinstance(opts, list) else []:
        o = resolve(o, rows)
        if isinstance(o, dict) and isinstance(o.get("option"), str):
            v = o.get("selected_value")
            out[o["option"].strip()] = v.strip() if isinstance(v, str) else v
    return out


def _code_name(v) -> Optional[str]:
    """«الرياض / 21282» → «الرياض» (the REGA name/code pair's NAME half)."""
    if not isinstance(v, str) or not v.strip():
        return None
    return v.split("/")[0].strip() or None


def _real(v) -> Optional[str]:
    """National-address cells use «0000» for "not given"."""
    return v if isinstance(v, str) and v.strip() and set(v.strip()) != {"0"} else None


def _num(v) -> Optional[float]:
    try:
        f = float(str(v).replace(",", ""))
    except (TypeError, ValueError):
        return None
    return f if f > 0 else None


def map_ad(ad: dict, rows: dict[str, Any]) -> tuple[Optional[tuple[dict, str]], str]:
    """((row, category) | None, skip_reason)."""
    ad_id = ad.get("id")
    opt = named_options(ad, rows)
    title = ad.get("title") or ""
    desc = resolve(ad.get("description"), rows)
    desc = desc if isinstance(desc, str) else ""

    if _OFFPLAN_RE.search(title) or _OFFPLAN_RE.search(desc):
        return None, "not_ready_offplan"

    # The ad's OWN REGA ad-licence end date is a gate (fleet law, owner 2026-09-28): 'expired' is never a
    # listing. 'unknown' (no readable date) is not judged — kept, and counted in main().
    # Measured 2026-10-02: 64 of 64 ads read print the date (DD/MM/YYYY), all in date; earliest 2026-10-08.
    licence_end = opt.get("تاريخ انتهاء ترخيص الاعلان")
    if normalize.ad_expiry_state(licence_end if isinstance(licence_end, str) else None) == "expired":
        return None, "ad_licence_expired"

    # TYPE — the licence's own singular «نوع العقار» (the category name is a plural nav bucket).
    type_ar = opt.get("نوع العقار")
    ptype = normalize.map_type_exact(type_ar)
    if not ptype:
        return None, f"type_unmapped_{type_ar}"
    category = normalize.category_for_type(ptype).lower()

    # DEAL — the structured enum and the licence's «غرض الاعلان» must agree. The category bucket
    # is NOT consulted: ad 841 sits under «مكاتب للبيع» while its enum, licence purpose and printed
    # «/شهري» price all say rent (2 such ads, 2026-09-26).
    enum = (ad.get("property_type_enum") or "").lower()
    purpose = _DEAL.get(opt.get("غرض الاعلان") or "")
    if enum not in ("rent", "sale"):
        return None, f"deal_unstated_{enum or 'none'}"
    if purpose and purpose != enum:
        return None, f"deal_conflict_{enum}_vs_{purpose}"
    deal = "Rent" if enum == "rent" else "Buy"

    # PRICE — «سعر الوحدة / سعر المتر للأرض»: for LAND the headline figure is PER m² (ad 844:
    # «SAR 1,550» on a 600 m² plot whose licence states «أجمالي سعر بيع الأرض» 930,000). So for
    # land the total is the licence's own published total, never a product we compute; the
    # per-m² rate is kept as price_per_meter and the search layer derives ≈ only where no total
    # was published (owner rule 2026-09-03, sale-only).
    headline = _num(ad.get("price_without_format"))
    is_land = "Land" in ptype
    price_total = price_annual = rent_period = ppm = None
    if deal == "Buy":
        if is_land:
            ppm = headline
            price_total = _num(opt.get("أجمالي سعر بيع الأرض"))
        else:
            price_total = headline
    else:
        rent_period, price_annual = normalize.rent_period_and_annual(
            None if is_land else normalize.to_int(ad.get("price_without_format")), ad.get("price"))
        by_enum = _ENUM_PERIOD.get((ad.get("property_type_duration_enum") or "").lower())
        if rent_period and by_enum and rent_period != by_enum:
            return None, f"period_conflict_{rent_period}_vs_{by_enum}"

    city_ar = _name(resolve(ad.get("city"), rows)) or _code_name(opt.get("المدينه / كود المدينه"))
    district_raw = _name(resolve(ad.get("district"), rows)) or _code_name(opt.get("الحي / كود الحي"))
    city_id, region_id = to_catalog(city_ar) if city_ar else (None, None)
    district_ar = find_district_in_text(district_raw, city_id) if (city_id and district_raw) else None

    imgs = resolve(ad.get("images_ads"), rows)
    photos = [u for u in (imgs if isinstance(imgs, list) else []) if isinstance(u, str) and u.startswith("http")]
    if not photos and isinstance(ad.get("main_image"), str):
        photos = [ad["main_image"]]
    attrs = resolve(ad.get("attributes"), rows)
    amenities = [a.strip() for a in (attrs if isinstance(attrs, list) else []) if isinstance(a, str) and a.strip()]

    services = {s.strip() for s in (opt.get("خدمات العقار") or "").split(",") if s.strip()}
    street = normalize.to_int(opt.get("عرض الشارع"))
    area = _num(opt.get("مساحة العقار"))

    row: dict[str, Any] = {
        "ad_number": f"{PREFIX}{ad_id}",
        "listing_url": f"{BASE}/ar/ads/{ad_id}",
        "source": SOURCE,
        "active": True,
        "title": redact_pii(title) or None,
        "description": redact_pii(desc) or None,
        "property_type": ptype,
        "transaction_type": deal,
        "city": normalize.map_city(city_ar) if city_ar else None,
        "city_ar": city_ar,
        "city_id": city_id,
        "region_id": region_id,
        "district_ar": district_ar,
        "neighborhood": district_raw,
        "area_m2": area,
        "property_age": normalize.exact_age(opt.get("عمر العقار")),
        "direction": normalize.one_direction(opt.get("واجهة العقار"), diagonal=True),
        "street_width_m": street if street and street > 0 else None,
        "street_name": _real(opt.get("الشارع")),
        "building_number": _real(opt.get("رقم المبني")),
        "zip_code": _real(opt.get("الرمز البريدي")),
        "additional_number": _real(opt.get("الرقم الاضافي")),
        "plan_parcel": " / ".join(x for x in (_real(opt.get("رقم المخطط")), _real(opt.get("رقم القطعة"))) if x) or None,
        "license_number": ad.get("license_number") or None,
        "license_expiry": opt.get("تاريخ انتهاء ترخيص الاعلان") or None,
        "ad_source": opt.get("مصدر الاعلان") or None,
        "date_added": ad.get("created_at") or None,
        "photo_urls": photos or None,
        "price_total": price_total,
        "price_per_meter": ppm,
    }
    for word, col in _SERVICES.items():
        if word in services:
            row[col] = True
    if "الياف ضوئية" in amenities:
        row["optical_fibers"] = True
    if deal == "Rent":
        row["price_annual"] = price_annual
        row["rent_period"] = rent_period

    stored = price_total if deal == "Buy" else price_annual
    row["price_evidence"] = normalize.price_evidence(
        field="أجمالي سعر بيع الأرض" if (is_land and deal == "Buy") else "price_without_format",
        raw=opt.get("أجمالي سعر بيع الأرض") if (is_land and deal == "Buy") else ad.get("price"),
        stored=stored, kind="total" if deal == "Buy" else "annual", unit="total", origin="api",
        authoritative_absent=stored is None)
    info = {
        "source_id": ad_id,
        "type_ar": type_ar,
        "category_ar": _name(resolve(ad.get("category"), rows)),
        "price_printed": ad.get("price"),
        "price_per_m2_printed": headline if is_land else None,
        "area_printed": opt.get("مساحة العقار"),
        "duration_enum": ad.get("property_type_duration_enum"),
        "source_rooms": opt.get("عدد الغرف"),
        "land_use_ar": opt.get("نوع استخدام الارض"),
        "property_use_ar": opt.get("استخدام العقار"),
        "age_ar": opt.get("عمر العقار"),
        "services_ar": sorted(services) or None,
        "amenities_ar": amenities or None,
        "ownership_doc_ar": opt.get("نوع وثيقة الملكية"),
        "encumbrances_ar": opt.get("الالتزامات على العقار"),
        "rega_ad_link": ad.get("link"),
        "latitude": ad.get("lat"),
        "longitude": ad.get("lng"),
        "zone_ar": _name(resolve(ad.get("zone"), rows)),
    }
    row["additional_info"] = strip_pii_fields({k: v for k, v in info.items() if v not in (None, "")})
    cap = {k: v for k, v in ad.items()
           if k not in _PII_KEYS and k != "options" and not (isinstance(v, str) and _PTR.fullmatch(v))}
    cap["options"] = {k: v for k, v in opt.items() if k not in _NEVER_STORE_OPTIONS}
    cap["title"], cap["description"] = row["title"], row["description"]
    row["source_capture"] = strip_pii_fields({"schema": "vmksa.rsc-ad.v2", **cap})
    return (row, category), ""


def fetch_ad(s: cc.Session, ad_id: int) -> tuple[Optional[str], Optional[dict]]:
    """(flight payload, the ad's own object) — retried with a pause when the object is missing.
    The first CI crawl (2026-09-26) got 9 of 163 ad pages back WITHOUT the ad object, although every
    one of them parses from a residential connection; a burst of 163 requests is throttled into a
    shell. Two paced retries recover it; a page still missing the object stays unreadable, which
    suppresses prune for that run rather than retiring a live ad."""
    raw = None
    for attempt in range(3):
        if attempt:
            time.sleep(3 * attempt)
        try:
            raw = flight(s.get(f"{BASE}/ar/ads/{ad_id}", impersonate=IMPERSONATE, timeout=TIMEOUT).text)
        except Exception:  # noqa: BLE001
            continue
        ad = main_ad(raw, ad_id)
        if ad:
            return raw, ad
    return raw, None


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--type", default="all")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()
    dry = a.dry_run

    s = cc.Session()
    ids, declared = list_ids(s)
    short_index = declared is None or len(ids) < declared   # no declared total read = short
    if a.limit:
        ids = ids[: a.limit]
    print(f"{SOURCE}: {len(ids)} ad id(s) listed (site declares total={declared})", flush=True)

    run_id = None if dry else db.begin_run(SLUG)
    res: list[dict] = []
    com: list[dict] = []
    skipped: dict[str, int] = {}
    unreadable = 0
    try:
        for ad_id in ids:
            raw, ad = fetch_ad(s, ad_id)
            if raw is None:
                unreadable += 1
                continue
            if not ad:
                unreadable += 1
                skipped["ad_object_not_found"] = skipped.get("ad_object_not_found", 0) + 1
                continue
            got, why = map_ad(ad, rows_of(raw))
            if not got:
                skipped[why] = skipped.get(why, 0) + 1
                continue
            row, cat = got
            (com if cat == "commercial" else res).append(row)

        no_end = sum(normalize.ad_expiry_state(r["license_expiry"] if isinstance(r.get("license_expiry"), str) else None)
                     == "unknown" for r in res + com)
        if no_end:
            print(f"  note: {no_end} ad(s) kept with no readable licence end date (not judged)", flush=True)
        if skipped:
            print("  skipped (not guessed): "
                  + ", ".join(f"{k}x{v}" for k, v in sorted(skipped.items())), flush=True)
        if dry:
            print(f"DRY: {len(res)} residential + {len(com)} commercial ({unreadable} unreadable)")
            for row in (res[:3] + com[:3]):
                print("   ", json.dumps({k: row.get(k) for k in
                      ("ad_number", "property_type", "transaction_type", "price_total",
                       "price_annual", "rent_period", "city_ar", "district_ar")},
                      ensure_ascii=False)[:190])
            return 0

        db.upsert_vmksa_residential_batch(res)
        db.upsert_vmksa_commercial_batch(com)
        superseded = db.retire_superseded_siblings(
            res_table="vmksa_residential_listings", com_table="vmksa_commercial_listings",
            res_ads={r["ad_number"] for r in res}, com_ads={r["ad_number"] for r in com}, source=SOURCE)
        if superseded:
            print(f"  retired {superseded} superseded sibling row(s) after a category flip", flush=True)
        # The index is complete only if it reached the site's OWN declared total and every listed
        # ad was readable; otherwise do not prune. No declared total read = not complete.
        complete = unreadable == 0 and not short_index and not a.limit
        for tbl, rr in (("vmksa_residential_listings", res), ("vmksa_commercial_listings", com)):
            if rr and complete:
                n = db.prune_unseen(tbl, {r["ad_number"] for r in rr}, source=SOURCE)
                if n < 0:
                    print(f"  ⚠ {tbl}: prune guard tripped — kept existing active rows", flush=True)
                elif n:
                    print(f"  pruned {n} from {tbl}", flush=True)
        if not complete:
            print(f"  NOT pruning: {unreadable} unreadable ad(s); index {len(ids)}/{declared}", flush=True)
        # A short index is flagged, not swallowed: it demotes the run (the daryusuf/ebriza rule).
        healthy = db.end_run(run_id, ok=True, rows_seen=len(ids), rows_upserted=len(res) + len(com),
                             notes=f"index={len(ids)}/{declared}; unreadable={unreadable}; complete={complete}; licence_end_unknown={no_end}",
                             degraded=short_index,
                             check_tables=["vmksa_residential_listings", "vmksa_commercial_listings"])
        if not healthy:
            print("✗ run demoted to unhealthy by end_run()", flush=True)
            return 1
        print(f"✓ {SOURCE}: {len(res)} residential + {len(com)} commercial upserted", flush=True)
        return 0
    except Exception as e:  # noqa: BLE001
        if run_id:
            db.end_run(run_id, ok=False, rows_seen=len(ids), rows_upserted=0, notes=str(e)[:300])
        raise


if __name__ == "__main__":
    raise SystemExit(main())
