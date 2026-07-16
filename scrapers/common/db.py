"""Supabase client + upsert helpers shared by every per-platform scraper.

`sb()` returns a service-role client (bypasses RLS, can write `listings`).
`upsert_listing(row)` writes one normalized row, deduped on (source_platform, source_id).
`begin_run(platform)` / `end_run(...)` write to `scrape_runs` so we can spot a broken source fast.
"""
from __future__ import annotations

import os
import random
import time
from collections import defaultdict
from datetime import datetime, timezone
from typing import Any, Optional

from dotenv import load_dotenv
from supabase import Client, create_client

from scrapers.common.pii import redact_pii
from scrapers.common.placeholder_tokens import PLACEHOLDER_TOKENS, is_placeholder


# Load .env once when this module is first imported.
load_dotenv()


# Transient failures worth retrying instead of crashing the whole scrape. A SATURATED database returns
# Cloudflare 522 (origin connection timed out) with an HTML body that PostgREST surfaces as
# "JSON could not be generated"; we also retry other gateway 5xx, rate-limits, request-timeouts, and
# connection/SSL resets. Everything else (e.g. a real 400/schema error) raises immediately so genuine
# bugs still surface. (Added 2026-06: scrapers were dying on transient 522s during DB-overload windows.)
_TRANSIENT_MARKERS = ("522", "520", "524", "503", "502", "504", "429", "408",
                      "timed out", "timeout", "connection", "json could not be generated",
                      "temporarily unavailable", "eof", "reset by peer", "server disconnected")


def _execute(query, *, what: str = "db", tries: int = 5):
    """Run a PostgREST query with exponential backoff + jitter on TRANSIENT errors (522 etc.), then
    re-raise after the last attempt. Upserts/selects/updates here are idempotent, so retrying is safe."""
    last_exc: Optional[BaseException] = None
    for attempt in range(tries):
        try:
            return query.execute()
        except Exception as exc:  # inspect, then either retry (transient) or re-raise
            last_exc = exc
            msg = str(exc).lower()
            transient = any(m in msg for m in _TRANSIENT_MARKERS)
            if not transient or attempt == tries - 1:
                raise
            delay = min(30.0, 2.0 ** attempt) + random.uniform(0.0, 1.0)
            print(f"⚠ {what}: transient DB error (attempt {attempt + 1}/{tries}), "
                  f"retrying in {delay:.1f}s — {str(exc)[:140]}", flush=True)
            time.sleep(delay)
    raise last_exc  # unreachable; satisfies type checkers


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
    _execute(
        sb().table("listings").upsert(row, on_conflict="source_platform,source_id"),
        what="listings",
    )


def begin_run(platform: str) -> int:
    """Open a row in scrape_runs and return its id, so end_run can finalize it."""
    res = _execute(
        sb().table("scrape_runs").insert({"platform": platform, "started_at": datetime.now(timezone.utc).isoformat()}),
        what="scrape_runs.begin",
    )
    return int(res.data[0]["id"])


def upsert_aqar_residential(row: dict[str, Any]) -> None:
    """Upsert one Aqar residential row, keyed on `ad_number`."""
    row = dict(row)
    row["last_seen_at"] = datetime.now(timezone.utc).isoformat()
    _sanitize_price(row)
    _sanitize_ints(row)
    _ensure_capture(row)
    _reject_placeholder_location(row, table="aqar_residential_listings")
    _execute(sb().table("aqar_residential_listings").upsert(row, on_conflict="ad_number"), what="aqar_residential_listings")


def upsert_aqar_commercial(row: dict[str, Any]) -> None:
    """Upsert one Aqar commercial row, keyed on `ad_number`. Same schema/shape as residential
    (the commercial table was cloned from it), just a different destination table."""
    row = dict(row)
    row["last_seen_at"] = datetime.now(timezone.utc).isoformat()
    _sanitize_price(row)
    _sanitize_ints(row)
    _ensure_capture(row)
    _reject_placeholder_location(row, table="aqar_commercial_listings")
    _execute(sb().table("aqar_commercial_listings").upsert(row, on_conflict="ad_number"), what="aqar_commercial_listings")


def upsert_wasalt_residential(row: dict[str, Any]) -> None:
    """Upsert one Wasalt residential row into its OWN table (separate source), keyed on `ad_number`
    (Wasalt ids are namespaced 'WST<id>' so they never collide with Aqar)."""
    row = dict(row)
    row["last_seen_at"] = datetime.now(timezone.utc).isoformat()
    _sanitize_price(row)
    _sanitize_ints(row)
    _ensure_capture(row)
    _reject_placeholder_location(row, table="wasalt_residential_listings")
    _execute(sb().table("wasalt_residential_listings").upsert(row, on_conflict="ad_number"), what="wasalt_residential_listings")


