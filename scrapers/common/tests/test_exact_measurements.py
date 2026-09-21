"""A source measurement keeps every digit it was published with (owner, 2026-09-21: «never ever again»).

Every to_measure case below is a REAL string from a live capture on 2026-09-21. Where the listing also
publishes a price per m² and a total, the expected value is the one that makes ppm × area = the total
(e.g. aqar 6582293: 300 × 161,891.927 = 48,567,578, exactly the published price).

Run: python -m pytest scrapers/common/tests/test_exact_measurements.py -v
"""
import sys

sys.path.insert(0, ".")

import pytest  # noqa: E402

from scrapers.common import db  # noqa: E402
from scrapers.common.normalize import measure_num, to_measure  # noqa: E402

REAL_DISPLAY_TEXT = [
    ("407.56 م²", 407.56),            # raghdan, the card that started this (1,228 × 407.56 = 500,483.68)
    ("457.5", 457.5),                  # aqar, stored 457 before
    ("183.72", 183.72),                # aqar, stored 183
    ("1,436.82", 1436.82),             # dealapp, stored 1437
    ("2,605.50 م²", 2605.5),           # muktamel, stored 2606
    ("161,891.927", 161891.927),       # aqar 6582293: comma groups, dot is decimal (ppm × area = price)
    ("120.475", 120475),               # aqar 6490267: one dot + 3 digits = thousands (37 × 120,475 ≈ price)
    ("38.961", 38961),                 # aqar 6752815: deed says 38962
    ("30٫000", 30000),                 # aqar 6817033: Arabic decimal mark used as grouping (500 × 30,000 = price)
    ("2.000.000", 2000000),            # several dots = thousands
    ("364,51 متر مربع", 364.51),       # aqar 6603069 prose: Arabic decimal comma (5000 × 364.51 = the quoted price)
    ("1,436", 1436),                   # comma + 3 digits = thousands
    ("٤٠٧٫٥٦", 407.56),                # Arabic-Indic digits and decimal mark
    ("۳۲.۵ م", 32.5),                  # Persian digits, a street width
    ("1.234,56", 1234.56),             # European: the LAST separator is the decimal point
    ("المساحة 0 م", 0),                # incident #45: abralosol publishes 0 and 0 is correct
    ("500 م²", 500),
    ("لا يوجد", None),
    ("", None),
    (None, None),
]


@pytest.mark.parametrize("raw,expected", REAL_DISPLAY_TEXT)
def test_to_measure_keeps_every_published_digit(raw, expected):
    assert to_measure(raw) == expected


def test_integral_values_stay_int_so_the_column_never_stores_500_point_0():
    assert isinstance(to_measure("500"), int) and isinstance(measure_num(500.0), int)


@pytest.mark.parametrize("v,expected", [
    (407.56, 407.56), ("407.56", 407.56), ("1316.445", 1316.445),  # machine value: dot is ALWAYS decimal
    (0, 0), ("0", 0), (-3, None), ("New", None), (float("nan"), None), (True, None), (None, None),
])
def test_measure_num_is_exact_for_machine_values(v, expected):
    assert measure_num(v) == expected


def test_the_1000x_inflation_to_int_does_is_impossible_for_a_machine_value():
    # normalize.to_int("1316.445") == 1316445 (it reads 3 decimals as grouping). measure_num never does.
    assert measure_num("1316.445") == 1316.445


def test_db_sanitizer_never_truncates_a_measurement():
    r = {"area_m2": 407.56, "price_per_meter": 1228.5, "street_width_m": 32.5,
         "interior_space_m2": "96.4", "outdoor_area_m2": 12, "bedrooms": 3.0}
    db._sanitize_ints(r)
    db._sanitize_measures(r)
    assert r["area_m2"] == 407.56 and r["price_per_meter"] == 1228.5 and r["street_width_m"] == 32.5
    assert r["interior_space_m2"] == 96.4 and r["outdoor_area_m2"] == 12
    assert r["bedrooms"] == 3                      # counts stay integers


def test_db_sanitizer_still_nulls_garbage_measurements():
    r = {"area_m2": -5, "price_per_meter": "غير محدد", "street_width_m": True, "interior_space_m2": [1]}
    db._sanitize_measures(r)
    assert r == {"area_m2": None, "price_per_meter": None, "street_width_m": None, "interior_space_m2": None}


def test_no_measurement_column_is_in_an_integer_set():
    measured = {"area_m2", "interior_space_m2", "outdoor_area_m2", "price_per_meter", "street_width_m"}
    assert not measured & (db._INT2_COLS | db._INT4_COLS | db._INT8_COLS)
    assert db._MEASURE_COLS == measured
