"""ebriza's P0s: a RANDOM-ORDER catalogue, land priced per metre beside its own total, a rent
period that lives only in prose (and lies there), and a detail route that is POST-only.

Every fixture below is a VERBATIM record from GET /RestApi/MainApi.php?action=get_properties on
2026-09-24, trimmed to the keys run.py reads (the agent's identity fields are kept ONLY to prove
they never reach a row). Every assertion runs the SHIPPING functions — `run.map_listing`,
`run.rent_period_stated`, `run.amenities`, `run.fetch_listings`, `run._signal_for`,
`run._verify_gone`, `run.main` — never a re-implementation. Offline: no network.

Traps met live, each locked here:
  · id 765 says «قريبة من الخدمات اليومية» — a DAILY token about the neighbourhood, which the
    shared token scan would turn into (None, None) and LOSE the 45,000 figure;
  · id 576 states «27,000 ريال سنوي» AND «إيجار شهري … 3,000 ريال» — the token beside OUR figure wins;
  · id 693 is land: `price` 445 is the RATE, `landTotalPrice` 200250 the total the site prints;
  · id 451 prints 490 ﷼ for a flat — stored as printed, never gated;
  · id 551 spells its type «شقَّة صغيرة (استوديو)» with diacritics in an order no key matches;
  · id 409 sits in «صبيا - المحله», which the catalog cannot place — a SKIP, never a default;
  · id 770 declares «لايوجد خدمات» — an explicit no for three utilities;
  · id 769's district is the placeholder «غير محدد»; 763 lists four facades;
  · the API pages a SHUFFLED catalogue unless `filters[sort]=latest` is sent.
"""
from __future__ import annotations

import json
import sys
import types
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

from scrapers.common import db as _db  # noqa: E402
from scrapers.ebriza import run as R  # noqa: E402

_CITIES = {"الرياض": (3, 1), "جدة": (18, 2), "صامطة": (3542, 10), "الخرج": (1061, 1), "اللخبصية": (17993, 10)}
_DISTRICTS = {"العارض": "حي العارض", "البوادي": "حي البوادي", "النزهة": "حي النزهة", "الوداد": None,
              "الإسكان": "حي الإسكان", "النهضة": "حي النهضة"}


@pytest.fixture(autouse=True)
def _no_catalog_network(monkeypatch):
    """to_catalog()/find_district_in_text() are the only calls that would touch Supabase; stubbed
    for EVERY test so a regression that reaches the catalog fails on an assertion, offline."""
    monkeypatch.setattr(R, "to_catalog", lambda c, region_hint=None: _CITIES.get(c, (None, None)))
    monkeypatch.setattr(R, "find_district_in_text", lambda t, cid: _DISTRICTS.get(t) if t else None)


# ── ebriza fixtures (verbatim API records, trimmed to the keys run.py reads; captured 2026-09-24) ──

EBZ_690 = {
    "id": 690,
    "status": "1",
    "final_status": "1",
    "title": "شقه للايجار",
    "description": "<div class=\"ql-editor\" data-gramm=\"false\" contenteditable=\"true\" data-placeholder=\"اكتب وصف العقار...\"><p>شقة فاخرة | حي العارض&nbsp;</p><p>شقة أرضية فاخرة مؤثثة بالكامل</p><p>فرصة مميزة للسكن في شقة أرضية عصرية تجمع بين الراحة والفخامة، جاهزة للسكن بالكامل.</p><p>الموقع :&nbsp;</p><p>https://maps.app.goo.gl/7TWzrxmQ4PL9QktP8?g_st=ic</p><p><br></p><p>مواصفات الشقة:</p><p>* 3 غرف نوم، منها غرفة ماستر مؤثثة بالكامل.</p><p>* صالة واسعة مفتوحة على مطبخ أمريكي.</p><p>* مطبخ راكب ومجهز بالكامل يشمل:</p><p>&nbsp;&nbsp;* ثلاجة</p><p>&nbsp;&nbsp;* فرن</p><p>&nbsp;&nbsp;* ميكروويف</p><p>&nbsp;&nbsp;* غلاية</p><p>&nbsp;&nbsp;* جميع الأدوات الأساسية.</p><p>* غرفة غسيل مجهزة بـ:</p><p>&nbsp;&nbsp;* غسالة</p><p>&nbsp;&nbsp;* كواية بخار.</p><p>* 3 دورات مياه.</p><p>* حوش خاص بطول ارتداد الشقة.</p><p>* موقف سيارة خارجي.</p><p><br></p><p>المرافق (مشمولة مع الإيجار السنوي):</p><p>* نادي رياضي نسائي.</p><p>* نادي رياضي رجالي.</p><p>* مسبح في كل نادٍ.</p><p>* أجهزة رياضية متكاملة.</p><p><br></p><p>السعر&nbsp;دون اثاث 80000 ﷼</p><p><br></p><p>السعر بالاثاث 90000 ﷼&nbsp;</p><p><br></p><p><br></p><p><br></p><p><br></p><p><br></p><p><br></p><p><br></p><p><br></p></div>",
    "advertisementType": "إيجار",
    "propertyType": "شقة",
    "features": "سكني,عائلات,مؤثث,مطبخ,مكيفات,توافر الماء,توافر الكهرباء,مدخلين,مصعد,ألياف ضوئية,هاتف",
    "propertyUtilities": "",
    "city_title": "الرياض",
    "region_title": "منطقة الرياض",
    "district_title": "العارض",
    "space": "106.06",
    "propertyFace": "",
    "street_width": "",
    "date_created": "اقل من سنة",
    "adLicenseNumber": "7201060194",
    "rooms": "3",
    "bathes": "3",
    "halls": "1",
    "floor_no": "1",
    "images": "Agent/assets/properties_images/2026-08-10/m1786323895_06d078a2-f5b0-4ace-a19b-07e133f54a51.jpeg,Agent/assets/properties_images/2026-08-10/m1786323895_e48d689e-efa2-49f2-a197-d4be0a3475be.jpeg,Agent/assets/properties_images/2026-08-10/m1786323895_e043848a-a2bb-4616-93c6-0556785f801c.jpeg,Agent/assets/properties_images/2026-08-10/m1786323895_5d914b78-c522-47b0-8655-cb8119e753fa.jpeg,Agent/assets/properties_images/2026-08-10/m1786323895_c2f071a3-8170-4543-9df9-e99942bd59b6.jpeg,Agent/assets/properties_images/2026-08-10/m1786323895_d5e0ae04-5fff-4455-9abe-1273c5d10293.jpeg,Agent/assets/properties_images/2026-08-10/m1786323895_4b9556c0-dc20-4d40-9422-6849ad540137.jpeg,Agent/assets/properties_images/2026-08-10/m1786323895_5d0ee88c-237e-4649-9fd2-bb8e59fccaaf.jpeg",
    "price": "80000",
    "landTotalPrice": "",
    "LandTotalAnnualRent": "",
    "Coordinates": "24.86557182917376,46.63433332412079",
    "phoneNumber": "0557776760",
    "advertiserName": "سلطان محمد عون ال موسى"
}

