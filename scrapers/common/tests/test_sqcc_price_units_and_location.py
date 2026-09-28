"""SQCC: one published price is stored verbatim; two prices / «تبدا من» / two quoted rents = several units →
price and area NULL; the deal is the site's own sale/rent category; a SALE «مؤجرة» is income, not off-market;
the location is the archive card's «المنطقة», never a town borrowed from inside a district name.
Fixtures are trimmed from the live site 2026-09-27."""
import pytest

import scrapers.sqcc.run as Q

_CITIES = {"الدمام": (13, 5), "الخبر": (31, 5), "القطيف": (67, 5), "جدة": (18, 2),
           "ضاحية": (14151, 6), "بدر": (1053, 3)}           # ضاحية / بدر: real towns ELSEWHERE in the catalog
_DISTRICTS = ("طيبة", "الفيحاء", "اللؤلؤ", "ضاحية الملك فهد", "المطار")


@pytest.fixture(autouse=True)
def _catalog(monkeypatch):
    monkeypatch.setattr(Q, "to_catalog", lambda c, region_hint=None: _CITIES.get(c, (None, None)))
    monkeypatch.setattr(Q, "find_district_in_text",
                        lambda t, cid: next((f"حي {d}" for d in _DISTRICTS if d.removeprefix("ال") in t), None))


URL = "https://sqcc.sa/realestate/x/"
SALE = {"وحدات للبيع": {URL}, "الدمام": {URL}}
RENT = {"وحدات للأيجار": {URL}, "الدمام": {URL}}

PAGE = """<link rel="canonical" href="https://sqcc.sa/realestate/%d8%b4/" /><link rel='shortlink' href='https://sqcc.sa/?p=53' />
<div class="precemp"> <h2>شقق تمليك للبيع</h2></div><div id="postin" style="">
<div class="postin_img postin_img_center"><img width="960" src="https://sqcc.sa/wp-content/uploads/2024/07/WA-3.jpeg" /></div>
<div class="news_shape_txt_all"> <p>250,000 / 270,000 ريال</p> <div class="serv_info">
<span class="icons139">2</span><span class="icons140">2</span><span class="icons141">مساحة تبدا من 99م</span></div></div>
<div class="postin_txt"></div><div class="shape_gallerys_all"> <a href="https://sqcc.sa/wp-content/uploads/2024/07/og.jpg" class="lightview">
</a></div><ul class="shape_data_list"><li><div><span class="icons11"></span><p>العمر : 19 سنة</p></div></li>
<li><div><span class="icons61"></span><p>شقق استثمارية مؤجرة للتواصل 0551234567</p></div></li>
<li><div><span class="icons89"></span><a href="https://maps.google.com/?q=26.437622,50.046021">الموقع</a></div></li></ul>
</div><div id="data"></div><div class="foot_phone">رقم الهاتف : 0138113427</div>"""


def _d(title=None, price=None, area=None, specs=None):
    d = Q.parse_page(PAGE)
    if title is not None:
        d["title"] = title
    if price is not None:
        d["price_text"] = price
    if area is not None:
        d["serv"]["icons141"] = area
    if specs is not None:
        d["specs"] = specs
    return d


def test_the_listing_block_is_parsed_and_the_logo_and_footer_are_not():
    d = Q.parse_page(PAGE)
    assert d["id"] == "53" and d["title"] == "شقق تمليك للبيع" and d["price_text"] == "250,000 / 270,000 ريال"
    assert d["serv"] == {"icons139": "2", "icons140": "2", "icons141": "مساحة تبدا من 99م"}
    assert d["photos"] == ["https://sqcc.sa/wp-content/uploads/2024/07/WA-3.jpeg"]     # og.jpg is the SQC logo
    assert (d["lat"], d["lng"]) == ("26.437622", "50.046021") and "0138113427" not in repr(d)


def test_two_prices_or_a_from_range_is_several_units_price_and_area_null():
    (row, cat), why = Q.map_listing(URL, _d(), SALE, "حي الفيحاء الدمام")
    assert why == "" and cat == "residential" and row["property_type"] == "Apartment"
    assert row["price_total"] is None and row["area_m2"] is None
    assert row["additional_info"]["price_text"] == "250,000 / 270,000 ريال"
    assert row["additional_info"]["area_text"] == "مساحة تبدا من 99م"
    assert (row["bedrooms"], row["bathrooms"], row["property_age"]) == (2, 2, 19)
    two_rents = ["الفتحة الكبيرة مساحة 110 متر سعر الايجار 100,000 ريال",
                 "الفتحة الصغيرة مساحة 90 متر سعر الايجار 75,000 ريال"]
    (row, _), _ = Q.map_listing(URL, _d("محلات للايجار", "100,000 ريال", "مساحة 110 م", two_rents), RENT, "الدمام")
    assert row["price_annual"] is None and row["area_m2"] is None       # never pick the bigger shop


