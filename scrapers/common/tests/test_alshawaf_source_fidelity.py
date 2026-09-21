"""Barrier for scrapers/alshawaf/run.py — OFFLINE, no network, no database.

Every fixture below is HTML captured VERBATIM from alshawaf.com.sa on 2026-09-20 and fed to the REAL
parse functions (`index_rows`, `parse_index`, `parse_price_cell`, `parse_detail`, `map_listing`) —
never to a copy of them, and never to text this repo invented. The two exceptions are labelled at
their definitions: the auction and sold-deal rows, which the live catalogue does not currently
contain, are one real row with one word changed, because a skip that only runs on data the site does
not publish today still has to work the day it does.

What each test pins, and why it exists (all measured on the live site before the code was written):

  MULTI-LISTING DETAIL PAGE  /22273's page carries the node's own facts (المساحة 395م) AND a related-
    listings table publishing 600 / 252 / 550 and an <img> that belongs to node 21635. Parsing "the
    page" mixes properties. Asserted: area is 395, the neighbour's photo never reaches photo_urls,
    and a node block whose own wa.me link names a different nid is refused outright.
  VIEW COUNTER  the price cell ends «<br><i class=fa-eye> 239</i>» — a bare integer that parses as a
    plausible price. Asserted: 20281 reads 1,850, never 239; «على السوم» reads NO figure, never its
    own view count.
  BASIS  «المتر 1,200» is a RATE (price_per_meter, never price_total). «السوم 1,850» on 487.5 m² is
    also a rate even though the label says otherwise — and the 5,000,000 farm total under the SAME
    label is not touched. Nothing is ever multiplied into a total inside the scraper.
  SILENCE  an amenity the source never mentions produces no column at all; «بدون اصانصير» is False;
    «تم تاسيس مصعد» (prepared, not installed) is neither.
  PERIOD  the site states none, so rent_period is NULL and the figure is stored unconverted.
  LOCATION  a fragment of a compound district name («هجر» out of «ضاحية هجر ،، الحي الثالث») is not a
    district; the owner's number fold matches «الهاشمية 1» to «الهاشمية»; a town the SOURCE names
    beats a town inferred from the catalog.

Run: python -m pytest scrapers/common/tests/test_alshawaf_source_fidelity.py -v
"""
from __future__ import annotations

import ast
import re
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
if str(REPO) not in sys.path:
    sys.path.insert(0, str(REPO))

from scrapers.alshawaf import run as R  # noqa: E402
from scrapers.common import normalize as N  # noqa: E402


# ── VERBATIM SOURCE FIXTURES (alshawaf.com.sa, 2026-09-20) ─────────────────────────────────────
TR_22273 = """<tr>
 <td headers="view-changed-table-column" class="views-field views-field-changed views-align-center"><a href="/22273"><i class="fa fa-external-link-square" aria-hidden="true"></i>
منزل بيت
للبيع</a><br><a href="/22273"><img class="image" src="https://alshawaf.com.sa/logos.png"></a><br>
<div class="changed"><time datetime="2026-09-20T22:55:30+03:00">2026-09-20</time>
</div>
<br>#
22273 </td>
 <td headers="view-field-tags-table-column" class="views-field views-field-field-tags views-align-center">المروج
 </td>
 <td headers="view-nothing-3-table-column" class="views-field views-field-nothing-3 views-align-center">المساحة
395م<br>
شارع
15
<br>
العمر
7 سنوات </td>
 <td headers="view-nothing-1-table-column" class="views-field views-field-nothing-1 views-align-center">
البيع
1,400,000
<br>
<i class="fa fa-eye"> 1</i>
<a href="https://wa.me/?text=https://alshawaf.com.sa/22273%20منزل بيت للبيع في المروج" target="_blank"><i class="fa fa-whatsapp fa-lg" title="مشاركة"></i></a>
 </td>
 </tr>"""

TR_22190 = """<tr>
 <td headers="view-changed-table-column" class="views-field views-field-changed views-align-center"><a href="/22190"><i class="fa fa-external-link-square" aria-hidden="true"></i>
أرض
سكنية
للبيع</a><br><a href="/22190"><img class="image" src="/sites/default/files/2026-09/204%20%D9%87%D8%A7%D8%A1.jpg" width="50"></a><br>
<div class="changed"><time datetime="2026-09-20T21:59:15+03:00">2026-09-20</time>
</div>
<br>#
22190 </td>
 <td headers="view-field-tags-table-column" class="views-field views-field-field-tags views-align-center">شرق الحديقة
<br>
رقم
204
/
هـ
<a href="https://www.google.com/maps/place/25.3084,49.6225" target="_blank"><i class="fa fa-map-marker"></i></a> </td>
 <td headers="view-nothing-3-table-column" class="views-field views-field-nothing-3 views-align-center">المساحة
472.5م<br>
شارع
25
<br>جنوب <br>
الأطوال
21×22.5<br>
 </td>
 <td headers="view-nothing-1-table-column" class="views-field views-field-nothing-1 views-align-center">
المتر
1,200
<br>
<i class="fa fa-eye"> 17</i>
<a href="https://wa.me/?text=https://alshawaf.com.sa/22190%20أرض سكنية للبيع في شرق الحديقة 204 هـ" target="_blank"><i class="fa fa-whatsapp fa-lg" title="مشاركة"></i></a>
 </td>
 </tr>"""

