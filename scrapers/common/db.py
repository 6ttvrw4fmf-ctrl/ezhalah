"""Supabase client + upsert helpers shared by every per-platform scraper.

`sb()` returns a service-role client (bypasses RLS, can write `listings`).
`upsert_listing(row)` writes one normalized row, deduped on (source_platform, source_id).
`begin_run(platform)` / `end_run(...)` write to `scrape_runs` so we can spot a broken source fast.
"""
from __future__ import annotations

import os
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
    sb().table("aqar_residential_listings").upsert(row, on_conflict="ad_number").execute()


def upsert_aqar_commercial(row: dict[str, Any]) -> None:
    """Upsert one Aqar commercial row, keyed on `ad_number`. Same schema/shape as residential
    (the commercial table was cloned from it), just a different destination table."""
    row = dict(row)
    row["last_seen_at"] = datetime.now(timezone.utc).isoformat()
    sb().table("aqar_commercial_listings").upsert(row, on_conflict="ad_number").execute()


def upsert_wasalt_residential(row: dict[str, Any]) -> None:
    """Upsert one Wasalt residential row into its OWN table (separate source), keyed on `ad_number`
    (Wasalt ids are namespaced 'WST<id>' so they never collide with Aqar)."""
    row = dict(row)
    row["last_seen_at"] = datetime.now(timezone.utc).isoformat()
    sb().table("wasalt_residential_listings").upsert(row, on_conflict="ad_number").execute()


def _wasalt_batch(table: str, rows: list[dict[str, Any]]) -> None:
    if not rows:
        return
    now = datetime.now(timezone.utc).isoformat()
    seen: dict[str, dict[str, Any]] = {}
    for r in rows:
        r = dict(r)
        r["last_seen_at"] = now
        seen[r["ad_number"]] = r
    sb().table(table).upsert(list(seen.values()), on_conflict="ad_number").execute()


def upsert_wasalt_residential_batch(rows: list[dict[str, Any]]) -> None:
    """Upsert a WHOLE PAGE of Wasalt residential rows in one request — ~32× fewer round-trips than
    row-by-row, the single biggest speedup for the Wasalt scrape."""
    _wasalt_batch("wasalt_residential_listings", rows)


def upsert_wasalt_commercial_batch(rows: list[dict[str, Any]]) -> None:
    """Same batched upsert pattern, into the separate Wasalt commercial table."""
    _wasalt_batch("wasalt_commercial_listings", rows)


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
