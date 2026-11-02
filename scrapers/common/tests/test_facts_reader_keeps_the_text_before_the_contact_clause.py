"""sanitize() cuts a contact clause from its first contact word, never the whole sentence.

Measured 2026-10-31: ksaaqar, akariyoun, sanadak, manzo and sadiqeltajer publish an ad as ONE sentence with
no punctuation and end it with «للاستفسار أبو أحمد …». The old rule dropped every clause that contained a
contact word, so the whole description vanished, the text fell under MIN_TEXT_CHARS and the ad was never
sent to the model: 60 of ksaaqar's 75 unread residential ads, all 16 of akariyoun's, 9 sanadak, 8 manzo.
The rule now keeps everything BEFORE the contact word; the phone, kunya and URL redaction stay as they were.

Run: python -m pytest scrapers/common/tests/test_facts_reader_keeps_the_text_before_the_contact_clause.py -v
"""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scrapers.facts.extract import MIN_TEXT_CHARS, sanitize  # noqa: E402

# ksaaqar ad KSA180786555851883 (2026-10-31), one sentence, contact at the end, site boilerplate after it.
TITLE = "للبيع شقه حي عكاظ"
TEXT = ("للبيع شقه مساحه ١٤١ حي عكاظ الرياض مواصفات الشقه ٣غرف نوم ومجلس وصاله ومقلط ومطبخ وغرفه شغاله مطبخ "
        "ومكيفات راكب على السوم ويوجد عقارات للبيع مساحات مختلفه للاستفسار أبو أحمد 0551234567 "
        "\"أخبر المالك أنك شاهدت الإعلان على موقع عقارات السعودية (ksaaqar.com) .\"")


def test_the_description_before_the_contact_word_survives():
    out = sanitize(TITLE, TEXT)
    assert len(out) >= MIN_TEXT_CHARS
    for feature in ("٣غرف نوم", "ومجلس", "غرفه شغاله", "مكيفات"):
        assert feature in out, out


def test_the_contact_data_is_still_gone():
    out = sanitize(TITLE, TEXT)
    for pii in ("للاستفسار", "أبو أحمد", "0551234567", "ksaaqar.com"):
        assert pii not in out, out


def test_a_clause_that_is_only_contact_is_still_dropped_whole():
    # Punctuated ads keep working exactly as before: the contact clause goes, the others stay.
    out = sanitize("فيلا للبيع", "فيلا دورين مع مسبح وملحق. للتواصل واتساب ابو سعد. موقف سيارتين")
    assert "مسبح وملحق" in out and "موقف سيارتين" in out
    assert "واتساب" not in out and "للتواصل" not in out and "ابو سعد" not in out
