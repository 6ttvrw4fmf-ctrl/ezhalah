"""Does gathern expose a PER-UNIT endpoint we can use as a liveness oracle? (read-only probe)

WHY THIS EXISTS. On 2026-09-01 gathern.co began answering our egress with its own application 404:
the same URL returned 200 to the CI oracle at 10:51 and 404 to a datacenter probe minutes later, and
12/12 rows the oracle had just verified alive came back 404. A Saudi residential proxy was then
authorised and TESTED — statuses[404x10], the proxy connected fine and the source refused it anyway.
So the web host is closed to us and gathern has no working liveness oracle.

But the block is confined to ONE host. The crawl reaches `msapi.gathern.co` and ran 12/12 ok EVERY
DAY straight through that window (09-01, 09-02, 09-03), from the same GitHub Actions egress. We
already hold a proven channel to this source; we just do not know whether it can answer a per-unit
question.

WHAT WOULD MAKE AN ENDPOINT USABLE, under docs/ops/LISTING_LIVENESS.md:
  * §2 only DIRECT evidence — this listing's own URL/record — may ever deactivate. An enumeration
    feed is ABSENCE evidence and can NEVER kill, however convenient it looks.
  * §1 a response we cannot interpret is UNKNOWN, never death.
So an endpoint qualifies only if it DISCRIMINATES: a record for ids that exist, and a distinct,
unambiguous not-found for ids that do not.

THE BOGUS COHORT IS THE POINT. Without an id that never existed we cannot tell "not found" from
"served us something unhelpful", and we would be inventing a death signal. gathern.co's web page
already failed exactly this test — run #85 measured bogus unit AND bogus property ids both returning
200 there. This probe therefore runs three cohorts:

  ALIVE_FEED  units the source served in the CURRENT monthly feed (<24h) — must look ALIVE
  ABSENT_408  units inactivated during the false-death window, unseen 7+ days — status genuinely
              UNKNOWN; this probe does NOT decide it, it only records what the endpoint says
  BOGUS       fabricated ids that never existed — defines what "not found" looks like

READ-ONLY BY CONSTRUCTION. No database writes of any kind, no listing state touched, no argument can
make it write. It prints a table and exits.

  python -m scrapers.gathern.probe_unit_api
"""
from __future__ import annotations

import json
import sys
import time
from typing import Any

from curl_cffi import requests as cc

THROTTLE = 1.2  # gathern rate-limits globally (~2 req/s across ALL IPs); stay well under

# (chalet_id, unit_id) — cohorts resolved from production 2026-09-03, recorded here so the probe is
# reproducible and reviewable without database access.
ALIVE_FEED = [(191078, 267460), (168796, 235925), (4990, 8716), (4990, 8719), (168796, 259506)]
ABSENT_408 = [(153457, 214970), (126077, 177494), (99129, 141522), (134334, 188483), (153747, 215326)]
# Fabricated. High ids well beyond the observed range, plus an obvious sentinel.
BOGUS = [(99999998, 99999997), (99999996, 99999995), (1, 999999999)]

# Candidate per-unit shapes. gathern's axios baseURL is "https://msapi.gathern.co/{service}/api/v1"
# and the crawl uses the `search` service; `unit`/`chalet` are the plausible siblings. Each is tried
# once per id — this is reconnaissance, not a brute force.
CANDIDATES = [
    ("msapi/search/unit/{unit}",        "https://msapi.gathern.co/search/api/v1/unit/{unit}"),
    ("msapi/search/units/{unit}",       "https://msapi.gathern.co/search/api/v1/units/{unit}"),
    ("msapi/unit/unit/{unit}",          "https://msapi.gathern.co/unit/api/v1/unit/{unit}"),
    ("msapi/chalet/{chalet}",           "https://msapi.gathern.co/chalet/api/v1/chalet/{chalet}"),
    ("msapi/chalet/{chalet}/unit/{u}",  "https://msapi.gathern.co/chalet/api/v1/chalet/{chalet}/unit/{unit}"),
    ("msapi/search-units?unit_id=",     "https://msapi.gathern.co/search/api/v1/search-units?lang=ar&unit_id={unit}"),
    ("api/web/chalet/{chalet}",         "https://api.gathern.co/v1/web/chalet/{chalet}?lang=ar"),
    ("api/web/unit/{unit}",             "https://api.gathern.co/v1/web/unit/{unit}?lang=ar"),
]


