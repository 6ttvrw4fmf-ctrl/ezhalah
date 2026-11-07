"""aqargate's REGA ad licence reaches the card (🔧 2026-11-07).

aqargate's panel is the label/value ROWS shape, so the card shows «رقم رخصة الإعلان» only from a row. The
source publishes adLicenseNumber (stored verbatim in source_capture on 186 of 186 live ads) but the panel
never carried it, and card parity found it on the source page and on 0 cards (aqargate 583398 / 8043271).
Runs the REAL panel builder.

Run: python -m pytest scrapers/aqargate/test_licence_row_on_card.py -v
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from scrapers.aqargate.run import _additional_info  # noqa: E402


def _lic(rows):
    return [r["value"] for r in rows if r["label"] == "Ad license number"]


def test_the_published_licence_is_a_card_row():
    assert _lic(_additional_info({"adLicenseNumber": "7100267912", "planNumber": "1932"})) == ["7100267912"]


def test_a_numeric_licence_is_kept_verbatim():
    assert _lic(_additional_info({"adLicenseNumber": 7100310241})) == ["7100310241"]


def test_no_licence_or_wrong_shape_adds_no_row():
    for bad in (None, "", "12345", "71002679120", "N/A"):
        assert _lic(_additional_info({"adLicenseNumber": bad})) == [], bad


if __name__ == "__main__":   # CI runs scrapers/<platform>/test_*.py one file per interpreter, not via pytest
    test_the_published_licence_is_a_card_row()
    test_a_numeric_licence_is_kept_verbatim()
    test_no_licence_or_wrong_shape_adds_no_row()
    print("✓ aqargate licence row reaches the card")
