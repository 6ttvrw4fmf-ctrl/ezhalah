"""Offline barrier for scrapers/almotmkenah/run.py — no network, no database.

EVERY FIXTURE IS THE SOURCE'S OWN BYTES. Each FIXTURES entry is the verbatim
`<h1>` + `annonce_header_info … اعلانات مماتلة` slice of a named almotmkenah.com page, saved live on
2026-09-20, re-joined with the verbatim related-ads block (which carries a NEIGHBOUR's 1,350,000
price) and the verbatim contact-modal hidden id that is this source's only real ad id. Runs of
whitespace were collapsed to keep the file readable; no character inside any tag, label, value or URL
was altered, and the generator asserted that every squeezed fixture parses to exactly what the live
page parses to. Nothing was hand-written or renamed to suit the parser
([[feedback_a-barrier-that-supplies-its-own-input-proves-nothing]]) — the expected values below are
what almotmkenah.com itself prints, on the detail page and on its own search card.

Run: python3 -m pytest scrapers/common/tests/test_almotmkenah_source_traps.py
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

from scrapers.almotmkenah import run as R  # noqa: E402
from scrapers.common import normalize  # noqa: E402

# to_catalog()/find_district_in_text() are the DB-backed catalog; this barrier must not reach it.
# They are the ONLY two things stubbed — the parser, the type table, the price rules, the deal rules
# and the area rules under test are the production code path.
_CITY_IDS = {"الرياض": (1, 1), "جدة": (2, 2), "مكة": (3, 2), "المدينة": (4, 3),
             "الدمام": (5, 5), "الخبر": (6, 5), "ابها": (7, 6), "الباحة": (8, 12)}
R.to_catalog = lambda city_ar, region_hint=None: _CITY_IDS.get((city_ar or "").strip(), (None, None))
R.find_district_in_text = lambda text, city_id: None

# The neighbours' block, verbatim: its header, the first related card (a 1,350,000 price that is
# NOT this ad's) and the one card whose thumbnail is a real photo («…_annonce_841_small.jpeg»).
RELATED_BLOCK = r'''<div class="bloc annonces_related">
 <div class="bloc_content">
 <h3>اعلانات مماتلة</h3>
<div class="row" style="margin-top: 30px">
 <div class="col-xs-12 col-sm-6 col-md-4 col-lg-4">
 <div class="annoncex">
 <a href="https://almotmkenah.com/annonce/%D8%B4%D9%82%D9%87_%D8%AC%D8%AF%D9%8A%D8%AF%D9%87_%D8%AA%D8%B7%D9%84_%D8%B9%D9%84%D9%89_%D8%A7%D9%84%D8%B4%D8%A7%D8%B1%D8%B9_%D8%AD%D9%8A_%D8%A7%D9%84%D9%85%D8%A7%D8%AC%D8%AF%D9%8A%D8%A9_%D8%A7%D9%84%D8%B1%D9%8A%D8%A7%D8%B6-17">
 <div class="img"
 style="background-image: url('https://almotmkenah.com/img/image_default.png');">
 <div class="count">
 0 <i class="fa fa-camera" aria-hidden="true"></i>
 </div>
 <div class="city">
 <i class="fa fa-map-marker" aria-hidden="true"></i>
 الرياض
 </div>
 <div class="gradient"></div>
 </div>
 </a>
 <div class="info">
 <a href="https://almotmkenah.com/annonce/%D8%B4%D9%82%D9%87_%D8%AC%D8%AF%D9%8A%D8%AF%D9%87_%D8%AA%D8%B7%D9%84_%D8%B9%D9%84%D9%89_%D8%A7%D9%84%D8%B4%D8%A7%D8%B1%D8%B9_%D8%AD%D9%8A_%D8%A7%D9%84%D9%85%D8%A7%D8%AC%D8%AF%D9%8A%D8%A9_%D8%A7%D9%84%D8%B1%D9%8A%D8%A7%D8%B6-17" title="شقه للبيع في الرياض حي الربيع ( #الماجديه رزيدنس 116) تطل على الشارع + بلوكنتين+ حديقه مشتركه الدور الاول">
 <h2>شقه للبيع في الرياض حي الربيع ( #الماجديه رزيدنس 116) تطل على الشارع + بلوكنتين+ حديقه مشتركه الدور الاول شقه للبيع في الرياض حي الربيع ( #الماجديه رزيدنس 116) تطل على الشارع + بلوكنتين+ حديقه مشتركه الدور الاول</h2>
 </a>
 <div class="details">
 <div class="price">1,350,000 ر.س</div>
 <div class="other">
 <i class="fa fa-clock-o" aria-hidden="true"></i> 12-6-2024
 &nbsp;&nbsp;
 <i class="fa fa-tag" aria-hidden="true"></i> فلل وبيوت وشقق في الرياض
 </div>
 </div>
 </div>
 </div>
 </div>
 <div class="col-xs-12 col-sm-6 col-md-4 col-lg-4">
 <div class="annoncex">
 <a href="https://almotmkenah.com/annonce/%D9%81%D9%8A%D9%84%D8%A7_%D9%85%D8%B3%D8%AA%D9%82%D9%84%D9%87_%D9%81%D9%8A_%D8%AD%D9%8A_%D8%A8%D9%88%D8%A7%D8%A8%D8%A9_%D8%A7%D9%84%D8%B4%D8%B1%D9%82__%D8%A7%D9%84%D9%85%D8%B3%D8%A7%D8%AD%D9%87_300_%D9%85%D8%AA%D8%B1_%28%D8%A8%D8%B5%D9%83_%D8%A7%D9%84%D9%83%D8%AA%D8%B1%D9%88%D9%86%D9%8A%29_%D8%B4%D8%A7%D8%B1%D8%B9_15%D9%85-17">
 <div class="img"
 style="background-image: url('https://almotmkenah.com/storage/image/1751899404_annonce_841_small.jpeg');">
 <div class="count">
 14 <i class="fa fa-camera" aria-hidden="true"></i>
 </div>
 <div class="city">
 <i class="fa fa-map-marker" aria-hidden="true"></i>
 الرياض
 </div>
 <div class="gradient"></div>
 </div>
 </a>
 <div class="info">
 <a href="https://almotmkenah.com/annonce/%D9%81%D9%8A%D9%84%D8%A7_%D9%85%D8%B3%D8%AA%D9%82%D9%84%D9%87_%D9%81%D9%8A_%D8%AD%D9%8A_%D8%A8%D9%88%D8%A7%D8%A8%D8%A9_%D8%A7%D9%84%D8%B4%D8%B1%D9%82__%D8%A7%D9%84%D9%85%D8%B3%D8%A7%D8%AD%D9%87_300_%D9%85%D8%AA%D8%B1_%28%D8%A8%D8%B5%D9%83_%D8%A7%D9%84%D9%83%D8%AA%D8%B1%D9%88%D9%86%D9%8A%29_%D8%B4%D8%A7%D8%B1%D8%B9_15%D9%85-17" title="فيلا مستقله للبيع الرياض / بوابة الشرق المساحه 300 متر (بصك الكتروني) شارع 15م">
 <h2>فيلا مستقله للبيع الرياض / بوابة الشرق المساحه 300 متر (بصك الكتروني) شارع 15م فيلا مستقله للبيع الرياض / بوابة الشرق المساحه 300 متر (بصك الكتروني) شارع 15م</h2>
 </a>
 <div class="details">
 <div class="price">1,150,000 ر.س</div>
 <div class="other">
 <i class="fa fa-clock-o" aria-hidden="true"></i> 7-7-2025
 &nbsp;&nbsp;
 <i class="fa fa-tag" aria-hidden="true"></i> فلل وبيوت وشقق في الرياض
 </div>
 </div>
 </div>
 </div>
 </div>
 </div>
 </div>
 </div>
</div>
 <div class="col-xs-12 col-sm-12 col-md-4 col-lg-4">
<div class="hidden-xs">
 </div>
 <div class="bloc">
 <div class="bloc_content">
 <div class="star"><i class="fa fa-star" aria-hidden="true"></i></div>
 <h2><i class="fa fa-star" aria-hidden="true"></i>'''

CONTACT_MODAL = r'''<input type="hidden" name="a" value="send" />
 <input type="hidden" name="d" value="409">'''

# ad id → (why this page is in the barrier, its live URL, its verbatim own block)
FIXTURES = {
    '409': (
        "live land ad — its own 320,000 price field sits above the neighbours' prices",
        'https://almotmkenah.com/annonce/%D8%A7%D8%B1%D8%B6_%D8%B2%D8%A7%D9%88%D9%8A%D8%A9_%D9%85%D8%AE%D8%B7%D8%B7_3217_%D9%85%D9%86%D8%AD_%D8%B4%D8%B1%D9%82_%D8%A7%D9%84%D8%B1%D9%8A%D8%A7%D8%B6-15',
        r'''<h1>ارض زاوية مخطط 3217 منح شرق الرياض</h1>
annonce_header_info">
 <div class="row">
 <div class="col-xs-12 col-sm-6 col-md-4 col-lg-4">
 <i class="fa fa-map-marker" aria-hidden="true"></i> المدينة: الرياض
 </div>
 <div class="col-xs-12 col-sm-6 col-md-4 col-lg-4">
 <i class="fa fa-clock-o" aria-hidden="true"></i> تاريخ الادخال: 26-3-2026
 </div>
<div class="col-xs-12 col-sm-6 col-md-4 col-lg-4">
 <i class="fa fa-eye" aria-hidden="true"></i> المشاهدات: 684
 </div>
 </div>
 </div>
<div class="details" style="padding-bottom:30px;">
<p>للبيع ارض في منح شرق الرياض (مخططات طريق الدمام القديمة) <br />
<br />
مخطط : 3217 (زاويه)<br />
الشوارع : 28م شمالي بطول 36.15 و 15م غربي بطول 21.4 وشرقي بطول 25 وجنوبي بطول 36<br />
المساحة :833.3<br />
<br />
🔺بينها وبين طريق الدمام السريع قطعتين فقط <br />
🔺قابلة للتجزئة قطعتين تناسب شراكة بين اكثر من شخص بصك مشترك <br />
🔺لايوجد خدمات في المنطقه<br />
<br />
السوم: 320 الف صافي 💰<br />
<br />
موقع العقار اضغط الرابط 👇🏻<br />
 <a href="https://maps.app.goo.gl/UFm8tW5TfTSHoaC97?g_st=ic" target="_blank" rel="nofollow">maps.app.goo.gl</a><br />
<br />
مؤسسة المتمكنة للعقارات وتساب 0552288243 او 0531190994 رقمنا الموحد لخدمات مابعد الشراء 920022109 سجل رقم: 5800107037 رخصة فال : 1200017017</p>
 </div>
<div>
 <div class="row details">
 <div class="col-xs-6 col-sm-6 col-md-4 col-lg-4">
 <b>
 السعر 
 :
 </b> 320,000 ر.س
 </div>
</div>
 </div>
<div class="annonce_images">
<a href="https://almotmkenah.com/storage/image/1774538988_annonce_340.jpeg">
 <img src="https://almotmkenah.com/storage/image/1774538988_annonce_340.jpeg" class="img-responsive" />
 </a>
<div class="clearfix"></div>
 </div>
<div class="sharethis">
 <button type="button" class="btn btn-default" data-toggle="modal" data-target="#contactUs">
 <i class="fa fa-paper-plane" aria-hidden="true"></i> تواصل معنا
 </button>
<button type="button" class="btn btn-default js_share" >
 <i class="fa fa-share-alt" aria-hidden="true"></i> شارك
 </button>
<div class="sharethis_btn">
 <div class="sharethis-inline-share-buttons"></div>
 </div>
 </div>
 </div>
 </div>
<div class="bloc">
 <div class="bloc_content">
 <div class="comments">
<h3>التعليقات:</h3>
<div class="row">
 <div class="col-md-4 col-md-offset-4">
 <div style="margin-bottom: 10px">
 <a href="https://almotmkenah.com/login" class="btn btn-primary btn-block">تسجيل دخول</a>
 </div>
 <div>
 <a href="https://almotmkenah.com/register" class="btn btn-default btn-block">تسجيل حساب جديد</a>
 </div>
 </div>
 </div>
</div>
 </div>
 </div>
<div class="visible-xs">
 </div>
<div class="bloc annonces_related">
 <div class="bloc_content">
 <h3>'''),
    '202': (
        '«السعر : 3,690 ر.س» is the SAME number as «سعر متر البيع : 3690», on a 1,247 m² plot',
        'https://almotmkenah.com/annonce/%D8%A7%D8%B1%D8%B6_%D8%AA%D8%AC%D8%A7%D8%B1%D9%8A%D8%A9_%D8%A8%D8%A7%D9%84%D9%85%D9%86%D8%B7%D9%82%D8%A9_%D8%A7%D9%84%D8%B4%D8%B1%D9%82%D9%8A%D8%A9_%D8%AA%D8%B5%D8%B1%D9%8A%D8%AD_%D8%A7%D8%A8%D8%B1%D8%A7%D8%AC-10',
        r'''<h1>ارض تجارية بالمنطقة الشرقية تصريح ابراج</h1>
annonce_header_info">
 <div class="row">
 <div class="col-xs-12 col-sm-6 col-md-4 col-lg-4">
 <i class="fa fa-map-marker" aria-hidden="true"></i> المدينة: غير محدد
 </div>
 <div class="col-xs-12 col-sm-6 col-md-4 col-lg-4">
 <i class="fa fa-clock-o" aria-hidden="true"></i> تاريخ الادخال: 31-10-2022
 </div>
<div class="col-xs-12 col-sm-6 col-md-4 col-lg-4">
 <i class="fa fa-clock-o" aria-hidden="true"></i> آخر تحديث: 31-10-2022 17:23
 </div>
<div class="col-xs-12 col-sm-6 col-md-4 col-lg-4">
 <i class="fa fa-eye" aria-hidden="true"></i> المشاهدات: 89
 </div>
 </div>
 </div>
<p class="bg-danger text-danger" style="padding: 20px">هذا الاعلان لم يعد صالح تم نقله للأرشيف.</p>
<div class="details" style="padding-bottom:30px;">
<p>ارض تجارية موقع مميز بالمنطقة الشرقية على طريق ابو حدرية تصريح أبراج<br />
 رأس بلك على ثلاثة شوارع<br />
متعددة الطوابق <br />
(شارع بعرض 100 م) قريب من الملك عبدالله طريق (فنادق ، شقق مفروشة ، معارض ، شقق سكنية ، أبراج إدارية ، مكاتب ، وأنشطة رائدة أخرى)<br />
? أرض رقم 13 المخطط درة الفيصلية 1913\ش.د مدينة الدمام ،<br />
حدودها وأطوالها: <br />
?الطول (40.05) شمالاً: عرض شارع 15 متر <br />
?جنوب: قطعة رقم 12 طول: (40) <br />
?شرقاً: ممر مشاة بطول 8 متر (3106) <br />
?غرباً: عرض شارع 15 متر بطول (31.67) <br />
?مساحتها الإجمالية: (1247.48) م<br />
 ?مطلوب: 3690 للمتر المربع فقط?<br />
الصفه:مباشر بتفويض كتابي لتسويق العقار من المالك ✍? <br />
موقع العقار اضغط الرابط ??<br />
 <a href="https://goo.gl/maps/u3prXqy3Jmkf9B9u9" target="_blank" rel="nofollow">goo.gl</a><br />
<br />
المعلن : مؤسسة المتمكنة للعقارات <br />
سجل تجاري: 5800107037 <br />
وتساب: 0552288243</p>
 </div>
<div>
 <div class="row details">
 <div class="col-xs-6 col-sm-6 col-md-4 col-lg-4">
 <b>
 السعر 
 :
 </b> 3,690 ر.س
 </div>
<div class="col-xs-6 col-sm-6 col-md-4 col-lg-4">
 <b>المساحة:</b> 1247 متر مربع
 </div>
<div class="col-xs-6 col-sm-6 col-md-4 col-lg-4">
 <b>نوع إستخدام العقار:</b> ارض تجارية
 </div>
<div class="col-xs-6 col-sm-6 col-md-4 col-lg-4">
 <b>نوع العقار:</b> تجاري
 </div>
<div class="col-xs-6 col-sm-6 col-md-4 col-lg-4">
 <b>رقم الأرض:</b> 13
 </div>
<div class="col-xs-6 col-sm-6 col-md-4 col-lg-4">
 <b>واجهة العقار:</b> شمالية
 </div>
<div class="col-xs-6 col-sm-6 col-md-4 col-lg-4">
 <b>حدود وأطوال العقار:</b> 40*31
 </div>
<div class="col-xs-6 col-sm-6 col-md-4 col-lg-4">
 <b>عرض الشارع:</b> 15
 </div>
<div class="col-xs-6 col-sm-6 col-md-4 col-lg-4">
 <b>سعر متر البيع:</b> 3690
 </div>
</div>
 </div>
<div class="annonce_images">
<a href="https://almotmkenah.com/storage/image/1667207817_annonce_647.jpeg">
 <img src="https://almotmkenah.com/storage/image/1667207817_annonce_647.jpeg" class="img-responsive" />
 </a>
<div class="clearfix"></div>
 </div>
<div class="sharethis">
 <button type="button" class="btn btn-default" data-toggle="modal" data-target="#contactUs">
 <i class="fa fa-paper-plane" aria-hidden="true"></i> تواصل معنا
 </button>
<button type="button" class="btn btn-default js_share" >
 <i class="fa fa-share-alt" aria-hidden="true"></i> شارك
 </button>
<div class="sharethis_btn">
 <div class="sharethis-inline-share-buttons"></div>
 </div>
 </div>
 </div>
 </div>
<div class="bloc">
 <div class="bloc_content">
 <div class="comments">
<h3>التعليقات:</h3>
<div class="row">
 <div class="col-md-4 col-md-offset-4">
 <div style="margin-bottom: 10px">
 <a href="https://almotmkenah.com/login" class="btn btn-primary btn-block">تسجيل دخول</a>
 </div>
 <div>
 <a href="https://almotmkenah.com/register" class="btn btn-default btn-block">تسجيل حساب جديد</a>
 </div>
 </div>
 </div>
</div>
 </div>
 </div>
<div class="visible-xs">
 </div>
<div class="bloc annonces_related">
 <div class="bloc_content">
 <h3>'''),
    '225': (
        'a total AND a per-metre rate, both published and DIFFERENT (840,000 and 2,800 on 300 m²)',
        'https://almotmkenah.com/annonce/%D9%84%D9%84%D8%A8%D9%8A%D8%B9_%D8%A7%D8%B1%D8%B6_%D9%81%D9%8A_%D8%A7%D9%84%D8%B1%D9%8A%D8%A7%D8%B6__%D8%AD%D9%8A_%D8%A7%D9%84%D9%81%D8%A7%D8%B1%D9%88%D9%82__%D9%85%D8%AE%D8%B7%D8%B7_%D8%A7%D9%84%D8%B1%D8%A8%D9%88%D9%87_3203_1-62',
        r'''<h1>للبيع ارض في الرياض حي الفاروق مخطط الربوه 3203/1</h1>
annonce_header_info">
 <div class="row">
 <div class="col-xs-12 col-sm-6 col-md-4 col-lg-4">
 <i class="fa fa-map-marker" aria-hidden="true"></i> المدينة: الرياض
 </div>
 <div class="col-xs-12 col-sm-6 col-md-4 col-lg-4">
 <i class="fa fa-clock-o" aria-hidden="true"></i> تاريخ الادخال: 27-2-2023
 </div>
<div class="col-xs-12 col-sm-6 col-md-4 col-lg-4">
 <i class="fa fa-clock-o" aria-hidden="true"></i> آخر تحديث: 28-4-2025 17:04
 </div>
<div class="col-xs-12 col-sm-6 col-md-4 col-lg-4">
 <i class="fa fa-eye" aria-hidden="true"></i> المشاهدات: 1461
 </div>
 </div>
 </div>
<p class="bg-danger text-danger" style="padding: 20px">هذا الاعلان لم يعد صالح تم نقله للأرشيف.</p>
<div class="details" style="padding-bottom:30px;">
<p>للبيع ارض في الرياض<br />
 حي الفاروق <br />
مخطط الربوه 3203/1 <br />
شارع 15م جنوبي <br />
الاطوال 12في 25 <br />
المساحة 300م <br />
<br />
موقع العقار اضغط الرابط ??<br />
 <a href="https://maps.app.goo.gl/ZQqtLGhA4PVPKWuz9?g_st=iw" target="_blank" rel="nofollow">maps.app.goo.gl</a><br />
<br />
البيع 2800 ريال للمتر <br />
<br />
المعلن : مؤسسة المتمكنة للعقارات <br />
سجل تجاري: 5800107037 <br />
وتساب: 0552288243 <br />
<br />
?الصفه:مباشر بتفويض كتابي لتسويق العقار من المالك ✍?</p>
 </div>
<div>
 <div class="row details">
 <div class="col-xs-6 col-sm-6 col-md-4 col-lg-4">
 <b>
 السعر 
 :
 </b> 840,000 ر.س
 </div>
<div class="col-xs-6 col-sm-6 col-md-4 col-lg-4">
 <b>المساحة:</b> 300 متر مربع
 </div>
<div class="col-xs-6 col-sm-6 col-md-4 col-lg-4">
 <b>رقم المخطط:</b> 3203
 </div>
<div class="col-xs-6 col-sm-6 col-md-4 col-lg-4">
 <b>حدود وأطوال العقار:</b> 12*25
 </div>
<div class="col-xs-6 col-sm-6 col-md-4 col-lg-4">
 <b>عرض الشارع:</b> 15
 </div>
<div class="col-xs-6 col-sm-6 col-md-4 col-lg-4">
 <b>سعر متر البيع:</b> 2800
 </div>
</div>
 </div>
<div class="annonce_images">
<a href="https://almotmkenah.com/storage/image/1677525837_annonce_460.jpeg">
 <img src="https://almotmkenah.com/storage/image/1677525837_annonce_460.jpeg" class="img-responsive" />
 </a>
<div class="clearfix"></div>
 </div>
<div class="sharethis">
 <button type="button" class="btn btn-default" data-toggle="modal" data-target="#contactUs">
 <i class="fa fa-paper-plane" aria-hidden="true"></i> تواصل معنا
 </button>
<button type="button" class="btn btn-default js_share" >
 <i class="fa fa-share-alt" aria-hidden="true"></i> شارك
 </button>
<div class="sharethis_btn">
 <div class="sharethis-inline-share-buttons"></div>
 </div>
 </div>
 </div>
 </div>
<div class="bloc">
 <div class="bloc_content">
 <div class="comments">
<h3>التعليقات:</h3>
<div class="row">
 <div class="col-md-4 col-md-offset-4">
 <div style="margin-bottom: 10px">
 <a href="https://almotmkenah.com/login" class="btn btn-primary btn-block">تسجيل دخول</a>
 </div>
 <div>
 <a href="https://almotmkenah.com/register" class="btn btn-default btn-block">تسجيل حساب جديد</a>
 </div>
 </div>
 </div>
</div>
 </div>
 </div>
<div class="visible-xs">
 </div>
<div class="bloc annonces_related">
 <div class="bloc_content">
 <h3>'''),
    '181': (
        "an عمارة whose «عدد الغرف» is 36 — the building's rooms, not 36 bedrooms",
        'https://almotmkenah.com/annonce/%D8%B9%D9%85%D8%A7%D8%B1%D8%A9_%D8%AA%D8%AC%D8%A7%D8%B1%D9%8A%D8%A9_%D9%84%D9%84%D8%A8%D9%8A%D8%B9_%D8%A8%D8%AD%D9%8A_%D8%A7%D9%84%D8%B9%D8%A7%D8%B1%D8%B6-15',
        r'''<h1>فرصة استثمارية عمارة تجارية للبيع بحي العارض</h1>
annonce_header_info">
 <div class="row">
 <div class="col-xs-12 col-sm-6 col-md-4 col-lg-4">
 <i class="fa fa-map-marker" aria-hidden="true"></i> المدينة: الرياض
 </div>
 <div class="col-xs-12 col-sm-6 col-md-4 col-lg-4">
 <i class="fa fa-clock-o" aria-hidden="true"></i> تاريخ الادخال: 13-6-2022
 </div>
<div class="col-xs-12 col-sm-6 col-md-4 col-lg-4">
 <i class="fa fa-clock-o" aria-hidden="true"></i> آخر تحديث: 24-10-2022 19:19
 </div>
<div class="col-xs-12 col-sm-6 col-md-4 col-lg-4">
 <i class="fa fa-eye" aria-hidden="true"></i> المشاهدات: 1039
 </div>
 </div>
 </div>
<p class="bg-danger text-danger" style="padding: 20px">هذا الاعلان لم يعد صالح تم نقله للأرشيف.</p>
<div class="details" style="padding-bottom:30px;">
<p>عمارة تجارية للبيع بحي العارض <br />
مساحة 875 م<br />
زاويه شمالية غربية <br />
شارع 20 شمال 30 غرب <br />
عمر العقار : 5 سنوات <br />
الدور الأرضي:<br />
 مكون من 4 محلات و 4 شقق <br />
الدور الارضي مصنع حلويات<br />
<br />
الدور الأول:<br />
 ٨ شقق<br />
<br />
الدور الثاني :<br />
4 شقق<br />
 <br />
<br />
كل شقة عبارة عن غرفتين وصالة ومطبخ راكب ودورة مياااه<br />
<br />
مؤجرة بالكامل<br />
( الدخل ٣٧٥ألف المالك مأجر برخيص والايجارات ممكن توصل بالراحه الى ٥٠٠ الف)<br />
السوم 5 مليون و200 الف ريال صافي بدون الضريبة والسعي<br />
والبيع قريب <br />
<br />
<br />
السعر لايشمل الضريبه والسعي ولحسابها اضغط الرابط?? <a href="https://almotmkenah.com/حاسبة-الضربة-و-السعي" target="_blank" rel="nofollow">almotmkenah.com</a></p>
 </div>
<div>
 <div class="row details">
 <div class="col-xs-6 col-sm-6 col-md-4 col-lg-4">
 <b>
 السعر 
 :
 </b> 5,500,000 ر.س
 </div>
<div class="col-xs-6 col-sm-6 col-md-4 col-lg-4">
 <b>المساحة:</b> 875 متر مربع
 </div>
<div class="col-xs-6 col-sm-6 col-md-4 col-lg-4">
 <b>إسم المنطقة:</b> الرياض
 </div>
<div class="col-xs-6 col-sm-6 col-md-4 col-lg-4">
 <b>إسم الحي:</b> العلرض
 </div>
<div class="col-xs-6 col-sm-6 col-md-4 col-lg-4">
 <b>موقع العقار:</b> <a href="https://www.google.com/maps/@https://maps.google.com/?q=24.881210,46.617641,15z" target="_blank">إضغط هنا</a>
 </div>
<div class="col-xs-6 col-sm-6 col-md-4 col-lg-4">
 <b>نوع إستخدام العقار:</b> تجاري
 </div>
<div class="col-xs-6 col-sm-6 col-md-4 col-lg-4">
 <b>نوع العقار:</b> تجاري
 </div>
<div class="col-xs-6 col-sm-6 col-md-4 col-lg-4">
 <b>رقم الأرض:</b> 1656
 </div>
<div class="col-xs-6 col-sm-6 col-md-4 col-lg-4">
 <b>رقم المخطط:</b> 2078
 </div>
<div class="col-xs-6 col-sm-6 col-md-4 col-lg-4">
 <b>عدد الوحدات:</b> 12
 </div>
<div class="col-xs-6 col-sm-6 col-md-4 col-lg-4">
 <b>رقم الدور:</b> 3
 </div>
<div class="col-xs-6 col-sm-6 col-md-4 col-lg-4">
 <b>عدد الغرف:</b> 36
 </div>
<div class="col-xs-6 col-sm-6 col-md-4 col-lg-4">
 <b>نوع الغرف:</b> شقق سكني والدور الارضي مصنع حلويات
 </div>
<div class="col-xs-6 col-sm-6 col-md-4 col-lg-4">
 <b>واجهة العقار:</b> بويه
 </div>
<div class="col-xs-6 col-sm-6 col-md-4 col-lg-4">
 <b>حدود وأطوال العقار:</b> 35
 </div>
<div class="col-xs-6 col-sm-6 col-md-4 col-lg-4">
 <b>عرض الشارع:</b> 25
 </div>
<div class="col-xs-6 col-sm-6 col-md-4 col-lg-4">
 <b>تاريخ البناء:</b> 5 سنوات
 </div>
<div class="col-xs-6 col-sm-6 col-md-4 col-lg-4">
 <b>سعر متر البيع:</b> 6857
 </div>
<div class="col-xs-6 col-sm-6 col-md-4 col-lg-4">
 <b>مؤثث:</b> المطابخ راكبه
 </div>
<div class="col-xs-6 col-sm-6 col-md-4 col-lg-4">
 <b>المطبخ:</b> مركب
 </div>
</div>
 </div>
<div class="annonce_images">
<div class="col-sm-8 col-md-8"
 style="min-height:300px;background-image:url('https://almotmkenah.com/storage/image/1655162795_annonce_679.jpeg')"><a
 href="https://almotmkenah.com/storage/image/1655162795_annonce_679.jpeg">
 <div class="img_listings_overlay"></div>
 </a>
 </div>
<div class="col-xs-6 col-sm-4 col-md-4"
 style="min-height:150px;background-image:url('https://almotmkenah.com/storage/image/1655162988_annonce_195.jpeg'); 
 "
 >
 <a href="https://almotmkenah.com/storage/image/1655162988_annonce_195.jpeg">
<div class="img_listings_overlay"></div>
</a>
 </div>
 <div class="col-xs-6 col-sm-4 col-md-4"
 style="min-height:150px;background-image:url('https://almotmkenah.com/storage/image/1655162988_annonce_632.jpeg'); 
 "
 >
 <a href="https://almotmkenah.com/storage/image/1655162988_annonce_632.jpeg">
<div class="img_listings_overlay"></div>
</a>
 </div>
 <div class="col-xs-6 col-sm-4 col-md-4"
 style="min-height:150px;background-image:url('https://almotmkenah.com/storage/image/1655162988_annonce_735.jpeg'); 
 "
 >
 <a href="https://almotmkenah.com/storage/image/1655162988_annonce_735.jpeg">
<div class="img_listings_overlay"></div>
</a>
 </div>
 <div class="col-xs-6 col-sm-4 col-md-4"
 style="min-height:150px;background-image:url('https://almotmkenah.com/storage/image/1655162989_annonce_117.jpeg'); 
 "
 >
 <a href="https://almotmkenah.com/storage/image/1655162989_annonce_117.jpeg">
<div class="img_listings_overlay"></div>
</a>
 </div>
 <div class="col-xs-6 col-sm-4 col-md-4"
 style="min-height:150px;background-image:url('https://almotmkenah.com/storage/image/1655162989_annonce_635.jpeg'); 
 "
 >
 <a href="https://almotmkenah.com/storage/image/1655162989_annonce_635.jpeg">
<div class="img_listings_overlay" style="opacity: 0.4;"></div>
 <div class="img_show_all">مشاهدة جميع الصور <i class="fa fa-angle-double-left"
 aria-hidden="true"></i></i></div>
 </a>
 </div>
<div class="clearfix"></div>
 </div>
<div class="sharethis">
 <button type="button" class="btn btn-default" data-toggle="modal" data-target="#contactUs">
 <i class="fa fa-paper-plane" aria-hidden="true"></i> تواصل معنا
 </button>
<button type="button" class="btn btn-default js_share" >
 <i class="fa fa-share-alt" aria-hidden="true"></i> شارك
 </button>
<div class="sharethis_btn">
 <div class="sharethis-inline-share-buttons"></div>
 </div>
 </div>
 </div>
 </div>
<div class="bloc">
 <div class="bloc_content">
 <div class="comments">
<h3>التعليقات:</h3>
<div class="row">
 <div class="col-md-4 col-md-offset-4">
 <div style="margin-bottom: 10px">
 <a href="https://almotmkenah.com/login" class="btn btn-primary btn-block">تسجيل دخول</a>
 </div>
 <div>
 <a href="https://almotmkenah.com/register" class="btn btn-default btn-block">تسجيل حساب جديد</a>
 </div>
 </div>
 </div>
</div>
 </div>
 </div>
<div class="visible-xs">
 </div>
<div class="bloc annonces_related">
 <div class="bloc_content">
 <h3>'''),
    '408': (
        'sale ad whose own prose says «ومؤجرة بالكامل»; its slug ends -35',
        'https://almotmkenah.com/annonce/%D8%B9%D9%85%D8%A7%D8%B1%D8%A9_%D8%AA%D8%AC%D8%A7%D8%B1%D9%8A%D8%A9_%D8%B3%D9%83%D9%86%D9%8A%D8%A9_%D8%B9%D9%84%D9%89_%D8%B4%D8%A7%D8%B1%D8%B9%D9%8A%D9%86_%D8%AD%D9%8A_%D9%85%D9%86%D9%81%D9%88%D8%AD%D8%A9_%D8%A7%D9%84%D8%AC%D8%AF%D9%8A%D8%AF%D8%A9-35',
        r'''<h1>عمارة تجارية سكنية على شارعين حي منفوحة الجديدة</h1>
annonce_header_info">
 <div class="row">
 <div class="col-xs-12 col-sm-6 col-md-4 col-lg-4">
 <i class="fa fa-map-marker" aria-hidden="true"></i> المدينة: الرياض
 </div>
 <div class="col-xs-12 col-sm-6 col-md-4 col-lg-4">
 <i class="fa fa-clock-o" aria-hidden="true"></i> تاريخ الادخال: 21-12-2025
 </div>
<div class="col-xs-12 col-sm-6 col-md-4 col-lg-4">
 <i class="fa fa-eye" aria-hidden="true"></i> المشاهدات: 574
 </div>
 </div>
 </div>
<div class="details" style="padding-bottom:30px;">
<p>للبيع عمارة مميزة وسعرها مناسب 👌🏻 <br />
<br />
عمارة تجارية سكنية<br />
على شارعين حي منفوحة الجديدة<br />
📍 على شارع سهل بن عدي / جُمّان<br />
<br />
3 وحدات تجارية<br />
3 وحدات سكنية، كل شقة بمدخل مستقل✅<br />
<br />
💰 الدخل الحالي: 113,100 ريال<br />
العقار مجدد من داخل وخارج وسباكة وخزان وصرف صحي.✅<br />
•<br />
السداد منتظم ✅<br />
<br />
⚡ عدادات كهرب — كل شقة عداد منفصل<br />
🔌 المحلات كهرب مشترك<br />
<br />
🏠 عمارة مجددة بالكامل ومؤجرة بالكامل بعقود إلكترونية<br />
✅ دخل مميز مناسب كإيراد <br />
🚶‍♂️ تبعد 5 دقائق عن محطة مترو منفوحة الجديدة مشي <br />
<br />
حدها سابقاً 1,500,000 ريال <br />
قابل للتفاوض للجاد ✅<br />
يوجد مكتب يتابعها ✅<br />
جاهزة للإفراغ <br />
<br />
 وتساب 0552288243 او 0531190994 رقمنا الموحد لخدمات مابعد الشراء 920022109 سجل رقم: 5800107037 رخصة فال : 1200017017</p>
 </div>
<div>
 <div class="row details">
 <div class="col-xs-6 col-sm-6 col-md-4 col-lg-4">
 <b>
 السعر 
 :
 </b> 1,430,000 ر.س
 </div>
</div>
 </div>
<div class="annonce_images">
<div class="clearfix"></div>
 </div>
<div class="sharethis">
 <button type="button" class="btn btn-default" data-toggle="modal" data-target="#contactUs">
 <i class="fa fa-paper-plane" aria-hidden="true"></i> تواصل معنا
 </button>
<button type="button" class="btn btn-default js_share" >
 <i class="fa fa-share-alt" aria-hidden="true"></i> شارك
 </button>
<div class="sharethis_btn">
 <div class="sharethis-inline-share-buttons"></div>
 </div>
 </div>
 </div>
 </div>
<div class="bloc">
 <div class="bloc_content">
 <div class="comments">
<h3>التعليقات:</h3>
<div class="row">
 <div class="col-md-4 col-md-offset-4">
 <div style="margin-bottom: 10px">
 <a href="https://almotmkenah.com/login" class="btn btn-primary btn-block">تسجيل دخول</a>
 </div>
 <div>
 <a href="https://almotmkenah.com/register" class="btn btn-default btn-block">تسجيل حساب جديد</a>
 </div>
 </div>
 </div>
</div>
 </div>
 </div>
<div class="visible-xs">
 </div>
<div class="bloc annonces_related">
 <div class="bloc_content">
 <h3>'''),
    '405': (
        'a sale stated only as «الحد البيع / 1,150,000»; its slug ALSO ends -35',
        'https://almotmkenah.com/annonce/%D9%81%D9%8A%D9%84%D8%A7_%D9%81%D9%8A_%D8%AD%D9%8A_%D8%A7%D9%84%D8%B1%D9%8A%D9%81_%D8%A7%D9%84%D8%B0%D9%87%D8%A8%D9%8A_-_%D8%AD%D9%8A_%D8%A7%D9%84%D8%AC%D8%A7%D9%85%D8%B9%D8%A9_%D8%AE%D9%84%D9%81_%D8%A7%D9%84%D8%A8%D9%88%D9%84%D9%8A%D9%81%D8%A7%D8%B1%D8%AF_%D8%AA%D8%B4%D8%B7%D9%8A%D8%A8_%D9%85%D9%85%D8%AA%D8%A7%D8%B2_%D8%B4%D8%A7%D8%B1%D8%B9_20_%D9%88%D8%A7%D8%AC%D9%87%D8%A9_%D8%B4%D8%B1%D9%82%D9%8A_%D8%A7%D9%84%D9%85%D8%B3%D8%A7%D8%AD%D8%A9_483-35',
        r'''<h1>فيلا في المزاحمية حي الريف الذهبي - حي الجامعة خلف البوليفارد تشطيب ممتاز شارع 20 واجهة شرقي المساحة 483</h1>
annonce_header_info">
 <div class="row">
 <div class="col-xs-12 col-sm-6 col-md-4 col-lg-4">
 <i class="fa fa-map-marker" aria-hidden="true"></i> المدينة: الرياض
 </div>
 <div class="col-xs-12 col-sm-6 col-md-4 col-lg-4">
 <i class="fa fa-clock-o" aria-hidden="true"></i> تاريخ الادخال: 7-9-2025
 </div>
<div class="col-xs-12 col-sm-6 col-md-4 col-lg-4">
 <i class="fa fa-clock-o" aria-hidden="true"></i> آخر تحديث: 7-9-2025 17:05
 </div>
<div class="col-xs-12 col-sm-6 col-md-4 col-lg-4">
 <i class="fa fa-eye" aria-hidden="true"></i> المشاهدات: 1000
 </div>
 </div>
 </div>
<div class="details" style="padding-bottom:30px;">
<p>فيلا في حي الريف الذهبي - حي الجامعة خلف البوليفارد تشطيب ممتاز شارع 20 واجهة شرقي المساحة 483 عمر الفيلا 3 سنوات <br />
.<br />
الفيلا نظيفة جدا لم يتم التعديل فيها ابد حتى المطبخ لم يتم التركيب<br />
.<br />
يتكون من:<br />
* حوش يتسع على 3 سيارات كحد ادنى<br />
* مشب - مجلس رجال - مجلس حريم - مقلط اكل - 4 دورات مياة - مطبخ - صالة كبيرة - ثلاث غرف نوم ماستر بدورة مياة وغرفتين بدورة مياة - مدخل خاص للسطح وفي السطح مستودع ( مؤوسس لشقتين ) <br />
.<br />
الفيلا على بنك الاهلي السداد المبكر: 1,094,000 <br />
.<br />
الحد البيع / 1,150,000<br />
.موقع العقار اضغط الرابط 👇🏻 <br />
 <a href="https://maps.app.goo.gl/ga29kwrk55MVVuKZ9?g_st=iwb" target="_blank" rel="nofollow">maps.app.goo.gl</a><br />
<br />
وتساب: 0552288243 او 0531190994 أو رقمنا الموحد وتساب 920022109<br />
<br />
_____<br />
🏡 Villa for Sale – Al Reef Al Thahabi District, Al Jamiah Area (Behind Boulevard, Riyadh)<br />
<br />
✨ Property Highlights:<br />
	•	Prime Location: Situated in Al Jamiah, directly behind Boulevard – one of Riyadh’s most vibrant destinations.<br />
	•	Street & Orientation: 20m wide street, East-facing.<br />
	•	Plot Size: 483 sqm.<br />
	•	Age: 3 years.<br />
	•	Condition: Excellent – very well maintained, never modified (kitchen not installed yet, giving flexibility to design your own).<br />
<br />
✨ Features:<br />
	•	Spacious yard accommodating at least 3 cars.<br />
	•	Guest majlis (men’s reception room).<br />
	•	Separate women’s majlis.<br />
	•	Dining area.<br />
	•	Large family living hall.<br />
	•	4 bathrooms.<br />
	•	Kitchen space.<br />
	•	3 master bedrooms with en-suite bathrooms.<br />
	•	2 additional bedrooms with shared bathroom.<br />
	•	Private entrance to the rooftop with storage room (foundation prepared for 2 future apartments).<br />
<br />
✨ Financial Details:<br />
	•	Property is on Al Ahli Bank mortgage.<br />
	•	Early settlement: SAR 1,094,000.<br />
	•	Asking Price: SAR 1,150,000.<br />
<br />
📍 Location: Google Maps Link<br />
<br />
📲 Contact via WhatsApp:<br />
0552288243 | 0531190994 | Unified number: 920022109<br />
<br />
⸻<br />
<br />
💼 Ideal for investors or families seeking a prime residence near Boulevard with excellent potential for future expansion.</p>
 </div>
<div>
 <div class="row details">
 <div class="col-xs-6 col-sm-6 col-md-4 col-lg-4">
 <b>
 السعر 
 :
 </b> 1,150,000 ر.س
 </div>
</div>
 </div>
<div class="annonce_images">
<a href="https://almotmkenah.com/storage/image/1757261369_annonce_619.jpeg">
 <img src="https://almotmkenah.com/storage/image/1757261369_annonce_619.jpeg" class="img-responsive" />
 </a>
<div class="clearfix"></div>
 </div>
<div class="sharethis">
 <button type="button" class="btn btn-default" data-toggle="modal" data-target="#contactUs">
 <i class="fa fa-paper-plane" aria-hidden="true"></i> تواصل معنا
 </button>
<button type="button" class="btn btn-default js_share" >
 <i class="fa fa-share-alt" aria-hidden="true"></i> شارك
 </button>
<div class="sharethis_btn">
 <div class="sharethis-inline-share-buttons"></div>
 </div>
 </div>
 </div>
 </div>
<div class="bloc">
 <div class="bloc_content">
 <div class="comments">
<h3>التعليقات:</h3>
<div class="row">
 <div class="col-md-4 col-md-offset-4">
 <div style="margin-bottom: 10px">
 <a href="https://almotmkenah.com/login" class="btn btn-primary btn-block">تسجيل دخول</a>
 </div>
 <div>
 <a href="https://almotmkenah.com/register" class="btn btn-default btn-block">تسجيل حساب جديد</a>
 </div>
 </div>
 </div>
</div>
 </div>
 </div>
<div class="visible-xs">
 </div>
<div class="bloc annonces_related">
 <div class="bloc_content">
 <h3>'''),
    '404': (
        '«راس بلك … مساحته 4000م عدد 4 قطع مناسبه 8 فلل» — land, advertising what could be built',
        'https://almotmkenah.com/annonce/%D9%81%D8%B1%D8%B5%D8%A9_%D9%84%D9%84%D9%85%D8%B7%D9%88%D8%B1%D9%8A%D9%86_%D9%88%D8%A7%D9%84%D9%85%D8%B3%D8%AA%D8%AB%D9%85%D8%B1%D9%8A%D9%86_%D8%B1%D8%A7%D8%B3_%D8%A8%D9%84%D9%83_%D8%B4%D9%85%D8%A7%D9%84_%D8%A7%D9%84%D8%B1%D9%8A%D8%A7%D8%B6_%D9%85%D9%86%D8%AD_%D8%A7%D9%84%D8%AE%D9%8A%D8%B1_%D9%85%D8%B3%D8%A7%D8%AD%D8%AA%D9%87_4000%D9%85_%D8%B9%D8%AF%D8%AF_4_%D9%82%D8%B7%D8%B9_%D9%85%D9%86%D8%A7%D8%B3%D8%A8%D9%87_8_%D9%81%D9%84%D9%84-57',
        r'''<h1>فرصة للمطورين والمستثمرين راس بلك شمال الرياض منح الخير مساحته 4000م عدد 4 قطع مناسبه 8 فلل</h1>
annonce_header_info">
 <div class="row">
 <div class="col-xs-12 col-sm-6 col-md-4 col-lg-4">
 <i class="fa fa-map-marker" aria-hidden="true"></i> المدينة: الرياض
 </div>
 <div class="col-xs-12 col-sm-6 col-md-4 col-lg-4">
 <i class="fa fa-clock-o" aria-hidden="true"></i> تاريخ الادخال: 6-9-2025
 </div>
<div class="col-xs-12 col-sm-6 col-md-4 col-lg-4">
 <i class="fa fa-clock-o" aria-hidden="true"></i> آخر تحديث: 6-9-2025 16:24
 </div>
<div class="col-xs-12 col-sm-6 col-md-4 col-lg-4">
 <i class="fa fa-eye" aria-hidden="true"></i> المشاهدات: 2828
 </div>
 </div>
 </div>
<div class="details" style="padding-bottom:30px;">
<p>💼 خيار مثالي للمطورين والشركات العقارية والمستثمرين في شمال ‫#الرياض‬ <br />
راس بلك ‫#منح_الخير‬ <br />
مخطط 3312/ب<br />
اربع قطع مساحة 4000م <br />
شارع 25م جنوبي وشارع 20م شمالي وشارع 8م شرقي ومرفق حكومي<br />
الاطوال لكل قطعه ممتازه 40م في 25م<br />
🔺 مميزات العقار:<br />
 • إمكانية تطوير 8 فلل فاخرة على الأربع قطع<br />
 • أطوال مثالية تناسب التصاميم الحديثة<br />
 • موقع استراتيجي قبل الشعيب مباشرة<br />
 • منطقة مسكونة ومخدومة بالكهرباء<br />
 • أفضل موقع داخل المخطط<br />
<br />
الارض على السوم 💵<br />
مباشر من المالك 🔹<br />
<br />
وتساب: 0552288243 او 0531190994 أو رقمنا الموحد وتساب 920022109<br />
سجل رقم: 5800107037 <br />
رخصة فال : 1200017017<br />
💼 Premium Opportunity for Developers, Real Estate Companies & Investors in North #Riyadh<br />
📍 Prime Corner Block – Al Khair Grants Area<br />
Plan No. 3312/B<br />
	•	4 plots with a total area of 4,000 sqm<br />
	•	Ideal dimensions: 40m × 25m each<br />
	•	Surrounded by 3 streets: 25m South – 20m North – 8m East<br />
	•	Adjacent government facility adding long-term value<br />
<br />
🔺 Property Highlights:<br />
• Potential to develop 8 luxury villas across the 4 plots<br />
• Excellent dimensions suitable for modern designs<br />
• Strategic location, right before Al Shu’ayb<br />
• Fully serviced area with electricity and active community<br />
• One of the best locations within the master plan<br />
<br />
💵 Price: On Offer<br />
🔹 Direct from Owner<br />
<br />
📲 Contact via WhatsApp:<br />
0552288243 – 0531190994<br />
Unified WhatsApp: 920022109<br />
<br />
Registry No.: 5800107037<br />
Val License: 1200017017</p>
 </div>
<div>
 <div class="row details">
 <div class="col-xs-6 col-sm-6 col-md-4 col-lg-4">
 <b>
 السومة 
 :
 </b> 2,000 ر.س
 </div>
</div>
 </div>
<div class="annonce_images">
<div class="col-sm-8 col-md-8"
 style="min-height:300px;background-image:url('https://almotmkenah.com/storage/image/1757175844_annonce_637.jpeg')"><a
 href="https://almotmkenah.com/storage/image/1757175844_annonce_637.jpeg">
 <div class="img_listings_overlay"></div>
 </a>
 </div>
<div class="col-xs-6 col-sm-4 col-md-4"
 style="min-height:150px;background-image:url('https://almotmkenah.com/storage/image/1757175597_annonce_382.jpeg'); 
 "
 >
 <a href="https://almotmkenah.com/storage/image/1757175597_annonce_382.jpeg">
<div class="img_listings_overlay" style="opacity: 0.4;"></div>
 <div class="img_show_all">مشاهدة جميع الصور <i class="fa fa-angle-double-left"
 aria-hidden="true"></i></i></div>
 </a>
 </div>
<div class="clearfix"></div>
 </div>
<div class="sharethis">
 <button type="button" class="btn btn-default" data-toggle="modal" data-target="#contactUs">
 <i class="fa fa-paper-plane" aria-hidden="true"></i> تواصل معنا
 </button>
<button type="button" class="btn btn-default js_share" >
 <i class="fa fa-share-alt" aria-hidden="true"></i> شارك
 </button>
<div class="sharethis_btn">
 <div class="sharethis-inline-share-buttons"></div>
 </div>
 </div>
 </div>
 </div>
<div class="bloc">
 <div class="bloc_content">
 <div class="comments">
<h3>التعليقات:</h3>
<div class="row">
 <div class="col-md-4 col-md-offset-4">
 <div style="margin-bottom: 10px">
 <a href="https://almotmkenah.com/login" class="btn btn-primary btn-block">تسجيل دخول</a>
 </div>
 <div>
 <a href="https://almotmkenah.com/register" class="btn btn-default btn-block">تسجيل حساب جديد</a>
 </div>
 </div>
 </div>
</div>
 </div>
 </div>
<div class="visible-xs">
 </div>
<div class="bloc annonces_related">
 <div class="bloc_content">
 <h3>'''),
    '403': (
        'area published only in Arabic-Indic prose («مساحة البلك ١٢٦٥٠ متر»); total 335,225,000',
        'https://almotmkenah.com/annonce/%D8%A8%D9%84%D9%83_%D8%AA%D8%AC%D8%A7%D8%B1%D9%8A_%D9%84%D9%84%D8%A8%D9%8A%D8%B9_%D9%81%D9%8A_%D8%A7%D9%84%D8%B1%D9%8A%D8%A7%D8%B6_%D8%AD%D9%8A_%D8%A7%D9%84%D9%82%D9%8A%D8%B1%D9%88%D8%A7%D9%86-91',
        r'''<h1>بلك تجاري للبيع في الرياض حي القيروان</h1>
annonce_header_info">
 <div class="row">
 <div class="col-xs-12 col-sm-6 col-md-4 col-lg-4">
 <i class="fa fa-map-marker" aria-hidden="true"></i> المدينة: الرياض
 </div>
 <div class="col-xs-12 col-sm-6 col-md-4 col-lg-4">
 <i class="fa fa-clock-o" aria-hidden="true"></i> تاريخ الادخال: 26-8-2025
 </div>
<div class="col-xs-12 col-sm-6 col-md-4 col-lg-4">
 <i class="fa fa-clock-o" aria-hidden="true"></i> آخر تحديث: 26-8-2025 14:31
 </div>
<div class="col-xs-12 col-sm-6 col-md-4 col-lg-4">
 <i class="fa fa-eye" aria-hidden="true"></i> المشاهدات: 934
 </div>
 </div>
 </div>
<div class="details" style="padding-bottom:30px;">
<p>بلك تجاري حي #القيروان طريق الملك فهد <br />
مساحة البلك ١٢٦٥٠ متر<br />
يحدها غربا طريق القصيم بطول ٢٣٠ متر<br />
شرقا شارع عرض ١٥ متر بطول ٢٣٠ متر<br />
شمالا شارع ١٥ بطول ٥٥ متر<br />
جنوبا شارع ١٥ بطول ٥٥ متر<br />
<br />
🛑 الارض مقام عليها مشروع محلات تجارية<br />
🛑 السوم ٢٦.٥٠٠ ريال للمتر<br />
<br />
وتساب: 0552288243 او 0531190994 أو رقمنا الموحد وتساب 920022109 <br />
<br />
Commercial Block of Lands – Al-Qirawan District, King Fahd Road<br />
<br />
📐 Total Area: 12,650 sqm<br />
	•	West: Al-Qassim Road – 230 m frontage<br />
	•	East: 15m Street – 230 m<br />
	•	North: 15m Street – 55 m<br />
	•	South: 15m Street – 55 m<br />
<br />
🛑 The property consists of a full block of lands designated for commercial use.<br />
🛑 Current Bid Price: 26,500 SAR per sqm (open for higher offers)<br />
<br />
✨ A rare opportunity in #Riyadh booming real estate market – secure your block investment today in one of the fastest-growing cities in the world.<br />
<br />
📲 WhatsApp: 0552288243 | 0531190994 | Toll Free WhatsApp: 920022109</p>
 </div>
<div>
 <div class="row details">
 <div class="col-xs-6 col-sm-6 col-md-4 col-lg-4">
 <b>
 السومة 
 :
 </b> 335,225,000 ر.س
 </div>
</div>
 </div>
<div class="annonce_images">
<div class="clearfix"></div>
 </div>
<div class="sharethis">
 <button type="button" class="btn btn-default" data-toggle="modal" data-target="#contactUs">
 <i class="fa fa-paper-plane" aria-hidden="true"></i> تواصل معنا
 </button>
<button type="button" class="btn btn-default js_share" >
 <i class="fa fa-share-alt" aria-hidden="true"></i> شارك
 </button>
<div class="sharethis_btn">
 <div class="sharethis-inline-share-buttons"></div>
 </div>
 </div>
 </div>
 </div>
<div class="bloc">
 <div class="bloc_content">
 <div class="comments">
<h3>التعليقات:</h3>
<div class="row">
 <div class="col-md-4 col-md-offset-4">
 <div style="margin-bottom: 10px">
 <a href="https://almotmkenah.com/login" class="btn btn-primary btn-block">تسجيل دخول</a>
 </div>
 <div>
 <a href="https://almotmkenah.com/register" class="btn btn-default btn-block">تسجيل حساب جديد</a>
 </div>
 </div>
 </div>
</div>
 </div>
 </div>
<div class="visible-xs">
 </div>
<div class="bloc annonces_related">
 <div class="bloc_content">
 <h3>'''),
    '407': (
        'four raw plots, four different areas, one price field',
        'https://almotmkenah.com/annonce/%D9%81%D8%B1%D8%B5_%D8%B9%D9%82%D8%A7%D8%B1%D9%8A%D8%A9_%D9%81%D9%8A_%D8%B4%D9%85%D8%A7%D9%84_%D8%A7%D9%84%D8%B1%D9%8A%D8%A7%D8%B6_%D8%A3%D8%B1%D8%A7%D8%B6%D9%8A_%D8%AE%D8%A7%D9%85_%D9%85%D9%85%D9%8A%D8%B2%D8%A9_%D8%A8%D9%85%D9%88%D8%A7%D9%82%D8%B9_%D8%A7%D8%B3%D8%AA%D8%B1%D8%A7%D8%AA%D9%8A%D8%AC%D9%8A%D8%A9_:_%D8%AD%D9%8A_%D8%A7%D9%84%D9%86%D8%B1%D8%AC%D8%B3_%D9%88_%D8%A7%D9%84%D8%B9%D8%A7%D8%B1%D8%B6-50',
        r'''<h1>فرص عقارية في شمال الرياض أراضي خام مميزة بمواقع استراتيجية : حي النرجس و العارض</h1>
annonce_header_info">
 <div class="row">
 <div class="col-xs-12 col-sm-6 col-md-4 col-lg-4">
 <i class="fa fa-map-marker" aria-hidden="true"></i> المدينة: الرياض
 </div>
 <div class="col-xs-12 col-sm-6 col-md-4 col-lg-4">
 <i class="fa fa-clock-o" aria-hidden="true"></i> تاريخ الادخال: 8-10-2025
 </div>
<div class="col-xs-12 col-sm-6 col-md-4 col-lg-4">
 <i class="fa fa-clock-o" aria-hidden="true"></i> آخر تحديث: 20-12-2025 19:46
 </div>
<div class="col-xs-12 col-sm-6 col-md-4 col-lg-4">
 <i class="fa fa-eye" aria-hidden="true"></i> المشاهدات: 1571
 </div>
 </div>
 </div>
<div class="details" style="padding-bottom:30px;">
<p>✨ فرص عقارية في شمال الرياض<br />
أراضي خام مميزة بمواقع استراتيجية :<br />
<br />
1️⃣ حي ‫#النرجس‬ – سكني تجاري<br />
📏 المساحة: 96 ألف م²<br />
📍 شارع 60 شمالي<br />
الأطوال: 266×361<br />
<br />
2️⃣ حي ‫#العارض‬ – سكني تجاري<br />
📏 المساحة: 43 ألف م²<br />
📍 شارع شرقي طريق أبو بكر 60<br />
الأطوال: 188×228<br />
<br />
3️⃣ حي ‫#العارض‬ – زاوية سكني تجاري<br />
📏 المساحة: 59 ألف م²<br />
📍 جنوب شارع 60 م<br />
الأطوال: 319×188<br />
4️⃣.. للبيع ارض خام زاويه (سكني تجاري) <br />
*النرجس* المساحه 37 الف متر<br />
الاطوال 218*170<br />
 شارع شرقي 30م<br />
جنوب شارع 60م<br />
<br />
💰البيع على السوم وسمح باذن الله للصامل<br />
 <br />
🔹 العروض مباشرة من وكيل الافراغ الشرعي<br />
<br />
📩 للاستفسار والتفاصيل تواصل معنا عبر الرسائل وتساب <br />
0552288243 او 0531190994 أو رقمنا الموحد 920022109 <br />
فال: 120001701<br />
‫#عقار‬ ‫#مطور_عقاري‬ <br />
<br />
✨ Prime Real Estate Opportunities – North Riyadh ✨<br />
Exceptional raw land plots in strategic, high-demand districts:<br />
<br />
1️⃣ Al Narjis District – Residential & Commercial<br />
📏 Area: 96,000 m²<br />
📍 Location: 60m North-facing main road<br />
Dimensions: 266 × 361 m<br />
<br />
2️⃣ Al A’arid District – Residential & Commercial<br />
📏 Area: 43,000 m²<br />
📍 Location: East side of Abu Bakr Al Siddiq Road (60m)<br />
Dimensions: 188 × 228 m<br />
<br />
3️⃣ Al A’arid District – Corner Plot – Residential & Commercial<br />
📏 Area: 59,000 m²<br />
📍 Location: South of 60m main road<br />
Dimensions: 319 × 188 m<br />
<br />
🔹 Direct offers from the exclusive broker<br />
🏗️ Ideal for development and investment projects in North Riyadh.<br />
📈 Strategic locations with high growth potential.<br />
<br />
📩 For inquiries & further details, contact us:<br />
📞 +966 55 228 8243<br />
📞 +966 53 119 0994<br />
📞 WhatsApp (Unified Number): 920022109<br />
<br />
Almotmkenah Real Estate<br />
Licensed Broker – VAL: 120001701<br />
<br />
#RiyadhRealEstate #SaudiInvestment #Almotmkenah #InvestInRiyadh #SaudiVision2030 #DevelopmentOpportunities #NorthRiyadh #LandInvestment #RealEstate</p>
 </div>
<div>
 <div class="row details">
 <div class="col-xs-6 col-sm-6 col-md-4 col-lg-4">
 <b>
 السعر 
 :
 </b> 2,500 ر.س
 </div>
</div>
 </div>
<div class="annonce_images">
<div class="clearfix"></div>
 </div>
<div class="sharethis">
 <button type="button" class="btn btn-default" data-toggle="modal" data-target="#contactUs">
 <i class="fa fa-paper-plane" aria-hidden="true"></i> تواصل معنا
 </button>
<button type="button" class="btn btn-default js_share" >
 <i class="fa fa-share-alt" aria-hidden="true"></i> شارك
 </button>
<div class="sharethis_btn">
 <div class="sharethis-inline-share-buttons"></div>
 </div>
 </div>
 </div>
 </div>
<div class="bloc">
 <div class="bloc_content">
 <div class="comments">
<h3>التعليقات:</h3>
<div class="row">
 <div class="col-md-4 col-md-offset-4">
 <div style="margin-bottom: 10px">
 <a href="https://almotmkenah.com/login" class="btn btn-primary btn-block">تسجيل دخول</a>
 </div>
 <div>
 <a href="https://almotmkenah.com/register" class="btn btn-default btn-block">تسجيل حساب جديد</a>
 </div>
 </div>
 </div>
</div>
 </div>
 </div>
<div class="visible-xs">
 </div>
<div class="bloc annonces_related">
 <div class="bloc_content">
 <h3>'''),
    '395': (
        '«السعر : 0 ر.س» — an unset field, not a published price',
        'https://almotmkenah.com/annonce/%D8%A7%D8%B1%D8%B6_%D9%84%D9%84%D8%A8%D9%8A%D8%B9_%D9%81%D9%8A_%D8%A7%D9%84%D8%B1%D9%8A%D8%A7%D8%B6_%D8%AD%D9%8A_%D9%86%D9%85%D8%A7%D8%B1-18',
        r'''<h1>ارض للبيع في الرياض حي نمار مساحة 782م</h1>
annonce_header_info">
 <div class="row">
 <div class="col-xs-12 col-sm-6 col-md-4 col-lg-4">
 <i class="fa fa-map-marker" aria-hidden="true"></i> المدينة: الرياض
 </div>
 <div class="col-xs-12 col-sm-6 col-md-4 col-lg-4">
 <i class="fa fa-clock-o" aria-hidden="true"></i> تاريخ الادخال: 14-7-2025
 </div>
<div class="col-xs-12 col-sm-6 col-md-4 col-lg-4">
 <i class="fa fa-clock-o" aria-hidden="true"></i> آخر تحديث: 14-7-2025 14:01
 </div>
<div class="col-xs-12 col-sm-6 col-md-4 col-lg-4">
 <i class="fa fa-eye" aria-hidden="true"></i> المشاهدات: 898
 </div>
 </div>
 </div>
<div class="details" style="padding-bottom:30px;">
<p>للبيع ارض بمخطط نمار<br />
مخطط 3020/د<br />
شارع 15 م شمالي<br />
المساحة 782 م<br />
<br />
🔺حولها مدارس ومسجد واستراحات قائمة <br />
<br />
موقع العقار اضغط الرابط <br />
 <a href="https://maps.app.goo.gl/YjTXDBAfxaab5PmN8?g_st=ic" target="_blank" rel="nofollow">maps.app.goo.gl</a><br />
<br />
العقار ماسيم عالسوم <br />
<br />
مؤسسة المتمكنة للعقارات <br />
وتساب 0552288243 او 0531190994 او 0559882703 <br />
رقمنا الموحد لخدمات مابعد الشراء 920022109 <br />
سجل رقم: 5800107037 <br />
رخصة فال : 1559 1200017017</p>
 </div>
<div>
 <div class="row details">
 <div class="col-xs-6 col-sm-6 col-md-4 col-lg-4">
 <b>
 السعر 
 :
 </b> 0 ر.س
 </div>
</div>
 </div>
<div class="annonce_images">
<a href="https://almotmkenah.com/storage/image/1752501620_annonce_286.png">
 <img src="https://almotmkenah.com/storage/image/1752501620_annonce_286.png" class="img-responsive" />
 </a>
<div class="clearfix"></div>
 </div>
<div class="sharethis">
 <button type="button" class="btn btn-default" data-toggle="modal" data-target="#contactUs">
 <i class="fa fa-paper-plane" aria-hidden="true"></i> تواصل معنا
 </button>
<button type="button" class="btn btn-default js_share" >
 <i class="fa fa-share-alt" aria-hidden="true"></i> شارك
 </button>
<div class="sharethis_btn">
 <div class="sharethis-inline-share-buttons"></div>
 </div>
 </div>
 </div>
 </div>
<div class="bloc">
 <div class="bloc_content">
 <div class="comments">
<h3>التعليقات:</h3>
<div class="row">
 <div class="col-md-4 col-md-offset-4">
 <div style="margin-bottom: 10px">
 <a href="https://almotmkenah.com/login" class="btn btn-primary btn-block">تسجيل دخول</a>
 </div>
 <div>
 <a href="https://almotmkenah.com/register" class="btn btn-default btn-block">تسجيل حساب جديد</a>
 </div>
 </div>
 </div>
</div>
 </div>
 </div>
<div class="visible-xs">
 </div>
<div class="bloc annonces_related">
 <div class="bloc_content">
 <h3>'''),
    '372': (
        '«معرض سيارات دورين جاهز للبيع» — the «دور» substring trap',
        'https://almotmkenah.com/annonce/%D9%85%D8%B9%D8%B1%D8%B6_%D8%B3%D9%8A%D8%A7%D8%B1%D8%A7%D8%AA_%D9%84%D9%84%D8%A8%D9%8A%D8%B9_%D9%81%D9%8A_%D8%A7%D9%84%D8%B1%D9%8A%D8%A7%D8%B6_%D8%AD%D9%8A_%D8%A7%D9%84%D9%82%D8%A7%D8%AF%D8%B3%D9%8A%D8%A9-74',
        r'''<h1>معرض سيارات دورين جاهز للبيع في الرياض/حي القادسية 1200م</h1>
annonce_header_info">
 <div class="row">
 <div class="col-xs-12 col-sm-6 col-md-4 col-lg-4">
 <i class="fa fa-map-marker" aria-hidden="true"></i> المدينة: الرياض
 </div>
 <div class="col-xs-12 col-sm-6 col-md-4 col-lg-4">
 <i class="fa fa-clock-o" aria-hidden="true"></i> تاريخ الادخال: 5-2-2025
 </div>
<div class="col-xs-12 col-sm-6 col-md-4 col-lg-4">
 <i class="fa fa-clock-o" aria-hidden="true"></i> آخر تحديث: 11-5-2025 10:28
 </div>
<div class="col-xs-12 col-sm-6 col-md-4 col-lg-4">
 <i class="fa fa-eye" aria-hidden="true"></i> المشاهدات: 1228
 </div>
 </div>
 </div>
<div class="details" style="padding-bottom:30px;">
<p>معرض سيارات للبيع في الرياض/حي القادسية👌🏻<br />
شارع 30م تجاري<br />
الاطوال 20في60<br />
المساحة 1200م<br />
<br />
🔺المعرض جاهز دورين<br />
🔺مؤجر والدخل 190 الف <br />
🔺العمر 3 سنوات<br />
<br />
البيع 3 مليون و500 الف فقط 💵 <br />
ترخيص اعلاني رقم : 7200485896<br />
موقع العقار اضغط الرابط 👇<br />
 <a href="https://maps.app.goo.gl/Ekps5vshdNEYFjV36?g_st=com.google.maps.preview.copy" target="_blank" rel="nofollow">maps.app.goo.gl</a><br />
<br />
العرض مباشر من المالك 💵<br />
ترخيص اعلاني : 7200485896<br />
<br />
وتساب: 0552288243 او 0531190994 أو رقمنا الموحد وتساب 920022109<br />
______<br />
Exceptional Investment Opportunity in Riyadh!<br />
<br />
Own a Premium Car Showroom in Al Qadisiyah District<br />
<br />
Property Details:<br />
	•	Location: Al Qadisiyah, East Riyadh<br />
	•	Land Area: 1,200 sqm<br />
	•	Street Width: 30 meters (prime commercial road)<br />
	•	Dimensions: 20m × 60m<br />
<br />
Highlights:<br />
	•	Turnkey ready showroom – operational immediately<br />
	•	Stable income: leased for SAR 190,000 annually<br />
	•	3 years old – excellent condition<br />
	•	Direct deal with the owner<br />
<br />
Don’t miss out! Asking Price: SAR 3,500,000 only!<br />
<br />
Ready to expand your investment portfolio?<br />
This is a rare chance to secure a fully-operational property in a fast-growing area of Riyadh.<br />
<br />
Contact Us Today:<br />
	•	WhatsApp: +966 552288243 / +966 531190994<br />
	•	Unified Number: +966 920022109<br />
<br />
License Number: 7200485896</p>
 </div>
<div>
 <div class="row details">
 <div class="col-xs-6 col-sm-6 col-md-4 col-lg-4">
 <b>
 السعر 
 :
 </b> 3,500,000 ر.س
 </div>
</div>
 </div>
<div class="annonce_images">
<div class="col-xs-6 col-sm-4 col-md-4"
 style="min-height:150px;background-image:url('https://almotmkenah.com/storage'); 
 display:none; "
 >
 <a href="https://almotmkenah.com/storage/image/1745072864_annonce_565.mov">
<div class="img_listings_overlay" style="opacity: 0.6;"></div>
<div class="video_icon">
 <i class="fa fa-youtube-play" aria-hidden="true"></i>
 </div>
</a>
 </div>
<div class="clearfix"></div>
 </div>
<div class="sharethis">
 <button type="button" class="btn btn-default" data-toggle="modal" data-target="#contactUs">
 <i class="fa fa-paper-plane" aria-hidden="true"></i> تواصل معنا
 </button>
<button type="button" class="btn btn-default js_share" >
 <i class="fa fa-share-alt" aria-hidden="true"></i> شارك
 </button>
<div class="sharethis_btn">
 <div class="sharethis-inline-share-buttons"></div>
 </div>
 </div>
 </div>
 </div>
<div class="bloc">
 <div class="bloc_content">
 <div class="comments">
<h3>التعليقات:</h3>
<div class="row">
 <div class="col-md-4 col-md-offset-4">
 <div style="margin-bottom: 10px">
 <a href="https://almotmkenah.com/login" class="btn btn-primary btn-block">تسجيل دخول</a>
 </div>
 <div>
 <a href="https://almotmkenah.com/register" class="btn btn-default btn-block">تسجيل حساب جديد</a>
 </div>
 </div>
 </div>
</div>
 </div>
 </div>
<div class="visible-xs">
 </div>
<div class="bloc annonces_related">
 <div class="bloc_content">
 <h3>'''),
    '390': (
        'live four-villa project whose prose says «مباع بالكامل» about part of it',
        'https://almotmkenah.com/annonce/%D9%85%D8%B4%D8%B1%D9%88%D8%B9_%D8%A7%D8%B1%D8%A8%D8%B9_%D9%81%D9%84%D9%84_%D9%85%D8%B3%D8%AA%D9%82%D9%84%D9%87_%D9%84%D9%84%D8%A8%D9%8A%D8%B9_%D9%81%D9%8A_%D8%AD%D9%8A_%D8%A7%D9%84%D8%AC%D9%86%D8%A7%D8%AF%D8%B1%D9%8A%D8%A9-3',
        r'''<h1>مشروع اربع فلل مستقله للبيع في حي الجنادرية</h1>
annonce_header_info">
 <div class="row">
 <div class="col-xs-12 col-sm-6 col-md-4 col-lg-4">
 <i class="fa fa-map-marker" aria-hidden="true"></i> المدينة: الرياض
 </div>
 <div class="col-xs-12 col-sm-6 col-md-4 col-lg-4">
 <i class="fa fa-clock-o" aria-hidden="true"></i> تاريخ الادخال: 11-5-2025
 </div>
<div class="col-xs-12 col-sm-6 col-md-4 col-lg-4">
 <i class="fa fa-eye" aria-hidden="true"></i> المشاهدات: 1075
 </div>
 </div>
 </div>
<div class="details" style="padding-bottom:30px;">
<p>للبيع في حي الجنادرية ⭐️<br />
المشروع:<br />
 • عبارة عن 4 فلل مستقلة.<br />
 • الموقع: حي الجنادرية - بوابة الشرق بمدينة الرياض.<br />
 • كل فلة مبنية على أرض مساحتها 375 متر مربع.<br />
 • الفلل تطل على مرفق عام (مسجد وحديقة)، يعني موقعها مميز وشرح.<br />
 • توجه الفلل: واجهات شرقية.<br />
⸻<br />
نظام البناء في كل فلة:<br />
 • الدور الأرضي (مستقل)<br />
 • الدور الأول (مستقل وتم بيعه بالكامل)<br />
 • شقة مستقلة (فوق الدور الأول)<br />
(يعني كل فلة فيها 3 وحدات سكنية مستقلة: دور أرضي + دور أول + شقة).<br />
⸻<br />
مميزات إضافية:<br />
 • راكب مصعد إيطالي الصنع بضمان 10 سنوات.<br />
 • يوجد تأمين شامل من شركة ملاذ على المشروع.<br />
⸻<br />
تفاصيل المسطحات:<br />
 • مساحة بناء الدور الأرضي: 233 متر.<br />
 • مساحة بناء الشقة: 140 متر.<br />
⸻<br />
الوحدات المتبقية وأسعارها:<br />
 • دور أرضي رقم 4: السعر 890,000 ريال.<br />
 • دور أرضي رقم 1: السعر 830,000 ريال.<br />
 • شقة رقم 2 وشقة رقم 3: السعر لكل شقة 550,000 ريال.<br />
 • شقة رقم 1: السعر 525,000 ريال.<br />
⸻<br />
ملاحظة:<br />
 • الدور الأول في كل الفلل مباع بالكامل.<br />
 • المتبقي حاليًا (دورين أرضيين + 3 شقق).<br />
⸻<br />
وتساب: 0552288243 او 0531190994 أو رقمنا الموحد وتساب 920022109</p>
 </div>
<div>
 <div class="row details">
 <div class="col-xs-6 col-sm-6 col-md-4 col-lg-4">
 <b>
 السعر 
 :
 </b> 890,000 ر.س
 </div>
</div>
 </div>
<div class="annonce_images">
<div class="clearfix"></div>
 </div>
<div class="sharethis">
 <button type="button" class="btn btn-default" data-toggle="modal" data-target="#contactUs">
 <i class="fa fa-paper-plane" aria-hidden="true"></i> تواصل معنا
 </button>
<button type="button" class="btn btn-default js_share" >
 <i class="fa fa-share-alt" aria-hidden="true"></i> شارك
 </button>
<div class="sharethis_btn">
 <div class="sharethis-inline-share-buttons"></div>
 </div>
 </div>
 </div>
 </div>
<div class="bloc">
 <div class="bloc_content">
 <div class="comments">
<h3>التعليقات:</h3>
<div class="row">
 <div class="col-md-4 col-md-offset-4">
 <div style="margin-bottom: 10px">
 <a href="https://almotmkenah.com/login" class="btn btn-primary btn-block">تسجيل دخول</a>
 </div>
 <div>
 <a href="https://almotmkenah.com/register" class="btn btn-default btn-block">تسجيل حساب جديد</a>
 </div>
 </div>
 </div>
</div>
 </div>
 </div>
<div class="visible-xs">
 </div>
<div class="bloc annonces_related">
 <div class="bloc_content">
 <h3>'''),
    '305': (
        'archived rent ad quoting ONE figure for «للايجار السنوي والشهري»',
        'https://almotmkenah.com/annonce/%D8%B4%D9%82%D9%82_%D9%85%D9%81%D8%B1%D9%88%D8%B4%D8%A9_%D9%84%D9%84%D8%A7%D9%8A%D8%AC%D8%A7%D8%B1_%D8%A7%D9%84%D8%B3%D9%86%D9%88%D9%8A_%D9%88%D8%A7%D9%84%D8%B4%D9%87%D8%B1%D9%8A_%D8%AD%D9%8A_%D8%A7%D8%B4%D8%A8%D9%8A%D9%84%D9%8A%D8%A7-58',
        r'''<h1>شقق مفروشة للايجار السنوي والشهري حي اشبيليا</h1>
annonce_header_info">
 <div class="row">
 <div class="col-xs-12 col-sm-6 col-md-4 col-lg-4">
 <i class="fa fa-map-marker" aria-hidden="true"></i> المدينة: الرياض
 </div>
 <div class="col-xs-12 col-sm-6 col-md-4 col-lg-4">
 <i class="fa fa-clock-o" aria-hidden="true"></i> تاريخ الادخال: 8-7-2024
 </div>
<div class="col-xs-12 col-sm-6 col-md-4 col-lg-4">
 <i class="fa fa-clock-o" aria-hidden="true"></i> آخر تحديث: 28-4-2025 16:39
 </div>
<div class="col-xs-12 col-sm-6 col-md-4 col-lg-4">
 <i class="fa fa-eye" aria-hidden="true"></i> المشاهدات: 649
 </div>
 </div>
 </div>
<p class="bg-danger text-danger" style="padding: 20px">هذا الاعلان لم يعد صالح تم نقله للأرشيف.</p>
<div class="details" style="padding-bottom:30px;">
<p>شقق مفروشة للايجار السنوي - الشهري عوائل فقط الرياض حي اشبيليا - اليرموك<br />
عبارة عن <br />
غرفة ودورة مياه <br />
غرفة وصالة ودورة مياه <br />
غرفتين وصالة ودورة مياه <br />
٣ غرفة وصالة وحوش كبير بمدخل سيارة <br />
٤ غرف وصالتين و٤ دورات مياه<br />
<br />
<br />
<br />
الاسعار في الشهر <br />
الغرفة ٣٠٠٠<br />
الغرفة والصالة ٣٥٠٠<br />
الغرفتين والصالة ٥٥٠٠</p>
 </div>
<div>
 <div class="row details">
 <div class="col-xs-6 col-sm-6 col-md-4 col-lg-4">
 <b>
 السعر 
 :
 </b> 5,500 ر.س
 </div>
</div>
 </div>
<div class="annonce_images">
<div class="col-xs-6 col-sm-4 col-md-4"
 style="min-height:150px;background-image:url('https://almotmkenah.com/storage/image/1720473351_annonce_880.jpeg'); 
 "
 >
 <a href="https://almotmkenah.com/storage/image/1720473351_annonce_880.jpeg">
<div class="img_listings_overlay"></div>
</a>
 </div>
 <div class="col-xs-6 col-sm-4 col-md-4"
 style="min-height:150px;background-image:url('https://almotmkenah.com/storage/image/1720473351_annonce_484.jpeg'); 
 "
 >
 <a href="https://almotmkenah.com/storage/image/1720473351_annonce_484.jpeg">
<div class="img_listings_overlay" style="opacity: 0.4;"></div>
 <div class="img_show_all">مشاهدة جميع الصور <i class="fa fa-angle-double-left"
 aria-hidden="true"></i></i></div>
 </a>
 </div>
 <div class="col-xs-6 col-sm-4 col-md-4"
 style="min-height:150px;background-image:url('https://almotmkenah.com/storage/image/1720473352_annonce_716.jpeg'); 
 display:none; "
 >
 <a href="https://almotmkenah.com/storage/image/1720473352_annonce_716.jpeg">
<div class="img_listings_overlay"></div>
</a>
 </div>
 <div class="col-xs-6 col-sm-4 col-md-4"
 style="min-height:150px;background-image:url('https://almotmkenah.com/storage/image/1720473352_annonce_710.jpeg'); 
 display:none; "
 >
 <a href="https://almotmkenah.com/storage/image/1720473352_annonce_710.jpeg">
<div class="img_listings_overlay"></div>
</a>
 </div>
<div class="clearfix"></div>
 </div>
<div class="sharethis">
 <button type="button" class="btn btn-default" data-toggle="modal" data-target="#contactUs">
 <i class="fa fa-paper-plane" aria-hidden="true"></i> تواصل معنا
 </button>
<button type="button" class="btn btn-default js_share" >
 <i class="fa fa-share-alt" aria-hidden="true"></i> شارك
 </button>
<div class="sharethis_btn">
 <div class="sharethis-inline-share-buttons"></div>
 </div>
 </div>
 </div>
 </div>
<div class="bloc">
 <div class="bloc_content">
 <div class="comments">
<h3>التعليقات:</h3>
<div class="row">
 <div class="col-md-4 col-md-offset-4">
 <div style="margin-bottom: 10px">
 <a href="https://almotmkenah.com/login" class="btn btn-primary btn-block">تسجيل دخول</a>
 </div>
 <div>
 <a href="https://almotmkenah.com/register" class="btn btn-default btn-block">تسجيل حساب جديد</a>
 </div>
 </div>
 </div>
</div>
 </div>
 </div>
<div class="visible-xs">
 </div>
<div class="bloc annonces_related">
 <div class="bloc_content">
 <h3>'''),
    '195': (
        'title says «للبيع» while «نوع إستخدام العقار» says «تجاري للايجار» — both, in that order',
        'https://almotmkenah.com/annonce/4_%D8%B4%D8%A7%D9%84%D9%8A%D9%87%D8%A7%D8%AA_%D9%81%D9%8A_%D8%A7%D9%84%D8%B1%D9%8A%D8%A7%D8%B6___%D8%AD%D9%8A_%D8%A7%D9%84%D8%B1%D9%85%D8%A7%D9%84_%D8%A7%D8%AC%D9%85%D8%A7%D9%84%D9%8A_%D8%A7%D9%84%D9%85%D8%B3%D8%A7%D8%AD%D8%A9_1400%D9%85_%D8%A8%D8%B5%D9%83_%D9%88%D8%A7%D8%AD%D8%AF-54',
        r'''<h1>4 شاليهات للبيع في الرياض / حي الرمال اجمالي المساحة 1400م بصك واحد</h1>
annonce_header_info">
 <div class="row">
 <div class="col-xs-12 col-sm-6 col-md-4 col-lg-4">
 <i class="fa fa-map-marker" aria-hidden="true"></i> المدينة: الرياض
 </div>
 <div class="col-xs-12 col-sm-6 col-md-4 col-lg-4">
 <i class="fa fa-clock-o" aria-hidden="true"></i> تاريخ الادخال: 2-9-2022
 </div>
<div class="col-xs-12 col-sm-6 col-md-4 col-lg-4">
 <i class="fa fa-clock-o" aria-hidden="true"></i> آخر تحديث: 28-4-2025 17:15
 </div>
<div class="col-xs-12 col-sm-6 col-md-4 col-lg-4">
 <i class="fa fa-eye" aria-hidden="true"></i> المشاهدات: 3691
 </div>
 </div>
 </div>
<p class="bg-danger text-danger" style="padding: 20px">هذا الاعلان لم يعد صالح تم نقله للأرشيف.</p>
<div class="details" style="padding-bottom:30px;">
<p>4 شاليهات للبيع في الرياض / حي الرمال<br />
اجمالي المساحة 1400م بصك واحد <br />
على شارع 40 م <br />
الاطوال 35 في <br />
كل شاليه مساحته 350 م ويتكون من : <br />
غرف نوم - صالة - مطبخ - مسبح -جلسة خارجية + ثيل -خيمة<br />
40<br />
مؤجره جميعها سنوي ب 135 الف العقد متبقي عليه سنتين بالضبط والدخل يتراوح مابين 240 الى 280<br />
<br />
السوم 3 مليون و780 الف صافي <br />
<br />
موقع العقار اضغط الرابط ??<br />
 <a href="https://goo.gl/maps/qvVzxWroQiPgSrYu8" target="_blank" rel="nofollow">goo.gl</a><br />
وتساب: 0552288243 <br />
او <br />
 0531190994 <br />
أو رقمنا الموحد وتساب 920022109</p>
 </div>
<div>
 <div class="row details">
 <div class="col-xs-6 col-sm-6 col-md-4 col-lg-4">
 <b>
 السعر 
 :
 </b> 4,200,000 ر.س
 </div>
<div class="col-xs-6 col-sm-6 col-md-4 col-lg-4">
 <b>المساحة:</b> 1400 متر مربع
 </div>
<div class="col-xs-6 col-sm-6 col-md-4 col-lg-4">
 <b>إسم المنطقة:</b> الزياض
 </div>
<div class="col-xs-6 col-sm-6 col-md-4 col-lg-4">
 <b>إسم الحي:</b> الرمال
 </div>
<div class="col-xs-6 col-sm-6 col-md-4 col-lg-4">
 <b>نوع إستخدام العقار:</b> تجاري للايجار
 </div>
<div class="col-xs-6 col-sm-6 col-md-4 col-lg-4">
 <b>نوع العقار:</b> تجاري
 </div>
<div class="col-xs-6 col-sm-6 col-md-4 col-lg-4">
 <b>رقم المخطط:</b> 3270
 </div>
<div class="col-xs-6 col-sm-6 col-md-4 col-lg-4">
 <b>عدد الوحدات:</b> 6
 </div>
<div class="col-xs-6 col-sm-6 col-md-4 col-lg-4">
 <b>رقم الدور:</b> 1
 </div>
<div class="col-xs-6 col-sm-6 col-md-4 col-lg-4">
 <b>عدد الغرف:</b> 6
 </div>
<div class="col-xs-6 col-sm-6 col-md-4 col-lg-4">
 <b>نوع الغرف:</b> نوم وصالات وجلسات
 </div>
<div class="col-xs-6 col-sm-6 col-md-4 col-lg-4">
 <b>واجهة العقار:</b> غربيه
 </div>
<div class="col-xs-6 col-sm-6 col-md-4 col-lg-4">
 <b>حدود وأطوال العقار:</b> 35 في 40
 </div>
<div class="col-xs-6 col-sm-6 col-md-4 col-lg-4">
 <b>عرض الشارع:</b> 40
 </div>
<div class="col-xs-6 col-sm-6 col-md-4 col-lg-4">
 <b>تاريخ البناء:</b> 7 سنوات
 </div>
<div class="col-xs-6 col-sm-6 col-md-4 col-lg-4">
 <b>سعر متر البيع:</b> 2700
 </div>
<div class="col-xs-6 col-sm-6 col-md-4 col-lg-4">
 <b>مؤثث:</b> مؤثث ومفروش
 </div>
<div class="col-xs-6 col-sm-6 col-md-4 col-lg-4">
 <b>المطبخ:</b> مركب كامل
 </div>
<div class="col-xs-6 col-sm-6 col-md-4 col-lg-4">
 <b>مرافق:</b> حدائق وخيمه
 </div>
</div>
 </div>
<div class="annonce_images">
<div class="col-sm-8 col-md-8"
 style="min-height:300px;background-image:url('https://almotmkenah.com/storage/image/1662138806_annonce_988.jpeg')"><a
 href="https://almotmkenah.com/storage/image/1662138806_annonce_988.jpeg">
 <div class="img_listings_overlay"></div>
 </a>
 </div>
<div class="col-xs-6 col-sm-4 col-md-4"
 style="min-height:150px;background-image:url('https://almotmkenah.com/storage/image/1662138770_annonce_696.jpeg'); 
 "
 >
 <a href="https://almotmkenah.com/storage/image/1662138770_annonce_696.jpeg">
<div class="img_listings_overlay"></div>
</a>
 </div>
 <div class="col-xs-6 col-sm-4 col-md-4"
 style="min-height:150px;background-image:url('https://almotmkenah.com/storage/image/1662138770_annonce_928.jpeg'); 
 "
 >
 <a href="https://almotmkenah.com/storage/image/1662138770_annonce_928.jpeg">
<div class="img_listings_overlay"></div>
</a>
 </div>
 <div class="col-xs-6 col-sm-4 col-md-4"
 style="min-height:150px;background-image:url('https://almotmkenah.com/storage/image/1662138770_annonce_134.jpeg'); 
 "
 >
 <a href="https://almotmkenah.com/storage/image/1662138770_annonce_134.jpeg">
<div class="img_listings_overlay"></div>
</a>
 </div>
 <div class="col-xs-6 col-sm-4 col-md-4"
 style="min-height:150px;background-image:url('https://almotmkenah.com/storage/image/1662138770_annonce_876.jpeg'); 
 "
 >
 <a href="https://almotmkenah.com/storage/image/1662138770_annonce_876.jpeg">
<div class="img_listings_overlay"></div>
</a>
 </div>
 <div class="col-xs-6 col-sm-4 col-md-4"
 style="min-height:150px;background-image:url('https://almotmkenah.com/storage/image/1662138770_annonce_642.jpeg'); 
 "
 >
 <a href="https://almotmkenah.com/storage/image/1662138770_annonce_642.jpeg">
<div class="img_listings_overlay" style="opacity: 0.4;"></div>
 <div class="img_show_all">مشاهدة جميع الصور <i class="fa fa-angle-double-left"
 aria-hidden="true"></i></i></div>
 </a>
 </div>
 <div class="col-xs-6 col-sm-4 col-md-4"
 style="min-height:150px;background-image:url('https://almotmkenah.com/storage/image/1662138770_annonce_985.jpeg'); 
 display:none; "
 >
 <a href="https://almotmkenah.com/storage/image/1662138770_annonce_985.jpeg">
<div class="img_listings_overlay"></div>
</a>
 </div>
 <div class="col-xs-6 col-sm-4 col-md-4"
 style="min-height:150px;background-image:url('https://almotmkenah.com/storage/image/1662138770_annonce_548.jpeg'); 
 display:none; "
 >
 <a href="https://almotmkenah.com/storage/image/1662138770_annonce_548.jpeg">
<div class="img_listings_overlay"></div>
</a>
 </div>
 <div class="col-xs-6 col-sm-4 col-md-4"
 style="min-height:150px;background-image:url('https://almotmkenah.com/storage/image/1662186786_annonce_953.jpeg'); 
 display:none; "
 >
 <a href="https://almotmkenah.com/storage/image/1662186786_annonce_953.jpeg">
<div class="img_listings_overlay"></div>
</a>
 </div>
 <div class="col-xs-6 col-sm-4 col-md-4"
 style="min-height:150px;background-image:url('https://almotmkenah.com/storage/image/1662186786_annonce_638.jpeg'); 
 display:none; "
 >
 <a href="https://almotmkenah.com/storage/image/1662186786_annonce_638.jpeg">
<div class="img_listings_overlay"></div>
</a>
 </div>
 <div class="col-xs-6 col-sm-4 col-md-4"
 style="min-height:150px;background-image:url('https://almotmkenah.com/storage/image/1662186787_annonce_501.jpeg'); 
 display:none; "
 >
 <a href="https://almotmkenah.com/storage/image/1662186787_annonce_501.jpeg">
<div class="img_listings_overlay"></div>
</a>
 </div>
 <div class="col-xs-6 col-sm-4 col-md-4"
 style="min-height:150px;background-image:url('https://almotmkenah.com/storage/image/1662186787_annonce_487.jpeg'); 
 display:none; "
 >
 <a href="https://almotmkenah.com/storage/image/1662186787_annonce_487.jpeg">
<div class="img_listings_overlay"></div>
</a>
 </div>
 <div class="col-xs-6 col-sm-4 col-md-4"
 style="min-height:150px;background-image:url('https://almotmkenah.com/storage/image/1662186787_annonce_877.jpeg'); 
 display:none; "
 >
 <a href="https://almotmkenah.com/storage/image/1662186787_annonce_877.jpeg">
<div class="img_listings_overlay"></div>
</a>
 </div>
 <div class="col-xs-6 col-sm-4 col-md-4"
 style="min-height:150px;background-image:url('https://almotmkenah.com/storage/image/1662186787_annonce_914.jpeg'); 
 display:none; "
 >
 <a href="https://almotmkenah.com/storage/image/1662186787_annonce_914.jpeg">
<div class="img_listings_overlay"></div>
</a>
 </div>
 <div class="col-xs-6 col-sm-4 col-md-4"
 style="min-height:150px;background-image:url('https://almotmkenah.com/storage/image/1662186787_annonce_310.jpeg'); 
 display:none; "
 >
 <a href="https://almotmkenah.com/storage/image/1662186787_annonce_310.jpeg">
<div class="img_listings_overlay"></div>
</a>
 </div>
 <div class="col-xs-6 col-sm-4 col-md-4"
 style="min-height:150px;background-image:url('https://almotmkenah.com/storage/image/1662186788_annonce_330.jpeg'); 
 display:none; "
 >
 <a href="https://almotmkenah.com/storage/image/1662186788_annonce_330.jpeg">
<div class="img_listings_overlay"></div>
</a>
 </div>
 <div class="col-xs-6 col-sm-4 col-md-4"
 style="min-height:150px;background-image:url('https://almotmkenah.com/storage/image/1662186788_annonce_292.jpeg'); 
 display:none; "
 >
 <a href="https://almotmkenah.com/storage/image/1662186788_annonce_292.jpeg">
<div class="img_listings_overlay"></div>
</a>
 </div>
 <div class="col-xs-6 col-sm-4 col-md-4"
 style="min-height:150px;background-image:url('https://almotmkenah.com/storage/image/1662186788_annonce_298.jpeg'); 
 display:none; "
 >
 <a href="https://almotmkenah.com/storage/image/1662186788_annonce_298.jpeg">
<div class="img_listings_overlay"></div>
</a>
 </div>
 <div class="col-xs-6 col-sm-4 col-md-4"
 style="min-height:150px;background-image:url('https://almotmkenah.com/storage/image/1662186788_annonce_885.jpeg'); 
 display:none; "
 >
 <a href="https://almotmkenah.com/storage/image/1662186788_annonce_885.jpeg">
<div class="img_listings_overlay"></div>
</a>
 </div>
 <div class="col-xs-6 col-sm-4 col-md-4"
 style="min-height:150px;background-image:url('https://almotmkenah.com/storage/image/1662186789_annonce_873.jpeg'); 
 display:none; "
 >
 <a href="https://almotmkenah.com/storage/image/1662186789_annonce_873.jpeg">
<div class="img_listings_overlay"></div>
</a>
 </div>
 <div class="col-xs-6 col-sm-4 col-md-4"
 style="min-height:150px;background-image:url('https://almotmkenah.com/storage/image/1662186789_annonce_238.jpeg'); 
 display:none; "
 >
 <a href="https://almotmkenah.com/storage/image/1662186789_annonce_238.jpeg">
<div class="img_listings_overlay"></div>
</a>
 </div>
 <div class="col-xs-6 col-sm-4 col-md-4"
 style="min-height:150px;background-image:url('https://almotmkenah.com/storage/image/1662186789_annonce_496.jpeg'); 
 display:none; "
 >
 <a href="https://almotmkenah.com/storage/image/1662186789_annonce_496.jpeg">
<div class="img_listings_overlay"></div>
</a>
 </div>
<div class="clearfix"></div>
 </div>
<div class="sharethis">
 <button type="button" class="btn btn-default" data-toggle="modal" data-target="#contactUs">
 <i class="fa fa-paper-plane" aria-hidden="true"></i> تواصل معنا
 </button>
<button type="button" class="btn btn-default js_share" >
 <i class="fa fa-share-alt" aria-hidden="true"></i> شارك
 </button>
<div class="sharethis_btn">
 <div class="sharethis-inline-share-buttons"></div>
 </div>
 </div>
 </div>
 </div>
<div class="bloc">
 <div class="bloc_content">
 <div class="comments">
<h3>التعليقات:</h3>
<div class="row">
 <div class="col-md-4 col-md-offset-4">
 <div style="margin-bottom: 10px">
 <a href="https://almotmkenah.com/login" class="btn btn-primary btn-block">تسجيل دخول</a>
 </div>
 <div>
 <a href="https://almotmkenah.com/register" class="btn btn-default btn-block">تسجيل حساب جديد</a>
 </div>
 </div>
 </div>
</div>
 </div>
 </div>
<div class="visible-xs">
 </div>
<div class="bloc annonces_related">
 <div class="bloc_content">
 <h3>'''),
}


def page(ad_id: str) -> str:
    """The saved page, reassembled exactly as the site serves it: the ad's own block, then the
    neighbours' block, then the contact modal that carries the id."""
    _, _, block = FIXTURES[ad_id]
    return f"{block}\n{RELATED_BLOCK}\n" + CONTACT_MODAL.replace('value="409"', f'value="{ad_id}"')