# Numeric columns by Postgres integer width. A parse glitch that overflows one of these (e.g. a bad
# price_per_meter of 90,533,352,829) used to make the WHOLE batch upsert fail with 22003, dropping
# every row in it. We null the offending FIELD instead of losing the batch — the listing still saves.
_INT2_COLS = frozenset({"bedrooms", "bathrooms", "master_bedrooms", "halls",
                        "reception_rooms_majlis", "property_age", "street_width_m"})
_INT4_COLS = frozenset({"area_m2", "interior_space_m2", "outdoor_area_m2", "price_per_meter",
                        "rent_now_pay_later_monthly", "missing_count"})
_INT8_COLS = frozenset({"price_annual", "price_total"})


def _sanitize_ints(r: dict[str, Any]) -> None:
    """Coerce/NULL integer fields so ONE bad value can never abort the row (or its whole batch).

    Two failure modes protected:
      • overflow (22003): value doesn't fit the column width → NULL that field.
      • bad cast (22P02): a NON-NUMERIC value in an integer column. Real incident 2026-07-06:
        Wasalt commercial sends property_age="New" (a string) — Postgres rejected the smallint
        cast, the WHOLE upsert failed with HTTP 400, and every listing in that batch was silently
        dropped on every 8h sweep. Numeric strings ("5", "5.0") are coerced to int; anything
        non-numeric → NULL. Only the numeric FILTER column is nulled — the raw source value stays
        preserved in additional_info / source_capture, so the card still shows exactly what the
        source published (search-engine-not-marketplace rule).
    """
    for col, lo, hi in ((_INT2_COLS, -32768, 32767),
                        (_INT4_COLS, -2147483648, 2147483647),
                        (_INT8_COLS, -9223372036854775808, 9223372036854775807)):
        for c in col:
            v = r.get(c)
            if v is None:
                continue
            if isinstance(v, bool):
                r[c] = None          # bool is an int subclass in Python; never a real count/price
                continue
            if isinstance(v, str):
                try:
                    v = int(float(v.strip()))
                except (ValueError, OverflowError):
                    r[c] = None      # "New", "غير محدد", "" … → honest NULL, listing still saves
                    continue
                r[c] = v
            elif isinstance(v, float):
                try:
                    v = int(v)
                except (ValueError, OverflowError):  # nan / inf
                    r[c] = None
                    continue
                r[c] = v
            elif not isinstance(v, int):
                r[c] = None          # lists/dicts/other junk can't cast either
                continue
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


def _ensure_capture(r: dict[str, Any]) -> None:
    """Unified raw-capture guarantee (Half A of the raw-capture standard).

    Every stored row — from EVERY platform, via any upsert path — gets `raw_captured_at`
    stamped and a non-null `source_capture` (cleaned text + image count + url path).
    Scrapers that already build a richer PDPL-aware `source_capture` (aqar, wasalt, sanadak,
    aqargate, …) keep theirs; we only fill the standard keys if missing. Platforms that build
    nothing get a fallback derived from the row's own (already-cleaned) description/title,
    PII-redacted as a safety net. `raw_html_key` / `image_storage_keys` stay NULL here — those
    are written later by the gated object-storage mirror (Half B)."""
    r["raw_captured_at"] = datetime.now(timezone.utc).isoformat()
    cap = r.get("source_capture")
    photos = r.get("photo_urls") or []
    if not cap:
        text = r.get("description") or r.get("title")
        r["source_capture"] = {
            "schema": "auto.v1-fallback",
            "source_text": redact_pii(text) if text else None,
            "url_path": r.get("listing_url"),
            "image_count": len(photos),
        }
    elif isinstance(cap, dict):
        cap.setdefault("image_count", len(photos))
        cap.setdefault("url_path", r.get("listing_url"))
        cap.setdefault("schema", "unspecified")


# Location columns checked on EVERY upsert path (2026-07-10 architecture redesign — see
# docs/LOCATION_RESOLUTION.md). Scoped to columns actually present across platform tables; a
# missing key is just `.get()` → None, a no-op. Includes both the legacy English `city`/`region`
# columns AND the first-class Arabic `city_ar` column some platforms (wasalt, sanadak, aqargate,
# aldarim, alhoshan, hajer, aqarmonthly) carry alongside it.
_LOCATION_COLS = ("city", "region", "city_ar", "district_ar", "neighborhood")


