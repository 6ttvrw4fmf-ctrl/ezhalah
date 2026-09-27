"""OFFLINE barrier for scrapers/wadod/run.py — the real functions, fed real wadod.sa markup.

No network, no database. FX holds verbatim fragments captured 2026-09-24 (svg/style/Alpine/Livewire
attributes removed, tags and text untouched): three catalogue cards — property 92 («متاح», linked),
84 («مؤجر», no link) and 48 (sale, sold overlay, no link) — and the detail pages of 92 (Apartment,
«دفعة واحدة», age 2, floor الثاني) and 85 (Floor, «دفعتين», «مؤثثة», age «جديد»). to_catalog /
city_ar_for / find_district_in_text are the only things patched; CATALOG is what production returned
for those strings on 2026-09-24.
"""
from __future__ import annotations

import json
import sys
import types
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

from scrapers.wadod import run as R  # noqa: E402

FX = json.loads(r"""{"cards": ["<a wire:key=\"property-92\" href=\"https://wadod.sa/property/92\" class=\"block group h-full\" wire:navigate><div class=\"bg-white border border-[#E2E8F0] rounded-xl shadow-sm overflow-hidden hover:shadow-md hover:border-primery/30 transition-all duration-300 h-full flex flex-col\"><div class=\"relative h-48 md:h-52 overflow-hidden\"><img class=\"h-full w-full object-cover object-center group-hover:scale-105 transition-transform duration-300\" src=\"https://amzn-s3-wadod-bucket1-wadod.s3.eu-central-1.amazonaws.com/propertiesImages/f9cc9931-7901-4e93-b255-f86b48e94b47-27946.webp\" /><div class=\"absolute top-4 right-4 flex gap-2\"><span class=\"inline-flex items-center gap-1 bg-yellow-100 text-yellow-800 text-xs font-bold px-2.5 py-1 rounded-md\"><i class=\"fa-solid fa-clock\"></i> إيجار </span><span class=\"inline-flex items-center gap-1 bg-green-100 text-green-800 text-xs font-bold px-2.5 py-1 rounded-md\"><i class=\"fa-solid fa-check\"></i> متاح </span></div></div><div class=\"p-4 md:p-5 flex-1 flex flex-col\"><div class=\"flex flex-col gap-3\"><div class=\"flex flex-row-reverse items-center\"><span class=\"text-xl md:text-2xl font-bold text-primery text-right block w-full\"> 65,000 <span class=\"icon-saudi_riyal text-lg\"></span></span></div><h4 class=\"text-base md:text-lg font-bold text-[#020617] group-hover:text-primery transition-colors line-clamp-2 wrap-break-word leading-tight text-right min-w-0\"> شقة دورين للإيجار في حي العارض بسطح وموقف خاص </h4></div><div class=\"mt-4 space-y-3 flex-1\"><div class=\"flex items-start gap-2 text-[#62748E]\"><i class=\"fa-solid fa-map-marker-alt text-primery mt-0.5 shrink-0 text-sm\"></i><span class=\"text-xs md:text-sm font-medium text-right wrap-break-word leading-relaxed min-w-0 flex-1 line-clamp-2\"> شمال الرياض - حي العارض </span></div><div class=\"flex items-center flex-wrap gap-3 text-[#62748E] text-xs md:text-sm\"><div class=\"flex items-center gap-1.5 min-w-0\"><i class=\"fa-solid fa-bed shrink-0 text-primery/70\"></i><span class=\"truncate\">3 غرف نوم</span></div><div class=\"flex items-center gap-1.5 min-w-0\"><i class=\"fa-solid fa-bath shrink-0 text-primery/70\"></i><span class=\"truncate\">3 دورات مياه</span></div><div class=\"flex items-center gap-1.5 min-w-0\"><i class=\"fa-solid fa-ruler-combined shrink-0 text-primery/70\"></i><span class=\"truncate\">140 م²</span></div></div></div></div> </div></div></a>", "<a wire:key=\"property-84\" class=\"block group h-full\"><div class=\"bg-white border border-[#E2E8F0] rounded-xl shadow-sm overflow-hidden hover:shadow-md hover:border-primery/30 transition-all duration-300 h-full flex flex-col\"><div class=\"relative h-48 md:h-52 overflow-hidden\"><img class=\"h-full w-full object-cover object-center group-hover:scale-105 transition-transform duration-300\" src=\"https://amzn-s3-wadod-bucket1-wadod.s3.eu-central-1.amazonaws.com/propertiesImages/1893465a-e548-47f2-8f7d-fe33fed25608-55846.webp\" /><div class=\"absolute top-4 right-4 flex gap-2\"><span class=\"inline-flex items-center gap-1 bg-yellow-100 text-yellow-800 text-xs font-bold px-2.5 py-1 rounded-md\"><i class=\"fa-solid fa-clock\"></i> إيجار </span><span class=\"inline-flex items-center gap-1 bg-blue-100 text-blue-800 text-xs font-bold px-2.5 py-1 rounded-md\"><i class=\"fa-solid fa-key\"></i> مؤجر </span></div></div><div class=\"p-4 md:p-5 flex-1 flex flex-col\"><div class=\"flex flex-col gap-3\"><div class=\"flex flex-row-reverse items-center\"><span class=\"text-xl md:text-2xl font-bold text-primery text-right block w-full\"> 80,000 <span class=\"icon-saudi_riyal text-lg\"></span></span></div><h4 class=\"text-base md:text-lg font-bold text-[#020617] group-hover:text-primery transition-colors line-clamp-2 wrap-break-word leading-tight text-right min-w-0\"> شقة مؤثثة للإيجار </h4></div><div class=\"mt-4 space-y-3 flex-1\"><div class=\"flex items-start gap-2 text-[#62748E]\"><i class=\"fa-solid fa-map-marker-alt text-primery mt-0.5 shrink-0 text-sm\"></i><span class=\"text-xs md:text-sm font-medium text-right wrap-break-word leading-relaxed min-w-0 flex-1 line-clamp-2\"> شمال الرياض - حي العارض </span></div><div class=\"flex items-center flex-wrap gap-3 text-[#62748E] text-xs md:text-sm\"><div class=\"flex items-center gap-1.5 min-w-0\"><i class=\"fa-solid fa-bed shrink-0 text-primery/70\"></i><span class=\"truncate\">3 غرف نوم</span></div><div class=\"flex items-center gap-1.5 min-w-0\"><i class=\"fa-solid fa-bath shrink-0 text-primery/70\"></i><span class=\"truncate\">3 دورات مياه</span></div><div class=\"flex items-center gap-1.5 min-w-0\"><i class=\"fa-solid fa-ruler-combined shrink-0 text-primery/70\"></i><span class=\"truncate\">145 م²</span></div></div></div></div> </div></div></a>", "<a wire:key=\"property-48\" class=\"block group h-full\"><div class=\"bg-white border border-[#E2E8F0] rounded-xl shadow-sm overflow-hidden hover:shadow-md hover:border-primery/30 transition-all duration-300 h-full flex flex-col\"><div class=\"relative h-48 md:h-52 overflow-hidden\"><img class=\"h-full w-full object-cover object-center group-hover:scale-105 transition-transform duration-300\" src=\"https://amzn-s3-wadod-bucket1-wadod.s3.eu-central-1.amazonaws.com/propertiesImages/dceef1d0-e415-4468-b5fb-96ed399fe34e-19434.webp\" /><div class=\"absolute inset-0 bg-black/50 flex items-center justify-center\"><img src=\"https://wadod.sa/images/sold_icon.png\" class=\"w-32 h-32 md:w-40 md:h-40 object-contain\"></div></div><div class=\"p-4 md:p-5 flex-1 flex flex-col\"><div class=\"flex flex-col gap-3\"><div class=\"flex flex-row-reverse items-center\"><span class=\"text-xl md:text-2xl font-bold text-primery text-right block w-full\"> 2,700,000 <span class=\"icon-saudi_riyal text-lg\"></span></span></div><h4 class=\"text-base md:text-lg font-bold text-[#020617] group-hover:text-primery transition-colors line-clamp-2 wrap-break-word leading-tight text-right min-w-0\"> فيلا دوبلكس للبيع </h4></div><div class=\"mt-4 space-y-3 flex-1\"><div class=\"flex items-start gap-2 text-[#62748E]\"><i class=\"fa-solid fa-map-marker-alt text-primery mt-0.5 shrink-0 text-sm\"></i><span class=\"text-xs md:text-sm font-medium text-right wrap-break-word leading-relaxed min-w-0 flex-1 line-clamp-2\"> شمال الرياض - حي العارض </span></div><div class=\"flex items-center flex-wrap gap-3 text-[#62748E] text-xs md:text-sm\"><div class=\"flex items-center gap-1.5 min-w-0\"><i class=\"fa-solid fa-bed shrink-0 text-primery/70\"></i><span class=\"truncate\">4 غرف نوم</span></div><div class=\"flex items-center gap-1.5 min-w-0\"><i class=\"fa-solid fa-bath shrink-0 text-primery/70\"></i><span class=\"truncate\">5 دورات مياه</span></div><div class=\"flex items-center gap-1.5 min-w-0\"><i class=\"fa-solid fa-ruler-combined shrink-0 text-primery/70\"></i><span class=\"truncate\">212 م²</span></div></div></div></div> </div></div></a>"], "p92": "<h1> شقة دورين للإيجار في حي العارض بسطح وموقف خاص</h1><div><i></i><span>حي العارض, الرياض</span></div></div></div><div><div><span class=\"text-xl md:text-2xl font-bold text-primery\">65,000</span><span class=\"icon-saudi_riyal font-bold\"></span><span>دفعة واحدة</span></div></div></div><div><div><div><button><i></i><span>مشاركة</span><i></i></button><div @click.outside=\"showShareMenu = false\" x-cloak><div><div> شارك على مواقع التواصل الاجتماعي </div><button><div><i></i></div><span>واتساب</span></button><button><div><i></i></div><span>فيسبوك</span></button><button><div><i></i></div><span>X</span></button><button><div><i></i></div><span>انستغرام</span></button><button><div><i></i></div><span>سناب شات</span></button><div></div><button><div><i></i></div><span></span></button></div></div><div x-cloak><i></i> تم نسخ الرابط إلى الحافظة </div></div><a href=\"https://wa.me/+966500080324?text=%D9%85%D8%B1%D8%AD%D8%A8%D9%8B%D8%A7%D8%8C+%D8%A3%D9%88%D8%AF+%D9%85%D8%B9%D8%B1%D9%81%D8%A9+%D8%A7%D9%84%D9%85%D8%B2%D9%8A%D8%AF+%D8%B9%D9%86+%D8%A7%D9%84%D8%B9%D9%82%D8%A7%D8%B1++https%3A%2F%2Fwadod.sa%2Fproperty%2F92\"><i></i><span>واتساب</span></a></div></div></div></div><div><div><div><i class=\"fa-solid fa-align-right text-primery text-sm\"></i></div><h2>وصف العقار</h2></div><div><p>شقة للإيجار في حي العارض بالرياض بنظام دورين، تتميز بسطح خاص وموقف سيارة خاص، وتتكون من غرفتين نوم ومجلس وصالة ومطبخ راكب بالأجهزة ومكيفات راكبة</p></div></div><div><div><div><div><div><iframe src=\"https://www.google.com/maps/embed?pb=!1m17!1m12!1m3!1d3619.18527906593!2d46.61456468499643!3d24.891660984039213!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m2!1m1!2zMjTCsDUzJzMwLjAiTiA0NsKwMzYnNDQuNiJF!5e0!3m2!1sar!2ssa!4v1787350194357!5m2!1sar!2ssa\" allowfullscreen=\"\" referrerpolicy=\"strict-origin-when-cross-origin\"></iframe></div></div><div><div><div><i class=\"fa-solid fa-list-check text-primery text-sm\"></i></div><h3>مميزات العقار</h3></div><div><div><div><i></i></div><span>صراف آلي</span></div><div><div><i></i></div><span>مسجد</span></div><div><div><i></i></div><span>مدرسة</span></div><div><div><i></i></div><span>مستشفى</span></div><div><div><i></i></div><span>صيدلية</span></div><button class=\"flex items-center gap-2 px-3 py-2 rounded-lg border border-primery/40 bg-primery/10 hover:bg-primery/20 text-primery font-medium transition-colors\"><span>عرض المزيد</span><i></i><span>+19</span></button></div></div></div></div><div><div><div><div><i class=\"fa-solid fa-info-circle text-primery text-sm\"></i></div><h2>المعلومات الأساسية للعقار</h2></div><div><div><div><i class=\"fa-solid fa-id-card text-primery text-sm\"></i></div><div><span>رقم الترخيص</span><span>7201096781</span></div></div><div><div><i class=\"fa-solid fa-house text-primery text-sm\"></i></div><div><span>نوع العقار</span><span>شقة</span></div></div><div><div><i class=\"fa-solid fa-ruler-combined text-primery text-sm\"></i></div><div><span>المساحة</span><span>140 م²</span></div></div><div><div><i class=\"fa-solid fa-tag text-primery text-sm\"></i></div><div><span>نوع العرض</span><span>إيجار</span></div></div><div><div><i class=\"fa-solid fa-layer-group text-primery text-sm\"></i></div><div><span>الطابق</span><span>الثاني</span></div></div><div><div><i class=\"fa-solid fa-bed text-primery text-sm\"></i></div><div><span>غرف النوم</span><span>3</span></div></div><div><div><i class=\"fa-solid fa-bath text-primery text-sm\"></i></div><div><span>دورات مياه</span><span>3</span></div></div><div><div><i class=\"fa-solid fa-couch text-primery text-sm\"></i></div><div><span>صالات المعيشة</span><span>1</span></div></div></div></div></div></div><div><div><div><i class=\"fa-solid fa-list text-primery text-sm\"></i></div><h2>تفاصيل العقار</h2></div><div><div><div><i class=\"fa-solid fa-kitchen-set text-primery text-sm\"></i></div><div><span>المطبخ</span><span><i class='fa-solid fa-check text-green-500'></i></span></div></div><div><div><i class=\"fa-solid fa-fan text-primery text-sm\"></i></div><div><span>المكيفات</span><span><i class='fa-solid fa-check text-green-500'></i></span></div></div><div><div><i class=\"fa-solid fa-square-parking text-primery text-sm\"></i></div><div><span>المواقف</span><span><i class='fa-solid fa-check text-green-500'></i></span></div></div><div><div><i class=\"fa-solid fa-elevator text-primery text-sm\"></i></div><div><span>المصعد</span><span><i class='fa-solid fa-check text-green-500'></i></span></div></div><div><div><i class=\"fa-solid fa-couch text-primery text-sm\"></i></div><div><span>صالة</span><span><i class='fa-solid fa-check text-green-500'></i></span></div></div><div><div><i class=\"fa-solid fa-clock text-primery text-sm\"></i></div><div><span>عمر العقار</span><span>2</span></div></div></div></div></div><div><div><div><i class=\"fa-solid fa-layer-group text-primery\"></i></div><div><h2>", "p85": "<h1> دور للإيجار مؤثث بالكامل </h1><div><i></i><span>حي النرجس, الرياض</span></div></div></div><div><div><span class=\"text-xl md:text-2xl font-bold text-primery\">120,000</span><span class=\"icon-saudi_riyal font-bold\"></span><span>دفعتين</span></div></div></div><div><div><div><button><i></i><span>مشاركة</span><i></i></button><div @click.outside=\"showShareMenu = false\" x-cloak><div><div> شارك على مواقع التواصل الاجتماعي </div><button><div><i></i></div><span>واتساب</span></button><button><div><i></i></div><span>فيسبوك</span></button><button><div><i></i></div><span>X</span></button><button><div><i></i></div><span>انستغرام</span></button><button><div><i></i></div><span>سناب شات</span></button><div></div><button><div><i></i></div><span></span></button></div></div><div x-cloak><i></i> تم نسخ الرابط إلى الحافظة </div></div><a href=\"https://wa.me/+966500080324?text=%D9%85%D8%B1%D8%AD%D8%A8%D9%8B%D8%A7%D8%8C+%D8%A3%D9%88%D8%AF+%D9%85%D8%B9%D8%B1%D9%81%D8%A9+%D8%A7%D9%84%D9%85%D8%B2%D9%8A%D8%AF+%D8%B9%D9%86+%D8%A7%D9%84%D8%B9%D9%82%D8%A7%D8%B1++https%3A%2F%2Fwadod.sa%2Fproperty%2F85\"><i></i><span>واتساب</span></a></div></div></div></div><div><div><div><i class=\"fa-solid fa-align-right text-primery text-sm\"></i></div><h2>وصف العقار</h2></div><div><p>دور للإيجار مؤثث بالكامل | جلسة خارجية خاصة جاهز للسكن | دور مؤثث فاخر مع غرفة خادمة وجلسة خارجية – حي النرجس في موقع مميز بالقرب من طريق الملك سلمان، طريق الثمامة، ومطار الملك خالد. يتكون من مجلس، صالة واسعة، جلسة خارجية خاصة، مطبخ، غرفة خادمة، 3 غرف نوم (منها غرفة ماستر)، تكييف مركزي، ومؤثث بالكامل بأثاث جديد. جاهز للسكن فورًا. Move-In Ready | Luxury Furnished Floor with Maid’s Room – Al Narjis Prime location near King Salman Road, Al Thumamah Road, and King Khalid International Airport. Features a majlis, spacious living room, private outdoor seating, kitchen, maid’s room, 3 bedrooms (1 master), central air conditioning, and is fully furnished with brand-new furniture. Ready for immediate move-in</p></div></div><div><div><div><div><div><iframe src=\"https://www.google.com/maps/embed?pb=!1m17!1m12!1m3!1d3621.331078195527!2d46.68279568499821!3d24.818348984073804!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m2!1m1!2zMjTCsDQ5JzA2LjEiTiA0NsKwNDAnNTAuMiJF!5e0!3m2!1sar!2ssa!4v1784155348884!5m2!1sar!2ssa\" allowfullscreen=\"\" referrerpolicy=\"strict-origin-when-cross-origin\"></iframe></div></div><div><div><div><i class=\"fa-solid fa-list-check text-primery text-sm\"></i></div><h3>مميزات العقار</h3></div><div><div><i></i></div><p>لا يوجد ميزات متاحة لهذا العقار</p></div></div></div></div><div><div><div><div><i class=\"fa-solid fa-info-circle text-primery text-sm\"></i></div><h2>المعلومات الأساسية للعقار</h2></div><div><div><div><i class=\"fa-solid fa-id-card text-primery text-sm\"></i></div><div><span>رقم الترخيص</span><span>7201036298</span></div></div><div><div><i class=\"fa-solid fa-house text-primery text-sm\"></i></div><div><span>نوع العقار</span><span>دور</span></div></div><div><div><i class=\"fa-solid fa-ruler-combined text-primery text-sm\"></i></div><div><span>المساحة</span><span>172 م²</span></div></div><div><div><i class=\"fa-solid fa-tag text-primery text-sm\"></i></div><div><span>نوع العرض</span><span>إيجار</span></div></div><div><div><i class=\"fa-solid fa-layer-group text-primery text-sm\"></i></div><div><span>الطابق</span><span>الأول</span></div></div><div><div><i class=\"fa-solid fa-bed text-primery text-sm\"></i></div><div><span>غرف النوم</span><span>3</span></div></div><div><div><i class=\"fa-solid fa-bath text-primery text-sm\"></i></div><div><span>دورات مياه</span><span>4</span></div></div><div><div><i class=\"fa-solid fa-couch text-primery text-sm\"></i></div><div><span>صالات المعيشة</span><span>1</span></div></div></div></div></div></div><div><div><div><i class=\"fa-solid fa-list text-primery text-sm\"></i></div><h2>تفاصيل العقار</h2></div><div><div><div><i class=\"fa-solid fa-kitchen-set text-primery text-sm\"></i></div><div><span>المطبخ</span><span><i class='fa-solid fa-check text-green-500'></i></span></div></div><div><div><i class=\"fa-solid fa-fan text-primery text-sm\"></i></div><div><span>المكيفات</span><span><i class='fa-solid fa-check text-green-500'></i></span></div></div><div><div><i class=\"fa-solid fa-square-parking text-primery text-sm\"></i></div><div><span>المواقف</span><span><i class='fa-solid fa-check text-green-500'></i></span></div></div><div><div><i class=\"fa-solid fa-couch text-primery text-sm\"></i></div><div><span>مؤثثة</span><span><i class='fa-solid fa-check text-green-500'></i></span></div></div><div><div><i class=\"fa-solid fa-elevator text-primery text-sm\"></i></div><div><span>المصعد</span><span><i class='fa-solid fa-check text-green-500'></i></span></div></div><div><div><i class=\"fa-solid fa-couch text-primery text-sm\"></i></div><div><span>صالة</span><span><i class='fa-solid fa-check text-green-500'></i></span></div></div><div><div><i class=\"fa-solid fa-clock text-primery text-sm\"></i></div><div><span>عمر العقار</span><span>جديد</span></div></div></div></div></div><div><div><div><i class=\"fa-solid fa-layer-group text-primery\"></i></div><div><h2>"}""")
AVAIL_CARD, RENTED_CARD, SOLD_CARD = FX["cards"]
CATALOG = {"الرياض": (3, 1)}        # «شمال الرياض», «حي العارض», «مدينة الرياض» resolve to nothing
DISTRICTS = {("حي العارض, الرياض", 3): "حي العارض", ("حي النرجس, الرياض", 3): "حي النرجس",
             ("شمال الرياض - حي العارض", 3): "حي العارض"}


