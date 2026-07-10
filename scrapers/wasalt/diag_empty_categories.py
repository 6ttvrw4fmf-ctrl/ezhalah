"""READ-ONLY live diagnostic: confirm how the recurring 'empty' Wasalt categories actually respond
through the production Saudi proxy (DataImpulse), using the SAME curl_cffi chrome124 session as the
real sweep. Writes NOTHING to the database — it only fetches, inspects the raw response shape, and
prints the classifier's verdict. (owner 2026-07-10; temporary — remove before merge.)

Run in CI (where WASALT_PROXY_URL is injected):
    python -m scrapers.wasalt.diag_empty_categories
"""
from __future__ import annotations

import json

from scrapers.wasalt.run import (
    BASE, NEXT_RE, REASON_OK, fetch_page, session,
)

# The 4 niches that fail every cycle (should be legitimately empty) + 1 known-populated control.
# The control PROVES the proxy is alive: if it comes back reached-with-listings while the niches come
# back reached-with-count-0, that is airtight proof the zeros are real emptiness, not a dead proxy.
TARGETS = [
    ("rent", "residential", "farm",      "farm-rent"),
    ("sale", "residential", "farm",      "farm-sale"),
    ("rent", "residential", "chalet",    "chalet-rent"),
    ("rent", "commercial",  "office",    "office-rent"),
    ("sale", "residential", "apartment", "apartment-sale (CONTROL, expect listings)"),
]


def raw_probe(s, deal, cat, slug):
    """Independent of the classifier: report the RAW response shape so we can see with our own eyes
    whether Wasalt returns a valid searchResult object with count=0."""
    seg = "sale" if deal == "sale" else "rent"
    url = (f"{BASE}/en/{seg}/search?propertyFor={deal}&countryId=1&type={cat}"
           f"&propertyTypeData={slug}&page=1")
    try:
        r = s.get(url, timeout=30)
    except Exception as e:
        return {"status": None, "has_next_data": False, "searchResult_is_dict": False,
                "raw_count": None, "error": str(e)[:160]}
    out = {"status": r.status_code, "has_next_data": False,
           "searchResult_is_dict": False, "raw_count": None, "error": ""}
    m = NEXT_RE.search(r.text)
    out["has_next_data"] = bool(m)
    if not m:
        return out
    try:
        data = json.loads(m.group(1))
    except Exception as e:
        out["error"] = f"bad_json: {str(e)[:100]}"
        return out
    sr = (data.get("props") or {}).get("pageProps", {}).get("searchResult")
    out["searchResult_is_dict"] = isinstance(sr, dict)
    if isinstance(sr, dict):
        out["raw_count"] = sr.get("count")
    return out


def verdict(pr) -> str:
    if pr.ok and pr.count == 0:
        return "✅ EMPTY CATEGORY (reached, count=0)"
    if pr.ok:
        return f"✅ REACHED — {pr.count} listings"
    return f"❌ REAL FAILURE ({pr.reason}: {pr.detail})"


def main() -> int:
    s = session()
    print("=" * 78)
    print("WASALT LIVE EMPTY-CATEGORY DIAGNOSTIC (through production Saudi proxy)")
    print("=" * 78)
    any_fetched_none_but_reached = True
    for deal, cat, slug, label in TARGETS:
        raw = raw_probe(s, deal, cat, slug)
        pr = fetch_page(s, deal, cat, slug, 1)
        print(f"\n▶ {label}")
        print(f"   raw : status={raw['status']}  __NEXT_DATA__={raw['has_next_data']}  "
              f"searchResult_is_dict={raw['searchResult_is_dict']}  raw_count={raw['raw_count']}"
              + (f"  err={raw['error']}" if raw['error'] else ""))
        print(f"   pr  : ok={pr.ok}  reason={pr.reason}  count={pr.count}  "
              f"total_pages={pr.total_pages}  props={len(pr.props)}"
              + (f"  detail={pr.detail}" if pr.detail else ""))
        print(f"   ==> {verdict(pr)}")
    print("\n" + "=" * 78)
    print("If the 4 niches show reason=ok/count=0 AND the control shows listings, the recurring")
    print("failures are GENUINELY empty and the fix will turn them ✅ green. Any niche showing a")
    print("non-ok reason (no_next_data / http_error / etc.) was a REAL block and correctly stays ❌.")
    print("=" * 78)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