def guard_location_update(fields: dict[str, Any], *, table: str, ref: str = "") -> dict[str, Any]:
    """PUBLIC — call this on any dict of column→value you're about to write directly via
    `sb().table(...).update(...)` OUTSIDE the upsert helpers below (2026-07-10 architecture
    redesign, see docs/LOCATION_RESOLUTION.md).

    CORRECTION (adversarial review, 2026-07-10): the upsert helpers' own `_reject_placeholder_location`
    is NOT actually "the one path every write goes through" — several scripts write location fields
    via a direct `.table().update()` that bypasses upsert entirely (confirmed: scrapers/wasalt/
    enrich_ar.py sets city_ar/district_ar/region_id this way on a DAILY schedule). Those call sites
    must call this function explicitly on their own update payload before executing it. A missing
    call site is a real gap, not a false alarm — if you add a new direct-write script that touches
    city/region/district_ar/neighborhood, call this on its update dict.

    Mutates and returns `fields` for convenient inline use: `c.table(t).update(guard_location_update(upd, table=t)).execute()`.
    """
    caught = [col for col in _LOCATION_COLS if is_placeholder(fields.get(col))]
    if not caught:
        return fields
    for col in caught:
        fields[col] = None
    try:
        _execute(
            sb().table("location_pipeline_alerts").insert({
                "alert_type": "placeholder_location_blocked",
                "metric": len(caught),
                "detail": f"{table}: blocked placeholder in {caught}" + (f" ({ref})" if ref else ""),
            }),
            what="location_pipeline_alerts.insert",
        )
    except Exception:
        pass  # monitoring must never break the actual upsert
    print(f"⚠ {table}: blocked placeholder location value in {caught} — nulled, not written", flush=True)
    return fields


def _reject_placeholder_location(r: dict[str, Any], *, table: str) -> None:
    """Backstop for the upsert helpers below (`_wasalt_batch` + the 3 dedicated `upsert_*`
    functions) — every row THOSE specific functions handle passes through here before the actual
    Postgres write. Thin wrapper around `guard_location_update` (one check, one place) for callers
    that already hold a full row dict rather than a partial update dict. See `guard_location_update`
    for direct-write scripts that bypass the upsert helpers entirely."""
    guard_location_update(r, table=table, ref=f"ad_number={r.get('ad_number')}")


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
        _ensure_capture(r)
        _reject_placeholder_location(r, table=table)
        seen[r["ad_number"]] = r
    _execute(sb().table(table).upsert(list(seen.values()), on_conflict="ad_number"), what=table)


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
    min_coverage: Optional[float] = None,
) -> int:
    """Age out active rows whose ad_number wasn't seen this crawl — CONSERVATIVELY.

    A listing is NEVER deactivated for being missing from a single crawl. Instead each
    consecutive miss bumps its `missing_count`; only once it has been missing `grace`
    crawls IN A ROW (default 3) do we flip `active = false`. Any crawl that sees the
    listing again resets the counter to 0 (done in the upsert), so a transient gap —
    pagination glitch, proxy hiccup, a page that 500'd — can never kill a live listing.

    THREE circuit breakers on top of that — a partial/failed crawl must NEVER cascade:
      • 0 ad_numbers seen but the table still has active rows → SKIP entirely (site down/blocked;
        this is what wiped Jazan Watan + East Abha when the old loop deactivated all on a timeout).
      • COLLAPSE guard: the set missing this crawl exceeds `max_prune_frac` (30%) of the active
        rows AND there are ≥ `min_active_guard` of them → SKIP entirely, bump nothing. A sudden
        30%+ disappearance is a broken crawl. (The old 85% guard let awal go 63%, dealapp 40%.)
      • PARTIAL-SCRAPE guard (coverage floor, default 0.80): only count misses when this run
        RE-SAW at least `min_coverage` of the active catalog. A flaky/rate-limited run that saw
        only part of it must not touch the rest — this is what caused the dealapp/sanadak flip-flop
        churn. Tune via PRUNE_MIN_COVERAGE. (Combined with the 3-strike counter, a listing now needs
        both good coverage AND three misses in a row before it can go inactive.)

    Returns the number of rows actually DEACTIVATED this run (0 when misses were only counted),
    or -1 when a circuit breaker tripped and nothing was changed, so the caller can flag the
    run degraded.
    """
    if min_coverage is None:
        min_coverage = float(os.environ.get("PRUNE_MIN_COVERAGE", "0.80"))
    c = sb()
    q = c.table(table).select("ad_number, missing_count").eq("active", True)
    if source:
        q = q.eq("source", source)
    existing = _execute(q, what=table + ".prune_select").data or []
    if not existing:
        return 0
    seen = set(seen_ads)
    if not seen:
        return -1  # nothing scraped → site almost certainly down → keep everything active
    gone = [r for r in existing if r["ad_number"] not in seen]
    if len(existing) >= min_active_guard:
        if len(gone) > max_prune_frac * len(existing):
            return -1  # collapse guard: a big fraction vanished at once → treat as a broken crawl
        if (len(existing) - len(gone)) / len(existing) < min_coverage:
            return -1  # partial-scrape guard: saw too little of the catalog to trust a prune
    if not gone:
        return 0
    # Consecutive-miss: group the missing rows by their CURRENT miss count so each distinct
    # increment is one batched UPDATE. Rows that reach `grace` misses in a row flip inactive;
    # everything else just ticks up (and resets to 0 the next time the upsert re-sees it).
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
            _execute(c.table(table).update(payload).in_("ad_number", ads[i:i + 200]),
                     what=table + ".prune_update")
        if new_missing >= grace:
            killed += len(ads)
    return killed


