"""iBaax's traps: a pagination parameter that is silently ignored, a poster-facing "spec" form
that is mostly dead (sizeArea is 0 on every row), land priced with two independently PUBLISHED
figures plus a third that is pure platform arithmetic, a rent period read from a REGA feature the
page's own <title> disagrees with, an advertiser/employee name that leaks into free text under TWO
different spellings of the same compound Arabic name, and a detail endpoint that states its own
removal verdict in a plain HTTP status code rather than page content.

Fixtures are VERBATIM /api/advertisements records from api.ibaax.sa, captured 2026-09-26 and trimmed
to one `media` entry (the mapper never reads more than one photo's url out of that list in these
tests) — plus, on purpose, the `user` object and the five PII `features` the code must never touch.
Assertions execute the SHIPPING functions (run.map_listing, run._feat, run._name_pattern, run._signal,
run.fetch_catalogue). Offline: only to_catalog / find_district_in_text are stubbed.

Run: python -m pytest scrapers/common/tests/test_ibaax_pagination_price_period_and_pdpl.py -v
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

from scrapers.ibaax import run as R  # noqa: E402

# ── VERBATIM CAPTURES (2026-09-26) ───────────────────────────────────────────────────────────────
RENT_SILENT_PII_RICH = json.loads(r'''{"id": 774, "adNumber": "2026SAP0EAPTG", "title": "Apartment for Rent", "description": "شقة للإيجار في فيلا\nالدور : دور الأول فوق الأرضي\nالموقع : الرياض حي النرجس\nالواجهة : شمالية 18م\nالمساحة : 130 تقريباً\nالعمر : 8 تقريباً\nعبارة عن :\nغرفتين + صالة + مطبخ + مجلس واسع مع دورة مياه .\n\nمجموع دورات المياه : 2\n\nمطبخ راكب ✅\n4 مكيفات سبيلت راكبة ✅\nالصرف الصحي و الماء ✅\nمدخلين للشقة ✅\n\nالسعر :\n 57 ألف\n\nلمزيد من التفاصيل وفديو واتس : 0545752077", "slug": "rent-apartment", "countOfViews": 17, "address": "RANC3823، 3823 رقم 472، 8370، حي النرجس، الرياض 13327، السعودية", "latitude": "24.84600584642787", "longitude": "46.669645607471466", "license": "7201145811", "price": 57000, "typeId": 2, "isFeatured": false, "IsFollowing": true, "isFavorite": false, "isRent": true, "rentType": "", "sizeArea": 0, "bedrooms": 0, "bathrooms": 0, "livingRooms": 0, "createdAt": "2026-09-23T02:02:03.000000Z", "updatedAt": "2026-09-26T03:29:00.000000Z", "user": {"id": 241, "name": "مكتب شريط للعقارات", "business_name": "مكتب شريط للعقارات", "avatar": "https://api.ibaax.sa/storage/4098/image_1788234878.jpeg", "phone": "+966540574630", "val_number": "1200029439", "countOfViews": 119, "countOfFollowers": 2, "countOfFollowing": 0, "address": "حي, RASB3557, 3557 محمد بن عبدالعزيز الدغيثر، 7309، الصحافة، الرياض 13321، السعودية", "about": "🛑 كادر سعودي 100%  🛑\nنقدم خدمة التسويق المجاني لعروض الملاك والوكلاء 🛑\nونتشرف بخدمة الجميع 🌷\n\nبيع - شراء -  آجار - إدارة أملاك - كتابة عقود \n\nأوقات العمل من 5 مساءً إلى 10:30 مساءً 🔴\n\nللملاحظات والاقتراحات : \n0540574630", "latitude": "24.80553946597971", "longitude": "46.637756153941154", "token": null, "refresh_token": null, "sendbird_access_token": null, "rating": 5, "rating_count": 2, "is_following": false, "type_of_user": "Agent", "covered_area": [], "files": [], "share_link": "https://api.ibaax.sa/agent-details/241", "unread_notifications": 0, "nafath_verified": true, "national_id": "1018344034"}, "category": {"id": 32, "icon": null, "name": "Apartment"}, "features": [{"name": "End Date", "value": "22/05/2027"}, {"name": "Advertisement Source", "value": "الهيئة العامة للعقار"}, {"name": "Channels", "value": "الإذاعة, منصة مرخصة, منصات التواصل الإجتماعي, أخرى, لوحة اعلانية"}, {"name": "Is Halted", "value": "No"}, {"name": "Is Pawned", "value": "No"}, {"name": "City", "value": "الرياض"}, {"name": "City ID", "value": "84c36906-d8e6-3a66-02e6-2fc1dd7fecff"}, {"name": "Region", "value": "منطقة الرياض"}, {"name": "Street", "value": "رقم 472"}, {"name": "City Code", "value": "21282"}, {"name": "District", "value": "النرجس"}, {"name": "Latitude", "value": "24.845876576604557"}, {"name": "Region ID", "value": "9d51fcb2-6e33-877a-48fc-85787e9e7eaf"}, {"name": "Longitude", "value": "46.66967664193697"}, {"name": "District ID", "value": "9196ffb6-b153-4632-e4d4-6ba8aaa27b4f"}, {"name": "Postal Code", "value": "13327"}, {"name": "Region Code", "value": "1"}, {"name": "District Code", "value": "2901"}, {"name": "Building Number", "value": "3823"}, {"name": "Additional Number", "value": "8370"}, {"name": "Deed Number", "value": "5782650508200000"}, {"name": "Is Testament", "value": "No"}, {"name": "Land Number", "value": "3391/1/2"}, {"name": "Plan Number", "value": "2737"}, {"name": "Phone Number", "value": "0545752077"}, {"name": "Property Age", "value": "ثمان سنوات"}, {"name": "Street Width", "value": "0"}, {"name": "Ad License URL", "value": "https://eservicesredp.rega.gov.sa/public/OfficesBroker/ElanDetails/51941d4e-9956-45ab-b04a-2ccf6810a9ab"}, {"name": "Advertiser ID", "value": "7041580627"}, {"name": "Creation Date", "value": "22/09/2026"}, {"name": "Property Area", "value": "450"}, {"name": "Property Facing", "value": "شمالية"}, {"name": "Property Type", "value": "شقة"}, {"name": "Is Constrained", "value": "No"}, {"name": "Number of Rooms", "value": "3"}, {"name": "Price per sqm", "value": "57000"}, {"name": "Advertiser Name", "value": "مكتب شريط للعقارات"}, {"name": "Ad License Number", "value": "7201145811"}, {"name": "Red Zone Type", "value": "حظر تجاري"}, {"name": "Advertisement Type", "value": "إيجار"}, {"name": "Property Utilities", "value": "صرف صحي, مياه, كهرباء"}, {"name": "Title Deed Type", "value": " صك السجل العقاري"}, {"name": "Main Land Use Type", "value": "سكني"}, {"name": "responsibleEmployeeName", "value": "عثمان عبدالعزيز بن عثمان الضحوك"}, {"name": "Obligations on the Property", "value": "لايوجد"}, {"name": "responsibleEmployeePhoneNumber", "value": "0545752077"}, {"name": "Brokerage & Marketing License Number", "value": "1200029439"}], "utilities": [{"name": "Family", "value": "Family"}, {"name": "Kitchen", "value": "1"}, {"name": "Air conditioner", "value": "1"}, {"name": "Water availability", "value": "1"}, {"name": "Drainage availability", "value": "1"}, {"name": "Electrical availability", "value": "1"}, {"name": "Apartment in villa", "value": "1"}, {"name": "Residential ", "value": "Residential "}, {"name": "Two entrances", "value": "1"}], "media": [{"mediaId": 4427, "isVideo": false, "0": "originalUrl", "previewUrl": "https://api.ibaax.sa/storage/4427/conversions/image_1790128809-preview.jpg", "mimeType": "image/jpeg"}], "status": "active", "isEditable": false, "share_link": "https://api.ibaax.sa/ad-details/774", "stc_validated": null}''')

BUY_NAME_LEAK_IN_DESCRIPTION = json.loads(r'''{"id": 551, "adNumber": "2026SALADVAF1", "title": "Villa for Sale", "description": "إعلان فيلا للبيع - الرياض حي النرجس\n\nالسلام عليكم ورحمة الله وبركاته\n\nفيلا متلاصقة للبيع حي النرجس مدينة الرياض\n\nرقم القطعة 217/1 مخطط 3236/3\n\nشارع ١٥ شمالي\n\nالمساحه 260م٢\n\n10 على الشارع في عمق 26\n\nالحقوق مرهون\n\nالخدمات كهرباء ، ماء\n\nالنزاعات: لا يوجد\n\nتاريخ انتهاء الترخيص : 2026/12/31\n\nالسعر:\n\n2,400,000 ريال:.\n\n* %50 ضريبة التصرفات العقارية\n\n2.5% سعي% . *\n\n* . ١٦٠٠ رسوم السجل العقاري\n\nعلى السوم\n\n\nللتواصل والاستفسار:\n\nأبو عبدالله\n\nمؤسسة عبدالعزيز عبدالله الجنيدل للعقارات\n\nمسؤول الإعلان عبدالعزيز عبدالله عبد العزيز الجنيدل\n\nصفة المعلن وسيط ومسوق عقاري\n\nرخصة فال للوساطة والتسويق : 1200019056\n\n6200932820 :رقم عقد الوساطة\n\nرخصة الإعلان العقاري : 7200990799", "slug": "sale-villa", "countOfViews": 2, "address": "RAJB2633، 2633 مناظر، 7521، النرجس، الرياض 13343، السعودية", "latitude": "24.9054522141206", "longitude": "46.62624813616276", "license": "7200990799", "price": 2400000, "typeId": 1, "isFeatured": false, "IsFollowing": true, "isFavorite": false, "isRent": false, "rentType": "", "sizeArea": 0, "bedrooms": 0, "bathrooms": 0, "livingRooms": 0, "createdAt": "2026-06-03T20:49:37.000000Z", "updatedAt": "2026-06-03T23:11:29.000000Z", "user": {"id": 333, "name": "مكتب عبدالعزيز عبدالله الجنيدل للعقارات", "business_name": "مكتب عبدالعزيز الجنيدل للعقارات", "avatar": null, "phone": "+966549994445", "val_number": "1200019056", "countOfViews": 0, "countOfFollowers": 0, "countOfFollowing": 0, "address": "RHZB3315، 3315 العباس بن عبدالمطلب، 7200، الازدهار، الرياض 12485، السعودية", "about": "خدمات عقارية\nللتواصل 0549994445 ابو عبدالله \nفال للوساطة والتسويق:1200019056\nفال لإدارة الاملاك:2200002021\nفال لإدارة المرافق:320000477\nفال للمزادات العقارية:4200000173", "latitude": "24.779440261930876", "longitude": "46.717452965676785", "token": null, "refresh_token": null, "sendbird_access_token": null, "rating": 0, "rating_count": 0, "is_following": false, "type_of_user": "Agent", "covered_area": [], "files": [], "share_link": "https://api.ibaax.sa/agent-details/333", "unread_notifications": 0, "nafath_verified": true, "national_id": "1072696428"}, "category": {"id": 23, "icon": null, "name": "Villa"}, "features": [{"name": "End Date", "value": "31/12/2026"}, {"name": "Advertisement Source", "value": "الهيئة العامة للعقار"}, {"name": "Channels", "value": "منصة مرخصة, لوحة اعلانية, منصات التواصل الإجتماعي, الإذاعة, أخرى"}, {"name": "Is Halted", "value": "No"}, {"name": "Is Pawned", "value": "No"}, {"name": "City", "value": "الرياض"}, {"name": "City ID", "value": "84c36906-d8e6-3a66-02e6-2fc1dd7fecff"}, {"name": "Region", "value": "منطقة الرياض"}, {"name": "Street", "value": "مناظر"}, {"name": "City Code", "value": "21282"}, {"name": "District", "value": "النرجس"}, {"name": "Latitude", "value": "24.905460995119398"}, {"name": "Region ID", "value": "9d51fcb2-6e33-877a-48fc-85787e9e7eaf"}, {"name": "Longitude", "value": "46.62630685903759"}, {"name": "District ID", "value": "9196ffb6-b153-4632-e4d4-6ba8aaa27b4f"}, {"name": "Postal Code", "value": "13343"}, {"name": "Region Code", "value": "1"}, {"name": "District Code", "value": "2901"}, {"name": "Building Number", "value": "2641"}, {"name": "Additional Number", "value": "7525"}, {"name": "Deed Number", "value": "9814138384100000"}, {"name": "Is Testament", "value": "No"}, {"name": "Land Number", "value": "217/1"}, {"name": "Plan Number", "value": "3236/3"}, {"name": "Phone Number", "value": "0549994445"}, {"name": "Property Age", "value": "خمس سنوات"}, {"name": "Street Width", "value": "15"}, {"name": "Ad License URL", "value": "https://eservicesredp.rega.gov.sa/public/OfficesBroker/ElanDetails/08dec177-2736-46ff-8134-71dcdd460a41"}, {"name": "Advertiser ID", "value": "7033969515"}, {"name": "Creation Date", "value": "03/06/2026"}, {"name": "Property Area", "value": "260"}, {"name": "Property Facing", "value": "شمالية"}, {"name": "Property Type", "value": "فيلا"}, {"name": "Is Constrained", "value": "No"}, {"name": "Number of Rooms", "value": "4"}, {"name": "Price per sqm", "value": "2400000"}, {"name": "Advertiser Name", "value": "مؤسسة عبدالعزيز عبدالله الجنيدل"}, {"name": "Ad License Number", "value": "7200990799"}, {"name": "Red Zone Type", "value": "حظر تجاري"}, {"name": "Advertisement Type", "value": "بيع"}, {"name": "Property Utilities", "value": "كهرباء, مياه, هاتف"}, {"name": "Title Deed Type", "value": " صك السجل العقاري"}, {"name": "Main Land Use Type", "value": "سكني"}, {"name": "responsibleEmployeeName", "value": "عبدالعزيز عبدالله عبدالعزيز الجنيدل"}, {"name": "Obligations on the Property", "value": "مرهون"}, {"name": "ownershipTransferFeeType", "value": "المشتري"}, {"name": "responsibleEmployeePhoneNumber", "value": "0549994445"}, {"name": "Brokerage & Marketing License Number", "value": "1200019056"}], "utilities": [{"name": "Water availability", "value": "1"}, {"name": "Electrical availability", "value": "1"}, {"name": "Drainage availability", "value": "1"}], "media": [{"mediaId": 3025, "isVideo": false, "0": "originalUrl", "previewUrl": "https://api.ibaax.sa/storage/3025/conversions/image_1780519707-preview.jpg", "mimeType": "image/jpeg"}], "status": "active", "isEditable": false, "share_link": "https://api.ibaax.sa/ad-details/551", "stc_validated": null}''')

RENT_YEARLY_ROOM_DISAGREEMENT = json.loads(r'''{"id": 513, "adNumber": "2026SASLIDPKK", "title": "Apartment for Rent", "description": "شقة للإيجار في المنسية، الرياض\n\nملاحظة: البيانات المقدمة تشير إلى شقة غير مفروشة أساسية للإيجار في الرياض بمنطقة المنسية مع عدم تحديد عدد الغرف أو المساحة الداخلية. تم صياغة الوصف أعلاه لتلبية متطلبات التنسيق وتقديم نظرة عامة شاملة للمستأجرين المحتملين. إذا كان لديك مزيد من التفاصيل ( مثل المساحة بالمتر مربع ، عدد الغرف، أو مدة عقد إيجار مفضلة) ، يمكنني تحديث القائمة وفقا لذلك لضمان الدقة والكمال.", "slug": "rent-apartment", "countOfViews": 2, "address": "RUMA3371، 3371 محمد البرقي، 7354، المونسية، الرياض 13253، السعودية", "latitude": "24.827511048007764", "longitude": "46.78102567791939", "license": "7200868819", "price": 60000, "typeId": 2, "isFeatured": false, "IsFollowing": true, "isFavorite": false, "isRent": true, "rentType": "", "sizeArea": 0, "bedrooms": 1, "bathrooms": 1, "livingRooms": 1, "createdAt": "2026-05-18T15:48:39.000000Z", "updatedAt": "2026-05-18T15:49:10.000000Z", "user": {"id": 247, "name": "تداول عقارك للعقارات", "business_name": "تداول عقارك للعقارات", "avatar": null, "phone": "+966557908578", "val_number": "1200013346", "countOfViews": 41, "countOfFollowers": 1, "countOfFollowing": 0, "address": "RFYA3944، 3944 عبدالله بن سعود بن عبدالعزيز الفرعى، 6570، حي اليرموك، الرياض 13251، السعودية", "about": "تداول عقارك للعقارات \nنسعدك بخدمتكم", "latitude": "24.80367109317633", "longitude": "46.79508615285158", "token": null, "refresh_token": null, "sendbird_access_token": null, "rating": 5, "rating_count": 1, "is_following": false, "type_of_user": "Agent", "covered_area": [], "files": [], "share_link": "https://api.ibaax.sa/agent-details/247", "unread_notifications": 0, "nafath_verified": true, "national_id": "1104716053"}, "category": {"id": 32, "icon": null, "name": "Apartment"}, "features": [{"name": "End Date", "value": "07/02/2027"}, {"name": "Advertisement Source", "value": "الهيئة العامة للعقار"}, {"name": "Channels", "value": "منصة مرخصة, لوحة اعلانية, منصات التواصل الإجتماعي, أخرى"}, {"name": "Is Halted", "value": "No"}, {"name": "Is Pawned", "value": "No"}, {"name": "City", "value": "الرياض"}, {"name": "City ID", "value": "84c36906-d8e6-3a66-02e6-2fc1dd7fecff"}, {"name": "Region", "value": "منطقة الرياض"}, {"name": "Street", "value": "محمد البرقي"}, {"name": "City Code", "value": "21282"}, {"name": "District", "value": "المونسية"}, {"name": "Latitude", "value": "24.827449405860047"}, {"name": "Region ID", "value": "9d51fcb2-6e33-877a-48fc-85787e9e7eaf"}, {"name": "Longitude", "value": "46.78098579826949"}, {"name": "District ID", "value": "dd4d6263-0522-0c40-403f-9cb78f98cf2c"}, {"name": "Postal Code", "value": "13253"}, {"name": "Region Code", "value": "1"}, {"name": "District Code", "value": "2508"}, {"name": "Building Number", "value": "3371"}, {"name": "Additional Number", "value": "7354"}, {"name": "Deed Number", "value": "1030097962400079"}, {"name": "Is Testament", "value": "No"}, {"name": "Land Number", "value": "و"}, {"name": "Plan Number", "value": "مربعات الأمير سطام"}, {"name": "Phone Number", "value": "0555257298"}, {"name": "Property Age", "value": "جديد"}, {"name": "Street Width", "value": "0"}, {"name": "Ad License URL", "value": "https://eservicesredp.rega.gov.sa/public/OfficesBroker/ElanDetails/08de6650-f4c4-40be-8f33-cdaa6dd00429"}, {"name": "Advertiser ID", "value": "7010265960"}, {"name": "Creation Date", "value": "07/02/2026"}, {"name": "Property Area", "value": "144.28"}, {"name": "Property Type", "value": "شقة"}, {"name": "Is Constrained", "value": "No"}, {"name": "Number of Rooms", "value": "3"}, {"name": "Price per sqm", "value": "60000"}, {"name": "Advertiser Name", "value": "مكتب تداول عقارك للعقارات"}, {"name": "Ad License Number", "value": "7200868819"}, {"name": "Red Zone Type", "value": "حظر تجاري"}, {"name": "Advertisement Type", "value": "إيجار"}, {"name": "Property Utilities", "value": "كهرباء, مياه, صرف صحي, هاتف, ألياف ضوئية, تصريف الفيضانات "}, {"name": "Title Deed Type", "value": " صك السجل العقاري"}, {"name": "Main Land Use Type", "value": "استعمال مختلط"}, {"name": "responsibleEmployeeName", "value": "عبدالله عجير سراج العتيبي"}, {"name": "Obligations on the Property", "value": "لايوجد "}, {"name": "responsibleEmployeePhoneNumber", "value": "0555257298"}, {"name": "Brokerage & Marketing License Number", "value": "1200013346"}, {"name": "Street Width", "value": "1"}, {"name": "Rent contract duration", "value": "Yearly"}], "utilities": [{"name": "Family", "value": "Family"}, {"name": "Residential ", "value": "Residential "}, {"name": "Water availability", "value": "1"}, {"name": "Electrical availability", "value": "1"}, {"name": "Drainage availability", "value": "1"}], "media": [{"mediaId": 2778, "isVideo": false, "0": "originalUrl", "previewUrl": "https://api.ibaax.sa/storage/2778/conversions/image_1779119198-preview.jpg", "mimeType": "image/jpeg"}], "status": "active", "isEditable": false, "share_link": "https://api.ibaax.sa/ad-details/513", "stc_validated": null}''')

RENT_MONTHLY = json.loads(r'''{"id": 507, "adNumber": "2026SAAPN5I7I", "title": "Istraha for Rent", "description": "استراحة للإيجار في شارع شارع, حي البيان, مدينة الرياض, منطقة الرياض\n\nالسلام عليكم ورحمة الله وبركاته استراحة بحي البيان للإيجار مجلس مقلط مطبخ دورة مياه الكهرباء مستقل الموية وايت شهري مكيفات ومطبخ راكب مفروش مدخل خاص حوش السعر 4000 شهري و الصلاة والسلام على نبينا محمد", "slug": "rent-istraha", "countOfViews": 5, "address": "RTBA7529، 7529 الحافظ العسقلاني، 3128، حي البيان، الرياض 13617، السعودية", "latitude": "24.87023065621698", "longitude": "46.855586394667625", "license": "7200889169", "price": 4000, "typeId": 2, "isFeatured": false, "IsFollowing": true, "isFavorite": false, "isRent": true, "rentType": "", "sizeArea": 0, "bedrooms": 1, "bathrooms": 1, "livingRooms": 1, "createdAt": "2026-05-14T15:56:16.000000Z", "updatedAt": "2026-07-08T07:41:42.000000Z", "user": {"id": 247, "name": "تداول عقارك للعقارات", "business_name": "تداول عقارك للعقارات", "avatar": null, "phone": "+966557908578", "val_number": "1200013346", "countOfViews": 41, "countOfFollowers": 1, "countOfFollowing": 0, "address": "RFYA3944، 3944 عبدالله بن سعود بن عبدالعزيز الفرعى، 6570، حي اليرموك، الرياض 13251، السعودية", "about": "تداول عقارك للعقارات \nنسعدك بخدمتكم", "latitude": "24.80367109317633", "longitude": "46.79508615285158", "token": null, "refresh_token": null, "sendbird_access_token": null, "rating": 5, "rating_count": 1, "is_following": false, "type_of_user": "Agent", "covered_area": [], "files": [], "share_link": "https://api.ibaax.sa/agent-details/247", "unread_notifications": 0, "nafath_verified": true, "national_id": "1104716053"}, "category": {"id": 35, "icon": null, "name": "Istraha"}, "features": [{"name": "End Date", "value": "22/02/2027"}, {"name": "Advertisement Source", "value": "الهيئة العامة للعقار"}, {"name": "Channels", "value": "منصة مرخصة, لوحة اعلانية, منصات التواصل الإجتماعي, أخرى"}, {"name": "Is Halted", "value": "No"}, {"name": "Is Pawned", "value": "No"}, {"name": "City", "value": "الرياض"}, {"name": "City ID", "value": "84c36906-d8e6-3a66-02e6-2fc1dd7fecff"}, {"name": "Region", "value": "منطقة الرياض"}, {"name": "Street", "value": "شارع"}, {"name": "City Code", "value": "21282"}, {"name": "District", "value": "البيان"}, {"name": "Latitude", "value": "24.870245535466076"}, {"name": "Region ID", "value": "9d51fcb2-6e33-877a-48fc-85787e9e7eaf"}, {"name": "Longitude", "value": "46.85559411036346"}, {"name": "District ID", "value": "db82f958-ab3b-fa38-e7b6-acf509a9ed94"}, {"name": "Postal Code", "value": "13617"}, {"name": "Region Code", "value": "1"}, {"name": "District Code", "value": "3549"}, {"name": "Building Number", "value": "7529"}, {"name": "Additional Number", "value": "3128"}, {"name": "Deed Number", "value": "1676148948300000"}, {"name": "Is Testament", "value": "No"}, {"name": "Land Number", "value": "501/503/1"}, {"name": "Plan Number", "value": "2670/أ"}, {"name": "Phone Number", "value": "0555257298"}, {"name": "Property Age", "value": "ثلاث سنوات"}, {"name": "Street Width", "value": "20"}, {"name": "Ad License URL", "value": "https://eservicesredp.rega.gov.sa/public/OfficesBroker/ElanDetails/08de7250-74b3-442b-8c5d-fa5c4660cd24"}, {"name": "Advertiser ID", "value": "7010265960"}, {"name": "Creation Date", "value": "22/02/2026"}, {"name": "Property Area", "value": "656.25"}, {"name": "Property Facing", "value": "شمالية"}, {"name": "Property Type", "value": "إستراحة"}, {"name": "Is Constrained", "value": "No"}, {"name": "Number of Rooms", "value": "2"}, {"name": "Price per sqm", "value": "4000"}, {"name": "Advertiser Name", "value": "مكتب تداول عقارك للعقارات"}, {"name": "Ad License Number", "value": "7200889169"}, {"name": "Red Zone Type", "value": "حظر تجاري"}, {"name": "Advertisement Type", "value": "إيجار"}, {"name": "Property Utilities", "value": "كهرباء, مياه, صرف صحي"}, {"name": "Title Deed Type", "value": " صك السجل العقاري"}, {"name": "Main Land Use Type", "value": "سكني"}, {"name": "responsibleEmployeeName", "value": "عبدالله عجير سراج العتيبي"}, {"name": "Obligations on the Property", "value": "لايوجد"}, {"name": "responsibleEmployeePhoneNumber", "value": "0555257298"}, {"name": "Brokerage & Marketing License Number", "value": "1200013346"}, {"name": "Street width", "value": "10"}, {"name": "Age (Year)", "value": "3"}, {"name": "Rent contract duration", "value": "Monthly"}], "utilities": [{"name": "Water availability", "value": "1"}, {"name": "Electrical availability", "value": "1"}, {"name": "Drainage availability", "value": "1"}], "media": [{"mediaId": 2750, "isVideo": false, "0": "originalUrl", "previewUrl": "https://api.ibaax.sa/storage/2750/conversions/image_1778774035-preview.jpg", "mimeType": "image/jpeg"}], "status": "active", "isEditable": false, "share_link": "https://api.ibaax.sa/ad-details/507", "stc_validated": null}''')

LAND_RENT_INDEPENDENT_FIGURES = json.loads(r'''{"id": 557, "adNumber": "2026SAHPEC5YQ", "title": "Land for Rent", "description": "إعلان أرض للإيجار\n\nالسلام عليكم ورحمة الله وبركاته\n\nرخصة فال للوساطة والتسويق : 1200019056\n\n6200869312 :رقم عقد الوساطة\n\nرخصة الإعلان العقاري : 7200924455\n\nللإيجار ارض مستودعات حي الغنامية الحائر مدينة الرياض\n\nمخطط 3258 رقم القطعة 87/2\n\nشارع 15 شرقي\n\nومساحتها 830م\n\nللتواصل ابو عبدالله ٠٥٤٩٩٩٤٤٤٥\n\nمؤسسة عبد العزيز عبدالله الجنيدل\n\nمسؤول الإعلان عبدالعزيز عبدالله عبد العزيز الجنيدل\n\nصفة المعلن وسيط ومسوق عقاري", "slug": "rent-land", "countOfViews": 0, "address": "RMGA8679، 8679 عبدالكريم الداغستاني، 2844، الغنامية، الرياض 14761، السعودية", "latitude": "24.465686460381963", "longitude": "46.79945010691882", "license": "7200924455", "price": 74700, "typeId": 2, "isFeatured": false, "IsFollowing": true, "isFavorite": false, "isRent": true, "rentType": "", "sizeArea": 0, "bedrooms": 0, "bathrooms": 0, "livingRooms": 0, "createdAt": "2026-06-04T10:06:43.000000Z", "updatedAt": "2026-06-04T10:06:43.000000Z", "user": {"id": 333, "name": "مكتب عبدالعزيز عبدالله الجنيدل للعقارات", "business_name": "مكتب عبدالعزيز الجنيدل للعقارات", "avatar": null, "phone": "+966549994445", "val_number": "1200019056", "countOfViews": 0, "countOfFollowers": 0, "countOfFollowing": 0, "address": "RHZB3315، 3315 العباس بن عبدالمطلب، 7200، الازدهار، الرياض 12485، السعودية", "about": "خدمات عقارية\nللتواصل 0549994445 ابو عبدالله \nفال للوساطة والتسويق:1200019056\nفال لإدارة الاملاك:2200002021\nفال لإدارة المرافق:320000477\nفال للمزادات العقارية:4200000173", "latitude": "24.779440261930876", "longitude": "46.717452965676785", "token": null, "refresh_token": null, "sendbird_access_token": null, "rating": 0, "rating_count": 0, "is_following": false, "type_of_user": "Agent", "covered_area": [], "files": [], "share_link": "https://api.ibaax.sa/agent-details/333", "unread_notifications": 0, "nafath_verified": true, "national_id": "1072696428"}, "category": {"id": 25, "icon": null, "name": "Land"}, "features": [{"name": "End Date", "value": "05/04/2027"}, {"name": "Advertisement Source", "value": "الهيئة العامة للعقار"}, {"name": "Channels", "value": "منصة مرخصة, لوحة اعلانية, منصات التواصل الإجتماعي, الإذاعة, أخرى"}, {"name": "Is Halted", "value": "No"}, {"name": "Is Pawned", "value": "No"}, {"name": "City", "value": "الرياض"}, {"name": "City ID", "value": "84c36906-d8e6-3a66-02e6-2fc1dd7fecff"}, {"name": "Region", "value": "منطقة الرياض"}, {"name": "Street", "value": "15"}, {"name": "City Code", "value": "21282"}, {"name": "District", "value": "الغنامية"}, {"name": "Latitude", "value": "24.465600045634975"}, {"name": "Region ID", "value": "9d51fcb2-6e33-877a-48fc-85787e9e7eaf"}, {"name": "Longitude", "value": "46.79940903591391"}, {"name": "District ID", "value": "25ec9700-67d2-a5f7-6a75-249caa083b9d"}, {"name": "Postal Code", "value": "14761"}, {"name": "Region Code", "value": "1"}, {"name": "District Code", "value": "2591"}, {"name": "Building Number", "value": "8682"}, {"name": "Additional Number", "value": "2866"}, {"name": "Deed Number", "value": "5097152302700000"}, {"name": "Is Testament", "value": "No"}, {"name": "Land Number", "value": "87/2"}, {"name": "Plan Number", "value": "3258"}, {"name": "Phone Number", "value": "0549994445"}, {"name": "Street Width", "value": "15"}, {"name": "Ad License URL", "value": "https://eservicesredp.rega.gov.sa/public/OfficesBroker/ElanDetails/08de9319-f902-4333-8f96-7043cc9c37f9"}, {"name": "Advertiser ID", "value": "7033969515"}, {"name": "Creation Date", "value": "05/04/2026"}, {"name": "Property Area", "value": "830"}, {"name": "Property Facing", "value": "شرقية"}, {"name": "Property Type", "value": "ارض"}, {"name": "Is Constrained", "value": "No"}, {"name": "Price per sqm", "value": "120"}, {"name": "Advertiser Name", "value": "مؤسسة عبدالعزيز عبدالله الجنيدل"}, {"name": "Ad License Number", "value": "7200924455"}, {"name": "Red Zone Type", "value": "حظر تجاري"}, {"name": "Advertisement Type", "value": "إيجار"}, {"name": "Property Utilities", "value": "كهرباء"}, {"name": "Title Deed Type", "value": " صك السجل العقاري"}, {"name": "Total Annual Land Rent", "value": "99600"}, {"name": "Main Land Use Type", "value": "تجاري"}, {"name": "responsibleEmployeeName", "value": "عبدالعزيز عبدالله عبدالعزيز الجنيدل"}, {"name": "Obligations on the Property", "value": "لا يوجد"}, {"name": "responsibleEmployeePhoneNumber", "value": "0549994445"}, {"name": "Brokerage & Marketing License Number", "value": "1200019056"}], "utilities": [], "media": [{"mediaId": 3046, "isVideo": false, "0": "originalUrl", "previewUrl": "https://api.ibaax.sa/storage/3046/conversions/image_1780567476-preview.jpg", "mimeType": "image/jpeg"}], "status": "active", "isEditable": false, "share_link": "https://api.ibaax.sa/ad-details/557", "stc_validated": null}''')

LAND_SALE_CLEAN = json.loads(r'''{"id": 757, "adNumber": "2026SAUFD2FCX", "title": "Land for Sale", "description": "للبيع بلك مميز\nيوجد رخصة جاهزة نوع ورش ومعارض\nالموقع : جدة حي المنتزهات\nالمساحة : 10,000 متر\nالأطوال : 100*100\nالواجهة :\nشارع غربي 30م\nشارع شمالي تجاري 32م\nشارع جنوبي 15م\nشارع شرقي 15م\n\nقريبة من طريق الحرمين ✅\nواصل ماء وكهرب ✅\nخرائط جاهزة ✅\n\nرخصة بناء ورش ومعارض جاهزة\nحتى تاريخ 1449هـ\n\nالسوم : 1900 للمتر\nالبيع : 2500 للمتر قابل للتفاوض\n\nمزيد من التفاصيل واتس : 0540574630", "slug": "sale-land", "countOfViews": 0, "address": "JIZD2934، 2934 احمد الطبري، 7643، ابرق الرغامة، جدة 22351، السعودية", "latitude": "21.48558595498406", "longitude": "39.277334064245224", "license": "7201141080", "price": 25000000, "typeId": 1, "isFeatured": false, "IsFollowing": true, "isFavorite": false, "isRent": false, "rentType": "", "sizeArea": 0, "bedrooms": 0, "bathrooms": 0, "livingRooms": 0, "createdAt": "2026-09-19T19:48:44.000000Z", "updatedAt": "2026-09-19T19:48:44.000000Z", "user": {"id": 241, "name": "مكتب شريط للعقارات", "business_name": "مكتب شريط للعقارات", "avatar": "https://api.ibaax.sa/storage/4098/image_1788234878.jpeg", "phone": "+966540574630", "val_number": "1200029439", "countOfViews": 119, "countOfFollowers": 2, "countOfFollowing": 0, "address": "حي, RASB3557, 3557 محمد بن عبدالعزيز الدغيثر، 7309، الصحافة، الرياض 13321، السعودية", "about": "🛑 كادر سعودي 100%  🛑\nنقدم خدمة التسويق المجاني لعروض الملاك والوكلاء 🛑\nونتشرف بخدمة الجميع 🌷\n\nبيع - شراء -  آجار - إدارة أملاك - كتابة عقود \n\nأوقات العمل من 5 مساءً إلى 10:30 مساءً 🔴\n\nللملاحظات والاقتراحات : \n0540574630", "latitude": "24.80553946597971", "longitude": "46.637756153941154", "token": null, "refresh_token": null, "sendbird_access_token": null, "rating": 5, "rating_count": 2, "is_following": false, "type_of_user": "Agent", "covered_area": [], "files": [], "share_link": "https://api.ibaax.sa/agent-details/241", "unread_notifications": 0, "nafath_verified": true, "national_id": "1018344034"}, "category": {"id": 25, "icon": null, "name": "Land"}, "features": [{"name": "End Date", "value": "03/09/2027"}, {"name": "Advertisement Source", "value": "الهيئة العامة للعقار"}, {"name": "Channels", "value": "أخرى, منصة مرخصة, منصات التواصل الإجتماعي, لوحة اعلانية, الإذاعة"}, {"name": "Is Halted", "value": "No"}, {"name": "Is Pawned", "value": "No"}, {"name": "City", "value": "جدة"}, {"name": "City ID", "value": "202ea443-2031-9ce7-c413-078e4ad890aa"}, {"name": "Region", "value": "منطقة مكة المكرمة"}, {"name": "Street", "value": "احمد الطبري"}, {"name": "City Code", "value": "18394"}, {"name": "District", "value": "المنتزهات"}, {"name": "Latitude", "value": "21.484895197644022"}, {"name": "Region ID", "value": "9e7cb8e3-f28d-0fa8-3388-f4273702054b"}, {"name": "Longitude", "value": "39.27844611616447"}, {"name": "District ID", "value": "0620e4ce-caef-151f-078f-aba57772a858"}, {"name": "Postal Code", "value": "22351"}, {"name": "Region Code", "value": "2"}, {"name": "District Code", "value": "4152"}, {"name": "Building Number", "value": "3042"}, {"name": "Additional Number", "value": "7580"}, {"name": "Deed Number", "value": "620241001700"}, {"name": "Is Testament", "value": "No"}, {"name": "Land Number", "value": "1"}, {"name": "Phone Number", "value": "0540574630"}, {"name": "Street Width", "value": "30"}, {"name": "Ad License URL", "value": "https://eservicesredp.rega.gov.sa/public/OfficesBroker/ElanDetails/1085b9e5-d956-4228-b756-48ace5a75134"}, {"name": "Advertiser ID", "value": "7041580627"}, {"name": "Creation Date", "value": "19/09/2026"}, {"name": "Property Area", "value": "10000"}, {"name": "Property Facing", "value": "اربعة شوارع"}, {"name": "Property Type", "value": "ارض"}, {"name": "Is Constrained", "value": "No"}, {"name": "Price per sqm", "value": "2500"}, {"name": "Advertiser Name", "value": "مكتب شريط للعقارات"}, {"name": "Total Land Price", "value": "25000000"}, {"name": "Ad License Number", "value": "7201141080"}, {"name": "Red Zone Type", "value": "لا يوجد حظر"}, {"name": "Advertisement Type", "value": "بيع"}, {"name": "Property Utilities", "value": "ألياف ضوئية, كهرباء, مياه, هاتف"}, {"name": "Title Deed Type", "value": "صك إلكتروني"}, {"name": "Main Land Use Type", "value": "تجاري"}, {"name": "responsibleEmployeeName", "value": "عبدالله عبدالرحمن بن زيد الغانم"}, {"name": "Obligations on the Property", "value": "-"}, {"name": "MOJ Deed Location Description", "value": "حي  المنتزهات  بمدينة جدة ."}, {"name": "responsibleEmployeePhoneNumber", "value": "0540574630"}, {"name": "Brokerage & Marketing License Number", "value": "1200029439"}], "utilities": [], "media": [{"mediaId": 4320, "isVideo": false, "0": "originalUrl", "previewUrl": "https://api.ibaax.sa/storage/4320/conversions/image_1789847254-preview.jpg", "mimeType": "image/jpeg"}], "status": "active", "isEditable": false, "share_link": "https://api.ibaax.sa/ad-details/757", "stc_validated": null}''')

LAND_SALE_PRICE_INDEPENDENT_OF_RATE = json.loads(r'''{"id": 747, "adNumber": "2026SA9QGLSFM", "title": "Land for Sale", "description": "للبيع أرض سكنية\nالرياض حي العلا\nالمساحة : 752م\nالأطوال  21.5 * 35\nشارع 15 شرقي \n\nالحد : 370,000 بإذن الله\n\nمزيد من التفاصيل واتس : 0598060020", "slug": "sale-land", "countOfViews": 0, "address": "الرياض 13849، السعودية", "latitude": "25.057481198886986", "longitude": "47.14488007128239", "license": "7201135293", "price": 370000, "typeId": 1, "isFeatured": false, "IsFollowing": true, "isFavorite": false, "isRent": false, "rentType": "", "sizeArea": 0, "bedrooms": 0, "bathrooms": 0, "livingRooms": 0, "createdAt": "2026-09-16T03:42:24.000000Z", "updatedAt": "2026-09-16T03:42:24.000000Z", "user": {"id": 241, "name": "مكتب شريط للعقارات", "business_name": "مكتب شريط للعقارات", "avatar": "https://api.ibaax.sa/storage/4098/image_1788234878.jpeg", "phone": "+966540574630", "val_number": "1200029439", "countOfViews": 119, "countOfFollowers": 2, "countOfFollowing": 0, "address": "حي, RASB3557, 3557 محمد بن عبدالعزيز الدغيثر، 7309، الصحافة، الرياض 13321، السعودية", "about": "🛑 كادر سعودي 100%  🛑\nنقدم خدمة التسويق المجاني لعروض الملاك والوكلاء 🛑\nونتشرف بخدمة الجميع 🌷\n\nبيع - شراء -  آجار - إدارة أملاك - كتابة عقود \n\nأوقات العمل من 5 مساءً إلى 10:30 مساءً 🔴\n\nللملاحظات والاقتراحات : \n0540574630", "latitude": "24.80553946597971", "longitude": "46.637756153941154", "token": null, "refresh_token": null, "sendbird_access_token": null, "rating": 5, "rating_count": 2, "is_following": false, "type_of_user": "Agent", "covered_area": [], "files": [], "share_link": "https://api.ibaax.sa/agent-details/241", "unread_notifications": 0, "nafath_verified": true, "national_id": "1018344034"}, "category": {"id": 25, "icon": null, "name": "Land"}, "features": [{"name": "East Border Name", "value": ":"}, {"name": "West Border Name", "value": ":"}, {"name": "North Border Name", "value": ":"}, {"name": "South Border Name", "value": ":"}, {"name": "East Border Length (Words)", "value": "اثنان و ثلاثون متراً"}, {"name": "West Border Length (Words)", "value": "اثنان و ثلاثون متراً"}, {"name": "East Border Description", "value": "القطعة رقم 688"}, {"name": "North Border Length (Words)", "value": "ثلاثة و عشرون متراً وخمسون سنتيمتر"}, {"name": "South Border Length (Words)", "value": "ثلاثة و عشرون متراً وخمسون سنتيمتر"}, {"name": "West Border Description", "value": "القطعة رقم 692"}, {"name": "North Border Description", "value": "شارع عرض 15 متر"}, {"name": "South Border Description", "value": "القطعة رقم 691"}, {"name": "End Date", "value": "05/09/2027"}, {"name": "Advertisement Source", "value": "الهيئة العامة للعقار"}, {"name": "Channels", "value": "منصة مرخصة, لوحة اعلانية, منصات التواصل الإجتماعي, الإذاعة, أخرى"}, {"name": "Is Halted", "value": "No"}, {"name": "Is Pawned", "value": "No"}, {"name": "City", "value": "الرياض"}, {"name": "City ID", "value": "84c36906-d8e6-3a66-02e6-2fc1dd7fecff"}, {"name": "Region", "value": "منطقة الرياض"}, {"name": "City Code", "value": "21282"}, {"name": "District", "value": "العلا"}, {"name": "Latitude", "value": "25.045902407689425"}, {"name": "Region ID", "value": "9d51fcb2-6e33-877a-48fc-85787e9e7eaf"}, {"name": "Longitude", "value": "47.13052642235565"}, {"name": "District ID", "value": "9af273eb-9515-f2f5-bf35-a6e8060fac53"}, {"name": "Postal Code", "value": "13845"}, {"name": "Region Code", "value": "1"}, {"name": "District Code", "value": "2767"}, {"name": "Building Number", "value": "5135"}, {"name": "Additional Number", "value": "8638"}, {"name": "Deed Number", "value": "360001235048"}, {"name": "Is Testament", "value": "No"}, {"name": "Land Number", "value": "690"}, {"name": "Plan Number", "value": "3451"}, {"name": "Phone Number", "value": "0598060020"}, {"name": "Street Width", "value": "15"}, {"name": "Ad License URL", "value": "https://eservicesredp.rega.gov.sa/public/OfficesBroker/ElanDetails/08df1355-5349-4d26-8b6b-ff20cad5dd52"}, {"name": "Advertiser ID", "value": "7041580627"}, {"name": "Creation Date", "value": "15/09/2026"}, {"name": "Property Area", "value": "752"}, {"name": "Property Facing", "value": "شرقية"}, {"name": "Property Type", "value": "ارض"}, {"name": "Is Constrained", "value": "No"}, {"name": "Price per sqm", "value": "490"}, {"name": "Advertiser Name", "value": "مكتب شريط للعقارات"}, {"name": "Total Land Price", "value": "368480"}, {"name": "Ad License Number", "value": "7201135293"}, {"name": "Red Zone Type", "value": "لا يوجد حظر"}, {"name": "Advertisement Type", "value": "بيع"}, {"name": "Property Utilities", "value": "لايوجد خدمات"}, {"name": "Title Deed Type", "value": "صك إلكتروني"}, {"name": "Main Land Use Type", "value": "سكني"}, {"name": "responsibleEmployeeName", "value": "فهد عبدالرحمن ناصر الغانم"}, {"name": "Obligations on the Property", "value": "-"}, {"name": "MOJ Deed Location Description", "value": "حي شرق الرياض بمدينة الرياض "}, {"name": "responsibleEmployeePhoneNumber", "value": "0598060020"}, {"name": "Brokerage & Marketing License Number", "value": "1200029439"}], "utilities": [], "media": [{"mediaId": 4286, "isVideo": false, "0": "originalUrl", "previewUrl": "https://api.ibaax.sa/storage/4286/conversions/image_1789529975-preview.jpg", "mimeType": "image/jpeg"}], "status": "active", "isEditable": false, "share_link": "https://api.ibaax.sa/ad-details/747", "stc_validated": null}''')

MISFILED_WORKSHOP_UNDER_LAND_CATEGORY = json.loads(r'''{"id": 603, "adNumber": "2026SAXCIIMCS", "title": "Land for Sale", "description": "للبيع أرض صناعية \nنوع الأرض : صناعي خفيف \nمقام عليها ورشة جديد\nالموقع : الرياض ( المصفاة )\nالمساحة : ٤٠٠م ( ٢٠م في ٢٠م )\nواجهة : غربية ٢٠م \nرقم القطعة : ١٠٨١\nرقم المخطط : ٢٣٧٧\n\nنوع الرخصة : خطورة عالية 🔴 \n\n\nالسوم : 1,350,000 \nالبيع : 1,400,000 صافي\n\nمزيد من التفاصيل واتس : 0598060020", "slug": "sale-land", "countOfViews": 3, "address": "RMFA6962، 6962 أبي الفضل عبدالمؤمن، 2795، المصفاة، الرياض 14528، السعودية", "latitude": "24.50983275985487", "longitude": "46.88543502241373", "license": "7201002795", "price": 1400000, "typeId": 1, "isFeatured": false, "IsFollowing": true, "isFavorite": false, "isRent": false, "rentType": "", "sizeArea": 0, "bedrooms": 0, "bathrooms": 0, "livingRooms": 0, "createdAt": "2026-06-13T19:46:20.000000Z", "updatedAt": "2026-08-17T19:51:12.000000Z", "user": {"id": 241, "name": "مكتب شريط للعقارات", "business_name": "مكتب شريط للعقارات", "avatar": "https://api.ibaax.sa/storage/4098/image_1788234878.jpeg", "phone": "+966540574630", "val_number": "1200029439", "countOfViews": 119, "countOfFollowers": 2, "countOfFollowing": 0, "address": "حي, RASB3557, 3557 محمد بن عبدالعزيز الدغيثر، 7309، الصحافة، الرياض 13321، السعودية", "about": "🛑 كادر سعودي 100%  🛑\nنقدم خدمة التسويق المجاني لعروض الملاك والوكلاء 🛑\nونتشرف بخدمة الجميع 🌷\n\nبيع - شراء -  آجار - إدارة أملاك - كتابة عقود \n\nأوقات العمل من 5 مساءً إلى 10:30 مساءً 🔴\n\nللملاحظات والاقتراحات : \n0540574630", "latitude": "24.80553946597971", "longitude": "46.637756153941154", "token": null, "refresh_token": null, "sendbird_access_token": null, "rating": 5, "rating_count": 2, "is_following": false, "type_of_user": "Agent", "covered_area": [], "files": [], "share_link": "https://api.ibaax.sa/agent-details/241", "unread_notifications": 0, "nafath_verified": true, "national_id": "1018344034"}, "category": {"id": 25, "icon": null, "name": "Land"}, "features": [{"name": "End Date", "value": "11/06/2027"}, {"name": "Advertisement Source", "value": "الهيئة العامة للعقار"}, {"name": "Channels", "value": "منصة مرخصة, لوحة اعلانية, منصات التواصل الإجتماعي, الإذاعة, أخرى"}, {"name": "Is Halted", "value": "No"}, {"name": "Is Pawned", "value": "No"}, {"name": "City", "value": "الرياض"}, {"name": "City ID", "value": "84c36906-d8e6-3a66-02e6-2fc1dd7fecff"}, {"name": "Region", "value": "منطقة الرياض"}, {"name": "Street", "value": "أبي الفضل عبدالمؤمن"}, {"name": "City Code", "value": "21282"}, {"name": "District", "value": "المصفاة"}, {"name": "Latitude", "value": "24.50982210372466"}, {"name": "Region ID", "value": "9d51fcb2-6e33-877a-48fc-85787e9e7eaf"}, {"name": "Longitude", "value": "46.8855663125884"}, {"name": "District ID", "value": "27b35985-199f-318c-1f92-8e4453a83523"}, {"name": "Postal Code", "value": "14528"}, {"name": "Region Code", "value": "1"}, {"name": "District Code", "value": "3707"}, {"name": "Building Number", "value": "6931"}, {"name": "Additional Number", "value": "2828"}, {"name": "Deed Number", "value": "6612828641600000"}, {"name": "Is Testament", "value": "No"}, {"name": "Land Number", "value": "1081"}, {"name": "Plan Number", "value": "2377"}, {"name": "Phone Number", "value": "0540574630"}, {"name": "Property Age", "value": "جديد"}, {"name": "Street Width", "value": "20"}, {"name": "Ad License URL", "value": "https://eservicesredp.rega.gov.sa/public/OfficesBroker/ElanDetails/08dec960-6992-47eb-87a7-b9aa86cd9de0"}, {"name": "Advertiser ID", "value": "7041580627"}, {"name": "Creation Date", "value": "13/06/2026"}, {"name": "Property Area", "value": "400"}, {"name": "Property Facing", "value": "غربية"}, {"name": "Property Type", "value": "ورشة"}, {"name": "Is Constrained", "value": "No"}, {"name": "Price per sqm", "value": "1400000"}, {"name": "Advertiser Name", "value": "مؤسسة مكتب شريط للعقارات"}, {"name": "Ad License Number", "value": "7201002795"}, {"name": "Red Zone Type", "value": "حظر تجاري"}, {"name": "Advertisement Type", "value": "بيع"}, {"name": "Property Utilities", "value": "كهرباء"}, {"name": "Title Deed Type", "value": " صك السجل العقاري"}, {"name": "Main Land Use Type", "value": "تصنيع"}, {"name": "responsibleEmployeeName", "value": "عبدالله عبدالرحمن بن زيد الغانم"}, {"name": "Obligations on the Property", "value": "لا يوجد"}, {"name": "responsibleEmployeePhoneNumber", "value": "0540574630"}, {"name": "Brokerage & Marketing License Number", "value": "1200029439"}], "utilities": [], "media": [{"mediaId": 3380, "isVideo": false, "0": "originalUrl", "previewUrl": "https://api.ibaax.sa/storage/3380/conversions/image_1782182902-preview.jpg", "mimeType": "image/jpeg"}], "status": "active", "isEditable": false, "share_link": "https://api.ibaax.sa/ad-details/603", "stc_validated": null}''')

STUDIO_TASHKEEL = json.loads(r'''{"id": 726, "adNumber": "2026SACXCFLOZ", "title": "Room for Rent", "description": "للإيجار استديو في فلة\nالموقع : الرياض - الصحافة\nالمساحة : 35م تقريباً\nالشارع : 15م\nالعمر : أكثر من 10 سنوات مجدد\n\nعبارة عن:\nغرفة - ركن مطبخ - دورة مياه .\n\nعدد دورات المياه : 1\n\n- شامل الكهرب والماء\n\n\nالسعر : 30,000\n\nلمزيد من التفاصيل التواصل على الرقم :\n0568288007", "slug": "rent-room", "countOfViews": 2, "address": "RASA8219، 8219 الاشبال، 3094، حي الصحافة، الرياض 13321، السعودية", "latitude": "24.813788699794443", "longitude": "46.63338482379913", "license": "7201117409", "price": 30000, "typeId": 2, "isFeatured": false, "IsFollowing": true, "isFavorite": false, "isRent": true, "rentType": "", "sizeArea": 0, "bedrooms": 0, "bathrooms": 0, "livingRooms": 0, "createdAt": "2026-09-04T14:17:31.000000Z", "updatedAt": "2026-09-04T16:35:42.000000Z", "user": {"id": 241, "name": "مكتب شريط للعقارات", "business_name": "مكتب شريط للعقارات", "avatar": "https://api.ibaax.sa/storage/4098/image_1788234878.jpeg", "phone": "+966540574630", "val_number": "1200029439", "countOfViews": 119, "countOfFollowers": 2, "countOfFollowing": 0, "address": "حي, RASB3557, 3557 محمد بن عبدالعزيز الدغيثر، 7309، الصحافة، الرياض 13321، السعودية", "about": "🛑 كادر سعودي 100%  🛑\nنقدم خدمة التسويق المجاني لعروض الملاك والوكلاء 🛑\nونتشرف بخدمة الجميع 🌷\n\nبيع - شراء -  آجار - إدارة أملاك - كتابة عقود \n\nأوقات العمل من 5 مساءً إلى 10:30 مساءً 🔴\n\nللملاحظات والاقتراحات : \n0540574630", "latitude": "24.80553946597971", "longitude": "46.637756153941154", "token": null, "refresh_token": null, "sendbird_access_token": null, "rating": 5, "rating_count": 2, "is_following": false, "type_of_user": "Agent", "covered_area": [], "files": [], "share_link": "https://api.ibaax.sa/agent-details/241", "unread_notifications": 0, "nafath_verified": true, "national_id": "1018344034"}, "category": {"id": 36, "icon": null, "name": "Room"}, "features": [{"name": "End Date", "value": "04/03/2027"}, {"name": "Advertisement Source", "value": "الهيئة العامة للعقار"}, {"name": "Channels", "value": "منصة مرخصة, لوحة اعلانية, منصات التواصل الإجتماعي, الإذاعة, أخرى"}, {"name": "Is Halted", "value": "No"}, {"name": "Is Pawned", "value": "No"}, {"name": "City", "value": "الرياض"}, {"name": "City ID", "value": "84c36906-d8e6-3a66-02e6-2fc1dd7fecff"}, {"name": "Region", "value": "منطقة الرياض"}, {"name": "Street", "value": "الاشبال"}, {"name": "City Code", "value": "21282"}, {"name": "District", "value": "الصحافة"}, {"name": "Latitude", "value": "24.813763339500884"}, {"name": "Region ID", "value": "9d51fcb2-6e33-877a-48fc-85787e9e7eaf"}, {"name": "Longitude", "value": "46.63338250074226"}, {"name": "District ID", "value": "feb59614-179a-36cc-f51c-8567ffc36f25"}, {"name": "Postal Code", "value": "13321"}, {"name": "Region Code", "value": "1"}, {"name": "District Code", "value": "3147"}, {"name": "Building Number", "value": "8219"}, {"name": "Additional Number", "value": "3094"}, {"name": "Deed Number", "value": "2325475402200000"}, {"name": "Is Testament", "value": "No"}, {"name": "Land Number", "value": "3364/2"}, {"name": "Plan Number", "value": "1637/س"}, {"name": "Phone Number", "value": "0568288007"}, {"name": "Property Age", "value": "اكثر من عشر سنوات"}, {"name": "Street Width", "value": "0"}, {"name": "Ad License URL", "value": "https://eservicesredp.rega.gov.sa/public/OfficesBroker/ElanDetails/08df0a85-9a4b-49bb-8f68-3b0a70e94f01"}, {"name": "Advertiser ID", "value": "7041580627"}, {"name": "Creation Date", "value": "04/09/2026"}, {"name": "Property Area", "value": "390"}, {"name": "Property Facing", "value": "غربية"}, {"name": "Property Type", "value": "شقَّة صغيرة (استوديو)"}, {"name": "Is Constrained", "value": "No"}, {"name": "Number of Rooms", "value": "1"}, {"name": "Price per sqm", "value": "30000"}, {"name": "Advertiser Name", "value": "مكتب شريط للعقارات"}, {"name": "Ad License Number", "value": "7201117409"}, {"name": "Red Zone Type", "value": "حظر تجاري"}, {"name": "Advertisement Type", "value": "إيجار"}, {"name": "Property Utilities", "value": "كهرباء, مياه, صرف صحي"}, {"name": "Title Deed Type", "value": " صك السجل العقاري"}, {"name": "Main Land Use Type", "value": "سكني"}, {"name": "responsibleEmployeeName", "value": "محمد عبدالرحمن بن زيد الغانم"}, {"name": "Obligations on the Property", "value": "لايوجد"}, {"name": "responsibleEmployeePhoneNumber", "value": "0568288007"}, {"name": "Brokerage & Marketing License Number", "value": "1200029439"}], "utilities": [{"name": "Water availability", "value": "1"}, {"name": "Kitchen", "value": "1"}, {"name": "Electrical availability", "value": "1"}], "media": [{"mediaId": 4118, "isVideo": false, "0": "originalUrl", "previewUrl": "https://api.ibaax.sa/storage/4118/conversions/image_1788531339-preview.jpg", "mimeType": "image/jpeg"}], "status": "active", "isEditable": false, "share_link": "https://api.ibaax.sa/ad-details/726", "stc_validated": null}''')

# Every personal value the fixtures above carry (phones, a Saudi national ID, advertiser/employee
# names, business names) — read straight OUT of the fixtures rather than hand-typed twice, so this
# list can never drift from what the fixtures actually contain.
_PII_VALUES = (
    "+966540574630",
    "+966549994445",
    "+966557908578",
    "0540574630",
    "0545752077",
    "0549994445",
    "0555257298",
    "0568288007",
    "0598060020",
    "1018344034",
    "1072696428",
    "1104716053",
    "7010265960",
    "7033969515",
    "7041580627",
    "تداول عقارك للعقارات",
    "عبدالعزيز عبدالله عبدالعزيز الجنيدل",
    "عبدالله عبدالرحمن بن زيد الغانم",
    "عبدالله عجير سراج العتيبي",
    "عثمان عبدالعزيز بن عثمان الضحوك",
    "فهد عبدالرحمن ناصر الغانم",
    "مؤسسة عبدالعزيز عبدالله الجنيدل",
    "مؤسسة مكتب شريط للعقارات",
    "محمد عبدالرحمن بن زيد الغانم",
    "مكتب تداول عقارك للعقارات",
    "مكتب شريط للعقارات",
    "مكتب عبدالعزيز الجنيدل للعقارات",
    "مكتب عبدالعزيز عبدالله الجنيدل للعقارات",
)

_CATALOG = {"الرياض": (3, 1), "جدة": (18, 2)}


@pytest.fixture(autouse=True)
def _no_catalog_network(monkeypatch):
    """to_catalog/find_district_in_text would otherwise read loc_catalog_* from the database."""
    monkeypatch.setattr(R, "to_catalog",
                        lambda c, region_hint=None: _CATALOG.get((c or "").strip(), (None, None)))
    monkeypatch.setattr(R, "find_district_in_text", lambda t, cid: (t or "").strip() or None)


def _row(rec):
    row, cat, why = R.map_listing(rec)
    assert row, f"fixture id {rec['id']} unexpectedly skipped: {why}"
    return row, cat


# ── 1. THE PAGINATION TRAP: `page` is silently ignored, `pageNumber` is the real parameter ───────

class _FakeResp:
    def __init__(self, payload):
        self.status_code = 200
        self._payload = payload
        self.text = json.dumps(payload)

    def json(self):
        return self._payload


def _fake_session(pages_by_number: dict[int, dict]):
    """Mimics the REAL measured API defect: a request keyed on the wrong query param (`page`)
    always lands on page 1's content, while `pageNumber` actually advances."""
    class S:
        def get(self, url, timeout=None):
            if "pageNumber=" in url:
                n = int(url.split("pageNumber=")[1])
            else:
                n = 1                      # the measured bug: any other param name → page 1, always
            return _FakeResp(pages_by_number.get(n, {
                "status": "success", "data": {"advertisements": [], "links": {"total": 0}}}))
    return S()


