"""Sold-pin coverage for scrapers/dealapp/repair.py (found by the daily engineer routine 2026-08-03,
landed by senior audit run #3).

repair.py re-fetches currently-ACTIVE rows and writes whatever map_listing() returns via the same
shared _wasalt_batch upsert path run.py uses — including active=False for a source-confirmed
SOLD/RENTED re-fetch. That upsert path always resets missing_count=0 (scrapers/common/db.py,
_wasalt_batch), so a repair run that discovers a sold ad and does not pin it afterwards leaves it in
exactly the active=false + missing_count=0 state that the nightly auto_recover_false_inactive()
sweep (jobid 30, 05:20 UTC) resurrects — the same defect class test_sold_pin_coverage.py guards for
run.py, but that guard only scans `{platform}/run.py` and never saw repair.py (added 2026-07-30,
after the guard shipped): the sold flag was silently discarded into `_sold`.

Hermetic source-lint (no network/DB), same style as test_sold_pin_coverage.py.

Run: python -m pytest scrapers/common/tests/test_dealapp_repair_sold_pin.py -v
"""
from __future__ import annotations

from pathlib import Path

REPAIR_PY = Path(__file__).resolve().parents[2] / "dealapp" / "repair.py"


def _src() -> str:
    assert REPAIR_PY.is_file(), f"missing {REPAIR_PY}"
    return REPAIR_PY.read_text(encoding="utf-8")


def test_repair_imports_the_canonical_pin_helper():
    src = _src()
    assert "_pin_sold_inactive" in src, (
        "scrapers/dealapp/repair.py must import and use run.py's _pin_sold_inactive() — "
        "otherwise a re-fetch that finds a sold/rented ad writes active=False with "
        "missing_count=0 via the shared upsert, which auto_recover_false_inactive() resurrects "
        "every morning."
    )


def test_repair_does_not_discard_the_sold_signal():
    src = _src()
    assert "row, cat, _sold = map_listing(" not in src, (
        "scrapers/dealapp/repair.py discards map_listing()'s sold flag (binds it to `_sold`) — "
        "it must capture it (`row, cat, sold = map_listing(...)`) and pin sold ad_numbers "
        "after the batch upsert, exactly like run.py's main() does."
    )


def test_repair_calls_pin_after_the_batch_upsert():
    src = _src()
    pin_call = src.rfind("_pin_sold_inactive(")
    assert pin_call > src.find("def main("), (
        "scrapers/dealapp/repair.py never calls _pin_sold_inactive() in main() — a captured but "
        "unpinned sold signal still protects nothing"
    )
    first_upsert_batch_ref = src.find("upsert_dealapp_residential_batch if category")
    assert first_upsert_batch_ref != -1 and pin_call > first_upsert_batch_ref, (
        "scrapers/dealapp/repair.py: the sold pin must run AFTER the batch upsert (the upsert "
        "resets missing_count=0, so pinning before it would be immediately wiped out)"
    )


if __name__ == "__main__":
    test_repair_imports_the_canonical_pin_helper()
    test_repair_does_not_discard_the_sold_signal()
    test_repair_calls_pin_after_the_batch_upsert()
    print("OK — dealapp repair.py sold-pin regression tests pass")
