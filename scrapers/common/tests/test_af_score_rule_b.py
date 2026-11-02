"""af_score judges a structured site's field the way the index serves it: Rule B (owner 2026-10-25).

The index merges the site's box with the ad's own QUOTED sentence (public.af_rule_b over listing_text_facts).
An aqar ad whose «مصعد» box is unticked but whose text says «يوجد مصعد» is served elevator = yes; the score
must count that as a match while the quote is still on the page, and must not when the page no longer prints
it (stale text). Run: python -m pytest scrapers/common/tests/test_af_score_rule_b.py -v
"""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scrapers.common.af_score import rule_b, says_yes, text_says  # noqa: E402

TEXT = {"elevator": {"v": True, "q": "يوجد مصعد"}, "pool": {"v": False, "q": "بدون مسبح"}}
PAGE = {"title": "شقة للإيجار", "text_head": "شقة واسعة | يوجد مصعد | بدون مسبح"}


def test_rule_b_truth_table():
    assert rule_b(None, True) is True and rule_b(None, False) is False
    assert rule_b(False, True) is True            # the sentence wins over an unticked box
    assert rule_b(True, None) is True and rule_b(False, None) is False
    assert rule_b(True, False) is None            # conflict → unknown
    assert rule_b(True, True) is True and rule_b(False, False) is False


def test_quote_counts_only_while_on_the_page():
    assert text_says(TEXT, "elevator", PAGE) is True
    assert text_says(TEXT, "pool", PAGE) is False
    assert text_says(TEXT, "elevator", {"title": "شقة", "text_head": "تم تعديل الوصف"}) is None
    assert text_says({"elevator": {"v": True, "q": ""}}, "elevator", PAGE) is None   # no quote, no value
    assert text_says(None, "elevator", PAGE) is None


def test_structured_site_asks_from_the_quoted_sentence():
    lines = ["شقة واسعة", "يوجد مصعد"]
    assert says_yes(lines, "elevator", "aqar", PAGE, TEXT) is True
    assert says_yes(lines, "elevator", "aqar", PAGE, None) is False, "no overlay fact: prose alone never asks"
