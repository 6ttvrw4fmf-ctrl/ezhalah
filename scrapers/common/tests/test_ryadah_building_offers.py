"""Ryadah: every post is a whole building offering its units — status is the deal, the price is
«عند الاتصال», the size meta is the BUILDING's, the unit type must be exactly one taxonomy type, and the
owner's name/contact in the REST meta never reach a row. Fixtures are trimmed from the live site 2026-09-27."""
import pytest

import scrapers.ryadah.run as R

_DISTRICTS = ("قرطبة", "البحيرة", "الروابي")


@pytest.fixture(autouse=True)
def _catalog(monkeypatch):
    monkeypatch.setattr(R, "to_catalog", lambda c, region_hint=None: (31, 5) if c == "الخبر" else (None, None))
    # the real finder scans 3/2/1-word windows: «بحيرة الشبيلي» → «بحيرة» → حي البحيرة
    monkeypatch.setattr(R, "find_district_in_text",
                        lambda t, cid: next((f"حي {d}" for d in _DISTRICTS if d.removeprefix("ال") in t), None))


PAGE = """<nav class="property-breadcrumbs"><ul><li><a href="https://ryadah.com.sa/">الصفحة الرئيسية</a></li>
<li><a href="https://ryadah.com.sa/property-city/x-ar/">السعودية</a></li>
<li><a href="https://ryadah.com.sa/property-city/y-ar/">المنطقة الشرقية</a></li>
<li><a href="https://ryadah.com.sa/property-city/z-ar/">الخبر</a></li></ul></nav>
<h1 class="rh_page__title">قرية ريتان</h1><div class="rh_page__property_price"><p class="status"> STATUS </p>
<p class="price "> عند الاتصال </p></div></div><!-- /.rh_page__head -->
<ul><li class="rh_property__feature" id="f1"><span></span><a href="#">موقف سيارات</a></li></ul>
<div class="rh_prop_card"><span class="rh_prop_card__status">تم البيع</span></div>"""


def _post(**meta):
    m = {"REAL_HOMES_property_price": "", "REAL_HOMES_property_price_postfix": "",
         "REAL_HOMES_property_size": "5591", "REAL_HOMES_property_size_postfix": "متر مربع",
         "REAL_HOMES_property_address": "85PV+G6V، قرطبة، الخبر 34235، المملكة العربية السعودية",
         "REAL_HOMES_additional_details_list": [["الوحدات", "100"]],
         "REAL_HOMES_property_images": [{"full_url": "https://ryadah.com.sa/wp-content/uploads/Retan-1.jpg"}],
         "inspiry_property_owner_name": "خالد المالك", "inspiry_property_owner_contact": "0551234567"}
    m.update(meta)
    return {"id": 9757, "link": "https://ryadah.com.sa/property/%d9%82/",
            "title": {"rendered": "قرية ريتان"},
            "content": {"rendered": "<p>مجمع سكني من 100 وحدة للتواصل 0551234567</p>"}, "property_meta": m}


def _map(status="للإيجار", terms=("إدارة الممتلكات والمرافق", "سكني", "شقة"), page=PAGE, **meta):
    return R.map_property(_post(**meta), R.parse_page(page.replace("STATUS", status)), list(terms))


def test_the_page_head_is_read_not_the_similar_property_cards():
    d = R.parse_page(PAGE.replace("STATUS", "للإيجار"))
    assert d["status"] == "للإيجار" and d["price_text"] == "عند الاتصال"
    assert d["crumbs"] == ["السعودية", "المنطقة الشرقية", "الخبر"] and d["features"] == ["موقف سيارات"]


def test_on_call_is_an_authoritative_null_and_the_building_size_is_never_the_area():
    (row, cat), why = _map()
    assert why == "" and cat == "residential" and row["property_type"] == "Apartment"
    assert row["transaction_type"] == "Rent" and row["price_annual"] is None and row["rent_period"] is None
    assert row["price_evidence"]["authoritative_absent"] is True and row["price_evidence"]["found"] is False
    assert row["area_m2"] is None and row["additional_info"]["building_size_text"] == "5591 متر مربع"
    assert row["city_ar"] == "الخبر" and row["district_ar"] == "حي قرطبة" and row["neighborhood"] == "قرطبة"
    assert row["parking"] is True and row["photo_urls"] == ["https://ryadah.com.sa/wp-content/uploads/Retan-1.jpg"]


def test_a_published_rent_goes_through_the_period_rule_never_a_hardcoded_annual():
    page = PAGE.replace("عند الاتصال", "5,000 ريال")
    (row, _), _ = _map(page=page, REAL_HOMES_property_price="5000", REAL_HOMES_property_price_postfix="شهري")
    assert row["rent_period"] == "monthly" and row["price_annual"] == 60000
    (row, _), _ = _map(page=page, REAL_HOMES_property_price="90000")
    assert row["price_annual"] == 90000 and row["rent_period"] is None      # no period stated → unknown
    (row, _), _ = _map(status="للبيع", terms=("فيلا",), page=page,
                       REAL_HOMES_property_price="3500", REAL_HOMES_property_price_postfix="ريال / متر مربع")
    assert row["price_per_meter"] == 3500 and row["price_total"] is None


@pytest.mark.parametrize("status", ["تم البيع", "تم التأجير", "قريبا"])
def test_a_post_that_is_not_an_offer_is_skipped(status):
    assert _map(status=status) == (None, f"status_{status}")


def test_off_plan_bahrain_and_every_type_ambiguity_are_skipped_never_guessed():
    off = _post()
    off["content"]["rendered"] = "<p>برج سكني بنظام البيع على الخارطة المعتمد رسميًا</p>"
    assert R.map_property(off, R.parse_page(PAGE.replace("STATUS", "للبيع")), ["شقة"]) == (None, "off_plan")
    bahrain = PAGE.replace(">السعودية<", ">البحرين<")
    assert _map(page=bahrain) == (None, "outside_saudi")
    assert _map(terms=("تجاري", "محل", "مكاتب")) == (None, "type_multiple")
    assert _map(terms=("سكني", "إدارة الممتلكات والمرافق")) == (None, "type_unstated")
    assert _map(terms=("تجاري", "درايف ثرو")) == (None, "type_unmapped_درايف ثرو")
    (row, cat), _ = _map(terms=("تجاري", "مكاتب"))
    assert row["property_type"] == "Office" and cat == "commercial"
    (row, _), _ = _map(terms=("شقة على الروف", "شقة"))
    assert row["property_type"] == "Apartment"
    showroom = _post()
    showroom["title"]["rendered"] = "برج الدبل (معرض)"            # live: tagged مكاتب, titled معرض
    assert R.map_property(showroom, R.parse_page(PAGE.replace("STATUS", "للإيجار")), ["تجاري", "مكاتب"]) \
        == (None, "type_title_conflict")


def test_a_district_only_contained_in_an_address_segment_is_not_the_district():
    (row, _), _ = _map(REAL_HOMES_property_address="الخُبر - بحيرة الشبيلي")
    assert row["district_ar"] is None and row["neighborhood"] is None     # a lake, not حي البحيرة


def test_the_owner_and_any_phone_never_reach_a_row():
    (row, _), _ = _map()
    blob = repr(row)
    assert "0551234567" not in blob and "خالد المالك" not in blob
    assert "owner" not in repr(row["source_capture"]["meta"])
