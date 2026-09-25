"""ego (إيجو عقار) — the guards for the three ways this source can corrupt a listing.

Every fixture below is a VERBATIM record captured from https://egoagar-backend.com/api/v0/units/<id>
on 2026-09-24, trimmed to the keys `map_listing` reads. Nothing is hand-written: the prices, the
Arabic prose, the government block (advertiser name and phone included, so the PDPL test has real
PII to fail on) and the presigned photo URLs are exactly what the API served. The assertions execute
the SHIPPING functions in scrapers/ego/run.py.

WHAT IS GUARDED, AND WHY EACH ONE IS HERE
  1. Id 2415 publishes `price` "42949672.95" — exactly 4294967295/100, the unsigned-32-bit ceiling in
     halalas — while the SAME record's REGA block says 656250000. The rendered page shows the
     former, so that is what we store: not the REGA figure, not NULL, not a repaired number.
  2. Id 2420 says «للايجار شهري وسنوى». The shared `rent_period_and_annual` cannot see «سنوى»
     (alef maqsura), reads a lone «شهري» and returns 504,000 for a 42,000 listing. `_rent_fields`
     must keep 42,000 with rent_period NULL.
  3. `governmentData` hides `advertiserName` and `phoneNumber` as VALUES of a "key" field, where the
     shared key-name filter cannot see them.

MUTATION-VERIFIED 2026-09-24. Six mutants were built and run; every one now FAILS a named test,
and the suite was restored to 59 passed after each. TWO OF THEM SURVIVED THE FIRST TIME AND THAT IS
THE MOST USEFUL THING IN THIS FILE, so it is recorded rather than tidied away:

  A. `price = normalize.to_int_numeric(price_raw)` → `price = rega_price or …`
     ("prefer the REGA figure", the single most tempting fix for a price that looks wrong)
     → 3 FAILED: «ego must store the price the platform itself publishes and shows (42949672),
       never the other published figure 656250000», plus the evidence and no-division tests.

  B. in `_rent_fields`, `if len(tokens) != 1:` → `if not tokens:`   (drop the two-periods gate)
     → FIRST RUN: **SURVIVED, 58 passed.** Why: id 2420 is caught by the OTHER gate too (its prose
       never prints 42,000, so the corroboration gate refuses the ×12 anyway).
  C. `_rent_fields`'s corroboration branch → `return period, annual` (convert unconditionally)
     → FIRST RUN: **ALSO SURVIVED, 58 passed** — 2420 is caught by the count gate instead.
     Two redundant guards each hide the other's removal, so neither was actually being tested:
     `test_each_of_the_two_rent_gates_is_load_bearing_on_its_own` was added to give each gate an
     input class only it can catch. With it, B fails («an ad naming two periods must not be labelled
     with the one that happens to come first», ('annual', 42000)) and C fails («a monthly word with
     no corroborating figure must not multiply the stored price», ('monthly', 504000)).
  D. both gates removed at once — `_rent_fields` → `return normalize.rent_period_and_annual(...)`,
     i.e. "why do we even have this wrapper?"
     → 4 FAILED, including «a 42,000 rent became 504000: the ×12 ran on a listing that names two
       periods at once» and «the published 60,000 must survive» (2380's daily+monthly summer rate).
  E. `"government_data": gov` → `rec.get("governmentData")` (copy the block instead of allowlisting)
     → FAILED: «PDPL: '0557731494' reached a stored payload».
  F. `bare = v.split("?", 1)[0]` → `bare = v` (keep the S3 presignature)
     → FAILED: test_the_presigned_photo_signature_is_never_stored.
  G. `_clean` → `return s or None` (treat the four-character string "None" as a value)
     → FAILED: test_the_four_character_string_None_is_an_absent_value.

Run: python -m pytest scrapers/common/tests/test_ego_price_period_and_pdpl.py -v
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[3]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scrapers.common import normalize                                    # noqa: E402
from scrapers.common.http_liveness import decide, read_is_unbelievable   # noqa: E402
from scrapers.ego import run as E                                        # noqa: E402

# ── VERBATIM CAPTURES ────────────────────────────────────────────────────────────────────────────
# Kept as raw JSON rather than Python literals so the bytes the API served are visibly untouched.
# Photo keys are present on 2451 only (the photo/PDPL fixture); the others were trimmed of them,
# which only means `photo_urls` is None for those rows.
_CAPTURED = json.loads(r"""
{
 "2415": {
  "id": 2415,
  "adType": "sell",
  "type": "land",
  "area": "525.00",
  "price": "42949672.95",
  "priceDisplay": "42,949,672.95 SAR",
  "coordinates": [
   21.780301,
   39.085875
  ],
  "numberOfRooms": null,
  "status": "active",
  "isActive": true,
  "isReserved": false,
  "createdAt": "10 Aug 2026 - 09:34:14 AM",
  "licenseNumber": "7100308894",
  "licenseStartDate": "10 Aug 2026",
  "licenseExpiryDate": "24 Oct 2026",
  "deedNumber": "6600006909000000",
  "adTitle": "Land for sale",
  "adDescription": null,
  "governmentData": [
   {
    "key": "adInfo",
    "label": "Ad information",
    "value": [
     {
      "key": "advertisementType",
      "label": "Ad purpose",
      "value": "بيع"
     },
     {
      "key": "advertiserName",
      "label": "Ad contact name",
      "value": "محمد حمود بن حامد البقمي"
     },
     {
      "key": "phoneNumber",
      "label": "Ad contact mobile number",
      "value": "0534052664"
     },
     {
      "key": "adLicenseNumber",
      "label": "Ad license number",
      "value": "7100308894"
     },
     {
      "key": "endDate",
      "label": "License expiry date",
      "value": "24/10/2026"
     }
    ]
   },
   {
    "key": "propertyDetails",
    "label": "Property details",
    "value": [
     {
      "key": "propertyType",
      "label": "Property type",
      "value": "ارض"
     },
     {
      "key": "propertyFace",
      "label": "Property frontage",
      "value": "شرقية - غربية - جنوبية - شمالية"
     },
     {
      "key": "propertyPrice",
      "label": "Unit price",
      "value": 656250000
     },
     {
      "key": "numberOfRooms",
      "label": "Number of rooms",
      "value": null
     },
     {
      "key": "propertyArea",
      "label": "Property area",
      "value": 525
     },
     {
      "key": "propertyAge",
      "label": "Property age",
      "value": null
     },
     {
      "key": "propertyUsages",
      "label": "Property usage",
      "value": "None"
     },
     {
      "key": "propertyUtilities",
      "label": "Property utilities",
      "value": "كهرباء, مياه, صرف صحي, ألياف ضوئية, تصريف الفيضانات , هاتف"
     },
     {
      "key": "streetWidth",
      "label": "Street width",
      "value": 15
     },
     {
      "key": "rerConstraints",
      "label": "Real estate registry restrictions",
      "value": "None"
     },
     {
      "key": "obligationsOnTheProperty",
      "label": "Obligations on the property",
      "value": "لايوجد"
     },
     {
      "key": "guaranteesAndTheirDuration",
      "label": "Guarantees and their duration",
      "value": ""
     }
    ]
   },
   {
    "key": "location",
    "label": "Location",
    "value": [
     {
      "key": "region",
      "label": "Region",
      "value": "منطقة مكة المكرمة"
     },
     {
      "key": "city",
      "label": "City",
      "value": "جدة"
     },
     {
      "key": "district",
      "label": "District",
      "value": "الياقوت"
     },
     {
      "key": "street",
      "label": "Street name",
      "value": "محب الدين الفكهاني"
     },
     {
      "key": "postalCode",
      "label": "Postal code",
      "value": "23824"
     },
     {
      "key": "buildingNumber",
      "label": "Building number",
      "value": "4750"
     },
     {
      "key": "additionalNumber",
      "label": "Additional number",
      "value": "7832"
     },
     {
      "key": "landNumber",
      "label": "Land parcel number",
      "value": "743"
     },
     {
      "key": "planNumber",
      "label": "Plan number",
      "value": "204 / ب"
     },
     {
      "key": "locationDescriptionOnMOJDeed",
      "label": "Property location description per the deed",
      "value": null
     }
    ]
   }
  ],
  "userId": 41878
 },
 "2420": {
  "id": 2420,
  "adType": "rent",
  "type": "apartment",
  "area": "500.00",
  "price": "42000.00",
  "priceDisplay": "42,000.00 SAR",
  "coordinates": [
   26.28663498369501,
   50.19694114507818
  ],
  "numberOfRooms": 18,
  "status": "active",
  "isActive": true,
  "isReserved": false,
  "createdAt": "16 Aug 2026 - 02:42:17 PM",
  "licenseNumber": "7201087951",
  "licenseStartDate": "16 Aug 2026",
  "licenseExpiryDate": "14 Nov 2026",
  "deedNumber": "830211003256",
  "adTitle": "Apartment for rent",
  "adDescription": "شقق مجهزة للايجار شهري وسنوى مكونة من غرفتين وصالة وحمام ومطبخ في موقع متميز في وسط الخبر حي العقربية قريب من الكورنيش وجميع الخدمات والمولات التجارية\n\nيمتاز بخدمة راقية ونظافة اسبوعية بالاضافة لانترنيت مفتوح",
  "governmentData": [
   {
    "key": "adInfo",
    "label": "Ad information",
    "value": [
     {
      "key": "advertisementType",
      "label": "Ad purpose",
      "value": "إيجار"
     },
     {
      "key": "advertiserName",
      "label": "Ad contact name",
      "value": "شركة إيجو العقارية"
     },
     {
      "key": "phoneNumber",
      "label": "Ad contact mobile number",
      "value": "0538583001"
     },
     {
      "key": "adLicenseNumber",
      "label": "Ad license number",
      "value": "7201087951"
     },
     {
      "key": "endDate",
      "label": "License expiry date",
      "value": "14/11/2026"
     }
    ]
   },
   {
    "key": "propertyDetails",
    "label": "Property details",
    "value": [
     {
      "key": "propertyType",
      "label": "Property type",
      "value": "شقة"
     },
     {
      "key": "propertyFace",
      "label": "Property frontage",
      "value": ""
     },
     {
      "key": "propertyPrice",
      "label": "Unit price",
      "value": 42000
     },
     {
      "key": "numberOfRooms",
      "label": "Number of rooms",
      "value": 18
     },
     {
      "key": "propertyArea",
      "label": "Property area",
      "value": 500
     },
     {
      "key": "propertyAge",
      "label": "Property age",
      "value": "خمس سنوات"
     },
     {
      "key": "propertyUsages",
      "label": "Property usage",
      "value": "None"
     },
     {
      "key": "propertyUtilities",
      "label": "Property utilities",
      "value": "كهرباء, مياه, صرف صحي, ألياف ضوئية, تصريف الفيضانات "
     },
     {
      "key": "streetWidth",
      "label": "Street width",
      "value": 0
     },
     {
      "key": "rerConstraints",
      "label": "Real estate registry restrictions",
      "value": "None"
     },
     {
      "key": "obligationsOnTheProperty",
      "label": "Obligations on the property",
      "value": "لا يوجد"
     },
     {
      "key": "guaranteesAndTheirDuration",
      "label": "Guarantees and their duration",
      "value": ""
     }
    ]
   },
   {
    "key": "location",
    "label": "Location",
    "value": [
     {
      "key": "region",
      "label": "Region",
      "value": "المنطقة الشرقية"
     },
     {
      "key": "city",
      "label": "City",
      "value": "الخبر"
     },
     {
      "key": "district",
      "label": "District",
      "value": "العقربية"
     },
     {
      "key": "street",
      "label": "Street name",
      "value": "اليرموك"
     },
     {
      "key": "postalCode",
      "label": "Postal code",
      "value": "34446"
     },
     {
      "key": "buildingNumber",
      "label": "Building number",
      "value": "3663"
     },
     {
      "key": "additionalNumber",
      "label": "Additional number",
      "value": "6462"
     },
     {
      "key": "landNumber",
      "label": "Land parcel number",
      "value": "16 / أ"
     },
     {
      "key": "planNumber",
      "label": "Plan number",
      "value": "145 / 2"
     },
     {
      "key": "locationDescriptionOnMOJDeed",
      "label": "Property location description per the deed",
      "value": "حي  العقربية  بمدينة الخبر ."
     }
    ]
   }
  ],
  "userId": 325827
 },
 "2392": {
  "id": 2392,
  "adType": "rent",
  "type": "apartment",
  "area": "502.00",
  "price": "18000.00",
  "priceDisplay": "18,000.00 SAR",
  "coordinates": [
   21.644583274864814,
   40.40294412231872
  ],
  "numberOfRooms": 3,
  "status": "active",
  "isActive": true,
  "isReserved": false,
  "createdAt": "19 Jul 2026 - 01:41:13 PM",
  "licenseNumber": "7201048009",
  "licenseStartDate": "19 Jul 2026",
  "licenseExpiryDate": "19 Oct 2026",
  "deedNumber": "994919008277",
  "adTitle": "Apartment for rent",
  "adDescription": "شقة جديدة فاخرة للإيجار السنوي (أول ساكن) 🌟\n التكييف: مكيفات سبلت جديدة راكبة بالكامل ❄️.\n المداخل: مدخلين مستقلين (رجال / نساء) \n الخدمات: الماء مجاني (على المالك) 💧.\nالتقسيم الداخلي:\n 🔹 قسم الرجال: مجلس + دورة مياه.\n 🔹 قسم العائلة: صالة + غرفتين نوم + مطبخ + دورة مياه.\n💵 الإيجار: سنوي [19000]\n📍 الحي: السيل الكبير بداية مخطط واحة الميقات \n📞 للتواصل والمعاينة: 0561159666",
  "governmentData": [
   {
    "key": "adInfo",
    "label": "Ad information",
    "value": [
     {
      "key": "advertisementType",
      "label": "Ad purpose",
      "value": "إيجار"
     },
     {
      "key": "advertiserName",
      "label": "Ad contact name",
      "value": "شركة إيجو العقارية"
     },
     {
      "key": "phoneNumber",
      "label": "Ad contact mobile number",
      "value": "0538583001"
     },
     {
      "key": "adLicenseNumber",
      "label": "Ad license number",
      "value": "7201048009"
     },
     {
      "key": "endDate",
      "label": "License expiry date",
      "value": "19/10/2026"
     }
    ]
   },
   {
    "key": "propertyDetails",
    "label": "Property details",
    "value": [
     {
      "key": "propertyType",
      "label": "Property type",
      "value": "شقة"
     },
     {
      "key": "propertyFace",
      "label": "Property frontage",
      "value": ""
     },
     {
      "key": "propertyPrice",
      "label": "Unit price",
      "value": 18000
     },
     {
      "key": "numberOfRooms",
      "label": "Number of rooms",
      "value": 3
     },
     {
      "key": "propertyArea",
      "label": "Property area",
      "value": 502
     },
     {
      "key": "propertyAge",
      "label": "Property age",
      "value": "جديد"
     },
     {
      "key": "propertyUsages",
      "label": "Property usage",
      "value": "None"
     },
     {
      "key": "propertyUtilities",
      "label": "Property utilities",
      "value": "مياه, صرف صحي"
     },
     {
      "key": "streetWidth",
      "label": "Street width",
      "value": 0
     },
     {
      "key": "rerConstraints",
      "label": "Real estate registry restrictions",
      "value": "None"
     },
     {
      "key": "obligationsOnTheProperty",
      "label": "Obligations on the property",
      "value": "لا يوجد"
     },
     {
      "key": "guaranteesAndTheirDuration",
      "label": "Guarantees and their duration",
      "value": ""
     }
    ]
   },
   {
    "key": "location",
    "label": "Location",
    "value": [
     {
      "key": "region",
      "label": "Region",
      "value": "منطقة مكة المكرمة"
     },
     {
      "key": "city",
      "label": "City",
      "value": "الطائف"
     },
     {
      "key": "district",
      "label": "District",
      "value": "القدس"
     },
     {
      "key": "street",
      "label": "Street name",
      "value": "حي البهيتة الجنوبية"
     },
     {
      "key": "postalCode",
      "label": "Postal code",
      "value": "26347"
     },
     {
      "key": "buildingNumber",
      "label": "Building number",
      "value": "9600"
     },
     {
      "key": "additionalNumber",
      "label": "Additional number",
      "value": "3946"
     },
     {
      "key": "landNumber",
      "label": "Land parcel number",
      "value": "721"
     },
     {
      "key": "planNumber",
      "label": "Plan number",
      "value": "1884 / س المعدل 2"
     },
     {
      "key": "locationDescriptionOnMOJDeed",
      "label": "Property location description per the deed",
      "value": "حي القدس في  محافظة الطائف"
     }
    ]
   }
  ],
  "userId": 214385
 },
 "2357": {
  "id": 2357,
  "adType": "rent",
  "type": "land",
  "area": "255.75",
  "price": "51150.00",
  "priceDisplay": "51,150.00 SAR",
  "coordinates": [
   26.046749572448793,
   43.54045732459307
  ],
  "numberOfRooms": null,
  "status": "active",
  "isActive": true,
  "isReserved": false,
  "createdAt": "02 Jul 2026 - 08:45:58 AM",
  "licenseNumber": "7201026180",
  "licenseStartDate": "02 Jul 2026",
  "licenseExpiryDate": "01 Oct 2026",
  "deedNumber": "860002478500",
  "adTitle": "Land for rent",
  "adDescription": "السلام عليكم ورحمة الله وبركاته\n\nفرصة استثمارية مميزة للإيجار\nأرض سكنية في موقع متميز بحي الجزيرة بمحافظة رياض الخبراء القصيم\nبمساحة 255.75 م2، مناسبة للمشاريع السكنية والاستثمارية، وتتميز بسهولة الوصول وقربها من الخدمات.\n\n® قيمة الإيجار السنوي: 70،635ريال\nللتواصل والاستفسار يرجى مراسلتي عبر  الواتساب \nنسعد  بخدمتكم وشكراً لكم",
  "governmentData": [
   {
    "key": "adInfo",
    "label": "Ad information",
    "value": [
     {
      "key": "advertisementType",
      "label": "Ad purpose",
      "value": "إيجار"
     },
     {
      "key": "advertiserName",
      "label": "Ad contact name",
      "value": "شركة إيجو العقارية"
     },
     {
      "key": "phoneNumber",
      "label": "Ad contact mobile number",
      "value": "0538583001"
     },
     {
      "key": "adLicenseNumber",
      "label": "Ad license number",
      "value": "7201026180"
     },
     {
      "key": "endDate",
      "label": "License expiry date",
      "value": "01/10/2026"
     }
    ]
   },
   {
    "key": "propertyDetails",
    "label": "Property details",
    "value": [
     {
      "key": "propertyType",
      "label": "Property type",
      "value": "ارض"
     },
     {
      "key": "propertyFace",
      "label": "Property frontage",
      "value": "شرقية - غربية - شمالية - جنوبية"
     },
     {
      "key": "propertyPrice",
      "label": "Unit price",
      "value": 51150
     },
     {
      "key": "numberOfRooms",
      "label": "Number of rooms",
      "value": null
     },
     {
      "key": "propertyArea",
      "label": "Property area",
      "value": 255.75
     },
     {
      "key": "propertyAge",
      "label": "Property age",
      "value": null
     },
     {
      "key": "propertyUsages",
      "label": "Property usage",
      "value": "None"
     },
     {
      "key": "propertyUtilities",
      "label": "Property utilities",
      "value": "كهرباء, مياه"
     },
     {
      "key": "streetWidth",
      "label": "Street width",
      "value": 15
     },
     {
      "key": "rerConstraints",
      "label": "Real estate registry restrictions",
      "value": "None"
     },
     {
      "key": "obligationsOnTheProperty",
      "label": "Obligations on the property",
      "value": "لا يوجد"
     },
     {
      "key": "guaranteesAndTheirDuration",
      "label": "Guarantees and their duration",
      "value": ""
     }
    ]
   },
   {
    "key": "location",
    "label": "Location",
    "value": [
     {
      "key": "region",
      "label": "Region",
      "value": "منطقة القصيم"
     },
     {
      "key": "city",
      "label": "City",
      "value": "رياض الخبراء"
     },
     {
      "key": "district",
      "label": "District",
      "value": "الجزيرة"
     },
     {
      "key": "street",
      "label": "Street name",
      "value": "لا يوجد"
     },
     {
      "key": "postalCode",
      "label": "Postal code",
      "value": "00000"
     },
     {
      "key": "buildingNumber",
      "label": "Building number",
      "value": "0000"
     },
     {
      "key": "additionalNumber",
      "label": "Additional number",
      "value": "0000"
     },
     {
      "key": "landNumber",
      "label": "Land parcel number",
      "value": "رقم 2 / 75 / 5"
     },
     {
      "key": "planNumber",
      "label": "Plan number",
      "value": "ق / ي / 326المعدل"
     },
     {
      "key": "locationDescriptionOnMOJDeed",
      "label": "Property location description per the deed",
      "value": "حي الجزيرة في  محافظة رياض الخبراء"
     }
    ]
   }
  ],
  "userId": 10679
 },
 "2451": {
  "id": 2451,
  "adType": "sell",
  "type": "apartment",
  "area": "344.55",
  "price": "750000.00",
  "priceDisplay": "750,000.00 SAR",
  "coordinates": [
   26.41694371500006,
   50.02392182700004
  ],
  "numberOfRooms": 9,
  "status": "active",
  "isActive": true,
  "isReserved": false,
  "createdAt": "21 Sep 2026 - 10:02:08 AM",
  "licenseNumber": "7100320423",
  "licenseStartDate": "11 Sep 2026",
  "licenseExpiryDate": "25 Nov 2026",
  "deedNumber": "932503016196",
  "adTitle": "Apartment for sale",
  "adDescription": "العقار عباره \nعن شقة دوبلكس علويه مساحة ٣٤٤ \nصك حر عمر العقار ما يقارب ١٣ سنه \nحي بدر خلف وكالة الجبر كيا\n\n*الدور الاول*\nمجلس رجال + غرفة معيشة + صاله + مستودع + مطبخ + ثلاث غرف نوم منها واحده ماستر \nواثنين دورات مياه اجلكم الله \n\n*الدور الثاني* \nاربع غرف نوم + مطبخ صغير + ثلاث دورات مياه اجلكم الله \n\nالمميزات \nمطابخ راكبه في المطبخين العلوي والسفلي \nفرن غاز سطح وفرن عادي راكبه ( قليم قاز ) \nغسالة اواني و ويلربول \nعدد ثلاثه مكيفات سبيلت \nمدخل مستقل بموقف سياره \nغاز مركزي \nعداد مياه مستقل \nعداد كهرباء مستقل\n\nالسعر : 750الف",
  "governmentData": [
   {
    "key": "adInfo",
    "label": "Ad information",
    "value": [
     {
      "key": "advertisementType",
      "label": "Ad purpose",
      "value": "بيع"
     },
     {
      "key": "advertiserName",
      "label": "Ad contact name",
      "value": "عبير عبدالله صالح العطاوي"
     },
     {
      "key": "phoneNumber",
      "label": "Ad contact mobile number",
      "value": "0557731494"
     },
     {
      "key": "adLicenseNumber",
      "label": "Ad license number",
      "value": "7100320423"
     },
     {
      "key": "endDate",
      "label": "License expiry date",
      "value": "25/11/2026"
     }
    ]
   },
   {
    "key": "propertyDetails",
    "label": "Property details",
    "value": [
     {
      "key": "propertyType",
      "label": "Property type",
      "value": "شقة"
     },
     {
      "key": "propertyFace",
      "label": "Property frontage",
      "value": ""
     },
     {
      "key": "propertyPrice",
      "label": "Unit price",
      "value": 750000
     },
     {
      "key": "numberOfRooms",
      "label": "Number of rooms",
      "value": 9
     },
     {
      "key": "propertyArea",
      "label": "Property area",
      "value": 344.55
     },
     {
      "key": "propertyAge",
      "label": "Property age",
      "value": "اكثر من عشر سنوات"
     },
     {
      "key": "propertyUsages",
      "label": "Property usage",
      "value": "None"
     },
     {
      "key": "propertyUtilities",
      "label": "Property utilities",
      "value": "كهرباء, مياه"
     },
     {
      "key": "streetWidth",
      "label": "Street width",
      "value": 0
     },
     {
      "key": "rerConstraints",
      "label": "Real estate registry restrictions",
      "value": "None"
     },
     {
      "key": "obligationsOnTheProperty",
      "label": "Obligations on the property",
      "value": "لايوجد"
     },
     {
      "key": "guaranteesAndTheirDuration",
      "label": "Guarantees and their duration",
      "value": ""
     }
    ]
   },
   {
    "key": "location",
    "label": "Location",
    "value": [
     {
      "key": "region",
      "label": "Region",
      "value": "المنطقة الشرقية"
     },
     {
      "key": "city",
      "label": "City",
      "value": "الدمام"
     },
     {
      "key": "district",
      "label": "District",
      "value": "بدر"
     },
     {
      "key": "street",
      "label": "Street name",
      "value": "سالم بن عبد الله"
     },
     {
      "key": "postalCode",
      "label": "Postal code",
      "value": "32266"
     },
     {
      "key": "buildingNumber",
      "label": "Building number",
      "value": "3171"
     },
     {
      "key": "additionalNumber",
      "label": "Additional number",
      "value": "7767"
     },
     {
      "key": "landNumber",
      "label": "Land parcel number",
      "value": "153"
     },
     {
      "key": "planNumber",
      "label": "Plan number",
      "value": "399 / 1"
     },
     {
      "key": "locationDescriptionOnMOJDeed",
      "label": "Property location description per the deed",
      "value": "حي  بدر  بمدينة الدمام ."
     }
    ]
   }
  ],
  "userId": 346063,
  "mainPhotoUrl": "https://ego-aqar-bucket-production.s3.eu-west-1.amazonaws.com/units/2451/main.jpeg?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Content-Sha256=UNSIGNED-PAYLOAD&X-Amz-Credential=AKIA2ZIOMXPAWV4HHKF2%2F20260925%2Feu-west-1%2Fs3%2Faws4_request&X-Amz-Date=20260925T043229Z&X-Amz-Expires=43200&X-Amz-Signature=31404a95ce1dee6df6250cc5ab33b9e15f92ef062b79226bb0524cf48c26093b&X-Amz-SignedHeaders=host&x-amz-checksum-mode=ENABLED&x-id=GetObject",
  "photo0Url": "https://ego-aqar-bucket-production.s3.eu-west-1.amazonaws.com/units/2451/photo-0.jpeg?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Content-Sha256=UNSIGNED-PAYLOAD&X-Amz-Credential=AKIA2ZIOMXPAWV4HHKF2%2F20260925%2Feu-west-1%2Fs3%2Faws4_request&X-Amz-Date=20260925T043229Z&X-Amz-Expires=43200&X-Amz-Signature=ef14ae9064e1d6188987c08552bdb0553e46487c53c77fd3a62af79c315123fa&X-Amz-SignedHeaders=host&x-amz-checksum-mode=ENABLED&x-id=GetObject",
  "photo1Url": "https://ego-aqar-bucket-production.s3.eu-west-1.amazonaws.com/units/2451/photo-1.jpeg?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Content-Sha256=UNSIGNED-PAYLOAD&X-Amz-Credential=AKIA2ZIOMXPAWV4HHKF2%2F20260925%2Feu-west-1%2Fs3%2Faws4_request&X-Amz-Date=20260925T043229Z&X-Amz-Expires=43200&X-Amz-Signature=debfb9c194cde0091697c5323228f4e836d5fa4c0a4a9a328a19b331009ca49d&X-Amz-SignedHeaders=host&x-amz-checksum-mode=ENABLED&x-id=GetObject",
  "photo2Url": "https://ego-aqar-bucket-production.s3.eu-west-1.amazonaws.com/units/2451/photo-2.jpeg?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Content-Sha256=UNSIGNED-PAYLOAD&X-Amz-Credential=AKIA2ZIOMXPAWV4HHKF2%2F20260925%2Feu-west-1%2Fs3%2Faws4_request&X-Amz-Date=20260925T043229Z&X-Amz-Expires=43200&X-Amz-Signature=789a63de384c80410f36d62660b514bc6ce6324abbd80ee9c8f307b42812df90&X-Amz-SignedHeaders=host&x-amz-checksum-mode=ENABLED&x-id=GetObject"
 },
 "2409": {
  "id": 2409,
  "adType": "sell",
  "type": "land",
  "area": "625.05",
  "price": "560000.00",
  "priceDisplay": "560,000.00 SAR",
  "coordinates": [
   28.37484219445891,
   36.53661893893388
  ],
  "numberOfRooms": null,
  "status": "active",
  "isActive": true,
  "isReserved": false,
  "createdAt": "03 Aug 2026 - 09:18:29 AM",
  "licenseNumber": "7201068567",
  "licenseStartDate": "03 Aug 2026",
  "licenseExpiryDate": "03 Nov 2026",
  "deedNumber": "295708001157",
  "adTitle": "Land for sale",
  "adDescription": "بيع الارض",
  "governmentData": [
   {
    "key": "adInfo",
    "label": "Ad information",
    "value": [
     {
      "key": "advertisementType",
      "label": "Ad purpose",
      "value": "بيع"
     },
     {
      "key": "advertiserName",
      "label": "Ad contact name",
      "value": "شركة إيجو العقارية"
     },
     {
      "key": "phoneNumber",
      "label": "Ad contact mobile number",
      "value": "0538583001"
     },
     {
      "key": "adLicenseNumber",
      "label": "Ad license number",
      "value": "7201068567"
     },
     {
      "key": "endDate",
      "label": "License expiry date",
      "value": "03/11/2026"
     }
    ]
   },
   {
    "key": "propertyDetails",
    "label": "Property details",
    "value": [
     {
      "key": "propertyType",
      "label": "Property type",
      "value": "ارض"
     },
     {
      "key": "propertyFace",
      "label": "Property frontage",
      "value": "شمالية شرقية"
     },
     {
      "key": "propertyPrice",
      "label": "Unit price",
      "value": 560000
     },
     {
      "key": "numberOfRooms",
      "label": "Number of rooms",
      "value": null
     },
     {
      "key": "propertyArea",
      "label": "Property area",
      "value": 625.05
     },
     {
      "key": "propertyAge",
      "label": "Property age",
      "value": null
     },
     {
      "key": "propertyUsages",
      "label": "Property usage",
      "value": "None"
     },
     {
      "key": "propertyUtilities",
      "label": "Property utilities",
      "value": "كهرباء, مياه, صرف صحي, ألياف ضوئية"
     },
     {
      "key": "streetWidth",
      "label": "Street width",
      "value": 15
     },
     {
      "key": "rerConstraints",
      "label": "Real estate registry restrictions",
      "value": "None"
     },
     {
      "key": "obligationsOnTheProperty",
      "label": "Obligations on the property",
      "value": "مرهون لدى مصرف الراجحي"
     },
     {
      "key": "guaranteesAndTheirDuration",
      "label": "Guarantees and their duration",
      "value": ""
     }
    ]
   },
   {
    "key": "location",
    "label": "Location",
    "value": [
     {
      "key": "region",
      "label": "Region",
      "value": "منطقة تبوك"
     },
     {
      "key": "city",
      "label": "City",
      "value": "تبوك"
     },
     {
      "key": "district",
      "label": "District",
      "value": "النظيم"
     },
     {
      "key": "street",
      "label": "Street name",
      "value": "النادي"
     },
     {
      "key": "postalCode",
      "label": "Postal code",
      "value": "47915"
     },
     {
      "key": "buildingNumber",
      "label": "Building number",
      "value": "6615"
     },
     {
      "key": "additionalNumber",
      "label": "Additional number",
      "value": "4214"
     },
     {
      "key": "landNumber",
      "label": "Land parcel number",
      "value": "1068"
     },
     {
      "key": "planNumber",
      "label": "Plan number",
      "value": "ت / ت / 47"
     },
     {
      "key": "locationDescriptionOnMOJDeed",
      "label": "Property location description per the deed",
      "value": "حي النظيم في  مدينة تبوك"
     }
    ]
   }
  ],
  "userId": 269516
 },
 "2380": {
  "id": 2380,
  "adType": "rent",
  "type": "villa",
  "area": "300.00",
  "price": "60000.00",
  "priceDisplay": "60,000.00 SAR",
  "coordinates": [
   18.283617924688958,
   42.593873003074705
  ],
  "numberOfRooms": 6,
  "status": "active",
  "isActive": true,
  "isReserved": false,
  "createdAt": "06 Jul 2026 - 10:44:40 AM",
  "licenseNumber": "7201030745",
  "licenseStartDate": "06 Jul 2026",
  "licenseExpiryDate": "05 Oct 2026",
  "deedNumber": "495024010476",
  "adTitle": "Villa for rent",
  "adDescription": "بدأ الحجز \nفيلا دورين وملحق مؤثثة في المحالة المشارف بجانب كوفي حمد والفكوك للأجار الصيفي اليومي والشهري بالصيف .\nمزودة بالمكيفات. \nمتوفر بايكة مظلة سيارات .\nوأيضا مواقف خارجية متعددة .\nقريب من المسجد ومن جميع المحلات التجارية تجيها ع رجولك .\nثلاث صالات جلوس كبيرة .\nمجلس ضيوف.\nاربع دورات مياة.\nاربع غرف نوم بما فيها واحدة ماستر بدورة مياة داخلية .\nمجلس تراثي على السطوح .\nمطبخ مؤثث .\nغرفة غسيل مزودة بغسالة ملابس.\nالاجار شامل الماء والكهرباء.\nالمدخل مشترك مع شقة بالدور الأرضي.\n.\n.\nملاحظة .. التواصل على الواتس أو الإتصال لقلة دخولي البرنامج",
  "governmentData": [
   {
    "key": "adInfo",
    "label": "Ad information",
    "value": [
     {
      "key": "advertisementType",
      "label": "Ad purpose",
      "value": "إيجار"
     },
     {
      "key": "advertiserName",
      "label": "Ad contact name",
      "value": "شركة إيجو العقارية"
     },
     {
      "key": "phoneNumber",
      "label": "Ad contact mobile number",
      "value": "0538583001"
     },
     {
      "key": "adLicenseNumber",
      "label": "Ad license number",
      "value": "7201030745"
     },
     {
      "key": "endDate",
      "label": "License expiry date",
      "value": "05/10/2026"
     }
    ]
   },
   {
    "key": "propertyDetails",
    "label": "Property details",
    "value": [
     {
      "key": "propertyType",
      "label": "Property type",
      "value": "فيلا"
     },
     {
      "key": "propertyFace",
      "label": "Property frontage",
      "value": "شرقية"
     },
     {
      "key": "propertyPrice",
      "label": "Unit price",
      "value": 60000
     },
     {
      "key": "numberOfRooms",
      "label": "Number of rooms",
      "value": 6
     },
     {
      "key": "propertyArea",
      "label": "Property area",
      "value": 300
     },
     {
      "key": "propertyAge",
      "label": "Property age",
      "value": "خمس سنوات"
     },
     {
      "key": "propertyUsages",
      "label": "Property usage",
      "value": "None"
     },
     {
      "key": "propertyUtilities",
      "label": "Property utilities",
      "value": "كهرباء, مياه, صرف صحي"
     },
     {
      "key": "streetWidth",
      "label": "Street width",
      "value": 15
     },
     {
      "key": "rerConstraints",
      "label": "Real estate registry restrictions",
      "value": "None"
     },
     {
      "key": "obligationsOnTheProperty",
      "label": "Obligations on the property",
      "value": "لا يوجد"
     },
     {
      "key": "guaranteesAndTheirDuration",
      "label": "Guarantees and their duration",
      "value": ""
     }
    ]
   },
   {
    "key": "location",
    "label": "Location",
    "value": [
     {
      "key": "region",
      "label": "Region",
      "value": "منطقة عسير"
     },
     {
      "key": "city",
      "label": "City",
      "value": "أبها"
     },
     {
      "key": "district",
      "label": "District",
      "value": "الغدير"
     },
     {
      "key": "street",
      "label": "Street name",
      "value": "ربيقة"
     },
     {
      "key": "postalCode",
      "label": "Postal code",
      "value": "62564"
     },
     {
      "key": "buildingNumber",
      "label": "Building number",
      "value": "8098"
     },
     {
      "key": "additionalNumber",
      "label": "Additional number",
      "value": "3505"
     },
     {
      "key": "landNumber",
      "label": "Land parcel number",
      "value": "81 / أ"
     },
     {
      "key": "planNumber",
      "label": "Plan number",
      "value": "967 / 1423هـ / ع / 1"
     },
     {
      "key": "locationDescriptionOnMOJDeed",
      "label": "Property location description per the deed",
      "value": "قطعة الارض رقم 81 / أ من المخطط التعديلى رقم 4364 /1442 / ع / 1 والمبنى على المخطط الاساسى رقم 967 / 1423هـ/ ع/ 1 الواقع فى حى شرق خط المحاله بمدينة ابها ."
     }
    ]
   }
  ],
  "userId": 310701
 },
 "2349": {
  "id": 2349,
  "adType": "rent",
  "type": "building",
  "area": "1600.00",
  "price": "32000.00",
  "priceDisplay": "32,000.00 SAR",
  "coordinates": [
   24.721495567630665,
   46.76443021448973
  ],
  "numberOfRooms": 32,
  "status": "active",
  "isActive": true,
  "isReserved": false,
  "createdAt": "29 Jun 2026 - 09:15:50 AM",
  "licenseNumber": "7201022225",
  "licenseStartDate": "29 Jun 2026",
  "licenseExpiryDate": "28 Sep 2026",
  "deedNumber": "10989615627",
  "adTitle": "Building for rent",
  "adDescription": "استديو مؤثث بتصميم عصري وتشطيب فاخر، بحي الروضه مناسب للسكن الهادئ الراقي 👌\n​✨ المميزات:\n​أثاث جديد وفاخر\n​شاشة ذكية ٥٠ بوصه \n​ركن مطبخ مجهز بالكامل (ثلاجة + مايكروويف + غلاية)\n​إنترنت عالي السرعة\n​شامل كهرباء وماء وانترنت\n​خدمة صيانه دورية\n​موقع مميز وقريب من جميع الخدمات\nالاسعار من ٢٥٠٠ الى ٣٢٠٠ \n\n​Luxury Studio for Rent – Al Rawdah, Riyadh\n​Modern and stylish studio with a premium finish, perfect for comfortable and peaceful living 👌\n​✨ Features:\n​Fully furnished with high-quality furniture\n​Smart TV 50 inch\n​Fully equipped kitchen Corner (Fridge, Microwave, Kettle)\n​High-speed internet\n​Electricity & water included & Internet\n​Regular cleaning service\n​Prime location near all services\nThe price ranges from 2500 to 3200",
  "governmentData": [
   {
    "key": "adInfo",
    "label": "Ad information",
    "value": [
     {
      "key": "advertisementType",
      "label": "Ad purpose",
      "value": "إيجار"
     },
     {
      "key": "advertiserName",
      "label": "Ad contact name",
      "value": "شركة إيجو العقارية"
     },
     {
      "key": "phoneNumber",
      "label": "Ad contact mobile number",
      "value": "0538583001"
     },
     {
      "key": "adLicenseNumber",
      "label": "Ad license number",
      "value": "7201022225"
     },
     {
      "key": "endDate",
      "label": "License expiry date",
      "value": "28/09/2026"
     }
    ]
   },
   {
    "key": "propertyDetails",
    "label": "Property details",
    "value": [
     {
      "key": "propertyType",
      "label": "Property type",
      "value": "عمارة"
     },
     {
      "key": "propertyFace",
      "label": "Property frontage",
      "value": "شمالية شرقية"
     },
     {
      "key": "propertyPrice",
      "label": "Unit price",
      "value": 32000
     },
     {
      "key": "numberOfRooms",
      "label": "Number of rooms",
      "value": 32
     },
     {
      "key": "propertyArea",
      "label": "Property area",
      "value": 1600
     },
     {
      "key": "propertyAge",
      "label": "Property age",
      "value": "ثلاث سنوات"
     },
     {
      "key": "propertyUsages",
      "label": "Property usage",
      "value": "None"
     },
     {
      "key": "propertyUtilities",
      "label": "Property utilities",
      "value": "كهرباء, مياه, صرف صحي, ألياف ضوئية, تصريف الفيضانات "
     },
     {
      "key": "streetWidth",
      "label": "Street width",
      "value": 20
     },
     {
      "key": "rerConstraints",
      "label": "Real estate registry restrictions",
      "value": "None"
     },
     {
      "key": "obligationsOnTheProperty",
      "label": "Obligations on the property",
      "value": "لا يوجد"
     },
     {
      "key": "guaranteesAndTheirDuration",
      "label": "Guarantees and their duration",
      "value": ""
     }
    ]
   },
   {
    "key": "location",
    "label": "Location",
    "value": [
     {
      "key": "region",
      "label": "Region",
      "value": "منطقة الرياض"
     },
     {
      "key": "city",
      "label": "City",
      "value": "الرياض"
     },
     {
      "key": "district",
      "label": "District",
      "value": "الروضة"
     },
     {
      "key": "street",
      "label": "Street name",
      "value": "تميم بن أبي الفتوح"
     },
     {
      "key": "postalCode",
      "label": "Postal code",
      "value": "13211"
     },
     {
      "key": "buildingNumber",
      "label": "Building number",
      "value": "2920"
     },
     {
      "key": "additionalNumber",
      "label": "Additional number",
      "value": "6776"
     },
     {
      "key": "landNumber",
      "label": "Land parcel number",
      "value": null
     },
     {
      "key": "planNumber",
      "label": "Plan number",
      "value": null
     },
     {
      "key": "locationDescriptionOnMOJDeed",
      "label": "Property location description per the deed",
      "value": null
     }
    ]
   }
  ],
  "userId": 310207
 }
}""")


def rec(unit_id: int) -> dict:
    return json.loads(json.dumps(_CAPTURED[str(unit_id)]))      # a fresh copy per test


@pytest.fixture(autouse=True)
def _catalog(monkeypatch):
    """The location catalog is a DB table; these tests are about price/period/PDPL, so the two
    lookups are stubbed with the real city_ids and the real Arabic districts the live rows carry."""
    cities = {"جدة": (18, 2), "الخبر": (31, 5), "الطائف": (5, 2), "رياض الخبراء": (2467, 4),
              "الدمام": (13, 5), "تبوك": (1, 7), "أبها": (15, 6), "الرياض": (3, 1)}
    monkeypatch.setattr(E, "to_catalog", lambda c, hint=None: cities.get(c, (None, None)))
    monkeypatch.setattr(E, "find_district_in_text",
                        lambda raw, cid: f"حي {raw}" if raw and cid else None)


# ── 1. PRICE = SOURCE, even when the source's own integer overflowed ─────────────────────────────
def test_the_uint32_saturated_price_is_stored_exactly_as_published():
    """Id 2415: `price` "42949672.95" is the uint32 ceiling in halalas and the REGA block says
    656250000. The page SHOWS 42,949,672.95, so that is the number we store — the platform's error
    is not ours to substitute, null or repair."""
    row, category, why = E.map_listing(rec(2415))
    assert (row, why) != (None, why) or not why, why
    assert row is not None and why == ""
    assert row["price_total"] == 42949672, (
        "ego must store the price the platform itself publishes and shows (42949672), never the "
        f"other published figure 656250000 and never a repaired number — got {row['price_total']!r}")
    assert row["price_total"] != 656250000, "the REGA figure must not be substituted for the price"
    assert row["price_total"] is not None, (
        "nulling a source-published price because it looks implausible is the regression the "
        "standing rule names")
    assert row["price_evidence"]["raw"] == "42949672.95", "the raw string must survive as evidence"
    assert row["price_evidence"]["stored"] == 42949672
    assert row["price_evidence"]["unit"] == "total" and row["price_evidence"]["origin"] == "api"
    assert category == "residential"


def test_the_rega_figure_is_recorded_beside_ours_never_instead_of_ours():
    row, _, _ = E.map_listing(rec(2415))
    info = row["additional_info"]
    assert info["rega_unit_price"] == 656250000, "the other published number must stay auditable"
    assert info["source_price_raw"] == "42949672.95"
    assert info["source_price_display"] == "42,949,672.95 SAR"
    assert info["price_disagrees_with_rega"] is True, (
        "the ONE row where the platform's two published prices differ must be flagged, so a monitor "
        "can see OUR claim beside the source's other number without re-fetching")


def test_a_row_whose_two_published_prices_agree_is_not_flagged():
    # CONTROL: the flag must mean something. 2451 publishes 750000.00 and REGA 750000.
    row, _, _ = E.map_listing(rec(2451))
    assert row["price_total"] == 750000
    assert row["additional_info"].get("price_disagrees_with_rega") is None


@pytest.mark.parametrize("unit_id,price,area", [(2415, 42949672, 525), (2409, 560000, 625),
                                                (2357, 51150, 255), (2380, 60000, 300)])
def test_no_price_is_ever_divided_by_area(unit_id, price, area):
    """ego publishes ONE price per ad — there is no per-metre field in the 35 detail keys or the 27
    government keys. price_per_meter must therefore NEVER be written, land included. The bait is
    real: 2357's 51,150 / 255.75 AND 2380's 60,000 / 300 both come out at exactly 200.0, which looks
    like a published per-metre rate on two rows at once."""
    row, _, _ = E.map_listing(rec(unit_id))
    assert "price_per_meter" not in row or row["price_per_meter"] is None, (
        "ego has no per-metre price; writing one means it was DERIVED from price/area")
    assert row["area_m2"] == area
    stored = row.get("price_total") if row["transaction_type"] == "Buy" else row.get("price_annual")
    assert stored == price, "the stored figure must be the source's own, unscaled"


# ── 2. RENT PERIOD = SOURCE ──────────────────────────────────────────────────────────────────────
def test_two_periods_in_one_phrase_never_multiply_the_rent():
    """Id 2420: «شقق مجهزة للايجار شهري وسنوى» — monthly AND yearly in one breath, which states
    nothing about one price. Storing ×12 would publish 504,000 for a 42,000 listing."""
    row, _, why = E.map_listing(rec(2420))
    assert row is not None and why == ""
    assert row["price_annual"] == 42000, (
        f"a 42,000 rent became {row['price_annual']}: the ×12 ran on a listing that names two "
        f"periods at once")
    assert row.get("rent_period") is None, (
        "two periods in one phrase is not a period statement — rent_period must stay UNKNOWN")


def test_the_shared_parser_alone_would_have_stored_504000():
    """CONTROL — the defect is real, not theoretical. This is what the shared, audited parser
    returns on 2420's own verbatim text: it cannot see «سنوى» (alef maqsura), so it reads a lone
    «شهري». `_rent_fields` exists to stand in front of exactly this."""
    r = rec(2420)
    period, annual = normalize.rent_period_and_annual(42000, f"{r['adTitle']} {r['adDescription']}")
    assert (period, annual) == ("monthly", 504000), (
        "if the shared parser no longer does this, re-derive ego's gate from what it does now")


def test_a_daily_plus_monthly_summer_rate_keeps_the_published_price():
    """Id 2380: «للأجار الصيفي اليومي والشهري بالصيف». The shared parser returns (None, None) and
    would DISCARD the price; ego's field is not labelled with a period, so throwing the figure away
    would hide a source-published price. Period UNKNOWN, price verbatim."""
    row, _, why = E.map_listing(rec(2380))
    assert row is not None and why == ""
    assert row["price_annual"] == 60000, "the published 60,000 must survive"
    assert row.get("rent_period") is None


@pytest.mark.parametrize("unit_id,price", [(2392, 18000), (2357, 51150)])
def test_a_stated_annual_period_is_honoured_and_moves_no_number(unit_id, price):
    """«للإيجار السنوي» / «قيمة الإيجار السنوي» — the ad's own word. 'annual' converts nothing, so
    the price is stored exactly as published even though on BOTH of these the figure the prose
    prints (19,000 and 70،635) differs from the price field."""
    row, _, why = E.map_listing(rec(unit_id))
    assert row is not None and why == ""
    assert row["rent_period"] == "annual"
    assert row["price_annual"] == price, "an annual period must not move the number by even a riyal"


def test_rent_silence_leaves_the_period_null_and_the_price_untouched():
    """Id 2349: 732 characters of prose and not one period word. NEVER defaults to annual."""
    row, _, why = E.map_listing(rec(2349))
    assert row is not None and why == ""
    assert row.get("rent_period") is None
    assert row["price_annual"] == 32000


def test_each_of_the_two_rent_gates_is_load_bearing_on_its_own():
    """THE TWO GATES ARE REDUNDANT FOR ID 2420 AND MUST STILL BE PINNED SEPARATELY.

    Found by the mutant sweep: removing EITHER gate alone left the 2420 test green, because each
    catches that row by itself (tokens={شهري,سنوي} → the count gate; and the prose never prints
    42,000 → the corroboration gate). A guard that only ever fires behind another guard is
    unfalsifiable, so each is given its own input class here.

    Neither input has a live example today, so both are built from ego's OWN words rather than
    invented vocabulary: the first is the verbatim opening clause of 2420's description, the second
    is 2420's own two period words with the conjunction the other way round.
    """
    # ONLY THE CORROBORATION GATE STANDS HERE: one period, monthly, and the prose prints no figure.
    # Without it, 42,000 × 12 = 504,000 is stored for a 42,000 listing.
    one_monthly = "شقق مجهزة للايجار شهري"
    assert one_monthly in rec(2420)["adDescription"], "fixture drifted — this is 2420's own clause"
    assert E._rent_fields(42000, one_monthly) == (None, 42000), (
        "a monthly word with no corroborating figure must not multiply the stored price")
    # And it DOES convert when the prose states that very figure beside the word — the gate is not
    # a blanket refusal of every monthly listing.
    assert E._rent_fields(3500, "للايجار شهري 3500 ريال") == ("monthly", 42000)

    # ONLY THE COUNT GATE STANDS HERE: «سنوي» comes FIRST, so the shared parser returns
    # ('annual', price) — an identity conversion that sails past the corroboration gate. Two periods
    # in one phrase is not a period statement, whichever order the advertiser wrote them in.
    assert E._rent_fields(42000, "للايجار سنوى وشهري") == (None, 42000), (
        "an ad naming two periods must not be labelled with the one that happens to come first")
    # CONTROL: the same sentence with ONE period is honoured, so the gate counts rather than refuses.
    assert E._rent_fields(42000, "للايجار سنوى") == ("annual", 42000)


def test_the_corroboration_gate_reads_the_figure_the_prose_actually_prints():
    """The gate that would let a «شهري» multiply: the prose must print the very figure the price
    field holds. Exercised on verbatim prose, including the Arabic thousands comma «،» that id 2357's
    advertiser uses («70،635ريال»). No live row currently names a lone monthly period, so this is
    the unit-level guard for that branch; the end-to-end refusal is 2420 above."""
    d2392 = rec(2392)["adDescription"]
    hits = [m.start() for m in normalize._RENT_PERIOD_TOKEN_RE.finditer(d2392)]
    assert len(hits) == 2, "fixture drifted — 2392 says «سنوي» twice"
    # The SECOND «سنوي» is the one the advertiser wrote beside a figure: «💵 الإيجار: سنوي [19000]».
    assert E._states_figure_beside(d2392, 19000, hits[1]) is True, "the prose does print 19000"
    assert E._states_figure_beside(d2392, 18000, hits[1]) is False, (
        "18000 is the price FIELD's figure and the prose never prints it — an uncorroborated "
        "conversion must not be allowed to claim it")
    # The window is ±90 characters, so the opening «للإيجار السنوي» 300 chars earlier carries no
    # figure. This is exactly why `_rent_fields` checks EVERY occurrence, not just the first.
    assert E._states_figure_beside(d2392, 19000, hits[0]) is False
    d2357 = rec(2357)["adDescription"]
    at = normalize._RENT_PERIOD_TOKEN_RE.search(d2357).start()
    assert E._states_figure_beside(d2357, 70635, at) is True, "«70،635» must read as 70635"


def test_arabic_indic_digits_are_read_as_digits():
    """Trap that would make the corroboration gate blind: the fleet rule is that ٠-٩ parse
    everywhere. Exercised on the verbatim prose of 2451, which writes its area as «٣٤٤»."""
    assert "٣٤٤" in rec(2451)["adDescription"], "fixture drifted — 2451 writes Arabic-Indic digits"
    assert E._states_figure_beside("الإيجار ٢٣٬٠٠٠ ريال سنوي", 23000, 20) is True


# ── 3. PDPL ──────────────────────────────────────────────────────────────────────────────────────
def test_a_poisoned_record_leaks_no_contact_detail_anywhere():
    """The real 2451 record already carries `advertiserName` «عبير عبدالله صالح العطاوي» and
    `phoneNumber` «0557731494» inside governmentData, plus a phone and a wa.me link in its prose.
    On top of that it is poisoned with the shapes a future API version could add. Nothing may reach
    a column, additional_info or source_capture."""
    r = rec(2451)
    r["adDescription"] = (r["adDescription"] or "") + \
        " للتواصل 0555754441 واتساب https://wa.me/966555754441 broker@example.com"
    r["ownerPhone"] = "0501234567"
    r["agentName"] = "وكيل عقاري"
    r["contactEmail"] = "agent@example.com"
    r["governmentData"].append({"key": "extra", "label": "x", "value": [
        {"key": "advertiserName", "label": "Ad contact name", "value": "شخص آخر"},
        {"key": "phoneNumber", "label": "Ad contact mobile number", "value": "0509876543"},
        {"key": "whatsappLink", "label": "WhatsApp", "value": "https://wa.me/966509876543"}]})

    row, _, why = E.map_listing(r)
    assert row is not None and why == ""
    blob = json.dumps(row, ensure_ascii=False)
    for leak in ("0557731494", "0555754441", "0501234567", "0509876543", "wa.me", "whatsapp",
                 "@example.com", "عبير عبدالله صالح العطاوي", "وكيل عقاري", "شخص آخر",
                 "ownerPhone", "agentName", "contactEmail", "advertiserName", "phoneNumber"):
        assert leak not in blob, (
            f"PDPL: {leak!r} reached a stored payload. governmentData hides contact details as the "
            f"VALUE of a 'key' field, so only the _GOV_KEEP allowlist may read out of it.")
    assert "userId" not in blob and str(r.get("userId", "no-userid")) not in blob, \
        "the advertiser's account id is not ours to store"
    # And the listing CONTENT survived — a redactor that ate the row would pass the loop above.
    assert row["license_number"] == "7100320423", "the REGA licence must survive untouched"
    assert row["additional_info"]["deed_number"] == "932503016196", "the deed number must survive"
    assert row["plan_parcel"] == "153" and row["zip_code"] == "32266"
    assert row["description"] and "دوبلكس" in row["description"]


def test_the_advertisers_own_name_is_removed_from_the_prose_it_appears_in():
    """2 of 33 descriptions print the advertiser's name verbatim; the source hands us that exact
    string, so it is removed as a literal. Only the FULL literal — id 2416 shares one token with
    its advertiser's name and partial matching would mangle prose."""
    r = rec(2451)
    name = "عبير عبدالله صالح العطاوي"
    r["adDescription"] = f"شقة مميزة {name} للتواصل"
    row, _, _ = E.map_listing(r)
    assert name not in (row["description"] or "")
    assert "شقة مميزة" in row["description"], "the listing's own words must survive the removal"


