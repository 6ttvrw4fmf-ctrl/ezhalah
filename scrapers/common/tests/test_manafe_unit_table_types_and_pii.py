"""Manafe: one listing per available-unit row; the form-default «معارض تجارية» unit type never overrules the
building's purpose; no period is printed so none is invented; «0 ر.س» is the source's no-price; a sale building
is ONE listing at its one printed price; unlicensed pages are skipped; phones/e-mail are never stored."""
import json

import pytest

import scrapers.manafe.run as R
from scrapers.common import db


@pytest.fixture(autouse=True)
def _catalog(monkeypatch):
    monkeypatch.setattr(R, "to_catalog", lambda c, region_hint=None: (18, 2) if c else (None, None))
    monkeypatch.setattr(R, "find_district_in_text", lambda t, cid: t)


def _row(name, typ, rooms, price, area=""):
    # the real table carries a commented-out <td> pair inside each row
    return (f"<tr><td>{name}</td><td> {typ}</td><td>{rooms}</td><td>1</td><td>1</td><td>1</td><td>0</td>"
            f"<td>0</td><td>0</td><td>{area}</td><!--  <td>< ?= $project[\"leng1\"]; ?></td> --><td>{price}</td></tr>")


def _page(*, licence="7200935018", section="العمائر", purpose="شقق للإيجار", rows=None):
    rows = [_row("شقة 1", "شقة", 2, "18000 ر.س")] if rows is None else rows
    lic = (f'<tr><td style="x"> رقم الترخيص الإعلاني : </td><td style="y"> {licence} </td></tr>' if licence else "")
    return f"""<h1 class="mt-4"> عقار 360 </h1><table>{lic}</table>
    <img alt="Porto" src="https://manafe.com.sa/admin/upfile/main/1x/logo.png">
    <img alt="Property Detail" src="
        https://manafe.com.sa/admin/upfile/old/file1.jpg" class="img-fluid">
    <img alt="Property Detail" src="https://manafe.com.saß//public/imgs/main/1x/photo-building.jpg">
    <table><tr><td> عدد الواحدات </td><td> 24 </td></tr><tr><td> عدد المشاهدات </td><td> 172 </td></tr>
    <tr><td> القسم العقاري </td><td> {section} </td></tr><tr><td> الغرض العقاري </td><td> {purpose} </td></tr>
    <tr><td>  اسم المعلن وصفته </td><td> مفوض </td></tr>
    <tr><td> المدينة </td><td> جدة </td></tr><tr><td> الحي </td><td> الصفا </td></tr>
    <tr><td> العنوان </td><td> على شارع إبراهيم الخزامي </td></tr></table>
    بيانات التواصل : 0535454228 marketing@manafeco.com
    <table><tr><td colspan="12">الوحده/الوحدات المتاحة</td></tr><tr><th>الوحدة</th></tr>{''.join(rows)}</table>
    <h4 class="mt-3 mb-3">المواصفات </h4><ul class="list"><li><i></i> مصعد </li><li><i></i> اتصل 0555555555 </li></ul>
    <iframe src="https://www.google.com/maps/embed?pb=!1m18!2d39.2087!3d21.5704!2m3"></iframe>"""


def _map(**kw):
    return R.map_building(R.parse_building(8, _page(**kw)))


def test_page_kinds_tell_a_missing_id_from_a_host_error():
    assert R.page_kind(_page()) == "real"
    assert R.page_kind(_page(licence=None)) == "real"          # the licence row is only printed when there is one
    assert R.page_kind("<h1>Notice : Trying to access array offset on value of type null in x</h1>"
                       " القسم العقاري الوحده/الوحدات المتاحة") == "missing"
    assert R.page_kind("<b>Fatal error</b>: Uncaught PDOException: SQLSTATE[HY000] [2002]") == "unreadable"
    assert R.page_kind("<title>Just a moment...</title>") == "unreadable"


def test_a_rent_unit_keeps_its_price_verbatim_and_a_silent_page_is_annual():
    [((row, cat), why)] = _map()
    assert why == "" and cat == "residential" and row["property_type"] == "Apartment"
    assert (row["rent_period"], row["price_annual"]) == ("annual", 18000)   # owner attestation 2026-09-28
    assert row["ad_number"] == "MNF8-1" and row["listing_url"].endswith("/manafemar/project/8")
    assert row["license_number"] == "7200935018" and row["bedrooms"] == 2 and row["area_m2"] is None
    assert row["maid_room"] is None                                      # a form 0 is silence, not «no»
    assert row["photo_urls"] == ["https://manafe.com.sa/admin/upfile/old/file1.jpg"]   # no logo, no placeholder
    assert row["district_ar"] == "حي الصفا" and row["neighborhood"] == "الصفا"


