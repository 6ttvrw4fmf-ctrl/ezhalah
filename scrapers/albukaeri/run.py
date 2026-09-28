"""AlBukairi («البكيري العقارية», albukaeri.sa) — DIRECT SALE only. Onboarding 2026-09-27 (batch 7).

The company runs auctions (/auctions — a bid, not a listed price) and a direct-sale catalogue
(/properties, «البيع المباشر — 31 عقار متاح»). Only the direct-sale catalogue is read; the auction pages
are never requested, so no auction row can enter.

SOURCE SHAPE (measured live 2026-09-27)
=======================================
Server-rendered HTML (jQuery), no JSON API:
  list    https://albukaeri.sa/properties?page=N&limit=100   — «<strong>31</strong> نتيجة»
  page    https://albukaeri.sa/property/<24-hex id>
TRAP: neither the card nor the page prints the property TYPE. The only structured type is the list's own
«نوع العقار» filter (?propertyType=<id>): each option's result set is read and every id takes the type of
the option that lists it (31/31 covered, no id in two options). The page TITLE is marketing prose
(«أرض استثمارية» is typed أرض تجارية; «دوبلكس الأحساء» is typed شقة سكنية) and never sets a type.
Measured types: شقة سكنية 9 · أرض تجارية 4 · أرض تجارية سكنية 4 · فيلا سكنية 3 · أرض سكنية 3 · أرض فضاء 2 ·
أرض زراعية 1 · وحدة سكنية 1 · منتجع 1 · مبنى تجاري 1 · قصر تجاري سكني 1 · عمارة سكنية تجارية 1.
  mapped   أرض سكنية/أرض فضاء → Residential Land (the shared map's bare «أرض»), فيلا سكنية → Villa,
           شقة سكنية → Apartment, أرض تجارية سكنية → Commercial Land (owner 2026-09-27: mixed-use land is
           commercial), مبنى تجاري → Commercial Building and منتجع → Resort (the taxonomy's own labels).
  skipped  عمارة سكنية تجارية (mixed building: no exact taxonomy type — OWNER QUESTION), قصر تجاري سكني,
           وحدة سكنية (a "unit" — apartment? villa?).
PRICE: one page of 31 shows «السعر 850,000 ر.س» (a total); the other 30 publish none → NULL.
FACADE / STREET: the deed bounds «الـحـدود و الأطـوال» (شمالاً/شرقاً/جنوباً/غرباً). A plot with a street on
exactly ONE side faces that side, at that street's width; two or more streets (a corner) → NULL, raw kept.
PDPL: «رقم الصك» (deed number) is never stored. The page's WhatsApp number is never read. «رقم عقد
الوساطة» (a REGA brokerage-contract number, 62…) is kept in additional_info.
LICENCE: some pages carry a «بيانات رخصة الإعلان» block (lr-label/lr-value: «رخصة الإعلان 7201032695» and
«تاريخ النهاية» as a data-fmt-date attribute) — the REGA ad licence and its end date are stored.
"""
from __future__ import annotations

import argparse
from datetime import datetime
import html as ihtml
import json
import re
import sys
import time
from pathlib import Path
from typing import Any, Optional

from curl_cffi import requests as cc

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from scrapers.common import db, normalize  # noqa: E402
from scrapers.common.arabic_location import find_district_in_text, norm_district_tok, to_catalog  # noqa: E402
from scrapers.common.pii import redact_pii, strip_pii_fields  # noqa: E402

BASE = "https://albukaeri.sa"
SOURCE = "البكيري العقارية"
PREFIX = "BKR"
SLUG = "albukaeri"
IMPERSONATE = "chrome"

# map_type_exact's per-platform escape hatch — literal readings only (see docstring)
_TYPE_OVERRIDES = {
    "أرض سكنية": "Residential Land", "أرض فضاء": "Residential Land",
    "أرض تجارية سكنية": "Commercial Land",      # owner 2026-09-27: mixed-use land = Commercial Land
    "فيلا سكنية": "Villa", "شقة سكنية": "Apartment",
    "مبنى تجاري": "Commercial Building", "منتجع": "Resort",
}
_DWELLING = {"Apartment", "Villa"}
_NEVER_STORE = {"رقم الصك"}


