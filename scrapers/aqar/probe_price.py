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

#: What a lone `null` in this probe's output would destroy.
#:
#: `enrich_residential` emits `db.AUTHORITATIVE_NULL` — not None — when aqar ITSELF states a listing
#: has no price («طلب تسويق», `published:false`). That sentinel is the whole SOURCE IS TRUTH
#: distinction in one object: "the source says there is no value" versus "we could not read one".
#: `json.dumps` cannot encode it, so every probe of such a listing died with
#: `TypeError: Object of type _AuthoritativeNull is not JSON serializable` — and those are precisely
#: the listings a price dispute is about, so the instrument was broken exactly where it was needed
#: (found 2026-09-22 adjudicating two extreme price-per-m² rows; the run failed in 21 seconds).
#:
#: Encoding it as `null` would have been worse than the crash: the reader could no longer tell an
#: authoritative absence from a failed read, which is the one question this probe exists to answer.
#: So it gets its own visible token, and anything else unencodable still raises rather than being
#: quietly stringified into evidence nobody can trust.
AUTHORITATIVE_NULL_JSON = "AUTHORITATIVE_NULL"


def _json_default(o: Any) -> str:
    if isinstance(o, db._AuthoritativeNull):
        return AUTHORITATIVE_NULL_JSON
    raise TypeError(f"Object of type {o.__class__.__name__} is not JSON serializable")


def _dump(obj: Any) -> str:
    return json.dumps(obj, ensure_ascii=False, default=_json_default)


def _settled(v: Any) -> Any:
    """Collapse an authoritative absence onto NULL — but only for COMPARISON, never for output.

    AUTHORITATIVE_NULL and a stored NULL are the same OUTCOME ("this listing has no price"), so the
    disagreement summary must treat them as equal or it reports the parser and the database as
    differing precisely when they agree — on the very cohort this probe is most often pointed at.
    The JSON above keeps them distinct, because there the question is not the outcome but WHO SAID SO.
    """
    return None if isinstance(v, db._AuthoritativeNull) else v


def _differs(r: dict[str, Any], field: str) -> bool:
    return _settled(r["parser"].get(field)) != _settled(r["db"].get(field))
TYPE_TO_SLUG = {v: k for k, v in N.SLUG_TO_TYPE.items()}

# Keys worth reporting if aqar publishes them. Matched as substrings so a renamed field still shows.
_PRICE_KEY_HINTS = ("price", "rent", "period", "duration", "monthly", "yearly", "annual", "meter")

# The SIZE half of the same question (routine #3, 2026-09-23). `aqar_structured` above filters the
# payload to price-ish keys, so an AREA dispute was structurally unanswerable by this tool: it would
# print the parser's area and the DB's area — which agree, because one produced the other — and
# nothing about what aqar itself published. That is the same shape as the TypeError this script
# carried on 2026-09-22: the instrument was blind on exactly the cohort a dispute is about.
#
# Found by 6 active rows (3 residential, 3 commercial) whose area_m2 EQUALS their price to the riyal
# — ad 6528840 «غرفة» area 1500 beside 1,500 SAR/yr, 6500587 «استراحة» 2500/2500, 6496996 «مستودع»
# 10000/10000. The price on all three is source-confirmed (aqar publishes price_text "1,500" and
# rent_period_text «سنوي»), so the suspect is the area — but "suspect" is not proof, and
# DATA_INTEGRITY_ENGINEER.md forbids repairing anything Ezhalah cannot be PROVEN to have broken.
# These keys are what settles it: `area` is the first alias enrich_listing() tries, so seeing its
# raw value says whether aqar published that number or whether our alias hunt produced it.
_SIZE_KEY_HINTS = ("area", "size", "space", "length", "width", "deed_area")

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
    # Raw, unjudged: what aqar itself publishes for size. Printed verbatim (including a null or a
    # missing key) so "the source says nothing here" and "the source says 1500" stay distinguishable
    # — a missing field is never read as an answer.
    size_source = {k: v for k, v in obj.items()
                   if any(h in k.lower() for h in _SIZE_KEY_HINTS) and not isinstance(v, (dict, list))}
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
        "aqar_size_source": size_source,
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
            print(_dump(res), flush=True)

    with ThreadPoolExecutor(max_workers=a.workers) as pool:
        list(pool.map(work, rows))

    # Summary: how often does the parser disagree with what aqar renders / publishes?
    disagree = [r for r in results
                if _differs(r, "price_annual") or _differs(r, "rent_period")]
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
