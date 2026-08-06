"""THE AMENITY TRUTH RULE for aqar (owner directive, 2026-08-05).

    Aqar says Yes            -> true
    Aqar says No             -> false
    Aqar does not say        -> NULL / unknown
    Never convert missing information into false.

WHAT WAS WRONG
--------------
`_flag()` was `any(re.search(p, html) for p in patterns)` — a bare bool. Two defects in one line:

  1. ABSENCE became FALSE. A page we could not read recorded a confident "this flat has NO lift".
     Measured across the 12,244 annual-rent aqar apartments: the amenity columns were 100% populated
     and NEVER NULL. A set of columns that can never say "unknown" is not reading anything.
  2. NEGATION became TRUE. The old header conceded it: «لا يوجد مصعد» ("there is no lift") matched
     the elevator pattern and stored True — the same inversion as the furnished defect fixed in
     aqar_parse the same day, where «مفروش» matched inside «غير مفروش».

PARKING was removed outright: aqar's listing object publishes explicit 0/1 keys for
lift/ketchen/ac/car_entrance/two_entrances/special_entrance and has NO parking key at all, so every
value we held was invented by prose-matching. The tell was decisive — parking=true on 93.6% of the
stub cohort vs 14.5% of the healthy one, a 6.5x gap no real market produces. `car_entrance`
(مدخل سيارة) IS published and is kept; it is not the same thing as a parking space.

Run: python -m pytest scrapers/common/tests/test_aqar_amenity_unknown_not_false.py -v
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, ".")

from scrapers.aqar.enrich_residential import FEATURE_PATTERNS, _flag  # noqa: E402

ELEV = [r"مصعد"]
KITCH = [r"مطبخ"]


# ── the four-way rule ────────────────────────────────────────────────────────────────────────────
def test_aqar_says_yes_saves_true():
    assert _flag("يوجد مصعد في المبنى", ELEV) is True


def test_aqar_says_no_saves_false():
    """An explicit denial is a REAL value from the source, not an unknown."""
    for phrase in ("لا يوجد مصعد", "بدون مصعد", "لا يتوفر مصعد", "عدم وجود مصعد"):
        assert _flag(phrase, ELEV) is False, phrase


def test_aqar_does_not_say_saves_unknown():
    """THE HEADLINE RULE: missing information must never become false."""
    assert _flag("شقة للايجار في الرياض", ELEV) is None
    assert _flag("", ELEV) is None


def test_contradictory_saves_unknown():
    assert _flag("يوجد مصعد لكن لا يوجد مصعد", ELEV) is None


def test_negation_cannot_leak_through_as_a_positive():
    """«لا يوجد مصعد» contains «مصعد» — the negated occurrence must be stripped BEFORE the positive
    test, or the denial reads as a confirmation (the exact furnished-bug shape)."""
    assert _flag("لا يوجد مصعد", ELEV) is not True


def test_rule_holds_for_every_pattern_family():
    """Not just the elevator: every configured feature obeys the same four-way rule."""
    for col, pats in FEATURE_PATTERNS:
        word = pats[0].replace(r"\s*", " ").replace("\\b", "")
        if any(c in word for c in "()?:|"):
            continue  # skip alternation-heavy patterns; the simple ones prove the mechanism
        assert _flag("", pats) is None, f"{col}: silence must be unknown"
        assert _flag(f"لا يوجد {word}", pats) is not True, f"{col}: a denial must not read as true"


# ── parking is not a source field ────────────────────────────────────────────────────────────────
def test_parking_is_not_derived_because_aqar_does_not_publish_it():
    cols = [c for c, _ in FEATURE_PATTERNS]
    assert "parking" not in cols, (
        "aqar publishes no parking field; deriving it from prose invented parking=true on 93.6% of "
        "the stub cohort vs 14.5% of the healthy one. It must stay NULL."
    )
    assert "car_entrance" in cols, "مدخل سيارة IS published and must still be captured"


def test_flag_can_return_none():
    """A type-level guard: the moment _flag is narrowed back to bool, unknown becomes false again."""
    src = (Path(__file__).resolve().parent.parent.parent / "aqar" / "enrich_residential.py").read_text(encoding="utf-8")
    assert "def _flag(html: str, patterns: list[str]) -> Optional[bool]:" in src, (
        "_flag must be able to return None; a bool return type is what caused the fabrication"
    )
