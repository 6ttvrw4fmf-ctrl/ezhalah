"""STeam Residence / ستيم العربية (steam-realestate.com) — the STAGED ingest (owner order 2026-11-05). Rows are stored
in tables no search arm reads; NOTHING reaches a customer until the owner launches it (docs/ops/FIVE_SOURCES_LAUNCH.md).

SOURCE SHAPE (measured live 2026-11-05; robots.txt disallows /wp-json/, /?s=, /search/ — never fetched)
=====================================================================================================
A WordPress «Houzez» site. Its own complete list is the Yoast sitemap https://steam-realestate.com/property-sitemap.xml
(22 /property/<slug>/ pages on 2026-11-05). Each page is server-rendered:
  h1                      the title; a.label-status = the side («للايجار» / «للبيع»), the only side word.
  li.item-price           the theme's price field — EMPTY on all 10 ads on 2026-11-05 (and on the archive cards). 3 ads
                          write a figure only inside their description («السعر 65.000», «السعر / 100.000»): that is PROSE
                          and is never read as a price (owner invariant 2026-08-04: no price from prose) — so every ad is
                          stored price-on-request, the figure kept in the stored description for the owner to rule on.
                          Should the field ever carry a price, it is PRICE = SOURCE, period from a stated «شهري / سنوي»
                          next to it, else silent (judged at launch, flagged judged).
  #property-detail-wrap   «المساحة», «غرف النوم» / «غرفة نوم», «الحمامات» / «حمام», «كراج», «عمر المبنى», «نوع»
                          («شقة, سكني»), «حالة الملكية», «تحديث في …». Every ad printed a bathroom field on 2026-11-05;
                          an ad without one falls back to its text («2دورة مياه», normalize.baths_from_leading_count).
  #property-address-wrap  «مدينة», «المحافظة», «المنطقة» (= the district, «حي لبن»), «بلد».
  #property-features-wrap the feature list (WiFi, تكييف, ثلاجة, غسالة …).
  #property-description-wrap article = the FULL description (phones redacted).
  NO PIN (no map, no coordinates) and NO REGA licence on any page.
PDPL: every page prints the company phones and sales mobiles inside the description — redacted by the shared redactor
and the tables' zz_redact_pii trigger. No agent block exists on these pages; none is read.

LIVENESS («own full list = the check»): COMPLETE = every sitemap URL answered 200 with a parseable property block.

    python -m scrapers.steam.run --dry-run
    python -m scrapers.steam.run
"""
from __future__ import annotations

import argparse
import html as _html
import json
import re
import sys
from collections import Counter
from pathlib import Path
from typing import Any, Optional
from urllib.parse import unquote

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from scrapers.common import db, honest_fetch as H, normalize as N  # noqa: E402
from scrapers.common.arabic_location import catalog_district, resolve  # noqa: E402
from scrapers.facts.one_reader import amenity_answers  # noqa: E402
from scrapers.common.pii import redact_pii  # noqa: E402
from scrapers.common.posting_date import site_posting_date  # noqa: E402

