"""The five sources staged 2026-11-05 (Keller Williams, Almajdiah, Asas Makeen, Al Rajhi, STeam): PRICE = SOURCE,
PERIOD = SOURCE, PDPL (no phone, email or person name stored), off-plan hidden, the honest client.

Fixtures are the real 2026-11-05 shapes cut down to the fields that matter, every person field replaced by an obvious
fake — the tests prove the fakes never reach a stored row.
"""
from __future__ import annotations

import json

import pytest

from scrapers.almajdiah import run as AM
from scrapers.asasmakeen import run as AS
from scrapers.common import honest_fetch as H
from scrapers.kellerwilliams import run as KW
from scrapers.mrajhi import run as MR
from scrapers.steam import run as ST

FAKE_PHONE = "0570000000"
FAKE_MAIL = "someone@example.com"
FAKE_NAME = "زيد المزيف"


@pytest.fixture(autouse=True)
def _no_catalogue(monkeypatch):
    fake = lambda city, district=None, region_hint=None: {"city_ar": city, "city_id": 3, "region_id": 1}  # noqa: E731
    for m in (KW, AM, AS, MR, ST):
        monkeypatch.setattr(m, "resolve", fake)
        monkeypatch.setattr(m, "catalog_district", lambda cid, d: f"حي {d.removeprefix('حي ')}" if d else None)


def _no_pii(row: dict) -> None:
    s = json.dumps(row, ensure_ascii=False, default=str)
    assert FAKE_PHONE not in s and FAKE_MAIL not in s and FAKE_NAME not in s, s[:400]


# ── Keller Williams ──────────────────────────────────────────────────────────────────────────────────────────────
def _kw(**over):
    x = {"_id": 2149160983275828, "list_uuid": "50b060391b4b1c692c8bf5d7", "list_category": "For Sale",
         "list_status": "Active", "prop_type": "Residential", "prop_subtype": "Apartment",
         "listing_title": "شقة للبيع في حي القيروان", "mls_number": "6201037915", "current_list_price": 950000,
         "list_desc": f"شقة 3 غرف مع مصعد\nللاستفسار:\n{FAKE_PHONE}",
         "list_desc_en": f"please contact the number provided below\nZaid Fakename.\n{FAKE_PHONE}",
         "total_bed": 3, "total_bath": 2, "living_area": 140, "living_area_units": "sqm",
         "list_address": {"city": "الرياض", "coordinates_gp": {"lat": 24.85, "lon": 46.62}},
         "location": {"region": "الرياض", "neighborhoods": [{"neigh_name": "حي القيروان"}]},
         "list_agent_office": {"list_agent_full_name": "Zaid Fakename", "list_agent_first_name": "Zaid",
                               "list_agent_last_name": "Fakename", "list_agent_preferred_phone": FAKE_PHONE,
                               "list_agent_email": FAKE_MAIL},
         "brokerage": {"name": "KW Jasmine", "email": FAKE_MAIL, "phone": FAKE_PHONE},
         "photos": [{"ph_url": "https://storage.googleapis.com/a.jpg"}], "marketing_info": {"display_list_price": True}}
    x.update(over)
    return x


def test_kw_sale_is_the_source_price_with_licence_pin_and_no_agent():
    (row, cat), _ = KW.map_listing(_kw())
    assert cat == "residential" and row["price_total"] == 950000 and row["license_number"] == "6201037915"
    assert row["listing_url"] == "https://kwsaudiarabia.com/propertydetails/50b060391b4b1c692c8bf5d7"
    assert row["additional_info"]["latitude"] == pytest.approx(24.85) and row["elevator"] is True
    _no_pii(row)
    assert "Fakename" not in json.dumps(row, ensure_ascii=False)          # an UNLABELLED signature, removed by value


def test_kw_rent_period_only_when_the_text_ties_it_to_the_price():
    (silent, _), _ = KW.map_listing(_kw(list_category="For Rent", current_list_price=85000, list_desc="شقة للإيجار"))
    assert silent["rent_period"] is None and silent["price_annual"] == 85000          # PERIOD = SOURCE = silent
    (yearly, _), _ = KW.map_listing(_kw(list_category="For Rent", current_list_price=55000,
                                        list_desc="الإيجار السنوي 55,000 ريال"))
    assert (yearly["rent_period"], yearly["price_annual"]) == ("annual", 55000)