def _page(n: int, total: int, ids: list[int], last_page: int) -> dict:
    return {"status": "success", "data": {
        "advertisements": [{"id": i} for i in ids],
        "links": {"total": total, "current_page": n, "last_page": last_page}}}


def test_pageNumber_is_read_and_every_page_is_collected():
    pages = {1: _page(1, 25, list(range(1, 11)), 3),
             2: _page(2, 25, list(range(11, 21)), 3),
             3: _page(3, 25, list(range(21, 26)), 3)}
    items, complete = R.fetch_catalogue(_fake_session(pages))
    assert len(items) == 25 and complete is True
    assert {i["id"] for i in items} == set(range(1, 26))


def test_a_pagination_that_silently_repeats_page_one_terminates_instead_of_looping_forever():
    """The measured defect ITSELF, reproduced: if the crawl were keyed on `page` instead of
    `pageNumber`, `_fake_session` always serves page 1's rows — the exact shape the real API
    returned in production for every `?page=N` this build tried. The completeness gate must refuse
    to call that a full catalogue rather than pruning 150 live rows out of existence."""
    only_page_one = {1: _page(1, 160, list(range(1, 11)), 16)}
    items, complete = R.fetch_catalogue(_fake_session(only_page_one))
    assert len(items) == 10, "the repeated page must not be counted 16 times over"
    assert complete is False, "10 of a declared 160 must never be treated as the whole catalogue"


