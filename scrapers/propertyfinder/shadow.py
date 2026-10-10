"""Property Finder Saudi SHADOW read (backlog 108, owner 2026-10-05) — reads and PRINTS; writes nothing.

Honest access only (owner rule): our own bot user-agent «Ezhalah-bot/1.0», never a browser identity,
never stealth, <= 1 request a second, never /en/search or /ar/search (robots.txt disallows them). If
the honest bot is refused, this prints the refusal and stops — it never tries to get around a block.
Agent/broker names and phones are in the payload: only their PRESENCE is printed, never the values.

  python -m scrapers.propertyfinder.shadow --pages 3
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import time

from curl_cffi import requests as cc  # NO impersonate: an honest client

UA = "Ezhalah-bot/1.0 (+https://ezhalah-app.vercel.app)"
BASE = "https://www.propertyfinder.sa"
_last = [0.0]


def fetch(url: str) -> tuple[int, str]:
    wait = 1.05 - (time.time() - _last[0])
    if wait > 0:
        time.sleep(wait)
    _last[0] = time.time()
    try:
        r = cc.get(url, headers={"User-Agent": UA}, timeout=30)
        return r.status_code, r.text
    except Exception as e:  # noqa: BLE001 — printed, never read as empty
        return -1, str(e)[:200]


def next_data(html: str) -> dict:
    m = re.search(r'<script id="__NEXT_DATA__"[^>]*>(.*?)</script>', html, re.S)
    return json.loads(m.group(1)) if m else {}


def summarise(item: dict) -> dict:
    """Field names + the non-PII values a listing would need; agent/broker only as present/absent."""
    p = item.get("property") or item
    loc = p.get("location") or {}
    coords = loc.get("coordinates") or {}
    price = p.get("price") or {}
    return {
        "id": p.get("id"), "type": p.get("property_type"), "offering": p.get("offering_type"),
        "price": price.get("value"), "period": price.get("period"), "size": (p.get("size") or {}).get("value"),
        "beds": p.get("bedrooms"), "baths": p.get("bathrooms"), "loc": loc.get("full_name"),
        "pin": [coords.get("lat"), coords.get("lon")] if coords else None,
        "available": p.get("is_available"), "path": p.get("details_path") or p.get("share_url"),
        "has_agent": bool(p.get("agent")), "has_broker": bool(p.get("broker")),
        "keys": sorted(p.keys())[:40],
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--pages", type=int, default=3)
    a = ap.parse_args()
    st, rb = fetch(f"{BASE}/robots.txt")
    print(f"robots.txt {st}:\n{rb[:900]}\n", flush=True)
    st, idx = fetch(f"{BASE}/sitemaps/index-sitemap.xml")
    locs = re.findall(r"<loc>([^<]+)</loc>", idx) if st == 200 else []
    print(f"sitemap index: {st} locs={len(locs)} first={locs[:4]}", flush=True)
    if st != 200:
        print("honest bot refused or index missing — stopping (owner rule: never get around a block)")
        return 0
    cats: list[str] = []
    for sm in locs[:2]:
        st2, body = fetch(sm)
        got = re.findall(r"<loc>([^<]+\.html)</loc>", body) if st2 == 200 else []
        print(f"  {sm}: {st2} category pages={len(got)} e.g. {got[:2]}", flush=True)
        cats += got
    for url in cats[: a.pages]:
        st3, h = fetch(url)
        sr = (((next_data(h).get("props") or {}).get("pageProps") or {}).get("searchResult") or {}) if st3 == 200 else {}
        listings = sr.get("listings") or []
        print(f"\nPAGE {url}: {st3} total_count={(sr.get('meta') or {}).get('total_count')} listings={len(listings)}",
              flush=True)
        for it in listings[:3]:
            print("  " + json.dumps(summarise(it), ensure_ascii=False)[:900], flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