def test_kw_area_is_the_unit_for_a_flat_and_the_lot_for_a_villa():
    (flat, _), _ = KW.map_listing(_kw(living_area=109.33, lot_size_area=607.1, lot_size_units="sqm"))
    assert flat["area_m2"] == 109
    (villa, _), _ = KW.map_listing(_kw(listing_title="فيلا للبيع", prop_subtype="Single Family Detached",
                                       living_area=300, lot_size_area=1225, lot_size_units="sqm"))
    assert villa["property_type"] == "Villa" and villa["area_m2"] == 1225


def test_kw_off_market_and_internal_codes_are_not_guessed():
    assert KW.map_listing(_kw(list_category="Off Market"))[0] is None
    (row, _), _ = KW.map_listing(_kw(mls_number="MA00034"))
    assert row["license_number"] is None and row["additional_info"]["mls_number"] == "MA00034"


def test_kw_commercial_filing_makes_bare_land_commercial():
    (row, cat), _ = KW.map_listing(_kw(prop_type="Commercial", prop_subtype="Other", listing_title="أرض للبيع بحي الفيحاء"))
    assert (row["property_type"], cat) == ("Commercial Land", "commercial") and row["bedrooms"] is None


# ── Almajdiah ────────────────────────────────────────────────────────────────────────────────────────────────────
def _am(**over):
    u = {"id": 3494, "unit_name": "الماجدية 45 - A 1", "unit_number": "1", "building_name": "A",
         "bedrooms_count": 2, "bathrooms_count": 2, "total_area": "95", "floor_text": "الطابق الأرضي",
         "is_has_kitchen": 1, "is_has_air_conditioning": 1, "is_has_maid_room": 0, "is_furnished": 0,
         "parking_text": "موقف خارجي", "unit_map_url": "https://www.google.com/maps/search/?api=1&query=24.779537,46.704106",
         "unit_description": f"سطح خاص للتواصل {FAKE_PHONE}", "one_batches_price": 70000, "two_batches_price": 72000,
         "insurance": "3000", "rental_license": "6201074157", "is_rental_license_expired": False,
         "area": "الرياض", "regionBlock": "التعاون", "type": "in_unit", "project": {"id": 46}}
    u.update(over)
    return u


def test_almajdiah_price_is_the_one_payment_figure_and_the_period_stays_silent():
    row, _ = AM.map_unit(_am(), {"id": 46, "name": "الماجدية 45"})
    assert row["price_annual"] == 70000 and row["rent_period"] is None
    assert row["additional_info"]["price_two_payments"] == 72000 and row["license_number"] == "6201074157"
    assert row["listing_url"] == "https://almajdiah.com/rentals/46?platform=web"          # never www. (self-signed)
    assert (row["kitchen"], row["maid_room"], row["floor_number"]) == (True, False, 0)
    _no_pii(row)


def test_almajdiah_placeholder_licence_is_no_licence():
    row, _ = AM.map_unit(_am(rental_license="--"), None)
    assert row["license_number"] is None and row["additional_info"]["rental_license_raw"] == "--"


def test_almajdiah_expired_licence_is_not_listed():
    assert AM.map_unit(_am(is_rental_license_expired=True), None)[0] is None


# ── Asas Makeen ──────────────────────────────────────────────────────────────────────────────────────────────────
_AS_PAGE = """<div class="apartment-unit-detail__info"> <span class="badge bg-secondary rounded-0 mb-3">{badge}</span>
<h2 class="h4">شقة 115م بشرق الرياض حي الرمال</h2> <p class="text-muted small mb-2">A-GF-A2</p>
<p class="mb-2"> <strong>في مشروع:</strong> {project} — حي الرمال </p>
<span class="unit-price-current fw-bold"> 55,000ريال </span>{rent}
<ul class="list-unstyled apartment-unit-detail__specs mb-4"> <li>عدد الغرف: 2</li> <li> الدور: الأرضي</li>
<li>المساحة: 115 م2</li> <li>دورتان مياة</li> <li>راكب المطبخ</li> <li>غرفة خادمة</li> </ul>
<div class="apartment-unit-detail__cta"></div>"""
_RENT = '<span class="badge rounded-pill unit-price-rent-badge">إيجار</span>'


def test_asas_rent_price_is_source_period_silent_baths_read_from_the_lines():
    u = AS.parse_unit(_AS_PAGE.format(badge="تأجير", project="مكين 66", rent=_RENT))
    row, _ = AS.map_unit("2087", "https://asasmakeen.com/ar/x", u)
    assert row["price_annual"] == 55000 and row["rent_period"] is None and row["transaction_type"] == "Rent"
    assert (row["bathrooms"], row["bedrooms"], row["area_m2"]) == (2, 2, 115)            # baths only in the text
    assert row["kitchen"] is True and row["maid_room"] is True and "دورتان مياة" in row["description"]


