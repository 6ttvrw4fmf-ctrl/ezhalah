"""aalbarrak's traps: deal words living in the TYPE taxonomy, rent figures with no period, a
«بدأ البيع» project without a price, floors itemised in prose, «تأسيس مصعد», a REGA licence and
phones in both digit notations in the same body, and a per-id REST oracle measured on 3 real
deleted listings.

Fixtures are VERBATIM /wp-json/wp/v2/properties records captured 2026-09-24 (trimmed to the keys
the code reads) with the taxonomy names as served; assertions run the SHIPPING functions
(run.map_listing, run.rent_fields, run.prose_bedrooms, run.city_in_title, run._signal_for,
run.main). Offline: only to_catalog/find_district_in_text and db are stubbed.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

from scrapers.aalbarrak import run as R  # noqa: E402

TAX = {
    "property_type": {63: "أرض تجارية", 55: "أرض سكنية", 52: "دور", 58: "سكن عمال", 30: "سكني", 45: "شقة",
                      54: "عمارة سكنية", 59: "غرفة فندقية", 51: "فيلا", 64: "قريبا للبيع", 60: "قصر",
                      66: "للإيجار", 65: "للبيع", 62: "محل تجاري", 25: "مكتب"},
    "property_status": {74: "تم الايجار", 75: "تم البيع", 19: "للإيجار", 20: "للبيع"},
    "property_city": {33: "أبها", 14: "الدمام", 18: "الرياض", 12: "جدة", 67: "مكه"},
    "property_area": {}, "property_feature": {},
}
POST_20657 = {'id': 20657, 'link': 'https://aalbarrak.com/property/%d8%af%d9%88%d8%b1-%d9%84%d9%84%d8%a5%d9%8a%d8%ac%d8%a7%d8%b1-%d9%81%d9%8a-%d8%b4%d8%a7%d8%b1%d8%b9-%d9%85%d8%ad%d9%85%d8%af-%d8%a7%d9%84%d8%b3%d9%88%d8%a7%d9%86%d9%8a-%d8%ad%d9%8a-%d8%a7%d9%84%d9%82/', 'status': 'publish', 'date_gmt': '2026-06-20T22:14:29', 'modified_gmt': '2026-06-20T22:14:29', 'featured_media': 20659, 'title': {'rendered': 'دور للإيجار في شارع محمد السواني, حي القيروان, مدينة الرياض, منطقة الرياض'}, 'content': {'rendered': '<p>\u200fدور أرضي للإيجار تفاصيل الوحدة : -دور ارضي بحي القيراون مساحة ١٨١ متر &#8211; يحتوي على ٣ غرف نوم غرفة ماستر وغرفتين اخرى بحمام مشترك، بالاضافة إلى غرفة عاملة مستقلة. &#8211; \u2060 مدخلين للوحدة مدخل رئيسي ومدخل ثانوي &#8211; \u2060مجلس &#8211; \u2060مطبخ &#8211; \u2060صالة &#8211; \u2060عدادات مستقلة &#8211; \u2060حوش + مدخل سيارة للمعاينة يرجى التواصل ((الرقم يظهر عند الضغط على اتصال))</p>\n<p><img fetchpriority="high" decoding="async" class="alignnone size-medium wp-image-20658" src="https://aalbarrak.com/wp-content/uploads/2026/06/000762690_1781771109249-225x300.webp" alt="" width="225" height="300" srcset="https://aalbarrak.com/wp-content/uploads/2026/06/000762690_1781771109249-225x300.webp 225w, https://aalbarrak.com/wp-content/uploads/2026/06/000762690_1781771109249-450x600.webp 450w, https://aalbarrak.com/wp-content/uploads/2026/06/000762690_1781771109249-496x661.webp 496w, https://aalbarrak.com/wp-content/uploads/2026/06/000762690_1781771109249.webp 750w" sizes="(max-width: 225px) 100vw, 225px" /> <img decoding="async" class="alignnone size-medium wp-image-20659" src="https://aalbarrak.com/wp-content/uploads/2026/06/000762692_1781771083407-225x300.webp" alt="" width="225" height="300" srcset="https://aalbarrak.com/wp-content/uploads/2026/06/000762692_1781771083407-225x300.webp 225w, https://aalbarrak.com/wp-content/uploads/2026/06/000762692_1781771083407-450x600.webp 450w, https://aalbarrak.com/wp-content/uploads/2026/06/000762692_1781771083407-496x661.webp 496w, https://aalbarrak.com/wp-content/uploads/2026/06/000762692_1781771083407.webp 750w" sizes="(max-width: 225px) 100vw, 225px" /> <img decoding="async" class="alignnone size-medium wp-image-20660" src="https://aalbarrak.com/wp-content/uploads/2026/06/000762693_1781771083435-225x300.webp" alt="" width="225" height="300" srcset="https://aalbarrak.com/wp-content/uploads/2026/06/000762693_1781771083435-225x300.webp 225w, https://aalbarrak.com/wp-content/uploads/2026/06/000762693_1781771083435-450x600.webp 450w, https://aalbarrak.com/wp-content/uploads/2026/06/000762693_1781771083435-496x661.webp 496w, https://aalbarrak.com/wp-content/uploads/2026/06/000762693_1781771083435.webp 750w" sizes="(max-width: 225px) 100vw, 225px" /> <img loading="lazy" decoding="async" class="alignnone size-medium wp-image-20661" src="https://aalbarrak.com/wp-content/uploads/2026/06/000762693_1781771109250-225x300.webp" alt="" width="225" height="300" srcset="https://aalbarrak.com/wp-content/uploads/2026/06/000762693_1781771109250-225x300.webp 225w, https://aalbarrak.com/wp-content/uploads/2026/06/000762693_1781771109250-450x600.webp 450w, https://aalbarrak.com/wp-content/uploads/2026/06/000762693_1781771109250-496x661.webp 496w, https://aalbarrak.com/wp-content/uploads/2026/06/000762693_1781771109250.webp 750w" sizes="(max-width: 225px) 100vw, 225px" /> <img loading="lazy" decoding="async" class="alignnone size-medium wp-image-20662" src="https://aalbarrak.com/wp-content/uploads/2026/06/000762696_1781771109211-225x300.webp" alt="" width="225" height="300" srcset="https://aalbarrak.com/wp-content/uploads/2026/06/000762696_1781771109211-225x300.webp 225w, https://aalbarrak.com/wp-content/uploads/2026/06/000762696_1781771109211-450x600.webp 450w, https://aalbarrak.com/wp-content/uploads/2026/06/000762696_1781771109211-496x661.webp 496w, https://aalbarrak.com/wp-content/uploads/2026/06/000762696_1781771109211.webp 750w" sizes="(max-width: 225px) 100vw, 225px" /></p>\n'}, 'property_type': [52, 66], 'property_status': [19], 'property_city': [], 'property_area': [], 'property_feature': [], 'property_meta': {'fave_property_price': ['100000'], 'fave_property_land': ['181']}}   # rent, no period, no city term, «٣ غرف نوم» in prose only
POST_20609 = {'id': 20609, 'link': 'https://aalbarrak.com/property/%d9%81%d9%8a%d9%84%d8%a7-%d9%84%d9%84%d8%a8%d9%8a%d8%b9-%d9%81%d9%8a-%d8%b4%d8%a7%d8%b1%d8%b9-%d8%b9%d8%a8%d8%af%d8%a7%d9%84%d8%b1%d8%ad%d9%85%d9%86-%d8%a7%d9%84%d8%ad%d9%84%d9%88%d8%a7%d9%86%d9%8a-2/', 'status': 'publish', 'date_gmt': '2026-05-02T12:24:45', 'modified_gmt': '2026-05-02T12:24:45', 'featured_media': 20612, 'title': {'rendered': 'فيلا للبيع في شارع عبدالرحمن الحلواني, حي النرجس, مدينة الرياض, منطقة الرياض'}, 'content': {'rendered': '<p>بدأ البيع \u200fفلل و أدوار النرجس 33 \u200f مساحة الفلل \u200f230 متر \u200fشارع 20 شرقي \u200fوفيلا زاوية 230 متر \u200fشارع 20 جنوبي \u200fوشارع 20 شرقي \u200fكرك سيارة \u200fغرفة سائق \u200fمجلس رجال مع دورة مياه \u200fصالة نساء مع دورة مياه \u200fمطبخ \u200fغرفة خادمة مع غرفة غسيل \u200fحدائق خارجية وخلفية \u200fتأسيس مصعد \u200fالدور الأول \u200fغرفة نوم ماستر \u200fثلاثة أجنحة وصاله \u200fالسطح \u200fصالة ألعاب \u200fغرفتين نوم كل غرفة مع دورة مياه \u200fمسطح البناء 550 متر \u200fيوجد شهادة إتمام بناء \u200fيوجد تأمين ملاذ \u200fضد العيوب الخفية \u200fيوجد ضمانات على السباكة والكهرباء العوازل \u200f اشراف هندسي \u200fاختبار تربة \u200fتصوير مراحل البناء \u200fضمان التكييف خمس سنوات \u200fتكييف مركزي غرفة النوم الماستر راكب \u200fالمطبخ تكييف مركزي راكب \u200fصالة النساء والمجلس راكب تكييف مركزي \u200fضمان من الشركة المطورة بعد البيع سنتين \u200fالأسعار \u200fالزاوية 3,450,000 \u200f الشارع الواحد \u200f3,300,000</p>\n<p><img loading="lazy" decoding="async" class="alignnone size-medium wp-image-20610" src="https://aalbarrak.com/wp-content/uploads/2026/05/000762693_1770924289943-225x300.webp" alt="" width="225" height="300" srcset="https://aalbarrak.com/wp-content/uploads/2026/05/000762693_1770924289943-225x300.webp 225w, https://aalbarrak.com/wp-content/uploads/2026/05/000762693_1770924289943-450x600.webp 450w, https://aalbarrak.com/wp-content/uploads/2026/05/000762693_1770924289943-496x661.webp 496w, https://aalbarrak.com/wp-content/uploads/2026/05/000762693_1770924289943.webp 750w" sizes="(max-width: 225px) 100vw, 225px" /> <img loading="lazy" decoding="async" class="alignnone size-medium wp-image-20611" src="https://aalbarrak.com/wp-content/uploads/2026/05/000762694_1770924289944-225x300.webp" alt="" width="225" height="300" srcset="https://aalbarrak.com/wp-content/uploads/2026/05/000762694_1770924289944-225x300.webp 225w, https://aalbarrak.com/wp-content/uploads/2026/05/000762694_1770924289944-450x600.webp 450w, https://aalbarrak.com/wp-content/uploads/2026/05/000762694_1770924289944-496x661.webp 496w, https://aalbarrak.com/wp-content/uploads/2026/05/000762694_1770924289944.webp 750w" sizes="(max-width: 225px) 100vw, 225px" /> <img loading="lazy" decoding="async" class="alignnone size-medium wp-image-20612" src="https://aalbarrak.com/wp-content/uploads/2026/05/000762699_1770924289942-225x300.webp" alt="" width="225" height="300" srcset="https://aalbarrak.com/wp-content/uploads/2026/05/000762699_1770924289942-225x300.webp 225w, https://aalbarrak.com/wp-content/uploads/2026/05/000762699_1770924289942-450x600.webp 450w, https://aalbarrak.com/wp-content/uploads/2026/05/000762699_1770924289942-496x661.webp 496w, https://aalbarrak.com/wp-content/uploads/2026/05/000762699_1770924289942.webp 750w" sizes="(max-width: 225px) 100vw, 225px" /> <img loading="lazy" decoding="async" class="alignnone size-medium wp-image-20613" src="https://aalbarrak.com/wp-content/uploads/2026/05/000762699_1770924348099-225x300.webp" alt="" width="225" height="300" srcset="https://aalbarrak.com/wp-content/uploads/2026/05/000762699_1770924348099-225x300.webp 225w, https://aalbarrak.com/wp-content/uploads/2026/05/000762699_1770924348099-450x600.webp 450w, https://aalbarrak.com/wp-content/uploads/2026/05/000762699_1770924348099-496x661.webp 496w, https://aalbarrak.com/wp-content/uploads/2026/05/000762699_1770924348099.webp 750w" sizes="(max-width: 225px) 100vw, 225px" /></p>\n'}, 'property_type': [51, 65], 'property_status': [20], 'property_city': [], 'property_area': [], 'property_feature': [], 'property_meta': {'fave_property_land': ['230'], 'fave_property_bedrooms': ['6'], 'fave_property_bathrooms': ['7']}}   # «بدأ البيع …», NO price
POST_20465 = {'id': 20465, 'link': 'https://aalbarrak.com/property/%d9%81%d9%8a%d9%84%d8%a7-%d9%84%d9%84%d8%a8%d9%8a%d8%b9-%d9%81%d9%8a-%d8%b4%d8%a7%d8%b1%d8%b9-%d8%b9%d8%a8%d8%af%d8%a7%d9%84%d8%b1%d8%ad%d9%85%d9%86-%d8%a7%d9%84%d8%ad%d9%84%d9%88%d8%a7%d9%86%d9%8a/', 'status': 'publish', 'date_gmt': '2026-02-14T17:09:11', 'modified_gmt': '2026-05-02T12:19:02', 'featured_media': 20469, 'title': {'rendered': 'فيلا للبيع في شارع عبدالرحمن الحلواني, حي النرجس, مدينة الرياض, منطقة الرياض'}, 'content': {'rendered': '<p>بدأ البيع \u200fفلل و أدوار النرجس 33 \u200f مساحة الفلل \u200f230 متر \u200fشارع 20 شرقي \u200fوفيلا زاوية 230 متر \u200fشارع 20 جنوبي \u200fوشارع 20 شرقي \u200fكرك سيارة \u200fغرفة سائق \u200fمجلس رجال مع دورة مياه \u200fصالة نساء مع دورة مياه \u200fمطبخ \u200fغرفة خادمة مع غرفة غسيل \u200fحدائق خارجية وخلفية \u200fتأسيس مصعد \u200fالدور الأول \u200fغرفة نوم ماستر \u200fثلاثة أجنحة وصاله \u200fالسطح \u200fصالة ألعاب \u200fغرفتين نوم كل غرفة مع دورة مياه \u200fمسطح البناء 550 متر \u200fيوجد شهادة إتمام بناء \u200fيوجد تأمين ملاذ \u200fضد العيوب الخفية \u200fيوجد ضمانات على السباكة والكهرباء العوازل \u200f اشراف هندسي \u200fاختبار تربة \u200fتصوير مراحل البناء \u200fضمان التكييف خمس سنوات \u200fتكييف مركزي غرفة النوم الماستر راكب \u200fالمطبخ تكييف مركزي راكب \u200fصالة النساء والمجلس راكب تكييف مركزي \u200fضمان من المالك بعد البيع سنتين \u200fالأسعار \u200fالزاوية 3,450,000 \u200f الشارع الواحد \u200f3,300,000</p>\n<p><img loading="lazy" decoding="async" class="alignnone size-medium wp-image-20470" src="https://aalbarrak.com/wp-content/uploads/2026/02/000762699_1770924455678-225x300.webp" alt="" width="225" height="300" srcset="https://aalbarrak.com/wp-content/uploads/2026/02/000762699_1770924455678-225x300.webp 225w, https://aalbarrak.com/wp-content/uploads/2026/02/000762699_1770924455678-450x600.webp 450w, https://aalbarrak.com/wp-content/uploads/2026/02/000762699_1770924455678-496x661.webp 496w, https://aalbarrak.com/wp-content/uploads/2026/02/000762699_1770924455678.webp 750w" sizes="(max-width: 225px) 100vw, 225px" /> <img loading="lazy" decoding="async" class="alignnone size-medium wp-image-20469" src="https://aalbarrak.com/wp-content/uploads/2026/02/000762698_1770924455680-225x300.webp" alt="" width="225" height="300" srcset="https://aalbarrak.com/wp-content/uploads/2026/02/000762698_1770924455680-225x300.webp 225w, https://aalbarrak.com/wp-content/uploads/2026/02/000762698_1770924455680-768x1024.webp 768w, https://aalbarrak.com/wp-content/uploads/2026/02/000762698_1770924455680-450x600.webp 450w, https://aalbarrak.com/wp-content/uploads/2026/02/000762698_1770924455680-496x661.webp 496w, https://aalbarrak.com/wp-content/uploads/2026/02/000762698_1770924455680.webp 1000w" sizes="(max-width: 225px) 100vw, 225px" /> <img loading="lazy" decoding="async" class="alignnone size-medium wp-image-20468" src="https://aalbarrak.com/wp-content/uploads/2026/02/000762698_1770924455679-225x300.webp" alt="" width="225" height="300" srcset="https://aalbarrak.com/wp-content/uploads/2026/02/000762698_1770924455679-225x300.webp 225w, https://aalbarrak.com/wp-content/uploads/2026/02/000762698_1770924455679-450x600.webp 450w, https://aalbarrak.com/wp-content/uploads/2026/02/000762698_1770924455679-496x661.webp 496w, https://aalbarrak.com/wp-content/uploads/2026/02/000762698_1770924455679.webp 750w" sizes="(max-width: 225px) 100vw, 225px" /> <img loading="lazy" decoding="async" class="alignnone size-medium wp-image-20467" src="https://aalbarrak.com/wp-content/uploads/2026/02/000762696_1770924455681-225x300.webp" alt="" width="225" height="300" srcset="https://aalbarrak.com/wp-content/uploads/2026/02/000762696_1770924455681-225x300.webp 225w, https://aalbarrak.com/wp-content/uploads/2026/02/000762696_1770924455681-450x600.webp 450w, https://aalbarrak.com/wp-content/uploads/2026/02/000762696_1770924455681-496x661.webp 496w, https://aalbarrak.com/wp-content/uploads/2026/02/000762696_1770924455681.webp 750w" sizes="(max-width: 225px) 100vw, 225px" /> <img loading="lazy" decoding="async" class="alignnone size-medium wp-image-20466" src="https://aalbarrak.com/wp-content/uploads/2026/02/000762694_1770924455678-225x300.webp" alt="" width="225" height="300" srcset="https://aalbarrak.com/wp-content/uploads/2026/02/000762694_1770924455678-225x300.webp 225w, https://aalbarrak.com/wp-content/uploads/2026/02/000762694_1770924455678-450x600.webp 450w, https://aalbarrak.com/wp-content/uploads/2026/02/000762694_1770924455678-496x661.webp 496w, https://aalbarrak.com/wp-content/uploads/2026/02/000762694_1770924455678.webp 750w" sizes="(max-width: 225px) 100vw, 225px" /></p>\n'}, 'property_type': [51, 65], 'property_status': [20], 'property_city': [18], 'property_area': [], 'property_feature': [], 'property_meta': {'fave_property_price': ['3300000'], 'fave_property_land': ['230'], 'fave_property_bedrooms': ['6'], 'fave_property_rooms': ['2'], 'fave_property_bathrooms': ['5']}}   # same project text WITH a price, «تأسيس مصعد»
POST_20583 = {'id': 20583, 'link': 'https://aalbarrak.com/property/%d9%81%d9%8a%d9%84%d8%a7-%d9%84%d9%84%d8%a8%d9%8a%d8%b9-%d9%81%d9%8a-%d8%b4%d8%a7%d8%b1%d8%b9-%d9%85%d8%ad%d9%85%d8%af-%d8%a8%d8%b3%d9%8a%d9%88%d9%86%d9%8a-%d8%ad%d9%8a-%d8%a7%d9%84%d8%b9%d8%a7%d8%b1/', 'status': 'publish', 'date_gmt': '2026-04-04T14:29:22', 'modified_gmt': '2026-06-20T22:17:47', 'featured_media': 20586, 'title': {'rendered': 'فيلا للبيع في شارع محمد بسيوني, حي العارض, مدينة الرياض, منطقة الرياض'}, 'content': {'rendered': '<p>للبيع فيلا دبلكس حي العارض مخطط دانة الياسمين المساحة 225 متر عمر العقار 4 سنوات شارع 15 جنوبي قطعه رقم 426/2 مخطط رقم 3185 الدور الأرضي : مجلس رجال دورة مياه مقلط وصاله ومطبخ مغاسل وحمام غرفة سائق.. الدور الأول : غرفة نوم ماستر ثلاثة غرف نوم دورتين مياه السطح : صالة كبيرة وغرفه غسيل غرفة خادمة مع دورة السعر 2.700.000 ريال للاستفسار شركة عبدالله البراك للتطوير والاستثمار العقاري جوال 0559393694 رقم ترخيص الإعلان 7200922698</p>\n<p><img loading="lazy" decoding="async" class="alignnone size-medium wp-image-20584" src="https://aalbarrak.com/wp-content/uploads/2026/04/000762695_1775235537067-225x300.webp" alt="" width="225" height="300" srcset="https://aalbarrak.com/wp-content/uploads/2026/04/000762695_1775235537067-225x300.webp 225w, https://aalbarrak.com/wp-content/uploads/2026/04/000762695_1775235537067-450x600.webp 450w, https://aalbarrak.com/wp-content/uploads/2026/04/000762695_1775235537067-496x661.webp 496w, https://aalbarrak.com/wp-content/uploads/2026/04/000762695_1775235537067.webp 750w" sizes="(max-width: 225px) 100vw, 225px" /> <img loading="lazy" decoding="async" class="alignnone size-medium wp-image-20585" src="https://aalbarrak.com/wp-content/uploads/2026/04/000762695_1775235537213-225x300.webp" alt="" width="225" height="300" srcset="https://aalbarrak.com/wp-content/uploads/2026/04/000762695_1775235537213-225x300.webp 225w, https://aalbarrak.com/wp-content/uploads/2026/04/000762695_1775235537213-450x600.webp 450w, https://aalbarrak.com/wp-content/uploads/2026/04/000762695_1775235537213-496x661.webp 496w, https://aalbarrak.com/wp-content/uploads/2026/04/000762695_1775235537213.webp 750w" sizes="(max-width: 225px) 100vw, 225px" /> <img loading="lazy" decoding="async" class="alignnone size-medium wp-image-20586" src="https://aalbarrak.com/wp-content/uploads/2026/04/000762698_1775235491771-225x300.webp" alt="" width="225" height="300" srcset="https://aalbarrak.com/wp-content/uploads/2026/04/000762698_1775235491771-225x300.webp 225w, https://aalbarrak.com/wp-content/uploads/2026/04/000762698_1775235491771-450x600.webp 450w, https://aalbarrak.com/wp-content/uploads/2026/04/000762698_1775235491771-496x661.webp 496w, https://aalbarrak.com/wp-content/uploads/2026/04/000762698_1775235491771.webp 750w" sizes="(max-width: 225px) 100vw, 225px" /> <img loading="lazy" decoding="async" class="alignnone size-medium wp-image-20587" src="https://aalbarrak.com/wp-content/uploads/2026/04/000762698_1775235537238-225x300.webp" alt="" width="225" height="300" srcset="https://aalbarrak.com/wp-content/uploads/2026/04/000762698_1775235537238-225x300.webp 225w, https://aalbarrak.com/wp-content/uploads/2026/04/000762698_1775235537238-450x600.webp 450w, https://aalbarrak.com/wp-content/uploads/2026/04/000762698_1775235537238-496x661.webp 496w, https://aalbarrak.com/wp-content/uploads/2026/04/000762698_1775235537238.webp 750w" sizes="(max-width: 225px) 100vw, 225px" /> <img loading="lazy" decoding="async" class="alignnone size-medium wp-image-20588" src="https://aalbarrak.com/wp-content/uploads/2026/04/000762698_1775235537264-225x300.webp" alt="" width="225" height="300" srcset="https://aalbarrak.com/wp-content/uploads/2026/04/000762698_1775235537264-225x300.webp 225w, https://aalbarrak.com/wp-content/uploads/2026/04/000762698_1775235537264-450x600.webp 450w, https://aalbarrak.com/wp-content/uploads/2026/04/000762698_1775235537264-496x661.webp 496w, https://aalbarrak.com/wp-content/uploads/2026/04/000762698_1775235537264.webp 750w" sizes="(max-width: 225px) 100vw, 225px" /></p>\n'}, 'property_type': [51, 65], 'property_status': [20], 'property_city': [18], 'property_area': [], 'property_feature': [], 'property_meta': {'fave_property_price': ['2,700,000'], 'fave_property_land': ['225'], 'fave_property_bedrooms': ['1']}}   # licence, age, street, phone, price «2,700,000»
POST_20637 = {'id': 20637, 'link': 'https://aalbarrak.com/property/%d8%b4%d9%82%d8%a9-%d9%84%d9%84%d8%a5%d9%8a%d8%ac%d8%a7%d8%b1-%d9%81%d9%8a-%d8%b4%d8%a7%d8%b1%d8%b9-%d9%85%d8%ad%d9%85%d8%af-%d8%ae%d9%84%d9%8a%d9%84-%d8%b9%d8%a8%d8%af%d8%a7%d9%84%d8%ae%d8%a7%d9%84/', 'status': 'publish', 'date_gmt': '2026-05-16T14:41:23', 'modified_gmt': '2026-05-16T14:41:23', 'featured_media': 20639, 'title': {'rendered': 'شقة للإيجار في شارع محمد خليل عبدالخالق, حي النرجس, مدينة الرياض, منطقة الرياض'}, 'content': {'rendered': '<p>\u200fللإيجار \u200fشقة مودرن \u200fمشروع شركة إيناس 14 \u200fالمساحة 108 متر \u200fثلاث غرف نوم \u200fثلاث دورات مياه \u200fمطبخ \u200fغرفة خادمة غرفة غسيل \u200fصالة استقبال كبيرة للمعاينة يرجى التواصل ٠٥٦١١١٤٨٨٨</p>\n<p><img loading="lazy" decoding="async" class="alignnone size-medium wp-image-20639" src="https://aalbarrak.com/wp-content/uploads/2026/05/000762698_1778483130201-225x300.webp" alt="" width="225" height="300" srcset="https://aalbarrak.com/wp-content/uploads/2026/05/000762698_1778483130201-225x300.webp 225w, https://aalbarrak.com/wp-content/uploads/2026/05/000762698_1778483130201-450x600.webp 450w, https://aalbarrak.com/wp-content/uploads/2026/05/000762698_1778483130201-496x661.webp 496w, https://aalbarrak.com/wp-content/uploads/2026/05/000762698_1778483130201.webp 750w" sizes="(max-width: 225px) 100vw, 225px" /> <img loading="lazy" decoding="async" class="alignnone size-medium wp-image-20638" src="https://aalbarrak.com/wp-content/uploads/2026/05/000762690_1778483138673-225x300.webp" alt="" width="225" height="300" srcset="https://aalbarrak.com/wp-content/uploads/2026/05/000762690_1778483138673-225x300.webp 225w, https://aalbarrak.com/wp-content/uploads/2026/05/000762690_1778483138673-450x600.webp 450w, https://aalbarrak.com/wp-content/uploads/2026/05/000762690_1778483138673-496x661.webp 496w, https://aalbarrak.com/wp-content/uploads/2026/05/000762690_1778483138673.webp 750w" sizes="(max-width: 225px) 100vw, 225px" /></p>\n'}, 'property_type': [45], 'property_status': [19], 'property_city': [18], 'property_area': [], 'property_feature': [], 'property_meta': {'fave_property_price': ['65,000'], 'fave_property_land': ['108'], 'fave_property_bedrooms': ['3'], 'fave_property_bathrooms': ['4']}}   # Arabic-Indic phone «٠٥٦١١١٤٨٨٨»
POST_20651 = {'id': 20651, 'link': 'https://aalbarrak.com/property/%d9%81%d9%8a%d9%84%d8%a7-%d9%84%d9%84%d8%a8%d9%8a%d8%b9-%d9%81%d9%8a-%d8%b4%d8%a7%d8%b1%d8%b9-%d8%ac%d9%86%d9%88%d8%a8%d9%8a%d8%a9-%d8%b3%d8%af%d9%8a%d8%b1-%d8%ad%d9%8a-%d8%a7%d9%84%d9%85%d8%b5%d9%8a/', 'status': 'publish', 'date_gmt': '2026-06-20T21:33:54', 'modified_gmt': '2026-06-20T21:35:41', 'featured_media': 20653, 'title': {'rendered': 'فيلا للبيع في شارع جنوبية سدير, حي المصيف, مدينة الرياض, منطقة الرياض'}, 'content': {'rendered': '<p>\u200fللبيع فيلا \u200fبناء شخصي \u200fحي المصيف المربع الذهبي \u200fشارع 20 غربي \u200fالمساحة 805 متر \u200fالدور الأرضي \u200fغرفة سائق \u200fكراج سيارة \u200fيتسع إلى أربع سيارات \u200fملحق خارجي مع دورة مياه \u200fغرفة ضيافة \u200f مستودع مع دورة مياه \u200f ممكن الاستخدام ك غرفة خادمة \u200fحدائق خارجية \u200fمجلس رجال مع دورة مياه \u200fصالة طعام رجال \u200fصالة مع دورة مياه \u200fمجلس نساء \u200fغرفة كبار سن \u200fمع دورة مياه \u200fمطبخين \u200fالدور الأول \u200fصالة \u200fغرفة نوم ماستر \u200fثلاث غرف كل غرفة مع دورة مياه \u200fغرفتين نوم مع دورة مياه مشتركة \u200f السطح \u200fصالة ألعاب \u200fغرفة خادمة مع دورة مياه \u200fغرفة غسيل \u200fالفيلا كاملة التكييف راكب \u200fالسباكة تحويل ضمان 15 سنة \u200fالكهرباء الفنار ضمان 15 سنة \u200fالعزل ضمان 10 سنوات \u200fالمكيفات الضمان خمس سنوات \u200fالمصعد الضمان خمس سنوات \u200fإشراف هندسي \u200fتصوير مراحل البناء \u200fتأمين التعاونية \u200fالدور الأرضي التكييف مركزي راكب \u200fمعه غرفة النوم الماستر \u200fمع الصالات \u200fضمان على جميع المواد المستخدمة \u200fالخزان الأرضي أربعة في سبعة للمعاينة يرجى التواصل على ((الرقم يظهر عند الضغط على اتصال))</p>\n<p><img loading="lazy" decoding="async" class="alignnone size-medium wp-image-20652" src="https://aalbarrak.com/wp-content/uploads/2026/06/000762691_1781985507406-225x300.webp" alt="" width="225" height="300" srcset="https://aalbarrak.com/wp-content/uploads/2026/06/000762691_1781985507406-225x300.webp 225w, https://aalbarrak.com/wp-content/uploads/2026/06/000762691_1781985507406-450x600.webp 450w, https://aalbarrak.com/wp-content/uploads/2026/06/000762691_1781985507406-496x661.webp 496w, https://aalbarrak.com/wp-content/uploads/2026/06/000762691_1781985507406.webp 750w" sizes="(max-width: 225px) 100vw, 225px" /> <img loading="lazy" decoding="async" class="alignnone size-medium wp-image-20653" src="https://aalbarrak.com/wp-content/uploads/2026/06/000762692_1781985507390-225x300.webp" alt="" width="225" height="300" srcset="https://aalbarrak.com/wp-content/uploads/2026/06/000762692_1781985507390-225x300.webp 225w, https://aalbarrak.com/wp-content/uploads/2026/06/000762692_1781985507390-450x600.webp 450w, https://aalbarrak.com/wp-content/uploads/2026/06/000762692_1781985507390-496x661.webp 496w, https://aalbarrak.com/wp-content/uploads/2026/06/000762692_1781985507390.webp 750w" sizes="(max-width: 225px) 100vw, 225px" /> <img loading="lazy" decoding="async" class="alignnone size-medium wp-image-20654" src="https://aalbarrak.com/wp-content/uploads/2026/06/000762693_1781985507394-225x300.webp" alt="" width="225" height="300" srcset="https://aalbarrak.com/wp-content/uploads/2026/06/000762693_1781985507394-225x300.webp 225w, https://aalbarrak.com/wp-content/uploads/2026/06/000762693_1781985507394-450x600.webp 450w, https://aalbarrak.com/wp-content/uploads/2026/06/000762693_1781985507394-496x661.webp 496w, https://aalbarrak.com/wp-content/uploads/2026/06/000762693_1781985507394.webp 750w" sizes="(max-width: 225px) 100vw, 225px" /> <img loading="lazy" decoding="async" class="alignnone size-medium wp-image-20655" src="https://aalbarrak.com/wp-content/uploads/2026/06/000762698_1781985507410-225x300.webp" alt="" width="225" height="300" srcset="https://aalbarrak.com/wp-content/uploads/2026/06/000762698_1781985507410-225x300.webp 225w, https://aalbarrak.com/wp-content/uploads/2026/06/000762698_1781985507410-450x600.webp 450w, https://aalbarrak.com/wp-content/uploads/2026/06/000762698_1781985507410-496x661.webp 496w, https://aalbarrak.com/wp-content/uploads/2026/06/000762698_1781985507410.webp 750w" sizes="(max-width: 225px) 100vw, 225px" /></p>\n'}, 'property_type': [51, 65], 'property_status': [20], 'property_city': [], 'property_area': [], 'property_feature': [], 'property_meta': {'fave_property_price': ['10500000'], 'fave_property_land': ['805']}}   # bedrooms itemised across floors, warranties in years


@pytest.fixture(autouse=True)
def _no_catalog_network(monkeypatch):
    monkeypatch.setattr(R, "to_catalog", lambda c, region_hint=None: (3, 1) if c == "الرياض" else (None, None))
    monkeypatch.setattr(R, "find_district_in_text",
                        lambda t, cid: next((d for d in ("حي القيروان", "حي النرجس", "حي العارض", "حي المصيف")
                                             if t and d[3:] in t), None))


def _post(base, **over):
    p = json.loads(json.dumps(base))
    p.update(over)
    return p


def test_deal_words_in_the_type_taxonomy_are_not_types():
    row, cat, why = R.map_listing(POST_20657, TAX, [])
    assert why == "" and cat == "residential"
    assert row["property_type"] == "Floor" and row["transaction_type"] == "Rent"
    assert row["additional_info"]["type_terms_ar"] == ["دور", "للإيجار"]
    assert R.map_listing(_post(POST_20657, property_type=[66]), TAX, [])[2] == "type_unmapped"


def test_a_silent_rent_period_is_null_and_the_figure_is_not_scaled():
    row = R.map_listing(POST_20657, TAX, [])[0]
    assert row["rent_period"] is None and row["price_annual"] == 100_000
    assert "price_total" not in row and row["additional_info"]["price_raw"] == "100000"
    assert R.rent_fields(5_000, "الايجار 5000 شهري او سنوي") == (None, 5_000)
    assert R.rent_fields(5_000, "الايجار 5000 شهري") == ("monthly", 60_000)
    assert R.rent_fields(700, "700 يومي") == (None, None)


def test_sales_start_without_a_price_is_off_plan_but_the_priced_sibling_is_kept():
    assert R.map_listing(POST_20609, TAX, [])[2] == "off_plan_unpriced"
    row, _, why = R.map_listing(POST_20465, TAX, [])
    assert why == "" and row["price_total"] == 3_300_000


def test_coming_soon_term_and_sold_terms_are_skipped():
    assert R.map_listing(_post(POST_20583, property_type=[51, 64]), TAX, [])[2] == "coming_soon"
    assert R.map_listing(_post(POST_20583, property_status=[75]), TAX, [])[2] == "sold_or_rented"
    assert R.map_listing(_post(POST_20657, property_status=[74]), TAX, [])[2] == "sold_or_rented"
    sold_title = _post(POST_20583, title={"rendered": "فيلا للبيع في حي العارض, مدينة الرياض — تم البيع"})
    assert R.map_listing(sold_title, TAX, [])[2] == "sold_or_rented"       # the title's own marker
    assert R.map_listing(_post(POST_20583, property_status=[]), TAX, [])[0]["transaction_type"] == "Buy"  # title says للبيع


def test_a_body_only_closed_marker_still_skips_reviewer_2026_09_24():
    # The title carries no closed word at all — only the BODY does (a real shape the reviewer flagged
    # as unguarded: the check used to scope to the title alone). This must still skip, matching
    # almuteb's twin, which checks title+body.
    body_only = _post(POST_20583, content={"rendered": POST_20583["content"]["rendered"] + " تم التأجير"})
    assert body_only["title"] == POST_20583["title"]                      # title itself is unchanged
    assert R.map_listing(body_only, TAX, [])[2] == "sold_or_rented"
    # The feminine occupancy-disclosure form stays a non-match (unlike the masculine status marker
    # above) — «الفيلا الان مؤجرة» describes a tenant inside a still-for-sale unit, not a closed deal.
    tenant_disclosure = _post(POST_20583, content={"rendered": POST_20583["content"]["rendered"] + " الفيلا الان مؤجرة"})
    assert R.map_listing(tenant_disclosure, TAX, [])[2] == ""


def test_city_from_the_term_else_recognised_in_the_title_never_invented():
    row = R.map_listing(POST_20657, TAX, [])[0]            # no property_city term
    assert (row["city_ar"], row["city_id"], row["region_id"]) == ("الرياض", 3, 1)
    assert R.city_in_title("شقة للإيجار في حي النرجس") is None
    # The «مدينة X» segment places the listing, never a street or district named after another city.
    assert R.city_in_title("شقة للإيجار في شارع الرياض, حي الدمام, مدينة جدة, منطقة مكة المكرمة") == "جدة"
    nocity = _post(POST_20657, title={"rendered": "دور للإيجار في شارع محمد السواني, حي القيروان"})
    assert R.map_listing(nocity, TAX, [])[2] == "city_not_stated"
    assert R.map_listing(_post(POST_20657, property_city=[67]), TAX, [])[2] == "city_not_in_catalog"


def test_district_and_neighbourhood_come_from_the_title():
    row = R.map_listing(POST_20657, TAX, [])[0]
    assert row["district_ar"] == "حي القيروان" and row["neighborhood"] == "حي القيروان"
    # A street named like a district is not the district: only the «حي X» phrase is matched.
    street = _post(POST_20657, title={"rendered": "دور للإيجار في شارع القيروان, حي النرجس, مدينة الرياض, منطقة الرياض"})
    row = R.map_listing(street, TAX, [])[0]
    assert row["district_ar"] == "حي النرجس" and row["neighborhood"] == "حي النرجس"
    nohood = _post(POST_20657, title={"rendered": "دور للإيجار في شارع القيروان, مدينة الرياض, منطقة الرياض"})
    assert R.map_listing(nohood, TAX, [])[0]["district_ar"] is None


def test_prose_bedrooms_only_when_stated_once_and_structured_wins():
    assert R.map_listing(POST_20657, TAX, [])[0]["bedrooms"] == 3          # «٣ غرف نوم», Arabic-Indic
    assert R.map_listing(POST_20651, TAX, [])[0]["bedrooms"] is None       # itemised across floors
    assert R.map_listing(POST_20583, TAX, [])[0]["bedrooms"] == 1          # the field, not the prose
    assert R.prose_bedrooms("شقة غرفتين نوم وصالة ومطبخ") == 2                # the dual, stated once
    assert R.prose_bedrooms("ثلاث غرف نوم") == 3 and R.prose_bedrooms("5 غرف نوم") == 5
    assert R.prose_bedrooms("الدور الأول: غرفتين نوم. السطح: غرفة نوم") is None   # itemised → NULL
    assert R.prose_bedrooms("شقة واسعة") is None


def test_licence_age_street_and_direction_reach_their_columns_and_warranties_do_not():
    row = R.map_listing(POST_20583, TAX, [])[0]
    assert row["license_number"] == "7200922698" and row["property_age"] == 4
    assert (row["street_width_m"], row["direction"]) == (15, "جنوب")
    assert row["price_total"] == 2_700_000                                  # raw «2,700,000»
    assert R.map_listing(POST_20651, TAX, [])[0]["property_age"] is None   # «ضمان 15 سنة» is a warranty


def test_a_prepared_elevator_shaft_is_null_not_true():
    row = R.map_listing(POST_20465, TAX, [])[0]
    assert "elevator" not in row and row["maid_room"] is True and row["driver_room"] is True


def test_phones_in_both_digit_notations_are_redacted():
    assert "٠٥٦١١١٤٨٨٨" in POST_20637["content"]["rendered"] and "0559393694" in POST_20583["content"]["rendered"]
    for post in (POST_20637, POST_20583):
        desc = R.map_listing(post, TAX, [])[0]["description"]
        assert "[redacted]" in desc and "٠٥٦١١١٤٨٨٨" not in desc and "0559393694" not in desc


def test_liveness_signal_reads_only_what_was_measured():
    sig = R._signal_for(20657, TAX)
    assert sig(404, '{"code":"rest_post_invalid_id","message":"x","data":{"status":404}}', False) == "gone"
    assert sig(200, '{"id":20657,"status":"publish","property_status":[19]}', False) == "live"
    assert sig(200, '{"id":20657,"status":"publish","property_status":[75]}', False) == "gone"
    assert sig(200, '{"id":20651,"status":"publish","property_status":[20]}', False) is None
    assert sig(401, '{"code":"rest_forbidden"}', False) is None and sig(200, "", False) is None


def test_main_tallies_every_skip_into_end_run_notes(monkeypatch):
    calls: dict = {"batches": []}
    monkeypatch.setattr(sys, "argv", ["run.py"])
    monkeypatch.setattr(R, "session", lambda: object())
    monkeypatch.setattr(R, "fetch_taxonomies", lambda s: TAX)
    monkeypatch.setattr(R, "fetch_listings", lambda s, limit=0: ([POST_20657, POST_20609, POST_20583], 3))
    monkeypatch.setattr(R, "fetch_photos", lambda s, posts: {20657: ["https://aalbarrak.com/a.webp"]})
    monkeypatch.setattr(R.db, "begin_run", lambda platform: 7)
    monkeypatch.setattr(R.db, "_wasalt_batch", lambda tbl, rows: calls["batches"].append((tbl, [r["ad_number"] for r in rows])))
    monkeypatch.setattr(R.db, "retire_superseded_siblings", lambda **kw: 0)
    monkeypatch.setattr(R.db, "prune_unseen", lambda tbl, seen, source, **kw: 0)
    monkeypatch.setattr(R.db, "end_run", lambda run_id, **kw: calls.update(end=kw) or True)
    assert R.main() == 0
    assert calls["batches"][0] == ("aalbarrak_residential_listings", ["BRK20657", "BRK20583"])
    assert calls["end"]["rows_seen"] == 3 and calls["end"]["rows_upserted"] == 2
    assert "off_plan_unpricedx1" in calls["end"]["notes"] and "complete=True" in calls["end"]["notes"]
    assert calls["end"]["check_tables"] == ["aalbarrak_residential_listings", "aalbarrak_commercial_listings"]
