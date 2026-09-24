"""daryusuf's P0s: one listing published as TWO WordPress posts (Arabic + English), a price that
is a HEADING with thirteen spellings, facts in a label/value widget whose labels drift across two
languages, and a city that is only ever stated in the title.

Every fixture below is a VERBATIM post from GET /wp-json/wp/v2/portfolio on 2026-09-24, with
content.rendered trimmed to the blocks run.py reads (h1/h2 headings, the gallery links, the Unfold
text, the cz_working_hours widget). Every assertion runs the SHIPPING functions —
`run.map_listing`, `run.dedupe_translations`, `run.parse_price_heading`, `run.parse_facts`,
`run.rent_period_stated`, `run.deal_and_type`, `run.deal_and_type_from_title`, `run.city_in_title`,
`run.fetch_posts`, `run._signal_for`, `run.main` — never a re-implementation. Offline: no network.

Traps met live, each locked here:
  · 9338 ↔ 9355: the same flat in Arabic and English, paired by the source's own «(463)»;
  · 8168: the price heading is the bare figure «2800»; the prose says «2800 SAR / Monthly»;
  · 4354's «Furniture Auction» (a landmark) and 6920's «تقريباً» (contains «قريباً») sit only in the
    BODY, never the title the auction/off-plan regexes read — sidestepped by the title-only scope,
    not by decoy protection in the regex itself (the «تقريباً» lookaround IS real and is exercised
    directly, in the title, below). 3422: «مؤجرة بالكامل» describes tenants, in the body too;
  · 3823: NO category at all — the title still says «Building for sale»;
  · 9157: the area cell reads «49,69م²» — a decimal comma, not 4,969 m²;
  · 9028: a plot with BOTH a total heading and a «سعر المتر» fact — both stored, never multiplied;
  · 4323: «More than 10 years» (an open bound); 8351: facade «Wast» (a typo); 7220: a phone number.
"""
from __future__ import annotations

import json
import sys
import types
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

from scrapers.daryusuf import run as R  # noqa: E402

_CITIES = {"المدينة المنورة": (14, 3), "جدة": (18, 2), "الرياض": (3, 1), "مكة المكرمة": (6, 2)}
_DISTRICTS = {"حي الإسكان": "حي الاسكان", "حي العليا": "حي العليا", "حي الدفاع": "حي الدفاع", "حي الرصيفة": "حي الرصيفة"}
TERMS = {80: "شقق-للإيجار", 170: "apartments-for-rent", 164: "land-for-rent", 89: "عمائر-للبيع", 82: "فلل-للبيع",
         83: "أراضي-للبيع", 183: "shops-for-rent", 172: "apartments-for-sale", 273: "محطات"}


@pytest.fixture(autouse=True)
def _no_catalog_network(monkeypatch):
    """to_catalog()/find_district_in_text() are the only calls that would touch Supabase; stubbed
    for EVERY test so a regression that reaches the catalog fails on an assertion, offline."""
    monkeypatch.setattr(R, "to_catalog", lambda c, region_hint=None: _CITIES.get(c, (None, None)))
    monkeypatch.setattr(R, "find_district_in_text", lambda t, cid: _DISTRICTS.get(t) if t else None)


# ── daryusuf fixtures (verbatim REST posts, content trimmed to the blocks run.py reads; captured 2026-09-24) ──

DYS_9338 = {
    "id": 9338,
    "link": "https://daryusuf.com/portfolio/%d8%b4%d9%82%d8%a9-%d9%84%d9%84%d8%a5%d9%8a%d8%ac%d8%a7%d8%b1-%d9%81%d9%8a-%d8%ad%d9%8a-%d8%a7%d9%84%d8%a5%d8%b3%d9%83%d8%a7%d9%86%d8%8c-%d8%a7%d9%84%d9%85%d8%af%d9%8a%d9%86%d8%a9-%d8%a7%d9%84%d9%85/",
    "status": "publish",
    "title": {
        "rendered": "شقة للإيجار في حي الإسكان، المدينة المنورة"
    },
    "content": {
        "rendered": "<h2>شقة للإيجار ، حي الإسكان, المدينة المنورة</h2>\n<h2>30,000 ريال سنوي</h2>\n<a class=\"cz_grid_link \" title=\"شقة الإسكان\" href=\"https://daryusuf.com/wp-content/uploads/2026/09/WhatsApp-Image-2026-09-19-at-12.36.15-PM.jpeg\" data-xtra-lightbox>\n<a class=\"cz_grid_link \" title=\"شقة الاسكان\" href=\"https://daryusuf.com/wp-content/uploads/2026/09/اسكان.jpg\" data-xtra-lightbox>\n<a class=\"cz_grid_link \" title=\"شقة الاسكان\" href=\"https://daryusuf.com/wp-content/uploads/2026/09/ااسككان.jpg\" data-xtra-lightbox>\n<a class=\"cz_grid_link \" title=\"شقة الاسكان\" href=\"https://daryusuf.com/wp-content/uploads/2026/09/ااسس.jpg\" data-xtra-lightbox>\n<a class=\"cz_grid_link \" title=\"شقة الاسكان\" href=\"https://daryusuf.com/wp-content/uploads/2026/09/اسسسك.jpg\" data-xtra-lightbox>\n<a class=\"cz_grid_link \" title=\"شقة الاسكان\" href=\"https://daryusuf.com/wp-content/uploads/2026/09/اسس.jpg\" data-xtra-lightbox>\n<a class=\"cz_grid_link \" title=\"شقة الاسكان\" href=\"https://daryusuf.com/wp-content/uploads/2026/09/اس.jpg\" data-xtra-lightbox>\n<a class=\"cz_grid_link \" title=\"شقة الاسكان\" href=\"https://daryusuf.com/wp-content/uploads/2026/09/اسكا.jpg\" data-xtra-lightbox>\n<a class=\"cz_grid_link \" title=\"شقة الاسكان\" href=\"https://daryusuf.com/wp-content/uploads/2026/09/اسككان.jpg\" data-xtra-lightbox>\n<a class=\"cz_grid_link \" title=\"شقة الاسكان\" href=\"https://daryusuf.com/wp-content/uploads/2026/09/ااسكان.jpg\" data-xtra-lightbox>\n<a class=\"cz_grid_link \" title=\"شقة الاسكان\" href=\"https://daryusuf.com/wp-content/uploads/2026/09/اسكانا.jpg\" data-xtra-lightbox>\n<div class=\"ue-txt\"><p>(463)</p><p>شقة للايجار- المدينة المنورة- حي الإسكان</p><p>داخل حد الحرم<br />المساحة 190م</p><p>تفاصيل العقار:<br />موقع مميز جداً: قريبة من شارع الملك عبد العزيز وشارع الأمير محمد بن عبد العزيز والدائري الثاني<br />وقريبة من جميع الخدمات</p><p>الدور الأرضي:<br />٤ غرف <br />٤ حمامات<br />غرفة غسيل أو خادمة <br />مطبخ <br />بدون صالة <br />المطبخ والمكيفات راكبة ( شباك)</p><p>السعرالمطلوب: 30 ألف ريال سنوياً دفعة واحدة <br />ومبلغ تأمين : 5000 ريال ويتم استرداده بعد تسليم الشقة بحالة جيدة</p></div>\n            </div>\n  \n      <div class=\"ue-btn-wrap\"\n<div class=\"cz_wh cz_wh_line_between\"><div class=\"mb10 last0 clr\"><div class=\"clr\"><span class=\"cz_wh_left\"><b>المساحة</b></span><span class=\"cz_wh_right\">190م</span></div><div class=\"cz_wh_line\"></div></div><div class=\"mb10 last0 clr\"><div class=\"clr\"><span class=\"cz_wh_left\"><b>غرف النوم</b></span><span class=\"cz_wh_right\">4</span></div><div class=\"cz_wh_line\"></div></div><div class=\"mb10 last0 clr\"><div class=\"clr\"><span class=\"cz_wh_left\"><b>دورات المياه</b></span><span class=\"cz_wh_right\">4</span></div><div class=\"cz_wh_line\"></div></div><div class=\"mb10 last0 clr\"><div class=\"clr\"><span class=\"cz_wh_left\"><b>عمر العقار</b></span><span class=\"cz_wh_right\">+10 سنوات</span></div><div class=\"cz_wh_line\"></div></div><div class=\"mb10 last0 clr\"><div class=\"clr\"><span class=\"cz_wh_left\"><b>الفئة</b></span><span class=\"cz_wh_right\">عوائل</span></div><div class=\"cz_wh_line\"></div></div><div class=\"mb10 last0 clr\"><div class=\"clr\"><span class=\"cz_wh_left\"><b>الصالات</b></span></div><div class=\"cz_wh_line\"></div></div><div class=\"mb10 last0 clr\"><div class=\"clr\"><span class=\"cz_wh_left\"><b>الدور</b></span><span class=\"cz_wh_right\">ارضي</span></div><div class=\"cz_wh_line\"></div></div></div>"
    },
    "portfolio_cat": [
        80
    ],
    "featured_media": 9339,
    "date_gmt": "2026-09-20T18:57:35",
    "modified_gmt": "2026-09-20T19:04:46"
}

