"""Aqar MONTHLY scraper → `aqarmonthly_residential_listings` (separate source, own table).

Aqar's `DailyRenting` vertical = furnished short-stay units booked by night/MONTH via a calendar —
the Gathern twin on Aqar. We price each unit for a 30-day stay, so the card price = the discounted
MONTHLY price the user actually pays when they open the unit (the Option-A guarantee).

NOTE — this is NOT `accept_monthly`. Those are 1-YEAR contracts with monthly PAYMENT installments
(the Saudi norm is collecting every 6 months; Rize/Ejari finance the monthly repay). That is annual
rent, already covered by our annual Aqar data + the RNPL card banner. This source is the true
short-stay monthly product only.

Pipeline (GraphQL at https://sa.aqar.fm/graphql — NO AUTH):
  1. Search.find(daily_renting_filter:{availability:{eq:1}})  → all daily_rentable listing ids (~3.8k).
  2. Per id (concurrent): Listing.get(id) + DailyRenting.getCalculatedBookingPriceWithDiscount(
     id, today_ms, +30d_ms) in ONE request → details + real monthly price.
  3. price_annual = discounted_price × 12 (the app divides back by 12 for the /mo display);
     rent_period='monthly'; source='Aqar Monthly'; listing_url = the Aqar listing page (today→+30d
     dates appended at click-time, mirroring Gathern).

Usage (from ezhalah-app/ with the venv):
    python -m scrapers.aqarmonthly.run --limit 20 --dry-run     # sanity check, no DB writes
    python -m scrapers.aqarmonthly.run                          # full crawl + prune
"""
from __future__ import annotations

import argparse
import os
import re
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import NamedTuple

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT.parent) not in sys.path:
    sys.path.insert(0, str(ROOT.parent))

from curl_cffi import requests as cc

from scrapers.common import db
from scrapers.common import normalize as N
from scrapers.common import arabic_location as AL
from scrapers.common.arabic_location import resolve_slug

GQL = "https://sa.aqar.fm/graphql"
WORKERS = int(os.environ.get("SCRAPE_WORKERS", "6"))
MIN_INTERVAL = float(os.environ.get("SCRAPE_MIN_INTERVAL", "0.3"))

# Aqar DailyRenting unit categories → our residential property types. 101/102/103 are furnished
# apartments/studios; 104 chalet; 105/107 rest-house/farm stays; 106 caravan/camp. Default Apartment.
CATEGORY_TYPE = {101: "Apartment", 102: "Apartment", 103: "Apartment",
                 104: "Chalet", 105: "Rest House", 106: "Camp", 107: "Rest House"}

# ── polite per-host throttle (spaces request STARTS, like common/http) ──────────────────────────
_last = [0.0]
_tlock = threading.Lock()


def _throttle() -> None:
    with _tlock:
        now = time.monotonic()
        target = max(now, _last[0] + MIN_INTERVAL)
        _last[0] = target
    d = target - time.monotonic()
    if d > 0:
        time.sleep(d)


_local = threading.local()


def _sess() -> cc.Session:
    s = getattr(_local, "s", None)
    if s is None:
        s = cc.Session(impersonate="chrome124")
        s.headers.update({"Content-Type": "application/json", "Origin": "https://sa.aqar.fm",
                          "Accept": "application/json"})
        _local.s = s
    return s


def _gql(query: str, variables: dict, tries: int = 3):
    """Returns (data, gql_errored). Retries ONLY transient failures (network error / no response).
    A valid JSON response that carries GraphQL `errors` (e.g. "dates already reserved", INVALID_INPUT)
    is a deterministic business error — return immediately so the caller can move on (NOT retry it;
    retrying booked-date errors is what made the crawl crawl)."""
    for i in range(tries):
        _throttle()
        try:
            r = _sess().post(GQL, json={"query": query, "variables": variables}, timeout=30)
            d = r.json()
            # Return PARTIAL data even on errors: when only the price field errors ("dates reserved"),
            # the response still carries Listing.get, so the caller keeps the detail and just retries
            # the price on the next window. Business errors are NOT retried (deterministic).
            return d.get("data"), bool(d.get("errors"))
        except Exception:
            time.sleep(0.6 * (i + 1))        # transient (network) → back off and retry
    return None, False