def test_asas_sale_and_offplan_split_follows_the_sites_own_list():
    u = AS.parse_unit(_AS_PAGE.format(badge="بيع", project="طليعة المشرقية", rent=""))
    assert u["project"] == "طليعة المشرقية"          # main() routes it to asasmakeen_offplan_units by project
    row, _ = AS.map_unit("1971", "https://asasmakeen.com/ar/y", u)
    assert row["price_total"] == 55000 and "price_annual" not in row


_AS_PROJECT = """<h1 class="display-5">مكين 90</h1><h2 class="mb-5 fw-bold">معلومات عن المشروع</h2>
<div class="fs-5 lh-lg">يأتي مشروع مكين 90 ... في موقع حيوي شرق مدينة الرياض.</div>
<a class="project-location-map__directions"
   href="https://www.google.com/maps/dir/?api=1&amp;destination=24.7260923%2C46.7651659" target="_blank">
<iframe src="https://www.google.com/maps/embed?pb=!1m3!2m1!1s24.7260923%2C46.8032747!6i16"></iframe>
<footer>الرياض - حي النرجس - طريق انس بن مالك</footer>"""


def test_asas_unit_inherits_its_projects_pin_and_city_never_the_map_centre_or_footer():
    page = _AS_PAGE.replace("شقة 115م بشرق الرياض حي الرمال", "شقة 212م بحي المنار")       # the title names no city
    page += '<option value="9" data-slug="مكين-90">\n   مكين 90 - حي المنار   </option>'
    assert AS.project_slugs(page) == {"مكين 90": "مكين-90"}
    u = AS.parse_unit(page.format(badge="بيع", project="مكين 90", rent=""))
    assert AS.map_unit("3076", "https://asasmakeen.com/ar/z", u)[0]["city_ar"] is None   # no project read: no claim
    row, _ = AS.map_unit("3076", "https://asasmakeen.com/ar/z", u, AS.parse_project(_AS_PROJECT))
    info = row["additional_info"]
    assert row["city_ar"] == "الرياض" and (info["latitude"], info["longitude"]) == (24.7260923, 46.7651659)
    assert info["pin_scope"] == "project"
    assert AS.parse_project(_AS_PROJECT)["name"] == "مكين 90"   # an old project found via the sitemap must match by <h1>
    assert AS._allowed(AS.PROJECTS_SITEMAP)
    footer_only = AS.parse_project(_AS_PROJECT.replace("شرق مدينة الرياض", "شرق المدينة").replace("destination=", "x="))
    row, _ = AS.map_unit("3076", "https://asasmakeen.com/ar/z", u, footer_only)
    assert row["city_ar"] is None and row["additional_info"]["pin_absent"] is True and "latitude" not in row["additional_info"]
    assert AS._allowed(AS.SITE + AS.PROJECT_PATH + "x") and not AS._allowed(AS.SITE + "/api/projects")


# ── Al Rajhi ─────────────────────────────────────────────────────────────────────────────────────────────────────
_MR_PAGE = """<script type="application/ld+json">{ld}</script><div>
<p>إيجار سنوي</p><p>فيلا</p><p>عنوان الإعلان العقاري</p><p>فيلا 3 غرف وصالتين</p><p>مشروع الواحة</p><p>•</p>
<p>رقم المشروع</p><p>:</p><p>31</p><p>السعودية</p><p>•</p><p>الرياض</p><p>•</p><p>العليا</p>
<p>3</p><p>غرف نوم</p><p>4</p><p>دورات مياه</p><p>2</p><p>صالات</p><p>الأرضي</p><p>الدور</p>
<p>السعر المطلوب</p><p>١٣٠٬٠٠٠</p><p>ر.س</p><p>إيجار سنوي</p>
<p>أرقام الحراس</p><p>للمعاينة فقط</p><p>الحارس الأول</p><p>: {name}</p><p>{phone}</p>
<p>رقم رخصة الإعلان</p><p>7200809360</p><iframe src="https://www.google.com/maps?q=24.6902,46.6915&z=17"></iframe></div>"""


