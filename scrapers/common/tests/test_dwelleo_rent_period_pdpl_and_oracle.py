"""Offline barrier for scrapers/dwelleo/run.py — the traps measured on dwelleo.sa, 2026-09-24.

Every fixture below is a VERBATIM fragment of a live api.dwelleo.sa record captured on 2026-09-24
(ids in the constant names), trimmed to the keys map_listing reads — an omitted key the code
never touches is not an edit of the listing. Descriptions are kept WHOLE on every row whose test
reads prose (the rent-period words and the amenity tokens can sit anywhere in them). The two
detail fragments (D18630, D15232) are the extra keys the /properties/<slug> record adds.
Two inputs are SYNTHETIC and say so in their test: a nightly-only rent text (0 exist live) and a
non-ASCII photo path (every live path is ASCII).

Everything runs the SHIPPING functions — run.map_listing, run.rent_terms, run._photo_urls,
run.session, run._signal_for/_make_verify_gone (under the real LivenessProbe law) and run.main —
never a re-implementation. Only the two DB-backed location helpers are stubbed.

What each trap costs if it regresses:
  · RENT PRICES CARRY NO PERIOD FIELD. 60% of rentals are silent → NULL period, figure as
    printed; «الشهري والسنوي» on one figure → NULL; a nightly-only text → no figure at all.
  · maid_room / driver_room / parking_space are zero-filled by the form → 0 is silence, not «no».
  · The detail record renames the district dict to `property_area` and reuses `area` for a
    number — merged naively, `.get("name")` on an int aborted the whole run.
  · `re-sale` is a Buy, `short-term-rental` is out of scope, availability≠available is a skip.
  · PDPL: owner/additional_contact dropped whole; mobiles scrubbed from description while the
    REGA ad licence and FAL licence numbers stay.
  · The removal oracle: 422 «The selected id is invalid.» and 404 «العقار غير موجود» are GONE,
    a live record is LIVE only as THIS id; a 403 stays UNKNOWN; every removal is canary-gated.
  · The site's own QA rows («[تجربة دويليو]», slug test-…, owner «Test … (Production)») pass
    every other gate with a publish/available status and a real-looking price → site_test_row.
  · ac_type is the TYPED AC value (registry: Split/Central/Duct/Window, «None» = no AC) → the
    availability column tri-state; ad_license_number keeps only the REGA AD shape (7 + 9 digits);
    a Building's floor_number is its floor COUNT, never a unit floor; an early empty catalogue
    page makes the walk INCOMPLETE (no prune); a mobile in the TITLE is scrubbed too.
"""
from __future__ import annotations

import sys
import types
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

# scrapers.common.db imports supabase + dotenv at module load; keep the barrier hermetic.
_sb = types.ModuleType("supabase")
_sb.Client = object
_sb.create_client = lambda *a, **k: None
sys.modules.setdefault("supabase", _sb)
_dv = types.ModuleType("dotenv")
_dv.load_dotenv = lambda *a, **k: None
sys.modules.setdefault("dotenv", _dv)

from scrapers.dwelleo import run as R  # noqa: E402

# --- offline stand-ins for the only two DB-backed helpers -------------------------------------
_CATALOG = {"الرياض": (3, 1), "جدة": (18, 2), "الخبر": (31, 5), "الدمام": (13, 5),
            "خميس مشيط": (62, 6), "تبوك": (1, 7)}
R.to_catalog = lambda city_ar, region_hint=None: _CATALOG.get((city_ar or "").strip(), (None, None))
R.find_district_in_text = lambda text, city_id: (text or "").strip() or None

YEAR = 2026

# ============================ VERBATIM PAYLOAD FRAGMENTS =====================================
R18630 = {"id": 18630, "slug": "3-bedroom-apartment-for-rent-in-ghirnatah-dist-riyadh", "status": "publish", "availability": "available", "listing_type": {"key": "for-rent", "label": "إيجار"}, "property_type": {"name": "شقة"}, "land_type": None, "city": {"name": "الرياض"}, "area": {"name": "حي غرناطة"}, "title": "شقة 3 غرف للإيجار في حي غرناطة، الرياض", "description": "تتوفر شقة مميزة للإيجار في حي غرناطة بمدينة الرياض، بسعر 60,000 ريال سعودي. تبلغ مساحتها 168 متر مربع، وتضم ثلاث غرف نوم، وثلاثة حمامات، وبناء عام 2015. الشقة غير مفروشة، وتوجد موقف سيارات واحد، وتصل إلى الطابق الثاني عبر مصعد. الخدمات الأساسية متوفرة وتشمل الكهرباء والماء. لا تفوت فرصة الاستمتاع بمرافق سكنية مريحة في قلب الرياض. اتصل بنا الآن لترتيب زيارة.", "price": 60000, "area_sqm": 168, "bedrooms": 3, "bathrooms": 3, "floor_number": 2, "building_year": 2015, "direction": None, "surrounding_streets": None, "ad_license_number": "7201132846", "image": {"path": "https://cdn.dwelleo.sa/143921/BLzQjt1xinduxkFdsEOCyI68Sx0zwoHRHsqlnij0.png"}, "tags": [{"name": "مصعد"}], "maid_room": 0, "driver_room": None, "parking_space": 1, "furnishing_status": "unfurnished", "utility_availability": ["electricity", "water"], "location": {"address": "RFGA4130، 4130 المندر، 6975، حي غرناطة، الرياض 13242, Saudi Arabia", "lat": 24.7924875, "lng": 46.7612031}, "owner": {"name": "مؤسسة مكتب شريط للعقارات", "phone": "966-540574630", "email": "shreet7171@gmail.com"}, "additional_contact": None}
# the /properties/<slug> record: `area` is now a NUMBER and the district dict is `property_area`
D18630 = {"street_width": None, "property_area": {"id": 153, "name": "حي غرناطة", "city_id": 1}, "area": 168, "region": {"id": 1, "name": "الرياض"}, "land_area": None, "livings": 1, "master_bedroom_count": None, "amenities": [{"name": "موقف سيارات"}, {"name": "مصعد"}], "images": [{"path": "https://cdn.dwelleo.sa/143921/BLzQjt1xinduxkFdsEOCyI68Sx0zwoHRHsqlnij0.png"}, {"path": "https://cdn.dwelleo.sa/143922/iQjQ7HuDdqaKtHaLiqKISx7i5C6kW03Nhg889VFT.png"}, {"path": "https://cdn.dwelleo.sa/143923/rpFgDE6qmNkyIJAaK7cgrX1s5un7ATWYMma1dWWL.png"}, {"path": "https://cdn.dwelleo.sa/143924/5yDRsEVDiZuzudiUzBbvSkIvajOeBzkOfgLm7OWN.png"}, {"path": "https://cdn.dwelleo.sa/143925/woH1waCWupejXaEM1pOPTVSLs08GCHr1AfqQc966.png"}, {"path": "https://cdn.dwelleo.sa/143926/02Kz1TiajO5b2rr0DuQsDtchDiMbJKAksqlUJMGM.png"}, {"path": "https://cdn.dwelleo.sa/143927/pqnLrKRxUCEES0YnES0ibwktta5qq638wzm0JkRF.png"}, {"path": "https://cdn.dwelleo.sa/143928/KXk6I0REyQ8xJ60k9LRtKh2eJLHatATOfur7SkdG.png"}], "owner": {"name": "مؤسسة مكتب شريط للعقارات", "phone": "966-540574630", "whatsapp_number": None, "email": "shreet7171@gmail.com"}, "rental_yield": None}