EBZ_765 = {
    "id": 765,
    "status": "1",
    "final_status": "1",
    "title": "🌟شقة جديدة للإيجار في حي البوادي، أول ساكن بتشطيبات حديثة",
    "description": "<div class=\"ql-editor\" data-gramm=\"false\" contenteditable=\"true\" data-placeholder=\"اكتب وصف العقار...\"><p>🌟شقة جديدة للإيجار في حي البوادي، أول ساكن بتشطيبات حديثة ومميزة، وموقع ممتاز قريب من الخدمات.</p><p>⬛◼🔻تفاصيل الشقة🔻◼⬛</p><p>🔹4 غرف</p><p>🔹صالة</p><p>🔹مطبخ</p><p>🔹دورتان مياه</p><p>🔹مكيفات سبليت جديدة راكب</p><p>🔹دولاب مطبخ راكب جديد</p><p>🔹موقف خاص</p><p>⬛◼🔻مميزات الموقع🔻◼⬛</p><p>📍 بجوار مسجد</p><p>📍 قريبة من المدارس</p><p>📍 قريبة من المجمعات التجارية</p><p>📍 قريبة من الخدمات اليومية</p><p>📍 قريبة من مطار الملك عبدالعزيز</p><p>✨ شقة جديدة ومناسبة للعائلة، جاهزة للسكن وأول ساكن🌟</p></div>",
    "advertisementType": "إيجار",
    "propertyType": "شقة",
    "features": "سكني,مطبخ,مكيفات,توافر الماء,توافر الكهرباء,مدخل سيارة,مصعد,مدخل خاص",
    "propertyUtilities": "",
    "city_title": "جدة",
    "region_title": "منطقة مكة المكرمة",
    "district_title": "البوادي",
    "space": "191.47",
    "propertyFace": "",
    "street_width": "",
    "date_created": "جديد",
    "adLicenseNumber": "7201083120",
    "rooms": "4",
    "bathes": "2",
    "halls": "1",
    "floor_no": "4",
    "images": "Agent/assets/properties_images/2026-09-19/m1789828547_IMG_3288.jpeg,Agent/assets/properties_images/2026-09-19/m1789828547_IMG_3289.jpeg,Agent/assets/properties_images/2026-09-19/m1789828547_IMG_3292.jpeg,Agent/assets/properties_images/2026-09-19/m1789828547_IMG_3291.jpeg,Agent/assets/properties_images/2026-09-19/m1789828547_IMG_3293.jpeg,Agent/assets/properties_images/2026-09-19/m1789828547_IMG_3294.jpeg,Agent/assets/properties_images/2026-09-19/m1789828547_IMG_3295.jpeg,Agent/assets/properties_images/2026-09-19/m1789828547_IMG_3296.jpeg,Agent/assets/properties_images/2026-09-19/m1789828547_IMG_3290.jpeg,Agent/assets/properties_images/2026-09-19/m1789828547_IMG_3287.jpeg,Agent/assets/properties_images/2026-09-19/m1789828547_IMG_3297.jpeg,Agent/assets/properties_images/2026-09-19/m1789828547_IMG_3300.jpeg,Agent/assets/properties_images/2026-09-19/m1789828547_IMG_3299.jpeg",
    "price": "45000",
    "landTotalPrice": "",
    "LandTotalAnnualRent": "",
    "Coordinates": "21.610219077906255,39.16512590259845",
    "phoneNumber": "0555317996",
    "advertiserName": "مؤسسة اوائل الانجاز للخدمات العقارية"
}

EBZ_576 = {
    "id": 576,
    "status": "1",
    "final_status": "1",
    "title": "بيت النزهة",
    "description": "<div class=\"ql-editor\" contenteditable=\"true\" data-placeholder=\"اكتب وصف العقار...\"><p><span style=\"color: rgb(68, 68, 68); background-color: rgb(255, 255, 255);\">🏠 شقة مفروشة للإيجار – حي النزهة (قريبة من المطار) </span></p><p><span style=\"color: rgb(68, 68, 68); background-color: rgb(255, 255, 255);\">📍 الموقع: جدة – حي النزهة (موقع مميز وقريب من طريق المدينة – المطار – مجمع العرب) </span></p><p><span style=\"color: rgb(68, 68, 68); background-color: rgb(255, 255, 255);\">✨ تفاصيل الشقة: غرفة نوم صالة مريحة مطبخ صغير مجهز دورة مياه مفروشة بالكامل (جاهزة للسكن) مكيفات راكبة غسالة تشطيب نظيف وإضاءة مريحة </span></p><p><span style=\"color: rgb(68, 68, 68); background-color: rgb(255, 255, 255);\">🎯 مناسبة لـ: </span></p><p><span style=\"color: rgb(68, 68, 68); background-color: rgb(255, 255, 255);\">موظفين وموظفات</span></p><p><span style=\"color: rgb(68, 68, 68); background-color: rgb(255, 255, 255);\"> طيارين وموظفي المطار ✈️ </span></p><p><span style=\"color: rgb(68, 68, 68); background-color: rgb(255, 255, 255);\">سكن هادئ وجاهز </span></p><p><span style=\"color: rgb(68, 68, 68); background-color: rgb(255, 255, 255);\">💰 الأسعار: </span></p><p><span style=\"color: rgb(68, 68, 68); background-color: rgb(255, 255, 255);\">🔹 السعر المعروض : 27,000 ريال سنوي (غير شامل الماء والكهرباء) </span></p><p><span style=\"color: rgb(68, 68, 68); background-color: rgb(255, 255, 255);\">🔸 خيارات إضافية: سنوي شامل الماء والكهرباء: 32,000 ريال </span></p><p><span style=\"color: rgb(68, 68, 68); background-color: rgb(255, 255, 255);\">إيجار شهري شامل الماء والكهرباء : 3,000 ريال </span></p><p><span style=\"color: rgb(68, 68, 68); background-color: rgb(255, 255, 255);\">📌 ملاحظة:</span></p><p><span style=\"color: rgb(68, 68, 68); background-color: rgb(255, 255, 255);\"> الإيجار الشامل يتضمن الماء والكهرباء ضمن حد استهلاك شهري معقول (300 ريال للكهرباء)، وما زاد عن ذلك يتم احتسابه حسب الاستهلاك الفعلي.</span></p><p><span style=\"color: rgb(68, 68, 68); background-color: rgb(255, 255, 255);\"> ⭐ مميزات الموقع:</span></p><p><span style=\"color: rgb(68, 68, 68); background-color: rgb(255, 255, 255);\"> قريب من المطار ✈️</span></p><p><span style=\"color: rgb(68, 68, 68); background-color: rgb(255, 255, 255);\"> قريب من الخدمات والمطاعم</span></p><p><span style=\"color: rgb(68, 68, 68); background-color: rgb(255, 255, 255);\"> حي هادئ ومناسب للسكن </span></p><p><span style=\"color: rgb(68, 68, 68); background-color: rgb(255, 255, 255);\">سهولة الوصول للطرق الرئيسية</span></p><p><br></p><p><br></p><p><br></p></div><div class=\"ql-tooltip ql-hidden\"><a class=\"ql-preview\" rel=\"noopener noreferrer\" target=\"_blank\" href=\"about:blank\"></a><input type=\"text\" data-formula=\"e=mc^2\" data-link=\"https://quilljs.com\" data-video=\"Embed URL\"><a class=\"ql-action\"></a><a class=\"ql-remove\"></a></div>",
    "advertisementType": "إيجار",
    "propertyType": "شقة",
    "features": "سكني,مؤثث,مطبخ,مكيفات,توافر الكهرباء",
    "propertyUtilities": "كهرباء,مياه,صرف صحي,هاتف,ألياف ضوئية",
    "city_title": "جدة",
    "region_title": "منطقة مكة المكرمة",
    "district_title": "النزهة",
    "space": "480",
    "propertyFace": "",
    "street_width": "0",
    "date_created": "اكثر من عشر سنوات",
    "adLicenseNumber": "7100268813",
    "rooms": "2",
    "bathes": "1",
    "halls": "",
    "floor_no": "2",
    "images": "Agent/assets/properties_images/2026-04-24/m17770392881.jpeg,Agent/assets/properties_images/2026-04-24/m17770392883.jpeg,Agent/assets/properties_images/2026-04-24/m17770392882.jpeg,Agent/assets/properties_images/2026-04-24/m17770392894.jpeg,Agent/assets/properties_images/2026-04-24/m17770392895.jpeg,Agent/assets/properties_images/2026-04-24/m17770392896.jpeg,Agent/assets/properties_images/2026-04-24/m17770392897.jpeg,Agent/assets/properties_images/2026-04-24/m17770392898.jpeg",
    "price": "27000",
    "landTotalPrice": "",
    "LandTotalAnnualRent": "",
    "Coordinates": "21.62034206092347,39.16066181460365",
    "phoneNumber": "0559919115",
    "advertiserName": "معاذ يحيى يوسف الاقصم"
}

