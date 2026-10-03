"""Re-read original ads and put what the PAGE says next to what WE store (docs/ops/
NEW_LISTINGS_ENGINEER.md, step 6 "Re-read against the original ad, two independent ways").

This is way (b), the independent reading: it never runs our scraper's parser. For each listing it
saves the page's own structured data (JSON-LD, meta tags), the lines of visible text that carry a
price, size, rooms or an amenity, and the start of the visible text, beside every normal-filter and
Advanced-Filter value we serve for that listing. A parser bug can't hide here, because nothing here
parses the way our parser does. Way (a) (the site's own production parser on a fresh page) is the
engineer's to add per website.

READ-ONLY: it writes nothing to the database. Pages are fetched through the deletion tier's own
transport (`cleanup._probe`: it keeps the real status, and reaches wasalt only through the real
browser), and each page gets the shared verdict (`classify_response`).

  python -m scrapers.common.source_reread --ids aqar_residential_listings:123,wasalt_residential_listings:9
  python -m scrapers.common.source_reread --platform gathern --n 20 --new-hours 24
"""
from __future__ import annotations

import argparse
import html
import json
import os
import random
import re
import sys
from datetime import datetime, timedelta, timezone

from scrapers.common.cleanup import PLATFORMS, _probe
from scrapers.common.db import sb
from scrapers.common.liveness_contract import classify_response

STORED = ("platform,source_table,listing_id,region_ar,city_ar,district_ar,deal_ar,type_ar,rent_period_ar,"
          "price_total,price_annual,price_per_meter,payment_monthly,area_m2,bedrooms,bathrooms,property_age,"
          "furnished,elevator,parking,kitchen,air_conditioner,maid_room,driver_room,private_entrance,"
          "rent_now_pay_later,installment_available,installment_amount,direction_ar,street_width_m,"
          "floor_number,license_number,first_seen_at,production_ready,has_photo")

# Lines of visible text worth a human's eye: money, size, rooms, and the Advanced Filter words.
EVIDENCE = re.compile(
    r"(ريال|ر\.س|SAR|م²|م2|متر|غرف|غرفة|حمام|دورات? مياه|مفروش|مؤثث|مصعد|موقف|مطبخ|مكيف|تكييف|"
    r"غرفة (?:خادمة|سائق)|مدخل خاص|عمر العقار|سنوي|شهري|للبيع|للإيجار|حي\s)")
TAG = re.compile(r"<[^>]+>")
DROP = re.compile(r"<(script|style|noscript|svg)[^>]*>.*?</\1>", re.S | re.I)
JSONLD = re.compile(r'<script[^>]+type=["\']application/ld\+json["\'][^>]*>(.*?)</script>', re.S | re.I)
META = re.compile(r'<meta\s+[^>]*(?:property|name)=["\']([^"\']+)["\'][^>]*content=["\']([^"\']*)["\']', re.I)
TITLE = re.compile(r"<title[^>]*>(.*?)</title>", re.S | re.I)


def page_evidence(body: str) -> dict:
    """What a person (or the page's own structured data) says, with no parser of ours involved."""
    jsonld = []
    for block in JSONLD.findall(body or ""):
        try:
            jsonld.append(json.loads(html.unescape(block.strip())))
        except ValueError:
            jsonld.append({"_unparsed": block.strip()[:500]})
    meta = {k: html.unescape(v) for k, v in META.findall(body or "")
            if k.startswith(("og:", "twitter:", "description", "product:"))}
    title = TITLE.search(body or "")
    text = TAG.sub("\n", DROP.sub(" ", body or ""))
    lines = [re.sub(r"\s+", " ", html.unescape(x)).strip() for x in text.split("\n")]
    lines = [x for x in lines if x]
    return {
        "title": html.unescape(title.group(1).strip()) if title else None,
        "meta": meta,
        "jsonld": jsonld[:5],
        "evidence_lines": [x for x in lines if EVIDENCE.search(x)][:60],
        "text_head": " | ".join(lines)[:1500],
    }


def page_image_count(page: dict) -> int | None:
    """How many images the PAGE's own structured data lists (JSON-LD `image`, any depth), counted
    without our parser; None when the page carried no JSON-LD to count from. Photos are part of the
    New Listings check (owner 2026-10-03), and the artifact that holds the JSON-LD is unreachable
    from a cloud session, so the count has to be readable from the job log."""
    blocks = (page or {}).get("jsonld") or []
    if not blocks:
        return None

    def walk(node) -> int:
        if isinstance(node, dict):
            n = 0
            for k, v in node.items():
                if k == "image":
                    n += len(v) if isinstance(v, list) else (1 if v else 0)
                else:
                    n += walk(v)
            return n
        if isinstance(node, list):
            return sum(walk(x) for x in node)
        return 0

    return sum(walk(b) for b in blocks)


