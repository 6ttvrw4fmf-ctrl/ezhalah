"""Advanced Filter score — the 🔬 engineer's computed rating (docs/ops/ADVANCED_FILTER_ENGINEER.md, "Your score").

Same shape as new_listings_score.py and it IMPORTS its comparison (compare_listing, fold, af_precision,
af_recall) rather than copying it. The sample is production-ready listings first seen MORE than 24 hours
ago (the 🆕 engineer owns the newer ones): 10 per big website, 5 per small one.

  precision   of the yes/no answers we serve that the original ad can judge, the share the ad agrees with
  capture     of the fields the ad itself states, the share we store (not NULL)
  findability the customer's request: the listing's deal, city, district, type + up to two Advanced Filter
              answers its ad really states, sent through the PUBLIC anon RPC the app uses
              (location_search_candidates_ar). Found in the results = found.
  parity      NOT measured by this module yet (customer-journey.mjs --mode af proves it per journey)

A page we could not read and a field the ad does not state are never wrong (silent means unknown). A
findability request whose result set was cut by the row cap is undecided, never a miss.

Writes one row per website per night into ops_af_score (until the table exists it prints and exits 0).
Evidence is "source_table:id" keys only (PDPL).

  python -m scrapers.common.af_score --sites aqar --per-site 3 --dry-run --json
"""
from __future__ import annotations

import argparse
import json
import os
import random
import re
import sys
import time
from collections import defaultdict
from datetime import datetime, timedelta, timezone

from scrapers.common.cleanup import _probe
from scrapers.common.db import sb
from scrapers.common.new_listings_score import (
    AF_FIELDS, FIELDS, MATCH, NEG, STORED, UNREADABLE, WE_MISS, af_precision, af_recall, compare_listing,
    empty_row, fold, norm,
)
from scrapers.common.source_reread import page_evidence

TABLE = "ops_af_score"
PAGE = 1000
BIG_SITE = 200               # a website with 200+ older production-ready listings is big
N_BIG, N_SMALL = 10, 5
PACE_S = 1.0
RPC_LIMIT = 5000             # location_search_candidates_ar p_limit; a result this large is undecided
MAX_ANSWERS = 2              # Advanced Filter answers asked per findability request
MIN_AGE_H = 24

# Advanced Filter amenity answers: stored column -> the anon RPC's English slug (amenity params are slugs).
AMENITY_SLUG = {"elevator": "elevator", "parking": "parking", "kitchen": "kitchen", "air_conditioner": "ac",
                "maid_room": "maid_room", "driver_room": "driver_room", "private_entrance": "private_entrance"}
FURNISHED = "furnished"
BOOL_KW = {n: kw for n, k, _, kw in FIELDS if k == "bool"}
RENT = ("إيجار", "ايجار")      # search_listings_ar stores «إيجار»; the bare spelling never matched it
MONTHLY = "شهري"
# Site chrome, not the ad: a short category link such as «مواقف سيارات للإيجار» / «شقق للبيع» sits in every
# aqar page's navigation, so it says nothing about THIS listing (norm() has already folded hamza).
CHROME = re.compile(r"^(?:\S+\s){0,3}(?:للايجار|للبيع)$")
# An EMPTY label («موقف السيارة :», «التكييف :») is printed on every tuba / ksaaqar page whatever the
# answer — the value sits elsewhere, or nowhere. A label is not a statement.
BARE_LABEL = re.compile(r"^[^:]{1,30}:$")


def page_lines(page: dict) -> list[str]:
    ls = [norm(x) for x in ([page.get("title") or ""] + list((page.get("meta") or {}).values())
                            + (page.get("evidence_lines") or []) + (page.get("text_head") or "").split(" | "))]
    return [x for x in ls if x and not CHROME.match(x) and not BARE_LABEL.match(x)]


# A line printed on EVERY sampled page of one website is that website's template, not any one ad: its
# menu («أجهزة مطبخ», «مكيفات هواء» on opensooq), a services strip («موقف سيارة» on superoffice), or
# feature art shared by all projects («موقف خاص» on hasaad, beside a district none of them is in).
# Measured 2026-10-06 (source-reread 37445697709): each produced a 5/5 «we miss» that no parser could
# fix. Applied only with TEMPLATE_MIN_PAGES readable pages, so two ads that happen to agree stay ads.
TEMPLATE_MIN_PAGES = 3


