"""راكز: the project's spec list answers the BUILDING traits (lift, air conditioning) for every unit in it,
never the UNIT traits (maid / driver room, parking, kitchen) — backlog 467, 🔬 2026-10-18.

Measured 2026-10-18: no rakez project mixes unit types, and ops_af_score rakez read 0 of 7 findable because
«مصاعد» / «مصاعد إيطالية» / «تكييف مخفي» on the project's own page were never stored.

Run: python -m pytest scrapers/common/tests/test_rakez_project_spec_building_traits.py -v
"""
from __future__ import annotations

import sys
import types
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
sys.modules.setdefault("scrapers.common.db", types.ModuleType("scrapers.common.db"))

from scrapers.common import normalize as N  # noqa: E402
from scrapers.rakez import run as R  # noqa: E402


def test_plural_lifts_is_an_elevator_fleet_wide():
    # verbatim rakez feature terms (projects 68407, 70181)
    assert N.prose_amenities("مصاعد").get("elevator") is True
    assert N.prose_amenities("مصاعد إيطالية").get("elevator") is True
    assert N.prose_amenities("يوجد مصاعد حديثة").get("elevator") is True


def test_plural_keeps_the_negation_and_prepared_only_rules():
    assert N.prose_amenities("تأسيس مصاعد").get("elevator") is None
    assert N.prose_amenities("بدون مصاعد").get("elevator") is False   # a stated no (owner 2026-10-24)
    assert N.amenities_from_text("بدون مصاعد").get("elevator") is False


def test_project_spec_gives_lift_and_ac():
    # project 70181, verbatim
    f = ["تراس", "تكييف مخفي", "غرفة خادمة", "غرفة سائق", "مصاعد إيطالية", "مطبخ", "منزل ذكي"]
    assert R.project_answers(f) == {"elevator": True, "air_conditioner": True}


def test_project_spec_never_stamps_unit_traits():
    # project 31681 (villas): maid room, parking — a unit trait, never read from the project list
    f = ["4 غرف نوم", "غرفة خادمة", "غرفة غسيل", "مواقف خاصة", "مستودع"]
    assert R.project_answers(f) == {}


def test_prepared_lift_in_the_spec_is_unknown():
    assert R.project_answers(["تأسيس مصعد", "تأسيس تكييف"]) == {}


def test_empty_spec_answers_nothing():
    assert R.project_answers([]) == {}
    assert R.project_answers(None) == {}


def test_air_conditioned_corridors_are_not_the_units_ac():
    # 54 units on the first crawl, 2026-10-18: the only AC term was the common corridors.
    assert R.project_answers(["مصاعد", "ممرات مكيفة", "غرفة خادمة"]) == {"elevator": True}
    assert R.project_answers(["ممرات مكيفة", "تكييف مخفي"]) == {"air_conditioner": True}