R1378 = {"id": 1378, "slug": "3-bedroom-townhouse-for-rent-in-al-narjis-riyadh", "status": "publish", "availability": "available", "listing_type": {"key": "for-rent", "label": "إيجار"}, "property_type": {"name": "تاون هاوس"}, "land_type": "residential", "city": {"name": "الرياض"}, "area": {"name": "حي النرجس"}, "title": "تاون هاوس 3 غرف للإيجار في النرجس، الرياض", "description": "🏡 تاون هاوس فاخر للإيجار في حي النرجس – الرياض\n\n📍 الموقع: حي النرجس – شمال الرياض\n💰 السعر: 150,000 ريال سنوياً\n📐 المساحة: 255 م²\n📑 رقم الترخيص الإعلاني: 7200494380\n\n✨ أسلوب حياة فاخر بانتظارك في تاون هاوس مميز بتصميم عصري وتشطيبات راقية، ضمن بيئة سكنية راقية تناسب العائلات الباحثة عن الخصوصية والرفاهية.\n\n🏠 توزيع العقار:\n\n🔹 القبو:\n\nصالة واسعة\n\nمدخل خاص مباشر للفيلا\n\nمواقف خاصة لعدد 2 سيارة\n\n🔹 الدور الأرضي:\n\nصالة استقبال واسعة\n\nمطبخ راكب مجهز بالكامل\n\nمصعد داخلي\n\nتكييف مركزي مخفي\n\n🔹 الدور الأول:\n\n3 غرف نوم بتوزيع مثالي يضمن الراحة والخصوصية\n\n🔹 الدور الثاني:\n\nغرفة خادمة بدورة مياه خاصة\n\nسطح خاص\n\n⭐ مميزات استثنائية:\n\nنادي رياضي متكامل (رجال / نساء)\n\nمنطقة ألعاب أطفال\n\nغرفة سائق خاصة\n\nموقف خاص لسيارتين\n\nأسقف مرتفعة\n\nنظام دخول ذكي\n\nمدخل خاص مباشر من القبو\n\n📞 فرصة مثالية لسكن فاخر في موقع مميز — احجز موعدك الآن 🔑✨", "price": 150000, "area_sqm": 225, "bedrooms": 3, "bathrooms": 6, "floor_number": 1, "building_year": 2025, "direction": None, "surrounding_streets": None, "ad_license_number": "7200494380", "image": {"path": "https://cdn.dwelleo.sa/24030/conversions/01KQW3RPTT9RXWV74CV9DSXRB9-watermarked.jpg"}, "tags": [{"name": "جراج"}, {"name": "حديقة"}, {"name": "مصعد"}, {"name": "نادي رياضي"}], "maid_room": 1, "driver_room": 1, "parking_space": 2, "furnishing_status": "unfurnished", "utility_availability": ["water", "electricity"], "location": {"address": "XJ89+4MX, Prince Faisal Ibn Bandar Ibn Abdulaziz Rd, King Khalid International Airport, Riyadh 11564, Saudi Arabia", "lat": 24.9652626, "lng": 46.6192407}, "owner": {"name": "العجلان للعقارات", "phone": "+966542044988", "email": "ksa7712@hotmail.com"}, "additional_contact": None}

R19471 = {"id": 19471, "slug": "1-bedroom-apartment-for-rent-in-al-khubar-ash-shamaliyah-dist-khobar-1", "status": "publish", "availability": "available", "listing_type": {"key": "for-rent", "label": "إيجار"}, "property_type": {"name": "شقة"}, "land_type": None, "city": {"name": "الخبر"}, "area": {"name": "حي الخبر الشمالية"}, "title": "شقة 1 غرف للإيجار في حي الخبر الشمالية، الخبر", "description": "شقة متاحة للإيجار في حي الخبر الشمالية بالخبر، وتقع في المنطقة الشرقية. تبلغ مساحتها 75 متر مربع، وقد بُنيت عام 2015، وتأتي غير مفروشة.\n\nتضم الشقة غرفة نوم واحدة وحمام واحد، بالإضافة إلى ملحق. تتوفر في الوحدة كهرباء وماء لضمان راحة سكنية كاملة.\n\nالسعر الشهري هو 13,000 ريال سعودي. لا تفوت فرصة الإقامة في هذه المساحة المثالية – اتصل بنا اليوم لتحديد موعد زيارة 0502152802.", "price": 13000, "area_sqm": 75, "bedrooms": 1, "bathrooms": 1, "floor_number": 0, "building_year": 2015, "direction": None, "surrounding_streets": None, "ad_license_number": "7201003358", "image": {"path": "https://cdn.dwelleo.sa/149791/8HSs6EfVthxDMzs2ysTWMK92d8VtwdqXjWGKqi8Y.png"}, "tags": [{"name": "شرفة"}], "maid_room": 0, "driver_room": None, "parking_space": 0, "furnishing_status": "unfurnished", "utility_availability": ["electricity", "water"], "location": {"address": "EKDC7696, 3154, Al Khobar Al Shamalia, الخبر 34426, Saudi Arabia", "lat": 26.2943875, "lng": 50.2136094}, "owner": {"name": "Al Nahdi Real Estate Co.", "phone": "966-508699992", "email": "s.alnahdi1147@gmail.com"}, "additional_contact": None}

R19658 = {"id": 19658, "slug": "1-bedroom-apartment-for-rent-in-al-nakheel-dist-riyadh-5", "status": "publish", "availability": "available", "listing_type": {"key": "for-rent", "label": "إيجار"}, "property_type": {"name": "شقة"}, "land_type": None, "city": {"name": "الرياض"}, "area": {"name": "حي النخيل"}, "title": "شقة 1 غرف للإيجار في حي النخيل، الرياض", "description": "شقة مفروشة للإيجار الشهري والسنوي في حي النخيل – شمال الرياض\n\nتقدم شركة غالينا العقارية شققًا مفروشة ومؤثثة بالكامل في موقع مميز بحي النخيل، شارع جبل الزيتون، مع خيارات للإيجار الشهري والسنوي.\n\nيتميز الموقع بقربه من أبرز الخدمات والفعاليات والمواقع الحيوية، ومنها جامعة الملك سعود، المدينة الرقمية، وكافد – المركز المالي.\n\nتفاصيل العقار\nنوع العقار: شقة مفروشة\nنوع العرض: للإيجار الشهري والسنوي\nالموقع: حي النخيل، شمال الرياض\nالشارع: جبل الزيتون\nالمساحة: 70 م²\nغرف النوم: غرفة واحدة\nدورة المياه: 1\nالتأثيث: مفروشة ومؤثثة بالكامل\nمكونات الشقة\nغرفة نوم\nصالة جلوس\nمطبخ\nدورة مياه\nالأسعار والخدمات المشمولة\n\nالأسعار تشمل:\n\nفواتير الكهرباء والمياه\nإنترنت عالي السرعة\nصيانة دورية\nالمميزات والخدمات\nمكيف\nقريب من الطرق الرئيسية\nنظام كاميرات مراقبة\nعداد كهرباء مستقل\nمدخل خاص\nمياه\nهاتف\nصرف صحي\nالأماكن والمرافق القريبة\nمدارس\nمستشفيات\nمسجد\nمراكز تسوق\nالخدمات والصيانة\nخدمات صيانة\nخدمة التخلص من النفايات", "price": 62400, "area_sqm": 70, "bedrooms": 1, "bathrooms": 1, "floor_number": 0, "building_year": 2024, "direction": None, "surrounding_streets": None, "ad_license_number": "7200747987", "image": {"path": "https://cdn.dwelleo.sa/151212/zdMS58xJDKQQFU7y5xygmBwdmU6eVm9Hr0p7v4i8.jpg"}, "tags": [{"name": "واي فاي"}], "maid_room": 0, "driver_room": None, "parking_space": 0, "furnishing_status": "furnished", "utility_availability": ["water", "electricity"], "location": {"address": "RGNA3851, 3851 Zaytoun Mountain, 7550، حي النخيل، Riyadh 12384, Saudi Arabia", "lat": 24.7492375, "lng": 46.6354531}, "owner": {"name": "شركة غالينا العقارية", "phone": "966538724000", "email": "Hasane1010@gmail.com"}, "additional_contact": None}

