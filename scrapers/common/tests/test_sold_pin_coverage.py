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
  1. the canonical `_pin_sold_inactive` helper exists and routes through the ONE shared law,
     `scrapers/common/sold_pin.pin_source_confirmed_gone`, naming the source field it read,
  2. main() actually CALLS it (a defined-but-never-called helper pins nothing),
  3. the first pin call sits AFTER the first upsert (the upsert is what resets missing_count=0 —
     pinning before it would be immediately undone) and BEFORE prune_unseen (pinned rows must
     already be active=false so prune's active=true scan skips them).

THE PAYLOAD MOVED, AND THAT IS THE POINT (2026-09-14). Until this date each covered scraper
carried its own byte-identical copy of the pin body, and this file asserted the literal payload in
each copy. Eleven copies of one law is eleven chances to omit a clause — and one had been omitted
everywhere but abeea: the per-row EVIDENCE row that makes a deactivation falsifiable. The payload
now lives once, in `scrapers/common/sold_pin.py`, together with the evidence write; this file
asserts every platform reaches it and that no platform re-implements it locally, which is strictly
stronger than asserting a literal eleven times. See `scripts/verify-sold-pin-evidence-law.ts`.

Run: python -m pytest scrapers/common/tests/test_sold_pin_coverage.py -v
"""
from __future__ import annotations

import ast
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
    # later arrivals, both publishing تم البيع / تم التأجير in property_status
    "alta", "amaall",
]

# The canonical pin payload — active=false plus the prune 3-strike missing_count so the row can
# never match auto_recover_false_inactive()'s missing_count=0 trigger. It lives in exactly ONE
# place now; a platform that spells it out locally is a twelfth copy of the law.
PIN_PAYLOAD = '{"active": False, "missing_count": 3}'
SHARED_LAW = SCRAPERS_DIR / "common" / "sold_pin.py"
SHARED_CALL = "sold_pin.pin_source_confirmed_gone("
# A CALL site (not the def line): the helper name at start-of-expression, i.e. indented and not
# preceded by `def `.
CALL_RE = re.compile(r"^\s*_pin_sold_inactive\(", re.M)


def _src(name: str) -> str:
    path = SCRAPERS_DIR / name / "run.py"
    assert path.is_file(), f"missing {path}"
    return path.read_text(encoding="utf-8")


def _call_lines(src: str, name: str) -> "tuple[list[int], list[int], list[int]]":
    """Line numbers of the REAL call sites, read from the syntax tree.

    Deliberately not `src.find("db.prune_unseen")`. On 2026-09-06 eastabha gained an oracle whose
    explanatory comment names `db.prune_unseen()` — accurately — near the top of the file, and the
    text search matched that PROSE at offset 13,320 while the real call sat at 44,094. The test
    failed on a file whose ordering was perfectly correct.

    That is the source-TEXT trap AGENTS.md warns about, in its less famous direction: a text check
    can fail on correct code as easily as it can pass on broken code, and both cost the same trust.
    A docstring, a comment, or a string literal is not a call site; only a Call node is.
    """
    tree = ast.parse(src)
    pin: list[int] = []
    upsert: list[int] = []
    prune: list[int] = []
    for node in ast.walk(tree):
        if not isinstance(node, ast.Call):
            continue
        f = node.func
        if isinstance(f, ast.Name) and f.id == "_pin_sold_inactive":
            pin.append(node.lineno)
        elif isinstance(f, ast.Attribute):
            if f.attr.startswith("upsert_"):
                upsert.append(node.lineno)
            elif f.attr == "prune_unseen":
                prune.append(node.lineno)
    return sorted(pin), sorted(upsert), sorted(prune)


def test_every_covered_scraper_defines_the_canonical_pin_helper():
    for name in PIN_COVERED:
        src = _src(name)
        assert "def _pin_sold_inactive(" in src, (
            f"scrapers/{name}/run.py lost its _pin_sold_inactive() helper — sold rows there are "
            "again resurrected by the nightly auto_recover_false_inactive() sweep"
        )
        assert SHARED_CALL in src, (
            f"scrapers/{name}/run.py: the pin no longer routes through the shared law "
            f"{SHARED_CALL} — a local copy of the pin is a copy of the law, and the clause that "
            "goes missing in a copy is the per-row evidence row (measured 2026-09-14: 10 of 11 "
            "platforms had already lost it, which made every correct sold-pin read as an "
            "unverified deactivation to mon_detect_unknown_treated_as_dead)"
        )
        assert PIN_PAYLOAD not in src, (
            f"scrapers/{name}/run.py re-implements the canonical pin payload locally. The payload "
            "and the evidence write belong together in scrapers/common/sold_pin.py; spelling the "
            "payload out here is how a platform silently opts out of the evidence half."
        )


def test_the_shared_law_still_carries_the_payload_and_the_evidence_write():
    """The invariant the eleven copies used to assert, asserted ONCE where it now lives."""
    src = SHARED_LAW.read_text(encoding="utf-8")
    assert PIN_PAYLOAD in src, (
        "scrapers/common/sold_pin.py lost the canonical pin payload — without missing_count=3 "
        "every pinned row again matches auto_recover_false_inactive()'s missing_count=0 trigger "
        "and resurrects at 05:20 UTC (measured 2026-07-16: 915 rows)"
    )
    assert '.in_("ad_number"' in src, (
        "scrapers/common/sold_pin.py: the pin must target rows by ad_number (batched .in_ "
        "update) — that is the only stable per-listing key across all platform tables"
    )
    assert "ops_stale_inactivation_probe" in src, (
        "scrapers/common/sold_pin.py no longer writes per-row evidence — a source-confirmed kill "
        "with no ledger row is indistinguishable in SQL from a crawl that timed out, and "
        "mon_detect_unknown_treated_as_dead (P1) raises on exactly that"
    )


def test_every_covered_scraper_calls_the_pin_after_upsert_before_prune():
    for name in PIN_COVERED:
        pin, upsert, prune = _call_lines(_src(name), name)
        assert pin, (
            f"scrapers/{name}/run.py defines _pin_sold_inactive() but never calls it — a "
            "defined-but-unused pin protects nothing; main() must pin gone rows post-upsert"
        )
        assert upsert, f"scrapers/{name}/run.py: no db.upsert_* call found?"
        assert pin[0] > upsert[0], (
            f"scrapers/{name}/run.py: _pin_sold_inactive() is called before the first upsert — "
            "the upsert resets missing_count=0, so a pre-upsert pin is immediately wiped out; "
            "the pin must run AFTER the batch upserts"
        )
        if prune:
            assert pin[0] < prune[0], (
                f"scrapers/{name}/run.py: _pin_sold_inactive() runs after prune_unseen() — gone "
                "rows must already be active=false when prune scans active rows, or they get "
                "double-processed as ordinary misses"
            )


def test_the_ordering_check_reads_calls_not_prose():
    """The ordering test above must not be fooled by a COMMENT that names the functions.

    Watched to happen 2026-09-06: eastabha's new oracle comment mentions `db.prune_unseen()`
    accurately, near the top of the file, and the previous text-search version failed on a file
    whose ordering was correct. This pins the repair so the trap cannot come back.
    """
    good = (
        "def _pin_sold_inactive(x):\n    pass\n"
        "def main():\n"
        "    # this comment mentions db.prune_unseen() and _pin_sold_inactive() early on\n"
        '    """…and so does this docstring: db.prune_unseen()."""\n'
        "    db.upsert_rows(x)\n"
        "    _pin_sold_inactive(y)\n"
        "    db.prune_unseen(t, s)\n"
    )
    pin, upsert, prune = _call_lines(good, "synthetic")
    assert pin and upsert and prune, "the AST reader found no real call sites"
    assert upsert[0] < pin[0] < prune[0], (
        "prose naming these functions was counted as a call site — the reader is reading text, "
        "not the syntax tree"
    )

    # …and it must still CATCH the real defect it exists for: a pin that runs after the prune.
    bad = (
        "def _pin_sold_inactive(x):\n    pass\n"
        "def main():\n"
        "    db.upsert_rows(x)\n"
        "    db.prune_unseen(t, s)\n"
        "    _pin_sold_inactive(y)\n"
    )
    pin, upsert, prune = _call_lines(bad, "synthetic")
    assert not (pin[0] < prune[0]), (
        "the reader failed to see a pin that genuinely runs after the prune — it would pass the "
        "very defect this module exists to prevent"
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