def test_the_presigned_photo_signature_is_never_stored():
    """The published photo URLs are 12-hour S3 presignatures embedding an AWS access-key id. Stored
    verbatim they rot overnight and park a key id in our database; the bucket objects are public, so
    only the bare object URL is kept."""
    r = rec(2451)
    assert "X-Amz-Signature" in r["mainPhotoUrl"], "fixture drifted — the source presigns these"
    row, _, _ = E.map_listing(r)
    assert row["photo_urls"] == [
        "https://ego-aqar-bucket-production.s3.eu-west-1.amazonaws.com/units/2451/main.jpeg",
        "https://ego-aqar-bucket-production.s3.eu-west-1.amazonaws.com/units/2451/photo-0.jpeg",
        "https://ego-aqar-bucket-production.s3.eu-west-1.amazonaws.com/units/2451/photo-1.jpeg",
        "https://ego-aqar-bucket-production.s3.eu-west-1.amazonaws.com/units/2451/photo-2.jpeg"]
    blob = json.dumps(row, ensure_ascii=False)
    for secret in ("X-Amz-Signature", "X-Amz-Credential", "X-Amz-Expires", "AKIA"):
        assert secret not in blob, f"{secret} must never be stored"


# ── 4. TYPES, and the words that must NOT be guessed ─────────────────────────────────────────────
@pytest.mark.parametrize("unit_id,expected,category", [
    (2451, "Apartment", "residential"),
    (2415, "Residential Land", "residential"),
    (2409, "Residential Land", "residential"),
    (2420, "Apartment", "residential"),
    (2349, "Building", "residential"),
    (2380, "Villa", "residential"),
])
def test_the_type_slug_maps_through_the_platforms_own_arabic_table(unit_id, expected, category):
    row, cat, why = E.map_listing(rec(unit_id))
    assert row is not None and why == ""
    assert row["property_type"] == expected
    assert cat == category
    # The slug is what the mapper reads; the REGA block's own Arabic word is kept beside it as the
    # cross-check, and on all 33 live rows the two agree.
    assert row["additional_info"]["type_slug"] == rec(unit_id)["type"]
    assert row["additional_info"]["rega_property_type"] == E._TYPE_AR[rec(unit_id)["type"]]