def get(s: cc.Session, url: str) -> str:
    for attempt in range(3):
        try:
            r = s.get(url, impersonate=IMPERSONATE, timeout=40)
            r.raise_for_status()
            return r.text
        except Exception:  # noqa: BLE001
            if attempt == 2:
                raise
            time.sleep(2 + attempt * 3)
    return ""


def list_ids(s: cc.Session, query: str = "") -> tuple[list[str], Optional[int]]:
    ids: list[str] = []
    declared = None
    for p in range(1, 50):
        page = get(s, f"{BASE}/properties?{query}page={p}&limit=100")
        m = re.search(r"<strong>(\d+)</strong>\s*نتيجة", page)
        declared = declared if declared is not None else (int(m.group(1)) if m else None)
        new = [i for i in dict.fromkeys(re.findall(r'href="/property/([0-9a-f]{24})"', page)) if i not in ids]
        if not new:
            break
        ids += new
    return ids, declared


def type_by_id(s: cc.Session) -> dict[str, str]:
    """Every id → the «نوع العقار» filter option whose results list it (the site's only structured type)."""
    sel = re.search(r'<select class="input" name="propertyType">(.*?)</select>', get(s, f"{BASE}/properties"), re.S)
    out: dict[str, str] = {}
    for val, name in re.findall(r'value="([0-9a-f]{24})">([^<]+)</option>', sel.group(1) if sel else ""):
        for i in list_ids(s, f"propertyType={val}&")[0]:
            # an id listed under two types has no single type — kept out, never first-wins
            out[i] = "" if i in out else ihtml.unescape(name).strip()
        time.sleep(0.3)
    return out


def _clean(s: str) -> str:
    return re.sub(r"\s+", " ", ihtml.unescape(re.sub(r"<[^>]+>", " ", s or ""))).strip()


def _pairs(page: str, label_cls: str, value_cls: str) -> dict[str, str]:
    return {_clean(k): _clean(v) for k, v in re.findall(
        rf'<span class="{label_cls}">(.*?)</span>\s*<span class="{value_cls}">(.*?)</span>', page, re.S)}


def parse_page(pid: str, page: str) -> dict[str, Any]:
    page = page[:page.find("عقارات مشابهة")] if "عقارات مشابهة" in page else page   # never the similar-ads rail
    loc = re.search(r'<div class="prop-hero-location">(.*?)</div>', page, re.S)
    gal = re.search(r"<!-- #gallery -->(.*?)<!-- ##gallery -->", page, re.S)
    og = re.search(r'og:image" content="([^"]+)"', page)
    video = re.search(r'class="prop-hero-video-link"[^>]*href="([^"]+)"', page)
    return {
        "id": pid,
        "title": _clean((re.search(r'<h1 class="prop-hero-title">(.*?)</h1>', page, re.S) or [None, ""])[1]),
        "street_line": _clean((re.search(r'<p class="prop-hero-street">(.*?)</p>', page, re.S) or [None, ""])[1]),
        "location": [x.strip() for x in _clean(loc.group(1)).split("·")] if loc else [],
        "description": _clean((re.search(r'<div class="prop-description-body">(.*?)</div>', page, re.S) or [None, ""])[1]),
        "stats": _pairs(page, "hero-stat-label", "hero-stat-value"),
        "side": _pairs(page, "sil-label", "sil-value"),
        "features": {_clean(k): _clean(n) for n, k in re.findall(
            r'<span class="ft-num">(.*?)</span><span class="ft-lbl">(.*?)</span>', page, re.S)},
        "bounds": [(_clean(k), _clean(v)) for k, v in re.findall(
            r'<span class="bli-tag">(.*?)</span><span class="bli-text">(.*?)</span>', page, re.S)],
        "photos": list(dict.fromkeys(BASE + u if u.startswith("/") else u for u in re.findall(
            r'<img[^>]*?\ssrc="([^"]*/uploads/[^"]+)"', gal.group(1)))) if gal else [],
        # the listing's own share image (its card photo) — only when the page has no gallery
        "og_image": og.group(1) if og and "/uploads/" in og.group(1) else None,
        "video": video.group(1) if video else None,
        "licence": _pairs(page, "lr-label", "lr-value"),
        "licence_end": (re.search(r'lr-label">تاريخ النهاية</span><span class="lr-value" data-fmt-date="\w{3} (\w{3} \d{1,2} \d{4})',
                                  page) or [None, None])[1],
    }


