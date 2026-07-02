"""Supabase client + upsert helpers shared by every per-platform scraper.

`sb()` returns a service-role client (bypasses RLS, can write `listings`).
`upsert_listing(row)` writes one normalized row, deduped on (source_platform, source_id).
`begin_run(platform)` / `end_run(...)` write to `scrape_runs` so we can spot a broken source fast.
"""
from __future__ import annotations

import os
from collections import defaultdict
from datetime import datetime, timezone
from typing import Any, Optional

from dotenv import load_dotenv
from supabase import Client, create_client


# Load .env once when this module is first imported.
load_dotenv()


def sb() -> Client:
    """Service-role Supabase client. Cached on the module for reuse across calls."""
    global _client
    try:
        return _client  # type: ignore[name-defined]
    except NameError:
        url = os.environ["SUPABASE_URL"]
        key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
        _client = create_client(url, key)
        return _client


def upsert_listing(row: dict[str, Any]) -> None:
    """Upsert one normalized row into public.listings keyed on (source_platform, source_id).
    Always refreshes `last_seen_at` so the liveness sweep can tell what's still around.
    """
    row = dict(row)  # don't mutate the caller's dict
    row["last_seen_at"] = datetime.now(timezone.utc).isoformat()
    sb().table("listings").upsert(
        row,
        on_conflict="source_platform,source_id",
    ).execute()


def begin_run(platform: str) -> int:
    """Open a row in scrape_runs and return its id, so end_run can finalize it."""
    res = (
        sb().table("scrape_runs").insert({"platform": platform, "started_at": datetime.now(timezone.utc).isoformat()}).execute()
    )
    return int(res.data[0]["id"])


def upsert_aqar_residential(row: dict[str, Any]) -> None:
    """Upsert one Aqar residential row, keyed on `ad_number`."""
    row = dict(row)
    row["last_seen_at"] = datetime.now(timezone.utc).isoformat()
    _sanitize_price(row)
    _sanitize_ints(row)
    sb().table("aqar_residential_listings").upsert(row, on_conflict="ad_number").execute()


def upsert_aqar_commercial(row: dict[str, Any]) -> None:
    """Upsert one Aqar commercial row, keyed on `ad_number`. Same schema/shape as residential
    (the commercial table was cloned from it), just a different destination table."""
    row = dict(row)
    row["last_seen_at"] = datetime.now(timezone.utc).isoformat()
    _sanitize_price(row)
    _sanitize_ints(row)
    sb().table("aqar_commercial_listings").upsert(row, on_conflict="ad_number").execute()


def upsert_wasalt_residential(row: dict[str, Any]) -> None:
    """Upsert one Wasalt residential row into its OWN table (separate source), keyed on `ad_number`
    (Wasalt ids are namespaced 'WST<id>' so they never collide with Aqar)."""
    row = dict(row)
    row["last_seen_at"] = datetime.now(timezone.utc).isoformat()
    _sanitize_price(row)
    _sanitize_ints(row)
    sb().table("wasalt_residential_listings").upsert(row, on_conflict="ad_number").execute()


# Numeric columns by Postgres integer width. A parse glitch that overflows one of these (e.g. a bad
# price_per_meter of 90,533,352,829) used to make the WHOLE batch upsert fail with 22003, dropping
# every row in it. We null the offending FIELD instead of losing the batch — the listing still saves.
_INT2_COLS = frozenset({"bedrooms", "bathrooms", "master_bedrooms", "halls",
                        "reception_rooms_majlis", "property_age", "street_width_m"})
_INT4_COLS = frozenset({"area_m2", "interior_space_m2", "outdoor_area_m2", "price_per_meter",
                        "rent_now_pay_later_monthly", "missing_count"})
_INT8_COLS = frozenset({"price_annual", "price_total"})


