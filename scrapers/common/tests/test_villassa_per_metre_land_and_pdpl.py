"""فلل (villas-sa.com) barrier: a land ad prints TWO figures and the scraper multiplies NEITHER.

Measured live 2026-09-23 on all 14 ads: the catalogue card prints `price` and the detail prints
`main.price`. On 6/6 non-land ads they are equal; on 8/8 land ads card == detail × area (21:
«1,037,933» vs «1,300» × 798.41). The detail figure on land is the REGA per-metre rate and the
card figure the site's own total. Every stored number here is one the site printed: price_total is
the CARD string, price_per_meter the DETAIL string. A scraper that multiplied, or that stored the
land detail figure as the total, prints a 798 m² plot at 1,300 riyals.

PROVENANCE: every fixture below is copied verbatim from the live `/api/real/estate` (cards) and
`/api/real/estate/<id>` (details) responses captured 2026-09-23 for ids 21, 93, 95, 99, 100 and
102, trimmed to the keys map_listing reads (images cut to three; the owner block and the two
«مسؤول الإعلان» rows are kept ONLY on 102, to prove they never reach a row). Two shapes are
SYNTHETIC and say so in their test: the delisted record (main.status flipped to "0" — the shape
the live ids 11/90/6 answer) and the monthly-labelled rent string.

Every assertion runs the SHIPPING functions (run.map_listing, run.split_prices, run._services,
run._signal_for, run.session, run.main). Only the two DB-backed location helpers are stubbed.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

from scrapers.villassa import run as R  # noqa: E402

# ── offline stand-ins for the only two DB-backed helpers ────────────────────────────────────────
_CATALOG = {"الرياض": (3, 1), "الخبر": (31, 5), "سكاكا": (2237, 13), "مكة المكرمة": (6, 2),
            "الدمام": (13, 5)}
_DISTRICTS = {(31, "العقيق"): "حي العقيق", (3, "الملقا"): "حي الملقا", (3, "الدريهمية"): "حي الدريهمية",
              (2237, "الزهور"): "حي الزهور", (13, "العروبة"): "حي العروبة"}
R.to_catalog = lambda city_ar, region_hint=None: _CATALOG.get((city_ar or "").strip(), (None, None))
R.find_district_in_text = lambda text, city_id: _DISTRICTS.get((city_id, (text or "").strip()))

# ── VERBATIM live payloads (2026-09-23) ─────────────────────────────────────────────────────────
CARD_21 = {
 "id": 21,
 "price": "1,037,933 ريال",
 "address": "العقيق - الخبر",
 "for_sale": True
}
DETAIL_21 = {
 "main": {
  "id": 21,
  "category": "ارض",
  "type": "بيع",
  "price": "1,300 ريال",
  "for_sale": True,
  "estate_space": "798.41",
  "created_at": "Feb 24",
  "url": "https://villas-sa.com/real/estate/ads/21",
  "views": 22,
  "status": "1"
 },
 "details": [
  {
   "name": "رقم ترخيص الإعلان",
   "value": "7100262790"
  },
  {
   "name": "عرض الشارع",
   "value": "16"
  },
  {
   "name": "مساحة العقار",
   "value": "798.41"
  },
  {
   "name": "نوع العقار",
   "value": "ارض"
  },
  {
   "name": "واجهة العقار",
   "value": "شرقية - جنوبية"
  },
  {
   "name": "رقم المخطط",
   "value": "ش خ 838"
  },
  {
   "name": "رقم القطعة",
   "value": "635"
  },
  {
   "name": "استخدام العقار",
   "value": "سكني"
  },
  {
   "name": "خدمات العقار",
   "value": "صرف صحي, كهرباء, مياه"
  },
  {
   "name": "تاريخ انتهاء رخصة الإعلان",
   "value": "12/11/2026"
  }
 ],
 "properites": [
  {
   "name": "واجهة العقار",
   "value": "شرقية - جنوبية"
  },
  {
   "name": "نوع الاستخدام الرئيسي للوحدة",
   "value": "سكني"
  },
  {
   "name": "نوع المنطقة الحمراء",
   "value": "حظر تجاري"
  },
  {
   "name": "رابط رخصة الإعلان",
   "value": "https://eservicesredp.rega.gov.sa/public/IndividualBroker/ElanDetails/08de723a-66d3-41d2-8800-90cde368649b"
  },
  {
   "name": "مصدر الإعلان",
   "value": "الهيئة العامة للعقار"
  },
  {
   "name": "نوع الصك",
   "value": " صك السجل العقاري"
  }
 ],
 "map": {
  "lat": "26.09928711646592",
  "lon": "50.154362811245036",
  "address": "العقيق-المنطقة الشرقية-الخبر"
 },
 "description": " للبيع ارض موقعها مميز في حي العقيق الخبر",
 "images": [
  "https://villas-sa.com/api/watermarked-image?path=QWRzLzY5OWQ5MTgyM2VhZGFfaW1hZ2UwLmpwZw%3D%3D&opacity=100"
 ]
}
CARD_102 = {
 "id": 102,
 "price": "4,200,000 ريال",
 "address": "الملقا - الرياض",
 "for_sale": True
}
DETAIL_102 = {
 "main": {
  "id": 102,
  "category": "فيلا",
  "type": "بيع",
  "price": "4,200,000 ريال",
  "for_sale": True,
  "estate_space": "200.25",
  "created_at": "Sep 18",
  "url": "https://villas-sa.com/real/estate/ads/102",
  "views": 6,
  "status": "1"
 },
 "details": [
  {
   "name": "رقم ترخيص الإعلان",
   "value": "7100308181"
  },
  {
   "name": "اسم مسؤول الإعلان",
   "value": "علي محمد علي الزنان"
  },
  {
   "name": "رقم جوال مسؤول الإعلان",
   "value": "0533253031"
  },
  {
   "name": "عرض الشارع",
   "value": "20"
  },
  {
   "name": "مساحة العقار",
   "value": "200.25"
  },
  {
   "name": "عدد الغرف",
   "value": "5"
  },
  {
   "name": "نوع العقار",
   "value": "فيلا"
  },
  {
   "name": "عمر العقار",
   "value": "جديد"
  },
  {
   "name": "واجهة العقار",
   "value": "شمالية غربية"
  },
  {
   "name": "رقم المخطط",
   "value": "2460/أ"
  },
  {
   "name": "رقم القطعة",
   "value": "3300/1"
  },
  {
   "name": "استخدام العقار",
   "value": "سكني"
  },
  {
   "name": "خدمات العقار",
   "value": "مياه, هاتف, صرف صحي, ألياف ضوئية, كهرباء, تصريف الفيضانات "
  },
  {
   "name": "تاريخ انتهاء رخصة الإعلان",
   "value": "06/08/2027"
  }
 ],
 "properites": [
  {
   "name": "واجهة العقار",
   "value": "شمالية غربية"
  },
  {
   "name": "نوع الاستخدام الرئيسي للوحدة",
   "value": "سكني"
  },
  {
   "name": "نوع المنطقة الحمراء",
   "value": "حظر تجاري"
  },
  {
   "name": "رابط رخصة الإعلان",
   "value": "https://eservicesredp.rega.gov.sa/public/IndividualBroker/ElanDetails/08def409-f0ba-4142-87ee-0fdcf28178a7"
  },
  {
   "name": "مصدر الإعلان",
   "value": "الهيئة العامة للعقار"
  },
  {
   "name": "نوع الصك",
   "value": " صك السجل العقاري"
  }
 ],
 "map": {
  "lat": "24.803594627894903",
  "lon": "46.60150937407057",
  "address": "الملقا-منطقة الرياض-الرياض"
 },
 "description": " فيلا 200 متر بموقع استراتيجي بجانب طريق انس بن مالك\n\nوالملك فهد\nبمربع فخم من اجمل مربعات ومخططات الملقا\n\nعلى شارعين 20 وشارع 15\n\nتتكون الدور الارضي من غرفة سائق وحوش واسع \n\nومجلس وصالة ومسبح وغرفة خادمه ومستودع وغسيل\n\nوتتكون من اربع غرف نوم ماستر\n\nتكييف مخفي\n\nمسبح\n\nجميع الضمانات على المواد\n\nيوجد تامين التعاونيه على العيوب الخفية 10 سنوات\n\nمن تطوير شركة ارايا للتطوير العقاري",
 "images": [
  "https://villas-sa.com/api/watermarked-image?path=QWRzLzZhYWQzZjJiMGViYWNfaW1hZ2UwLmpwZw%3D%3D&opacity=100",
  "https://villas-sa.com/api/watermarked-image?path=QWRzLzZhYWQzZjJiMGZmN2VfaW1hZ2UxLmpwZw%3D%3D&opacity=100",
  "https://villas-sa.com/api/watermarked-image?path=QWRzLzZhYWQzZjJiMTY1ZmNfaW1hZ2UyLmpwZw%3D%3D&opacity=100"
 ],
 "owner": {
  "id": 121,
  "name": "علي محمد علي الزنان",
  "image": "https://villas-sa.com/assets/images/faces/1.jpg",
  "phone": "0533253031",
  "whatsapp": "https://api.whatsapp.com/send/?phone=9660533253031&text=https://villas-sa.com/show/102&type=phone_number&app_absent=0",
  "date": "2026"
 }
}
CARD_100 = {
 "id": 100,
 "price": "3,700 ريال",
 "address": "الدريهمية - الرياض",
 "for_sale": False
}
DETAIL_100 = {
 "main": {
  "id": 100,
  "category": "مكتب",
  "type": "إيجار",
  "price": "3,700 ريال",
  "for_sale": True,
  "estate_space": "5000",
  "created_at": "Aug 24",
  "url": "https://villas-sa.com/real/estate/ads/100",
  "views": 16,
  "status": "1"
 },
 "details": [
  {
   "name": "رقم ترخيص الإعلان",
   "value": "7100307921"
  },
  {
   "name": "مساحة العقار",
   "value": "5000"
  },
  {
   "name": "عدد الغرف",
   "value": "150"
  },
  {
   "name": "نوع العقار",
   "value": "مكتب"
  },
  {
   "name": "عمر العقار",
   "value": "جديد"
  },
  {
   "name": "استخدام العقار",
   "value": "تجاري"
  },
  {
   "name": "خدمات العقار",
   "value": "ألياف ضوئية, صرف صحي, مياه, تصريف الفيضانات , كهرباء"
  },
  {
   "name": "تاريخ انتهاء رخصة الإعلان",
   "value": "16/07/2027"
  }
 ],
 "properites": [
  {
   "name": "نوع الاستخدام الرئيسي للوحدة",
   "value": "تجاري"
  },
  {
   "name": "نوع المنطقة الحمراء",
   "value": "لا يوجد حظر"
  },
  {
   "name": "رابط رخصة الإعلان",
   "value": "https://eservicesredp.rega.gov.sa/public/IndividualBroker/ElanDetails/08def38e-d873-4d2b-84b6-f17d73141e62"
  },
  {
   "name": "مصدر الإعلان",
   "value": "الهيئة العامة للعقار"
  },
  {
   "name": "نوع الصك",
   "value": "عقد ايجار الكتروني"
  }
 ],
 "map": {
  "lat": "24.59479517462703",
  "lon": "46.69490516391593",
  "address": "الدريهمية-منطقة الرياض-الرياض"
 },
 "description": " 🏢 مكاتب خاصة ومشتركة، مستودعات، ومواقف سيارات للإيجار.\n📅 خيارات تأجير مرنة: بالساعة، يومي، شهري، أو سنوي.\n✨ نوفر بيئة عمل متكاملة في 3 فروع بمدينة الرياض، تشمل:\nإنترنت فايبر، قاعات اجتماعات، موظف استقبال، نظافة، طابعات، جيم، كوفي، صالة بريك، ومواقف سيارات، مع شمول الكهرباء والمياه.\n📍 الفروع: العارض – السويدي – الروضة.\nلـلـتـواصـل والـمفاهمة/ 966542593555+📱\n•\nرقم الترخيص الإعلاني: 7100307921 ✅\nرقم رخصة الوساطة العقارية: 1100260351 💠",
 "images": [
  "https://villas-sa.com/api/watermarked-image?path=QWRzLzZhOGM1ZTFmNjI2OWFfaW1hZ2UwLmpwZw%3D%3D&opacity=100",
  "https://villas-sa.com/api/watermarked-image?path=QWRzLzZhOGM1ZTFmNzZmMmVfaW1hZ2UxLmpwZw%3D%3D&opacity=100",
  "https://villas-sa.com/api/watermarked-image?path=QWRzLzZhOGM1ZTFmOGU1M2NfaW1hZ2UyLmpwZw%3D%3D&opacity=100"
 ]
}
CARD_93 = {
 "id": 93,
 "price": "2,220,000 ريال",
 "address": "الملك فهد - مكة المكرمة",
 "for_sale": True
}
DETAIL_93 = {
 "main": {
  "id": 93,
  "category": "ارض",
  "type": "بيع",
  "price": "3,700 ريال",
  "for_sale": True,
  "estate_space": "600",
  "created_at": "Aug 19",
  "url": "https://villas-sa.com/real/estate/ads/93",
  "views": 3,
  "status": "1"
 },
 "details": [
  {
   "name": "رقم ترخيص الإعلان",
   "value": "7100310952"
  },
  {
   "name": "عرض الشارع",
   "value": "20"
  },
  {
   "name": "مساحة العقار",
   "value": "600"
  },
  {
   "name": "نوع العقار",
   "value": "ارض"
  },
  {
   "name": "واجهة العقار",
   "value": "غربية"
  },
  {
   "name": "رقم المخطط",
   "value": "1 / 29 / 15 / ب"
  },
  {
   "name": "رقم القطعة",
   "value": "47"
  },
  {
   "name": "استخدام العقار",
   "value": "استعمال مختلط"
  },
  {
   "name": "خدمات العقار",
   "value": "صرف صحي, كهرباء, هاتف, ألياف ضوئية, مياه"
  },
  {
   "name": "تاريخ انتهاء رخصة الإعلان",
   "value": "16/08/2027"
  }
 ],
 "properites": [
  {
   "name": "واجهة العقار",
   "value": "غربية"
  },
  {
   "name": "نوع الاستخدام الرئيسي للوحدة",
   "value": "استعمال مختلط"
  },
  {
   "name": "نوع المنطقة الحمراء",
   "value": "لا يوجد حظر"
  },
  {
   "name": "رابط رخصة الإعلان",
   "value": "https://eservicesredp.rega.gov.sa/public/IndividualBroker/ElanDetails/08defb1d-cd19-4909-8c6a-a2e630e78d84"
  },
  {
   "name": "مصدر الإعلان",
   "value": "الهيئة العامة للعقار"
  },
  {
   "name": "نوع الصك",
   "value": "صك إلكتروني"
  }
 ],
 "map": {
  "lat": "21.405267676327554",
  "lon": "39.767005359133286",
  "address": "الملك فهد-منطقة مكة المكرمة-مكة المكرمة"
 },
 "description": " ارض للبيع موقع مميز جدا",
 "images": [
  "https://villas-sa.com/api/watermarked-image?path=QWRzLzZhODYzZjZhNDVmM2NfaW1hZ2UwLmpwZw%3D%3D&opacity=100"
 ]
}
CARD_99 = {
 "id": 99,
 "price": "1,200,000 ريال",
 "address": "الزهور - سكاكا",
 "for_sale": True
}
DETAIL_99 = {
 "main": {
  "id": 99,
  "category": "فيلا",
  "type": "بيع",
  "price": "1,200,000 ريال",
  "for_sale": True,
  "estate_space": "609.01",
  "created_at": "Aug 24",
  "url": "https://villas-sa.com/real/estate/ads/99",
  "views": 2,
  "status": "1"
 },
 "details": [
  {
   "name": "رقم ترخيص الإعلان",
   "value": "7100313688"
  },
  {
   "name": "عرض الشارع",
   "value": "25"
  },
  {
   "name": "مساحة العقار",
   "value": "609.01"
  },
  {
   "name": "عدد الغرف",
   "value": "10"
  },
  {
   "name": "نوع العقار",
   "value": "فيلا"
  },
  {
   "name": "عمر العقار",
   "value": "اربع سنوات"
  },
  {
   "name": "واجهة العقار",
   "value": "شرقية"
  },
  {
   "name": "رقم المخطط",
   "value": "22 / 1 / 2 / 1414"
  },
  {
   "name": "رقم القطعة",
   "value": "189"
  },
  {
   "name": "استخدام العقار",
   "value": "سكني"
  },
  {
   "name": "خدمات العقار",
   "value": "مياه, ألياف ضوئية, كهرباء, صرف صحي"
  },
  {
   "name": "تاريخ انتهاء رخصة الإعلان",
   "value": "16/07/2027"
  }
 ],
 "properites": [
  {
   "name": "واجهة العقار",
   "value": "شرقية"
  },
  {
   "name": "نوع الاستخدام الرئيسي للوحدة",
   "value": "سكني"
  },
  {
   "name": "نوع المنطقة الحمراء",
   "value": "حظر تجاري"
  },
  {
   "name": "رابط رخصة الإعلان",
   "value": "https://eservicesredp.rega.gov.sa/public/IndividualBroker/ElanDetails/08df01c3-20cc-477f-8ca2-64e6f17fbcc2"
  },
  {
   "name": "مصدر الإعلان",
   "value": "الهيئة العامة للعقار"
  },
  {
   "name": "نوع الصك",
   "value": "صك إلكتروني"
  }
 ],
 "map": {
  "lat": "29.91725551175607",
  "lon": "40.20570557488861",
  "address": "الزهور-منطقة الجوف-سكاكا"
 },
 "description": " فيلا للبيع 🏡🔑 \nعلى شارع عرض 25 م\nمع ممرين بمثابة ثلاث شوارع \n.\nالفيلا دورين مع حوش كبير بغرفة 🔹\n.\nالدور الاول 1️⃣\nمجلس رجال\nمقلط\nمجلس نساء\nغرفة\nمطبخ\nدورتين مياه\n.\nالدور الثاني 2️⃣\nملحق فيه غرفتين\nغرفة نوم وغرفة صغيرة\nمع دورة مياة وبلكونة\nاربع غرف نوم\nدورتين مياه\nسطح\n.\nعمر العقار 4 سنوات\nقريبة من الخدمات وجامع\nومطاعم ومحطة وقود وغيرها \nوبنك وكلية ومستشفى والأمـانة 🏪\nالموقع في سكاكا الجوف - حي الزهور📍\nلـتـواصـل والمفـاهمة/  966542593555+📱\n.\nالمساحة: 609 م 📐\nالــســعـــر: 1200000﷼ 💳\nالـــقــيـــود: الـعـقــار مــرهــون 🔗\nرقم الترخيص الإعلاني: 7100313688 ✅\nرقم رخصة الوساطة العقارية: 1100260351 💠",
 "images": [
  "https://villas-sa.com/api/watermarked-image?path=QWRzLzZhOGM1Y2U4MDUxODhfaW1hZ2UwLmpwZw%3D%3D&opacity=100",
  "https://villas-sa.com/api/watermarked-image?path=QWRzLzZhOGM1Y2U4M2MwYThfaW1hZ2UxLmpwZw%3D%3D&opacity=100",
  "https://villas-sa.com/api/watermarked-image?path=QWRzLzZhOGM1Y2U4M2MzNDFfaW1hZ2UyLmpwZw%3D%3D&opacity=100"
 ]
}
CARD_95 = {
 "id": 95,
 "price": "1,699,074 ريال",
 "address": "العروبة - الدمام",
 "for_sale": True
}
DETAIL_95 = {
 "main": {
  "id": 95,
  "category": "ارض",
  "type": "بيع",
  "price": "1,300 ريال",
  "for_sale": True,
  "estate_space": "1306.98",
  "created_at": "Aug 19",
  "url": "https://villas-sa.com/real/estate/ads/95",
  "views": 6,
  "status": "1"
 },
 "details": [
  {
   "name": "رقم ترخيص الإعلان",
   "value": "7100309396"
  },
  {
   "name": "عرض الشارع",
   "value": "20"
  },
  {
   "name": "مساحة العقار",
   "value": "1306.98"
  },
  {
   "name": "نوع العقار",
   "value": "ارض"
  },
  {
   "name": "واجهة العقار",
   "value": "شمالية شرقية - غربية - ثلاثة شوارع"
  },
  {
   "name": "رقم المخطط",
   "value": "ش د 1015"
  },
  {
   "name": "رقم القطعة",
   "value": "110"
  },
  {
   "name": "استخدام العقار",
   "value": "سكني"
  },
  {
   "name": "خدمات العقار",
   "value": "مياه, هاتف, كهرباء, صرف صحي"
  },
  {
   "name": "تاريخ انتهاء رخصة الإعلان",
   "value": "11/08/2027"
  }
 ],
 "properites": [
  {
   "name": "واجهة العقار",
   "value": "شمالية شرقية - غربية - ثلاثة شوارع"
  },
  {
   "name": "نوع الاستخدام الرئيسي للوحدة",
   "value": "سكني"
  },
  {
   "name": "نوع المنطقة الحمراء",
   "value": "لا يوجد حظر"
  },
  {
   "name": "رابط رخصة الإعلان",
   "value": "https://eservicesredp.rega.gov.sa/public/IndividualBroker/ElanDetails/08def78f-2cae-45a1-89f4-907bdd1fd06b"
  },
  {
   "name": "مصدر الإعلان",
   "value": "الهيئة العامة للعقار"
  },
  {
   "name": "نوع الصك",
   "value": "صك إلكتروني"
  }
 ],
 "map": {
  "lat": "26.342227721027946",
  "lon": "50.003977774453794",
  "address": "العروبة-المنطقة الشرقية-الدمام"
 },
 "description": " للبيع ارض في حي العروبة الدمام",
 "images": [
  "https://villas-sa.com/api/watermarked-image?path=QWRzLzZhODY0MGFiYjU5MmZfaW1hZ2UwLmpwZw%3D%3D&opacity=100"
 ]
}


def _row(card, detail):
    row, cat, why = R.map_listing(card, json.loads(json.dumps(detail)))
    assert row is not None, why
    return row, cat


# ── PRICE: two printed figures, nothing multiplied ──────────────────────────────────────────────
def test_a_land_ads_card_total_and_detail_rate_land_in_their_own_columns():
    row, cat = _row(CARD_21, DETAIL_21)
    assert row["price_total"] == 1037933, "the CARD's printed total, verbatim"
    assert row["price_per_meter"] == 1300, "the DETAIL's printed figure is the per-metre rate"
    assert row["property_type"] == "Residential Land" and cat == "residential"
    assert row["additional_info"]["price_kind"] == "card_total_detail_per_metre"
    assert row["additional_info"]["price_evidence"]["raw"] == "1,037,933 ريال | 1,300 ريال"


def test_the_land_detail_figure_is_never_stored_as_the_total():
    row, _ = _row(CARD_21, DETAIL_21)
    assert row["price_total"] != 1300, "a 798 m² plot at 1,300 riyals is the bug this file exists for"


def test_split_prices_never_multiplies_when_the_two_figures_do_not_reconcile():
    """Card 1,000,000 vs detail 1,300 on 798.41 m²: 1,300 × 798.41 = 1,037,933 ≠ 1,000,000. The
    card total is kept, no rate is claimed, and the product never appears anywhere."""
    total, ppm, kind = R.split_prices("1,000,000 ريال", "1,300 ريال", "798.41")
    assert (total, ppm, kind) == (1000000, None, "unreconciled")
    assert 1037933 not in (total, ppm)


def test_equal_figures_on_a_dwelling_are_one_total_and_no_rate():
    row, _ = _row(CARD_102, DETAIL_102)
    assert row["price_total"] == 4200000
    assert "price_per_meter" not in row
    assert row["additional_info"]["price_kind"] == "card_equals_detail"


def test_a_missing_card_figure_falls_back_to_the_detail_verbatim_without_a_rate():
    assert R.split_prices(None, "1,300 ريال", "798.41") == (1300, None, "detail_only")
    assert R.split_prices("4,200,000 ريال", None, "200.25") == (4200000, None, "card_only")


# ── RENT PERIOD: read from the price string only ────────────────────────────────────────────────
def test_a_silent_rent_period_stays_null_and_the_figure_is_not_converted():
    """Id 100's prose offers «بالساعة، يومي، شهري، أو سنوي» — every period at once, labelling
    nothing. The price string «3,700 ريال» carries no period → NULL, 3,700 unconverted."""
    row, cat = _row(CARD_100, DETAIL_100)
    assert row["transaction_type"] == "Rent" and cat == "commercial"
    assert row["price_annual"] == 3700 and "rent_period" not in row
    assert "price_total" not in row


def test_a_period_stated_on_the_price_string_itself_is_honoured():
    """SYNTHETIC: the live string never carries a period. A «شهري» on the price string would be
    the source's own word for THAT figure → monthly, ×12 storage."""
    d = json.loads(json.dumps(DETAIL_100)); d["main"]["price"] = "3,700 ريال شهري"
    row, _ = _row(CARD_100, d)
    assert (row["rent_period"], row["price_annual"]) == ("monthly", 44400)


