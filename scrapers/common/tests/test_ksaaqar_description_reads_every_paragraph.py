"""ksaaqar: the description box is read paragraph by paragraph, not only its first <p> (🔬 2026-10-17, backlog 630).

CI re-read 39026652684: 12225735 opens with the headline paragraph «فيلا مع شقتين. حي المصيف» and names «مطبخ»
in the next one, 12226520 names «غرفة سائق» and «مطبخ» after its first line. Both stored kitchen NULL.
"""
import scrapers.ksaaqar.run as R

PAGE = ('<div id="adt-ad-description-box"><h4>الوصف:</h4>'
        '<p>فيلا مع شقتين. حي المصيف</p>'
        '<p>الدور الارضي حوش واسع - مجلس حريم - مطبخ - عدد 5 حمامات بالدور الارضي.</p>'
        '</div><div class="sidebar"><p>مصعد</p></div>')


def test_a_later_paragraph_is_read():
    assert R.parse_description_amenities(PAGE)["kitchen"] is True


def test_the_box_ends_at_its_own_div():
    assert "elevator" not in R.parse_description_amenities(PAGE)


def test_ac_and_furnished_stay_structured_only():
    out = R.parse_description_amenities(PAGE.replace("مطبخ", "مطبخ - مكيفات - مفروشة"))
    assert "air_conditioner" not in out and "furnished" not in out


def test_no_box_reads_nothing():
    assert R.parse_description_amenities("<p>مطبخ</p>") == {}
