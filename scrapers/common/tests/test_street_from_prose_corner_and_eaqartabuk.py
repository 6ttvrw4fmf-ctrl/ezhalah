"""One street from prose, a corner plot stays unknown, and eaqartabuk reads it (🔬 AF engineer, 2026-10-11).

1. normalize.street_from_prose read «شمالية شارع 15 وغربية شارع 20» as ONE north street of 15: the second
   bearing carries «و», so it was not recognised and that street went uncounted. A corner plot is two
   streets → (None, None). masar, almotmkenah, aalbarrak, arkaan and eaqartabuk share this reader.
2. eaqartabuk publishes no facade/street field; its 168 served lands, which answer only street width and
   direction, had neither. Verbatim text of a live ad (حي النخيل قطعه رقم 674): «… غربيه شارع 25 متر …».
"""
import sys

import pytest

sys.path.insert(0, ".")

from scrapers.common import normalize as N  # noqa: E402
from scrapers.eaqartabuk import run as E  # noqa: E402


@pytest.mark.parametrize("text,expected", [
    ("حي النخيل قطعه رقم 674 سكني المساحه/600 متر غربيه شارع 25 متر بطول 20 متر", (25, "غرب")),
    ("شمالية شارع 15 وغربية شارع 20", (None, None)),
    ("الواجهة شمالية الشارع 20 متر", (20, "شمال")),
    ("وغربية شارع 20", (20, "غرب")),
])
def test_street_from_prose(text, expected):
    assert N.street_from_prose(text) == expected


def _map(desc: str):
    item = {"id": 674, "title": "ارض للبيع حي النخيل", "meta": {"price": "500000", "area": "600"},
            "link": "https://eaqartabuk.com/property/x/", "date": "2026-05-04T17:27:25"}
    mp = {"type": "اراضي للبيع", "usage": "residential", "operation": "sale", "status": "بيع",
          "district": "حي النخيل"}
    row, _ = E.map_listing(item, mp, desc)
    return row


def test_eaqartabuk_stores_the_one_street_its_ad_states():
    row = _map("حي النخيل قطعه رقم 674 سكني المساحه/600 متر غربيه شارع 25 متر بطول 20 متر")
    assert row["street_width_m"] == 25 and row["direction"] == "غرب"


def test_eaqartabuk_corner_plot_is_unknown():
    row = _map("ارض زاوية شمالية شارع 15 وغربية شارع 20")
    assert row["street_width_m"] is None and row["direction"] is None