def _sanitize_ints(r: dict[str, Any]) -> None:
    """Null any integer field whose value won't fit its Postgres column (prevents 22003 batch aborts)."""
    for col, lo, hi in ((_INT2_COLS, -32768, 32767),
                        (_INT4_COLS, -2147483648, 2147483647),
                        (_INT8_COLS, -9223372036854775808, 9223372036854775807)):
        for c in col:
            v = r.get(c)
            if isinstance(v, int) and not (lo <= v <= hi):
                r[c] = None


def _sanitize_price(r: dict[str, Any]) -> None:
    """HIDE listings whose price is a clear advertiser typo — total > 1B SAR, per-meter > 300k SAR/m²,
    or annual rent > 100M SAR (e.g. a land ad with سعر المتر = 800,000 × 57,500 m² = 46,000,000,000).
    The source site shows that bogus number too, so a "Price on request" card would contradict the page;
    marking the row inactive keeps the rule that a card's price always equals the price the user sees
    after clicking through. Runs on every upsert path so it can't slip in on any platform."""
    pt, ppm, pa = r.get("price_total"), r.get("price_per_meter"), r.get("price_annual")
    if ((isinstance(pt, (int, float)) and pt > 1_000_000_000)
            or (isinstance(ppm, (int, float)) and ppm > 300_000)
            or (isinstance(pa, (int, float)) and pa > 100_000_000)):
        r["active"] = False


def _wasalt_batch(table: str, rows: list[dict[str, Any]]) -> None:
    if not rows:
        return
    now = datetime.now(timezone.utc).isoformat()
    seen: dict[str, dict[str, Any]] = {}
    for r in rows:
        r = dict(r)
        r["last_seen_at"] = now
        # Seen on the source THIS crawl → reset the consecutive-miss counter (prune_unseen only
        # deactivates after `grace` consecutive misses), and reactivate it: a listing that
        # reappears in the source is live again, so undo any earlier prune. `setdefault` so a
        # scraper that deliberately flags a row inactive (e.g. dealapp's مباع/مؤجر "sold" badge)
        # still wins, and _sanitize_price below can still force a price-typo row inactive.
        r["missing_count"] = 0
        r.setdefault("active", True)
        _sanitize_price(r)
        _sanitize_ints(r)
        seen[r["ad_number"]] = r
    sb().table(table).upsert(list(seen.values()), on_conflict="ad_number").execute()


def upsert_wasalt_residential_batch(rows: list[dict[str, Any]]) -> None:
    """Upsert a WHOLE PAGE of Wasalt residential rows in one request — ~32× fewer round-trips than
    row-by-row, the single biggest speedup for the Wasalt scrape."""
    _wasalt_batch("wasalt_residential_listings", rows)


def upsert_wasalt_commercial_batch(rows: list[dict[str, Any]]) -> None:
    """Same batched upsert pattern, into the separate Wasalt commercial table."""
    _wasalt_batch("wasalt_commercial_listings", rows)


