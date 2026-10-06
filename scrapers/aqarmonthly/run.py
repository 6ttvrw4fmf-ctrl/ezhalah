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
# 108 is Aqar's own «قاعة للحجز» (event/meeting halls; the site's category name, measured 2026-09-28).
# Owner rule 2026-09-28: a commercial space we cannot place goes in مرافق خدمية under the source's word
# («قاعة» = Event Hall), MONTHLY, and PRICE ON REQUEST — a hall is booked by the hour or night (ad
# 6834468: «السعر للساعه 200 ريال»), so Aqar's 30-day booking calculator is not a monthly rent anyone
# publishes. The price is stored NULL (authoritatively, so an older calculated figure is cleared).
HALL_CATEGORY = 108

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

# ── Retry smarter on a BLOCK (2026-09-28, Scraping Engineer) ──────────────────────────────────────
# aqarmonthly-sync run 36384691494: all 16 shards discovered 0 ids ("page stream failed mid-flight")
# after nine straight green days — the same site-wide aqar wall that took aqar-sweep to 0 pages
# earlier that day (run 36360844470, fixed in common/http.py by #5055). _gql was pinned to ONE
# fingerprint (chrome124) on ONE route, swallowed every failure silently, and so could neither get
# past a handshake block nor say what the host answered. Now: a request that does not come back as
# a JSON object (403 page, challenge HTML, refused connection) walks the other browser profiles
# DIRECT, then — only when the workflow sets SCRAPE_PROXY_FALLBACK_URL — every profile through the
# residential proxy. The first leg that answers JSON is pinned for every thread for the rest of the
# process. When no leg answers EXHAUST_AFTER escapes in a row the host is marked exhausted and later
# calls fail fast (None, False) exactly as before, so a real ban cannot become a probe storm or a
# proxy bill. The caller's UNKNOWN-coverage path (no prune, ok=False) is unchanged.
FALLBACK_PROFILES = ("chrome124", "safari17_0", "firefox133", "edge101")
EXHAUST_AFTER = 3
_route: list[tuple[str, bool]] = [("chrome124", False)]   # the pinned (profile, via_proxy) leg
_route_lock = threading.Lock()
_escape = {"failures": 0, "exhausted": False}


def _proxy_fallback() -> dict | None:
    purl = os.environ.get("SCRAPE_PROXY_FALLBACK_URL", "").strip()
    return {"http": purl, "https": purl} if purl else None


def _new_session(profile: str, via_proxy: bool) -> cc.Session:
    s = cc.Session(impersonate=profile, proxies=_proxy_fallback() if via_proxy else None)
    # impersonate OWNS the User-Agent — never set one here
    s.headers.update({"Content-Type": "application/json", "Origin": "https://sa.aqar.fm",
                      "Accept": "application/json"})
    return s


def _sess() -> cc.Session:
    leg = _route[0]
    if getattr(_local, "leg", None) != leg:
        _local.s = _new_session(*leg)
        _local.leg = leg
    return _local.s


def _post(s: cc.Session, body: dict) -> tuple[dict | None, str]:
    """(json_object, outcome). json_object is None unless the host answered a JSON object."""
    try:
        r = s.post(GQL, json=body, timeout=30)
    except Exception as e:                     # noqa: BLE001 — transport error, recorded by name
        return None, type(e).__name__
    try:
        d = r.json()
    except Exception:                          # noqa: BLE001 — a block page is HTML, not JSON
        return None, f"HTTP {r.status_code} non-JSON"
    if not isinstance(d, dict):
        return None, f"HTTP {r.status_code} non-object"
    return d, f"HTTP {r.status_code}"


