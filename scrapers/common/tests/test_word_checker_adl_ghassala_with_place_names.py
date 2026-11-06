"""«حي العدل الغسالة» is a Makkah address even when the listing's own district «العدل» is blanked first (🔬 2026-11-06,
CodeRabbit on #10943): blanking «العدل» alone left «الغساله» for the reader to take as a washing machine."""
import sys

sys.path.insert(0, ".")

from scrapers.facts import word_checker as W  # noqa: E402


def _laundry(text, place_names=("العدل",)):
    return W.facts_of(W.clean_text(None, text), place_names).get("laundry_room")


def test_the_district_pair_is_silent_after_blanking():
    assert _laundry("شقة للإيجار حي العدل الغسالة ٤ غرف") is None


def test_a_real_laundry_room_in_the_same_district_is_still_read():
    assert _laundry("شقة في حي العدل فيها غرفة غسيل") is True