def test_the_deal_is_the_detail_type_word_never_the_for_sale_flag():
    assert DETAIL_100["main"]["for_sale"] is True, "the live payload really says for_sale on a rental"
    row, _ = _row(CARD_100, DETAIL_100)
    assert row["transaction_type"] == "Rent"


# ── SKIP, NEVER GUESS ───────────────────────────────────────────────────────────────────────────
def test_mixed_use_land_is_skipped_and_the_reason_is_named():
    row, _, why = R.map_listing(CARD_93, DETAIL_93)
    assert row is None and why == "usage_mixed_land"


def test_land_usage_decides_the_land_type_only_from_the_sources_word():
    assert R._land_type("سكني") == ("Residential Land", "")
    assert R._land_type("تجاري") == ("Commercial Land", "")
    assert R._land_type("استعمال مختلط") == (None, "usage_mixed_land")
    assert R._land_type(None) == (None, "usage_unstated_land")


def test_a_delisted_record_is_skipped_by_its_status_flag():
    """SYNTHETIC shape, measured on live ids 11/90/6: HTTP 200, main.status "0"."""
    d = json.loads(json.dumps(DETAIL_21)); d["main"]["status"] = "0"
    row, _, why = R.map_listing(CARD_21, d)
    assert row is None and why == "status_0"