@pytest.fixture(autouse=True)
def _catalog(monkeypatch):
    monkeypatch.setattr(R, "to_catalog", lambda s, hint=None: CATALOG.get((s or "").strip(), (None, None)))
    monkeypatch.setattr(R, "city_ar_for", lambda cid: {3: "الرياض"}.get(cid))
    monkeypatch.setattr(R, "find_district_in_text", lambda text, cid: DISTRICTS.get(((text or "").strip(), cid)))


def _cards():
    return R.parse_cards(AVAIL_CARD + RENTED_CARD + SOLD_CARD)


# ── catalogue cards ───────────────────────────────────────────────────────────────────────────────

def test_cards_carry_id_status_link_price_location_and_cover():
    a, r, s = _cards()
    assert (a["id"], a["href"], a["badges"], a["sold"]) == (92, "https://wadod.sa/property/92", ["إيجار", "متاح"], False)
    assert (r["id"], r["href"], r["badges"]) == (84, None, ["إيجار", "مؤجر"])
    assert (s["id"], s["href"], s["sold"], s["price_raw"]) == (48, None, True, "2,700,000")
    assert a["price_raw"] == "65,000" and a["location"] == "شمال الرياض - حي العارض"
    assert a["cover"].startswith("https://amzn-s3-wadod-bucket1-wadod.s3.eu-central-1.amazonaws.com/propertiesImages/")


