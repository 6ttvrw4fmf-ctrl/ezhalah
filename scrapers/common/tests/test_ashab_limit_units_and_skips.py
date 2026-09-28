"""Ashab (ashab.sa): «الحد» is the ad's price and «السوم» never is; a multi-unit ad is one listing per
AVAILABLE unit priced from the unit's OWN header (its «الحد» row is the building's, copied); rented /
auction / «استثمار» / unresolvable combined types are skipped; no contact detail is ever stored.
Fixtures reproduce the live page shapes measured 2026-09-27 (/properties/637943, 103128, 822470)."""
import json

import pytest

import scrapers.ashab.run as R


@pytest.fixture(autouse=True)
def _catalog(monkeypatch):
    monkeypatch.setattr(R, "to_catalog", lambda c, region_hint=None: (11, 4) if c == "بريدة" else (None, None))
    monkeypatch.setattr(R, "find_district_in_text", lambda t, cid: t if t in ("حي الرمال", "حي الأخضر") else None)


def _spec(label, value):
    return (f'<div class="d-flex flex-column flex-grow-1"><a class="text-dark-75 text-hover-primary mb-1 '
            f'font-size-lg font-weight-bolder">{label}</a>\n <span class="text-muted ">{value}</span></div>')


def _page(*, deal="إيجار", status="متاح", title="وحدة علوية", loc="بريدة،الرمال", header="الحد 20000 ر.س",
          type_ar="شقة علوية", limit="الحد 20000 ر.س", offer="لا يوجد", ppm="لا يوجد", area="لا يوجد",
          licence="7201126713", desc="وحدة علوية بموقع مميز", units="", similar="", unit_page=False):
    tag = "strong" if unit_page else "b"
    limit_cell = (f'<div class="d-flex flex-column flex-grow-1"><a class="text-dark-75 text-hover-primary mb-1 '
                  f'font-size-lg font-weight-bolder">حد / سعر نهائي</a>\n {limit}\n </div>')
    return f"""<html><body><header>… 920000720 info@ashab.sa</header><main id="ts-main">
<section id="page-title"><div class="ts-title mb-0 mt-5">
 <span class="badge" style="background-color:#adadad">{deal}</span>
 <span class="badge" style="background-color:#8da83e">{status}</span>
 <{tag} class="d-flex align-items-center my-3" style="font-weight:bolder">{title}
   <span class="material-symbols-outlined text-primary">verified_user</span></{tag}>
 <h6><span class="material-symbols-outlined text-primary">location_on</span>
 <span>{loc}</span></h6>
 <h6><span class="material-symbols-outlined text-primary">tag</span><span>رقم الإعلان 2070</span></h6>
 </div>
 <!--Price-->
 <h4 class="mt-4 limit-test" style="text-align: right"><span></span><br>{header}</h4>
</section>
<section id="gallery-carousel">
 <div class="slide"><div class="ts-image"
   data-bg-image="https://ashab.sa/public/storage/PunECmB2WAdfLBOeyX8eUJP6SVFvB94zuT0ZMoy3.jpg"></div></div>
</section>
<section id="content"><a href="tel:920000720">اتصل بنا</a>
<form><input name="mobile" placeholder="رقم الجوال"></form>
<section id="description" class="myP"><b>نظرة عامة</b><p><p>{desc}</p></p></section>
<div class="tab-pane" id="specification">
 <h5 class="mfp-property"><b>المرافق</b></h5>
 <p class="text-dark-75 text-hover-primary mb-1 font-size-lg font-weight-bolder">الغرف
   <span class="text-dark "><b>5</b></span></p>
 <p class="text-dark-75 text-hover-primary mb-1 font-size-lg font-weight-bolder">مدخل سيارة
   <span class="text-dark "><b>1</b></span></p>
 <h5 class="mfp-property"><b>الواجهات</b></h5>
 <p class="text-dark-75 text-hover-primary mb-1 font-size-lg font-weight-bolder">الشارع شمال
   <span class="text-dark"><b>15 م</b></span></p>
</div>
<div class="tab-pane" id="locationMap"><iframe src="https://maps.google.com/maps?q=26.3555,44.0047&t="></iframe></div>
<div class="tab-pane active" id="details">
 {_spec("معرف الإعلان", "637943")}{_spec("نوع العقار", type_ar)}{_spec("رخصة فال", "1200012840")}
 {_spec("صفة المُعلِن", "مفوض")}{limit_cell}{_spec("السوم", offer)}{_spec("عرض الشارع", "15 م")}
 {_spec("المساحة", area)}{_spec("سعر المتر", ppm)}{_spec("ترخيص الاعلان", licence)}
</div>
{units}
</section></main>
{similar}
<footer>عدد مشاهدات الوحدات العقارية 722.4K المزادات</footer></body></html>"""