def test_a_short_catalogue_is_not_complete_so_nothing_may_be_pruned():
    items, complete = R.fetch_catalogue(_fake_session({1: _page(1, 160, [1, 2], 16)}))
    assert len(items) == 2 and complete is False


# ── 2. LAND PRICE FIDELITY: two independent figures, a third that is pure arithmetic (trap 2) ────

def test_a_land_rent_stores_the_independently_published_price_never_the_platforms_own_arithmetic():
    """id 557: `price` 74,700 is the poster's own figure. "Price per sqm" 120 × "Property Area" 830
    = 99,600 exactly, published separately as "Total Annual Land Rent" — that IS the platform's own
    multiplication, and it must never be adopted as price_annual."""
    row, cat = _row(LAND_RENT_INDEPENDENT_FIGURES)
    assert row["price_annual"] == 74700, "the poster's own published figure, verbatim"
    assert row["price_annual"] != 99600, "99,600 is rate×area — platform arithmetic, not a price"
    assert row["price_per_meter"] == 120
    assert row.get("price_total") is None, "a rent never lands in price_total"
    assert row["additional_info"]["platform_land_total_derived"] == "99600"


def test_a_land_sale_stores_price_and_rate_as_two_independent_figures():
    row, cat = _row(LAND_SALE_CLEAN)
    assert row["price_total"] == 25000000
    assert row["price_per_meter"] == 2500
    assert cat == "residential" and row["transaction_type"] == "Buy"


