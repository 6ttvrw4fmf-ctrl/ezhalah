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


def upsert_aldarim_residential_batch(rows: list[dict[str, Any]]) -> None:
    """Batch upsert Aldarim residential rows into their own table (source='Aldarim')."""
    _wasalt_batch("aldarim_residential_listings", rows)


def upsert_aldarim_commercial_batch(rows: list[dict[str, Any]]) -> None:
    """Batch upsert Aldarim commercial rows into their own table."""
    _wasalt_batch("aldarim_commercial_listings", rows)


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