def _card(status, unit_id):
    return (f'<div class="card ts-item ts-card"><span class="badge" style="width:30%">{status}</span>\n'
            f'<a href="https://ashab.sa/properties/1023/unit/{unit_id}" class="card-img"></a></div>')


def _map(**kw):
    unit_of = kw.pop("unit_of", None)
    return R.map_page(R.parse_page(_page(unit_page=bool(unit_of), **kw)), "637943",
                      "https://ashab.sa/properties/637943", unit_of=unit_of)


# ── price ────────────────────────────────────────────────────────────────────────────────────────
def test_the_limit_is_the_price_and_the_offer_never_is():
    (row, cat), why = _map(offer="80000 ر.س")
    assert why == "" and cat == "residential" and row["property_type"] == "Apartment"
    assert row["price_annual"] == 20000 and row["transaction_type"] == "Rent"
    assert row["additional_info"]["current_offer_text"] == "80000 ر.س"     # «السوم» kept as text only
    assert 80000 not in (row.get("price_total"), row.get("price_annual"))


def test_no_limit_is_no_price_and_the_period_is_never_hard_coded():
    (row, _), _ = _map(header="لا يوجد حد", limit="لا يوجد حد")
    assert row["price_annual"] is None and row["rent_period"] is None
    assert row["price_evidence"]["authoritative_absent"] is True
    (row, _), _ = _map()                       # 20000, no period word anywhere → unknown, not «annual»
    assert row["rent_period"] is None and row["price_annual"] == 20000
    (row, _), _ = _map(header="الحد 8500 ر.س", limit="الحد 8500 ر.س")   # the shared ≤10,000 rule
    assert row["rent_period"] == "monthly" and row["price_annual"] == 8500 * 12
    (row, _), _ = _map(header="الحد 8500 ر.س", limit="الحد 8500 ر.س",   # the ad's own words win
                       desc="الشقه الواحده 8500 سنوي")
    assert row["rent_period"] == "annual" and row["price_annual"] == 8500


def test_dot_grouped_limits_are_read_as_the_site_prints_them():
    (row, _), _ = _map(deal="بيع", type_ar="فيلا", header="الحد 4.500000 ر.س", limit="الحد 4.500000 ر.س")
    assert row["price_total"] == 4500000


def test_a_limit_equal_to_the_per_metre_price_is_per_metre_not_a_total():
    (row, cat), _ = _map(deal="بيع", type_ar="أرض سكنية", header="الحد 470 ر.س", limit="الحد 470 ر.س",
                         ppm="470 ر.س", area="319.61 م²")
    assert cat == "residential" and row["property_type"] == "Residential Land"
    assert row["price_total"] is None and row["price_per_meter"] == 470 and row["area_m2"] == 319.61
    assert row["price_evidence"]["unit"] == "per_meter"


def test_a_single_ad_with_two_prices_in_its_header_is_never_given_one():
    assert _map(header="السعر يبدأ من 10000 إلى 50000 ر.س") == (None, "price_range")


# ── multi-unit ads ─────────────────────────────────────────────────────────────────────────────────
def test_a_building_lists_its_units_and_a_unit_page_lists_none():
    units = ('<h6 class="mt-10"><b>الوحدات العقارية</b></h6>' + _card("مؤجر", 1080) + _card("متاح", 1081))
    b = R.parse_page(_page(header="السعر يبدأ من 0 إلى 15000 ر.س", units=units))
    assert [(st, uid) for st, _, uid in b["units"]] == [("مؤجر", "1080"), ("متاح", "1081")]
    # a unit page's «عقارات مشابهة» holds its SIBLINGS in the same card shape — never units of its own
    sib = '<section id="similar-properties"><h3>عقارات مشابهة</h3>' + _card("متاح", 1082) + "</section>"
    assert R.parse_page(_page(unit_page=True, similar=sib))["units"] == []