def prune_unseen(
    table: str,
    seen_ads,
    source: Optional[str] = None,
    *,
    grace: int = 3,
    max_prune_frac: float = 0.30,
    min_active_guard: int = 8,
) -> int:
    """Age out active rows whose ad_number wasn't seen this crawl — CONSERVATIVELY.

    A listing is NEVER deactivated for being missing from a single crawl. Instead each
    consecutive miss bumps its `missing_count`; only once it has been missing `grace`
    crawls IN A ROW (default 3) do we flip `active = false`. Any crawl that sees the
    listing again resets the counter to 0 (done in the upsert), so a transient gap —
    pagination glitch, proxy hiccup, a page that 500'd — can never kill a live listing.

    Two circuit breakers on top of that, because a partial/failed crawl must NEVER cascade:
      • 0 ad_numbers seen but the table still has active rows → SKIP entirely (site down/blocked).
      • The set missing this crawl exceeds `max_prune_frac` (30%) of the active rows AND there
        are at least `min_active_guard` of them → SKIP entirely, bump nothing. A sudden 30%+
        disappearance is a broken crawl, not real churn. (The old 85% guard let awal go 63%
        and dealapp 40% inactive in a single pass.)

    Returns the number of rows actually DEACTIVATED this run (0 when misses were only counted),
    or -1 when a circuit breaker tripped and nothing was changed, so the caller can flag the
    run degraded.
    """
    c = sb()
    q = c.table(table).select("ad_number, missing_count").eq("active", True)
    if source:
        q = q.eq("source", source)
    existing = q.execute().data or []
    if not existing:
        return 0
    seen = set(seen_ads)
    if not seen:
        return -1  # nothing scraped → site almost certainly down → keep everything active
    gone = [r for r in existing if r["ad_number"] not in seen]
    if len(existing) >= min_active_guard and len(gone) > max_prune_frac * len(existing):
        return -1  # collapse guard: a big fraction vanished at once → treat as a broken crawl
    if not gone:
        return 0
    # Group the missing rows by their CURRENT miss count so each distinct increment is one
    # batched UPDATE. Rows that reach `grace` this run flip inactive; the rest just tick up.
    by_count: dict[int, list[str]] = defaultdict(list)
    for r in gone:
        by_count[int(r.get("missing_count") or 0)].append(r["ad_number"])
    killed = 0
    for m, ads in by_count.items():
        new_missing = m + 1
        payload: dict[str, Any] = {"missing_count": new_missing}
        if new_missing >= grace:
            payload["active"] = False
        for i in range(0, len(ads), 200):
            c.table(table).update(payload).in_("ad_number", ads[i:i + 200]).execute()
        if new_missing >= grace:
            killed += len(ads)
    return killed


def end_run(run_id: int, *, ok: bool, rows_seen: int, rows_upserted: int, notes: Optional[str] = None) -> None:
    sb().table("scrape_runs").update(
        {
            "finished_at": datetime.now(timezone.utc).isoformat(),
            "ok": ok,
            "rows_seen": rows_seen,
            "rows_upserted": rows_upserted,
            "notes": notes,
        }
    ).eq("id", run_id).execute()


def upsert_aldarim_residential_batch(rows: list[dict[str, Any]]) -> None:
    """Batch upsert Aldarim residential rows into their own table (source='Aldarim')."""
    _wasalt_batch("aldarim_residential_listings", rows)


def upsert_aldarim_commercial_batch(rows: list[dict[str, Any]]) -> None:
    """Batch upsert Aldarim commercial rows into their own table."""
    _wasalt_batch("aldarim_commercial_listings", rows)


# --- 2026-06 batch: Deal App, 24 Souq, Dwelleo, Era Pulse, Al Nowaisiry ---------------------
def upsert_dealapp_residential_batch(rows: list[dict[str, Any]]) -> None:
    _wasalt_batch("dealapp_residential_listings", rows)


def upsert_dealapp_commercial_batch(rows: list[dict[str, Any]]) -> None:
    _wasalt_batch("dealapp_commercial_listings", rows)


def upsert_souq24_residential_batch(rows: list[dict[str, Any]]) -> None:
    _wasalt_batch("souq24_residential_listings", rows)


def upsert_souq24_commercial_batch(rows: list[dict[str, Any]]) -> None:
    _wasalt_batch("souq24_commercial_listings", rows)


def upsert_erapulse_residential_batch(rows: list[dict[str, Any]]) -> None:
    _wasalt_batch("erapulse_residential_listings", rows)


def upsert_erapulse_commercial_batch(rows: list[dict[str, Any]]) -> None:
    _wasalt_batch("erapulse_commercial_listings", rows)


def upsert_nowaisiry_residential_batch(rows: list[dict[str, Any]]) -> None:
    _wasalt_batch("nowaisiry_residential_listings", rows)


def upsert_nowaisiry_commercial_batch(rows: list[dict[str, Any]]) -> None:
    _wasalt_batch("nowaisiry_commercial_listings", rows)


def upsert_october_residential_batch(rows: list[dict[str, Any]]) -> None:
    _wasalt_batch("october_residential_listings", rows)


def upsert_october_commercial_batch(rows: list[dict[str, Any]]) -> None:
    _wasalt_batch("october_commercial_listings", rows)


