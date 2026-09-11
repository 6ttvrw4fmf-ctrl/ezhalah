#!/usr/bin/env python3
"""Nightly production-audit invariants (2026-07-24) — the checks a daily audit was skipping.

Runs SIX live-production checks and exits non-zero + logs a row to location_pipeline_alerts if
any fails (same "build fails + ops dashboard" mechanism as scripts/check_placeholder_locations.py):

  1. NOT-READY REASON INVARIANT — every production_ready=false row in listing_native_location_v2
     must fall into a KNOWN reason bucket: (a) blank source city, or (b) a source city that hasn't
     resolved to a canonical city_id yet. A not-ready row that ALREADY has a resolved city
     (city_ar present AND city_id present) is UNEXPLAINED → alert. This is the "every not-ready row
     has a verified reason" invariant (owner request 2026-07-24). Verified live the same day: 1,070
     not-ready = 787 blank-city + 283 city-unresolved, 0 unexplained.

  2. AWAL RETIRED-STATE (inverted 2026-07-28) — awaalun.com lapsed into a domain-parking page, so
     the scraper was retired (#252) and its 51 link-rotted listings inactivated (#255). 0 active
     rows is now CORRECT; we alert if rows come BACK without a deliberate un-retirement.

  3. UNVERIFIED-INACTIVATION INVARIANT (2026-07-28) — no listing may be deactivated without a
     liveness signal. Every source-verified kill path writes missing_count >= 3; only the
     time-based mark_stale sweep wrote 0, and it false-killed 59 verified-alive dealapp listings
     before its flip was removed. Must read 0.

  4. LIVE AI AGENT — POST fixed Arabic queries to the production `agent` edge function and assert
     the classification is right (deal / city / type) and the reply is Arabic. This is the live
     end-to-end AI test the audit was missing.

  5. DELETION-SPIKE NO-REREISE (2026-08-10) — an aborted cleanup run must alert exactly once, not
     re-raise every ~30 minutes for up to 2 days after its own self-heal resolves it. A single
     2026-08-09 gathern abort produced 40 duplicate P1 alerts before this was fixed.

Usage:
  python3 scripts/check_audit_invariants.py            # all checks (DB checks need SERVICE_ROLE key)
  python3 scripts/check_audit_invariants.py --only agent   # just the AI check (public key only)
"""
from __future__ import annotations

import argparse
import json
import os
import ssl
import sys
import urllib.request

SUPABASE_URL = os.environ.get("SUPABASE_URL") or "https://aannarbkwcymrotzwdbo.supabase.co"
# Publishable (anon) key — PUBLIC, shipped in the web bundle; same precedent as safe-deploy.sh's
# hard-coded key. `or` (not the get() default) so an EMPTY env var — what an unset GitHub secret
# `${{ secrets.X }}` injects — falls back to the hard-coded key instead of shadowing it with "".
PUBLISHABLE_KEY = os.environ.get("SUPABASE_PUBLISHABLE_KEY") or "sb_publishable_vXzwxdpfrzmbwtbR5aXcKA_cMUO8hVB"

KNOWN_NOT_READY_REASONS = ("blank_source_city", "city_unresolved_to_id")

# Fixed AI cases: (query, expected deal, expected city substring, expected type).
AGENT_CASES = [
    ("شقة للإيجار السنوي في الرياض", "Rent", "الرياض", "Apartment"),
    ("فيلا للبيع في جدة", "Buy", "جدة", "Villa"),
]


def _is_ar(s: str) -> bool:
    return any("؀" <= c <= "ۿ" for c in (s or ""))


def _alert(client, alert_type: str, metric: int, detail: str) -> None:
    try:
        client.table("location_pipeline_alerts").insert(
            {"alert_type": alert_type, "metric": metric, "detail": detail}
        ).execute()
    except Exception:
        pass  # exit code is the primary signal; the alert row is best-effort