def test_rented_and_sold_cards_are_skipped_and_counted():
    _, r, s = _cards()
    assert R.map_listing(r, R.parse_detail(FX["p92"])) == (None, "residential", "sold_or_rented")
    assert R.map_listing(s, R.parse_detail(FX["p92"])) == (None, "residential", "sold_or_rented")


# ── detail page ───────────────────────────────────────────────────────────────────────────────────

def test_labelled_facts_land_in_real_columns():
    row, cat, why = R.map_listing(_cards()[0], R.parse_detail(FX["p92"]))
    assert why == "" and cat == "residential"
    assert row["ad_number"] == "WDD92" and row["listing_url"] == "https://wadod.sa/property/92"
    assert row["property_type"] == "Apartment" and row["transaction_type"] == "Rent"
    assert row["city_id"] == 3 and row["city_ar"] == "الرياض" and row["district_ar"] == "حي العارض"
    assert row["area_m2"] == 140 and row["bedrooms"] == 3 and row["bathrooms"] == 3 and row["halls"] == 1
    assert row["floor_number"] == 2 and row["property_age"] == 2
    assert row["license_number"] == "7201096781"
    assert row["kitchen"] is True and row["air_conditioner"] is True and row["parking"] is True and row["elevator"] is True
    assert "furnished" not in row, "not listed under «تفاصيل العقار» → NULL, never False"
    assert row["photo_urls"] == [_cards()[0]["cover"]]
    assert "direction" not in row, "«شمال الرياض» is the site's area grouping, not a facade"