PROSE_COLS = ("kitchen", "parking", "elevator", "maid_room", "driver_room", "air_conditioner", "private_entrance", "furnished", "balcony_terrace", "laundry_room")
SOURCE = "STeam Residence"
SLUG = "steam"
PREFIX = "STM"
RES_TABLE = "steam_residential_listings"
COM_TABLE = "steam_commercial_listings"
SITE = "https://steam-realestate.com"
SITEMAP = SITE + "/property-sitemap.xml"
_H1_RE = re.compile(r"<h1>\s*(.*?)\s*</h1>", re.S)
_STATUS_RE = re.compile(r'class="label-status label[^"]*">\s*([^<]+?)\s*</a>')
_PRICE_RE = re.compile(r'<li class="item-price[^"]*">(.*?)</li>', re.S)
_SECTION_RE = r'id="{}"[^>]*>(.*?)(?=<div class="property-[a-z-]+-wrap property-section-wrap"|$)'
_PAIR_RE = re.compile(r"<strong[^>]*>\s*(.*?)\s*</strong>\s*<span[^>]*>\s*(.*?)\s*</span>", re.S)
_DESC_RE = re.compile(r'<article data-testid="dynamic-sanitize-html">(.*?)</article>', re.S)
_DESC_FALLBACK_RE = re.compile(r'<div class="description-content">(.*?)</div>\s*</div>\s*</div>', re.S)
_FEATURE_RE = re.compile(r'<a href="https://steam-realestate\.com/feature/[^"]*">\s*([^<]+?)\s*</a>')
_POSTID_RE = re.compile(r"\bpostid-(\d+)\b")     # the WordPress post id on <body class>: the ad's stable id
_UPDATED_RE = re.compile(r"تحديث في\s*([^<]+?)\s*<")
# THE SITE'S OWN POSTING DATE: the Yoast graph's WebPage `datePublished` (the WordPress post date, UTC). Measured
# 2026-11-09: 17546 «2026-07-16T21:02:59+00:00», 17878 «2026-08-01T13:45:42+00:00» — one per page, per post. The
# page's visible «تحديث في …» is `dateModified` (an edit: 17878 «أغسطس 19, 2026 في 10:35 ص» == 10:35:32+00:00).
_YOAST_RE = re.compile(r'<script[^>]*class="yoast-schema-graph"[^>]*>(.*?)</script>', re.S)
_PUBLISHED_RE = re.compile(r'"@type":"WebPage".*?"datePublished":"([^"]+)"', re.S)
_DEAL = {"للايجار": "Rent", "للإيجار": "Rent", "للبيع": "Buy"}
_FEATURE_COL = {"تكييف": "air_conditioner", "مصعد": "elevator", "موقف": "parking", "مطبخ": "kitchen"}


def _allowed(url: str) -> bool:
    return url == SITEMAP or (url.startswith(SITE + "/property/") and "?" not in url)


def _text(fragment: str) -> str:
    return re.sub(r"\s+", " ", _html.unescape(re.sub(r"<[^>]+>", " ", fragment or ""))).strip()


def _section(page: str, sid: str) -> str:
    m = re.search(_SECTION_RE.format(sid), page, re.S)
    return m.group(1) if m else ""


def parse_property(page: str) -> Optional[dict]:
    h1 = _H1_RE.search(page)
    if not h1 or 'id="property-detail-wrap"' not in page:
        return None
    pairs = lambda sid: {_text(k).rstrip(":"): _text(v) for k, v in _PAIR_RE.findall(_section(page, sid))}  # noqa: E731
    desc = _DESC_RE.search(page) or _DESC_FALLBACK_RE.search(page)
    top = page[page.find("property-top-wrap"):page.find("property-overview-data")]
    images = list(dict.fromkeys(re.findall(r'data-src="(https://steam-realestate\.com/wp-content/uploads/[^"]+)"', top)))
    sl = _POSTID_RE.search(page)
    upd = _UPDATED_RE.search(page)
    graph = _YOAST_RE.search(page)
    pub = _PUBLISHED_RE.search(graph.group(1)) if graph else None
    return {"published": pub.group(1) if pub else None, "title": _text(h1.group(1)), "status": _text((_STATUS_RE.search(page) or [None, ""])[1])
            if _STATUS_RE.search(page) else "", "price_raw": _text(_PRICE_RE.search(page).group(1)) if _PRICE_RE.search(page) else "",
            "details": pairs("property-detail-wrap"), "address": pairs("property-address-wrap"),
            "features": _FEATURE_RE.findall(_section(page, "property-features-wrap")),
            "description": N.html_block_lines(desc.group(1)) if desc else "",
            "post_id": sl.group(1) if sl else None, "updated": upd.group(1) if upd else None, "images": images}