def mapped(ad_id: str):
    raw = R.parse_detail(page(ad_id))
    assert raw is not None, f"{ad_id}: parse_detail returned nothing"
    raw["listing_url"] = FIXTURES[ad_id][1]
    return raw, R.map_listing(raw)


# ── 1. the archive banner is the retirement oracle, and prose sold-words are NOT ──────────────────

def test_archived_ad_is_skipped_with_a_named_reason():
    """MTM202 carries the site's own «هذا الاعلان لم يعد صالح تم نقله للأرشيف». 339 of the 361 ads
    in the index carry it, so an empty-looking run must say WHY."""
    raw, (row, _cat, why) = mapped("202")
    assert raw["archived"] is True
    assert row is None
    assert why == "archived_at_source"


def test_a_live_ad_saying_part_of_it_is_sold_is_NOT_skipped():
    """MTM390's prose says «الدور الأول في كل الفلل مباع بالكامل» — the first floors of a four-villa
    project are sold and five units remain at 890,000. A «مباع»/«تم بيع» keyword skip would delete a
    live listing ([[feedback_completed-projects-are-real-listings]])."""
    raw, (row, _cat, why) = mapped("390")
    assert "مباع" in raw["description"]
    assert raw["archived"] is False
    assert row is not None, f"a live ad was skipped as {why!r} over prose about part of it"
    assert row["price_total"] == 890_000
    assert row["active"] is True