def test_the_ground_floor_is_zero_not_null():
    assert "<span>الطابق</span><span>الثاني</span>" in FX["p92"]
    ground = FX["p92"].replace("<span>الطابق</span><span>الثاني</span>", "<span>الطابق</span><span>الأرضي</span>")
    row, _, why = R.map_listing(_cards()[0], R.parse_detail(ground))
    assert why == "" and row["floor_number"] == 0 and row["additional_info"]["floor_raw"] == "الأرضي"
    missing = FX["p92"].replace("<div><span>الطابق</span><span>الثاني</span></div>", "")
    row, _, _ = R.map_listing(_cards()[0], R.parse_detail(missing))
    assert row["floor_number"] is None, "93 has no floor line → NULL"


def test_payment_terms_are_not_a_rent_period():
    """«دفعة واحدة» / «دفعتين» say how the rent is PAID. The period is stated nowhere (7/7 pages),
    so the period comes from the OWNER's platform-level attestation (2026-09-24: «those are yearly»,
    registered in ops_rent_period_single_value_ok), never from the payment split."""
    row, _, _ = R.map_listing(_cards()[0], R.parse_detail(FX["p92"]))
    assert row["price_annual"] == 65000 and row["rent_period"] == "annual"
    assert row["additional_info"]["payment_terms"] == "دفعة واحدة"