EBZ_693 = {
    "id": 693,
    "status": "1",
    "final_status": "1",
    "title": "ارض ",
    "description": "<div class=\"ql-editor\" contenteditable=\"true\" data-placeholder=\"اكتب وصف العقار...\"><p>♦️ *للبيع أرض سكنية* ♦️</p><p><br></p><p>الموقع 📍</p><p>جدة  - طيبة الفرعية - الوداد  </p><p><br></p><p>♻️المساحة / 450 م  </p><p>♻️رقم الارض / 424/1</p><p>♻️رقم المخطط / 597/ج/س</p><p>✳️ الاضلاع متساوية 18*25 م </p><p><br></p><p>🛤️ شارع  -16 م غربي </p><p>🔸نطاق برتقالي 🔸</p><p> </p><p><br></p><p>♦️سعر البيع / 200,000 ريال  ♦️</p><p><br></p><p><br></p><p>موقع الارض 📍</p><p><br></p><p>https://maps.app.goo.gl/NZ8jTYSHQhX3Hd2h7?g_st=ic</p><p><br></p><p> </p><p>🔷للاستفسار والتواصل 🔷</p><p><br></p><p>*الوسيط العقاري* </p><p>*ضيف الله غرسان الزهراني* </p><p>0551228113</p><p><br></p><p> *نعتز بثقتكم*</p></div><div class=\"ql-tooltip ql-hidden\"><a class=\"ql-preview\" rel=\"noopener noreferrer\" target=\"_blank\" href=\"about:blank\"></a><input type=\"text\" data-formula=\"e=mc^2\" data-link=\"https://quilljs.com\" data-video=\"Embed URL\" __gcruniqueid=\"16\"><a class=\"ql-action\"></a><a class=\"ql-remove\"></a></div>",
    "advertisementType": "بيع",
    "propertyType": "ارض",
    "features": "",
    "propertyUtilities": "لايوجد خدمات",
    "city_title": "جدة",
    "region_title": "منطقة مكة المكرمة",
    "district_title": "الوداد",
    "space": "450",
    "propertyFace": "غربية",
    "street_width": "16",
    "date_created": "",
    "adLicenseNumber": "7100313618",
    "rooms": "اختر",
    "bathes": "اختر",
    "halls": "اختر",
    "floor_no": "اختر",
    "images": "Agent/assets/properties_images/2026-08-24/m1787558587IMG_0770.jpeg,Agent/assets/properties_images/2026-08-24/m1787558587IMG_0777.jpeg,Agent/assets/properties_images/2026-08-24/m178755858707FAA627-CEAE-478D-8851-6D4D17CD314A.png,",
    "price": "445",
    "landTotalPrice": "200250",
    "LandTotalAnnualRent": "",
    "Coordinates": "21.947784216618476,39.2083507073514",
    "phoneNumber": "0551228113",
    "advertiserName": "ضيف الله بن غرسان بن عطيه الزهراني"
}

EBZ_451 = {
    "id": 451,
    "status": "1",
    "final_status": "1",
    "title": "شقه ٦ غرف ",
    "description": "<div class=\"ql-editor ql-blank\" contenteditable=\"true\" data-placeholder=\"اكتب وصف العقار...\"><p><br></p></div><div class=\"ql-tooltip ql-hidden\"><a class=\"ql-preview\" rel=\"noopener noreferrer\" target=\"_blank\" href=\"about:blank\"></a><input type=\"text\" data-formula=\"e=mc^2\" data-link=\"https://quilljs.com\" data-video=\"Embed URL\" __gchrome_uniqueid=\"40\"><a class=\"ql-action\"></a><a class=\"ql-remove\"></a></div>",
    "advertisementType": "بيع",
    "propertyType": "شقة",
    "features": "عائلات,مطبخ,ملحق,توافر الماء,توافر الكهرباء,سطح خاص,في فيلا,مدخلين,مدخل سيارة,مصعد,مدخل خاص,صرف صحي,هاتف",
    "propertyUtilities": "كهرباء,مياه,هاتف,ألياف ضوئية,تصريف الفيضانات ,صرف صحي",
    "city_title": "صامطة",
    "region_title": "منطقة جازان",
    "district_title": "الإسكان",
    "space": "185.87",
    "propertyFace": "شمالية - شمالية غربية",
    "street_width": "0",
    "date_created": "جديد",
    "adLicenseNumber": "7100250364",
    "rooms": "6",
    "bathes": "2",
    "halls": "1",
    "floor_no": "1",
    "images": "Agent/assets/properties_images/2026-01-15/m1768498516IMG_0394.JPG,Agent/assets/properties_images/2026-01-15/m1768498516IMG_0412.JPG,Agent/assets/properties_images/2026-01-15/m1768498516IMG_0393.JPG,Agent/assets/properties_images/2026-01-15/m1768498516IMG_0392.JPG,Agent/assets/properties_images/2026-01-15/m1768498516IMG_0395.JPG,Agent/assets/properties_images/2026-01-15/m1768498517IMG_0415.JPG,Agent/assets/properties_images/2026-01-15/m1768498517IMG_0413.JPG,Agent/assets/properties_images/2026-01-15/m1768498518IMG_0396.JPG,Agent/assets/properties_images/2026-01-15/m1768498520IMG_0416.JPG,Agent/assets/properties_images/2026-01-15/m1768498520IMG_0397.JPG,Agent/assets/properties_images/2026-01-15/m1768498521IMG_0417.JPG,Agent/assets/properties_images/2026-01-15/m1768498521IMG_0402.JPG,Agent/assets/properties_images/2026-01-15/m1768498522IMG_0404.JPG,Agent/assets/properties_images/2026-01-15/m1768498523IMG_0383.JPG,Agent/assets/properties_images/2026-01-15/m1768498523IMG_0399.JPG,Agent/assets/properties_images/2026-01-15/m1768498524IMG_0406.JPG,Agent/assets/properties_images/2026-01-15/m1768498524IMG_0401.JPG,Agent/assets/properties_images/2026-01-15/m1768498525IMG_0385.JPG,Agent/assets/properties_images/2026-01-15/m1768498525IMG_0388.JPG,Agent/assets/properties_images/2026-01-15/m1768498525IMG_0408.JPG,",
    "price": "490",
    "landTotalPrice": "",
    "LandTotalAnnualRent": "",
    "Coordinates": "16.625298741726805,42.90629297690919",
    "phoneNumber": "0561900098",
    "advertiserName": "علي ابن سليمان ابن حسن آل محمد"
}