def test_an_unplaceable_city_is_skipped_never_defaulted():
    d = json.loads(json.dumps(DETAIL_21)); d["map"]["address"] = "العقيق-المنطقة الشرقية-مدينة لا وجود لها"
    card = dict(CARD_21, address="العقيق - مدينة لا وجود لها")
    row, _, why = R.map_listing(card, d)
    assert row is None and why == "city_not_in_catalog"


def test_an_unknown_type_is_skipped():
    d = json.loads(json.dumps(DETAIL_102)); d["main"]["category"] = "برج"
    row, _, why = R.map_listing(CARD_102, d)
    assert row is None and why == "type_unmapped"


def test_a_record_whose_id_does_not_match_its_card_is_refused():
    row, _, why = R.map_listing(dict(CARD_102, id=999), DETAIL_102)
    assert row is None and why == "no_id"


# ── PDPL ────────────────────────────────────────────────────────────────────────────────────────
def test_no_owner_name_or_phone_reaches_any_field():
    row, _ = _row(CARD_102, DETAIL_102)
    blob = json.dumps(row, ensure_ascii=False)
    assert "علي محمد علي الزنان" not in blob and "0533253031" not in blob
    assert "whatsapp" not in blob and "مسؤول الإعلان" not in blob


def test_the_prose_phone_is_redacted_and_the_ad_licence_is_never_the_fal_licence():
    row, _ = _row(CARD_100, DETAIL_100)
    assert "966542593555" not in row["description"] and "[redacted]" in row["description"]
    assert row["license_number"] == "7100307921", "the AD licence from «رقم ترخيص الإعلان»"
    assert "1100260351" != row["license_number"], "the FAL broker licence in the prose is never read"