# ── 2. a per-metre figure never becomes a total ───────────────────────────────────────────────────

def test_per_metre_figure_is_not_stored_as_a_total():
    """MTM202 prints «السعر : 3,690 ر.س» AND «سعر متر البيع : 3690» over 1,247 m². The two agree, so
    the source is showing a RATE in the price slot. The total must stay NULL and the rate must land in
    price_per_meter; multiplying is the search layer's job, never a scraper's
    ([[feedback_ppm-times-area-becomes-a-shown-searchable-total]])."""
    raw = R.parse_detail(page("202"))
    assert raw["fields"]["السعر"] == "3,690 ر.س"        # the trap is in the source, not in the test
    assert raw["fields"]["سعر متر البيع"] == "3690"
    assert raw["fields"]["المساحة"] == "1247 متر مربع"
    total, ppm, note = R._price_from_fields(raw["fields"])
    assert total is None, "a per-metre rate was published as this plot's total price"
    assert ppm == 3690
    assert "سعر متر البيع" in (note or "")
    assert 3690 * 1247 not in (total, ppm), "the scraper did the search layer's multiplication"


def test_a_published_total_and_a_published_rate_both_survive():
    """The rule is a UNIT read, not a size judgement: MTM225 publishes «السعر : 840,000 ر.س» and
    «سعر متر البيع : 2800» on 300 m². They are different numbers, so both are the source's own and
    both are stored — the rate must not overwrite the total."""
    raw = R.parse_detail(page("225"))
    raw["listing_url"] = FIXTURES["225"][1]
    assert R._price_from_fields(raw["fields"]) == (840_000, 2800, None)
    # All six ads that publish سعر متر البيع are archived today, so the banner would skip this one
    # before the row is built. The flag is cleared to reach the row branch; every VALUE below is
    # still the page's own.
    raw["archived"] = False
    row, _cat, why = R.map_listing(raw)
    assert row is not None, why
    assert row["price_total"] == 840_000
    assert row["price_per_meter"] == 2800
    assert row["area_m2"] == 300
    assert row["additional_info"].get("price_is_per_meter") is None