R2427 = {"id": 2427, "slug": "4-bedroom-villa-for-sale-in-al-rahmaniyah-jeddah", "status": "publish", "availability": "available", "listing_type": {"key": "for-sale", "label": "بيع"}, "property_type": {"name": "فيلا"}, "land_type": "residential", "city": {"name": "جدة"}, "area": {"name": "حي الرحمانية"}, "title": "فيلا 4 غرف للبيع في حي الرحمانية  جدة ", "description": "فيلا فاخرة للبيع في حي الرحمانية بمدينة الرياض\nفرصة مميزة لامتلاك فيلا جديدة في أحد أرقى أحياء الرياض بموقع استراتيجي قريب من المدارس والخدمات والمجمعات التجارية وتتميز الفيلا بتصميم معماري عصري وتشطيب فاخر ومساحات عملية تناسب الباحثين عن السكن الراقي والخصوصية\nتتكون الفيلا من دورين وملحق علوي بمساحة إجمالية 300 متر مربع حيث يضم الدور الأرضي مجلس رجال فاخر ومقلط وصالة عائلية واسعة ومجلس نساء أنيق ومطبخ مجهز ودورات مياه بينما يضم الدور الأول 4 غرف نوم منها غرفة ماستر بالإضافة إلى صالة عائلية ودورات مياه ويشتمل الملحق العلوي على غرفة خادمة وغرفة غسيل وسطح واسع\nكما تتميز الفيلا بوجود مدخل سيارة وحوش خارجي وتشطيبات فاخرة بأعلى المواصفات مع تصميم عصري وأنيق والفيلا جديدة تمامًا وجاهزة للسكن\nالسعر 1 مليون و300 ألف ريال سعودي\nللتواصل وتحديد موعد للمعاينة\n0500118055\n\n0580999909\n\nترخيص الإعلان 7200678872\n\nرخصة فال للوساطة والتسويق 1200007758\n\n", "price": 1300000, "area_sqm": 275, "bedrooms": 4, "bathrooms": 5, "floor_number": None, "building_year": 2025, "direction": None, "surrounding_streets": None, "ad_license_number": "7200678872", "image": {"path": "https://cdn.dwelleo.sa/45718/01KWA3F55VDRXVS2NFP78DMCW5.png"}, "tags": [{"name": "جراج"}, {"name": "شرفة"}], "maid_room": 1, "driver_room": 0, "parking_space": 1, "furnishing_status": "unfurnished", "utility_availability": ["electricity", "water", "fiber_optics"], "location": {"address": "JGRA8778، 8778, 2861 عبد المغيث الحربي، الرحمانية، جدة 23765, Saudi Arabia", "lat": 21.8022875, "lng": 39.2055156}, "owner": {"name": "النهدي للاستثمارات العقاريه", "phone": "966-580999909", "whatsapp_number": "966-580999909", "email": "Ibrahim9909@hotmail.com"}, "additional_contact": None}

R15232 = {"id": 15232, "slug": "4-bedroom-villa-for-sale-in-al-mahdiyah-riyadh-51", "status": "publish", "availability": "available", "listing_type": {"key": "for-sale", "label": "بيع"}, "property_type": {"name": "فيلا"}, "land_type": None, "city": {"name": "الرياض"}, "area": {"name": "حي المهدية"}, "title": "فيلا 4 غرف نوم للبيع في المهدية، الرياض", "description": "فيلا 4 غرف نوم للبيع في شارع محمد بن أبي بكر القيم، حي المهدية، غرب الرياض. تبلغ مساحتها 227 م²، وتتكون من 4 غرف نوم و3 دورات مياه ومطبخ. تتميز بواجهة غربية على شارع بعرض 20 مترًا، وتقع ضمن المخطط رقم 2566/ب.\n\nالتفاصيل:\n\n4 غرف نوم\n3 دورات مياه\nالمساحة: 227 م²\nمطبخ\nالواجهة: غربية\nعرض الشارع: 20 متر\nرقم المخطط: 2566/ب\n\nالمميزات:\n\nواجهة غربية\nشارع بعرض 20 مترًا\nتوزيع عملي مناسب للعائلات\nتقع في حي المهدية، غرب الرياض", "price": 1400000, "area_sqm": 227, "bedrooms": 4, "bathrooms": 3, "floor_number": None, "building_year": 2025, "direction": None, "surrounding_streets": None, "ad_license_number": "7200899466", "image": {"path": "https://cdn.dwelleo.sa/121490/BrXKZ9OXWiZB3nz7x6zDvpCTOAacpJnPnxtVjqrV.png"}, "tags": [{"name": "جراج"}], "maid_room": 0, "driver_room": 0, "parking_space": 0, "furnishing_status": "unfurnished", "utility_availability": ["water", "electricity"], "location": {"address": "MG27+RMJ Al Mahdiyah, Riyadh, Saudi Arabia", "lat": 24.652078, "lng": 46.514147}, "owner": {"name": "شركة نوس العقارية", "phone": "+966559773539", "email": "gggggggggg55550@gmail.com"}, "additional_contact": None}
D15232 = {"street_width": None, "property_area": {"id": 162, "name": "حي المهدية", "city_id": 1}, "area": 227, "region": {"id": 1, "name": "الرياض"}, "land_area": None, "livings": 0, "master_bedroom_count": None, "amenities": [], "images": [{"path": "https://cdn.dwelleo.sa/121490/BrXKZ9OXWiZB3nz7x6zDvpCTOAacpJnPnxtVjqrV.png"}, {"path": "https://cdn.dwelleo.sa/121491/yrYccRWMiTgcslWVNzlFSWRzA8nWJExTRqPxQFRv.png"}, {"path": "https://cdn.dwelleo.sa/121492/4BW3kKkG3uVDlbkeW2FcyD8t8PSKaamCrTIrML1l.png"}, {"path": "https://cdn.dwelleo.sa/121493/1rEwucH7tbYv3hjgYZYVLxBUXnoJeEZEN9htL0RP.png"}, {"path": "https://cdn.dwelleo.sa/121494/yuAF3ry5zHkltDm1Kqdmu2050AYZEDSZzSzLS8Ny.png"}, {"path": "https://cdn.dwelleo.sa/121495/QY0PJaPfWW2EfDwgokqWLMCRdcM6TMbfH0M8OZ5e.png"}], "owner": {"name": "شركة نوس العقارية", "phone": "+966559773539", "whatsapp_number": None, "email": "gggggggggg55550@gmail.com"}, "rental_yield": {"annual_rent": 75600, "gross_yield": 5.4}}

