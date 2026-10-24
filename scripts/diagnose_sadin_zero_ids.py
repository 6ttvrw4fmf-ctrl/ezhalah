"""Sadin list-page probe: WHY does /properties return HTTP 200 with zero listing IDs?

THE QUESTION
------------
Since 2026-08-30 04:22Z every sadin run captures 0 rows. The instrumentation merged in #1451
narrowed it to one precise fact, recorded on the 2026-09-01 06:34Z run:

    list-fetch failures: http_200_zero_ids_page1=3

All three list URLs (/properties, ?purpose=sale, ?purpose=rent) answer 200 and yield no matches for
the ID pattern the parser depends on. So the site is reachable and is NOT blocking us — the markup
the extractor keys on is gone. That is the same signature as the "v4" redesign found on 2026-07-30
after 4 days of 0-card runs (see scrapers/sadin/run.py header).

Which of those two extraction anchors moved cannot be answered from the database, and the audit
container's egress policy hard-403s sadin.com.sa. Actions reaches it — this is where the production
scraper runs, using the same curl_cffi fetch path, so this probe sees exactly what the scraper sees.

WHAT IT PRINTS
--------------
For each list URL: status, body size, whether the body looks JS-shell-rendered, and then the
evidence needed to rewrite the two anchors:
  * how many times the CURRENT anchors match (`<article class="property-card"`, and the
    href="/property/{4,8 alnum}" ID regex) — expected 0, which is the bug;
  * every distinct href PATH SHAPE on the page, so a moved detail-URL prefix (/properties/{id},
    /ad/{id}, a locale prefix, an absolute URL) is immediately visible;
  * the class names of repeated block elements, so a renamed card wrapper is immediately visible;
  * whether the literal string "property" appears at all, to separate "renamed" from "empty page".

READ-ONLY BY CONSTRUCTION: the workflow that runs this passes no Supabase credentials, so it cannot
write to the database — it only prints evidence to the log.

PDPL: sadin detail pages expose an office name and phone/WhatsApp numbers. This probe reads only
LIST pages, prints no free text beyond class/attribute names, and redacts phone-shaped digit runs
from the one bounded snippet it emits.
"""
from __future__ import annotations

import re
import sys
from collections import Counter

from curl_cffi import requests as cc

BASE = "https://www.sadin.com.sa"
URLS = [f"{BASE}/properties", f"{BASE}/properties?purpose=sale", f"{BASE}/properties?purpose=rent"]

# The two anchors the production parser depends on (scrapers/sadin/run.py:218,241).
ID_RE = re.compile(r'href="/property/([A-Za-z0-9]{4,8})"')
CARD_RE = re.compile(r'<article class="property-card')

PHONE_RE = re.compile(r"(?:\+?966|0)\d[\d\s\-]{6,}")


def redact(s: str) -> str:
    return PHONE_RE.sub("[REDACTED-PHONE]", s)


def probe(session: cc.Session, url: str) -> None:
    print(f"\n{'=' * 78}\n{url}\n{'=' * 78}")
    try:
        r = session.get(url, timeout=45)
    except Exception as exc:  # noqa: BLE001 - a probe reports failures, never raises
        print(f"  FETCH FAILED: {type(exc).__name__}: {exc}")
        return

    html = r.text or ""
    print(f"  status            : {r.status_code}")
    print(f"  body bytes        : {len(html)}")
    print(f"  final url         : {getattr(r, 'url', '(n/a)')}")

    # --- the bug, stated numerically ---
    ids = ID_RE.findall(html)
    print(f"  CURRENT id anchor : {len(ids)} match(es)  <- parser needs > 0")
    print(f"  CURRENT card anchor: {len(CARD_RE.findall(html))} match(es)")

    # --- is there anything to parse at all? ---
    print(f"  contains 'property': {html.count('property')}")
    print(f"  contains '<article': {html.count('<article')}")
    # A JS shell serves a near-empty body plus a bundle; that is a different fix entirely.
    shell = len(html) < 20000 and ("__NEXT_DATA__" in html or "<div id=\"app\"" in html or "window.__" in html)
    print(f"  looks JS-rendered : {shell}")

    # --- where did the detail links go? ---
    paths = Counter()
    for href in re.findall(r'href="([^"#?]+)', html):
        if href.startswith(("mailto:", "tel:", "javascript:")):
            continue
        # collapse the variable last segment so /property/AB12 and /property/CD34 group together
        segs = [s for s in href.split("/") if s]
        shape = "/" + "/".join(
            ("{id}" if re.fullmatch(r"[A-Za-z0-9_-]{3,}", s) and any(c.isdigit() for c in s) else s)
            for s in segs
        )
        paths[shape] += 1
    print("  href path shapes (top 25):")
    for shape, n in paths.most_common(25):
        print(f"      {n:5d}  {shape}")

    # --- what are the repeated block wrappers now called? ---
    classes = Counter()
    for cls in re.findall(r'<(?:article|div|li|a)[^>]*class="([^"]{0,160})"', html):
        for token in cls.split():
            classes[token] += 1
    print("  repeated element class tokens (top 25):")
    for token, n in classes.most_common(25):
        if n > 1:
            print(f"      {n:5d}  {token}")

    if ids:
        print(f"  sample ids        : {sorted(set(ids))[:10]}")
    else:
        # one bounded, redacted window around the first 'property' mention, to eyeball the new markup
        idx = html.find("property")
        if idx != -1:
            print("  first 'property' context (redacted, 600 bytes):")
            print("      " + redact(html[max(0, idx - 200): idx + 400]).replace("\n", " ")[:600])


def main() -> int:
    with cc.Session(impersonate="chrome") as s:
        for url in URLS:
            probe(s, url)
    print("\nDone. Compare the anchors above against scrapers/sadin/run.py:218 (id regex) and :241 "
          "(card split) to write the corrected selectors.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