def map_property(slug: str, url: str, p: dict) -> tuple[Optional[tuple[dict, str]], str]:
    deal = _DEAL.get(p["status"]) or _DEAL.get(p["details"].get("حالة الملكية", ""))
    if not deal:
        return None, f"status_{p['status'] or 'none'}"
    kind = p["details"].get("نوع", "")
    ptype = N.map_type(kind.split(",")[0].strip()) or N.map_type(p["title"])
    if not ptype:
        return None, f"type_unmapped_{kind}"
    addr = p["address"]
    city = (addr.get("مدينة") or "").strip() or None
    district = (addr.get("المنطقة") or "").strip() or None
    r = resolve(city, district) if city else {}
    cid = r.get("city_id")
    title = redact_pii(p["title"]) or None
    desc = redact_pii(p["description"], keep_lines=True) or None
    price = N.to_int(p["price_raw"]) if re.search(r"\d", p["price_raw"]) else None
    d = p["details"]   # the theme prints plural OR singular labels («الحمامات» / «حمام», «غرف النوم» / «غرفة نوم»)
    baths = N.to_int(d.get("الحمامات") or d.get("حمام")) or N.baths_from_leading_count(desc)
    feats = {col: True for word, col in _FEATURE_COL.items() if any(word in f for f in p["features"])}
    if N.to_int(d.get("كراج")):
        feats["parking"] = True
    # ONE READER (owner 2026-11-03): prose amenities come from the Advanced Filter's word reader, never normalize.prose_amenities.
    prose = {c: v for c, v in amenity_answers(f"{title or ''}\n{desc or ''}", PROSE_COLS, {"balcony": "balcony_terrace"}).items() if c not in feats}
    row: dict[str, Any] = {
        "ad_number": f"{PREFIX}{p['post_id'] or slug}", "listing_url": url, "source": SOURCE, "active": True,
        "title": title, "description": desc, "property_type": ptype, "transaction_type": "Rent" if deal == "Rent" else "Buy",
        "city": N.map_city(r.get("city_ar") or city) if city else None, "city_ar": r.get("city_ar") or city,
        "city_id": cid, "region_id": r.get("region_id"), "neighborhood": district,
        "district_ar": catalog_district(cid, district) if (cid and district) else None,
        "area_m2": N.to_int(re.sub(r"م\s*مربع|م²|م2", "", p["details"].get("المساحة", "")).split("إلى")[0]),
        "bedrooms": N.to_int(d.get("غرف النوم") or d.get("غرفة نوم")), "bathrooms": baths,
        "property_age": N.to_int(d.get("عمر المبنى")),
        "photo_urls": p["images"] or None, "last_update": p["updated"], **prose, **feats,
        "date_added": site_posting_date(p.get("published")),   # Yoast WebPage datePublished — never «تحديث في»
    }
    if deal == "Buy":
        row["price_total"] = price if price else db.AUTHORITATIVE_NULL
        stored, kind_ = price, "total"
    elif price:
        period = N.stated_rent_period(price, f"{p['price_raw']}\n{desc or ''}")
        row["rent_period"], row["price_annual"] = N.rent_period_and_annual(
            price, {"monthly": "شهري", "annual": "سنوي"}.get(period or ""))
        stored, kind_ = row["price_annual"], period or "annual"
    else:
        row["price_annual"], stored, kind_ = db.AUTHORITATIVE_NULL, None, "annual"
    row["price_evidence"] = N.price_evidence(field="li.item-price", raw=p["price_raw"] or None, stored=stored,
                                             kind=kind_, unit="total", origin="structured", authoritative_absent=not price)
    info = {"source_id": p["post_id"], "slug": unquote(slug), "status_label": p["status"], "type_label": kind or None,
            "details": p["details"] or None, "address": p["address"] or None, "features": p["features"] or None,
            "price_label": p["price_raw"] or None, "pin_source": "none (no map or coordinates on the page)"}
    row["additional_info"] = {k: v for k, v in info.items() if v not in (None, "", [], {})}
    row["source_capture"] = {"schema": "steam.property.v1",
                             "item": {k: v for k, v in p.items() if k not in ("description", "images")}}
    cat = "commercial" if "تجاري" in kind and "سكني" not in kind else (
        "residential" if N.category_for_type(ptype) == "Residential" or ptype == "Duplex" else "commercial")
    return (row, cat), ""


