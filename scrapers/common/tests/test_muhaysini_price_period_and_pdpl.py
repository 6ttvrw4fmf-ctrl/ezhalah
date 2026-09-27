"""muhaysini (أحمد المحيسني العقارية) — the guards that would have shipped a wrong number.

Every fixture below is a VERBATIM record captured from the live API on 2026-09-24 (the
`retrieve/<id>.property` payload merged over its `list` row, exactly what map_listing() receives),
trimmed to the keys the shipping code reads. Every assertion executes scrapers/muhaysini/run.py's own
functions — no reimplementation, no hand-written "expected" dicts.

MUTATION-VERIFIED (2026-09-24). Six mutants were built, run, and watched to FAIL before the guard was
restored — each one the shape a careless first draft actually writes. Observed output, verbatim:

  (a) `headline = _money(rec.get("price"))` on both branches — trusting the platform's own price
      column, which on a land rent holds the per-metre rate:
        test_land_rent_stores_the_published_total_not_the_per_metre_rate    assert 51 == 507858
        test_land_sale_stores_the_licence_total_the_page_prints             assert 230000 == 229125
        test_non_land_headline_is_the_figure_the_detail_page_prints         assert 900000 == 1150000
        test_two_periods_named_at_once_leaves_rent_period_null              assert 2500 == 25000
      → 4 failed, 31 passed
  (b) `_land_total()` returning `landTotalPrice` for BOTH deal sides (reading "the land total" as one
      field and forgetting the rent has its own):
        test_land_rent_stores_the_published_total_not_the_per_metre_rate    assert 51 == 507858
        test_nothing_is_ever_multiplied_even_when_the_product_would_match
      → 2 failed, 33 passed
  (c) `title = _clean(...)` without redact_pii — THIS ONE WAS A REAL BUG, not a fabricated mutant.
      The first draft redacted only the description, and the PDPL test found the leak:
        test_pdpl_a_poisoned_record_leaks_nothing_into_any_stored_payload
            AssertionError: PII value '0542037990' reached a stored payload
      → the fix is in run.py; this is the one mutant that was written by accident.
  (d) `gated()` without the `field in declared` check (no propertyFields gate). THE FIRST VERSION OF
      THIS SUITE DID NOT CATCH IT — 36 passed with the gate gone, because every value the gate nulls
      on the land fixture is a falsy 0/false that the other rules already reject. Measuring the
      ungated mapper against all 2,827 rows showed where it really bites (building_number "0000" on
      934 rows, plan_parcel "0" on 55, and price_per_meter 9 on one villa), and the two tests were
      rewritten to assert those. Now:
        test_property_fields_gate_keeps_a_land_row_from_publishing_table_defaults
        test_an_undeclared_meter_price_never_reaches_the_price_column
      → 2 failed, 34 passed
  (e) `parse_property_age(gated("age"))` — the FK id instead of the word:
        test_the_age_field_is_a_foreign_key_not_a_year_count   → 1 failed, 35 passed
  (f) `row["furnished"] = rec["furnished"]` for any bool — storing 1,018 fabricated negatives:
        test_a_declared_false_furnished_is_still_not_a_published_no  → 1 failed, 35 passed

  (g) `_period_describes_the_stored_figure` reverted to the loose ±90-character "appears nearby"
      window — which is what the FIRST DRAFT ACTUALLY SHIPPED, and it was wrong by 12× on two live
      rows before a sweep of all 600 rents found them:
        test_a_period_beside_the_wrong_number_is_refused
            AssertionError: APT_RENT_TWO_INSTALMENTS_NOT_MONTHLY: the period describes the OTHER
            figure — assert 'monthly' is None      (it had stored 35,000 × 12 = 420,000)
        test_nearest_number_picks_the_figure_the_token_is_attached_to
      → 2 failed, 36 passed
  (h) the city fallback removed (`City` only, ignoring the licence's own `location.city`):
        test_the_city_falls_back_to_the_licence_when_the_platform_relation_is_null
      → 1 failed, 37 passed
  (i) `while page <= MAX_PAGES` reverted to `while True`. This mutant does not FAIL —
      test_the_walk_only_claims_complete_when_it_reached_the_end HANGS FOREVER on its rolling-window
      case, which is exactly the production failure the cap exists to prevent: this API publishes no
      `total`, so a shifting page window would keep adding ids and a nightly job would never return.
      Killed after 120 s, cap restored.

Restored → 38 passed. Two lessons worth keeping. (d): a green suite can be asserting nothing — the
gate mutant passed 36 tests until the ungated mapper was diffed against all 2,827 rows to find where
it actually bites. (g): the guard borrowed from another platform was subtly wrong for THIS one, and
only a sweep of every rent in the catalogue showed it.
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

# The REAL scrapers.common.db is imported (the mapper needs its AUTHORITATIVE_NULL sentinel, and a
# stub would make the opposite-deal-side assertions vacuous). Only its two module-load imports are
# stubbed, so nothing touches the network and SUPABASE_* is never read — sb() is never called here.
_sb = types.ModuleType("supabase")
_sb.Client = object
_sb.create_client = lambda *a, **k: None
sys.modules.setdefault("supabase", _sb)
_dv = types.ModuleType("dotenv")
_dv.load_dotenv = lambda *a, **k: None
sys.modules.setdefault("dotenv", _dv)

from scrapers.common import db, normalize  # noqa: E402
import scrapers.common.arabic_location as al  # noqa: E402
from scrapers.muhaysini import run as mhs  # noqa: E402


# ── The location catalog, stubbed with the REAL catalog rows these fixtures resolve against ──────
# Read from production loc_catalog_city / _region / _district on 2026-09-24. Stubbing the module's
# own maps (rather than the mapper) keeps to_catalog()/find_district_in_text() as the SHIPPING
# functions — only their data source is offline.
_CATALOG_CITIES = {          # city_norm → [(city_id, region_id)]
    "بلجرشي": [(1531, 12)],
    "احد رفيده": [(65, 6)],
    "الرياض": [(3, 1)],
    "المدينه المنوره": [(14, 3)],
    "عنيزه": [(80, 4)],
    "بريده": [(11, 4)],
    "البدائع": [(2358, 8), (2481, 4)],          # a REAL twin: Hail and Qassim
}
_CATALOG_REGIONS = {1: "منطقة الرياض", 2: "منطقة مكة المكرمة", 3: "منطقة المدينة المنورة",
                    4: "منطقة القصيم", 6: "منطقة عسير", 8: "منطقة حائل", 12: "منطقة الباحة"}
_CATALOG_DISTRICTS = {                           # (city_id, district_norm) → district_ar
    (1531, "وادي"): "حي الوادي",
    (65, "صوامع"): "حي الصوامع",
    (3, "شعله"): "حي الشعلة",
    (3, "قرطبه"): "حي قرطبة",
    (3, "غرناطه"): "حي غرناطة",
    (3, "عقيق"): "حي العقيق",
    (14, "شظاه"): "حي شظاة",
}


@pytest.fixture(autouse=True)
def _catalog():
    al._CITY.clear(); al._CID_AR.clear(); al._REGION_NORM.clear(); al._REGION_AR_FOR.clear()
    al._DISTRICT_BY_CITY.clear(); al._DISTRICT_AR_BY_NORM.clear(); al._DISTRICT_AR_BY_CITY.clear()
    for norm, cands in _CATALOG_CITIES.items():
        al._CITY[norm] = list(cands)
        for cid, _rid in cands:
            al._CID_AR[cid] = norm
    for rid, ar in _CATALOG_REGIONS.items():
        al._REGION_NORM[al.norm_ar(ar)] = rid
        al._REGION_AR_FOR[rid] = ar
    for (cid, dnorm), dar in _CATALOG_DISTRICTS.items():
        al._DISTRICT_BY_CITY.setdefault(cid, set()).add(dnorm)
        al._DISTRICT_AR_BY_NORM.setdefault(dnorm, dar)
        al._DISTRICT_AR_BY_CITY[(cid, dnorm)] = dar
    yield
    al._CITY.clear()


RECORDS = json.loads(r"""
{
 "LAND_RENT_RATE_TRAP": {
  "id": 3590,
  "purpose": "for_rent",
  "title": "أرض سكنية للإيجار في الوادي، بلجرشي",
  "price": "51",
  "area": "9958",
  "createdAt": "2026-09-14T15:30:37.085Z",
  "roomsCount": 0,
  "bathrooms": 0,
  "halls": 1,
  "furnished": false,
  "floorNumber": 0,
  "floorsCount": 0,
  "apartmentNumber": 0,
  "buildNumber": null,
  "plotNumber": "0",
  "meterPrice": null,
  "street": "غير مسمى",
  "age": null,
  "description": "\nالميزات الرئيسية:\n- المساحة الإجمالية: 9958 متر مربع\n- الغرض: للإيجار\n- الموقع: الوادي، بالجرشي\n- السعر: 507,858 ريال سعودي\n\nالمرافق:\n- أرض غير مؤثثة مناسبة للبناء\n- الوصول السهل إلى المرافق والخدمات المحلية\n- مثالية للتطوير السكني",
  "City": {
   "id": 4980,
   "name": "بلجرشي"
  },
  "Neighborhood": {
   "id": 11078,
   "name": "الوادي"
  },
  "Region": {
   "id": 11,
   "name": "الباحة"
  },
  "PropertyType": {
   "id": 50,
   "name": "ارض",
   "category": "residential",
   "propertyFields": [
    "plotNumber",
    "meterPrice"
   ]
  },
  "AdValidator": {
   "isValid": true,
   "advertisement": {
    "adLicenseNumber": "7200966947",
    "adSource": "الهيئة العامة للعقار",
    "advertisementType": "إيجار",
    "creationDate": "10/05/2026",
    "deedNumber": "675101005624",
    "endDate": "10/05/2027",
    "landNumber": null,
    "landTotalAnnualRent": 507858,
    "landTotalPrice": null,
    "location": {
     "region": "منطقة الباحة",
     "city": "بلجرشي",
     "district": "الوادي",
     "postalCode": "",
     "additionalNumber": "",
     "street": "غير مسمى"
    },
    "mainLandUseTypeName": "غير معرف",
    "numberOfRooms": null,
    "planNumber": null,
    "propertyAge": null,
    "propertyArea": 9958,
    "propertyFace": "غربية",
    "propertyPrice": 51,
    "propertyType": "ارض",
    "propertyUtilities": [
     "لايوجد خدمات"
    ],
    "streetWidth": 82,
    "titleDeedTypeName": "صك عقار مع شهادة وقفية",
    "isPawned": false,
    "isConstrained": false
   }
  },
  "mediaFiles": [
   {
    "id": 12576,
    "filePath": "properties/media_14940_2840_1789399854.jpeg",
    "thumbnail": "thumbnails/media_56388_1381_1789399854.jpeg"
   }
  ]
 },
 "LAND_SALE_BOTH_FIGURES": {
  "id": 3730,
  "purpose": "for_sale",
  "title": "أرض سكنية للبيع في مخطط الصوامع , المدينة المنورة ",
  "price": "400,000",
  "area": "625",
  "createdAt": "2026-09-16T14:16:07.153Z",
  "roomsCount": 0,
  "bathrooms": 0,
  "halls": 1,
  "furnished": false,
  "floorNumber": 0,
  "floorsCount": 0,
  "apartmentNumber": 0,
  "buildNumber": "0000",
  "plotNumber": "342",
  "meterPrice": 640,
  "street": "20",
  "age": null,
  "description": "أرض سكنية للبيع في مخطط السومة، أحد رفيدة\nواجهة غربية\nععرض الشارع 20 متر\nالمساحة: 625 متر مربع\nالسعر: 400 ألف ريال\n\nالمرافق:\nعداد كهرباء مستقل",
  "City": {
   "id": 72,
   "name": "أحد رفيدة"
  },
  "Neighborhood": {
   "id": 8806,
   "name": "الصوامع"
  },
  "Region": {
   "id": 5,
   "name": "عسير"
  },
  "PropertyType": {
   "id": 50,
   "name": "ارض",
   "category": "residential",
   "propertyFields": [
    "plotNumber",
    "meterPrice"
   ]
  },
  "AdValidator": {
   "isValid": true,
   "advertisement": {
    "adLicenseNumber": "7200751603",
    "adSource": "الهيئة العامة للعقار",
    "advertisementType": "بيع",
    "creationDate": "06/11/2025",
    "deedNumber": "362035001471",
    "endDate": "06/11/2026",
    "landNumber": "342",
    "landTotalAnnualRent": null,
    "landTotalPrice": 400000,
    "location": {
     "region": "منطقة عسير",
     "city": "أحد رفيدة",
     "district": "الصوامع",
     "postalCode": "00000",
     "additionalNumber": "0000",
     "street": "20"
    },
    "mainLandUseTypeName": "سكني",
    "numberOfRooms": null,
    "planNumber": "559 / 1440 / ع / 6",
    "propertyAge": null,
    "propertyArea": 625,
    "propertyFace": "غربية",
    "propertyPrice": 640,
    "propertyType": "ارض",
    "propertyUtilities": [
     "كهرباء"
    ],
    "streetWidth": 20,
    "titleDeedTypeName": "صك إلكتروني",
    "isPawned": false,
    "isConstrained": false
   }
  },
  "mediaFiles": [
   {
    "id": 13124,
    "filePath": "properties/media_88877_5900_1789568203.jpeg",
    "thumbnail": "thumbnails/media_71424_4044_1789568203.jpeg"
   }
  ]
 },
 "LAND_SALE_PLATFORM_ROUNDED": {
  "id": 608,
  "purpose": "for_sale",
  "title": "أرض للبيع",
  "price": "230,000",
  "area": "763",
  "createdAt": "2026-06-21T13:16:03.288Z",
  "roomsCount": 0,
  "bathrooms": 0,
  "halls": null,
  "furnished": false,
  "floorNumber": 0,
  "floorsCount": 0,
  "apartmentNumber": 0,
  "buildNumber": null,
  "plotNumber": null,
  "meterPrice": null,
  "street": "",
  "age": null,
  "description": "للبيع أرض سكنية قريبة من مسجد\nالموقع : الرياض حي الشعلة\nالمساحة : 763م\nالأطوال : (23,5 * 32,5 )\nالواجهة : جنوبية 25م\n\nشارع واسع ✅\nقريبة من مسجد وجامع 🕌\nقريبة من مدرسة ✅\nقريبة من حديقة ✅\n\nالبيع : 230,000\n\nمزيد من التفاصيل واتس : ((الرقم يظهر عند الضغط على اتصال))",
  "City": {
   "id": 1,
   "name": "الرياض"
  },
  "Neighborhood": {
   "id": 2289,
   "name": "حي الشعلة"
  },
  "Region": {
   "id": 1,
   "name": "الرياض"
  },
  "PropertyType": {
   "id": 50,
   "name": "ارض",
   "category": "residential",
   "propertyFields": [
    "plotNumber",
    "meterPrice"
   ]
  },
  "AdValidator": {
   "isValid": true,
   "advertisement": {
    "adLicenseNumber": "7201011764",
    "adSource": "الهيئة العامة للعقار",
    "advertisementType": "بيع",
    "creationDate": "20/06/2026",
    "deedNumber": "799661000382",
    "endDate": "28/05/2027",
    "landNumber": "387",
    "landTotalAnnualRent": null,
    "landTotalPrice": 229125,
    "location": {
     "region": "منطقة الرياض",
     "city": "الرياض",
     "district": "الشعلة",
     "postalCode": "13849",
     "additionalNumber": "8697",
     "street": "25"
    },
    "mainLandUseTypeName": "سكني",
    "numberOfRooms": null,
    "planNumber": "3441",
    "propertyAge": null,
    "propertyArea": 763.75,
    "propertyFace": "جنوبية",
    "propertyPrice": 300,
    "propertyType": "ارض",
    "propertyUtilities": [
     "هاتف"
    ],
    "streetWidth": 25,
    "titleDeedTypeName": "صك إلكتروني",
    "isPawned": false,
    "isConstrained": false
   }
  },
  "mediaFiles": [
   {
    "id": 2780,
    "filePath": "properties_original/media_83554_1530_1782047746.jpeg",
    "thumbnail": null
   }
  ],
  "PropertyFeatures": [
   {
    "id": 41,
    "name": "مدارس قريبة",
    "icon": "system/aqaria_BEYEJsVBdZ1757591785_1354.png",
    "PropertyFeaturesPivot": {
     "propertyId": 608,
     "featureId": 41
    }
   },
   {
    "id": 45,
    "name": "مسجد قريب",
    "icon": "system/aqaria_JPxxPa9upa1757591964_3763.png",
    "PropertyFeaturesPivot": {
     "propertyId": 608,
     "featureId": 45
    }
   }
  ]
 },
 "APT_SALE_PAGE_SHOWS_LICENCE": {
  "id": 2379,
  "purpose": "for_sale",
  "title": "للبيع | شقة سكنية مميزة في حي قرطبة ",
  "price": "900,000",
  "area": "86.98",
  "createdAt": "2026-08-20T12:31:39.097Z",
  "roomsCount": 2,
  "bathrooms": 0,
  "halls": 1,
  "furnished": false,
  "floorNumber": 0,
  "floorsCount": 0,
  "apartmentNumber": 0,
  "buildNumber": "4084",
  "plotNumber": "4",
  "meterPrice": null,
  "street": "ابن مقلة",
  "age": 3,
  "description": " الموقع: حي قرطبة – زاوية شارع 30 غربي × 30 جنوبي\n المساحة: 86 م²\n عمر العقار: سنتان\n تبعد 7 دقائق عن مجمع بارك أفنيو\n تبعد 14 دقيقة عن مطار الملك خالد الدولي\n\n مواصفات الشقة:\n غرفتا نوم، إحداهما ماستر\n مجلس مستقل\n مطبخ واسع\n ركن مخصص للغسيل\n 3 دورات مياه\n موقف خاص\n\n التفاصيل المالية:\nالعائد الاستثماري السنوي: 60,000 ريال\nسعر البيع:900,000  ريال\nالرهن العقاري المتبقي: 560,000 ريال",
  "City": {
   "id": 1,
   "name": "الرياض"
  },
  "Neighborhood": {
   "id": 10086,
   "name": "قرطبة"
  },
  "Region": {
   "id": 1,
   "name": "الرياض"
  },
  "PropertyType": {
   "id": 1,
   "name": "شقة",
   "category": "residential",
   "propertyFields": [
    "buildNumber",
    "floorNumber",
    "apartmentNumber",
    "roomsCount",
    "bathrooms",
    "halls",
    "age",
    "propertyType",
    "saudiBuildingCode",
    "furnished"
   ]
  },
  "AdValidator": {
   "isValid": true,
   "advertisement": {
    "adLicenseNumber": "7200866436",
    "adSource": "الهيئة العامة للعقار",
    "advertisementType": "بيع",
    "creationDate": "05/02/2026",
    "deedNumber": "498576008535",
    "endDate": "09/11/2026",
    "landNumber": "4",
    "landTotalAnnualRent": null,
    "landTotalPrice": null,
    "location": {
     "region": "منطقة الرياض",
     "city": "الرياض",
     "district": "قرطبة",
     "postalCode": "13245",
     "additionalNumber": "7057",
     "street": "ابن مقلة"
    },
    "mainLandUseTypeName": "غير متوفر",
    "numberOfRooms": 2,
    "planNumber": "2704 / أ",
    "propertyAge": "سنتين",
    "propertyArea": 86.98,
    "propertyFace": "شرقية",
    "propertyPrice": 1150000,
    "propertyType": "شقة",
    "propertyUtilities": [
     "كهرباء",
     "مياه",
     "صرف صحي"
    ],
    "streetWidth": 0,
    "titleDeedTypeName": "صك إلكتروني",
    "isPawned": true,
    "isConstrained": true
   }
  },
  "mediaFiles": [
   {
    "id": 10346,
    "filePath": "properties/media_60664_1078_1788342668.jpeg",
    "thumbnail": "thumbnails/media_45949_8912_1788342668.jpeg"
   }
  ]
 },
 "SHOWROOM_RENT_ANNUAL_IN_PROSE": {
  "id": 24,
  "purpose": "for_rent",
  "title": "معرض رقم (2)  للإيجار",
  "price": "33,350",
  "area": "30",
  "createdAt": "2026-01-25T08:38:42.722Z",
  "roomsCount": 0,
  "bathrooms": 0,
  "halls": null,
  "furnished": false,
  "floorNumber": 0,
  "floorsCount": 0,
  "apartmentNumber": 0,
  "buildNumber": "3070",
  "plotNumber": null,
  "meterPrice": 0,
  "street": "عبدالله ابن الربيع ",
  "age": 5,
  "description": "فرصة لاستئجار معرض بموقع مميز في حي الشظاه، مناسب للأنشطة التجارية المختلفة.\nتفاصيل المعرض:\n• رقم المعرض: 2\n• المساحة: 30 م²\n• موقع حيوي وسهل الوصول\nقيمة الإيجار السنوي: 35,000 ريال سعودي",
  "City": {
   "id": 39,
   "name": "المدينة المنورة"
  },
  "Neighborhood": {
   "id": 2333,
   "name": "حي شظاة"
  },
  "Region": {
   "id": 3,
   "name": "المدينة المنورة"
  },
  "PropertyType": {
   "id": 35,
   "name": "معرض",
   "category": "commercial",
   "propertyFields": [
    "buildNumber",
    "floorsCount",
    "halls",
    "age",
    "furnished",
    "saudiBuildingCode"
   ]
  },
  "AdValidator": {
   "isValid": true,
   "advertisement": {
    "adLicenseNumber": "7200971538",
    "adSource": "الهيئة العامة للعقار",
    "advertisementType": "إيجار",
    "creationDate": "13/05/2026",
    "deedNumber": "340118007272",
    "endDate": "09/11/2026",
    "landNumber": "61",
    "landTotalAnnualRent": null,
    "landTotalPrice": null,
    "location": {
     "region": "منطقة المدينة المنورة",
     "city": "المدينة المنورة",
     "district": "شظاة",
     "postalCode": "42361",
     "additionalNumber": "7917",
     "street": "الرياشى"
    },
    "mainLandUseTypeName": "غير معرف",
    "numberOfRooms": null,
    "planNumber": "768 / ت / 1417",
    "propertyAge": "اربع سنوات",
    "propertyArea": 846.85,
    "propertyFace": "جنوبية",
    "propertyPrice": 35000,
    "propertyType": "معرض",
    "propertyUtilities": [
     "كهرباء",
     "مياه",
     "صرف صحي"
    ],
    "streetWidth": 20,
    "titleDeedTypeName": "صك إلكتروني",
    "isPawned": false,
    "isConstrained": true
   }
  },
  "mediaFiles": [
   {
    "id": 2562,
    "filePath": "properties/media_56205_1420_1779712126.jpeg",
    "thumbnail": "thumbnails/media_34148_2469_1779712126.jpeg"
   }
  ]
 },
 "OFFICE_RENT_TWO_PERIODS": {
  "id": 246,
  "purpose": "for_rent",
  "title": "202 مكتب خاص في مساحة عمل مشتركة",
  "price": "2,500",
  "area": "6",
  "createdAt": "2026-04-12T09:53:41.307Z",
  "roomsCount": 0,
  "bathrooms": 0,
  "halls": null,
  "furnished": false,
  "floorNumber": 0,
  "floorsCount": 0,
  "apartmentNumber": 0,
  "buildNumber": null,
  "plotNumber": null,
  "meterPrice": null,
  "street": " الإمام عبدالله بن سعود",
  "age": null,
  "description": "الموقع حي غرناطة - شارع الإمام عبدالله بن سعود\nالدور الثاني\n------\n- مجهزة بالكامل\n-إمكانية تأجير مكتب واحد\n-خيارات تأجير : شهري - سنوي\n-------\n- مساحات المكتب :\n3 مكاتب = 9.50م\nالسعر :\nشهريا 3000 ألف ريال\nسنويا 36 ألف ريال\nغير شامل الضريبة\n\n3 مكاتب = 6.25م\nالسعر :\nشهريا 2500 ألف ريال\nسنويا 30000 ألف ريال\nغير شامل الضريبة",
  "City": {
   "id": 1,
   "name": "الرياض"
  },
  "Neighborhood": {
   "id": 2266,
   "name": "حي غرناطة"
  },
  "Region": {
   "id": 1,
   "name": "الرياض"
  },
  "PropertyType": {
   "id": 22,
   "name": "مكتب",
   "category": "commercial",
   "propertyFields": [
    "buildNumber",
    "floorNumber",
    "roomsCount",
    "bathrooms",
    "age",
    "saudiBuildingCode",
    "furnished"
   ]
  },
  "AdValidator": {
   "isValid": true,
   "advertisement": {
    "adLicenseNumber": "7200918512",
    "adSource": "الهيئة العامة للعقار",
    "advertisementType": "إيجار",
    "creationDate": "30/03/2026",
    "deedNumber": "610109004207",
    "endDate": "09/11/2026",
    "landNumber": "80",
    "landTotalAnnualRent": null,
    "landTotalPrice": null,
    "location": {
     "region": "منطقة الرياض",
     "city": "الرياض",
     "district": "غرناطة",
     "postalCode": "13242",
     "additionalNumber": "6204",
     "street": "عبدالله ابن سعود ابن عبدالعزيز الفرعي"
    },
    "mainLandUseTypeName": "استعمال مختلط",
    "numberOfRooms": 1,
    "planNumber": "2956",
    "propertyAge": "سنتين",
    "propertyArea": 1000,
    "propertyFace": "",
    "propertyPrice": 25000,
    "propertyType": "مكتب",
    "propertyUtilities": [
     "كهرباء",
     "مياه",
     "صرف صحي"
    ],
    "streetWidth": 0,
    "titleDeedTypeName": "صك إلكتروني",
    "isPawned": false,
    "isConstrained": true
   }
  },
  "mediaFiles": [
   {
    "id": 1290,
    "filePath": "properties/media_68036_7295_1775987452.jpeg",
    "thumbnail": "thumbnails/media_46087_6588_1775987452.jpeg"
   }
  ],
  "PropertyFeatures": [
   {
    "id": 26,
    "name": "مصاعد",
    "icon": "system/aqaria_2y4yKxCPig1757590764_3738.png",
    "PropertyFeaturesPivot": {
     "propertyId": 246,
     "featureId": 26
    }
   },
   {
    "id": 27,
    "name": "مواقف سيارات",
    "icon": "system/aqaria_KEvD4GH0yU1757590796_5992.png",
    "PropertyFeaturesPivot": {
     "propertyId": 246,
     "featureId": 27
    }
   },
   {
    "id": 29,
    "name": "كهرباء للطوارئ",
    "icon": "system/aqaria_ubKfmZGUMx1757590971_8773.png",
    "PropertyFeaturesPivot": {
     "propertyId": 246,
     "featureId": 29
    }
   },
   {
    "id": 30,
    "name": "مصاعد خدمات",
    "icon": "system/aqaria_4Hnbj7aRxq1757591016_9809.png",
    "PropertyFeaturesPivot": {
     "propertyId": 246,
     "featureId": 30
    }
   },
   {
    "id": 32,
    "name": "أمن وحماية",
    "icon": "system/aqaria_8RYgRnBRMe1757591126_1198.png",
    "PropertyFeaturesPivot": {
     "propertyId": 246,
     "featureId": 32
    }
   },
   {
    "id": 33,
    "name": "مواقف في القبو",
    "icon": "system/aqaria_QCOH1ByyVu1757591153_5396.png",
    "PropertyFeaturesPivot": {
     "propertyId": 246,
     "featureId": 33
    }
   }
  ]
 },
 "APT_RENT_MONTHLY_CORROBORATED": {
  "id": 1982,
  "purpose": "for_rent",
  "title": "شقة للإيجار ",
  "price": "4,000",
  "area": "66",
  "createdAt": "2026-08-18T11:16:21.182Z",
  "roomsCount": 1,
  "bathrooms": 0,
  "halls": 1,
  "furnished": null,
  "floorNumber": 0,
  "floorsCount": 0,
  "apartmentNumber": 0,
  "buildNumber": "8340",
  "plotNumber": "1418 / 1  /  6",
  "meterPrice": null,
  "street": "صفاح",
  "age": 2,
  "description": "للاجار استديو حي العقيق\nموثث\nالايجار شهري ٤٠٠٠",
  "City": {
   "id": 1,
   "name": "الرياض"
  },
  "Neighborhood": {
   "id": 2193,
   "name": "حي العقيق"
  },
  "Region": {
   "id": 1,
   "name": "الرياض"
  },
  "PropertyType": {
   "id": 1,
   "name": "شقة",
   "category": "residential",
   "propertyFields": [
    "buildNumber",
    "floorNumber",
    "apartmentNumber",
    "roomsCount",
    "bathrooms",
    "halls",
    "age",
    "propertyType",
    "saudiBuildingCode",
    "furnished"
   ]
  },
  "AdValidator": {
   "isValid": true,
   "advertisement": {
    "adLicenseNumber": "7201027815",
    "adSource": "الهيئة العامة للعقار",
    "advertisementType": "إيجار",
    "creationDate": "03/07/2026",
    "deedNumber": "599054002436",
    "endDate": "09/10/2026",
    "landNumber": "1418 / 1  /  6",
    "landTotalAnnualRent": null,
    "landTotalPrice": null,
    "location": {
     "region": "منطقة الرياض",
     "city": "الرياض",
     "district": "العقيق",
     "postalCode": "13515",
     "additionalNumber": "3905",
     "street": "صفاح"
    },
    "mainLandUseTypeName": "استعمال مختلط",
    "numberOfRooms": 1,
    "planNumber": "2670 / ب",
    "propertyAge": "سنة",
    "propertyArea": 66.61,
    "propertyFace": "",
    "propertyPrice": 4000,
    "propertyType": "شقة",
    "propertyUtilities": [
     "كهرباء",
     "مياه",
     "صرف صحي"
    ],
    "streetWidth": 0,
    "titleDeedTypeName": "صك إلكتروني",
    "isPawned": false,
    "isConstrained": false
   }
  },
  "mediaFiles": [
   {
    "id": 6770,
    "filePath": "properties/media_13011_6693_1787052061.jpeg",
    "thumbnail": "thumbnails/media_43820_3701_1787052061.jpeg"
   }
  ]
 },
 "BUILDING_RENT_SILENT": {
  "id": 3911,
  "purpose": "for_rent",
  "title": "5 محلات للايجار في حي القصواء، المدينة المنورة",
  "price": "150",
  "area": "742.47",
  "createdAt": "2026-09-20T13:11:55.300Z",
  "roomsCount": 20,
  "bathrooms": 0,
  "City": {
   "id": 39,
   "name": "المدينة المنورة"
  },
  "Neighborhood": {
   "id": 11755,
   "name": "القصواء"
  },
  "PropertyType": {
   "id": 8,
   "name": "عمارة سكنية",
   "category": "residential",
   "propertyFields": [
    "buildNumber",
    "floorsCount",
    "age",
    "propertyType",
    "saudiBuildingCode",
    "furnished"
   ]
  },
  "AdValidator": {
   "isValid": true,
   "advertisement": {
    "adLicenseNumber": "7200807215",
    "adSource": "الهيئة العامة للعقار",
    "advertisementType": "إيجار",
    "creationDate": "22/12/2025",
    "deedNumber": "318709000269",
    "endDate": "20/12/2026",
    "landNumber": "1858",
    "landTotalAnnualRent": null,
    "landTotalPrice": null,
    "location": {
     "region": "منطقة المدينة المنورة",
     "city": "المدينة المنورة",
     "district": "القصواء",
     "postalCode": "42391",
     "additionalNumber": "7082",
     "street": "بجاد ابن عمير"
    },
    "mainLandUseTypeName": "استعمال مختلط",
    "numberOfRooms": 20,
    "planNumber": "7 / ع / 1401هـ",
    "propertyAge": "جديد",
    "propertyArea": 742.47,
    "propertyFace": "شمالية شرقية",
    "propertyPrice": 150,
    "propertyType": "عمارة",
    "propertyUtilities": [
     "صرف صحي",
     "كهرباء",
     "لايوجد خدمات",
     "مياه"
    ],
    "streetWidth": 20,
    "titleDeedTypeName": "صك إلكتروني",
    "isPawned": false,
    "isConstrained": false
   }
  },
  "mediaFiles": [
   {
    "id": 13712,
    "thumbnail": "thumbnails/media_83056_6984_1789909956.jpeg"
   }
  ]
 },
 "REST_HOUSE_SALE_TINY_PRICE": {
  "id": 2295,
  "purpose": "for_sale",
  "title": "استراحة للبيع في حي السلام, مدينة عنيزة",
  "price": "700",
  "area": "733.5",
  "createdAt": "2026-08-20T10:19:46.959Z",
  "roomsCount": 2,
  "bathrooms": 0,
  "halls": 1,
  "furnished": false,
  "floorNumber": 0,
  "floorsCount": 0,
  "apartmentNumber": 0,
  "buildNumber": "7374",
  "plotNumber": "319",
  "meterPrice": null,
  "street": "ابن باديس",
  "age": 6,
  "description": "#للبيع\nاستراحة / حي السلام بمحافظة عنيزة\nمساحة الأرض:- 733م²\nبواجهه:-\nشرقية على شارع عرض 25م\nللمزيد_من_المعلومات_والاستفسار الرجاء التواصل مع الأرقام الظاهرة اسفل الإعلان\nالسعر: على السوم",
  "City": {
   "id": 137,
   "name": "عنيزة"
  },
  "Neighborhood": {
   "id": 10287,
   "name": "السلام"
  },
  "Region": {
   "id": 13,
   "name": "القصيم"
  },
  "PropertyType": {
   "id": 13,
   "name": "استراحة",
   "category": "residential",
   "propertyFields": [
    "buildNumber",
    "floorsCount",
    "roomsCount",
    "bathrooms",
    "halls",
    "age",
    "propertyType",
    "saudiBuildingCode",
    "furnished"
   ]
  },
  "AdValidator": {
   "isValid": true,
   "advertisement": {
    "adLicenseNumber": "7200883172",
    "adSource": "الهيئة العامة للعقار",
    "advertisementType": "بيع",
    "creationDate": "17/02/2026",
    "deedNumber": "8463312320500000",
    "endDate": "17/02/2027",
    "landNumber": "319",
    "landTotalAnnualRent": null,
    "landTotalPrice": null,
    "location": {
     "region": "منطقة القصيم",
     "city": "عنيزة",
     "district": "السلام",
     "postalCode": "56242",
     "additionalNumber": "3152",
     "street": "ابن باديس"
    },
    "mainLandUseTypeName": "الخدمات العامة",
    "numberOfRooms": 2,
    "planNumber": "867",
    "propertyAge": "خمس سنوات",
    "propertyArea": 733.5,
    "propertyFace": "شرقية",
    "propertyPrice": 700,
    "propertyType": "إستراحة",
    "propertyUtilities": [
     "كهرباء",
     "مياه"
    ],
    "streetWidth": 20,
    "titleDeedTypeName": " صك السجل العقاري",
    "isPawned": false,
    "isConstrained": false
   }
  },
  "mediaFiles": [
   {
    "id": 7789,
    "filePath": "properties/media_36702_2371_1787221194.jpeg",
    "thumbnail": "thumbnails/media_33307_8870_1787221194.jpeg"
   }
  ]
 },
 "INVESTMENT_NOT_A_DEAL": {
  "id": 695,
  "purpose": "for_investment",
  "title": "للبيع عمارة استثمارية مؤجرة بالكامل",
  "price": "700,000",
  "area": "0",
  "createdAt": "2026-06-30T12:46:48.889Z",
  "roomsCount": 0,
  "bathrooms": 0,
  "halls": null,
  "furnished": false,
  "floorNumber": 0,
  "floorsCount": 0,
  "apartmentNumber": 0,
  "buildNumber": null,
  "plotNumber": null,
  "meterPrice": null,
  "street": "لقمان",
  "age": 12,
  "description": "🏢 للبيع عمارة استثمارية مؤجرة بالكامل في حي منفوحة – الرياض\n\n📍 الموقع: حي منفوحة – الرياض\n📐 المساحة: 100 م²\n🛣️ عرض الشارع: 10 م\n⚡ عدد عدادات الكهرباء: 3 عدادات مستقلة\n💧 المياه متوفرة\n\n🏢 مكونات العقار:\n▪️ دور أرضي\n▪️ دور أول\n▪️ ملحق\n\n💰 الدخل السنوي الحالي: 67,000 ريال\n📄 العقار مؤجر بالكامل على شركات بعقود إلكترونية سارية.\n\nمميزات العقار:\n- العمارة مجددة بالكامل.\n- تم تجديد السباكة بالكامل.\n- تم تجديد الكهرباء بالكامل.\n- العقار نظيف وجاهز للاستثمار.\n- دخل سنوي قائم ومستقر.\n- جميع الخدمات متوفرة.\n\nمميزات الموقع:\n- موقع حيوي في حي منفوحة.\n- قريب من الخدمات والمرافق العامة.\n- رابط الموقع:\nhttps://maps.google.com/?q=24.605902,46.725384\n\n💵 المطلوب: 700,000 ريال\n\n🤝 المالك متجاوب مع الجادين وحول المطلوب.\n\n📈 فرصة استثمارية مميزة بعائد سنوي قائم ومناسب للمستثمرين الباحثين عن دخل مستقر.\n\n",
  "City": {
   "id": 1,
   "name": "الرياض"
  },
  "Neighborhood": {
   "id": 11708,
   "name": "منفوحة"
  },
  "Region": {
   "id": 1,
   "name": "الرياض"
  },
  "PropertyType": {
   "id": 8,
   "name": "عمارة سكنية",
   "category": "residential",
   "propertyFields": [
    "buildNumber",
    "floorsCount",
    "age",
    "propertyType",
    "saudiBuildingCode",
    "furnished"
   ]
  },
  "AdValidator": {
   "isValid": true,
   "advertisement": {
    "adLicenseNumber": "7201001227",
    "adSource": "الهيئة العامة للعقار",
    "advertisementType": "بيع",
    "creationDate": "11/06/2026",
    "deedNumber": "499057002753",
    "endDate": "01/12/2026",
    "landNumber": "بدون",
    "landTotalAnnualRent": null,
    "landTotalPrice": null,
    "location": {
     "region": "منطقة الرياض",
     "city": "الرياض",
     "district": "منفوحة",
     "postalCode": "12681",
     "additionalNumber": "7926",
     "street": "لقمان"
    },
    "mainLandUseTypeName": "غير متوفر",
    "numberOfRooms": 11,
    "planNumber": "بدون",
    "propertyAge": "اكثر من عشر سنوات",
    "propertyArea": 99,
    "propertyFace": "شمالية",
    "propertyPrice": 700000,
    "propertyType": "عمارة",
    "propertyUtilities": [
     "كهرباء",
     "مياه",
     "صرف صحي"
    ],
    "streetWidth": 10,
    "titleDeedTypeName": "صك إلكتروني",
    "isPawned": false,
    "isConstrained": false
   }
  },
  "mediaFiles": [
   {
    "id": 2942,
    "filePath": "properties/media_38264_6565_1782823601.jpeg",
    "thumbnail": "thumbnails/media_86547_6863_1782823601.jpeg"
   }
  ],
  "PropertyFeatures": [
   {
    "id": 22,
    "name": "كهرباء",
    "icon": "system/aqaria_msqS3wntlk1757590522_8697.png",
    "PropertyFeaturesPivot": {
     "propertyId": 695,
     "featureId": 22
    }
   },
   {
    "id": 23,
    "name": "مياه",
    "icon": "system/aqaria_yyvbphRipj1757590560_8804.png",
    "PropertyFeaturesPivot": {
     "propertyId": 695,
     "featureId": 23
    }
   },
   {
    "id": 51,
    "name": "صرف صحي",
    "icon": "system/aqaria_gF9Agm5tPJ1757592217_7356.png",
    "PropertyFeaturesPivot": {
     "propertyId": 695,
     "featureId": 51
    }
   }
  ]
 },
 "PURPOSE_CONTRADICTS_LICENCE": {
  "id": 554,
  "purpose": "for_sale",
  "title": "شقة للايجار حي النرجس",
  "price": "48,000",
  "area": "150",
  "createdAt": "2026-05-21T11:39:23.772Z",
  "roomsCount": 3,
  "bathrooms": 2,
  "halls": 1,
  "furnished": false,
  "floorNumber": 0,
  "floorsCount": 0,
  "apartmentNumber": 0,
  "buildNumber": null,
  "plotNumber": null,
  "meterPrice": null,
  "street": "عبدالملك العصامي",
  "age": 9,
  "description": "شقة للإيجار في فيلا\nالدور : دور أول فوق الأرضي\nالموقع : الرياض حي النرجس\nالواجهة : شماليه 15م\nالمساحة : 150 م تقريباً\nالعمر : 8 سنوات تقريباً\nعبارة عن :\n2 غرفة + صالة + مطبخ + مجلس مع دورة مياه\n\nمجموع دورات المياه : 2\n\nمطبخ راكب ✅\n5 مكيفات سبيلت راكبة ✅\nعداد كهرب مستقل ✅\nالصرف الصحي و الماء واصل ✅\nمدخلين للشقة ✅\n\nالسعر :\n45 ألف دفعة\n48 ألف دفعتين\n\nرقم الترخيص : 7200981453\nلمزيد من التفاصيل وفديو واتس : 0545752077",
  "City": {
   "id": 1,
   "name": "الرياض"
  },
  "Neighborhood": {
   "id": 2241,
   "name": "حي النرجس"
  },
  "Region": {
   "id": 1,
   "name": "الرياض"
  },
  "PropertyType": {
   "id": 1,
   "name": "شقة",
   "category": "residential",
   "propertyFields": [
    "buildNumber",
    "floorNumber",
    "apartmentNumber",
    "roomsCount",
    "bathrooms",
    "halls",
    "age",
    "propertyType",
    "saudiBuildingCode",
    "furnished"
   ]
  },
  "AdValidator": {
   "isValid": true,
   "advertisement": {
    "adLicenseNumber": "7200981453",
    "adSource": "الهيئة العامة للعقار",
    "advertisementType": "إيجار",
    "creationDate": "20/05/2026",
    "deedNumber": "2374305946400000",
    "endDate": "16/12/2026",
    "landNumber": "6873/1",
    "landTotalAnnualRent": null,
    "landTotalPrice": null,
    "location": {
     "region": "منطقة الرياض",
     "city": "الرياض",
     "district": "النرجس",
     "postalCode": "13333",
     "additionalNumber": "7090",
     "street": "عبدالملك العصامي"
    },
    "mainLandUseTypeName": "سكني",
    "numberOfRooms": 3,
    "planNumber": "2737",
    "propertyAge": "ثمان سنوات",
    "propertyArea": 350,
    "propertyFace": "شمالية",
    "propertyPrice": 48000,
    "propertyType": "شقة",
    "propertyUtilities": [
     "كهرباء",
     "مياه",
     "صرف صحي"
    ],
    "streetWidth": 0,
    "titleDeedTypeName": " صك السجل العقاري",
    "isPawned": false,
    "isConstrained": false
   }
  },
  "mediaFiles": [
   {
    "id": 2521,
    "filePath": "properties/media_26316_9919_1779363485.jpeg",
    "thumbnail": "thumbnails/media_95230_4225_1779363485.jpeg"
   }
  ],
  "PropertyFeatures": [
   {
    "id": 4,
    "name": "مطبخ",
    "icon": "system/aqaria_fmngCGhsnO1757589800_8950.png",
    "PropertyFeaturesPivot": {
     "propertyId": 554,
     "featureId": 4
    }
   },
   {
    "id": 5,
    "name": "مكيف",
    "icon": "system/aqaria_lrDB6IREqc1757589841_9394.png",
    "PropertyFeaturesPivot": {
     "propertyId": 554,
     "featureId": 5
    }
   },
   {
    "id": 22,
    "name": "كهرباء",
    "icon": "system/aqaria_msqS3wntlk1757590522_8697.png",
    "PropertyFeaturesPivot": {
     "propertyId": 554,
     "featureId": 22
    }
   },
   {
    "id": 23,
    "name": "مياه",
    "icon": "system/aqaria_yyvbphRipj1757590560_8804.png",
    "PropertyFeaturesPivot": {
     "propertyId": 554,
     "featureId": 23
    }
   },
   {
    "id": 51,
    "name": "صرف صحي",
    "icon": "system/aqaria_gF9Agm5tPJ1757592217_7356.png",
    "PropertyFeaturesPivot": {
     "propertyId": 554,
     "featureId": 51
    }
   }
  ]
 },
 "VILLA_SALE_PROSE_SAYS_UNDER_CONSTRUCTION": {
  "id": 3220,
  "purpose": "for_sale",
  "title": "فيلا للبيع في حي شمال شرق بريدة, مدينة بريدة",
  "price": "720,000",
  "area": "548.58",
  "createdAt": "2026-09-05T14:51:04.220Z",
  "roomsCount": 4,
  "bathrooms": 0,
  "halls": 1,
  "furnished": false,
  "floorNumber": 0,
  "floorsCount": 0,
  "apartmentNumber": 0,
  "buildNumber": "0000",
  "plotNumber": "2040",
  "meterPrice": null,
  "street": "0000",
  "age": 4,
  "description": "للبيع فيلا تحت الانشاء\nشمال شرق بريدة ضاحية بريدة",
  "City": {
   "id": 136,
   "name": "بريدة"
  },
  "Neighborhood": {
   "id": 8571,
   "name": "النقيب الشمالي"
  },
  "Region": {
   "id": 13,
   "name": "القصيم"
  },
  "PropertyType": {
   "id": 2,
   "name": "فيلا",
   "category": "residential",
   "propertyFields": [
    "buildNumber",
    "floorsCount",
    "roomsCount",
    "bathrooms",
    "halls",
    "age",
    "saudiBuildingCode",
    "furnished",
    "propertyType"
   ]
  },
  "AdValidator": {
   "isValid": true,
   "advertisement": {
    "adLicenseNumber": "7200888946",
    "adSource": "الهيئة العامة للعقار",
    "advertisementType": "بيع",
    "creationDate": "22/02/2026",
    "deedNumber": "894537002995",
    "endDate": "22/02/2027",
    "landNumber": "2040",
    "landTotalAnnualRent": null,
    "landTotalPrice": null,
    "location": {
     "region": "منطقة القصيم",
     "city": "بريدة",
     "district": "شمال شرق بريدة",
     "postalCode": "00000",
     "additionalNumber": "0000",
     "street": "0000"
    },
    "mainLandUseTypeName": "سكني",
    "numberOfRooms": 4,
    "planNumber": "1439 / ق / س / المعدل",
    "propertyAge": "ثلاث سنوات",
    "propertyArea": 548.575,
    "propertyFace": "شمالية شرقية",
    "propertyPrice": 720000,
    "propertyType": "فيلا",
    "propertyUtilities": [
     "كهرباء",
     "مياه",
     "صرف صحي"
    ],
    "streetWidth": 15,
    "titleDeedTypeName": "صك إلكتروني",
    "isPawned": true,
    "isConstrained": false
   }
  },
  "mediaFiles": [
   {
    "id": 10753,
    "filePath": "properties/media_33903_3594_1788620580.jpeg",
    "thumbnail": "thumbnails/media_45387_4154_1788620580.jpeg"
   }
  ]
 },
 "VILLA_SALE_UNDECLARED_METER_PRICE": {
  "id": 3749,
  "purpose": "for_sale",
  "title": "فلتان للبيع في حي المبعوث (باقدو) خلف متحف دار المدينة",
  "price": "2,500,000",
  "area": "536.84",
  "createdAt": "2026-09-17T09:17:23.110Z",
  "roomsCount": 20,
  "bathrooms": 0,
  "halls": 1,
  "furnished": false,
  "floorNumber": 0,
  "floorsCount": 0,
  "apartmentNumber": 0,
  "buildNumber": "5489",
  "plotNumber": "141",
  "meterPrice": 9,
  "street": "الواسطي",
  "age": 11,
  "description": "فلتان للبيع في حي المبعوث (باقدو) خلف متحف دار المدينة\n\nفلتان متلاصقتان على مساحة إجمالية 536 م2 مساحة كل فلة 268 م2 تشطيب ممتاز ومواصفات متكاملة\nواجهة شمالية شرقية\nشارع شرقي عرض 16م\n———-\nتفاصيل كل فل",
  "City": {
   "id": 39,
   "name": "المدينة المنورة"
  },
  "Neighborhood": {
   "id": 2329,
   "name": "حي المبعوث"
  },
  "Region": {
   "id": 3,
   "name": "المدينة المنورة"
  },
  "PropertyType": {
   "id": 2,
   "name": "فيلا",
   "category": "residential",
   "propertyFields": [
    "buildNumber",
    "floorsCount",
    "roomsCount",
    "bathrooms",
    "halls",
    "age",
    "saudiBuildingCode",
    "furnished",
    "propertyType"
   ]
  },
  "AdValidator": {
   "isValid": true,
   "advertisement": {
    "adLicenseNumber": "7200803434",
    "adSource": "الهيئة العامة للعقار",
    "advertisementType": "بيع",
    "creationDate": "20/12/2025",
    "deedNumber": "394372005276",
    "endDate": "28/10/2026",
    "landNumber": "141",
    "landTotalAnnualRent": null,
    "landTotalPrice": null,
    "location": {
     "region": "منطقة المدينة المنورة",
     "city": "المدينة المنورة",
     "district": "المبعوث",
     "postalCode": "42362",
     "additionalNumber": "6987",
     "street": "الواسطي"
    },
    "mainLandUseTypeName": "غير معرف",
    "numberOfRooms": 20,
    "planNumber": "772 / ت / 1417",
    "propertyAge": "عشر سنوات",
    "propertyArea": 536.84,
    "propertyFace": "شرقية",
    "propertyPrice": 2500000,
    "propertyType": "فيلا",
    "propertyUtilities": [
     "كهرباء",
     "مياه",
     "صرف صحي",
     "هاتف",
     "ألياف ضوئية",
     "تصريف الفيضانات "
    ],
    "streetWidth": 16,
    "titleDeedTypeName": "صك إلكتروني",
    "isPawned": true,
    "isConstrained": false
   }
  },
  "mediaFiles": [
   {
    "id": 13183,
    "filePath": "properties/media_15526_5043_1789636659.jpeg",
    "thumbnail": "thumbnails/media_32324_7357_1789636659.jpeg"
   }
  ]
 },
 "APT_RENT_TWO_INSTALMENTS_NOT_MONTHLY": {
  "id": 2403,
  "purpose": "for_rent",
  "title": "شقة للإيجار في شارع محمد المصيبيح, حي الرمال, مدينة الرياض, منطقة الرياض",
  "price": "35,000",
  "area": "409.5",
  "createdAt": "2026-08-20T13:31:54.546Z",
  "roomsCount": 3,
  "bathrooms": 0,
  "halls": 1,
  "furnished": false,
  "floorNumber": 0,
  "floorsCount": 0,
  "apartmentNumber": 0,
  "buildNumber": "2554",
  "plotNumber": "226/2",
  "meterPrice": null,
  "street": "محمد المصيبيح",
  "age": 7,
  "description": "شقه ثلاث غرف وصاله للايجار بفيلا دور ثاني بدون سطح بحي الرمال\nالشقه تتكون من :-\nغرفتين نوم - مجلس - صاله - مطبخ - دورتين مياه -\nالايجار دفعتين : 35,000\nالايجار الشهري : 3,300",
  "City": {
   "id": 1,
   "name": "الرياض"
  },
  "Neighborhood": {
   "id": 2265,
   "name": "حي الرمال"
  },
  "Region": {
   "id": 1,
   "name": "الرياض"
  },
  "PropertyType": {
   "id": 1,
   "name": "شقة",
   "category": "residential",
   "propertyFields": [
    "buildNumber",
    "floorNumber",
    "apartmentNumber",
    "roomsCount",
    "bathrooms",
    "halls",
    "age",
    "propertyType",
    "saudiBuildingCode",
    "furnished"
   ]
  },
  "AdValidator": {
   "isValid": true,
   "advertisement": {
    "adLicenseNumber": "7200983710",
    "adSource": "الهيئة العامة للعقار",
    "advertisementType": "إيجار",
    "creationDate": "23/05/2026",
    "deedNumber": "8493958589500000",
    "endDate": "31/12/2026",
    "landNumber": "226/2",
    "landTotalAnnualRent": null,
    "landTotalPrice": null,
    "location": {
     "region": "منطقة الرياض",
     "city": "الرياض",
     "district": "الرمال",
     "postalCode": "13256",
     "additionalNumber": "6857",
     "street": "محمد المصيبيح"
    },
    "mainLandUseTypeName": "سكني",
    "numberOfRooms": 3,
    "planNumber": "3121",
    "propertyAge": "ست سنوات",
    "propertyArea": 409.5,
    "propertyFace": "شرقية",
    "propertyPrice": 35000,
    "propertyType": "شقة",
    "propertyUtilities": [
     "كهرباء",
     "مياه",
     "صرف صحي",
     "ألياف ضوئية"
    ],
    "streetWidth": 0,
    "titleDeedTypeName": " صك السجل العقاري"
   }
  },
  "mediaFiles": [
   {
    "id": 8216,
    "filePath": "properties/media_87548_3082_1787232722.jpeg",
    "thumbnail": "thumbnails/media_38716_7818_1787232722.jpeg"
   }
  ]
 },
 "FLOOR_RENT_MONTHLY_AND_ANNUAL_BOTH_PRINTED": {
  "id": 1834,
  "purpose": "for_rent",
  "title": "فيلا للإيجار في شارع أبي أيوب بن المهلب, حي الرمال, مدينة الرياض, منطقة الرياض",
  "price": "65,000",
  "area": "163.64",
  "createdAt": "2026-08-17T12:07:46.215Z",
  "roomsCount": 3,
  "bathrooms": 0,
  "halls": 1,
  "furnished": false,
  "floorNumber": 0,
  "floorsCount": 0,
  "apartmentNumber": 0,
  "buildNumber": "7405",
  "plotNumber": "1401",
  "meterPrice": null,
  "street": "أبي أيوب بن المهلب",
  "age": 13,
  "description": "تاون هاوس بحي تنال الرمال\nمدخل خاصة\nسطح كبير\nموقف داخلي وكراج\n٣ غرف بالدور الثاني\nمطبخ و صالة و مجلس بالدور الاول\n\nاجار شهري 5500\nالسنوي 65000\nيقبل دفعتين\n",
  "City": {
   "id": 1,
   "name": "الرياض"
  },
  "Neighborhood": {
   "id": 2265,
   "name": "حي الرمال"
  },
  "Region": {
   "id": 1,
   "name": "الرياض"
  },
  "PropertyType": {
   "id": 2,
   "name": "فيلا",
   "category": "residential",
   "propertyFields": [
    "buildNumber",
    "floorsCount",
    "roomsCount",
    "bathrooms",
    "halls",
    "age",
    "saudiBuildingCode",
    "furnished",
    "propertyType"
   ]
  },
  "AdValidator": {
   "isValid": true,
   "advertisement": {
    "adLicenseNumber": "7200969087",
    "adSource": "الهيئة العامة للعقار",
    "advertisementType": "إيجار",
    "creationDate": "11/05/2026",
    "deedNumber": "993487005305",
    "endDate": "10/05/2027",
    "landNumber": "1401",
    "landTotalAnnualRent": null,
    "landTotalPrice": null,
    "location": {
     "region": "منطقة الرياض",
     "city": "الرياض",
     "district": "الرمال",
     "postalCode": "13436",
     "additionalNumber": "3993",
     "street": "أبي أيوب بن المهلب"
    },
    "mainLandUseTypeName": "سكني",
    "numberOfRooms": 3,
    "planNumber": "3242",
    "propertyAge": "جديد",
    "propertyArea": 163.64,
    "propertyFace": "غربية",
    "propertyPrice": 65000,
    "propertyType": "فيلا",
    "propertyUtilities": [
     "كهرباء",
     "مياه",
     "صرف صحي"
    ],
    "streetWidth": 20,
    "titleDeedTypeName": "صك إلكتروني"
   }
  },
  "mediaFiles": [
   {
    "id": 6210,
    "filePath": "properties/media_28063_7393_1786968478.jpeg",
    "thumbnail": "thumbnails/media_50147_6267_1786968478.jpeg"
   }
  ]
 },
 "NO_CITY_RELATION_LICENCE_HAS_ONE": {
  "id": 575,
  "purpose": "for_rent",
  "title": "فيلا للايجار",
  "price": "190,000",
  "area": "300",
  "createdAt": "2026-06-04T09:32:46.314Z",
  "roomsCount": 7,
  "bathrooms": 0,
  "halls": 1,
  "furnished": null,
  "floorNumber": 0,
  "floorsCount": 0,
  "apartmentNumber": 0,
  "buildNumber": null,
  "plotNumber": "1840 / 1",
  "meterPrice": null,
  "street": null,
  "age": 13,
  "description": "لفيلا :\nالدور الارضي :\nملحق خارجي + مجلس رجال + دورة مياة لمجلس الرجال + مقلط + صالة كبيرة + دورة مياة + غرفة كبار السن + مطبخ كبير راكب .\nالدور العلوي :\nغرفة م",
  "City": null,
  "Neighborhood": null,
  "Region": {
   "id": 1,
   "name": "الرياض"
  },
  "PropertyType": {
   "id": 2,
   "name": "فيلا",
   "category": "residential",
   "propertyFields": [
    "buildNumber",
    "floorsCount",
    "roomsCount",
    "bathrooms",
    "halls",
    "age",
    "saudiBuildingCode",
    "furnished",
    "propertyType"
   ]
  },
  "AdValidator": {
   "isValid": true,
   "advertisement": {
    "adLicenseNumber": "7200949696",
    "adSource": "الهيئة العامة للعقار",
    "advertisementType": "إيجار",
    "creationDate": "27/04/2026",
    "deedNumber": "498507020989",
    "endDate": "27/04/2027",
    "landNumber": "1840 / 1",
    "landTotalAnnualRent": null,
    "landTotalPrice": null,
    "location": {
     "region": "منطقة الرياض",
     "city": "الرياض",
     "district": "الصفاء",
     "postalCode": "12853",
     "additionalNumber": "4510",
     "street": null
    },
    "mainLandUseTypeName": "غير متوفر",
    "numberOfRooms": 7,
    "planNumber": "3203 / 1",
    "propertyAge": "جديد",
    "propertyArea": 300,
    "propertyFace": "شرقية",
    "propertyPrice": 190000,
    "propertyType": "فيلا",
    "propertyUtilities": [
     "كهرباء",
     "مياه",
     "صرف صحي"
    ],
    "streetWidth": 18,
    "titleDeedTypeName": "صك إلكتروني"
   }
  },
  "mediaFiles": [
   {
    "id": 2613,
    "filePath": "properties/media_44140_8398_1780565493.jpeg",
    "thumbnail": "thumbnails/media_78647_7247_1780565493.jpeg"
   }
  ]
 }
}
""")


def mapped(name: str) -> dict:
    """map_listing() on one captured record; fails loudly if that record was skipped."""
    row, category, why = mhs.map_listing(RECORDS[name])
    assert row is not None, f"{name} was skipped as {why!r} — the fixture should map"
    return row


def skipped(name: str) -> str:
    row, _category, why = mhs.map_listing(RECORDS[name])
    assert row is None, f"{name} mapped, but this fixture must be skipped"
    return why


# ══ 1. PRICE = SOURCE ════════════════════════════════════════════════════════════════════════════
def test_land_rent_stores_the_published_total_not_the_per_metre_rate():
    """THE SITE'S OWN HARDEST TRAP, and the mutation-verified one.

    id 3590 is a 9,958 m² plot for rent. The platform's `price` column and REGA's `propertyPrice`
    both hold 51 — the PER-METRE rate — because the platform's REGA import only ever copies
    `landTotalPrice` into its price field and this ad publishes `landTotalAnnualRent` instead. Its
    own detail page prints «السعر الاجمالى 51» and its own description prints «السعر: 507,858 ريال
    سعودي». Storing 51 as the annual rent is a 9,958× understatement.
    """
    rec = RECORDS["LAND_RENT_RATE_TRAP"]
    rega = rec["AdValidator"]["advertisement"]
    assert rec["price"] == "51" and rega["propertyPrice"] == 51          # what a naive read takes
    assert rega["landTotalAnnualRent"] == 507858                        # what the source publishes
    assert rega["landTotalPrice"] is None                              # the sale field is empty

    row = mapped("LAND_RENT_RATE_TRAP")
    assert row["price_annual"] == 507858, "the rent must be the source's own published total"
    assert row["price_per_meter"] == 51, "the per-metre rate is stored too, verbatim"
    # A RENT authoritatively has no sale total — see test_the_opposite_deal_side_is_cleared_not_dropped.
    assert row["price_total"] is db.AUTHORITATIVE_NULL
    # The period comes from the FIELD NAME — `landTotalAnnualRent` — and nothing is converted.
    assert row["rent_period"] == "annual"
    assert row["price_evidence"]["field"] == "AdValidator.advertisement.landTotalAnnualRent"
    assert row["price_evidence"]["raw"] == 507858
    assert row["price_evidence"]["stored"] == 507858


def test_nothing_is_ever_multiplied_even_when_the_product_would_match():
    """`landTotalAnnualRent` HAPPENS to equal propertyPrice × propertyArea on all 30 land rents.
    The stored number is still the published field. Proof: a fixture whose product is a float
    (5.94 × 84,252.99) would land on a different integer than any published one, and the guard is
    that `_land_total` returns a source key and `_money` only parses."""
    rec = RECORDS["LAND_RENT_RATE_TRAP"]
    rega = rec["AdValidator"]["advertisement"]
    assert rega["propertyPrice"] * rega["propertyArea"] == 507858       # the coincidence
    assert mhs._land_total(rega, "Rent") is rega["landTotalAnnualRent"]  # the SAME object, not a sum
    assert mhs._land_total(rega, "Buy") is None


def test_land_sale_stores_the_licence_total_the_page_prints():
    """id 3730 publishes both figures and they agree with the platform's own column (400,000 / 640).
    id 608 is the same shape where they DISAGREE: the platform rounded 229,125 to «230,000» in its
    own price column, while its detail page renders «السعر الاجمالى 229,125» (verified in a real
    browser). We publish the figure the page the user opens actually shows."""
    row = mapped("LAND_SALE_BOTH_FIGURES")
    assert (row["price_total"], row["price_per_meter"]) == (400000, 640)
    assert row["price_annual"] is db.AUTHORITATIVE_NULL
    assert row["rent_period"] is db.AUTHORITATIVE_NULL

    rounded = RECORDS["LAND_SALE_PLATFORM_ROUNDED"]
    assert rounded["price"] == "230,000"                                # the platform's own column
    assert rounded["AdValidator"]["advertisement"]["landTotalPrice"] == 229125
    row = mapped("LAND_SALE_PLATFORM_ROUNDED")
    assert row["price_total"] == 229125, "the detail page's own «السعر الاجمالى» figure"
    assert row["price_per_meter"] == 300


def test_non_land_headline_is_the_figure_the_detail_page_prints():
    """On a NON-land row the page renders `propertyPrice`, not the platform's `price` column. The two
    disagree on 24 of 2,827 rows; both were confirmed in a real browser.
        id 2379  platform 900,000    page «السعر الاجمالى 1,150,000»
        id 24    platform 33,350     page «السعر الاجمالى 35,000»  (and its own prose says
                                     «قيمة الإيجار السنوي: 35,000 ريال سعودي»)
    """
    assert RECORDS["APT_SALE_PAGE_SHOWS_LICENCE"]["price"] == "900,000"
    row = mapped("APT_SALE_PAGE_SHOWS_LICENCE")
    assert row["price_total"] == 1150000
    assert row["price_per_meter"] is None, "a non-land row publishes no meterPrice"
    assert row["price_evidence"]["field"] == "AdValidator.advertisement.propertyPrice"

    assert RECORDS["SHOWROOM_RENT_ANNUAL_IN_PROSE"]["price"] == "33,350"
    row = mapped("SHOWROOM_RENT_ANNUAL_IN_PROSE")
    assert row["price_annual"] == 35000


def test_the_opposite_deal_side_is_cleared_not_dropped():
    """`purpose` is the source STATING which side the ad is on, so a sale has no annual rent and a
    rent has no sale total. That must be written as db.AUTHORITATIVE_NULL, not plain None: an upsert
    DROPS a None key (db._unknown_must_not_overwrite_known), so a listing the broker re-published on
    the other side would keep its old figure and end up carrying two prices at once. Checked in both
    directions, and the sentinel is deliberately falsy so `is` is the only correct comparison."""
    sale = mapped("LAND_SALE_BOTH_FIGURES")
    assert sale["price_annual"] is db.AUTHORITATIVE_NULL
    assert sale["rent_period"] is db.AUTHORITATIVE_NULL
    assert sale["price_total"] == 400000

    rent = mapped("BUILDING_RENT_SILENT")
    assert rent["price_total"] is db.AUTHORITATIVE_NULL
    assert rent["price_annual"] == 150
    # Falsy but NOT None — a `== None` or `or` test would silently read it as "unknown".
    assert not sale["price_annual"] and sale["price_annual"] is not None


def test_a_source_published_price_is_never_second_guessed():
    """id 2295 asks 700 riyals for a 733 m² rest house. The platform's column and the REGA licence
    BOTH say 700 and the ad publishes no land total, so 700 is what the source published — an
    advertiser's data-entry error is still the source's number. A plausibility gate here would be
    the exact regression the owner banned: no hiding source-published prices."""
    rec = RECORDS["REST_HOUSE_SALE_TINY_PRICE"]
    assert rec["price"] == "700" and rec["AdValidator"]["advertisement"]["propertyPrice"] == 700
    row = mapped("REST_HOUSE_SALE_TINY_PRICE")
    assert row["price_total"] == 700
    assert row["price_per_meter"] is None


def test_money_parses_what_the_source_printed_and_nothing_else():
    """`_money` is a PARSER, never a calculator: comma-formatted strings, JSON floats truncated
    toward zero (never rounded up), Arabic-Indic digits, and NULL for anything unreadable."""
    assert mhs._money("400,000") == 400000
    assert mhs._money("507,858") == 507858
    assert mhs._money(507858.76) == 507858          # truncated, never 507859
    assert mhs._money(5.94) == 5
    assert mhs._money("٤٠٠٠") == 4000
    for empty in (None, "", "   ", "السعر عند الطلب", 0):
        assert mhs._money(empty) is None, f"{empty!r} must be NULL, never a guess"


# ══ 2. RENT PERIOD = SOURCE ══════════════════════════════════════════════════════════════════════
def test_two_periods_named_at_once_leaves_rent_period_null():
    """id 246 stores 25,000 while its own description says «خيارات تأجير : شهري - سنوي … شهريا 3000
    ألف ريال سنويا 36 ألف ريال». The shared token regex finds «شهري» FIRST, so an uncorroborated
    storage conversion would publish 300,000 for a 25,000 listing. Neither figure the prose prints
    is the one we store, so the period is UNKNOWN and the price stays verbatim."""
    rec = RECORDS["OFFICE_RENT_TWO_PERIODS"]
    assert "شهري" in rec["description"] and "سنوي" in rec["description"]
    # The shared parser, unguarded, really does want to multiply:
    assert normalize.rent_period_and_annual(25000, rec["description"]) == ("monthly", 300000)

    row = mapped("OFFICE_RENT_TWO_PERIODS")
    assert row.get("rent_period") is None, "two periods at once state nothing about one price"
    assert row["price_annual"] == 25000, "the price must be stored exactly as published"


def test_a_stated_monthly_period_is_honoured_when_the_prose_prints_that_very_figure():
    """The guard is a corroboration rule, not a ban. id 1982 says «الايجار شهري ٤٠٠٠» in
    ARABIC-INDIC digits beside a stored 4,000, so the prose provably describes that field: period
    monthly and the standard ×12 storage conversion applies (the app divides by 12 to display, so
    the shown figure is still the source's own 4,000)."""
    row = mapped("APT_RENT_MONTHLY_CORROBORATED")
    assert row["rent_period"] == "monthly"
    assert row["price_annual"] == 48000
    assert row["price_evidence"]["kind"] == "monthly"


def test_a_period_beside_the_wrong_number_is_refused():
    """NEAREST, NOT NEARBY — the fix for a real 12× overstatement that the loose ±90-char version of
    this rule shipped past. Both rows below publish TWO figures and a «شهري»; the one the period word
    is attached to is the closest one, and it is not the figure we store.

    MHS2403 «الايجار دفعتين : 35,000 الايجار الشهري : 3,300» — 35,000 is the annual rent paid in two
            instalments. The loose rule saw 35,000 inside its window and stored 35,000 × 12 = 420,000.
    MHS1834 «اجار شهري 5500 السنوي 65000» — 5,500 monthly, 65,000 annual; the structured field holds
            the annual. The loose rule stored 780,000.
    """
    for name, published in (("APT_RENT_TWO_INSTALMENTS_NOT_MONTHLY", 35000),
                            ("FLOOR_RENT_MONTHLY_AND_ANNUAL_BOTH_PRINTED", 65000)):
        rec = RECORDS[name]
        assert "شهري" in rec["description"]
        assert rec["AdValidator"]["advertisement"]["propertyPrice"] == published
        row = mapped(name)
        assert row.get("rent_period") is None, f"{name}: the period describes the OTHER figure"
        assert row["price_annual"] == published, f"{name}: the price must be stored as published"
        assert row["price_annual"] != published * 12


def test_nearest_number_picks_the_figure_the_token_is_attached_to():
    """The predicate on its own, over the exact strings measured on the nine converting-period rows:
    seven genuine statements (distance 1-6 chars) and the two that print another number closer."""
    W = mhs._WESTERN
    for prose, price, want in (
            ("الإيجار الشهري: 4000 شامل الكهرباء", 4000, True),
            ("الايجار شهري ٤٠٠٠", 4000, True),
            ("الإيجار: 3,000 ريال شهريًا", 3000, True),
            ("إيجار شهري: 12,000 ريال سعودي", 12000, True),
            ("الايجار دفعتين : 35,000 الايجار الشهري : 3,300", 35000, False),
            ("اجار شهري 5500 السنوي 65000", 65000, False),
            ("خيارات تأجير : شهري - سنوي السعر : شهريا 3000 ريال", 25000, False)):
        text = prose.translate(W)
        m = normalize._RENT_PERIOD_TOKEN_RE.search(text)
        assert m, prose
        got = mhs._period_describes_the_stored_figure(text, price, m.start(), m.end())
        assert got is want, f"{prose!r} with {price}: got {got}, want {want}"


def test_the_city_falls_back_to_the_licence_when_the_platform_relation_is_null():
    """id 575 ships `City: null` and `Neighborhood: null` while its REGA licence publishes city
    «الرياض» and district «الصفاء». That is the source stating the location in another field, not an
    inference, so the row is published rather than skipped as no_city. A record with NEITHER is still
    skipped — the fallback reads the source, it does not invent one."""
    rec = RECORDS["NO_CITY_RELATION_LICENCE_HAS_ONE"]
    assert rec["City"] is None and rec["Neighborhood"] is None
    assert rec["AdValidator"]["advertisement"]["location"]["city"] == "الرياض"
    row = mapped("NO_CITY_RELATION_LICENCE_HAS_ONE")
    assert (row["city_ar"], row["city_id"]) == ("الرياض", 3)
    assert row["neighborhood"] == "الصفاء"

    blind = json.loads(json.dumps(rec, ensure_ascii=False))
    blind["AdValidator"]["advertisement"]["location"]["city"] = None
    row2, _cat, why = mhs.map_listing(blind)
    assert row2 is None and why == "no_city"


def test_rent_period_silence_stays_null_and_the_price_is_unconverted():
    """id 3911 is a rent whose description is EMPTY and whose payload carries no period field of any
    kind. rent_period is NULL and the price is stored exactly as published — never annual by
    default, never scaled."""
    rec = RECORDS["BUILDING_RENT_SILENT"]
    assert not (rec.get("description") or "").strip()
    row = mapped("BUILDING_RENT_SILENT")
    assert row["transaction_type"] == "Rent"
    assert row.get("rent_period") is None
    assert row["price_annual"] == 150, "the source's own figure, unconverted"


def test_the_platform_states_no_period_anywhere_so_a_silent_rent_cannot_get_one():
    """`rentalUnits` is byte-identical on every record (a form enum, not a statement), and no
    fixture carries any per-listing period key. If a future payload adds one, this fails and the
    period rule gets re-read rather than silently inheriting prose-only behaviour."""
    period_keys = {"rentPeriod", "rentalUnit", "priceUnit", "period", "paymentPeriod",
                   "rentType", "priceType", "rentalPeriod"}
    for name, rec in RECORDS.items():
        assert not (period_keys & set(rec)), f"{name} now publishes a period field: {rec.keys()}"


# ══ 3. SOURCE IS TRUTH — absent is NULL, never False/0 ═══════════════════════════════════════════
def test_property_fields_gate_keeps_a_land_row_from_publishing_table_defaults():
    """id 3730's payload ships `bathrooms: 0, halls: 1, furnished: false, floorNumber: 0` while its
    own `PropertyType.propertyFields` is only ["plotNumber","meterPrice"] — the source declaring
    that this type asks neither. Those values are table defaults and none may reach a column."""
    rec = RECORDS["LAND_SALE_BOTH_FIGURES"]
    assert rec["PropertyType"]["propertyFields"] == ["plotNumber", "meterPrice"]
    assert (rec["bathrooms"], rec["halls"], rec["furnished"]) == (0, 1, False)

    row = mapped("LAND_SALE_BOTH_FIGURES")
    assert row["bathrooms"] is None
    assert row.get("furnished") is None, "a gated-out false must never become False"
    assert row.get("halls") is None
    assert row["floor_number"] is None
    # THE ONE THAT ACTUALLY BITES on this fixture. Land ships the placeholder buildNumber "0000"
    # and does not declare the field; ungated, 934 rows would store "0000" as a building number.
    assert rec["buildNumber"] == "0000"
    assert row["building_number"] is None
    assert row["additional_info"].get("apartment_number") is None    # apartmentNumber 0, undeclared
    assert row["additional_info"].get("source_halls_raw") is None    # halls 1, undeclared
    assert row["plan_parcel"] == "342"          # plotNumber IS declared, so it is read


def test_an_undeclared_meter_price_never_reaches_the_price_column():
    """THE GATE'S SHARPEST CASE, and it is a PRICE column. id 3749 is a 2,500,000 villa on 536.84 m²
    whose type does NOT declare `meterPrice` — and whose record ships `meterPrice: 9` anyway. Nine
    riyals per square metre is residue in an unused column, not a rate anyone published. Ungated it
    becomes a searchable price_per_meter; it is the only such row in the 2,827, which is exactly why
    a spot-check would miss it and the source's own declaration is what has to decide."""
    rec = RECORDS["VILLA_SALE_UNDECLARED_METER_PRICE"]
    assert rec["meterPrice"] == 9
    assert "meterPrice" not in rec["PropertyType"]["propertyFields"]
    row = mapped("VILLA_SALE_UNDECLARED_METER_PRICE")
    assert row["price_per_meter"] is None, "an undeclared field is not a published rate"
    assert row["price_total"] == 2500000
    # The declared fields on the SAME row are read normally — the gate is not a blanket refusal.
    assert row["building_number"] == "5489"
    assert row["property_age"] == 10               # «عشر سنوات», not the FK 11
    assert row["additional_info"]["total_rooms"] == 20


def test_a_declared_false_furnished_is_still_not_a_published_no():
    """Even where the type DECLARES `furnished`, the value is false on 1,018 records, true on 7 and
    null on 137 — a table default being submitted, not a market — and the detail page renders no
    furnished row at all. Positive-only: true → True, false → NULL (never a fabricated negative)."""
    rec = RECORDS["SHOWROOM_RENT_ANNUAL_IN_PROSE"]
    assert "furnished" in rec["PropertyType"]["propertyFields"]
    assert rec["furnished"] is False
    row = mapped("SHOWROOM_RENT_ANNUAL_IN_PROSE")
    assert row.get("furnished") is None
    assert row["additional_info"]["source_furnished_raw"] is False, "the raw value is still kept"


def test_roomscount_never_becomes_bedrooms():
    """«عدد الغرف» is a TOTAL-room count (it is REGA's numberOfRooms verbatim) and the string
    «غرف النوم» appears nowhere in the platform. bedrooms stays NULL; the figure is archived."""
    rec = RECORDS["APT_SALE_PAGE_SHOWS_LICENCE"]
    assert rec["roomsCount"] == 2 == rec["AdValidator"]["advertisement"]["numberOfRooms"]
    row = mapped("APT_SALE_PAGE_SHOWS_LICENCE")
    assert row.get("bedrooms") is None, "this platform publishes no bedroom count"
    assert row["additional_info"]["total_rooms"] == 2


def test_the_age_field_is_a_foreign_key_not_a_year_count():
    """`age: 13` means «جديد» — brand new, age 0. The shared parser cannot know that: given the int
    it returns 13, so a scraper that passes it publishes "13 years old" for every new property and
    nothing raises. The age is read from the WORD instead."""
    assert normalize.parse_property_age(13) == 13            # the silent trap
    row = mapped("APT_SALE_PAGE_SHOWS_LICENCE")
    assert RECORDS["APT_SALE_PAGE_SHOWS_LICENCE"]["age"] == 3
    assert RECORDS["APT_SALE_PAGE_SHOWS_LICENCE"]["AdValidator"]["advertisement"]["propertyAge"] == "سنتين"
    assert row["property_age"] == 2, "two years, from «سنتين» — not the FK 3"
    # And a row whose type never asks for an age keeps NULL rather than inheriting an id.
    assert mapped("LAND_SALE_BOTH_FIGURES")["property_age"] is None


def test_a_blanket_negative_utility_sets_no_column_false():
    """«لايوجد خدمات» (231 rows) says services are absent but names NONE of them, so it cannot make
    electricity/water/sanitation False. It is preserved as a raw word instead."""
    rec = RECORDS["LAND_RENT_RATE_TRAP"]
    assert rec["AdValidator"]["advertisement"]["propertyUtilities"] == ["لايوجد خدمات"]
    row = mapped("LAND_RENT_RATE_TRAP")
    for col in ("electricity", "water_supply", "sanitation", "optical_fibers"):
        assert col not in row, f"{col} must be UNKNOWN, not False"
    assert row["additional_info"]["utility_words"] == ["لايوجد خدمات"]
    # A NAMED utility, by contrast, is a positive the source stated.
    assert mapped("LAND_SALE_BOTH_FIGURES")["electricity"] is True


# ══ 4. LOCATION ══════════════════════════════════════════════════════════════════════════════════
def test_the_city_never_comes_from_the_title():
    """id 3730's title says «المدينة المنورة» (Medina) while its structured City, its REGA location
    and its own description all say «أحد رفيدة» (Asir). The structured field wins and the title is
    not consulted for location at all."""
    rec = RECORDS["LAND_SALE_BOTH_FIGURES"]
    assert "المدينة المنورة" in rec["title"] and rec["City"]["name"] == "أحد رفيدة"
    row = mapped("LAND_SALE_BOTH_FIGURES")
    assert row["city_ar"] == "أحد رفيدة"
    assert (row["city_id"], row["region_id"]) == (65, 6)
    assert row["district_ar"] == "حي الصوامع"


def test_the_region_hint_uses_the_licence_spelling_so_a_twin_resolves():
    """loc_catalog_region stores «منطقة القصيم»; the platform's own `Region.name` is the BARE
    «القصيم», which the shared hint resolver cannot match (it strips a «منطقة » prefix, it never
    adds one). Passing the bare form first left 33 real rows unresolved. البدائع is a genuine twin
    (Hail 2358 / Qassim 2481), so only the licence spelling separates them."""
    assert al._hint_to_id("القصيم") is None, "the bare region name is not a resolvable hint"
    assert al._hint_to_id("منطقة القصيم") == 4
    assert mhs._land_total({}, "Buy") is None       # unrelated key absent → None, never a KeyError


# ══ 5. DEAL TYPE IS NEVER GUESSED ════════════════════════════════════════════════════════════════
def test_an_investment_listing_is_skipped_not_parked_as_a_buy():
    assert skipped("INVESTMENT_NOT_A_DEAL") == "purpose_not_a_deal_for_investment"


def test_two_contradicting_source_fields_are_not_a_deal_type():
    """id 554 publishes `purpose:"for_sale"` while its licence says `advertisementType:"إيجار"` and
    its own title says «شقة للايجار». Filing it under either side would publish a guess."""
    rec = RECORDS["PURPOSE_CONTRADICTS_LICENCE"]
    assert rec["purpose"] == "for_sale"
    assert rec["AdValidator"]["advertisement"]["advertisementType"] == "إيجار"
    assert skipped("PURPOSE_CONTRADICTS_LICENCE") == "purpose_contradicts_licence"


def test_type_mapping_covers_every_word_the_platform_publishes():
    """All 22 `PropertyType.name` values seen across the 2,827-row catalogue, with their counts. Each
    override reuses another live scraper's decision (named in run.py) rather than inventing one.
    «غرف عزاب» maps to Room AND carries the source's own tenant category."""
    expected = {
        "ارض": "Residential Land", "شقة": "Apartment", "فيلا": "Villa", "دور": "Floor",
        "عمارة سكنية": "Building", "استراحة": "Rest House", "معرض": "Showroom", "مكتب": "Office",
        "مزرعة": "Farm", "مستودع": "Warehouse", "مجمع تجاري ": "Commercial Building",
        "ارض تجاري": "Commercial Land", "محطة وقود": "Gas Station", "غرف عزاب": "Room",
        "ورشة ": "Workshop", "ستوديو": "Studio", "فندق": "Hotel", "تاون هاوس": "Villa",
        "مصنع": "Factory", "محل تجاري": "Shop", "دوبلكس": "Duplex",
        "مستشفى - مركز صحي": "Health Center",
    }
    import re as _re
    for word, canonical in expected.items():
        key = _re.sub(r"\s+", " ", word).strip()
        got = normalize.map_type_exact(key, mhs._TYPE_OVERRIDES)
        assert got == canonical, f"{word!r} mapped to {got!r}, expected {canonical!r}"


def test_an_unknown_type_word_skips_rather_than_guessing():
    rec = dict(RECORDS["LAND_SALE_BOTH_FIGURES"])
    rec["PropertyType"] = dict(rec["PropertyType"], name="بيت شعر")
    row, _cat, why = mhs.map_listing(rec)
    assert row is None and why.startswith("type_unmapped_")


def test_a_bachelor_rooms_row_carries_the_sources_own_tenant_category():
    assert mhs._TENANT_FROM_TYPE["غرف عزاب"] == "عزاب"


# ══ 6. NO AUCTIONS — and no off-plan HEURISTIC ═══════════════════════════════════════════════════
def test_an_auction_ad_is_skipped_with_a_counted_reason():
    """0 of 2,827 titles and 0 of 1,840 descriptions say «مزاد» today, so this is a guard rather
    than a path — and it must stay one."""
    rec = dict(RECORDS["LAND_SALE_BOTH_FIGURES"])
    rec["description"] = "أرض ممتازة تُطرح في مزاد علني يوم الخميس"
    row, _cat, why = mhs.map_listing(rec)
    assert row is None and why == "auction"


def test_prose_about_a_neighbouring_construction_site_is_not_an_off_plan_skip():
    """THE MEASUREMENT THAT DELETED A REGEX. Over all 2,827 descriptions, «على الخارطة/الخريطة»,
    «تحت/قيد الإنشاء», a %-figure, «محجوز» and «مباع» matched 20 rows; SEVENTEEN were about something
    that is not the property or not a construction stage at all — the platform's own «نأمل مطابقة
    الموقع على الخريطة» boilerplate, Google Maps links, a mosque/university/school/lake being built
    nearby, a 2.5% commission, 80% of the furniture, and one sold FLOOR of a live multi-unit ad. The
    source publishes no construction-stage field to key on instead, so there is no off-plan skip and
    these rows are published as the ready properties they are."""
    for prose in ("نأمل مطابقة الموقع على الخريطة مع الموقع حسب الصك",
                  "الموقع على الخريطة: https://maps.app.goo.gl/abc",
                  "مقابل مشروع فرع جامعة طيبة (تحت الإنشاء)",
                  "مقابل مسجد تحت الإنشاء",
                  "مدرسة قيد الإنشاء بالقرب من المشروع",
                  "3,100,000 ريال + 2.5% سعي",
                  "البيع مع تقريبا 80 % من الأثاث",
                  "الدور الأرضي *مباع* الدور العلوي مساحة ١٨٥م",
                  "والبيع من المالك مباشرة 100%",
                  "تشطيب قائم ومكتمل بنسبة 70%"):
        rec = dict(RECORDS["LAND_SALE_BOTH_FIGURES"], description=prose)
        row, _cat, why = mhs.map_listing(rec)
        assert row is not None, f"{prose!r} was wrongly skipped as {why!r}"


def test_the_genuinely_under_construction_rows_are_published_as_the_source_publishes_them():
    """id 3220 describes ITSELF as «للبيع فيلا تحت الانشاء» (ids 3697 and 2231 do the same). The
    platform lists all three as ordinary `available` sales with full REGA licences, so we publish
    them and raise the question rather than inventing a source distinction. Even on its best pattern
    the prose regex was 3 right out of 9. This test exists so that decision is visible and
    reversible, not accidental."""
    rec = RECORDS["VILLA_SALE_PROSE_SAYS_UNDER_CONSTRUCTION"]
    assert "تحت الانشاء" in rec["description"]
    assert rec.get("status", "available") == "available"
    row = mapped("VILLA_SALE_PROSE_SAYS_UNDER_CONSTRUCTION")
    assert row["active"] is True and row["transaction_type"] == "Buy"


# ══ 7. PDPL ══════════════════════════════════════════════════════════════════════════════════════
from scrapers.common.pii import redact_pii  # noqa: E402

_PII_KEY_NAMES = ("phoneNumber", "advertiserName", "advertiserId", "responsibleEmployeeName",
                  "responsibleEmployeePhoneNumber", "brokerageAndMarketingLicenseNumber",
                  "adCreator", "Agent", "ownerId", "qrLink", "mobile", "avatar")
_PII_VALUES = ("0542037990", "0535000304", "مؤسسة الأرض المميزة العقارية",
               "عمر احمد عبدالله العسيري", "broker@example.com", "wa.me/966555754441",
               "7038313230", "1200025384", "qr/qr_1789568166_3422.png")


def test_pdpl_a_poisoned_record_leaks_nothing_into_any_stored_payload():
    """Every PII shape this platform really publishes, injected into ONE record: the REGA block's own
    contact keys, the `adCreator.User` broker record the rendered page shows
    («محمد سليمان محمد الحميد | 0535000304»), an `Agent`, a QR path, and an advertiser's own phone,
    WhatsApp link and email written into the prose. Nothing may reach a column, additional_info or
    source_capture — and the assertion walks the WHOLE serialised row, so a key nested anywhere is
    caught, not just a top-level one."""
    rec = json.loads(json.dumps(RECORDS["LAND_SALE_BOTH_FIGURES"], ensure_ascii=False))
    rec["AdValidator"]["advertisement"].update({
        "phoneNumber": "0542037990",
        "advertiserName": "مؤسسة الأرض المميزة العقارية",
        "advertiserId": "7038313230",
        "responsibleEmployeeName": "عمر احمد عبدالله العسيري",
        "responsibleEmployeePhoneNumber": "0542037990",
        "brokerageAndMarketingLicenseNumber": "1200025384",
        "notes": "للتواصل 0542037990 أو broker@example.com",
    })
    rec["AdValidator"]["qrLink"] = "qr/qr_1789568166_3422.png"
    rec["adCreator"] = {"id": 3836, "ownerType": "broker",
                        "User": {"id": 4424, "name": "محمد سليمان محمد الحميد",
                                 "mobile": "0535000304", "avatar": None}}
    rec["Agent"] = {"id": 3, "name": "منصور", "mobile": "0535000304", "avatar": None}
    rec["ownerId"] = 3836
    rec["title"] = "أرض للبيع - للتواصل 0542037990"
    rec["description"] = ("أرض سكنية ممتازة\nواتساب: https://wa.me/966555754441\n"
                          "جوال 0542037990\nbroker@example.com")

    row, _cat, why = mhs.map_listing(rec)
    assert row is not None, f"the poisoned record must still map, not skip ({why})"
    blob = json.dumps(row, ensure_ascii=False, default=str)
    for key in _PII_KEY_NAMES:
        assert f'"{key}"' not in blob, f"PII key {key!r} reached a stored payload"
    for value in _PII_VALUES:
        assert value not in blob, f"PII value {value!r} reached a stored payload"
    # The listing CONTENT survives, redacted — PDPL removes contact data, not the ad.
    assert "أرض سكنية ممتازة" in row["description"]
    assert "[redacted]" in row["description"]
    # And the regulatory numbers, which are NOT contact data, are untouched.
    assert row["license_number"] == "7200751603"
    assert row["additional_info"]["deed_number"] == "362035001471"


def test_every_captured_record_is_pii_free_as_shipped():
    """The allowlists, checked against the real payloads rather than a constructed one: no captured
    record leaks a contact key or a phone-shaped string out of a FREE-TEXT field."""
    for name in RECORDS:
        row, _cat, _why = mhs.map_listing(RECORDS[name])
        if row is None:
            continue
        blob = json.dumps(row, ensure_ascii=False, default=str)
        for key in _PII_KEY_NAMES:
            assert f'"{key}"' not in blob, f"{name}: PII key {key!r} reached a stored payload"
        for field in ("title", "description"):
            text = row.get(field)
            if text:
                # The right oracle is "the redactor finds nothing left to remove", NOT byte-identity:
                # redact_pii also collapses whitespace, and one real title («معرض رقم (2)  للإيجار»)
                # carries a double space, so an equality check would fail on punctuation.
                assert "[redacted]" not in text, f"{name}: {field} was stored un-redacted"
                assert redact_pii(text) == redact_pii(redact_pii(text))


# ══ 8. THE REMOVAL ORACLE ════════════════════════════════════════════════════════════════════════
_GONE = '{"status":"fail","error_number":229,"msg":"لم يتم العثور على العقار"}'
_LIVE = '{"status":"success","property":{"id":3730,"purpose":"for_sale"}}'


def test_only_the_platforms_own_not_found_code_is_a_death():
    """Measured: 14 randomly sampled ids absent from the catalogue plus fabricated 0 / 4,200 /
    999,999 all answered HTTP 400 with `error_number` 229, and every live id answered 200 with its
    own record. The signal is keyed on THAT code, never on the bare 400 — a 400 from a schema change,
    a WAF or a rejected query shape says nothing about the listing."""
    assert mhs._signal(400, _GONE, False) == "gone"
    assert mhs._signal(200, _LIVE, False) == "live"
    assert mhs._signal(400, '{"status":"fail","error_number":9,"msg":"شيء آخر"}', False) is None
    assert mhs._signal(400, '{"message":"Bad Request"}', False) is None
    assert mhs._signal(400, "", False) is None
    assert mhs._signal(200, '{"status":"success","property":null}', False) is None
    assert mhs._signal(200, "<html>a rate-limit page</html>", False) is None


def test_the_shared_law_still_refuses_a_death_on_a_read_that_cannot_bear_one():
    """This platform DOES rate-limit (987 of 2,827 detail fetches drew 429 on a first full walk), so
    the law's 429 rule is load-bearing here rather than theoretical: even if the body somehow carried
    the not-found code, a throttled or broken read can never kill a row."""
    from scrapers.common.http_liveness import decide, read_is_unbelievable
    for status in (401, 403, 408, 429, 500, 502, 503):
        assert read_is_unbelievable(status, _GONE) is not None
        assert decide(status, _GONE, False, mhs._signal) is None
    assert read_is_unbelievable(None, "") is not None
    assert decide(400, "", False, mhs._signal) is None          # empty body → never a verdict
    assert decide(400, _GONE, False, mhs._signal) == (
        "gone", "source confirms removal (HTTP 400)")


def test_the_listing_page_is_deliberately_not_the_oracle():
    """The SPA answers 200 with the same 3,399-byte shell for /propertydetails/<any id>, /robots.txt
    and /anything — so the oracle probes the API record the page itself loads, and `url_for` points
    at `retrieve/<id>` rather than at listing_url."""
    probe = mhs._make_verify_gone(None)
    assert mhs.map_listing(RECORDS["LAND_SALE_BOTH_FIGURES"])[0]["listing_url"] == (
        "https://aqaralmuhaysini.com/propertydetails/3730")
    verdict, why = probe("NOTAPREFIX999")
    assert verdict == "unknown" and "MHS" in why


def test_a_removal_is_withheld_when_there_is_no_positive_control():
    """Fails CLOSED: with no row from this run to check the source against, no removal is confirmed
    — the canary cannot answer, so the verdict is UNKNOWN even on a believable 'gone' read."""
    probe = mhs._make_verify_gone(None)

    class _Resp:
        status_code, text, url = 400, _GONE, "https://backend.aqaralmuhaysini.com/x"

    class _S:
        def get(self, *a, **k):
            return _Resp()

    original = mhs.session
    mhs.session = lambda: _S()
    try:
        verdict, why = probe("MHS999999")
    finally:
        mhs.session = original
    assert verdict == "unknown"
    assert "removal withheld" in why and "positive control" in why


# ══ 9. THE WALK ══════════════════════════════════════════════════════════════════════════════════
def test_the_walk_only_claims_complete_when_it_reached_the_end():
    """There is no `total` to stop against, so `complete` is what gates pruning and it must be earned.
    A short page or an empty page IS the end; a --limit, a repeated page and the MAX_PAGES cap are
    not, and each leaves complete=False so db.prune_unseen is never reached."""
    calls = []

    def fake(pages):
        def _get(_s, url, *, what, tries=4):
            calls.append(url)
            n = int(url.rsplit("=", 1)[1])
            return {"properties": pages[n - 1] if n <= len(pages) else []}
        return _get

    original = mhs._get_json
    try:
        # two full pages then a short one → the end
        mhs._get_json = fake([[{"id": i} for i in range(30)],
                              [{"id": 100 + i} for i in range(30)],
                              [{"id": 200 + i} for i in range(7)]])
        items, complete = mhs.fetch_catalogue(None)
        assert len(items) == 67 and complete is True

        # a page that repeats itself → stop, and do NOT claim complete
        page = [{"id": i} for i in range(30)]
        mhs._get_json = fake([page, page])
        items, complete = mhs.fetch_catalogue(None)
        assert len(items) == 30 and complete is False

        # the cap → stop, do NOT claim complete (so a runaway can never prune)
        mhs._get_json = lambda _s, url, *, what, tries=4: {
            "properties": [{"id": f"{url.rsplit('=', 1)[1]}-{i}"} for i in range(30)]}
        items, complete = mhs.fetch_catalogue(None)
        assert complete is False
        assert len(items) == mhs.MAX_PAGES * 30

        # --limit → never complete
        mhs._get_json = fake([[{"id": i} for i in range(30)]])
        items, complete = mhs.fetch_catalogue(None, limit=5)
        assert len(items) == 5 and complete is False
    finally:
        mhs._get_json = original


# ══ 10. THE ROW ITSELF ════════════════════════════════════════════════════════════════════════════
def test_photos_are_absolute_and_prefer_the_full_size_path():
    row = mapped("APT_SALE_PAGE_SHOWS_LICENCE")
    for url in row["photo_urls"]:
        assert url.startswith("https://backend.aqaralmuhaysini.com/uploads/")
    assert row["images_evidence"]["count"] == len(row["photo_urls"])


def test_the_row_carries_the_licence_facts_and_the_ad_number_shape():
    row = mapped("LAND_SALE_BOTH_FIGURES")
    assert row["ad_number"] == "MHS3730"
    assert row["source"] == "أحمد المحيسني العقارية"
    assert row["license_number"] == "7200751603"
    assert row["license_expiry"] == "06/11/2026"
    assert row["rega_location_verified"] is True
    assert row["ad_source"] == "الهيئة العامة للعقار"
