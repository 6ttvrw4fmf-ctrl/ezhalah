"""ksaaqar: a description typed as <div> lines inside the <p> is still read (owner 2026-10-31: «make sure it's all good»).

Measured 2026-10-31 after the first crawl that stored ksaaqar descriptions: 1,070 of 1,352 active ads got their text,
281 seen the same hour stayed NULL. The live page of one of them («شقق مفروش إيجار شهري قريب المطار») carries
«<p><div>شقق فاخرة ايجار شهرى قريبة للمطار</div><div>الفرش جديد&nbsp;</div>…</p>»: the poster's editor wrapped every line
in a div, and the old parser cut the box at the first «</div>» — before the first <p> closed — so it found no
paragraph and returned None. The box ends where its OWN div closes. Fails on the old code.

Run: python -m pytest scrapers/common/tests/test_ksaaqar_description_survives_div_lines.py -v
"""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import scrapers.ksaaqar.run as R  # noqa: E402

DIV_LINES = ('<div id="adt-ad-description-box" class="adt-ad-description">\n<h4>الوصف:</h4>\n'
             '<p><div>شقق فاخرة ايجار شهرى قريبة للمطار</div><div>الفرش جديد&nbsp;</div>'
             '<div>الايجار شامل الكهرباء والمياه&nbsp;</div><div>يوجد ف العمارة مصعد</div></p>\n'
             '</div><div class="sidebar"><p>اعلانات مشابهة</p></div>')

PLAIN = ('<div id="adt-ad-description-box"><h4>الوصف:</h4><p>فيلا مع شقتين. حي المصيف</p>'
         '<p>مطبخ راكب - غرفة سائق</p></div><div class="sidebar"><p>اعلانات مشابهة</p></div>')


def test_div_wrapped_lines_are_read_every_one():
    text = R._description_text(DIV_LINES)
    assert text, "the box has text; None is the 2026-10-31 defect"
    assert "شقق فاخرة ايجار شهرى قريبة للمطار" in text
    assert "يوجد ف العمارة مصعد" in text, "the last line, after three nested divs"
    assert "اعلانات مشابهة" not in text, "the box still ends at its own div, never the sidebar"
    assert "الوصف" not in text, "the heading is dropped, never read as a fact"


def test_plain_paragraphs_read_exactly_as_before():
    assert R._description_text(PLAIN).split("\n") == ["فيلا مع شقتين. حي المصيف", "مطبخ راكب - غرفة سائق"]


def test_a_box_with_no_paragraph_is_none():
    assert R._description_text('<div id="adt-ad-description-box"><h4>الوصف:</h4></div><p>sidebar</p>') is None
