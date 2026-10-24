"""صادق التاجر: the ad's title-row map link is its pin; a «اعلانات مشابهة» card's link never is
(owner 2026-10-24: every pin the source has; measured on 5 live ads, source-reread 40072817782).

Run: python -m pytest scrapers/common/tests/test_sadiqeltajer_reads_its_own_pin_2026_10_24.py -v
"""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import scrapers.sadiqeltajer.run as S  # noqa: E402

S.to_catalog = lambda city_ar, region_hint=None: (1, 1)
S.find_district_in_text = lambda text, city_id: text

OWN = ('<div class="ad-title-meta-row"><div class="ad-title-media-icons">'
       '<a href="https://www.google.com/maps?q=26.3311,44.0123"\n   class="ad-map-wrap" target="_blank">'
       '<span class="ad-map-link"></span></a></div></div>')
NEIGHBOUR = ('<ul class="listing-feature-list"></ul><div class="ad-title-media-icons">'
             '<a href="https://www.google.com/maps?q=26.304739,44.02628"\n  class="ad-map-icon" target="_blank"></a></div>')
# The header shape of test_sadiqeltajer_never_reads_a_neighbours_price.PAGE.
BODY = ("--&gt; 3 استراحات بحي الغدير شرق بريدة --&gt; بيع استراحات واحواش كود الاعلان : 5106 "
        "(حد) 3 استراحات بحي الغدير شرق بريدة 235,000 ريال 480 م² اللوكيشن تفاصيل الإعلان "
        "للبيع 3 استراحات بحي الغدير شرق بريدة المساحة : 480م "
        "الموقع حسب الصك من وزارة العدل القصيم - بريدة - الغدير ")


def page(own_link: bool) -> str:
    return ("<html><body>" + (OWN if own_link else "") + BODY
            + "اعلانات مشابهة " + NEIGHBOUR + "</body></html>")


def test_the_title_row_link_is_the_pin():
    assert S.own_pin(page(True)) == {"latitude": 26.3311, "longitude": 44.0123}


def test_a_neighbours_card_link_is_never_the_pin():
    # No own link: the only map link on the page belongs to a similar ad below «اعلانات مشابهة».
    assert S.own_pin(page(False)) == {}


def test_a_neighbour_link_above_the_cut_is_still_not_read():
    # The card class, not the position, is what makes a link ours.
    assert S.own_pin("<html>" + NEIGHBOUR + BODY + "</html>") == {}


def test_the_pin_reaches_the_row():
    row, _cat, why = S.map_listing("https://sadiq-eltajer.sa/ads/x", page(True))
    assert row is not None, why
    assert row["additional_info"]["latitude"] == 26.3311
    assert row["additional_info"]["longitude"] == 44.0123


def test_no_link_writes_no_pin():
    row, _cat, why = S.map_listing("https://sadiq-eltajer.sa/ads/x", page(False))
    assert row is not None, why
    assert "latitude" not in row["additional_info"]
