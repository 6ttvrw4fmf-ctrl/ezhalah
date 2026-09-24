"""1000 العقارية (1000.com.sa) — the traps this server-rendered site sets, each pinned to markup
copied VERBATIM from the live /offers page and /property/{id} pages on 2026-09-23. Trimming: the
inline <svg> icons, srcSet/sizes/style attributes and the card's contact block (never read) are cut;
every text node, class, href and src the code reads is byte-identical to what the site served.

Offline: the two catalog helpers are the only stubs.

Run: python3 -m pytest -q -p no:cacheprovider scrapers/common/tests/test_thousand_ssr_cards_and_traps.py
"""
from __future__ import annotations

import json
import sys
import types
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[3]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scrapers.thousand import run as R  # noqa: E402

_CITIES = {"الرياض": (3, 1), "الدمام": (13, 5)}
_DISTRICTS = {"الملقا": "حي الملقا", "العقيق": "حي العقيق", "القيروان": "حي القيروان"}


@pytest.fixture(autouse=True)
def _catalog(monkeypatch):
    monkeypatch.setattr(R, "to_catalog", lambda city_ar, region_hint=None: _CITIES.get(city_ar, (None, None)))
    monkeypatch.setattr(R, "find_district_in_text",
                        lambda text, city_id: next((v for k, v in _DISTRICTS.items() if k in (text or "")), None))


# ── VERBATIM CARDS (/offers, 2026-09-23) ────────────────────────────────────────────────────────
CARD_MONTHLY = '''<article class="card rv"><a class="card-main" href="/property/cmnh40o40000210i8x84ezr2n?source=estate"><div class="ph"><img alt="مشروع: 124 - وحدة 103 الجفال" loading="lazy" decoding="async" data-nimg="fill" src="https://images.unsplash.com/photo-1545324418-cc1a3fa10c00?auto=format&amp;fit=crop&amp;w=800&amp;q=80"/><div class="badges"><span class="chip gold">للإيجار</span><span class="chip">شقة</span></div></div><div class="body"><div class="top"><div><h3>مشروع: 124 - وحدة 103 الجفال</h3><div class="loc">الرياض، الملقا، وادي نوار</div></div><div class="price"><b class="num">6500</b><span>ريال / شهرياً</span></div></div><div class="feats"><span class="f">1 غرف</span><span class="f">1 دورات مياه</span><span class="f">صالة</span><span class="f">تراس</span><span class="f">مطبخ</span></div></div></a></article>'''
CARD_OFFICE = '''<article class="card rv"><a class="card-main" href="/property/cmnh40oc600fg10i8nnkq5txv?source=estate"><div class="ph"><img alt="مشروع: S16 - وحدة مكتب 201" loading="lazy" decoding="async" data-nimg="fill" src="https://images.unsplash.com/photo-1545324418-cc1a3fa10c00?auto=format&amp;fit=crop&amp;w=800&amp;q=80"/><div class="badges"><span class="chip gold">للإيجار</span><span class="chip">مكتب</span></div></div><div class="body"><div class="top"><div><h3>مشروع: S16 - وحدة مكتب 201</h3><div class="loc">الرياض، العقيق، الامام سعود بن فيصل</div></div><div class="price"><b class="num">185,000</b><span>ريال / سنوياً</span></div></div><div class="feats"><span class="f">0 غرف</span></div></div></a></article>'''
CARD_ON_REQUEST = '''<article class="card rv"><a class="card-main" href="/property/cmo44bibe003q5w1wk2y08vlc?source=estate"><div class="ph"><img alt="مشروع: A - 477 - وحدة 107" loading="lazy" decoding="async" data-nimg="fill" src="https://images.unsplash.com/photo-1545324418-cc1a3fa10c00?auto=format&amp;fit=crop&amp;w=800&amp;q=80"/><div class="badges"><span class="chip gold">للإيجار</span><span class="chip">شقة</span></div></div><div class="body"><div class="top"><div><h3>مشروع: A - 477 - وحدة 107</h3><div class="loc">الرياض - الازدهار</div></div><div class="price"><b class="num">السعر عند الطلب</b></div></div><div class="feats"><span class="f">1 غرف</span><span class="f">1 دورات مياه</span><span class="f">صالة</span></div></div></a></article>'''
CARD_AREA = '''<article class="card rv"><a class="card-main" href="/property/cmnh40obn00ef10i8d5y80hgd?source=estate"><div class="ph"><img alt="مشروع: S-13 - وحدة 101" loading="lazy" decoding="async" data-nimg="fill" src="https://images.unsplash.com/photo-1545324418-cc1a3fa10c00?auto=format&amp;fit=crop&amp;w=800&amp;q=80"/><div class="badges"><span class="chip gold">للإيجار</span><span class="chip">شقة</span></div></div><div class="body"><div class="top"><div><h3>مشروع: S-13 - وحدة 101</h3><div class="loc">الرياض، القيروان، الشيخ عبدالله بن جبرين</div></div><div class="price"><b class="num">السعر عند الطلب</b></div></div><div class="feats"><span class="f">4 غرف</span><span class="f">1 دورات مياه</span><span class="f">صالة</span><span class="f">120 م²</span></div></div></a></article>'''
CARD_AHAD = '''<article class="card rv"><a class="card-main" href="/property/cmo44biaq001i5w1wptjlreld?source=estate"><div class="ph"><img alt="مشروع: A - 613 - وحدة 301" loading="lazy" decoding="async" data-nimg="fill" src="https://images.unsplash.com/photo-1545324418-cc1a3fa10c00?auto=format&amp;fit=crop&amp;w=800&amp;q=80"/><div class="badges"><span class="chip gold">للإيجار</span><span class="chip">شقة</span></div></div><div class="body"><div class="top"><div><h3>مشروع: A - 613 - وحدة 301</h3><div class="loc">احد رفيده - الورود</div></div><div class="price"><b class="num">30000</b><span>ريال / سنوياً</span></div></div><div class="feats"><span class="f">2 غرف</span><span class="f">1 دورات مياه</span><span class="f">صالة</span></div></div></a></article>'''
CARD_UPLOAD = '''<article class="card"><a class="card-main" href="/property/cmnh40o7i006e10i8zkkbrkk1?source=estate"><div class="ph"><img alt="مشروع: S247 - وحدة 102" fetchPriority="high" decoding="async" data-nimg="fill" src="/uploads/1783614184753-n36litc2jm-medium.webp"/><div class="badges"><span class="chip gold">للإيجار</span><span class="chip">شقة</span></div></div><div class="body"><div class="top"><div><h3>مشروع: S247 - وحدة 102</h3><div class="loc">الرياض، القيروان، الشيخ عبدالله بن جبرين</div></div><div class="price"><b class="num">75,000</b><span>ريال / سنوياً</span></div></div><div class="feats"><span class="f">1 غرف</span><span class="f">1 دورات مياه</span><span class="f">صالة</span><span class="f">تراس</span><span class="f">مطبخ</span></div></div></a></article>'''