def _escape_block(body: dict, reason: str, used: tuple[str, bool]) -> dict | None:
    """Try every other leg with a fresh session; pin the first one that answers JSON."""
    with _route_lock:   # one thread probes; the others then reuse its verdict
        if _escape["exhausted"]:
            return None
        cur = _route[0]
        if cur != used:
            # Another thread already found a working route while we waited — use it.
            _throttle()
            return _post(_new_session(*cur), body)[0]
        tried = [f"{'proxy' if cur[1] else 'direct'}/{cur[0]}:{reason}"]
        legs = [(p, False) for p in FALLBACK_PROFILES]
        if _proxy_fallback() is not None:
            legs += [(p, True) for p in FALLBACK_PROFILES]
        for leg in legs:
            if leg == cur:
                continue
            _throttle()
            d, outcome = _post(_new_session(*leg), body)
            tried.append(f"{'proxy' if leg[1] else 'direct'}/{leg[0]}:{outcome}")
            if d is not None:
                _route[0] = leg
                _escape["failures"] = 0
                print(f"   ↻ aqar graphql blocked, escaped via {tried[-1]} "
                      f"(tried {', '.join(tried)}) — pinned for this run", flush=True)
                return d
        _escape["failures"] += 1
        final = _escape["failures"] >= EXHAUST_AFTER
        if final:
            _escape["exhausted"] = True
        print(f"   ✗ aqar graphql BLOCKED on every route (tried {', '.join(tried)}"
              f"{'' if _proxy_fallback() else '; proxy fallback not enabled'})"
              + (f" — {EXHAUST_AFTER} in a row, failing fast for the rest of this run" if final else ""),
              flush=True)
        return None


def _gql(query: str, variables: dict, tries: int = 3):
    """Returns (data, gql_errored). Retries ONLY transient failures (network error / no response).
    A valid JSON response that carries GraphQL `errors` (e.g. "dates already reserved", INVALID_INPUT)
    is a deterministic business error — return immediately so the caller can move on (NOT retry it;
    retrying booked-date errors is what made the crawl crawl).

    When every try on the pinned route fails, the other browser profiles and then the residential
    proxy are tried once (see _escape_block) before giving up with (None, False)."""
    body = {"query": query, "variables": variables}
    outcome = "no attempt"
    used = _route[0]
    for i in range(tries):
        if _escape["exhausted"]:
            return None, False
        _throttle()
        used = _route[0]
        d, outcome = _post(_sess(), body)
        if d is not None:
            # Return PARTIAL data even on errors: when only the price field errors ("dates reserved"),
            # the response still carries Listing.get, so the caller keeps the detail and just retries
            # the price on the next window. Business errors are NOT retried (deterministic).
            with _route_lock:
                _escape["failures"] = 0
            return d.get("data"), bool(d.get("errors"))
        time.sleep(0.6 * (i + 1))            # transient (network/block) → back off and retry
    d = _escape_block(body, outcome, used)
    if d is not None:
        return d.get("data"), bool(d.get("errors"))
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
# Parking lives in aqar's `extended_details` (special_parking), and Listing.get does NOT expose it — only
# `has_extended_details` (introspected 2026-10-06; the detail query's schema probe dropped it, so aqarmonthly
# stored parking for 0 units). The search result type (ElasticListing) DOES carry it, so discovery asks for
# it alongside the id: live sample of 210 available units, special_parking true 40 / false 22 / null 148.
# If the schema ever refuses it, discovery falls back to FIND_Q on the first page — never fewer ids.
FIND_Q_EXT = ("query($drf:DailyRentingFilter,$size:Int,$from:Int){ Search{ "
              "find(daily_renting_filter:$drf, size:$size, from:$from){ total listings{ id "
              "extended_details { special_parking laundry_room } } } } }")
_ext_by_id: dict[int, dict] = {}

# Aqar's structured amenity flags (2026-10-05, 🔬 AF engineer). The same Listing object the aqar page
# embeds — and scrapers/aqar/enrich_residential.py already reads for the annual inventory — carries
# `lift` / `ketchen` / `ac` / `maid` / `driver` / `car_entrance` (0/1/null), the two entrance flags and
# `extended_details` (special_parking, laundry_room). This query fetched `furnished` and nothing else, so
# all 3,675 searchable Aqar Monthly units stored NULL for every Advanced Filter amenity while their own
# pages render «مطبخ · مصعد · مكيف · موقف خاص» (source-reread run 37288862098, ad 6570974) — invisible
# to every customer who ticks an amenity on a Monthly search (ops_af_score 2026-10-05: find 0/10).
AMENITY_GQL_FIELDS: tuple[str, ...] = ("lift", "ketchen", "ac", "maid", "driver", "car_entrance",
                                       "special_entrance", "two_entrances", "extended_details")
