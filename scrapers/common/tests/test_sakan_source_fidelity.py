"""Offline barrier for scrapers/sakan/run.py — the traps that would ship wrong cards.

Both fixtures below are VERBATIM excerpts of live sa.sakan.co detail pages (ad 68195, a Buy
استراحة in جدة/الصفوة, and ad 97922, a Rent مكتب in الرياض/السويدي), reduced to the blocks the
parser reads. They are fed to the REAL parse_page()/map_listing()/fetch_urls() — nothing is
re-implemented here, and nothing touches the network or the database.

What each test pins, and why it is not decoration:
  · `offers` IS A LIST. A first probe called .get("price") on it and measured price 0/25 on a site
    whose real coverage is 220/220 — a fully-priced platform would have shipped priceless.
  · The mortgage widget prints «التزامات شهرية» on EVERY page, Buy included. Any period scan wider
    than the price block turns a 1,350,000 sale into a 112,500/month rent: a 12× card error.
  · `leaseLength.unitText` on this source is the SEO page title, not a lease term.
  · PRICE = SOURCE: never derived from area, never rounded, never hidden for implausibility.
  · Amenity silence is NULL, not False; a self-contradicting source is NULL too.
  · The sitemap carries THREE URLs per listing; counting them all triples the catalogue.
"""
from __future__ import annotations

import re
import sys
import types
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

# Stub supabase + dotenv so importing scrapers.common.db is hermetic (the module is imported by
# run.py for begin_run/end_run; no test below reaches it).
_sb = types.ModuleType("supabase")
_sb.Client = object
_sb.create_client = lambda *a, **k: None
sys.modules.setdefault("supabase", _sb)
_dv = types.ModuleType("dotenv")
_dv.load_dotenv = lambda *a, **k: None
sys.modules.setdefault("dotenv", _dv)

from scrapers.sakan import run as R  # noqa: E402

BUY_URL = "https://sa.sakan.co/ar/property/details/68195-استراحة-للبيع-في-جدة-حي-الصفوة"
RENT_URL = "https://sa.sakan.co/ar/property/details/97922-مكاتب-مؤثثة-للإيجار-في-الرياض-حي-السويدي"

# ── the catalogue stand-in: offline, and it RECORDS what it was asked, so a test can assert the
#    region label was never offered as a city and that the numbered-slug fold retried correctly ──
_CATALOG = {"جدة": (18394, 2), "الرياض": (21282, 1), "بريده": (15718, 4), "بريدة": (15718, 4),
            # Deliberately resolvable, so that a scraper which RETRIES an unresolved city as its
            # region label would produce a row here instead of skipping — and be caught.
            "منطقة مكة المكرمة": (99999, 2)}
CALLS: list = []


def _to_catalog(city_ar, region_hint=None):
    CALLS.append(city_ar)
    return _CATALOG.get((city_ar or "").strip(), (None, None))


R.to_catalog = _to_catalog
R.find_district_in_text = lambda text, city_id: (text or "").strip() or None


def setup_function(_fn=None):
    CALLS.clear()


def _row(url, page):
    row, cat, why = R.map_listing(R.parse_page(url, page))
    return row, cat, why