# ── ADVANCED-FILTER FACTS IN REAL COLUMNS ───────────────────────────────────────────────────────
def test_named_utilities_are_true_and_unnamed_ones_are_absent():
    row102, _ = _row(CARD_102, DETAIL_102)
    assert all(row102[k] is True for k in ("electricity", "water_supply", "sanitation", "optical_fibers"))
    row21, _ = _row(CARD_21, DETAIL_21)          # «صرف صحي, كهرباء, مياه» — no fibre named
    assert (row21["electricity"], row21["water_supply"], row21["sanitation"]) == (True, True, True)
    assert "optical_fibers" not in row21, "silence is no key, never False"
    assert R._services(None) == {} and R._services("هاتف") == {}


def test_the_labelled_facts_reach_their_columns_and_a_multi_street_facade_is_null():
    row102, _ = _row(CARD_102, DETAIL_102)
    assert (row102["street_width_m"], row102["direction"], row102["property_age"]) == (20, "شمال غرب", 0)
    row21, _ = _row(CARD_21, DETAIL_21)          # «شرقية - جنوبية»: two facades → no single direction
    assert row21["direction"] is None and row21["street_width_m"] == 16
    row99, _ = _row(CARD_99, DETAIL_99)          # «اربع سنوات»: a word numeral is a real number
    assert row99["property_age"] == 4


