"""aqar Advanced-Filter amenities come from aqar's own structured payload — never from prose.

Owner rule: docs/ops/ADVANCED_FILTER_SOURCE_TRUTH.md. Source value = scraped value. Yes → True,
no → False, source silent → NULL. Never guess, never infer "no" from missing data, never fabricate.

History this pins (both directions):
  • Before 2026-08-05 `parking` was matched from the prose «موقف سيارة» / «مواقف», producing a
    confident bool on 25,159 active rows from text that cannot express a negative.
  • The 2026-08-05 fix reached the right conclusion from a WRONG premise — "aqar publishes NO
    parking field at all" — and pinned the column to NULL forever. aqar DOES publish it, as
    `listing.extended_details.special_parking`; a 24-page live sample on 2026-08-09 found 19 of 20
    stored values disagreed with the source, including a row stored `false` where aqar said `true`.

Both regressions are failures of the SAME invariant, so every case below asserts against the
source payload rather than against either historical behaviour.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

from scrapers.aqar import enrich_residential as E  # noqa: E402


# Real key names and value shapes, verified against 24 live aqar pages on 2026-08-09.
PROSE_CLAIMING_PARKING = "شقة للإيجار بها مواقف سيارات ومصعد ومطبخ راكب"


def _page(extended: dict | str | None, *, prose: str = PROSE_CLAIMING_PARKING,
          flat: dict | None = None) -> str:
    """`flat` adds/overrides keys on the listing object itself — the level `maid`/`driver`/`lift`
    live at, as opposed to the nested extended_details block `extended` fills."""
    listing: dict = {"id": 6503022, "lift": 1, "ketchen": 0, "furnished": 0}
    if extended is not None:
        listing["extended_details"] = extended
    if flat:
        listing.update(flat)
    return f'<html><body>{prose}<script>{{"listing":{json.dumps(listing)}}}</script></body></html>'


def _amenities(extended, *, prose: str = PROSE_CLAIMING_PARKING, flat: dict | None = None) -> dict:
    html = _page(extended, prose=prose, flat=flat)
    obj = E._listing_json(html)
    assert obj is not None, "fixture must parse — otherwise the test proves nothing"
    return E._amenities(html, html, obj)


# ── The tri-state law, on the field the Advanced Filter actually offers ──────────────────────────
def test_parking_true_when_aqar_publishes_true():
    assert _amenities({"special_parking": True})["parking"] is True


def test_parking_false_when_aqar_publishes_false():
    # Prose says "مواقف". aqar says no. The source wins — this is the case that made a stored
    # `false` row read `true` on the live page, and vice versa.
    assert _amenities({"special_parking": False})["parking"] is False


def test_parking_unknown_when_aqar_publishes_null():
    # 17 of 19 live pages sampled. NULL is the correct answer, NOT False and NOT the prose hit.
    assert _amenities({"special_parking": None})["parking"] is None


def test_parking_unknown_when_the_key_is_absent():
    assert _amenities({"fiber_optic": True})["parking"] is None


def test_parking_unknown_when_the_whole_extended_block_is_absent():
    assert _amenities(None)["parking"] is None


# ── The fabrication itself: prose must never be able to produce a value for these columns ───────
def test_prose_alone_never_produces_parking():
    """The pre-2026-08-05 bug, pinned. Text screaming «مواقف سيارات» yields UNKNOWN, not True."""
    for extended in (None, {}, {"special_parking": None}):
        assert _amenities(extended)["parking"] is None, extended


def test_no_prose_pattern_survives_for_any_structurally_published_column():
    prose_cols = {c for c, _ in E.FEATURE_PATTERNS}
    overlap = prose_cols & set(E._EXTENDED_DETAIL_KEYS.values())
    assert not overlap, f"prose fallback must be deleted for source-published columns: {overlap}"


def test_the_never_published_premise_is_gone():
    """`_NEVER_PUBLISHED_BY_AQAR` pinned parking to NULL on a premise proven false. If it ever
    comes back it must not contain a field aqar demonstrably publishes."""
    assert "parking" not in getattr(E, "_NEVER_PUBLISHED_BY_AQAR", ())


# ── Real negatives, which prose structurally cannot express ─────────────────────────────────────
def test_false_is_preserved_for_every_mapped_column():
    """`fiber_optic` was observed BOTH true and false live: these columns carry genuine negatives."""
    am = _amenities({k: False for k in E._EXTENDED_DETAIL_KEYS})
    for col in E._EXTENDED_DETAIL_KEYS.values():
        assert am[col] is False, f"{col} lost aqar's published negative"


def test_null_is_preserved_for_every_mapped_column():
    am = _amenities({k: None for k in E._EXTENDED_DETAIL_KEYS})
    for col in E._EXTENDED_DETAIL_KEYS.values():
        assert am[col] is None, f"{col} invented a value aqar never published"


def test_every_mapped_column_round_trips_true():
    am = _amenities({k: True for k in E._EXTENDED_DETAIL_KEYS})
    for col in E._EXTENDED_DETAIL_KEYS.values():
        assert am[col] is True, f"{col} dropped aqar's published positive"


# ── Shape tolerance: aqar sends the block nested on most pages, stringified on some ─────────────
def test_extended_details_sent_as_a_json_string_is_read_the_same_way():
    assert _amenities(json.dumps({"special_parking": True}))["parking"] is True


def test_unparseable_extended_details_is_unknown_not_false():
    assert _amenities("not json at all")["parking"] is None


def test_extended_details_of_the_wrong_type_is_unknown_not_false():
    assert _amenities(["special_parking"])["parking"] is None


# ── Utility availability: published as flat booleans, previously guessed from prose ────────────
def test_utility_availability_comes_from_aqar_not_prose():
    """water/electrical/drainage are native booleans on aqar's flat object and carry real negatives
    (24 live pages: water 21T/1F, electrical 21T/1F, drainage 18T/4F). Prose «توفر الماء» / «كهرباء»
    / «صرف صحي» can only ever say yes, so it must no longer be consulted for them."""
    html = _page({}, prose="الشقة بها توفر الماء وكهرباء وصرف صحي")
    obj = E._listing_json(html)
    obj.update({"water_availability": False, "electrical_availability": False,
                "drainage_availability": False})
    am = E._amenities(html, html, obj)
    assert am["water_supply"] is False, "aqar's published negative lost to a prose hit"
    assert am["electricity"] is False
    assert am["sanitation"] is False


def test_utility_availability_is_unknown_when_aqar_is_silent():
    am = _amenities({}, prose="الشقة بها توفر الماء وكهرباء وصرف صحي")
    for col in ("water_supply", "electricity", "sanitation"):
        assert am[col] is None, f"{col} invented a value from prose"


# ── The flat keys must keep working — this change must not disturb them ─────────────────────────
def test_flat_structured_keys_are_untouched_by_the_extended_read():
    am = _amenities({"special_parking": True})
    assert am["elevator"] is True    # lift: 1
    assert am["kitchen"] is False    # ketchen: 0 — a published negative
    assert am["furnished"] is False  # furnished: 0


def test_columns_with_no_structured_counterpart_still_use_prose_as_a_positive_hint():
    """Unchanged behaviour, corrected example (2026-08-23).

    The rule this pins is unchanged: a column aqar answers NOWHERE may still be raised to True by a
    prose hit, and stays UNKNOWN otherwise — never False.

    The example moved. This test used to demonstrate it with `maid_room`, on the premise that "aqar
    publishes no maid-room key anywhere". That premise was wrong, in exactly the way this same file's
    header already records for `parking`: aqar publishes `maid` (and `driver`) as native 0/1/null
    keys in the flat listing payload. Measured over 36 live pages, 0 fetch failures: aqar published
    `driver` on 13 of them and only 2 stored values agreed — 9 rows had discarded an explicit 0, one
    had discarded a published 1, and ad 6738742 stored TRUE against a published 0. Both columns are
    now read structurally (_STRUCTURED_AMENITY_KEYS), so a prose hit can no longer overturn them —
    which is what this assertion, written against the old premise, would have blocked.

    `extension` («إمكانية التوسعة») is a genuine prose-only column: it appears in no flat key and no
    extended_details key, so it still demonstrates the rule the test was written for.
    """
    am = _amenities(None, prose="فيلا مع إمكانية التوسعة")
    assert am["extension"] is True
    assert _amenities(None, prose="فيلا")["extension"] is None


def test_maid_and_driver_room_are_read_structurally_not_from_prose():
    """The correction itself: aqar's published answer wins over the page text, in both directions."""
    assert _amenities({}, flat={"maid": 1, "driver": 1})["maid_room"] is True
    no = _amenities({}, flat={"maid": 0, "driver": 0}, prose="فيلا بها غرفة خادمة و غرفة سائق")
    assert no["maid_room"] is False, "a published 0 must survive a prose hit"
    assert no["driver_room"] is False
    silent = _amenities(None, prose="فيلا بها غرفة خادمة")
    assert silent["maid_room"] is None, "aqar silent -> UNKNOWN, never True from prose alone"