def get_counts(client) -> dict:
    """The heavy location counts, PRECOMPUTED every 30 min by the pg_cron job 'refresh-mon-audit-counts'
    into the 1-row mon_audit_counts table. Reading that row is instant, so this never trips the
    per-request statement_timeout (57014) that counting listing_native_location_v2 / the drift view
    live does under matview-refresh contention. Also guards freshness: a stale row = the cron is
    broken, so the counts can't be trusted → raise, which fails the run."""
    rows = client.table("mon_audit_counts").select(
        "not_ready_total,not_ready_unexplained,search_index_drift,computed_at").limit(1).execute().data
    if not rows:
        raise RuntimeError("mon_audit_counts is empty — the refresh cron has never run.")
    row = rows[0]
    from datetime import datetime, timezone
    ts = datetime.fromisoformat(row["computed_at"].replace("Z", "+00:00"))
    age_h = (datetime.now(timezone.utc) - ts).total_seconds() / 3600
    if age_h > 3:
        raise RuntimeError(f"mon_audit_counts is stale ({age_h:.1f}h old) — the refresh cron may be broken.")
    return row


def check_not_ready(client, counts: dict) -> bool:
    """True = OK. Every not-ready row must be a known reason bucket (0 unexplained = no not-ready row
    that ALREADY has a fully resolved city)."""
    total = counts.get("not_ready_total", 0)
    unexplained = counts.get("not_ready_unexplained", 0)
    if unexplained == 0:
        print(f"OK  not-ready invariant: {total} not-ready rows, 0 unexplained "
              f"(all buckets in {KNOWN_NOT_READY_REASONS}).")
        return True
    detail = (f"{unexplained} not-ready rows have a resolved city yet stay not-ready "
              f"(unexplained reason bucket).")
    print(f"FAIL not-ready invariant: {detail}")
    _alert(client, "not_ready_unexplained_reason", unexplained, detail)
    return False


def check_awal(client) -> bool:
    """True = OK. REVIVED 2026-09-04 — restored to the check's ORIGINAL sense.

    History, both flips deliberate:
      * RETIRED 2026-07-28 (#252/#255, owner-approved): awaalun.com lapsed into a GoDaddy parking
        stub; the 51 link-rotted listings were inactivated and this check was INVERTED to assert
        0 active rows, with its own docstring saying: "If awaalun.com genuinely returns, un-retire
        deliberately and restore this check to its original sense."
      * REVIVED 2026-09-04 (#1782, owner-instructed): the source came back as a full real-estate
        site (WP REST served 128 real posts); platform_registry retired→active (migration
        20260905023206), small-sources-sync re-armed. The revival missed this file — the inverted
        assertion then failed nightly against healthy stock. Re-adjudicated 2026-09-11: apex 200
        with a ~158KB real site, 5/5 sampled /property/ URLs 200 with real listing pages, 0 parked
        markers, last sync saw every row (low churn is documented source behavior in #1782).

    So active rows are the healthy state again, and the failure worth watching is the original
    one: 0 active rows = the scraper stopped or something mass-deactivated live stock. If awaalun
    ever parks again, retire deliberately (the #252/#255 pattern) and re-invert.
    """
    active = 0
    for tbl in ("awal_residential_listings", "awal_commercial_listings"):
        active += client.table(tbl).select("listing_url", count="exact").eq("active", True).limit(1).execute().count or 0
    if active > 0:
        print(f"OK  awal active: {active} active listings (platform revived #1782; healthy state).")
        return True
    detail = ("awal has 0 ACTIVE listings but the platform was revived (#1782) — the scraper "
              "stopped or something mass-deactivated live stock.")
    print(f"FAIL awal revived-state: {detail}")
    _alert(client, "awal_empty_while_active", 1, detail)
    return False


def check_stale_index(client, counts: dict) -> bool:
    """True = OK. search_listings_ar (the table the search RPC reads) is a rebuilt snapshot of
    listing_native_location_v2; when the rebuild lags/breaks, a listing can be indexed under a
    DIFFERENT city/region than the resolver now says — a الرياض search then returns e.g. an أبو عريش
    listing (self-healed 2026-07-26). At rest the layers are identical (0 drift), so we tolerate only
    a small transient mid-refresh window and alert on material drift."""
    max_drift = int(os.environ.get("STALE_INDEX_MAX") or "50")
    n = counts.get("search_index_drift", 0)
    if n <= max_drift:
        print(f"OK  stale-index drift: {n} listings where search index city/region != resolver (<= {max_drift} tolerated).")
        return True
    detail = (f"{n} listings in search_listings_ar are indexed under a different city/region than "
              f"listing_native_location_v2 resolves — the search index is stale (rebuild may be broken).")
    print(f"FAIL stale-index drift: {detail}")
    _alert(client, "search_index_city_drift", n, detail)
    return False


