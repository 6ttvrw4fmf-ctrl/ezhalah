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


# ── parking: aqar publishes no such field at all ─────────────────────────────────────────────────
def test_parking_is_always_unknown_because_aqar_never_publishes_it() -> None:
    body = "مواقف سيارة متوفرة موقف سيارة"
    for obj in ({"id": 1}, {"id": 1, "lift": 1, "ketchen": 1, "furnished": 1}):
        assert _amenities(_page(obj, body), body)["parking"] is None, (
            "aqar has no parking key in its ~88-key listing object; a prose hit is not a source "
            "statement. This is the 93.6%-vs-14.5% fabrication."
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