def template_lines(pages: list[list[str]]) -> set[str]:
    readable = [set(p) for p in pages if p]
    if len(readable) < TEMPLATE_MIN_PAGES:
        return set()
    return set.intersection(*readable)


def page_says_yes(lines: list[str], field: str) -> bool:
    """The ad itself names the amenity and does not negate it («مصعد» yes, «لا يوجد مصعد» no)."""
    kw = BOOL_KW[field]
    hit = [x for x in lines if re.search(kw, x)]
    return bool(hit) and not all(re.search(NEG + "(?:" + kw + ")", x) for x in hit)


def customer_answers(lines: list[str], results: dict[str, str]) -> list[str]:
    """Advanced Filter answers the ad really states as YES: the ones a customer would ask for. Both a stored
    true (does the filter find it) and a stored NULL (the trapping failure) qualify; a stored false never
    does, the customer asking for it would be excluding the ad correctly or the ad disagrees (precision)."""
    cols = [c for c in (*AMENITY_SLUG, FURNISHED) if results.get(c) in (MATCH, WE_MISS) and page_says_yes(lines, c)]
    return cols[:MAX_ANSWERS]


def offered(answers: list[str], stored: dict) -> list[str]:
    """Only answers a customer can actually give in this listing's scope. The Advanced Filter never asks
    «furnished» on a Monthly search (src/lib/afCohorts.ts: no RentMonthly cohort lists it), so a request
    carrying it is not a customer's request and its miss is not a customer's miss."""
    if stored.get("rent_period_ar") == MONTHLY:
        return [a for a in answers if a != FURNISHED]
    return answers


def rpc_params(stored: dict, answers: list[str]) -> dict | None:
    if not (stored.get("deal_ar") and stored.get("city_ar") and stored.get("type_ar")):
        return None
    p: dict = {"p_deal": stored["deal_ar"], "p_cities": [stored["city_ar"]], "p_types": [stored["type_ar"]],
               "p_limit": RPC_LIMIT, "p_offset": 0}
    if stored.get("district_ar"):
        p["p_districts"] = [stored["district_ar"]]
    if stored.get("deal_ar") in RENT and stored.get("rent_period_ar"):
        p["p_rent_period"] = stored["rent_period_ar"]
    slugs = [AMENITY_SLUG[a] for a in answers if a in AMENITY_SLUG]
    if slugs:
        p["p_amenities"] = slugs
    if FURNISHED in answers:
        p["p_furnished"] = True
    return p


def findable(rows: list[dict] | None, source_table: str, listing_id: int) -> bool | None:
    """True found / False not found / None undecided (no answer, or the row cap cut the list)."""
    if rows is None:
        return None
    if any(r.get("source_table") == source_table and int(r.get("listing_id")) == int(listing_id) for r in rows):
        return True
    return None if len(rows) >= RPC_LIMIT else False


# Keys under propertyDetailsV3 that can hold a person or a contact: never read (PDPL).
_WASALT_SKIP = re.compile(r"agent|broker|owner|advertiser|user|phone|mobile|whats|email|contact|licen|\bid$|_id$|uuid",
                          re.I)


def wasalt_page(url: str, fetch=None) -> dict | None:
    """A wasalt listing read like any other ad, through the browser path wasalt requires.

    cleanup._probe() answers a live wasalt page with (200, "") by design: liveness needs only the status,
    so the body is dropped — which made every wasalt page «unreadable» here (ops_af_score 2026-10-04 and
    10-05: 5/5 and 10/10). The page's own __NEXT_DATA__ (propertyDetailsV3) is the ad: its text values
    become the evidence lines our comparison reads. Contact/agent keys are skipped. None = unreadable."""
    if fetch is None:
        from scrapers.common.cleanup import _wasalt_browser, _wasalt_browser_enabled
        if not _wasalt_browser_enabled():
            return None
        fetch = _wasalt_browser().page_data
    try:
        data, status, _n = fetch(url)
    except Exception:  # noqa: BLE001 — a failed read is unknown, never wrong
        return None
    pd = (((data or {}).get("props") or {}).get("pageProps") or {}).get("propertyDetailsV3")
    if status != 200 or not isinstance(pd, dict):
        return None
    texts: list[str] = []

    def walk(node, key: str = "") -> None:
        if key and _WASALT_SKIP.search(key):
            return
        if isinstance(node, dict):
            for k, v in node.items():
                walk(v, str(k))
        elif isinstance(node, list):
            for x in node:
                walk(x, key)
        elif isinstance(node, str) and node.strip():
            texts.extend(x.strip() for x in node.splitlines() if x.strip())

    walk(pd)
    return {"title": next((t for t in texts if re.search(r"[ء-ي]", t)), None), "meta": {}, "jsonld": [],
            "evidence_lines": texts[:200], "text_head": " | ".join(texts)[:1500]}


