"""OFFLINE barrier for scrapers/shatri/run.py — the real functions, fed real shatrirealestate.com payloads.

No network, no database. Every string below is verbatim production output captured from
/wp-json/wp/v2/properties?per_page=100 on 2026-09-24 (X-WP-Total = 74), trimmed to the keys
map_listing() reads (content.rendered cut to its first 700 characters). TERMS are the live taxonomy
maps. to_catalog / city_ar_for / find_district_in_text are the only things patched, because they read
the location catalog out of the database; CATALOG holds what production to_catalog() returned for
those exact strings on 2026-09-24 (incl. the trap that «بجدة» and «الصفا» are themselves catalog
cities, ids 2967 and 14545).

Posts: 22251 (Building, no city term, title names حي السلامة جدة, price 15000000) · 22248 (priced
under-construction roof annex tagged «شقة تمليك») · 22208 (title «… في حي الصفا بجدة» — the
district/city trap) · 22174 (no type term, title leads with «فلل») · 21820 (under construction,
no price) · 18906 (terms map to Apartment AND Building, title decides nothing) · 18501 (label
«تم البيع») · 18101 (features, 6 bedrooms, year 2022).
"""
from __future__ import annotations

import json
import sys
import types
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

from scrapers.shatri import run as R  # noqa: E402