TR_22239 = """<tr>
 <td headers="view-changed-table-column" class="views-field views-field-changed views-align-center"><a href="/22239"><i class="fa fa-external-link-square" aria-hidden="true"></i>
أرض
سكنية
للبيع</a><br><a href="/22239"><img class="image" src="https://alshawaf.com.sa/logos.png"></a><br>
<div class="changed"><time datetime="2026-09-20T15:19:40+03:00">2026-09-20</time>
</div>
<br>#
22239 </td>
 <td headers="view-field-tags-table-column" class="views-field views-field-field-tags views-align-center">ضاحية هجر ،، الحي الثالث
<br>
رقم
94
/
ج
 </td>
 <td headers="view-nothing-3-table-column" class="views-field views-field-nothing-3 views-align-center">المساحة
625م<br>
شارع
20
<br>
 </td>
 <td headers="view-nothing-1-table-column" class="views-field views-field-nothing-1 views-align-center">
على السوم
<br>
<i class="fa fa-eye"> 4</i>
<a href="https://wa.me/?text=https://alshawaf.com.sa/22239%20أرض سكنية للبيع في ضاحية هجر ،، الحي الثالث 94 ج" target="_blank"><i class="fa fa-whatsapp fa-lg" title="مشاركة"></i></a>
 </td>
 </tr>"""

TR_20281 = """<tr>
 <td headers="view-changed-table-column" class="views-field views-field-changed views-align-center"><a href="/20281"><i class="fa fa-external-link-square" aria-hidden="true"></i>
أرض
سكنية
للبيع</a><br><a href="/20281"><img class="image" src="/sites/default/files/2025-05/2025-05-26_213846.png" width="50"></a><br>
<div class="changed"><time datetime="2026-09-13T20:30:24+03:00">2026-09-13</time>
</div>
<br>#
20281 </td>
 <td headers="view-field-tags-table-column" class="views-field views-field-field-tags views-align-center">الجابرية
<br>
رقم
110
<a href="https://www.google.com/maps/place/25.4145,49.6135" target="_blank"><i class="fa fa-map-marker"></i></a> </td>
 <td headers="view-nothing-3-table-column" class="views-field views-field-nothing-3 views-align-center">المساحة
487.5م<br>
شارع
20×15
<br>غرب شمال<br>
الأطوال
20 × 25<br>
 </td>
 <td headers="view-nothing-1-table-column" class="views-field views-field-nothing-1 views-align-center">
السوم
1,850
<br>
<i class="fa fa-eye"> 239</i>
<a href="https://wa.me/?text=https://alshawaf.com.sa/20281%20أرض سكنية للبيع في الجابرية 110" target="_blank"><i class="fa fa-whatsapp fa-lg" title="مشاركة"></i></a>
 </td>
 </tr>"""

TR_22205 = """<tr>
 <td headers="view-changed-table-column" class="views-field views-field-changed views-align-center"><a href="/22205"><i class="fa fa-external-link-square" aria-hidden="true"></i>
أرض
تجارية
للإيجار</a><br><a href="/22205"><img class="image" src="/sites/default/files/2026-09/%D8%A7%D9%84%D8%B5%D9%81%D8%A7%201.jpg" width="50"></a><br>
<div class="changed"><time datetime="2026-09-19T13:18:05+03:00">2026-09-19</time>
</div>
<br>#
22205 </td>
 <td headers="view-field-tags-table-column" class="views-field views-field-field-tags views-align-center">الصفا 1
<br>
رقم
1079
<a href="https://www.google.com/maps/place/25.5108,49.626" target="_blank"><i class="fa fa-map-marker"></i></a> </td>
 <td headers="view-nothing-3-table-column" class="views-field views-field-nothing-3 views-align-center">المساحة
1,779.62م<br>
شارع
60×15
<br>
الأطوال
40.88×28.08<br>
 </td>
 <td headers="view-nothing-1-table-column" class="views-field views-field-nothing-1 views-align-center">
<br>
<i class="fa fa-eye"> 3</i>
<a href="https://wa.me/?text=https://alshawaf.com.sa/22205%20أرض تجارية للإيجار في الصفا 1 1079" target="_blank"><i class="fa fa-whatsapp fa-lg" title="مشاركة"></i></a>
 </td>
 </tr>"""

TR_22266 = """<tr>
 <td headers="view-changed-table-column" class="views-field views-field-changed views-align-center"><a href="/22266"><i class="fa fa-external-link-square" aria-hidden="true"></i>
مزرعة
للبيع</a><br><a href="/22266"><img class="image" src="https://alshawaf.com.sa/logos.png"></a><br>
<div class="changed"><time datetime="2026-09-20T21:05:10+03:00">2026-09-20</time>
</div>
<br>#
22266 </td>
 <td headers="view-field-tags-table-column" class="views-field views-field-field-tags views-align-center">صويدرة
<a href="https://www.google.com/maps/place/25.3746,49.6331" target="_blank"><i class="fa fa-map-marker"></i></a> </td>
 <td headers="view-nothing-3-table-column" class="views-field views-field-nothing-3 views-align-center">المساحة
13,851م<br>
 </td>
 <td headers="view-nothing-1-table-column" class="views-field views-field-nothing-1 views-align-center">
السوم
5,000,000
<br>
<i class="fa fa-eye"> 4</i>
<a href="https://wa.me/?text=https://alshawaf.com.sa/22266%20مزرعة للبيع في صويدرة" target="_blank"><i class="fa fa-whatsapp fa-lg" title="مشاركة"></i></a>
 </td>
 </tr>"""

TR_19813 = """<tr>
 <td headers="view-changed-table-column" class="views-field views-field-changed views-align-center"><a href="/19813"><i class="fa fa-external-link-square" aria-hidden="true"></i>
أرض
زراعية
للبيع</a><br><a href="/19813"><img class="image" src="/sites/default/files/2025-02/58182c1f-bed6-41a5-8f55-d02256c608e8.jpeg" width="50"></a><br>
<div class="changed"><time datetime="2026-03-15T22:04:59+03:00">2026-03-15</time>
</div>
<br>#
19813 </td>
 <td headers="view-field-tags-table-column" class="views-field views-field-field-tags views-align-center">العقير
<br>
رقم
406
 </td>
 <td headers="view-nothing-3-table-column" class="views-field views-field-nothing-3 views-align-center">المساحة
200,000م<br>
شارع
50 × 50
<br>جنوب شرق<br>
الأطوال
500 × 400<br>
 </td>
 <td headers="view-nothing-1-table-column" class="views-field views-field-nothing-1 views-align-center">
المتر
8
<br>
<i class="fa fa-eye"> 116</i>
<a href="https://wa.me/?text=https://alshawaf.com.sa/19813%20أرض زراعية للبيع في العقير 406" target="_blank"><i class="fa fa-whatsapp fa-lg" title="مشاركة"></i></a>
 </td>
 </tr>"""

