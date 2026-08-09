"""READ-ONLY probe: what does aqar actually publish for price and rent period?

Answers one question with evidence, and writes nothing: for a cohort of live aqar listings,
compare four views of the same listing side by side —

  1. aqar's STRUCTURED keys (the RSC `listing` object: price, price_type, meter_price, …)
  2. the RENDERED price slot (the «N §/سنوي» text the human sees)
  3. what the CURRENT parser produces (enrich_residential)
  4. what our DATABASE holds today

Any disagreement between (1)/(2) and (3)/(4) is a pipeline defect. Agreement between (1) and (2)
that disagrees with (4) means our stored value is stale or was mis-parsed. The probe never decides
which is right — it prints the evidence so a human can.

Must run where aqar serves real pages (GitHub Actions); a laptop gets a 241 KB app shell.

Usage:
  python -m scrapers.aqar.probe_price --ads 6668912,6609974,6663318
  python -m scrapers.aqar.probe_price --deal rent --type apartment --limit 60 --schema-keys
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import threading
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any, Optional

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT.parent) not in sys.path:
    sys.path.insert(0, str(ROOT.parent))

from scrapers.common import db, normalize as N  # noqa: E402
from scrapers.aqar import enrich_residential as ER  # noqa: E402

TABLE = "aqar_residential_listings"
TYPE_TO_SLUG = {v: k for k, v in N.SLUG_TO_TYPE.items()}

# Keys worth reporting if aqar publishes them. Matched as substrings so a renamed field still shows.
_PRICE_KEY_HINTS = ("price", "rent", "period", "duration", "monthly", "yearly", "annual", "meter")

# The rendered price slot: a number followed by the billing-period word. Captured verbatim.
_RENDERED = re.compile(r"([\d][\d,]{2,})\s*[§ر﷼]?\s*/?\s*(سنوي\w*|شهري\w*|يومي\w*|أسبوعي\w*)")


COLS = ("ad_number, listing_url, property_type, transaction_type, price_annual, price_total, "
        "price_per_meter, rent_period, area_m2, active")


def cohort(ads: list[str], deal: Optional[str], ptype: Optional[str], limit: int) -> list[dict[str, Any]]:
    q = db.sb().table(TABLE).select(COLS)
    if ads:
        return q.in_("ad_number", ads).execute().data or []
    q = q.eq("active", True).not_.is_("listing_url", "null")
    if deal:
        q = q.eq("transaction_type", "Rent" if deal == "rent" else "Buy")
    if ptype:
        q = q.eq("property_type", ptype)
    return q.limit(limit).execute().data or []


def probe_one(row: dict[str, Any], dump_keys: bool) -> Optional[dict[str, Any]]:
    slug = TYPE_TO_SLUG.get(row.get("property_type") or "")
    deal_slug = "rent" if row.get("transaction_type") == "Rent" else "buy"
    if not slug or not row.get("listing_url"):
        return None
    r = ER.get(row["listing_url"])
    if r is None:
        return None
    html = r.text
    obj = ER._listing_json(html) or {}
    structured = {k: v for k, v in obj.items()
                  if any(h in k.lower() for h in _PRICE_KEY_HINTS) and not isinstance(v, (dict, list))}
    text = ER._html_to_text(html)
    rendered = [f"{m.group(1)} {m.group(2)}" for m in _RENDERED.finditer(
        text.split(ER._AGE_BLOCK_ANCHOR, 1)[0] if ER._AGE_BLOCK_ANCHOR in text else text)][:4]
    parsed = ER.enrich_residential(row["listing_url"], type_slug=slug, deal_slug=deal_slug) or {}
    # Is the listing still open? A closed/expired ad keeps its JSON price but stops displaying it,
    # so liveness has to be read alongside the price or the two get confused.
    state = {k: obj.get(k) for k in ("status", "closed", "published", "rent_period_text")}
    # The first 400 chars of the page's own prefix — what the human actually sees above the fold.
    head = re.sub(r"\s+", " ", (text.split(ER._AGE_BLOCK_ANCHOR, 1)[0] if ER._AGE_BLOCK_ANCHOR in text
                                else text))[:400]
    out = {
        "ad": row["ad_number"],
        "state": state,
        "head": head,
        "aqar_structured": structured,
        "aqar_rendered": rendered,
        "parser": {k: parsed.get(k) for k in
                   ("price_annual", "price_total", "price_per_meter", "rent_period", "area_m2")},
        "db": {k: row.get(k) for k in
               ("price_annual", "price_total", "price_per_meter", "rent_period", "area_m2")},
    }
    if dump_keys:
        out["all_keys"] = sorted(obj.keys())
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--ads", default="", help="comma-separated ad numbers")
    ap.add_argument("--deal", choices=["rent", "buy"])
    ap.add_argument("--type", dest="ptype")
    ap.add_argument("--limit", type=int, default=40)
    ap.add_argument("--workers", type=int, default=4)
    ap.add_argument("--schema-keys", action="store_true",
                    help="also dump every key of the first listing object (schema discovery)")
    a = ap.parse_args()

    ads = [s.strip() for s in a.ads.split(",") if s.strip()]
    rows = cohort(ads, a.deal, a.ptype, a.limit)
    print(f"probing {len(rows)} listings", flush=True)

    results: list[dict[str, Any]] = []
    lock = threading.Lock()
    first = [a.schema_keys]

    def work(r: dict[str, Any]) -> None:
        want_keys = False
        with lock:
            if first[0]:
                want_keys, first[0] = True, False
        res = probe_one(r, want_keys)
        with lock:
            if res is None:
                print(f"  ✗ unfetchable ad={r['ad_number']}", flush=True)
                return
            results.append(res)
            print(json.dumps(res, ensure_ascii=False), flush=True)

    with ThreadPoolExecutor(max_workers=a.workers) as pool:
        list(pool.map(work, rows))

    # Summary: how often does the parser disagree with what aqar renders / publishes?
    disagree = [r for r in results
                if r["parser"].get("price_annual") != r["db"].get("price_annual")
                or r["parser"].get("rent_period") != r["db"].get("rent_period")]
    monthly_rendered = [r for r in results
                        if any("شهري" in s for s in r["aqar_rendered"])]
    no_period_rendered = [r for r in results if not r["aqar_rendered"]]
    print(f"\nfetched={len(results)} parser_vs_db_differs={len(disagree)} "
          f"rendered_MONTHLY={len(monthly_rendered)} rendered_NO_PERIOD={len(no_period_rendered)}",
          flush=True)
    for r in monthly_rendered:
        print(f"  MONTHLY-at-source ad={r['ad']} rendered={r['aqar_rendered']} "
              f"db={r['db']} parser={r['parser']}", flush=True)
    for r in no_period_rendered:
        print(f"  NO-PERIOD-at-source ad={r['ad']} db={r['db']} parser={r['parser']} "
              f"structured={r['aqar_structured']}", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