POSTS = {int(k): v for k, v in json.loads(r"""{
 "22251": {
  "id": 22251,
  "status": "publish",
  "link": "https://shatrirealestate.com/property/%d8%b9%d9%85%d8%a7%d8%b1%d8%a9-%d8%ac%d8%a7%d9%87%d8%b2%d8%a9-%d9%84%d9%84%d8%a7%d8%b3%d8%aa%d8%ab%d9%85%d8%a7%d8%b1-%d9%81%d9%8a-%d8%ad%d9%8a-%d8%a7%d9%84%d8%b3%d9%84%d8%a7%d9%85%d8%a9-%d8%ac%d8%af/",
  "modified": "2026-09-10T15:06:32",
  "featured_media": 22253,
  "title": {
   "rendered": "عمارة جاهزة للاستثمار في حي السلامة جدة بعائد يصل إلى 1.5 مليون ريال"
  },
  "content": {
   "rendered": "<p>هل تبحث عن فرصة استثمار عقاري في جدة تجمع بين جاهزية المشروع، والموقع المميز، وتعدد مصادر الدخل؟ تقدم لكم الشاطري العقارية فرصة مميزة لامتلاك مبنى سكني فاخر في حي السلامة بجدة، مجهز بالكامل ليكون مشروعًا مناسبًا للتأجير اليومي والشهري.</p>\n<p>المشروع مصمم ليمنح المستثمر فرصة الاستفادة من الطلب المتزايد على الوحدات السكنية المفروشة، مع إمكانية تحقيق عوائد سنوية تصل إلى 1,500,000 ريال سعودي وفقًا لمعدلات الإشغال والإدارة التشغيلية للمشروع.<br />\n&nbsp;</p>\n<p><strong> لماذا الاستثمار في عمارة جاهزة في جدة؟</strong></p>\n<p>يُعد الاستثمار في العقارات الجاهزة من الخيارات الجذابة للمستثمر الذي يبحث عن أصل عقاري يمكن تشغيله والاستفادة من إيراداته دون الحاجة إلى المرور بمراحل البناء والتجهيز من ا"
  },
  "property_type": [
   88
  ],
  "property_status": [
   47
  ],
  "property_label": [],
  "property_city": [],
  "property_area": [
   91
  ],
  "property_feature": [],
  "property_meta": {
   "fave_property_id": [
    "shatri22251"
   ],
   "fave_property_location": [
    "21.5315055,39.2049242,15"
   ],
   "fave_property_price": [
    "15000000"
   ]
  }
 },
 "22248": {
  "id": 22248,
  "status": "publish",
  "link": "https://shatrirealestate.com/property/%d9%85%d9%84%d8%ad%d9%82-%d8%b1%d9%88%d9%81-%d9%84%d9%84%d8%aa%d9%85%d9%84%d9%8a%d9%83-%d9%a5-%d8%ba%d8%b1%d9%81-%d8%aa%d8%ad%d8%aa-%d8%a7%d9%84%d8%a5%d9%86%d8%b4%d8%a7%d8%a1-%d8%ad%d9%8a-%d8%a7%d9%84/",
  "modified": "2026-08-27T16:16:59",
  "featured_media": 22249,
  "title": {
   "rendered": "ملحق روف للتمليك ٥ غرف تحت الإنشاء حي المنار جدة"
  },
  "content": {
   "rendered": "<p>\nمن حي المنار جدة مشروع ركايز 104 عنوان يُضيف للحياة قيمة، رؤية عمرانية راقية، تتجلّى فيها الفخامة بهدوء، وتتكامل فيها الوظيفة مع الجمال. تصميم معماري عصري بخطوط متزنة، ومساحات مدروسة، وجودة تفاصيل تعكس عناية في الاختيار، واستدامة في التنفيذ ليقدم تجربة متكاملة ترتقي بقيمة المكان وتفاصيله.</p>\n<p>18 وحدة سكنية، موزعة على 4 أدوار بالإضافة إلي دور يحتوى على ملحقين روف. </p>\n<p><strong> ضمانات المشروع:</strong></p>\n<li>ضمان 20 سنة على الهيكل الإنشائي</li>\n<li>ضمان 5 سنوات على الكهرباء</li>\n<li>ضمان 5 سنوات على عزل الأسطح</li>\n<li>ضمان 5 سنوات على السباكة والتمديدات</li>\n<li>ضمان 5 سنوات على مفاتيح الأبواب</li>\n<li>ضمان 5 سنوات على الأفياش</li>\n<li>ضمان 5 سنوات على أطقم الصحة والخلاطات</li>\n<"
  },
  "property_type": [
   90
  ],
  "property_status": [
   58
  ],
  "property_label": [],
  "property_city": [],
  "property_area": [
   49
  ],
  "property_feature": [],
  "property_meta": {
   "fave_property_id": [
    "shatri22248"
   ],
   "fave_property_location": [
    "21.5315055,39.2049242,15"
   ],
   "fave_property_price": [
    "800000"
   ],
   "fave_property_size": [
    "270"
   ],
   "fave_property_bedrooms": [
    "5"
   ],
   "fave_property_rooms": [
    "5"
   ],
   "fave_property_bathrooms": [
    "3"
   ],
   "fave_property_images": [
    "22249",
    "22241",
    "22247",
    "22246",
    "22242"
   ]
  }
 },
 "22208": {
  "id": 22208,
  "status": "publish",
  "link": "https://shatrirealestate.com/property/%d8%aa%d9%85%d9%84%d9%83-%d8%b4%d9%82%d8%a9-%d8%a7%d8%b3%d8%aa%d8%af%d9%8a%d9%88-%d9%85%d9%86-%d8%ba%d8%b1%d9%81%d8%aa%d9%8a%d9%86-%d9%81%d9%8a-%d8%ad%d9%8a-%d8%a7%d9%84%d8%b5%d9%81%d8%a7-%d8%a8%d8%ac/",
  "modified": "2026-06-28T19:01:25",
  "featured_media": 22204,
  "title": {
   "rendered": "تملك شقة استديو من غرفتين في حي الصفا بجدة"
  },
  "content": {
   "rendered": "<p>لطالما صنعنا الفرق من كل ما هو اعتيادي، الآن تجد الفارق في مشروعنا الجديد أكابر إليت، حيث شقق سكنية تجودُ بأفضل المرافق، تتألق بحداثة البناء، وأناقة التشطيبات الراقية، والاستغلال الأمثل للمساحات، لتمنحك أمان العيش بين أسوارها طيلة العمر، وتمنح أطفالك ملاذهم الأكثر أماناً اللعب والتعلم وممارسة الهوايات.</p>\n<p><strong>مكونات المشروع:</strong></p>\n<li> 4 شقق الدور </li>\n<li>مصعد مشترك </li>\n<li>درج ضمن الخدمات المشتركة </li>\n<li>حمامان لكل شقة </li>\n<li>مطبخ داخل كل وحدة </li>\n<p>&nbsp;<br />\n<strong>توزيع الدور </strong><br />\nيتكون الدور من 4 شقق حول مصعد ودرج مركزي.</p>\n<li> شقة على مساحة 75 م² </li>\n<li>شقة على مساحة 72 م² </li>\n<li>شقة على مساحة 87 م² </li>\n<li>شقة على مساحة 84 م² </li"
  },
  "property_type": [
   90,
   96,
   92
  ],
  "property_status": [
   58
  ],
  "property_label": [],
  "property_city": [],
  "property_area": [
   41
  ],
  "property_feature": [],
  "property_meta": {
   "fave_property_price": [
    "450000"
   ],
   "fave_property_size": [
    "75"
   ],
   "fave_property_bedrooms": [
    "2"
   ],
   "fave_property_rooms": [
    "2"
   ],
   "fave_property_bathrooms": [
    "2"
   ],
   "fave_property_id": [
    "shatri22208"
   ],
   "fave_property_location": [
    "21.5315055,39.2049242,15"
   ],
   "fave_property_map_address": [
    "J648+C74 Al-Safa, Jeddah Saudi Arabia"
   ]
  }
 },
 "22174": {
  "id": 22174,
  "status": "publish",
  "link": "https://shatrirealestate.com/property/%d9%81%d9%84%d9%84-%d9%84%d9%84%d8%a8%d9%8a%d8%b9-%d9%81%d9%8a-%d8%a7%d9%84%d8%b1%d9%8a%d8%a7%d8%b6-%d9%85%d8%b4%d8%b1%d9%88%d8%b9-%d8%a3%d8%b1%d9%83%d8%a7%d9%86-%d8%a7%d9%84%d9%85%d9%87/",
  "modified": "2026-05-06T16:01:44",
  "featured_media": 22183,
  "title": {
   "rendered": "فلل للبيع في الرياض – مشروع أركان المها غرب الرياض"
  },
  "content": {
   "rendered": "<p>هنا، في قلب غرب الرياض، وفي أحد أكثر المواقع حيوية وتميزًا، يبرز مشروع أركان المها كوجهة سكنية متكاملة تمنحك أسلوب حياة يرتقي بتفاصيله إلى أعلى مستويات الراحة والرفاهية. صُمم المشروع ليقدم تجربة سكنية استثنائية تجمع بين الموقع المثالي، والتصميم العصري، والمواصفات التي تلبي تطلعاتك وتناسب نمط حياتك.</p>\n<p>أركان المها هو الخيار الأمثل لكل من يبحث عن الخصوصية، ولكل من يسعى لتوفير بيئة سكنية راقية لأسرته، ولكل من يطمح للعيش في مستوى فاخر بجودة لا تضاهى. المشروع عبارة عن فلل سكنية دوبلكس تم تنفيذها بعناية على أرض تتجاوز مساحتها 5600 متر مربع، ويضم عددًا محدودًا من الفلل يصل إلى 20 فيلا فقط، مما يعزز من الهدوء والخصوصية داخل المجتمع السكني.</p>\n<p>تأتي كل فيلا بمساحة 280 متر مربع، بتصميم مدروس"
  },
  "property_type": [],
  "property_status": [],
  "property_label": [],
  "property_city": [
   93
  ],
  "property_area": [],
  "property_feature": [],
  "property_meta": {
   "fave_property_id": [
    "shatri22174"
   ],
   "fave_property_location": [
    "21.5315055,39.2049242,15"
   ],
   "fave_property_price": [
    "1250000"
   ],
   "fave_property_size": [
    "280"
   ],
   "fave_property_bedrooms": [
    "14"
   ],
   "fave_property_bathrooms": [
    "6"
   ]
  }
 },
 "21820": {
  "id": 21820,
  "status": "publish",
  "link": "https://shatrirealestate.com/property/shatritowerproject/",
  "modified": "2026-08-31T16:11:20",
  "featured_media": 21877,
  "title": {
   "rendered": "شقق فندقية برج الشاطري شارع التحلية جدة"
  },
  "content": {
   "rendered": "<p>في خطوة جديدة مميزة في مسيرة شركة الشاطري العقارية،<br />\n نعلن عن طرح أيقونة برج الشاطري العقارية في قلب أحد أفضل أحياء جدة، وهو حي الأندلس وتحديدًا شارع التحلية الذي يعتبر منطقة ساحلية بالقرب من كافة الخدمات، الكافيهات، مراكز التسوق، الخدمة الصحية والدراسية، لذلك مشروعنا مناسب لمين يريد الاستقرار أو حتى الاستثمار فهو مكان جاذب للسياحة، تعرف معنا عن قرب على تفاصيل المشروع.</p>\n<p><strong>مواصفات الشقق برج الشاطري:</strong></p>\n<li>مساحات تبدأ من ٨٥ متر\n<li>غرفتبن</li>\n<li>صالة</li>\n<li>دورتين مياة</li>\n<li>غرفة خادمة  </li>\n<li> صالة </li>\n<p><strong>مميزات المشروع </strong></p>\n<li>موقف سيارة </li>\n<li> خزانات مستقلة</li>\n<li>نوافذ بانورامية عازلة للحرارة والضوضاء</li>\n<li>غاز مركزي </l"
  },
  "property_type": [
   52,
   92
  ],
  "property_status": [
   58
  ],
  "property_label": [
   37
  ],
  "property_city": [
   46
  ],
  "property_area": [
   123
  ],
  "property_feature": [
   76,
   81,
   75,
   82,
   80
  ],
  "property_meta": {
   "fave_property_id": [
    "shatri21820"
   ],
   "fave_property_location": [
    "21.554548145437,39.17020457417,17"
   ],
   "fave_property_bedrooms": [
    "3"
   ],
   "fave_property_rooms": [
    "3"
   ],
   "fave_property_bathrooms": [
    "2"
   ],
   "fave_property_size": [
    "90"
   ],
   "fave_property_map_address": [
    "No results found"
   ],
   "fave_property_images": [
    "21877",
    "21879",
    "21880",
    "21878",
    "21881",
    "21882",
    "21883"
   ]
  }
 },
 "18906": {
  "id": 18906,
  "status": "publish",
  "link": "https://shatrirealestate.com/property/%d8%a7%d8%b3%d8%aa%d8%ab%d9%85%d8%a7%d8%b1-%d8%b9%d9%82%d8%a7%d8%b1%d9%8a-%d8%a8%d8%ac%d8%af%d8%a9/",
  "modified": "2025-04-29T08:29:48",
  "featured_media": 21570,
  "title": {
   "rendered": "استثمار عقاري بجدة"
  },
  "content": {
   "rendered": "<p>حتى يحصل الاستثمار العقاري على النجاح المطلوب، يمر بالعديد من الخطوات مثل دراسة حركة السوق، المنطقة التي سيتم البناء فيها، تكاليف الخامات، العاملة، والتشغيل وغيرها من البنود التي يجب دراستها.</p>\n<p>&nbsp;</p>\n<p>لذلك في<a href=\"https://shatrirealestate.com/\" target=\"_blank\" rel=\"noopener\"> الشاطري</a> قطعنا لك الشوط الأكثر أهمية من الدراسة حتى البناء، وأخرجنا لك منتج عقاري مميز بتشطيب فندقي وفي موقع استراتيجي وحيوي. تابع معنا مواصفات أحد أفضل مشاريع الشاطري العقارية المميزة في حي المروة بجدة.</p>\n<p>&nbsp;</p>\n<h2>مواصفات مشروع الشاطري:</h2>\n<p>المشروع مكون من ٦ عمائر، العمارة الواحدة على مساحة ٧٠٠ متر مربع.</p>\n<ul>\n<li><strong>مجموع الشقق:</strong> ٤٨ شقة + ١٢ فيلا روف</li>\n<li><strong"
  },
  "property_type": [
   52,
   92,
   88
  ],
  "property_status": [
   47
  ],
  "property_label": [
   37,
   39
  ],
  "property_city": [],
  "property_area": [
   40
  ],
  "property_feature": [],
  "property_meta": {
   "fave_property_id": [
    "shatri18906"
   ],
   "fave_property_location": [
    "21.5315055,39.2049242,15"
   ]
  }
 },
 "18501": {
  "id": 18501,
  "status": "publish",
  "link": "https://shatrirealestate.com/property/3room-akaber-alsafa-project/",
  "modified": "2024-09-05T16:03:01",
  "featured_media": 20319,
  "title": {
   "rendered": "شقق تمليك 3 غرف حي الصفا جدة"
  },
  "content": {
   "rendered": "<div class=\"listingView_descriptionCard__9FElV Card-module_card__TCPyF\">\n<h2 class=\"listingView_description__N7Hio\">للبيع شقق فاخرة بجدة</h2>\n<h2 class=\"listingView_description__N7Hio\">للتمليك والاستثمار</h2>\n<p><strong>مشروع اكابر الصفا بجدة</strong></p>\n<div class=\"listingView_description__N7Hio\"><strong>مكونة من</strong></div>\n<div class=\"listingView_description__N7Hio\">3غرف و3 دورات مياة وصالة ومطبخ مساحة 115 متر</div>\n<div class=\"listingView_description__N7Hio\">حي الصفا موقع مميز جدا علي شارعين <strong>بسعر 390 الف كاش فقط</strong></div>\n<h2><strong>المواصفات والمميزات</strong></h2>\n<div>حي الصفاء بموقع مميز جدا</div>\n<div>تاسيس منزل ذكي</div>\n<div>مدخلين لكل شقة</div>\n<div>موقف خاص لكل"
  },
  "property_type": [
   52,
   92
  ],
  "property_status": [
   58
  ],
  "property_label": [
   73
  ],
  "property_city": [
   46
  ],
  "property_area": [
   41
  ],
  "property_feature": [
   77,
   76,
   45,
   81,
   51,
   79,
   80,
   78
  ],
  "property_meta": {
   "fave_property_price": [
    "390000"
   ],
   "fave_property_size": [
    "115"
   ],
   "fave_property_bedrooms": [
    "3"
   ],
   "fave_property_bathrooms": [
    "3"
   ],
   "fave_property_garage": [
    "1"
   ],
   "fave_property_year": [
    "2024"
   ],
   "fave_property_id": [
    "shatri18501"
   ],
   "fave_property_map_address": [
    "الصفا، جدة السعودية"
   ],
   "fave_property_address": [
    "الصفا، جدة السعودية"
   ],
   "fave_property_location": [
    "21.595541676445,39.198125957333,14"
   ],
   "fave_property_images": [
    "18494",
    "18497",
    "18498",
    "18499",
    "18500"
   ]
  }
 },
 "18101": {
  "id": 18101,
  "status": "publish",
  "link": "https://shatrirealestate.com/property/%d8%b4%d9%82%d9%82-%d8%a8%d8%a7%d9%86%d9%88%d8%b1%d8%a7%d9%85%d9%8a%d8%a9-6-%d8%ba%d8%b1%d9%81-%d8%ad%d9%8a-%d8%a7%d9%84%d9%85%d8%b1%d9%88%d8%a9-%d9%82%d9%8a%d8%af-%d8%a7%d9%84%d8%aa%d8%b4%d8%b7/",
  "modified": "2025-04-28T21:33:07",
  "featured_media": 21542,
  "title": {
   "rendered": "شقق بانورامية 6 غرف حي المروة افراغ فوري"
  },
  "content": {
   "rendered": "<p>اغتنم الفرصة واحجز بمشروعنا الجديد البيلسان 155 / 160 بحي المروة (درة المروة)</p>\n<p>مساحة الشقق 218م نظام شقتين في الدور كل شقة متكونة من :-</p>\n<p>6 غرف=3 غرف نوم و 2 مجلس,صالة وغرفة خادمة وغسيل.</p>\n<p>موقف خاص , غرفة سائق , خزان مستقل وعداد مياه مستقل</p>\n<p>نقدم ضمانات على التشطيب مع خدمة الصيانة</p>\n"
  },
  "property_type": [
   52,
   87,
   92,
   86
  ],
  "property_status": [
   58
  ],
  "property_label": [
   56
  ],
  "property_city": [
   46
  ],
  "property_area": [
   40
  ],
  "property_feature": [
   45,
   51,
   54,
   59
  ],
  "property_meta": {
   "fave_property_price": [
    "900000"
   ],
   "fave_property_size": [
    "218"
   ],
   "fave_property_bedrooms": [
    "3"
   ],
   "fave_property_bathrooms": [
    "4"
   ],
   "fave_property_garage": [
    "1"
   ],
   "fave_property_year": [
    "2022"
   ],
   "fave_property_id": [
    "shatri18101"
   ],
   "fave_property_map_address": [
    "حي المروة, جدة السعودية"
   ],
   "fave_property_address": [
    "حي المروة, جدة السعودية"
   ],
   "fave_property_location": [
    "21.6253394,39.2049343,14"
   ],
   "fave_property_images": [
    "18097"
   ]
  }
 }
}""").items()}
TERMS = {tax: {int(k): v for k, v in d.items()} for tax, d in json.loads(r"""{"property_type": {"52": "شقة تمليك", "90": "شقق تحت الانشاء جدة", "87": "شقق تمليك البيلسان جدة", "100": "شقق تمليك المدينة المنورة", "96": "شقق تمليك حي الصفا", "92": "شقق تمليك للبيع جدة", "86": "عقارات وشقق تمليك في حي المروة بجدة", "88": "عمائر للبيع", "55": "فيلا سكنية", "125": "محلات", "126": "محلات للبيع", "64": "ملحق سكني"}, "property_status": {"38": "اعادة بيع", "47": "جاهز للبيع", "58": "قيد الانشاء"}, "property_city": {"93": "الرياض", "99": "المدينة المنورة", "46": "جــدة"}, "property_area": {"123": "الاندلس", "95": "البدر", "89": "الرحاب", "97": "الروضة", "91": "السلامة", "41": "الصفا", "74": "الفيصلية", "40": "المروة", "49": "المنار", "124": "بريمان"}, "property_feature": {"77": "بالقرب من حديقه", "44": "بيت شعر", "76": "تاسيس بيت ذكي", "45": "توصيلات مكييف", "81": "خزان مستقل علوي وسفلي", "50": "ساونا جاكوزي", "51": "شبابيك عاكسة", "75": "غرفة خادمة", "54": "غرفة غسيل", "59": "كابلات تلفزيون", "82": "كاميرات مراقبة", "79": "مدخلين لكل شقة", "60": "مسبح", "63": "مكان شواء", "80": "موقف خاص", "78": "مياة وصرف عام"}, "property_label": {"37": "استثمار عقاري", "39": "افراغ فوري", "73": "تم البيع", "53": "عرض الموسم", "56": "قابل للتفاوض", "61": "مستخدم"}, "property_country": {"42": "المملكة العربيه السعوديه"}}""").items()}
MEDIA = {22253: "https://shatrirealestate.com/wp-content/uploads/2026/09/WhatsApp-Image-1447-11-18-at-19.51.34-1.jpeg"}
CATALOG = {"جــدة": (18, 2), "جدة": (18, 2), "بجدة": (2967, 7), "الصفا": (14545, 6), "الرياض": (3, 1),
           "المدينة المنورة": (14, 3)}
