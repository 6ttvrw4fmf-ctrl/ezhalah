"""Backlog 312 (owner 2026-10-09): every crawler keeps the source's OWN map pin, through ONE gate.

muhaysini publishes latitude/longitude on every ad; they sat only in source_capture, which the index
never reads, so 0% of its ~11k searchable ads had a pin. The index's generic branch reads
additional_info->>'latitude' / 'longitude', so the pin now travels there. Executed on the real
map_listing() over the committed real records.
Run: python -m pytest scrapers/common/tests/test_source_pins_reach_the_index.py -q
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT))

import scrapers.common.tests.test_muhaysini_price_period_and_pdpl as T  # noqa: E402
from scrapers.common.source_pin import sa_pin  # noqa: E402


def test_gate():
    assert sa_pin("24.366433", "39.605524") == (24.366433, 39.605524)
    assert sa_pin(0, 0) == (None, None)
    assert sa_pin(51.5, -0.12) == (None, None)
    assert sa_pin(None, 46.7) == (None, None)
    assert sa_pin("x", "y") == (None, None)


def test_muhaysini_pin_fields():
    assert T.mhs.pin_fields({"latitude": "24.366433", "longitude": "39.605524"}) == {
        "latitude": 24.366433, "longitude": 39.605524}
    assert T.mhs.pin_fields({"latitude": "0", "longitude": "0"}) == {}
    assert T.mhs.pin_fields({}) == {}


def test_muhaysini_row_builder_uses_it():
    src = (ROOT / "scrapers" / "muhaysini" / "run.py").read_text(encoding="utf-8")
    body = src.split('row["additional_info"] = strip_pii_fields')[0]
    assert "**pin_fields(rec)," in body.split("info = {")[-1] or "**pin_fields(rec)," in body


def test_tuba_row_builder_uses_the_gate():
    from scrapers.common.source_pin import pin_dict
    assert pin_dict("21.5", "39.2") == {"latitude": 21.5, "longitude": 39.2}
    assert pin_dict(0, 0) == {}
    src = (ROOT / "scrapers" / "tuba" / "run.py").read_text(encoding="utf-8")
    assert 'pin_dict((ar.get("location") or {}).get("latitude")' in src