def test_a_unit_is_priced_from_its_own_header_never_the_buildings_limit():
    # live /properties/822470: building «الحد 44000»; its units print 22000 / 25000 and the copied limit
    (row, cat), why = _map(unit_of="822470", title="محل للايجار - محل 2", type_ar="معارض - محلات",
                           header="22000 ر.س", limit="الحد 44000 ر.س", area="75 م²", licence="")
    assert why == "" and cat == "commercial" and row["property_type"] == "Shop"
    assert row["price_annual"] == 22000 and row["area_m2"] == 75.0
    assert row["additional_info"]["building_limit_text"] == "الحد 44000 ر.س"
    assert row["additional_info"]["unit_of"] == "ASB822470"
    (row, _), _ = _map(unit_of="1", deal="بيع", type_ar="أرض سكنية", header="0 ر.س", ppm="3000 ر.س")
    assert row["price_total"] is None and row["price_per_meter"] == 3000       # «0 ر.س» is no price


def test_a_rented_unit_or_ad_is_skipped_with_its_reason():
    assert _map(status="مؤجر") == (None, "status_مؤجر")
    assert _map(unit_of="1", status="مباع", header="560000 ر.س") == (None, "status_مباع")


# ── skips ──────────────────────────────────────────────────────────────────────────────────────────
def test_auction_investment_and_unmapped_types_are_skipped_not_guessed():
    assert _map(desc="تباع بالمزاد العلني") == (None, "auction")
    assert _map(deal="استثمار") == (None, "deal_unmapped_استثمار")
    assert _map(type_ar="مخطط الفردوس") == (None, "type_unmapped_مخطط الفردوس")
    assert _map(type_ar="أخرى", title="حوش") == (None, "type_unmapped_أخرى")


def test_a_combined_type_bucket_is_resolved_only_by_the_listings_own_title():
    assert _map(type_ar="معارض - محلات", title="معرض للإيجار")[0][0]["property_type"] == "Showroom"
    assert _map(type_ar="معارض - محلات", title="محلات للايجار")[0][0]["property_type"] == "Shop"
    assert _map(type_ar="شاليه - استراحة", title="شاليه مسور")[0][0]["property_type"] == "Chalet"
    assert _map(type_ar="معارض - محلات", title="معارض تجارية - محل 11") == (
        None, "type_bucket_unresolved_معارض - محلات")                    # names both: never a coin flip
    assert _map(type_ar="معارض - محلات", title="صالة تجارية") == (None, "type_bucket_unresolved_معارض - محلات")


# ── PDPL + fidelity ─────────────────────────────────────────────────────────────────────────────────
def test_no_contact_or_advertiser_detail_is_ever_stored():
    (row, _), _ = _map(desc="للتواصل 0551234567 أو info@ashab.sa")
    blob = json.dumps(row, ensure_ascii=False)
    for pii in ("0551234567", "info@ashab.sa", "920000720", "مفوض", "صفة المُعلِن"):
        assert pii not in blob
    assert row["license_number"] == "7201126713" and row["additional_info"]["fal_licence"] == "1200012840"


def test_location_icons_photos_and_facts_come_from_the_page():
    (row, _), _ = _map(loc="بريدة،الرمال،ق/ب/6170")
    assert row["title"] == "وحدة علوية"                                   # the «verified_user» icon is not text
    assert row["city_id"] == 11 and row["district_ar"] == "حي الرمال" and row["plan_parcel"] == "ق/ب/6170"
    assert row["photo_urls"] == ["https://ashab.sa/public/storage/PunECmB2WAdfLBOeyX8eUJP6SVFvB94zuT0ZMoy3.jpg"]
    assert row["bedrooms"] == 5 and row["car_entrance"] is True and row["direction"] == "شمال"
    (row, _), _ = _map(loc="بريدة،ق/ب/6660")                              # a plan number is not a district
    assert row["neighborhood"] is None and row["district_ar"] is None and row["plan_parcel"] == "ق/ب/6660"


def test_a_land_sale_priced_below_any_possible_total_is_per_metre():
    # owner 2026-09-28: «الحد 500» on a 700 m² plot with «سعر المتر» blank — 500 is per m², never the plot's total
    (row, _), _ = _map(deal="بيع", type_ar="أرض سكنية", header="الحد 500 ر.س", limit="الحد 500 ر.س", area="700 م²")
    assert row["price_total"] is None and row["price_per_meter"] == 500
    assert row["price_evidence"]["unit"] == "per_meter"
    # a real total stays a total, and a villa is never touched
    (big, _), _ = _map(deal="بيع", type_ar="أرض سكنية", header="الحد 350000 ر.س", limit="الحد 350000 ر.س", area="700 م²")
    assert big["price_total"] == 350000 and big["price_per_meter"] is None
    (villa, _), _ = _map(deal="بيع", type_ar="فيلا", header="الحد 900 ر.س", limit="الحد 900 ر.س")
    assert villa["price_total"] == 900
