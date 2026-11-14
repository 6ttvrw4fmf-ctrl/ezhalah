"""The possible-use rule (🔬 2026-11-14, PR #12188) silences only a YES, and a full stop ends its list (CodeRabbit #12188)."""
import re

from scrapers.facts import word_checker as W


def test_a_stated_no_survives_the_possible_use_rule():
    assert W.facts_of("أرض مثالية للاستثمار لا يوجد خيل").get("horses_stable") is False
    # yes in one sentence, no in another: a conflict stays unknown, never the yes
    assert W.facts_of("خيل للركوب. أرض مثالية للاستثمار لا يوجد خيل").get("horses_stable") is None


def test_a_full_stop_before_a_blanked_place_clause_ends_the_list():
    assert W.facts_of("أرض مثالية للاستثمار.\nالرياض، خيل للركوب", ("الرياض",)).get("horses_stable") is True


def test_the_opener_still_silences_a_listed_possible_use():
    assert W.facts_of("مناسبة لعدة أنشطة استثمارية: 🔹 منتجع سياحي 🔹 مشروع فعاليات ومناسبات خاصة").get("for_events") is None


def test_the_rule_is_what_the_tests_measure(monkeypatch):
    # with the opener off, the listed possible use reads yes again — the test above would catch it
    monkeypatch.setattr(W, "_POSSIBLE_OPENER", re.compile(r"(?!x)x"))
    assert W.facts_of("مناسبة لعدة أنشطة استثمارية: 🔹 منتجع سياحي 🔹 مشروع فعاليات ومناسبات خاصة").get("for_events") is True
