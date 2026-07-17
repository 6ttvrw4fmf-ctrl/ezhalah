"""Property-age parsing: the shared Arabic vocabulary + Aqar's anchored extraction.

WHY THESE EXIST: age coverage looked like a data-availability problem for months. It was a PARSER
problem. Every scraper read «عمر العقار» with an int-only regex (`عمر\\s*العقار[\\s:]*?(\\d+)`), which can
only match a Latin digit — so the three NON-numeric values the Saudi portals actually publish («جديد»,
«سنتين», «أكثر من 10 سنوات») were unparseable BY CONSTRUCTION and silently became NULL. Live proof at the
time of writing: 21,035 ACTIVE aqar listings whose own structured block says «جديد» were stored NULL.

Run: python3 -m pytest scrapers/common/tests/ -q   (this directory is what CI executes)
"""
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

from scrapers.common.normalize import parse_property_age
from scrapers.aqar.enrich_residential import _property_age_from_text

ANCHOR = "تفاصيل الإعلان"


# ── The shared vocabulary ────────────────────────────────────────────────────────────────────────
def test_the_three_shapes_the_old_int_only_regex_could_never_match():
    # This is the whole bug, in three lines.
    assert parse_property_age("جديد") == 0
    assert parse_property_age("سنتين") == 2
    assert parse_property_age("أكثر من 10 سنوات") == 10


def test_numeric_shapes_still_parse_unchanged():
    assert parse_property_age("5") == 5
    assert parse_property_age("5 سنوات") == 5
    assert parse_property_age("١٠ سنوات") == 10          # Arabic-Indic digits
    assert parse_property_age("0") == 0


def test_open_ended_buckets_map_to_the_FLOOR_never_an_invented_midpoint():
    # Owner decision 2026-07-17: the source asserts "at least 10" and nothing more, so 10 is the only
    # number it supports. The legacy wasalt ladder mapped "10+ years" -> 12, inventing precision the
    # source never published. A regression here silently re-fabricates ages.
    for term in ("أكثر من 10 سنوات", "اكثر من 10 سنوات", "اكثر من عشر سنوات", "أكثر من عشر سنوات"):
        assert parse_property_age(term) == 10, term
    assert parse_property_age("أكثر من 10 سنوات") != 12


def test_a_trailing_label_never_leaks_its_number_in():
    # Source lines run the next label onto the same line. "عدد الشقق 4" must not make this a 4.
    assert _property_age_from_text(f"{ANCHOR} عمر العقار أكثر من 10 سنوات عدد الشقق 4") == 10
    assert _property_age_from_text(f"{ANCHOR} عمر العقار جديد المساحة 395") == 0


def test_never_fabricates_from_junk():
    # Every one of these must be an honest None, never a guess.
    for junk in ('<meta property="og:url" content="http://dealapp.sa', "حوش", "", "   ", None,
                 "غير محدد", "n/a", "-"):
        assert parse_property_age(junk) is None, junk


def test_build_years_are_rejected_not_converted():
    # aldarim stores build YEARS (max 2026) in the same canonical column. A year is not an age, and
    # guessing (2026 - year) here would be a fabrication — the gate's job is to refuse, not decode.
    for year in ("2026", "2000", "1999", "1975"):
        assert parse_property_age(year) is None, year


def test_implausible_ages_are_rejected():
    assert parse_property_age("150") is None      # not a human building age
    assert parse_property_age("9999") is None


# ── Aqar's anchored extraction ───────────────────────────────────────────────────────────────────
def test_the_sellers_description_never_overrides_the_structured_field():
    # THE regression that matters. Live: 462 rows where the description states its own age that
    # contradicts the dropdown. Unanchored parsing reads the description (it comes first on the page).
    page = (
        "الرياض شقة للبيع 850,000 ريال "
        "وصف المالك: عمر العقار 27 سنه تتكون من 5 شقق ومطبخ وحمام "   # seller free text, comes FIRST
        f"{ANCHOR} عمر العقار أكثر من 10 سنوات عدد الغرف 4"            # the authoritative dropdown
    )
    assert _property_age_from_text(page) == 10, "read the seller description instead of the dropdown"


def test_no_structured_block_means_unknown_not_the_description():
    page = "وصف المالك: عمر العقار 27 سنه شقة ممتازة"   # description only, no structured table
    assert _property_age_from_text(page) is None


def test_page_without_any_age_label_is_unknown():
    assert _property_age_from_text(f"{ANCHOR} المساحة 200 عدد الغرف 4") is None
    assert _property_age_from_text("") is None


# ── The requirement the owner asked for explicitly ───────────────────────────────────────────────
def test_a_NEW_platform_participates_automatically_via_the_shared_vocabulary():
    """Platform #31 needs ZERO Property Age code changes if it publishes the standard Arabic terms.

    The vocabulary is shared because it is standard Saudi real-estate phrasing, not one site's
    invention — measured 100% closed on raghdan (283/283), aqaratikom (77/77) and souq24 (32/32).
    A brand-new scraper that calls normalize.parse_property_age() on its own field inherits every
    term below without anyone touching age code. That is the whole point of putting it in normalize.
    """
    # Simulating an unknown future platform's raw values — no per-platform rule exists for it.
    hypothetical_platform_31_values = {
        "جديد": 0, "سنة": 1, "سنتين": 2, "ثلاث سنوات": 3, "خمس سنوات": 5,
        "عشر سنوات": 10, "اكثر من عشر سنوات": 10, "٧ سنوات": 7, "8 سنوات": 8,
    }
    for raw, expected in hypothetical_platform_31_values.items():
        assert parse_property_age(raw) == expected, f"platform #31 value {raw!r} did not auto-parse"

    # ...and its junk is refused just as automatically, with no rule written for it either.
    for raw in ("مبنى جديد كلياً بحالة ممتازة جداً وموقع مميز", "2015", "قديم"):
        assert parse_property_age(raw) is None, raw


def test_vocabulary_terms_are_all_reachable_and_in_range():
    from scrapers.common.normalize import _AGE_VOCAB_AR
    for term, years in _AGE_VOCAB_AR.items():
        assert parse_property_age(term) == years, f"{term} unreachable through the parser"
        assert 0 <= years <= 10, f"{term} -> {years} outside the 5 approved buckets' input range"
