"""Option E canary: does a REAL BROWSER get a real page where curl_cffi gets 404? (read-only)

WHY, after Option B. The msapi probe (scrapers/gathern/probe_unit_api.py, run 33817560364) settled
that question and the answer was no:

  every per-unit REST shape        404 / 401
  msapi/search-units?unit_id=      200 — the only survivor, and it FAILS discrimination:
      ALIVE_FEED  200  len 20875-21185
      ABSENT_408  200  len 16448   (identical across all five)
      BOGUS       200  len 16452   <- an id that never existed looks like a real absent one

So that endpoint distinguishes only "in the current monthly feed" from "not in it", which is ABSENCE
evidence by another name (LISTING_LIVENESS §2) and can never kill. gathern's own docstring is explicit
that a fully-booked LIVE unit drops out of that feed.

WHAT THIS TESTS INSTEAD. gathern.co returns its own application 404 to curl_cffi from BOTH datacenter
egress AND the Saudi residential proxy (statuses[404x10]) — two very different IPs, same answer, which
suggests the discriminator is not the IP but the client: TLS fingerprint, cookies, or JS execution. A
real browser is the cheapest way to test that, and it is the one thing we have not tried.

THE BAR IS UNCHANGED, and the bogus cohort still carries it. Run #85 measured gathern.co returning 200
for bogus unit AND property ids, so a 200 alone proves nothing here. This qualifies as a DIRECT oracle
only if a real browser renders a genuine listing for ALIVE ids and something unambiguously
not-a-listing for BOGUS ids.

RESULT, measured 2026-09-03 23:30 UTC (run 33817754767, plain GitHub Actions egress, NO proxy).
The browser DISCRIMINATES, cleanly, at the HTTP status line — the first channel that ever has:

  ALIVE_FEED  5/5  status=200  html~250-358KB  notfound_ar=False  riyal=9-10  real Arabic unit titles
  ABSENT_408  3/3  status=404  html~142KB      notfound_ar=True   riyal=0     title 'Gathern | جاذر إن'
  BOGUS       3/3  status=404  html~142KB      notfound_ar=True   riyal=0     title 'Gathern | جاذر إن'

Compare run #85, which measured this SAME host returning 200 for bogus ids to curl_cffi. The
difference is not the site: it is the client. What curl_cffi reads as "404 = we were blocked" a real
browser reads as "404 = no such unit", and the ALIVE cohort is the positive control that separates
them. Adopting this as gathern's DIRECT oracle is an owner decision (reported 2026-09-03); until it
is taken, the ABSENT_408 rows stay UNKNOWN — three rows agreeing is not 408 rows adjudicated.

READ-ONLY. No database import, no credentials, no listing state. Prints a table and exits.

  python -m scrapers.gathern.probe_unit_browser
"""
from __future__ import annotations

import sys

ALIVE_FEED = ["https://gathern.co/view/191078/unit/267460",
              "https://gathern.co/view/168796/unit/235925",
              "https://gathern.co/view/4990/unit/8716",
              "https://gathern.co/view/4990/unit/8719",
              "https://gathern.co/view/168796/unit/259506"]
ABSENT_408 = ["https://gathern.co/view/153457/unit/214970",
              "https://gathern.co/view/126077/unit/177494",
              "https://gathern.co/view/99129/unit/141522"]
BOGUS = ["https://gathern.co/view/99999998/unit/99999997",
         "https://gathern.co/view/99999996/unit/99999995",
         "https://gathern.co/view/1/unit/999999999"]


def main() -> int:
    from playwright.sync_api import sync_playwright

    print("gathern browser canary — READ ONLY, no database access, no listing state touched.\n")
    rows = []
    with sync_playwright() as p:
        b = p.chromium.launch(args=["--no-sandbox"])
        ctx = b.new_context(locale="ar-SA")
        pg = ctx.new_page()
        for label, urls in (("ALIVE_FEED", ALIVE_FEED), ("ABSENT_408", ABSENT_408), ("BOGUS", BOGUS)):
            for u in urls:
                ident = u.split("/view/")[1]
                try:
                    r = pg.goto(u, wait_until="domcontentloaded", timeout=45000)
                    status = r.status if r else 0
                    pg.wait_for_timeout(2000)          # let the SPA hydrate
                    html = pg.content()
                    # Reported, never inferred. «ريال» is the price marker; «غير موجود» the not-found.
                    notfound = ("غير موجود" in html)
                    riyal = html.count("ريال")
                    title = (pg.title() or "")[:40]
                    rows.append((label, status, len(html), notfound, riyal))
                    print(f"  {label:11} {ident:22} status={status:<4} html={len(html):<7} "
                          f"notfound_ar={str(notfound):<5} riyal={riyal:<4} title={title!r}")
                except Exception as e:
                    rows.append((label, -1, 0, None, 0))
                    print(f"  {label:11} {ident:22} ERR {repr(e)[:80]}")
        b.close()

    def real(label):
        return sum(1 for l, s, n, nf, r in rows if l == label and s == 200 and not nf and r > 0)

    print(f"\nSUMMARY  ALIVE_FEED real-listing={real('ALIVE_FEED')}/{len(ALIVE_FEED)}  "
          f"ABSENT_408 real-listing={real('ABSENT_408')}/{len(ABSENT_408)}  "
          f"BOGUS real-listing={real('BOGUS')}/{len(BOGUS)}")
    print("\nREAD IT, DO NOT INFER:\n"
          "  * a usable DIRECT oracle needs ALIVE to render a real listing AND BOGUS not to.\n"
          "  * BOGUS rendering like ALIVE means a 200 proves nothing here — run #85 already\n"
          "    measured that shape on this host — and the browser cannot kill either.\n"
          "  * ABSENT_408 is REPORTED, never adjudicated. Those rows stay UNKNOWN.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
