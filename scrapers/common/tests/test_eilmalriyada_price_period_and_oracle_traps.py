"""eilmalriyada's P0s: an SPA whose data lives on a separate API host, a CMS that writes «0» and
«.» for «not filled», a rent period that lives only in prose (with «نصف السنوي» beside it), and a
price cell that is sometimes a rate, sometimes a word.

Every fixture below is a VERBATIM record from GET https://api.eilmalriyada.com/api/recent on
2026-09-24, trimmed to the keys run.py reads (descriptions cut at 1,200 chars). Every assertion
runs the SHIPPING functions — `run.map_listing`, `run.parse_price_cell`, `run.rent_period_stated`,
`run.parse_age`, `run.parse_direction`, `run.photo_urls`, `run.fetch_catalogue`, `run.fetch_detail`,
`run._signal_for`, `run.main` — never a re-implementation. Offline: no network.

Traps met live, each locked here:
  · id 134: «أرض» whose NAME says «تجارية», for rent at «1,000,000 ريال» with «الإيجار السنوي:
    مليون ريال» in prose — the figure form «مليون» binds the period;
  · id 245: «الإيجار السنوي: 100,000 ريال» AND «الإيجار نصف السنوي 52,000» — ours is the annual;
  · id 641: the price cell itself says «7,300 ريال شهرياً» → monthly ×12;
  · id 609: «2,500 ريال/م²» is a RATE (and its type «مشروع تجاري» is unmapped);
  · id 580: the price cell is the WORD «مجمع سياحي» — the source states no price;
  · id 664: property_age «على الخارطة» — off-plan → SKIP;
  · id 223: «القصيم» is a region, not a catalog city → SKIP;
  · ids 443/297/217/141: «جديدة», «+4», «غربية شمالية», tatweel in «شرقـاً»/«غـربــاً», a phone
    number in prose, «7100132880» as the ad licence;
  · the first full walk lost 99 of 283 details to throttling → fetch_detail retries once.
"""
from __future__ import annotations

import json
import sys
import types
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

from scrapers.common import db as _db  # noqa: E402
from scrapers.eilmalriyada import run as R  # noqa: E402

_CITIES = {"الرياض": (3, 1), "الخبر": (31, 5), "الدمام": (13, 5)}
_DISTRICTS = {"حي الخير": "حي الخير", "حي سدرة": "حي سدرة", "حي الملقا": "حي الملقا", "حي الرمال": "حي الرمال"}


@pytest.fixture(autouse=True)
def _no_catalog_network(monkeypatch):
    """to_catalog()/find_district_in_text() are the only calls that would touch Supabase; stubbed
    for EVERY test so a regression that reaches the catalog fails on an assertion, offline."""
    monkeypatch.setattr(R, "to_catalog", lambda c, region_hint=None: _CITIES.get(c, (None, None)))
    monkeypatch.setattr(R, "find_district_in_text", lambda t, cid: _DISTRICTS.get(t) if t else None)
    R.DETAIL_MISSES.clear()


# ── eilmalriyada fixtures (verbatim /api/recent records, trimmed to the keys run.py reads; captured 2026-09-24) ──

ELR_134 = {
    "id": 134,
    "cover": "images/recent/1736198569.jpg",
    "name": "أرض تجارية استراتيجية",
    "location": "حي الخير - الرياض",
    "category": "للإيجار",
    "price": "1,000,000 ريال",
    "type": "أرض",
    "property_area": "8,250m²",
    "street_direction": ".",
    "bathrooms": "30",
    "bedrooms": ".",
    "property_age": ".",
    "street_width": ".",
    "license_number": ".",
    "description": "*الموقع:* الرياض حي الخير – أحد أفضل وأسرع الأحياء نموًا في المنطقة، يوفر بيئة مثالية للعيش والاستثمار.\r\n*المواصفات:*\r\n\t•\tالمساحة الإجمالية: 8,250 متر مربع.\r\n\t•\tالتقسيم: خمس قطع أرض متجاورة، كلها مسورة لضمان الخصوصية والتنظيم.\r\n\t•\tالمباني القائمة:\r\n\t•\tشاليه مميز: ثلاث غرف مصممة بمستوى عالٍ من الجودة.\r\n\t•\tمصالح مجهزة بالكامل.\r\n\t•\t30 دورة مياه معزولة لتوفير الخصوصية والتسهيلات المثلى.\r\n\t•\tالمرافق الإضافية:\r\n\t•\tمسبح حديث يناسب الاستخدامات الترفيهية.\r\n\t•\tمستوع \r\n\t•\tخزان أرضي لضمان توفير المياه بشكل دائم.\r\n\t•\tالبنية التحتية: الأرض مجهزة بالكهرباء، مما يجعلها جاهزة للاستخدام فورًا.\r\n*الفرصة الاستثمارية:*\r\n\t•\tتصميم مخطط سكني جاهز:\r\n\t•\tيحتوي على 300 غرفة مع دورات مياه وخدمات مرافقة.\r\n\t•\tمثالي لتنفيذ مشروع استثماري مثل إسكان العمالة أو مشروع شقق سكنية صغيرة.\r\n\r\n*السعر:*\r\n\t•\tالإيجار السنوي: مليون ريال فقط – فرصة لا تُضاهى لتأمين موقع جاهز للتطوير أو الاستثمار.\r\n\r\n*لماذا هذه الأرض؟*\r\n\t1.\t*موقع استراتيجي:* حي مزدهر مع طلب متزايد على المشاريع السكنية والخدمية.\r\n\t2.\t*جاهزية المشروع:* الأرض تحتوي على بنية تحتية ومرافق تجعلها مثالية للاستثمار السريع.\r\n\t3.\t*مرونة الاستخدام:* يمكن استغلالها كسكن للعمالة، أو تطوير مشروع شقق صغيرة، أو استخدام قائم مباشرة.",
    "map_location": "https://maps.app.goo.gl/6MBgYmEwCvW7tq1A8",
    "filePdfRecent": "pdfs/recent/1736198569.pdf",
    "created_at": "2025-01-06T21:22:49.000000Z",
    "updated_at": "2025-01-06T21:22:49.000000Z",
    "land_length": ".",
    "land_width": ".",
    "type_en": "Land",
    "name_en": "Strategic commercial land",
    "location_en": "Al Khair District - Riyadh",
    "price_en": "SAR 1,000,000"
}

