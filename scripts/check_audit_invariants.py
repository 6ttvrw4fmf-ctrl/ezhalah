#!/usr/bin/env python3
"""Nightly production-audit invariants (2026-07-24) — the checks a daily audit was skipping.

Runs THREE live-production checks and exits non-zero + logs a row to location_pipeline_alerts if
any fails (same "build fails + ops dashboard" mechanism as scripts/check_placeholder_locations.py):

  1. NOT-READY REASON INVARIANT — every production_ready=false row in listing_native_location_v2
     must fall into a KNOWN reason bucket: (a) blank source city, or (b) a source city that hasn't
     resolved to a canonical city_id yet. A not-ready row that ALREADY has a resolved city
     (city_ar present AND city_id present) is UNEXPLAINED → alert. This is the "every not-ready row
     has a verified reason" invariant (owner request 2026-07-24). Verified live the same day: 1,070
     not-ready = 787 blank-city + 283 city-unresolved, 0 unexplained.

  2. AWAL SCRAPER LIVENESS — Awal (awaalun.com) is an auction/listing office that publishes NO
     prices, so price coverage is 0/N BY DESIGN (scrapers/awal/run.py hard-codes price=NULL; three
     live source pages confirmed zero price markup, 2026-07-24). So 0 prices is EXPECTED and must
     NOT be flagged. What we DO watch: that the scraper is still alive (active listings > 0) — a
     drop to 0 means the crawler broke, which IS a real signal.

  3. LIVE AI AGENT — POST fixed Arabic queries to the production `agent` edge function and assert
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
    """The heavy location counts, computed server-side by audit_location_counts() which raises its own
    statement_timeout — counting listing_native_location_v2 / the drift view via plain PostgREST
    `count=exact` intermittently trips the short per-request timeout (57014), esp. during a matview
    refresh. One RPC call returns not_ready_total / not_ready_unexplained / search_index_drift."""
    return client.rpc("audit_location_counts").execute().data or {}


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
    """True = OK. Awal price=0 is by design; we only alert if the scraper died (0 active)."""
    active = 0
    for tbl in ("awal_residential_listings", "awal_commercial_listings"):
        active += client.table(tbl).select("listing_url", count="exact").eq("active", True).limit(1).execute().count or 0
    if active > 0:
        print(f"OK  awal liveness: {active} active listings (price coverage 0 is EXPECTED — "
              f"awaalun.com publishes no prices; scraper leaves NULL by design).")
        return True
    detail = "awal has 0 active listings — the awaalun.com scraper appears to have stopped."
    print(f"FAIL awal liveness: {detail}")
    _alert(client, "awal_scraper_dead", 0, detail)
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
    ap.add_argument("--only", choices=["agent", "not_ready", "awal", "stale_index"], help="run one check")
    args = ap.parse_args()

    if args.only == "agent":
        return 0 if check_agent(None) else 1

    from scrapers.common import db  # lazy: needs SUPABASE_SERVICE_ROLE_KEY (CI only)
    client = db.sb()
    results = []
    if args.only in (None, "not_ready", "stale_index"):
        counts = get_counts(client)  # one server-side RPC feeds both count-based checks
        if args.only in (None, "not_ready"):   results.append(check_not_ready(client, counts))
        if args.only in (None, "stale_index"): results.append(check_stale_index(client, counts))
    if args.only in (None, "awal"):        results.append(check_awal(client))
    if args.only is None:                  results.append(check_agent(client))
    return 0 if all(results) else 1


if __name__ == "__main__":
    sys.exit(main())
