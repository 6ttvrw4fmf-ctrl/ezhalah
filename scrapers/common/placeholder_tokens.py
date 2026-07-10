"""THE single canonical list of location placeholder/sentinel tokens (2026-07-10 architecture
redesign — see docs/LOCATION_RESOLUTION.md). Deliberately dependency-free (no Supabase, no
network) so both `scrapers/common/arabic_location.py` (resolution) and `scrapers/common/db.py`
(the DB-write enforcement backstop) can import it without any circular-import risk.

A value here is NEVER a real Saudi city/region/district name — it's a sentinel a scraper's own
(now-forbidden) placeholder logic used to write instead of an honest NULL. Keep this list in sync
with src/data/remote.ts's JUNK_LOCATION_TOKENS (frontend defense-in-depth layer) — three
independent layers deliberately check the same set: this one (resolution/backfill), db.py
(the last line of defense before a write reaches Postgres), and remote.ts (display, for any
placeholder that predates this redesign or reaches the DB through some other path).
"""
from __future__ import annotations

PLACEHOLDER_TOKENS = frozenset({
    "other", "unknown", "n/a", "none", "null", "undefined", "",
    "غير محدد", "اخرى", "أخرى",
})


def is_placeholder(value: object) -> bool:
    """True when `value` is a known junk sentinel rather than a real place name. Case/whitespace-
    insensitive; non-string input (None, numbers) is never a placeholder by definition."""
    if not isinstance(value, str):
        return False
    return value.strip().lower() in PLACEHOLDER_TOKENS