CITY_AR = {18: "جدة", 2967: "بجدة", 14545: "الصفا", 3: "الرياض", 14: "المدينة المنورة"}
DISTRICTS = {("الصفا", 18): "حي الصفا", ("حي الصفا", 18): "حي الصفا", ("السلامة", 18): "حي السلامة",
             ("حي السلامة جدة", 18): "حي السلامة", ("المنار", 18): "حي المنار", ("المروة", 18): "حي المروة"}


@pytest.fixture(autouse=True)
def _catalog(monkeypatch):
    monkeypatch.setattr(R, "to_catalog", lambda s, hint=None: CATALOG.get((s or "").strip(), (None, None)))
    monkeypatch.setattr(R, "city_ar_for", lambda cid: CITY_AR.get(cid))
    monkeypatch.setattr(R, "find_district_in_text", lambda text, cid: DISTRICTS.get(((text or "").strip(), cid)))


def _map(pid, **over):
    post = json.loads(json.dumps(POSTS[pid]))
    for k, v in over.items():
        if k.startswith("meta_"):
            post["property_meta"][k[5:]] = [v]
        elif k == "title":
            post["title"]["rendered"] = v
        elif k == "content":
            post["content"]["rendered"] = v
        else:
            post[k] = v
    return R.map_listing(post, TERMS, MEDIA, this_year=2026)


