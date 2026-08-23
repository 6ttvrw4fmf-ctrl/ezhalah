"""THE RULE, pinned: aqar says yes -> true; aqar says no -> false; aqar is silent -> UNKNOWN.

Owner directive, 2026-08-05:
    "If Aqar explicitly says: Yes → save true. No → save false. Does not say → save NULL/unknown.
     Never convert missing information into false."

WHAT WAS WRONG
--------------
`FEATURE_PATTERNS` + `_flag()` matched Arabic words anywhere in the page text and returned a BARE
BOOL, so:
  • a listing whose text says «لا يوجد مصعد» ("there is NO lift") matched the elevator pattern;
  • a listing aqar said nothing about was recorded as a confident False;
  • every amenity column was 100% populated and NEVER NULL — the same tell as `furnished`, which
    could not record False at all before the 2026-08-05 fix, and as wasalt, which recorded "no lift"
    on all 9,247 of its rent apartments.

The census that forced it (108 live pages + the whole active cohort, 2026-08-05):
  **aqar publishes NO parking field anywhere in its ~88-key listing object**, yet `parking` was true
  on 4,880/5,216 (93.6%) of the June stub rows against 1,016/7,028 (14.5%) of healthy rows. A 6.5x
  gap in one market is not a real difference — both numbers were manufactured by the «مواقف» pattern
  firing on whatever prose happened to be stored. Stub values are not even reproducible from the text
  we kept (921/5,216), while healthy rows reproduce 7,028/7,028.

WHAT IS PINNED HERE
-------------------
Six amenities are read from aqar's own structured 0/1 keys; `parking` is unknown by construction;
everything else may only be raised to True by a prose hit and otherwise stays unknown. Crucially, a
fetch that yields no payload makes EVERYTHING unknown — an unhydrated page must never be read as a
flat without amenities.

Run: python -m pytest scrapers/common/tests/test_aqar_amenity_tri_state.py -v
"""
from __future__ import annotations

import json
import sys

sys.path.insert(0, ".")

from scrapers.aqar.enrich_residential import (  # noqa: E402
    _amenities, _listing_json, _tri_state, FEATURE_PATTERNS,
    _STRUCTURED_AMENITY_KEYS, _EXTENDED_DETAIL_KEYS,
)


def _page(obj: dict, body: str = "") -> str:
    """A realistic aqar page: the listing object inside a Next.js RSC flight chunk."""
    inner = json.dumps({"listing": obj}, ensure_ascii=False)[1:-1]
    esc = json.dumps('{"x":1,' + inner + '}')[1:-1]
    return f'<html><script>self.__next_f.push([1,"{esc}"])</script><body>{body}</body></html>'


# ── the three states ─────────────────────────────────────────────────────────────────────────────
def test_source_says_yes_saves_true() -> None:
    a = _amenities(_page({"id": 1, "lift": 1, "ketchen": 1, "ac": 1, "furnished": 1}), "")
    assert a["elevator"] is True
    assert a["kitchen"] is True
    assert a["air_conditioner"] is True
    assert a["furnished"] is True


def test_source_says_no_saves_false() -> None:
    """The state the old code could never reach."""
    a = _amenities(_page({"id": 1, "lift": 0, "ketchen": 0, "ac": 0, "furnished": 0}), "")
    assert a["elevator"] is False
    assert a["kitchen"] is False
    assert a["air_conditioner"] is False
    assert a["furnished"] is False


def test_source_silent_saves_unknown_even_when_the_prose_mentions_it() -> None:
    """The rule that matters most: missing information must NOT become false — or true."""
    body = "شقة فيها مطبخ و مصعد و مواقف سيارة"
    a = _amenities(_page({"id": 1}, body), body)
    assert a["elevator"] is None, "aqar did not state it -> unknown, despite «مصعد» in the prose"
    assert a["kitchen"] is None
    assert a["furnished"] is None
    assert a["air_conditioner"] is None


def test_negation_can_never_read_as_present() -> None:
    """«لا يوجد مصعد» is exactly what the old coarse pattern got wrong."""
    body = "لا يوجد مصعد في العمارة"
    a = _amenities(_page({"id": 1}, body), body)
    assert a["elevator"] is not True, "a negation must never be stored as True"
    assert a["elevator"] is None, "and with no structured key it is unknown, not False"


# ── parking: no FLAT key, and a prose hit is never a source statement ────────────────────────────
def test_parking_stays_unknown_when_the_page_carries_no_structured_answer() -> None:
    """Superseded rationale, kept assertion (2026-08-09): the original claim here was that aqar
    publishes no parking field ANYWHERE. That was wrong — it publishes
    `listing.extended_details.special_parking`, one level deeper than the parser was then reading,
    and `_EXTENDED_DETAIL_KEYS` now maps it. What still holds, and is what this pins, is the rule
    underneath: with no structured answer on the page, «مواقف» in the prose is not aqar saying yes.
    """
    body = "مواقف سيارة متوفرة موقف سيارة"
    for obj in ({"id": 1}, {"id": 1, "lift": 1, "ketchen": 1, "furnished": 1}):
        assert _amenities(_page(obj, body), body)["parking"] is None, (
            "no structured answer on this page; a prose hit is not a source statement. This is the "
            "93.6%-vs-14.5% fabrication."
        )


