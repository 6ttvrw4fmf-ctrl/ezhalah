"""Batch 3 deletion-safety guard (2026-07-16): every scraper with explicit source-side gone/sold
detection must pin those rows AFTER its upserts so the nightly auto_recover_false_inactive()
sweep (pg_cron jobid 30, daily 05:20 UTC) can never resurrect them.

The sweep recovers any row with active=false AND coalesce(missing_count,0)=0 AND a fresh
last_seen_at (price-sane) — and the shared batch upsert unconditionally writes missing_count=0
for every row it touches. So a scraper that writes/knows a listing is SOLD but leaves
missing_count=0 hands the sweep exactly its recover trigger: on 2026-07-16, 907
dealapp_residential + 5 dealapp_commercial + 3 aqaratikom_commercial rows sat live in that
vulnerable state, resurrecting every morning. Four platforms (awal, eastabha, satel,
ramzalqasim) already shipped the `_pin_sold_inactive()` fix (PR #38/#39 lineage); Batch 3 added
the five that never got it: abeea, aqaratikom, hajer, jurash, dealapp.

Hermetic source-lint (no network/DB), mirroring test_no_type_default_fallback.py: for each
covered scraper this asserts
  1. the canonical `_pin_sold_inactive` helper exists with the exact pin payload
     (active=False + missing_count=3, batched over ad_number),
  2. main() actually CALLS it (a defined-but-never-called helper pins nothing),
  3. the first pin call sits AFTER the first upsert (the upsert is what resets missing_count=0 —
     pinning before it would be immediately undone) and BEFORE prune_unseen (pinned rows must
     already be active=false so prune's active=true scan skips them).

Run: python -m pytest scrapers/common/tests/test_sold_pin_coverage.py -v
"""
from __future__ import annotations

import re
from pathlib import Path

SCRAPERS_DIR = Path(__file__).resolve().parents[2]  # …/scrapers

# Every platform with explicit gone/sold detection. Growing this list is expected when a new
# scraper detects sold/rented states; shrinking it needs the same scrutiny as un-retiring a
# platform (see scrapers/RETIRED_PLATFORMS.txt for the spirit of that contract).
PIN_COVERED = [
    # the four originals (sold-resurrection fix, 2026-07-09 lineage)
    "awal", "eastabha", "satel", "ramzalqasim",
    # the five added in Batch 3 (2026-07-16)
    "abeea", "aqaratikom", "hajer", "jurash", "dealapp",
]

# The canonical pin payload — active=false plus the prune 3-strike missing_count so the row can
# never match auto_recover_false_inactive()'s missing_count=0 trigger.
PIN_PAYLOAD = '{"active": False, "missing_count": 3}'
# A CALL site (not the def line): the helper name at start-of-expression, i.e. indented and not
# preceded by `def `.
CALL_RE = re.compile(r"^\s*_pin_sold_inactive\(", re.M)


def _src(name: str) -> str:
    path = SCRAPERS_DIR / name / "run.py"
    assert path.is_file(), f"missing {path}"
    return path.read_text(encoding="utf-8")


def test_every_covered_scraper_defines_the_canonical_pin_helper():
    for name in PIN_COVERED:
        src = _src(name)
        assert "def _pin_sold_inactive(" in src, (
            f"scrapers/{name}/run.py lost its _pin_sold_inactive() helper — sold rows there are "
            "again resurrected by the nightly auto_recover_false_inactive() sweep"
        )
        assert PIN_PAYLOAD in src, (
            f"scrapers/{name}/run.py: the pin no longer writes the canonical payload "
            f"{PIN_PAYLOAD} — without missing_count=3 the row still matches the sweep's "
            "missing_count=0 recover trigger"
        )
        assert '.in_("ad_number"' in src, (
            f"scrapers/{name}/run.py: the pin must target rows by ad_number (batched .in_ "
            "update) — that is the only stable per-listing key across all platform tables"
        )


def test_every_covered_scraper_calls_the_pin_after_upsert_before_prune():
    for name in PIN_COVERED:
        src = _src(name)
        calls = [m.start() for m in CALL_RE.finditer(src)]
        assert calls, (
            f"scrapers/{name}/run.py defines _pin_sold_inactive() but never calls it — a "
            "defined-but-unused pin protects nothing; main() must pin gone rows post-upsert"
        )
        first_upsert = src.find("db.upsert_")
        assert first_upsert != -1, f"scrapers/{name}/run.py: no db.upsert_* call found?"
        assert calls[0] > first_upsert, (
            f"scrapers/{name}/run.py: _pin_sold_inactive() is called before the first upsert — "
            "the upsert resets missing_count=0, so a pre-upsert pin is immediately wiped out; "
            "the pin must run AFTER the batch upserts"
        )
        first_prune = src.find("db.prune_unseen")
        if first_prune != -1:
            assert calls[0] < first_prune, (
                f"scrapers/{name}/run.py: _pin_sold_inactive() runs after prune_unseen() — gone "
                "rows must already be active=false when prune scans active rows, or they get "
                "double-processed as ordinary misses"
            )


def test_covered_scrapers_collect_sold_ids_for_both_tables():
    """Each covered main() must route pinned ids per table (residential vs commercial) — a pin
    against the wrong table silently no-ops (ad_number never matches)."""
    for name in PIN_COVERED:
        src = _src(name)
        for suffix in ("_residential_listings", "_commercial_listings"):
            assert f'"{name}{suffix}"' in src, (
                f"scrapers/{name}/run.py no longer references {name}{suffix} — pin/upsert table "
                "routing changed; update this guard together with the new routing"
            )