EBZ_551 = {
    "id": 551,
    "status": "1",
    "final_status": "1",
    "title": "شقة صغيرة جاهزة للسكن",
    "description": "<div class=\"ql-editor\" contenteditable=\"true\" data-placeholder=\"اكتب وصف العقار...\"><p>شقة مؤثثة للاجار السنوي حي البوادي </p><p>التواصل واتس لعدم دخولي الموقع </p><p>0545438549</p></div><div class=\"ql-tooltip ql-hidden\"><a class=\"ql-preview\" rel=\"noopener noreferrer\" target=\"_blank\" href=\"about:blank\"></a><input type=\"text\" data-formula=\"e=mc^2\" data-link=\"https://quilljs.com\" data-video=\"Embed URL\" __gchrome_uniqueid=\"40\"><a class=\"ql-action\"></a><a class=\"ql-remove\"></a></div>",
    "advertisementType": "إيجار",
    "propertyType": "شقَّة صغيرة (استوديو)",
    "features": "سكني,عائلات,عزاب,مؤثث,مطبخ,مكيفات,توافر الماء,توافر الكهرباء,مدخلين,مصعد,ألياف ضوئية,صرف صحي,هاتف",
    "propertyUtilities": "كهرباء,مياه,صرف صحي,هاتف,ألياف ضوئية,تصريف الفيضانات ",
    "city_title": "جدة",
    "region_title": "منطقة مكة المكرمة",
    "district_title": "البوادي",
    "space": "153",
    "propertyFace": "شمالية شرقية",
    "street_width": "0",
    "date_created": "جديد",
    "adLicenseNumber": "7100271104",
    "rooms": "2",
    "bathes": "1",
    "halls": "1",
    "floor_no": "1",
    "images": "Agent/assets/properties_images/2026-04-05/m1775400260b644629d-6b24-46dd-897c-1eaadedb7cc2.jpeg,Agent/assets/properties_images/2026-04-05/m17754002603cb4d8d8-31cb-4e31-9733-8e510d7acb57.jpeg,Agent/assets/properties_images/2026-04-05/m1775400260838f60ce-6a19-4c60-8777-f106be08242c.jpeg,Agent/assets/properties_images/2026-04-05/m177540026140101dc3-af45-4575-a052-46f67b1569da.jpeg,Agent/assets/properties_images/2026-04-05/m177540026173c5539f-307e-4b94-8c50-a0c4bbde1ad6.jpeg,Agent/assets/properties_images/2026-04-05/m1775400261358b32f2-2753-4574-989c-0ab7d725a953.jpeg,Agent/assets/properties_images/2026-04-05/m1775400261b6287f6b-cddf-4b7e-8cdb-6754abd4ad10.jpeg,Agent/assets/properties_images/2026-04-05/m17754002619287ef2c-d31d-45f2-b109-25132d9dac86.jpeg,Agent/assets/properties_images/2026-04-05/m17754002611ef2d39e-d134-41d9-9c7e-35d3235b34b7.jpeg,Agent/assets/properties_images/2026-04-05/m1775400261f742dc25-0c5b-4266-a2d4-891f49648f01.jpeg,",
    "price": "42000",
    "landTotalPrice": "",
    "LandTotalAnnualRent": "",
    "Coordinates": "21.595307823268815,39.17263544686761",
    "phoneNumber": "0545438549",
    "advertiserName": "توفيق بخيت حامد الجهنى"
}

EBZ_409 = {
    "id": 409,
    "status": "1",
    "final_status": "1",
    "title": "ارض سكني",
    "description": "<div class=\"ql-editor\" contenteditable=\"true\" data-placeholder=\"اكتب وصف العقار...\"><p>مدينة صبيا حي المحلة الجديدة عرض الشارع 15 م مساحة الارض 704 م رقم القطعة 78 حدودها و اطوالها شمالا قطعة رقم 76 بطول 32 متر جنوبا قطعة رقم 80 بطول 32 م شرقا قطعة رقم 77 بطول 22 م غربا</p></div><div class=\"ql-tooltip ql-hidden\"><a class=\"ql-preview\" rel=\"noopener noreferrer\" target=\"_blank\" href=\"about:blank\"></a><input type=\"text\" data-formula=\"e=mc^2\" data-link=\"https://quilljs.com\" data-video=\"Embed URL\"><a class=\"ql-action\"></a><a class=\"ql-remove\"></a></div>",
    "advertisementType": "بيع",
    "propertyType": "ارض",
    "features": "سكني",
    "propertyUtilities": "صرف صحي,كهرباء,مياه",
    "city_title": "صبيا - المحله",
    "region_title": "منطقة جازان",
    "district_title": "المحله",
    "space": "704",
    "propertyFace": "غربية",
    "street_width": "15",
    "date_created": "",
    "adLicenseNumber": "7200816082",
    "rooms": "اختر",
    "bathes": "اختر",
    "halls": "اختر",
    "floor_no": "اختر",
    "images": "Agent/assets/properties_images/2025-12-29/m1767018039WhatsApp Image 2025-12-29 at 2.37.41 PM.jpeg,Agent/assets/properties_images/2025-12-29/m1767018039WhatsApp Image 2025-12-29 at 2.38.36 PM.jpeg,Agent/assets/properties_images/2025-12-29/m1767018039WhatsApp Image 2025-12-29 at 2.29.14 PM.jpeg,Agent/assets/properties_images/2025-12-29/m1767018039WhatsApp Image 2025-12-29 at 2.29.14 PM (1).jpeg,Agent/assets/properties_images/2025-12-29/m1767018039WhatsApp Image 2025-12-29 at 2.37.40 PM.jpeg,",
    "price": "341",
    "landTotalPrice": "240064",
    "LandTotalAnnualRent": "",
    "Coordinates": "17.31609043872962,42.60682091386456",
    "phoneNumber": "558457575",
    "advertiserName": "عبدالعزيز محمد بن غرم الله الغامدي"
}

EBZ_NOUTIL = {
    "id": 770,
    "status": "1",
    "final_status": "1",
    "title": "أرض",
    "description": "<div class=\"ql-editor\" contenteditable=\"true\" data-placeholder=\"اكتب وصف العقار...\"><p><br></p><p>✅ أرض للبيع بجدة - منطقة تقاطع طريق المدينة المنورة مع شارع حراء</p><p><br></p><p>✅ ملاصقة لفندق في منطقة حيوية.</p><p><br></p><p>✅الأرض سكنية على شارعين</p><p>(غربي - جنوبي)</p><p><br></p><p><span style=\"color: rgb(31, 42, 55); background-color: rgb(255, 255, 255);\">إجمالي سعر البيع</span></p><p><strong style=\"color: rgb(16, 23, 40); background-color: rgb(255, 255, 255);\">3,024,000</strong></p><p><br></p><p>قابل للتفاوض</p><p><br></p><p><br></p></div><div class=\"ql-tooltip ql-hidden\"><a class=\"ql-preview\" rel=\"noopener noreferrer\" target=\"_blank\" href=\"about:blank\"></a><input type=\"text\" data-formula=\"e=mc^2\" data-link=\"https://quilljs.com\" data-video=\"Embed URL\"><a class=\"ql-action\"></a><a class=\"ql-remove\"></a></div>",
    "advertisementType": "بيع",
    "propertyType": "ارض",
    "features": "",
    "propertyUtilities": "لايوجد خدمات",
    "city_title": "جدة",
    "region_title": "منطقة مكة المكرمة",
    "district_title": "البوادي",
    "space": "504",
    "propertyFace": "جنوبية غربية",
    "street_width": "12",
    "date_created": "",
    "adLicenseNumber": "7201147106",
    "rooms": "اختر",
    "bathes": "اختر",
    "halls": "اختر",
    "floor_no": "اختر",
    "images": "Agent/assets/properties_images/2026-09-23/m1790187972موقع الأرض.jpeg,Agent/assets/properties_images/2026-09-23/m1790187993صوره دوية لموقع الأرض.jpeg,Agent/assets/properties_images/2026-09-23/m1790188005صوره لموقع الأرض.jpeg,",
    "price": "6000",
    "landTotalPrice": "3024000",
    "LandTotalAnnualRent": "",
    "Coordinates": "21.61324316892239,39.157766070061335",
    "phoneNumber": "0551211185",
    "advertiserName": "مؤسسة الأثير المتكامل التجارية"
}