# ── maid + driver room: aqar's flat `maid`/`driver` keys (2026-08-23) ─────────────────────────────
# Both columns drive live Advanced Filter chips («غرفة خادمة» / «غرفة سائق») and both were routed
# through the prose fallback, which can only ever emit True-or-UNKNOWN. Live evidence, 36 aqar pages
# fetched 2026-08-23 (0 fetch failures): aqar published `driver` on 13 of them and only 2 stored
# values agreed — 9 rows held UNKNOWN where aqar published 0, one held UNKNOWN where aqar published
# 1, and one held TRUE where aqar published 0 (ad 6738742, on BOTH columns). Discarding every
# published negative is why the two columns carry 15,987/6,982 trues and ZERO falses across 117,734
# rows — the shape `af_field_stuck_no_variance` had been reporting since 2026-08-20.
def test_maid_and_driver_room_read_aqars_own_keys() -> None:
    yes = _amenities(_page({"id": 1, "maid": 1, "driver": 1}), "")
    assert yes["maid_room"] is True and yes["driver_room"] is True

    no = _amenities(_page({"id": 1, "maid": 0, "driver": 0}), "")
    assert no["maid_room"] is False, "aqar published 0 — an explicit NO must be recorded, not dropped"
    assert no["driver_room"] is False, "the state these two columns could never reach before"


def test_a_published_no_is_never_overwritten_by_a_prose_hit() -> None:
    """The exact defect: ad 6738742 stored maid_room=true while aqar published `maid: 0`."""
    body = "فيلا فخمة فيها غرفة خادمة و غرفة سائق"
    a = _amenities(_page({"id": 1, "maid": 0, "driver": 0}, body), body)
    assert a["maid_room"] is False, "prose must not overturn aqar's own published 0"
    assert a["driver_room"] is False


def test_maid_and_driver_stay_unknown_when_aqar_is_silent() -> None:
    """Silence is still UNKNOWN — the fix must not swing the other way into manufacturing False."""
    body = "فيلا فيها غرفة خادمة"
    a = _amenities(_page({"id": 1}, body), body)
    assert a["maid_room"] is None, "no structured key -> unknown, even with the phrase in the prose"
    assert a["driver_room"] is None


def test_no_column_is_read_from_both_a_structured_key_and_prose() -> None:
    """THE BUG CLASS, pinned: a column aqar answers structurally must never ALSO be reachable
    through `FEATURE_PATTERNS`, because the prose path can only raise True and would overwrite a
    published 0. `_structured_amenities()` enforces this by skipping structured columns in its prose
    loop; this test fails if a future edit removes that skip or re-adds a prose-only duplicate.
    """
    structured = set(_STRUCTURED_AMENITY_KEYS.values()) | set(_EXTENDED_DETAIL_KEYS.values()) | {"private_entrance"}
    body = " ".join(["مصعد", "مطبخ", "مكيف", "غرفة خادمة", "غرفة سائق", "مدخل سيارة", "مدخل خاص"])
    # every structured column, published as an explicit 0, with prose shouting the opposite
    obj = {"id": 1}
    obj.update({k: 0 for k in _STRUCTURED_AMENITY_KEYS})
    obj["extended_details"] = {k: False for k in _EXTENDED_DETAIL_KEYS}
    a = _amenities(_page(obj, body), body)
    for col in structured:
        if col == "private_entrance":
            continue  # composed from two keys, neither of which this fixture sets
        assert a[col] is not True, (
            f"{col}: aqar published 0 but the stored value is True — a prose pattern is overwriting "
            f"a structured negative. This is the class that produced 15,987 maid_room trues and "
            f"zero falses."
        )


# ── an unreadable fetch must not be read as absence ──────────────────────────────────────────────
def test_no_payload_makes_everything_unknown_never_false() -> None:
    body = "مطبخ مصعد مواقف سيارة مدخل خاص"
    a = _amenities("<html><body>app shell</body></html>", body)
    for col in ("elevator", "kitchen", "air_conditioner", "furnished", "parking"):
        assert a[col] is None, f"{col} must be unknown when aqar's payload is unreadable"
    assert all(v is not False for v in a.values()), (
        "an unhydrated page must never manufacture a single False — that is how a recovery run "
        "would silently overwrite real data"
    )


def test_every_emitted_column_is_present_and_tri_state() -> None:
    """No column may be missing from the dict, and no column may hold a non-tri-state value."""
    a = _amenities(_page({"id": 1}), "")
    for col, _pats in FEATURE_PATTERNS:
        assert col in a, f"{col} missing from the amenity dict"
    assert "furnished" in a, "furnished has no prose pattern but must still be emitted"
    assert all(v in (True, False, None) for v in a.values())


# ── the primitives ───────────────────────────────────────────────────────────────────────────────
def test_tri_state_maps_aqar_values_and_never_invents_false() -> None:
    assert _tri_state(1) is True and _tri_state("1") is True and _tri_state(True) is True
    assert _tri_state(0) is False and _tri_state("0") is False and _tri_state(False) is False
    for unknown in (None, "", "weird", "  "):
        assert _tri_state(unknown) is None, f"{unknown!r} must be unknown, never False"


def test_listing_json_ignores_the_i18n_bundle_and_requires_an_id() -> None:
    """The FIRST `"listing":{` in an aqar payload is a label bundle with no id."""
    bundle = json.dumps({"listing": {"title_label": "الإعلان"}, "x": 1}, ensure_ascii=False)
    real = json.dumps({"listing": {"id": 999, "lift": 1}}, ensure_ascii=False)
    esc = json.dumps(bundle + real)[1:-1]
    html = f'<html><script>self.__next_f.push([1,"{esc}"])</script></html>'
    obj = _listing_json(html)
    assert obj is not None and obj.get("id") == 999, "must skip the id-less i18n bundle"


def test_listing_json_returns_none_when_absent() -> None:
    assert _listing_json("<html><body>nothing here</body></html>") is None
    assert _listing_json("") is None