def test_the_studio_type_survives_its_shadda_before_fatha():
    """ego writes «شقَّة صغيرة (استوديو)» with shadda BEFORE fatha — abaad's exact byte-order trap,
    where a hand-typed copy renders identically and compares UNEQUAL."""
    assert normalize.map_type_exact(E._TYPE_AR["studio"].translate(E._MARKS),
                                    E._TYPE_OVERRIDES) == "Studio"


@pytest.mark.parametrize("slug", ["station", "cinema", "teller", "school",
                                  "hospital-or-health-center", "telecom-tower"])
def test_a_type_with_no_safe_fleet_meaning_is_skipped_not_guessed(slug):
    """«محطة» is the abaad verdict: ego lists «محطة كهرباء» separately, so a bare station is not
    proven to be a fuel station. These skip with a counted reason rather than being mis-filed."""
    r = rec(2451)
    r["type"] = slug
    row, _, why = E.map_listing(r)
    assert row is None and why == f"type_unmapped_{slug}"


def test_an_unknown_slug_is_skipped_with_a_counted_reason():
    r = rec(2451)
    r["type"] = "spaceport"
    row, _, why = E.map_listing(r)
    assert row is None and why == "type_slug_unknown_spaceport"


# ── 5. THE SOURCE'S OWN MARKERS: auction, reserved, non-active ───────────────────────────────────
def test_an_auction_ad_is_skipped_with_a_counted_reason():
    """ego publishes ZERO auctions today («مزاد» appears in 0 of the 33 descriptions), so this is a
    forward-looking guard on a live record carrying the source's own auction word."""
    r = rec(2451)
    r["adDescription"] = "مزاد علني على العقار " + (r["adDescription"] or "")
    row, _, why = E.map_listing(r)
    assert row is None and why == "auction"


