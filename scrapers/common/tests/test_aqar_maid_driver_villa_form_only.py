"""aqar publishes maid_room / driver_room ONLY on the Villa ad form (owner decision 5, 2026-11-03).

On every other form the source has no such field, so a stored value is not the source's — it is prose
residue from before the 2026-08-23 structured read. A plain None can never clear it (the upsert guard
drops None so a failed fetch never erases data), so the enricher must send AUTHORITATIVE_NULL for these
two columns on every non-Villa row, and keep the source's own 0/1 on Villa rows.

Evidence: ops_aqar_commercial_amenity_probe #18/#19 (90 non-Villa live pages, 0 published values; 10/10
Villa controls published) and the 2026-11-03 stored-capture recheck (0 of 77 non-Villa rows carrying a
value name the room in «المميزات»; 11,374 of 12,578 Villa rows do). Alarm: fabricated_unpublished_amenity.

Run: python -m pytest scrapers/common/tests/test_aqar_maid_driver_villa_form_only.py -v
"""
from __future__ import annotations

import json
import sys

sys.path.insert(0, ".")

from scrapers.aqar import enrich_residential as E  # noqa: E402
from scrapers.common import db  # noqa: E402

ROOMS = ("maid_room", "driver_room")


def _page(obj: dict) -> str:
    inner = json.dumps({"listing": obj}, ensure_ascii=False)[1:-1]
    esc = json.dumps('{"x":1,' + inner + '}')[1:-1]
    return f'<html><script>self.__next_f.push([1,"{esc}"])</script><body>غرفة خادمة غرفة سائق</body></html>'


class _Resp:
    def __init__(self, text: str) -> None:
        self.text = text


def _enrich(monkeypatch, type_slug: str, obj: dict) -> dict:
    monkeypatch.setattr(E, "get", lambda url: _Resp(_page(obj)))
    row = E.enrich_residential(f"https://sa.aqar.fm/x/{type_slug}-6894695", type_slug=type_slug, deal_slug="sale")
    assert row is not None
    return row


def test_non_villa_forms_clear_both_rooms_authoritatively(monkeypatch) -> None:
    # Even a payload that somehow carries maid/driver, and prose that names both rooms, must not
    # reach the column on a non-Villa form: the form has no such field.
    for slug in ("apartment", "floor", "building", "rest_house", "room"):
        row = _enrich(monkeypatch, slug, {"id": 1, "maid": 1, "driver": 0})
        for col in ROOMS:
            assert row[col] is db.AUTHORITATIVE_NULL, (slug, col, row[col])


def test_villa_form_keeps_the_sources_own_values(monkeypatch) -> None:
    row = _enrich(monkeypatch, "villa", {"id": 1, "maid": 1, "driver": 0})
    assert row["maid_room"] is True and row["driver_room"] is False
    # silent on a Villa stays a droppable UNKNOWN — never an authoritative clear
    row = _enrich(monkeypatch, "villa", {"id": 1})
    assert row["maid_room"] is None and row["driver_room"] is None


def test_the_upsert_guard_writes_the_null_over_a_stored_value() -> None:
    r = E._villa_form_only({"maid_room": True, "driver_room": None, "elevator": None}, "Apartment")
    db._unknown_must_not_overwrite_known(r)
    assert "maid_room" in r and r["maid_room"] is None
    assert "driver_room" in r and r["driver_room"] is None
    assert "elevator" not in r          # other unknowns still dropped — the guard is not weakened


def test_only_these_two_columns_are_villa_form_only() -> None:
    assert E._VILLA_FORM_ONLY_COLUMNS == ROOMS
    r = E._villa_form_only({"maid_room": True, "driver_room": True, "elevator": True}, "Floor")
    assert r["elevator"] is True