def test_mrajhi_stated_yearly_price_and_the_guard_is_never_stored():
    ld = json.dumps({"@type": "RealEstateListing", "name": "فيلا 3 غرف وصالتين",
                     "description": f"فيلا للإيجار - مسبح خاص\nللتواصل {FAKE_PHONE}",
                     "offers": {"price": 130000, "description": "إيجار سنوي"},
                     "address": {"addressLocality": "الرياض", "streetAddress": "العليا"}}, ensure_ascii=False)
    page = _MR_PAGE.format(ld=ld, name=FAKE_NAME, phone=FAKE_PHONE)
    assert FAKE_NAME not in " ".join(MR.page_lines(page))
    (row, cat), _ = MR.map_unit("RqVrwO8A", "https://mrajhi.com.sa/units/RqVrwO8A", MR.parse_unit(page))
    assert (row["rent_period"], row["price_annual"], cat) == ("annual", 130000, "residential")
    assert (row["bathrooms"], row["halls"], row["license_number"]) == (4, 2, "7200809360")
    assert row["district_ar"] == "حي العليا" and row["additional_info"]["latitude"] == pytest.approx(24.6902)
    _no_pii(row)


# ── STeam ────────────────────────────────────────────────────────────────────────────────────────────────────────
_ST_PAGE = """<body class="postid-17969"><h1>للايجار شقة جديده حي لبن</h1>
<a href="x" class="label-status label status-color-28"> للايجار </a><li class="item-price item-price-text"></li>
<div class="property-address-wrap property-section-wrap" id="property-address-wrap"><strong>مدينة:</strong> <span>الرياض</span>
<strong>المنطقة:</strong> <span>حي لبن</span></div>
<div class="property-detail-wrap property-section-wrap" id="property-detail-wrap"><strong>المساحة</strong> <span>١٢٠ م مربع</span>
<strong>غرف النوم</strong> <span>3</span><strong>نوع</strong> <span>شقة, سكني</span></div>
<div class="property-features-wrap property-section-wrap" id="property-features-wrap">
<a href="https://steam-realestate.com/feature/x/">تكييف</a></div>
<div class="property-description-wrap property-section-wrap" id="property-description-wrap">
<article data-testid="dynamic-sanitize-html">3 غرف نوم + صالة + 2دورة مياه<br /> الشقة مخدومة بالمصعد<br />
• السعر 65.000<br /> {phone}</article></div>"""


def test_steam_prose_price_is_never_a_price_and_text_baths_are_read():
    p = ST.parse_property(_ST_PAGE.format(phone=FAKE_PHONE))
    (row, cat), _ = ST.map_property("slug", "https://steam-realestate.com/property/slug/", p)
    assert row["ad_number"] == "STM17969" and cat == "residential"
    assert row["price_annual"] is ST.db.AUTHORITATIVE_NULL and "price_total" not in row   # «السعر 65.000» is prose
    assert row["bathrooms"] == 2 and row["elevator"] is True and row["air_conditioner"] is True
    assert "السعر 65.000" in row["description"]
    _no_pii(row)


# ── the honest client ────────────────────────────────────────────────────────────────────────────────────────────
class _R:
    def __init__(self, code, text):
        self.status_code, self.text = code, text


class _S:
    def __init__(self, r):
        self.r, self.seen = r, []

    def request(self, method, url, headers=None, **_):
        self.seen.append(headers)
        return self.r


def test_honest_client_stops_on_a_wall_and_refuses_what_robots_forbids():
    ok = lambda u: u.startswith("https://ok/")  # noqa: E731
    with pytest.raises(ValueError):
        H.get_text("https://ok-not/x", allowed=ok, sleep=lambda s: None)
    for r in (_R(403, ""), _R(429, ""), _R(200, "<title>Just a moment… cf-chl</title>"), _R(200, "please solve the CAPTCHA")):
        with pytest.raises(H.Blocked):
            H.get_text("https://ok/x", allowed=ok, session=_S(r), sleep=lambda s: None)
    s = _S(_R(200, "<html>fine</html>"))
    assert H.get_text("https://ok/x", allowed=ok, session=s, sleep=lambda s: None) == "<html>fine</html>"
    assert s.seen[0]["User-Agent"] == "Ezhalah-bot/1.0 (+https://ezhalah.com)"


def test_every_crawler_allows_only_its_own_robots_rule():
    assert not AS._allowed("https://asasmakeen.com/api/units") and AS._allowed(AS.SITEMAP)
    assert not MR._allowed("https://mrajhi.com.sa/api/units") and MR._allowed("https://mrajhi.com.sa/units/RqVrwO8A")
    assert not ST._allowed("https://steam-realestate.com/wp-json/wp/v2/property") and ST._allowed(ST.SITEMAP)
    assert not AM._allowed("https://www.almajdiah.com/x") and KW._allowed(KW.API)