def test_a_reserved_or_non_active_unit_is_skipped_with_a_counted_reason():
    """`isReserved` is False and `status` "active" on all 33, so neither other value was ever
    observed — which is why an unexpected one skips (fail closed) instead of being mapped anyway."""
    r = rec(2451)
    r["isReserved"] = True
    assert E.map_listing(r)[2] == "reserved"
    r = rec(2451)
    r["status"] = "expired"
    assert E.map_listing(r)[2] == "status_expired"


def test_an_unknown_ad_type_is_never_parked_on_one_side_of_the_market():
    r = rec(2451)
    r["adType"] = "swap"
    row, _, why = E.map_listing(r)
    assert row is None and why == "deal_unknown_swap"


# ── 6. SOURCE IS TRUTH: absence is NULL, and "None" is absence ───────────────────────────────────
def test_the_four_character_string_None_is_an_absent_value():
    """The backend serialises Python None into the string "None" — `propertyUsages` on all 33 rows,
    `propertyAge` on 4. Stored verbatim that becomes the literal text "None" in a column."""
    row, _, _ = E.map_listing(rec(2415))
    assert rec(2415)["governmentData"][1]["value"][6]["value"] == "None", "fixture drifted"
    assert "property_usages" not in row["additional_info"]
    assert row["property_age"] is None
    assert "None" not in json.dumps({k: v for k, v in row.items()
                                     if k not in ("source_capture",)}, ensure_ascii=False)