ELR_245 = {
    "id": 245,
    "cover": "images/recent/1767852108.png",
    "name": "فيلا جديدة للإيجار حي روشن",
    "location": "حي سدرة - الرياض",
    "category": "للإيجار",
    "price": "100,000 ريال",
    "type": "فيلا",
    "property_area": "250m²",
    "street_direction": ".",
    "bathrooms": "3",
    "bedrooms": "4",
    "property_age": "حديث",
    "street_width": "30m",
    "license_number": "#",
    "description": "*فيلا جديدة للإيجار في شمال الرياض – حي روشن*\r\n\r\nفرصة سكنية مميزة في حي روشن الجديد شمال الرياض، بموقع يسهل الوصول منه إلى:\r\n- جامعة الأميرة نورة (PNU)  \r\n- واجهة الرياض  \r\n- مركز الملك عبدالله للدراسات والبحوث البترولية (KAPSARC)  \r\n- محطة قطار SAR  \r\n- طريق الملك سلمان  \r\n- المطار  \r\n\r\n*مواصفات الفيلا:*\r\n\r\n- *المساحة الكلية للأرض:* 250 م²  \r\n- *مساحة البناء:* 200 م²  \r\n- *الدور الأرضي:* غرفة معيشة، منطقة طعام، مطبخ، غرفة غسيل، غرفة تخزين، عدد 2 دورة مياه  \r\n- *الدور الأول:* غرفة نوم رئيسية بحمام خاص، غرفتان نوم، دورة مياه، غرفة تخزين  \r\n- *الحديقة:* خلفية  \r\n- *المطبخ والمكيفات:* جاهزة ومركبة  \r\n- *حالة التأثيث:* غير مؤثثة حالياً، مع إمكانية التأثيث برسوم إضافية عند الطلب  \r\n\r\n*خيارات الإيجار:*\r\n- *الإيجار السنوي:* 100,000 ريال  \r\n- *الإيجار نصف السنوي:* 105,000 ريال (52,500 كل 6 أشهر)  \r\n- *الإيجار ربع السنوي:* 110,000 ريال (27,500 كل 3 أشهر)  \r\n- *الإيجار الشهري:* 115,000 ريال (9,580 ريال شهرياً)  \r\n\r\n🔸 *ملاحظة:* يُشترط دفع إيجار شهر إضافي كتأمين، بالإضافة إلى إيجار آخر شهر مقدماً.",
    "map_location": "https://maps.app.goo.gl/QkM5SENtHagKHPWH6",
    "filePdfRecent": "pdfs/recent/1745268520.pdf",
    "created_at": "2025-04-21T20:48:40.000000Z",
    "updated_at": "2026-01-08T06:01:48.000000Z",
    "land_length": ".",
    "land_width": ".",
    "type_en": "villa",
    "name_en": "New villa for rent in Rawshan district",
    "location_en": "Sidra District - Riyadh",
    "price_en": "SAR 100,000"
}

ELR_664 = {
    "id": 664,
    "cover": "images/recent/1788881522.jpg",
    "name": "فيلا مستقلة للبيع على الخارطة في سدرة –  نموذج A3N",
    "location": "حي سدرة - الرياض",
    "category": "للبيع",
    "price": "5,500,000 ريال",
    "type": "فيلا",
    "property_area": "350m²",
    "street_direction": "على 3 شوارع",
    "bathrooms": "6",
    "bedrooms": "5",
    "property_age": "على الخارطة",
    "street_width": "0",
    "license_number": "#",
    "description": "*فيلا مستقلة فاخرة للبيع على الخارطة في سدرة – روشن، نموذج A3N ضمن مشروع Neptune Interiors by Mouawad من شركة دار جلوبال، بتصاميم داخلية تحمل توقيع Mouawad، وموقع على ثلاثة شوارع.*\r\n\r\n*تفاصيل الفيلا:*\r\nمساحة الأرض: 350 م²\r\nالمساحة البنائية: 420 م²\r\n5 غرف نوم\r\nجناح ماستر مع غرفة ملابس وحمام خاص\r\nصالة معيشة واسعة\r\nصالة عائلية\r\nمنطقة طعام\r\nغرفة ضيوف\r\nمطبخ رئيسي + مطبخ خدمات\r\nغرفة سائق مع حمام\r\nغرفة خادمة مع حمام\r\nغرفة غسيل\r\nمصعد داخلي\r\nتراسات\r\nحديقة سطح Roof Garden\r\nمساحات خضراء خارجية\r\n\r\n*التجهيزات والمواصفات:*\r\nخزائن ملابس بتصاميم مبتكرة\r\nتكييف مخفي باستثناء غرفتي السائق والعاملة بتكييف سبليت\r\nمطبخ راكب بدون الأجهزة الكهربائية\r\nسخان مركزي بالطاقة الشمسية\r\nتأسيس مصعد ومسبح\r\nتأسيس منزل ذكي للتحكم بالإضاءة والستائر والتكييف\r\nتأسيس الألياف البصرية والهاتف والبيانات والساتلايت\r\nتأسيس كاميرات مراقبة خارجية\r\nنظام Intercom\r\nمراوح شفط للمطبخ ودورات المياه\r\n\r\n*التفاصيل المالية:*\r\nالمبلغ المدفوع حتى الآن: 2,983,380 ريال.\r\nمبلغ التنازل المطلوب: 3,300,000 ريال.\r\nالمتبقي للمطور حتى نهاية عام 2027: 1,988,920 ريال + ضريبة التصرفات العقارية.\r\nالاجمالي : 5,500,000 شامل الضريبة\r\nتضاف ضريبة التصرفات العقارية\r\nأسعار الوحدات المشابهة تتجاوز حالياً 6,000,000 ريال\r\n\r\n*موعد التسليم المتوقع:*\r\n31 ديسمبر 2027",
    "map_location": "https://maps.google.com/maps?q=24.857643127441406%2C46.741092681884766&z=17&hl=ar",
    "filePdfRecent": "pdfs/recent/1788881522.pdf",
    "created_at": "2026-09-08T15:32:02.000000Z",
    "updated_at": "2026-09-08T15:32:02.000000Z",
    "land_length": "420",
    "land_width": "0",
    "type_en": "villa",
    "name_en": "Off-Plan Independent Villa for Sale in Sidra –  A3N",
    "location_en": "Sidra District - Riyadh",
    "price_en": "5,500,000 SAR"
}