def upsert_gathern_residential_batch(rows: list[dict[str, Any]]) -> None:
    """Gathern (gathern.co) MONTHLY furnished residential units only (source='Gathern')."""
    _wasalt_batch("gathern_residential_listings", rows)


def upsert_gathern_commercial_batch(rows: list[dict[str, Any]]) -> None:
    _wasalt_batch("gathern_commercial_listings", rows)


def upsert_aqarmonthly_residential_batch(rows: list[dict[str, Any]]) -> None:
    """Aqar DailyRenting MONTHLY furnished short-stay units only (source='Aqar Monthly')."""
    _wasalt_batch("aqarmonthly_residential_listings", rows)


def upsert_deal_residential_batch(rows: list[dict[str, Any]]) -> None:
    """Batch upsert Deal (dealapp.sa) residential rows into their own table (source='Deal')."""
    _wasalt_batch("deal_residential_listings", rows)


def upsert_deal_commercial_batch(rows: list[dict[str, Any]]) -> None:
    """Batch upsert Deal commercial rows into their own table."""
    _wasalt_batch("deal_commercial_listings", rows)


def upsert_aqargate_residential_batch(rows: list[dict[str, Any]]) -> None:
    """Batch upsert Aqargate (aqargate.com) residential rows into their own table (source='Aqargate')."""
    _wasalt_batch("aqargate_residential_listings", rows)


def upsert_aqargate_commercial_batch(rows: list[dict[str, Any]]) -> None:
    """Batch upsert Aqargate commercial rows into their own table."""
    _wasalt_batch("aqargate_commercial_listings", rows)


def upsert_alhoshan_residential_batch(rows: list[dict[str, Any]]) -> None:
    """Batch upsert Al Hoshan (alhoshan.sa) residential rows into their own table (source='Alhoshan')."""
    _wasalt_batch("alhoshan_residential_listings", rows)


def upsert_alhoshan_commercial_batch(rows: list[dict[str, Any]]) -> None:
    """Batch upsert Al Hoshan commercial rows into their own table."""
    _wasalt_batch("alhoshan_commercial_listings", rows)


def upsert_hajer_residential_batch(rows: list[dict[str, Any]]) -> None:
    """Batch upsert Hajer Houses (hajerhouses.com) residential rows (source='Hajer')."""
    _wasalt_batch("hajer_residential_listings", rows)


def upsert_hajer_commercial_batch(rows: list[dict[str, Any]]) -> None:
    """Batch upsert Hajer Houses commercial rows into their own table."""
    _wasalt_batch("hajer_commercial_listings", rows)


def upsert_sanadak_residential_batch(rows: list[dict[str, Any]]) -> None:
    """Batch upsert Sanadak (sanadak.sa) residential rows (source='Sanadak')."""
    _wasalt_batch("sanadak_residential_listings", rows)


def upsert_sanadak_commercial_batch(rows: list[dict[str, Any]]) -> None:
    """Batch upsert Sanadak commercial rows into their own table."""
    _wasalt_batch("sanadak_commercial_listings", rows)


def upsert_eastabha_residential_batch(rows: list[dict[str, Any]]) -> None:
    """Batch upsert East Abha (eastabha.sa) residential rows (source='Eastabha')."""
    _wasalt_batch("eastabha_residential_listings", rows)


def upsert_eastabha_commercial_batch(rows: list[dict[str, Any]]) -> None:
    """Batch upsert East Abha commercial rows into their own table."""
    _wasalt_batch("eastabha_commercial_listings", rows)


def upsert_aqarcity_residential_batch(rows: list[dict[str, Any]]) -> None:
    """Batch upsert Aqar City (aqarcity.net) residential rows (source='Aqarcity')."""
    _wasalt_batch("aqarcity_residential_listings", rows)


def upsert_aqarcity_commercial_batch(rows: list[dict[str, Any]]) -> None:
    """Batch upsert Aqar City commercial rows into their own table."""
    _wasalt_batch("aqarcity_commercial_listings", rows)