def test_a_period_the_source_states_is_read_and_monthly_is_x12():
    d = R.parse_detail(FX["p92"])
    row, _, _ = R.map_listing(_cards()[0], dict(d, description=d["description"] + " الإيجار سنوي"))
    assert row["rent_period"] == "annual" and row["price_annual"] == 65000
    row, _, _ = R.map_listing(_cards()[0], dict(d, description=d["description"] + " الإيجار شهري"))
    assert row["rent_period"] == "monthly" and row["price_annual"] == 65000 * 12
    row, _, _ = R.map_listing(_cards()[0], dict(d, description=d["description"] + " إيجار يومي"))
    assert "rent_period" not in row and row["price_annual"] is None, "a daily rate is never parked as annual"


def test_furnished_floor_with_new_age():
    card = dict(_cards()[0], id=85, href="https://wadod.sa/property/85")
    row, _, why = R.map_listing(card, R.parse_detail(FX["p85"]))
    assert why == "" and row["property_type"] == "Floor" and row["floor_number"] == 1
    assert row["furnished"] is True and row["property_age"] == 0 and row["bathrooms"] == 4
    assert row["additional_info"]["payment_terms"] == "دفعتين" and row["rent_period"] == "annual"


def test_unknown_type_or_offer_is_skipped_not_guessed():
    d = R.parse_detail(FX["p92"])
    d2 = dict(d, info=dict(d["info"], **{"نوع العقار": "استراحة فاخرة"}))
    assert R.map_listing(_cards()[0], d2)[2] == "type_unmapped[استراحة فاخرة]"
    d3 = dict(d, info=dict(d["info"], **{"نوع العرض": "استثمار"}))
    assert R.map_listing(_cards()[0], d3)[2] == "deal_unknown[استثمار]"
    assert R.map_listing(_cards()[0], dict(d, location="حي العارض"))[2] == "city_not_in_catalog"