NODE_22273 = """<div class="views-element-container block" id="block-edux-views-block-duplicate-of-node-block-1">
 <div class="block-content">
 <div><div class="js-view-dom-id-7d6e4b47edfcb74e4785f92a0747ac2d242ed42b7cfe3a311559ba423cecbb70">
 <div class="views-row"><div class="views-field views-field-nothing"><span class="field-content"><div dir="rtl">
<table>
<tr>
<th>التاريخ</th>
<td>
<i class="fa fa-calendar fa-lg"></i>
<time datetime="2026-09-20T22:55:30+03:00" title="Sunday, September 20, 2026 - 22:55">2026-09-20</time>
<i class="fa fa-eye"> 1</i>
<a href="https://wa.me/?text=https://alshawaf.com.sa/22273" target="_blank"><i class="fa fa-whatsapp fa-lg" aria-hidden="true"></i></a>
</td>
</tr>
<tr>
<th>العقار</th>
<td>
منزل بيت
للبيع
</td>
</tr>
<tr>
<th>الحي</th>
<td>
المروج
</td>
</tr>
<tr>
<th>المساحة</th>
<td>
395م
</td>
</tr>
<tr>
<th>شارع عرض</th>
<td>
15م
</td>
</tr>
<tr>
<th>العمر</th>
<td>
7 سنوات
</td>
</tr>
<tr>
<th>وصف العقار</th>
<td>
<p>قريب من قرية الفضول<br>يتكون من :دور ارضي و 3 شقق<br>يقبل البنك&nbsp;<br>*يتكون الدور الارضي من*<br>مجلس رجال دورة مياه<br>غرفة نساء - ثلاث غرف نوم<br>3 دورات مياه - صاله - مطبخ- مطبخ خارجي</p><p>*تتكون الشقق من*<br>غرفتين نوم - صاله - مجلس<br>مطبخ -دورتين مياه<br>الشقق غير جاهزه &nbsp;- تم تمديد الكهرباء والسباكه والتلييص - باقي السراميك - الاصباغ والابواب</p>
</td>
</tr>
<tr>
<th>سعر البيع</th>
<td>
1,400,000
</td>
</tr>
</table>"""

NODE_21905 = """<div class="views-element-container block" id="block-edux-views-block-duplicate-of-node-block-1">
 <div class="block-content">
 <div><div class="js-view-dom-id-2cddb095b8af9b819df815a404d358f28328edff97f3b35209be6b6713126302">
 <div class="views-row"><div class="views-field views-field-nothing"><span class="field-content"><div dir="rtl">
<table>
<tr>
<th>التاريخ</th>
<td>
<i class="fa fa-calendar fa-lg"></i>
<time datetime="2026-09-20T21:56:37+03:00" title="Sunday, September 20, 2026 - 21:56">2026-09-20</time>
<i class="fa fa-eye"> 31</i>
<a href="https://wa.me/?text=https://alshawaf.com.sa/21905" target="_blank"><i class="fa fa-whatsapp fa-lg" aria-hidden="true"></i></a>
</td>
</tr>
<tr>
<th>العقار</th>
<td>
أرض
سكنية
للبيع
</td>
</tr>
<tr>
<th>الحي</th>
<td>
الهاشمية 1
رقم
80
</td>
</tr>
<tr>
<th>المساحة</th>
<td>
430م
</td>
</tr>
<tr>
<th>شارع عرض</th>
<td>
15م
</td>
</tr>
<tr>
<th>الواجهة والإتجاه</th>
<td>
غرب
</td>
</tr>
<tr>
<th>الحدود والأطوال</th>
<td>
20*21.5
</td>
</tr>
<tr>
<th>سعر المتر</th>
<td>
1,600
</td>
</tr>
<tr>
<th>الموقع</th>
<td>
https://www.google.com/maps/place/25.3733,49.6121
</td>
</tr>
</table>"""

NODE_22266 = """<div class="views-element-container block" id="block-edux-views-block-duplicate-of-node-block-1">
 <div class="block-content">
 <div><div class="js-view-dom-id-02a64c13c8780f1ff4aa60f2253ede1f3d540ae0b53608e03ec07543ba2b09d1">
 <div class="views-row"><div class="views-field views-field-nothing"><span class="field-content"><div dir="rtl">
<table>
<tr>
<th>التاريخ</th>
<td>
<i class="fa fa-calendar fa-lg"></i>
<time datetime="2026-09-20T21:05:10+03:00" title="Sunday, September 20, 2026 - 21:05">2026-09-20</time>
<i class="fa fa-eye"> 4</i>
<a href="https://wa.me/?text=https://alshawaf.com.sa/22266" target="_blank"><i class="fa fa-whatsapp fa-lg" aria-hidden="true"></i></a>
</td>
</tr>
<tr>
<th>العقار</th>
<td>
مزرعة
للبيع
</td>
</tr>
<tr>
<th>الحي</th>
<td>
صويدرة
</td>
</tr>
<tr>
<th>المساحة</th>
<td>
13851م
</td>
</tr>
<tr>
<th>وصف العقار</th>
<td>
<p>الموقع - خلف مدارس الشروق طريق الجفر&nbsp;<br>تتكون من :<br>ثمان مستودعات و ملعب كرة ومنتجع ومكاتب ادارية&nbsp;<br>يوجد بها نخيل واشجار&nbsp;<br>يوجد بها كهرب&nbsp;<br>بدون عين&nbsp;<br>المدخول 450.000</p>
</td>
</tr>
<tr>
<th>سعر السوم</th>
<td>
5,000,000
</td>
</tr>
<tr>
<th>الموقع</th>
<td>
https://www.google.com/maps/place/25.3746,49.6331
</td>
</tr>
</table>"""

