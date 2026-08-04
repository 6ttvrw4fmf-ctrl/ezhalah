"""Regression test for the 2026-08-04 alkhaas district-extraction fix (scrapers/alkhaas/run.py).

Root cause (2026-08-04 audit, live-reverified): the district regex only fired on بحي/حي. 13/29
sampled null-district titles instead use مخطط ("subdivision plan"), e.g. "للبيع ارض بمخطط الرحاب"
(AKH903 live). Separately, ~8 rows where extraction DID succeed still carried noise glued onto the
captured 1-2-word text by the regex's own capture width: a trailing plot number ("رقم" / "رقم N",
live AKH958/AKH959 "بحي الروابي رقم 1"), a bare trailing digit (live AKH271 "بحي السلام 2"), stray
parenthetical punctuation (live AKH759 "بحي الوهلان ( الجوز )" -> old capture "الوهلان ("), and the
city name fused on with the "in <city>" ب- preposition, no space (live AKH650 "بحي الجلده بعنيزة").

Fix: DISTRICT_RE adds a `ب?مخطط` alternative alongside `ب?حي`; extract_district() then strips a
trailing purely-numeric or رقم-prefixed token, trims stray leading/trailing punctuation off each
captured word, and strips a trailing token equal to the city name OR "ب" + the city name.

Run: python -m pytest scrapers/common/tests/test_alkhaas_district_makhtat_and_noise_strip.py -v
"""
import sys

sys.path.insert(0, ".")

from scrapers.alkhaas.run import extract_district  # noqa: E402

CITY = "عنيزة"  # f.get("المدينة") value for every alkhaas Unaizah row


# ── مخطط ("subdivision plan") — the new alternative pattern ───────────────────────────────────────
def test_makhtat_single_word():
    # live AKH903/922/923/924/942/963/964/965
    assert extract_district("للبيع ارض بمخطط الرحاب", CITY) == "الرحاب"


def test_makhtat_two_words():
    # live AKH618 ("ب مخطط" — space-separated ب also matches, since ب? is optional)
    assert extract_district("للبيع مزرعه ب مخطط اليحيى الزراعي", CITY) == "اليحيى الزراعي"


def test_makhtat_no_leading_preposition():
    # live AKH805
    assert extract_district("للبيع مزرعه بمخطط اليحيى", CITY) == "اليحيى"


# ── بحي still works unchanged (no regression) ──────────────────────────────────────────────────────
def test_bahai_unchanged():
    assert extract_district("للبيع فيلا بحي المحمدية", CITY) == "المحمدية"


# ── trailing plot-number noise ("رقم" / "رقم N") ───────────────────────────────────────────────────
def test_trailing_raqam_word_stripped():
    # live AKH958/AKH959: capture was "الروابي رقم" (رقم itself is the 2nd captured word — the plot
    # number digit falls outside the 2-word capture window entirely).
    assert extract_district("للبيع شاليه بحي الروابي رقم 1", CITY) == "الروابي"
    assert extract_district("للبيع شاليه بحي الروابي رقم 2", CITY) == "الروابي"


# ── trailing bare digit ─────────────────────────────────────────────────────────────────────────────
def test_trailing_bare_digit_stripped():
    # live AKH271/AKH798
    assert extract_district("للبيع ارض بحي السلام 2", CITY) == "السلام"


# ── stray punctuation ───────────────────────────────────────────────────────────────────────────────
def test_stray_parenthesis_stripped():
    # live AKH759
    assert extract_district("للبيع استراحتين بحي الوهلان ( الجوز )", CITY) == "الوهلان"


# ── fused "ب" + city-name suffix ────────────────────────────────────────────────────────────────────
def test_fused_city_suffix_stripped():
    # live AKH650/AKH639/AKH651/AKH656 — "بعنيزة" = ب + عنيزة glued on with no space.
    assert extract_district("للبيع استراحه بحي الجلده بعنيزة مساحة 2491 م", CITY) == "الجلده"
    assert extract_district("للبيع استراحه بحي الحمراء بعنيزة 1780 م", CITY) == "الحمراء"


def test_bare_city_suffix_still_stripped():
    # Pre-existing behavior (bare trailing city token, no ب-) must keep working.
    assert extract_district("للبيع ارض بحي المحمدية عنيزة", CITY) == "المحمدية"


# ── مخطط + fused-city together (both fixes compose) ─────────────────────────────────────────────────
def test_makhtat_and_fused_city_compose():
    # live AKH652
    assert (
        extract_district("للبيع ارض بمخطط الراحه بعنيزة المساحه 287.5 م", CITY) == "الراحه"
    )


# ── no false positive: a single-strip capture must never be wiped to nothing ──────────────────────
def test_single_word_capture_never_emptied():
    # If the only captured word happened to equal the city name or be numeric, the (len > 1) guard
    # must keep it rather than stripping the whole result away.
    assert extract_district("للبيع ارض بحي 2", CITY) == "2"


# ── no match at all ─────────────────────────────────────────────────────────────────────────────────
def test_no_keyword_no_match():
    assert extract_district("للبيع ارض زراعيه", CITY) is None
    assert extract_district("", CITY) is None
    assert extract_district(None, CITY) is None


if __name__ == "__main__":
    test_makhtat_single_word()
    test_makhtat_two_words()
    test_makhtat_no_leading_preposition()
    test_bahai_unchanged()
    test_trailing_raqam_word_stripped()
    test_trailing_bare_digit_stripped()
    test_stray_parenthesis_stripped()
    test_fused_city_suffix_stripped()
    test_bare_city_suffix_still_stripped()
    test_makhtat_and_fused_city_compose()
    test_single_word_capture_never_emptied()
    test_no_keyword_no_match()
    print("OK — alkhaas مخطط + trailing-noise district-extraction regression tests pass")