def test_the_sources_room_count_is_total_rooms_and_is_not_published_as_bedrooms():
    """Villa 99 publishes «عدد الغرف» 10 while its prose lists four bedrooms + a two-room annex."""
    row, _ = _row(CARD_99, DETAIL_99)
    assert row.get("bedrooms") is None
    assert row["additional_info"]["source_rooms"] == "10"


def test_prose_amenities_are_tri_state():
    row, _ = _row(CARD_102, DETAIL_102)          # «غرفة سائق … غرفة خادمه … تكييف مخفي»
    assert row["driver_room"] is True and row["maid_room"] is True and row["air_conditioner"] is True
    assert "elevator" not in row and "furnished" not in row


def test_area_keeps_the_exact_figure_beside_the_integer_column():
    row, _ = _row(CARD_95, DETAIL_95)
    assert row["area_m2"] == 1306 and row["additional_info"]["area_raw"] == "1306.98"
    assert row["price_per_meter"] == 1300 and row["price_total"] == 1699074


# ── IDENTITY, URL, PHOTOS, TRANSPORT ────────────────────────────────────────────────────────────
def test_ad_number_url_photos_and_location():
    row, _ = _row(CARD_21, DETAIL_21)
    assert row["ad_number"] == "VLS21" and row["source"] == "فلل"
    assert row["listing_url"] == "https://villas-sa.com/real/estate/ads/21"
    assert row["photo_urls"][0].startswith("https://villas-sa.com/api/watermarked-image?path=")
    assert (row["city_ar"], row["city_id"], row["region_id"]) == ("الخبر", 31, 5)
    assert row["district_ar"] == "حي العقيق" and row["neighborhood"] == "العقيق"
    assert row["additional_info"]["title_composed"] is True