# The subset the live schema accepted this run (see settle_amenity_fields); () = today's query exactly.
_amenity_fields: tuple[str, ...] = ()


def detail_query(extra: tuple[str, ...] = ()) -> str:
    return ("query($id:Int!,$s:Float!,$e:Float!){ "
            "Listing{ get(id:$id){ id category beds area rooms capacity furnished content content_en uri imgs "
            "address location_city location_district location_region location_street city_id district_id"
            + "".join(" " + f for f in extra) + " } } "
            "DailyRenting{ getCalculatedBookingPriceWithDiscount(listing_id:$id, start_date:$s, end_date:$e){ "
            "discounted_price total_price } } }")


DETAIL_Q = detail_query()


def settle_amenity_fields(answer, fields: tuple[str, ...] = AMENITY_GQL_FIELDS) -> tuple[str, ...]:
    """The amenity fields the live GraphQL schema accepts, proven by asking it once before the crawl.

    `answer(query) -> dict | None` sends one detail query and returns the parsed JSON. A GraphQL
    VALIDATION error (an unknown field, an object field without a selection) answers with no data at
    all — sent on every unit, it would drop the whole catalogue. So a field the schema names in an error
    is removed and the query re-asked; an answer that cannot be read, or an error that names none of
    our fields, falls back to () — exactly the query this scraper ran before. Fail-safe both ways."""
    fields = tuple(fields)
    for _ in range(len(fields) + 1):
        if not fields:
            return ()
        d = answer(detail_query(fields))
        if not isinstance(d, dict):
            return ()
        if ((d.get("data") or {}).get("Listing") or {}).get("get") is not None:
            return fields
        msgs = " ".join(str((e or {}).get("message", "")) for e in (d.get("errors") or []))
        bad = {f for f in fields if re.search(r'"' + re.escape(f) + r'"', msgs)}
        if not bad:
            return ()
        fields = tuple(f for f in fields if f not in bad)
    return ()


SETTLE_TRIES = 3


def settle_across_units(answer_for, ids, tries: int = SETTLE_TRIES) -> tuple[str, ...]:
    """settle_amenity_fields() on up to `tries` units, first non-empty answer wins (🔬 AF engineer,
    2026-10-06). One unit is not proof: a unit that is gone, or a transient error, answers unreadable,
    which settles to () — and that shard then crawled with no amenity fields at all (2026-10-05: 1,835
    of ~2,368 fresh rows carried them; aqarmonthly_residential_listings:13906613 refreshed without).
    `answer_for(query, unit_id)`. All `tries` failing still falls back to () — the old query."""
    for lid in list(ids)[:tries]:
        got = settle_amenity_fields(lambda q, lid=lid: answer_for(q, lid))
        if got:
            return got
    return ()


def map_amenities(g: dict) -> dict:
    """aqar's 0/1/null flags → our tri-state columns, through the SAME tables and _tri_state the annual
    aqar parser uses (one reading of one payload). A key the payload does not carry is not emitted, and
    None is UNKNOWN (the upsert drops it, so it never overwrites a known value). Only columns
    aqarmonthly_residential_listings has are emitted (it has no `furnished` column: that stays NULL)."""
    from scrapers.aqar.enrich_residential import (
        _EXTENDED_DETAIL_KEYS, _PRIVATE_ENTRANCE_KEYS, _STRUCTURED_AMENITY_KEYS, _extended_details, _tri_state,
    )
    out: dict = {}
    for key, col in _STRUCTURED_AMENITY_KEYS.items():
        if col in AMENITY_COLUMNS and key in g:
            out[col] = _tri_state(g.get(key))
    ext = _extended_details(g)
    for key, col in _EXTENDED_DETAIL_KEYS.items():
        if col in AMENITY_COLUMNS and key in ext:
            out[col] = _tri_state(ext.get(key))
    vals = [_tri_state(g.get(k)) for k in _PRIVATE_ENTRANCE_KEYS if k in g]
    if vals:
        out["private_entrance"] = True if any(v is True for v in vals) else (
            False if all(v is False for v in vals) else None)
    return out