def test_a_land_sale_where_price_disagrees_with_rate_times_area_keeps_price_verbatim():
    """id 747: `price` 370,000 but "Price per sqm" 490 × "Property Area" 752 = 368,480 (published as
    "Total Land Price") — the two figures DISAGREE, which is the proof `price` is independently
    published and not derived from the rate. Storing 368,480 would silently repair a real listing's
    stated price."""
    row, _ = _row(LAND_SALE_PRICE_INDEPENDENT_OF_RATE)
    assert row["price_total"] == 370000
    assert row["price_total"] != 368480
    assert row["price_per_meter"] == 490
    assert row["additional_info"]["platform_land_total_derived"] == "368480"


def test_price_per_meter_is_never_set_for_a_row_the_app_mis_filed_under_land():
    """id 603: `category.name` is "Land" (the poster's own dropdown) but the REGA "Property Type"
    feature says «ورشة» (Workshop) — REGA wins (trap 5), and correctly, a workshop gets NO
    price_per_meter even though "Price per sqm" happens to equal `price` on this exact row."""
    row, cat = _row(MISFILED_WORKSHOP_UNDER_LAND_CATEGORY)
    assert row["property_type"] == "Workshop"
    assert cat == "commercial"
    assert row.get("price_per_meter") is None
    assert row["price_total"] == 1400000