BUY = '<script type=\'application/ld+json\'>{\n    "@context": "https://schema.org/",\n    "@type": "BreadcrumbList",\n    "itemListElement": [\n        {\n            "@type": "ListItem",\n            "position": 1,\n            "name": "الرئيسية",\n            "item": "https://sa.sakan.co/ar/"\n        },\n        {\n            "@type": "ListItem",\n            "position": 2,\n            "name": "استراحة لـ بيع",\n            "item": "https://sa.sakan.co/ar/buy/استراحة"\n        },\n        {\n            "@type": "ListItem",\n            "position": 3,\n            "name": "استراحة لـ بيع في منطقة مكة المكرمة",\n            "item": "https://sa.sakan.co/ar/buy/استراحة/منطقة-مكة-المكرمة"\n        },\n        {\n            "@type": "ListItem",\n            "position": 4,\n            "name": "استراحة لـ بيع في منطقة مكة المكرمة، جدة",\n            "item": "https://sa.sakan.co/ar/buy/استراحة/منطقة-مكة-المكرمة/جدة"\n        },\n        {\n            "@type": "ListItem",\n            "position": 5,\n            "name": "استراحة لـ بيع في منطقة مكة المكرمة، جدة، الصفوة",\n            "item": "https://sa.sakan.co/ar/buy/استراحة/منطقة-مكة-المكرمة/جدة/الصفوة"\n        },\n        {\n            "@type": "ListItem",\n            "position": 6,\n            "name": "استراحة لـ بيع في استراحة للبيع في جدة , حي الصفوة",\n            "item": ""\n        }\n    ]\n}</script>\n<script type="application/ld+json">\n      {\n         "@context": "https://schema.org",\n         "@type": "SingleFamilyResidence",\n         "name": "سكن | استراحة للبيع - للشراء في منطقة مكة المكرمة,جدة",\n         "description": " افضل استراحة للبيع - للشراء في منطقة مكة المكرمة .  ابحث بالخريطة و الصور على موقع سكن العقاري استراحة لـ بيع  افضل احياء جدة . متنوعة استراحة لـ بيع",\n         "image": "https://sakancdn.sakan.co/sakan/production/uploads/property_image/2024/10/05/mobile/property_image_mobile_1728131556.webp",\n         "numberOfRooms": "3",\n         "offers":[\n                     {\n                        "@type":"Offer",\n                        "price":1350000,\n                        "priceCurrency":"ر.س"\n                     }\n                  ],\n         "leaseLength": {\n               "@type": "QuantitativeValue",\n               "unitText": "سكن | استراحة للبيع - للشراء في منطقة مكة المكرمة,جدة"\n         },\n         "numberOfBathroomsTotal": "4",\n         "numberOfBedrooms": "3",\n         "address": {\n            "@type": "PostalAddress",\n            "addressCountry": "السعودية",\n            "addressLocality": "منطقة مكة المكرمة",\n            "addressRegion": "جدة",\n            "streetAddress": "منطقة مكة المكرمة,الصفوة"\n         },\n         "telephone": "+966115115801"\n      }\n      </script>\n<div class="details__navigations" id="navSection"> <a class="f16 active" href="#navigationGeneral"> عام </a> <a class="f16" href="#navigationOverview"> ملخص </a> <a class="f16" href="#navigationAmenities"> مميزات العقار </a> <a class="f16" href="#navigationLocation"> الموقع </a> </div>\n<div class="aminities-box"> <div> <span class="fn fn--gray">المساحة</span> <div class=" icon-box"> <svg> <use xlink:href="#icon-size"></use> </svg> <span class="fn fn--b">900 m²</span> </div> </div> <div> <span class="fn fn--gray">الحالة</span> <div class=" icon-box"> <svg> <use xlink:href="#icon-checked-red-circle"></use> </svg> <span class="fn fn--b">فعال</span> </div> </div> \n<div class="price details__action--inner-section-1"> <span class="f16 ">سعر البيع</span> <div class="card__price-sar"> <span class="f20 f20-700 f20-red me-1">1,350,000</span> <img src="https://sakancdn.sakan.co/sakan/production/assets/front_v2/image/icons/real.svg" alt="" srcset=""> </div> </div>\n<div id="accordion_div" class="accordion__body fn fn--gray desc"> استراحة للبيع في جدة, حي الصفوة , متفرع من طريق عسفان <br>تحتوي على عدد 3 غرف نوم و 4 دورات مياه <br>2 من الغرف بابهم على الشارع <br> <br>رقم الترخيص:7200845864 </div>\n<div class="tr"> <span class="fn">غرف</span> <div> <svg class="me-1"> <use xlink:href="#icon-bedroom"></use> </svg> <span class="fn fn--b">3</span> </div> </div>\n<div class="tr"> <span class="fn">دورات مياه</span> <div> <svg class="me-1"> <use xlink:href="#icon-bathroom"></use> </svg> <span class="fn fn--b">4</span> </div> </div>\n<div class="tr"> <span class="fn">نوع العقار الفرعي</span> <div> <svg class="me-1"> <use xlink:href="#icon-istiraha"></use> </svg> <span class="fn fn--b">استراحة</span> </div> </div>\n<div class="tr"> <span class="fn">المساحة</span> <div> <svg class="me-1"> <use xlink:href="#icon-plot-area"></use> </svg> <span class="fn fn--b">900</span> </div> </div>\n<div class="tr"> <span class="fn">حالة التأثيث</span> <div> <svg class="me-1"> <use xlink:href="#icon-living-room"></use> </svg> <span class="fn fn--b">مؤثث</span> </div> </div>\n<div class="tr"> <span class="f14">رقم ترخيص الإعلان</span> <span class="f16 f16-700">7200845864</span> </div> <div class="tr"> <span class="f14">رقم الموحد للمنشأة</span> <span class="f16 f16-700">7015635050</span> </div> <div class="tr"> <span class="f14">تاريخ إصدار الإعلان</span> <span class="f16 f16-700">2026-01-21</span> </div> <div class="tr"> <span class="f14">تاريخ انتهاء رخصة الإعلان</span> <span class="f16 f16-700">2027-01-07</span> </div> <div class="tr"> <span class="f14">اسم الموظف المسؤول</span> <span class="f16 f16-700">تغريد عبدالعزيز محمد المديهش</span> </div> <div class="tr"> <span class="f14">هاتف الموظف المسؤول</span> <span class="f16 f16-700">0501415141</span> </div> </div>\n<div class="details__aminities--2" id="navigationAmenities"> <span class="f16 f16-700">مميزات العقار</span> <div class="inner"> <div> <img src="https://sakancdn.sakan.co/sakan/production/assets/front_v2/image/mobile_app/amenities/icon-parking.svg" alt="broken-icon" srcset=""> <span class="fxs fxs--gray">موقف</span> </div> <div> <img src="https://sakancdn.sakan.co/sakan/production/assets/front_v2/image/mobile_app/amenities/icon-master-bhk.svg" alt="broken-icon" srcset=""> <span class="fxs fxs--gray">ماستر</span> </div> <div> <img src="https://sakancdn.sakan.co/sakan/production/assets/front_v2/image/mobile_app/amenities/icon-yard.svg" alt="broken-icon" srcset=""> <span class="fxs fxs--gray">حوش</span> </div> <div> <img src="https://sakancdn.sakan.co/sakan/production/assets/front_v2/image/mobile_app/amenities/icon-living-room.svg" alt="broken-icon" srcset=""> <span class="fxs fxs--gray">غرفة معيشة</span> </div> <div> <img src="https://sakancdn.sakan.co/sakan/production/assets/front_v2/image/mobile_app/amenities/icon-resort.svg" alt="broken-icon" srcset=""> <span class="fxs fxs--gray">إستراحة</span> </div> </div> </div> <div class="details__location"></div>\n<a class="owner-bg-text" href="https://sa.sakan.co/ar/agency/1-فرع-شركة-سكن-العالمية-للتجارة-العامة"></a>\n<img src="https://sakancdn.sakan.co/sakan/production/uploads/property_image/2024/10/05/mobile/property_image_mobile_1728131556_thumb.webp" alt="">\n<img src="https://sakancdn.sakan.co/sakan/production/uploads/property_image/2024/10/05/mobile/property_image_mobile_1728131556.webp" alt="">\n<img src="https://sakancdn.sakan.co/sakan/production/uploads/property_image/2024/10/05/mobile/property_image_mobile_1728131579_thumb.webp" alt="">\n<img src="https://sakancdn.sakan.co/sakan/production/uploads/property_image/2024/10/05/mobile/property_image_mobile_1728131606_thumb.webp" alt="">\n<img src="https://sakancdn.sakan.co/sakan/production/uploads/property_image/2024/10/05/mobile/property_image_mobile_1728131627_thumb.webp" alt="">\n<img src="https://sakancdn.sakan.co/sakan/production/uploads/property_image/2024/10/05/mobile/property_image_mobile_1728131648_thumb.webp" alt="">'