def test_a_large_source_published_total_is_kept_verbatim():
    """The mirror rule cuts BOTH ways ([[feedback_no-hiding-source-published-prices-rule]]). MTM403's
    body quotes a per-metre bid («السوم ٢٦.٥٠٠ ريال للمتر» over «١٢٦٥٠ متر») but the SITE has already
    published the product in its السومة field, and prints it on its own card. 335,225,000 is stored
    as-is — a plausibility gate at the high end is the same regression as one at the low end."""
    _raw, (row, _cat, why) = mapped("403")
    assert row is not None, why
    assert row["price_total"] == 335_225_000
    assert row["price_per_meter"] is None, "the body's rate was invented into a structured column"


def test_a_zero_price_field_becomes_null_not_zero():
    """MTM395's only money field is «السعر : 0 ر.س». 0 is an unset field, not an offer of nothing."""
    _raw, (row, _cat, why) = mapped("395")
    assert row is not None, why
    assert row["price_total"] is None
    assert row["additional_info"]["price_field_raw"] == "0 ر.س"   # the raw field is still recorded
    assert R._money("0 ر.س") is None, "0 reached the row as a price of zero"
    assert R._money("320,000 ر.س") == 320_000


def test_a_neighbours_price_is_never_read_as_this_ads_price():
    """The page continues into «اعلانات مماتلة», where the first neighbour's card shows
    «1,350,000 ر.س». MTM409's own field says 320,000."""
    full = page("409")
    assert "1,350,000 ر.س" in full               # the neighbour's price really is on the page
    assert "1,350,000" not in R._own_block(full), "the ad's own block reaches into the neighbours'"
    _raw, (row, _cat, why) = mapped("409")
    assert row is not None, why
    assert row["price_total"] == 320_000