def _month_windows_ms(offsets=(1, 31, 61, 91, 121, 151)) -> list[tuple[int, int]]:
    """Candidate 30-day booking windows as (start_ms, end_ms) Unix-MILLISECOND pairs (Aqar wants ms
    Floats). Most daily-rental units have SOME dates reserved, so the immediate today→+30 window often
    fails with "dates already reserved" — we try the nearest free 30-day window instead, walking
    forward month-by-month. The first window that prices wins → the nearest-available monthly rate."""
    now = datetime.now(timezone.utc)
    out = []
    for off in offsets:
        s = now + timedelta(days=off)
        out.append((int(s.timestamp() * 1000), int((s + timedelta(days=30)).timestamp() * 1000)))
    return out


FIND_Q = ("query($drf:DailyRentingFilter,$size:Int,$from:Int){ Search{ "
          "find(daily_renting_filter:$drf, size:$size, from:$from){ total listings{ id } } } }")

DETAIL_Q = ("query($id:Int!,$s:Float!,$e:Float!){ "
            "Listing{ get(id:$id){ id category beds area rooms capacity furnished content content_en uri imgs "
            "address location_city location_district location_region location_street city_id district_id } } "
            "DailyRenting{ getCalculatedBookingPriceWithDiscount(listing_id:$id, start_date:$s, end_date:$e){ "
            "discounted_price total_price } } }")


ES_FROM_CAP = 9500          # ES refuses from+size past ~10k; the vertical is smaller, but pin the bound.
MAX_PASSES = 4              # bounded re-paging; see discover_ids' "why more than one pass" note.
COVERAGE_SLACK_PCT = 0.05   # measured convergence headroom, NOT a fudge factor — see coverage_verdict.


class Discovery(NamedTuple):
    """What one discovery pass captured, AND whether it can prove that is all the source published.

    `declared` is the source's OWN `Search.find.total` for the very filter we asked for — the only
    thing on the wire that distinguishes "aqar published 240 today" from "our page stream died after
    240 of 3,800". Before 2026-09-12 this field was read on every page and thrown away.
    """
    ids: list[int]
    declared: int | None    # source-declared total; None ⇒ we never got a readable first page
    truncated: bool         # a page fetch failed / came back empty MID-stream (not exhaustion)
    capped: bool            # stopped at ES_FROM_CAP, not because the source ran out


def coverage_verdict(d: Discovery) -> tuple[bool, str]:
    """(complete, reason) — is `d` provably the whole of what the source published?

    PURE: no network, no clock, no DB. scripts/verify-aqarmonthly-coverage-beats-row-floor.ts
    executes THIS function, so the predicate a barrier proves is the predicate production runs.

    The rule is a COVERAGE relation against source truth, never an absolute row count:

      • a failed/empty page mid-stream is UNKNOWN, never "the source has no more" — AGENTS.md,
        "A FAILED FETCH IS NOT AN EMPTY ANSWER". Nothing else on the wire tells these apart.
      • no readable first page ⇒ we cannot prove anything ⇒ not complete.
      • captured materially short of `declared` ⇒ OUR crawl truncated ⇒ not complete.
      • captured ≈ declared ⇒ complete, HOWEVER SMALL. 240 ids against a declared 240 is the
        source's own answer and is preserved as such (source fidelity outranks plausibility).

    The slack is MEASURED, not guessed. Aqar's ES pages without a stable tiebreaker, so documents
    shift between page requests and one pass returns duplicates in place of ids it never showed.
    Measured live 2026-09-12 against a declared 240: one pass yields 194-199 distinct (~19% short);
    cumulative distinct over repeated passes went 194 → 224 → 234, i.e. it converges on the declared
    total but does not reach it exactly. discover_ids() now re-pages (see there); 5% is the headroom
    that convergence needs and is still far tighter than the collapse shapes it must reject — 900 of
    a declared 3,800 is 24% and fails by a wide margin.
    """
    if d.truncated:
        return False, "page stream failed mid-flight — UNKNOWN coverage, not a small source"
    if d.declared is None:
        return False, "no readable first page — coverage unprovable"
    if d.capped:
        return True, f"captured {len(d.ids)} up to the ES from-cap ({ES_FROM_CAP}) of {d.declared}"
    slack = max(5, int(d.declared * COVERAGE_SLACK_PCT))
    missing = d.declared - len(d.ids)
    if missing > slack:
        return False, f"captured {len(d.ids)} of {d.declared} the source declared ({missing} missing > {slack} slack)"
    return True, f"captured {len(d.ids)} of {d.declared} the source declared"