OFFERS = ('<html><body><section class="blk lst"><div class="wrap"><div class="rhead"><div class="cnt">'
          '<b class="num">105</b> وحدة متاحة</div></div><div class="grid">'
          + CARD_MONTHLY + CARD_OFFICE + CARD_ON_REQUEST + CARD_AREA + CARD_AHAD + CARD_UPLOAD
          + '</div></div></section></body></html>')

# ── VERBATIM DETAIL FRAGMENTS (/property/{id}, 2026-09-23) ──────────────────────────────────────
def _page(pid: str, frag: str) -> str:
    return (f'<html><body><main>{frag}<aside class="booking-contact"></aside>'
            f'<a class="cccall" href="tel:0538241000" data-listing-id="{pid}" data-listing-type="unit">اتصال</a>'
            f'</main></body></html>')


DETAIL_MONTHLY = _page("cmnh40o40000210i8x84ezr2n", '''<div class="gallery"><button type="button" class="gtile" aria-label="عرض الصورة 1 بالحجم الكامل"><img alt="مشروع: 124 - وحدة 103 الجفال" fetchPriority="high" decoding="async" data-nimg="fill" src="https://images.unsplash.com/photo-1545324418-cc1a3fa10c00?auto=format&amp;fit=crop&amp;w=800&amp;q=80"/></button></div><div class="dhead"><div class="dhead-main"><div class="badges"><span class="badge gold">للإيجار</span><span class="badge">شقة</span></div><h1>مشروع: 124 - وحدة 103 الجفال</h1><div class="loc">الرياض، الملقا، وادي نوار</div><p class="adlic" aria-label="رقم ترخيص الإعلان 7200951836"><span>رقم ترخيص الإعلان</span><b dir="ltr">7200951836</b></p></div><div class="dprice"><div><b class="num">6500</b> <span class="cur">ريال / شهرياً</span></div><div class="ptag">يشمل إدارة الوحدة والصيانة</div></div></div><div class="specs"><div class="spec"><b class="num">1</b><span>غرف نوم</span></div><div class="spec"><b class="num">1</b><span>دورات مياه</span></div></div><div class="layout"><div><div class="sec first"><h2>المواصفات</h2><div class="amen"><div class="a"><div class="ic"></div><span>الدور<!-- -->: <b>0</b></span></div><div class="a"><div class="ic"></div><span>صالة<!-- -->: <b>1</b></span></div><div class="a"><div class="ic"></div><span>تراس<!-- -->: <b>1</b></span></div><div class="a"><div class="ic"></div><span>المطبخ<!-- -->: <b>1</b></span></div></div></div><div class="sec"><h2>الوصف</h2><div class="desc-sec"><h3>تفاصيل الوحدة</h3><p class="desc-body">الوحدة رقم <bdi>103</bdi> الجفال (شقة) في الدور <bdi>0</bdi>. الشقة تضم غرفة نوم، دورة مياه، صالة، مطبخ، وتراس. متاحة للإيجار بسعر <bdi>6500</bdi> ريال شهرياً ضمن إدارة وصيانة كاملة من <bdi>1000</bdi> العقارية.</p></div><div class="desc-sec"><h3>نبذة عن المشروع</h3><p class="desc-body">✨ وحدات سكنية مؤثثة  للإيجار في  حي الملقا، الرياض
فرصة مميزة للسكن  في أحد مشاريع ألف العقارية ، حيث الجودة العالية، والموقع الاستراتيجي.
* الإيجار يبدأ من <bdi>4500</bdi> شهرياً
شامل الماء والكهرباء والإنترنت
التواصل:
                      <bdi>0538241000</bdi> (أسامه)
                      <bdi>0538451000</bdi> ( عبدالعزيز)
                      <bdi>0556831000</bdi> ( نايف)
شركة ألف العقارية</p></div><div class="desc-sec"><h3>الموقع والخدمات القريبة</h3><p class="desc-body">📍 موقع استثنائي
*تبعد عن مطار الملك خالد الدولي <bdi>20</bdi> دقيقة.</p></div><div class="desc-sec"><h3>مميزات المبنى</h3><p class="desc-body">مصعد - مواقف - دخول امني - كاميرات مراقبة.</p></div><div class="desc-sec"><h3>الخدمات المشمولة</h3><p class="desc-body">الصيانة الدورية - النظافة للمداخل والممرات.</p></div></div></div>''')