def api_session() -> cc.Session:
    """The SAME session shape scrapers/gathern/run.py uses for msapi (json + source headers)."""
    s = cc.Session(impersonate="chrome124")
    s.headers.update({
        "Accept": "application/json",
        "Accept-Language": "ar,en-US;q=0.7,en;q=0.6",
        "source": "web",
        "Origin": "https://gathern.co",
        "Referer": "https://gathern.co/",
    })
    return s


def describe(body: str, unit: int) -> str:
    """What did the body actually contain? Never guessed — only reported."""
    if not body:
        return "empty"
    low = body[:4000].lower()
    marks = []
    if str(unit) in body[:8000]:
        marks.append("has_unit_id")
    for key in ('"data"', '"unit"', '"price"', '"name"', '"id"'):
        if key in low:
            marks.append(key.strip('"'))
    for nf in ("not found", "notfound", "غير موجود", "no result", "unauthorized", "forbidden"):
        if nf in low:
            marks.append(f"NF:{nf}")
    return ",".join(marks) or "opaque"


def probe(s: cc.Session, url: str) -> dict[str, Any]:
    time.sleep(THROTTLE)
    try:
        r = s.get(url, timeout=25, allow_redirects=True)
        return {"status": r.status_code, "len": len(r.content), "body": r.text}
    except Exception as e:  # network/tunnel failure is UNKNOWN, never a verdict
        return {"status": 0, "len": 0, "body": "", "err": repr(e)[:120]}


def main() -> int:
    s = api_session()
    print("gathern per-unit API probe — READ ONLY, no database writes, no listing state touched.\n")

    # ── Stage 1: confirm the channel itself works from here ─────────────────────────────────────
    base = probe(s, "https://msapi.gathern.co/search/api/v1/search-units?lang=ar&city=1&page=1")
    print(f"CONTROL enumeration search-units: status={base['status']} len={base['len']}")
    if base["status"] != 200:
        print("  ⚠ the enumeration endpoint itself did not answer 200 — every result below is "
              "UNKNOWN (we cannot distinguish 'no such endpoint' from 'we were refused').")
    print()

    # ── Stage 2: does any candidate shape exist at all? ─────────────────────────────────────────
    chalet, unit = ALIVE_FEED[0]
    print(f"Endpoint discovery against a KNOWN-ALIVE unit ({chalet}/{unit}):")
    survivors: list[tuple[str, str]] = []
    for name, tpl in CANDIDATES:
        r = probe(s, tpl.format(chalet=chalet, unit=unit))
        print(f"  {name:34} status={r['status']:<4} len={r['len']:<7} {describe(r['body'], unit)[:70]}")
        if r["status"] == 200 and r["len"] > 0:
            survivors.append((name, tpl))
    print()

    if not survivors:
        print("RESULT: no candidate per-unit endpoint answered 200. Option B does not resolve on "
              "these shapes.\nNOTHING here says any listing is dead — absence of an endpoint is "
              "absence of EVIDENCE (LISTING_LIVENESS §1).")
        return 0

    # ── Stage 3: for surviving shapes, does it DISCRIMINATE across the three cohorts? ───────────
    for name, tpl in survivors:
        print(f"DISCRIMINATION TEST — {name}")
        for label, cohort in (("ALIVE_FEED", ALIVE_FEED), ("ABSENT_408", ABSENT_408), ("BOGUS", BOGUS)):
            for ch, un in cohort:
                r = probe(s, tpl.format(chalet=ch, unit=un))
                print(f"  {label:11} {ch}/{un:<10} status={r['status']:<4} len={r['len']:<7} "
                      f"{describe(r['body'], un)[:60]}")
        print()

    print("READ THE TABLE, DO NOT INFER FROM IT:\n"
          "  * usable as a DIRECT oracle only if ALIVE_FEED returns records AND BOGUS returns a\n"
          "    distinct, unambiguous not-found. If BOGUS looks like ALIVE, the endpoint cannot\n"
          "    prove death and must never be used to kill.\n"
          "  * ABSENT_408 is REPORTED, never adjudicated here. Those rows stay UNKNOWN until an\n"
          "    endpoint proven to discriminate says otherwise, per the owner rule 2026-09-03.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
