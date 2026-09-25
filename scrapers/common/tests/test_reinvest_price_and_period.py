"""ري إنفست (reinvest.sa) barriers: a DERIVED per-metre figure never becomes a price, and a «شهري»
in the prose never inflates a price it was not talking about.

THE TWO DEFECTS THIS EXISTS TO STOP, both measured on the live API 2026-09-24 over all 813 ads.

1. `selling_meter_price` LOOKS like the REGA «سعر المتر» a seller quotes, and it is not. It is
   present on 813/813 rows — flats, offices and warehouses, not just the 142 land ads — and it is
   exactly `floor(price / int(total_area))` on 813 of 813, with zero exceptions, checked against
   four candidate formulas. A scraper that filed it as `price_per_meter` would put the platform's own
   truncated quotient into a price column and, on land, make it look like a published rate. Same
   ruling as aqargate's `landTotalPrice` (rate × area, refused), read from the other end.
   `test_the_derived_meter_price_never_becomes_a_price_column` MUTATION-VERIFIED: adding
   `"price_per_meter": rec.get("selling_meter_price")` to run.map_listing's row literal makes that
   test fail with «LAND_RENT_223: price_per_meter=110 — that is floor(420750 / 3825) = 110, a
   truncated quotient the platform computed, not a rate any seller published»; removing it turns it
   green. No shared fleet suite catches this mutant — the AST guard in
   test_source_is_truth_fleet_invariants only fires when price_total and price_per_meter take the
   SAME bare name, which they do not here. That is why this test exists. The companion assertion re-derives the
   formula from the fixtures themselves, so the docstring's claim is executed rather than asserted.

2. THE PROSE PERIOD IS OFTEN ABOUT A DIFFERENT NUMBER. reinvest publishes no period field anywhere
   (all 18 `info_fields` keys + property_purpose + type_purpose enumerated over 813 rows). 80 of the
   577 rents carry «شهري» in their own text, and on most the structured `price` is ALREADY the annual
   figure while the prose names the monthly instalment: FLAT_107 publishes 54000 beside «الايجار
   4500 ريال شهري» (4500 × 12 = 54000), so a blind ×12 stores 648,000 for a 54,000 listing. On
   others the field really is the monthly rate and the source says so beside it (FLAT_103: price
   3000, «الايجار يبدء من 3000 شهري»). So a converting period is honoured only when the prose prints
   THE VERY FIGURE the price field holds, the ad names exactly ONE period, and the window is not
   about a payment split. Live outcome: 21 monthly, 47 annual, 508 UNKNOWN with the price verbatim.
   MUTATION-VERIFIED: replacing run._rent_fields' body with a bare
   `return normalize.rent_period_and_annual(price, text)` fails FIVE of these tests, and the mapper
   then stores price_annual=648000 / rent_period='monthly' for FLAT_107 (a 54,000 SAR listing) and
   price_annual=None for OFFICE_543. Restoring the shipped body turns all 26 green again.
     test_a_monthly_token_converts_only_when_it_describes_the_stored_figure
     test_a_daily_service_word_never_discards_a_published_price
     test_a_payment_split_is_not_a_lease_period
     test_two_periods_in_one_ad_pin_neither
     test_no_price_is_ever_multiplied_by_an_area

   That second failure is a defect of its own: 28 rent rows contain a يومي token that is «ضيافة
   يومية» / «نظافة يومية» — DAILY SERVICE on a serviced office, not a daily rate — and the shared
   normalize.rent_period_and_annual() returns (None, None) for يومي, which would NULL a real
   source-published price on all 28. run._rent_fields keeps the price. abaad reasoned its way to
   this rule with no row that hit the branch; reinvest supplies the rows that prove it.

PROVENANCE: every fixture below is copied VERBATIM from `GET https://api.reinvest.sa/api/v1/
real-estate/<slug>` captured 2026-09-24, trimmed to the keys the code reads — `info_fields` cut to
the measured spec keys (its duplicate `description` copy dropped), `images_info` cut to one entry,
and `amenities[].amenity` cut to {id, title, slug}. WAREHOUSE_288_PDPL additionally keeps its
advertiser/creator block VERBATIM, to prove none of it reaches a row. Exactly one shape is
SYNTHETIC and says so in its own test: the bid-priced ad, built by flipping
`price_type_label` on a real record to the platform's own «آخر عرض».

Every assertion runs the SHIPPING functions (run.map_listing, run._rent_fields, run.listing_path,
run._signal, run._slug_from_url). Only the two DB-backed location helpers are stubbed.
"""
from __future__ import annotations

import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

from scrapers.common import normalize  # noqa: E402
from scrapers.reinvest import run as R  # noqa: E402

# ── offline stand-ins for the only two DB-backed helpers ────────────────────────────────────────
_CATALOG = {"الرياض": (3, 1), "أبها": (8, 6)}
_DISTRICTS = {
    (3, "السلي"): "حي السلي", (3, "الفلاح"): "حي الفلاح", (3, "الوادي"): "حي الوادي",
    (3, "السويدي"): "حي السويدي", (3, "الرمال"): "حي الرمال", (3, "العليا"): "حي العليا",
    (3, "البرية"): "حي البرية", (3, "الندى"): "حي الندى", (8, "سلطانة"): "حي سلطانة",
}
R.to_catalog = lambda city_ar, region_hint=None: _CATALOG.get((city_ar or "").strip(), (None, None))
R.find_district_in_text = lambda text, city_id: _DISTRICTS.get((city_id, (text or "").strip()))