# ── PRICE = SOURCE ────────────────────────────────────────────────────────────────────────────────

def test_a_word_numeral_price_is_never_published_as_500():
    """«مليون و500 الف» is a live fave_property_price (18361). normalize.to_int reads it as 500;
    publishing that answers an "under 50k" filter with a 1.5M flat."""
    assert R.parse_price("مليون و500 الف") is None
    assert R.parse_price("750,000 ريـال") == 750000
    assert R.parse_price("1,500,000 ريال") == 1500000
    assert R.parse_price("15000000") == 15000000
    assert R.parse_price("750000.50") == 750000, "shared 1-2-decimal rule — a '.'-strip stored 75000050"
    assert R.parse_price("٧٥٠٬٠٠٠ ريال") == 750000 and R.parse_price("0") is None
    row, _, why = _map(22251, meta_fave_property_price="مليون و500 الف")
    assert why == "" and row["price_total"] is None
    assert row["additional_info"]["price_unparsed"] == "مليون و500 الف"


def test_a_building_keeps_its_stated_total_and_no_bedrooms():
    row, cat, why = _map(22251)
    assert why == "" and row["property_type"] == "Building" and row["price_total"] == 15000000
    assert row["bedrooms"] is None and row["bathrooms"] is None
    # a Building WITH fave_property_bedrooms (the project ads carry 14): dwelling-only columns stay
    # NULL and the source figure survives in additional_info
    row, _, _ = _map(22251, meta_fave_property_bedrooms="14", meta_fave_property_bathrooms="6")
    assert row["bedrooms"] is None and row["bathrooms"] is None
    assert row["additional_info"]["bedrooms_raw"] == 14 and row["additional_info"]["bathrooms_raw"] == 6


