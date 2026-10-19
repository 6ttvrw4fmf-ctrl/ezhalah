"""Wajaf: «الحد» has no unit, «السوم» is a buyer's offer (never the price), a per-m² rate is only what the
site's own «سعر المتر» cell states; sold/let/«استثمار»/two-type ads and subdivision containers are skipped.
Fixtures are the live page's markup (2026-09-27), trimmed."""
import json

import pytest

import scrapers.wajaf.run as R


@pytest.fixture(autouse=True)
def _catalog(monkeypatch):
    monkeypatch.setattr(R, "to_catalog", lambda c, region_hint=None: (11, 4) if c == "بريدة" else (None, None))
    # the shared resolver's 1-word window: «حي الحمر الشمالي» comes back as «حي الحمر»
    monkeypatch.setattr(R, "find_district_in_text",
                        lambda t, cid: "حي الحمر" if "الحمر" in t else ("حي الربوة" if "الربوة" in t else None))


def _page(*, title="أرض تجارية.. حي الربوة.. للبيع", loc="بريدة،الربوة", deal="بيع", status="متاح",
          type_ar="أرض تجارية", limit="1000 <span class=\"riyali-text\">R</span>", soum="لا يوجد",
          width="15 م", area="3036.75 م²", ppm="لا يوجد", desc="أرض تجارية تقع على طريق الملك خالد",
          unit=False, siblings=(), facades=()):
    badge = "cbadge" if unit else "s-badge-secondary"
    fac = ("<h4 class=\"title fz17 mb30\">الواجهات</h4>"
           + "".join(f"<div><h6 class=\" mb-0\">{f}</h6></div>" for f in facades)) if facades else ""
    sib = "".join(f'<a href="https://wajaf.sa/properties/4/unit/{u}">قطعة {u}</a>'
                  f'<span class="cbadge" style="x">مباع</span>' for u in siblings)
    return f"""<div class="item"><img class="bdrs12" src="https://wajaf.sa/public/storage/items/a.jpg" alt=""></div>
<div class="item"><img class="bdrs12" src="https://wajaf.sa/public/storage/units/b.webp" alt=""></div>
<h2 class="sp-lg-title ">{title}</h2>
<span class="material-symbols-outlined">distance</span><span>{loc}، 008001653</span>
<a class="ff-heading text-thm fz15" href=""><span style="color:black">{deal}</span></a>
<a class="ff-heading" href="#"><span class="{badge}" style="x">{status}</span></a>
<a class="ff-heading" href="#"><span class="s-badge-secondary" style="x">{type_ar}</span></a>
<a data-content="للتواصل *رقم الجوال:* 0539010777 *البريد الالكتروني:* info@wajaf.sa"></a>
<h3 class="price  mb-0">الحد 1000</h3>
<h4 class="title fz17 mb30">نظرة عامة</h4><p class="text mb10"><p>{desc}</p></p>
<h4 class="title fz17 mb30 mt50">عرض التفاصيل</h4>
<div class="pd-list"><p class="fw600">معرف الإعلان</p><p class="fw600">نوع العقار</p><p class="fw600">صفة المُعلِن
</p><p class="fw600">حد / سعر نهائي
</p><p class="fw600">السوم</p></div>
<div class="pd-list"><p class="text">2766</p><p class="text">{type_ar}</p><p class="text">مفوض</p>
<p class="text">{limit}</p><p class="text mb-0">{soum}</p></div>
<div class="pd-list"><p class="fw600">عرض الشارع</p><p class="fw600">المساحة</p><p class="fw600">سعر المتر
</p><p class="fw600">رقم الإعلان</p></div>
<div class="pd-list"><p class="text">{width}</p><p class="text">{area}</p><p class="text">{ppm}</p><p class="text"></p></div>
{fac}<h4 class="title">الأماكن القريبة</h4>{sib}
<iframe src="https://maps.google.com/maps?q=26.352498,,43.971493&output=embed"></iframe>"""


def _map(url="https://wajaf.sa/properties/2766", **kw):
    return R.map_page(R.parse_page(url, _page(**kw)))


def test_a_limit_the_site_also_states_per_metre_is_a_per_metre_price_never_a_total():
    (row, cat), why = _map(ppm="1000 <span class=\"riyali-text\">R</span>")
    assert why == "" and cat == "commercial" and row["property_type"] == "Commercial Land"
    assert row["price_per_meter"] == 1000 and row["price_total"] is None
    assert row["price_evidence"]["unit"] == "per_meter"