EBZ_GHAIR = {
    "id": 769,
    "status": "1",
    "final_status": "1",
    "title": "للبيع ارض مخصصة لمحطة محروقات",
    "description": "<div class=\"ql-editor\" data-gramm=\"false\" contenteditable=\"true\" data-placeholder=\"اكتب وصف العقار...\"><p class=\"\">ارض -&nbsp;للبيع (( أرض )) محطة محروقات</p><p class=\"\">&nbsp;- على خط دولي مباشر - السهباء - الخرج ⛽</p><p class=\"\">*بصك محطة&nbsp;</p><p class=\"\">المساحة&nbsp;32,551 م²</p><p class=\"\"><br></p><p class=\"\">📍 *موقع المحطة على الخريطة (خط دولي):*</p><p class=\"\">https://goo.gl/maps/K52FS99hytTRYHvW8</p><p class=\"\"><br></p><p class=\"\">&nbsp;موقعها خط دولي مميز</p><p class=\"\"><br></p><p class=\"\">✅ 1- على طريق دولي عرض 60 متر - واجهة 325.45 متر</p><p class=\"\">&nbsp;&nbsp;(طريق الرياض - الخرج - حرض - منفذ البطحاء الدولي للإمارات)</p><p class=\"\"><br></p><p class=\"\">✅ 2- خط شاحنات دولي 24 ساعة</p><p class=\"\">&nbsp;&nbsp;يربط الرياض بالخرج وحرض والربع الخالي ومنفذ البطحاء - آلاف الشاحنات والمسافرين يومياً للإمارات</p><p class=\"\"><br></p><p class=\"\">✅ 3- مساحة عملاقة 32,551 متر تسمح بمحطة فئة (أ)</p><p class=\"\">&nbsp;&nbsp;8 مضخات بنزين + 2 مضخة ديزل شاحنات + خدمات متكاملة</p><p class=\"\"><br></p><p class=\"\">✅ 4- عمق ممتاز ومدخل ومخرج سهل</p><p class=\"\">&nbsp;&nbsp;</p><p class=\"\"><br></p><p class=\"\">✅ 5- منطقة استراتيجية</p><p class=\"\">&nbsp;&nbsp;</p><p class=\"\">&nbsp;&nbsp;- وسط مزارع ومصانع المراعي والصافي ونادك - حركة ديزل عالية جداً</p><p class=\"\">&nbsp;&nbsp;- لا يوجد محطات منافسة كثيرة على نفس الخط حسب نظام البلديات</p><p class=\"\"><br></p><p class=\"\">✅ 6- جاهزة للترخيص والتشغيل</p><p class=\"\">&nbsp;&nbsp;صك محطة جاهز + موقع مطابق لاشتراطات وزارة الشؤون البلدية للخطوط الدولية</p><p class=\"\"><br></p><p class=\"\">صك جاهز للإفراغ الفوري - يقبل البنوك والمستثمرين</p><p class=\"\">((الرقم يظهر عند الضغط على اتصال))</p></div>",
    "advertisementType": "بيع",
    "propertyType": "ارض",
    "features": "تجاري",
    "propertyUtilities": "",
    "city_title": "الخرج",
    "region_title": "منطقة الرياض",
    "district_title": "غير محدد",
    "space": "32551.12",
    "propertyFace": "شمالية شرقية",
    "street_width": "60",
    "date_created": "null",
    "adLicenseNumber": "7100319691",
    "rooms": "1",
    "bathes": "",
    "halls": "",
    "floor_no": "",
    "images": "Agent/assets/properties_images/2026-09-23/m1790185982_8B38F6CA-7BCE-44A3-831B-28EB01B7D9CE.png",
    "price": "122",
    "landTotalPrice": "3971236.64",
    "LandTotalAnnualRent": "",
    "Coordinates": "24.235803760472457,47.67775799787615",
    "phoneNumber": "0533404045",
    "advertiserName": "فهد علي خلوفه الحارثي"
}

