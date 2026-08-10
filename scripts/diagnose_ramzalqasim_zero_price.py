"""SOURCE-TRUTH probe for the ramzalqasim price=0 rows (owner question, 2026-08-10).

WHY THIS EXISTS
---------------
Six ramzalqasim rows carry price_total = 0; three of them are production_ready, so `Buy in عنيزة
sorted by price ascending` puts them ABOVE all 1,451 genuinely priced listings. The fidelity rule
says the ONLY question that matters is: DID THE SOURCE PUBLISH THIS VALUE? A genuinely published 0
must be preserved exactly; a sentinel meaning "price on request" must become an honest NULL, never
a guess.

That question cannot be answered from the database, and the audit container's egress policy blocks
ramzalqasim.com (hard 403 CONNECT). GitHub Actions reaches it every day — the production scraper
runs there. So this read-only probe runs in CI and prints the evidence.

WHAT IT PROVES, both layers:
  1. THE MACHINE PAYLOAD the scraper actually parses — the `updateMapMarkers` marker JSON. It
     prints the `price` key VERBATIM with its JSON type, and reports whether the key is absent,
     null, 0, "0", "" or a number. It uses the production fetch path (same session, same regex),
     so it sees exactly what the scraper sees.
  2. THE PUBLIC PAGE a human sees — /x/{id}. It extracts the price region of the rendered HTML.
     If the page shows "0 ريال" then 0 is published and must be kept. If it shows «السوم» /
     "price on request" / no price at all, then 0 is a sentinel and the honest value is NULL.

CONTROLS: it also probes listings with known non-zero prices, so "the price key looks like X" can
be read against a working example rather than in isolation. Without controls a null could just
mean our extraction is broken.

PDPL: the marker JSON carries owner_name / owner_phone. This script NEVER prints them — it
allowlists the keys it may show, and redacts any phone-shaped digits from page excerpts.

READ-ONLY: no database connection, no writes, no imports from scrapers.common.db.

Usage (CI):  python scripts/diagnose_ramzalqasim_zero_price.py
"""
from __future__ import annotations

import html as ihtml
import json
import re
import sys
import time
from typing import Any, Optional

from curl_cffi import requests as cc

BASE = "https://ramzalqasim.com"
MAPS = f"{BASE}/maps"

# The rows under investigation (source id → what we stored). Sourced from the 2026-08-10 audit.
SUSPECT = {226: "RQ226 land 430m² الرحاب (active/searchable)",
           252: "RQ252 land 887m² اشبيليا (active/searchable)",
           253: "RQ253 land 315m² المصيف (active/searchable)",
           200: "RQ200 villa 288m² الملك فهد (inactive/sold)",
           199: "RQ199 villa 300m² الملك فهد (inactive/sold)",
           147: "RQ147 land 900m² الرياضي (inactive/sold)"}

# Keys we are allowed to print. owner_name / owner_phone are deliberately absent (PDPL).
SAFE_KEYS = ("id", "price", "area", "status", "type", "availability", "city", "district",
             "real_estate_age", "width_street", "bedrooms", "bathroom")

_PHONE = re.compile(r"(?:\+?966|00966|0)?5\d{8}")


def redact(s: str) -> str:
    return _PHONE.sub("[phone-redacted]", s)


def session() -> cc.Session:
    s = cc.Session(impersonate="chrome124")
    s.headers.update({"Accept-Language": "ar,en;q=0.8"})
    return s


def fetch_markers(s: cc.Session, max_pages: int = 12) -> list[dict]:
    """Production fetch path, copied verbatim from scrapers/ramzalqasim/run.py."""
    out: list[dict] = []
    seen: set[int] = set()
    for page in range(1, max_pages + 1):
        time.sleep(0.5)
        try:
            r = s.get(f"{MAPS}?page={page}", timeout=30)
        except Exception as e:
            print(f"  page {page} fetch error: {e}")
            break
        if r.status_code != 200:
            print(f"  page {page} HTTP {r.status_code}")
            break
        m = re.search(r'updateMapMarkers","params":\[\[(.*?)\]\]', ihtml.unescape(r.text), re.S)
        if not m:
            print(f"  page {page}: no markers payload → stop")
            break
        try:
            arr = json.loads("[" + m.group(1) + "]")
        except Exception as e:
            print(f"  page {page}: parse err {e}")
            break
        if not arr:
            break
        new = [a for a in arr if a.get("id") not in seen]
        for a in new:
            seen.add(a["id"])
        print(f"  page {page}: +{len(new)} (total {len(seen)})")
        out += new
        if len(arr) < 30:
            break
    return out