DYS_9355 = {
    "id": 9355,
    "link": "https://daryusuf.com/en/portfolio/apartment-for-rent-al-iskan-district-madinah/",
    "status": "publish",
    "title": {
        "rendered": "Apartment for Rent, Al Iskan District, Madinah"
    },
    "content": {
        "rendered": "<h2>Apartment for Rent, Al Iskan District, Madinah</h2>\n<h2>30,000 SAR/ Year</h2>\n<a class=\"cz_grid_link \" title=\"شقة الإسكان\" href=\"https://daryusuf.com/wp-content/uploads/2026/09/WhatsApp-Image-2026-09-19-at-12.36.15-PM.jpeg\" data-xtra-lightbox>\n<a class=\"cz_grid_link \" title=\"شقة الاسكان\" href=\"https://daryusuf.com/wp-content/uploads/2026/09/اسكان.jpg\" data-xtra-lightbox>\n<a class=\"cz_grid_link \" title=\"شقة الاسكان\" href=\"https://daryusuf.com/wp-content/uploads/2026/09/ااسككان.jpg\" data-xtra-lightbox>\n<a class=\"cz_grid_link \" title=\"شقة الاسكان\" href=\"https://daryusuf.com/wp-content/uploads/2026/09/ااسس.jpg\" data-xtra-lightbox>\n<a class=\"cz_grid_link \" title=\"شقة الاسكان\" href=\"https://daryusuf.com/wp-content/uploads/2026/09/اسسسك.jpg\" data-xtra-lightbox>\n<a class=\"cz_grid_link \" title=\"شقة الاسكان\" href=\"https://daryusuf.com/wp-content/uploads/2026/09/اسس.jpg\" data-xtra-lightbox>\n<a class=\"cz_grid_link \" title=\"شقة الاسكان\" href=\"https://daryusuf.com/wp-content/uploads/2026/09/اس.jpg\" data-xtra-lightbox>\n<a class=\"cz_grid_link \" title=\"شقة الاسكان\" href=\"https://daryusuf.com/wp-content/uploads/2026/09/اسكا.jpg\" data-xtra-lightbox>\n<a class=\"cz_grid_link \" title=\"شقة الاسكان\" href=\"https://daryusuf.com/wp-content/uploads/2026/09/اسككان.jpg\" data-xtra-lightbox>\n<a class=\"cz_grid_link \" title=\"شقة الاسكان\" href=\"https://daryusuf.com/wp-content/uploads/2026/09/ااسكان.jpg\" data-xtra-lightbox>\n<a class=\"cz_grid_link \" title=\"شقة الاسكان\" href=\"https://daryusuf.com/wp-content/uploads/2026/09/اسكانا.jpg\" data-xtra-lightbox>\n<div class=\"ue-txt\"><p>(463)</p><p>Apartment for Rent - Al Madinah Al Munawwarah - Al Iskan District</p><p>Inside Haram Boundaries<br />Area: 190 sqm</p><p>Property Details:<br />Very prime location: Close to King Abdul Aziz Road, Prince Mohammad Bin Abdul Aziz Road, and the Second Ring Road<br />Close to all services</p><p>Ground Floor:<br />4 rooms<br />4 bathrooms<br />Laundry or maid's room<br />Kitchen<br />Without living room<br />Kitchen and window ACs installed</p><p>Asking Price: 30 thousand SAR annually in one payment<br /><br />Security deposit: 5,000 SAR, refundable after handing over the apartment in good condition</p></div>\n            </div>\n  \n      <div class=\"ue-btn-wrap\"\n<div class=\"cz_wh cz_wh_line_between\"><div class=\"mb10 last0 clr\"><div class=\"clr\"><span class=\"cz_wh_left\"><b>المساحة</b></span><span class=\"cz_wh_right\">190m²</span></div><div class=\"cz_wh_line\"></div></div><div class=\"mb10 last0 clr\"><div class=\"clr\"><span class=\"cz_wh_left\"><b>غرف النوم</b></span><span class=\"cz_wh_right\">4</span></div><div class=\"cz_wh_line\"></div></div><div class=\"mb10 last0 clr\"><div class=\"clr\"><span class=\"cz_wh_left\"><b>دورات المياه</b></span><span class=\"cz_wh_right\">4</span></div><div class=\"cz_wh_line\"></div></div><div class=\"mb10 last0 clr\"><div class=\"clr\"><span class=\"cz_wh_left\"><b>عمر العقار</b></span><span class=\"cz_wh_right\">+10 Years</span></div><div class=\"cz_wh_line\"></div></div><div class=\"mb10 last0 clr\"><div class=\"clr\"><span class=\"cz_wh_left\"><b>الفئة</b></span><span class=\"cz_wh_right\">Family</span></div><div class=\"cz_wh_line\"></div></div><div class=\"mb10 last0 clr\"><div class=\"clr\"><span class=\"cz_wh_left\"><b>الصالات</b></span></div><div class=\"cz_wh_line\"></div></div><div class=\"mb10 last0 clr\"><div class=\"clr\"><span class=\"cz_wh_left\"><b>الدور</b></span><span class=\"cz_wh_right\">Ground Floor</span></div><div class=\"cz_wh_line\"></div></div></div>"
    },
    "portfolio_cat": [
        170
    ],
    "featured_media": 9339,
    "date_gmt": "2026-09-20T19:05:52",
    "modified_gmt": "2026-09-20T19:08:52"
}

DYS_8168 = {
    "id": 8168,
    "link": "https://daryusuf.com/en/portfolio/furnished-apartment-for-rent-in-al-nubala-district-madinah/",
    "status": "publish",
    "title": {
        "rendered": "Furnished apartment for rent in Al Nubala District, Madinah"
    },
    "content": {
        "rendered": "<h2>  2800</h2>\n<a class=\"cz_grid_link \" title=\"شقة النبلاء\" href=\"https://daryusuf.com/wp-content/uploads/2026/08/شقة-نبلااا.webp\" data-xtra-lightbox>\n<a class=\"cz_grid_link \" title=\"شقة النبلاء\" href=\"https://daryusuf.com/wp-content/uploads/2026/08/شقة-بركي.webp\" data-xtra-lightbox>\n<a class=\"cz_grid_link \" title=\"شقة النبلاء\" href=\"https://daryusuf.com/wp-content/uploads/2026/08/شقةة-بركي.webp\" data-xtra-lightbox>\n<a class=\"cz_grid_link \" title=\"شقة النبلاء\" href=\"https://daryusuf.com/wp-content/uploads/2026/08/شقة-برككي.webp\" data-xtra-lightbox>\n<a class=\"cz_grid_link \" title=\"شقة النبلاء\" href=\"https://daryusuf.com/wp-content/uploads/2026/08/شقة-برركي.webp\" data-xtra-lightbox>\n<div class=\"ue-txt\"><p>(Off-408)</p><p>Furnished Apartment with a Private Entrance for Monthly Rent – Madinah – Al Nubala</p><p>Consists of:</p><p>One bedroom with a double bed</p><p>Living room</p><p>Fully equipped kitchen</p><p>One bathroom</p><p>Private entrance with a small courtyard</p><p>Washing machine available</p><p>Monthly Rent: SAR 2,800 (Discount available for bookings of more than one month)</p><p>For families only, to avoid any inconvenience</p></div>\n            </div>\n  \n      <div class=\"ue-btn-wrap\"\n<div class=\"cz_wh cz_wh_line_between\"><div class=\"mb10 last0 clr\"><div class=\"clr\"><span class=\"cz_wh_left\"><b>المساحة</b></span></div><div class=\"cz_wh_line\"></div></div><div class=\"mb10 last0 clr\"><div class=\"clr\"><span class=\"cz_wh_left\"><b>غرف النوم</b></span><span class=\"cz_wh_right\">1</span></div><div class=\"cz_wh_line\"></div></div><div class=\"mb10 last0 clr\"><div class=\"clr\"><span class=\"cz_wh_left\"><b>دورات المياه</b></span><span class=\"cz_wh_right\">1</span></div><div class=\"cz_wh_line\"></div></div><div class=\"mb10 last0 clr\"><div class=\"clr\"><span class=\"cz_wh_left\"><b>عمر العقار</b></span><span class=\"cz_wh_right\">New</span></div><div class=\"cz_wh_line\"></div></div><div class=\"mb10 last0 clr\"><div class=\"clr\"><span class=\"cz_wh_left\"><b>الفئة</b></span><span class=\"cz_wh_right\">Family</span></div><div class=\"cz_wh_line\"></div></div><div class=\"mb10 last0 clr\"><div class=\"clr\"><span class=\"cz_wh_left\"><b>الصالات</b></span><span class=\"cz_wh_right\">1</span></div><div class=\"cz_wh_line\"></div></div><div class=\"mb10 last0 clr\"><div class=\"clr\"><span class=\"cz_wh_left\"><b>الدور</b></span></div><div class=\"cz_wh_line\"></div></div></div>"
    },
    "portfolio_cat": [
        170
    ],
    "featured_media": 8163,
    "date_gmt": "2026-08-06T15:50:12",
    "modified_gmt": "2026-08-06T15:54:18"
}

