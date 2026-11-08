"""PR #11308: sentence-local stove context and partial carried services lists."""
import pytest

from scrapers.facts import word_checker as W


def _facts(text):
    return W.facts_of(W.clean_text(None, text))


@pytest.mark.parametrize("mark", ["!", "؟", "?", ".", "\n"])
@pytest.mark.parametrize("reverse", [False, True], ids=["kitchen-before", "kitchen-after"])
def test_kitchen_in_another_sentence_cannot_veto_a_fire_pit(mark, reverse):
    kitchen, fire = "مطبخ فيه فرن", "موقد حجري في الصالة"
    text = f"{fire}{mark} {kitchen}" if reverse else f"{kitchen}{mark} {fire}"
    assert _facts(text).get("fire_pit") is True


@pytest.mark.parametrize("text", [
    "مطبخ فيه فرن، وصف جميل! موقد حجري في الصالة",
    "موقد حجري في الصالة؟ وصف جميل، مطبخ فيه فرن",
    "مَطْبَخ فيه فُرْن!! 🪵 مَوْقِد حجري في الصالة",
    "مَوْقِد حجري في الصالة؟ 🏠 مَطْبَخ فيه فُرْن",
])
def test_sentence_cut_blocks_adjacent_clauses_and_maps_normalized_offsets(text):
    assert _facts(text).get("fire_pit") is True


@pytest.mark.parametrize("text", [
    "مطبخ فيه فرن وموقد سيراميكي",
    "مطبخ مجهز، فرن، موقد، شفاط",
    "مطبخ فيه فرن! مطبخ مجهز بموقد سيراميكي",
    "موقد سيراميكي في المطبخ؟ موقد سيراميكي في المطبخ",
])
def test_cooktop_context_within_its_sentence_still_suppresses_fire_pit(text):
    assert "fire_pit" not in _facts(text)


@pytest.mark.parametrize("cue", ["مميزات العمارة", "يوجد", "المجمع"])
def test_carried_services_stop_at_first_own_cue(cue):
    facts = _facts(f"بالقرب من جميع الخدمات، وتشمل: مسجد وسوبرماركت وحديقة {cue} مسبح خاص")
    for nearby in ("mosque", "market", "garden"):
        assert nearby not in facts
    assert facts.get("pool") is True


@pytest.mark.parametrize("separator", ["،", " / ", " - ", " • "])
def test_services_heading_carries_through_multiple_list_clauses(separator):
    text = separator.join([
        "بالقرب من جميع الخدمات", "مسجد", "سوبرماركت", "حديقة مميزات العمارة مسبح خاص",
    ])
    facts = _facts(text)
    for nearby in ("mosque", "market", "garden"):
        assert nearby not in facts
    assert facts.get("pool") is True


def test_own_cue_at_start_leaves_no_carried_services_range():
    facts = _facts("بالقرب من جميع الخدمات، مميزات العمارة حديقة خاصة ومسبح خاص")
    assert facts.get("garden") is True
    assert facts.get("pool") is True


def test_own_cue_ends_services_carry_for_the_following_clause():
    facts = _facts("بالقرب من جميع الخدمات، مسجد مميزات العمارة مسبح خاص، حديقة خاصة")
    assert "mosque" not in facts
    assert facts.get("pool") is True
    assert facts.get("garden") is True


@pytest.mark.parametrize("separator", [".", "\n"])
def test_sentence_break_ends_services_heading_before_own_amenities(separator):
    facts = _facts(f"بالقرب من جميع الخدمات{separator} حديقة خاصة ومسبح خاص")
    assert facts.get("garden") is True
    assert facts.get("pool") is True


def test_carried_heading_without_own_cue_keeps_all_places_silent():
    facts = _facts("بالقرب من جميع الخدمات، وتشمل: مسجد وسوبرماركت وحديقة")
    for nearby in ("mosque", "market", "garden"):
        assert nearby not in facts


def test_same_amenity_after_own_cue_can_be_positive():
    facts = _facts("بالقرب من جميع الخدمات، مسجد وحديقة مميزات العمارة حديقة خاصة")
    assert "mosque" not in facts
    assert facts.get("garden") is True