ELR_PPM = {
    "id": 609,
    "cover": "images/recent/1781785704.jpg",
    "name": "مشروع تجاري للايجار في حي القيروان شمال الرياض – 17 معرض وDrive Thru",
    "location": "حي القيروان - الرياض",
    "category": "للإيجار",
    "price": "2,500 ريال/م²",
    "type": "مشروع تجاري",
    "property_area": "1418m²",
    "street_direction": "0",
    "bathrooms": "0",
    "bedrooms": "0",
    "property_age": "0",
    "street_width": "0",
    "license_number": "#",
    "description": "*مشروع تجاري نوعي للايجار في حي القيروان شمال الرياض، يضم 17 معرضًا تجاريًا ووحدتي Drive Thru، بموقع استراتيجي على شوارع تجارية وبيئة استثمارية واعدة مناسبة للعلامات التجارية المحلية والعالمية.*\r\n\r\n*مكونات المشروع:*\r\n17 معرضًا تجاريًا\r\nوحدتا Drive Thru\r\n41 موقف سيارة\r\nإجمالي مسطح بناء 1,418 م²\r\nواجهات تجارية حديثة\r\n\r\n*المساحات المتاحة:*\r\n176 م² (معرضان)\r\n72 م² (4 معارض)\r\n71 م² (معرضان)\r\n64 م² (معرض واحد)\r\n63 م² (6 معارض)\r\n61 م² (معرض واحد)\r\n\r\n*مميزات وحدات Drive Thru:*\r\nمناسبة للكوفي شوب\r\nالمطاعم السريعة\r\nالمخابز والحلويات\r\nالعصائر والمشروبات\r\nالصيدليات والخدمات السريعة\r\n\r\n*الأنشطة المناسبة:*\r\nالمطاعم\r\nالكافيهات\r\nالسوبرماركت\r\nالصيدليات\r\nالعيادات الطبية\r\nمراكز التجميل\r\nالمكاتب التجارية\r\nالبنوك\r\nمتاجر التجزئة والخدمات\r\n\r\n*مميزات الموقع:*\r\nعلى شوارع تجارية\r\nكثافة سكانية عالية\r\nسهولة الوصول والحركة\r\nمواقف واسعة للعملاء\r\nبيئة استثمارية واعدة في شمال الرياض\r\n\r\n*السعر:*\r\n2,500 ريال للمتر المربع",
    "map_location": "https://maps.app.goo.gl/Xf3rWmsAAuvNbH1m6?g_st=iw",
    "filePdfRecent": "pdfs/recent/1781785704.pdf",
    "created_at": "2026-06-18T12:28:24.000000Z",
    "updated_at": "2026-06-18T12:28:24.000000Z",
    "land_length": "0",
    "land_width": "0",
    "type_en": "Commercial Project",
    "name_en": "Commercial Project For Rent in Al Qirawan North Riyadh – 17 Shops and Drive Thru",
    "location_en": "Al Qirawan District - Riyadh",
    "price_en": "2,500 SAR/sqm"
}

ELR_MONTHLY = {
    "id": 641,
    "cover": "images/recent/1786438240.jpg",
    "name": "شقة جديدة مؤثثة بالكامل للإيجار في حي الملقا",
    "location": "حي الملقا - الرياض",
    "category": "للإيجار",
    "price": "7,300 ريال شهرياً",
    "type": "شقة",
    "property_area": "0",
    "street_direction": "0",
    "bathrooms": "2",
    "bedrooms": "2",
    "property_age": "جديد",
    "street_width": "0",
    "license_number": "#",
    "description": "*شقة جديدة مؤثثة بالكامل للإيجار في حي الملقا بمدينة الرياض، متاحة للإيجار الشهري أو السنوي، ومجهزة بجميع احتياجات السكن لتكون جاهزة للسكن الفوري.*\r\n\r\n*مكونات الشقة:*\r\nغرفتا نوم بسريرين كنج\r\nصالة معيشة\r\nمطبخ متكامل\r\nدورتا مياه\r\nفناء خارجي\r\nمدخل خاص\r\n\r\n*الأثاث والتجهيزات:*\r\nمؤثثة بالكامل\r\nثلاجة\r\nفرن\r\nغسالة ملابس مع نشافة 100%\r\nطاولة طعام\r\nتلفزيون ذكي\r\nإنترنت\r\nأدوات تنظيف\r\nمكنسة كهربائية\r\n\r\n*المميزات:*\r\nعقار جديد\r\nأثاث وتجهيزات متكاملة\r\nمدخل خاص\r\nفناء خارجي\r\nجاهزة للسكن مباشرة\r\nالإيجار الشهري شامل الكهرباء والماء والخدمات والإنترنت\r\n\r\n*خيارات التأجير:*\r\n7,300 ريال شهرياً شامل الكهرباء والماء والخدمات والإنترنت",
    "map_location": "https://maps.app.goo.gl/SuGuq1k5eJrfVmm87",
    "filePdfRecent": "pdfs/recent/1786438240.pdf",
    "created_at": "2026-08-11T08:50:40.000000Z",
    "updated_at": "2026-08-11T08:50:40.000000Z",
    "land_length": "0",
    "land_width": "0",
    "type_en": "apartment",
    "name_en": "New Fully Furnished Apartment for Rent in Al Malqa",
    "location_en": "Malaga District - Riyadh",
    "price_en": "7,300 SAR Monthly"
}