def test_parking_silence_is_null_never_false():
    """22251: no fave_property_garage, no «موقف خاص» term, no «موقف» in its prose."""
    row, _, why = _map(22251)
    assert why == "" and "parking" not in row
    row, _, _ = _map(22251, meta_fave_property_garage="0")
    assert "parking" not in row, "garage 0 is WP's not-set, not a negation"
    row, _, _ = _map(22251, meta_fave_property_garage="2")
    assert row["parking"] is True
    assert row["transaction_type"] == "Buy" and "price_annual" not in row


# ── refusals, each one tallied ────────────────────────────────────────────────────────────────────

def test_sold_label_is_skipped_and_counted():
    row, _, why = _map(18501)
    assert row is None and why == "sold"


def test_under_construction_without_a_price_is_skipped_but_a_priced_unit_is_kept():
    row, _, why = _map(21820)
    assert row is None and why == "off_plan_unpriced"
    row, _, why = _map(22248)
    assert why == "" and row["price_total"] == 800000 and row["additional_info"]["status_ar"] == "قيد الانشاء"
    assert row["property_type"] == "Apartment", "the source's own «شقة تمليك» tag names the unit"


def test_terms_mapping_to_two_types_are_skipped_unless_the_title_decides():
    row, _, why = _map(18906)
    assert row is None and why.startswith("type_ambiguous"), why
    row, _, why = _map(18906, title="عمارة للبيع بحي المروة جدة")
    assert why == "" and row["property_type"] == "Building"


