"""Is there a link that opens a Gathern APP-ONLY unit for a web customer? (read-only probe, 2026-10-06)

Owner request 2026-10-04 (SCRAPING_ENGINEER.md, «GATHERN: ALL ~37,000 UNITS» step 1): Gathern's
search lists ~37,000 units but ~32,000 of them answer «الصفحة غير موجودة» (HTTP 404) on
gathern.co/view/<chalet>/unit/<unit>. A unit may be shown only with a link proven to open it.
The 10-04 measurement ran from a cloud container; this one runs from the GitHub Actions egress the
crawl really uses, so its answer is about the platform, not about one container's network.

For a sample of units the search API lists (one page per big city), it records:
  1. every field of the unit's own search record that looks like a link (url / link / share / slug /
     deep / dynamic) — the share link the app produces would have to come from somewhere;
  2. what each candidate web address answers, on a PHONE user agent and a LAPTOP one:
     /view/<c>/unit/<u> (what we store), /link/view/<c>/unit/<u> and /r/<u> (the paths Gathern's
     apple-app-site-association hands to its app), /unit/<u>, /ar/view/<c>/unit/<u>.
PASS for a candidate = HTTP 200 AND the page is not Gathern's «غير موجودة» page AND it names the unit.

READ-ONLY BY CONSTRUCTION: no database credentials, no writes. Prints a table and a verdict line.

  python -m scrapers.gathern.probe_app_only_link
"""
from __future__ import annotations

import json
import os
import re
import sys
import time
from typing import Any

from curl_cffi import requests as cc

SEARCH = "https://msapi.gathern.co/search/api/v1/search-units?lang=ar&city={city}&page={page}"
WEB = "https://gathern.co"
CITIES = (3, 1, 2)          # gathern city ids sampled (the crawl's own ids; order = biggest first)
PER_CITY = 4
THROTTLE = 1.0
LINKISH = re.compile(r"url|link|share|slug|deep|dynamic|href", re.I)
NOT_FOUND = ("الصفحة غير موجودة", "غير موجودة", "page not found", "404")
PHONE = "safari17_2_ios"
LAPTOP = "chrome124"


def api() -> cc.Session:
    s = cc.Session(impersonate="chrome124")
    s.headers.update({"Accept": "application/json", "Accept-Language": "ar", "source": "web",
                      "Origin": WEB, "Referer": WEB + "/"})
    return s


def units_in(js: Any) -> list[dict]:
    out: list[dict] = []
    if isinstance(js, dict):
        if "chalet_id" in js and ("id" in js or "unit_id" in js):
            out.append(js)
        for v in js.values():
            out += units_in(v)
    elif isinstance(js, list):
        for v in js:
            out += units_in(v)
    return out


def linkish(d: Any, path: str = "") -> list[str]:
    found: list[str] = []
    if isinstance(d, dict):
        for k, v in d.items():
            p = f"{path}.{k}" if path else k
            if LINKISH.search(k) and isinstance(v, (str, int)) and str(v).strip():
                found.append(f"{p}={str(v)[:120]}")
            found += linkish(v, p)
    elif isinstance(d, list):
        for i, v in enumerate(d[:3]):
            found += linkish(v, f"{path}[{i}]")
    return found


def web(profile: str, url: str, unit: int) -> str:
    time.sleep(THROTTLE)
    try:
        r = cc.Session(impersonate=profile).get(url, timeout=25, allow_redirects=True)
    except Exception as e:  # noqa: BLE001 — a failed fetch is UNKNOWN, never a verdict
        return f"ERR:{type(e).__name__}"
    body = r.text or ""
    nf = any(m in body[:20000] for m in NOT_FOUND[:2])
    named = str(unit) in body
    final = r.url if r.url != url else ""
    ok = r.status_code == 200 and not nf and named
    return f"{r.status_code}{' NF' if nf else ''}{' named' if named else ''}{' PASS' if ok else ''}" + (f" →{final[:80]}" if final else "")


def main() -> int:
    s = api()
    print("gathern app-only link probe — READ ONLY, no database writes.\n", flush=True)
    sample: list[dict] = []
    # PROBE_UNITS="chalet:unit,…" tests units we already hold as web-404 (the app-only cohort) instead
    # of page 1 of the search, which may list only web-visible units (2026-10-06: 8 of 8 opened).
    for pair in filter(None, os.environ.get("PROBE_UNITS", "").replace(" ", "").split(",")):
        c, _, u = pair.partition(":")
        if c.isdigit() and u.isdigit():
            sample.append({"chalet_id": int(c), "id": int(u)})
    for city in (() if sample else CITIES):
        time.sleep(THROTTLE)
        try:
            r = s.get(SEARCH.format(city=city, page=1), timeout=30)
            js = r.json()
        except Exception as e:  # noqa: BLE001
            print(f"city {city}: search unreadable ({type(e).__name__}) — UNKNOWN", flush=True)
            continue
        us = units_in(js)
        print(f"city {city}: HTTP {r.status_code}, {len(us)} units on page 1", flush=True)
        sample += us[:PER_CITY]
    if not sample:
        print("VERDICT: UNKNOWN — the search API served no units to sample")
        return 1
    print("\nlink-like fields in the first unit's search record:")
    for line in linkish(sample[0]) or ["(none)"]:
        print("   ", line)
    keys = sorted({k for u in sample for k in u.keys()})
    print(f"   all top-level keys: {', '.join(keys)}\n", flush=True)

    passes: dict[str, int] = {}
    web404 = 0
    for u in sample:
        c, uid = u.get("chalet_id"), u.get("id") or u.get("unit_id")
        cands = {
            "view": f"{WEB}/view/{c}/unit/{uid}",
            "ar_view": f"{WEB}/ar/view/{c}/unit/{uid}",
            "link_view": f"{WEB}/link/view/{c}/unit/{uid}",
            "r": f"{WEB}/r/{uid}",
            "unit": f"{WEB}/unit/{uid}",
        }
        row = []
        for name, url in cands.items():
            for label, prof in (("phone", PHONE), ("laptop", LAPTOP)):
                out = web(prof, url, int(uid))
                row.append(f"{name}/{label}:{out}")
                if out.split()[0] == "200" and "PASS" in out:
                    passes[name] = passes.get(name, 0) + 1
            if name == "view" and "PASS" not in row[-1] and "PASS" not in row[-2]:
                web404 += 1
        print(f"unit {uid} (chalet {c}) linkish={linkish(u)[:4]}\n   " + "\n   ".join(row), flush=True)

    app_only = web404
    alt = {k: v for k, v in passes.items() if k != "view"}
    print(f"\nsampled {len(sample)} units · {app_only} do not open on /view (app-only) · "
          f"other candidates that opened a unit: {json.dumps(alt)}")
    if app_only and not alt:
        print("VERDICT: NO — no web address opens an app-only unit for a customer (keep the web-proven units only)")
    elif alt:
        print("VERDICT: CANDIDATE — an alternative address opened units; check it opens the APP-ONLY ones above")
    else:
        print("VERDICT: UNKNOWN — every sampled unit opened on /view (no app-only unit in the sample)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