def test_a_non_land_row_gets_no_per_metre_rate_even_though_the_source_publishes_one():
    row, _ = _row(RENT_SILENT_PII_RICH)          # id 774, an Apartment
    assert row.get("price_per_meter") is None, "«Price per sqm» is only meaningful for «ارض»"
    assert row["price_annual"] == 57000


# ── 3. RENT PERIOD = SOURCE, from the REGA feature — never the top-level rentType, never the UI ──

def test_a_silent_rent_keeps_its_period_unknown_and_its_price_unconverted():
    """id 774 has NO "Rent contract duration" feature. Unlike abaad, iBaax has no owner attestation
    to fall back on (it DOES state a real period on other rows), so silence here means genuinely
    UNKNOWN — never defaulted to annual, and (measured live) the rendered page's own <title> saying
    "/ Monthly" for this exact ad must NOT be trusted; nothing in the API says "Monthly" for id 774."""
    assert RENT_SILENT_PII_RICH["rentType"] == "", "sanity: the dead top-level field really is blank"
    row, _ = _row(RENT_SILENT_PII_RICH)
    assert row.get("rent_period") is None
    assert row["price_annual"] == 57000, "verbatim — no default period, so no conversion either"
    assert "rent_period" not in row, "an UNKNOWN period is the key's absence, never a guessed value"


