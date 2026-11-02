"""The AI facts reader never sends HTML markup to the model (owner 2026-10-30: «we need to investigate this wasalt»).

Measured 2026-10-30: Wasalt stores the advertiser's text as HTML — 84,395 of 87,263 active wasalt residential
descriptions carry tags, ~262 of an average 437 chars were markup, and 172 of a 20k sample were cut by MAX_TEXT_CHARS
before their own words ended. The model was paid for «<div><p>» and lost the end of long ads. sanitize() now drops
the tags, decodes entities, and still splits contact clauses on the former <p> / <br> boundaries so a phone line is
removed as a clause of its own, not with the words next to it. Fails on the old code: tags reached the output.

Run: python -m pytest scrapers/common/tests/test_facts_reader_strips_html_before_reading.py -v
"""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scrapers.facts.extract import sanitize, strip_html  # noqa: E402

WASALT = ('<div><p>- محلات تجارية للإيجار في البوادي *</p><p>- مساحة 40 متر مربع</p>'
          '<p>- سهولة الوصول والمواقف</p><p>- ديكور جديد &amp; عصري</p>'
          '<p>- للتواصل اتصل على الرقم التالي: * ((0554322675)</p><p>- رقم ترخيص الإعلان: * 7100330592</p></div>')


def test_no_tag_reaches_the_model():
    out = sanitize("معرض للإيجار", WASALT)
    assert "<" not in out and ">" not in out, out
    assert "div" not in out and "/p" not in out, out


def test_the_words_survive_and_entities_are_decoded():
    out = sanitize("معرض للإيجار", WASALT)
    assert "سهولة الوصول والمواقف" in out
    assert "ديكور جديد & عصري" in out, "&amp; is the advertiser's «&», not markup"


def test_a_phone_line_is_cut_as_its_own_clause_not_the_whole_ad():
    out = sanitize("معرض للإيجار", WASALT)
    assert "0554322675" not in out
    assert "مساحة 40 متر مربع" in out, "the <p> boundary kept the phone clause apart from the facts around it"


def test_plain_text_is_untouched():
    plain = "شقة 3 غرف & صالة، الدور الثاني"
    assert strip_html(plain) == plain
    assert sanitize("شقة", "شقة 3 غرف وصالة") == "شقة\nشقة 3 غرف وصالة".replace("\n", " ")


def test_mutation_the_old_code_sent_the_tags():
    # The tagged form of exactly the words the model should see; the old sanitize left «<div><p>» in place.
    tagged = "<div><p>مسبح خاص</p><br><p>مصعد</p></div>"
    assert strip_html(tagged).split() == ["مسبح", "خاص", "مصعد"]
