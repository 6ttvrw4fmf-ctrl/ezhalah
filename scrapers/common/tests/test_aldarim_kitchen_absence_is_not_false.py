"""Aldarim `kitchen`: absence must stay UNKNOWN, a published 0 must stay False, a count wins.

Found 2026-08-11 by senior audit run #10, as the handoff item from the wasalt/aldarim
manufactured-negative work. `"kitchen": bool(L.get("is_kitchen_installed")) or ...` mapped BOTH
"aldarim said 0" and "aldarim sent null" to False, so 12 listings aldarim published nothing about
recorded a confident "this property has NO kitchen".

WHY THE SAFETY BARRIER DID NOT CATCH THIS ONE. detect_manufactured_negatives() flags a column that
is false somewhere and true nowhere — "it can only ever say no, so it is not reading anything".
`kitchen` has 14 real trues on aldarim, so it looked healthy while 12 of its values were fabricated.
A column can be PARTLY manufactured and still pass that barrier; this flag-level test covers the gap.

Measured over the stored source_capture, which retains aldarim's full payload:

    is_kitchen_installed = 0, kitchens = 0     -> 112 res + 34 com   aldarim SAYS no kitchen
    is_kitchen_installed = 0, kitchens = 1..4  ->  14 res            counted kitchens
    is_kitchen_installed = null, kitchens null ->   7 res +  5 com   aldarim says nothing
    is_kitchen_installed = 1                   ->   0 rows anywhere

The trap is the over-correction the aldarim AC work also called out: the flag is never affirmative
on this platform, but a published 0 is still a REAL negative and retracting the column wholesale
would destroy 146 source values. Only the 12 nulls were ours (retracted by migration
20260811095857). Both directions are pinned below.
"""
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[3]))

from scrapers.aldarim.run import _kitchen_state  # noqa: E402


def test_absent_flag_is_unknown_not_false():
    # The 12 rows (7 residential + 5 commercial) this defect fabricated.
    assert _kitchen_state(None, None) is None


def test_blank_flag_is_unknown():
    assert _kitchen_state("", None) is None


def test_published_zero_is_a_real_negative():
    # 146 rows depend on this staying False rather than being swept to None.
    assert _kitchen_state(0, 0) is False
    assert _kitchen_state("0", 0) is False


def test_a_counted_kitchen_wins_over_a_zero_flag():
    # The pre-existing widening, unchanged: aldarim reports the flag as 0 on every row, so the
    # COUNT is the only affirmative signal it publishes. 14 rows depend on this.
    for n in (1, 2, 3, 4):
        assert _kitchen_state(0, n) is True


def test_a_counted_kitchen_wins_even_when_the_flag_is_unknown():
    assert _kitchen_state(None, 2) is True


def test_a_zero_count_is_not_proof_of_a_kitchen():
    # to_int_numeric maps 0/"0" to None, so a zero count must fall through to the flag rather than
    # being read as "a kitchen was counted".
    assert _kitchen_state(0, 0) is False
    assert _kitchen_state(None, 0) is None


def test_affirmative_flag_is_true():
    # Not observed on aldarim today (the flag is only ever 0 or null), but it must not regress if
    # aldarim starts publishing it.
    assert _kitchen_state(1, 0) is True
    assert _kitchen_state("1", None) is True


def test_tristate_has_not_collapsed():
    # Narrowing the return type back to bool is what caused the fabrication in the first place.
    assert _kitchen_state(None, None) is None and _kitchen_state(0, 0) is False


def test_old_implementation_would_fail_this():
    # The exact defect: bool(None) is False, which is how absence became a denial.
    assert bool(None) is False
    assert _kitchen_state(None, None) is not False