RENT = '<script type=\'application/ld+json\'>{\n    "@context": "https://schema.org/",\n    "@type": "BreadcrumbList",\n    "itemListElement": [\n        {\n            "@type": "ListItem",\n            "position": 1,\n            "name": "الرئيسية",\n            "item": "https://sa.sakan.co/ar/"\n        },\n        {\n            "@type": "ListItem",\n            "position": 2,\n            "name": "مكتب لـ تأجير",\n            "item": "https://sa.sakan.co/ar/rent/مكتب"\n        },\n        {\n            "@type": "ListItem",\n            "position": 3,\n            "name": "مكتب لـ تأجير في منطقة الرياض",\n            "item": "https://sa.sakan.co/ar/rent/مكتب/منطقة-الرياض"\n        },\n        {\n            "@type": "ListItem",\n            "position": 4,\n            "name": "مكتب لـ تأجير في منطقة الرياض، الرياض",\n            "item": "https://sa.sakan.co/ar/rent/مكتب/منطقة-الرياض/الرياض"\n        },\n        {\n            "@type": "ListItem",\n            "position": 5,\n            "name": "مكتب لـ تأجير في منطقة الرياض، الرياض، السويدي",\n            "item": "https://sa.sakan.co/ar/rent/مكتب/منطقة-الرياض/الرياض/السويدي"\n        },\n        {\n            "@type": "ListItem",\n            "position": 6,\n            "name": "مكتب لـ تأجير في مكاتب مؤثثة للإيجار في الرياض, حي السويدي",\n            "item": ""\n        }\n    ]\n}</script>\n<script type="application/ld+json">\n      {\n         "@context": "https://schema.org",\n         "@type": "SingleFamilyResidence",\n         "name": "سكن | مكتب للتأجير في منطقة الرياض,الرياض",\n         "description": " افضل مكتب للتأجير في منطقة الرياض .  ابحث بالخريطة و الصور على موقع سكن العقاري مكتب لـ تأجير  افضل احياء الرياض . متنوعة مكتب لـ تأجير",\n         "image": "https://sakancdn.sakan.co/sakan/production/uploads/property_image/2026/06/15/mobile/property_image_mobile_1781508912.webp",\n         "numberOfRooms": "",\n         "offers":[\n                     {\n                        "@type":"Offer",\n                        "price":1000,\n                        "priceCurrency":"ر.س"\n                     }\n                  ],\n         "leaseLength": {\n               "@type": "QuantitativeValue",\n               "unitText": "سكن | مكتب للتأجير في منطقة الرياض,الرياض"\n         },\n         "numberOfBathroomsTotal": "",\n         "numberOfBedrooms": "",\n         "address": {\n            "@type": "PostalAddress",\n            "addressCountry": "السعودية",\n            "addressLocality": "منطقة الرياض",\n            "addressRegion": "الرياض",\n            "streetAddress": "منطقة الرياض,السويدي"\n         },\n         "telephone": "+966594120578"\n      }\n      </script>\n<div class="details__navigations" id="navSection"> <a class="f16 active" href="#navigationGeneral"> عام </a> <a class="f16" href="#navigationOverview"> ملخص </a> <a class="f16" href="#navigationAmenities"> مميزات العقار </a> <a class="f16" href="#navigationLocation"> الموقع </a> </div>\n<div class="aminities-box"> <div> <span class="fn fn--gray">المساحة</span> <div class=" icon-box"> <svg> <use xlink:href="#icon-size"></use> </svg> <span class="fn fn--b">9000 m²</span> </div> </div> <div> <span class="fn fn--gray">الحالة</span> <div class=" icon-box"> <svg> <use xlink:href="#icon-checked-red-circle"></use> </svg> <span class="fn fn--b">فعال</span> </div>\n<div class="price details__action--inner-section-1"> <span class="f16">سعر الإيجار</span> <div class="card__price-sar"> <span class="f20 f20-700 f20-red me-1">1,000</span> <img src="https://sakancdn.sakan.co/sakan/production/assets/front_v2/image/icons/real.svg" alt="" srcset=""> <span class="f16"> / شهري</span> </div> </div>\n<div id="accordion_div" class="accordion__body fn fn--gray"> مكاتب مؤثثة للإيجار في حي السويدي <br> <br>هل تبحث عن مكتب يجمع بين الموقع المميز والخدمات المتكاملة؟ ✨ <br> <br>نوفر لكم مكاتب مؤثثة وجاهزة للعمل فورًا، لتبدأوا أعمالكم بكل احترافية ودون عناء التجهيز. <br> <br>✔️ مكاتب مجهزة بالكامل <br>✔️ إنترنت عالي السرعة <br>✔️ قاعات اجتماعات مجهزة <br>✔️ خدمات استقبال وضيافة <br>✔️ دعم في إصدار التراخيص والإجراءات النظامية <br>✔️ عنوان أعمال معتمد <br>✔️ مواقف سيارات متوفرة <br> <br>اجعل مقر أعمالك في بيئة عملية واحترافية تساعدك على النمو والتركيز على نجاح مشروعك. <br> <br>🎉 استفيدوا الآن من عروضنا الخاصة لفترة محدودة. <br> <br>7200987109 </div>\n<div class="tr"> <span class="fn">نوع العقار الفرعي</span> <div> <svg class="me-1"> <use xlink:href="#icon-office"></use> </svg> <span class="fn fn--b">مكتب</span> </div> </div>\n<div class="tr"> <span class="fn">المساحة</span> <div> <svg class="me-1"> <use xlink:href="#icon-plot-area"></use> </svg> <span class="fn fn--b">9000</span> </div> </div>\n<div class="tr"> <span class="fn">سعر الإيجار</span> <div> <svg class="me-1"> <use xlink:href="#icon-rental-price"></use> </svg> <span class="fn fn--b">شهري</span> </div> </div>\n<div class="tr"> <span class="f14">رقم ترخيص الإعلان</span> <span class="f16 f16-700">7200987109</span> </div> <div class="tr"> <span class="f14">رقم الموحد للمنشأة</span> <span class="f16 f16-700">7005147454</span> </div> <div class="tr"> <span class="f14">تاريخ إصدار الإعلان</span> <span class="f16 f16-700">2026-05-31</span> </div> <div class="tr"> <span class="f14">تاريخ انتهاء رخصة الإعلان</span> <span class="f16 f16-700">2027-05-31</span> </div> <div class="tr"> <span class="f14">اسم الموظف المسؤول</span> <span class="f16 f16-700">سلطان عبد الله سليمان الراجحي</span> </div> <div class="tr"> <span class="f14">هاتف الموظف المسؤول</span> <span class="f16 f16-700">0592431010</span> </div> </div>\n<div class="details__aminities--2" id="navigationAmenities"> <span class="fb fb--b">مميزات العقار</span> <div class="inner"> <div> <img src="https://sakancdn.sakan.co/sakan/production/assets/front_v2/image/mobile_app/amenities/icon-parking.svg" alt="broken-icon" srcset=""> <span class="fxs fxs--gray">موقف</span> </div> <div> <img src="https://sakancdn.sakan.co/sakan/production/assets/front_v2/image/mobile_app/amenities/icon-wifi.svg" alt="broken-icon" srcset=""> <span class="fxs fxs--gray">انترنت</span> </div> <div> <img src="https://sakancdn.sakan.co/sakan/production/assets/front_v2/image/mobile_app/amenities/icon-ac.svg" alt="broken-icon" srcset=""> <span class="fxs fxs--gray">تكييف مركزي</span> </div> </div> </div> <div class="details__location"></div>\n<a class="owner-bg-text" href="https://sa.sakan.co/ar/agency/19277-شركة-سوبر-اوفيس-للأعمال-العقارية"></a>\n<img src="https://sakancdn.sakan.co/sakan/production/uploads/property_image/2026/06/15/mobile/property_image_mobile_1781508912_thumb.webp" alt="">\n<img src="https://sakancdn.sakan.co/sakan/production/uploads/property_image/2026/06/15/mobile/property_image_mobile_1781508912.webp" alt="">\n<img src="https://sakancdn.sakan.co/sakan/production/uploads/property_image/2026/06/15/mobile/property_image_mobile_1781508915_thumb.webp" alt="">\n<img src="https://sakancdn.sakan.co/sakan/production/uploads/property_image/2026/06/15/mobile/property_image_mobile_1781508937_thumb.webp" alt="">\n<img src="https://sakancdn.sakan.co/sakan/production/uploads/property_image/2026/06/15/mobile/property_image_mobile_1781508956_thumb.webp" alt="">\n<img src="https://sakancdn.sakan.co/sakan/production/uploads/property_image/2026/06/15/mobile/property_image_mobile_1781508976_thumb.webp" alt="">'


