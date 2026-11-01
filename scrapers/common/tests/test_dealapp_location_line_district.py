"""dealapp: the page's visible location line fills a district the title does not carry (2026-10-03).

Owner: «all the ones in dealapp have a district». A listing whose title has no district segment
("دور للبيع - بئر بن هرماس") still prints «بئر بن هرماس, حي الربوة» on the page. The line is a
GAP-FILLER only: the title's own district wins, and both printed orders must agree.

Run: python -m pytest scrapers/common/tests/test_dealapp_location_line_district.py -v
"""
import sys

sys.path.insert(0, ".")

from scrapers.dealapp.run import _location_line_district_ar  # noqa: E402


def _page(*blocks):
    body = "".join(f"<div>{b}</div>" for b in blocks)
    return f"<html><head><title>x</title></head><body>{body}</body></html>"


def test_both_orders_of_the_line_give_the_district():
    html = _page("دور للبيع", "بئر بن هرماس, حي الربوة", "1,000 م²", "حي الربوة, بئر بن هرماس")
    assert _location_line_district_ar(html, "بئر بن هرماس") == "حي الربوة"


def test_one_order_alone_is_not_enough():
    assert _location_line_district_ar(_page("الغاط, حي المنتزة"), "الغاط") is None
    assert _location_line_district_ar(_page("حي المنتزة, الغاط"), "الغاط") is None


def test_disagreeing_orders_give_nothing():
    html = _page("الغاط, حي المنتزة", "حي المروج, الغاط")
    assert _location_line_district_ar(html, "الغاط") is None


def test_no_city_given_still_reads_the_line_and_never_english():
    html = _page("الغاط, حي المنتزة", "حي المنتزة, الغاط")
    assert _location_line_district_ar(html, None) == "حي المنتزة"
    assert _location_line_district_ar(_page("Riyadh, Al Malqa", "Al Malqa, Riyadh"), "Riyadh") is None


def test_script_text_is_not_a_location_line():
    html = ("<html><head></head><body><script>var a='الغاط, حي المنتزة'; var b='حي المنتزة, الغاط';</script>"
            "</body></html>")
    assert _location_line_district_ar(html, "الغاط") is None


def test_city_side_with_a_sub_area_after_a_dash():
    # real ad 550358: «الغزالة - الروضه, حي الروضة» / «حي الروضة, الغزالة - الروضه»
    html = _page("ارض سكنية للبيع", "الغزالة - الروضه, حي الروضة", "450 م²", "حي الروضة, الغزالة - الروضه")
    assert _location_line_district_ar(html, "الغزالة") == "حي الروضة"


def test_the_sources_own_unspecified_district_is_never_stored():
    # real ad 520164: the page itself says «حي غير محدد»
    html = _page("الكامل, حي غير محدد", "حي غير محدد, الكامل")
    assert _location_line_district_ar(html, "الكامل") is None


def test_real_lines_from_the_reread():
    assert _location_line_district_ar(_page("بقعاء, حي بقعاء القديمة", "حي بقعاء القديمة, بقعاء"), "بقعاء") == "حي بقعاء القديمة"
    assert _location_line_district_ar(_page("ثول, حي بلدة ثول", "حي بلدة ثول, ثول"), "ثول") == "حي بلدة ثول"


def test_first_part_may_be_a_village_not_the_city():
    # real ad 473076: city is أبو عريش but the page prints «العسيله, حي العسيله»
    html = _page("العسيله, حي العسيله", "حي العسيله, العسيله")
    assert _location_line_district_ar(html, "ابو عريش") == "حي العسيله"


def test_the_sources_doubled_hay_is_collapsed():
    # real ad 576275: «النعيرية, حي حي الشهداء»
    html = _page("النعيرية, حي حي الشهداء", "حي حي الشهداء, النعيرية")
    assert _location_line_district_ar(html, "النعيرية") == "حي الشهداء"


def test_two_different_districts_on_one_page_say_nothing_unless_the_city_picks_one():
    html = _page("مكة المكرمة, حي الشامية الجديد", "حي الشامية الجديد, مكة المكرمة",
                 "جدة, حي الصفا", "حي الصفا, جدة")
    assert _location_line_district_ar(html, None) is None
    assert _location_line_district_ar(html, "مكة المكرمة") == "حي الشامية الجديد"


def test_the_page_line_wins_over_the_title_and_the_title_is_the_fallback():
    from scrapers.dealapp.run import _district_ar
    schema = {"_breadcrumb": {"itemListElement": [
        {"position": 1, "name": "الرئيسية"}, {"position": 2, "name": "مكة المكرمة"},
        {"position": 3, "name": "فيلا للبيع - الشامية - مكة المكرمة"}]}}
    page = _page("مكة المكرمة, حي الشامية الجديد", "حي الشامية الجديد, مكة المكرمة")
    assert _district_ar(schema, page, "مكة المكرمة") == "حي الشامية الجديد"      # line first
    assert _district_ar(schema, _page("فيلا للبيع"), "مكة المكرمة") == "الشامية"   # title fallback
    assert _district_ar({}, _page("فيلا للبيع"), "مكة المكرمة") is None


def test_village_ads_get_a_city_from_the_page_line_when_the_title_has_none():
    from scrapers.dealapp.run import _city_from_line
    # real ads 2026-10-03
    assert _city_from_line(_page("بئر بن هرماس, حي الربوة", "حي الربوة, بئر بن هرماس")) == ("بئر بن هرماس", "Bir Bin Hirmas")
    assert _city_from_line(_page("طحي, حي غير محدد", "حي غير محدد, طحي")) == ("طحي", "Tuhayy")   # place known even when the district is not
    assert _city_from_line(_page("فرسان - فرسان, حي الجنوبي", "حي الجنوبي, فرسان - فرسان")) == ("فرسان", "Farasan")
    assert _city_from_line(_page("القويعية - الرويضة, حي الملك عبدالله", "حي الملك عبدالله, القويعية - الرويضة"))[1] == "Al Quwayiyah"


def test_a_village_the_catalog_cannot_place_stays_without_a_city_never_a_guess():
    from scrapers.dealapp.run import _city_from_line
    assert _city_from_line(_page("الصقيع, حي الصقيع", "حي الصقيع, الصقيع")) == (None, None)
    assert _city_from_line(_page("العيينه, حي العيينه", "حي العيينه, العيينه")) == (None, None)   # Diriyah vs Tabuk: not guessed
    assert _city_from_line(_page("فرسان")) == (None, None)


def test_two_different_places_on_one_page_say_nothing():
    from scrapers.dealapp.run import _city_from_line
    html = _page("طحي, حي الوسط", "حي الوسط, طحي", "سنام, حي الشرق", "حي الشرق, سنام")
    assert _city_from_line(html) == (None, None)
