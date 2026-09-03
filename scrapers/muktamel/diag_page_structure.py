"""One-shot diagnostic: dump RAW structural evidence from real muktamel.com listing pages.

WHY THIS EXISTS (2026-09-03): after fixing the _NodeWorker deadlock (see run.py), a real crawl
against muktamel.com completed cleanly but found 0 live listings — every non-dead id came back
"unparseable_or_no_offer" (scrapers/common/tests + the fetch-outcome counter in run.py). That is
consistent with the site's page structure having changed since this scraper was written for
Nuxt 2's `window.__NUXT__=` IIFE. This script proves what the CURRENT structure actually is,
straight from the runner (this repo's sandbox cannot reach muktamel.com — outbound is blocked),
so the rebuilt parser is built from real evidence, not a guess.

It fetches each given id ONCE, and prints, per id:
  - HTTP status, final URL (redirect target)
  - content length
  - whether the OLD marker (`window.__NUXT__=`) is present
  - whether newer Nuxt3-shaped markers are present (`__NUXT_DATA__`, `useNuxtApp`, `window.__NUXT__`
    as a plain object literal instead of an IIFE, `<script type="application/json"`)
  - every `<script ...>` tag's opening attributes (id/type/src) in document order — this alone
    usually reveals which framework/hydration payload is really on the page
  - a bounded snippet (first 4000 chars) of whichever script tag looks most likely to carry the
    listing payload (largest inline <script> body), for manual/agent inspection

This is diagnostic-only: it writes NOTHING to the database and stores NOTHING beyond the CI log.

Usage: python -m scrapers.muktamel.diag_page_structure --ids 24000,24001,24005
"""
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

from curl_cffi import requests as cc

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT.parent) not in sys.path:
    sys.path.insert(0, str(ROOT.parent))

BASE = "https://www.muktamel.com"

_SCRIPT_TAG_RE = re.compile(r"<script\b([^>]*)>(.*?)</script>", re.S | re.I)


def _session() -> cc.Session:
    s = cc.Session(impersonate="chrome124")
    s.headers.update({
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "ar,en-US;q=0.7,en;q=0.6",
    })
    return s


def dump_one(s: cc.Session, listing_id: int) -> None:
    url = f"{BASE}/real-estates/{listing_id}"
    print(f"\n{'=' * 90}\nID {listing_id}  GET {url}")
    try:
        r = s.get(url, timeout=45, allow_redirects=True)
    except Exception as e:
        print(f"  EXC {type(e).__name__}: {e}")
        return
    print(f"  status={r.status_code}  final_url={r.url}  len={len(r.text)}")
    html = r.text

    has_old_nuxt2 = "window.__NUXT__=" in html
    has_nuxt_data_tag = "__NUXT_DATA__" in html
    has_app_json_ld = 'application/ld+json' in html
    print(f"  markers: window.__NUXT__=... : {has_old_nuxt2}   __NUXT_DATA__ : {has_nuxt_data_tag}"
          f"   application/ld+json : {has_app_json_ld}")

    m = re.search(r'name="generator"\s+content="([^"]+)"', html, re.I)
    print(f"  <meta generator>: {m.group(1) if m else '(none found)'}")

    scripts = _SCRIPT_TAG_RE.findall(html)
    print(f"  {len(scripts)} <script> tags:")
    biggest = None
    biggest_len = -1
    for attrs, body in scripts:
        attrs_clean = " ".join(attrs.split())
        print(f"    <script {attrs_clean[:120]}>  body_len={len(body)}")
        if len(body) > biggest_len:
            biggest_len = len(body)
            biggest = (attrs_clean, body)

    if biggest and biggest_len > 200:
        attrs_clean, body = biggest
        print(f"\n  --- largest inline <script {attrs_clean[:80]}> (first 4000 chars) ---")
        print(body[:4000])
        print("  --- end snippet ---")
    else:
        print("\n  (no substantial inline <script> body found)")

    # Fallback: print a slice of raw body HTML around the first occurrence of a plausible
    # listing-data anchor, in case the payload isn't in a <script> tag at all (e.g. pure SSR HTML,
    # a data-* attribute blob, or a different hydration mechanism entirely).
    anchor = re.search(r"real-estate|offer|listing|__NUXT|__DATA__", html, re.I)
    if anchor:
        start = max(0, anchor.start() - 200)
        print(f"\n  --- raw HTML around first '{anchor.group(0)}' match (400 chars) ---")
        print(html[start:start + 600])
        print("  --- end ---")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--ids", required=True, help="comma-separated listing ids to dump")
    args = ap.parse_args()
    ids = [int(x) for x in args.ids.split(",") if x.strip()]
    s = _session()
    for lid in ids:
        dump_one(s, lid)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