# skip fixtures — the code never reaches the description on these, so it is omitted
R17573 = {"id": 17573, "slug": "1344-sqm-residential-commercial-land-for-sale-in-al-danah-al-ahsa-1", "status": "publish", "availability": "available", "listing_type": {"key": "for-sale", "label": "بيع"}, "property_type": {"name": "ارض"}, "land_type": "residential", "city": {"name": "الهفوف"}, "area": {"name": "حي الدانة"}, "title": "أرض سكنية تجارية 1,344 م² للبيع في الدانة، الأحساء", "price": 2958861.4, "area_sqm": 1344, "bedrooms": None, "bathrooms": None, "floor_number": None, "building_year": None, "direction": "eastern", "surrounding_streets": None, "ad_license_number": "7200984115", "image": {"path": "https://cdn.dwelleo.sa/136971/5DtqYENcPW8CU2Ce2cqq078bxxj86z5lwfG1fPBr.jpg"}, "tags": [], "maid_room": None, "driver_room": None, "parking_space": None, "furnishing_status": None, "utility_availability": ["water", "electricity"], "location": {"address": "FHGH7552, 7552 Prince Faisal Bin Fahd Bin Abdulaziz St, 4384, Aldanah, Al Hofuf 36443, Saudi Arabia", "lat": 25.2931375, "lng": 49.6150781}, "owner": {"name": "مؤسسة ميثاق دار الأركان العقارية", "phone": "966-595333033", "whatsapp_number": "966-595333033", "email": "Htomi203@icloud.com"}, "additional_contact": None}
R12843 = {"id": 12843, "slug": "4-bedroom-apartment-for-sale-in-al-safa-jeddah-1", "status": "publish", "availability": "available", "listing_type": {"key": "for-sale", "label": "بيع"}, "property_type": {"name": "شقة"}, "land_type": None, "city": {"name": "جدة"}, "area": {"name": "حي الصفا"}, "title": "شقة 4 غرف للبيع في الصفا، جدة", "price": 585000, "area_sqm": 133, "bedrooms": 4, "bathrooms": 1, "floor_number": 0, "building_year": 2024, "direction": "southeastern", "surrounding_streets": 2, "ad_license_number": "7201015915", "image": {"path": "https://cdn.dwelleo.sa/106396/sWbvm7QYSqe1xUrW2fhbJB7kiK3H4ssv8PbtOMMg.jpg"}, "tags": [{"name": "جراج"}], "maid_room": 0, "driver_room": None, "parking_space": 0, "furnishing_status": "unfurnished", "utility_availability": ["water", "electricity", "fiber_optics"], "location": {"address": "JDSA8318، 8318 شرجيل بن حسنه، 3573، حي الصفا، جدة 23454, Saudi Arabia", "lat": 21.5831125, "lng": 39.2136719}, "owner": {"name": "شركة الهدي للخدمات العقارية", "phone": "966-535233407", "whatsapp_number": "966-535233407", "email": "Hudacompany74@gmail.com"}, "additional_contact": None}
R12363 = {"id": 12363, "slug": "1250-sqm-residential-land-for-sale-in-al-lulu-district-jeddah", "status": "publish", "availability": "available", "listing_type": {"key": "for-sale", "label": "بيع"}, "property_type": {"name": "ارض"}, "land_type": "residential", "city": {"name": "جدة"}, "area": {"name": "حي اللؤلؤ"}, "title": "1,250 م²أرض سكنية للبيع في حي اللؤلؤ - مدينة جدة", "price": 4200000, "area_sqm": 1250, "bedrooms": None, "bathrooms": None, "floor_number": None, "building_year": None, "direction": "شرقي", "surrounding_streets": 2, "ad_license_number": "1234", "image": {"path": "https://cdn.dwelleo.sa/103264/qapC3Y76rGpbuqUt0hTwdRdS18WOg8ohD1TOfVBX.png"}, "tags": [], "maid_room": None, "driver_room": None, "parking_space": None, "furnishing_status": None, "utility_availability": [], "location": {"address": "Al Loaloa Dist.", "lat": 21.766195, "lng": 39.060728}, "owner": {"name": "مؤسسة الاصول الشاملة العقارية", "phone": "966-545046666", "whatsapp_number": "966-545046666", "email": "turki_madani@hotmail.com"}, "additional_contact": None}
R19573 = {"id": 19573, "slug": "640-sqm-land-for-sale-in-al-safa-dist-tabuk", "status": "publish", "availability": "available", "listing_type": {"key": "for-sale", "label": "بيع"}, "property_type": {"name": "ارض"}, "land_type": "commercial", "city": {"name": "تبوك"}, "area": {"name": "حي الصفا"}, "title": "ارض 640 متر مربع للبيع في حي الصفا، تبوك", "price": 128000, "area_sqm": 640, "bedrooms": None, "bathrooms": None, "floor_number": None, "building_year": None, "direction": None, "surrounding_streets": None, "ad_license_number": "7200728848", "image": {"path": "https://cdn.dwelleo.sa/150576/1rMmgL4bZSuhnyJ4o9LGj6qeh9wmdg3XFptVCamI.png"}, "tags": [], "maid_room": None, "driver_room": None, "parking_space": None, "furnishing_status": None, "utility_availability": [], "location": {"address": "KGAA6173، 6173 فاطمه الزهراء، 2770، حي الصفا، Tabuk 47918, Saudi Arabia", "lat": 28.36563, "lng": 36.4926567}, "owner": {"name": "تسنيم الشمال العقاريه", "phone": "966550273777", "email": "waled01@hotmail.com"}, "additional_contact": None}
R18374 = {"id": 18374, "slug": "270-sqm-land-for-sale-in-al-rimal-dist-riyadh", "status": "publish", "availability": "available", "listing_type": {"key": "for-sale", "label": "بيع"}, "property_type": {"name": "ارض"}, "land_type": "raw_land", "city": {"name": "الرياض"}, "area": {"name": "حي الرمال"}, "title": "ارض 270 متر مربع للبيع في حي الرمال، الرياض", "price": 972000, "area_sqm": 270, "bedrooms": None, "bathrooms": None, "floor_number": None, "building_year": None, "direction": "western", "surrounding_streets": None, "ad_license_number": "500126587", "image": {"path": "https://cdn.dwelleo.sa/142291/ILcaM5T1Kr0yqk3RbkqN4EWAHjvRBiEVZUBewtK4.png"}, "tags": [], "maid_room": None, "driver_room": None, "parking_space": None, "furnishing_status": None, "utility_availability": ["water", "electricity"], "location": {"address": "RUAC8538، 8538 جمال الدين أبي السعود ظهيرة، 3631، حي الرمال، الرياض 13436, Saudi Arabia", "lat": 24.9320625, "lng": 46.7916406}, "owner": {"name": "مؤسسة نجمة الشرق للخدمات العقارية", "phone": "966532770006", "email": "info@aqrstar.com"}, "additional_contact": None}
R14951 = {"id": 14951, "slug": "626-sqm-building-for-rent-in-al-harabi-dist-khamis-mushait", "status": "publish", "availability": "available", "listing_type": {"key": "for-rent", "label": "إيجار"}, "property_type": {"name": "مبني"}, "land_type": None, "city": {"name": "خميس مشيط"}, "area": {"name": "حي الحرابى"}, "title": "مبني 626 متر مربع للإيجار في حي الحرابى، خميس مشيط", "description": "هذا المبنى الواسع بمساحة 626 متر مربع متاح للإيجار في حي الحرابى، خميس مشيط. تم بناؤه في عام 2019 ويضم 18 دورة مياه.\n\nيشتمل العقار على ساحة، بالإضافة إلى الخدمات الأساسية كالكهرباء والماء.\n\nلا تفوت فرصة استئجار هذا العقار الرائع، اتصل بنا اليوم.", "price": 325000, "area_sqm": 626, "bedrooms": 30, "bathrooms": 18, "floor_number": 6, "building_year": 2019, "direction": None, "surrounding_streets": None, "ad_license_number": "7100257837", "image": {"path": "https://cdn.dwelleo.sa/119549/KYXFtur5HRteSN81Xd7YKmeyzBcC3xW1zcQhgPnq.png"}, "tags": [{"name": "حديقة"}], "maid_room": None, "driver_room": None, "parking_space": 0, "furnishing_status": None, "utility_availability": ["electricity", "water"], "location": {"address": "AKGB4976، 4976 الحرابى 42، 8562, Al Shifa, Khamis Mushait 62436, Saudi Arabia", "lat": 18.2512125, "lng": 42.7377344}, "owner": {"name": "Sarona Real Estate", "phone": "966-562367033", "whatsapp_number": "966-562367033", "email": "asaronh46@gmail.com"}, "additional_contact": None}
R2068 = {"id": 2068, "slug": "2-bedroom-apartment-for-sale-in-al-narjis-district-riyadh", "status": "publish", "availability": "available", "listing_type": {"key": "for-sale", "label": "بيع"}, "property_type": {"name": "شقة"}, "land_type": None, "city": {"name": "الرياض"}, "area": {"name": "حي النرجس"}, "title": "شقةغرفتين نوم للبيع في حي النرجس، الرياض", "price": 1049040, "area_sqm": 109, "bedrooms": 2, "bathrooms": 3, "floor_number": 1, "building_year": 2025, "direction": None, "surrounding_streets": None, "ad_license_number": "548412122122", "image": {"path": "https://cdn.dwelleo.sa/26354/01KRGDXTD8RNGSB67117Y4P01P.png"}, "tags": [{"name": "جراج"}, {"name": "مصعد"}, {"name": "شرفة"}], "maid_room": None, "driver_room": None, "parking_space": 1, "furnishing_status": "unfurnished", "utility_availability": ["water", "electricity", "fiber_optics"], "location": {"address": "RMMH+PMM, An Narjis, Riyadh 13327, Saudi Arabia", "lat": 24.8343347, "lng": 46.6791822}, "owner": {"name": "ارم الخليج للتطوير العقاري", "phone": "966-553353229", "whatsapp_number": "966-5533532", "email": "AhmedHegazy@eeramalkhaliji.com"}, "additional_contact": "966"}
R18891 = {"id": 18891, "slug": "3-bedroom-apartment-for-sale-in-al-jawharah-dist-dammam-1", "status": "publish", "availability": "sold", "listing_type": {"key": "for-sale", "label": "بيع"}, "property_type": {"name": "شقة"}, "land_type": None, "city": {"name": "الدمام"}, "area": {"name": "حي الجوهرة"}, "title": "شقة 3 غرف للبيع في حي الجوهرة، الدمام", "price": 750000, "area_sqm": 185, "bedrooms": 3, "bathrooms": 3, "floor_number": 0, "building_year": 2025, "direction": None, "surrounding_streets": None, "ad_license_number": "1234567", "image": {"path": "https://cdn.dwelleo.sa/145736/ZtTdnxHJTOjFwPOk9gklo0MAHFHS3SAHzpMbsJSj.png"}, "tags": [{"name": "جراج"}], "maid_room": 0, "driver_room": None, "parking_space": 1, "furnishing_status": "unfurnished", "utility_availability": ["electricity", "water", "fiber_optics"], "location": {"address": "Al Jawharah Dist.", "lat": 25.3172542, "lng": 49.5504963}, "owner": {"name": "شركه أساس الذهب العقاريه", "phone": "966920018351", "whatsapp_number": "966920018351", "email": "Thegoldbase@gmail.com"}, "additional_contact": None}
R17539 = {"id": 17539, "slug": "2-bedrooms-apartment-for-sale-in-al-sharafiyah-jeddah-2", "status": "publish", "availability": "off-plan", "listing_type": {"key": "for-sale", "label": "بيع"}, "property_type": {"name": "شقة"}, "land_type": None, "city": {"name": "جدة"}, "area": {"name": "حي الشرفية"}, "title": "شقة 2 غرفة نوم للبيع في الشرفية، جدة", "price": 730000, "area_sqm": 221, "bedrooms": 2, "bathrooms": 3, "floor_number": 5, "building_year": 2026, "direction": "northwestern", "surrounding_streets": None, "ad_license_number": "0", "image": {"path": "https://cdn.dwelleo.sa/136772/xPrQhk8CKoY8BwDh74zXZpmcF0A9eUeUvDryiH1L.png"}, "tags": [{"name": "جراج"}, {"name": "مصعد"}, {"name": "منزل ذكي"}], "maid_room": 0, "driver_room": None, "parking_space": 2, "furnishing_status": "unfurnished", "utility_availability": ["water", "electricity"], "location": {"address": "G57R+M98, Al Sharafeyah, Jeddah 23217, Saudi Arabia", "lat": 21.514176583523, "lng": 39.191234639993}, "owner": {"name": "مكتب دروب الرفاهيه العقاري", "phone": "966565680701", "email": "Dorobalrafahyah.sm@gmail.com"}, "additional_contact": "966"}
R19277 = {"id": 19277, "slug": "5-bedroom-apartment-for-sale-in-al-manar-dist-jeddah-5", "status": "publish", "availability": "later", "listing_type": {"key": "re-sale", "label": "إعادة بيع"}, "property_type": {"name": "شقة"}, "land_type": None, "city": {"name": "جدة"}, "area": {"name": "حي المنار"}, "title": "شقة 5 غرف للبيع في حي المنار، جدة", "price": 880000, "area_sqm": 259, "bedrooms": 5, "bathrooms": 4, "floor_number": 0, "building_year": 2026, "direction": None, "surrounding_streets": None, "ad_license_number": "23131313", "image": {"path": "https://cdn.dwelleo.sa/148521/BfUZfLIEKW3vxjjnUt7lE6a0PT9XO809rzhqW6A9.png"}, "tags": [{"name": "جراج"}, {"name": "مصعد"}], "maid_room": 1, "driver_room": None, "parking_space": 1, "furnishing_status": "unfurnished", "utility_availability": ["electricity", "water"], "location": {"address": "H6XJ+JM6, Al-Manar, Jeddah 23462, Saudi Arabia", "lat": 21.5989375, "lng": 39.2332031}, "owner": {"name": "ABDULLAH ELMASABI", "phone": "966-5022196", "whatsapp_number": "966-5022196", "email": "anmsvi@outlook.com"}, "additional_contact": None}
R19609 = {"id": 19609, "slug": "four-recreational-units-istirahas-for-sale-al-bayan-district-riyadh", "status": "publish", "availability": "available", "listing_type": {"key": "for-sale", "label": "بيع"}, "property_type": {"name": "غير محدد"}, "land_type": None, "city": {"name": "الرياض"}, "area": {"name": "حي البيان"}, "title": "أربع استراحات للبيع | حي البيان – الرياض", "price": 1700000, "area_sqm": 525, "bedrooms": None, "bathrooms": None, "floor_number": None, "building_year": 2021, "direction": None, "surrounding_streets": None, "ad_license_number": "7200766896", "image": {"path": "https://cdn.dwelleo.sa/150883/ZTHlTWInKTKAnY7bjlcIgu9ux9VOadqfKXN9wEAS.jpg"}, "tags": [{"name": "واي فاي"}], "maid_room": None, "driver_room": None, "parking_space": 1, "furnishing_status": None, "utility_availability": ["water", "electricity"], "location": {"address": "RTBC7141، 7141 ابن الجزري، 2899، حي البيان، Riyadh 13618, Saudi Arabia", "lat": 24.8772647, "lng": 46.8649423}, "owner": {"name": "شركة قمم نجد العقارية", "phone": "+966 56 256 1794", "whatsapp_number": "966-562561794", "email": "ahmdyhzkrya947@gmail.com"}, "additional_contact": None}
R15678 = {"id": 15678, "slug": "test-distinctive-apartment-for-sale-in-al-rim-7b5c87", "status": "publish", "availability": "available", "listing_type": {"key": "for-sale", "label": "بيع"}, "property_type": {"name": "شقة"}, "land_type": None, "city": {"name": "الرياض"}, "area": {"name": "حي الرمال"}, "title": "[تجربة دويليو] شقة مميزة للبيع في حي الرمال | الوحدة A17", "description": "شقة مميزة للبيع في حي الرمال | الوحدة A17\n\nفرصة سكنية مميزة للبيع ضمن مشروع أكنان 23 في حي الرمال بمدينة الرياض، بمساحة واسعة وتصميم عصري يوفر الراحة والخصوصية، في موقع استراتيجي قريب من أهم الخدمات والمرافق والطرق الرئيسية.\n\nتفاصيل الوحدة\n\nرقم الوحدة: A17\nنوع العقار: شقة\nالدور: الثاني\nالمساحة: 164.72 م²\nالسعر: 1,013,028 ريال", "price": 1013028, "area_sqm": 164, "bedrooms": None, "bathrooms": None, "floor_number": None, "building_year": 2025, "direction": None, "surrounding_streets": None, "ad_license_number": "1200047556", "image": {"path": "https://cdn.dwelleo.sa/124689/5h9C7nkvCtuiSsXeqT0M4PVvcgRsBY1wmgTRz6Wr.png"}, "tags": [], "maid_room": None, "driver_room": None, "parking_space": 1, "furnishing_status": "unfurnished", "utility_availability": ["water", "electricity", "fiber_optics"], "location": {"address": "RRXQ+V88, Riyadh Saudi Arabia", "lat": 24.8496625, "lng": 46.8383281}, "owner": {"name": "Test Indiv Broker (Production)", "phone": "+995593900655", "email": "test.indivbroker@dwelleo-test.com"}, "additional_contact": None}
R2651 = {"id": 2651, "slug": "2-bedroom-chalet-for-daily-rent-in-shahbah-al-baha", "status": "publish", "availability": "available", "listing_type": {"key": "short-term-rental", "label": "إيجار قصير الأجل"}, "property_type": {"name": "غير محدد"}, "land_type": None, "city": {"name": "الباحة"}, "area": {"name": "حي شهبة"}, "title": "2 غرف، شاليه للإيجار اليومي في حي شهبة - مدينة الباحة", "price": 292000, "area_sqm": 80, "bedrooms": 2, "bathrooms": 2, "floor_number": 7, "building_year": 2024, "direction": None, "surrounding_streets": None, "ad_license_number": "1234", "image": {"path": "https://cdn.dwelleo.sa/38799/01KVKCBFBWEKKJ26907DY9M7XF.png"}, "tags": [{"name": "شرفة"}, {"name": "جراج"}], "maid_room": 0, "driver_room": None, "parking_space": 1, "furnishing_status": "furnished", "utility_availability": ["water", "electricity"], "location": {"address": "BAAB2942، 2942 عبدالله ابن جعفر، 7851، حي شهبة، Al Bahah 65711, Saudi Arabia", "lat": 20.0359812, "lng": 41.4848327}, "owner": {"name": "ميدكم للعقارات", "phone": "966-557272999", "whatsapp_number": "966-057272999", "email": "a-7272999@hotmail.com"}, "additional_contact": None}