def walk(log=print) -> dict:
    sm = H.get_text(SITEMAP, allowed=_allowed)
    urls = [u for u in dict.fromkeys(_html.unescape(x) for x in re.findall(r"<loc>\s*([^<]+?)\s*</loc>", sm))
            if _allowed(u) and u.rstrip("/") != SITE + "/property"]
    props, bad = {}, Counter()
    for u in urls:
        try:
            p = parse_property(H.get_text(u, allowed=_allowed))
        except H.Blocked as e:
            if " 404 " in str(e) or " 410 " in str(e):
                bad["gone_404"] += 1
                continue
            raise
        if p is None:
            bad["no_property_block"] += 1
            continue
        props[u.rstrip("/").rsplit("/", 1)[1]] = (u, p)
    log(f"  {len(props)} of {len(urls)} property pages parsed")
    return {"listed": len(urls), "props": props, "bad": bad}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--save", default="")
    a = ap.parse_args()
    run_id = None if a.dry_run else db.begin_run(SLUG)
    w: dict = {"props": {}}
    try:
        w = walk()
        res, com, skipped = [], [], Counter()
        for slug, (url, p) in w["props"].items():
            got, why = map_property(slug, url, p)
            if not got:
                skipped[why] += 1
                continue
            (res if got[1] == "residential" else com).append(got[0])
        ok = not w["bad"] and len(w["props"]) == w["listed"] > 0
        cover = {"sitemap": w["listed"], "parsed": len(w["props"]), "bad": dict(w["bad"]), "complete": ok}
        print(f"  coverage: {json.dumps(cover)}\n  mapped: {len(res)} residential + {len(com)} commercial "
              f"({Counter(r['transaction_type'] for r in res + com)}); skipped (not guessed): {dict(skipped)}", flush=True)
        if a.save:
            Path(a.save).write_text(json.dumps(res + com, ensure_ascii=False, default=str))
        if a.dry_run:
            return 0
        db.upsert_steam_residential_batch(res)
        db.upsert_steam_commercial_batch(com)
        notes = [f"coverage {json.dumps(cover)}"]
        sup = db.retire_superseded_siblings(res_table=RES_TABLE, com_table=COM_TABLE, res_ads={r["ad_number"] for r in res},
                                            com_ads={r["ad_number"] for r in com}, source=SOURCE)
        if sup:
            notes.append(f"superseded={sup}")
        for tbl, rows in ((RES_TABLE, res), (COM_TABLE, com)):
            if rows and ok:
                notes.append(f"{tbl} pruned={db.prune_unseen(tbl, {r['ad_number'] for r in rows}, source=SOURCE, verify_gone=_gone)}")
        healthy = db.end_run(run_id, ok=True, rows_seen=len(w["props"]), rows_upserted=len(res) + len(com),
                             notes="; ".join(notes)[:900], check_tables=["steam_residential_listings", "steam_commercial_listings"])
        if not healthy:
            print("✗ run demoted to unhealthy by end_run()", flush=True)
            return 1
        print(f"✓ {SOURCE}: {len(res)} residential + {len(com)} commercial upserted", flush=True)
        return 0
    except Exception as e:  # noqa: BLE001
        if run_id:
            db.end_run(run_id, ok=False, rows_seen=len(w["props"]), rows_upserted=0, notes=f"{type(e).__name__}: {e}"[:300])
        raise


def _gone(ad_number: str) -> tuple[str, str]:
    """prune_unseen's answer at grace. Absence from a list is a CANDIDATE, never a kill (LISTING_LIVENESS.md §2:
    only a DIRECT reading of the ad's own page may deactivate). Until this site has a measured own-page oracle the
    strike is held: UNKNOWN. ♻️ 2026-11-06 — it used to return «gone» here, an absence-only kill."""
    return "unknown", "absent from 3 consecutive COMPLETE walks of the site's own property sitemap; no own-page oracle yet — held (absence never kills)"


if __name__ == "__main__":
    raise SystemExit(main())