DETAIL_UPLOADS = _page("cmnh40od500hf10i8wa7gv7jh", '''<div class="gallery"><button type="button" class="gtile" aria-label="عرض الصورة 1 بالحجم الكامل"><img alt="مشروع: S-103 - وحدة 201" fetchPriority="high" decoding="async" data-nimg="fill" src="/uploads/1783436111061-oxwumkap1ei-medium.webp"/></button><button type="button" class="gtile" aria-label="عرض الصورة 2 بالحجم الكامل"><img alt="مشروع: S-103 - وحدة 201" loading="lazy" decoding="async" data-nimg="fill" src="/uploads/1783436112824-3r9ctwrnuuw-medium.webp"/></button><button type="button" class="gtile" aria-label="عرض الصورة 3 بالحجم الكامل"><img alt="مشروع: S-103 - وحدة 201" loading="lazy" decoding="async" data-nimg="fill" src="/uploads/1783436114537-5rckl9iwqwr-medium.webp"/><div class="more">+ <!-- -->2<!-- --> صورة</div></button></div><div class="dhead"><div class="dhead-main"><div class="badges"><span class="badge gold">للإيجار</span><span class="badge">شقة</span></div><h1>مشروع: S-103 - وحدة 201</h1><div class="loc">الرياض، العقيق، التحلية</div><p class="adlic" aria-label="رقم ترخيص الإعلان 7200869407"><span>رقم ترخيص الإعلان</span><b dir="ltr">7200869407</b></p></div><div class="dprice"><div><b class="num">7500</b> <span class="cur">ريال / شهرياً</span></div><div class="ptag">يشمل إدارة الوحدة والصيانة</div></div></div><div class="specs"><div class="spec"><b class="num">2</b><span>غرف نوم</span></div><div class="spec"><b class="num">2</b><span>دورات مياه</span></div></div><div class="layout"><div><div class="sec first"><h2>المواصفات</h2><div class="amen"><div class="a"><div class="ic"></div><span>الدور<!-- -->: <b>2</b></span></div><div class="a"><div class="ic"></div><span>صالة<!-- -->: <b>1</b></span></div><div class="a"><div class="ic"></div><span>المداخل<!-- -->: <b>1</b></span></div><div class="a"><div class="ic"></div><span>المطبخ<!-- -->: <b>نعم</b></span></div></div></div><div class="sec"><h2>الوصف</h2><div class="desc-sec"><h3>تفاصيل الوحدة</h3><p class="desc-body">شقة رقم <bdi>201</bdi> ضمن المشروع في الدور <bdi>2</bdi>. الشقة تضم <bdi>2</bdi> غرف نوم، <bdi>2</bdi> دورات مياه، صالة، مطبخ، ومدخل. متاحة للإيجار بقيمة <bdi>7500</bdi> ريال شهرياً ضمن إدارة وصيانة كاملة من <bdi>1000</bdi> العقارية.</p></div><div class="desc-sec"><h3>مميزات المبنى</h3><p class="desc-body">مصعد - مواقف - دخول امني - كاميرات مراقبة.</p></div></div></div>''')