def _map(rec, **detail):
    row, cat, why = R.map_listing({**rec, **detail}, this_year=YEAR)
    return row, cat, why


# ============================ RENT PERIOD = SOURCE ===========================================
def test_a_silent_rent_keeps_the_figure_and_states_no_period():
    row, cat, why = _map(R18630, **D18630)
    assert row and cat == "residential", why
    assert row["transaction_type"] == "Rent"
    assert row["price_annual"] == 60000 and row.get("rent_period") is R.db.AUTHORITATIVE_NULL
    assert row["additional_info"]["rent_period_note"] == "silent"
    assert "price_total" not in row


def test_a_stated_annual_rent_is_annual_and_the_figure_is_verbatim():
    row, _, _ = _map(R1378)
    assert row["rent_period"] == "annual" and row["price_annual"] == 150000
    assert row["property_type"] == "Villa"      # «تاون هاوس», the fleet's existing override


def test_a_stated_monthly_rent_is_monthly_and_annualised_by_the_shared_helper():
    row, _, _ = _map(R19471)
    assert row["rent_period"] == "monthly" and row["price_annual"] == 13000 * 12
    assert row["source_capture"] if "source_capture" in row else True   # db builds the capture


def test_both_monthly_and_annual_for_one_figure_is_null_and_unconverted():
    row, _, _ = _map(R19658)
    assert row.get("rent_period") is R.db.AUTHORITATIVE_NULL and row["price_annual"] == 62400
    assert row["additional_info"]["rent_period_note"] == "mixed"
    assert row["furnished"] is True           # furnishing_status: furnished


