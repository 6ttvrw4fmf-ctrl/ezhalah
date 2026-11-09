"""Kitchen cooktops stay unknown; a separately stated fire pit keeps its evidence."""

import pytest

from scrapers.facts import word_checker as W


@pytest.mark.parametrize("text", [
    "شقة مجهزة بفرن وموقد",
    "شقة مجهزة بالموقد والشفاط",
    "الموقد سيراميكي داخل الوحدة",
    "الشقة فيها مَوْقِد وثلاجة",
    "ثلاجة، فرن، موقد، غلاية",
    "ثلاجة, فرن, موقد, غلاية",
    "ثلاجة\nفرن\nموقد\nغلاية",
])
def test_cooktop_is_unknown_rather_than_an_explicit_no(text):
    assert "fire_pit" not in W.facts_of(W.clean_text(None, text))


@pytest.mark.parametrize("text", [
    "فرن وثلاجة وموقد حطب",
    "فرن وثلاجة وموقد (مشب)",
    "جلسة خارجية مع موقد وثلاجة",
    "شاليه مجهز بموقد",
    "فرن وثلاجة مع fire pit",
    "فرن وثلاجة مع firepit",
    "فرن وثلاجة مع حفرة النار",
])
def test_real_fire_pit_survives_appliance_context(text):
    cleaned = W.clean_text(None, text)
    rows = [row for row in W.check(cleaned) if row["fact"] == "fire_pit"]
    assert len(rows) == 1
    assert rows[0]["value_bool"] is True
    assert rows[0]["quote"]
    assert rows[0]["quote"] in cleaned


@pytest.mark.parametrize("text", [
    "بدون موقد سيراميكي",
    "لا يوجد موقد مع الفرن",
])
def test_explicit_negative_is_not_silenced_by_stove_context(text):
    assert W.facts_of(W.clean_text(None, text))["fire_pit"] is False


@pytest.mark.parametrize("reverse", [False, True])
def test_cooktop_does_not_hide_a_separate_fire_pit_or_supply_its_quote(reverse):
    parts = ["المطبخ مجهز بفرن وموقد سيراميكي", "جلسة خارجية مع موقد نار"]
    if reverse:
        parts.reverse()
    # Separate the mentions beyond the rule's local context; a nearby fire cue
    # deliberately keeps a stove-shaped mention positive.
    rows = W.check(W.clean_text(None, "\nتفاصيل\nتفاصيل\nتفاصيل\nتفاصيل\n".join(parts)))
    fire = [row for row in rows if row["fact"] == "fire_pit"]
    assert len(fire) == 1
    assert fire[0]["value_bool"] is True
    assert fire[0]["quote"] == "موقد"


def _is_stove(text):
    """Use production clause splitting and folding to isolate the new context rule."""
    clauses = [(offset, clause, W.norm(clause), []) for offset, clause in W._clauses(text)]
    for ci, (_, _, folded, _) in enumerate(clauses):
        start = folded.find("موقد")
        if start >= 0:
            return W._stove_not_fire(clauses, ci, folded, start, start + len("موقد"))
    raise AssertionError("fixture needs a stove mention")


@pytest.mark.parametrize("side", ["before", "after"])
@pytest.mark.parametrize("distance, expected", [(1, True), (7, True), (8, False)])
def test_appliance_window_includes_seventh_word_only(side, distance, expected):
    context = ["فرن"] + ["تفاصيل"] * (distance - 1)
    words = context + ["موقد"] if side == "before" else ["موقد"] + list(reversed(context))
    assert _is_stove(" ".join(words)) is expected


@pytest.mark.parametrize("side", ["before", "after"])
@pytest.mark.parametrize("distance, expected", [(1, False), (4, False), (5, True)])
def test_fire_cue_takes_precedence_within_four_words(side, distance, expected):
    context = ["جلسة"] + ["تفاصيل"] * (distance - 1)
    words = context + ["موقد", "فرن"] if side == "before" else ["فرن", "موقد"] + list(reversed(context))
    assert _is_stove(" ".join(words)) is expected


@pytest.mark.parametrize("side", ["before", "after"])
@pytest.mark.parametrize("distance, expected", [(3, True), (4, False)])
def test_context_crosses_at_most_three_clause_breaks(side, distance, expected):
    context = ["فرن"] + ["تفاصيل"] * (distance - 1)
    clauses = context + ["موقد"] if side == "before" else ["موقد"] + list(reversed(context))
    assert _is_stove("، ".join(clauses)) is expected