DETAIL_OFFICE = _page("cmnh40oc600fg10i8nnkq5txv", '''<div class="gallery"><button type="button" class="gtile" aria-label="عرض الصورة 1 بالحجم الكامل"><img alt="مشروع: S16 - وحدة مكتب 201" fetchPriority="high" decoding="async" data-nimg="fill" src="https://images.unsplash.com/photo-1545324418-cc1a3fa10c00?auto=format&amp;fit=crop&amp;w=800&amp;q=80"/></button></div><div class="dhead"><div class="dhead-main"><div class="badges"><span class="badge gold">للإيجار</span><span class="badge">مكتب</span></div><h1>مشروع: S16 - وحدة مكتب 201</h1><div class="loc">الرياض، العقيق، الامام سعود بن فيصل</div></div><div class="dprice"><div><b class="num">185,000</b> <span class="cur">ريال / سنوياً</span></div><div class="ptag">يشمل إدارة الوحدة والصيانة</div></div></div><div class="specs"><div class="spec"><b class="num">0</b><span>غرف نوم</span></div><div class="spec"><b class="num">0</b><span>دورات مياه</span></div></div><div class="layout"><div><div class="sec"><h2>الوصف</h2><div class="desc-sec"><h3>تفاصيل الوحدة</h3><p class="desc-body">الوحدة رقم مكتب <bdi>201</bdi> (مكتب). متاح للإيجار بسعر <bdi>185,000</bdi> ريال سنوياً بإدارة وصيانة شاملة من <bdi>1000</bdi> العقارية.</p></div></div></div>''')

DETAIL_ON_REQUEST = _page("cmo44bibe003q5w1wk2y08vlc", '''<div class="gallery"><button type="button" class="gtile" aria-label="عرض الصورة 1 بالحجم الكامل"><img alt="مشروع: A - 477 - وحدة 107" fetchPriority="high" decoding="async" data-nimg="fill" src="https://images.unsplash.com/photo-1545324418-cc1a3fa10c00?auto=format&amp;fit=crop&amp;w=800&amp;q=80"/></button></div><div class="dhead"><div class="dhead-main"><div class="badges"><span class="badge gold">للإيجار</span><span class="badge">شقة</span></div><h1>مشروع: A - 477 - وحدة 107</h1><div class="loc">الرياض - الازدهار</div></div><div class="dprice"><div><b class="num">السعر عند الطلب</b></div><div class="ptag">يشمل إدارة الوحدة والصيانة</div></div></div><div class="specs"><div class="spec"><b class="num">1</b><span>غرف نوم</span></div><div class="spec"><b class="num">1</b><span>دورات مياه</span></div></div><div class="layout"><div><div class="sec first"><h2>المواصفات</h2><div class="amen"><div class="a"><div class="ic"></div><span>الدور<!-- -->: <b>1</b></span></div><div class="a"><div class="ic"></div><span>صالة<!-- -->: <b>1</b></span></div></div></div><div class="sec"><h2>الوصف</h2><div class="desc-sec"><h3>تفاصيل الوحدة</h3><p class="desc-body">شقة رقم <bdi>107</bdi> ضمن المشروع في الدور <bdi>1</bdi>. الشقة تضم غرفة نوم، دورة مياه، وصالة. متاحة للإيجار، السعر عند الطلب بإدارة وصيانة شاملة من <bdi>1000</bdi> العقارية.</p></div></div></div>''')