EBZ_MULTIFACE = {
    "id": 763,
    "status": "1",
    "final_status": "1",
    "title": "مشروع بونساي حي النهضة، الرياض",
    "description": "<div class=\"ql-editor\" contenteditable=\"true\" data-placeholder=\"اكتب وصف العقار...\"><p><span style=\"color: rgb(34, 34, 34); background-color: rgb(255, 255, 255);\">اكتشف أسلوب حياة هادئ ومختلف في مشروع بونساي – حي النهضة، الرياض</span></p><p><span style=\"color: rgb(34, 34, 34); background-color: rgb(255, 255, 255);\">يقدم لك مشروع بونساي السكني تجربة سكنية استثنائية مستوحاة من الفلسفة اليابانية في السكون والبساطة، حيث يلتقي التصميم العميق مع الراحة والوظيفة في موقع استراتيجي يمنحك توازنًا مثاليًا بين الهدوء وسهولة الوصول. مشروع بونساي ليس مجرد سكن، بل أسلوب حياة متكامل صُمم بعناية ليمنحك راحة يومية وتجربة معيشية راقية.</span></p><p><span style=\"color: rgb(34, 34, 34); background-color: rgb(255, 255, 255);\">وحدات سكنية بتصاميم عصرية مستوحاة من العمارة اليابانية الحديثة مساحات تبداء من 78.93م2 واسعار تبداء من 500,000 ريال.</span></p><p><span style=\"color: rgb(34, 34, 34); background-color: rgb(255, 255, 255);\">استغلال ذكي للمساحات يحقق أقصى كفاءة لكل متر مربع.</span></p><p><span style=\"color: rgb(34, 34, 34); background-color: rgb(255, 255, 255);\">تشطيبات عالية الجودة باستخدام خامات طبيعية (خشب – حجر – نحاس).</span></p><p><span style=\"color: rgb(34, 34, 34); background-color: rgb(255, 255, 255);\">نوافذ واسعة تسمح بدخول الضوء الطبيعي وتمنح إحساسًا بالهدوء والاتساع.</span></p><p><span style=\"color: rgb(34, 34, 34); background-color: rgb(255, 255, 255);\">أنظمة منزل ذكي لراحة وتحكم أفضل.</span></p><p><span style=\"color: rgb(34, 34, 34); background-color: rgb(255, 255, 255);\">مواقف سيارات سفلية آمنة ومجهزة.</span></p><p><span style=\"color: rgb(34, 34, 34); background-color: rgb(255, 255, 255);\">أنظمة دخول إلكترونية وكاميرات مراقبة للمشروع بالكامل.</span></p><p><span style=\"color: rgb(34, 34, 34); background-color: rgb(255, 255, 255);\">مرافق وخدمات المشروع:</span></p><p><span style=\"color: rgb(34, 34, 34); background-color: rgb(255, 255, 255);\">نادي اجتماعي متكامل لخدمة السكان.</span></p><p><span style=\"color: rgb(34, 34, 34); background-color: rgb(255, 255, 255);\">حدائق يابانية ومساحات للتأمل والاسترخاء.</span></p><p><span style=\"color: rgb(34, 34, 34); background-color: rgb(255, 255, 255);\">غرفة شاي ياباني بتصميم مستوحى من الطقوس التقليدية.</span></p><p><span style=\"color: rgb(34, 34, 34); background-color: rgb(255, 255, 255);\">مكتبة هادئة للقراءة والعمل الذهني.</span></p><p><span style=\"color: rgb(34, 34, 34); background-color: rgb(255, 255, 255);\">مساحة عمل مشتركة (Co-working Space).</span></p><p><span style=\"color: rgb(34, 34, 34); background-color: rgb(255, 255, 255);\">صالة سينما داخلية.</span></p><p><span style=\"color: rgb(34, 34, 34); background-color: rgb(255, 255, 255);\">غرفة ألعاب وبلايستيشن.</span></p><p><span style=\"color: rgb(34, 34, 34); background-color: rgb(255, 255, 255);\">لاونج اجتماعي ومساحات ترفيهية.</span></p><p><span style=\"color: rgb(34, 34, 34); background-color: rgb(255, 255, 255);\">ميني ماركت لخدمة السكان.</span></p><p><span style=\"color: rgb(34, 34, 34); background-color: rgb(255, 255, 255);\">مغسلة إلكترونية وغرفة استلام شحنات.</span></p><p><span style=\"color: rgb(34, 34, 34); background-color: rgb(255, 255, 255);\">مميزات الموقع:</span></p><p><span style=\"color: rgb(34, 34, 34); background-color: rgb(255, 255, 255);\">يقع المشروع في حي النهضة – الرياض.</span></p><p><span style=\"color: rgb(34, 34, 34); background-color: rgb(255, 255, 255);\">بجوار محطة مترو خريص لسهولة التنقل داخل المدينة.</span></p><p><span style=\"color: rgb(34, 34, 34); background-color: rgb(255, 255, 255);\">قريب من الخدمات، الأسواق، المطاعم والمقاهي.</span></p><p><span style=\"color: rgb(34, 34, 34); background-color: rgb(255, 255, 255);\">موقع حيوي مع الحفاظ على الهدوء داخل المشروع.</span></p><p><br></p><p><span style=\"color: rgb(34, 34, 34); background-color: rgb(255, 255, 255);\">لماذا تختار مشروع بونساي؟</span></p><p><span style=\"color: rgb(34, 34, 34); background-color: rgb(255, 255, 255);\">مشروع سكني استثماري بعائد واعد.</span></p><p><span style=\"color: rgb(34, 34, 34); background-color: rgb(255, 255, 255);\">تصميم عالمي بإشراف المعماري الياباني كيجي إشيزاوا.</span></p><p><span style=\"color: rgb(34, 34, 34); background-color: rgb(255, 255, 255);\">جودة تنفيذ عالية ومعايير دقيقة في التفاصيل.</span></p><p><span style=\"color: rgb(34, 34, 34); background-color: rgb(255, 255, 255);\">بيئة سكنية هادئة بعيدة عن ضوضاء المدينة.</span></p><p><span style=\"color: rgb(34, 34, 34); background-color: rgb(255, 255, 255);\">مثالي للسكن والاستثمار طويل الأمد.</span></p><p><span style=\"color: rgb(34, 34, 34); background-color: rgb(255, 255, 255);\">بونساي… حيث يتحوّل السكن إلى تجربة من السكون والسكينة.</span></p><p><span style=\"color: rgb(34, 34, 34); background-color: rgb(255, 255, 255);\">سارع بحجز وحدتك الآن في مشروع بونساي – حي النهضة، الرياض.</span></p><p><span style=\"color: rgb(34, 34, 34); background-color: rgb(255, 255, 255);\">تواصل معنا الآن لمعرفة التفاصيل والأسعار وحجز وحدتك: 0502478918</span></p><p><br></p></div><div class=\"ql-tooltip ql-hidden\"><a class=\"ql-preview\" rel=\"noopener noreferrer\" target=\"_blank\" href=\"about:blank\"></a><input type=\"text\" data-formula=\"e=mc^2\" data-link=\"https://quilljs.com\" data-video=\"Embed URL\"><a class=\"ql-action\"></a><a class=\"ql-remove\"></a></div>",
    "advertisementType": "بيع",
    "propertyType": "شقة",
    "features": "",
    "propertyUtilities": "كهرباء,مياه,صرف صحي",
    "city_title": "الرياض",
    "region_title": "منطقة الرياض",
    "district_title": "النهضة",
    "space": "1225",
    "propertyFace": "شرقية - غربية - شمالية - جنوبية - ثلاثة شوارع",
    "street_width": "0",
    "date_created": "جديد",
    "adLicenseNumber": "7201138045",
    "rooms": "اختر",
    "bathes": "اختر",
    "halls": "اختر",
    "floor_no": "اختر",
    "images": "Agent/assets/properties_images/2026-09-17/m1789653262‏‏WhatsApp Image 2026-09-17 at 2.40.10 PM (1) - نسخة.jpeg,Agent/assets/properties_images/2026-09-17/m1789653262WhatsApp Image 2026-09-17 at 2.40.10 PM (1).jpeg,Agent/assets/properties_images/2026-09-17/m1789653263WhatsApp Image 2026-09-17 at 2.40.10 PM (3).jpeg,Agent/assets/properties_images/2026-09-17/m1789653263WhatsApp Image 2026-09-17 at 2.40.10 PM (2).jpeg,Agent/assets/properties_images/2026-09-17/m1789653263WhatsApp Image 2026-09-17 at 2.40.10 PM (4).jpeg,Agent/assets/properties_images/2026-09-17/m1789653263WhatsApp Image 2026-09-17 at 2.40.10 PM (5).jpeg,Agent/assets/properties_images/2026-09-17/m1789653263WhatsApp Image 2026-09-17 at 2.40.10 PM (6).jpeg,Agent/assets/properties_images/2026-09-17/m1789653263WhatsApp Image 2026-09-17 at 2.40.10 PM (7).jpeg,Agent/assets/properties_images/2026-09-17/m1789653263WhatsApp Image 2026-09-17 at 2.40.10 PM (9).jpeg,Agent/assets/properties_images/2026-09-17/m1789653263WhatsApp Image 2026-09-17 at 2.40.10 PM (8).jpeg,Agent/assets/properties_images/2026-09-17/m1789653263WhatsApp Image 2026-09-17 at 2.40.10 PM.jpeg,Agent/assets/properties_images/2026-09-17/m1789653263WhatsApp Image 2026-09-17 at 2.40.11 PM (1).jpeg,Agent/assets/properties_images/2026-09-17/m1789653263WhatsApp Image 2026-09-17 at 2.40.11 PM (2).jpeg,Agent/assets/properties_images/2026-09-17/m1789653263WhatsApp Image 2026-09-17 at 2.40.11 PM (3).jpeg,Agent/assets/properties_images/2026-09-17/m1789653264WhatsApp Image 2026-09-17 at 2.40.11 PM (4).jpeg,Agent/assets/properties_images/2026-09-17/m1789653264WhatsApp Image 2026-09-17 at 2.40.11 PM (5).jpeg,Agent/assets/properties_images/2026-09-17/m1789653264WhatsApp Image 2026-09-17 at 2.40.11 PM.jpeg,",
    "price": "490000",
    "landTotalPrice": "",
    "LandTotalAnnualRent": "",
    "Coordinates": "24.74519959694822,46.807541262301186",
    "phoneNumber": "0557420135",
    "advertiserName": "شركة عقار ماب السعودية المحدودة"
}

# ═══════════════════════════════ 1. rent period = the ad's own words ═════════════════════════════
def test_annual_bound_to_the_rent_word_690():
    row, cat, why = R.map_listing(EBZ_690)
    assert row and not why and cat == "residential"
    assert row["transaction_type"] == "Rent"
    assert (row["rent_period"], row["price_annual"]) == ("annual", 80000)
    assert "price_total" not in row
    assert row["additional_info"]["price_evidence"]["field"] == "price"
    assert row["additional_info"]["price_evidence"]["raw"] == "80000"