def test_a_nightly_only_text_withholds_the_figure_rather_than_parking_it_as_annual():
    """SYNTHETIC: no live dwelleo rental states a nightly-only price (0 of 2,576 measured); this pins
    the rule against a future one. Same real record, the period words replaced."""
    rec = {**R18630, "description": "شقة مفروشة، الإيجار اليومي 300 ريال شامل الخدمات."}
    row, _, _ = _map(rec, **D18630)
    assert row["price_annual"] is R.db.AUTHORITATIVE_NULL and row.get("rent_period") is R.db.AUTHORITATIVE_NULL
    assert row["additional_info"]["rent_period_note"] == "sub_monthly"


def test_a_silent_or_sub_monthly_rent_period_survives_the_real_no_clobber_guard():
    """FIX (reviewer blocker on the builder's report): a plain None/absent rent_period is DROPPED
    by the real db._unknown_must_not_overwrite_known before the upsert, so a stale 'monthly' or
    'annual' value from an earlier crawl would freeze in place forever once THIS crawl finds the
    source silent, mixed, or nightly-only — exactly the aqarcity incident. Runs the REAL guard
    (not a re-implementation) on the REAL mapped rows to prove the sentinel actually reaches the
    write path, not just the in-memory row."""
    silent_row, _, _ = _map(R18630, **D18630)
    R.db._unknown_must_not_overwrite_known(silent_row)
    assert "rent_period" in silent_row and silent_row["rent_period"] is None   # key survives as NULL

    nightly_rec = {**R18630, "description": "شقة مفروشة، الإيجار اليومي 300 ريال شامل الخدمات."}
    nightly_row, _, _ = _map(nightly_rec, **D18630)
    R.db._unknown_must_not_overwrite_known(nightly_row)
    assert "rent_period" in nightly_row and nightly_row["rent_period"] is None
    assert "price_annual" in nightly_row and nightly_row["price_annual"] is None


def test_a_nightly_only_rows_price_evidence_never_carries_the_raw_sentinel():
    """FIX (found while fixing the AUTHORITATIVE_NULL blocker above): price_evidence's `stored`
    is folded into source_capture and written to a jsonb column — the raw _AuthoritativeNull
    object is not JSON-serializable, so passing it through verbatim would crash the write (or
    worse, silently corrupt the capture) on every sub_monthly-only rent row. Matches jawher's own
    `stored=... if isinstance(...) else None` / `authoritative_absent=... is AUTHORITATIVE_NULL`."""
    import json
    nightly_rec = {**R18630, "description": "شقة مفروشة، الإيجار اليومي 300 ريال شامل الخدمات."}
    row, _, _ = _map(nightly_rec, **D18630)
    assert row["price_evidence"]["stored"] is None          # coerced, never the sentinel object
    assert row["price_evidence"]["authoritative_absent"] is True
    json.dumps(row["price_evidence"])                        # raises if the sentinel leaked through


def test_weekly_cleaning_and_daily_needs_are_not_rent_periods():
    assert R.rent_terms("نظافة أسبوعية مجانية، الخدمات التي تحتاجها يومياً، إطلالة ليلية") == (None, "silent")
    assert R.rent_terms("الإيجار السنوي 30,000 ريال مع دفع ربع سنوي") == (None, "mixed")
    assert R.rent_terms("تأمين شهرين، الإيجار السنوي 50,000") == ("annual", "stated")


def test_a_buy_row_never_carries_a_rent_period_and_the_ai_yield_is_ignored():
    row, _, _ = _map(R15232, **D15232)
    assert row["price_total"] == 1400000 and "price_annual" not in row and "rent_period" not in row
    assert "rental_yield" not in row["additional_info"] and "75600" not in str(row["additional_info"])
    assert row["price_evidence"]["raw"] == 1400000 and row["price_evidence"]["origin"] == "api"


def test_a_decimal_price_is_kept_to_whole_riyals_with_the_decimal_string_as_evidence(monkeypatch):
    monkeypatch.setattr(R, "to_catalog", lambda c, h=None: (3677, 5))   # live: الهفوف is unplaced
    row, _, _ = _map(R17573)
    assert row["price_total"] == 2958861 and row["additional_info"]["price_raw"] == "2958861.4"
    assert row["property_type"] == "Residential Land" and row["direction"] == "شرق"


