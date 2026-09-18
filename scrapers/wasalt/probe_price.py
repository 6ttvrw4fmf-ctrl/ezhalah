"""Read-only price-source probe: what does wasalt ACTUALLY publish for these listings?

Exists because adjudicating "is this price ours or theirs?" is a recurring job in this repo
(`ops_price_source_verified`), and the only honest answer is the source payload itself. AGENTS.md
§19 and the resolved comment in `run.py` both record the same trap: a divide-by-N that lands on a
plausible band is NOT evidence. wasalt's own `averageSalePricePerSqm` and its own description prose
ARE — so this prints them verbatim next to `salePrice`, and computes nothing.

NO DATABASE WRITES. NO DATABASE READS. Diagnosis only — it takes URLs and prints what came back,
so it can never be the thing that corrupts the data it was run to adjudicate.

Needs WASALT_PROXY_URL + WASALT_BROWSER=1; dispatch `wasalt-price-probe.yml` (only CI holds the
proxy secret). Usage: python -m scrapers.wasalt.probe_price <url> [<url> ...]
"""
from __future__ import annotations

import json
import re
import sys


def _prose(html: str | None) -> str:
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", html or "")).strip()


def report(url: str, data: dict | None) -> None:
    print("=" * 78)
    print(url)
    if data is None:
        # None is "no parseable answer" (see browser.next_data) — a challenge shell, never an
        # empty result. Say so loudly: silence here must not be read as "no price published".
        print("  !! NO __NEXT_DATA__ — blocked or changed shape. NOT evidence of anything.")
        return
    pp = data.get("props", {}).get("pageProps", {}) or {}
    # The detail page carries propertyInfo directly; a search page carries it per property.
    info = pp.get("propertyInfo") or (pp.get("propertyDetail") or {}).get("propertyInfo") or {}
    if not info:
        print(f"  !! no propertyInfo. pageProps keys: {sorted(pp.keys())[:14]}")
        return
    for k in ("salePrice", "conversionPrice", "averageSalePricePerSqm", "currencyType",
              "conversionUnit", "expectedRent", "rentFreq", "unitType", "title"):
        if k in info:
            print(f"  {k:24} = {info[k]!r}")
    attrs = [a for a in (data.get("props", {}).get("pageProps", {}).get("attributes") or [])]
    if attrs:
        print(f"  {'attributes':24} = {[(a.get('key'), a.get('value')) for a in attrs]}")
    print(f"  {'description':24} = {_prose(info.get('description'))[:400]}")


def main() -> int:
    urls = sys.argv[1:]
    if not urls:
        print(__doc__)
        return 2
    from scrapers.wasalt import browser as b
    if not b.browser_enabled():
        print("WASALT_BROWSER is not set — refusing to probe over the blocked plain-HTTP path.")
        return 2
    br = b.BrowserFetcher()
    try:
        for u in urls:
            report(u, br.next_data(u))
    finally:
        br.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