_LOG_FIELDS = ("city_ar", "district_ar", "deal_ar", "type_ar", "rent_period_ar", "price_total", "price_annual",
               "area_m2", "bedrooms", "bathrooms")


def log_lines(item: dict, n_evidence: int = 15) -> list[str]:
    """The comparison as plain log lines. The reread.json artifact cannot be downloaded from a cloud
    agent session (its blob host is refused by the egress proxy, measured 2026-10-02), so the
    stored-vs-page facts must also be readable from the job log itself."""
    st = item.get("stored") or {}
    page = item.get("page") or {}
    out = [f"== {item.get('table')}:{item.get('id')} status={item.get('status')} verdict={item.get('verdict')}",
           f"   url: {item.get('url')}",
           "   stored: " + " | ".join(f"{k}={st.get(k)}" for k in _LOG_FIELDS if st.get(k) is not None),
           f"   page title: {page.get('title')}",
           f"   page images (JSON-LD): {page_image_count(page)} | og:image: {bool((page.get('meta') or {}).get('og:image'))} "
           f"| we serve a photo: {st.get('has_photo')}"]
    out += [f"   page: {x[:200]}" for x in (page.get("evidence_lines") or [])[:n_evidence]]
    return out


def parse_ids(spec: str) -> list[tuple[str, int]]:
    """'table:id,table:id' → [(table, id)]. Anything malformed is refused, never guessed."""
    out = []
    for part in filter(None, (p.strip() for p in spec.split(","))):
        table, _, rid = part.partition(":")
        if not table or not rid.isdigit():
            raise ValueError(f"bad --ids entry {part!r}; expected table:id")
        out.append((table, int(rid)))
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--ids", default="", help="table:id,… exactly these listings")
    ap.add_argument("--platform", default="", help="sample this website's new listings instead")
    ap.add_argument("--n", type=int, default=20)
    ap.add_argument("--new-hours", type=int, default=24)
    ap.add_argument("--seed", type=int, default=None)
    a = ap.parse_args()
    client = sb()

    if a.ids:
        wanted = parse_ids(a.ids)
    elif a.platform:
        since = (datetime.now(timezone.utc) - timedelta(hours=a.new_hours)).isoformat()
        rows = (client.table("search_listings_ar").select("source_table,listing_id")
                .eq("platform", a.platform).gte("first_seen_at", since).limit(2000).execute().data or [])
        rng = random.Random(a.seed)
        wanted = [(r["source_table"], int(r["listing_id"])) for r in rng.sample(rows, min(a.n, len(rows)))]
    else:
        print("give --ids or --platform", file=sys.stderr)
        return 2

    out = []
    for table, rid in wanted:
        stored = (client.table("search_listings_ar").select(STORED).eq("source_table", table)
                  .eq("listing_id", rid).limit(1).execute().data or [{}])[0]
        raw = (client.table(table).select("listing_url,neighborhood").eq("id", rid).limit(1).execute().data or [{}])[0]
        url = raw.get("listing_url")
        item = {"table": table, "id": rid, "url": url, "stored": stored,
                "card_district_raw": raw.get("neighborhood")}
        if url:
            status, body = _probe(url)
            platform = stored.get("platform") or table.split("_")[0]
            item["status"] = status
            item["verdict"] = classify_response(status, body or "",
                                                dead_marker=PLATFORMS.get(platform, {}).get("dead_marker"))
            item["page"] = page_evidence(body or "")
        out.append(item)

    text = json.dumps(out, ensure_ascii=False, indent=1, default=str)
    with open("reread.json", "w", encoding="utf-8") as f:
        f.write(text)
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as f:
            f.write(f"### Source re-read: {len(out)} listing(s)\n\n")
            for it in out:
                f.write(f"- `{it['table']}:{it['id']}` status={it.get('status')} verdict={it.get('verdict')}\n")
    for it in out:
        print("\n".join(log_lines(it)), flush=True)
    print(f"re-read {len(out)} listing(s) → reread.json")
    return 0


if __name__ == "__main__":
    sys.exit(main())