def discover_ids(max_listings: int | None = None) -> Discovery:
    """Page through every available daily_rentable listing id, and report whether that stream is
    PROVABLY complete against the source's own declared total (see coverage_verdict).

    WHY MORE THAN ONE PASS (measured 2026-09-12, senior audit). Aqar's ES `from`/`size` paging has
    no stable tiebreaker, so documents move between page requests: a single pass hands back the same
    id on two pages and never shows others at all. Against a declared total of 240 one pass yielded
    194-199 DISTINCT ids — a silent ~19% capture loss on every run since this scraper shipped, which
    nothing could see because len(ids) was never compared to the total the source declared on each
    page. Re-paging recovers them: cumulative distinct went 194 → 224 → 234 over three passes. Page
    size cannot fix it instead — the endpoint caps a page at ~70 however large a `size` we ask for.

    That loss is not only a freshness gap. On the UNSHARDED path the surviving id set is what
    prune_unseen() is handed, so a fifth of the live catalogue would look absent from the crawl.

    Bounded: at most MAX_PASSES, and we stop the moment a pass stops paying for itself.
    """
    ids: list[int] = []
    seen: set[int] = set()
    declared: int | None = None
    truncated = capped = False

    for _pass in range(MAX_PASSES):
        before = len(ids)
        frm, size = 0, 50
        while True:
            d, _ = _gql(FIND_Q, {"drf": {"availability": {"eq": 1}}, "size": size, "from": frm})
            if not d:
                truncated = True      # transport gave up: UNKNOWN, never "that was the last page"
                break
            fr = d["Search"]["find"]
            total = fr.get("total") or 0
            if declared is None:
                declared = int(total)
            batch = [l["id"] for l in (fr.get("listings") or []) if l.get("id")]
            if not batch:
                # An empty page BEFORE the declared total is a source-side hiccup, not the end of
                # the catalogue — indistinguishable on the wire, so say UNKNOWN rather than guess.
                truncated = frm < (declared or 0)
                break
            for lid in batch:         # dedupe ACROSS passes: len(ids) must mean "distinct ids
                if lid not in seen:   # captured", or coverage compares against an inflated number
                    seen.add(lid)
                    ids.append(lid)
            frm += size
            if max_listings and len(ids) >= max_listings:
                return Discovery(ids[:max_listings], declared, False, True)
            if frm >= total:
                break
            if frm >= ES_FROM_CAP:
                capped = True
                break
        gained = len(ids) - before
        if truncated or capped or declared is None:
            break                     # a broken/bounded stream is not made whole by re-running it
        if len(ids) >= declared:
            break                     # we hold everything the source says exists
        if _pass and gained <= max(1, int(declared * 0.01)):
            break                     # converged: another pass would buy ~nothing for real traffic
    return Discovery(ids, declared, truncated, capped)


def _redact(t: str | None) -> str | None:
    """PDPL: strip any phone-like digit run from free text (owners sometimes paste numbers)."""
    if not t:
        return t
    return re.sub(r"(\+?\d[\d\s\-]{7,}\d)", "", t).strip()


def _district_from_address(address: str | None, city_id: int | None) -> str | None:
    """Fallback district extraction from Aqar's GraphQL `address` field — a clean, comma-delimited
    "[street?, district?, city]" string — for the rows where the URI slug omits the word «حي»,
    so resolve_slug()'s \\bحي\\s+ regex finds nothing (2026-08-04 audit: ~330/388 aqarmonthly
    null-district search_listings_ar rows, e.g. AQM5946944 address="شارع العمرة, الصحافة, الرياض").

    Catalog-validated against arabic_location's own loaded `_DISTRICT_BY_CITY` (city_id →
    {district_norm,…}) — UNLIKE resolve_slug()'s «حي X» capture, which stores the raw regex match
    with no catalog check at all. An uncatalogued/ambiguous candidate is discarded, never stored
    (never invent/guess a location — canonical rule 3)."""
    if not address or not city_id:
        return None
    segs = [s.strip() for s in re.split(r"[,،]", address) if s.strip()]
    if len(segs) < 2:
        return None
    candidate, city_seg = segs[-2], segs[-1]
    if AL.norm_ar(candidate) == AL.norm_ar(city_seg):
        return None  # district==city shape → source has no real district (honest null, matches
                      # the already-decided gathern district==own-city policy)
    valid = AL._DISTRICT_BY_CITY.get(city_id, ())
    for form in (candidate, "حي " + candidate):
        if AL.norm_ar(form) in valid:
            return form
    return None