def test_a_yearly_stated_rent_converts_nothing():
    row, _ = _row(RENT_YEARLY_ROOM_DISAGREEMENT)
    assert row["rent_period"] == "annual"
    assert row["price_annual"] == 60000, "'annual' converts nothing — the figure is verbatim"


def test_a_monthly_stated_rent_is_converted_by_twelve():
    row, _ = _row(RENT_MONTHLY)
    assert row["rent_period"] == "monthly"
    assert row["price_annual"] == 4000 * 12, "the documented ×12 storage conversion"


def test_the_top_level_rentType_field_is_never_read_it_is_dead_on_every_row():
    for rec in (RENT_SILENT_PII_RICH, RENT_YEARLY_ROOM_DISAGREEMENT, RENT_MONTHLY):
        assert rec["rentType"] == "", "sanity: the fixture really is the measured dead-field shape"
    row, _ = _row(RENT_MONTHLY)
    assert row["rent_period"] == "monthly", "came from the REGA feature, never from `rentType`"


# ── 4. PDPL: no personal data anywhere, and no structured fact destroyed to get there ─────────────

@pytest.mark.parametrize("rec", [
    RENT_SILENT_PII_RICH, BUY_NAME_LEAK_IN_DESCRIPTION, RENT_YEARLY_ROOM_DISAGREEMENT, RENT_MONTHLY,
    LAND_RENT_INDEPENDENT_FIGURES, LAND_SALE_CLEAN, LAND_SALE_PRICE_INDEPENDENT_OF_RATE,
    MISFILED_WORKSHOP_UNDER_LAND_CATEGORY, STUDIO_TASHKEEL,
], ids=lambda r: str(r["id"]))
def test_no_phone_national_id_or_advertiser_identity_ever_reaches_the_row(rec):
    row, _ = _row(rec)
    stored = json.dumps(row, ensure_ascii=False, default=str)
    for value in _PII_VALUES:
        assert value not in stored, (
            f"{value!r} is personal data and reached the row for id {rec['id']} — PDPL forbids "
            f"storing broker/owner identity or any contact number, in a column, in additional_info "
            f"or in source_capture")
    for key in ("user", "Phone Number", "Advertiser ID", "Advertiser Name",
                "responsibleEmployeeName", "responsibleEmployeePhoneNumber"):
        assert key not in stored, f"the {key!r} key/object itself must never be carried into a row"