DYS_4354 = {
    "id": 4354,
    "link": "https://daryusuf.com/en/portfolio/land-for-rent-on-hamza-ibn-awf-street-al-zahra-district-al-madinah-al-munawwarah-city-al-madinah-region/",
    "status": "publish",
    "title": {
        "rendered": "Land for rent in Al Zahra district, Al Madinah"
    },
    "content": {
        "rendered": "<h2>Land for rent, Al-Zahra District, Madinah </h2>\n<h2>35,002.66 SAR Per Year</h2>\n<a class=\"cz_grid_link \" title=\"019487781_1758136550384\" href=\"https://daryusuf.com/wp-content/uploads/2026/03/019487781_1758136550384.webp\" data-xtra-lightbox>\n<a class=\"cz_grid_link \" title=\"019487781_1758136550407\" href=\"https://daryusuf.com/wp-content/uploads/2026/03/019487781_1758136550407.webp\" data-xtra-lightbox>\n<a class=\"cz_grid_link \" title=\"019487788_1758136550381\" href=\"https://daryusuf.com/wp-content/uploads/2026/03/019487788_1758136550381.webp\" data-xtra-lightbox>\n<a class=\"cz_grid_link \" title=\"019487789_1758136550384\" href=\"https://daryusuf.com/wp-content/uploads/2026/03/019487789_1758136550384.webp\" data-xtra-lightbox>\n<a class=\"cz_grid_link \" title=\"019487789_1758136550399\" href=\"https://daryusuf.com/wp-content/uploads/2026/03/019487789_1758136550399.webp\" data-xtra-lightbox>\n<div class=\"ue-txt\"><p style=\"text-align: left;\">(off - 077)</p><p style=\"text-align: left;\">Land for investment – Al-Madinah Al-Munawwarah, Al-Uyoon District, Plan No. 8 / 1402 / A, Plot No. 176</p><p style=\"text-align: left;\">Outside Haram boundary<br />Area: 539 m²</p><p style=\"text-align: left;\"><strong>Land Features:</strong><br />- Total area: 539 m²<br />- Commercial and residential use<br />- Street width: 24 m<br />- Frontage: 24.5 m, Depth: 22 m<br />- Eastern facade<br />- Very close to Prince Nayef Road<br />- 3 km from Furniture Auction, 7 km from Guard Hospital</p><p style=\"text-align: left;\">Initial price: 35,000 SAR for the first year; price for subsequent years depends on building details, activity, and contract duration<br />Commission: 5%</p></div>\n            </div>\n  \n      <div class=\"ue-btn-wrap\"\n<div class=\"cz_wh cz_wh_line_between\"><div class=\"mb10 last0 clr\"><div class=\"clr\"><span class=\"cz_wh_left\"><b>Facade</b></span><span class=\"cz_wh_right\">East</span></div><div class=\"cz_wh_line\"></div></div><div class=\"mb10 last0 clr\"><div class=\"clr\"><span class=\"cz_wh_left\"><b>Area</b></span><span class=\"cz_wh_right\">539 m²</span></div><div class=\"cz_wh_line\"></div></div><div class=\"mb10 last0 clr\"><div class=\"clr\"><span class=\"cz_wh_left\"><b>Street width</b></span><span class=\"cz_wh_right\">24 m</span></div><div class=\"cz_wh_line\"></div></div><div class=\"mb10 last0 clr\"><div class=\"clr\"><span class=\"cz_wh_left\"><b>Price per square meter</b></span><span class=\"cz_wh_right\">65 SAR</span></div><div class=\"cz_wh_line\"></div></div></div>"
    },
    "portfolio_cat": [
        164
    ],
    "featured_media": 2628,
    "date_gmt": "2026-03-28T16:33:43",
    "modified_gmt": "2026-08-31T17:20:53"
}

DYS_3422 = {
    "id": 3422,
    "link": "https://daryusuf.com/portfolio/%d8%b9%d9%85%d8%a7%d8%b1%d8%a9-%d9%84%d9%84%d8%a8%d9%8a%d8%b9-%d9%81%d9%8a-%d8%b4%d8%a7%d8%b1%d8%b9-%d8%b1%d8%b6%d9%8a-%d8%a7%d9%84%d8%af%d9%8a%d9%86-%d8%a7%d9%84%d9%81%d8%a7%d8%b3%d9%8a-%d8%ad%d9%8a/",
    "status": "publish",
    "title": {
        "rendered": "عمارة للبيع في حي الرصيفة, مدينة مكة المكرمة"
    },
    "content": {
        "rendered": "<h2>عمارة للبيع في شارع رضي الدين الفاسي, حي الرصيفة, مدينة مكة المكرمة, منطقة مكة المكرمة</h2>\n<h2>5,800,000 ريال</h2>\n<a class=\"cz_grid_link \" title=\"عمارة الرصيفة\" href=\"https://daryusuf.com/wp-content/uploads/2026/03/15.png\" data-xtra-lightbox>\n<a class=\"cz_grid_link \" title=\"019487780_1763406380469\" href=\"https://daryusuf.com/wp-content/uploads/2026/03/019487780_1763406380469-1.webp\" data-xtra-lightbox>\n<a class=\"cz_grid_link \" title=\"019487783_1763406380483\" href=\"https://daryusuf.com/wp-content/uploads/2026/03/019487783_1763406380483.webp\" data-xtra-lightbox>\n<a class=\"cz_grid_link \" title=\"019487784_1763406380467\" href=\"https://daryusuf.com/wp-content/uploads/2026/03/019487784_1763406380467.webp\" data-xtra-lightbox>\n<a class=\"cz_grid_link \" title=\"019487787_1763406380470\" href=\"https://daryusuf.com/wp-content/uploads/2026/03/019487787_1763406380470.webp\" data-xtra-lightbox>\n<a class=\"cz_grid_link \" title=\"019487787_1763406380489\" href=\"https://daryusuf.com/wp-content/uploads/2026/03/019487787_1763406380489.webp\" data-xtra-lightbox>\n<div class=\"ue-txt\"><p style=\"text-align: right;\">(off-101)</p><p style=\"text-align: right;\">للبيع عمارة سكنية- مكة المكرمة، حي الرصيفة الجديد</p><p style=\"text-align: right;\">المساحة: 725متر مربع</p><p style=\"text-align: right;\">تفاصيل العقار:<br />تتكون من ٤ أدوار وملحق<br />- دور أرضي شقتين : ٥ غرف و ٣ غرف بمنافعها<br />- دور الميزان شقتين : كل شقة ٥ غرف بمنافعهم<br />- ٣ أدوار متكررة شقتين في كل دور : كل شقة ٥ غرف بمنافعها<br />- ملحق : غرفتين بمنافعهم</p><p style=\"text-align: right;\">مميزات العقار:<br />واجهتين :<br />شمالا : شارع عرض ١٢ متر<br />غربا : شارع عرض ١٢ متر</p><p style=\"text-align: right;\">* العمارة مؤجرة بالكامل<br />* الدخل 250 - 300 ألف سنوياً<br />* العمارة يمكن تأجيرها موسم العمرة والحج<br />* قريبة من جميع الخدمات ومن محطة القطار</p><p style=\"text-align: right;\">السعر المطلوب: 5.8 مليون ريال صافي<br />السعي: 2.5%</p></div>\n            </div>\n  \n      <div class=\"ue-btn-wrap\"\n<div class=\"cz_wh cz_wh_line_between\"><div class=\"mb10 last0 clr\"><div class=\"clr\"><span class=\"cz_wh_left\"><b>نوع العقار</b></span><span class=\"cz_wh_right\">سكني</span></div><div class=\"cz_wh_line\"></div></div><div class=\"mb10 last0 clr\"><div class=\"clr\"><span class=\"cz_wh_left\"><b>عمر العقار</b></span><span class=\"cz_wh_right\">أكثر من 10 سنوات</span></div><div class=\"cz_wh_line\"></div></div><div class=\"mb10 last0 clr\"><div class=\"clr\"><span class=\"cz_wh_left\"><b>المساحة</b></span><span class=\"cz_wh_right\">725م²</span></div><div class=\"cz_wh_line\"></div></div><div class=\"mb10 last0 clr\"><div class=\"clr\"><span class=\"cz_wh_left\"><b>عرض الشارع</b></span><span class=\"cz_wh_right\">12م</span></div><div class=\"cz_wh_line\"></div></div><div class=\"mb10 last0 clr\"><div class=\"clr\"><span class=\"cz_wh_left\"><b>عدد الغرف</b></span><span class=\"cz_wh_right\">35</span></div><div class=\"cz_wh_line\"></div></div></div>"
    },
    "portfolio_cat": [
        89
    ],
    "featured_media": 8735,
    "date_gmt": "2026-03-23T12:48:28",
    "modified_gmt": "2026-09-06T17:22:57"
}