def test_a_small_price_is_still_annual_here_and_the_zero_price():
    [((low, _), _), ((zero, _), _)] = _map(rows=[_row("1", "شقة", 1, "6000 ر.س"), _row("2", "شقة", 3, "0 ر.س")])
    # this company prices yearly (its own Aqar cross-post), so the shared ≤10,000-looks-monthly rule does NOT apply
    assert (low["rent_period"], low["price_annual"]) == ("annual", 6000)
    assert zero["price_annual"] is db.AUTHORITATIVE_NULL and zero["price_evidence"]["authoritative_absent"]


def test_the_form_default_showroom_type_never_overrules_the_purpose():
    [((row, cat), _)] = _map(rows=[_row("", "معارض تجارية", 3, "15000 ر.س")])
    assert (row["property_type"], cat) == ("Apartment", "residential")
    [((row, cat), _)] = _map(section="المستودعات", purpose="مستودعات للإيجار",
                             rows=[_row("مستودع", "معارض تجارية", 4, "120000 ر.س", "450")])
    assert (row["property_type"], cat, row["area_m2"]) == ("Warehouse", "commercial", 450.0)


def test_a_unit_type_that_contradicts_the_purpose_is_skipped_not_guessed():
    [(got, why)] = _map(rows=[_row("4", "مكاتب آدارية", 1, "7200 ر.س")])
    assert got is None and why == "type_conflict_مكاتب آدارية_vs_شقق للإيجار"
    [((row, _), _)] = _map(rows=[_row("فيلا 1", "فلل دوبلكس", 8, "120000 ر.س")])   # same category → the unit wins
    assert row["property_type"] == "Villa"


def test_unlicensed_and_empty_buildings_are_counted_skips():
    assert _map(licence=None, rows=[_row("1", "شقة", 2, "1 ر.س")] * 2) == [(None, "no_rega_ad_licence")] * 2
    assert _map(licence="000000000") == [(None, "no_rega_ad_licence")]        # a placeholder is no licence
    assert _map(rows=[]) == [(None, "no_available_units")]


def test_a_sale_building_is_one_listing_at_its_one_printed_price():
    rows = [_row("1 شقة", "شقة", 2, "9000000 ر.س"), _row("5 معارض", "معارض تجارية", 5, "9000000 ر.س")]
    [((row, cat), _)] = _map(purpose="عقارات للبيع", rows=rows)
    assert (row["ad_number"], row["property_type"], cat) == ("MNF8", "Building", "residential")
    assert (row["transaction_type"], row["price_total"]) == ("Buy", 9000000)
    assert len(row["additional_info"]["composition"]) == 2 and row["bedrooms"] is None
    [((row, _), _)] = _map(purpose="عقارات للبيع", rows=rows[:1] + [_row("2", "شقة", 3, "8000000 ر.س")])
    assert row.get("price_total") is None and row["additional_info"]["price_text"] == "8000000 ر.س / 9000000 ر.س"


def test_phones_email_and_the_advertiser_capacity_are_never_stored():
    [((row, _), _)] = _map()
    blob = json.dumps(row, ensure_ascii=False, default=str)
    assert "0535454228" not in blob and "0555555555" not in blob and "manafeco" not in blob and "مفوض" not in blob
    assert row["elevator"] is True


def test_the_index_counters_declare_the_sections():
    idx = ('<strong data-to="185">185</strong>\n  <label>العمائر</label> '
           '<strong data-to="3">3</strong><label>المستودعات</label>')
    assert R.declared_counts(idx) == {"العمائر": 185, "المستودعات": 3}


def test_a_period_the_page_ties_to_the_price_still_wins():
    # the unit's own name is part of the text the period is read from
    [((row, _), _)] = _map(rows=[_row("شقة 1 إيجار شهري 2000", "شقة", 2, "2000 ر.س")])
    assert (row["rent_period"], row["price_annual"]) == ("monthly", 24000)
