"""sakan's «تفاصيل الأدوار» per-floor room form → halls / reception_rooms_majlis (🔬 2026-11-04).

The two descriptions are VERBATIM sakan ad text (ads 19509 and 19434, licence numbers removed). Before this
fix both columns were NULL on every sakan ad while 1,780 of 2,283 active ads stated «عدد المجالس: N» and 1,408
«الصالات: N» — af-score 11-03 read living_rooms we_miss 6/10 and majlis 7/10. Mutation: drop the floor sum (keep
only the first floor) or drop «غرف المعيشة» from the map and these fail.
"""
from __future__ import annotations

import sys
import types
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))
_sb = types.ModuleType("supabase")
_sb.Client = object
_sb.create_client = lambda *a, **k: None
sys.modules.setdefault("supabase", _sb)
_dv = types.ModuleType("dotenv")
_dv.load_dotenv = lambda *a, **k: None
sys.modules.setdefault("dotenv", _dv)

from scrapers.sakan import run as R  # noqa: E402

ONE_FLOOR = ("عدد الأدوار:1 تفاصيل الأدوار تفاصيل الدور الأرضي عدد المجالس: 1 ، دورات المياه: 2 ، غرف المعيشة: 1 ، "
             "غرف النوم: 2 ، غرف الماستر: 1 ، الملقط: 1 ، المطابخ: 1 ، مميزات العقار موقف سيارات ، قريب من الخدمات ، "
             "نوافذ زجاج ، غرفة تخزين ، رقم العرض: 19509")
TWO_FLOORS = ("عدد الأدوار:2 تفاصيل الأدوار تفاصيل الدور الأرضي عدد المجالس: 1 ، دورات المياه: 2 ، الصالات: 1 ، "
              "غرف النوم: 1 ، الملقط: 1 ، المطابخ: 1 ، تفاصيل الدور الأول دورات المياه: 1 ، الصالات: 1 ، غرف النوم: 2 ، "
              "غرف الماستر: 2 ، مميزات العقار قريب من الخدمات ، نوافذ زجاج ، موقف سيارات ، رقم العرض: 19434")
# Free prose (ad 100487): rooms named in words, no form — must stay NULL, never a guess.
PROSE = ("الدور الأرضي : مجلس رجال - مقلط مجلس نساء مفتوح على صالة واسعة مطبخ رئيسي - 2 حمام الدور الأول : "
         "4 غرف نوم - صالة مطبخ خدمة - 3 حمام")


def test_one_floor_living_room_and_majlis():
    assert R.floor_room_counts(ONE_FLOOR) == {"reception_rooms_majlis": 1, "halls": 1}


def test_counts_sum_over_floors():
    assert R.floor_room_counts(TWO_FLOORS) == {"reception_rooms_majlis": 1, "halls": 2}


def test_prose_without_the_form_is_silent():
    assert R.floor_room_counts(PROSE) == {}
    assert R.floor_room_counts(None) == {}


def test_arabic_indic_digits():
    assert R.floor_room_counts("تفاصيل الدور الأرضي عدد المجالس: ٢ ، الصالات: ١ ،") == {
        "reception_rooms_majlis": 2, "halls": 1}