DYS_6920 = {
    "id": 6920,
    "link": "https://daryusuf.com/portfolio/%d9%81%d9%8a%d9%84%d8%a7-%d9%84%d9%84%d8%a8%d9%8a%d8%b9-%d9%81%d9%8a-%d8%ad%d9%8a-%d8%a7%d9%84%d8%af%d9%81%d8%a7%d8%b9-%d8%a7%d9%84%d9%85%d8%af%d9%8a%d9%86%d8%a9-%d8%a7%d9%84%d9%85%d9%86%d9%88%d8%b1-2/",
    "status": "publish",
    "title": {
        "rendered": "فيلا للبيع في حي الدفاع, المدينة المنورة"
    },
    "content": {
        "rendered": "<h2>فيلا للبيع , في حي الدفاع, المدينة المنورة</h2>\n<h2>3,000,000 ريال</h2>\n<a class=\"cz_grid_link \" title=\"فيلا الدفاع\" href=\"https://daryusuf.com/wp-content/uploads/2026/05/فيلا-الدفااع.webp\" data-xtra-lightbox>\n<a class=\"cz_grid_link \" title=\"فيلا الدفاع\" href=\"https://daryusuf.com/wp-content/uploads/2026/05/ففيلا-الدفاع.webp\" data-xtra-lightbox>\n<a class=\"cz_grid_link \" title=\"فيلا الدفاع\" href=\"https://daryusuf.com/wp-content/uploads/2026/05/فيلا-دفاااع.webp\" data-xtra-lightbox>\n<a class=\"cz_grid_link \" title=\"فيلا الدفاع\" href=\"https://daryusuf.com/wp-content/uploads/2026/05/فييلا-الدفاع.webp\" data-xtra-lightbox>\n<div class=\"ue-txt\"><p>(off-290)</p><p>للبيع فيلا -المدينة المنورة - حي العزيزية<br />منطقة البيداء الدفاع</p><p>اجمالي المساحة 1000 متر تقريباً<br />مساحة البناء 600 متر<br />مساحة بناء الفيلا 350 متر<br />مساحة بناء الشقق 250 متر</p><p>تفاصيل العقار:<br />فيلا على واجهتين غربية و شمالية<br />وثلاث شقق في الخلف على واجهه شمالية.</p><p>الفيلا لم يتم تشطيبها من الداخل بعد.<br />الشقق تم تشطيبها بالكامل<br />الشقق الدور الارضي<br />5 غرف<br />وصالة<br />3 دورات مياه<br />مطبخ.<br />الدور الاول:<br />ثلاث غرف وصالة واثنين دورات مياه و مطبخ.<br />الدور الثاني:<br />اربع غرف وصالة وثلاث دورات مياه و مطبخ وسطح</p><p>الفيلا الدور الارضي:<br />ثلاث مجالس وصالة ومطبخ ومستودع اثنان دورة مياه.<br />الدور الاول :<br />خمس غرف نوم اثنان من الغرف ب دورة مياه داخلية<br />وثلاث غرف نوم ب دورة مياه خارجية وغرفة خادمة ب دورة مياه داخلية<br />ومطبخ وصالة.<br />الدور الثاني: ملحق غرفة و صالة و دورة مياه وغسيل و سطح.<br />يوجد في الفيلا تأسيس مصعد.<br />يوجد تأسيس غاز مركزي للشقق و الفيلا<br />يوجد امام المبنى من الجهة الشمالية جامع كبير</p><p><br />السعر المطلوب : 3 مليون ريال<br />السعي : 2.5%</p><p> </p></div>\n            </div>\n  \n      <div class=\"ue-btn-wrap\"\n<div class=\"cz_wh cz_wh_line_between\"><div class=\"mb10 last0 clr\"><div class=\"clr\"><span class=\"cz_wh_left\"><b>الواجهة</b></span><span class=\"cz_wh_right\">غرب- شمال</span></div><div class=\"cz_wh_line\"></div></div><div class=\"mb10 last0 clr\"><div class=\"clr\"><span class=\"cz_wh_left\"><b>عدد الشقق</b></span><span class=\"cz_wh_right\">3</span></div><div class=\"cz_wh_line\"></div></div><div class=\"mb10 last0 clr\"><div class=\"clr\"><span class=\"cz_wh_left\"><b>دورات المياه</b></span><span class=\"cz_wh_right\">6</span></div><div class=\"cz_wh_line\"></div></div><div class=\"mb10 last0 clr\"><div class=\"clr\"><span class=\"cz_wh_left\"><b>عمر العقار</b></span><span class=\"cz_wh_right\">جديد</span></div><div class=\"cz_wh_line\"></div></div><div class=\"mb10 last0 clr\"><div class=\"clr\"><span class=\"cz_wh_left\"><b>غرف النوم</b></span><span class=\"cz_wh_right\">17</span></div><div class=\"cz_wh_line\"></div></div><div class=\"mb10 last0 clr\"><div class=\"clr\"><span class=\"cz_wh_left\"><b>الصالات</b></span><span class=\"cz_wh_right\">4</span></div><div class=\"cz_wh_line\"></div></div><div class=\"mb10 last0 clr\"><div class=\"clr\"><span class=\"cz_wh_left\"><b>عرض الشارع</b></span><span class=\"cz_wh_right\">37م</span></div><div class=\"cz_wh_line\"></div></div><div class=\"mb10 last0 clr\"><div class=\"clr\"><span class=\"cz_wh_left\"><b>المساحة</b></span><span class=\"cz_wh_right\">980م²</span></div><div class=\"cz_wh_line\"></div></div></div>"
    },
    "portfolio_cat": [
        82
    ],
    "featured_media": 6924,
    "date_gmt": "2026-05-15T18:08:06",
    "modified_gmt": "2026-05-15T18:24:30"
}

DYS_3823 = {
    "id": 3823,
    "link": "https://daryusuf.com/en/portfolio/building-for-sale-on-al-rumaysa-bint-malhan-street-bani-muawiyah-district-madinah-al-madinah-region/",
    "status": "publish",
    "title": {
        "rendered": "Building for sale in Bani Muawiyah district, Al Madinah"
    },
    "content": {
        "rendered": "<h2>Building for Sale on Al-Rumaysa Bint Malhan Street, Bani Muawiyah District, Madinah, Al Madinah Region</h2>\n<h2>1,500,000 SAR</h2>\n<a class=\"cz_grid_link \" title=\"019487783_1755961829708\" href=\"https://daryusuf.com/wp-content/uploads/2026/03/019487783_1755961829708-1.webp\" data-xtra-lightbox>\n<a class=\"cz_grid_link \" title=\"019487785_1755961829694\" href=\"https://daryusuf.com/wp-content/uploads/2026/03/019487785_1755961829694.webp\" data-xtra-lightbox>\n<a class=\"cz_grid_link \" title=\"019487785_1756235240970\" href=\"https://daryusuf.com/wp-content/uploads/2026/03/019487785_1756235240970.webp\" data-xtra-lightbox>\n<a class=\"cz_grid_link \" title=\"019487787_1755961830156\" href=\"https://daryusuf.com/wp-content/uploads/2026/03/019487787_1755961830156.webp\" data-xtra-lightbox>\n<div class=\"ue-txt\"><p style=\"text-align: left;\">(off-074)</p><p style=\"text-align: left;\">Building for Sale – Madinah, Bani Muawiyah District (Inside Haram Limits)</p><p style=\"text-align: left;\">Area: 195.65 sqm</p><p style=\"text-align: left;\">Permitted Construction: Approximately 6 floors</p><p style=\"text-align: left;\">Property Details:<br />- 2 Floors + Annex<br />- Each floor: 2 apartments, each with 3 rooms and 2 bathrooms</p><p style=\"text-align: left;\">Property Features:<br />- 1 km from Al-Masjid an-Nabawi<br />- Close to King Abdulaziz Road<br />- Behind former Al-Bashir<br />- Covered terrace suitable for building staff rooms</p><p style=\"text-align: left;\">Annual Income: SAR 60,000</p><p style=\"text-align: left;\">Asking Price: SAR 1,500,000 (Net, Negotiable)<br />Commission: 2.5%</p></div>\n            </div>\n  \n      <div class=\"ue-btn-wrap\"\n<div class=\"cz_wh cz_wh_line_between\"><div class=\"mb10 last0 clr\"><div class=\"clr\"><span class=\"cz_wh_left\"><b>Frontage</b></span><span class=\"cz_wh_right\">East</span></div><div class=\"cz_wh_line\"></div></div><div class=\"mb10 last0 clr\"><div class=\"clr\"><span class=\"cz_wh_left\"><b>Number of Apartments</b></span><span class=\"cz_wh_right\">None</span></div><div class=\"cz_wh_line\"></div></div><div class=\"mb10 last0 clr\"><div class=\"clr\"><span class=\"cz_wh_left\"><b>Number of Rooms</b></span><span class=\"cz_wh_right\">12</span></div><div class=\"cz_wh_line\"></div></div><div class=\"mb10 last0 clr\"><div class=\"clr\"><span class=\"cz_wh_left\"><b>Street Width</b></span><span class=\"cz_wh_right\">16 m</span></div><div class=\"cz_wh_line\"></div></div><div class=\"mb10 last0 clr\"><div class=\"clr\"><span class=\"cz_wh_left\"><b>Building Age</b></span><span class=\"cz_wh_right\">Over 10 years</span></div><div class=\"cz_wh_line\"></div></div><div class=\"mb10 last0 clr\"><div class=\"clr\"><span class=\"cz_wh_left\"><b>Area</b></span><span class=\"cz_wh_right\">195 m²</span></div><div class=\"cz_wh_line\"></div></div></div>"
    },
    "portfolio_cat": [],
    "featured_media": 3413,
    "date_gmt": "2026-03-27T17:50:17",
    "modified_gmt": "2026-04-02T15:15:01"
}

