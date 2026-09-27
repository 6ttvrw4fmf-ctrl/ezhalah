"""Arsh («شركة عرش العقارية», arshglobal.com.sa) — land offers. Onboarding 2026-09-27 (wave 3, batch 6).

Owner 2026-09-27: include Arsh, as land listings with «السعر عند الطلب» — the site publishes no price.

SOURCE SHAPE (measured live 2026-09-27)
=======================================
A hand-built Duda site — no API, no JSON feed:
  index   https://www.arshglobal.com.sa/عقارات-عرش   — the site's own list of its properties (23 links
          once the RSS feeds and one empty page, «futindustrial», are dropped)
  page    https://www.arshglobal.com.sa/<slug>
16 pages are land BLOCKS in one fixed header shape — «أراضي سكنية حي الصدفة ( المهندسين ) مخطط رقم
ش د 985 بلك رقم 23» — with a Google-Maps embed carrying real coordinates (!2d<lng>!3d<lat>). The rest are
project / parcel pages (أرض الروابي التجارية, أرض الجوهرة, جدة لاند, مخطط ملفى اللؤلؤ …).

PRICE: none anywhere (0 × ريال/ر.س/SAR). Stored NULL — the card shows «السعر عند الطلب».
PHOTOS: none of the plot. og:image (where present) is the project LOGO; the page images are stock
pictures, maps and plans → photo_urls [] (empty) (measured 2026-09-27 on the first production crawl).
AREA: block pages show plot sizes only as a screenshot image → NULL. Figures in the prose are the whole
PLAN's area («2,000,000م2», «881,600 متر مربع»), not the listing's — never stored as area_m2.
DEAL: 19 of 23 pages state none — owner 2026-09-27: treat Arsh's land as for sale (DEAL_WHEN_UNSTATED).
"""
from __future__ import annotations

import argparse
import html as ihtml
import json
import re
import sys
import time
import urllib.parse
from pathlib import Path
from typing import Any, Optional

from curl_cffi import requests as cc

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from scrapers.common import db, normalize  # noqa: E402
from scrapers.common.arabic_location import find_district_in_text, stated_city, to_catalog  # noqa: E402
from scrapers.common.pii import redact_pii  # noqa: E402

BASE = "https://www.arshglobal.com.sa/"
INDEX = "عقارات-عرش"
SOURCE = "عرش العقارية"
PREFIX = "ARS"
SLUG = "arsh"
IMPERSONATE = "chrome"

# 19 of 23 pages never say sale or rent (4 say بيع). OWNER DECISION 2026-09-27: «yes treat arsh as for
# sale» — land a broker offers in a subdivision is for sale. A page that says إيجار/تأجير is never forced.
DEAL_WHEN_UNSTATED: Optional[str] = "Buy"

_NAV = {"عقارات-عرش", "أخبار-عرش", ""}
_CITIES = ("الخبر", "الدمام", "الظهران", "جدة")
_HEADER_RE = re.compile(r"(أراضي سكنية|أرض سكنية|سكنية استثمارية|أرض تجارية|تجارية استثمارية)")


def get(s: cc.Session, slug: str) -> str:
    for attempt in range(3):
        try:
            r = s.get(BASE + urllib.parse.quote(slug), impersonate=IMPERSONATE, timeout=40)
            r.raise_for_status()
            return r.text
        except Exception:  # noqa: BLE001
            if attempt == 2:
                raise
            time.sleep(2 + attempt * 3)
    return ""


def list_slugs(s: cc.Session) -> list[str]:
    out: list[str] = []
    for h in re.findall(r'href="(?:https://www\.arshglobal\.com\.sa)?/([^"#?]+)"', get(s, INDEX)):
        h = urllib.parse.unquote(h).strip("/")
        if h in _NAV or h in out or h.startswith(("feed", "http")) or "." in h:
            continue
        out.append(h)
    return out


def visible_text(page: str) -> str:
    body = page[page.find("<body"):]
    text = re.sub(r"<script.*?</script>|<style.*?</style>|<[^>]+>", " ", body, flags=re.S)
    return re.sub(r"\s+", " ", ihtml.unescape(text)).strip()