def test_pii_is_redacted():
    d = R.parse_detail(FX["p92"])
    row, _, _ = R.map_listing(_cards()[0], dict(d, description=d["description"] + " للتواصل 0551234567"))
    assert "0551234567" not in row["description"]


def test_a_whole_building_keeps_its_aggregate_count_out_of_bedrooms_bathrooms():
    """Reviewer finding: map_type_exact has no per-platform override here, so «عمارة» resolves
    straight off the SHARED vocabulary to Building — a whole-building rent ad's aggregate room
    count («24 غرف نوم» / «18 دورات مياه») is not one dwelling's and must not land in the real
    bedrooms/bathrooms columns."""
    d = R.parse_detail(FX["p92"])
    building = dict(d, info=dict(d["info"], **{"نوع العقار": "عمارة", "غرف النوم": "24", "دورات مياه": "18"}))
    row, cat, why = R.map_listing(_cards()[0], building)
    assert why == "" and row["property_type"] == "Building" and cat == "residential"
    assert row["bedrooms"] is None and row["bathrooms"] is None
    assert row["additional_info"]["bedrooms_raw"] == 24 and row["additional_info"]["bathrooms_raw"] == 18
    # a dwelling (Apartment, the unmodified fixture) keeps them in the real columns, unaffected
    dwelling_row, _, _ = R.map_listing(_cards()[0], d)
    assert dwelling_row["bedrooms"] == 3 and dwelling_row["bathrooms"] == 3
    assert "bedrooms_raw" not in dwelling_row["additional_info"]