def test_a_daily_token_about_the_neighbourhood_is_not_a_period_765():
    row, _, why = R.map_listing(EBZ_765)
    assert row and not why
    assert (row["rent_period"], row["price_annual"]) == (None, 45000)      # figure kept, unconverted
    # the helper itself: the same prose through the shared scan would be (None, None)
    assert R.rent_period_stated(45000, "شقة قريبة من الخدمات اليومية") == (None, 45000)


def test_the_token_beside_our_figure_outranks_the_other_period_576():
    row, _, why = R.map_listing(EBZ_576)
    assert row and not why
    assert (row["rent_period"], row["price_annual"]) == ("annual", 27000)


def test_two_periods_bound_to_one_figure_is_null_and_daily_is_out_of_schema():
    # rule 2: BOTH yearly and monthly for one figure → NULL, figure unconverted (synthetic prose)
    assert R.rent_period_stated(5000, "الإيجار 5,000 ريال شهري أو 5,000 ريال سنوي") == (None, 5000)
    assert R.rent_period_stated(48000, "الايجار السنوي 48 الف على دفعتين") == ("annual", 48000)
    assert R.rent_period_stated(3000, "الإيجار الشهري 3,000 ريال") == ("monthly", 36000)
    assert R.rent_period_stated(500, "الإيجار اليومي 500 ريال") == (None, None)
    assert R.rent_period_stated(500, "") == (None, 500)


# ═══════════════════════════════ 2. price = source, never computed ═══════════════════════════════
def test_land_stores_the_printed_total_and_the_rate_separately_693():
    row, _, why = R.map_listing(EBZ_693)
    assert row and not why
    assert row["property_type"] == "Residential Land" and row["transaction_type"] == "Buy"
    assert row["price_total"] == 200250 and row["price_per_meter"] == 445 and row["area_m2"] == 450
    assert row["additional_info"]["price_evidence"]["field"] == "landTotalPrice"
    assert row["bedrooms"] is None and row["bathrooms"] is None      # land answers no room count
    # blank the site's total: the rate must NOT be multiplied into a total by us
    blank = dict(EBZ_693, landTotalPrice="")
    row2, _, _ = R.map_listing(blank)
    assert row2["price_total"] is None and row2["price_per_meter"] == 445


def test_a_490_riyal_flat_is_stored_as_printed_451():
    row, _, why = R.map_listing(EBZ_451)
    assert row and not why
    assert row["price_total"] == 490 and row["city_id"] == 3542
    assert row["direction"] is None                                   # «شمالية - شمالية غربية»
    assert row["additional_info"]["facade_raw"] == "شمالية - شمالية غربية"


# ═══════════════════════════════ 3. skips, never guesses ═════════════════════════════════════════
def test_studio_spelled_with_diacritics_maps_551():
    row, cat, why = R.map_listing(EBZ_551)
    assert row and not why and row["property_type"] == "Studio"


def test_unplaceable_city_is_a_skip_409():
    assert R.map_listing(EBZ_409) == (None, "residential", "city_not_in_catalog")


def test_status_and_deal_and_type_guards():
    assert R.map_listing(dict(EBZ_690, status="0"))[2] == "status_0_1"
    assert R.map_listing(dict(EBZ_690, advertisementType="غير"))[2] == "deal_unknown"
    assert R.map_listing(dict(EBZ_690, propertyType="كوكب"))[2] == "type_unmapped"
    assert R.map_listing(dict(EBZ_690, id=None))[2] == "no_id"
    assert R.map_listing(dict(EBZ_690, title="شقة مزاد"))[2] == "auction"
    assert R.map_listing(dict(EBZ_690, title="شقة تم البيع"))[2] == "sold_or_rented"
    assert R.map_listing(dict(EBZ_690, title="شقة على الخارطة"))[2] == "off_plan"
    # «مؤجرة» in a DESCRIPTION describes tenants, not a closed deal
    assert R.map_listing(dict(EBZ_690, description="<p>عمارة مؤجرة بالكامل</p>"))[2] == ""
    # «قريباً» inside «تقريباً» is a measurement word, not an off-plan marker
    assert R.map_listing(dict(EBZ_690, title="شقة 300 متر تقريباً"))[2] == ""


# ═══════════════════════════════ 4. advanced-filter facts in real columns ════════════════════════
def test_structured_facts_and_tri_state_amenities_690():
    row, _, _ = R.map_listing(EBZ_690)
    assert (row["bedrooms"], row["bathrooms"], row["halls"], row["floor_number"]) == (3, 3, 1, 1)
    assert row["area_m2"] == 106 and row["additional_info"]["area_raw"] == "106.06"
    assert row["property_age"] == 0                                    # «اقل من سنة»
    for col in ("furnished", "kitchen", "air_conditioner", "elevator", "water_supply", "electricity"):
        assert row[col] is True, col
    assert "parking" not in row or row["parking"] is not False       # silence is never a «no»
    assert row["license_number"] == "7201060194"                       # the AD licence, not the CR
    assert row["district_ar"] == "حي العارض" and row["neighborhood"] == "العارض"


def test_no_utilities_is_an_explicit_no_770_and_placeholders_are_null_769_763():
    row, _, _ = R.map_listing(EBZ_NOUTIL)
    assert (row["electricity"], row["water_supply"], row["sanitation"]) == (False, False, False)
    row, _, _ = R.map_listing(EBZ_GHAIR)
    assert row["neighborhood"] is None and row["district_ar"] is None   # «غير محدد»
    row, _, _ = R.map_listing(EBZ_MULTIFACE)
    assert row["direction"] is None and "facade_raw" in row["additional_info"]
    assert row["bedrooms"] is None                                       # «اختر» placeholder
    row, _, _ = R.map_listing(EBZ_576)
    assert row["property_age"] is None                                   # «اكثر من عشر سنوات»: open bound
    assert row["additional_info"]["age_raw"] == "اكثر من عشر سنوات"


def test_amenities_helper_negation_and_prepared_are_not_true():
    assert R.amenities("مصعد,مطبخ", "كهرباء,مياه", "") == {"elevator": True, "kitchen": True,
                                                            "electricity": True, "water_supply": True}
    assert R.amenities("", "لايوجد خدمات", "غير مفروشة")["furnished"] is False
    assert "elevator" not in R.amenities("", "", "مصعد مؤسس")


# ═══════════════════════════════ 5. identity, url, photos, PII ═══════════════════════════════════
def test_url_is_the_listings_own_page_and_no_pii_reaches_the_row():
    row, _, _ = R.map_listing(EBZ_690)
    assert row["ad_number"] == "EBZ690"
    assert row["listing_url"] == ("https://ebriza.com.sa/rent/690/%D8%A7%D9%84%D8%B1%D9%8A%D8%A7%D8%B6/"
                                  "%D8%A7%D9%84%D8%B9%D8%A7%D8%B1%D8%B6/%D8%B4%D9%82%D8%A9-%D8%A5%D9%8A%D8%AC%D8%A7%D8%B1")
    assert R.map_listing(EBZ_693)[0]["listing_url"].startswith("https://ebriza.com.sa/for_sell/693/")
    assert row["photo_urls"][0].startswith("https://ebriza.com.sa/Agent/assets/properties_images/")
    assert " " not in "".join(row["photo_urls"]) and "None" not in row["listing_url"]
    blob = json.dumps(row, ensure_ascii=False, default=str)
    assert EBZ_690["phoneNumber"] not in blob and EBZ_690["advertiserName"] not in blob
    assert "0557776760" not in blob and "557776760" not in blob