RELATED_22273 = """<tr>
 <td headers="view-changed-table-column" class="views-field views-field-changed views-align-center"><a href="/19913"><i class="fa fa-external-link-square" aria-hidden="true"></i>
أرض
سكنية
للبيع</a><br><a href="/19913"><img class="image" src="https://alshawaf.com.sa/logos.png"></a><br>
<div class="changed"><time datetime="2026-07-29T19:48:59+03:00">2026-07-29</time>
</div>
<br>#
19913 </td>
 <td headers="view-field-tags-table-column" class="views-field views-field-field-tags views-align-center">المروج
<br>
رقم
359
 </td>
 <td headers="view-nothing-3-table-column" class="views-field views-field-nothing-3 views-align-center">المساحة
600م<br>
شارع
30
<br>شرق<br>
 </td>
 <td headers="view-nothing-1-table-column" class="views-field views-field-nothing-1 views-align-center">
المتر
1,300
<br>
<i class="fa fa-eye"> 52</i>
<a href="https://wa.me/?text=https://alshawaf.com.sa/19913%20أرض سكنية للبيع في المروج 359" target="_blank"><i class="fa fa-whatsapp fa-lg" title="مشاركة"></i></a>
 </td>
 </tr>
<tr>
 <td headers="view-changed-table-column" class="views-field views-field-changed views-align-center"><a href="/21038"><i class="fa fa-external-link-square" aria-hidden="true"></i>
نص أرض
سكنية
للبيع</a><br><a href="/21038"><img class="image" src="https://alshawaf.com.sa/logos.png"></a><br>
<div class="changed"><time datetime="2026-03-29T01:06:56+03:00">2026-03-29</time>
</div>
<br>#
21038 </td>
 <td headers="view-field-tags-table-column" class="views-field views-field-field-tags views-align-center">المروج
<br>
رقم
487
<a href="https://www.google.com/maps/place/25.363,49.6644" target="_blank"><i class="fa fa-map-marker"></i></a> </td>
 <td headers="view-nothing-3-table-column" class="views-field views-field-nothing-3 views-align-center">المساحة
252م<br>
شارع
15
<br>غرب<br>
 </td>
 <td headers="view-nothing-1-table-column" class="views-field views-field-nothing-1 views-align-center">
المتر
1,300
<br>
<i class="fa fa-eye"> 23</i>
<a href="https://wa.me/?text=https://alshawaf.com.sa/21038%20نص أرض سكنية للبيع في المروج 487" target="_blank"><i class="fa fa-whatsapp fa-lg" title="مشاركة"></i></a>
 </td>
 </tr>
<tr>
 <td headers="view-changed-table-column" class="views-field views-field-changed views-align-center"><a href="/21635"><i class="fa fa-external-link-square" aria-hidden="true"></i>
أرض
سكنية
للبيع</a><br><a href="/21635"><img class="image" src="/sites/default/files/2026-03/46%20%D8%A7%D9%84%D9%85%D8%B1%D9%88%D8%AC.jpg" width="50"></a><br>
<div class="changed"><time datetime="2026-03-27T21:25:37+03:00">2026-03-27</time>
</div>
<br>#
21635 </td>
 <td headers="view-field-tags-table-column" class="views-field views-field-field-tags views-align-center">المروج
<br>
رقم
46
<a href="https://www.google.com/maps/place/25.37042,49.667911" target="_blank"><i class="fa fa-map-marker"></i></a> </td>
 <td headers="view-nothing-3-table-column" class="views-field views-field-nothing-3 views-align-center">المساحة
550م<br>
شارع
15
<br>شمال <br>
الأطوال
22×25<br>
 </td>
 <td headers="view-nothing-1-table-column" class="views-field views-field-nothing-1 views-align-center">
المتر
1,550
<br>
<i class="fa fa-eye"> 28</i>
<a href="https://wa.me/?text=https://alshawaf.com.sa/21635%20أرض سكنية للبيع في المروج 46" target="_blank"><i class="fa fa-whatsapp fa-lg" title="مشاركة"></i></a>
 </td>
 </tr>"""

ART_22273 = """<article data-history-node-id="22273" class="node node-view-mode-full">"""

GAL_21905 = """<div class="views-element-container block" id="block-edux-views-block-view-block-1"><header><div dir="rtl"><img class="image" src="https://alshawaf.com.sa/sites/default/files/styles/wide/public/2026-05/%D8%A7%D9%84%D9%87%D8%A7%D8%B4%D9%85%D9%8A%D8%A9%2080.jpg.webp?itok=4ewQjzxA" loading="lazy"><img class="image" src="https://alshawaf.com.sa/sites/default/files/styles/wide/public/2026-05/%D8%B5%D9%83%20%D8%A7%D9%84%D9%87%D8%A7%D8%B4%D9%85%D9%8A%D8%A9%2080.jpg.webp?itok=B3Wg2pi-" loading="lazy"><img class="image" src="https://alshawaf.com.sa/sites/default/files/styles/wide/public/2026-05/%D8%A7%D9%84%D9%87%D8%A7%D8%B4%D9%85%D9%8A%D8%A9%2080.jpg.webp?itok=4ewQjzxA" loading="lazy"><img class="image" src="https://alshawaf.com.sa/sites/default/files/styles/wide/public/2026-05/%D8%B5%D9%83%20%D8%A7%D9%84%D9%87%D8%A7%D8%B4%D9%85%D9%8A%D8%A9%2080.jpg.webp?itok=B3Wg2pi-" loading="lazy"></div></header></div><div class="views-element-container block" id="next">"""


