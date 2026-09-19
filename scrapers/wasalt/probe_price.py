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


def _find_price_dict(node: object, depth: int = 0) -> dict | None:
    """Last-resort: any nested dict carrying salePrice, wherever wasalt moved it to."""
    if depth > 8:
        return None
    if isinstance(node, dict):
        if "salePrice" in node:
            return node
        for v in node.values():
            hit = _find_price_dict(v, depth + 1)
            if hit is not None:
                return hit
    elif isinstance(node, list):
        for v in node[:40]:
            hit = _find_price_dict(v, depth + 1)
            if hit is not None:
                return hit
    return None


def report(url: str, data: dict | None) -> None:
    print("=" * 78)
    print(url)
    if data is None:
        # None is "no parseable answer" (see browser.next_data) — a challenge shell, never an
        # empty result. Say so loudly: silence here must not be read as "no price published".
        print("  !! NO __NEXT_DATA__ — blocked or changed shape. NOT evidence of anything.")
        return
    pp = data.get("props", {}).get("pageProps", {}) or {}
    # enrich_ar.py reads the detail page from propertyDetailsV3; fall back to a search-shaped
    # payload, then to a blind walk, so a moved key costs a comment and not another dispatch.
    pdv = pp.get("propertyDetailsV3") or {}
    info = pdv.get("propertyInfo") or pp.get("propertyInfo") or _find_price_dict(pp) or {}
    if not info:
        print(f"  !! no salePrice anywhere. pageProps keys: {sorted(pp.keys())[:14]}")
        return
    for k in ("salePrice", "conversionPrice", "averageSalePricePerSqm", "currencyType",
              "conversionUnit", "expectedRent", "rentFreq", "unitType", "title"):
        if k in info:
            print(f"  {k:24} = {info[k]!r}")
    attrs = pdv.get("attributes") or data.get("attributes") or []
    if attrs:
        print(f"  {'attributes':24} = {[(a.get('key'), a.get('value')) for a in attrs if isinstance(a, dict)]}")
    print(f"  {'description':24} = {_prose(info.get('description'))[:400]}")


def _selftest() -> int:
    """The walk picks WHICH number gets adjudicated, so prove it picks the right one."""
    real = {"salePrice": 26250000000, "averageSalePricePerSqm": 25000000}
    # Nested exactly as wasalt nests it, with a decoy dict in front that has no salePrice.
    payload = {"props": {"pageProps": {"searchFilters": {"maxPrice": 99},
                                       "propertyDetailsV3": {"propertyInfo": real}}}}
    pp = payload["props"]["pageProps"]
    assert _find_price_dict(pp) is real, "walk must return the dict that HAS salePrice"
    assert _find_price_dict({"a": {"b": {"c": 1}}}) is None, "no salePrice anywhere → None"
    assert _find_price_dict({"salePrice": 1}) == {"salePrice": 1}, "top-level hit"
    # A payload deeper than the depth cap must fail CLOSED (None), never a wrong dict.
    deep = {"salePrice": 7}
    for _ in range(12):
        deep = {"x": deep}
    assert _find_price_dict(deep) is None, "over-deep must return None, not a wrong answer"
    assert _prose("<p>سعرها 26250000000 ر.س</p>") == "سعرها 26250000000 ر.س"
    print("probe_price selftest: ok")
    return 0


def main() -> int:
    if "--selftest" in sys.argv:
        return _selftest()
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