def _district(raw: Optional[str], city_id: Optional[int]) -> Optional[str]:
    raw = re.sub(r"^حي\s+", "", raw or "").strip()
    if not (raw and city_id):
        return None
    hit = find_district_in_text("حي " + raw, city_id)
    # the WHOLE name only: «العزيزية - العقيق» must not become «حي العقيق» by one of its words
    return hit if hit and norm_district_tok(hit) == norm_district_tok(raw) else None


def _facade(bounds: list[tuple[str, str]]) -> tuple[Optional[int], Optional[str]]:
    """(street_width_m, direction) when exactly ONE side of the deed bounds is a street."""
    streets = [(side, m.group(1)) for side, text in bounds
               for m in [re.search(r"شارع\s*عرض\s*([\d٠-٩.]+)", text)] if m]
    if len(streets) != 1:
        return None, None
    return normalize.one_street_width(streets[0][1]), normalize.one_direction(streets[0][0])


def _count(raw: Optional[str]) -> Optional[int]:
    n = normalize.to_int(raw) if raw else None
    return n if n and n > 0 else None


def map_page(d: dict[str, Any], type_ar: Optional[str]) -> tuple[Optional[tuple[dict, str]], str]:
    title, desc = d["title"], d["description"]
    if re.search(r"مباع|محجوز|تم البيع|مزاد", title):
        return None, "not_available_or_auction"
    ptype = normalize.map_type_exact(type_ar, overrides=_TYPE_OVERRIDES)
    if not ptype:
        return None, f"type_unmapped_{type_ar or 'none'}"
    category = normalize.category_for_type(ptype).lower()

    price_raw = d["stats"].get("السعر")
    price = normalize.to_int(price_raw) if price_raw else None
    loc = d["location"]
    city_ar = loc[0] if loc else None
    city_en = normalize.map_city(city_ar) if city_ar else None
    # the shared city→region map is the sanctioned twin hint: «الهفوف» is two catalog towns (Eastern, Riyadh)
    city_id, region_id = to_catalog(city_ar, region_hint=normalize.region_for_city(city_en)) if city_ar else (None, None)
    district_raw = re.sub(r"^حي\s+", "", loc[1]).strip() if len(loc) > 1 else None
    area = re.search(r"\d+(?:\.\d+)?", (d["stats"].get("المساحة") or d["side"].get("المساحة") or "").replace(",", ""))
    width, direction = _facade(d["bounds"])
    feats, stats, side = d["features"], d["stats"], d["side"]
    plan = [f"{word} {side[k].strip()}" for k, word in (("رقم المخطط", "مخطط"), ("رقم القطعة", "قطعة"), ("رقم البلك", "بلك"))
            if side.get(k, "").strip() not in ("", "لا يوجد", "بدون")]
    row: dict[str, Any] = {
        "ad_number": f"{PREFIX}{d['id']}",
        "listing_url": f"{BASE}/property/{d['id']}",
        "source": SOURCE,
        "active": True,
        "title": redact_pii(title) or None,
        "description": redact_pii(desc[:4000]) or None,
        "property_type": ptype,
        "transaction_type": "Buy",
        "price_total": price,
        "city": city_en,
        "city_ar": city_ar,
        "city_id": city_id,
        "region_id": region_id,
        "district_ar": _district(district_raw, city_id),
        "neighborhood": district_raw or None,
        "area_m2": float(area.group(0)) if area and float(area.group(0)) > 0 else None,
        "street_width_m": width,
        "direction": direction,
        "plan_parcel": " · ".join(plan) or None,
        "photo_urls": list(d["photos"]) or ([d["og_image"]] if d.get("og_image") else []),
        "video_url": d.get("video"),
    }
    lic = ((d.get("licence") or {}).get("رخصة الإعلان") or "").strip()
    if re.fullmatch(r"7\d{9}", lic):   # a REGA AD licence only
        row["license_number"] = lic
        if d.get("licence_end"):
            row["license_expiry"] = datetime.strptime(d["licence_end"], "%b %d %Y").date().isoformat()
    if ptype in _DWELLING:   # «الغرف» counts bedrooms only in a dwelling
        row["bedrooms"] = _count(stats.get("الغرف"))
        row["bathrooms"] = _count(stats.get("دورات المياه"))
        row["halls"] = _count(feats.get("صالة"))
        row["reception_rooms_majlis"] = _count(feats.get("مجلس"))
        if _count(feats.get("مطبخ")):
            row["kitchen"] = True
    if _count(stats.get("مواقف")) or _count(feats.get("كراج")):
        row["parking"] = True
    row["price_evidence"] = normalize.price_evidence(
        field="hero-stat السعر" if price_raw else "(none — the page shows no price)", raw=price_raw,
        stored=price, kind="total", unit="total", origin="structured", authoritative_absent=price_raw is None)
    info = {
        "source_type_ar": type_ar,
        "street_line": d["street_line"],                 # the site's reference code (BK-018) or a street label
        "location_extra": " · ".join(loc[2:]) or None,   # e.g. the plan name «مخطط النخبة»
        "floors": _count(stats.get("عدد الأدوار")),
        "features": feats or None,
        "bounds": dict(d["bounds"]) if any(v for _, v in d["bounds"]) else None,
        "rega_mediation_contract_number": side.get("رقم عقد الوساطة"),
    }
    row["additional_info"] = strip_pii_fields({k: v for k, v in info.items() if v not in (None, "", [], {})})
    row["source_capture"] = strip_pii_fields({
        "schema": "albukaeri.page.v1", "type_ar": type_ar, "title": title, "location": loc,
        "stats": stats, "side": {k: v for k, v in side.items() if k not in _NEVER_STORE}, "features": feats})
    return (row, category), ""


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--type", default="all")
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()
    dry = a.dry_run

    s = cc.Session()
    ids, declared = list_ids(s)
    types = type_by_id(s)
    print(f"{SOURCE}: {len(ids)} listing(s) (site declares {declared}); {len(types)} typed by the site's filter",
          flush=True)

    run_id = None if dry else db.begin_run(SLUG)
    res: list[dict] = []
    com: list[dict] = []
    skipped: dict[str, int] = {}
    unreadable = 0
    try:
        for pid in ids:
            try:
                d = parse_page(pid, get(s, f"{BASE}/property/{pid}"))
            except Exception:  # noqa: BLE001
                unreadable += 1
                continue
            got, why = map_page(d, types.get(pid))
            time.sleep(0.3)
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
                      ("ad_number", "property_type", "price_total", "area_m2", "city_id", "district_ar",
                       "direction", "street_width_m", "bedrooms", "plan_parcel")}, ensure_ascii=False)[:260])
            return 0

        db.upsert_albukaeri_residential_batch(res)
        db.upsert_albukaeri_commercial_batch(com)
        superseded = db.retire_superseded_siblings(
            res_table="albukaeri_residential_listings", com_table="albukaeri_commercial_listings",
            res_ads={r["ad_number"] for r in res}, com_ads={r["ad_number"] for r in com}, source=SOURCE)
        if superseded:
            print(f"  retired {superseded} superseded sibling row(s) after a category flip", flush=True)
        complete = unreadable == 0 and declared is not None and len(ids) >= declared > 0
        for tbl, rr in (("albukaeri_residential_listings", res), ("albukaeri_commercial_listings", com)):
            if rr and complete:
                n = db.prune_unseen(tbl, {r["ad_number"] for r in rr}, source=SOURCE)
                if n < 0:
                    print(f"  ⚠ {tbl}: prune guard tripped — kept existing active rows", flush=True)
                elif n:
                    print(f"  pruned {n} from {tbl}", flush=True)
        if not complete:
            print(f"  NOT pruning: walked {len(ids)} of a declared {declared}, {unreadable} unreadable", flush=True)
        healthy = db.end_run(run_id, ok=True, rows_seen=len(ids), rows_upserted=len(res) + len(com),
                             check_tables=["albukaeri_residential_listings", "albukaeri_commercial_listings"])
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