def map_listing(g: dict, price: dict) -> dict | None:
    uri = g.get("uri") or ""
    if not uri:
        return None
    place = uri.rsplit("-", 1)[0].replace("-", " ")  # drop trailing -id, dashes → spaces
    city = N.map_city(place)
    region = N.region_for_city(city) if city else None
    dm = re.search(r"حي\s+(\S+(?:\s+\S+){0,2})", place)
    district = dm.group(1) if dm else None

    monthly = price.get("discounted_price") or price.get("total_price")
    try:
        monthly = float(monthly)
    except (TypeError, ValueError):
        return None
    if monthly <= 0:
        return None
    price_annual_val = round(monthly * 12)
    area_m2_val = N.to_int(g.get("area"))

    imgs = ["https://images.aqar.fm/" + k for k in (g.get("imgs") or []) if k][:30]

    # Native Arabic R/C/D (ADDITIVE — the live city/region/neighborhood above stay the lossy slug-parse,
    # unchanged, until cutover). Aqar's STRUCTURED location_* fields are NULL for the DailyRenting
    # vertical, so we resolve R/C/D from the Arabic URI slug with the shared DETERMINISTIC, catalog-
    # validated resolver (positional «منطقة X» + rightmost whole-name catalog city; never loose-matched;
    # unresolved stays null, never guessed). This FIXES the live false-positives (street «مكة المكرمة»
    # or district «المدينة» no longer mis-map the city). source_capture = the full detail minus PII
    # (descriptions phone-redacted; the detail exposes no broker contact field). Numbers unchanged.
    loc = resolve_slug(uri)
    # Fallback ONLY — the slug's «حي X» capture wins when present (unchanged behavior); the
    # address-derived, catalog-validated candidate fills the gap when the slug had no «حي» at all.
    district_ar_val = loc["district_ar"] or _district_from_address(g.get("address"), loc["city_id"])
    capture = {k: (_redact(v) if k in ("content", "content_en") else v) for k, v in g.items()}
    return {
        "ad_number":        f"AQM{g['id']}",
        "listing_url":      f"https://sa.aqar.fm/{uri}",
        "active":           True,
        # An UNKNOWN category id must not default to Apartment (that fabricates a type). None →
        # normalize maps it to the honest «غير معروف» sentinel and the novel-type alarm quarantines
        # the new id for review. (audit item 7, owner rule 2026-07-27.)
        "property_type":    CATEGORY_TYPE.get(g.get("category")),
        "transaction_type": "Rent",
        "rent_period":      "monthly",
        "source":           "Aqar Monthly",
        "price_annual":     price_annual_val,  # app shows price_annual / 12 = the monthly figure
        # PRICE = SOURCE evidence (owner invariant 2026-08-04, alert_event 523). Previously every
        # aqarmonthly row was written with NO price_evidence at all — the sibling scrapers
        # (dealapp, wasalt) already record this; aqarmonthly was the one gap.
        "price_evidence":   N.price_evidence(
            field="DailyRenting.getCalculatedBookingPriceWithDiscount.discounted_price",
            raw=price.get("discounted_price") or price.get("total_price"),
            stored=price_annual_val,
            kind="monthly",
            unit="total",
            origin="api",
        ),
        "area_m2":          area_m2_val,
        # "beds" is a furnished/short-stay field (this is a daily-rental vertical) — conventionally
        # physical sleeping-bed count (sofa-beds, bunk beds, extra beds for guest capacity), not
        # bedroom-ROOM count; these routinely diverge for furnished units. A sibling "rooms" field
        # exists in the same API response but is never read either — no bedroom-specific signal
        # exists here. Owner decision 2026-07-28: null rather than store an unverifiable figure.
        "bedrooms":         None,
        # Forward-fix (2026-07-10 location-data-quality audit): an honest None beats the literal
        # "Other" sentinel — the additive resolve_slug()-derived columns already cover most rows.
        "city":             city,
        "region":           region,
        "neighborhood":     district,
        "title":            _redact((g.get("content") or "").split("\n")[0][:120]),
        "description":      _redact(g.get("content")),
        "photo_urls":       imgs,
        # ── Arabic-native (additive, shadow) + complete-source capture ──────────
        "city_ar":          loc["city_ar"],
        "district_ar":      district_ar_val,
        "city_id":          loc["city_id"],
        "region_id":        loc["region_id"],
        "source_capture":   capture,
    }