def test_a_post_with_no_type_term_takes_its_titles_leading_noun_only():
    row, _, why = _map(22174)
    assert why == "" and row["property_type"] == "Villa"
    row, _, why = _map(22174, title="استثمار عقاري بجدة")
    assert row is None and why == "type_unmapped[none]"


# ── CITY: never guessed, never a district ─────────────────────────────────────────────────────────

def test_a_district_phrase_is_not_a_city_candidate():
    """22208: «تملك شقة استديو من غرفتين في حي الصفا بجدة» — الصفا is a catalog CITY (14545). Scanning
    the title in order published the flat in the town of الصفا, 800 km from Jeddah."""
    row, _, why = _map(22208)
    assert why == "" and row["city_id"] == 18 and row["city_ar"] == "جدة"
    assert row["district_ar"] == "حي الصفا"


def test_the_stripped_prefix_is_tried_before_the_prefixed_word():
    """«بجدة» is ITSELF a catalog village (2967, region 7)."""
    assert R.resolve_city(None, ["عمارة للبيع بجدة"]) == (18, 2, "جدة")
    row, _, why = _map(22251)
    assert why == "" and row["city_id"] == 18 and row["district_ar"] == "حي السلامة"


def test_an_unplaceable_city_is_skipped_not_defaulted():
    row, _, why = _map(22251, title="عمارة جاهزة للاستثمار", meta_fave_property_address="", meta_fave_property_map_address="")
    assert row is None and why == "city_not_in_catalog"