# ============================ TRI-STATE + AF COLUMNS =========================================
def test_zero_filled_rooms_and_parking_are_silence_not_no():
    row, _, _ = _map(R15232, **D15232)                      # maid 0, driver 0, parking_space 0
    assert "maid_room" not in row and "driver_room" not in row
    assert row["parking"] is True                            # …but the «جراج» tag names one
    assert row["kitchen"] is True                            # «ومطبخ» in the prose
    assert row["furnished"] is False                         # furnishing_status: unfurnished
    assert row["street_width_m"] == 20                       # «عرض الشارع: 20 متر» — prose fallback
    assert row["property_age"] == 1                          # building_year 2025 at this_year 2026


def test_positive_counts_and_named_chips_set_true():
    row, _, _ = _map(R1378)                                  # maid 1, driver 1, parking 2
    assert row["maid_room"] is True and row["driver_room"] is True and row["parking"] is True
    assert row["elevator"] is True and row["private_entrance"] is True
    assert row["electricity"] is True and row["water_supply"] is True
    assert "optical_fibers" not in row                       # not in utility_availability → silent


def test_the_detail_record_renames_the_district_and_reuses_area_for_a_number():
    row, _, _ = _map(R18630, **D18630)
    assert row["neighborhood"] == "حي غرناطة" and row["district_ar"] == "حي غرناطة"
    assert row["area_m2"] == 168 and row["halls"] == 1
    assert row["parking"] is True and row["elevator"] is True     # amenities[] chips
    assert row["furnished"] is False                              # «غير مفروشة» + unfurnished
    assert len(row["photo_urls"]) == 8 and all(u.startswith("https://cdn.dwelleo.sa/") for u in row["photo_urls"])
    assert row["images_evidence"]["count"] == 8 and row["images_evidence"]["key_present"]


def test_the_english_direction_enum_lands_as_the_arabic_canon():
    row, _, _ = _map(R12843)
    assert row["direction"] == "جنوب شرق"
    assert row["street_width_m"] is None and row["additional_info"]["surrounding_streets_count"] == 2
    row, _, _ = _map(R12363)
    assert row["direction"] == "شرق" and row["floor_number"] is None and row["bedrooms"] is None


def test_a_buildings_room_stock_is_not_bedrooms():
    row, cat, _ = _map(R14951)
    assert row["property_type"] == "Building" and cat == "residential"
    assert row["bedrooms"] is None and row["bathrooms"] is None
    assert row["additional_info"]["source_bedrooms"] == 30
    assert row["price_annual"] == 325000 and row.get("rent_period") is R.db.AUTHORITATIVE_NULL
    assert row["floor_number"] is None and row["additional_info"]["building_floor_number"] == 6   # floor COUNT
    assert _map(R18630, **D18630)[0]["floor_number"] == 2    # a dwelling's unit floor still lands


def test_the_typed_ac_field_sets_availability_tri_state_and_keeps_the_type():
    """SYNTHETIC values on a real record: ac_type is None on 66/66 live details sampled 2026-09-24
    (the list card never carries it). The fleet registry's typed values pin the rule."""
    base = {**R18630, **D18630}                              # prose names no AC → key absent
    assert "air_conditioner" not in _map(base)[0]
    row, _, _ = _map({**base, "ac_type": "split"})
    assert row["air_conditioner"] is True and row["additional_info"]["ac_type"] == "split"
    row, _, _ = _map({**base, "ac_type": "None"})
    assert row["air_conditioner"] is False                   # a typed «None» is «no AC», not «has one»
    assert "air_conditioner" not in _map({**base, "ac_type": "whatever"})[0]   # unknown → silence


def test_only_the_rega_ad_licence_shape_reaches_license_number():
    row, _, _ = _map(R14951)                                 # 7100257837 — a 71xx AD licence
    assert row["license_number"] == "7100257837"
    row, _, _ = _map(R12363)                                 # «1234» placeholder
    assert row["license_number"] is None and row["additional_info"]["ad_license_raw"] == "1234"
    row, _, _ = _map(R2068)                                  # 548412122122 — 12 digits, not an AD licence
    assert row["license_number"] is None
    assert "548412122122" not in str(row)                    # …and it reads as a mobile → the PII scrub takes it
    row, _, _ = _map({**R2427, "ad_license_number": "1200007758"})   # FAL-shaped → never the AD column
    assert row["license_number"] is None


def test_land_is_split_by_the_sites_own_land_type():
    row, cat, _ = _map(R19573)
    assert row["property_type"] == "Commercial Land" and cat == "commercial"
    assert _map(R18374)[2] == "type_unmapped"                # raw_land has no honest bucket


# ============================ SKIP, NEVER GUESS ==============================================
def test_closed_deals_and_unreleased_stock_are_skipped_by_the_sites_own_flag():
    assert _map(R18891)[2] == "availability_sold"
    assert _map(R17539)[2] == "availability_off-plan"
    assert _map(R19277)[2] == "availability_later"


def test_re_sale_is_a_buy_and_short_term_is_out_of_scope():
    row, _, why = _map({**R19277, "availability": "available"})
    assert row and row["transaction_type"] == "Buy" and row["price_total"] == 880000, why
    assert _map(R2651)[2] == "deal_short-term-rental"


def test_an_unspecified_type_and_an_unplaceable_city_are_skipped():
    assert _map(R19609)[2] == "type_unmapped"
    assert _map(R17573)[2] == "city_not_in_catalog"          # الهفوف: live to_catalog places nothing


def test_the_sites_own_qa_rows_are_a_skip_never_a_listing():
    """Live 2026-09-24: ids 15672/15673/15675/15676/15678 on catalogue page 1 — publish, available,
    a real-looking price and a FAL-shaped licence, so every other gate passes. Each marker alone
    must be enough (the site could drop any one of them)."""
    assert _map(R15678)[2] == "site_test_row"
    only_slug = {**R15678, "title": "شقة مميزة للبيع", "owner": {"name": "شركة عقارية"}}
    only_title = {**R15678, "slug": "distinctive-apartment-for-sale-in-al-rim-7b5c87", "owner": {"name": "شركة عقارية"}}
    only_owner = {**R15678, "slug": "distinctive-apartment-for-sale-in-al-rim-7b5c87", "title": "شقة مميزة للبيع"}
    assert _map(only_slug)[2] == "site_test_row"
    assert _map(only_title)[2] == "site_test_row"
    assert _map(only_owner)[2] == "site_test_row"
    clean = {**R15678, "slug": "distinctive-apartment-for-sale-in-al-rim-7b5c87", "title": "شقة مميزة للبيع", "owner": {"name": "شركة عقارية"}}
    assert _map(clean)[0] is not None                        # the same record without the markers maps


def test_a_record_without_a_slug_never_becomes_a_listing_url():
    assert _map({**R18630, "slug": None})[2] == "no_slug"
    assert _map({**R18630, "id": None})[2] == "no_id"


# ============================ PDPL ===========================================================
def test_contact_details_never_reach_the_row_but_licences_survive():
    row, _, _ = _map(R2427)
    blob = str(row)
    for pii in ("0500118055", "0580999909", "Ibrahim9909", "966-580999909", "النهدي للاستثمارات"):
        assert pii not in blob, pii
    assert "7200678872" in row["description"] and "1200007758" in row["description"]
    assert row["license_number"] == "7200678872"             # the AD licence, never the FAL one
    assert row["maid_room"] is True and row["car_entrance"] is True and row["laundry_room"] is True


def test_a_mobile_in_the_title_is_scrubbed_like_the_description():
    """SYNTHETIC title on a real record (no live title carried a mobile on 2026-09-24): the title
    goes through the same redactor as the description, so a future one never reaches the card."""
    row, _, _ = _map({**R2427, "title": "فيلا للبيع في الرحمانية للتواصل 0500118055"})
    assert "0500118055" not in row["title"] and "7200678872" in row["description"]


