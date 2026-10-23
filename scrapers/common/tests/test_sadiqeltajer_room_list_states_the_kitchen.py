"""صادق التاجر: the kitchen the ad's own room list names («المكونات») reaches the Advanced Filter.

ops_af_score 2026-10-09: sadiqeltajer 0 of 3 findable, kitchen «we_miss» 3/3; kitchen was stored on 0 of
1,512 active ads while 272 of their room lists name «مطبخ». The site has no amenity field, so the room
list is its statement — read yes-or-nothing (ADVANCED_FILTER_SOURCE_TRUTH §2). The list text below is
verbatim from live ad 12218783 / 12218844 (🔬 AF engineer 2026-10-09).

Run: python -m pytest scrapers/common/tests/test_sadiqeltajer_room_list_states_the_kitchen.py -q
"""
from __future__ import annotations

import sys
import types
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
_supabase = types.ModuleType("supabase")
_supabase.Client = type("Client", (), {})
_supabase.create_client = lambda url, key: None
sys.modules.setdefault("supabase", _supabase)
_dotenv = types.ModuleType("dotenv")
_dotenv.load_dotenv = lambda *a, **k: None
sys.modules.setdefault("dotenv", _dotenv)

import scrapers.sadiqeltajer.run as S  # noqa: E402

HEAD = "--&gt; للبيع فله --&gt; مميز بيع فلل كود الاعلان : 8134 (حد) للبيع فله 875,000 ريال 325 م² "
TAIL = " اللوكيشن تفاصيل الإعلان الموقع حسب الصك القصيم - بريدة - الغدير اعلانات مشابهة 9 1 م² 5 ريال"


def row_for(components: str | None) -> dict:
    body = HEAD + (f"المكونات : {components}" if components else "") + TAIL
    row, _cat, why = S.map_listing("https://sadiq-eltajer.sa/ad/8134", "<html><body>" + body + "</body></html>")
    assert row, why
    return row


def test_a_room_list_with_a_kitchen_is_a_kitchen():
    row = row_for("الدور الاول : مجلس رجال . دورة مياة . صالة . غرفتين نوم . غرفة ماستر . مطبخ . دورة مياة")
    assert row["kitchen"] is True


def test_the_comma_list_reads_the_same():
    row = row_for("ملحق , دورة مياه , مطبخ , مسبح , مسطح اخضر , صالة واسعة , غرفة نوم , دورة مياه")
    assert row["kitchen"] is True


def test_a_list_without_a_kitchen_says_nothing_about_it():
    row = row_for("غرفتين . دورة مياة . دكه")
    assert "kitchen" not in row, "an unlisted kitchen is silence (NULL), never «no»"


def test_no_room_list_writes_no_amenity():
    row = row_for(None)
    assert "kitchen" not in row and "maid_room" not in row


def test_mutation_without_the_reader_the_kitchen_is_lost(monkeypatch):
    monkeypatch.setattr(S.normalize, "prose_amenities_yes", lambda raw, skip=(): {})
    row = row_for("صالة . مطبخ . دورة مياة")
    assert "kitchen" not in row   # so test_a_room_list_with_a_kitchen_is_a_kitchen is what catches its loss