def parse_page(slug: str, page: str) -> dict[str, Any]:
    text = visible_text(page)
    # the Duda header prints the site menu TWICE (mobile + desktop); the listing's own content starts
    # after the LAST «أخبار عرش» of that menu block
    cut = text[:700].rfind("أخبار عرش")
    content = re.sub(r"^\s*Share by:?\s*", "", text[cut + len("أخبار عرش"):] if cut >= 0 else text).strip()
    geo = re.search(r"!2d(-?\d+\.\d+)!3d(-?\d+\.\d+)", page)
    return {"slug": slug, "content": content,
            "lng": geo.group(1) if geo else None, "lat": geo.group(2) if geo else None}


def map_page(d: dict[str, Any]) -> tuple[Optional[tuple[dict, str]], str]:
    content, slug = d["content"], d["slug"]
    if len(content) < 40:
        return None, "empty_page"
    # the listing's own HEADER line — type, district, plan, block — ends where the prose begins
    head = re.split(r"نبذة عن المخطط|نبذة عن", content, maxsplit=1)[0][:220].strip()
    kind = _HEADER_RE.search(head)
    if kind:
        ptype = "Commercial Land" if "تجارية" in kind.group(1) and "سكنية" not in kind.group(1) else "Residential Land"
    else:
        ptype = "Commercial Land" if re.search(r"التجارية|تجارية", head[:80]) else "Residential Land"
    if not kind and not re.search(r"أرض|أراضي|مخطط|لاند", head + slug):
        return None, "not_a_land_listing"

    # only an explicit deal PHRASE counts: «عمليات البيع والتأجير» (جدة لاند — what a buyer may later do
    # with his plot) and «فريق المبيعات» (the sales team) describe no deal of THIS listing
    says_sale = bool(re.search(r"للبيع", content))
    says_rent = bool(re.search(r"للإيجار|للايجار|للتأجير", content))
    if says_sale and says_rent:
        return None, "deal_ambiguous_sale_and_lease"
    deal = "Buy" if says_sale else ("Rent" if says_rent else DEAL_WHEN_UNSTATED)
    if deal not in ("Buy", "Rent"):
        return None, "deal_unstated"

    city_ar = (stated_city(content[:600]) or (None,))[0] \
        or next((c for c in _CITIES if slug.startswith(c) or f"-{c}-" in f"-{slug}-"), None) \
        or next((c for c in _CITIES if c in content[:600]), None)
    city_id, region_id = to_catalog(city_ar) if city_ar else (None, None)
    # the header's own district: «حي X ( plan )», «مدينة Y ( حي X )», or «حي CITY ( X )» — try each named
    # token against the catalog of THIS city; one the catalog lacks («العزيزية» in الخبر) stays NULL
    tokens = [m.strip() for m in re.findall(r"حي ([^()]+?)\s*(?=\(|\)|مخطط)", head)]
    tokens += [m.strip() for m in re.findall(r"\(\s*(?:حي )?([^()]+?)\s*\)", head)]
    district_ar = next((x for x in (find_district_in_text("حي " + tok, city_id) for tok in tokens) if x), None) \
        if city_id else None
    district_raw = tokens[0] if tokens else None
    plan = re.search(r"مخطط(?: [^\d]{0,25})? رقم ([^\s]+(?: [^\s]+){0,3}?)(?= بلك| نبذة| جوار|$)", head)
    block = re.search(r"بلك رقم (\d+)", head)
    title = re.sub(r"\s+", " ", head.split("نبذة عن المخطط")[0])[:160].strip()
    row: dict[str, Any] = {
        "ad_number": f"{PREFIX}{slug}",
        "listing_url": BASE + urllib.parse.quote(slug),
        "source": SOURCE,
        "active": True,
        "title": redact_pii(title) or None,
        "description": redact_pii(content[:4000]) or None,
        "property_type": ptype,
        "transaction_type": "Rent" if deal == "Rent" else "Buy",   # deal is validated above
        "price_total": None,
        "city": normalize.map_city(city_ar) if city_ar else None,
        "city_ar": city_ar,
        "city_id": city_id,
        "region_id": region_id,
        "district_ar": district_ar,
        "neighborhood": district_raw,
        "plan_parcel": " / ".join(x for x in ((plan.group(1).strip() if plan else None),
                                               (f"بلك {block.group(1)}" if block else None)) if x) or None,
        # no photo of the plot exists: og:image is the project LOGO («malfa allulu logo»), the rest are
        # stock pictures (shutterstock_…), maps and plans — none may stand in as the listing's photo
        "photo_urls": [],   # [] not None: db.py drops a None, which would freeze a stale logo in place
    }
    row["price_evidence"] = normalize.price_evidence(
        field="(none — the site publishes no price)", raw=None, stored=None, kind="total", unit="total",
        origin="structured", authoritative_absent=True)
    row["additional_info"] = {k: v for k, v in {"slug": slug, "block_number": block.group(1) if block else None,
                                                  "latitude": d.get("lat"), "longitude": d.get("lng")}.items() if v}
    row["source_capture"] = {"schema": "arsh.duda.page.v1", "header": head}
    return (row, normalize.category_for_type(ptype).lower()), ""


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--type", default="all")
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()
    dry = a.dry_run

    s = cc.Session()
    slugs = list_slugs(s)
    print(f"{SOURCE}: {len(slugs)} page(s) on its own index", flush=True)

    run_id = None if dry else db.begin_run(SLUG)
    res: list[dict] = []
    com: list[dict] = []
    skipped: dict[str, int] = {}
    unreadable = 0
    try:
        for slug in slugs:
            try:
                d = parse_page(slug, get(s, slug))
            except Exception:  # noqa: BLE001
                unreadable += 1
                continue
            got, why = map_page(d)
            if not got:
                skipped[why] = skipped.get(why, 0) + 1
                continue
            row, cat = got
            (com if cat == "commercial" else res).append(row)
            time.sleep(0.3)
        if skipped:
            print("  skipped (not guessed): "
                  + ", ".join(f"{k}x{v}" for k, v in sorted(skipped.items())), flush=True)
        if dry:
            print(f"DRY: {len(res)} residential + {len(com)} commercial ({unreadable} unreadable)")
            for row in res + com:
                print("   ", json.dumps({k: row.get(k) for k in ("ad_number", "property_type", "transaction_type",
                      "city_ar", "district_ar", "plan_parcel")}, ensure_ascii=False)[:220])
            return 0

        db.upsert_arsh_residential_batch(res)
        db.upsert_arsh_commercial_batch(com)
        superseded = db.retire_superseded_siblings(
            res_table="arsh_residential_listings", com_table="arsh_commercial_listings",
            res_ads={r["ad_number"] for r in res}, com_ads={r["ad_number"] for r in com}, source=SOURCE)
        if superseded:
            print(f"  retired {superseded} superseded sibling row(s) after a category flip", flush=True)
        complete = unreadable == 0 and len(slugs) > 0
        for tbl, rr in (("arsh_residential_listings", res), ("arsh_commercial_listings", com)):
            if rr and complete:
                n = db.prune_unseen(tbl, {r["ad_number"] for r in rr}, source=SOURCE)
                if n < 0:
                    print(f"  ⚠ {tbl}: prune guard tripped — kept existing active rows", flush=True)
                elif n:
                    print(f"  pruned {n} from {tbl}", flush=True)
        healthy = db.end_run(run_id, ok=True, rows_seen=len(slugs), rows_upserted=len(res) + len(com),
                             check_tables=["arsh_residential_listings", "arsh_commercial_listings"])
        if not healthy:
            print("✗ run demoted to unhealthy by end_run()", flush=True)
            return 1
        print(f"✓ {SOURCE}: {len(res)} residential + {len(com)} commercial upserted", flush=True)
        return 0
    except Exception as e:  # noqa: BLE001
        if run_id:
            db.end_run(run_id, ok=False, rows_seen=len(slugs), rows_upserted=0, notes=str(e)[:300])
        raise


if __name__ == "__main__":
    raise SystemExit(main())