def is_wasalt(url: str) -> bool:
    return "wasalt.sa" in url or "wasalt.com" in url


def anon_client():
    """The customer's path: the public anon key, never the service key (trap 10)."""
    from supabase import create_client
    url = os.environ["SUPABASE_URL"]
    key = os.environ.get("SUPABASE_ANON_KEY") or os.environ.get("EXPO_PUBLIC_SUPABASE_ANON_KEY") or ""
    return create_client(url, key) if key else None


def ask(anon, params: dict) -> list[dict] | None:
    try:
        return anon.rpc("location_search_candidates_ar", params).execute().data or []
    except Exception:  # noqa: BLE001 — a failed request says nothing about the listing
        return None


def new_row(night: str, platform: str, **kw) -> dict:
    row = empty_row(night, platform, find_tried=0, find_found=0, find_missed_ids=[], **kw)
    return row


def _all(q) -> list[dict]:
    out: list[dict] = []
    lo = 0
    while True:
        rows = q.range(lo, lo + PAGE - 1).execute().data or []
        out += rows
        if len(rows) < PAGE:
            return out
        lo += PAGE


def older_listings(client, hours: int = MIN_AGE_H) -> dict[str, list[tuple[str, int]]]:
    before = (datetime.now(timezone.utc) - timedelta(hours=hours)).isoformat()
    out: dict[str, list[tuple[str, int]]] = defaultdict(list)
    # one platform at a time keeps each answer small
    for p in sorted({r["platform"] for r in _all(client.table("ops_platform_liveness_coverage").select("platform"))}):
        q = (client.table("search_listings_ar").select("source_table,listing_id", count="exact")
             .eq("platform", p).eq("production_ready", True).lt("first_seen_at", before))
        n = q.limit(1).execute().count or 0
        # PostgREST returns at most PAGE rows: read one page from a random offset so the sample is not
        # biased toward the lowest ids on a big website.
        lo = random.randrange(max(1, n - PAGE + 1)) if n > PAGE else 0
        rows = q.order("listing_id").range(lo, lo + PAGE - 1).execute().data or []
        out[p] = [(r["source_table"], int(r["listing_id"])) for r in rows]
    return {p: v for p, v in out.items() if v}


def sample_size(n: int, per_site: int | None) -> int:
    if per_site:
        return min(per_site, n)
    return N_BIG if n >= BIG_SITE else min(N_SMALL, n)


def score_site(client, anon, platform: str, picks: list[tuple[str, int]], *, night: str,
               pace: float = PACE_S, probe=None, wasalt=wasalt_page) -> dict:
    probe = probe or _probe
    row = new_row(night, platform)
    last = 0.0
    read: list[tuple[str, int, dict, dict]] = []
    for table, rid in picks:
        stored = (client.table("search_listings_ar").select(STORED).eq("source_table", table)
                  .eq("listing_id", rid).limit(1).execute().data or [{}])[0]
        url = (client.table(table).select("listing_url").eq("id", rid).limit(1).execute().data or [{}])[0].get("listing_url")
        if not url:
            row["sampled"] += 1
            row["unreadable_pages"] += 1
            continue
        time.sleep(max(0.0, last + pace - time.monotonic()))
        last = time.monotonic()
        if is_wasalt(url) and wasalt is not None:
            page = wasalt(url)
        else:
            try:
                status, body = probe(url)
            except Exception:  # noqa: BLE001
                status, body = None, ""
            page = page_evidence(body) if status == 200 and body else None
        if page is None:
            row["sampled"] += 1
            row["unreadable_pages"] += 1
            continue
        read.append((table, rid, stored, page))
    # Second pass: the website's template is known only once every page of the sample has been read.
    chrome = template_lines([page_lines(pg) for _, _, _, pg in read])
    for table, rid, stored, page in read:
        key = f"{table}:{rid}"
        results = compare_listing(stored, page, skip_price=False)
        af_only = {k: v for k, v in results.items() if k in AF_FIELDS}
        fold(row, key, af_only, stored)
        ad_lines = [x for x in page_lines(page) if x not in chrome]
        answers = offered(customer_answers(ad_lines, af_only), stored)
        params = rpc_params(stored, answers) if anon is not None and answers else None
        if params:
            verdict = findable(ask(anon, params), table, rid)
            if verdict is not None:
                row["find_tried"] += 1
                if verdict:
                    row["find_found"] += 1
                else:
                    row["find_missed_ids"].append(key)
    if row["unreadable_pages"]:
        row["note"] = f"{row['unreadable_pages']} page(s) unreadable (never counted as wrong)"
    return row