DETAILS = {"cmnh40o40000210i8x84ezr2n": DETAIL_MONTHLY, "cmnh40od500hf10i8wa7gv7jh": DETAIL_UPLOADS,
           "cmnh40oc600fg10i8nnkq5txv": DETAIL_OFFICE, "cmo44bibe003q5w1wk2y08vlc": DETAIL_ON_REQUEST}


def _cards():
    cards, total = R.parse_offers(OFFERS)
    return {c["pid"]: c for c in cards}, total


# ── THE OFFERS PAGE ─────────────────────────────────────────────────────────────────────────────
def test_every_card_and_the_sites_own_counter_are_read():
    cards, total = _cards()
    assert total == 105 and len(cards) == 6
    c = cards["cmnh40o40000210i8x84ezr2n"]
    assert c["title"] == "مشروع: 124 - وحدة 103 الجفال"
    assert c["chips"] == ["للإيجار", "شقة"] and c["loc"] == "الرياض، الملقا، وادي نوار"
    assert (c["price_num"], c["price_unit"]) == ("6500", "ريال / شهرياً")
    assert c["feats"] == ["1 غرف", "1 دورات مياه", "صالة", "تراس", "مطبخ"]
    on_request = cards["cmo44bibe003q5w1wk2y08vlc"]
    assert (on_request["price_num"], on_request["price_unit"]) == ("السعر عند الطلب", None)


# ── PRICE + PERIOD ──────────────────────────────────────────────────────────────────────────────
def test_monthly_is_annualised_from_the_sources_own_unit_text():
    cards, _ = _cards()
    row, cat, why = R.map_listing(cards["cmnh40o40000210i8x84ezr2n"], R.parse_detail(DETAIL_MONTHLY))
    assert why == "" and cat == "residential"
    assert (row["rent_period"], row["price_annual"], row["price_total"], row["price_per_meter"]) == (
        "monthly", 78000, None, None)


def test_annual_is_stored_verbatim():
    cards, _ = _cards()
    row, cat, _ = R.map_listing(cards["cmnh40oc600fg10i8nnkq5txv"], R.parse_detail(DETAIL_OFFICE))
    assert (row["rent_period"], row["price_annual"]) == ("annual", 185000)


def test_price_on_request_is_null_in_both_columns_and_the_phrase_is_kept():
    cards, _ = _cards()
    row, _, why = R.map_listing(cards["cmo44bibe003q5w1wk2y08vlc"], R.parse_detail(DETAIL_ON_REQUEST))
    assert why == ""
    assert (row["price_annual"], row["price_total"], row["rent_period"]) == (None, None, None)
    assert row["additional_info"]["price_note"] == "السعر عند الطلب"


# ── PHOTOS ──────────────────────────────────────────────────────────────────────────────────────
def test_the_sites_stock_cover_is_kept_as_the_listing_photo():
    # Owner decision 2026-09-24: the cover 1000.com.sa shows on the card (its Unsplash stock photo on
    # 86 of 105 listings) is what a visitor sees there, so it is the listing photo here too.
    cards, _ = _cards()
    row, _, _ = R.map_listing(cards["cmnh40o40000210i8x84ezr2n"], R.parse_detail(DETAIL_MONTHLY))
    assert row["photo_urls"] == ["https://images.unsplash.com/photo-1545324418-cc1a3fa10c00?auto=format&fit=crop&w=800&q=80"]


def test_site_hosted_uploads_are_absolute_and_kept():
    cards, _ = _cards()
    row, _, _ = R.map_listing(cards["cmnh40o40000210i8x84ezr2n"], R.parse_detail(DETAIL_UPLOADS))
    assert row["photo_urls"] == [
        "https://1000.com.sa/uploads/1783436111061-oxwumkap1ei-medium.webp",
        "https://1000.com.sa/uploads/1783436112824-3r9ctwrnuuw-medium.webp",
        "https://1000.com.sa/uploads/1783436114537-5rckl9iwqwr-medium.webp"]