# ══ THE TRAP: offers is a LIST ══════════════════════════════════════════════════════════════════

def test_offers_is_a_list_and_a_naive_get_would_have_lost_every_price():
    p = R.parse_page(BUY_URL, BUY)
    assert p["price_ld"] == 1_350_000, "the page's own Offer price, read from offers[0]"

    # Document the exact defect this guards: the JSON-LD value really is a list, so the .get()
    # a first probe used cannot return a price no matter how well the rest of the parser works.
    import json
    ld = [json.loads(b) for b in R._LD_RE.findall(BUY)]
    offers = next(d["offers"] for d in ld if d.get("@type") == "SingleFamilyResidence")
    assert isinstance(offers, list) and not isinstance(offers, dict)
    assert not hasattr(offers, "get")


def test_offers_as_a_bare_object_is_tolerated_not_assumed():
    """If the source ever switches to schema.org's singular form, the price must still be read —
    but the list form stays the measured reality, so it is the one asserted above."""
    page = re.sub(r'"offers":\s*\[\s*(\{.*?\})\s*\]', lambda m: '"offers":' + m.group(1), BUY,
                  flags=re.S)
    assert '"offers":{' in re.sub(r"\s+", "", page), "the rewrite must produce the object form"
    assert R.parse_page(BUY_URL, page)["price_ld"] == 1_350_000


# ══ RENT PERIOD = SOURCE ════════════════════════════════════════════════════════════════════════

def test_buy_page_mortgage_widget_never_becomes_a_rent_period():
    page = BUY + '<div class="f14">التزامات شهرية</div><span> / شهري</span>'
    row, cat, why = _row(BUY_URL, page)
    assert row, why
    assert row["transaction_type"] == "Buy"
    assert row["price_total"] == 1_350_000
    assert "rent_period" not in row and "price_annual" not in row


def test_monthly_rent_is_annualised_from_the_sources_own_token():
    row, cat, why = _row(RENT_URL, RENT)
    assert row, why
    assert row["transaction_type"] == "Rent"
    assert row["rent_period"] == "monthly"
    assert row["price_annual"] == 12_000          # 1,000 × 12, the standard storage conversion
    assert "price_total" not in row
    assert row["additional_info"]["price_shown"] == "1,000"   # what the page printed, kept verbatim


def test_annual_rent_is_stored_verbatim():
    page = RENT.replace("/ شهري", "/ سنوي")
    row, _, why = _row(RENT_URL, page)
    assert row, why
    assert row["rent_period"] == "annual"
    assert row["price_annual"] == 1_000           # NOT ×12 — the source said annual