# ── 3. the deal side ──────────────────────────────────────────────────────────────────────────────

def test_rental_income_prose_in_a_sale_ad_does_not_flip_the_deal():
    """MTM408 is «للبيع عمارة مميزة … 1,430,000» and its prose says «ومؤجرة بالكامل» (fully rented)
    plus «الدخل الحالي: 113,100». Reading that as Rent puts a 1.43m sale price into price_annual and
    shows it as a yearly rent."""
    raw, (row, _cat, why) = mapped("408")
    assert "مؤجرة" in raw["description"]
    assert row is not None, why
    assert row["transaction_type"] == "Buy"
    assert row["price_total"] == 1_430_000
    assert row.get("price_annual") is None
    assert row.get("rent_period") is None
    # Two independent guards, both pinned: the rent pattern must not match income prose at all, AND
    # when both offer words appear the EARLIER one wins (here «للبيع» opens the body).
    assert not R._RENT_RE.search("عمارة مجددة بالكامل ومؤجرة بالكامل بعقود إلكترونية الدخل الحالي")
    # A real both-offers ad: MTM195's title says «للبيع» while its own نوع إستخدام العقار field says
    # «تجاري للايجار». Whichever the source states FIRST wins; a fixed rent-first test is a coin toss.
    title_195, use_195 = FIXTURES["195"][0], None
    raw195 = R.parse_detail(page("195"))
    use_195 = raw195["fields"]["نوع إستخدام العقار"]
    assert "للبيع" in raw195["title"] and "للايجار" in use_195
    assert R._first_deal(f"{raw195['title']}\n{use_195}") == "Buy"
    assert R._first_deal(f"{use_195}\n{raw195['title']}") == "Rent"
    assert title_195