# The catalogue publishes no auction and no closed deal TODAY (all 987 rows scanned: «مزاد», «تم
# البيع», «تم الإيجار», «مباع», «محجوز» appear zero times). These two are TR_22273 with ONE word
# changed, so the skip is exercised on the site's real markup rather than on nothing at all.
TR_AUCTION = TR_22273.replace("منزل بيت", "أرض مزاد")
TR_SOLD = TR_22273.replace("للبيع", "للبيع تم البيع")

PAGE_22273 = ART_22273 + NODE_22273 + '<div class="views-element-container block" id="x"><table><tbody>' + RELATED_22273 + "</tbody></table></div>"
PAGE_21905 = '<article data-history-node-id="21905" class="node">' + GAL_21905 + NODE_21905
PAGE_22266 = '<article data-history-node-id="22266" class="node">' + NODE_22266


# ── the catalog, stubbed: these two functions are the only DB-backed calls in the module ────────
# Values are production's own (src/data/sa-locations.json): الهفوف=12, المبرز=2748, الاحساء=3677,
# all region 5, and «حي هجر» / «حي الأمراء» / «حي الجابرية» are real catalog districts of الهفوف.
CATALOG_DISTRICTS = {
    12: {"هجر": "حي هجر", "امراء": "حي الأمراء", "جابريه": "حي الجابرية",
         "هاشميه": "حي الهاشمية", "مروج": "حي المروج"},
    2748: {"امراء": "حي الأمراء"},
    3677: {},
}
CITIES = {"الهفوف": (12, 5), "المبرز": (2748, 5), "الاحساء": (3677, 5)}


def _fake_to_catalog(city_ar, region_hint=None):
    return CITIES.get((city_ar or "").strip(), (None, None))


def _fake_find_district(text, city_id):
    """Same contract as the real one: 3-, 2-, then 1-word windows, EXACT city-scoped match, and the
    CATALOG's spelling back. Keyed on public.norm_district_tok (migration 20260914204035), which is
    what loc_catalog_district.district_norm is built with."""
    known = CATALOG_DISTRICTS.get(city_id) or {}
    words = re.findall(r"[؀-ۿ]+", text or "")
    for size in (3, 2, 1):
        for i in range(len(words) - size + 1):
            n = R._fold_num(" ".join(words[i:i + size]))
            if n in known:
                return known[n]
    return None


def setup_function(_fn) -> None:
    R.to_catalog = _fake_to_catalog
    R.find_district_in_text = _fake_find_district


def _ix(tr_html: str) -> dict:
    rows = R.index_rows("<tbody>" + tr_html + "</tbody>")
    assert len(rows) == 1, f"expected one index row, got {len(rows)}"
    return R.parse_index(rows[0])


def _row(tr_html: str, page: str = "", nid: str = ""):
    ix = _ix(tr_html)
    detail = R.parse_detail(page, nid or ix["nid"]) if page else {}
    return R.map_listing(ix, detail)


# ══ TRAP 1: one page, more than one listing ═════════════════════════════════════════════════════
def test_detail_reads_only_the_nodes_own_block() -> None:
    d = R.parse_detail(PAGE_22273, "22273")
    assert d, "the node's own block must be readable"
    assert d["fields"]["المساحة"] == "395م", d["fields"]["المساحة"]
    assert d["fields"]["سعر البيع"] == "1,400,000"
    # the related table publishes these; none of them may land in the node's fields
    for foreign in ("600م", "252م", "550م"):
        assert foreign not in d["fields"].values(), f"neighbour's area {foreign} leaked in"


def test_neighbours_photo_never_becomes_this_listings_photo() -> None:
    assert "46%20" in RELATED_22273, "fixture must still contain the neighbour's image"
    row, _cat, why = _row(TR_22273, PAGE_22273)
    assert row is not None, why
    assert not row["photo_urls"], row["photo_urls"]      # 22273's own thumbnail is the office logo


def test_a_block_that_names_another_nid_is_refused() -> None:
    """The wa.me link inside the block is the block's own identity. If it disagrees with the nid we
    asked for, we are holding someone else's facts — return nothing rather than mis-attribute."""
    assert R.parse_detail(PAGE_22273, "21635") == {}


def test_a_node_block_that_belongs_to_another_listing_is_refused() -> None:
    """The <article> id and the block's own wa.me link are two INDEPENDENT identities, and the second
    one is the load-bearing half: if the theme ever renders another node's block under this article,
    or the block regex over-reaches into the related table, the article check alone would hand
    21905's area, district and price back as 22273's. Both real blocks, deliberately mismatched."""
    assert R.parse_detail(ART_22273 + NODE_21905, "22273") == {}
    assert R.parse_detail(ART_22273 + NODE_22273, "22273")["fields"]["المساحة"] == "395م"


def test_a_failed_detail_does_not_erase_photos() -> None:
    """A page we could not read is not the source saying «no photos». photo_urls must be None (the
    key is then dropped by db's unknown-must-not-overwrite-known guard), never []."""
    row, _cat, _why = _row(TR_22239)          # no detail page at all; index thumb is the logo
    assert row["photo_urls"] is None


# ══ TRAP 2: the view counter ════════════════════════════════════════════════════════════════════
def test_view_counter_is_not_the_price() -> None:
    p = _ix(TR_20281)["price"]
    assert (p["label"], p["amount"]) == ("السوم", 1850), p
    assert "239" in TR_20281, "fixture must still carry the view count this test rejects"