def check_unverified_inactivations(client) -> bool:
    """True = OK. NO listing may be deactivated without a liveness signal.

    Every source-verified kill path writes missing_count >= 3 (prune_unseen's 3-strike grace, the
    sold-pin, the aqar/wasalt liveness passes, the awal link-rot inactivation). The ONLY path that
    ever wrote 0 was the time-based mark_stale_listings_inactive sweep, which is plpgsql and so can
    never re-fetch a listing_url to check. On 2026-07-28 it deactivated 59 dealapp_commercial rows
    that were verified ALIVE at source (12/12 sampled returned availability=InStock). That flip was
    removed the same day; this check is the tripwire that keeps it removed.

    So `active=false AND missing_count<3` in the last 24h == an unverified kill, by construction.
    Expect non-zero for up to 24h after the fix ships (today's 59 are still in the window); a
    non-zero reading after that is a real regression.
    """
    rows = client.table("mon_unverified_inactivations_24h").select(
        "unverified_inactivations_24h").limit(1).execute().data
    if not rows:
        detail = "mon_unverified_inactivations_24h returned no row — the invariant view is missing."
        print(f"FAIL unverified-inactivation invariant: {detail}")
        _alert(client, "unverified_inactivation_view_missing", 0, detail)
        return False
    n = rows[0].get("unverified_inactivations_24h") or 0
    if n == 0:
        print("OK  unverified-inactivation invariant: 0 listings deactivated without a liveness "
              "signal (missing_count >= 3 on every kill).")
        return True
    detail = (f"{n} listing(s) were deactivated in the last 24h with missing_count < 3 — i.e. WITHOUT "
              f"the source being re-fetched. Some path is killing listings it never verified.")
    print(f"FAIL unverified-inactivation invariant: {detail}")
    _alert(client, "unverified_inactivation", n, detail)
    return False


def check_aqar_price_not_licence(client) -> bool:
    """True = OK. No aqar listing's price may equal the 9-digit tail of its own REGA licence number.

    The Buy fallback pattern `(\\d{6,9})\\s*[§ر﷼]` treated the bare Arabic letter «ر» as a currency
    mark, so on «... رخصة الإعلان 7200922371 رابط ...» it captured the licence tail 200922371 and stored
    it as the price. Two cohorts were repaired (PR#257 «71…», PR#266 «72…»); the parser now requires a
    real §/﷼ symbol. This is the prefix-agnostic tripwire: license_number is parsed independently of
    the price, so license_number = '7' || price is the price wearing the licence's digits — never a
    coincidence. Compares two columns only, so it is cheap enough to run every night.
    """
    rows = client.table("mon_aqar_price_equals_licence_tail").select(
        "price_equals_licence_tail").limit(1).execute().data
    if not rows:
        detail = "mon_aqar_price_equals_licence_tail returned no row — the invariant view is missing."
        print(f"FAIL aqar licence-price invariant: {detail}")
        _alert(client, "aqar_licence_price_view_missing", 0, detail)
        return False
    n = rows[0].get("price_equals_licence_tail") or 0
    if n == 0:
        print("OK  aqar licence-price invariant: 0 rows whose price equals their own licence tail.")
        return True
    detail = (f"{n} active aqar listing(s) have price == the 9-digit tail of their own REGA licence "
              f"number — the bare-«ر» capture bug has recurred.")
    print(f"FAIL aqar licence-price invariant: {detail}")
    _alert(client, "aqar_price_equals_licence_tail", n, detail)
    return False