def test_a_sale_stated_only_in_the_body_is_still_a_sale():
    """MTM405's title names no deal at all; the body's «الحد البيع / 1,150,000» is the only signal."""
    _raw, (row, _cat, why) = mapped("405")
    assert row is not None, why
    assert row["transaction_type"] == "Buy"
    assert row["price_total"] == 1_150_000


def test_two_stated_rent_periods_leave_the_period_null():
    """MTM305 is «شقق مفروشة للايجار السنوي والشهري» with ONE figure, 5,500. Taking the first token
    would publish 5,500 as a year's rent — a 12x error on the card. Two periods are no period."""
    raw = R.parse_detail(page("305"))
    raw["listing_url"] = FIXTURES["305"][1]
    assert "السنوي والشهري" in raw["title"]
    raw["archived"] = False                      # exercise the rent branch on the real values
    row, _cat, why = R.map_listing(raw)
    assert row is not None, why
    assert row["transaction_type"] == "Rent"
    assert row["rent_period"] is None
    assert row["price_annual"] == 5_500, "an unstated period was scaled into an annual figure"


def test_a_stated_period_is_mapped_and_never_defaulted():
    """The other half of the same rule: a source that DOES state شهري must be annualised, and one
    that states nothing must not be. Both go through the shared helper, unpatched."""
    assert normalize.rent_period_and_annual(5_000, "الايجار شهري") == ("monthly", 60_000)
    assert normalize.rent_period_and_annual(5_000, "سنوي") == ("annual", 5_000)
    assert normalize.rent_period_and_annual(5_000, "بدون ذكر") == (None, 5_000)