def test_the_monthly_rows_mobile_and_the_additional_contact_are_dropped():
    row, _, _ = _map(R19471)
    assert "0502152802" not in str(row) and "alnahdi" not in str(row)
    row, _, _ = _map(R2068)
    assert "additional_contact" not in row["additional_info"] and "owner" not in row["additional_info"]
    assert "AhmedHegazy" not in str(row)


# ============================ IDENTITY, URL, SESSION, PHOTOS ==================================
def test_identity_and_the_verified_detail_url():
    row, _, _ = _map(R18630, **D18630)
    assert row["ad_number"] == "DWL18630" and row["source"] == "دويليو"
    assert row["listing_url"] == "https://www.dwelleo.sa/ar/properties/3-bedroom-apartment-for-rent-in-ghirnatah-dist-riyadh"
    assert row["city_ar"] == "الرياض" and row["city_id"] == 3 and row["region_id"] == 1
    assert row["license_number"] == "7201132846"


def test_session_requests_arabic_and_lets_impersonate_own_the_user_agent():
    s = R.session()
    assert s.headers["Accept-Language"].startswith("ar")
    assert "user-agent" not in {k.lower() for k in s.headers}


def test_photo_paths_are_absolute_percent_encoded_and_deduplicated():
    """SYNTHETIC path: every live cdn.dwelleo.sa path is ASCII; this pins the encoding rule."""
    urls = R._photo_urls({"images": [{"path": "https://cdn.dwelleo.sa/1/صورة 1.jpg"}, {"path": "/relative.jpg"}],
                          "image": {"path": "https://cdn.dwelleo.sa/1/صورة 1.jpg"}})
    assert urls == ["https://cdn.dwelleo.sa/1/%D8%B5%D9%88%D8%B1%D8%A9%201.jpg"]


# ============================ REMOVAL ORACLE (under the shared law) ==========================
_LIVE_BODY = '{"message":null,"data":{"id":18599,"slug":"x","status":"publish","availability":"available"}}'
_SOLD_BODY = '{"message":null,"data":{"id":18599,"slug":"x","status":"publish","availability":"sold"}}'
_GONE_422 = '{"message":"The selected id is invalid.","errors":{"id":["The selected id is invalid."]}}'
_GONE_404 = '{"message":"العقار غير موجود","errors":null}'


def test_the_measured_gone_shapes_and_the_live_shape():
    sig = R._signal_for(18599)
    assert sig(422, _GONE_422, False) == "gone"
    assert sig(404, _GONE_404, False) == "gone"
    assert sig(200, _LIVE_BODY, False) == "live"
    assert sig(200, _SOLD_BODY, False) == "gone"           # a status flag is a death
    assert sig(200, _LIVE_BODY.replace("18599", "18600"), False) is None   # someone else's record
    assert sig(422, "{}", False) is None and sig(404, "<html>", False) is None


def test_a_block_can_never_read_as_a_death_and_removals_fail_closed_without_a_control(monkeypatch):
    from scrapers.common import http_liveness as L
    answers = {}
    monkeypatch.setattr(L.LivenessProbe, "fetch", lambda self, url: answers[url])
    monkeypatch.setattr(L.time, "sleep", lambda *_: None)
    api = "https://api.dwelleo.sa/api/v1/properties/"
    answers[api + "18353"] = (403, "Forbidden", False)
    assert R._make_verify_gone(None)("DWL18353")[0] == "unknown"
    answers[api + "18353"] = (422, _GONE_422, False)
    verdict, why = R._make_verify_gone(None)("DWL18353")   # no control row → no removal
    assert verdict == "unknown" and "withheld" in why
    answers[api + "18599"] = (200, _LIVE_BODY, False)
    assert R._make_verify_gone({"ad_number": "DWL18599"})("DWL18353")[0] == "gone"
    answers[api + "18599"] = (200, _GONE_422, False)       # the control itself stops answering
    assert R._make_verify_gone({"ad_number": "DWL18599"})("DWL18353")[0] == "unknown"
    assert R._make_verify_gone(None)("NFZ1")[0] == "unknown"


# ============================ fetch_catalogue: `complete` means what it says ==================
class _Resp:
    def __init__(self, body): self.status_code, self._b = 200, body
    def json(self): return self._b


class _PagedSession:
    """A transport that serves a fixed page list — the real fetch_catalogue does the walking."""
    def __init__(self, pages, total_pages): self.pages, self.tp = pages, total_pages
    def get(self, url, params=None, timeout=None):
        rows = self.pages.get(params["page"], [])
        return _Resp({"data": {"properties": rows, "pagination": {"total": sum(len(v) for v in self.pages.values()),
                                                                  "total_pages": self.tp, "current_page": params["page"]}}})


def test_an_early_empty_page_makes_the_walk_incomplete_and_a_full_walk_complete(monkeypatch):
    monkeypatch.setattr(R.time, "sleep", lambda *_: None)
    full = _PagedSession({1: [R18630], 2: [R19573]}, total_pages=2)
    items, total, complete = R.fetch_catalogue(full)
    assert set(items) == {18630, 19573} and total == 2 and complete is True
    holed = _PagedSession({1: [R18630], 3: [R19573]}, total_pages=3)       # page 2 answers empty
    items, total, complete = R.fetch_catalogue(holed)
    assert set(items) == {18630} and complete is False
    assert R.fetch_catalogue(full, limit=1)[2] is False                    # --limit is never complete


# ============================ main(): the tally reaches end_run ==============================
def _run_main(monkeypatch, items, *, complete, total, argv=("run.py",)):
    calls: dict = {"prune": [], "batches": {}}
    monkeypatch.setattr(sys, "argv", list(argv))
    monkeypatch.setattr(R, "session", lambda: None)
    monkeypatch.setattr(R, "fetch_catalogue", lambda s, limit=0: (items, total, complete))
    monkeypatch.setattr(R, "fetch_detail", lambda s, key: {**D18630, "id": 18630} if key == R18630["slug"] else None)
    monkeypatch.setattr(R.time, "sleep", lambda *_: None)
    monkeypatch.setattr(R.db, "begin_run", lambda src: 1)
    monkeypatch.setattr(R.db, "_wasalt_batch", lambda t, rows: calls["batches"].__setitem__(t, rows))
    monkeypatch.setattr(R.db, "retire_superseded_siblings", lambda **k: 0)
    monkeypatch.setattr(R.db, "prune_unseen", lambda *a, **k: calls["prune"].append(a[0]) or 0)
    monkeypatch.setattr(R.db, "end_run", lambda run_id, **k: calls.update(k) or True)
    assert R.main() == 0
    return calls


def test_the_skip_tally_reaches_end_run_and_prune_waits_for_a_complete_walk(monkeypatch):
    items = {r["id"]: r for r in (R18630, R18891, R19609, R2651, R19573, R15678)}
    calls = _run_main(monkeypatch, items, complete=False, total=6)
    for part in ("availability_soldx1", "type_unmappedx1", "deal_short-term-rentalx1", "detail_missx5", "site_test_rowx1"):
        assert part in calls["notes"], calls["notes"]
    assert calls["check_tables"] == ["dwelleo_residential_listings", "dwelleo_commercial_listings"]
    assert calls["rows_seen"] == 6 and calls["rows_upserted"] == 2
    assert calls["prune"] == []                              # an incomplete walk never prunes
    res = calls["batches"]["dwelleo_residential_listings"]
    assert res[0]["ad_number"] == "DWL18630" and res[0].get("_direct_alive_oracle")   # detail read
    assert calls["batches"]["dwelleo_commercial_listings"][0]["property_type"] == "Commercial Land"


def test_a_complete_walk_that_collected_the_sites_total_prunes_both_tables(monkeypatch):
    items = {r["id"]: r for r in (R18630, R19573)}
    calls = _run_main(monkeypatch, items, complete=True, total=2)
    assert calls["prune"] == ["dwelleo_residential_listings", "dwelleo_commercial_listings"]
    calls = _run_main(monkeypatch, items, complete=True, total=3)      # 2 of 3 < 98 %
    assert calls["prune"] == []