def test_the_title_contributes_only_its_own_district_phrase(monkeypatch):
    """«مشروع الراية» matched the Riyadh district «حي الراية» when the whole title was scanned."""
    seen = []
    monkeypatch.setattr(R, "find_district_in_text", lambda t, c: seen.append(t) or None)
    _map(22174, title="فلل للبيع في الرياض – مشروع الراية بحي النرجس")
    assert seen and all("مشروع" not in t for t in seen) and any("حي النرجس" in t for t in seen)


# ── Advanced-Filter facts in real columns ─────────────────────────────────────────────────────────

def test_structured_facts_land_in_columns():
    row, _, why = _map(18101)
    assert why == ""
    assert row["bedrooms"] == 3 and row["bathrooms"] == 4 and row["area_m2"] == 218
    assert row["property_age"] == 4, "fave_property_year 2022 against this_year 2026"
    assert row["parking"] is True, "fave_property_garage = 1"
    assert "air_conditioner" not in row, "«توصيلات مكييف» is connections only — prepared, not present"
    assert row["maid_room"] is True, "its own prose says «غرفة خادمة»"
    row, _, _ = _map(18101, property_feature=[], content="<p>شقق بانورامية</p>")
    assert "maid_room" not in row and "water_supply" not in row, "absent terms stay NULL, never False"
    # the three feature terms that ARE column facts (live term ids 80 / 75 / 78)
    row, _, _ = _map(18101, property_feature=[80, 75, 78], content="<p>شقق بانورامية</p>")
    assert row["maid_room"] is True and row["water_supply"] is True and row["sanitation"] is True
    assert row["photo_urls"] is None or all(u.startswith("https://") for u in row["photo_urls"])


def test_arabic_indic_year_and_counts_are_read():
    row, _, _ = _map(18101, meta_fave_property_year="٢٠٢٢", meta_fave_property_bedrooms="٤")
    assert row["property_age"] == 4 and row["bedrooms"] == 4


def test_pii_is_stripped_from_the_description():
    row, _, _ = _map(18101, content="<p>شقق بانورامية للتواصل 0551234567 أو info@example.com</p>")
    assert "0551234567" not in (row["description"] or "") and "example.com" not in (row["description"] or "")


