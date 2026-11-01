"""hajer amenities come from the ad's own body (🔬 AF engineer, 2026-10-07).

hajer's REM block publishes rooms, area, facade, street, age — and no amenity field at all, so the ad
body is the only statement and prose is lawful (four outcomes, line by line). The parser never read
it: 0 kitchen / 0 maid room on 121 listings whose pages list «مطبخ مغلق», «غرفة خادمة», «غرفة غسيل»
(ops_af_score 2026-10-07 hajer findability 0/4; source-reread 37608383084).

    python -m pytest scrapers/common/tests/test_hajer_amenities_from_the_ad_body.py -q
"""
from __future__ import annotations

import sys

sys.path.insert(0, ".")

from scrapers.common import normalize as N  # noqa: E402
from scrapers.hajer import run as H  # noqa: E402

# Verbatim shape of a live hajer WP `content.rendered` (2026-10-07, wp id 1508).
BODY = {"content": {"rendered": "<p>يتكون من دورين وملحق:</p><p>الدور الأرضي<br>•صالة+دورة مياه<br>"
                                "•مجلس رجال+دورة مياه<br>•غرفة طعام<br>•مطبخ مغلق+مستودع</p>"
                                "<p>•غرفة خادمة<br>•غرفة غسيل<br>•سطح</p>"}}


def test_the_body_states_kitchen_maid_and_laundry():
    out = N.amenities_from_lines(H._body_lines(BODY))
    assert out.get("kitchen") is True and out.get("maid_room") is True and out.get("laundry_room") is True


def test_silence_and_negation_are_kept():
    assert N.amenities_from_lines(H._body_lines({"content": {"rendered": "<p>أرض سكنية</p>"}})) == {}
    assert H._body_lines({}) == ""
    neg = N.amenities_from_lines(H._body_lines({"content": {"rendered": "<p>بدون مصعد<br>مطبخ راكب</p>"}}))
    assert neg.get("elevator") is False and neg.get("kitchen") is True    # «بدون» never crosses a line


def test_map_listing_carries_the_body_amenities():
    from scrapers.common.tests.test_hajer_direction_reaches_the_column import BASE, P, _page
    row, _, _ = H.map_listing({**P, **BODY}, _page(*BASE))
    assert row["kitchen"] is True and row["maid_room"] is True and row["laundry_room"] is True
    silent, _, _ = H.map_listing(P, _page(*BASE))
    assert "kitchen" not in silent and "elevator" not in silent       # silence stores nothing