def test_a_failed_detail_fetch_is_not_no_photos():
    cards, _ = _cards()
    row, _, _ = R.map_listing(cards["cmnh40o7i006e10i8zkkbrkk1"], None)
    assert row["photo_urls"] is None            # None → the no-clobber guard keeps a stored list


# ── TYPE / CATEGORY / ROOMS ─────────────────────────────────────────────────────────────────────
def test_an_office_is_commercial_and_its_zero_rooms_are_a_form_default():
    cards, _ = _cards()
    row, cat, _ = R.map_listing(cards["cmnh40oc600fg10i8nnkq5txv"], R.parse_detail(DETAIL_OFFICE))
    assert (row["property_type"], cat) == ("Office", "commercial")
    assert row["bedrooms"] is None and row["bathrooms"] is None
    assert "kitchen" not in row and "elevator" not in row


def test_bedrooms_come_from_the_detail_specs_on_a_dwelling():
    cards, _ = _cards()
    row, _, _ = R.map_listing(cards["cmnh40o40000210i8x84ezr2n"], R.parse_detail(DETAIL_UPLOADS))
    assert (row["bedrooms"], row["bathrooms"], row["floor_number"], row["halls"]) == (2, 2, 2, 1)


def test_area_is_read_from_the_one_card_that_prints_it():
    cards, _ = _cards()
    row, _, _ = R.map_listing(cards["cmnh40obn00ef10i8d5y80hgd"], R.parse_detail(DETAIL_ON_REQUEST))
    assert row["area_m2"] == 120


def test_an_unmappable_type_is_skipped_not_guessed():
    cards, _ = _cards()
    card = {**cards["cmnh40o40000210i8x84ezr2n"], "chips": ["للإيجار", "كرفان"]}   # documented edit
    row, _, why = R.map_listing(card, None)
    assert row is None and why == "type_unmapped"


def test_a_retired_badge_is_skipped():
    cards, _ = _cards()
    card = {**cards["cmnh40o40000210i8x84ezr2n"], "chips": ["مؤجر", "شقة"]}         # documented edit
    row, _, why = R.map_listing(card, None)
    assert row is None and why == "retired_or_auction"


# ── LOCATION ────────────────────────────────────────────────────────────────────────────────────
def test_the_comma_shape_yields_city_district_and_street():
    cards, _ = _cards()
    row, _, _ = R.map_listing(cards["cmnh40o40000210i8x84ezr2n"], R.parse_detail(DETAIL_MONTHLY))
    assert (row["city_ar"], row["city_id"], row["region_id"]) == ("الرياض", 3, 1)
    assert (row["neighborhood"], row["district_ar"]) == ("الملقا", "حي الملقا")
    assert row["additional_info"]["street"] == "وادي نوار"


def test_the_dash_shape_yields_city_and_district_only():
    cards, _ = _cards()
    row, _, _ = R.map_listing(cards["cmo44bibe003q5w1wk2y08vlc"], R.parse_detail(DETAIL_ON_REQUEST))
    assert (row["city_ar"], row["neighborhood"], row["district_ar"]) == ("الرياض", "الازدهار", None)
    assert "street" not in row["additional_info"]


def test_a_city_the_catalogue_cannot_place_is_skipped_not_defaulted():
    cards, _ = _cards()
    row, _, why = R.map_listing(cards["cmo44biaq001i5w1wptjlreld"], None)
    assert row is None and why == "city_not_in_catalog"


# ── ADVANCED-FILTER FACTS + PII ─────────────────────────────────────────────────────────────────
def test_licence_floor_halls_and_amenities_reach_their_columns():
    cards, _ = _cards()
    row, _, _ = R.map_listing(cards["cmnh40o40000210i8x84ezr2n"], R.parse_detail(DETAIL_MONTHLY))
    assert row["license_number"] == "7200951836"
    assert (row["floor_number"], row["halls"]) == (0, 1)                 # ground floor is a real 0
    assert (row["kitchen"], row["balcony_terrace"]) == (True, True)
    assert (row["elevator"], row["parking"]) == (True, True)             # «مميزات المبنى»
    assert "furnished" not in row                                        # only the blurb says مؤثثة
    assert "private_entrance" not in row