# ── VERBATIM live payloads (2026-09-24) ─────────────────────────────────────────────────────────
LAND_RENT_223 = {
 "id": 4571,
 "slug": "ard-llaygar-223",
 "ad_number": "9697308029",
 "license_number": "7200976483",
 "the_sub_type_of_ad": 18,
 "the_sub_type_of_ad_label": "إيجار",
 "the_sub_type_of_ad_slug": "for-rent",
 "type": "أرض",
 "main_usage": "تجاري",
 "real_state_type_slug": "lands",
 "city": "الرياض",
 "city_slug": "riyadh",
 "district": "السلي",
 "district_slug": "hy-alslymany-alshrky",
 "region": "منطقة الرياض",
 "price": 420750,
 "price_type_label": "سعر محدد",
 "selling_meter_price": 110,
 "total_area": 3825,
 "land_number": 1309021985100000,
 "info_fields": {
  "area": 3825,
  "street_count": 1,
  "street_width": 187
 },
 "amenities": [],
 "images_info": [
  {
   "type": "image/webp",
   "url": "https://axjnsouwsh1z.compat.objectstorage.me-riyadh-1.oraclecloud.com/bucket-aqaratic-prod/uploads/real_estate/20865/responsive-images/file_6a5394b0541a7102404167___images_1200_751.webp"
  }
 ],
 "video": None,
 "status": 2,
 "status_value": "منشور",
 "is_active": 1,
 "is_active_label": "معتمد",
 "is_draft": 0,
 "ad_type": 2,
 "ad_type_value": "إعلان مرخص",
 "published_at": "2026-08-02T15:21:09.000000Z",
 "title": "أرض للإيجار",
 "description": "اﳌﺴﺎﺣﺔ : 3,825 ﻣﱰ ﻣﺮﺑﻊ\r\nاﻟﻮاﺟﻬﺔ : ﴍﻗﻴﺔ - ﻏﺮﺑﻴﺔ\r\nﻋﻠﻲ ﺷﺎرﻋﲔ: )60ﻣﱰ - 30ﻣﱰ(\r\nﺑﻄﻮل 45ﻣﱰ و ﻋﻤﻖ 85ﻣﱰ\r\nاﳌﺮاﻓﻖ : 12 ﻏﺮﻓﺔ + 5 دورات ﻣﻴﺎة + ﻣﻄﺒﺦ\r\nاﻟﺨﺪﻣﺎت : ﻋﺪاد ﻣﻴﺎه + ﻋﺪاد ﻛﻬﺮﺑﺎء )60 اﻣﺒﲑ(\r\nاﻻﺷﱰاﻃﺎت : ﻳﺸﱰط ﺑﻨﺎء ﻣﺴﺘﻮدﻋﺎت ارﺗﻔﺎع اﻟﺠﻮاﻧﺐ ﻻ ﺗﻘﻞ ﻋﻦ 8 م - ﺳﻤﺎﻛﺔ اﻷرﺿﻴﺔ\r\n12ﺳﻢ ﻣﻊ ﺗﺮﻛﻴﺐ ﺷﺒﻚ - اﻟﺪﻓﺎع اﳌﺪﱐ ) ﺧﻄﻮرة ﻋﺎﻟﻴﺔ أو ﺧﻄﻮرة ﻣﺘﻮﺳﻄﺔ (\r\nﻣﺪة اﻻﻳﺠﺎر : 15 ﺳﻨﺔ\r\nاﳌﻮاﺻﻔﺎت اﻷﺧﺮى ﺣﺴﺐ ﻧﻈﺎم اﻟﻜﻮد اﻟﺴﻌﻮدي\r\nرﻗﻢ اﻟﻘﻄﻌﺔ : 117\r\nاﳌﻮﻗﻊ : ﺷﺎرع اﺑﻦ ﻣﺎﺟﺔ - ﺣﻲ اﻟﺴﻠﻲ"
}

FLAT_107_ANNUAL_FIELD = {
 "id": 4786,
 "slug": "shk-llaygar-107",
 "ad_number": "9463824700",
 "license_number": "7201057130",
 "the_sub_type_of_ad": 18,
 "the_sub_type_of_ad_label": "إيجار",
 "the_sub_type_of_ad_slug": "for-rent",
 "type": "شقة",
 "main_usage": "سكني",
 "real_state_type_slug": "apartment",
 "city": "الرياض",
 "city_slug": "riyadh",
 "district": "الفلاح",
 "district_slug": "al-falah",
 "region": "منطقة الرياض",
 "price": 54000,
 "price_type_label": "سعر محدد",
 "selling_meter_price": 46,
 "total_area": 1150,
 "land_number": 2528183066400000,
 "info_fields": {
  "area": 1150,
  "construction_period": 136,
  "bed_room_count": "1",
  "bathrooms": 1,
  "rooms_count": 1
 },
 "amenities": [
  {
   "amenity_id": 11,
   "amenity": {
    "id": 11,
    "title": "كهرباء",
    "slug": "khrbaaa"
   }
  },
  {
   "amenity_id": 18,
   "amenity": {
    "id": 18,
    "title": "صرف صحي",
    "slug": "srf-shy"
   }
  },
  {
   "amenity_id": 22,
   "amenity": {
    "id": 22,
    "title": "مياه",
    "slug": "myah"
   }
  }
 ],
 "images_info": [
  {
   "type": "image/webp",
   "url": "https://axjnsouwsh1z.compat.objectstorage.me-riyadh-1.oraclecloud.com/bucket-aqaratic-prod/uploads/real_estate/22028/responsive-images/file_6a7062976048b608281681___images_1200_918.webp"
  }
 ],
 "video": None,
 "status": 2,
 "status_value": "منشور",
 "is_active": 1,
 "is_active_label": "معتمد",
 "is_draft": 0,
 "ad_type": 2,
 "ad_type_value": "إعلان مرخص",
 "published_at": "2026-08-03T10:14:57.000000Z",
 "title": "شقة للإيجار",
 "description": "شقق فاخرة للإيجار بحي الفلاح\r\nأسعار منافسة مع مميزات عديدة في الشقق \r\n🔹المميزات:\r\n1-العقار قريب جداًمن جامعة دار العلوم\r\n2-شقق فاخرة بديكورات مميزة\r\n3-موقع مميز وقريب من الشوارع الرئيسية (عثمان بن عفان وحطة مترو سابك ومحطه متر عثمان بن عفان\r\n4-قريب من الخدمات (المدارس – المساجد – الأسواق – المطاعم....) .\r\n5-مكيفات راكبة\r\n6- مطبخ راكب\r\n7-يوجد مصعد\r\n8-شقق مؤثثة\r\n9-يوجد استقبال وخدمة نظافه علي مدار الساعه\r\n10-يوجد أنترنت فائق السرعه\r\n11-يوجد كاميرات مراقبه\r\n🔹الوصف:\r\nغرفة و حمام ومطبخ مفروش\r\n🔹الايجار 4500 ريال شهري\r\nالايجار يشمل الكهرباء والماء والانترنت"
}

FLAT_103_MONTHLY_FIELD = {
 "id": 4768,
 "slug": "shk-llaygar-103",
 "ad_number": "8300384786",
 "license_number": "7200838570",
 "the_sub_type_of_ad": 18,
 "the_sub_type_of_ad_label": "إيجار",
 "the_sub_type_of_ad_slug": "for-rent",
 "type": "شقة",
 "main_usage": "سكني",
 "real_state_type_slug": "apartment",
 "city": "الرياض",
 "city_slug": "riyadh",
 "district": "الوادي",
 "district_slug": "al-wadi",
 "region": "منطقة الرياض",
 "price": 3000,
 "price_type_label": "سعر محدد",
 "selling_meter_price": 3,
 "total_area": 1000,
 "land_number": 5459503951700000,
 "info_fields": {
  "area": 1000,
  "construction_period": 138,
  "bed_room_count": "1",
  "bathrooms": 1,
  "rooms_count": 1
 },
 "amenities": [
  {
   "amenity_id": 11,
   "amenity": {
    "id": 11,
    "title": "كهرباء",
    "slug": "khrbaaa"
   }
  },
  {
   "amenity_id": 18,
   "amenity": {
    "id": 18,
    "title": "صرف صحي",
    "slug": "srf-shy"
   }
  },
  {
   "amenity_id": 22,
   "amenity": {
    "id": 22,
    "title": "مياه",
    "slug": "myah"
   }
  }
 ],
 "images_info": [
  {
   "type": "image/webp",
   "url": "https://axjnsouwsh1z.compat.objectstorage.me-riyadh-1.oraclecloud.com/bucket-aqaratic-prod/uploads/real_estate/21939/responsive-images/file_6a6f30c3516cf074531727___images_1200_1433.webp"
  }
 ],
 "video": None,
 "status": 2,
 "status_value": "منشور",
 "is_active": 1,
 "is_active_label": "معتمد",
 "is_draft": 0,
 "ad_type": 2,
 "ad_type_value": "إعلان مرخص",
 "published_at": "2026-08-02T11:59:01.000000Z",
 "title": "شقة للإيجار",
 "description": "شقق فاخرة للإيجار بحي الوادي\r\nأسعار منافسة مع مميزات عديدة في الشقق\r\n🔹المميزات:\r\n1-العقار قريب جداًمن جامعة الامام\r\n2-شقق فاخرة بديكورات مميزة\r\n3-موقع مميز وقريب من الشوارع الرئيسية (طريق ابي بكر الصديق..)\r\n4-قريب من الخدمات (المدارس – المساجد – الأسواق – المطاعم....) .\r\n5-مكيفات راكبة\r\n6- مطبخ راكب\r\n🔹الوصف:\r\nغرفة وحمام ومطبخ\r\n🔹الايجار يبدء من 3000 شهري"
}