# ── removal oracle ────────────────────────────────────────────────────────────────────────────────

def test_liveness_signal_reads_the_measured_shapes():
    assert R._signal(404, "<title>404 غير متوفر</title>", False) == "gone"
    assert R._signal(200, FX["p92"], False) == "live"
    assert R._signal(500, "خطأ في الإستضافة", False) is None, "an id that never existed answers 500"
    assert R._signal(404, "<html>other</html>", False) is None
    assert R._signal(403, "", False) is None


# ── main(): the tally reaches end_run ─────────────────────────────────────────────────────────────

def test_main_walks_both_catalogues_and_reports_the_skip_tally(monkeypatch):
    calls = {}
    pages = {f"{R.BASE}/properties/rent/all?page=1": AVAIL_CARD + RENTED_CARD,
             f"{R.BASE}/properties/rent/all?page=2": "<html></html>",
             f"{R.BASE}/properties?page=1": SOLD_CARD, f"{R.BASE}/properties?page=2": "<html></html>",
             "https://wadod.sa/property/92": FX["p92"]}
    monkeypatch.setattr(R, "session", lambda: object())
    monkeypatch.setattr(R, "fetch", lambda s, url: pages[url])
    monkeypatch.setattr(R.time, "sleep", lambda *_: None)
    db = types.SimpleNamespace(
        begin_run=lambda slug: calls.setdefault("begin", slug) or 5,
        _wasalt_batch=lambda table, rows: calls.setdefault("batches", []).append((table, [r["ad_number"] for r in rows])),
        retire_superseded_siblings=lambda **kw: calls.setdefault("retire", kw) and 0,
        prune_unseen=lambda table, seen, source=None, verify_gone=None: calls.setdefault("prune", []).append((table, sorted(seen), verify_gone)) or 0,
        end_run=lambda run_id, **kw: calls.setdefault("end", kw) or True,
    )
    monkeypatch.setattr(R, "db", db)
    monkeypatch.setattr(sys, "argv", ["run"])
    assert R.main() == 0
    assert calls["begin"] == "wadod"
    assert ("wadod_residential_listings", ["WDD92"]) in calls["batches"]
    assert ("wadod_commercial_listings", []) in calls["batches"]
    assert calls["retire"]["res_table"] == "wadod_residential_listings"
    assert calls["prune"][0][:2] == ("wadod_residential_listings", ["WDD92"]) and calls["prune"][0][2] is R.verify_gone
    end = calls["end"]
    assert end["check_tables"] == ["wadod_residential_listings", "wadod_commercial_listings"]
    assert end["rows_seen"] == 3 and end["rows_upserted"] == 1 and "sold_or_rentedx2" in end["notes"]


def test_main_never_prunes_when_nothing_available_was_mapped(monkeypatch):
    calls = {}
    pages = {f"{R.BASE}/properties/rent/all?page=1": RENTED_CARD, f"{R.BASE}/properties/rent/all?page=2": "",
             f"{R.BASE}/properties?page=1": SOLD_CARD, f"{R.BASE}/properties?page=2": ""}
    monkeypatch.setattr(R, "session", lambda: object())
    monkeypatch.setattr(R, "fetch", lambda s, url: pages[url])
    monkeypatch.setattr(R.time, "sleep", lambda *_: None)
    db = types.SimpleNamespace(begin_run=lambda slug: 5, _wasalt_batch=lambda t, r: None,
                               retire_superseded_siblings=lambda **kw: 0,
                               prune_unseen=lambda *a, **kw: calls.setdefault("prune", True) or 0,
                               end_run=lambda run_id, **kw: calls.setdefault("end", kw) or True)
    monkeypatch.setattr(R, "db", db)
    monkeypatch.setattr(sys, "argv", ["run"])
    assert R.main() == 0 and "prune" not in calls and calls["end"]["rows_upserted"] == 0