def test_kitchen_reads_the_arabic_yes_and_entrances_stay_out_of_private_entrance():
    cards, _ = _cards()
    row, _, _ = R.map_listing(cards["cmnh40o40000210i8x84ezr2n"], R.parse_detail(DETAIL_UPLOADS))
    assert row["kitchen"] is True
    assert row["additional_info"]["specs"]["المداخل"] == "1" and "private_entrance" not in row
    assert "balcony_terrace" not in row                                  # no تراس anywhere → NULL


def test_silence_is_null_when_no_features_section_exists():
    cards, _ = _cards()
    row, _, _ = R.map_listing(cards["cmo44bibe003q5w1wk2y08vlc"], R.parse_detail(DETAIL_ON_REQUEST))
    assert "elevator" not in row and "parking" not in row and "kitchen" not in row
    assert row["license_number"] is None


def test_the_project_blurb_with_agent_names_is_never_stored():
    cards, _ = _cards()
    row, _, _ = R.map_listing(cards["cmnh40o40000210i8x84ezr2n"], R.parse_detail(DETAIL_MONTHLY))
    blob = json.dumps(row, ensure_ascii=False)
    for tok in ("0538241000", "0538451000", "أسامه", "عبدالعزيز", "نايف", "نبذة عن المشروع"):
        assert tok not in blob, tok
    assert row["description"].startswith("الوحدة رقم 103 الجفال (شقة) في الدور 0")
    assert "مميزات المبنى: مصعد - مواقف" in row["description"]


def test_identity_is_the_prefixed_cuid_and_the_query_less_detail_url():
    cards, _ = _cards()
    row, _, _ = R.map_listing(cards["cmnh40o40000210i8x84ezr2n"], R.parse_detail(DETAIL_MONTHLY))
    assert row["ad_number"] == "ALFcmnh40o40000210i8x84ezr2n"
    assert row["listing_url"] == "https://1000.com.sa/property/cmnh40o40000210i8x84ezr2n"
    assert row["source"] == "1000 العقارية"
    assert row["additional_info"]["project"] == "124" and row["additional_info"]["unit"] == "103"


# ── TRANSPORT + LIVENESS ────────────────────────────────────────────────────────────────────────
class _Resp(types.SimpleNamespace):
    pass


def _session(answers):
    """answers: list of (status, body) or Exception, consumed in order."""
    class _S:
        def get(self, url, **_kw):
            a = answers.pop(0)
            if isinstance(a, Exception):
                raise a
            return _Resp(status_code=a[0], text=a[1], url=url)
    return _S()


def test_a_stalled_offers_read_is_retried_never_read_as_empty(monkeypatch):
    monkeypatch.setattr(R.time, "sleep", lambda s: None)
    s = _session([TimeoutError("stall"), (200, OFFERS)])
    cards, total = R.fetch_offers(s)
    assert len(cards) == 6 and total == 105


def test_a_404_detail_is_a_fetch_miss_not_an_empty_listing():
    assert R.fetch_detail(_session([(404, "<html><h1>404</h1></html>")]), "x") is None


def test_a_stalled_detail_read_is_retried_never_a_crash(monkeypatch):
    # Same documented host flake as /offers (trap 8) — a transport stall on ONE of 105 detail
    # fetches must self-heal, never propagate out of crawl() and discard the whole run's rows.
    monkeypatch.setattr(R.time, "sleep", lambda s: None)
    s = _session([TimeoutError("stall"), (200, DETAIL_MONTHLY)])
    d = R.fetch_detail(s, "cmnh40o40000210i8x84ezr2n")
    assert d is not None and d["title"]


def test_a_detail_stall_that_never_recovers_is_a_tallied_miss_not_an_abort(monkeypatch):
    monkeypatch.setattr(R.time, "sleep", lambda s: None)
    s = _session([TimeoutError("stall"), TimeoutError("stall"), TimeoutError("stall")])
    assert R.fetch_detail(s, "x") is None


def test_liveness_signal_measured_shapes():
    sig = R._signal_for("cmnh40o40000210i8x84ezr2n")
    assert sig(404, "<html>themed not-found page</html>", False) == "gone"
    assert sig(200, DETAIL_MONTHLY, False) == "live"
    assert sig(200, DETAIL_OFFICE, False) is None          # another listing's page: no opinion
    assert sig(403, "", False) is None