def test_a_record_without_the_sources_url_field_gets_the_share_route_not_a_none_url():
    d = json.loads(json.dumps(DETAIL_21)); d["main"]["url"] = None
    row, _ = _row(CARD_21, d)
    assert row["listing_url"] == "https://villas-sa.com/property/21"


def test_session_asks_for_arabic_json_and_never_sets_its_own_user_agent():
    s = R.session()
    assert s.headers["Accept-Language"].startswith("ar") and s.headers["Accept"] == "application/json"
    assert "user-agent" not in {k.lower() for k in s.headers}


# ── REMOVAL ORACLE ──────────────────────────────────────────────────────────────────────────────
def test_the_signal_reads_status_1_as_live_status_0_as_gone_and_a_500_as_no_opinion():
    sig = R._signal_for(21)
    live = json.dumps({"data": {"main": {"id": 21, "status": "1"}}})
    gone = json.dumps({"data": {"main": {"id": 21, "status": "0"}}})
    assert sig(200, live, False) == "live"
    assert sig(200, gone, False) == "gone"
    assert sig(500, '{"message": "Undefined array key \\"id\\""}', False) is None
    assert sig(200, json.dumps({"data": {"main": {"id": 22, "status": "0"}}}), False) is None, \
        "someone else's record is no evidence about this one"
    assert sig(200, "<html>", False) is None