DYS_9157 = {
    "id": 9157,
    "link": "https://daryusuf.com/portfolio/%d8%b4%d9%82%d8%a9-%d9%84%d9%84%d8%a5%d9%8a%d8%ac%d8%a7%d8%b1-%d9%81%d9%8a-%d8%ad%d9%8a-%d8%a7%d9%84%d8%b9%d9%84%d9%8a%d8%a7%d8%8c-%d8%a7%d9%84%d8%b1%d9%8a%d8%a7%d8%b6/",
    "status": "publish",
    "title": {
        "rendered": "شقة للإيجار في حي العليا، الرياض"
    },
    "content": {
        "rendered": "<h2>  120,000 ريال سنوي</h2>\n<a class=\"cz_grid_link \" title=\"شقة الرياض العليا\" href=\"https://daryusuf.com/wp-content/uploads/2026/09/WhatsApp-Image-2026-09-15-at-10.16.31-AM.jpeg\" data-xtra-lightbox>\n<a class=\"cz_grid_link \" title=\"شقة الرياض العليا\" href=\"https://daryusuf.com/wp-content/uploads/2026/09/دامااك.webp\" data-xtra-lightbox>\n<a class=\"cz_grid_link \" title=\"شقة الرياض العليا\" href=\"https://daryusuf.com/wp-content/uploads/2026/09/داماكك.webp\" data-xtra-lightbox>\n<a class=\"cz_grid_link \" title=\"شقة الرياض العليا\" href=\"https://daryusuf.com/wp-content/uploads/2026/09/داماك.webp\" data-xtra-lightbox>\n<a class=\"cz_grid_link \" title=\"شقة الرياض العليا\" href=\"https://daryusuf.com/wp-content/uploads/2026/09/دداماك.webp\" data-xtra-lightbox>\n<a class=\"cz_grid_link \" title=\"شقة الرياض العليا\" href=\"https://daryusuf.com/wp-content/uploads/2026/09/ددااماكك.webp\" data-xtra-lightbox>\n<a class=\"cz_grid_link \" title=\"شقة الرياض العليا\" href=\"https://daryusuf.com/wp-content/uploads/2026/09/دامكاا.webp\" data-xtra-lightbox>\n<div class=\"ue-txt\"><p>(452)</p><p>استديو برج داماك- الرياض- حي العليا شارع الملك فهد<br />مساحة الشقة 49,69م</p><p>تفاصيل الشقة :<br />موقف خاص<br />دورة مياه</p><p>المميزات :<br />مصاعد<br />برج مميز فندقي على طريق الملك فهد<br />موقع قريب من جميع الخدمات</p><p> </p><p>السعر المطلوب : 120 الف ريال ايجار سنوي<br />السعي :5%</p></div>\n            </div>\n  \n      <div class=\"ue-btn-wrap\"\n<div class=\"cz_wh cz_wh_line_between\"><div class=\"mb10 last0 clr\"><div class=\"clr\"><span class=\"cz_wh_left\"><b>المساحة</b></span><span class=\"cz_wh_right\">49,69م²</span></div><div class=\"cz_wh_line\"></div></div><div class=\"mb10 last0 clr\"><div class=\"clr\"><span class=\"cz_wh_left\"><b>غرف النوم</b></span><span class=\"cz_wh_right\">1</span></div><div class=\"cz_wh_line\"></div></div><div class=\"mb10 last0 clr\"><div class=\"clr\"><span class=\"cz_wh_left\"><b>دورات المياه</b></span><span class=\"cz_wh_right\">1</span></div><div class=\"cz_wh_line\"></div></div><div class=\"mb10 last0 clr\"><div class=\"clr\"><span class=\"cz_wh_left\"><b>عمر العقار</b></span><span class=\"cz_wh_right\">+10 سنوات</span></div><div class=\"cz_wh_line\"></div></div><div class=\"mb10 last0 clr\"><div class=\"clr\"><span class=\"cz_wh_left\"><b>الفئة</b></span></div><div class=\"cz_wh_line\"></div></div><div class=\"mb10 last0 clr\"><div class=\"clr\"><span class=\"cz_wh_left\"><b>الصالات</b></span></div><div class=\"cz_wh_line\"></div></div><div class=\"mb10 last0 clr\"><div class=\"clr\"><span class=\"cz_wh_left\"><b>الدور</b></span></div><div class=\"cz_wh_line\"></div></div></div>"
    },
    "portfolio_cat": [
        80
    ],
    "featured_media": 9158,
    "date_gmt": "2026-09-19T18:55:39",
    "modified_gmt": "2026-09-19T19:12:14"
}

DYS_9028 = {
    "id": 9028,
    "link": "https://daryusuf.com/portfolio/%d8%a3%d8%b1%d8%b6-%d8%b3%d9%83%d9%86%d9%8a%d8%a9-%d9%84%d9%84%d8%a8%d9%8a%d8%b9-%d9%81%d9%8a-%d8%ad%d9%8a-%d8%a7%d9%84%d8%b1%d9%8a%d8%a7%d8%b6-%d9%85%d8%af%d9%8a%d9%86%d8%a9-%d8%ac%d8%af%d8%a9/",
    "status": "publish",
    "title": {
        "rendered": "أرض سكنية للبيع في حي الرياض, مدينة جدة"
    },
    "content": {
        "rendered": "<h2>أرض للبيع, حي الرياض, جدة</h2>\n<h2>1,000,000 ريال</h2>\n<a class=\"cz_grid_link \" title=\"ارض الرياض\" href=\"https://daryusuf.com/wp-content/uploads/2026/09/الرياض.webp\" data-xtra-lightbox>\n<a class=\"cz_grid_link \" title=\"بغدادي\" href=\"https://daryusuf.com/wp-content/uploads/2026/09/بغدادي.webp\" data-xtra-lightbox>\n<a class=\"cz_grid_link \" title=\"ارض بغدادي\" href=\"https://daryusuf.com/wp-content/uploads/2026/09/ارض-بغدادي.webp\" data-xtra-lightbox>\n<div class=\"ue-txt\"><p>أرض سكنية للبيع</p><p><br />الموقع: جدة – حي الرياض القطعة 379/د - المخطط 184 ج س</p><p><br />المساحة: 625م</p><p><br />الأطوال : 20م*31.25م<br />الواجهة: شمالية<br />عرض الشارع: 25 متر</p><p><br />المطلوب: 1,000,000 ريال<br />السعي: 2.5%</p></div>\n            </div>\n  \n      <div class=\"ue-btn-wrap\"\n<div class=\"cz_wh cz_wh_line_between\"><div class=\"mb10 last0 clr\"><div class=\"clr\"><span class=\"cz_wh_left\"><b>نوع العقار</b></span><span class=\"cz_wh_right\">سكني</span></div><div class=\"cz_wh_line\"></div></div><div class=\"mb10 last0 clr\"><div class=\"clr\"><span class=\"cz_wh_left\"><b>المساحة</b></span><span class=\"cz_wh_right\">625م²</span></div><div class=\"cz_wh_line\"></div></div><div class=\"mb10 last0 clr\"><div class=\"clr\"><span class=\"cz_wh_left\"><b>عرض الشارع</b></span><span class=\"cz_wh_right\">25م</span></div><div class=\"cz_wh_line\"></div></div><div class=\"mb10 last0 clr\"><div class=\"clr\"><span class=\"cz_wh_left\"><b>سعر المتر</b></span><span class=\"cz_wh_right\">1600 ريال</span></div><div class=\"cz_wh_line\"></div></div></div>"
    },
    "portfolio_cat": [
        83
    ],
    "featured_media": 9029,
    "date_gmt": "2026-09-14T16:03:34",
    "modified_gmt": "2026-09-14T16:15:39"
}

