"""wasalt states waterMeter / electricityMeter explicitly — store them tri-state, never invent «no».

Owner rule: docs/ops/EZHALAH_DATA_ARCHITECTURE_GOAL.md — "Never treat 'not mentioned' as 'no'".

What this pins (found live 2026-08-09): the wasalt row builder never wrote
separate_water_meter / separate_electricity_meter at all, so PostgreSQL's `DEFAULT false` invented a
negative on ALL 52,892 active rows — while wasalt's own additionalAttributes panel said "Yes" on
45,723 (water) and 51,801 (electricity) of them. The database was contradicting the source on
~97,500 row-facts, and no code was involved: the schema itself was the fabricator.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

from scrapers.wasalt.run import _yes_no  # noqa: E402

_RUN_PY = Path(__file__).resolve().parents[1].parent / "wasalt" / "run.py"

# Real shapes from wasalt's additionalAttributes panel.
ADDL = [
    {"key": "waterMeter", "label": "Water Meter", "value": "Yes"},
    {"key": "electricityMeter", "label": "Electricity Meter", "value": "No"},
    {"key": "noOfParkings", "label": "Parkings", "value": "2"},
]


def test_yes_becomes_true():
    assert _yes_no(ADDL, "waterMeter") is True


def test_no_becomes_false():
    """wasalt's real negative must survive — this is the value the DEFAULT was masking."""
    assert _yes_no(ADDL, "electricityMeter") is False


def test_absent_key_is_unknown_not_false():
    assert _yes_no(ADDL, "somethingWasaltNeverSends") is None


def test_empty_and_missing_panels_are_unknown():
    for panel in ([], None):
        assert _yes_no(panel, "waterMeter") is None, panel


def test_unexpected_value_is_unknown_not_false():
    assert _yes_no([{"key": "waterMeter", "value": "Maybe"}], "waterMeter") is None
    assert _yes_no([{"key": "waterMeter", "value": ""}], "waterMeter") is None


def test_case_and_whitespace_tolerant():
    assert _yes_no([{"key": "waterMeter", "value": " YES "}], "waterMeter") is True
    assert _yes_no([{"key": "waterMeter", "value": "no"}], "waterMeter") is False


def test_malformed_entries_do_not_crash_the_row():
    assert _yes_no(["not a dict", None, {"key": "waterMeter", "value": "Yes"}], "waterMeter") is True


# ── The row builder must actually EMIT them — a correct helper nobody calls fixes nothing ───────
def test_the_row_builder_writes_both_meter_fields_from_source():
    src = _RUN_PY.read_text(encoding="utf-8")
    assert re.search(r'"separate_water_meter":\s*_yes_no\(addl_info,\s*"waterMeter"\)', src), \
        "separate_water_meter must be written from the source panel, not left to a column default"
    assert re.search(r'"separate_electricity_meter":\s*_yes_no\(addl_info,\s*"electricityMeter"\)', src), \
        "separate_electricity_meter must be written from the source panel, not left to a column default"


def test_the_meter_keys_are_still_kept_from_the_detail_payload():
    """If these drop out of keep_keys the panel arrives empty and both fields silently go NULL."""
    src = _RUN_PY.read_text(encoding="utf-8")
    keep = src.split("keep_keys = {", 1)[1].split("}", 1)[0]
    assert '"waterMeter"' in keep and '"electricityMeter"' in keep