# ── main(): the skip tally reaches the run ledger ───────────────────────────────────────────────
def test_the_skip_tally_reaches_end_run_and_prune_runs_only_after_the_full_walk(monkeypatch):
    calls, batches, pruned = {}, [], []
    delisted = json.loads(json.dumps(DETAIL_21)); delisted["main"]["status"] = "0"; delisted["main"]["id"] = 11
    details = {21: DETAIL_21, 93: DETAIL_93, 11: delisted, 100: DETAIL_100}
    cards = [CARD_21, CARD_93, dict(CARD_21, id=11), CARD_100]
    monkeypatch.setattr(sys, "argv", ["run.py"])
    monkeypatch.setattr(R, "session", lambda: None)
    monkeypatch.setattr(R.time, "sleep", lambda *_: None)
    monkeypatch.setattr(R, "fetch_list", lambda s: cards)
    monkeypatch.setattr(R, "fetch_detail", lambda s, i: (200, json.loads(json.dumps(details[i]))))
    monkeypatch.setattr(R.db, "begin_run", lambda src: 1)
    monkeypatch.setattr(R.db, "_wasalt_batch", lambda t, rows: batches.append((t, len(rows))))
    monkeypatch.setattr(R.db, "retire_superseded_siblings", lambda **k: 0)
    monkeypatch.setattr(R.db, "prune_unseen", lambda t, seen, **k: pruned.append((t, set(seen), "verify_gone" in k)) or 0)
    monkeypatch.setattr(R.db, "end_run", lambda run_id, **k: calls.update(k) or True)

    assert R.main() == 0
    assert calls["ok"] is True and calls["rows_seen"] == 4 and calls["rows_upserted"] == 2
    assert "usage_mixed_landx1" in calls["notes"] and "status_0x1" in calls["notes"]
    assert calls["check_tables"] == ["villassa_residential_listings", "villassa_commercial_listings"]
    assert batches == [("villassa_residential_listings", 1), ("villassa_commercial_listings", 1)]
    assert pruned == [("villassa_residential_listings", {"VLS21"}, True),
                      ("villassa_commercial_listings", {"VLS100"}, True)]


def test_a_limited_run_never_writes_or_prunes(monkeypatch):
    touched = []
    monkeypatch.setattr(sys, "argv", ["run.py", "--limit", "1"])
    monkeypatch.setattr(R, "session", lambda: None)
    monkeypatch.setattr(R.time, "sleep", lambda *_: None)
    monkeypatch.setattr(R, "fetch_list", lambda s: [CARD_21, CARD_102])
    monkeypatch.setattr(R, "fetch_detail", lambda s, i: (200, json.loads(json.dumps({21: DETAIL_21, 102: DETAIL_102}[i]))))
    for name in ("begin_run", "_wasalt_batch", "retire_superseded_siblings", "prune_unseen", "end_run"):
        monkeypatch.setattr(R.db, name, lambda *a, _n=name, **k: touched.append(_n))
    assert R.main() == 0 and touched == []