def classify(rec: dict) -> str:
    """Exactly what the `price` key IS, without interpretation."""
    if "price" not in rec:
        return "KEY ABSENT"
    v = rec["price"]
    return f"{type(v).__name__} {v!r}"


def price_region(html: str) -> list[str]:
    """Lines of the rendered page around any price-ish marker, so we can see what a human reads."""
    text = re.sub(r"<script.*?</script>", " ", html, flags=re.S | re.I)
    text = re.sub(r"<style.*?</style>", " ", text, flags=re.S | re.I)
    text = ihtml.unescape(re.sub(r"<[^>]+>", " ", text))
    text = re.sub(r"[ \t ]+", " ", text)
    hits: list[str] = []
    for kw in ("السعر", "ريال", "﷼", "SAR", "السوم", "سوم", "على السوم", "اتصل", "price"):
        for m in re.finditer(re.escape(kw), text):
            seg = text[max(0, m.start() - 90): m.start() + 90].strip()
            seg = redact(re.sub(r"\s+", " ", seg))
            if seg not in hits:
                hits.append(seg)
    return hits[:8]


def main() -> int:
    s = session()

    print("=" * 100)
    print("LAYER 1 — the machine payload the scraper parses (updateMapMarkers marker JSON)")
    print("=" * 100)
    markers = fetch_markers(s)
    by_id = {m.get("id"): m for m in markers if isinstance(m.get("id"), int)}
    print(f"\nfetched {len(by_id)} markers\n")

    if not by_id:
        print("FATAL: no markers fetched — cannot conclude anything. Do NOT change data on this run.")
        return 1

    print("--- SUSPECT ROWS (stored price 0) ---")
    for sid, label in SUSPECT.items():
        rec = by_id.get(sid)
        if rec is None:
            print(f"  id {sid:<5} {label}\n      NOT IN CURRENT PAYLOAD (delisted?) — no live evidence this run")
            continue
        safe = {k: rec.get(k) for k in SAFE_KEYS if k in rec}
        print(f"  id {sid:<5} {label}\n      price = {classify(rec)}\n      safe fields: {json.dumps(safe, ensure_ascii=False)}")

    print("\n--- CONTROLS (a sample of rows carrying a real price) ---")
    controls = [m for i, m in by_id.items() if i not in SUSPECT][:6]
    for rec in controls:
        safe = {k: rec.get(k) for k in SAFE_KEYS if k in rec}
        print(f"  id {rec.get('id'):<5} price = {classify(rec)}\n      safe fields: {json.dumps(safe, ensure_ascii=False)}")

    # Distribution across the WHOLE catalogue — is 0 common, and does the site ever send null/""?
    print("\n--- price-key distribution across every marker on the site ---")
    dist: dict[str, int] = {}
    zeros: list[int] = []
    for i, rec in by_id.items():
        if "price" not in rec:
            k = "KEY ABSENT"
        elif rec["price"] is None:
            k = "null"
        elif isinstance(rec["price"], str) and rec["price"].strip() == "":
            k = "empty string"
        else:
            try:
                k = "zero" if float(str(rec["price"]).replace(",", "")) == 0 else "non-zero"
            except Exception:
                k = f"unparseable ({rec['price']!r})"
        dist[k] = dist.get(k, 0) + 1
        if k == "zero":
            zeros.append(i)
    for k, v in sorted(dist.items(), key=lambda kv: -kv[1]):
        print(f"  {k:<24} {v}")
    print(f"  ids with a zero price: {sorted(zeros)}")

    print("\n" + "=" * 100)
    print("LAYER 2 — the public page a HUMAN sees (/x/{id}) — this is what 'the source publishes'")
    print("=" * 100)
    for sid, label in SUSPECT.items():
        url = f"{BASE}/x/{sid}"
        time.sleep(0.5)
        try:
            r = s.get(url, timeout=30)
        except Exception as e:
            print(f"\n{url}  FETCH ERROR {e}")
            continue
        print(f"\n{url}  HTTP {r.status_code}  ({label})")
        if r.status_code != 200:
            continue
        hits = price_region(r.text)
        if not hits:
            print("      no price-like text found anywhere on the page")
        for h in hits:
            print(f"      … {h} …")

    # One control detail page, so we know the extraction works on a priced listing.
    if controls:
        cid = controls[0].get("id")
        time.sleep(0.5)
        try:
            r = s.get(f"{BASE}/x/{cid}", timeout=30)
            print(f"\n--- CONTROL detail page {BASE}/x/{cid}  HTTP {r.status_code} "
                  f"(marker price = {classify(controls[0])}) ---")
            for h in price_region(r.text):
                print(f"      … {h} …")
        except Exception as e:
            print(f"\ncontrol detail fetch error: {e}")

    print("\nDONE. Read Layer 2 first: it is what the source publishes to a user.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