ELR_NOPRICE = {
    "id": 580,
    "cover": "images/recent/1776535027.jpg",
    "name": "مجمع سكني متكامل للإيجار في حي الرمال – 22 وحدة",
    "location": "حي الرمال - الرياض",
    "category": "للإيجار",
    "price": "مجمع سياحي",
    "type": "مجمع سكني",
    "property_area": "16516m²",
    "street_direction": "0",
    "bathrooms": "0",
    "bedrooms": "0",
    "property_age": "0",
    "street_width": "0",
    "license_number": "#",
    "description": "*مجمع سكني متكامل للإيجار بالكامل في حي الرمال بمدينة الرياض، فرصة استثمارية مميزة بموقع استراتيجي مناسب للتشغيل الفوري كمشروع سكني أو ضيافة.* \r\n\r\n*تفاصيل المشروع:*\r\nمساحة الأرض: 16,516 م²\r\nعدد الوحدات: 22 وحدة سكنية\r\nمدخل رئيسي خاص + مدخل خدمات\r\nمبنى إدارة وخدمات\r\nمبنى أمن\r\nأكثر من 60 موقف سيارة\r\nبئر مياه\r\n\r\n*تفاصيل الوحدات:*\r\nوحدات غرفة نوم واحدة\r\nشاليهات غرفتين نوم\r\nوحدات متنوعة (بعضها دورين)\r\n\r\n*مميزات العرض:*\r\nتأجير كامل (Bulk Lease)\r\nجاهز للتشغيل الفوري\r\nمناسب للشركات والمستثمرين\r\nإمكانية تشغيله كشاليهات أو مجمع سكني\r\nخصوصية عالية ومدخل مستقل\r\n\r\n*فرصة استثمارية:*\r\nمناسب لشركات إدارة العقارات\r\nمشغلي الضيافة والشاليهات\r\nالمستثمرين الباحثين عن عوائد مستقرة",
    "map_location": "https://maps.app.goo.gl/AARTxi5CoQX5M5Pk6",
    "filePdfRecent": "pdfs/recent/1776535027.pdf",
    "created_at": "2026-04-18T17:57:07.000000Z",
    "updated_at": "2026-04-18T18:27:49.000000Z",
    "land_length": "0",
    "land_width": "0",
    "type_en": "Residential Compound",
    "name_en": "Full Residential Compound for Lease in Al Rimal – 22 Units",
    "location_en": "Al Ramal District - Riyadh",
    "price_en": "Tourist complex"
}

ELR_QASSIM = {
    "id": 223,
    "cover": "images/recent/1744903765.jpg",
    "name": "قطعة ارض رقم 13 مخطط رقم ق/158",
    "location": "حي الربوة - القصيم",
    "category": "للبيع",
    "price": "85,000 ريال",
    "type": "أرض",
    "property_area": "425m²",
    "street_direction": ".",
    "bathrooms": ".",
    "bedrooms": ".",
    "property_age": ".",
    "street_width": "15m",
    "license_number": "7100158258",
    "description": "*للبيع 18 قطعة أرض سكنية مميزة في القصيم – حي الربوة مركز القوارة*\r\nصكوك شرعية – مواقع ممتازة – جاهزة للبناء\r\n\r\n*السعر:* يبدأ من 85,000 ريال فقط لكل قطعة\r\nفرصة ذهبية لامتلاك 18 قطعة أرض سكنية بصكوك إلكترونية في حي الربوة – القوارة، ضمن مواقع مميزة وشوارع واسعة. تعتبر هذه الأراضي مثالية للسكن أو الاستثمار طويل الأجل، بأسعار مغرية تبدأ من 85,000 ريال فقط للقطعة.\r\n\r\n*تفاصيل الأراضي:*\r\n\r\n*مخطط رقم ق/158:*\r\n- قطعة رقم 13 – مساحة 425 م² – شارع 15م\r\n- قطعة رقم 11 – مساحة 424 م² – شارع 15م\r\n- قطعة رقم 6 – مساحة 424 م² – شارع 15م\r\n- قطعة رقم 36 – مساحة 506 م² – شارع 15م + ممر 6م\r\n\r\n*مخطط رقم ق/227:*\r\n- قطعة رقم 8 أ – مساحة 650 م² – شارع 15م\r\n- قطعة رقم 9 – مساحة 650 م² – شارع 15م\r\n- قطعة رقم 10 – مساحة 650 م² – شارع 15م\r\n- قطعة رقم 11 – مساحة 600 م² – شارع 15م\r\n- قطعة رقم 13 – مساحة 600 م² – شارع 15م\r\n- قطعة رقم 14 – مساحة 600 م² – شارع 15م\r\n- قطعة رقم 5 – مساحة 600 م² – شارع 15م\r\n- قطعة رقم 6 – مساحة 600 م² – شارع 15م\r\n- قطعة رقم 7 – مساحة 600 م² – شارع 15م\r\n- قطعة رقم 8 – مساحة 600 م² – شارع 15م\r\n- قطعة رقم 9 – مساحة 600 م² – شارع 15م\r\n- قطعة رقم 15 – مساحة 579 م² – شارع 20م\r\n\r\n*مميزات العقار:*\r\n- جميع الأراضي بصكوك إلكترونية معتمدة.\r\n- تقع في حي الربوة – القوارة بمنطقة القصيم.\r\n- ضمن مخط",
    "map_location": "https://maps.app.goo.gl/qAYbzeakH5jAwaKA9",
    "filePdfRecent": "pdfs/recent/1744903765.pdf",
    "created_at": "2025-04-17T15:29:25.000000Z",
    "updated_at": "2025-05-08T11:19:22.000000Z",
    "land_length": ".",
    "land_width": ".",
    "type_en": "Land",
    "name_en": "Plot No. 13, Plan No. Q/158",
    "location_en": "Al-Rabwa District - Qassim",
    "price_en": "SAR 85,000"
}