def test_a_zero_street_width_is_not_a_width_and_the_raw_zero_is_kept():
    """14 of 33 publish streetWidth 0 and the page PRINTS «عرض الشارع 0». A 0-metre street is not a
    width, so the column stays NULL — and the raw 0 survives in additional_info, so nothing is
    hidden and the owner can reverse the reading from the stored row alone."""
    row, _, _ = E.map_listing(rec(2451))
    assert row["street_width_m"] is None
    assert row["additional_info"]["street_width_raw"] == 0


def test_no_bedroom_bathroom_or_hall_count_is_invented_from_total_rooms():
    """`numberOfRooms` is labelled «عدد الغرف» — TOTAL rooms (2349, a 1,600 m² building, says 32).
    ego publishes no bedroom count at all, so the column stays NULL and the number goes to
    additional_info."""
    row, _, _ = E.map_listing(rec(2349))
    for absent in ("bedrooms", "bathrooms", "halls", "reception_rooms_majlis", "master_bedrooms"):
        assert absent not in row, f"{absent} was invented — ego publishes no such count"
    assert row["additional_info"]["total_rooms"] == 32


def test_an_absent_amenity_is_null_never_false():
    """Utilities are positive-only. 2451 names كهرباء and مياه; صرف صحي and ألياف ضوئية are simply
    absent from its list and must not become False."""
    row, _, _ = E.map_listing(rec(2451))
    assert row["electricity"] is True and row["water_supply"] is True
    assert "sanitation" not in row and "optical_fibers" not in row
    assert row["additional_info"]["utility_words"] == ["كهرباء", "مياه"]