DYS_MORETHAN = {
    "id": 4323,
    "link": "https://daryusuf.com/en/portfolio/shop-for-rent-on-marrah-al-tayeb-street-al-shafiyah-district-al-madinah-al-munawwarah-city-al-madinah-region/",
    "status": "publish",
    "title": {
        "rendered": "Shop for rent in Al Shafiyah district, Al Madinah"
    },
    "content": {
        "rendered": "<h2>Shop for rent on Marrah Al-Tayeb Street, Al-Shafiyah District, Al-Madinah Al-Munawwarah City, Al-Madinah Region.</h2>\n<h2>200,000 SAR Per Year</h2>\n<a class=\"cz_grid_link \" title=\"019487787_1762704484072\" href=\"https://daryusuf.com/wp-content/uploads/2026/03/019487787_1762704484072.webp\" data-xtra-lightbox>\n<a class=\"cz_grid_link \" title=\"019487788_1762704474644\" href=\"https://daryusuf.com/wp-content/uploads/2026/03/019487788_1762704474644.webp\" data-xtra-lightbox>\n<a class=\"cz_grid_link \" title=\"019487789_1762704479262\" href=\"https://daryusuf.com/wp-content/uploads/2026/03/019487789_1762704479262.webp\" data-xtra-lightbox>\n<div class=\"ue-txt\"><p style=\"text-align: left;\">(off-095)</p><p style=\"text-align: left;\">Car showrooms for rent – Al-Madinah Al-Munawwarah, Al-Shafiyah District.</p><p style=\"text-align: left;\">Area: 2250 m²</p><p style=\"text-align: left;\"><strong>Property Details:</strong><br />• 3 reinforced offices<br />• 2 large majlis (sitting rooms)<br />• 3 bathrooms<br />Suitable location for showrooms or commercial activities</p><p style=\"text-align: left;\"><strong>Asking price:</strong> 200,000 SAR<br /><strong>Commission:</strong> 5%</p></div>\n            </div>\n  \n      <div class=\"ue-btn-wrap\"\n<div class=\"cz_wh cz_wh_line_between\"><div class=\"mb10 last0 clr\"><div class=\"clr\"><span class=\"cz_wh_left\"><b>Facade</b></span><span class=\"cz_wh_right\">East</span></div><div class=\"cz_wh_line\"></div></div><div class=\"mb10 last0 clr\"><div class=\"clr\"><span class=\"cz_wh_left\"><b>Property age</b></span><span class=\"cz_wh_right\">More than 10 years</span></div><div class=\"cz_wh_line\"></div></div><div class=\"mb10 last0 clr\"><div class=\"clr\"><span class=\"cz_wh_left\"><b>Street width</b></span><span class=\"cz_wh_right\">20 m</span></div><div class=\"cz_wh_line\"></div></div><div class=\"mb10 last0 clr\"><div class=\"clr\"><span class=\"cz_wh_left\"><b>Area</b></span><span class=\"cz_wh_right\">2,250 m²</span></div><div class=\"cz_wh_line\"></div></div></div>"
    },
    "portfolio_cat": [
        183
    ],
    "featured_media": 2571,
    "date_gmt": "2026-03-28T16:19:46",
    "modified_gmt": "2026-04-02T17:09:02"
}

DYS_WAST = {
    "id": 8351,
    "link": "https://daryusuf.com/en/portfolio/shop-for-rent-in-al-hadiqah-district-madinah/",
    "status": "publish",
    "title": {
        "rendered": "Shop for Rent in Al-Hadiqah District, Madinah"
    },
    "content": {
        "rendered": "<h2>55,000 SAR/ Year</h2>\n<a class=\"cz_grid_link \" title=\"محل ورد\" href=\"https://daryusuf.com/wp-content/uploads/2026/08/محل-ورد.webp\" data-xtra-lightbox>\n<div class=\"ue-txt\"><p>(420)</p><p>Flower Shop for Transfer - Madinah - Al-Hadiqah District</p><p>Details:<br />Area: 42 m</p><p>Clean, ready-to-use décor and finishes</p><p>Flower refrigerator with a dedicated cooling unit for flower preservation<br />2 cameras<br />2 air conditioners<br />Transfer includes 2 experienced employees with over 8 years of experience<br />Google Maps rating: 4.7</p><p>Transfer includes inventory</p><p>The shop is ready for immediate takeover and operation without any setup or establishment costs. It also has an excellent reputation and a stable customer base</p><p>Required: 55,000 SAR for transfer<br />Commission: 5%</p></div>\n            </div>\n  \n      <div class=\"ue-btn-wrap\"\n<div class=\"cz_wh cz_wh_line_between\"><div class=\"mb10 last0 clr\"><div class=\"clr\"><span class=\"cz_wh_left\"><b>الواجهة</b></span><span class=\"cz_wh_right\">Wast</span></div><div class=\"cz_wh_line\"></div></div><div class=\"mb10 last0 clr\"><div class=\"clr\"><span class=\"cz_wh_left\"><b>عمر العقار</b></span><span class=\"cz_wh_right\">5 Years</span></div><div class=\"cz_wh_line\"></div></div><div class=\"mb10 last0 clr\"><div class=\"clr\"><span class=\"cz_wh_left\"><b>عرض الشارع</b></span><span class=\"cz_wh_right\">25m</span></div><div class=\"cz_wh_line\"></div></div><div class=\"mb10 last0 clr\"><div class=\"clr\"><span class=\"cz_wh_left\"><b>المساحة</b></span><span class=\"cz_wh_right\">42m²</span></div><div class=\"cz_wh_line\"></div></div></div>"
    },
    "portfolio_cat": [
        183
    ],
    "featured_media": 8346,
    "date_gmt": "2026-08-14T16:44:30",
    "modified_gmt": "2026-08-14T16:46:29"
}

DYS_PHONE = {
    "id": 7220,
    "link": "https://daryusuf.com/en/portfolio/apartment-for-sale-in-al-salamah-district-jeddah/",
    "status": "publish",
    "title": {
        "rendered": "apartment for sale in Al-Salamah district, Jeddah"
    },
    "content": {
        "rendered": "<h2> apartment for sale in Al-Salamah district, Jeddah</h2>\n<h2>660,000 SAR</h2>\n<a class=\"cz_grid_link \" title=\"شقة السلامة\" href=\"https://daryusuf.com/wp-content/uploads/2026/05/شقة-السلامةة.webp\" data-xtra-lightbox>\n<a class=\"cz_grid_link \" title=\"شقة السلامة\" href=\"https://daryusuf.com/wp-content/uploads/2026/05/شقة-السلامة.webp\" data-xtra-lightbox>\n<a class=\"cz_grid_link \" title=\"شقة السلامة\" href=\"https://daryusuf.com/wp-content/uploads/2026/05/شقة-االسلامة.webp\" data-xtra-lightbox>\n<a class=\"cz_grid_link \" title=\"شقة السلامة\" href=\"https://daryusuf.com/wp-content/uploads/2026/05/شقةة-السلامة.webp\" data-xtra-lightbox>\n<a class=\"cz_grid_link \" title=\"شقة السلامة\" href=\"https://daryusuf.com/wp-content/uploads/2026/05/السلامة.webp\" data-xtra-lightbox>\n<div class=\"ue-txt\"><p>(OFF-303)</p><p>Luxury 4-bedroom apartment for sale in Al Salamah District</p><p>Area: 129 sqm</p><p>Property features:<br />4 rooms<br />3 bathrooms<br />Kitchen<br />Living room<br />Private parking<br />Smart access<br />Independent water tanks<br />Smart access<br />Smart intercom</p><p>Asking price: 660,000 SAR<br />Buyer’s commission: 2.5%</p><p>For inquiries:<br />Dar Youssef Real Estate<br />Hatem Al Mahdhar<br />0540097993</p></div>\n            </div>\n  \n      <div class=\"ue-btn-wrap\"\n<div class=\"cz_wh cz_wh_line_between\"><div class=\"mb10 last0 clr\"><div class=\"clr\"><span class=\"cz_wh_left\"><b>الواجهة</b></span><span class=\"cz_wh_right\">east</span></div><div class=\"cz_wh_line\"></div></div><div class=\"mb10 last0 clr\"><div class=\"clr\"><span class=\"cz_wh_left\"><b>الصالات</b></span><span class=\"cz_wh_right\">1</span></div><div class=\"cz_wh_line\"></div></div><div class=\"mb10 last0 clr\"><div class=\"clr\"><span class=\"cz_wh_left\"><b>الدور</b></span><span class=\"cz_wh_right\">2</span></div><div class=\"cz_wh_line\"></div></div><div class=\"mb10 last0 clr\"><div class=\"clr\"><span class=\"cz_wh_left\"><b>المساحة</b></span><span class=\"cz_wh_right\">129m²</span></div><div class=\"cz_wh_line\"></div></div><div class=\"mb10 last0 clr\"><div class=\"clr\"><span class=\"cz_wh_left\"><b>غرف النوم</b></span><span class=\"cz_wh_right\">4</span></div><div class=\"cz_wh_line\"></div></div><div class=\"mb10 last0 clr\"><div class=\"clr\"><span class=\"cz_wh_left\"><b>دورات المياه</b></span><span class=\"cz_wh_right\">3</span></div><div class=\"cz_wh_line\"></div></div><div class=\"mb10 last0 clr\"><div class=\"clr\"><span class=\"cz_wh_left\"><b>عمر العقار</b></span><span class=\"cz_wh_right\">New</span></div><div class=\"cz_wh_line\"></div></div><div class=\"mb10 last0 clr\"><div class=\"clr\"><span class=\"cz_wh_left\"><b>نظام التكييف</b></span></div><div class=\"cz_wh_line\"></div></div></div>"
    },
    "portfolio_cat": [
        172
    ],
    "featured_media": 7214,
    "date_gmt": "2026-05-22T18:21:08",
    "modified_gmt": "2026-05-22T18:25:39"
}

# ═══════════════════════════════ 1. two posts, one listing ═══════════════════════════════════════
def test_arabic_and_english_posts_pair_on_the_source_ad_number_and_arabic_wins():
    kept, dropped = R.dedupe_translations([DYS_9355, DYS_9338, DYS_8168])
    assert [p["id"] for p in kept] == [9338, 8168] and dropped == 1
    # a pair that carries no ad number falls back to the shared featured image
    a = dict(DYS_9355, content={"rendered": "<h2>x</h2>"}); b = dict(DYS_9338, content={"rendered": "<h2>y</h2>"})
    kept, dropped = R.dedupe_translations([a, b])
    assert [p["id"] for p in kept] == [9338] and dropped == 1
    # no ad number and different images → two listings
    kept, dropped = R.dedupe_translations([a, dict(b, featured_media=1)])
    assert len(kept) == 2 and dropped == 0