def upsert_raghdan_residential_batch(rows: list[dict[str, Any]]) -> None:
    """Batch upsert Raghdan (raghdan.sa) residential rows (source='Raghdan')."""
    _wasalt_batch("raghdan_residential_listings", rows)


def upsert_raghdan_commercial_batch(rows: list[dict[str, Any]]) -> None:
    """Batch upsert Raghdan commercial rows into their own table."""
    _wasalt_batch("raghdan_commercial_listings", rows)


def upsert_eaqartabuk_residential_batch(rows: list[dict[str, Any]]) -> None:
    """Batch upsert Eaqar Tabuk (eaqartabuk.com) residential rows (source='Eaqartabuk')."""
    _wasalt_batch("eaqartabuk_residential_listings", rows)


def upsert_eaqartabuk_commercial_batch(rows: list[dict[str, Any]]) -> None:
    """Batch upsert Eaqar Tabuk commercial rows into their own table."""
    _wasalt_batch("eaqartabuk_commercial_listings", rows)


def upsert_satel_residential_batch(rows: list[dict[str, Any]]) -> None:
    """Batch upsert Satel (satel.sa) residential rows (source='Satel')."""
    _wasalt_batch("satel_residential_listings", rows)


def upsert_satel_commercial_batch(rows: list[dict[str, Any]]) -> None:
    """Batch upsert Satel commercial rows into their own table."""
    _wasalt_batch("satel_commercial_listings", rows)


def upsert_sadin_residential_batch(rows: list[dict[str, Any]]) -> None:
    """Batch upsert Sadin (sadin.com.sa) residential rows (source='Sadin')."""
    _wasalt_batch("sadin_residential_listings", rows)


def upsert_sadin_commercial_batch(rows: list[dict[str, Any]]) -> None:
    """Batch upsert Sadin commercial rows into their own table."""
    _wasalt_batch("sadin_commercial_listings", rows)


def upsert_toor_residential_batch(rows: list[dict[str, Any]]) -> None:
    """Batch upsert Toor (toor.ooo) residential rows (source='Toor')."""
    _wasalt_batch("toor_residential_listings", rows)


def upsert_toor_commercial_batch(rows: list[dict[str, Any]]) -> None:
    """Batch upsert Toor commercial rows into their own table."""
    _wasalt_batch("toor_commercial_listings", rows)


def upsert_mustqr_residential_batch(rows: list[dict[str, Any]]) -> None:
    """Batch upsert Mustqr (mustqr.sa) residential rows (source='Mustqr')."""
    _wasalt_batch("mustqr_residential_listings", rows)


def upsert_mustqr_commercial_batch(rows: list[dict[str, Any]]) -> None:
    """Batch upsert Mustqr commercial rows into their own table."""
    _wasalt_batch("mustqr_commercial_listings", rows)


def upsert_ramzalqasim_residential_batch(rows: list[dict[str, Any]]) -> None:
    """Batch upsert Ramz Al-Qassim (ramzalqasim.com) residential rows (source='Ramzalqasim')."""
    _wasalt_batch("ramzalqasim_residential_listings", rows)


def upsert_ramzalqasim_commercial_batch(rows: list[dict[str, Any]]) -> None:
    """Batch upsert Ramz Al-Qassim commercial rows into their own table."""
    _wasalt_batch("ramzalqasim_commercial_listings", rows)


def upsert_fursaghyr_residential_batch(rows: list[dict[str, Any]]) -> None:
    """Batch upsert Fursa Ghyr (fursaghyr.com) residential rows (source='Fursaghyr')."""
    _wasalt_batch("fursaghyr_residential_listings", rows)


def upsert_fursaghyr_commercial_batch(rows: list[dict[str, Any]]) -> None:
    """Batch upsert Fursa Ghyr commercial rows into their own table."""
    _wasalt_batch("fursaghyr_commercial_listings", rows)


