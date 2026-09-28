"""AlBukairi: the type comes from the site's own «نوع العقار» filter (the page never prints one), never from
the marketing title; no published price → NULL; the deed bounds give a facade only when ONE side is a street;
the deed number and phone numbers are never stored. Fixtures are the live page's markup (2026-09-27), trimmed."""
import json

import pytest

import scrapers.albukaeri.run as R


@pytest.fixture(autouse=True)
def _catalog(monkeypatch):
    monkeypatch.setattr(R, "to_catalog", lambda c, region_hint=None: {"الخبر": (31, 5), "الدمام": (13, 5)}.get(c, (None, None)))
    # the shared resolver matches one word of «العزيزية - العقيق»
    monkeypatch.setattr(R, "find_district_in_text",
                        lambda t, cid: "حي العقيق" if "العقيق" in t else ("حي الأثير" if "الأثير" in t else None))


def _page(*, title="أرض استثمارية", loc="الخبر · حي العزيزية", price="",
          bounds=(("شمالاً", "قطعة رقم 10 بطول 116.06 م"), ("شرقاً", "البحر + قطعة رملية بطول 21.68 م"),
                  ("جنوباً", "قطعة رقم 12 بطول 102.3 م"), ("غرباً", "شارع عرض 10 م بطول 45.24 م")),
          stats=(("المساحة", "3495 <small>م²</small>"),), features=(), gallery=("/uploads/gallery-1.jpeg",),
          desc="أرض شاليه فضاء بموقع استثنائي على البحر مباشرة"):
    hero = "".join(f'<div class="hero-stat"><span class="hero-stat-label">{k}</span>\n'
                   f'<span class="hero-stat-value">{v}</span></div>' for k, v in
                   ((("السعر", price),) if price else ()) + tuple(stats))
    tiles = "".join(f'<div class="feature-tile"><span class="ft-num">{n}</span><span class="ft-lbl">{k}</span></div>'
                    for k, n in features)
    gal = "".join(f'<div class="swiper-slide"><img photo-swipe class="x" data-img="{g}" src="{g}" /></div>' for g in gallery)
    bl = "".join(f'<div class="bounds-list-item"><span class="bli-tag">{k}</span><span class="bli-text">{v}</span></div>'
                 for k, v in bounds)
    return f"""<meta property="og:image" content="https://albukaeri.sa/uploads/thumbImage-9.png">
<div class="prop-hero-location"><svg></svg><span>{loc}</span></div>
<h1 class="prop-hero-title">{title}</h1><p class="prop-hero-street">BK-018</p>
<div class="prop-hero-stats">{hero}</div>
<!-- #gallery -->{gal}<!-- ##gallery -->
<div class="prop-description-body">{desc}</div>{tiles}
<div class="bounds-list">{bl}</div>
<ul class="side-info-list no-ul"><li><span class="sil-label">المساحة</span><span class="sil-value">3495 م²</span></li>
<li><span class="sil-label">رقم الصك</span><span class="sil-value">330136003872</span></li>
<li><span class="sil-label">رقم المخطط</span><span class="sil-value">406 / 2</span></li>
<li><span class="sil-label">رقم القطعة</span><span class="sil-value">11</span></li>
<li><span class="sil-label">رقم البلك</span><span class="sil-value">  لا يوجد</span></li>
<li><span class="sil-label">رقم عقد الوساطة</span><span class="sil-value">6200841352</span></li></ul>
<a class="btn" href="https://wa.me/966505825075?text=x">واتساب</a>
<h2>عقارات مشابهة</h2><div class="prp-card"><span class="prp-card-price">1,000,000</span>
<div class="bounds-list-item"><span class="bli-tag">شرقاً</span><span class="bli-text">شارع عرض 60 م</span></div></div>"""


def _map(type_ar="أرض تجارية", **kw):
    return R.map_page(R.parse_page("6aa543f3c9a6ea5730d10c42", _page(**kw)), type_ar)


def test_the_filter_type_wins_over_the_marketing_title():
    (row, cat), why = _map("أرض تجارية", title="أرض استثمارية")
    assert why == "" and row["property_type"] == "Commercial Land" and cat == "commercial"
    (row, cat), _ = _map("شقة سكنية", title="دوبلكس الأحساء")
    assert row["property_type"] == "Apartment" and cat == "residential"


@pytest.mark.parametrize("type_ar,ptype", [
    ("أرض تجارية سكنية", "Commercial Land"),     # owner 2026-09-27: mixed-use land = Commercial Land
    ("أرض سكنية", "Residential Land"), ("أرض فضاء", "Residential Land"), ("أرض زراعية", "Farm"),
    ("فيلا سكنية", "Villa"), ("مبنى تجاري", "Commercial Building"), ("منتجع", "Resort"),
])
def test_the_sites_types_map_only_to_their_literal_meaning(type_ar, ptype):
    assert _map(type_ar)[0][0]["property_type"] == ptype


@pytest.mark.parametrize("type_ar", ["عمارة سكنية تجارية", "قصر تجاري سكني", "وحدة سكنية", None])
def test_a_type_with_no_single_meaning_is_skipped_never_guessed(type_ar):
    assert _map(type_ar) == (None, f"type_unmapped_{type_ar or 'none'}")