def test_an_invitation_to_bid_has_no_figure() -> None:
    p = _ix(TR_22239)["price"]
    assert p["label"] == "على السوم" and p["amount"] is None, p
    row, _cat, why = _row(TR_22239)
    assert row is not None, why
    assert (row["price_total"], row["price_annual"], row["price_per_meter"]) == (None, None, None)


def test_a_price_cell_with_no_label_and_no_figure_prices_nothing() -> None:
    row, _cat, why = _row(TR_22205)           # أرض تجارية للإيجار, price cell empty
    assert row is not None, why
    assert row["transaction_type"] == "Rent"
    assert (row["price_total"], row["price_annual"], row["price_per_meter"]) == (None, None, None)
    assert row["area_m2"] == 1779             # the source's own 1,779.62م


# ══ TRAP 3: basis — a rate is not a total ═══════════════════════════════════════════════════════
def test_per_metre_label_never_fills_price_total() -> None:
    row, _cat, why = _row(TR_22190)
    assert row is not None, why
    assert row["price_per_meter"] == 1200
    assert row["price_total"] is None
    assert row["area_m2"] == 472              # 472.5م — and 1200 * 472 is NEVER written anywhere
    assert row["additional_info"]["price_basis"] == "per_sqm"


def test_a_real_total_under_the_same_label_is_left_alone() -> None:
    """The same «سعر السوم» label on a 13,851 m² farm at 5,000,000 (361 SAR/m²) is a genuine total.
    The guard needs BOTH of the source's numbers to agree before it reclassifies anything."""
    row, _cat, why = _row(TR_22266, PAGE_22266)
    assert row is not None, why
    assert row["price_total"] == 5_000_000
    assert row["price_per_meter"] is None
    assert "area_contradicts" not in (row["additional_info"].get("price_basis_from") or "")


def test_cheap_agricultural_land_keeps_its_real_low_rate() -> None:
    """«المتر 8» on 200,000 m² of أرض زراعية — nid 19813, verbatim. 8 SAR/m² over 20 hectares is a
    REAL rate, and the guard must never be able to touch it: the reclassification lives on the
    total-label branch only, so a per-metre label goes straight to price_per_meter whatever its
    magnitude. An absolute «too small to be a price» floor would have mangled this row."""
    row, _cat, why = _row(TR_19813)
    assert row is not None, why
    assert (row["price_per_meter"], row["price_total"]) == (8, None)
    assert row["area_m2"] == 200_000
    assert row["additional_info"]["price_basis"] == "per_sqm"
    assert "area_contradicts" not in (row["additional_info"].get("price_basis_from") or "")


def test_the_scraper_never_multiplies_a_rate_into_a_total() -> None:
    """scripts/verify-ppm-searchable-and-filter-safe.ts bans deriving a total inside scrapers/ — the
    searchable ppm × area total is the display layer's, and `price_total` here keeps meaning "the
    SOURCE said this". Asserted on the module's own AST: no assignment to a stored price column may
    have a multiplication anywhere in its value. """
    tree = ast.parse(Path(R.__file__).read_text(encoding="utf-8"))
    guarded = {"price_total", "price_annual", "price_per_meter"}
    for node in ast.walk(tree):
        if not isinstance(node, ast.Assign):
            continue
        names = {t.id for t in node.targets if isinstance(t, ast.Name)}
        if not (names & guarded):
            continue
        products = [x for x in ast.walk(node.value)
                    if isinstance(x, ast.BinOp) and isinstance(x.op, ast.Mult)]
        assert not products, f"line {node.lineno}: a stored price is assigned a product"


# ══ TRAP 4: period = source ═════════════════════════════════════════════════════════════════════
def test_rent_period_is_never_invented() -> None:
    """The site states no period anywhere. The figure is stored unconverted and the period stays
    unknown — a manufactured «سنوي» would be a 12× error on the card."""
    ix = _ix(TR_22205)
    ix["price"] = {"label": "سعر الإيجار", "basis": "total", "kind": "asking",
                   "amount": 18000, "raw": "18,000"}     # 22235's own live figure
    row, _cat, _why = R.map_listing(ix, {})
    assert row["price_annual"] == 18000
    assert row["rent_period"] is None
    assert row["additional_info"]["rent_period_stated"] is False


def test_a_stated_period_would_still_be_honoured() -> None:
    """The mechanism is not disabled — it is unused because the source is silent. If the office ever
    writes «سعر الإيجار الشهري», the shared rent_period_and_annual must convert, not default."""
    ix = _ix(TR_22205)
    ix["price"] = {"label": "سعر الإيجار الشهري", "basis": "total", "kind": "asking",
                   "amount": 1500, "raw": "1,500 شهري"}
    row, _cat, _why = R.map_listing(ix, {})
    assert row["rent_period"] == "monthly"
    assert row["price_annual"] == 18000       # 1,500 × 12 — the storage unit conversion, not a guess


# ══ AMENITIES: four outcomes, and silence is not one of them ════════════════════════════════════
def test_silence_never_becomes_false() -> None:
    got = N.amenities_from_text(R._amenity_text("ارض مفروزة قطعتين مساحة كل قطعه 375 م"))
    assert got == {}, got


def test_negated_lift_is_false_in_this_offices_own_spelling() -> None:
    """«بدون اصانصير» — verbatim, SHW21823/SHW21822. «اصانصير» is not in the shared vocabulary, so
    without the alias the source's own NO was silently dropped."""
    got = N.amenities_from_text(R._amenity_text("بجانب مركز اليحيى القديم بدون اصانصير اربع ادوار"))
    assert got["elevator"] is False, got


def test_a_prepared_lift_is_neither_yes_nor_no() -> None:
    """«تم تاسيس مصعد في حال الرغبه في التركيب» (SHW22179) and «مؤسس ل اصانصير» (SHW20788): the shaft
    is prepared, the lift is not there. Reading either as True publishes a fixture the villa lacks."""
    for text in ("ملاحظه / تم تاسيس مصعد في حال الرغبه في التركيب دورات المياه",
                 "ودورتين مياه مؤسس ل اصانصير الفيلا بالكامل"):
        assert "elevator" not in N.amenities_from_text(R._amenity_text(text)), text


