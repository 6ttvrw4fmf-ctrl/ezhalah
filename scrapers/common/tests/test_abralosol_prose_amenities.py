"""abralosol amenities: the ad's own prose is the only source, so it is read — yes or nothing.

abralosol publishes no structured amenity field (DOM fact blocks carry area / street / age / price
only), and on 2026-10-10 all 2,803 searchable rows stored NULL for every amenity while 535 built ads
named a kitchen, parking or maid room in their text (ops_af_score abralosol kitchen we_miss). A
customer asking the Advanced Filter for a kitchen could never find one of them.

Descriptions below are VERBATIM from stored rows (abralosol_residential_listings:10302612,
:10302278, :10302135); every assertion runs the SHIPPING map_listing.
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

from scrapers.common.tests.test_abralosol_price_basis import CELL_TOTAL, _index  # noqa: E402
from scrapers.abralosol import run as R  # noqa: E402

VILLA_DESC = "مكونه من :- غرف نوم 3 منهم ماستر + مجلس + 4 دورات مياه + مطبخ + مستودع العمر: 8 سنوات"
BIG_DESC = ("ركني البناء ع نظام ارامكوا لدور الأرضي : مجلس رجال مجلس نساء غرفة طعام صالة مطبخ خارجي "
            "وداخلي مستودع + دورات مياه غرفة خادمة + دورة مياه")
LAND_DESC = "غرب ، شرقا مواقف سيارات الاطوال: 21 + 40"


def _row(title, desc):
    mapped = R.map_listing(_index("9001", CELL_TOTAL, title), {"description": desc})
    return mapped[0]


def test_kitchen_named_in_prose_is_captured():
    assert _row("فيلا\n\nللبيع", VILLA_DESC).get("kitchen") is True


def test_maid_room_and_kitchen_from_a_long_layout():
    row = _row("فيلا\n\nللبيع", BIG_DESC)
    assert row.get("kitchen") is True and row.get("maid_room") is True


def test_silence_stays_unknown_never_no():
    row = _row("فيلا\n\nللبيع", "فيلا للبيع في حي الراجحي")
    for col in ("kitchen", "parking", "elevator", "maid_room"):
        assert row.get(col) is None


def test_a_negation_is_never_written_as_false():
    assert _row("شقة\nسكنية\nللايجار", "لا يوجد مصعد").get("elevator") is None


def test_land_neighbour_parking_is_not_the_property():
    assert _row("أرض\n\nللبيع", LAND_DESC).get("parking") is None


def test_fibre_and_furnished_are_never_read_from_prose():
    row = _row("شقة\nسكنية\nللايجار", "شقة مفروشة مع ألياف بصرية ومطبخ")
    assert row.get("furnished") is None and row.get("optical_fibers") is None
    assert row.get("kitchen") is True


# ── street width: the index cell «شارع N» is structured and now reaches street_width_m ──────────
def _row_area(area):
    mapped = R.map_listing(_index("9002", CELL_TOTAL, "أرض\n\nللبيع", area=area), {})
    return mapped[0]


def test_one_street_width_is_stored_in_metres():
    row = _row_area("المساحة\n511م\n<br>شارع\n40")
    assert row["street_width_m"] == 40
    assert row["additional_info"]["street_width"] == "40"


def test_two_streets_are_not_collapsed_into_one_width():
    assert _row_area("المساحة\n511م\n<br>شارع\n15+15")["street_width_m"] is None


def test_no_street_cell_is_silence():
    assert _row_area("المساحة\n511م")["street_width_m"] is None