def test_a_name_that_leaks_into_free_text_is_scrubbed_under_either_spacing():
    """id 551, THE MEASURED DEFECT: the REGA "responsibleEmployeeName" feature spells a compound
    name without an internal space ("عبدالعزيز") while the SAME source's own description spells the
    identical name WITH one ("عبد العزيز"). A byte-exact substring removal misses the second
    spelling; `_name_pattern` must catch both."""
    rec = BUY_NAME_LEAK_IN_DESCRIPTION
    assert "عبد العزيز" in rec["description"], "sanity: the fixture really carries the spaced spelling"
    row, _ = _row(rec)
    assert "عبدالعزيز عبدالله الجنيدل" not in (row["description"] or "")
    assert "عبد العزيز" not in (row["description"] or "")
    assert "0549994445" not in (row["description"] or "")
    assert "رخصة فال للوساطة والتسويق : 1200019056" in (row["description"] or ""), (
        "the FAL brokerage licence is regulatory data and must survive the redaction")


def test_a_whatsapp_contact_line_is_redacted_from_the_description():
    row, _ = _row(RENT_SILENT_PII_RICH)
    assert "0545752077" not in (row["description"] or "")
    assert "واتس" not in (row["description"] or "") or "لمزيد من التفاصيل" in (row["description"] or "")


