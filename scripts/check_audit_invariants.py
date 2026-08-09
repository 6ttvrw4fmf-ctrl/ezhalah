#!/usr/bin/env python3
"""Nightly production-audit invariants (2026-07-24) — the checks a daily audit was skipping.

Runs FIVE live-production checks and exits non-zero + logs a row to location_pipeline_alerts if
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
    """True = OK. RETIRED 2026-07-28 — this check is now INVERTED.

    awaalun.com lapsed into a GoDaddy domain-parking page: the WP REST catalogue and every
    individual /property/ URL return HTTP 200 with a ~114-133 byte redirect stub to /lander. The
    scraper was retired (#252) and the 51 link-rotted listings were inactivated with the
    source-confirmed pin missing_count=3 (#255, owner-approved) after 8/8 sampled URLs were
    re-fetched and confirmed parked.

    So 0 active rows is now the CORRECT state, and the old assertion (active > 0, "the scraper
    appears to have stopped") would fail every night forever. What is worth watching instead is the
    opposite: rows coming BACK without a decision to un-retire, which would mean either the retired
    scraper is running again or something reactivated dead stock. If awaalun.com genuinely returns,
    un-retire deliberately and restore this check to its original sense.
    """
    active = 0
    for tbl in ("awal_residential_listings", "awal_commercial_listings"):
        active += client.table(tbl).select("listing_url", count="exact").eq("active", True).limit(1).execute().count or 0
    if active == 0:
        print("OK  awal retired: 0 active listings, as expected (awaalun.com is a parked domain; "
              "scraper retired #252, listings inactivated #255).")
        return True
    detail = (f"awal has {active} ACTIVE listings but the platform is retired and awaalun.com is a "
              f"parked domain — something re-activated dead stock or the retired scraper ran.")
    print(f"FAIL awal retired-state: {detail}")
    _alert(client, "awal_reactivated_while_retired", active, detail)
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


def check_bedroom_or(client) -> bool:
    """True = OK. Bedroom multi-select must be an OR: an exact count AND "5+" together returns BOTH
    sets. The search + 2 guided-count RPCs shared a priority-CASE (p_beds_min ignored when
    p_beds_exact set), so "3 or 5+" dropped every 5+ row (Filter QA 2026-08-05; migration
    20260809110618). Asserts, live, count("3 or 5+") == count(3) + count(>=5)."""
    def tc(**extra):
        scope = {"p_deal": "بيع", "p_cities": ["الرياض"], "p_limit": 1, **extra}
        rows = client.rpc("location_search_candidates_ar", scope).execute().data or []
        return rows[0]["total_count"] if rows else 0
    n3 = tc(p_beds_exact=[3]); n5 = tc(p_beds_min=5); both = tc(p_beds_exact=[3], p_beds_min=5)
    if both == n3 + n5 and both > n3 and both > n5:
        print(f"OK  bedroom OR: '3 or 5+' = {both} == {n3} (=3) + {n5} (>=5)."); return True
    detail = (f"bedroom multi-select is not OR: '3 or 5+' returned {both}, expected {n3 + n5} "
              f"(exact-3={n3}, min-5={n5}) — the priority-CASE regression is back.")
    print(f"FAIL bedroom OR: {detail}"); _alert(client, "bedroom_or_predicate_regression", both, detail); return False


def check_filter_qa(client) -> bool:
    """True = OK. Reads mon_filter_qa (Filter QA 2026-08-05). Both counts must be 0:
      buy_token_price_servable — servable Buy rows with an impossible sub-1000 price (parse token);
      cityid_not_in_match — production_ready rows whose city_id is not in their own match_city_ids
      (the Taif→Makkah compound-label class)."""
    rows = client.table("mon_filter_qa").select("buy_token_price_servable,cityid_not_in_match,untaxonomized_type").limit(1).execute().data
    if not rows:
        detail = "mon_filter_qa returned no row — the regression view is missing."
        print(f"FAIL filter-qa: {detail}"); _alert(client, "mon_filter_qa_missing", 0, detail); return False
    tok = rows[0].get("buy_token_price_servable") or 0
    mis = rows[0].get("cityid_not_in_match") or 0
    unk = rows[0].get("untaxonomized_type") or 0
    if tok == 0 and mis == 0 and unk == 0:
        print("OK  filter-qa: 0 servable sub-1000 Buy prices, 0 city_id/match contradictions, 0 untaxonomized types."); return True
    detail = f"filter-qa regression: buy_token_price_servable={tok}, cityid_not_in_match={mis}, untaxonomized_type={unk} (all must be 0)."
    print(f"FAIL filter-qa: {detail}"); _alert(client, "filter_qa_regression", tok + mis, detail); return False


def _call_agent(text: str) -> dict:
    body = json.dumps({"text": text, "locale": "ar", "loggedIn": False, "order": False, "history": []}).encode()
    req = urllib.request.Request(
        f"{SUPABASE_URL}/functions/v1/agent", data=body, method="POST",
        headers={"apikey": PUBLISHABLE_KEY, "Authorization": f"Bearer {PUBLISHABLE_KEY}",
                 "Content-Type": "application/json"},
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


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", choices=["agent", "not_ready", "awal", "stale_index", "unverified_kill", "aqar_licence_price", "bedroom_or", "filter_qa"],
                    help="run one check")
    args = ap.parse_args()

    if args.only == "agent":
        return 0 if check_agent(None) else 1

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
    if args.only in (None, "bedroom_or"):  results.append(check_bedroom_or(client))
    if args.only in (None, "filter_qa"):   results.append(check_filter_qa(client))
    if args.only is None:                  results.append(check_agent(client))
    return 0 if all(results) else 1


if __name__ == "__main__":
    sys.exit(main())