def test_one_price_is_stored_verbatim_per_metre_and_arabic_digits_included():
    (row, _), _ = Q.map_listing(URL, _d("عمارة للبيع", "1,300,000 ريال", "المساحة 400م2", []), SALE, "الدمام")
    assert row["price_total"] == 1300000 and row["area_m2"] == 400.0    # «م2» is a unit, never a digit
    (row, cat), _ = Q.map_listing(URL, _d("مزرعة للبيع", "75 ريال للمتر", "المساحة  50,000م", []), SALE, "الدمام")
    assert row["price_per_meter"] == 75 and row["price_total"] is None and row["area_m2"] == 50000.0
    assert row["property_type"] == "Farm" and cat == "commercial"
    (row, _), _ = Q.map_listing(URL, _d("مزرعة للبيع", "3 ريال للمتر", "المساحة  مليونان م", []), SALE, "الدمام")
    assert row["area_m2"] is None                                        # a number in words is not parsed


def test_a_rent_is_judged_by_its_price_when_no_period_is_stated():
    # owner 2026-09-28: no stated period → above 10,000 is yearly (a 25 m² shop at 12,000 a MONTH is impossible)
    (row, cat), _ = Q.map_listing(URL, _d("محل للايجار", "١٢٠٠٠ ريال", "المساحة ٢٥م", []), RENT, "الدمام")
    assert row["transaction_type"] == "Rent" and row["price_annual"] == 12000 and row["rent_period"] == "annual"
    assert row["area_m2"] == 25.0 and row["property_type"] == "Shop" and cat == "commercial"
    (row, _), _ = Q.map_listing(URL, _d("غرفة وصالة للايجار", "3300 ريال", "", ["3300 ريال ايجار شهري"]), RENT, "الدمام")
    assert row["rent_period"] == "monthly" and row["price_annual"] == 39600


def test_the_deal_is_the_sites_category_and_off_market_words_skip():
    assert Q.map_listing(URL, _d(), {"الدمام": {URL}}, "الدمام") == (None, "deal_unstated")
    assert Q.map_listing(URL, _d(), RENT, "الدمام") == (None, "deal_title_conflict")      # title says تمليك
    (row, _), _ = Q.map_listing(URL, _d(), SALE, "الدمام")                   # SALE «مؤجرة» = income, kept
    assert row["transaction_type"] == "Buy"
    rented = _d("دوبلكس للايجار", "50,000 ريال", "مساحة ٢٠٠م", ["تم التأجير"])
    assert Q.map_listing(URL, rented, RENT, "الدمام") == (None, "already_rented")
    auction = _d("ارض للبيع", "1,000,000 ريال", "المساحة 900م", ["تباع في المزاد العلني"])
    assert Q.map_listing(URL, auction, SALE, "الدمام") == (None, "sold_reserved_or_auction")


@pytest.mark.parametrize("title,ptype", [
    ("فلة دوبلكس متصل للبيع", "Duplex"), ("فيلا دوبلكس للبيع", "Duplex"), ("عمارة تجارية", "Commercial Building"),
    ("فرصه ذهبيه ارض للبيع تجارية", "Commercial Land"), ("ارض سكنية للبيع", "Residential Land"),
    ("مجمع محلات للايجار", "Shop"), ("مكاتب للايجار", "Office"), ("اراضي زراعية للايجار", "Farm"),
    ("للبيع شقة فاخرة", "Apartment"), ("استراحة للبيع", "Rest House"),
])
def test_the_titles_own_type_word(title, ptype):
    assert Q.title_type(title) == ptype


def test_an_unmapped_type_is_skipped():
    assert Q.map_listing(URL, _d("سويتات فاخرة VIP", "3300 / 4800 ريال", "", []), RENT, "الدمام") \
        == (None, "type_unmapped_سويتات")


@pytest.mark.parametrize("where,city,district", [
    ("حى طيبة (الدمام)", "الدمام", "حى طيبة"), ("حي اللؤلؤ بالخبر", "الخبر", "حي اللؤلؤ"),
    ("حي الفيحاء الدمام", "الدمام", "حي الفيحاء"), ("الجبيل طريق الملك فيصل", None, "الجبيل"),
    ("ضاحية الملك فهد", None, "ضاحية الملك فهد"), ("حى بدر", None, "حى بدر"), ("الدمام", "الدمام", None),
])
def test_the_city_comes_only_from_the_cards_city_slot(where, city, district):
    assert Q.place(where) == (city, district)


def test_the_card_location_resolves_and_a_contradicting_category_nulls_it():
    (row, _), _ = Q.map_listing(URL, _d("دوبلكس متصل للبيع", "950,000 ريال", "المساحة 197م", []), SALE, "حى طيبة (الدمام)")
    assert (row["city_ar"], row["city_id"], row["district_ar"], row["neighborhood"]) == ("الدمام", 13, "حي طيبة", "طيبة")
    (row, _), _ = Q.map_listing(URL, _d("مزرعة للبيع", "20 ريال للمتر", "المساحة 200,000م", []), SALE, "غرب مطار الدمام")
    assert row["district_ar"] is None                       # «غرب مطار» is not the district المطار
    (row, _), _ = Q.map_listing(URL, _d("مكاتب للايجار", "17000 ريال", "", []), RENT, "حي ابن خلدون (القطيف)")
    assert row["city_ar"] is None and row["additional_info"]["location_conflict"] == ["الدمام"]


def test_no_phone_is_stored_anywhere():
    (row, _), _ = Q.map_listing(URL, _d(), SALE, "الدمام")
    assert "0551234567" not in repr(row) and "0138113427" not in repr(row)