# ── 4. amenities stay tri-state ───────────────────────────────────────────────────────────────────

def test_silence_about_an_amenity_never_becomes_false():
    """MTM409's prose is about plot boundaries and street widths — it names no amenity at all. A
    False would answer «هل يوجد مصعد؟» with a source-backed "no" the source never gave."""
    _raw, (row, _cat, why) = mapped("409")
    assert row is not None, why
    amenity_keys = set(normalize.amenities_from_text("مصعد مسبح مطبخ مؤثث حديقة موقف مجلس"))
    assert amenity_keys, "the shared amenity vocabulary went empty — this test would pass vacuously"
    assert all(row.get(k) is not False for k in amenity_keys), \
        {k: row.get(k) for k in amenity_keys if row.get(k) is False}


def test_the_four_amenity_outcomes_survive_this_scrapers_call_shape():
    """This scraper feeds amenities_from_text the description PLUS the «مؤثث / المطبخ / مرافق» field
    lines. The four outcomes must still hold through that join: named True, negated False,
    prepared-only NULL, the neighbourhood's NULL ([[feedback_amenity-prose-has-four-outcomes]])."""
    assert normalize.amenities_from_text("وراكب مصعد إيطالي").get("elevator") is True
    assert normalize.amenities_from_text("بدون مصعد").get("elevator") is False
    assert normalize.amenities_from_text("مصعد مؤسس").get("elevator") is None
    assert normalize.amenities_from_text("قريب من حديقة عامة").get("garden") is None