def test_an_auction_or_sold_title_is_skipped():
    assert _map(title="مزاد أرض تجارية") == (None, "not_available_or_auction")
    assert _map(title="أرض تجارية - تم البيع") == (None, "not_available_or_auction")


def test_no_published_price_is_null_and_a_published_one_is_verbatim():
    (row, _), _ = _map()
    assert row["price_total"] is None and row["price_evidence"]["authoritative_absent"] is True
    (row, _), _ = _map("شقة سكنية", price="850,000 <small>ر.س</small>")
    assert row["price_total"] == 850000 and row["transaction_type"] == "Buy"
    assert "price_per_meter" not in row and "price_annual" not in row


def test_one_street_side_is_the_facade_a_corner_is_not():
    (row, _), _ = _map()
    assert row["direction"] == "غرب" and row["street_width_m"] == 10
    corner = (("شمالاً", "شارع عرض 20 متر بطول 100 متر"), ("شرقاً", "شارع عرض 25 متر بطول 98 متر"),
              ("جنوباً", "قطعة رقم 52"), ("غرباً", "قطعة رقم 53"))
    (row, _), _ = _map(bounds=corner)
    assert row["direction"] is None and row["street_width_m"] is None
    assert row["additional_info"]["bounds"]["شمالاً"].startswith("شارع عرض 20")


def test_rooms_count_as_bedrooms_only_in_a_dwelling():
    kw = {"stats": (("المساحة", "402 م²"), ("الغرف", "5"), ("دورات المياه", "6")),
          "features": (("مجلس", "1"), ("صالة", "1"), ("مطبخ", "1"), ("كراج", "1"))}
    (row, _), _ = _map("فيلا سكنية", **kw)
    assert (row["bedrooms"], row["bathrooms"], row["halls"], row["reception_rooms_majlis"]) == (5, 6, 1, 1)
    assert row["kitchen"] is True and row["parking"] is True
    (row, _), _ = _map("مبنى تجاري", **kw)
    assert "bedrooms" not in row


def test_a_district_is_the_whole_name_or_nothing():
    (row, _), _ = _map(loc="الخبر · العزيزية - العقيق")
    assert row["district_ar"] is None and row["neighborhood"] == "العزيزية - العقيق" and row["city_id"] == 31
    (row, _), _ = _map(loc="الدمام · الأثير")
    assert row["district_ar"] == "حي الأثير"


def test_the_deed_number_and_phones_are_never_stored_and_the_similar_rail_is_ignored():
    (row, _), _ = _map(desc="للتواصل 0505825075 أرض على البحر")
    blob = json.dumps(row, ensure_ascii=False)
    assert "330136003872" not in blob                         # «رقم الصك»
    assert "0505825075" not in blob and "966505825075" not in blob
    assert row["plan_parcel"] == "مخطط 406 / 2 · قطعة 11"      # «بلك لا يوجد» is no block
    assert row["additional_info"]["rega_mediation_contract_number"] == "6200841352"
    assert row["photo_urls"] == ["https://albukaeri.sa/uploads/gallery-1.jpeg"]
    assert row["additional_info"]["bounds"]["شرقاً"] == "البحر + قطعة رملية بطول 21.68 م"   # not the similar-ads rail
    (row, _), _ = _map(gallery=())
    assert row["photo_urls"] == ["https://albukaeri.sa/uploads/thumbImage-9.png"]   # its own card photo


# ── the «بيانات رخصة الإعلان» block (live /property/6a4f82d6306e73ab4e053c58, 2026-09-28) ─────────────
_LICENCE = """<section><h2 class="prop-card-title">بيانات رخصة الإعلان</h2><div class="license-rows">
<div class="license-row"><span class="lr-label">رخصة الإعلان</span><span class="lr-value">7201032695</span></div>
<div class="license-row"><span class="lr-label">تاريخ الإصدار</span><span class="lr-value" data-fmt-date="Tue Jul 07 2026 00:00:00 GMT+0000 (Coordinated Universal Time)"></span></div>
<div class="license-row"><span class="lr-label">تاريخ النهاية</span><span class="lr-value" data-fmt-date="Sat Aug 15 2026 00:00:00 GMT+0000 (Coordinated Universal Time)"></span></div>
</div></section>"""


def test_the_ad_licence_block_is_stored_with_its_end_date():
    page = _page().replace("<h2>عقارات مشابهة</h2>", _LICENCE + "<h2>عقارات مشابهة</h2>")   # as live: before the rail
    row = R.map_page(R.parse_page("6a4f82d6306e73ab4e053c58", page), "شقة سكنية")[0][0]
    assert row["license_number"] == "7201032695" and row["license_expiry"] == "2026-08-15"


def test_a_page_without_the_block_claims_no_licence():
    row = R.map_page(R.parse_page("6aa543f3c9a6ea5730d10c42", _page()), "شقة سكنية")[0][0]
    assert "license_number" not in row and "license_expiry" not in row