def test_pii_is_stripped_from_the_agent_typed_address_fields_too():
    """fave_property_address / fave_property_map_address are Houzez free-text an agent can type —
    they flow into neighborhood (when no property_area term) and additional_info.address/
    map_address, and must be redacted like body (reviewer finding: only body was passed through
    redact_pii; property_area=[] forces neighborhood to fall back to addr[0])."""
    row, _, why = _map(18101, property_area=[],
                       meta_fave_property_address="حي المروة، للتواصل 0551234567",
                       meta_fave_property_map_address="حي المروة info@example.com")
    assert why == ""
    assert "0551234567" not in (row["neighborhood"] or "")
    assert "0551234567" not in (row["additional_info"].get("address") or "")
    assert "example.com" not in (row["additional_info"].get("map_address") or "")


def test_listing_url_is_the_posts_own_page():
    row, _, _ = _map(22251)
    assert row["listing_url"].startswith("https://shatrirealestate.com/property/") and "None" not in row["listing_url"]
    assert row["ad_number"] == "SHT22251"


# ── removal oracle ────────────────────────────────────────────────────────────────────────────────

def test_liveness_signal_reads_the_measured_shapes():
    sig = R._signal_for(22251, TERMS["property_label"])
    assert sig(404, '{"code":"rest_post_invalid_id","message":"x","data":{"status":404}}', False) == "gone"
    assert sig(200, '{"id":22251,"status":"publish","property_label":[]}', False) == "live"
    assert sig(200, '{"id":22251,"status":"publish","property_label":[73]}', False) == "gone"
    assert sig(200, '{"id":22251,"status":"draft","property_label":[]}', False) == "gone"
    assert sig(200, '{"id":99,"status":"publish","property_label":[]}', False) is None
    assert sig(403, "<html>blocked</html>", False) is None
    assert sig(404, "<html>not json</html>", False) is None


# ── main(): the tally reaches end_run ─────────────────────────────────────────────────────────────

def test_main_writes_both_tables_and_reports_the_skip_tally(monkeypatch):
    calls = {}
    posts = [POSTS[i] for i in (22251, 18501, 21820, 18906, 22208)]
    monkeypatch.setattr(R, "session", lambda: object())
    monkeypatch.setattr(R, "fetch_terms", lambda s: TERMS)
    monkeypatch.setattr(R, "fetch_posts", lambda s, limit=0: (posts, len(posts)))
    monkeypatch.setattr(R, "fetch_media", lambda s, ids: MEDIA)
    db = types.SimpleNamespace(
        begin_run=lambda slug: calls.setdefault("begin", slug) or 7,
        _wasalt_batch=lambda table, rows: calls.setdefault("batches", []).append((table, [r["ad_number"] for r in rows])),
        retire_superseded_siblings=lambda **kw: calls.setdefault("retire", kw) and 0,
        prune_unseen=lambda table, seen, source=None, verify_gone=None: calls.setdefault("prune", []).append((table, sorted(seen), verify_gone is not None)) or 0,
        end_run=lambda run_id, **kw: calls.setdefault("end", kw) or True,
    )
    monkeypatch.setattr(R, "db", db)
    monkeypatch.setattr(sys, "argv", ["run"])
    assert R.main() == 0
    assert calls["begin"] == "shatri"
    assert ("shatri_residential_listings", ["SHT22251", "SHT22208"]) in calls["batches"]
    assert ("shatri_commercial_listings", []) in calls["batches"]
    assert calls["retire"]["res_table"] == "shatri_residential_listings"
    assert calls["prune"] and calls["prune"][0][2] is True, "prune runs only with the measured oracle"
    end = calls["end"]
    assert end["check_tables"] == ["shatri_residential_listings", "shatri_commercial_listings"]
    assert end["rows_seen"] == 5 and end["rows_upserted"] == 2
    for tok in ("soldx1", "off_plan_unpricedx1", "type_ambiguous[Apartment, Building]x1"):
        assert tok in end["notes"], end["notes"]


def test_main_never_prunes_a_limited_enumeration(monkeypatch):
    calls = {}
    posts = [POSTS[22251]]
    monkeypatch.setattr(R, "session", lambda: object())
    monkeypatch.setattr(R, "fetch_terms", lambda s: TERMS)
    monkeypatch.setattr(R, "fetch_posts", lambda s, limit=0: (posts, 74))     # site says 74, we read 1
    monkeypatch.setattr(R, "fetch_media", lambda s, ids: MEDIA)
    db = types.SimpleNamespace(begin_run=lambda slug: 1, _wasalt_batch=lambda t, r: None,
                               retire_superseded_siblings=lambda **kw: 0,
                               prune_unseen=lambda *a, **kw: calls.setdefault("prune", True) or 0,
                               end_run=lambda run_id, **kw: True)
    monkeypatch.setattr(R, "db", db)
    monkeypatch.setattr(sys, "argv", ["run"])
    assert R.main() == 0 and "prune" not in calls
