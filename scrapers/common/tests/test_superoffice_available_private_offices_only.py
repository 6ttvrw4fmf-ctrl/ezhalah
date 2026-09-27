"""SuperOffice: only an AVAILABLE («احجز») private office is a listing; the monthly price is the page's
own; the district comes from the office's address line one part at a time (a road named after a
district is never read); the company switchboard never lands on a row."""
import json

import pytest

import scrapers.superoffice.run as R

_DISTRICTS = {"الدريهمية": "حي الدريهمية", "العارض": "حي العارض", "صيدا": None,
              "طريق الملك عبد العزيز الأول": "حي الملك عبدالعزيز"}   # the road would match if it were read


@pytest.fixture(autouse=True)
def _catalog(monkeypatch):
    monkeypatch.setattr(R, "to_catalog", lambda c, region_hint=None: (3, 1) if c else (None, None))
    monkeypatch.setattr(R, "find_district_in_text", lambda t, cid: _DISTRICTS.get(t))


def _page(kind="مكاتب خاصة", status='<a href="https://superoffice.sa/ar/book/230" class=" action_btn"> احجز </a>',
          addr="صيدا ، الدريهمية ، الرياض  12791", price="2719.30 ريال / شهر"):
    return f'''<div class="carousel-outer"><img src="https://superoffice.sa/uploads/offices/1.webp" alt="">
    <img src="https://superoffice.sa/uploads/offices/1.webp" alt=""><img src="https://superoffice.sa/uploads/offices/0_1.webp"></div>
    <div class="auto-container"><ul class="bread-crumb black"><li><a href="/"> الرئيسية </a></li>
    <li> / <a href="/ar/spaces/private-office"> {kind} </a></li><li> / <a> مكتب خاص A-13 </a></li></ul>
    <div class="content-one"><div class="text"><i></i> {addr} </div><h2>مكتب خاص A-13</h2>
    <div class="price"> {price}</div><div class="actions_div"> {status}
    <a href="tel:920032320" class=" action_btn"> اتصل بنا </a></div> استأجر المكتب الخاص A13 الآن
    <h3 class="service_title">الخدمات والمرافق</h3><ul class="service_ul"><li><img src="x.png"> أثاث </li>
    <li><img src="y.png"> خدمات النظافه </li></ul></div>
    <li><a href="mailto:info@superoffice.sa">info@superoffice.sa</a></li>'''


def _map(**kw):
    return R.map_page(R.parse_page("https://superoffice.sa/ar/office-details/private-office-A13-suwaidi", _page(**kw)))


def test_an_available_private_office_maps_with_its_monthly_price_and_address_district():
    (row, cat), why = _map()
    assert why == "" and cat == "commercial" and row["property_type"] == "Office"
    assert (row["transaction_type"], row["rent_period"], row["price_annual"]) == ("Rent", "monthly", 2719 * 12)
    assert row["district_ar"] == "حي الدريهمية" and row["additional_info"]["branch"] == "السويدي"
    assert row["furnished"] is True and row["area_m2"] is None
    assert row["photo_urls"] == ["https://superoffice.sa/uploads/offices/1.webp",
                                 "https://superoffice.sa/uploads/offices/0_1.webp"]


def test_a_booked_office_and_a_meeting_room_are_never_listings():
    assert _map(status='<a class="alert_btn action_btn"> محجوز </a>')[1] == "status_محجوز"
    assert _map(kind="غرفة الاجتماعات")[1] == "kind_غرفة الاجتماعات"


def test_a_road_named_after_a_district_is_never_the_district():
    (row, _), _ = _map(addr="المبنى رقم 6143، طريق الملك عبد العزيز الأول، العارض، الرياض 13342")
    assert row["district_ar"] == "حي العارض"


def test_the_company_switchboard_is_never_stored():
    (row, _), _ = _map()
    blob = json.dumps(row, ensure_ascii=False)
    assert "920032320" not in blob and "info@superoffice.sa" not in blob
