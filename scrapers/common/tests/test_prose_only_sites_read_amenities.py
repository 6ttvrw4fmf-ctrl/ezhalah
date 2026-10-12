"""alkhaas and rawasidark read amenities from the ad's own words (🔬 AF engineer, 2026-10-12).

Both sites publish NO structured amenity field: al-khaas's page is title + area + free text, rawasidark's
catalog object is area / city / location / price / streetWidth / title / type / description (its
source_capture holds every raw key). The ad text is therefore the only statement of kitchen / AC / parking /
rooms, and prose is lawful there — YES or nothing, never «no» (ADVANCED_FILTER_SOURCE_TRUTH §2). Both parsers
stored the text and never read it: 93 of 187 active al-khaas ads and 36 of 101 rawasidark ads named one and
stored NULL, so the Advanced Filter never found them (ops_af_score 2026-10-12: alkhaas 0/5 findable;
source-reread 38229066757: «تتكون من : مجلس و مطبخ», «وراكب التكييف مكيفات شباك»).

Run: python -m pytest scrapers/common/tests/test_prose_only_sites_read_amenities.py -v
"""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scrapers.rawasidark.run import map_object  # noqa: E402


def _raw(description: str) -> dict:
    return {"id": "c9", "title": "للبيع عماره", "location": "الخبر، الثقبة", "price": 1650000, "area": 0,
            "streetWidth": "$undefined", "type": "عمارة", "imageUrl": "/images/logo.png", "statusText": "للبيع",
            "createdAt": "$D2026-07-22T00:21:34.815Z", "updatedAt": "$D2026-09-03T02:39:45.216Z", "userId": "",
            "city": "الخبر", "description": description, "images": []}


def test_rawasidark_states_kitchen_yes():
    # rawasidark_residential_listings:10283298, verbatim lines of its body
    row, _cat = map_object(_raw("12 شقة من غرفتين وصاله وحمام ومطبخ\nمجموع الغرف 31"))
    assert row["kitchen"] is True


def test_rawasidark_silence_and_stated_no_stay_unknown():
    row, _cat = map_object(_raw("عمارة على شارعين\nبدون مصعد"))
    assert "kitchen" not in row               # silence → NULL
    assert "elevator" not in row              # prose never writes «no»


def _alkhaas_page(text: str) -> str:
    rows = {"عنوان الاعلان": "للايجار شقة علوية بحي الجال", "قسم العقار": "شقق", "نوع العقار": "للايجار",
            "المدينة": "عنيزة", "المنطقة": "منطقة القصيم", "المساحة": "200"}
    table = "".join(f"<tr><th>{k}</th><td>{v}</td></tr>" for k, v in rows.items())
    return (f"<h3>تفاصيل العقار</h3><table>{table}</table>"
            f'<div class="col-sm-12">{text}</div>')


def test_alkhaas_row_reads_its_body():
    """Executes map_listing(): alkhaas_residential_listings:645835's own body, verbatim."""
    from scrapers.alkhaas.run import map_listing
    row, _cat = map_listing(993, _alkhaas_page(
        "تتكون من : مجلس مع دورة مياه وصالة ومطبخ مع مستودع وغرفتين نوم بينهم دورة مياه<br>"
        "وراكب التكييف مكيفات شباك"))
    assert row is not None
    assert row["kitchen"] is True and row["air_conditioner"] is True
    assert "elevator" not in row                       # silence → NULL


def test_alkhaas_never_writes_furnished():
    """alkhaas tables have no furnished column; writing the key fails the whole upsert (PGRST204)."""
    from scrapers.alkhaas.run import map_listing
    row, _cat = map_listing(994, _alkhaas_page("شقة مفروشة بالكامل ومطبخ"))
    assert row is not None and "furnished" not in row and row["kitchen"] is True