OFFICE_543_DAILY_SERVICE = {
 "id": 4708,
 "slug": "mktb-llaygar-543",
 "ad_number": "1947354414",
 "license_number": "7201049574",
 "the_sub_type_of_ad": 18,
 "the_sub_type_of_ad_label": "إيجار",
 "the_sub_type_of_ad_slug": "for-rent",
 "type": "مكتب",
 "main_usage": "تجاري",
 "real_state_type_slug": "offices",
 "city": "الرياض",
 "city_slug": "riyadh",
 "district": "السويدي",
 "district_slug": "al-suwaidi",
 "region": "منطقة الرياض",
 "price": 1000,
 "price_type_label": "سعر محدد",
 "selling_meter_price": 0,
 "total_area": 9000,
 "land_number": 20895740573,
 "info_fields": {
  "area": 9000,
  "construction_period": 136
 },
 "amenities": [
  {
   "amenity_id": 11,
   "amenity": {
    "id": 11,
    "title": "كهرباء",
    "slug": "khrbaaa"
   }
  },
  {
   "amenity_id": 18,
   "amenity": {
    "id": 18,
    "title": "صرف صحي",
    "slug": "srf-shy"
   }
  },
  {
   "amenity_id": 21,
   "amenity": {
    "id": 21,
    "title": "هاتف",
    "slug": "hatf"
   }
  },
  {
   "amenity_id": 22,
   "amenity": {
    "id": 22,
    "title": "مياه",
    "slug": "myah"
   }
  }
 ],
 "images_info": [
  {
   "type": "image/webp",
   "url": "https://axjnsouwsh1z.compat.objectstorage.me-riyadh-1.oraclecloud.com/bucket-aqaratic-prod/uploads/real_estate/21593/responsive-images/file_6a68e92d68324852123001___images_1200_802.webp"
  }
 ],
 "video": None,
 "status": 2,
 "status_value": "منشور",
 "is_active": 1,
 "is_active_label": "معتمد",
 "is_draft": 0,
 "ad_type": 2,
 "ad_type_value": "إعلان مرخص",
 "published_at": "2026-07-29T08:16:40.000000Z",
 "title": "مكتب للإيجار",
 "description": "مكاتب مؤثثة ومجهزة بالكامل للإيجار في حي السويدي\r\n\r\nباشر عملك دون انتظار في بيئة مريحة وعملية تجمع بين المرونة والكفاءة.\r\n\r\nالمميزات الأساسية:\r\n- جاهزية كاملة: أثاث حديث، مكاتب مستقلة وحلول افتراضية.\r\n- تأسيس سريع: إصدار فوري للرخص البلدية والعنوان الوطني\r\n- دعم لوجستي: ألياف بصرية، قاعات اجتماعات، وضيافة يومية.\r\n- خدمات إضافية: صالة استراحة ومواقف سيارات مريحة.\r\n\r\n📍 مواقعنا - العارض - الروضة - السويدي"
}

STUDIO_7_TASHKEEL = {
 "id": 4877,
 "slug": "shk-sghyr-astodyo-llaygar-7",
 "ad_number": "8317507953",
 "license_number": "7200967241",
 "the_sub_type_of_ad": 18,
 "the_sub_type_of_ad_label": "إيجار",
 "the_sub_type_of_ad_slug": "for-rent",
 "type": "شقَّة صغيرة (استوديو)",
 "main_usage": "سكني",
 "real_state_type_slug": "studio-apartments",
 "city": "الرياض",
 "city_slug": "riyadh",
 "district": "الرمال",
 "district_slug": "ar-rimal",
 "region": "منطقة الرياض",
 "price": 21600,
 "price_type_label": "سعر محدد",
 "selling_meter_price": 720,
 "total_area": 30,
 "land_number": 10679012119,
 "info_fields": {
  "area": 30,
  "construction_period": 136,
  "bed_room_count": "1",
  "bathrooms": 1,
  "rooms_count": 1
 },
 "amenities": [
  {
   "amenity_id": 11,
   "amenity": {
    "id": 11,
    "title": "كهرباء",
    "slug": "khrbaaa"
   }
  },
  {
   "amenity_id": 18,
   "amenity": {
    "id": 18,
    "title": "صرف صحي",
    "slug": "srf-shy"
   }
  },
  {
   "amenity_id": 22,
   "amenity": {
    "id": 22,
    "title": "مياه",
    "slug": "myah"
   }
  }
 ],
 "images_info": [
  {
   "type": "image/webp",
   "url": "https://axjnsouwsh1z.compat.objectstorage.me-riyadh-1.oraclecloud.com/bucket-aqaratic-prod/uploads/real_estate/22443/responsive-images/file_6a7da0927d125197084018___images_1200_1600.webp"
  }
 ],
 "video": None,
 "status": 2,
 "status_value": "منشور",
 "is_active": 1,
 "is_active_label": "معتمد",
 "is_draft": 0,
 "ad_type": 2,
 "ad_type_value": "إعلان مرخص",
 "published_at": "2026-08-13T10:53:58.000000Z",
 "title": "شقَّة صغيرة (استوديو) للإيجار",
 "description": "غرفة للإيجار الشهري\r\nغرفة\r\nمطبخ\r\nدورة مياه\r\n\r\nيوجد مكيف\r\nيوجد سخان\r\nشامل الماء والكهرباء\r\nمناسبة للعزاب السعوديين\r\nموقع هادئ وسكن مريح\r\n\r\nالإيجار الشهري : 1800 ريال فقط"
}