def test_the_arabic_row_9338():
    row, cat, why = R.map_listing(DYS_9338, TERMS)
    assert row and not why and cat == "residential"
    assert row["ad_number"] == "DYS9338" and row["listing_url"] == DYS_9338["link"]
    assert row["property_type"] == "Apartment" and row["transaction_type"] == "Rent"
    assert (row["rent_period"], row["price_annual"]) == ("annual", 30000)
    assert row["city_ar"] == "المدينة المنورة" and row["city_id"] == 14
    assert row["district_ar"] == "حي الاسكان" and row["neighborhood"] == "حي الإسكان"
    assert (row["area_m2"], row["bedrooms"], row["bathrooms"], row["floor_number"]) == (190, 4, 4, 0)
    assert row["property_age"] is None                                  # «+10 سنوات»: open bound
    assert row["additional_info"]["source_ad_number"] == "463"
    assert row["additional_info"]["language"] == "ar"
    assert row["photo_urls"][0] == "https://daryusuf.com/wp-content/uploads/2026/09/WhatsApp-Image-2026-09-19-at-12.36.15-PM.jpeg"
    assert len(row["photo_urls"]) == 11 and " " not in "".join(row["photo_urls"])
    assert "https://daryusuf.com/wp-content/uploads/2026/09/%D8%A7%D8%B3%D9%83%D8%A7%D9%86.jpg" in row["photo_urls"]
    assert "kitchen" in row and row["kitchen"] is True                  # «مطبخ» in the prose


def test_the_english_only_row_keeps_its_text_and_maps_the_canon_9355():
    row, _, why = R.map_listing(DYS_9355, TERMS)
    assert row and not why
    assert row["title"].startswith("Apartment for Rent") and row["city_ar"] == "المدينة المنورة"
    assert (row["rent_period"], row["price_annual"]) == ("annual", 30000)    # «30,000 SAR/ Year»
    assert row["district_ar"] is None and row["neighborhood"] == "Al Iskan District"
    assert row["additional_info"]["language"] == "en"


# ═══════════════════════════════ 2. price = the heading, period = its own word ═══════════════════
def test_price_heading_shapes():
    assert R.parse_price_heading("<h2>x</h2><h2>30,000 ريال سنوي</h2>")[:2] == (30000, "سنوي")
    assert R.parse_price_heading("<h2>30,000 SAR/ Year</h2>")[:2] == (30000, "سنوي")
    assert R.parse_price_heading("<h2>SAR 27,000 per year</h2>")[:2] == (27000, "سنوي")
    assert R.parse_price_heading("<h2>1,500,000 SAR</h2>")[:2] == (1500000, None)
    assert R.parse_price_heading("<h2>75,000 ريال/ سنوي</h2>")[:2] == (75000, "سنوي")
    assert R.parse_price_heading("<h2>3,000 ريال شهري</h2>")[:2] == (3000, "شهري")
    assert R.parse_price_heading("<h1>Shop for rent in Jafar Al-Ansari Street, Medina</h1>") == (None, None, None)
    assert R.parse_price_heading("<h2>2800</h2>")[:2] == (2800, None)     # a bare number, as printed
    assert R.parse_price_heading("<h2>2800</h2><h2>3,000 SAR</h2>")[:2] == (3000, None)


def test_bare_heading_takes_its_period_from_the_prose_beside_the_figure_8168():
    row, _, why = R.map_listing(DYS_8168, TERMS)
    assert row and not why
    assert (row["rent_period"], row["price_annual"]) == ("monthly", 33600)
    assert row["additional_info"]["price_evidence"]["raw"] == "2800"
    assert row["furnished"] is True


def test_prose_period_is_bound_to_the_rent_word_and_our_figure():
    assert R.rent_period_stated(220000, "Annual Rent: 220,000 SAR Commission 2.5%") == ("annual", 220000)
    assert R.rent_period_stated(75000, "Monthly rent: 4,000 SAR Annual rent: 48,000 SAR") == (None, 75000)
    assert R.rent_period_stated(2800, "2800 SAR / Monthly (Off-408)") == ("monthly", 33600)
    assert R.rent_period_stated(500, "rent 500 SAR daily") == (None, None)
    assert R.rent_period_stated(75000, "close to daily services") == (None, 75000)
    assert R.rent_period_stated(75000, "") == (None, 75000)


def test_a_plot_with_a_total_and_a_rate_stores_both_and_multiplies_nothing_9028():
    row, _, why = R.map_listing(DYS_9028, TERMS)
    assert row and not why
    assert row["property_type"] == "Residential Land" and row["transaction_type"] == "Buy"
    assert row["price_total"] == 1000000 and row["price_per_meter"] == 1600 and row["area_m2"] == 625
    assert row["bedrooms"] is None and row["bathrooms"] is None
    assert row["direction"] is None and row["street_width_m"] == 25       # no facade fact on this plot


# ═══════════════════════════════ 3. skips, never guesses ═════════════════════════════════════════
def test_landmarks_and_tenants_are_not_statuses_and_a_missing_category_reads_the_title():
    # These three decoys sit in content.rendered, never in the title map_listing actually scans —
    # they pass by the title-only SCOPE, not by any decoy guard in the regex (reviewer-confirmed
    # 2026-09-24: mutating _OFFPLAN_TITLE_RE's lookaround does not turn this line red).
    assert R.map_listing(DYS_4354, TERMS)[2] == ""                      # «Furniture Auction» landmark (body)
    assert R.map_listing(DYS_3422, TERMS)[2] == ""                      # «مؤجرة بالكامل» tenants (body)
    assert R.map_listing(DYS_6920, TERMS)[2] == ""                      # «تقريباً» (body)
    # The «تقريباً» lookaround guard IS real code (contains «قريباً» but is not «قريباً» itself) —
    # exercised here where the regex actually reads: the TITLE. Mutating the lookaround turns this red.
    assert R.map_listing(dict(DYS_9338, title={"rendered": "شقة تقريباً جاهزة، المدينة المنورة"}), TERMS)[2] == ""
    row, _, why = R.map_listing(DYS_3823, TERMS)                        # portfolio_cat == []
    assert row and not why and row["property_type"] == "Building" and row["transaction_type"] == "Buy"
    assert row["price_total"] == 1500000
    assert R.deal_and_type_from_title("Residential land for sale in Al Rabwah district, Jeddah") == ("Buy", "Residential Land")
    assert R.deal_and_type_from_title("شقة للإيجار في حي الإسكان") == ("Rent", "Apartment")
    assert R.deal_and_type_from_title("مزرعة") == (None, None)
    assert R.map_listing(dict(DYS_3823, title={"rendered": "Something in Madinah"}), TERMS)[2] == "deal_unknown"
    assert R.map_listing(dict(DYS_9338, portfolio_cat=[273]), TERMS)[2] == "deal_unknown"   # «محطات»
    assert R.map_listing(dict(DYS_9338, title={"rendered": "شقة للإيجار في حي الإسكان"}), TERMS)[2] == "city_not_stated"
    assert R.map_listing(dict(DYS_9338, title={"rendered": "شقة للإيجار، تبوك"}), TERMS)[2] == "city_not_stated"
    assert R.map_listing(dict(DYS_9338, title={"rendered": "مزاد شقة، المدينة المنورة"}), TERMS)[2] == "auction"
    assert R.map_listing(dict(DYS_9338, title={"rendered": "شقة تم البيع، المدينة المنورة"}), TERMS)[2] == "sold_or_rented"
    assert R.map_listing(dict(DYS_9338, title={"rendered": "شقة على الخارطة، المدينة المنورة"}), TERMS)[2] == "off_plan"
    assert R.map_listing(dict(DYS_9338, status="draft"), TERMS)[2] == "status_draft"
    assert R.deal_and_type("apartments-for-rent") == ("Rent", "Apartment")
    assert R.deal_and_type("أراضي-للبيع") == ("Buy", "Residential Land")
    assert R.deal_and_type("محطات") == (None, None)


def test_city_is_recognised_from_a_closed_set_in_both_languages():
    assert R.city_in_title("Villa for Sale, Al Rehab District, Jeddah") == "جدة"
    assert R.city_in_title("Apartment for Rent, Shatha District, Madinah") == "المدينة المنورة"
    assert R.city_in_title("شقة للبيع في حي ناردين, مدينة الملك عبدالله الاقتصادية") == "مدينة الملك عبدالله الاقتصادية"
    assert R.city_in_title("عمارة للبيع في حي قروى, مدينة الطائف") == "الطائف"
    assert R.city_in_title("Building for sale in Bani Muawiyah district, Al Madinah") == "المدينة المنورة"
    assert R.city_in_title("مستودع للإيجار") is None