def _live(ad_id: str, **fields):
    """The fixture's own page, mapped as a live ad (the archive banner lifted), with grid cells
    optionally overridden to exercise a value the live catalogue can carry."""
    raw = R.parse_detail(page(ad_id))
    raw["listing_url"] = FIXTURES[ad_id][1]
    raw["archived"] = False
    raw["fields"].update(fields)
    row, _cat, why = R.map_listing(raw)
    assert row is not None, why
    return row


def test_a_yes_no_cells_label_is_never_read_as_the_amenity():
    """«مؤثث: لا» used to reach amenities_from_text as the string «مؤثث: لا», whose label word IS the
    token → furnished=True for a flat the source says is NOT furnished. MTM181's own cell, «مؤثث:
    المطابخ راكبه» (the kitchens are fitted), was published as a furnished Building."""
    assert _live("181").get("furnished") is None
    assert _live("181", **{"مؤثث": "لا"})["furnished"] is False
    assert _live("181", **{"مؤثث": "غير مؤثث"})["furnished"] is False
    assert _live("195").get("furnished") is True                    # «مؤثث: مؤثث ومفروش»
    assert _live("181")["kitchen"] is True                          # «المطبخ: مركب»
    assert _live("409", **{"المطبخ": "لا يوجد"})["kitchen"] is False
    # MTM181's body says «ومطبخ راكب»: a cell saying «لا يوجد» contradicts it → NULL, not a pick.
    assert _live("181", **{"المطبخ": "لا يوجد"}).get("kitchen") is None


def test_the_grids_street_width_and_facade_reach_their_columns():
    """#3349 again: «عرض الشارع» / «واجهة العقار» went only to additional_info.source_fields, and the
    AF asks land nothing else. «بويه» (paint) in the facade cell is not a bearing → NULL."""
    row = _live("195")
    assert (row["street_width_m"], row["direction"]) == (40, "غرب")
    row = _live("181")
    assert (row["street_width_m"], row["direction"]) == (25, None)
    row = _live("395")                                               # prose: «شارع 15 م شمالي»
    assert (row["street_width_m"], row["direction"]) == (15, "شمال")


def test_bathrooms_are_one_stated_count_or_nothing():
    """MTM405 says «4 دورات مياة» and then «ماستر بدورة مياة» twice — whether those are among the 4 is
    not stated, so no number. MTM305 lists five unit layouts, each with its own bathrooms."""
    assert _live("405")["bathrooms"] is None
    assert _live("305")["bathrooms"] is None
    assert R._bathrooms("فيلا دورين ٤ غرف و٤ دورات مياه") == 4


def test_the_ads_own_licence_and_villa_age_are_read():
    assert _live("372")["license_number"] == "7200485896"   # «ترخيص اعلاني رقم : 7200485896»
    assert _live("405")["property_age"] == 3                 # «عمر الفيلا 3 سنوات»


# ── 5. the type table ─────────────────────────────────────────────────────────────────────────────

def test_a_land_block_advertising_villas_is_land():
    """MTM404: «راس بلك شمال الرياض منح الخير مساحته 4000م عدد 4 قطع مناسبه 8 فلل». Reading «فلل»
    as the type turns four raw plots into a Villa."""
    _raw, (row, _cat, why) = mapped("404")
    assert row is not None, why
    assert row["property_type"] == "Residential Land"
    assert row["area_m2"] == 4000


def test_a_showroom_with_dorayn_in_its_title_is_not_a_floor():
    """MTM372: «معرض سيارات دورين جاهز للبيع». normalize.map_type()'s substring pass puts «دور»
    ahead of «معرض» and returns Floor for this exact title, which is why the type table here matches
    «دور» last and only as a whole word."""
    _raw, (row, _cat, cat_why) = mapped("372")
    assert normalize.map_type("معرض سيارات دورين جاهز للبيع") == "Floor", \
        "the shared substring pass changed — re-check whether this table still needs to differ"
    assert row is not None, cat_why
    assert row["property_type"] == "Showroom"
    assert normalize.category_for_type("Showroom") == "Commercial"


def test_a_structure_only_mentioned_as_a_neighbour_is_not_the_type():
    """Same distinction amenities_from_text draws for «قريب من حديقة»: what is next door, or standing
    on a plot, is not what is for sale. Both titles are real almotmkenah titles."""
    assert R._type_from_text("ارض للبيع في الرياض / حي الملقا مقام عليها استراحة جنوب شارع سلمان "
                             "مساحة 900م")[0] == "Residential Land"
    assert R._type_from_text("للبيع على كورنيش جدة شقه راقيه بالدور 31 برج الجوهرة "
                             "بجوار فندق")[0] == "Apartment"


def test_dorayn_is_two_floors_not_a_Floor_unit_and_fondoqi_is_not_a_hotel():
    """Two adjectival traps, both real almotmkenah titles. «دورين» («two-storey») is not the type
    Floor, and there is no other type word in that phrase, so it is honestly unmappable rather than
    guessed. «فندقي» describes a hotel-STYLE studio, not a hotel."""
    assert R._type_from_text("للبيع دورين مسلح") == (None, None)
    assert R._type_from_text("للبيع دور علوي في الرياض / العزيزيه بصك مستقل")[0] == "Floor"
    assert R._type_from_text("للبيع شقة استوديو فندقي قرب الحرم المكي")[0] == "Studio"


def test_an_unmappable_type_is_skipped_never_assumed():
    """«محطة للبيع» — a station, with no word saying of what. Two archived ads read like this, and a
    bus stop and a filling station are not the same listing, so they are skipped rather than guessed
    ([[feedback_ambiguous-mapping-ask-first-rule]]). Every value below is MTM310's, as parse_detail
    reads it off the live page (the page itself is 12 KB of plot prose and is not worth inlining)."""
    raw = {
        "ad_id": "310",
        "archived": False,
        "title": "محطة للبيع على طريق حفرالباطن رفحاء مساحة المحطه ٢٥٠٠ متر مربع",
        "city_raw": "غير محدد",
        "description": None,
        "fields": {"السعر": "700,000 ر.س"},
        "photo_urls": [],
        "listing_url": "https://almotmkenah.com/annonce/"
                       "%D9%85%D8%AD%D8%B7%D8%A9_%D9%84%D9%84%D8%A8%D9%8A%D8%B9-36",
    }
    assert R._type_from_text(None, raw["title"], None) == (None, None)
    row, _cat, why = R.map_listing(raw)
    assert row is None and why == "type_unmapped", \
        "an unmappable type was assumed into a real property type"


def test_the_city_fallback_only_rescues_an_unspecified_city_and_only_when_unambiguous():
    """The header city is authoritative; the title is read ONLY when it says «غير محدد». MTM398 is the
    ad that needs it (its title names الخبر), and the body must never be used — «طريق الدمام» appears
    in Riyadh ads constantly, and a title naming two catalog cities is an ambiguity, not a location."""
    assert R._city_from_title("شقه للبيع في ‫الخبر‬ (جديده) حي ‫الشبيلي‬ اطلالة مباشرة على البحر") \
        == "الخبر"
    assert R._city_from_title("للبيع ارض في منح شرق الرياض (مخططات طريق الدمام القديمة)") is None
    # and a STATED city is never second-guessed: MTM409's body talks about طريق الدمام throughout.
    raw, (row, _cat, why) = mapped("409")
    assert "الدمام" in raw["description"] and raw["city_raw"] == "الرياض"
    assert row is not None, why
    assert row["city_ar"] == "الرياض" and row["city_id"] == 1


# ── 6. identity, area and numerals ────────────────────────────────────────────────────────────────

def test_the_slugs_trailing_number_is_not_the_ad_id():
    """Both of these live URLs end in -35 and they are unrelated listings. Keying on the slug's
    trailing number merges them into one row."""
    url_a, url_b = FIXTURES["408"][1], FIXTURES["405"][1]
    assert re.search(r"-35$", url_a) and re.search(r"-35$", url_b)
    assert url_a != url_b
    a, (row_a, _c1, w1) = mapped("408")
    b, (row_b, _c2, w2) = mapped("405")
    assert row_a is not None and row_b is not None, (w1, w2)
    assert row_a["ad_number"] == "MTM408" and row_b["ad_number"] == "MTM405"
    assert row_a["ad_number"] != row_b["ad_number"]


def test_an_area_in_arabic_indic_numerals_is_read():
    """MTM403 publishes its area only as «مساحة البلك ١٢٦٥٠ متر». An int()-based parser reads نothing
    and the plot silently loses its size ([[feedback_arabic-notation-parity-in-deterministic-parsers]])."""
    raw, (row, _cat, why) = mapped("403")
    assert "١٢٦٥٠" in raw["description"]
    assert row is not None, why
    assert row["area_m2"] == 12650


def test_an_ad_offering_four_plots_with_four_areas_stores_none():
    """MTM407 lists «96 ألف», «43 ألف», «59 ألف» and «37 الف» m² under one price field. Any one of
    them on the card is a fabrication, and dropping the «ألف» stores 96 for a 96,000 m² plot."""
    raw, (row, _cat, why) = mapped("407")
    assert row is not None, why
    assert row["area_m2"] is None
    assert row["area_m2"] != 96, "the word numeral «ألف» was dropped instead of read"
    # the scaling itself still works when the ad states ONE area, and so do the other real shapes:
    # a dash between label and figure (MTM393), a noun between them (MTM403), Arabic-Indic digits.
    assert R._area({}, "المساحة: 96 ألف م²") == 96_000
    assert R._area({}, "المساحة -108 م زاوية شارعين") == 108
    assert R._area({}, "مساحة البلك ١٢٦٥٠ متر") == 12_650
    assert R._area({"المساحة": "1247 متر مربع"}, "مساحة البناء 233 متر") == 1247


def test_photos_come_only_from_this_ads_gallery():
    """The page also carries the site's fallback frame (/img/image_default.png — 69 of its own cards
    use it, and those galleries really are empty) and a NEIGHBOUR's real thumbnail
    («…_annonce_841_small.jpeg») as a CSS background-image. Neither may enter photo_urls: one shows a
    stock frame as the property, the other shows someone else's."""
    assert "_annonce_841_small" in RELATED_BLOCK and "image_default" in RELATED_BLOCK
    # The boundary, not just the outcome: the neighbour's real thumbnail is on the page and outside
    # this ad's block. (The href + /storage/image/ constraint is the second, redundant layer — no
    # mutation of that regex alone can reach foreign markup while this holds.)
    assert "_annonce_841_small" not in R._own_block(page("409"))
    for ad in ("403", "408", "390"):
        _raw, (row, _cat, why) = mapped(ad)
        assert row is not None, why
        assert row["photo_urls"] is None, f"{ad} has an empty gallery at source"
    _raw, (row, _cat, _why) = mapped("409")
    assert row["photo_urls"] and all("/storage/image/" in u for u in row["photo_urls"])
    assert not any("image_default" in u or "_small" in u for u in row["photo_urls"])


# ── 7. an auction guard, precautionary on this source ─────────────────────────────────────────────

def test_the_auction_guard_is_wired_to_the_title():
    """No ad on almotmkenah.com says «مزاد» today (0 of 361 titles), so there is no real page to
    feed this. The guard is asserted where it is reachable — the title — rather than left as a
    regex nothing calls ([[feedback_a-comment-is-not-a-code-path]])."""
    assert R._AUCTION_RE.search("مزاد علني لبيع ارض في الرياض")
    assert not R._AUCTION_RE.search(FIXTURES["409"][2])
    raw = R.parse_detail(page("409"))
    raw["listing_url"] = FIXTURES["409"][1]
    raw["title"] = "مزاد علني " + raw["title"]
    assert R.map_listing(raw)[2] == "auction"


# ── 8. the run's own invariants ───────────────────────────────────────────────────────────────────

def test_every_skip_has_a_reason_and_no_row():
    """A skip that returns (None, cat, "") would vanish from the tally and make an empty run silent."""
    for ad in FIXTURES:
        raw = R.parse_detail(page(ad))
        raw["listing_url"] = FIXTURES[ad][1]
        row, cat, why = R.map_listing(raw)
        assert (row is None) == bool(why), (ad, row is None, why)
        assert cat in ("residential", "commercial")


def test_the_prune_oracle_never_kills_an_ad_this_run_did_not_read():
    """prune_unseen may only deactivate on 'gone'. An id absent from this run's status map is
    UNKNOWN, which holds the strike ([[feedback_source-is-truth]]: silent → NULL, never → NO)."""
    R._STATUS.clear()
    assert R._verify_gone("MTM999999")[0] == "unknown"
    R._STATUS["MTM202"] = ("gone", "source banner")
    R._STATUS["MTM409"] = ("live", "parsed with no banner")
    assert R._verify_gone("MTM202")[0] == "gone"
    assert R._verify_gone("MTM409")[0] == "live"
    R._STATUS.clear()


def test_rooms_on_a_non_dwelling_never_become_bedrooms():
    """MTM181 is «عمارة تجارية للبيع بحي العارض» with «عدد الغرف : 36» — the building's room count.
    Writing 36 into bedrooms puts «36 غرف» on a building card and makes it answer a bedroom filter.
    Same lesson as wslnaa's `rooms`."""
    raw = R.parse_detail(page("181"))
    raw["listing_url"] = FIXTURES["181"][1]
    assert raw["fields"]["عدد الغرف"] == "36"
    raw["archived"] = False                      # every rooms-bearing ad on this site is archived
    row, cat, why = R.map_listing(raw)
    assert row is not None, why
    assert row["property_type"] == "Building"
    assert row["bedrooms"] is None, "a building's room count was published as bedrooms"
    assert row["additional_info"]["source_fields"]["عدد الغرف"] == "36"   # kept, just not as bedrooms


def test_impersonate_owns_the_user_agent():
    """A UA header set on top of curl_cffi's impersonation contradicts the TLS fingerprint and reads
    exactly like a block ([[feedback_impersonate_owns_the_user_agent]] — rakez 403'd every endpoint)."""
    assert "user-agent" not in {k.lower() for k in R.session().headers}


def test_the_index_url_is_the_search_route_not_a_category():
    """The eight /category/ pages list only the 22 live ads and do not paginate; /search/ paginates
    all 361. A scraper pointed at a category looks complete and can never see the rest."""
    assert R.INDEX == "https://almotmkenah.com/search/"
    assert "/category/" not in R.INDEX
