"""ودود العقارية — wadod.sa. Laravel + Livewire, server-rendered. North-Riyadh brokerage, rent + sale.

SOURCE SHAPE (measured live 2026-09-24, before any code):
  · CATALOGUE. /properties/rent/all?page=N (rent) and /properties?page=N (sale). Cards are
    server-rendered: each carries `wire:key="property-<id>"`, a status badge («متاح» / «مؤجر»),
    a sold overlay (`sold_icon.png`, alt «مباع») on sale cards, the price («90,000»), the title, the
    location («شمال الرياض - حي النرجس»), rooms/baths/area and the S3 cover image. ONLY an available
    card is a link (href https://wadod.sa/property/<id>); rented/sold cards have no href at all.
    Measured: rent page 1 = 20 cards, page 2 = 10, page 3 = 0; sale page 1 = 3 cards, page 2 = 0
    → 33 cards, of which 7 «متاح», 23 «مؤجر», 3 sold. The run walks pages until an empty one.
    sitemap-properties.xml is NOT the catalogue: it lists 20 ids (ar + en URLs), includes
    /property/1 (a «test» dummy, price 3, on no catalogue page) and misses the newest ids.
  · DETAIL (/property/<id>, available ones only). Text lines, label then value:
      «المعلومات الأساسية للعقار»: رقم الترخيص · نوع العقار (شقة/دور) · المساحة «140 م²» · نوع العرض
      (إيجار/بيع) · الطابق (الأرضي/الأول/الثاني/الثالث) · غرف النوم · دورات مياه · صالات المعيشة.
      «تفاصيل العقار»: the PRESENT features only, each with a check icon — المطبخ / المكيفات /
      المواقف / المصعد / صالة / مؤثثة — then «عمر العقار» (2 / 5 / 7 / جديد). An absent feature is
      simply not listed → NULL, never False.
      «مميزات العقار» is the NEIGHBOURHOOD (صراف آلي، مسجد، مدرسة، مستشفى) → ignored.
      Header: h1 title · «حي العارض, الرياض» · price «65,000» · payment terms «دفعة واحدة» / «دفعتين».
  · RENT PERIOD = SOURCE. «دفعة واحدة»/«دفعتين» are PAYMENT terms, not a period; no measured page
    says سنوي/شهري (7/7 silent) → rent_period NULL, price_annual = the figure unconverted.
  · PHOTOS. The detail gallery is a lazily-loaded Livewire component: the server HTML holds no image
    URL (0/3 pages). The card's cover image on S3
    (…amazonaws.com/propertiesImages/<uuid>-<n>.webp) is the photo — fetched, image/webp.
  · PDPL: descriptions carry no phone numbers (7/7); redact_pii runs regardless.
  · REMOVAL ORACLE (measured 2026-09-24): a rented/sold listing's page answers HTTP 404 with the
    site's own «404 غير متوفر» page (ids 84, 48, 82 — 3/3); a live one answers 200 with the h1 and
    «المعلومات الأساسية للعقار» (92, 93, 80 — 3/3). An id that never existed answers HTTP 500
    (999999) — the shared law reads 5xx as no opinion, so an unknown id can never be pruned.
    Signal: 404 + «غير متوفر» → gone; 200 + «المعلومات الأساسية للعقار» → live; else no opinion.
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
from scrapers.common.arabic_location import city_ar_for, find_district_in_text, to_catalog  # noqa: E402
from scrapers.common.http_liveness import LivenessProbe  # noqa: E402
from scrapers.common.pii import redact_pii  # noqa: E402

BASE = "https://wadod.sa"
SOURCE = "ودود العقارية"
PREFIX = "WDD"
RES_TABLE = "wadod_residential_listings"
COM_TABLE = "wadod_commercial_listings"
LISTS = (f"{BASE}/properties/rent/all", f"{BASE}/properties")
_PAUSE = 1.0

AVAILABLE = "متاح"
NOT_FOUND = "غير متوفر"
INFO_HEAD = "المعلومات الأساسية للعقار"
INFO_LABELS = ("رقم الترخيص", "نوع العقار", "المساحة", "نوع العرض", "الطابق", "غرف النوم", "دورات مياه",
               "صالات المعيشة")
FEATURE_COL = {"المطبخ": "kitchen", "المكيفات": "air_conditioner", "المواقف": "parking", "المصعد": "elevator",
               "مؤثثة": "furnished", "مؤثث": "furnished"}
DEAL = {"إيجار": "Rent", "ايجار": "Rent", "بيع": "Buy"}
FLOOR = {"الأرضي": 0, "الارضي": 0, "الأول": 1, "الاول": 1, "الثاني": 2, "الثالث": 3, "الرابع": 4, "الخامس": 5,
         "السادس": 6, "السابع": 7, "الثامن": 8, "التاسع": 9, "العاشر": 10}
CARD_SPLIT = re.compile(r'(?=<(?:a|div) wire:key="property-\d+")')


def session() -> cc.Session:
    # impersonate owns the User-Agent — never set one here.
    s = cc.Session(impersonate="chrome")
    s.headers.update({"Accept-Language": "ar,en;q=0.7"})
    return s


def fetch(s: cc.Session, url: str) -> str:
    r = s.get(url, timeout=60)
    if r.status_code != 200:
        raise RuntimeError(f"{url} → HTTP {r.status_code}")
    return r.text


def html_text(raw: Optional[str]) -> str:
    if not raw:
        return ""
    t = re.sub(r"(?is)<(script|style|svg).*?</\1>", " ", raw)
    t = re.sub(r"(?i)<br\s*/?>|</(p|div|li|h[1-6]|tr|span)>", "\n", t)
    t = ihtml.unescape(re.sub(r"(?s)<[^>]+>", " ", t))
    t = re.sub(r"[ \t\xa0]+", " ", t)
    return re.sub(r"\n\s*\n+", "\n", t).strip()


def parse_cards(page_html: str) -> list[dict[str, Any]]:
    """Every card on a catalogue page: id, href (available only), badges, sold overlay, price, cover."""
    out = []
    for chunk in CARD_SPLIT.split(page_html)[1:]:
        pid = int(re.search(r'property-(\d+)', chunk).group(1))
        head = chunk[:8000]
        href = re.search(r'href="([^"]*/property/\d+)"', chunk[:400])
        badges = re.findall(r'(متاح|مؤجر|إيجار|بيع|مباع)\s*</span>', head)
        price = re.search(r'text-primery[^>]*>\s*([\d,]+)\s*<span class="icon-saudi_riyal', head)
        loc = re.search(r'fa-map-marker-alt.*?<span[^>]*>\s*([^<]+?)\s*</span>', head, re.S)
        img = re.search(r'<img[^>]+src="(https://[^"]+amazonaws\.com/[^"]+)"', head)
        title = re.search(r'<h4[^>]*>\s*([^<]+?)\s*</h4>', head)
        out.append({"id": pid, "href": href.group(1) if href else None,
                    "sold": "sold_icon.png" in head, "badges": badges,
                    "price_raw": price.group(1) if price else None,
                    "location": ihtml.unescape(loc.group(1)) if loc else None,
                    "title": ihtml.unescape(title.group(1)) if title else None,
                    "cover": img.group(1) if img else None})
    return out


def parse_detail(page_html: str) -> dict[str, Any]:
    lines = [ln.strip() for ln in html_text(page_html).split("\n") if ln.strip()]
    h1 = re.search(r"<h1[^>]*>\s*(.*?)\s*</h1>", page_html, re.S)
    pm = re.search(r'text-primery">\s*([\d,]+)\s*</span>\s*<span class="icon-saudi_riyal[^>]*></span>\s*<span[^>]*>([^<]*)</span>',
                   page_html)
    info: dict[str, str] = {}
    feats: list[str] = []
    age = None
    desc = ""
    if INFO_HEAD in lines:
        i = lines.index(INFO_HEAD)
        block = lines[i + 1:]
        for k, ln in enumerate(block):
            if ln in INFO_LABELS and k + 1 < len(block) and block[k + 1] not in INFO_LABELS:
                info[ln] = block[k + 1]
            if ln == "تفاصيل العقار":
                for f in block[k + 1:]:
                    if f == "عمر العقار":
                        j = block.index(f, k + 1)
                        age = block[j + 1] if j + 1 < len(block) else None
                        break
                    if f.startswith("عقارات مشابهة"):
                        break
                    feats.append(f)
                break
    if "وصف العقار" in lines:
        d = lines.index("وصف العقار") + 1
        stop = next((n for n, ln in enumerate(lines[d:]) if ln in ("مميزات العقار", INFO_HEAD)), 0)
        desc = "\n".join(lines[d:d + stop])
    loc = None
    if h1:
        t = html_text(h1.group(1))
        try:
            loc = lines[lines.index(t) + 1]
        except ValueError:
            loc = None
    return {"title": html_text(h1.group(1)) if h1 else None, "location": loc,
            "price_raw": pm.group(1) if pm else None, "payment_terms": pm.group(2).strip() if pm else None,
            "info": info, "features": feats, "age_raw": age, "description": desc}


def resolve_city(loc: Optional[str]) -> tuple[Optional[int], Optional[int], Optional[str]]:
    for seg in re.split(r"[-–,،|/]", loc or ""):
        seg = re.sub(r"^\s*(?:مدينة|شمال|جنوب|شرق|غرب|وسط)\s+", "", seg.strip())
        if not seg or re.match(r"(?:حي|حى|بحي)\s", seg):
            continue
        cid, rid = to_catalog(seg)
        if cid:
            return cid, rid, city_ar_for(cid) or seg
    return None, None, None


def map_listing(card: dict[str, Any], detail: dict[str, Any]) -> tuple[Optional[dict], str, str]:
    """One available card + its detail page → (row, category, skip_reason)."""
    if card.get("sold") or "مؤجر" in card.get("badges", []):
        return None, "residential", "sold_or_rented"
    if AVAILABLE not in card.get("badges", []) or not card.get("href"):
        return None, "residential", "unavailable"
    info = detail["info"]
    type_ar = info.get("نوع العقار")
    ptype = normalize.map_type_exact(type_ar)
    if not ptype:
        return None, "residential", f"type_unmapped[{type_ar or 'none'}]"
    category = normalize.category_for_type(ptype).lower()
    deal = DEAL.get((info.get("نوع العرض") or "").strip())
    if not deal:
        return None, category, f"deal_unknown[{info.get('نوع العرض') or 'none'}]"
    loc = detail["location"] or card.get("location")
    city_id, region_id, city_ar = resolve_city(loc)
    if not city_id:
        return None, category, "city_not_in_catalog"
    price = normalize.to_int(detail["price_raw"] or card.get("price_raw"))
    desc = redact_pii(detail["description"]) or None
    # Rule 6: bedrooms/bathrooms are one DWELLING's room count. map_type_exact has no per-platform
    # override here, so it resolves against the FULL shared vocabulary (Office/Shop/Farm/Building/
    # Commercial Land/…) — same gate as shatri/alqasem in this batch.
    dwelling = ptype in ("Apartment", "Villa", "Duplex", "Floor", "Studio")
    beds = normalize.to_int(info.get("غرف النوم"))
    baths = normalize.to_int(info.get("دورات مياه"))
    row: dict[str, Any] = {
        "ad_number": f"{PREFIX}{card['id']}",
        "listing_url": f"{BASE}/property/{card['id']}", "source": SOURCE, "active": True,
        "title": detail["title"] or card.get("title"), "description": desc,
        **normalize.amenities_from_text(desc),
        "property_type": ptype, "transaction_type": "Rent" if deal == "Rent" else "Buy",
        "city": normalize.map_city(city_ar), "city_ar": city_ar, "city_id": city_id, "region_id": region_id,
        "district_ar": find_district_in_text(loc, city_id), "neighborhood": loc,
        "area_m2": normalize.to_int(info.get("المساحة")),
        "bedrooms": beds if dwelling else None,
        "bathrooms": baths if dwelling else None,
        "halls": normalize.to_int(info.get("صالات المعيشة")),
        "floor_number": FLOOR.get((info.get("الطابق") or "").strip()),
        "property_age": normalize.exact_age(detail["age_raw"]),
        "license_number": normalize.ad_licence_from_prose("ترخيص: " + info["رقم الترخيص"]) if info.get("رقم الترخيص") else None,
        "photo_urls": [card["cover"]] if card.get("cover") else None,
    }
    for f in detail["features"]:
        col = FEATURE_COL.get(f)
        if col:
            row[col] = True                       # NAMED with a check icon; absent stays NULL
    if deal == "Rent":
        period, annual = normalize.rent_period_and_annual(price, (desc or "") + "\n" + (detail["payment_terms"] or ""))
        row["price_annual"] = annual
        if period:
            row["rent_period"] = period
    else:
        row["price_total"] = price
    row["additional_info"] = {k: v for k, v in {
        "type_ar": type_ar, "offer_ar": info.get("نوع العرض"), "floor_raw": info.get("الطابق"),
        "age_raw": detail["age_raw"], "payment_terms": detail["payment_terms"],
        "price_raw": detail["price_raw"] or card.get("price_raw"),
        "features_ar": ", ".join(detail["features"]) or None, "card_location": card.get("location"),
        "bedrooms_raw": beds if not dwelling else None, "bathrooms_raw": baths if not dwelling else None,
    }.items() if v is not None}
    return row, category, ""


# ── LIVENESS (see the docstring's measured oracle) ───────────────────────────────────────────────
def _signal(status, body, _moved):
    if status == 404 and NOT_FOUND in (body or ""):
        return "gone"
    if status == 200 and INFO_HEAD in (body or ""):
        return "live"
    return None


def verify_gone(ad_number: str) -> tuple[str, str]:
    pid = ad_number[len(PREFIX):]
    if not pid.isdigit():
        return "unknown", f"{ad_number!r} is not a {PREFIX}<id> ad number"
    return LivenessProbe(platform="wadod", signal=_signal, session=session,
                         url_for=lambda _ad: f"{BASE}/property/{pid}").verify_gone(ad_number)


def enumerate_cards(s: cc.Session) -> list[dict[str, Any]]:
    """Every card on both catalogues, walking ?page=N until a page yields none (or repeats)."""
    cards: dict[int, dict[str, Any]] = {}
    for base in LISTS:
        seen_pages: set[tuple[int, ...]] = set()
        for page in range(1, 50):
            batch = parse_cards(fetch(s, f"{base}?page={page}"))
            ids = tuple(c["id"] for c in batch)
            if not ids or ids in seen_pages:
                break
            seen_pages.add(ids)
            for c in batch:
                cards.setdefault(c["id"], c)
            time.sleep(_PAUSE)
    return list(cards.values())


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--type", choices=["residential", "commercial", "all"], default="all")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()
    s = session()
    dry = args.dry_run or bool(args.limit)
    run_id = None if dry else db.begin_run("wadod")
    res: list[dict] = []
    com: list[dict] = []
    skipped: dict[str, int] = {}
    try:
        cards = enumerate_cards(s)
        if not cards:
            raise RuntimeError("no property cards on either catalogue")
        print(f"{SOURCE}: {len(cards)} cards ({sum(AVAILABLE in c['badges'] for c in cards)} {AVAILABLE})", flush=True)
        todo = cards[:args.limit] if args.limit else cards
        for card in todo:
            if AVAILABLE not in card["badges"] or not card["href"]:
                why = "sold_or_rented" if (card["sold"] or "مؤجر" in card["badges"]) else "unavailable"
                skipped[why] = skipped.get(why, 0) + 1
                continue
            time.sleep(_PAUSE)
            row, cat, why = map_listing(card, parse_detail(fetch(s, card["href"])))
            if not row:
                skipped[why] = skipped.get(why, 0) + 1
                continue
            if args.type != "all" and cat != args.type:
                continue
            (com if cat == "commercial" else res).append(row)
        notes = ", ".join(f"{k}x{v}" for k, v in sorted(skipped.items(), key=lambda x: -x[1]))
        if skipped:
            print(f"  skipped (not guessed): {notes}")
        if dry:
            print(f"✓ {SOURCE} VALIDATION: {len(res)} residential + {len(com)} commercial (nothing written)")
            for r0 in res + com:
                print(f"   {r0['ad_number']:>6} {r0['transaction_type']:4} {r0['property_type']:9} d={str(r0['district_ar']):10} "
                      f"a={str(r0['area_m2']):>4} p={str(r0.get('price_total') or r0.get('price_annual')):>7} per={r0.get('rent_period')} "
                      f"b={r0['bedrooms']}/{r0['bathrooms']} h={r0['halls']} fl={r0['floor_number']} age={r0['property_age']} "
                      f"lic={r0['license_number']} el={r0.get('elevator')} fu={r0.get('furnished')} ph={len(r0['photo_urls'] or [])}")
            return 0
        # public upsert_wadod_*_batch wrappers are added centrally later; the shared batch writer is used directly.
        db._wasalt_batch(RES_TABLE, res)
        db._wasalt_batch(COM_TABLE, com)
        superseded = db.retire_superseded_siblings(res_table=RES_TABLE, com_table=COM_TABLE,
                                                   res_ads={r["ad_number"] for r in res},
                                                   com_ads={r["ad_number"] for r in com}, source=SOURCE)
        pruned = 0
        # Prune only after BOTH catalogues were walked to their empty page, with a positive control:
        # this run mapped at least one available listing (a served-but-empty shell never prunes).
        if args.type == "all" and (res or com):
            for tbl, rows in ((RES_TABLE, res), (COM_TABLE, com)):
                n = db.prune_unseen(tbl, {r["ad_number"] for r in rows}, source=SOURCE, verify_gone=verify_gone)
                pruned += max(n, 0)
        healthy = db.end_run(run_id, ok=True, rows_seen=len(cards), rows_upserted=len(res) + len(com),
                             check_tables=["wadod_residential_listings", "wadod_commercial_listings"],
                             notes=f"pruned={pruned} superseded={superseded} {notes}"[:300])
        print(f"✓ {SOURCE}: {len(res)} residential + {len(com)} commercial upserted")
        return 0 if healthy else 1
    except Exception as e:
        if run_id:
            db.end_run(run_id, ok=False, rows_seen=0, rows_upserted=0,
                       notes=(f"{e} | skips: " + ", ".join(f"{k}x{v}" for k, v in skipped.items()))[:300])
        print(f"✗ {SOURCE}: {e}", flush=True)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