# ═══════════════════════════════ 4. facts: labels drift, values lie ══════════════════════════════
def test_facts_widget_labels_and_values():
    facts = R.parse_facts(DYS_9338["content"]["rendered"])
    assert facts["area"] == "190م" and facts["bedrooms"] == "4" and facts["bathrooms"] == "4"
    assert facts["age"] == "+10 سنوات" and facts["tenants"] == "عوائل" and facts["floor"] == "ارضي"
    assert "halls" not in facts                                         # label with no value
    assert R.parse_area("49,69م²") == 49 and R.parse_area("2,500") == 2500 and R.parse_area("400 m²") == 400
    row, _, _ = R.map_listing(DYS_9157, TERMS)
    assert row["area_m2"] == 49 and row["additional_info"]["facts"]["area"] == "49,69م²"
    assert R.parse_age("More than 10 years") is None and R.parse_age("Over 10 years") is None
    assert R.parse_age("New") == 0 and R.parse_age("4 Years") == 4 and R.parse_age("جديد") == 0
    assert R.parse_age("سنتين ونصف") is None
    assert R.parse_direction("Wast") is None and R.parse_direction("North") == "شمال"
    assert R.parse_direction("Northwest") is None and R.parse_direction("شرق") == "شرق"
    assert R.parse_floor("Ground floor") == 0 and R.parse_floor("2") == 2 and R.parse_floor("Basement") is None
    row, _, _ = R.map_listing(DYS_MORETHAN, TERMS)
    assert row["property_age"] is None and row["additional_info"]["facts"]["age"] == "More than 10 years"
    row, _, _ = R.map_listing(DYS_WAST, TERMS)
    assert row["direction"] is None and row["additional_info"]["facts"]["direction"] == "Wast"


def test_a_stated_ac_or_driver_room_negation_lands_False_not_NULL():
    """Reviewer-confirmed defect (2026-09-24): both fields were written by an if-only True
    assignment that can structurally never produce False — a stated negation («بدون تكييف») or an
    explicit stated zero («0» driver's rooms) landed NULL instead of False. Not observed live (no
    shipped row currently states either negation), so this is a synthetic widget-row addition on
    top of the verbatim DYS_9338 fixture, in the shape parse_facts actually reads."""
    extra = ('<div class="mb10 last0 clr"><div class="clr"><span class="cz_wh_left"><b>'
             "Driver's room</b></span><span class=\"cz_wh_right\">0</span></div></div>"
             '<div class="mb10 last0 clr"><div class="clr"><span class="cz_wh_left"><b>'
             'نظام التكييف</b></span><span class="cz_wh_right">بدون تكييف</span></div></div>')
    content = dict(DYS_9338["content"], rendered=DYS_9338["content"]["rendered"] + extra)
    row, _, why = R.map_listing(dict(DYS_9338, content=content), TERMS)
    assert not why
    assert row["air_conditioner"] is False and row["driver_room"] is False
    # A stated Split unit and a stated "2" still read True (the non-negated path is untouched).
    extra_true = extra.replace("بدون تكييف", "Split AC").replace(">0<", ">2<")
    content_true = dict(DYS_9338["content"], rendered=DYS_9338["content"]["rendered"] + extra_true)
    row2, _, _ = R.map_listing(dict(DYS_9338, content=content_true), TERMS)
    assert row2["air_conditioner"] is True and row2["driver_room"] is True


# ═══════════════════════════════ 5. PII ══════════════════════════════════════════════════════════
def test_a_phone_in_the_body_never_reaches_the_row_7220():
    row, _, _ = R.map_listing(DYS_PHONE, TERMS)
    blob = json.dumps(row, ensure_ascii=False, default=str)
    assert "[redacted]" in row["description"]
    import re
    assert not re.search(r"05\d{8}|\+966\s*5", blob), blob[:200]


# ═══════════════════════════════ 6. transport ════════════════════════════════════════════════════
class _Resp:
    def __init__(self, status, body, total=None):
        self.status_code, self.text, self.headers = status, body, {"x-wp-total": str(total or 0)}

    def json(self):
        return json.loads(self.text)


class _Session:
    def __init__(self, answers):
        self.answers, self.calls = list(answers), []

    def get(self, url, params=None, timeout=None):
        self.calls.append((url, dict(params or {})))
        return self.answers.pop(0)


def test_fetch_posts_walks_pages_dedupes_and_reports_x_wp_total(monkeypatch):
    monkeypatch.setattr(R.time, "sleep", lambda *_: None)
    page1 = [dict(DYS_9338, id=i) for i in range(100)]
    s = _Session([_Resp(200, json.dumps(page1), total=101), _Resp(200, json.dumps([DYS_9338, page1[0]]), total=101)])
    posts, expected = R.fetch_posts(s)
    assert len(posts) == 101 and expected == 101 and s.calls[1][1]["page"] == 2
    with pytest.raises(RuntimeError):
        R.fetch_posts(_Session([_Resp(200, "<html>")]))
    with pytest.raises(RuntimeError):
        R.fetch_posts(_Session([_Resp(503, "")]))


# ═══════════════════════════════ 7. the oracle ═══════════════════════════════════════════════════
def test_signal_reads_the_measured_shapes():
    sig = R._signal_for(9338)
    assert sig(404, '{"code":"rest_post_invalid_id","message":"x"}', False) == "gone"
    assert sig(200, '{"id":9338,"status":"publish"}', False) == "live"
    assert sig(200, '{"id":9338,"status":"draft"}', False) == "gone"
    assert sig(200, '{"id":9355,"status":"publish"}', False) is None
    assert sig(404, '<html>Page not found</html>', False) is None
    assert R._verify_gone("DYSx")[0] == "unknown"


# ═══════════════════════════════ 8. main(): pairs, tally, gate, literal tables ═══════════════════
def _stub_db(monkeypatch):
    calls = {"batch": [], "end_run": [], "prune": [], "retire": []}
    db = types.SimpleNamespace(
        begin_run=lambda platform: 77,
        _wasalt_batch=lambda table, rows: calls["batch"].append((table, [r["ad_number"] for r in rows])),
        retire_superseded_siblings=lambda **kw: calls["retire"].append(kw) or 0,
        prune_unseen=lambda table, seen, source=None, **kw: calls["prune"].append((table, sorted(seen), kw)) or 0,
        end_run=lambda run_id, **kw: calls["end_run"].append((run_id, kw)) or True,
    )
    monkeypatch.setattr(R, "db", db)
    monkeypatch.setattr(R.time, "sleep", lambda *_: None)
    monkeypatch.setattr(R, "session", lambda: object())
    monkeypatch.setattr(R, "fetch_terms", lambda s: dict(TERMS))
    return calls


_POSTS = [DYS_9355, DYS_9338, DYS_MORETHAN, DYS_9028,
          dict(DYS_9338, id=1, title={"rendered": "شقة للإيجار في حي الإسكان"}, content={"rendered": "<h2>1</h2>"}, featured_media=0)]


def test_main_pairs_twins_tallies_skips_and_prunes_only_behind_a_complete_walk_and_the_control(monkeypatch):
    calls = _stub_db(monkeypatch)
    monkeypatch.setattr(R, "fetch_posts", lambda s, limit=0: (list(_POSTS), 5))
    monkeypatch.setattr(R, "_controls_live", lambda ads: False)
    monkeypatch.setattr(sys, "argv", ["run.py"])
    assert R.main() == 0
    assert calls["batch"] == [("daryusuf_residential_listings", ["DYS9338", "DYS9028"]),
                              ("daryusuf_commercial_listings", ["DYS4323"])]
    assert calls["retire"][0]["res_table"] == "daryusuf_residential_listings"
    assert calls["prune"] == []
    run_id, kw = calls["end_run"][0]
    assert run_id == 77 and kw["ok"] is True and kw["rows_seen"] == 5 and kw["rows_upserted"] == 3
    for tally in ("translation_twinx1", "city_not_statedx1", "pruned=0", "walk=5/5"):
        assert tally in kw["notes"], (tally, kw["notes"])
    assert kw["degraded"] is False
    assert kw["check_tables"] == ["daryusuf_residential_listings", "daryusuf_commercial_listings"]

    calls = _stub_db(monkeypatch)
    monkeypatch.setattr(R, "_controls_live", lambda ads: ads[:1] == ["DYS9338"])
    assert R.main() == 0
    assert [p[0] for p in calls["prune"]] == ["daryusuf_residential_listings", "daryusuf_commercial_listings"]
    assert calls["prune"][0][1] == ["DYS9028", "DYS9338"] and calls["prune"][0][2]["verify_gone"] is R._verify_gone

    calls = _stub_db(monkeypatch)
    monkeypatch.setattr(R, "fetch_posts", lambda s, limit=0: (list(_POSTS), 290))     # x-wp-total says more
    assert R.main() == 0
    assert calls["prune"] == [] and calls["end_run"][0][1]["degraded"] is True


def test_a_blocked_walk_is_a_failed_run_that_writes_nothing(monkeypatch):
    calls = _stub_db(monkeypatch)

    def blocked(s, limit=0):
        raise RuntimeError("portfolio page 1: not JSON")
    monkeypatch.setattr(R, "fetch_posts", blocked)
    monkeypatch.setattr(sys, "argv", ["run.py"])
    assert R.main() == 1
    assert calls["batch"] == [] and calls["prune"] == []
    assert calls["end_run"][0][1]["ok"] is False and "not JSON" in calls["end_run"][0][1]["notes"]


def test_session_asks_for_arabic_json_and_never_sets_a_user_agent():
    s = R.session()
    assert s.headers["Accept"] == "application/json" and s.headers["Accept-Language"].startswith("ar")
    assert "User-Agent" not in s.headers and "user-agent" not in s.headers