def test_a_multi_facing_property_has_no_single_direction():
    """2415 publishes «شرقية - غربية - جنوبية - شمالية». A property facing four ways has no one
    direction; the raw string is preserved."""
    row, _, _ = E.map_listing(rec(2415))
    assert "direction" not in row or row["direction"] is None
    assert row["additional_info"]["property_face_raw"] == "شرقية - غربية - جنوبية - شمالية"


def test_the_exact_area_survives_the_integer_column():
    row, _, _ = E.map_listing(rec(2451))
    assert row["area_m2"] == 344, "the column is INTEGER, so it rounds"
    assert row["additional_info"]["source_area_raw"] == "344.55", "the exact decimal must survive"


def test_the_listing_url_is_the_route_the_app_itself_uses():
    row, _, _ = E.map_listing(rec(2451))
    assert row["listing_url"] == "https://ego-aqar.com/unit-details/2451"
    assert row["ad_number"] == "EGO2451"


# ── 7. THE REMOVAL ORACLE ────────────────────────────────────────────────────────────────────────
@pytest.mark.parametrize("status,body,expected", [
    (200, '{"code":200,"data":{"id":2451,"adType":"sell"}}', "live"),
    (409, '{"code":409,"message":"This unit is inactive"}', "gone"),
    (404, '{"code":404,"message":"Not found"}', "gone"),
    # A 409 that does not SAY it is about the unit is not a statement about the unit.
    (409, '{"code":409,"message":"Conflict"}', None),
    (403, '{"message":"forbidden"}', None),
    (500, 'server error', None),
])
def test_the_measured_signal(status, body, expected):
    assert E._signal(status, body, False) == expected