FLAT_190_PAYMENT_SPLIT = {
 "id": 5115,
 "slug": "shk-llaygar-190",
 "ad_number": "1031589646",
 "license_number": "7201070580",
 "the_sub_type_of_ad": 18,
 "the_sub_type_of_ad_label": "إيجار",
 "the_sub_type_of_ad_slug": "for-rent",
 "type": "شقة",
 "main_usage": "سكني",
 "real_state_type_slug": "apartment",
 "city": "أبها",
 "city_slug": "abha",
 "district": "سلطانة",
 "district_slug": "sultanah",
 "region": "منطقة عسير",
 "price": 40000,
 "price_type_label": "سعر محدد",
 "selling_meter_price": 90,
 "total_area": 441.5,
 "land_number": 460001025706,
 "info_fields": {
  "area": 441,
  "construction_period": 147,
  "bed_room_count": "1",
  "bathrooms": 2,
  "rooms_count": 3
 },
 "amenities": [
  {
   "amenity_id": 11,
   "amenity": {
    "id": 11,
    "title": "كهرباء",
    "slug": "khrbaaa"
   }
  },
  {
   "amenity_id": 18,
   "amenity": {
    "id": 18,
    "title": "صرف صحي",
    "slug": "srf-shy"
   }
  },
  {
   "amenity_id": 22,
   "amenity": {
    "id": 22,
    "title": "مياه",
    "slug": "myah"
   }
  }
 ],
 "images_info": [
  {
   "type": "image/webp",
   "url": "https://axjnsouwsh1z.compat.objectstorage.me-riyadh-1.oraclecloud.com/bucket-aqaratic-prod/uploads/real_estate/23927/responsive-images/file_6aa91bdd81435553320327___images_1200_1200.webp"
  }
 ],
 "video": None,
 "status": 2,
 "status_value": "منشور",
 "is_active": 1,
 "is_active_label": "معتمد",
 "is_draft": 0,
 "ad_type": 2,
 "ad_type_value": "إعلان مرخص",
 "published_at": "2026-09-15T11:51:26.000000Z",
 "title": "شقة للإيجار",
 "description": "شقة مؤثثة للإيجار – أبها - مدينة سلطان\r\nلتجربة معيشية في قلب الطبيعة.\r\nشقة للإيجار في موقع مميز بالقرب من المسجد، لتستمتع بالأجواء العليلة، والطبيعة الساحرة، وهدوء الحياة الذي تتميز به المدينة.\r\n\r\nتتكون من:\r\nغرفة نوم\r\nمجلس\r\nمقلط\r\nصالة\r\nمطبخ\r\n2 دورات مياه\r\n\r\nالمميزات:\r\nتبعد عن مطار أبها تقريبًا 10 دقائق\r\nمدخلين\r\nمطبخ راكب متكامل\r\nمكيفات راكبة\r\nبالقرب من مدارس البنين والبنات\r\nبالقرب من حديقة الحي وجميع الخدمات\r\nبالقرب من مساجد جامعَين\r\n\r\nقيمة الإيجار: 40,000 ألف دفعة أو دفعتين أو شهري"
}

COMPLEX_10_UNMAPPED = {
 "id": 4933,
 "slug": "mgmaa-llbyaa-10",
 "ad_number": "4675337085",
 "license_number": "7201030053",
 "the_sub_type_of_ad": 17,
 "the_sub_type_of_ad_label": "بيع",
 "the_sub_type_of_ad_slug": "for-sale",
 "type": "مجمع",
 "main_usage": "تجاري",
 "real_state_type_slug": "centers",
 "city": "الرياض",
 "city_slug": "riyadh",
 "district": "العليا",
 "district_slug": "al-olaya",
 "region": "منطقة الرياض",
 "price": 21000000,
 "price_type_label": "سعر محدد",
 "selling_meter_price": 8403,
 "total_area": 2499.84,
 "land_number": 7587721522600000,
 "info_fields": {
  "area": 2499,
  "construction_period": 148,
  "rental_space": 2499
 },
 "amenities": [
  {
   "amenity_id": 11,
   "amenity": {
    "id": 11,
    "title": "كهرباء",
    "slug": "khrbaaa"
   }
  },
  {
   "amenity_id": 18,
   "amenity": {
    "id": 18,
    "title": "صرف صحي",
    "slug": "srf-shy"
   }
  },
  {
   "amenity_id": 22,
   "amenity": {
    "id": 22,
    "title": "مياه",
    "slug": "myah"
   }
  }
 ],
 "images_info": [
  {
   "type": "image/webp",
   "url": "https://axjnsouwsh1z.compat.objectstorage.me-riyadh-1.oraclecloud.com/bucket-aqaratic-prod/uploads/real_estate/22732/responsive-images/file_6a859d5dc2a1a708787760___images_1200_808.webp"
  }
 ],
 "video": "https://axjnsouwsh1z.compat.objectstorage.me-riyadh-1.oraclecloud.com/bucket-aqaratic-prod/uploads/real_estate/22731/file_6a859d3ee8a19276915455.mp4",
 "status": 2,
 "status_value": "منشور",
 "is_active": 1,
 "is_active_label": "معتمد",
 "is_draft": 0,
 "ad_type": 2,
 "ad_type_value": "إعلان مرخص",
 "published_at": "2026-08-19T12:14:23.000000Z",
 "title": "مجمع للبيع",
 "description": "فرصة استثمارية نادرة في قلب حي العُليا – مجمع سكني على 3 شوارع\r\n\r\nموقع استراتيجي من أقوى المواقع الاستثمارية في مدينة الرياض، مناسب للمطورين العقاريين والمستثمرين الباحثين عن أرض ذات قيمة عالية وإمكانية تطوير متميزة.\r\n\r\nالموقع – حي العُليا\r\nيتميز بقربه من أهم المحاور والخدمات، ومنها:\r\n✅ مدينة الملك فهد الطبية\r\n✅ المستشفى العسكري\r\n✅ شارع الضباب\r\n✅ طريق العُليا\r\n✅ طريق الملك فهد\r\n✅ طريق خريص\r\n✅ الوزارات والجهات الحكومية\r\n✅ منطقة أعمال وتجارية ذات طلب مرتفع على السكن والاستثمار.\r\n\r\nتفاصيل العقار\r\n▪️ نوع العقار: مجمع سكني ( يحتاج هدم )\r\n▪️ المساحة: 2,499.84 م²\r\n▪️ الحي: العليا – الرياض\r\n▪️ العمر: حوالي 40 سنة\r\n▪️ الحالة: المجمع خالي ولا يوجد به سكان\r\n\r\nعلى ثلاثة شوارع\r\n🔹 جنوباً: شارع 20م بطول 40.32م\r\n🔹 شمالاً: شارع 16م بطول 40.32م\r\n🔹 غرباً: شارع 16م بطول 62م\r\n🔹 شرقاً: يحده العقار رقم 2574.\r\n\r\nلماذا يعتبر فرصة استثمارية؟\r\nموقع من أقوى المواقع في العليا.\r\n\r\nمناسب لإعادة تطوير المشروع إلى شقق فاخرة أو مجمع سكني حديث أو مشروع استثماري نوعي.\r\nقربه من المستشفيات والوزارات ومراكز الأعمال\r\n\r\nالسوم : 6000 ﷼ للمتر\r\n\r\nالموقع :\r\nhttps://maps.app.goo.gl/awTwPdgG55q8cxmy6?g_st=ic\r\n\r\nبروشور العرض :\r\nhttps://olayainvest-7dig5cvy.manus.space/"
}