ELR_TOWNHOUSE = {
    "id": 443,
    "cover": "images/recent/1759150652.jpg",
    "name": "تاون هاوس للإيجار ضاحية خزام (مشروع مرسية) – شمال الرياض",
    "location": "ضاحية خزام - الرياض",
    "category": "للإيجار",
    "price": "85,000 ريال",
    "type": "تاون هاوس",
    "property_area": "190m²",
    "street_direction": "غربية شمالية",
    "bathrooms": "6",
    "bedrooms": "4",
    "property_age": "جديدة",
    "street_width": "18m",
    "license_number": "#",
    "description": "*تاون هاوس للإيجار – ضاحية خزام (مشروع مرسية) – شمال الرياض*\r\nالمساحة: 190 م²\r\n\r\n*الوصف:*\r\nتاون هاوس جديد لم يسكن بعد يقع في ضاحية خزام غرب مطار الملك خالد ضمن مشروع مرسية (الحي الأول - بلك 18) مقابل حديقة الحي. المنزل يتضمن موقفين للسيارة (أمام المنزل وداخل الجراج)، وجراج واسع يستوعب سيارة كبيرة (مثل سوبربان). في الحوش الأمامي حديقة مزروعة أمام المجلس، وفي الحوش الوسطي حديقة كبيرة تطل عليها الصالتان والمطبخ وغرفتا نوم، ويوجد حديقة جانبية ثالثة. جميع الحدائق مزودة بنظام ري أوتوماتيكي.\r\n\r\n*المكونات:*\r\n• 4 غرف نوم (غرفة ماستر واحدة)\r\n• غرفة خادمة\r\n• صالتان\r\n• 6 دورات مياه\r\n• مطبخ راكب مع ثلاجة، فرن، غسالة صحون، مايكروويف، شفاط وموقد\r\n• جراج واسع + موقف أمامي\r\n• مدخل سيارة\r\n\r\n*المرافق والتجهيزات:*\r\n• 9 مكيفات راكبة (ما عدا مكيف غرفة الخادمة)\r\n• غسالة ملابس أوتوماتيك\r\n• فلتر ماء مركزي بعد الخزان العلوي\r\n• سخان ماء مركزي بالطاقة الشمسية\r\n• نظام ري أوتوماتيكي للحدائق\r\n\r\n*تفاصيل إضافية:*\r\n• الدور الأرضي: المجلس + غرفة طعام + الصالتان بطول امتداد مشترك 11 متر (قابلة للفصل)\r\n• الموقع: الحي الأول - بلك 18 أمام حديقة الحي\r\n• القرب من الخدمات: سوبرماركت التميمي، صيدلية، مركز لياقة، حضانة، ومساحات لعب للأطفال\r\n\r\n*مميزات الموقع والشارع:*\r\n• واجهة: غربية شمالية\r\n• شارع سكني بعرض 18 م\r\n• موقع مميز",
    "map_location": "https://maps.app.goo.gl/FRghatEXsCL4r2Pe9",
    "filePdfRecent": "pdfs/recent/1759150652.pdf",
    "created_at": "2025-09-29T12:57:32.000000Z",
    "updated_at": "2025-09-29T12:57:32.000000Z",
    "land_length": "0",
    "land_width": "0",
    "type_en": "Townhouse",
    "name_en": "Townhouse For Rent – Al-Khuzam (Mersia Project) – North Riyadh",
    "location_en": "Khazam Suburb - Riyadh",
    "price_en": "85,000 SAR"
}

ELR_PLUS4 = {
    "id": 297,
    "cover": "images/recent/1750186661.jpg",
    "name": "فيلا في مشروع سرايا الجوان 1 (نموذج جوري)",
    "location": "ضاحية خزام - الرياض",
    "category": "للإيجار",
    "price": "75,000 ريال",
    "type": "فيلا",
    "property_area": "250m²",
    "street_direction": "جنوباً",
    "bathrooms": "+4",
    "bedrooms": "4",
    "property_age": "حديث",
    "street_width": "20m",
    "license_number": ".",
    "description": "*🏡 فيلا للإيجار في مشروع سرايا الجوان 1 – نموذج جوري*\r\n*المساحة:* 250 م² – *الواجهة:* جنوبية – *الموقع:* مميز جداً\r\n\r\n*✅ مواصفات الفيلا:*\r\n• مدخل سيارة\r\n• حوش كبير مع ارتداد جانبي\r\n• مدخلين (باب رئيسي + باب زجاج سحب)\r\n\r\n*🏠 تفاصيل الأدوار:*\r\n*الدور الأرضي:*\r\n• مجلس\r\n• صالة كبيرة\r\n• مطبخ داخلي + مطبخ خارجي\r\n• دورات مياه\r\n*الدور الأول:*\r\n• 4 غرف نوم:\r\n – غرفة نوم رئيسية ماستر مع غرفة ملابس ودورة مياه خاصة\r\n – غرفة ماستر بدورة مياه\r\n – غرفتان نوم بدورة مياه مشتركة\r\n\r\n*💰 خيارات التأجير:*\r\n• *75,000 ريال – دفعة واحدة*\r\n• *80,000 ريال – دفعتين*",
    "map_location": "https://goo.gl/maps/STMcweA8nWv4jgnJA",
    "filePdfRecent": "pdfs/recent/1750186661.pdf",
    "created_at": "2025-06-17T18:57:41.000000Z",
    "updated_at": "2025-06-17T18:57:41.000000Z",
    "land_length": ".",
    "land_width": ".",
    "type_en": "villa",
    "name_en": "Villa in Saraya Al-Jawaan 1 project (Jourie model)",
    "location_en": "Khazam Suburb - Riyadh",
    "price_en": "SAR 75,000"
}

ELR_PHONE = {
    "id": 217,
    "cover": "images/recent/1767851923.png",
    "name": "فيلا دوبلكس مفروشة جديدة للإيجار في حي سدرة",
    "location": "حي سدرة - الرياض",
    "category": "للإيجار",
    "price": "150,000 ريال",
    "type": "فيلا",
    "property_area": "250m²",
    "street_direction": "شرقـاً",
    "bathrooms": "4",
    "bedrooms": "3",
    "property_age": "حديث",
    "street_width": "15m",
    "license_number": ".",
    "description": "*فيلا دوبلكس مفروشة جديدة للإيجار في حي سدرة – أرقى أحياء الرياض السكنية*  \r\n*الموقع:*  \r\n• على بعد 5 دقائق من واجهة روشن للأعمال.  \r\n• حي متكامل تحت إدارة شركة روشن مع خدمة أمن 24/7.  \r\n• سهولة الدخول والخروج من الحي.  \r\n*مميزات الحي:*  \r\n• يتوفر به جميع الخدمات مثل المدارس، مركز اجتماعي، حديقة، وملاعب.  \r\n*تفاصيل الفيلا:*  \r\n• *المساحة:* 250 متر مربع شارع ١٥م واجهة شرقية  \r\n• *الحالة:* مفروشة بالكامل وجاهزة للسكن.  \r\n*الطابق الأرضي:*  \r\n• مجلس ضيوف مجهز بالكامل مع غرفة طعام.  \r\n• غرفة جلوس للعائلة بأثاث أنيق، دواليب ثابتة، ستائر راقية، وإنارة فاخرة.  \r\n• مجهزة بغسالة ملابس (غسيل وتنشيف 100٪).  \r\n• حمامين.  \r\n• *المطبخ:*  \r\n  • دواليب خشبية حديثة.  \r\n  • ثلاجة.  \r\n  • فرن كهربائي مع شفاط علوي.  \r\n*الطابق الأول:*  \r\n• *جناح رئيسي:* غرفة نوم مؤثثة بالكامل مع غرفة ملابس ودورة مياه خاصة.  \r\n• *غرفتا نوم:* مجهزة بدواليب ثابتة، ستائر أنيقة، وموكيت، مع دورة مياه مشتركة.  \r\n• صالة في الطابق الأول.  \r\n• مستودع صغير.  \r\n*مرافق الفيلا:*  \r\n• حديقة أنيقة مع نظام ري آلي.  \r\n• مدخل رئيسي ومدخل جانبي.  \r\n• موقف مظلل يتسع لسيارتين.  \r\n• 7 مكيفات وسخان مركزي.  \r\n*السعر:*  \r\n• 160,000 ريال (على دفعتين).  \r\n• 150,000 ريال (دفعة واحدة).  \r\n*للتواصل مع المالك مباشرة:*  \r\n📞 0530668828",
    "map_location": "https://maps.app.goo.gl/wH4v4uL5XjjqBPHr8",
    "filePdfRecent": "pdfs/recent/1744142635.pdf",
    "created_at": "2025-04-08T20:03:55.000000Z",
    "updated_at": "2026-01-08T05:58:43.000000Z",
    "land_length": ".",
    "land_width": ".",
    "type_en": "villa",
    "name_en": "New furnished duplex villa for rent in Sidra District",
    "location_en": "Sidra District - Riyadh",
    "price_en": "SAR 150,000"
}