def test_rent_with_no_stated_period_is_never_defaulted():
    page = RENT.replace('<span class="f16"> / شهري</span>', "")
    p = R.parse_page(RENT_URL, page)
    assert p["period_raw"] is None
    row, _, why = _row(RENT_URL, page)
    assert row, why
    assert row["rent_period"] is None
    assert row["price_annual"] == 1_000, "the published figure, unscaled and un-annualised"


def test_leaselength_unittext_is_never_read_as_a_period():
    """leaseLength.unitText here is the SEO page title. Removing the price block's own token must
    leave the period UNKNOWN even though leaseLength is still present and parseable."""
    page = RENT.replace('<span class="f16"> / شهري</span>', "")
    assert "leaseLength" in page and "سكن | مكتب للتأجير" in page
    assert _row(RENT_URL, page)[0]["rent_period"] is None


def test_period_change_alone_never_rescales_the_stored_figure_twice():
    monthly = _row(RENT_URL, RENT)[0]
    annual = _row(RENT_URL, RENT.replace("/ شهري", "/ سنوي"))[0]
    assert monthly["price_annual"] == 12_000 and annual["price_annual"] == 1_000
    assert monthly["additional_info"]["price_shown"] == annual["additional_info"]["price_shown"]


# ══ PRICE = SOURCE ══════════════════════════════════════════════════════════════════════════════