WAREHOUSE_288_PDPL = {
 "id": 5055,
 "slug": "mstodaa-llaygar-288",
 "ad_number": "1724587210",
 "license_number": "7200897769",
 "the_sub_type_of_ad": 18,
 "the_sub_type_of_ad_label": "إيجار",
 "the_sub_type_of_ad_slug": "for-rent",
 "type": "مستودع",
 "main_usage": "تجاري",
 "real_state_type_slug": "warehouses",
 "city": "الرياض",
 "city_slug": "riyadh",
 "district": "البرية",
 "district_slug": "al-bariyah",
 "region": "منطقة الرياض",
 "price": 256020,
 "price_type_label": "سعر محدد",
 "selling_meter_price": 169,
 "total_area": 1507,
 "land_number": 20425424425,
 "info_fields": {
  "area": 1507,
  "street_width": 185,
  "construction_period": 136,
  "real_estate_facade_id": 156,
  "has_worker_accommodation": 21
 },
 "amenities": [
  {
   "amenity_id": 11,
   "amenity": {
    "id": 11,
    "title": "كهرباء",
    "slug": "khrbaaa"
   }
  },
  {
   "amenity_id": 22,
   "amenity": {
    "id": 22,
    "title": "مياه",
    "slug": "myah"
   }
  }
 ],
 "images_info": [
  {
   "type": "image/webp",
   "url": "https://axjnsouwsh1z.compat.objectstorage.me-riyadh-1.oraclecloud.com/bucket-aqaratic-prod/uploads/real_estate/23531/responsive-images/file_6a9e6cf21454f196973203___images_1200_1600.webp"
  }
 ],
 "video": None,
 "status": 2,
 "status_value": "منشور",
 "is_active": 1,
 "is_active_label": "معتمد",
 "is_draft": 0,
 "ad_type": 2,
 "ad_type_value": "إعلان مرخص",
 "published_at": "2026-09-07T07:52:14.000000Z",
 "title": "مستودع للإيجار",
 "description": "مستودع للإيجار | حي البرية – الرياض\r\n\r\nفرصة مميزة للأنشطة التجارية والتخزينية في موقع حيوي بحي البرية، بمساحة 1,346 م² وتصنيف خطورة متوسطة.\r\n\r\nالمميزات:\r\n• المساحة: 1,346 م²\r\n• خطورة متوسطة\r\n• مساحة واسعة مناسبة للتخزين والتشغيل\r\n• موقع مميز في حي البرية\r\n• خيار مناسب للأنشطة التجارية واللوجستية والتخزينية\r\n\r\nللتواصل والاستفسار مع فريق المبيعات:\r\n920015243\r\n0555434487\r\n0541775599\r\n0533138777\r\n0543337060\r\n0508033359",
 "advertiser_name": "شركة المشرق للأستثمار",
 "advertiser_phone": "531195228",
 "advertiser_email": "i.alammari@almasharaq-sa.com",
 "contact_number": "+966555434487",
 "creator": {
  "id": 5401,
  "name": "ابراهيم عبدالله ابراهيم العماري",
  "image": "https://axjnsouwsh1z.compat.objectstorage.me-riyadh-1.oraclecloud.com/bucket-aqaratic-prod/customers/VKHjmX15RJ4mb3OIVKqWsDye570lDYjghO6xCCVg.png",
  "mobile": "531195228",
  "member_type": 192,
  "member_type_value": "وسيط"
 },
 "member_type": None,
 "average_rating": 0,
 "average_rating_creator": 0,
 "authorization_no": "7200897769",
 "current_rent_price": None,
 "is_rented": 0,
 "is_negotiable": 0,
 "remaining_month": None,
 "card_label": "مميز",
 "sub_usages": [
  {
   "id": 1,
   "name": "صناعي"
  }
 ],
 "usage": "تجاري",
 "usage_id": 2,
 "property_purpose": "عقارات لـإيجار"
}

FLAT_105_ANNUAL_STATED = {
 "id": 4784,
 "slug": "shk-llaygar-105",
 "ad_number": "3073092470",
 "license_number": "7200975066",
 "the_sub_type_of_ad": 18,
 "the_sub_type_of_ad_label": "إيجار",
 "the_sub_type_of_ad_slug": "for-rent",
 "type": "شقة",
 "main_usage": "سكني",
 "real_state_type_slug": "apartment",
 "city": "الرياض",
 "city_slug": "riyadh",
 "district": "الندى",
 "district_slug": "an-nada",
 "region": "منطقة الرياض",
 "price": 70000,
 "price_type_label": "سعر محدد",
 "selling_meter_price": 208,
 "total_area": 336,
 "land_number": 310126000193,
 "info_fields": {
  "area": 336,
  "construction_period": 143,
  "bed_room_count": "1",
  "bathrooms": 1,
  "rooms_count": 3
 },
 "amenities": [
  {
   "amenity_id": 11,
   "amenity": {
    "id": 11,
    "title": "كهرباء",
    "slug": "khrbaaa"
   }
  },
  {
   "amenity_id": 18,
   "amenity": {
    "id": 18,
    "title": "صرف صحي",
    "slug": "srf-shy"
   }
  },
  {
   "amenity_id": 22,
   "amenity": {
    "id": 22,
    "title": "مياه",
    "slug": "myah"
   }
  }
 ],
 "images_info": [
  {
   "type": "image/webp",
   "url": "https://axjnsouwsh1z.compat.objectstorage.me-riyadh-1.oraclecloud.com/bucket-aqaratic-prod/uploads/real_estate/22013/responsive-images/file_6a703f02c5eb2934662678___images_1200_1934.webp"
  }
 ],
 "video": None,
 "status": 2,
 "status_value": "منشور",
 "is_active": 1,
 "is_active_label": "معتمد",
 "is_draft": 0,
 "ad_type": 2,
 "ad_type_value": "إعلان مرخص",
 "published_at": "2026-08-03T07:18:01.000000Z",
 "title": "شقة للإيجار",
 "description": "شقة للايجار في حي الندى شارع ابيان 20 م واجهة شمالية ملحق في فيلا مفروش ٣ غرف نوم وصالة ومجلس مطبخ راكب مكيف تكييف شباك فيه غسالة وفرن وثلاجة ومكرويف وماكينة قهوة مكيفات شباك راكبة وسطح وخيمة مفروشة مدخل مشترك عداد كهرباء مستقل\r\nايجار 70000 سنوي"
}

ALL_FIXTURES = {
    "LAND_RENT_223": LAND_RENT_223,
    "FLAT_107_ANNUAL_FIELD": FLAT_107_ANNUAL_FIELD,
    "FLAT_103_MONTHLY_FIELD": FLAT_103_MONTHLY_FIELD,
    "OFFICE_543_DAILY_SERVICE": OFFICE_543_DAILY_SERVICE,
    "STUDIO_7_TASHKEEL": STUDIO_7_TASHKEEL,
    "FLAT_190_PAYMENT_SPLIT": FLAT_190_PAYMENT_SPLIT,
    "WAREHOUSE_288_PDPL": WAREHOUSE_288_PDPL,
    "FLAT_105_ANNUAL_STATED": FLAT_105_ANNUAL_STATED,
}


def _row(rec: dict) -> dict:
    row, _cat, why = R.map_listing(rec)
    assert row, f"the fixture must map, or the test proves nothing (skip reason: {why!r})"
    return row


# ── 1. THE CORE PRICE GUARD (mutation-verified — see the module docstring) ───────────────────────
def test_the_derived_meter_price_never_becomes_a_price_column():
    """`selling_meter_price` is the platform's own floor(price / area). It may not be stored as one.

    MUTATION-VERIFIED: adding `row["price_per_meter"] = rec.get("selling_meter_price")` to
    run.map_listing makes this fail on LAND_RENT_223 (price_per_meter=110 for a 420,750 SAR lease)
    and on all eight fixtures; removing it again turns it green.
    """
    for name, rec in ALL_FIXTURES.items():
        row = _row(rec)
        assert "price_per_meter" not in row, (
            f"{name}: price_per_meter={row['price_per_meter']} — that is "
            f"floor({rec['price']} / {int(rec['total_area'])}) = {rec['selling_meter_price']}, a "
            f"truncated quotient the platform computed, not a rate any seller published"
        )
        archived = row["additional_info"].get("platform_derived_meter_price")
        assert archived == rec["selling_meter_price"], (
            f"{name}: the derived figure must still be ARCHIVED as provenance, not dropped"
        )