def test_the_neighbourhoods_amenity_is_not_this_propertys() -> None:
    got = N.amenities_from_text(R._amenity_text("قريب من قرية الفضول وقريب من حديقة ومواقف"))
    assert "parking" not in got, got


def test_the_stored_description_is_never_the_rewritten_one() -> None:
    row, _cat, why = _row(TR_22273, PAGE_22273)
    assert row is not None, why
    assert "قريب من قرية الفضول" in row["description"]
    assert "اصانصير" not in R._amenity_text("مصعد")     # sanity: the alias only ever adds مصعد


# ══ ROOMS: a building's flats are not its bedrooms ══════════════════════════════════════════════
def test_a_multi_unit_body_does_not_set_bedrooms() -> None:
    """22273 is a house whose own description says «دور ارضي و 3 شقق … ثلاث غرف نوم». That three is
    one floor's layout, not the property's bedroom count (wslnaa's rooms≠bedrooms, restated)."""
    row, _cat, why = _row(TR_22273, PAGE_22273)
    assert row is not None, why
    assert row["bedrooms"] is None
    assert row["bathrooms"] is None


def test_word_numerals_are_read_for_a_single_dwelling() -> None:
    """«خمس غرف نوم وصاله ومطبخ ومجلس وثلاث دورات مياه» — SHW22235, verbatim. Arabic word numerals are
    real numbers; a digits-only parser drops this apartment's whole layout."""
    got = R._rooms("الدور الاول - مدخل مستقل تتكون من : خمس غرف نوم وصاله ومطبخ ومجلس "
                   "وثلاث دورات مياه", "Apartment")
    assert got.get("bedrooms") == 5 and got.get("bathrooms") == 3 and got.get("halls") == 1, got
    assert R._rooms("غرفتين", "Apartment").get("bedrooms") == 2
    assert R._rooms("ثلاث غرف", "Apartment").get("bedrooms") == 3


def test_arabic_indic_digits_are_digits() -> None:
    assert N.to_int("١,٤٠٠,٠٠٠") == 1_400_000
    assert R.parse_price_cell("<td>سعر البيع\n١,٤٠٠,٠٠٠<br><i>٢٣٩</i></td>")["amount"] == 1_400_000
    assert R._floor_number("الدور ٢") == 2


# ══ LOCATION ════════════════════════════════════════════════════════════════════════════════════
def test_a_fragment_of_a_compound_district_is_not_a_district() -> None:
    """«ضاحية هجر ،، الحي الثالث» is the third neighbourhood of the Hajar suburb. The catalog has a
    «حي هجر» and free-text window matching hands it back on the bare word «هجر» — a different place,
    on ~150 of this office's listings."""
    assert R._district("ضاحية هجر ،، الحي الثالث", 12) is None
    row, _cat, why = _row(TR_22239)
    assert row is not None, why
    assert row["district_ar"] is None
    assert row["neighborhood"] == "ضاحية هجر ،، الحي الثالث رقم 94 / ج"   # the card keeps it all


def test_a_whole_term_match_is_accepted_in_the_catalogs_spelling() -> None:
    assert R._district("الجابرية", 12) == "حي الجابرية"
    row, _cat, why = _row(TR_20281)
    assert row is not None, why
    assert row["district_ar"] == "حي الجابرية"       # catalog spelling for matching…
    assert row["neighborhood"] == "الجابرية رقم 110"  # …source text, plot number and all, for the card


def test_the_owners_number_fold_matches_a_numbered_district() -> None:
    """Owner 2026-09-14: our district list never shows a number — «الهاشمية 1» folds onto
    «الهاشمية» for MATCHING and the card keeps the source's own number."""
    assert R._district("الهاشمية 1", 12) == "حي الهاشمية"
    assert R._fold_num("الهاشمية 1") == R._fold_num("حي الهاشمية")


def test_a_town_the_source_names_beats_one_inferred_from_the_catalog() -> None:
    """«الامراء ، المبرز»: the catalog would also place حي الأمراء in الهفوف, but the SOURCE says
    المبرز. Inference fills gaps; it never overrules a source statement."""
    city_ar, city_id, region_id, _d, basis = R._district_and_city("الامراء ، المبرز")
    assert (city_ar, city_id, region_id) == ("المبرز", 2748, 5)
    assert basis == "source_states_town"


def test_an_unplaceable_district_falls_back_to_the_governorate_not_a_town() -> None:
    city_ar, city_id, _r, district_ar, basis = R._district_and_city("منسوب التعليم ، المطاوعة")
    assert (city_ar, city_id, basis) == ("الاحساء", 3677, "governorate_fallback")
    assert district_ar is None                     # 3677 carries no districts — honest NULL


def test_a_south_of_x_qualifier_is_not_a_town() -> None:
    """«جنوب الهفوف» is "south of Hofuf", not a city. to_catalog must refuse it and the row must not
    be filed under الهفوف on the strength of a substring."""
    city_ar, _cid, _r, _d, basis = R._district_and_city("الزهرة ، جنوب الهفوف")
    assert basis != "source_states_town", (city_ar, basis)


def test_two_facades_stay_unknown() -> None:
    """«غرب شمال» (20281, live) is a corner plot on two streets, not a compass point."""
    assert R._direction("غرب شمال") is None
    assert R._direction("شرق") == "شرق"
    assert R._direction("شماليه") == "شمال"        # the ه spelling canon_direction_ar() cannot fold


def test_a_multi_street_width_stays_unknown() -> None:
    assert R._street_width("20×15م")[0] is None    # two streets — no single width
    assert R._street_width("نافذ م")[0] is None    # «نافذ» is not a number
    assert R._street_width("15م")[0] == 15