def test_price_is_never_derived_from_the_area():
    row, _, why = _row(BUY_URL, BUY)
    assert row, why
    assert row["price_total"] == 1_350_000 and row["area_m2"] == 900
    assert "price_per_meter" not in row, "this source publishes no سعر المتر — nothing to store"
    # The arithmetic a 'helpful' fallback would reach for must not appear anywhere in the row.
    # A 'helpful' fallback would divide or multiply. Neither quotient may appear as the total.
    assert row["price_total"] not in {1_350_000 // 900, round(1_350_000 / 900)}
    assert row["additional_info"]["price_shown"] == "1,350,000", "the printed figure, verbatim"


def test_no_price_per_meter_label_exists_on_this_source():
    for page in (BUY, RENT):
        assert "سعر المتر" not in page


def test_an_implausibly_small_published_price_is_stored_verbatim_and_not_hidden():
    """1 ر.س against 900 m² looks like a per-metre rate — but this source labels the figure
    «سعر البيع» and publishes no rate at all, so it IS the total it published. Hiding it (or
    'repairing' it to ppm × area) is the plausibility-gate regression, not a fix."""
    page = BUY.replace('"price":1350000', '"price":1').replace(">1,350,000<", ">1<")
    row, _, why = _row(BUY_URL, page)
    assert row, why
    assert row["price_total"] == 1
    assert row["active"] is True
    assert row["price_total"] != 900, "never ppm × area"


def test_a_page_with_no_price_at_all_yields_null_not_a_guess():
    page = BUY.replace('"price":1350000', '"price":null').replace(
        '<span class="f20 f20-700 f20-red me-1">1,350,000</span>', "")
    row, _, why = _row(BUY_URL, page)
    assert row, why
    assert row["price_total"] is None


def test_arabic_indic_digits_are_real_digits():
    page = (BUY.replace(">1,350,000<", ">١,٣٥٠,٠٠٠<").replace('"price":1350000', '"price":null')
               .replace(">900 m²<", ">٩٠٠ m²<"))
    p = R.parse_page(BUY_URL, page)
    assert p["price_shown"] == "1,350,000" and p["area_raw"] == "900"
    row, _, why = _row(BUY_URL, page)
    assert row and row["price_total"] == 1_350_000 and row["area_m2"] == 900


# ══ AMENITIES: FOUR OUTCOMES, silence is NULL ═══════════════════════════════════════════════════

def test_silence_is_null_never_false():
    row, _, _ = _row(BUY_URL, BUY)
    # The page names موقف / حوش / مدخل سيارة and says nothing about a lift or a maid's room.
    assert row.get("parking") is True
    for absent in ("elevator", "maid_room", "driver_room", "optical_fibers"):
        assert absent not in row, f"{absent} must stay NULL — the source never mentioned it"


def test_the_ad_licence_and_a_cells_diagonal_facade_reach_their_columns():
    row, _, _ = _row(BUY_URL, BUY)
    assert row["license_number"] == "7200845864"                     # «رقم ترخيص الإعلان»
    assert row["additional_info"]["rega_ad_license_number"] == "7200845864"
    cell = ('<div class="tr"> <span class="fn">واجهة العقار</span> <div> <span class="fn fn--b">'
            'جنوب شرقي</span> </div> </div>\n')
    anchor = '<div class="tr"> <span class="fn">حالة التأثيث</span>'
    row, _, _ = _row(BUY_URL, BUY.replace(anchor, cell + anchor))
    assert row["direction"] == "جنوب شرق", "the cell's own diagonal option is one facade"


def test_explicit_negation_is_false():
    # The page's own «حالة التأثيث: مؤثث» cell is stripped so the prose negation is the only
    # statement: with both present the source contradicts itself, and that is NULL (next assert).
    bare = re.sub(r'<div class="tr"> <span class="fn">حالة التأثيث</span>.*?</div> </div>', "", BUY,
                  flags=re.S)
    row, _, _ = _row(BUY_URL, bare.replace("متفرع من طريق عسفان", "غير مؤثثة"))
    assert row.get("furnished") is False
    row, _, _ = _row(BUY_URL, BUY.replace("متفرع من طريق عسفان", "غير مؤثثة"))
    assert row.get("furnished") is None, "cell «مؤثث» vs prose «غير مؤثثة» is not a stated fact"


def test_prepared_only_stays_null():
    page = BUY.replace("متفرع من طريق عسفان", "مصعد مؤسس")
    row, _, _ = _row(BUY_URL, page)
    assert "elevator" not in row, "«مصعد مؤسس» is a prepared shaft, not a lift"


def test_the_neighbourhoods_amenity_stays_null():
    page = BUY.replace("متفرع من طريق عسفان", "قريب من مصعد عام وحديقة")
    row, _, _ = _row(BUY_URL, page)
    assert "elevator" not in row


def test_structured_feature_chips_fill_what_the_prose_omits():
    p = R.parse_page(RENT_URL, RENT)
    assert p["features"] == ["موقف", "انترنت", "تكييف مركزي"]
    row, _, _ = _row(RENT_URL, RENT)
    assert row.get("air_conditioner") is True and row.get("parking") is True


def test_a_self_contradicting_source_yields_null_not_a_coin_flip():
    """Prose «بدون مصعد» against a «مصعد» chip: the source has not stated the fact."""
    page = (BUY.replace("متفرع من طريق عسفان", "بدون مصعد")
               .replace('<span class="fxs fxs--gray">ماستر</span>',
                        '<span class="fxs fxs--gray">مصعد</span>'))
    p = R.parse_page(BUY_URL, page)
    assert "مصعد" in p["features"] and "بدون مصعد" in (p["description"] or "")
    row, _, _ = _row(BUY_URL, page)
    assert "elevator" not in row


# ══ SKIP, DON'T FAKE ════════════════════════════════════════════════════════════════════════════

def test_an_auction_is_skipped():
    page = BUY.replace("متفرع من طريق عسفان", "يطرح في مزاد علني")
    row, _, why = _row(BUY_URL, page)
    assert row is None and why == "auction"


def test_an_already_sold_ad_is_skipped():
    page = BUY.replace("متفرع من طريق عسفان", "تم البيع")
    row, _, why = _row(BUY_URL, page)
    assert row is None and why == "already_transacted"


def test_a_non_active_status_is_skipped():
    page = BUY.replace('<span class="fn fn--b">فعال</span>',
                       '<span class="fn fn--b">غير فعال</span>')
    assert R.parse_page(BUY_URL, page)["status"] == "غير فعال"
    row, _, why = _row(BUY_URL, page)
    assert row is None and why == "status_غير فعال"


def test_a_test_agency_is_skipped():
    page = BUY.replace("/ar/agency/1-فرع-شركة-سكن-العالمية-للتجارة-العامة",
                       "/ar/agency/9-ziyada-test-3")
    assert R.parse_page(BUY_URL, page)["agency_name"] == "ziyada test 3"
    row, _, why = _row(BUY_URL, page)
    assert row is None and why == "junk_agency"
    for real in ("شركة إسكان سلمان العقارية", "الصفقة الذهبية", "مكتب تميز الدار للعقارات",
                 "شركة العجمي العقاريه", "يمين الركيزة العقارية"):
        assert not R._JUNK_AGENCY_RE.search(real), f"the filter must not eat {real}"


def test_an_unmappable_type_is_skipped_not_guessed():
    page = BUY.replace("/ar/buy/استراحة", "/ar/buy/مستشفى").replace(
        '<span class="fn fn--b">استراحة</span>', '<span class="fn fn--b">مستشفى</span>')
    row, _, why = _row(BUY_URL, page)
    assert row is None and why == "type_unmapped"


def test_a_city_outside_the_catalogue_is_skipped_not_guessed():
    page = BUY.replace("/منطقة-مكة-المكرمة/جدة", "/منطقة-مكة-المكرمة/بحره")
    row, _, why = _row(BUY_URL, page)
    assert row is None and why == "city_not_in_catalog"
    # …and it is never rescued by falling back to the REGION, which the stub WOULD resolve. That
    # upgrades a region-level label into a specific city and fabricates precision (alhoshan, 2026-08-10).
    assert "منطقة مكة المكرمة" not in CALLS, CALLS
    assert CALLS == ["بحره"], CALLS


# ══ LOCATION: the region is never the city ══════════════════════════════════════════════════════

def test_the_region_label_is_never_offered_as_a_city():
    p = R.parse_page(BUY_URL, BUY)
    assert p["region_ar"] == "منطقة مكة المكرمة" and p["city_ar"] == "جدة"
    row, _, why = _row(BUY_URL, BUY)
    assert row, why
    assert row["city_ar"] == "جدة" and row["city"] == "Jeddah"
    assert not any((c or "").startswith("منطقة") for c in CALLS), CALLS


def test_a_numbered_city_slug_folds_and_the_raw_label_survives():
    """«بريده 1» is a duplicate-row disambiguator in sakan's own city table, not a city name."""
    page = BUY.replace("/منطقة-مكة-المكرمة/جدة", "/منطقة-القصيم/بريده-1")
    row, _, why = _row(BUY_URL, page)
    assert row, why
    assert CALLS[:2] == ["بريده 1", "بريده"], CALLS
    assert row["city_ar"] == "بريده"
    assert row["additional_info"]["city_ar_raw"] == "بريده 1", "folded, never deleted"


def test_a_district_number_is_never_folded_away():
    """Only the CITY slug gets the fold. A district's own number is source text the card keeps."""
    page = BUY.replace("/منطقة-مكة-المكرمة/جدة/الصفوة", "/منطقة-مكة-المكرمة/جدة/السويس-1")
    row, _, why = _row(BUY_URL, page)
    assert row, why
    assert row["neighborhood"] == "السويس 1"


def test_area_comes_from_the_summary_box_not_a_page_wide_scan():
    """Regression: an earlier draft scanned up to the first "navigationAmenities" occurrence, which
    is the NAV ANCHOR printed BEFORE the summary box — area_raw measured 0/60 while a spec-table
    fallback silently covered for it."""
    assert R.parse_page(BUY_URL, BUY)["area_raw"] == "900"
    assert R.parse_page(RENT_URL, RENT)["area_raw"] == "9000"
    # The page prints href="#navigationAmenities" (the nav bar) BEFORE the summary box, so any
    # parse that slices the page at the first occurrence of that token loses the area entirely.
    assert BUY.index('href="#navigationAmenities"') < BUY.index("900 m²")
    # Strip the spec table's own «المساحة» row: the summary box must still carry the area, so a
    # broken primary path can no longer hide behind the fallback.
    page = re.sub(r'<div class="tr"> <span class="fn">المساحة</span>.*?</div> </div>', "", BUY,
                  flags=re.S)
    assert "المساحة" in page and R.parse_page(BUY_URL, page)["specs"].get("المساحة") is None
    assert R.parse_page(BUY_URL, page)["area_raw"] == "900"
    assert _row(BUY_URL, page)[0]["area_m2"] == 900


def test_title_is_the_listing_title_not_the_seo_blob():
    p = R.parse_page(BUY_URL, BUY)
    assert p["title"] == "استراحة للبيع في جدة , حي الصفوة"
    assert "افضل" not in (p["description"] or ""), "the ld+json SEO description is never used"
    assert p["description"].startswith("استراحة للبيع في جدة, حي الصفوة")
    # With the listing's own prose absent, description is NULL — never backfilled from the SEO
    # blob, which is site marketing copy and would feed amenities_from_text someone else's text.
    stripped = re.sub(r'<div id="accordion_div".*?</div>', "", BUY, flags=re.S)
    assert "افضل استراحة للبيع" in stripped, "the ld+json SEO description is still in the page"
    assert R.parse_page(BUY_URL, stripped)["description"] is None


# ══ BEDROOMS only on a dwelling ═════════════════════════════════════════════════════════════════

def test_bedrooms_are_taken_on_a_dwelling():
    row, _, _ = _row(BUY_URL, BUY)
    assert row["bedrooms"] == 3 and row["bathrooms"] == 4


def test_bedrooms_are_not_written_onto_land():
    page = BUY.replace("/ar/buy/استراحة", "/ar/buy/أرض").replace(
        '<span class="fn fn--b">استراحة</span>', '<span class="fn fn--b">أرض</span>')
    row, cat, why = _row(BUY_URL, page)
    assert row, why
    assert row["property_type"] == "Residential Land"
    assert row["bedrooms"] is None, "a «3 غرف نوم» badge on a plot is a fabricated specification"


def test_property_age_reads_the_spelled_out_arabic():
    page = BUY + '<div class="tr"><span class="f14">عمر العقار</span>' \
                 '<span class="f16 f16-700">سبع سنوات</span></div></div>'
    row, _, _ = _row(BUY_URL, page)
    assert row["property_age"] == 7


def test_an_open_bound_age_is_unknown_not_its_floor():
    """«اكثر من عشر سنوات» (3 of 150 live pages, 2026-09-21) is MORE than ten: stored as 10 it would
    answer «10 years or newer» with a building the source says is older (akariyoun precedent)."""
    page = BUY + '<div class="tr"><span class="f14">عمر العقار</span>' \
                 '<span class="f16 f16-700">اكثر من عشر سنوات</span></div></div>'
    row, _, _ = _row(BUY_URL, page)
    assert row["property_age"] is None
    assert row["additional_info"]["spec_table"]["عمر العقار"] == "اكثر من عشر سنوات"


# ══ PHOTOS ══════════════════════════════════════════════════════════════════════════════════════

def test_the_published_thumb_is_preferred_over_the_multi_megabyte_original():
    row, _, _ = _row(BUY_URL, BUY)
    assert row["photo_urls"] and len(row["photo_urls"]) <= 20
    assert all(u.endswith("_thumb.webp") for u in row["photo_urls"])
    assert row["additional_info"]["photo_urls_full_res"], "the original is recorded, not discarded"


def test_a_thumb_the_page_never_printed_is_not_invented():
    page = re.sub(r'<img src="[^"]*_thumb\.webp" alt="">', "", BUY)
    p = R.parse_page(BUY_URL, page)
    assert p["photos"], "the page still printed the plain original"
    assert not any(u.endswith("_thumb.webp") for u in p["photos"])


def test_photo_urls_are_capped_at_twenty():
    extra = "".join(f'<img src="https://sakancdn.sakan.co/x/property_image/a/p_{i}_thumb.webp">'
                    for i in range(40))
    row, _, _ = _row(BUY_URL, BUY + extra)
    assert len(row["photo_urls"]) == 20


# ══ ENUMERATION ═════════════════════════════════════════════════════════════════════════════════

_SITEMAP = """<?xml version="1.0" encoding="UTF-8"?><urlset>
 <url><loc>https://sa.sakan.co/ar/property/details/68195-a</loc></url>
 <url><loc>https://sa.sakan.co/ar/loancalculator/68195-a</loc></url>
 <url><loc>https://sa.sakan.co/ar/reservation/buyonline/68195-a</loc></url>
 <url><loc>https://sa.sakan.co/ar/property/details/97922-b?x=1&amp;y=2</loc></url>
 <url><loc>https://sa.sakan.co/ar/loancalculator/97922-b</loc></url>
 <url><loc>https://sa.sakan.co/ar/reservation/buyonline/97922-b</loc></url>
 <url><loc>https://sa.sakan.co/ar/property/details/68195-a</loc></url>
</urlset>"""


class _FakeSession:
    def get(self, url, **kw):
        return types.SimpleNamespace(status_code=200, text=_SITEMAP, url=url)


def test_only_detail_urls_are_counted_so_the_catalogue_is_not_tripled():
    urls = R.fetch_urls(_FakeSession())
    assert len(urls) == 2, "3 URLs per listing in the sitemap; only /ar/property/details/ counts"
    assert all(R.DETAIL_PATH in u for u in urls)


def test_html_entities_in_sitemap_hrefs_are_unescaped():
    urls = R.fetch_urls(_FakeSession())
    assert "&amp;" not in "".join(urls) and "?x=1&y=2" in urls[1]


def test_limit_is_honoured():
    assert len(R.fetch_urls(_FakeSession(), limit=1)) == 1


def test_ad_number_is_the_prefixed_slug_id():
    assert R.ad_id_from_url(BUY_URL) == "68195"
    assert _row(BUY_URL, BUY)[0]["ad_number"] == "SKN68195"
    assert _row(BUY_URL, BUY)[0]["listing_url"] == BUY_URL


def test_category_comes_from_the_taxonomy_not_the_pages_land_use_word():
    """The spec table says «نوع العقار: تجاري» on this استراحة. Category is the taxonomy's call."""
    row, cat, _ = _row(BUY_URL, BUY)
    assert row["property_type"] == "Rest House" and cat == "residential"
    assert R.normalize.category_for_type("Office") == "Commercial"


def test_the_user_agent_is_left_to_impersonate():
    s = R.session()
    assert not any(k.lower() == "user-agent" for k in s.headers)


# ══ A 200 IS NOT PROOF OF A LISTING ═════════════════════════════════════════════════════════════

class _Replies:
    """Serves a canned list of (status, body) once each, and records how many gets it saw."""

    def __init__(self, *replies):
        self.replies = list(replies)
        self.calls = 0

    def get(self, url, **kw):
        self.calls += 1
        status, body = self.replies.pop(0) if self.replies else (500, "")
        return types.SimpleNamespace(status_code=status, text=body, url=url)


def test_a_soft_404_that_returns_200_is_a_fetch_miss_not_an_empty_listing(monkeypatch):
    """A body with no SingleFamilyResidence block parses cleanly to nothing. Without this guard it
    is filed as an ordinary type/deal skip and the page loss never shows up as a fetch failure."""
    monkeypatch.setattr(R.time, "sleep", lambda *_: None)
    sess = _Replies((200, "<html><body>العقار غير موجود</body></html>"))
    assert R.fetch_page(sess, BUY_URL) is None
    assert sess.calls == 1, "no payload is DEFINITIVE — retrying it just burns the crawl"
    # …and the same body, had it been accepted, would have produced a row-shaped nothing:
    row, _, why = _row(BUY_URL, "<html><body>العقار غير موجود</body></html>")
    assert row is None and why == "type_unmapped"


def test_a_transient_failure_is_retried_and_a_real_page_wins(monkeypatch):
    monkeypatch.setattr(R.time, "sleep", lambda *_: None)
    assert R.fetch_page(_Replies((403, ""), (200, BUY)), BUY_URL) == BUY


def test_a_404_is_not_retried():
    sess = _Replies((404, ""), (200, BUY))
    assert R.fetch_page(sess, BUY_URL) is None and sess.calls == 1


# ══ THE PLATFORM'S OWN CHIP VOCABULARY ══════════════════════════════════════════════════════════

def test_the_lift_chip_reaches_the_elevator_column():
    """sakan prints «اصنصير - مصاعد»; the shared map knows «مصعد» and shares no substring with it.
    Measured: 14 of 117 live listings stated a lift that no column saw before this rewrite."""
    page = BUY.replace('<span class="fxs fxs--gray">ماستر</span>',
                       '<span class="fxs fxs--gray">اصنصير - مصاعد</span>')
    p = R.parse_page(BUY_URL, page)
    assert "اصنصير - مصاعد" in p["features"]
    assert not R.normalize.amenities_from_text("اصنصير - مصاعد"), "the shared map cannot read it"
    row, _, _ = _row(BUY_URL, page)
    assert row.get("elevator") is True
    assert row["additional_info"]["features"] == p["features"], "the chip is stored as printed"


def test_partially_furnished_is_not_furnished():
    # Strip the page's own «حالة التأثيث: مؤثث» cell first — that cell is a real source statement
    # and legitimately sets furnished=True, so the chip has to be the ONLY signal left.
    page = re.sub(r'<div class="tr"> <span class="fn">حالة التأثيث</span>.*?</div> </div>', "", BUY,
                  flags=re.S)
    assert "حالة التأثيث" not in page
    page = page.replace('<span class="fxs fxs--gray">ماستر</span>',
                        '<span class="fxs fxs--gray">مفروشة جزئي</span>')
    assert R.normalize.amenities_from_text("مفروشة جزئي").get("furnished") is True, \
        "the shared map would say yes — which is why the chip is dropped here"
    row, _, _ = _row(BUY_URL, page)
    assert "furnished" not in row, "«partially furnished» is neither a yes nor a no"


_SERVICE = ('<div class="tr"> <span style="color: green; font-size: 22px;">&#10003;</span> '
            '<span class="f14">خدمة {}</span> </div>\n')


def test_service_rows_street_cells_and_no_employee_pii():
    cells = ('<div class="tr"> <span class="fn">عرض الشارع</span> <div> <span class="fn fn--b">15</span>'
             ' </div> </div>\n<div class="tr"> <span class="fn">واجهة العقار</span> <div> '
             '<span class="fn fn--b">شمال</span> </div> </div>\n')
    page = BUY.replace('<div class="details__aminities--2"',
                       cells + _SERVICE.format("الكهرباء") + _SERVICE.format("ألياف ضوئية")
                       + '<div class="details__aminities--2"', 1)
    row, _cat, why = _row("https://sa.sakan.co/ar/property/details/68195-x", page)
    assert why == ""
    assert (row["street_width_m"], row["direction"]) == (15, "شمال")
    assert (row["electricity"], row["optical_fibers"]) == (True, True)
    assert "water_supply" not in row, "a service the page never ticked stays NULL"
    spec = row["additional_info"]["spec_table"]
    assert not any(k.startswith("خدمة") for k in spec), "a ✓ row is not a label/value pair"
    assert "0501415141" not in str(row["additional_info"]) and "اسم الموظف المسؤول" not in spec