def test_the_derivation_claim_is_true_of_these_very_fixtures():
    """The docstring says selling_meter_price == floor(price / int(total_area)) on 813/813 rows.
    Re-derive it here so the claim is EXECUTED, not merely asserted in prose. If a future capture
    breaks the identity, the rule that price_per_meter stays NULL needs re-measuring, not patching."""
    for name, rec in ALL_FIXTURES.items():
        expected = math.floor(rec["price"] / int(rec["total_area"]))
        assert rec["selling_meter_price"] == expected, (
            f"{name}: selling_meter_price={rec['selling_meter_price']} but "
            f"floor({rec['price']}/{int(rec['total_area'])})={expected} — the field may no longer be "
            f"derived, so re-measure before trusting it either way"
        )


def test_a_land_lease_stores_the_published_total_not_the_per_metre_figure():
    """LAND_RENT_223 publishes price 420,750 and selling_meter_price 110 for 3,825 m². Storing 110
    would advertise a 3,825 m² plot at 110 riyals — the aqargate AG55663 / hajer HJ3107 defect."""
    row = _row(LAND_RENT_223)
    assert row["price_annual"] == 420750
    assert row["property_type"] == "Residential Land"
    assert "price_total" not in row, "a RENT has no sale total"
    assert row["price_evidence"]["field"] == "price"
    assert row["price_evidence"]["raw"] == 420750
    assert row["price_evidence"]["unit"] == "total"


def test_no_price_is_ever_multiplied_by_an_area():
    """Every stored price must be a figure the source printed, for every fixture."""
    for name, rec in ALL_FIXTURES.items():
        row = _row(rec)
        stored = row.get("price_total") if row["transaction_type"] == "Buy" else row["price_annual"]
        published = rec["price"]
        assert stored in (published, published * 12), (
            f"{name}: stored {stored}, but the source published {published} (×12 is the schema's "
            f"documented annualisation and the only conversion allowed)"
        )


# ── 2. RENT PERIOD = SOURCE ──────────────────────────────────────────────────────────────────────
def test_a_silent_rent_period_stays_unknown_and_the_price_is_untouched():
    """LAND_RENT_223's text names no period at all (its «مدة الايجار : 15 سنة» is a LEASE TERM, not
    a rent period — «سنة» is not one of the parser's period tokens). 508 of 577 live rents are this
    shape. rent_period NULL keeps them out of period-scoped rent search, which is correct."""
    row = _row(LAND_RENT_223)
    assert "rent_period" not in row, "silence is UNKNOWN, never a default"
    assert row["price_annual"] == 420750, "the published figure must survive an unknown period"


def test_a_stated_annual_period_is_honoured_because_it_converts_nothing():
    """FLAT_105 prints «ايجار 70000 سنوي». 'annual' stores the figure verbatim, so no number can
    move and no corroboration is needed."""
    row = _row(FLAT_105_ANNUAL_STATED)
    assert row["rent_period"] == "annual"
    assert row["price_annual"] == 70000 == FLAT_105_ANNUAL_STATED["price"]


def test_a_monthly_token_converts_only_when_it_describes_the_stored_figure():
    """The platform's hardest trap, both directions, from two real ads.

    MUTATION-VERIFIED: replacing run._rent_fields' body with a bare
    `return normalize.rent_period_and_annual(price, text)` stores 648,000 on FLAT_107.
    """
    # NOT corroborated: the field is already annual and the prose names the instalment.
    # «🔹الايجار 4500 ريال شهري» beside a price field of 54000, and 4500 × 12 == 54000.
    row = _row(FLAT_107_ANNUAL_FIELD)
    assert "rent_period" not in row, (
        "«شهري» printed beside 4500 says nothing about the 54000 in the price field"
    )
    assert row["price_annual"] == 54000, (
        f"price_annual={row['price_annual']} — 54000 was the published figure; ×12 would have "
        f"stored 648000 for a listing whose own text says 4500 a month"
    )

    # CORROBORATED: «🔹الايجار يبدء من 3000 شهري» and the price field holds exactly 3000.
    row = _row(FLAT_103_MONTHLY_FIELD)
    assert row["rent_period"] == "monthly"
    assert row["price_annual"] == 36000 == FLAT_103_MONTHLY_FIELD["price"] * 12, (
        "the source states this very figure is monthly, so the schema's ×12 annualisation applies "
        "and dividing by 12 for display returns exactly the 3000 the source printed"
    )


def test_a_daily_service_word_never_discards_a_published_price():
    """OFFICE_543 is a serviced office whose text says «ضيافة يومية» — DAILY HOSPITALITY. 28 live
    rent rows are this shape. normalize.rent_period_and_annual() returns (None, None) for a يومي
    token, which is right for a platform whose price field IS labelled daily and would here erase a
    real published price over a word about cleaning.

    MUTATION-VERIFIED: a bare `return normalize.rent_period_and_annual(price, text)` in
    run._rent_fields makes this fail with price_annual=None.
    """
    text = " ".join(filter(None, (OFFICE_543_DAILY_SERVICE["title"],
                                 OFFICE_543_DAILY_SERVICE["description"])))
    assert normalize._RENT_PERIOD_TOKEN_RE.search(text).group(1) == "يومي", (
        "sanity: the shared parser really does see a يومي token in this ad"
    )
    assert normalize.rent_period_and_annual(1000, text) == (None, None), (
        "sanity: the shared contract really would throw the price away"
    )
    row = _row(OFFICE_543_DAILY_SERVICE)
    assert row["price_annual"] == 1000, (
        f"price_annual={row['price_annual']} — «ضيافة يومية» is a service, and a source-published "
        f"price may never be hidden on the strength of a word about it"
    )
    assert "rent_period" not in row, "the period is UNKNOWN, which is not the same as no price"


def test_a_payment_split_is_not_a_lease_period():
    """FLAT_190 prints «قيمة الإيجار: 40,000 ألف دفعة أو دفعتين أو شهري» — one payment, two, or
    monthly instalments OF THE SAME 40,000. The figure IS beside «شهري», so proximity alone would
    convert it and store 480,000. The split word is what settles it (same reading as wadod's
    «دفعة واحدة»/«دفعتين»)."""
    row = _row(FLAT_190_PAYMENT_SPLIT)
    assert "rent_period" not in row
    assert row["price_annual"] == 40000
    assert row["additional_info"]["rent_period_reading"] == "period_is_a_payment_split"


def test_two_periods_in_one_ad_pin_neither():
    """An ad offering «للإيجار الشهري والسنوي» has made no statement about its one price — the same
    rule the fleet already applies to eaqartabuk. SYNTHETIC text on a real record."""
    rec = {**FLAT_103_MONTHLY_FIELD,
           "description": "مكاتب مشتركة للإيجار الشهري والسنوي — الإيجار 3000"}
    row = _row(rec)
    assert "rent_period" not in row
    assert row["price_annual"] == 3000, "the published figure survives an unpinnable period"
    assert row["additional_info"]["rent_period_reading"] == "period_two_periods_named"