def fetch_row(listing_id: int, windows: list[tuple[int, int]]) -> dict | None:
    """Fetch detail once, then price the first AVAILABLE 30-day window. Detail is window-independent,
    so we only re-issue the cheap price query per window until one is free."""
    g = None
    for (s_ms, e_ms) in windows:
        d, errored = _gql(DETAIL_Q, {"id": int(listing_id), "s": s_ms, "e": e_ms})
        if d:
            if g is None:
                g = (d.get("Listing") or {}).get("get")
            p = (d.get("DailyRenting") or {}).get("getCalculatedBookingPriceWithDiscount")
            if g and p:
                return map_listing(g, p)
        # errored (dates reserved / invalid) → just try the next window. If we already have detail (g)
        # but no free window after all candidates, the unit is fully booked → skip it.
    return None


def main() -> int:
    ap = argparse.ArgumentParser(description="Aqar Monthly (DailyRenting) scraper")
    ap.add_argument("--type", default="all", choices=["all", "residential", "commercial"],
                    help="commercial is a no-op (Aqar Monthly is furnished residential only)")
    ap.add_argument("--limit", type=int, default=0, help="cap total listings (sanity checks)")
    ap.add_argument("--shard", default="", help="i/N — price only the i-th of N id shards (parallel matrix); skips prune")
    ap.add_argument("--dry-run", action="store_true", help="don't write to the DB")
    args = ap.parse_args()

    if args.type == "commercial":
        # Deliberately NO scrape_runs row here: this path is manual-only (the cron matrix never
        # passes --type), and gathern's commercial no-op stays the fleet's single allow_empty run
        # (see db.end_run's RC-B docstring).
        print("Aqar Monthly is residential-only — commercial is a no-op.")
        return 0

    windows = _month_windows_ms()
    print(f"Aqar Monthly — discovering daily_rentable ids… ({len(windows)} candidate 30-day windows)")

    # ── scrape_runs instrumentation (Batch 1 monitoring activation, 2026-07-16) ─────────────────
    # This scraper never called begin_run/end_run, so all 16 cron shards were invisible to every
    # scrape_runs-based monitor (silent-death detector D1 included). House convention (gathern —
    # the sharded matrix twin — plus abeea et al.): validation passes (--limit / --dry-run) write
    # no run row; every real run, including EACH matrix shard, opens one. The label is plain
    # "aqarmonthly" for every shard (gathern's matrix shards all log as plain "gathern" too); the
    # shard id goes in notes.
    #
    # 0-row semantics (composes with end_run's RC-B demotion, PR #72): rows_seen = the ids this
    # run actually price-checked (its shard slice). A slice of the ~1.5-3.8k vertical / 16 shards
    # is ~100-240 ids — never legitimately empty while the vertical is alive — so rows_seen==0
    # here means discovery collapsed or the source is blocked: exactly what RC-B should redden.
    # NO allow_empty. A shard whose units are ALL fully booked upserts 0 rows but still reports
    # rows_seen=len(ids) > 0, so that legitimately-possible case can't manufacture false-red noise.
    run_id = None if (args.limit or args.dry_run) else db.begin_run("aqarmonthly")

    ids: list[int] = []
    counter = {"done": 0, "ok": 0}
    try:
        disc = discover_ids(max_listings=args.limit or None)
        ids = list(disc.ids)
        complete, why = coverage_verdict(disc)
        print(f"✓ discovered {len(ids)} daily-rentable listings — {why}")
        if not ids:
            print("No listings — aborting (no prune on an empty discovery).")
            if run_id is not None:
                db.end_run(run_id, ok=False, rows_seen=0, rows_upserted=0,
                           notes="discovery returned 0 daily-rentable ids (blocked/empty source?)")
            return 1
        if not complete:
            # OUR crawl is short of what the source published. Do not upsert a partial catalogue
            # under a healthy verdict, and never let it near prune_unseen().
            print(f"✗ incomplete discovery — {why}")
            if run_id is not None:
                db.end_run(run_id, ok=False, rows_seen=len(ids), rows_upserted=0,
                           notes=f"incomplete discovery: {why}")
            return 1

        # Parallel matrix: each shard prices a deterministic stride slice ids[i::N] (own runner/IP). A
        # sharded run sees only its slice, so it must NOT prune (see below).
        if args.shard:
            si, sn = (int(x) for x in args.shard.split("/"))
            ids.sort()
            ids = ids[si::sn]
            print(f"  shard {si}/{sn} → {len(ids)} ids")

        rows: list[dict] = []
        seen_ads: set[str] = set()
        lock = threading.Lock()

        def work(lid: int) -> None:
            row = fetch_row(lid, windows)
            with lock:
                counter["done"] += 1
                if row:
                    rows.append(row)
                    seen_ads.add(row["ad_number"])
                    counter["ok"] += 1
                if counter["done"] % 100 == 0:
                    print(f"   [{counter['done']}/{len(ids)}] ok={counter['ok']}")

        with ThreadPoolExecutor(max_workers=WORKERS) as pool:
            list(pool.map(work, ids))

        print(f"✓ built {len(rows)} rows ({counter['ok']}/{len(ids)} priced)")

        if args.dry_run:
            for r in rows[:5]:
                print(f"   {r['ad_number']} | {r['property_type']} | {r['city']}/{r.get('neighborhood')} "
                      f"| {r['price_annual']//12} SAR/mo | beds={r['bedrooms']} | imgs={len(r['photo_urls'])}")
            print("(dry-run — no DB writes)")
            return 0

        # Batch upsert in chunks.
        for i in range(0, len(rows), 200):
            db.upsert_aqarmonthly_residential_batch(rows[i:i + 200])
        print(f"✓ upserted {len(rows)} rows into aqarmonthly_residential_listings")

        # PRUNE only on a full (non-sharded) pass — a shard sees just its slice and would wrongly
        # deactivate every other shard's rows.
        pruned = 0
        if args.shard:
            print(f"✓ shard {args.shard}: no prune (partial run)")
        else:
            pruned = db.prune_unseen("aqarmonthly_residential_listings", seen_ads, source="Aqar Monthly")
            if pruned < 0:
                print("⚠ aqarmonthly prune guard tripped (0 scraped or collapse) — kept existing active")
            else:
                print(f"✓ pruned {pruned} stale (no-longer-available) units")
        healthy = True
        if run_id is not None:
            healthy = db.end_run(run_id, ok=True, rows_seen=len(ids), rows_upserted=len(rows),
                       degraded=pruned < 0,  # a tripped prune guard is an integrity trip → honest red
                       # NO absolute `floor=` here, DELIBERATELY — coverage_verdict() above already
                       # decided this, against the source's own declared total, and it is strictly
                       # stronger than the row floor it replaces (senior audit 2026-09-12).
                       #
                       # The floor was `floor=50`, added after the 2026-08-22/29 + 09-05 Saturday
                       # collapses to ~15/shard, on the stated premise that a slice is "never
                       # legitimately [that small] while the vertical is alive". MEASURED on the
                       # fifth consecutive Saturday (2026-09-12), that premise is false in one
                       # specific way: the vertical IS alive — `Search.find` with no availability
                       # filter answered total=3,953 — but the facet we ask for,
                       # availability:{eq:1}, answered **240** (availability:{eq:0} answered 399;
                       # the other ~3,300 carry no availability value at all). Discovery captured
                       # 240 of 240. A COMPLETE crawl of a small source answer was being demoted to
                       # ok=False, reddening CI and raising a P1 `ingestion_check_failed` every
                       # Saturday for a fact the source itself published.
                       #
                       # An absolute floor is blind in BOTH directions, and the other one is worse:
                       # a stream that died after 900 of a declared 3,800 leaves each shard ~56 rows
                       # — comfortably OVER 50 — so it passed as healthy, and on the unsharded path
                       # that verdict feeds prune_unseen(). Coverage catches that; the floor did not.
                       notes=f"shard={args.shard or 'full'} priced={counter['ok']}/{len(ids)} "
                             f"pruned={max(pruned, 0)} source_total={disc.declared} coverage={why}",
                       check_tables=["aqarmonthly_residential_listings"])
        if not healthy:
            print("✗ run demoted to unhealthy by end_run()'s RC-B guard — failing CI instead of a silent success.", flush=True)
        return 0 if healthy else 1
    except Exception as e:
        if run_id is not None:
            db.end_run(run_id, ok=False, rows_seen=counter["done"], rows_upserted=0,
                       notes=str(e)[:300])
        print(f"✗ {e}")
        import traceback
        traceback.print_exc()
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