ELR_TATWEEL = {
    "id": 141,
    "cover": "images/recent/1736857016.png",
    "name": "أرض سكنية في مدينة الرياض",
    "location": "حي الخير - الرياض",
    "category": "للبيع",
    "price": "2,000,000 ريال",
    "type": "أرض",
    "property_area": "750m²",
    "street_direction": "غـربــاً",
    "bathrooms": ".",
    "bedrooms": ".",
    "property_age": ".",
    "street_width": "20m",
    "license_number": "7100132880",
    "description": "*للبيع أرض سكنية في مدينة الرياض - حي الخير*\r\n\t•\t*المساحة:* 750 متر مربع.\r\n\t•\t*السعر المطلوب: 2,000,000 ريال سعودي.*\r\n\t•\t*حدود الأرض:*\r\n\t•\t*شمالاً:* قطعة رقم 1535 بطول 30 متر.\r\n\t•\t*جنوباً:* قطعة رقم 1539 بطول 30 متر.\r\n\t•\t*شرقاً:* قطعة رقم 1536 بطول 25.5 متر.\r\n\t•\t*غرباً:* شارع عرض 20 متر بطول 25.5 متر",
    "map_location": "https://maps.app.goo.gl/7YZW3oQorkS7nnGP9",
    "filePdfRecent": "pdfs/recent/1736857016.pdf",
    "created_at": "2025-01-14T12:16:56.000000Z",
    "updated_at": "2025-01-14T12:16:56.000000Z",
    "land_length": "30m",
    "land_width": "25.5m",
    "type_en": "Land",
    "name_en": "Residential land in Riyadh",
    "location_en": "Al Khair District - Riyadh",
    "price_en": "SAR 2,000,000"
}

# ═══════════════════════════════ 1. rent period = the ad's own words ═════════════════════════════
def test_commercial_land_for_rent_annual_bound_by_the_million_word_134():
    row, cat, why = R.map_listing(ELR_134, None)
    assert row and not why
    assert row["property_type"] == "Commercial Land" and cat == "commercial"
    assert row["transaction_type"] == "Rent"
    assert (row["rent_period"], row["price_annual"]) == ("annual", 1000000)
    assert row["bedrooms"] is None and row["bathrooms"] is None        # land answers no room count
    assert row["neighborhood"] == "حي الخير" and row["district_ar"] == "حي الخير" and row["city_id"] == 3
    assert row["listing_url"] == "https://eilmalriyada.com/real-estate/view/134"
    assert row["photo_urls"] == ["https://api.eilmalriyada.com/images/recent/1736198569.jpg"]
    assert row["license_number"] is None and row["property_age"] is None      # «.»


def test_annual_beside_our_figure_outranks_the_semi_annual_option_245():
    row, _, why = R.map_listing(ELR_245, None)
    assert row and not why
    assert (row["rent_period"], row["price_annual"]) == ("annual", 100000)
    assert row["property_age"] is None                                  # «حديث» is not in the vocabulary


def test_monthly_in_the_price_cell_641():
    row, _, why = R.map_listing(ELR_MONTHLY, None)
    assert row and not why
    assert (row["rent_period"], row["price_annual"]) == ("monthly", 87600)
    assert row["additional_info"]["price_raw"] == "7,300 ريال شهرياً"


def test_no_period_anywhere_stays_null_and_unconverted():
    silent = dict(ELR_245, description="فيلا فاخرة في حي سدرة")
    row, _, _ = R.map_listing(silent, None)
    assert (row["rent_period"], row["price_annual"]) == (None, 100000)
    assert R.rent_period_stated(5000, "الإيجار 5,000 ريال شهري أو 5,000 ريال سنوي") == (None, 5000)
    assert R.rent_period_stated(500, "الإيجار اليومي 500 ريال") == (None, None)
    assert R.rent_period_stated(45000, "قريبة من الخدمات اليومية") == (None, 45000)


# ═══════════════════════════════ 2. the price cell: total, rate, or a word ═══════════════════════
def test_price_cell_shapes():
    assert R.parse_price_cell("1,000,000 ريال") == (1000000, "total")
    assert R.parse_price_cell("2,500 ريال/م²") == (2500, "per_meter")
    assert R.parse_price_cell("SAR 85,000") == (85000, "total")
    assert R.parse_price_cell("مجمع سياحي") == (None, "absent")
    assert R.parse_price_cell("") == (None, "absent")


def test_a_rate_goes_to_price_per_meter_with_no_total_609():
    assert R.map_listing(ELR_PPM, None)[2] == "type_unmapped"          # «مشروع تجاري» stays out
    as_office = dict(ELR_PPM, type="مكتب")
    row, _, why = R.map_listing(as_office, None)
    assert row and not why
    assert row["price_per_meter"] == 2500 and row.get("price_annual") is None and "price_total" not in row
    assert row["additional_info"]["price_evidence"]["unit"] == "per_meter"


