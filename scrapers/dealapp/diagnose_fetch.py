"""Deal App fetch discriminator: is the shell response caused by our CLIENT or by our NETWORK?

Diagnosis ONLY. Never writes to the database, never touches scrape_runs/listings. A handful of
requests against a few known ids, run once on demand via wasalt-style workflow_dispatch.

THE PROBLEM (2026-08-26). dealapp detail fetches in production fail ~78-82% of the time with
`status_200_no_listing_schema`: HTTP 200, an <script id="ng-state"> block present, but no
`real-estate-listing` key inside `schemaMarkupScripts` — the same response shape a genuinely
nonexistent ad id produces. That signal is what feeds last_seen_at, so 30% of the active inventory
now looks "not seen at source" while a hand sample proved 6 of 15 of those listings are alive and
carry availability=InStock. dealapp_recover has returned `unknown=276 of 276` on EVERY run for
days, including a fresh mid-afternoon dispatch — it has never once classified anything.

From an ordinary network the same URLs return the full schema WITH a price (verified 2026-08-26:
live id 558414 price 550160.38, stale-but-alive id 382843 price 260325, bogus id 999999999 no
real-estate-listing key at all). So the parser and the classifier are correct; only the fetch
inside GitHub Actions is not getting data-bearing pages.

WHAT THIS SEPARATES. Four client variants against the SAME ids from the SAME runner:

  A prod-exact   curl_cffi impersonate=chrome124 + the Accept/Accept-Language headers run.py sets
  B no-imp       curl_cffi with NO TLS impersonation, plain browser User-Agent
  C imp-no-hdrs  impersonate=chrome124 with curl_cffi's DEFAULT headers (no run.py overrides)
  D imp-alt      a DIFFERENT impersonation profile

A vs C isolates HEADERS. A vs B and A vs D isolate the TLS FINGERPRINT. If all four fail
identically, the client is exonerated and the cause is the runner's network/egress identity —
which is a provider/compliance question for the owner, NOT something to route around here.

Deliberately NOT a fix and NOT a workaround: this script only reports. It adds no proxy, changes
no production path, and must never be put on a schedule.
"""
from __future__ import annotations

import json
import re
import sys
import time
from typing import Any, Optional

from curl_cffi import requests as cc

BASE = "https://dealapp.sa"

# Known ids, established from an ordinary network on 2026-08-26 (see module docstring).
PROBE_IDS: list[tuple[str, str]] = [
    ("558414", "live-confirmed-today"),
    ("382843", "stale>=7d-but-alive-InStock"),
    ("548176", "stale>=7d-but-alive-InStock"),
    ("999999999", "bogus-control-must-have-no-listing-schema"),
]


def listing_schema(html: str) -> tuple[Optional[dict], str]:
    """Mirror of run.py::_listing_schema, plus a reason string so a failure says WHICH step died."""
    m = re.search(r'<script id="ng-state" type="application/json">(.*?)</script>', html, re.S)
    if not m:
        return None, "no ng-state block at all"
    try:
        state = json.loads(m.group(1))
    except Exception as e:
        return None, f"ng-state present but unparseable: {type(e).__name__}"
    sm = state.get("schemaMarkupScripts") or {}
    raw = next((v for k, v in sm.items() if k.startswith("real-estate-listing")), None)
    if raw is None:
        return None, f"ng-state ok, NO real-estate-listing key; keys={sorted(sm.keys())[:6]}"
    try:
        return (json.loads(raw) if isinstance(raw, str) else raw), "ok"
    except Exception as e:
        return None, f"real-estate-listing present but unparseable: {type(e).__name__}"


def build(variant: str) -> cc.Session:
    if variant == "A-prod-exact":
        s = cc.Session(impersonate="chrome124")
        s.headers.update({
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "ar,en-US;q=0.7,en;q=0.6",
        })
        return s
    if variant == "B-no-impersonation":
        s = cc.Session()
        s.headers.update({"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                                        "AppleWebKit/537.36 (KHTML, like Gecko) "
                                        "Chrome/124.0.0.0 Safari/537.36"})
        return s
    if variant == "C-impersonate-default-headers":
        return cc.Session(impersonate="chrome124")
    if variant == "D-impersonate-alt-profile":
        for prof in ("chrome131", "chrome126", "chrome120", "safari17_0"):
            try:
                return cc.Session(impersonate=prof)
            except Exception:
                continue
        return cc.Session()
    raise ValueError(variant)


VARIANTS = ["A-prod-exact", "B-no-impersonation", "C-impersonate-default-headers",
            "D-impersonate-alt-profile"]


def probe(sess: cc.Session, adid: str) -> dict[str, Any]:
    url = f"{BASE}/ar/ad-details/{adid}"
    t0 = time.monotonic()
    try:
        r = sess.get(url, timeout=45, allow_redirects=True)
    except Exception as e:
        return {"ok": False, "error": f"{type(e).__name__}: {str(e)[:160]}",
                "ms": round((time.monotonic() - t0) * 1000)}
    schema, why = listing_schema(r.text)
    offers = (schema or {}).get("offers") or {}
    return {
        "ok": True,
        "status": r.status_code,
        "bytes": len(r.text),
        "marker_in_text": "real-estate-listing" in r.text,
        "schema_found": schema is not None,
        "price": offers.get("price"),
        "availability": offers.get("availability"),
        "reason": why,
        "ms": round((time.monotonic() - t0) * 1000),
    }


def main() -> int:
    report: dict[str, Any] = {"base": BASE, "variants": {}}
    for variant in VARIANTS:
        try:
            sess = build(variant)
        except Exception as e:
            report["variants"][variant] = {"build_error": f"{type(e).__name__}: {e}"}
            continue
        rows = {}
        for adid, tag in PROBE_IDS:
            rows[f"{adid} ({tag})"] = probe(sess, adid)
            time.sleep(1.0)          # polite: one request per second, per variant
        report["variants"][variant] = rows

    # Verdict: did ANY variant get a data-bearing page for a known-live id?
    live_ids = [f"{i} ({t})" for i, t in PROBE_IDS if "alive" in t or "live" in t]
    winners = [v for v, rows in report["variants"].items()
               if isinstance(rows, dict)
               and any(isinstance(rows.get(k), dict) and rows[k].get("schema_found") for k in live_ids)]
    report["variants_that_got_real_data"] = winners
    report["verdict"] = (
        "CLIENT-SIDE: at least one client variant works from this runner — compare A against the "
        "winners to see whether TLS fingerprint or headers is the discriminator."
        if winners else
        "NETWORK/EGRESS-SIDE: no client variant obtained a listing schema for a known-live id from "
        "this runner, so the client is exonerated and the runner's egress identity is the cause. "
        "That is an owner decision about provider/egress, not something to route around here."
    )
    print("=== DEAL APP FETCH DISCRIMINATOR ===")
    print(json.dumps(report, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
