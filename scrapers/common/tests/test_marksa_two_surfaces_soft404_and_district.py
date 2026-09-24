"""مار العقارية (mar-ksa.com) barrier: the catalogue is TWO surfaces, a soft-404 is the only
death, and the site's own district text is never overruled by prose.

Measured live 2026-09-23: /ar/property/showitems lists 10 offers with a <small class="locat">
«جدة - الصفا» field; the home slider lists those 10 plus 10 older ones with no location; detail
pages for ids the site no longer lists (500, 800, 878, 879) still render as full priced offers,
while never-existing ids (0, 1, 2, 999999) answer HTTP 200 with <title>«مار العقاريه - الصفحة
الرئيسية», blank spec cells and the logo as the only slide. 881's locat says «صاري» — a street —
while its prose says «حي الربوه». 884's prose writes «لاغرفة سائق» (NO driver room) glued.

PROVENANCE: every HTML fixture is the live page captured 2026-09-23 (ids 873, 884, 881, 286, 870
and the 999999 shell), trimmed to the elements parse_detail reads: <title>, the
`.realestate-features` block, the «مميزات العقار» section and two swiper slides. The card
snippets are the live card blocks of 873/881 (from «العروض», 873 twice because the page repeats
its cards) and 286/873 (from the home slider).

Every assertion runs the SHIPPING functions (run.parse_cards, run.parse_detail, run.map_listing,
run._type_token, run._signal, run.session, run.main). Only the two DB-backed location helpers are
stubbed.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

from scrapers.marksa import run as R  # noqa: E402

# ── offline stand-ins for the only two DB-backed helpers ────────────────────────────────────────
R.to_catalog = lambda city_ar, region_hint=None: (18, 2) if (city_ar or "").strip() == "جدة" else (None, None)
_DISTRICTS = {"الصفا": "حي الصفا", "الصفاء": "حي الصفا", "الربوه": "حي الربوة", "الربوة": "حي الربوة",
              "المروه": "حي المروة", "المروة": "حي المروة"}
R.find_district_in_text = lambda text, city_id: _DISTRICTS.get((text or "").strip()) if city_id == 18 else None

# ── VERBATIM live pages (2026-09-23), trimmed ───────────────────────────────────────────────────
PAGE_873 = r'''<html><head><title>مار العقاريه - مشروع الزاهد ( شقق )</title></head><body><div class="swiper-slide">
                            <img src="https://mar-ksa.com/upload/a9526918c288fc90c740ecf5c581090f.jpg" alt="">
                        </div>
<div class="swiper-slide">
                            <img src="https://mar-ksa.com/upload/a03dfe0b1f38139022a3e93c2471b406.jpg" alt="">
                        </div>
<div class="realestate-features">
                <div class="items">
                        <span class="icon">
                            <img src="https://mar-ksa.com/assets/theme/images/icons/beds.svg" alt="">
                        </span>
                    <p>
                        5                        غرف كبيره
                    </p>
                </div>

                <div class="items">
                        <span class="icon">
                            <img src="https://mar-ksa.com/assets/theme/images/icons/select.svg" alt="">
                        </span>
                    <p>
                        178                        متر مربع
                    </p>
                </div>

                <div class="items">
                        <span class="icon">
                            <img src="https://mar-ksa.com/assets/theme/images/icons/bathtub.svg" alt="">
                        </span>
                    <p>
                        3                        حمامات
                    </p>
                </div>

                <div class="items">
                        <span class="icon">
                            <img src="https://mar-ksa.com/assets/theme/images/icons/microwave.svg" alt="">
                        </span>
                    <p>
                        1                        مطبخ
                    </p>
                </div>

                <div class="items">
                        <span class="icon">
                            <img src="https://mar-ksa.com/assets/theme/images/icons/garage.svg" alt="">
                        </span>
                    <p>
                        1                        موقف سيارات
                    </p>
                </div>

                <div class="items price">
                    <h5>
                        720000                        ريال
                    </h5>
                </div>
            </div>
        </div>
    </section>
<section class="features-details gray-bg section-padding text-center">
        <div class="container">
            <div class="section-head">
                <h2>مميزات العقار</h2>
            </div>
            <div class="row">
                <div class="col-lg-5">
                    <div class="items">
                        <p>مشروع الزاهد 5&nbsp;غرف&nbsp;</p>

<p>شقق للبيع بجده حي الصفاء&nbsp;</p>

<p>مكونات العقار&nbsp;</p>

<p>5&nbsp; غرف + صاله + مطبخ + 3 دوره مياه&nbsp;<br />
غرفه شغاله + غرفه سائق +<br />
موقف خاص&nbsp;</p>

<p><br />
المساحه 178م&nbsp;<br />
الاسعار تبدا من 720الف&nbsp;</p>
                    </div>
                </div>
                            </div>
        </div>
    </section></body></html>'''
PAGE_884 = r'''<html><head><title>مار العقاريه - مشروع جوهرة حراء ( ملاحق )</title></head><body><div class="swiper-slide">
                            <img src="https://mar-ksa.com/upload/e3ddb27168ad90a59951542e6433c54b.jpg" alt="">
                        </div>
<div class="swiper-slide">
                            <img src="https://mar-ksa.com/upload/51724490c2086a310cdbdc70a2588f2e.jpg" alt="">
                        </div>
<div class="realestate-features">
                <div class="items">
                        <span class="icon">
                            <img src="https://mar-ksa.com/assets/theme/images/icons/beds.svg" alt="">
                        </span>
                    <p>
                        6                        غرف كبيره
                    </p>
                </div>

                <div class="items">
                        <span class="icon">
                            <img src="https://mar-ksa.com/assets/theme/images/icons/select.svg" alt="">
                        </span>
                    <p>
                        330                        متر مربع
                    </p>
                </div>

                <div class="items">
                        <span class="icon">
                            <img src="https://mar-ksa.com/assets/theme/images/icons/bathtub.svg" alt="">
                        </span>
                    <p>
                        4                        حمامات
                    </p>
                </div>

                <div class="items">
                        <span class="icon">
                            <img src="https://mar-ksa.com/assets/theme/images/icons/microwave.svg" alt="">
                        </span>
                    <p>
                        1                        مطبخ
                    </p>
                </div>

                <div class="items">
                        <span class="icon">
                            <img src="https://mar-ksa.com/assets/theme/images/icons/garage.svg" alt="">
                        </span>
                    <p>
                        1                        موقف سيارات
                    </p>
                </div>

                <div class="items price">
                    <h5>
                        1100000                        ريال
                    </h5>
                </div>
            </div>
        </div>
    </section>
<section class="features-details gray-bg section-padding text-center">
        <div class="container">
            <div class="section-head">
                <h2>مميزات العقار</h2>
            </div>
            <div class="row">
                <div class="col-lg-5">
                    <div class="items">
                        <p>مشروع جوهره حراء</p>

<p>&nbsp; روف دور كامل&nbsp;<br />
&nbsp;للبيع بجده حي المروه&nbsp;</p>

<p>6&nbsp; غرف&nbsp; +&nbsp; &nbsp;صاله&nbsp;+ 4 دوره مياه&nbsp;<br />
+ مطبخ&nbsp; + سطح&nbsp;+ غرفه شغاله +لاغرفة سائق +<br />
خزان علوي وسفلي +&nbsp;موقف خاص&nbsp;<br />
&nbsp;سطحين&nbsp;</p>

<p>غاز مركزي</p>

<p>موقع مميز بلقرب من كافه الخدمات&nbsp;<br />
امام مسجد وعلى حرف T</p>

<p>&nbsp;</p>

<p>مساحه&nbsp; مع السطوح&nbsp; 330 م</p>

<p>السعر مليون و100&nbsp; الف</p>
                    </div>
                </div>
                            </div>
        </div>
    </section></body></html>'''
PAGE_881 = r'''<html><head><title>مار العقاريه - مشروع صاري 2 ( شقق )</title></head><body><div class="swiper-slide">
                            <img src="https://mar-ksa.com/upload/5c871a839f90a569dea61cca5463bceb.jpg" alt="">
                        </div>
<div class="swiper-slide">
                            <img src="https://mar-ksa.com/upload/fcaee971d081adcd7e981925604e78c5.jpg" alt="">
                        </div>
<div class="realestate-features">
                <div class="items">
                        <span class="icon">
                            <img src="https://mar-ksa.com/assets/theme/images/icons/beds.svg" alt="">
                        </span>
                    <p>
                        6                        غرف كبيره
                    </p>
                </div>

                <div class="items">
                        <span class="icon">
                            <img src="https://mar-ksa.com/assets/theme/images/icons/select.svg" alt="">
                        </span>
                    <p>
                        220                        متر مربع
                    </p>
                </div>

                <div class="items">
                        <span class="icon">
                            <img src="https://mar-ksa.com/assets/theme/images/icons/bathtub.svg" alt="">
                        </span>
                    <p>
                        5                        حمامات
                    </p>
                </div>

                <div class="items">
                        <span class="icon">
                            <img src="https://mar-ksa.com/assets/theme/images/icons/microwave.svg" alt="">
                        </span>
                    <p>
                        1                        مطبخ
                    </p>
                </div>

                <div class="items">
                        <span class="icon">
                            <img src="https://mar-ksa.com/assets/theme/images/icons/garage.svg" alt="">
                        </span>
                    <p>
                        1                        موقف سيارات
                    </p>
                </div>

                <div class="items price">
                    <h5>
                        850000                        ريال
                    </h5>
                </div>
            </div>
        </div>
    </section>
<section class="features-details gray-bg section-padding text-center">
        <div class="container">
            <div class="section-head">
                <h2>مميزات العقار</h2>
            </div>
            <div class="row">
                <div class="col-lg-5">
                    <div class="items">
                        <p><span style="color: rgb(51, 51, 51); font-family: sans-serif, Arial, Verdana, &quot;Trebuchet MS&quot;; font-size: 13px; background-color: rgb(255, 255, 255);">نموذج 6 غرف</span></p>

<p>مشروع صاري</p>

<p>شقق للبيع بجده حي الربوه&nbsp;</p>

<p>شارع صاري&nbsp;&nbsp;</p>

<p>مكونات العقار&nbsp;</p>

<p>&nbsp; 6&nbsp; غرف + صاله +مطبخ + 5 دوره مياه&nbsp;<br />
&nbsp;+ غرفه سائق +<br />
موقف خاص&nbsp;<br />
المساحه 220&nbsp; &nbsp;م&nbsp;<br />
السعر 850&nbsp; &nbsp;الف</p>
                    </div>
                </div>
                            </div>
        </div>
    </section></body></html>'''
PAGE_286 = r'''<html><head><title>مار العقاريه - مشروع المروه جوار  كبري مطار</title></head><body><div class="swiper-slide">
                            <img src="https://mar-ksa.com/upload/f4c01348a12b8f6b594c1e133a621f5b.jpg" alt="">
                        </div>
<div class="swiper-slide">
                            <img src="https://mar-ksa.com/upload/d08c3c83735152600159e8382aa32bc9.jpg" alt="">
                        </div>
<div class="realestate-features">
                <div class="items">
                        <span class="icon">
                            <img src="https://mar-ksa.com/assets/theme/images/icons/beds.svg" alt="">
                        </span>
                    <p>
                        4                        غرف كبيره
                    </p>
                </div>

                <div class="items">
                        <span class="icon">
                            <img src="https://mar-ksa.com/assets/theme/images/icons/select.svg" alt="">
                        </span>
                    <p>
                        146                        متر مربع
                    </p>
                </div>

                <div class="items">
                        <span class="icon">
                            <img src="https://mar-ksa.com/assets/theme/images/icons/bathtub.svg" alt="">
                        </span>
                    <p>
                        4                        حمامات
                    </p>
                </div>

                <div class="items">
                        <span class="icon">
                            <img src="https://mar-ksa.com/assets/theme/images/icons/microwave.svg" alt="">
                        </span>
                    <p>
                        1                        مطبخ
                    </p>
                </div>

                <div class="items">
                        <span class="icon">
                            <img src="https://mar-ksa.com/assets/theme/images/icons/garage.svg" alt="">
                        </span>
                    <p>
                        1                        موقف سيارات
                    </p>
                </div>

                <div class="items price">
                    <h5>
                        490000                        ريال
                    </h5>
                </div>
            </div>
        </div>
    </section>
<section class="features-details gray-bg section-padding text-center">
        <div class="container">
            <div class="section-head">
                <h2>مميزات العقار</h2>
            </div>
            <div class="row">
                <div class="col-lg-5">
                    <div class="items">
                        <p dir="RTL">&nbsp;</p>

<p dir="RTL">شقق للبيع من المالك مباشره</p>

<p dir="RTL">بحي المروه 3 تشطيب فاخر</p>

<p dir="RTL">يتكون العقار من</p>

<p dir="RTL">&nbsp;</p>

<p dir="RTL">4 غرف +صاله + مطبخ 4 حمام +غرف&nbsp; سائق+غرفه شغاله+</p>

<p dir="RTL">علوي وسفلي + موقف خاص</p>

<p dir="RTL">تشطيب <span dir="LTR">VIP</span></p>

<p dir="RTL">مساحه 146</p>

<p dir="RTL">سعر 490 الف</p>

<p dir="RTL">موقع مميز&nbsp; بالقرب من كبري مطار</p>

<p dir="RTL">&nbsp;</p>

<p dir="RTL">&nbsp;</p>
                    </div>
                </div>
                            </div>
        </div>
    </section></body></html>'''
PAGE_870 = r'''<html><head><title>مار العقاريه - مشروع الفال (شقق)</title></head><body><div class="swiper-slide">
                            <img src="https://mar-ksa.com/upload/64b6306119abfceb646e0abfc7a3d979.jpg" alt="">
                        </div>
<div class="swiper-slide">
                            <img src="https://mar-ksa.com/upload/64b6306119abfceb646e0abfc7a3d979.jpg" alt="">
                        </div>
<div class="realestate-features">
                <div class="items">
                        <span class="icon">
                            <img src="https://mar-ksa.com/assets/theme/images/icons/beds.svg" alt="">
                        </span>
                    <p>
                        5                        غرف كبيره
                    </p>
                </div>

                <div class="items">
                        <span class="icon">
                            <img src="https://mar-ksa.com/assets/theme/images/icons/select.svg" alt="">
                        </span>
                    <p>
                        194                        متر مربع
                    </p>
                </div>

                <div class="items">
                        <span class="icon">
                            <img src="https://mar-ksa.com/assets/theme/images/icons/bathtub.svg" alt="">
                        </span>
                    <p>
                        4                        حمامات
                    </p>
                </div>

                <div class="items">
                        <span class="icon">
                            <img src="https://mar-ksa.com/assets/theme/images/icons/microwave.svg" alt="">
                        </span>
                    <p>
                        1                        مطبخ
                    </p>
                </div>

                <div class="items">
                        <span class="icon">
                            <img src="https://mar-ksa.com/assets/theme/images/icons/garage.svg" alt="">
                        </span>
                    <p>
                        1                        موقف سيارات
                    </p>
                </div>

                <div class="items price">
                    <h5>
                        780000                        ريال
                    </h5>
                </div>
            </div>
        </div>
    </section>
<section class="features-details gray-bg section-padding text-center">
        <div class="container">
            <div class="section-head">
                <h2>مميزات العقار</h2>
            </div>
            <div class="row">
                <div class="col-lg-5">
                    <div class="items">
                        <p><strong>مشروع الفال&nbsp; &nbsp;</strong><br />
شقق للبيع في حي&nbsp;الصواري&nbsp; مخطط الفال&nbsp; &nbsp; &nbsp;<br />
&nbsp;<br />
&nbsp;تشطيب ديلوكس&nbsp; &nbsp;<br />
&nbsp;جوار مسجد وحديقه&nbsp;&nbsp;</p>

<p>مكونات العقار&nbsp;</p>

<p>&nbsp; 5 غرف + صاله +مطبخ + 4&nbsp; دوره مياه&nbsp;<br />
غرفه شغاله + غرفه سائق +<br />
موقف خاص</p>

<p>المساحه 201 م&nbsp;&nbsp;<br />
السعر 750&nbsp; الف</p>
                    </div>
                </div>
                            </div>
        </div>
    </section></body></html>'''
SHELL_999999 = r'''<html><head><title>مار العقاريه - الصفحة الرئيسية</title></head><body><div class="swiper-slide">
                            <img src="https://mar-ksa.com/upload/logo.png" alt="">
                        </div>
<div class="swiper-slide">
                            <img src="https://mar-ksa.com/upload/logo.png" alt="">
                        </div>
<div class="realestate-features">
                <div class="items">
                        <span class="icon">
                            <img src="https://mar-ksa.com/assets/theme/images/icons/beds.svg" alt="">
                        </span>
                    <p>
                                                غرف كبيره
                    </p>
                </div>

                <div class="items">
                        <span class="icon">
                            <img src="https://mar-ksa.com/assets/theme/images/icons/select.svg" alt="">
                        </span>
                    <p>
                                                متر مربع
                    </p>
                </div>

                <div class="items">
                        <span class="icon">
                            <img src="https://mar-ksa.com/assets/theme/images/icons/bathtub.svg" alt="">
                        </span>
                    <p>
                                                حمامات
                    </p>
                </div>

                <div class="items">
                        <span class="icon">
                            <img src="https://mar-ksa.com/assets/theme/images/icons/microwave.svg" alt="">
                        </span>
                    <p>
                                                مطبخ
                    </p>
                </div>

                <div class="items">
                        <span class="icon">
                            <img src="https://mar-ksa.com/assets/theme/images/icons/garage.svg" alt="">
                        </span>
                    <p>
                                                موقف سيارات
                    </p>
                </div>

                <div class="items price">
                    <h5>
                                                ريال
                    </h5>
                </div>
            </div>
        </div>
    </section>
<section class="features-details gray-bg section-padding text-center">
        <div class="container">
            <div class="section-head">
                <h2>مميزات العقار</h2>
            </div>
            <div class="row">
                <div class="col-lg-5">
                    <div class="items">
                                            </div>
                </div>
                            </div>
        </div>
    </section></body></html>'''
LIST_SNIPPET = r'''<div class="items">
                                        <div class="img">
                                            <a href="https://mar-ksa.com/ar/property/showitem/873" class="d-block">
                                                <img src="https://mar-ksa.com/upload/a9526918c288fc90c740ecf5c581090f.jpg" alt="">
                                            </a>
                                        </div>
                                        <div class="info">
                                            <div class="date">
                                                <span>
                                                    2022-02-02                                                </span>
                                            </div>
                                            <a href="https://mar-ksa.com/ar/property/showitem/873" class="d-block">
                                                <h6>مشروع الزاهد ( شقق )</h6>
                                            </a>
                                            <small class="locat">
                                                <img src="https://mar-ksa.com/assets/theme/images/icons/location.svg" alt="">جدة - الصفا                                            </small>
                                            <div class="details">
                                                <p>
                                                    <img src="https://mar-ksa.com/assets/theme/images/icons/door.svg" alt="">
                                                    5                                                    غرف
                                                </p>

                                                <p>
                                                    <img src="https://mar-ksa.com/assets/theme/images/icons/select.svg" alt="">
                                                    178                                                    م
                                                </p>
                                            </div>
                                            <div class="price">
                                                <span>
                                                    720000                                                    ريال
                                                </span>
                                                <a href="https://mar-ksa.com/ar/property/showitem/873">التفاصيل</a>
                                            </div>
                                        </div>
                                    </div>
                                                                                            </div>
                                                    <div class="slide">
                                                                                                                                        <div class="items">
                                        <div class="img">
                                            <a href="https://mar-ksa.com/ar/property/showitem/881" class="d-block">
                                                <img src="https://mar-ksa.com/upload/5c871a839f90a569dea61cca5463bceb.jpg" alt="">
                                            </a>
                                        </div>
                                        <div class="info">
                                            <div class="date">
                                                <span>
                                                    2022-02-06                                                </span>
                                            </div>
                                            <a href="https://mar-ksa.com/ar/property/showitem/881" class="d-block">
                                                <h6>مشروع صاري 2 ( شقق )</h6>
                                            </a>
                                            <small class="locat">
                                                <img src="https://mar-ksa.com/assets/theme/images/icons/location.svg" alt="">جدة - صاري                                            </small>
                                            <div class="details">
                                                <p>
                                                    <img src="https://mar-ksa.com/assets/theme/images/icons/door.svg" alt="">
                                                    6                                                    غرف
                                                </p>

                                                <p>
                                                    <img src="https://mar-ksa.com/assets/theme/images/icons/select.svg" alt="">
                                                    220                                                    م
                                                </p>
                                            </div>
                                            <div class="price">
                                                <span>
                                                    850000                                                    ريال
                                                </span>
                                                <a href="https://mar-ksa.com/ar/property/showitem/881">التفاصيل</a>
                                            </div>
                                        </div>
                                    </div>
                                                                                                                                            </div><div class="slide">
                                                                        <div class="items">
                                        <div class="img">
                                            <a href="https://mar-ksa.com/ar/property/showitem/873" class="d-block">
                                                <img src="https://mar-ksa.com/upload/a9526918c288fc90c740ecf5c581090f.jpg" alt="">
                                            </a>
                                        </div>
                                        <div class="info">
                                            <div class="date">
                                                <span>
                                                    2022-02-02                                                </span>
                                            </div>
                                            <a href="https://mar-ksa.com/ar/property/showitem/873" class="d-block">
                                                <h6>مشروع الزاهد ( شقق )</h6>
                                            </a>
                                            <small class="locat">
                                                <img src="https://mar-ksa.com/assets/theme/images/icons/location.svg" alt="">جدة - الصفا                                            </small>
                                            <div class="details">
                                                <p>
                                                    <img src="https://mar-ksa.com/assets/theme/images/icons/door.svg" alt="">
                                                    5                                                    غرف
                                                </p>

                                                <p>
                                                    <img src="https://mar-ksa.com/assets/theme/images/icons/select.svg" alt="">
                                                    178                                                    م
                                                </p>
                                            </div>
                                            <div class="price">
                                                <span>
                                                    720000                                                    ريال
                                                </span>
                                                <a href="https://mar-ksa.com/ar/property/showitem/873">التفاصيل</a>
                                            </div>
                                        </div>
                                    </div>
                                                                                            </div>
                                                    <div class="slide">
                                                                                                                                        '''
HOME_SNIPPET = r'''<div class="items">
                                        <div class="img">
                                            <a href="https://mar-ksa.com/ar/property/showitem/286" class="d-block">
                                                <img src="https://mar-ksa.com/upload/f4c01348a12b8f6b594c1e133a621f5b.jpg" alt="">
                                            </a>
                                        </div>
                                        <div class="info">
                                            <div class="date">
                                                <span>
                                                    2020-12-04                                                </span>
                                            </div>
                                            <a href="https://mar-ksa.com/ar/property/showitem/286">
                                                <h6>مشروع المروه جوار  كبري مطار</h6>
                                            </a>
                                        </div>
                                    </div>
                                                                                                                                        <div class="items">
                                        <div class="img">
                                            <a href="https://mar-ksa.com/ar/property/showitem/873" class="d-block">
                                                <img src="https://mar-ksa.com/upload/a9526918c288fc90c740ecf5c581090f.jpg" alt="">
                                            </a>
                                        </div>
                                        <div class="info">
                                            <div class="date">
                                                <span>
                                                    2022-02-02                                                </span>
                                            </div>
                                            <a href="https://mar-ksa.com/ar/property/showitem/873">
                                                <h6>مشروع الزاهد ( شقق )</h6>
                                            </a>
                                        </div>
                                    </div>
                                                                                                                                            </div><div class="slide">
                                                                        '''


def _row(card, page):
    row, cat, why = R.map_listing(card, R.parse_detail(page))
    assert row is not None, why
    return row, cat


# ── ENUMERATION: two surfaces, de-duplicated, the card price never read ─────────────────────────
def test_the_offers_page_cards_carry_the_only_structured_location_and_repeats_collapse():
    cards = R.parse_cards(LIST_SNIPPET)
    assert set(cards) == {"873", "881"}, "the page repeats its cards; ids are de-duplicated"
    assert cards["873"]["locat"] == "جدة - الصفا" and cards["881"]["locat"] == "جدة - صاري"
    assert cards["873"]["title"] == "مشروع الزاهد ( شقق )" and cards["873"]["date"] == "2022-02-02"
    assert "price" not in cards["873"], "the card's price div belongs to the NEXT card in the markup"


def test_home_slider_cards_have_no_location():
    cards = R.parse_cards(HOME_SNIPPET)
    assert set(cards) == {"286", "873"} and "locat" not in cards["286"]


# ── THE DETAIL PAGE IS THE SOURCE OF EVERY FACT ─────────────────────────────────────────────────
def test_a_catalogue_offer_maps_from_its_own_page():
    row, cat = _row({"id": "873", "title": "مشروع الزاهد ( شقق )", "date": "2022-02-02", "locat": "جدة - الصفا"}, PAGE_873)
    assert cat == "residential" and row["property_type"] == "Apartment" and row["transaction_type"] == "Buy"
    assert row["price_total"] == 720000 and "price_annual" not in row
    assert row["additional_info"]["price_evidence"]["raw"] == "720000 ريال"
    assert row["additional_info"]["price_note"] == "starting_price", "«الاسعار تبدا من 720الف» is noted, never altered"
    assert (row["area_m2"], row["bedrooms"], row["bathrooms"]) == (178, 5, 3)
    assert row["kitchen"] is True and row["parking"] is True and row["halls"] == 1
    assert row["maid_room"] is True and row["driver_room"] is True
    assert (row["city_ar"], row["city_id"], row["district_ar"], row["neighborhood"]) == ("جدة", 18, "حي الصفا", "الصفا")
    assert row["ad_number"] == "MAR873" and row["listing_url"] == "https://mar-ksa.com/ar/property/showitem/873"
    assert row["photo_urls"][0].startswith("https://mar-ksa.com/upload/") and row["source"] == "مار العقارية"
    assert "license_number" not in row, "the site publishes no ad licence — NULL, not invented"


def test_the_sites_district_text_is_kept_and_the_canonical_match_comes_from_the_explicit_hay_phrase():
    """881: locat «صاري» is a street name the catalog cannot match; the prose states «حي الربوه»."""
    row, _ = _row({"id": "881", "locat": "جدة - صاري"}, PAGE_881)
    assert row["neighborhood"] == "صاري", "the card shows the source's own text"
    assert row["district_ar"] == "حي الربوة", "the explicit «حي X» phrase fills the gap"


def test_a_landmark_in_the_body_never_becomes_the_district(monkeypatch):
    """Only the «حي X» phrase may fill a gap — not any district word anywhere in the prose."""
    seen = []
    monkeypatch.setattr(R, "find_district_in_text", lambda text, cid: seen.append(text) or None)
    R.map_listing({"id": "881", "locat": "جدة - صاري"}, R.parse_detail(PAGE_881))
    assert seen == ["صاري", "الربوه"], "the locat district, then the «حي» phrase — never the whole body"


# ── AMENITY PROSE TRAP ──────────────────────────────────────────────────────────────────────────
def test_a_glued_negator_reads_as_no_driver_room():
    """884 writes «لاغرفة سائق». Through the shared parser alone it came back True (measured)."""
    d = R.parse_detail(PAGE_884)
    assert "لاغرفة سائق" in d["description"]
    assert R.normalize.amenities_from_text(d["description"]).get("driver_room") is True, \
        "the shared parser's gap this file guards"
    assert R.normalize.amenities_from_text(R._vocab(d["description"])).get("driver_room") is False
    # …and through the SHIPPING path: the same page with only its type token swapped (884 is a
    # «ملاحق», which map_listing skips before it ever scans the prose).
    row, _, why = R.map_listing({"id": "884", "locat": "جدة - المروة"}, dict(d, title="مشروع جوهرة حراء ( شقق )"))
    assert row, why
    assert row["driver_room"] is False and row["maid_room"] is True


# ── TYPE: the site's own token, «ملاحق» left to the owner ───────────────────────────────────────
def test_the_roof_annex_type_is_skipped_not_folded_into_apartment():
    row, _, why = R.map_listing({"id": "884", "locat": "جدة - المروة"}, R.parse_detail(PAGE_884))
    assert row is None and why == "type_unmapped"
    assert R._type_token("مشروع جوهرة حراء ( ملاحق )") == "ملاحق"
    assert R._type_token("مشروع مار الربوة - ملحق") == "ملحق"


def test_a_title_without_a_token_takes_the_type_word_from_the_prose():
    d = R.parse_detail(PAGE_286)
    assert R._type_token(d["title"], d["description"]) == "شقق"
    assert R._type_token("مشروع بلا نوع", "لا شيء هنا") is None


# ── CITY: stated or skipped, never defaulted ────────────────────────────────────────────────────
def test_a_home_only_offer_that_names_no_city_is_skipped():
    row, _, why = R.map_listing({"id": "870"}, R.parse_detail(PAGE_870))
    assert row is None and why == "city_unstated"


def test_the_prose_spelling_without_ta_marbuta_places_and_is_stored_canonically():
    row, _ = _row({"id": "881"}, PAGE_881)          # no locat: «شقق للبيع بجده حي الربوه»
    assert (row["city_ar"], row["city_id"], row["district_ar"], row["neighborhood"]) == ("جدة", 18, "حي الربوة", "الربوه")


def test_an_unplaceable_city_is_skipped():
    row, _, why = R.map_listing({"id": "873", "locat": "مدينة لا وجود لها - الصفا"}, R.parse_detail(PAGE_873))
    assert row is None and why == "city_not_in_catalog"


# ── DEAL, PERIOD, ZERO CELLS ────────────────────────────────────────────────────────────────────
def test_the_deal_comes_from_the_prose_and_is_skipped_when_unstated_or_both():
    d = R.parse_detail(PAGE_873)
    d2 = dict(d, description=d["description"].replace("للبيع", "للاستثمار"), title="مشروع ( شقق )")
    assert R.map_listing({"id": "873", "locat": "جدة - الصفا"}, d2)[2] == "deal_unstated"
    d3 = dict(d, description=d["description"] + "\nأو للإيجار")
    assert R.map_listing({"id": "873", "locat": "جدة - الصفا"}, d3)[2] == "deal_ambiguous"


def test_a_rent_offer_keeps_a_silent_period_null_and_the_figure_unconverted():
    """SYNTHETIC: all 20 live offers are sales. A «للإيجار» offer whose price cell carries no
    period must store the figure as published with no period."""
    d = R.parse_detail(PAGE_873)
    d = dict(d, description=d["description"].replace("للبيع", "للإيجار"), title="مشروع ( شقق )")
    row, _, why = R.map_listing({"id": "873", "locat": "جدة - الصفا"}, d)
    assert row, why
    assert row["price_annual"] == 720000 and "rent_period" not in row and "price_total" not in row
    d["cells"] = dict(d["cells"], price="60000 ريال سنوي")
    row, _, why = R.map_listing({"id": "873", "locat": "جدة - الصفا"}, d)
    assert (row["rent_period"], row["price_annual"]) == ("annual", 60000)


def test_a_zero_cell_is_unfilled_not_zero():
    """SYNTHETIC cells (the shape the unlisted 878 renders), on a prose that names neither a
    kitchen nor parking — so any True could only have come from a fabricated 0 → False."""
    d = R.parse_detail(PAGE_873)
    d = dict(d, description="شقق للبيع بجده حي الصفاء")
    d["cells"] = dict(d["cells"], bathrooms="0 حمامات", kitchen="0 مطبخ", parking="0 موقف سيارات")
    row, _, why = R.map_listing({"id": "873", "locat": "جدة - الصفا"}, d)
    assert row, why
    assert row["bathrooms"] is None and "kitchen" not in row and "parking" not in row


# ── REMOVAL ORACLE ──────────────────────────────────────────────────────────────────────────────
def test_the_soft_404_shell_is_gone_a_project_page_is_live_and_chrome_is_no_opinion():
    assert R.parse_detail(SHELL_999999)["soft_404"] is True
    assert R.parse_detail(PAGE_873)["soft_404"] is False
    assert R._signal(200, SHELL_999999, False) == "gone"
    assert R._signal(200, PAGE_873, False) == "live"
    assert R._signal(200, "<html><title>something else</title></html>", False) is None
    assert R._signal(500, PAGE_873, False) is None and R._signal(200, "", False) is None


def test_the_shell_is_skipped_by_the_crawl_too():
    row, _, why = R.map_listing({"id": "999999"}, R.parse_detail(SHELL_999999))
    assert row is None and why == "soft_404"


def test_session_asks_for_arabic_and_never_sets_its_own_user_agent():
    s = R.session()
    assert s.headers["Accept-Language"].startswith("ar")
    assert "user-agent" not in {k.lower() for k in s.headers}


# ── main(): the skip tally reaches the run ledger ───────────────────────────────────────────────
def test_the_skip_tally_reaches_end_run_and_prune_runs_only_after_the_full_walk(monkeypatch):
    calls, batches, pruned = {}, [], []
    cards = {"873": {"id": "873", "locat": "جدة - الصفا"}, "884": {"id": "884", "locat": "جدة - المروة"},
             "870": {"id": "870"}, "999999": {"id": "999999"}}
    pages = {"873": PAGE_873, "884": PAGE_884, "870": PAGE_870, "999999": SHELL_999999}
    monkeypatch.setattr(sys, "argv", ["run.py"])
    monkeypatch.setattr(R, "session", lambda: None)
    monkeypatch.setattr(R.time, "sleep", lambda *_: None)
    monkeypatch.setattr(R, "fetch_cards", lambda s: cards)
    monkeypatch.setattr(R, "fetch_detail", lambda s, i: pages[i])
    monkeypatch.setattr(R.db, "begin_run", lambda src: 1)
    monkeypatch.setattr(R.db, "_wasalt_batch", lambda t, rows: batches.append((t, len(rows))))
    monkeypatch.setattr(R.db, "retire_superseded_siblings", lambda **k: 0)
    monkeypatch.setattr(R.db, "prune_unseen", lambda t, seen, **k: pruned.append((t, set(seen), "verify_gone" in k)) or 0)
    monkeypatch.setattr(R.db, "end_run", lambda run_id, **k: calls.update(k) or True)

    assert R.main() == 0
    assert calls["ok"] is True and calls["rows_seen"] == 4 and calls["rows_upserted"] == 1
    for reason in ("type_unmappedx1", "city_unstatedx1", "soft_404x1"):
        assert reason in calls["notes"], calls["notes"]
    assert calls["check_tables"] == ["marksa_residential_listings", "marksa_commercial_listings"]
    assert batches == [("marksa_residential_listings", 1), ("marksa_commercial_listings", 0)]
    assert pruned == [("marksa_residential_listings", {"MAR873"}, True), ("marksa_commercial_listings", set(), True)]


def test_a_limited_run_never_writes_or_prunes(monkeypatch):
    touched = []
    monkeypatch.setattr(sys, "argv", ["run.py", "--limit", "1"])
    monkeypatch.setattr(R, "session", lambda: None)
    monkeypatch.setattr(R.time, "sleep", lambda *_: None)
    monkeypatch.setattr(R, "fetch_cards", lambda s: {"873": {"id": "873", "locat": "جدة - الصفا"}, "881": {"id": "881", "locat": "جدة - صاري"}})
    monkeypatch.setattr(R, "fetch_detail", lambda s, i: {"873": PAGE_873, "881": PAGE_881}[i])
    for name in ("begin_run", "_wasalt_batch", "retire_superseded_siblings", "prune_unseen", "end_run"):
        monkeypatch.setattr(R.db, name, lambda *a, _n=name, **k: touched.append(_n))
    assert R.main() == 0 and touched == []