def test_the_spa_shell_could_never_have_been_the_oracle():
    """The web route answers 200 with the SAME 1,892-byte shell for every id, fabricated ones
    included — so the oracle probes the API, and even if the shell were fetched it says nothing."""
    shell = ('<!doctype html><html><head><title>Ego Aqar</title>'
             '<meta name=description content="Ego Aqar web app">'
             '</head><body><div id=q-app></div></body></html>')
    assert E._signal(200, shell, False) is None


@pytest.mark.parametrize("status,body", [(403, "blocked"), (429, "slow down"), (503, "down"),
                                         (None, ""), (404, "")])
def test_the_shared_law_still_refuses_a_death_this_read_cannot_bear(status, body):
    """The law is not ego's to relax: a block, a throttle, a 5xx, no answer and an empty body can
    never carry a removal, whatever this platform's signal says."""
    assert read_is_unbelievable(status, body) is not None
    assert decide(status, body, False, lambda *_: "gone") is None


def test_a_probe_of_a_foreign_ad_number_is_unknown_never_a_kill():
    verdict, why = E._make_verify_gone(None)("WASALT123")
    assert verdict == "unknown" and "EGO" in why


def test_the_canary_withholds_a_removal_when_the_run_produced_no_control_row(monkeypatch):
    """A source that has stopped serving us real listings cannot testify that any one is gone. The
    read here is a clean 404 — the strongest 'gone' ego has — and it is STILL withheld because there
    is no positive control to ask. Fails closed. `fetch` is the seam the law's own docstring names;
    the law itself is never replaced."""
    import scrapers.common.http_liveness as L
    monkeypatch.setattr(L.LivenessProbe, "fetch",
                        lambda self, url: (404, '{"code":404,"message":"Not found"}', False))
    verdict, why = E._make_verify_gone(None)("EGO2451")
    assert verdict == "unknown", "a removal with no positive control must not be certified"
    assert "withheld" in why and "positive control" in why