def test_a_word_in_the_price_cell_is_an_authoritative_absence_580():
    assert R.map_listing(ELR_NOPRICE, None)[2] == "type_unmapped"       # «مجمع سكني» stays out
    as_flat = dict(ELR_NOPRICE, type="شقة")
    row, _, why = R.map_listing(as_flat, None)
    assert row and not why
    assert row["price_annual"] is _db.AUTHORITATIVE_NULL and row["rent_period"] is None
    assert row["additional_info"]["price_evidence"]["authoritative_absent"] is True
    as_sale = dict(as_flat, category="للبيع")
    row, _, _ = R.map_listing(as_sale, None)
    assert row["price_total"] is _db.AUTHORITATIVE_NULL


def test_sale_land_price_as_printed_141():
    row, _, why = R.map_listing(ELR_TATWEEL, None)
    assert row and not why
    assert row["transaction_type"] == "Buy" and row["price_total"] == 2000000
    assert row["direction"] == "غرب" and row["street_width_m"] == 20
    assert row["license_number"] == "7100132880"


# ═══════════════════════════════ 3. skips, never guesses ═════════════════════════════════════════
def test_off_plan_region_city_and_type_skips():
    assert R.map_listing(ELR_664, None) == (None, "residential", "off_plan")
    assert R.map_listing(dict(ELR_245, property_age="على الخارطة"), None)[2] == "off_plan"   # age cell alone
    assert R.map_listing(ELR_QASSIM, None)[2] == "city_not_in_catalog"
    assert R.map_listing(dict(ELR_245, category="مزاد"), None)[2] == "deal_unknown"
    assert R.map_listing(dict(ELR_245, name="فيلا في مزاد"), None)[2] == "auction"
    assert R.map_listing(dict(ELR_245, name="فيلا تم الإيجار"), None)[2] == "sold_or_rented"
    assert R.map_listing(dict(ELR_245, id="245"), None)[2] == "no_id"
    assert R.map_listing(dict(ELR_245, location=""), None)[2] == "city_not_stated"
    assert R.map_listing(dict(ELR_245, location="حي سدرة"), None)[2] == "city_not_in_catalog"
    # «قريباً» inside «تقريباً» is not an off-plan marker
    assert R.map_listing(dict(ELR_245, name="فيلا 300 متر تقريباً"), None)[2] == ""


# ═══════════════════════════════ 4. advanced-filter facts in real columns ════════════════════════
def test_cms_sentinels_open_bounds_and_tatweel_443_297_217():
    row, _, _ = R.map_listing(ELR_TOWNHOUSE, None)
    assert row["property_type"] == "Villa"                              # the fleet folds a townhouse
    assert row["property_age"] == 0                                     # «جديدة»
    assert row["direction"] is None and row["additional_info"]["direction_raw"] == "غربية شمالية"
    assert row["street_width_m"] == 18 and (row["bedrooms"], row["bathrooms"]) == (4, 6)
    assert row["neighborhood"] == "ضاحية خزام" and row["district_ar"] is None
    row, _, _ = R.map_listing(ELR_PLUS4, None)
    assert row["bathrooms"] is None and row["additional_info"]["bathrooms_raw"] == "+4"
    assert row["direction"] == "جنوب" and row["street_width_m"] == 20 and row["property_age"] is None
    row, _, _ = R.map_listing(ELR_PHONE, None)
    assert row["direction"] == "شرق"
    assert R.parse_age("0") is None and R.parse_age("15سنة") == 15 and R.parse_age("3 سنوات") == 3
    assert R.parse_age("6 أشهر فقط") is None and R.parse_age("سنتين ونصف") is None
    assert R.parse_direction("0") is None and R.parse_direction("غـربــاً") == "غرب"
    assert R.parse_area("8,250m²") == 8250 and R.parse_area("300-350m²") is None and R.parse_area(".") is None


def test_furnished_from_the_type_word_and_prose_negation():
    row, _, _ = R.map_listing(dict(ELR_245, type="شقق مفروشة"), None)
    assert row["property_type"] == "Apartment" and row["furnished"] is True
    row, _, _ = R.map_listing(dict(ELR_245, description="شقة غير مفروشة بدون مصعد"), None)
    assert row["furnished"] is False and row["elevator"] is False


def test_a_negation_INSIDE_name_or_type_is_not_dropped_by_a_bare_substring_check():
    """Reviewer-confirmed defect (2026-09-24): the old code did
    `if "مفروش" in type_ar or "مفروش" in name: row["furnished"] = True`, a bare substring check
    that ignored a negator sitting in the SAME field. ELR_245's real description already carries
    the negated synonym «غير مؤثثة حالياً» (unfurnished) — this native trap plus a name that also
    states the negation must both land False, never True."""
    row, _, _ = R.map_listing(ELR_245, None)
    assert row["furnished"] is False  # native prose: «حالة التأثيث: غير مؤثثة حالياً»
    row, _, _ = R.map_listing(dict(ELR_245, name="فيلا غير مفروشة للإيجار حي روشن"), None)
    assert row["furnished"] is False  # negation now also in `name` — must not flip to True


# ═══════════════════════════════ 5. PII, photos ══════════════════════════════════════════════════
def test_phone_in_prose_is_redacted_217_and_gallery_is_percent_encoded():
    row, _, _ = R.map_listing(ELR_PHONE, None)
    blob = json.dumps(row, ensure_ascii=False, default=str)
    assert "0508605772" not in blob and "966508605772" not in blob and "[redacted]" in row["description"]
    detail = {"id": 199, "recent_imags": [{"url": "images/recent/1741599176-منشورات تيك توك (80).jpg"},
                                          {"url": "images/recent/1741599176.png"}]}
    urls = R.photo_urls({"cover": "images/recent/1741599176.png"}, detail)
    assert urls == ["https://api.eilmalriyada.com/images/recent/1741599176.png",
                    "https://api.eilmalriyada.com/images/recent/1741599176-%D9%85%D9%86%D8%B4%D9%88%D8%B1%D8%A7%D8%AA%20%D8%AA%D9%8A%D9%83%20%D8%AA%D9%88%D9%83%20%2880%29.jpg"]