AMENITY_COLUMNS = frozenset({"elevator", "kitchen", "air_conditioner", "maid_room", "driver_room",
                             "car_entrance", "parking", "laundry_room", "private_entrance"})


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

    find_q = FIND_Q_EXT
    for _pass in range(MAX_PASSES):
        before = len(ids)
        frm, size = 0, 50
        while True:
            d, errored = _gql(find_q, {"drf": {"availability": {"eq": 1}}, "size": size, "from": frm})
            if find_q is FIND_Q_EXT and (errored or not d) and not ids:
                find_q = FIND_Q        # the schema refused the extra block: discovery must not suffer
                d, _ = _gql(find_q, {"drf": {"availability": {"eq": 1}}, "size": size, "from": frm})
            if not d:
                truncated = True      # transport gave up: UNKNOWN, never "that was the last page"
                break
            fr = d["Search"]["find"]
            total = fr.get("total") or 0
            if declared is None:
                declared = int(total)
            batch = [l["id"] for l in (fr.get("listings") or []) if l.get("id")]
            for l in (fr.get("listings") or []):
                if l.get("id") and isinstance(l.get("extended_details"), dict):
                    _ext_by_id[int(l["id"])] = l["extended_details"]
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

    Catalog-validated against arabic_location's own loaded `_DISTRICT_AR_BY_CITY` ((city_id,
    district_norm) → that city's catalog spelling) — UNLIKE resolve_slug()'s «حي X» capture, which
    stores the raw regex match with no catalog check at all. An uncatalogued/ambiguous candidate is
    discarded, never stored (never invent/guess a location — canonical rule 3)."""
    if not address or not city_id:
        return None
    segs = [s.strip() for s in re.split(r"[,،]", address) if s.strip()]
    if len(segs) < 2:
        return None
    candidate, city_seg = segs[-2], segs[-1]
    if AL.norm_ar(candidate) == AL.norm_ar(city_seg):
        return None  # district==city shape → source has no real district (honest null, matches
                      # the already-decided gathern district==own-city policy)
    # norm_district_tok(), NOT norm_ar(): catalog district_norm keys are built by that function (it
    # strips «حي »/«ال», drops ء…), so under norm_ar() «الصحافة» never met its own key «صحافه».
    catalog_ar = AL._DISTRICT_AR_BY_CITY.get((city_id, AL.norm_district_tok(candidate)))
    if catalog_ar is None:
        return None
    # Source spelling, «حي »-prefixed exactly when THIS city's catalog spelling is — the shape the
    # old two-form loop returned (candidate, then «حي »+candidate), and what the slug path stores.
    if AL.norm_ar(catalog_ar).startswith("حي ") and not AL.norm_ar(candidate).startswith("حي "):
        return "حي " + candidate
    return candidate


def map_listing(g: dict, price: dict) -> dict | None:
    uri = g.get("uri") or ""
    if not uri:
        return None
    # Out of scope, not "type unknown" (2026-09-28, run 36385996203): Aqar's DailyRenting vertical
    # began serving category 108 — an event hall, a meeting room and a pallet warehouse on the first
    # day. This is the FURNISHED RESIDENTIAL monthly product (the table is *_residential_listings), so
    # a category with no residential mapping is not written at all. Writing it with property_type
    # NULL is what tripped mon_check_run_field_ranges and failed 13 of 16 shards. Never default a
    # type (source is truth) and never invent a commercial one here (taxonomy is an owner decision).
    # A MISSING category stays what it always was (type unknown → NULL); only a category the source
    # names and we have no residential mapping for is out of scope.
    hall = g.get("category") == HALL_CATEGORY
    if g.get("category") is not None and g.get("category") not in CATEGORY_TYPE and not hall:
        return None
    place = uri.rsplit("-", 1)[0].replace("-", " ")  # drop trailing -id, dashes → spaces
    city = N.map_city(place)
    region = N.region_for_city(city) if city else None

    monthly = price.get("discounted_price") or price.get("total_price")
    try:
        monthly = float(monthly)
    except (TypeError, ValueError):
        return None
    if monthly <= 0:
        return None
    price_annual_val = None if hall else round(monthly * 12)
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
        "property_type":    "Event Hall" if hall else CATEGORY_TYPE.get(g.get("category")),
        "transaction_type": "Rent",
        "rent_period":      "monthly",
        "source":           "Aqar Monthly",
        "price_annual":     db.AUTHORITATIVE_NULL if hall else price_annual_val,  # app shows price_annual / 12
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
            authoritative_absent=hall,
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
        # THE CARD'S OWN DISTRICT LINE. ResultCard shows the RAW scraped district whenever it is
        # already Arabic (owner 2026-07-06, src/data/remote.ts: `l.district = /[ء-ي]/.test(rawDistrict)
        # ? rawDistrict : …`), so this column — not the catalog-canonical index value — is what a user
        # reads. It used to be its own naive slug parse, `re.search(r"حي\s+(\S+(?:\s+\S+){0,2})")`,
        # which swallows up to 3 words after «حي» and therefore glued the city and the word «منطقة»
        # onto the district: 1,352 of 1,801 active rows rendered as «الفرسان الدمام الدمام» or «الرمال
        # الرياض منطقة» while district_ar (and the search index built from it) correctly said «حي
        # الفرسان» / «حي الرمال». One parse, one answer: this is resolve_slug()'s district, which
        # strips the trailing catalog city by name, plus the address fallback. Unresolved stays None.
        "neighborhood":     district_ar_val,
        "title":            _redact((g.get("content") or "").split("\n")[0][:120]),
        "description":      _redact(g.get("content")),
        "photo_urls":       imgs,
        # ── Arabic-native (additive, shadow) + complete-source capture ──────────
        "city_ar":          loc["city_ar"],
        "district_ar":      district_ar_val,
        "city_id":          loc["city_id"],
        "region_id":        loc["region_id"],
        "source_capture":   capture,
        **map_amenities(g),
    }


def with_search_extended_details(g: dict | None, listing_id) -> dict | None:
    """The detail object plus the `extended_details` discovery read for this unit (see FIND_Q_EXT). The
    detail's own block wins if the schema ever serves one; a unit discovery saw no block for is unchanged."""
    if not isinstance(g, dict) or "extended_details" in g:
        return g
    ext = _ext_by_id.get(int(listing_id))
    return {**g, "extended_details": ext} if ext is not None else g


def fetch_row(listing_id: int, windows: list[tuple[int, int]]) -> dict | None:
    """Fetch detail once, then price the first AVAILABLE 30-day window. Detail is window-independent,
    so we only re-issue the cheap price query per window until one is free."""
    g = None
    for (s_ms, e_ms) in windows:
        d, errored = _gql(detail_query(_amenity_fields), {"id": int(listing_id), "s": s_ms, "e": e_ms})
        if d:
            if g is None:
                g = with_search_extended_details((d.get("Listing") or {}).get("get"), listing_id)
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

        global _amenity_fields
        s0, e0 = windows[0]

        def _answer(q: str, lid) -> dict | None:
            _throttle()
            return _post(_sess(), {"query": q, "variables": {"id": int(lid), "s": s0, "e": e0}})[0]

        _amenity_fields = settle_across_units(_answer, ids)
        print(f"  amenity fields accepted by the schema: {list(_amenity_fields) or 'none (query unchanged)'}")

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