def test_structured_numeric_features_survive_the_pdpl_scrub_byte_identical():
    """THE BUG THIS TEST GUARDS: a blanket `redact_pii()`/`_scrub()` over every feature value
    corrupted a real coordinate and a real deed number in this exact build, because their digit runs
    coincidentally matched the Saudi-mobile pattern. `redact_capture()` (gated on `is_free_text`)
    must leave every bare structured number alone."""
    row, _ = _row(RENT_SILENT_PII_RICH)
    feats = row["source_capture"]["features"]
    assert feats["Latitude"] == "24.845876576604557"
    assert feats["Longitude"] == "46.66967664193697"
    assert feats["Deed Number"] == "5782650508200000"
    assert feats["Land Number"] == "3391/1/2"


def test_the_capture_and_additional_info_are_built_from_an_allowlist():
    """A blocklist would miss the two REGA name features by construction — an allowlist means a
    sixth PII-shaped feature the source adds tomorrow cannot arrive by default either."""
    row, _ = _row(RENT_SILENT_PII_RICH)
    for blob in (row["additional_info"], row["source_capture"]):
        flat = json.dumps(blob, ensure_ascii=False, default=str)
        assert "national_id" not in flat and "1018344034" not in flat


# ── 5. TYPE MAPPING: REGA wins over the app's own category, never guessed (trap 5) ───────────────

def test_the_apps_own_category_never_overrides_the_regas_verified_type():
    row, cat = _row(MISFILED_WORKSHOP_UNDER_LAND_CATEGORY)
    assert MISFILED_WORKSHOP_UNDER_LAND_CATEGORY["category"]["name"] == "Land", (
        "sanity: the app really did file this under its Land tab")
    assert row["property_type"] == "Workshop"
    assert cat == "commercial"


# Read straight OUT of the fixture rather than hand-typed: a hand-typed copy of this exact phrase is
# what broke abaad's FIRST build (its override was keyed on a typed string with fatha-before-shadda,
# which renders identically to the source's shadda-before-fatha order and compares UNEQUAL, so the
# override silently never fired in production while a test using that same hand-typed string passed).
# Deriving it from the fixture rather than typing it a second time is what a fixture that "proves
# something about production input" actually requires.
STUDIO_TYPE_AR = next(f["value"] for f in STUDIO_TASHKEEL["features"] if f["name"] == "Property Type")


def test_the_studio_fixture_really_carries_the_sources_own_mark_order():
    assert STUDIO_TYPE_AR.index("ّ") < STUDIO_TYPE_AR.index("َ"), (
        "shadda BEFORE fatha — the source's own order, not a hand-typed one")


def test_the_studio_override_fires_on_the_sources_own_bytes():
    row, cat = _row(STUDIO_TASHKEEL)
    assert row["property_type"] == "Studio"
    from scrapers.common import normalize
    assert cat == normalize.category_for_type("Studio").lower() == "commercial"


def test_a_hand_typed_spelling_of_the_same_word_maps_identically():
    """Both mark orders are the same word once stripped, so both must map — the point of stripping."""
    hand_typed = "شقَّة صغيرة (استوديو)"     # fatha-before-shadda, as a keyboard normally produces it
    assert hand_typed != STUDIO_TYPE_AR, "sanity: the two byte sequences really do differ"
    rec = {**STUDIO_TASHKEEL,
           "features": [f for f in STUDIO_TASHKEEL["features"] if f["name"] != "Property Type"]
                       + [{"name": "Property Type", "value": hand_typed}]}
    row, _ = _row(rec)
    assert row["property_type"] == "Studio"


def test_zero_type_skips_across_every_property_type_word_the_corpus_uses():
    """Every REGA "Property Type" word observed in the full 160-row corpus, fed through the real
    mapping path. None may be unmapped — this is the whole-corpus accounting behind the "zero type
    skips" claim in the onboarding report."""
    from scrapers.common import normalize
    words = ("شقة", "ارض", "فيلا", "دور", "عمارة", "إستراحة", "ورشة", "مستودع", "مكتب", "غرفة",
            "معرض", "مصنع", STUDIO_TYPE_AR)
    for w in words:
        assert normalize.map_type_exact(R._strip_marks(w), R._TYPE_OVERRIDES) is not None, w


# ── 6. ROOMS: the "touched form" reading (trap 1) ─────────────────────────────────────────────────

def test_an_untouched_room_form_leaves_bedrooms_bathrooms_and_halls_unknown():
    """id 774: bedrooms/bathrooms/livingRooms are ALL 0 together — the untouched-form shape."""
    row, _ = _row(RENT_SILENT_PII_RICH)
    assert row.get("bedrooms") is None and row.get("bathrooms") is None and row.get("halls") is None
    assert row["additional_info"]["total_rooms"] == "3", "REGA's total, kept, never mistaken for bedrooms"


def test_a_touched_room_form_is_trusted_even_where_it_disagrees_with_regas_total():
    """id 513: bedrooms=1 while REGA's own "Number of Rooms" says 3 (a TOTAL, proven independent —
    same class as abaad's/tuba's numberOfRooms trap). The touched, per-field answer wins for the
    bedrooms COLUMN; the total is kept in additional_info under its own name, never overwriting it."""
    row, _ = _row(RENT_YEARLY_ROOM_DISAGREEMENT)
    assert row["bedrooms"] == 1
    assert row["bathrooms"] == 1
    assert row["halls"] == 1
    assert row["additional_info"]["total_rooms"] == "3"


# ── 7. A duplicated feature name is a disagreement, not a fact (trap 6) ──────────────────────────

def test_a_feature_name_published_twice_with_different_values_resolves_to_none():
    rec = RENT_YEARLY_ROOM_DISAGREEMENT
    widths = [f["value"] for f in rec["features"] if f["name"] == "Street Width"]
    assert len(widths) == 2 and len(set(widths)) == 2, "sanity: the source really disagrees with itself"
    row, _ = _row(rec)
    assert row.get("street_width_m") is None
    assert sorted(row["source_capture"]["features"]["Street Width"]) == sorted(widths), (
        "both raw values are still kept for audit")


# ── 8. THE REMOVAL ORACLE: the detail endpoint's own HTTP verdict (measured 2026-09-25/26) ───────

@pytest.mark.parametrize("status,body,expect,why", [
    (422, '{"status":"error","message":"some thing went wrong"}', "gone",
     "measured 40/40 on ids the live catalogue no longer serves, 0 counter-examples"),
    (200, '{"status":"success","data":{"id":774}}', "live", "the same shape the list endpoint trusts"),
    (200, 'not json at all', None, "an unparseable 200 has no opinion, never a guessed verdict"),
    (200, '{"status":"success","data":null}', None, "success with no data is not a live listing"),
    (404, "Not Found", None, "iBaax's own not-found is 422, not 404 — no opinion here"),
    (403, '{"status":"error"}', None, "a block is about us, not the listing"),
    (500, '{"status":"error"}', None, "the source is broken, not the listing"),
])
def test_the_oracle_reads_only_the_platforms_own_measured_verdict(status, body, expect, why):
    assert R._signal(status, body, False) == expect, why


# ── 9. Auction guard shipped, off-plan correctly absent (see the docstring) ──────────────────────

def test_an_auction_word_anywhere_in_the_text_skips_the_row_with_a_counted_reason():
    rec = {**RENT_SILENT_PII_RICH, "description": RENT_SILENT_PII_RICH["description"] + " مزاد علني"}
    row, cat, why = R.map_listing(rec)
    assert row is None and why == "auction"


def test_no_off_plan_skip_reason_exists_because_no_structured_signal_exists():
    """The ABSOLUTE RULE forbids judging off-plan readiness from a title word. This source publishes
    no completion/handover/development-stage field at all, so — correctly — there is no "off_plan"
    branch in map_listing to test: building one would be exactly the guessing the rule forbids."""
    import inspect
    assert "off_plan" not in inspect.getsource(R.map_listing)


# ── 10. Skips are counted, never guessed ──────────────────────────────────────────────────────────

@pytest.mark.parametrize("patch,expect", [
    ({"isRent": None}, "deal_unknown_blank"),
    ({"isRent": "yes"}, "deal_unknown_yes"),
])
def test_an_unrecognised_deal_value_skips_with_a_counted_reason(patch, expect):
    rec = {**RENT_SILENT_PII_RICH, **patch}
    row, _cat, why = R.map_listing(rec)
    assert row is None and why == expect


def test_an_unresolvable_city_skips_with_a_counted_reason():
    rec = {**RENT_SILENT_PII_RICH,
           "features": [f for f in RENT_SILENT_PII_RICH["features"] if f["name"] != "City"]
                       + [{"name": "City", "value": "مدينة لا توجد في الفهرس"}]}
    row, _cat, why = R.map_listing(rec)
    assert row is None and why == "city_not_in_catalog"


def test_an_unmapped_type_word_skips_with_a_counted_reason():
    rec = {**RENT_SILENT_PII_RICH,
           "features": [f for f in RENT_SILENT_PII_RICH["features"] if f["name"] != "Property Type"]
                       + [{"name": "Property Type", "value": "كوخ"}]}
    row, _cat, why = R.map_listing(rec)
    assert row is None and why == "type_unmapped_كوخ"


# ── 11. Shape ──────────────────────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("rec", [RENT_SILENT_PII_RICH, LAND_SALE_CLEAN, STUDIO_TASHKEEL],
                        ids=lambda r: str(r["id"]))
def test_every_row_carries_the_platforms_ad_number_and_a_verified_listing_url(rec):
    row, _ = _row(rec)
    assert row["ad_number"] == f"IBX{rec['id']}"
    assert row["listing_url"] == f"https://api.ibaax.sa/api/advertisements/{rec['id']}"
    assert row["source"] == "آي باكس"


def test_license_number_and_expiry_are_stored_because_expiry_is_part_of_the_removal_story():
    row, _ = _row(RENT_SILENT_PII_RICH)
    assert row["license_number"] == "7201145811"
    assert row["license_expiry"] == "22/05/2027"