def findability(row: dict) -> float | None:
    return row["find_found"] / row["find_tried"] if row["find_tried"] else None


def _pct(v: float | None) -> str:
    return "n/a" if v is None else f"{100 * v:.1f}%"


def _line(r: dict) -> str:
    return (f"{r['platform']}: sampled={r['sampled']} findability={_pct(findability(r))} "
            f"({r['find_found']}/{r['find_tried']}) precision={_pct(af_precision(r))} "
            f"capture={_pct(af_recall(r))} parity=not-measured misses={len(r['find_missed_ids'])}"
            + (f" | {r['note']}" if r["note"] else ""))


def write_rows(client, rows: list[dict]) -> str:
    payload = [{
        "night": r["night"], "platform": r["platform"], "sampled": r["sampled"], "fields": r["fields"],
        "find_tried": r["find_tried"], "find_found": r["find_found"],
        "af_claimed": r["af_claimed"], "af_agree": r["af_agree"],
        "af_page_states": r["af_page_states"], "af_captured": r["af_captured"],
        "mismatch_ids": r["mismatch_ids"], "find_missed_ids": r["find_missed_ids"], "note": r["note"],
    } for r in rows]
    try:
        client.table(TABLE).upsert(payload, on_conflict="night,platform").execute()
    except Exception as e:  # noqa: BLE001
        text = str(e)
        if TABLE in text and ("PGRST205" in text or "42P01" in text or "not find" in text):
            return f"{TABLE} does not exist yet: rows printed only"
        raise
    return f"wrote {len(rows)} rows to {TABLE}"


def fleet_totals(rows: list[dict]) -> dict:
    t = lambda k: sum(r[k] for r in rows)  # noqa: E731
    r_ = lambda a, b: (a / b) if b else None  # noqa: E731
    return {"findability": r_(t("find_found"), t("find_tried")), "precision": r_(t("af_agree"), t("af_claimed")),
            "capture": r_(t("af_captured"), t("af_page_states")), "find_tried": t("find_tried"),
            "find_found": t("find_found"), "sampled": t("sampled")}


def main() -> int:
    ap = argparse.ArgumentParser(description="Advanced Filter score: the nightly measurement")
    ap.add_argument("--sites", nargs="*")
    ap.add_argument("--per-site", type=int, default=None)
    ap.add_argument("--pace", type=float, default=PACE_S)
    ap.add_argument("--seed", type=int, default=None)
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()

    client, anon = sb(), anon_client()
    if anon is None:
        print("WARNING: no SUPABASE_ANON_KEY — findability NOT measured tonight (precision/capture still are)")
    rng = random.Random(a.seed)
    night = datetime.now(timezone.utc).date().isoformat()
    older = older_listings(client)
    rows: list[dict] = []
    for p in a.sites or sorted(older):
        picks = older.get(p) or []
        if not picks:
            rows.append(new_row(night, p, note="no older production-ready listings"))
            continue
        try:
            row = score_site(client, anon, p, rng.sample(picks, sample_size(len(picks), a.per_site)),
                             night=night, pace=a.pace)
        except Exception as e:  # noqa: BLE001 — one website failing never stops the fleet
            row = new_row(night, p, note=f"error: {type(e).__name__}: {e}"[:300])
        rows.append(row)
        print(_line(row), flush=True)
    try:
        from scrapers.common.cleanup import _close_wasalt_browser
        _close_wasalt_browser()
    except Exception:  # noqa: BLE001 — closing a browser that never opened is not an error
        pass
    out = {"night": night, "fleet": fleet_totals(rows), "sites": rows,
           "written": "dry run: nothing written" if a.dry_run else write_rows(client, rows)}
    if a.json:
        print(json.dumps(out, ensure_ascii=False, indent=1, default=str))
    else:
        f = out["fleet"]
        print(f"fleet: findability={_pct(f['findability'])} ({f['find_found']}/{f['find_tried']}) "
              f"precision={_pct(f['precision'])} capture={_pct(f['capture'])} parity=not-measured")
        print(out["written"])
    return 0


if __name__ == "__main__":
    sys.exit(main())