def upsert_jazwtn_residential_batch(rows: list[dict[str, Any]]) -> None:
    """Batch upsert Jazwtn (jazwtn.sa) residential rows (source='Jazwtn')."""
    _wasalt_batch("jazwtn_residential_listings", rows)


def upsert_jazwtn_commercial_batch(rows: list[dict[str, Any]]) -> None:
    """Batch upsert Jazwtn commercial rows into their own table."""
    _wasalt_batch("jazwtn_commercial_listings", rows)


def upsert_mizlaj_residential_batch(rows: list[dict[str, Any]]) -> None:
    """Batch upsert Mizlaj (mizlaj.com.sa) residential rows (source='Mizlaj')."""
    _wasalt_batch("mizlaj_residential_listings", rows)


def upsert_mizlaj_commercial_batch(rows: list[dict[str, Any]]) -> None:
    """Batch upsert Mizlaj commercial rows into their own table."""
    _wasalt_batch("mizlaj_commercial_listings", rows)


def upsert_muktamel_residential_batch(rows: list[dict[str, Any]]) -> None:
    """Batch upsert Muktamel (muktamel.com) residential rows (source='Muktamel')."""
    _wasalt_batch("muktamel_residential_listings", rows)


def upsert_muktamel_commercial_batch(rows: list[dict[str, Any]]) -> None:
    """Batch upsert Muktamel commercial rows into their own table."""
    _wasalt_batch("muktamel_commercial_listings", rows)


# ── Batch 7: Semsar, Aqaratikom (Nawait), Awal, Al Khaas, Abeea, Jurash, Al Nokhba ──────────────
def upsert_aqaratikom_residential_batch(rows: list[dict[str, Any]]) -> None:
    """Batch upsert Aqaratikom / Nawait (aqaratikom.com → nawait.sa) residential (source='Aqaratikom')."""
    _wasalt_batch("aqaratikom_residential_listings", rows)


def upsert_aqaratikom_commercial_batch(rows: list[dict[str, Any]]) -> None:
    _wasalt_batch("aqaratikom_commercial_listings", rows)


def upsert_awal_residential_batch(rows: list[dict[str, Any]]) -> None:
    """Batch upsert Awal (awaalun.com) residential rows (source='Awal')."""
    _wasalt_batch("awal_residential_listings", rows)


def upsert_awal_commercial_batch(rows: list[dict[str, Any]]) -> None:
    _wasalt_batch("awal_commercial_listings", rows)


def upsert_alkhaas_residential_batch(rows: list[dict[str, Any]]) -> None:
    """Batch upsert Al Khaas (alkhaas.net) residential rows (source='Al Khaas')."""
    _wasalt_batch("alkhaas_residential_listings", rows)


def upsert_alkhaas_commercial_batch(rows: list[dict[str, Any]]) -> None:
    _wasalt_batch("alkhaas_commercial_listings", rows)


def upsert_abeea_residential_batch(rows: list[dict[str, Any]]) -> None:
    """Batch upsert Abeea (abeea.com.sa) residential rows (source='Abeea')."""
    _wasalt_batch("abeea_residential_listings", rows)


def upsert_abeea_commercial_batch(rows: list[dict[str, Any]]) -> None:
    _wasalt_batch("abeea_commercial_listings", rows)


def upsert_jurash_residential_batch(rows: list[dict[str, Any]]) -> None:
    """Batch upsert Jurash (jurash.sa) residential rows (source='Jurash')."""
    _wasalt_batch("jurash_residential_listings", rows)


def upsert_jurash_commercial_batch(rows: list[dict[str, Any]]) -> None:
    _wasalt_batch("jurash_commercial_listings", rows)


def upsert_alnokhba_residential_batch(rows: list[dict[str, Any]]) -> None:
    """Batch upsert Al Nokhba (alnokhba-services.com) residential rows (source='Al Nokhba')."""
    _wasalt_batch("alnokhba_residential_listings", rows)


def upsert_alnokhba_commercial_batch(rows: list[dict[str, Any]]) -> None:
    _wasalt_batch("alnokhba_commercial_listings", rows)