# ═══════════════════════════════ 6. transport ════════════════════════════════════════════════════
class _Resp:
    def __init__(self, status, body):
        self.status_code, self.text = status, body

    def json(self):
        return json.loads(self.text)


class _Session:
    def __init__(self, answers):
        self.answers, self.calls = list(answers), []

    def get(self, url, timeout=None):
        self.calls.append(url)
        return self.answers.pop(0)


def test_catalogue_refuses_a_shell_or_an_empty_array():
    assert R.fetch_catalogue(_Session([_Resp(200, json.dumps([ELR_134]))]))[0]["id"] == 134
    for bad in (_Resp(200, "<html>"), _Resp(200, "[]"), _Resp(503, "[]"), _Resp(200, '{"data":[]}')):
        with pytest.raises(RuntimeError):
            R.fetch_catalogue(_Session([bad]))


def test_detail_retries_with_backoff_and_records_the_miss(monkeypatch):
    monkeypatch.setattr(R.time, "sleep", lambda *_: None)
    s = _Session([_Resp(429, ""), _Resp(200, json.dumps(dict(ELR_134, recent_imags=[])))])
    assert R.fetch_detail(s, 134)["id"] == 134 and len(s.calls) == 2
    s = _Session([_Resp(429, ""), _Resp(429, ""), _Resp(429, "")])
    assert R.fetch_detail(s, 134) is None and len(s.calls) == 3 and R.DETAIL_MISSES == {"HTTP 429": 1}
    s = _Session([_Resp(200, json.dumps({"id": 135}))] * 3)
    assert R.fetch_detail(s, 134) is None                               # another listing's record


# ═══════════════════════════════ 7. the oracle ═══════════════════════════════════════════════════
def test_signal_reads_the_measured_shapes():
    sig = R._signal_for(134)
    assert sig(404, '{"message":"العقار غير موجود"}', False) == "gone"
    assert sig(200, '{"id":134,"name":"x"}', False) == "live"
    assert sig(200, '{"id":135}', False) is None
    assert sig(404, '{"message":"other"}', False) is None
    assert sig(200, "<html>", False) is None
    assert R._verify_gone("ELRx")[0] == "unknown"


# ═══════════════════════════════ 8. main(): tally, stamp, gate, literal tables ═══════════════════
def _stub_db(monkeypatch):
    calls = {"batch": [], "end_run": [], "prune": [], "retire": [], "alive": []}
    db = types.SimpleNamespace(
        begin_run=lambda platform: 77,
        _wasalt_batch=lambda table, rows: calls["batch"].append((table, [r["ad_number"] for r in rows])),
        retire_superseded_siblings=lambda **kw: calls["retire"].append(kw) or 0,
        prune_unseen=lambda table, seen, source=None, **kw: calls["prune"].append((table, sorted(seen), kw)) or 0,
        end_run=lambda run_id, **kw: calls["end_run"].append((run_id, kw)) or True,
        mark_direct_alive=lambda row, oracle: calls["alive"].append((row["ad_number"], oracle)),
        AUTHORITATIVE_NULL=_db.AUTHORITATIVE_NULL,
    )
    monkeypatch.setattr(R, "db", db)
    monkeypatch.setattr(R.time, "sleep", lambda *_: None)
    monkeypatch.setattr(R, "session", lambda: object())
    return calls


_ITEMS = [ELR_134, ELR_245, ELR_664, ELR_QASSIM, ELR_PPM]
_DETAILS = {134: dict(ELR_134, recent_imags=[]), 245: None, 664: None, 223: None, 609: None}


def test_main_tallies_skips_stamps_direct_alive_and_prunes_only_behind_the_control(monkeypatch):
    calls = _stub_db(monkeypatch)
    monkeypatch.setattr(R, "fetch_catalogue", lambda s: list(_ITEMS))
    monkeypatch.setattr(R, "fetch_detail", lambda s, pid: _DETAILS[pid])
    monkeypatch.setattr(R, "_controls_live", lambda ads: False)
    monkeypatch.setattr(sys, "argv", ["run.py"])
    assert R.main() == 0
    assert calls["batch"] == [("eilmalriyada_residential_listings", ["ELR245"]),
                              ("eilmalriyada_commercial_listings", ["ELR134"])]
    assert calls["alive"] == [("ELR134", R.ORACLE)]                    # only the row read by its own id
    assert calls["retire"][0]["com_table"] == "eilmalriyada_commercial_listings"
    assert calls["prune"] == []
    run_id, kw = calls["end_run"][0]
    assert run_id == 77 and kw["ok"] is True and kw["rows_seen"] == 5 and kw["rows_upserted"] == 2
    for tally in ("off_planx1", "city_not_in_catalogx1", "type_unmappedx1", "detail_missx1", "pruned=0"):
        assert tally in kw["notes"], (tally, kw["notes"])
    assert kw["degraded"] is False                                      # 1 miss of 5 = 20 %, not > 20 %
    assert kw["check_tables"] == ["eilmalriyada_residential_listings", "eilmalriyada_commercial_listings"]

    calls = _stub_db(monkeypatch)
    monkeypatch.setattr(R, "_controls_live", lambda ads: ads[:2] == ["ELR245", "ELR134"])
    assert R.main() == 0
    assert [p[0] for p in calls["prune"]] == ["eilmalriyada_residential_listings", "eilmalriyada_commercial_listings"]
    assert calls["prune"][1][1] == ["ELR134"] and calls["prune"][0][2]["verify_gone"] is R._verify_gone


def test_a_blocked_catalogue_is_a_failed_run_that_writes_nothing(monkeypatch):
    calls = _stub_db(monkeypatch)

    def blocked(s):
        raise RuntimeError("/recent: not JSON — challenge or outage")
    monkeypatch.setattr(R, "fetch_catalogue", blocked)
    monkeypatch.setattr(sys, "argv", ["run.py"])
    assert R.main() == 1
    assert calls["batch"] == [] and calls["prune"] == []
    assert calls["end_run"][0][1]["ok"] is False and "not JSON" in calls["end_run"][0][1]["notes"]


def test_session_asks_for_arabic_json_and_never_sets_a_user_agent():
    s = R.session()
    assert s.headers["Accept"] == "application/json" and s.headers["Accept-Language"].startswith("ar")
    assert "User-Agent" not in s.headers and "user-agent" not in s.headers
