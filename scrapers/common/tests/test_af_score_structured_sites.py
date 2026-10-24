"""af_score never builds a customer request from prose on a site that publishes the field structurally.

sodasyat 14105973 / 13857640 / 13636009 (ops_af_score 2026-10-12): the spec grid lists the lift and parking
but no kitchen; the description says «مطبخ أمريكي». The score asked for a kitchen and counted a miss against a
NULL that is the source's own answer (ADVANCED_FILTER_SOURCE_TRUTH §2). Run:
python -m pytest scrapers/common/tests/test_af_score_structured_sites.py -v
"""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scrapers.common.af_score import says_yes  # noqa: E402

PROSE = ["تتكون كل شقة من 3 غرف، وصالة معيشة، ومطبخ أمريكي، و2 دورات مياه"]


def test_structured_site_prose_never_asks():
    assert says_yes(PROSE, "kitchen", "sodasyat", {}) is False
    assert says_yes(PROSE, "kitchen", "eaqartabuk", {}) is False


def test_prose_site_still_asks():
    assert says_yes(PROSE, "kitchen", "alkhaas", {}) is True


def test_reinvest_parking_is_its_count_not_its_prose():
    """🔬 10-24: 6 of 7 reinvest misses asked parking from «موقف» prose; its parking is info_fields.parking_count."""
    lines = ["شقة للإيجار مع موقف خاص ومطبخ راكب"]
    assert says_yes(lines, "parking", "reinvest", {}) is False
    assert says_yes(lines, "kitchen", "reinvest", {}) is True, "kitchen has no structured home there: prose still states it"