def end_run(
    run_id: int,
    *,
    ok: bool,
    rows_seen: int,
    rows_upserted: int,
    notes: Optional[str] = None,
    allow_empty: bool = False,
    floor: int = 0,
    degraded: bool = False,
    check_tables: Optional[list[str]] = None,
) -> bool:
    """Finalize a scrape_runs row. Returns the EFFECTIVE ok actually written.

    RC-B fail-visible finalization (hardening 2026-07-13). A blocked crawl, a served
    login/consent shell, a silently-changed API shape, or an exhausted proxy raises no
    exception, so a scraper finalizes ok=True with rows_seen=0 — a dead source that reads
    as perfectly healthy. That is exactly how alnokhba/souq24 stayed "green" for days while
    returning nothing. Every one of the ~34 scrapers funnels through this single call, so we
    demote a dishonest run to ok=False HERE rather than trusting each run.py tail to get it
    right:
      • rows_seen == 0 and not allow_empty         → dead / blocked source
      • floor > 0 and rows_seen < floor            → suspicious partial crawl (per-platform sanity floor)
      • degraded (e.g. prune_unseen returned -1)   → an integrity guard tripped mid-run
      • check_tables=[...] and a row this run touched fails a field-range sanity check
        (garbage price, a placeholder location, a blank critical field — "finished successfully"
        is not the same claim as "the rows it wrote are sane"; see mon_check_run_field_ranges)
    This only ever DEMOTES: an explicit ok=False from an except-block stays False; a healthy
    run stays True. The single legitimate empty run — gathern's commercial no-op — opts out
    with allow_empty=True. Batch-0 detector D1 (mon_detect_silent_scraper_death) alerts on the
    resulting ok=False, and the returned bool lets a caller `sys.exit(1)` to redden CI too.
    """
    effective_ok = bool(ok)
    demotions: list[str] = []
    if effective_ok:
        if allow_empty:
            pass  # caller asserts an empty/low run is legitimate (e.g. gathern commercial no-op)
        elif rows_seen == 0:
            effective_ok = False
            demotions.append("0-row run (blocked/empty source?)")
        elif floor > 0 and rows_seen < floor:
            effective_ok = False
            demotions.append(f"rows_seen {rows_seen} < floor {floor} (partial crawl?)")
        if check_tables:
            # Monitoring must never fail an already-committed run — the rows are written either
            # way, this only affects whether the run is HONESTLY reported as degraded.
            try:
                run_row = _execute(
                    sb().table("scrape_runs").select("platform, started_at").eq("id", run_id),
                    what="scrape_runs.select_for_check",
                ).data[0]
                for tbl in check_tables:
                    field_bad = _execute(
                        sb().rpc("mon_check_run_field_ranges", {
                            "p_run_id": run_id,
                            "p_platform": run_row["platform"],
                            "p_table": tbl,
                            "p_since": run_row["started_at"],
                            "p_placeholder_tokens": list(PLACEHOLDER_TOKENS),
                        }),
                        what="mon_check_run_field_ranges",
                    ).data
                    if field_bad:
                        degraded = True
            except Exception:
                pass
        if degraded:  # an integrity trip is never OK, even for an allow_empty run
            effective_ok = False
            demotions.append("integrity guard tripped (degraded)")
    final_notes = notes
    if demotions:
        tag = "RC-B demoted ok=False: " + "; ".join(demotions)
        final_notes = f"{notes} | {tag}" if notes else tag
    _execute(
        sb().table("scrape_runs").update(
            {
                "finished_at": datetime.now(timezone.utc).isoformat(),
                "ok": effective_ok,
                "rows_seen": rows_seen,
                "rows_upserted": rows_upserted,
                "notes": final_notes,
            }
        ).eq("id", run_id),
        what="scrape_runs.end",
    )
    return effective_ok


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