def check_deletion_spike_no_rereise(client) -> bool:
    """True = OK. An aborted cleanup run must alert exactly once — not re-raise every ~30 minutes
    for up to 2 days after its own self-heal resolves it.

    mon_detect_deletion_spike() scans the last 2 days of cleanup_runs on every sweep and called
    mon_raise() for every ABORTED row it found, every time — including ones it already alerted on
    hours ago. mon_raise() only dedupes against an OPEN row, so as soon as the 20260809153239
    self-heal closed the alert (a later successful cleanup run existed), the very next sweep found
    no open row and inserted a fresh one. Net effect: gathern's single 2026-08-09 03:00 abort
    (cleanup_runs id 6) produced 40 separate P1 alert_event rows over the following ~31 hours, each
    created and resolved in the same instant — real alert noise that could bury a genuine future
    spike, self-terminating only when the row aged out of the 2-day window (not a real fix).

    mon_selftest_deletion_spike_no_rereise() exercises the live function against a reserved
    platform and cleans up after itself: an aborted run raises once; a later successful run
    self-heals it AND the next sweep must not re-raise; a third sweep with nothing new must still
    not add a row. Returns false on the pre-2026-08-10 implementation.
    """
    try:
        ok = client.rpc("mon_selftest_deletion_spike_no_rereise").execute().data
    except Exception as e:
        detail = f"mon_selftest_deletion_spike_no_rereise() could not be run: {e}"
        print(f"FAIL deletion-spike no-rereise invariant: {detail}")
        _alert(client, "deletion_spike_rereise_selftest_missing", 0, detail)
        return False
    if ok is True:
        print("OK  deletion-spike no-rereise invariant: an aborted cleanup run alerts exactly "
              "once, even across a self-heal resolution and repeated sweeps.")
        return True
    detail = ("mon_detect_deletion_spike() re-raises an alert for an aborted run that was already "
              "resolved by self-heal — the 2026-08-10 regression that produced 40 duplicate "
              "gathern P1 alerts in ~31 hours from a single abort.")
    print(f"FAIL deletion-spike no-rereise invariant: {detail}")
    _alert(client, "deletion_spike_rereise_regression", 1, detail)
    return False


def check_normal_filter_barrier(client) -> bool:
    """True = OK. The PERMANENT Normal Filter safety barrier (owner request 2026-08-10): every Normal
    Filter field has a per-field Ezhalah-side-mistake invariant in mon_normal_filter_barrier, and EVERY
    column must read 0. Covers deal, rent-period, region, city, district, category, property type/group,
    bedrooms, area (price fabrication is covered by the dedicated price monitors; district dead-ends by
    verify-district-suggestion-parity-live.ts). SOURCE-IS-TRUTH: source-published unusual values (high
    bedroom/area counts, unusual prices) are NOT flagged — only OUR fabrication / cross-field
    contamination / unreachable-or-dropped listings. A live hourly cron (mon_check_normal_filter_barrier)
    also alerts; this is the CI-enforced layer that fails the build on any regression."""
    rows = client.table("mon_normal_filter_barrier").select("*").limit(1).execute().data
    if not rows:
        detail = "mon_normal_filter_barrier returned no row — the permanent barrier view is missing."
        print(f"FAIL normal-filter barrier: {detail}"); _alert(client, "normal_filter_barrier_missing", 0, detail); return False
    bad = {k: v for k, v in rows[0].items() if (v or 0) != 0}
    if not bad:
        print("OK  normal-filter barrier: all per-field invariants 0 "
              "(deal/period/region/city/district/category/type/bedrooms/area — no Ezhalah-side mistakes).")
        return True
    detail = "normal-filter barrier regression: " + ", ".join(f"{k}={v}" for k, v in bad.items()) + " (all must be 0)."
    print(f"FAIL normal-filter barrier: {detail}")
    _alert(client, "normal_filter_barrier_regression", sum(int(v or 0) for v in bad.values()), detail)
    return False


# PAID-CALL BUDGET FOR THIS RUN. These two probes are the ONLY paid DeepSeek calls anywhere in CI,
# and they are a genuine live-agent verification (they assert the real model still maps Arabic onto
# the right deal/city/type — a deterministic test cannot prove that). The budget exists so the cost
# of CI is a stated number rather than an emergent one: if someone adds cases, this refuses instead
# of quietly multiplying the bill. Owner rule: CI must not call paid DeepSeek unless the test
# explicitly requires it, and those calls must be bounded.
# Pinned by scripts/verify-ai-spend-safety.ts.
MAX_PAID_AGENT_CALLS_PER_RUN = 4
_paid_agent_calls = 0