def test_verify_gone_is_canary_gated_and_fails_closed(monkeypatch):
    monkeypatch.setattr("scrapers.common.http_liveness.time.sleep", lambda s: None)
    gone = R.verify_gone_for(canary=lambda: (True, "ok"), session_factory=lambda: _session([(404, "nf")]))
    assert gone("ALFcmnh40o40000210i8x84ezr2n")[0] == "gone"
    withheld = R.verify_gone_for(canary=R.make_canary(None), session_factory=lambda: _session([(404, "nf")]))
    assert withheld("ALFcmnh40o40000210i8x84ezr2n")[0] == "unknown"
    blocked = R.verify_gone_for(canary=lambda: (True, "ok"),
                                session_factory=lambda: _session([(403, "blocked"), (403, "blocked")]))
    assert blocked("ALFcmnh40o40000210i8x84ezr2n")[0] == "unknown"


# ── main(): the tally reaches end_run and prune waits for a complete enumeration ────────────────
def _stub_db(monkeypatch, written, ended, pruned):
    monkeypatch.setattr(R, "session", lambda: object())
    monkeypatch.setattr(R.time, "sleep", lambda s: None)
    # A pid without a captured detail page gets an EMPTY detail (the page loaded but printed
    # nothing the parser reads) so the card path is exercised; None would be a fetch miss.
    monkeypatch.setattr(R, "fetch_detail", lambda s, pid: R.parse_detail(DETAILS[pid]) if pid in DETAILS else {})
    monkeypatch.setattr(R.db, "begin_run", lambda platform: 5)
    monkeypatch.setattr(R.db, "_wasalt_batch", lambda table, rows: written.setdefault(table, list(rows)))
    monkeypatch.setattr(R.db, "retire_superseded_siblings", lambda **kw: 0)
    monkeypatch.setattr(R.db, "prune_unseen", lambda tbl, seen, source, **kw: pruned.append(tbl) or 0)
    monkeypatch.setattr(R.db, "end_run", lambda run_id, **kw: ended.update(kw) or True)


def test_main_tallies_every_skip_into_end_run_and_never_prunes_a_partial_crawl(monkeypatch):
    written, ended, pruned = {}, {}, []
    _stub_db(monkeypatch, written, ended, pruned)
    monkeypatch.setattr(R, "fetch_offers", lambda s, limit=0: R.parse_offers(OFFERS))   # 6 of 105
    assert R.main([]) == 0
    assert sorted(r["ad_number"] for r in written["thousand_residential_listings"]) == sorted(
        ["ALFcmnh40o40000210i8x84ezr2n", "ALFcmo44bibe003q5w1wk2y08vlc",
         "ALFcmnh40obn00ef10i8d5y80hgd", "ALFcmnh40o7i006e10i8zkkbrkk1"])
    assert [r["ad_number"] for r in written["thousand_commercial_listings"]] == ["ALFcmnh40oc600fg10i8nnkq5txv"]
    assert ended["notes"].endswith("skipped: city_not_in_catalogx1")
    assert ended["check_tables"] == ["thousand_residential_listings", "thousand_commercial_listings"]
    assert ended["rows_seen"] == 6 and ended["rows_upserted"] == 5
    assert pruned == []                                   # 6 ≠ 105: absence proves nothing


def test_main_prunes_only_when_the_counter_matches_the_cards(monkeypatch):
    written, ended, pruned = {}, {}, []
    _stub_db(monkeypatch, written, ended, pruned)
    monkeypatch.setattr(R, "fetch_offers", lambda s, limit=0: (R.parse_offers(OFFERS)[0], 6))
    assert R.main([]) == 0
    assert pruned == ["thousand_residential_listings", "thousand_commercial_listings"]


def test_a_limit_run_is_a_dry_run_that_touches_no_table(monkeypatch):
    written, ended, pruned = {}, {}, []
    _stub_db(monkeypatch, written, ended, pruned)
    monkeypatch.setattr(R, "fetch_offers", lambda s, limit=0: (R.parse_offers(OFFERS)[0][:limit], 105))
    assert R.main(["--limit", "2"]) == 0
    assert written == {} and ended == {} and pruned == []