# ══ SKIPS ═══════════════════════════════════════════════════════════════════════════════════════
def test_an_auction_is_skipped_not_published() -> None:
    row, _cat, why = _row(TR_AUCTION)
    assert row is None and why == "auction", (row, why)


def test_a_closed_deal_is_skipped() -> None:
    row, _cat, why = _row(TR_SOLD)
    assert row is None and why == "closed_deal", (row, why)


def test_an_unmappable_type_is_skipped_with_a_reason() -> None:
    row, _cat, why = _row(TR_22273.replace("منزل بيت", "شيء غريب"))
    assert row is None and why == "type_unmapped", (row, why)


def test_every_type_the_site_publishes_maps() -> None:
    """The site's own «العقار» dropdown, verbatim (19 options). An unmapped type is a silently
    dropped listing, so the whole vocabulary is pinned — «نص أرض» is 162 live rows on its own."""
    for word in ("أرض", "نص أرض", "عمارة", "شقة عوائل", "شقة عزاب", "شقة مكتبية", "منزل بيت",
                 "بيت دور", "بيت دور وشقق", "بيت من شقق", "فيلا", "فيلا وشقق", "دبلكس",
                 "دبلكس فيلا", "دبلكس وشقة", "محل", "مستودع", "مزرعة", "استراحة"):
        assert N.map_type_exact(word, R.TYPE_OVERRIDES), f"unmapped source type «{word}»"


def test_the_tsnyf_refines_a_land_row_from_the_source() -> None:
    t, type_ar, tsnyf = R._property_type(["أرض", "تجارية", "للبيع"])
    assert (t, type_ar, tsnyf) == ("Commercial Land", "أرض", "تجارية")
    assert R._property_type(["أرض", "زراعية", "للبيع"])[0] == "Farm"
    assert R._property_type(["أرض", "سكنية", "للبيع"])[0] == "Residential Land"


def test_deal_is_never_defaulted() -> None:
    assert R._deal("أرض سكنية") is None
    row, _cat, why = _row(TR_22273.replace("للبيع", "سكنية"))
    assert row is None and why == "no_deal", (row, why)


# ══ IDENTITY / PLUMBING ═════════════════════════════════════════════════════════════════════════
def test_ad_number_and_url_are_the_nodes_own() -> None:
    row, _cat, _why = _row(TR_22273, PAGE_22273)
    assert row["ad_number"] == "SHW22273"
    assert row["listing_url"] == "https://alshawaf.com.sa/22273"
    assert row["source"] == "Al Shawaf"


def test_the_source_label_carries_the_platform_slug() -> None:
    """The app's SourceBadge/sourceHost matcher greps source.toLowerCase() and a space-stripped copy
    for 'alshawaf'. A label that misses every branch falls through to Aqar's name and logo."""
    raw = R.SOURCE.lower()
    assert R.PLATFORM in raw + "|" + raw.replace(" ", "")


def test_photos_are_stored_as_originals_not_image_style_derivatives() -> None:
    d = R.parse_detail(PAGE_21905, "21905")
    assert d["photo_urls"], d
    for u in d["photo_urls"]:
        assert "/styles/" not in u and ".webp" not in u and "?itok=" not in u, u
        assert u.startswith("https://alshawaf.com.sa/sites/default/files/"), u
    assert len(d["photo_urls"]) == 2, d["photo_urls"]      # the gallery repeats each file twice


def test_price_evidence_records_what_the_source_published() -> None:
    row, _cat, _why = _row(TR_20281)
    ev = row["price_evidence"]
    assert ev["found"] is True and ev["raw"] == "السوم 1,850"
    assert ev["stored"] == 1850 and ev["unit"] == "total" and ev["origin"] == "structured"


def test_every_price_column_is_absent_or_an_int() -> None:
    for tr, page in ((TR_22273, PAGE_22273), (TR_22190, ""), (TR_22239, ""),
                     (TR_20281, ""), (TR_22205, ""), (TR_22266, PAGE_22266)):
        row, _cat, why = _row(tr, page)
        assert row is not None, why
        for col in ("price_total", "price_annual", "price_per_meter", "area_m2", "bedrooms",
                    "property_age", "street_width_m", "floor_number"):
            assert row[col] is None or isinstance(row[col], int), (row["ad_number"], col, row[col])


def test_a_town_in_another_region_is_not_the_town_the_source_meant(monkeypatch) -> None:
    """«الخرس والشهاب ، اليمامة» — 4 live rows. اليمامة is a Hofuf district; the catalog's only
    CITY of that name is 1062 in Riyadh. Runs the REAL to_catalog over that catalog shape, because
    the real one returns a lone candidate whatever the region hint says (the stub above cannot)."""
    from scrapers.common import arabic_location as AL
    monkeypatch.setattr(AL, "_load", lambda: None)
    monkeypatch.setattr(AL, "_CITY", {AL.norm_ar("اليمامة"): [(1062, 1)],
                                      AL.norm_ar("الاحساء"): [(3677, 5)]})
    monkeypatch.setattr(R, "to_catalog", AL.to_catalog)
    assert AL.to_catalog("اليمامة", region_hint=5) == (1062, 1), "the trap this guards is real"
    _city_ar, city_id, region_id, _d, basis = R._district_and_city("الخرس والشهاب ، اليمامة")
    assert basis != "source_states_town" and city_id != 1062 and region_id == 5


def test_a_total_labelled_figure_is_stored_exactly_as_the_site_shows_it() -> None:
    """20281 «سعر السوم 1,850» on 487.5 m². The page states no unit, so the card shows 1,850 — the
    same number the site shows. Choosing «per metre» by size is the scraper inventing a basis."""
    row, _cat, why = _row(TR_20281)
    assert row is not None, why
    assert row["price_total"] == 1850 and row["price_per_meter"] is None