def test_a_sale_never_gets_a_rent_period():
    """`the_sub_type_of_ad` 17 «بيع» / 18 «إيجار» is the only deal signal, and an unrecognised value
    is skipped rather than guessed into one side. SYNTHETIC: the deal flag flipped on a real lease."""
    assert _row(WAREHOUSE_288_PDPL)["transaction_type"] == "Rent"
    sale = {**WAREHOUSE_288_PDPL, "the_sub_type_of_ad": 17, "the_sub_type_of_ad_label": "بيع",
            "the_sub_type_of_ad_slug": "for-sale"}
    row = _row(sale)
    assert row["transaction_type"] == "Buy"
    assert row["price_total"] == WAREHOUSE_288_PDPL["price"]
    assert "rent_period" not in row and "price_annual" not in row

    unknown, _cat, why = R.map_listing({**WAREHOUSE_288_PDPL, "the_sub_type_of_ad": 19,
                                       "the_sub_type_of_ad_label": "مزاد"})
    assert unknown is None and why == "deal_unknown_مزاد", (
        f"an unrecognised deal flag must be COUNTED, not guessed into Buy or Rent; got {why!r}")


# ── 3. PDPL ──────────────────────────────────────────────────────────────────────────────────────
def test_a_poisoned_record_leaks_no_contact_detail_anywhere():
    """WAREHOUSE_288 carries a broker's name, mobile and email in structured fields AND six phone
    numbers the advertiser typed into the description. None of it may reach a column,
    additional_info or source_capture."""
    rec = WAREHOUSE_288_PDPL
    row = _row(rec)
    blob = repr(row)

    for secret in ("531195228", "i.alammari@almasharaq-sa.com", "+966555434487",
                   "ابراهيم عبدالله ابراهيم العماري", "شركة المشرق للأستثمار",
                   "920015243", "0555434487", "0541775599", "0533138777",
                   "0543337060", "0508033359"):
        assert secret in repr(rec), f"sanity: {secret!r} must really be in the captured record"
        assert secret not in blob, f"PDPL leak: {secret!r} reached the stored row"

    for banned in ("advertiser_name", "advertiser_phone", "advertiser_email", "contact_number",
                   "creator", "member_type", "average_rating", "average_rating_creator"):
        assert banned not in row["source_capture"], f"{banned} must not be captured"
        assert banned not in row["additional_info"], f"{banned} must not be archived"

    # The listing CONTENT survives the redaction — this is a privacy fix, not data destruction.
    assert "مستودع للإيجار" in row["description"]
    assert "حي البرية" in row["description"]
    assert row["license_number"] == "7200897769" or row["license_number"] == rec["license_number"]
    assert row["additional_info"]["authorization_no"] == "7200897769"
    assert row["price_annual"] == rec["price"], "the price is not PII"


def test_the_capture_is_an_allowlist_so_a_new_pii_key_cannot_arrive_by_default():
    """A blocklist would have to be updated the day the platform adds a field. SYNTHETIC key."""
    rec = {**WAREHOUSE_288_PDPL, "owner_whatsapp_link": "https://wa.me/966555434487",
           "some_new_field_nobody_reviewed": "0555434487"}
    row = _row(rec)
    assert "owner_whatsapp_link" not in row["source_capture"]
    assert "some_new_field_nobody_reviewed" not in row["source_capture"]
    assert "wa.me" not in repr(row) and "0555434487" not in repr(row)


# ── 4. Skips the source's own markers ask for ────────────────────────────────────────────────────
def test_a_bid_priced_ad_is_skipped_with_a_counted_reason():
    """SYNTHETIC: `price_type_label` flipped on a real record to the platform's own «آخر عرض» (last
    bid). Auctions live in a separate entity (/api/v1/auctions, `mzad-*` slugs, `auctions_count` 0
    on every city) and all 813 catalogue ads read «سعر محدد», so this is the backstop, not the
    primary defence. NO «مزاد» ad may be mapped."""
    rec = {**LAND_RENT_223, "price_type_label": "آخر عرض"}
    row, _cat, why = R.map_listing(rec)
    assert row is None
    assert why == "price_type_آخر عرض", f"the skip must be COUNTED and name the marker, got {why!r}"


def test_an_unpublished_or_draft_or_unapproved_ad_is_skipped():
    """All 813 read status 2 «منشور» / is_active 1 «معتمد» / is_draft 0 / ad_type 2 «إعلان مرخص», so
    none of them is a death signal — but a row arriving at an unmeasured value is refused, not
    guessed about. SYNTHETIC flips of a real record."""
    for patch, expect in (
        ({"status": 5, "status_value": "مؤرشف"}, "status_مؤرشف"),
        ({"is_active": 0, "is_active_label": "غير معتمد"}, "not_approved_غير معتمد"),
        ({"is_draft": 1}, "draft"),
        ({"ad_type": 1, "ad_type_value": "إعلان غير مرخص"}, "ad_type_إعلان غير مرخص"),
    ):
        row, _cat, why = R.map_listing({**LAND_RENT_223, **patch})
        assert row is None and why == expect, f"{patch} → {why!r}, expected {expect!r}"


def test_an_unmappable_type_skips_rather_than_being_guessed():
    """«مجمع» (9 live rows) has no safe fleet mapping — 6 scrapers say Commercial Building, aqargate
    says Compound, and the canonical taxonomy files it under Residential Building's rawTypes. Four
    such words (مجمع/برج/كشك/موقف سيارات, 14 rows) skip with a counted reason and are raised as
    owner questions rather than filed under a guess."""
    row, _cat, why = R.map_listing(COMPLEX_10_UNMAPPED)
    assert row is None
    assert why == "type_unmapped_مجمع"


# ── 5. The type mapping, including the invisible one ─────────────────────────────────────────────
def test_the_type_mapping_including_the_tashkeel_studio():
    """«شقَّة صغيرة (استوديو)» is written with SHADDA BEFORE FATHA (U+0651 then U+064E). A hand-typed
    copy renders identically and compares UNEQUAL, which is how abaad's first build skipped all
    three of its studio rows while its own unit test passed. Marks are stripped before the lookup."""
    raw = STUDIO_7_TASHKEEL["type"]
    assert raw != "شقة صغيرة (استوديو)", "sanity: the captured string carries diacritics"
    assert [hex(ord(c)) for c in raw[:5]] == ["0x634", "0x642", "0x651", "0x64e", "0x629"], (
        "sanity: the capture really is shadda-before-fatha, which is why stripping is required"
    )
    assert normalize.map_type_exact(raw) is None, (
        "sanity: the shared map cannot read it as published — the override is load-bearing"
    )
    assert _row(STUDIO_7_TASHKEEL)["property_type"] == "Studio"

    for rec, expect in ((LAND_RENT_223, "Residential Land"), (FLAT_107_ANNUAL_FIELD, "Apartment"),
                        (OFFICE_543_DAILY_SERVICE, "Office"), (WAREHOUSE_288_PDPL, "Warehouse")):
        assert _row(rec)["property_type"] == expect


# ── 6. The lookup ids the API never resolves ─────────────────────────────────────────────────────
def test_an_unresolvable_option_id_leaves_the_column_null_and_never_interpolates():
    """`construction_period` / `street_width` / `real_estate_facade_id` are row ids of a server-side
    options table the API returns unresolved (`info_fields_label` is null on every request). The
    measured sets are closed; an id outside them resolves to nothing. Facade 158 and street widths
    188-193 are real options no live listing uses — they must stay NULL, never be read off a
    neighbouring id."""
    row = _row(LAND_RENT_223)
    assert row["street_width_m"] == 60, "187 is the measured 60 m option"
    assert row["property_age"] is None, "«-» — LAND_RENT_223 publishes no age"

    row = _row(FLAT_107_ANNUAL_FIELD)
    assert row["property_age"] == 0, "136 is «جديد», which the shared vocabulary reads as 0"

    unknown = {**LAND_RENT_223,
               "info_fields": {**LAND_RENT_223["info_fields"], "street_width": 191,
                               "construction_period": 999, "real_estate_facade_id": 158}}
    row = _row(unknown)
    assert row["street_width_m"] is None and row["property_age"] is None
    assert row["direction"] is None
    assert row["additional_info"]["street_width_option_id"] == 191, "the raw id is still archived"
    assert "street_width_option_label" not in row["additional_info"]


