"""Count-derived amenities: a source SILENCE must stay UNKNOWN, a published 0 must stay False.

ops_incident #154, measured 2026-09-11. The field-level safety barrier
(detect_manufactured_negatives) reported eleven (platform × column) pairs holding `false` with
`true` nowhere on the platform — elevator/parking/air_conditioner/maid_room/driver_room/
balcony_terrace across abwbna, alobid and bahadhabab. `npm test` is a REQUIRED check, so the repo
could not merge anything while it stood.

ROOT CAUSE. Four scrapers on the aldarim SaaS shape derived five amenity booleans from counts as

    "balcony_terrace": (_int(L.get("balconies")) or 0) > 0

and `normalize.to_int_numeric` returns None for an explicit source ``0`` AND for a source ``null``
alike — its "0 means not set" reading is right for a bedroom count and exactly wrong here, where 0
is the answer. The two collapse into the same False, so a listing the API said NOTHING about was
stored as a confident "no balcony". That is the owner-locked SOURCE IS TRUTH violation (silent →
NULL, never unknown → NO) sitting directly under five Advanced Filter amenity predicates.

AND THE OVER-CORRECTION THIS ALSO GUARDS, which is the harder half and the reason the 2026-08-11
sibling test exists at all: retracting the whole column — the obvious reading of "false with zero
true anywhere on the platform" — would destroy hundreds of REAL source negatives. Measured over the
stored `source_capture` (the exact payload, so this is a probe, not an inference): the key is present
on 100% of rows for all four platforms, published as an explicit 0 on the overwhelming majority, and
as JSON null on 20 abwbna and 12-13 aldarim rows per key. Only those were fabricated.

So both directions are pinned below, and the shape that caused it is pinned out of the whole fleet.
"""
import ast
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[3]))

from scrapers.common.normalize import count_flag

REPO = pathlib.Path(__file__).resolve().parents[3]

# The four scrapers on the aldarim SaaS shape, and the five amenity columns they derive from counts.
ALDARIM_SHAPE = ("aldarim", "abwbna", "alobid", "bahadhabab")
COUNT_AMENITIES = {
    "parking": "parking_spots",
    "elevator": "elevators",
    "maid_room": "maid_rooms",
    "driver_room": "driver_rooms",
    "balcony_terrace": "balconies",
}


# ── the tri-state itself, both directions ───────────────────────────────────────────────────────
def test_silence_is_unknown_not_false():
    assert count_flag(None) is None
    assert count_flag("") is None
    assert count_flag("   ") is None


def test_published_zero_is_a_real_negative():
    # Hundreds of rows depend on this staying False rather than becoming None: abwbna alone
    # publishes an explicit 0 on 169 of 189 rows for balconies/driver_rooms/parking_spots.
    assert count_flag(0) is False
    assert count_flag("0") is False
    assert count_flag(0.0) is False


def test_a_positive_count_is_true():
    assert count_flag(1) is True
    assert count_flag("3") is True
    assert count_flag(2.9) is True   # int(float("2.9")) == 2 > 0


def test_unparseable_is_unknown_never_a_claim():
    assert count_flag("abc") is None
    assert count_flag({}) is None


def test_the_tri_state_has_not_collapsed():
    # Narrowing the return type back to bool is what fabricated the negatives in the first place.
    assert count_flag(None) is None and count_flag(0) is False, "tri-state collapsed to two states"


def test_the_old_implementation_would_fail_this():
    """The exact defect, executed: `(to_int_numeric(v) or 0) > 0` cannot tell silence from zero."""
    from scrapers.common.normalize import to_int_numeric

    old = lambda v: (to_int_numeric(v) or 0) > 0            # noqa: E731 — the defect, verbatim
    assert old(None) is False and old(0) is False, "the old shape is being misremembered"
    assert count_flag(None) is not count_flag(0), "the fix must separate what the old shape merged"


# ── and the shape cannot come back anywhere in the fleet ────────────────────────────────────────
def _amenity_assignments(path: pathlib.Path) -> dict[str, str]:
    """Every `"<amenity>": <expr>` in the file's row dicts, as source text, by amenity name."""
    tree = ast.parse(path.read_text(encoding="utf-8"))
    src = path.read_text(encoding="utf-8")
    out: dict[str, str] = {}
    for node in ast.walk(tree):
        if not isinstance(node, ast.Dict):
            continue
        for k, v in zip(node.keys, node.values):
            if isinstance(k, ast.Constant) and k.value in COUNT_AMENITIES:
                out[k.value] = ast.get_source_segment(src, v) or ""
    return out


def test_every_aldarim_shape_scraper_routes_counts_through_the_tri_state():
    for name in ALDARIM_SHAPE:
        path = REPO / "scrapers" / name / "run.py"
        found = _amenity_assignments(path)
        for amenity in COUNT_AMENITIES:
            assert amenity in found, f"{name}: no `{amenity}` assignment found at all"
            expr = found[amenity]
            assert "count_flag" in expr, (
                f"{name}.{amenity} is `{expr}` — a count-derived amenity must go through "
                f"normalize.count_flag(), or a source silence becomes a fabricated 'no'")


def test_no_scraper_anywhere_still_maps_a_missing_count_to_false():
    """Discovery, not a list: the `(… or 0) > 0` shape is red in ANY scraper, present or future."""
    offenders = []
    for path in sorted((REPO / "scrapers").rglob("run.py")):
        src = path.read_text(encoding="utf-8")
        for lineno, line in enumerate(src.splitlines(), 1):
            code = line.split("#", 1)[0]
            if ") or 0) > 0" in code:
                offenders.append(f"{path.relative_to(REPO)}:{lineno}: {line.strip()}")
    assert not offenders, (
        "a missing source value is being turned into a confident negative:\n  "
        + "\n  ".join(offenders))
