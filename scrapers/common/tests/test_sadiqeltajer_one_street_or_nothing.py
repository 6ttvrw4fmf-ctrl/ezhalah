"""sadiqeltajer's frontage row: ONE street or nothing (the fleet rule in normalize.one_street_width).

Re-read 2026-10-13 (CI source-reread 38377658296), sadiqeltajer_residential_listings:12217842 prints
«الواجهة : شارع تجارى غربي 40م شارع جنوبي 15م» — a corner plot on two streets. The old reader allowed one
word between «شارع» and the number, so it skipped the 40 m street, stored 15, and took «جنوبي» because it
came first in a word list: a confident answer the ad never gave, which hid the plot from a customer
asking for a 30 m street or a west facade. Two streets or two bearings → NULL, the raw row is kept.
"""
import scrapers.sadiqeltajer.run as R

CORNER = "المساحة : 609م العمر : 10 سنوات الواجهة : شارع تجارى غربي 40م شارع جنوبي 15م المكونات : غرفة نوم"


def test_a_corner_plot_states_no_single_width_or_facade():
    assert R.parse_street_width(CORNER) is None
    assert R.parse_direction(CORNER) is None


def test_the_raw_frontage_row_is_kept_verbatim():
    assert R.facade_row(CORNER) == "شارع تجارى غربي 40م شارع جنوبي 15م"


def test_one_street_with_a_two_word_name_is_read():
    t = "الواجهة : شارع تجاري غربي 40م المكونات : غرفة"
    assert R.parse_street_width(t) == 40
    assert R.parse_direction(t) == "غربي"


def test_one_street_is_still_read():
    t = "الواجهة : شارع شرقى 25م المكونات : غرفة"
    assert R.parse_street_width(t) == 25
    assert R.parse_direction(t) == "شرقى"


def test_two_bearings_without_a_street_are_a_corner():
    assert R.parse_direction("الواجهة : شرقية جنوبية المكونات : غرفة") is None


def test_silence_stays_null():
    t = "المساحة : 600م المكونات : غرفة"
    assert R.parse_street_width(t) is None and R.parse_direction(t) is None


# The 117 frontage rows re-read 2026-10-13 (CI 38379060128): the old reader took the FIRST bearing in a
# word list anywhere in the row, so an alley or the plot's side lengths decided the facade.
def test_an_alley_is_not_the_facade():
    t = "الواجهة : شارع غربي 15م وممر شمالي 8م المكونات : غرفة"      # 12219206, stored north
    assert R.parse_direction(t) == "غربي" and R.parse_street_width(t) == 15


def test_the_plot_side_lengths_are_not_the_facade():
    t = "الواجهة : شارع شرقي 30م الاطــوال : شمالي 41م جنوبي 51.50م شرقي 20م غربي 22.65م"   # 14108262
    assert R.parse_direction(t) == "شرقي" and R.parse_street_width(t) == 30


def test_a_width_after_a_colon_is_read():
    t = "الواجهة : شارع شرقي : 15م / ممر شمالي : 5م قريبة من اسواق الرمال"   # 12219014, stored north, no width
    assert R.parse_direction(t) == "شرقي" and R.parse_street_width(t) == 15


def test_a_bearing_glued_to_its_number_is_read():
    t = "الواجهة : شارع شرقي12م المكونات : غرفة"
    assert R.parse_direction(t) == "شرقي" and R.parse_street_width(t) == 12


def test_two_streets_said_in_one_word_are_a_corner():
    t = "الواجهة : شارعين شرقي12 وجنوبي12 المكونات : غرفة"
    assert R.parse_direction(t) is None and R.parse_street_width(t) is None
