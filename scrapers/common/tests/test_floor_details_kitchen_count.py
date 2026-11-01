"""A labelled kitchen COUNT is a kitchen statement (🔬 AF engineer, 2026-10-07).

sakan and tuba carry one broker template whose floor-details block prints «المطابخ: 1» beside
«دورات المياه: 2 ، الصالات: 1». The plural shares no substring with «مطبخ», so the shared prose reader
never saw it: 2,619 sakan and 273 tuba ads stated a kitchen while storing NULL, invisible to a customer
asking the Advanced Filter for one (ops_af_score 2026-10-07, sakan_residential_listings:12612200).

    python -m pytest scrapers/common/tests/test_floor_details_kitchen_count.py -q
"""
from __future__ import annotations

import sys

sys.path.insert(0, ".")

from scrapers.common import normalize as N  # noqa: E402
from scrapers.sakan import run as S  # noqa: E402
from scrapers.tuba import run as T  # noqa: E402

# Verbatim shape of sakan_residential_listings:12612200's ad body (licence numbers dropped).
FLOORS = ("عدد الأدوار:2 يوجد ملحق علوي تفاصيل الأدوار تفاصيل الدور الأرضي دورات المياه: 2 ، الصالات: 1 ، "
          "غرف النوم: 2 ، غرف الماستر: 1 ، المطابخ: 1 ، تفاصيل الدور الأول دورات المياه: 2 ، الصالات: 1 ، "
          "مميزات العقار نوافذ زجاج ، قريب من الخدمات ، تأسيس مصعد ، رقم العرض: 18352")


def test_count_is_tri_state():
    assert N.kitchen_from_count(FLOORS) is True
    assert N.kitchen_from_count("المطابخ: 0 ، الصالات: 1") is False
    assert N.kitchen_from_count("المطابخ: 0 ، المطابخ: 2") is True       # any floor with a kitchen
    assert N.kitchen_from_count("شقة واسعة قريبة من الخدمات") is None   # silence
    assert N.kitchen_from_count(None) is None


def test_sakan_stores_the_stated_kitchen_and_keeps_the_lift_unknown():
    out = S._amenities({"description": FLOORS, "features": []}, {})
    assert out.get("kitchen") is True
    assert "elevator" not in out or out["elevator"] is not True        # «تأسيس مصعد» is no lift


def test_sakan_contradiction_is_dropped():
    out = S._amenities({"description": "بدون مطبخ. المطابخ: 1", "features": []}, {})
    assert "kitchen" not in out


def test_tuba_stores_the_stated_kitchen():
    assert T._prose_amenities(["كهرباء"], FLOORS).get("kitchen") is True
    assert "kitchen" not in T._prose_amenities([], "قريب من الخدمات ، موقف سيارات")