def test_arabic_filename_is_percent_encoded():
    urls = R.photo_urls({"images": "Agent/assets/properties_images/2026-09-23/m1790187972موقع.jpeg"})
    assert urls == ["https://ebriza.com.sa/Agent/assets/properties_images/2026-09-23/m1790187972%D9%85%D9%88%D9%82%D8%B9.jpeg"]


# ═══════════════════════════════ 6. transport: the shuffled catalogue ════════════════════════════
class _Resp:
    def __init__(self, status, body):
        self.status_code, self.text = status, body

    def json(self):
        return json.loads(self.text)


class _Session:
    """Answers get_properties by (type, page); records every call's params."""
    def __init__(self, pages, total=None):
        self.pages, self.total, self.calls = pages, total, []

    def get(self, url, params=None, timeout=None):
        self.calls.append(dict(params))
        body = self.pages.get((params["type"], params["page"]))
        if body is None:
            return _Resp(200, json.dumps({"propertiesData": [], "total": self.total or 0}))
        if isinstance(body, str):
            return _Resp(200, body)
        return _Resp(200, json.dumps({"propertiesData": body, "total": self.total}))


def test_fetch_listings_sends_the_deterministic_sort_and_dedupes(monkeypatch):
    monkeypatch.setattr(R.time, "sleep", lambda *_: None)
    a, b = dict(EBZ_693, id=1), dict(EBZ_693, id=2)
    pages = {("بيع", 1): [a] * 10, ("بيع", 2): [b], ("إيجار", 1): [dict(EBZ_690, id=3)]}
    items, expected = R.fetch_listings(_Session(pages, total=2))
    assert sorted(i["id"] for i in items) == [1, 2, 3] and expected == 4
    assert all(c["filters[sort]"] == "latest" for c in _Session(pages, 2).calls or [{"filters[sort]": "latest"}])
    s = _Session(pages, total=2)
    R.fetch_listings(s)
    assert all(c["filters[sort]"] == "latest" for c in s.calls)
    with pytest.raises(RuntimeError):
        R.fetch_listings(_Session({("بيع", 1): "<html>challenge</html>"}))


# ═══════════════════════════════ 7. the oracle ═══════════════════════════════════════════════════
def test_signal_reads_the_measured_shapes():
    sig = R._signal_for(690)
    assert sig(404, '{"error":"No property found"}', False) == "gone"
    assert sig(200, '{"id":690,"status":"1"}', False) == "live"
    assert sig(200, '{"id":691,"status":"1"}', False) is None          # another listing's record
    assert sig(200, '{"id":690,"status":"0"}', False) == "gone"
    assert sig(400, '{"error":"Invalid ID"}', False) is None
    assert sig(200, "<html>", False) is None


def test_verify_gone_posts_and_a_block_is_never_a_death(monkeypatch):
    posted = []

    def _session(status, body):
        def post(url, data=None, timeout=None):
            posted.append(data)
            return _Resp(status, body)
        return types.SimpleNamespace(post=post)
    monkeypatch.setattr(R.time, "sleep", lambda *_: None)
    monkeypatch.setattr(R, "session", lambda: _session(404, '{"error":"No property found"}'))
    assert R._verify_gone("EBZ59")[0] == "gone"
    assert posted[-1] == {"action": "get_property_data", "id": "59"}
    monkeypatch.setattr(R, "session", lambda: _session(403, '{"error":"No property found"}'))
    assert R._verify_gone("EBZ59")[0] == "unknown"
    monkeypatch.setattr(R, "session", lambda: _session(200, '{"id":690,"status":"1"}'))
    assert R._verify_gone("EBZ690")[0] == "live"
    assert R._verify_gone("EBZx")[0] == "unknown"


# ═══════════════════════════════ 8. main(): tally, gate, literal tables ══════════════════════════
def _stub_db(monkeypatch):
    calls = {"batch": [], "end_run": [], "prune": [], "retire": []}
    db = types.SimpleNamespace(
        begin_run=lambda platform: 77,
        _wasalt_batch=lambda table, rows: calls["batch"].append((table, [r["ad_number"] for r in rows])),
        retire_superseded_siblings=lambda **kw: calls["retire"].append(kw) or 0,
        prune_unseen=lambda table, seen, source=None, **kw: calls["prune"].append((table, sorted(seen), kw)) or 0,
        end_run=lambda run_id, **kw: calls["end_run"].append((run_id, kw)) or True,
        AUTHORITATIVE_NULL=_db.AUTHORITATIVE_NULL,
    )
    monkeypatch.setattr(R, "db", db)
    monkeypatch.setattr(R.time, "sleep", lambda *_: None)
    monkeypatch.setattr(R, "session", lambda: object())
    return calls


_ITEMS = [EBZ_690, EBZ_693, EBZ_409, EBZ_551, dict(EBZ_690, id=9, title="شقة مزاد")]


def test_main_tallies_every_skip_and_prunes_only_behind_a_complete_walk_and_the_control(monkeypatch):
    calls = _stub_db(monkeypatch)
    monkeypatch.setattr(R, "fetch_listings", lambda s, limit=0: (list(_ITEMS), 5))
    monkeypatch.setattr(R, "_controls_live", lambda ads: False)
    monkeypatch.setattr(sys, "argv", ["run.py"])
    assert R.main() == 0
    assert calls["batch"] == [("ebriza_residential_listings", ["EBZ690", "EBZ693"]),
                              ("ebriza_commercial_listings", ["EBZ551"])]
    assert calls["retire"][0]["res_table"] == "ebriza_residential_listings"
    assert calls["prune"] == []                                        # control failed → nothing pruned
    run_id, kw = calls["end_run"][0]
    assert run_id == 77 and kw["ok"] is True and kw["rows_seen"] == 5 and kw["rows_upserted"] == 3
    assert kw["degraded"] is False
    for tally in ("city_not_in_catalogx1", "auctionx1", "pruned=0", "walk=5/5"):
        assert tally in kw["notes"], (tally, kw["notes"])
    assert kw["check_tables"] == ["ebriza_residential_listings", "ebriza_commercial_listings"]

    calls = _stub_db(monkeypatch)
    monkeypatch.setattr(R, "_controls_live", lambda ads: ads[:2] == ["EBZ690", "EBZ693"])
    assert R.main() == 0
    assert [p[0] for p in calls["prune"]] == ["ebriza_residential_listings", "ebriza_commercial_listings"]
    assert calls["prune"][0][1] == ["EBZ690", "EBZ693"] and calls["prune"][0][2]["verify_gone"] is R._verify_gone

    # the site counter says MORE than we saw → incomplete: upsert, but never prune, and say so
    calls = _stub_db(monkeypatch)
    monkeypatch.setattr(R, "fetch_listings", lambda s, limit=0: (list(_ITEMS), 207))
    assert R.main() == 0
    assert calls["prune"] == [] and calls["end_run"][0][1]["degraded"] is True
    assert "walk=5/207" in calls["end_run"][0][1]["notes"]


def test_a_blocked_walk_is_a_failed_run_that_writes_nothing(monkeypatch):
    calls = _stub_db(monkeypatch)

    def blocked(s, limit=0):
        raise RuntimeError("get_properties type=بيع page=1: not JSON")
    monkeypatch.setattr(R, "fetch_listings", blocked)
    monkeypatch.setattr(sys, "argv", ["run.py"])
    assert R.main() == 1
    assert calls["batch"] == [] and calls["prune"] == []
    assert calls["end_run"][0][1]["ok"] is False and "not JSON" in calls["end_run"][0][1]["notes"]


def test_session_asks_for_arabic_and_never_sets_a_user_agent():
    s = R.session()
    assert s.headers["Accept-Language"].startswith("ar")
    assert "User-Agent" not in s.headers and "user-agent" not in s.headers
