"""page_pin.drop_shared_pins: a pair 3+ ads of one crawl share is the office/default map (⚡ 2026-11-03, backlog 1197)."""
from scrapers.common import page_pin


def _row(la, lo):
    return {"additional_info": {"latitude": la, "longitude": lo, "x": 1}}


def test_a_pair_three_ads_share_is_dropped_and_own_pins_are_kept():
    rows = [_row(27.0192233, 49.644855) for _ in range(3)] + [_row(26.6391412, 49.9219712), _row(21.5, 39.2), _row(21.5, 39.2)]
    assert page_pin.drop_shared_pins(rows) == 3
    assert all("latitude" not in r["additional_info"] and r["additional_info"]["x"] == 1 for r in rows[:3])
    assert rows[3]["additional_info"]["latitude"] == 26.6391412
    assert rows[4]["additional_info"]["latitude"] == 21.5, "two ads of one project may share their building"


def test_rows_without_a_pin_are_untouched():
    rows = [{"additional_info": {}}, {"additional_info": {"pin_absent": True}}]
    assert page_pin.drop_shared_pins(rows) == 0 and rows[1]["additional_info"] == {"pin_absent": True}