def _call_agent(text: str, history: list | None = None, ask_count: int | None = None) -> dict:
    global _paid_agent_calls
    if _paid_agent_calls >= MAX_PAID_AGENT_CALLS_PER_RUN:
        raise RuntimeError(
            f"paid-call budget exhausted ({MAX_PAID_AGENT_CALLS_PER_RUN}) - refusing another "
            f"DeepSeek call. Raise MAX_PAID_AGENT_CALLS_PER_RUN deliberately if more live "
            f"verification is genuinely needed."
        )
    _paid_agent_calls += 1
    payload = {"text": text, "locale": "ar", "loggedIn": False, "order": False,
               "history": history or []}
    # The server counts its question budget via this structured field (#1384 removed the old
    # history-regex counter) — a probe that fabricates "budget already spent" must send it.
    if ask_count is not None:
        payload["askCount"] = ask_count
    body = json.dumps(payload).encode()
    req = urllib.request.Request(
        f"{SUPABASE_URL}/functions/v1/agent", data=body, method="POST",
        headers={"apikey": PUBLISHABLE_KEY, "Authorization": f"Bearer {PUBLISHABLE_KEY}",
                 "Content-Type": "application/json",
                 # Attribution: keeps CI spend separable from real user spend in public.ai_usage,
                 # so "is this traffic real?" is answerable from the cost data itself.
                 "x-ezhalah-client": "ci"},
    )
    try:
        import certifi  # ships transitively via supabase → httpx
        ctx = ssl.create_default_context(cafile=certifi.where())
    except Exception:
        ctx = ssl.create_default_context()
    with urllib.request.urlopen(req, timeout=30, context=ctx) as r:
        return json.loads(r.read().decode())


def check_agent(client=None) -> bool:
    ok = True
    for text, deal, city, ptype in AGENT_CASES:
        try:
            d = _call_agent(text)
        except Exception as e:
            print(f"FAIL agent «{text}»: request failed ({e})"); ok = False; continue
        q = d.get("query") or {}
        reply = d.get("reply") or ""
        problems = []
        if d.get("kind") != "listings": problems.append(f"kind={d.get('kind')}")
        if q.get("deal") != deal: problems.append(f"deal={q.get('deal')}!={deal}")
        if city not in (q.get("location") or ""): problems.append(f"location={q.get('location')!r} missing {city}")
        if q.get("type") != ptype: problems.append(f"type={q.get('type')}!={ptype}")
        if not _is_ar(reply): problems.append("reply not Arabic")
        if problems:
            detail = f"agent «{text}»: " + "; ".join(problems)
            print(f"FAIL {detail}"); ok = False
            if client is not None: _alert(client, "ai_agent_regression", len(problems), detail)
        else:
            print(f"OK  agent «{text}»: deal={deal} city~{city} type={ptype}, Arabic reply.")
    return ok


# BROAD-SEARCH-AFTER-BUDGET — re-pinned to the CURRENT contract (2026-09-11).
#
# The original probe (2026-08-30, "family of 5" bug) asserted a CITY-LESS broad search once the
# question budget was spent. That contract was REPEALED by the owner on 2026-09-04 (#1770,
# reinforced #1785): «a search needs a real place» — nationwide search is closed at the decision
# authority (the 39,055-nationwide-listings bug), so a user who never names a city keeps getting
# the city question (decide.ts step 1c, deliberately unbounded), and location "" is no longer an
# acceptable search. This probe kept grading the repealed rule and failed nightly against a
# CORRECT production (verified live 2026-09-11: the kind="message" reply still carries
# understoodState — deal kept, «كبير» captured as askAbout:["size"], never a bedroom count).
#
# The CURRENT contract this probe pins: with a real city named and the budget spent, the agent
# must SEARCH (kind="listings" scoped to that city) rather than ask again. Two mechanics matter:
#   * The server counts questions via the structured body.askCount the client sends (#1384
#     removed the old history-regex counter), so the probe must send askCount, not just history.
#   * The city is جدة, deliberately NOT الرياض — الرياض is a city/region twin and would correctly
#     trigger the ambiguity question (decide.ts step ~207) instead of a search.
# NON-DETERMINISTIC: still a live DeepSeek call; the deterministic ladder guard is
# scripts/verify-agent-decide-turn.ts. This is the live companion proving the server half.
AGENT_BROAD_SEARCH_HISTORY = [
    {"role": "user", "text": "ابغى شي في جدة عندي 5 عيال"},
    {"role": "model", "text": "أبشر! وش تدور عليه بالضبط؟"},
    {"role": "user", "text": "عادي الاثنين ماعندي مشكلة"},
    {"role": "model", "text": "طيب، إيجار ولا تمليك؟"},
]
AGENT_BROAD_SEARCH_TEXT = "بس ودي شي كبير، ماعندي مانع الاثنين"
AGENT_BROAD_SEARCH_ASK_COUNT = 2  # budget spent — the server reads this structured field (#1384)