def test_the_facade_diagonal_is_the_sources_own_single_choice():
    """157 is «جنوبية» and 159 is «جنوبية شرقية» — one cell, eight options, so a diagonal here is a
    facade rather than the two-street corner plot that prose diagonals often are."""
    for fid, expect in ((157, "جنوب"), (154, "شرق"), (159, "جنوب شرق"), (161, None)):
        rec = {**LAND_RENT_223,
               "info_fields": {**LAND_RENT_223["info_fields"], "real_estate_facade_id": fid}}
        got = _row(rec)["direction"]
        if expect is not None:
            assert got == expect, f"facade id {fid} → {got!r}, expected {expect!r}"


# ── 7. Amenities: positive-only ──────────────────────────────────────────────────────────────────
def test_an_omitted_amenity_stays_unknown_and_a_columnless_one_is_archived():
    """Six amenity slugs exist on this platform; four have columns. «هاتف» and «تصريف الفيضانات»
    have none and are archived rather than forced into a neighbour. Positive-only: an amenity the
    source omits is UNKNOWN, never False."""
    row = _row(OFFICE_543_DAILY_SERVICE)
    assert row["electricity"] is True and row["sanitation"] is True
    assert "هاتف" in row["additional_info"]["amenity_words"]
    assert row["additional_info"]["amenity_words"].count("هاتف") == 1

    bare = {**LAND_RENT_223, "amenities": []}
    row = _row(bare)
    for col in ("electricity", "water_supply", "sanitation", "optical_fibers"):
        assert row.get(col) is not False, f"{col} must be UNKNOWN, never a fabricated NO"


# ── 8. The listing URL and the removal oracle ────────────────────────────────────────────────────
def test_the_listing_url_is_the_path_the_site_itself_links_to():
    """Verified against the site's own <a href> on 763/763 walked listings. `main_usage` is what the
    site routes on; the record's `usage_slug` is "commercial" on all 813 and reproducing the link
    with it fails on 282 of the 763."""
    assert _row(FLAT_107_ANNUAL_FIELD)["listing_url"] == (
        "https://reinvest.sa/for-rent/apartment/residential/riyadh/al-falah/shk-llaygar-107")
    assert _row(LAND_RENT_223)["listing_url"] == (
        "https://reinvest.sa/for-rent/lands/commercial/riyadh/hy-alslymany-alshrky/ard-llaygar-223")
    # main_usage absent → the site's own literal "explore" segment (31 of the 763)
    assert R.listing_path({**LAND_RENT_223, "main_usage": None}) == (
        "/for-rent/lands/explore/riyadh/hy-alslymany-alshrky/ard-llaygar-223")
    # district_slug empty → the site's own literal "district" segment (33 live rows)
    assert R.listing_path({**LAND_RENT_223, "district_slug": ""}) == (
        "/for-rent/lands/commercial/riyadh/district/ard-llaygar-223")
    assert R.listing_path({**LAND_RENT_223, "slug": None}) is None, "no slug, no URL — never a guess"


def test_the_oracle_reads_the_api_because_the_rendered_page_lies():
    """Measured 2026-09-24: of four ads that left the catalogue, the API 404s on all four while
    THREE still serve a complete 200 HTML page from Next.js's ISR cache. A 200-means-live oracle
    would never retire anything; a page-based oracle would resurrect corpses."""
    gone = '{"status":404,"message":"هذا الاعلان لم يعد متوفر","data":null}'
    missing = '{"status":404,"message":"لم يتم العثور على البيانات","data":null}'
    live = '{"status":200,"message":"تم تحميل البيانات بنجاح","data":{"id":4571,"price":420750}}'

    assert R._signal(404, gone, False) == "gone", "the source's own «لم يعد متوفر», in words"
    assert R._signal(404, missing, False) == "gone", "both 404 messages mean gone"
    assert R._signal(200, live, False) == "live"
    assert R._signal(200, '{"status":200,"data":null}', False) is None, (
        "a 200 with no listing object states nothing"
    )
    for blocked in (403, 429, 500, 503):
        assert R._signal(blocked, "", False) is None, f"HTTP {blocked} is about us, never the ad"
    assert R._signal(None, "", False) is None, "no answer is never proof of death"
    # A stale but complete HTML page must not be readable as life by this signal.
    assert R._signal(200, "<!DOCTYPE html><html>… أرض للإيجار …</html>", False) is None


def test_the_oracle_addresses_a_row_by_its_own_stored_url():
    """`url_for` takes the slug from the row's OWN stored listing_url, never from an ad_number — the
    sanadak lesson, where 39 of 1,724 rows stored another listing's URL and three answered 'live'."""
    assert R._slug_from_url(
        "https://reinvest.sa/for-rent/lands/commercial/riyadh/x/ard-llaygar-223") == "ard-llaygar-223"
    assert R._slug_from_url("https://reinvest.sa/for-rent/lands/commercial/riyadh/x/a-1/") == "a-1"
    assert R._slug_from_url(None) is None
    assert R._slug_from_url("") is None


# ── 9. The row never carries a fabricated fact ───────────────────────────────────────────────────
def test_the_rega_land_number_is_not_filed_as_the_parcel_number():
    """The API's `land_number` is a 12-16 digit REGA land identifier; the rendered page's «رقم القطعة»
    for the SAME listing reads «117». Storing one as the other would publish a wrong parcel."""
    row = _row(LAND_RENT_223)
    assert "plan_parcel" not in row or row["plan_parcel"] is None
    assert row["additional_info"]["rega_land_number"] == str(LAND_RENT_223["land_number"])


def test_total_rooms_are_not_bedrooms():
    """`rooms_count` is TOTAL rooms (a 21-flat building publishes 50); `bed_room_count` is bedrooms.
    SYNTHETIC info_fields on a real record, mirroring the live aamar-llaygar-183 shape."""
    rec = {**FLAT_107_ANNUAL_FIELD,
           "info_fields": {**FLAT_107_ANNUAL_FIELD["info_fields"], "rooms_count": 50}}
    row = _row(rec)
    assert row["bedrooms"] == 1, "bedrooms come from bed_room_count only"
    assert row["additional_info"]["total_rooms"] == "50"


def test_photos_and_video_are_the_absolute_urls_the_source_publishes():
    row = _row(WAREHOUSE_288_PDPL)
    assert row["photo_urls"] == [WAREHOUSE_288_PDPL["images_info"][0]["url"]]
    assert row["photo_urls"][0].startswith("https://")
    assert row["images_evidence"]["count"] == 1
    no_media = {**WAREHOUSE_288_PDPL, "images_info": [], "video": None}
    row = _row(no_media)
    assert row["photo_urls"] is None and row["video_url"] is None
    assert row["images_evidence"]["key_present"] is False
