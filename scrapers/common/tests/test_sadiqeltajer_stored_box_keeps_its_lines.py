"""sadiqeltajer stores its description box ONE LINE PER SOURCE LINE (crawl-health 2026-11-04).

The amenity reader splits the box into clauses on line breaks and drops a clause that names a neighbour
(«على شارع», «قريب من», «خلف» …). The stored copy went through redact_pii(), which collapsed every line break,
so anything re-reading the stored text saw ONE clause: alert sadiqeltajer_af_outside_room_list flagged SDQ5412's
kitchen (stored «… على شارع 40 … ومطبخ …» as one line) although the reader had read «ومطبخ» from its own line.

The check below re-reads the STORED description exactly the way the production detector does
(public.sadiqeltajer_af_outside_room_list: split on [\\n\\r،,.;؛|()\\-]+, drop clauses matching the neighbour
regex) and asserts that every amenity the reader wrote is still named — and, the other direction, that a
neighbour clause is still dropped.

    python -m pytest scrapers/common/tests/test_sadiqeltajer_stored_box_keeps_its_lines.py -q
"""
from __future__ import annotations

import re
import sys
import types
from pathlib import Path

import pytest

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
from scrapers.common.pii import redact_pii  # noqa: E402

# The production detector's own split and neighbour regex (public.sadiqeltajer_af_outside_room_list).
DETECTOR_SPLIT = re.compile(r"[\n\r،,.;؛|()\-]+")
DETECTOR_NEAR = re.compile(r"يلي|مقابل|بجوار|بجانب|جنب|قريب|بالقرب|مجاور|يجاور|امام|أمام|خلف|على شارع|علي شارع")
# The category header of the live villa ad the 10-30 description test uses (a built unit, so the box is read).
HEAD = "--&gt; للبيع فله --&gt; مميز بيع فلل كود الاعلان : 8134 (حد) للبيع فله 875,000 ريال 630 م² "
TAIL = " الموقع حسب الصك القصيم - بريدة - الروابي اعلانات مشابهة 9 1 م² 5 ريال"
# SDQ5412's box shape: a «على شارع» line, then the unit's own rooms on their own line.
BOX = ("للبيع عمارة تجارية سكني حي الروابي شرق بريدة<br>العمر خمس سنوات على شارع 40<br>"
       "كل شقه تتكون من ثلاث غرف نوم وصاله ومطبخ ودورتين مياه")


@pytest.fixture
def sadiq(monkeypatch):
    monkeypatch.setattr(S, "to_catalog", lambda city_ar, region_ar=None: (11, 4))
    monkeypatch.setattr(S, "find_district_in_text", lambda text, city_id: None)


def _row(box: str) -> dict:
    html = f'<html><body>{HEAD}<div class="all-desc">{box}</div>{TAIL}</body></html>'
    row, _cat, why = S.map_listing("https://sadiq-eltajer.sa/ads/x", html)
    assert row, why
    return row


def _detector_text(description: str) -> str:
    return " / ".join(c for c in DETECTOR_SPLIT.split(description) if c and not DETECTOR_NEAR.search(c))


def test_the_reader_and_the_stored_copy_agree_on_the_kitchen(sadiq):
    row = _row(BOX)
    assert row.get("kitchen") is True                       # read from the unit's own line
    assert "مطبخ" in _detector_text(row["description"])      # still there when the stored copy is re-read


def test_a_neighbour_line_is_still_dropped(sadiq):
    row = _row(BOX)
    assert "على شارع" not in _detector_text(row["description"])


def test_redaction_is_unchanged_by_keep_lines():
    text = "للبيع شقة\nجوال 0551234567\n\n  مطبخ   راكب  "
    flat, lined = redact_pii(text), redact_pii(text, keep_lines=True)
    assert "0551234567" not in flat and "0551234567" not in lined
    assert lined.split("\n")[0] == "للبيع شقة" and lined.endswith("مطبخ راكب")
    assert lined.replace("\n", " ") == flat