def check_agent_broad_search_after_budget(client=None) -> bool:
    try:
        d = _call_agent(AGENT_BROAD_SEARCH_TEXT, history=AGENT_BROAD_SEARCH_HISTORY,
                        ask_count=AGENT_BROAD_SEARCH_ASK_COUNT)
    except Exception as e:
        print(f"FAIL agent-broad-search-after-budget: request failed ({e})"); return False
    q = d.get("query") or {}
    problems = []
    if d.get("kind") != "listings":
        problems.append(f"kind={d.get('kind')} (expected listings: city named + budget spent)")
    # The named city must survive into the executed search (owner 2026-09-04: a search needs a
    # real place — and that place must be the one the user gave, never invented or dropped).
    if "جدة" not in (q.get("location") or ""):
        problems.append(f"location={q.get('location')!r} lost the named city جدة")
    # The regression this half still guards: the non-location signal must not be erased — the
    # vague-size «كبير» is captured as askAbout (never a bedroom count), and/or a type carries.
    if not (q.get("type") or (q.get("askAbout") or [])):
        problems.append(f"no usable non-location signal captured: query={q}")
    if problems:
        detail = "agent-broad-search-after-budget: " + "; ".join(problems)
        print(f"FAIL {detail}")
        if client is not None: _alert(client, "ai_agent_regression", len(problems), detail)
        return False
    print(f"OK  agent-broad-search-after-budget: kind=listings, location={q.get('location')!r}, "
          f"type={q.get('type')}, askAbout={q.get('askAbout')}")
    return True


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", choices=["agent", "agent_broad_search_after_budget", "not_ready", "awal",
                                       "stale_index", "unverified_kill", "aqar_licence_price",
                                       "deletion_spike_no_rereise", "normal_filter_barrier"],
                    help="run one check")
    args = ap.parse_args()

    if args.only == "agent":
        return 0 if check_agent(None) else 1
    if args.only == "agent_broad_search_after_budget":
        return 0 if check_agent_broad_search_after_budget(None) else 1

    from scrapers.common import db  # lazy: needs SUPABASE_SERVICE_ROLE_KEY (CI only)
    client = db.sb()
    results = []
    if args.only in (None, "not_ready", "stale_index"):
        try:
            counts = get_counts(client)  # instant read of the pre-computed 1-row table
        except Exception as e:
            print(f"FAIL audit counts unavailable: {e}")
            _alert(client, "audit_counts_unavailable", 0, str(e))
            results.append(False)
            counts = None
        if counts is not None:
            if args.only in (None, "not_ready"):   results.append(check_not_ready(client, counts))
            if args.only in (None, "stale_index"): results.append(check_stale_index(client, counts))
    if args.only in (None, "awal"):        results.append(check_awal(client))
    if args.only in (None, "unverified_kill"): results.append(check_unverified_inactivations(client))
    if args.only in (None, "aqar_licence_price"): results.append(check_aqar_price_not_licence(client))
    if args.only in (None, "deletion_spike_no_rereise"): results.append(check_deletion_spike_no_rereise(client))
    if args.only in (None, "normal_filter_barrier"): results.append(check_normal_filter_barrier(client))
    if args.only is None:                  results.append(check_agent(client))
    if args.only is None:                  results.append(check_agent_broad_search_after_budget(client))
    return 0 if all(results) else 1


if __name__ == "__main__":
    sys.exit(main())