def test_a_bare_limit_on_land_has_no_unit_so_no_price_is_claimed():
    # 2766 live: «الحد 1000» on 3036.75 m², «سعر المتر: لا يوجد» — 1000 is not a total, and not stated per m²
    (row, _), _ = _map()
    assert row["price_total"] is None and row["price_per_meter"] is None
    assert row["additional_info"]["price_note"] == "land_limit_unit_unstated"
    assert "1000" in row["additional_info"]["price_text"]


def test_a_limit_and_a_per_metre_cell_that_disagree_are_two_prices_not_one():
    (row, _), _ = _map(limit="850.00 R", ppm="900 R")          # unit 43 live
    assert row["price_total"] is None and row["price_per_meter"] is None
    assert row["additional_info"]["price_note"] == "limit_and_per_metre_disagree"


def test_the_soum_is_a_buyers_offer_and_never_the_price():
    (row, _), _ = _map(limit="لا يوجد حد", soum="950 <span class=\"riyali-text\">R</span>")   # 7940 live
    assert row["price_total"] is None and row["price_per_meter"] is None
    assert row["additional_info"]["soum"] == 950
    assert row["price_evidence"]["authoritative_absent"] is True


def test_a_buildings_final_price_is_its_total():
    (row, cat), _ = _map(title="ورشة مصنعية.. للبيع", type_ar="مستودعات", limit="1700000 R", area="700 م²")
    assert cat == "commercial" and row["property_type"] == "Warehouse"
    assert row["price_total"] == 1700000 and row["price_per_meter"] is None


def test_rent_period_comes_from_the_ad_never_a_hard_coded_year():
    (row, _), _ = _map(title="مستودع للايجار", deal="إيجار", type_ar="مستودعات", limit="180000 R")
    assert row["transaction_type"] == "Rent" and row["price_annual"] == 180000 and row["rent_period"] is None
    (row, _), _ = _map(title="مكاتب إدارية.. للايجار", deal="إيجار", type_ar="مكاتب إدارية", limit="4500 R")
    assert row["property_type"] == "Office" and row["rent_period"] == "monthly" and row["price_annual"] == 54000


@pytest.mark.parametrize("kw,why", [
    ({"status": "مباع"}, "status_مباع"),
    ({"status": "مؤجر جزئي", "deal": "إيجار"}, "status_مؤجر جزئي"),
    ({"status": "محجوز"}, "status_محجوز"),
    ({"deal": "استثمار"}, "deal_unmapped_استثمار"),
    ({"type_ar": "شاليه / استراحة"}, "type_unmapped_شاليه / استراحة"),
    ({"type_ar": "وحدة سكنية"}, "type_unmapped_وحدة سكنية"),
    ({"siblings": (5, 6)}, "project_container"),
])
def test_what_is_not_a_ready_single_listing_is_skipped_with_a_reason(kw, why):
    assert _map(**kw) == (None, why)


def test_a_unit_page_is_a_listing_even_though_it_lists_its_siblings():
    url = "https://wajaf.sa/properties/4/unit/5"
    (row, cat), why = _map(url=url, unit=True, siblings=(1, 2), type_ar="أرض سكنية", limit="850.00 R", ppm="850 R",
                           loc="بريدة،الحمر", facades=("غرب",))
    assert why == "" and cat == "residential" and row["property_type"] == "Residential Land"
    assert row["ad_number"] == "WJFU5" and row["listing_url"] == url and row["price_per_meter"] == 850
    assert row["direction"] == "غرب" and row["street_width_m"] == 15
    assert row["additional_info"]["project_url"] == "https://wajaf.sa/properties/4"
    # a unit prints its status as «cbadge»: a SOLD unit must not pass as «متاح» on its type badge
    assert _map(url=url, unit=True, status="مباع") == (None, "status_مباع")


def test_a_district_is_the_whole_name_or_nothing():
    (row, _), _ = _map(loc="بريدة،الحمر الشمالي")
    assert row["district_ar"] is None and row["neighborhood"] == "الحمر الشمالي"
    (row, _), _ = _map(loc="بريدة،الربوة")
    assert row["district_ar"] == "حي الربوة" and row["city_id"] == 11


def test_no_phone_email_or_unlabelled_address_number_is_stored():
    (row, _), _ = _map(desc="أرض مميزة للتواصل 0539010777 أو info@wajaf.sa")
    blob = json.dumps(row, ensure_ascii=False)
    assert "0539010777" not in blob and "info@wajaf.sa" not in blob
    assert "008001653" not in blob            # «بريدة،الحمر، 008001653» — maybe a deed/plan number
    assert row["photo_urls"] == ["https://wajaf.sa/public/storage/items/a.jpg",
                                 "https://wajaf.sa/public/storage/units/b.webp"]