def test_the_canary_lets_a_removal_through_when_the_source_is_still_serving(monkeypatch):
    """CONTROL: the canary must not block everything, or the oracle would never retire anything.
    The probed row 404s; the control row answers 200 with a unit, so the removal stands."""
    import scrapers.common.http_liveness as L

    def fake_fetch(self, url):
        if url.endswith("/2451"):
            return 200, '{"code":200,"data":{"id":2451}}', False
        return 404, '{"code":404,"message":"Not found"}', False

    monkeypatch.setattr(L.LivenessProbe, "fetch", fake_fetch)
    verdict, why = E._make_verify_gone({"ad_number": "EGO2451"})("EGO9999")
    assert verdict == "gone", why


# ── 8. THE ROW IS NOT VACUOUSLY SMALL ────────────────────────────────────────────────────────────
def test_the_mapper_is_still_doing_work():
    """Every assertion above would pass trivially on an empty row."""
    row, _, _ = E.map_listing(rec(2451))
    assert len(row) >= 25, f"only {len(row)} keys — the fixture stopped exercising the mapper"
    for essential in ("ad_number", "listing_url", "source", "property_type", "transaction_type",
                      "city_id", "region_id", "area_m2", "price_total", "license_number",
                      "photo_urls", "additional_info", "source_capture", "price_evidence"):
        assert essential in row, f"missing {essential}"
    assert row["source"] == "إيجو عقار"
