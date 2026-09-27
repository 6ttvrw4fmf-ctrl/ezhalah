"""العجلان (alajlan-re.com) — the shared-URL exception, category-scoped ad_numbers, price/period
parsing off a spec-table cell (not prose), and the status:false exclusion.

PROJECTS_JSON below is the VERBATIM body of GET https://alajlan-re.com/data/projects.json,
captured 2026-09-25 — not paraphrased, not trimmed, not hand-typed. Every assertion runs the
SHIPPING function `run.map_listing`, never a re-implementation. Offline: no network
(to_catalog/find_district_in_text are monkeypatched, same contract as every other scraper's tests).
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

from scrapers.alajlan import run as R  # noqa: E402

_RIYADH = (3, 1)  # (city_id, region_id) stub — every item in this capture is الرياض


@pytest.fixture(autouse=True)
def _no_catalog_network(monkeypatch):
    monkeypatch.setattr(R, "to_catalog", lambda c, region_hint=None: _RIYADH if c == "الرياض" else (None, None))
    monkeypatch.setattr(R, "find_district_in_text", lambda t, cid: t)  # canonical == raw, for this test


PROJECTS_JSON = r"""[
  {
      "name": "تأجير",
      "isActive": true,
      "description": [
        {
          "id":1,
          "order":1,
          "license_num":"7200503415",
          "image":"images/land/1.webp",
          "title":"شقة النرجس",
          "information":"حي النرجس - الرياض",
          "typeEn":"appartment",
          "typeAr":"شقة",
          "icon":"images/icons/navigation.png",
          "location":"الرياض",
          "status": true,
          "images":[               
              "images/rent/13/1.jpg",
              "images/rent/13/2.jpg",
              "images/rent/13/3.jpg",
              "images/rent/13/4.jpg",
              "images/rent/13/5.jpg",
              "images/rent/13/6.jpg",
              "images/rent/13/7.jpg",
              "images/rent/13/8.jpg"
          ],
          "detailTitle1":"عدد الغرف",
          "detailIcon1":"far fa-bed-alt",
          "detailInfo1":"3",
          "detailTitle2":"دورات المياة",
          "detailIcon2":"far fa-shower",
          "detailInfo2":"3",
          "detailTitle3":"المساحة",
          "detailIcon3":"far fa-chart-area",
          "detailInfo3":"110 متر",
          "detailTitle4":"السعر",
          "detailIcon4":"far fa-money-bill-alt",
          "detailInfo4":"92,000 <img src=\"/images/icons/Saudi_Riyal.svg\" width=\"12\">",
          "detailInfo4_2":"",
          "locationURL":"",
          "summary":"فرصة مميزة للسكن في شقة فاخرة بتصميم عصري ومساحة واسعة في حي النرجس مع خدمات متكاملة وراحة لا مثيل لها محتويات الشقة: صالة كبيرة مع سطح خاص، غرفة ماستر مع سطح خاص، غرفة نوم إضافية، غرفة غسيل، غرفة ملابس، مطبخ راكب مع الأجهزة الكهربائية، مكيفات راكبة، بلكونة بإطلالة مميزة. المرافق والخدمات المميزة: مسبح، نادي رجالي ونسائي، مكاتب وصالات اجتماعات، حضانة أطفال، لاونج أنيق وقاعة كبيرة لاستقبال الضيوف."

        },
        {
          "id":2,
          "order":2,
          "license_num":"7200503305",
          "image":"images/land/1.webp",
          "title":"شقة النرجس",
          "information":"حي النرجس - الرياض",
          "typeEn":"appartment",
          "typeAr":"شقة",
          "icon":"images/icons/navigation.png",
          "location":"الرياض",
          "status": true,
          "images":[               
              "images/rent/12/1.jpg",
              "images/rent/12/2.jpg",
              "images/rent/12/3.jpg",
              "images/rent/12/4.jpg",
              "images/rent/12/5.jpg",
              "images/rent/12/6.jpg",
              "images/rent/12/7.jpg"
          ],
          "detailTitle1":"عدد الغرف",
          "detailIcon1":"far fa-bed-alt",
          "detailInfo1":"3",
          "detailTitle2":"دورات المياة",
          "detailIcon2":"far fa-shower",
          "detailInfo2":"3",
          "detailTitle3":"المساحة",
          "detailIcon3":"far fa-chart-area",
          "detailInfo3":"118 متر",
          "detailTitle4":"السعر",
          "detailIcon4":"far fa-money-bill-alt",
          "detailInfo4":"75,000 <img src=\"/images/icons/Saudi_Riyal.svg\" width=\"12\">",
          "detailInfo4_2":"",
          "locationURL":"",
          "summary":"شقة راقية للإيجار في حي النرجس في الدور الأول مع تراس، فاخرة وحديثة تتميز بموقع هادئ وتصميم عصري تفاصيل الشقة: غرفة نوم رئيسية، غرفتين نوم عادية، مطبخ راكب، مكيفات راكبة، تراس واسع ومطل، حوش وممر مشاة خاص. مميزات الشقة: تشطيب راق وحديث، موقع مميز وقريب من جميع الخدمات، مناسبة للعائلات الباحثة عن الراحة والخصوصية."

        },
        {
          "id":3,
          "order":3,
          "license_num":"7200498341",
          "image":"images/land/1.webp",
          "title":"شقة العارض",
          "information":"حي العارض - الرياض",
          "typeEn":"appartment",
          "typeAr":"شقة",
          "icon":"images/icons/navigation.png",
          "location":"الرياض",
          "status": true,
          "images":[               
              "images/rent/10/1.jpg",
              "images/rent/10/2.jpg",
              "images/rent/10/3.jpg",
              "images/rent/10/4.jpg",
              "images/rent/10/5.jpg",
              "images/rent/10/6.jpg",
              "images/rent/10/7.jpg",
              "images/rent/10/8.jpg"
          ],
          "detailTitle1":"عدد الغرف",
          "detailIcon1":"far fa-bed-alt",
          "detailInfo1":"2",
          "detailTitle2":"دورات المياة",
          "detailIcon2":"far fa-shower",
          "detailInfo2":"2",
          "detailTitle3":"المساحة",
          "detailIcon3":"far fa-chart-area",
          "detailInfo3":"435 متر",
          "detailTitle4":"السعر",
          "detailIcon4":"far fa-money-bill-alt",
          "detailInfo4":"60,000 <img src=\"/images/icons/Saudi_Riyal.svg\" width=\"12\">",
          "detailInfo4_2":"",
          "locationURL":"",
          "summary":"شقة للإيجار في فيلا بحي العارض مع سطح جديدة تشمل على غرفتين نوم، دورتين مياة، صالة كبيرة، مجلس كبير، مطبخ راكب ومكيفات سبيلت راكبة."

        },
        {
          "id":4,
          "order":4,
          "license_num":"7200498313",
          "image":"images/land/1.webp",
          "title":"شقة العارض",
          "information":"حي العارض - الرياض",
          "typeEn":"appartment",
          "typeAr":"شقة",
          "icon":"images/icons/navigation.png",
          "location":"الرياض",
          "status": true,
          "images":[               
              "images/rent/9/1.jpg",
              "images/rent/9/2.jpg",
              "images/rent/9/3.jpg",
              "images/rent/9/4.jpg",
              "images/rent/9/5.jpg",
              "images/rent/9/6.jpg",
              "images/rent/9/7.jpg",
              "images/rent/9/8.jpg"
          ],
          "detailTitle1":"عدد الغرف",
          "detailIcon1":"far fa-bed-alt",
          "detailInfo1":"5",
          "detailTitle2":"دورات المياة",
          "detailIcon2":"far fa-shower",
          "detailInfo2":"3",
          "detailTitle3":"المساحة",
          "detailIcon3":"far fa-chart-area",
          "detailInfo3":"134 متر",
          "detailTitle4":"السعر",
          "detailIcon4":"far fa-money-bill-alt",
          "detailInfo4":"67,000 <img src=\"/images/icons/Saudi_Riyal.svg\" width=\"12\">",
          "detailInfo4_2":"",
          "locationURL":"",
          "summary":"شقة في عمارة سكنية في حي العارض بموقع مميز للإيجار تشمل على ثلاث غرف نوم واحدة منهم ماستر مع منطقة لغرفة الملابس، ثلاث دورات مياة، مطبخ مفتوح على الصالة، غرفة غسيل أو مستودع أو غرفة خادمة، صالة كبيرة مفتوحة على المجلس بواجهة زجاجية، واجهة أمامية مع بلكونه وأيضاً دخول ذكي للشقة"

        },
          {
            "id":5,
            "order":5,
            "license_num":"7200494380",
            "image":"images/land/1.webp",
            "title":"تاون هاوس النرجس",
            "information":"حي النرجس - الرياض",
            "typeEn":"appartment",
            "typeAr":"فيلا",
            "icon":"images/icons/navigation.png",
            "location":"الرياض",
            "status": true,
            "images":[               
                "images/rent/8/9.jpg",
                "images/rent/8/10.jpg",
                "images/rent/8/11.jpg",
                "images/rent/8/8.jpg",
                "images/rent/8/7.jpg",
                "images/rent/8/6.jpg",
                "images/rent/8/5.jpg",
                "images/rent/8/4.jpg",
                "images/rent/8/3.jpg",
                "images/rent/8/2.jpg",  
                "images/rent/8/1.jpg"
            ],
            "detailTitle1":"عدد الغرف",
            "detailIcon1":"far fa-bed-alt",
            "detailInfo1":"5",
            "detailTitle2":"دورات المياة",
            "detailIcon2":"far fa-shower",
            "detailInfo2":"6",
            "detailTitle3":"المساحة",
            "detailIcon3":"far fa-chart-area",
            "detailInfo3":"255 متر",
            "detailTitle4":"السعر",
            "detailIcon4":"far fa-money-bill-alt",
            "detailInfo4":"150,000 <img src=\"/images/icons/Saudi_Riyal.svg\" width=\"12\">",
            "detailInfo4_2":"",
            "locationURL":"",
            "summary":"تاون هاوس فاخر للإيجار في حي النرجس تشمل على: 1/القبو يحتوي على صالة، مدخل مباشر للفيلا، مواقف خاصة لعدد 2 سيارة. 2/ الدور الأرضي يحتوي على صالة واسعة، مطبخ راكب مجهز، مصعد داخلي، تكييف مخفي. 3/ الدور الأول يحتوي على 3 غرف نوم بتوزيع مثالي يضمن الراحة والخصوصية. 4/ الدور الثاني يحتوي على غرفة خادمة بدورة مياة وسطح خاص. مميزات استثنائية: نادي رياضي متكامل(رجال، نساء)، منطقة ألعاب أطفال، غرفة سائق خاصة، موقف خاص لـ 2 سيارة، تكييف مركزي مخفي في الدور الأرضي، أسقف رفيعة، مدخل خاص مباشر من القبو للفيلا ونظام دخول ذكي."

          },
		            {
            "id":6,
            "order":6,
            "license_num":"7200496161",
            "image":"images/land/1.webp",
            "title":"دور أرضي النرجس",
            "information":"حي النرجس - الرياض",
            "typeEn":"appartment",
            "typeAr":"دور",
            "icon":"images/icons/navigation.png",
            "location":"الرياض",
            "status": true,
            "images":[               
                "images/rent/7/9.jpg",
                "images/rent/7/10.jpg",
                "images/rent/7/3.jpg",
                "images/rent/7/2.jpg",
                "images/rent/7/8.jpg",
                "images/rent/7/7.jpg",
                "images/rent/7/6.jpg",
                "images/rent/7/5.jpg",
                "images/rent/7/4.jpg",
                "images/rent/7/11.jpg",  
                "images/rent/7/12.jpg",
                "images/rent/7/1.jpg"        
            ],
            "detailTitle1":"عدد الغرف",
            "detailIcon1":"far fa-bed-alt",
            "detailInfo1":"5",
            "detailTitle2":"دورات المياة",
            "detailIcon2":"far fa-shower",
            "detailInfo2":"3",
            "detailTitle3":"المساحة",
            "detailIcon3":"far fa-chart-area",
            "detailInfo3":"198 متر",
            "detailTitle4":"السعر",
            "detailIcon4":"far fa-money-bill-alt",
            "detailInfo4":"130,000 <img src=\"/images/icons/Saudi_Riyal.svg\" width=\"12\">",
            "detailInfo4_2":"",
            "locationURL":"",
            "summary":"دور أرضي فاخر في حي النرجس بتصميم عصري يدمج بين الفخامة والراحة، مدعوم بنظام'سمارت هوم' المتكامل للتحكم الذكي بالإضاءة والتكييف والأمن يشمل على: مدخل سيارة خاص، مجلس، مقلط، صالة واسعة، 3 غرف نوم واحدة منها غرفة ماستر، 3 دورات مياة، غرفة غسيل، غرفة خادمة بدورة مياة وتكييف راكب بالكامل"

          },
		            {
            "id":7,
            "order":7,
            "license_num":"7200487861",
            "image":"images/land/1.webp",
            "title":"شقة النرجس",
            "information":"حي النرجس - الرياض",
            "typeEn":"appartment",
            "typeAr":"شقة",
            "icon":"images/icons/navigation.png",
            "location":"الرياض",
            "status": true,
            "images":[               
                "images/rent/6/6.jpg",
                "images/rent/6/2.jpg",
                "images/rent/6/1.jpg",
                "images/rent/6/3.jpg",
                "images/rent/6/4.jpg",
                "images/rent/6/5.jpg",
                "images/rent/6/7.jpg",
                "images/rent/6/8.jpg"          
            ],
            "detailTitle1":"عدد الغرف",
            "detailIcon1":"far fa-bed-alt",
            "detailInfo1":"5",
            "detailTitle2":"دورات المياة",
            "detailIcon2":"far fa-shower",
            "detailInfo2":"3",
            "detailTitle3":"المساحة",
            "detailIcon3":"far fa-chart-area",
            "detailInfo3":"83 متر",
            "detailTitle4":"السعر",
            "detailIcon4":"far fa-money-bill-alt",
            "detailInfo4":"80,000 <img src=\"/images/icons/Saudi_Riyal.svg\" width=\"12\">",
            "detailInfo4_2":"",
            "locationURL":"",
            "summary":"شقة سكنية مميزة بمواصفات راقية في حي النرجس تشمل على غرفتين نوم، مجلس واسع، غرفة معيشة مريحة، مطبخ راكب بأحدث التجهيزات، غرفة خادمة مع دورة مياة، 3 دورات مياة، مكيفات راكبة، دخول ذكي، موقف خاص للسيارة كما تشمل على 2 سطح مثالي للاستخدام المتعدد."

          },
		  {
            "id":8,
            "order":8,
            "license_num":"7200480501",
            "image":"images/land/1.webp",
            "title":"فيلا العارض",
            "information":"حي العارض - الرياض",
            "typeEn":"villa",
            "typeAr":"فيلا",
            "icon":"images/icons/navigation.png",
            "location":"الرياض",
            "status": true,
            "images":[               
                "images/rent/5/15.jpg",
                "images/rent/5/1.jpg",
                "images/rent/5/2.jpg",
                "images/rent/5/3.jpg",
                "images/rent/5/4.jpg",
                "images/rent/5/5.jpg",
                "images/rent/5/6.jpg",
                "images/rent/5/7.jpg",
                "images/rent/5/8.jpg",
                "images/rent/5/9.jpg",
                "images/rent/5/10.jpg",
                "images/rent/5/11.jpg",
                "images/rent/5/12.jpg",
                "images/rent/5/13.jpg",
                "images/rent/5/14.jpg",
                "images/rent/5/16.jpg",
                "images/rent/5/17.jpg"           
            ],
            "detailTitle1":"عدد الغرف",
            "detailIcon1":"far fa-bed-alt",
            "detailInfo1":"4",
            "detailTitle2":"دورات المياة",
            "detailIcon2":"far fa-shower",
            "detailInfo2":"4",
            "detailTitle3":"المساحة",
            "detailIcon3":"far fa-chart-area",
            "detailInfo3":"184 متر",
            "detailTitle4":"السعر",
            "detailIcon4":"far fa-money-bill-alt",
            "detailInfo4":"80,000 <img src=\"/images/icons/Saudi_Riyal.svg\" width=\"12\">",
            "detailInfo4_2":"",
            "locationURL":"",
            "summary":"بنتهاوس فاخر للإيجار بنظام دورين بواجهة غربية تحتوي على 3 غرف نوم واسعة بدورة مياة مستقلة، صالة مع فناء خارجي خاص مثالية للاستمتاع بجلساتك الخاصة، مطبخ راكب ومجهز بالكامل، مكيفات راكبة، غرفة غسيل مستقلة لتوفير مزيد من التنظيم بالإضافة إلى موقف خاص. سهولة الوصول إلى الطرق الرئيسية (طريق الملك سلمان - طريق الملك عبدالعزيز)، قرب من محطة المترو، مجمع متكامل الخدمات والمرافق وسط بيئة راقية مخصصة للعائلات."

          },
		  {
            "id":9,
            "order":9,
            "license_num":"7200480245",
            "image":"images/land/1.webp",
            "title":"شقة الرمال",
            "information":"حي الرمال - الرياض",
            "typeEn":"appartment",
            "typeAr":"شقق",
            "icon":"images/icons/navigation.png",
            "location":"الرياض",
            "status": true,
            "images":[               
                "images/rent/4/1.jpg",
                "images/rent/4/2.jpg",
                "images/rent/4/3.jpg",
                "images/rent/4/4.jpg",
                "images/rent/4/5.jpg",
                "images/rent/4/6.jpg",
                "images/rent/4/7.jpg"           
            ],
            "detailTitle1":"عدد الغرف",
            "detailIcon1":"far fa-bed-alt",
            "detailInfo1":"6",
            "detailTitle2":"دورات المياة",
            "detailIcon2":"far fa-shower",
            "detailInfo2":"3",
            "detailTitle3":"المساحة",
            "detailIcon3":"far fa-chart-area",
            "detailInfo3":"152 متر",
            "detailTitle4":"السعر",
            "detailIcon4":"far fa-money-bill-alt",
            "detailInfo4":"50,000 <img src=\"/images/icons/Saudi_Riyal.svg\" width=\"12\">",
            "detailInfo4_2":"",
            "locationURL":"",
            "summary":"شقة للإيجار بالدور الأول في منطقة راقية تتميز بالمساحات الواسعة والإضاءة الطبيعية التي تضفي إحساساً بالحيوية والراحة. تحتوي الشقة على: 4 غرف نوم واسعة تشمل غرفة ماستر بتصميم أنيق (تسمح بخصوصية لغرفة خادمة) بالإضافة إلى صالة فسيحة ومجلس راقٍ بتصميم مفتوح يسمح بدخول الإضاءة وتحتوي أيضاً على موقف خاص يضمن لك الراحة والخصوصية كما تتميز بنظام دخول ذكي لمزيد من الأمان والتحكم السهل."

          },
		      {
            "id":10,
            "order":10,
            "license_num":"7200459915",
            "image":"images/land/1.webp",
            "title":"شقة القيروان",
            "information":"حي القيروان - الرياض",
            "typeEn":"appartment",
            "typeAr":"شقق",
            "icon":"images/icons/navigation.png",
            "location":"الرياض",
            "status": true,
            "images":[             
                "images/rent/1/1.jpg",
                "images/rent/1/2.jpg",
                "images/rent/1/3.jpg",
                "images/rent/1/4.jpg",
                "images/rent/1/5.jpg",
                "images/rent/1/6.jpg",
                "images/rent/1/7.jpg",
                "images/rent/1/8.jpg"             
            ],
            "detailTitle1":"عدد الغرف",
            "detailIcon1":"far fa-bed-alt",
            "detailInfo1":"4",
            "detailTitle2":"دورات المياة",
            "detailIcon2":"far fa-shower",
            "detailInfo2":"2",
            "detailTitle3":"المساحة",
            "detailIcon3":"far fa-chart-area",
            "detailInfo3":"145 متر",
            "detailTitle4":"السعر",
            "detailIcon4":"far fa-money-bill-alt",
            "detailInfo4":"100,000 <img src=\"/images/icons/Saudi_Riyal.svg\" width=\"12\"> سنوي",
            "detailInfo4_2":"",
            "locationURL":"",
            "summary":"شقة مؤثثة بالكامل بأثاث فندقي فاخر تشمل حديقة خارجية وغرفتين نوم واسعة، دورتين مياة، صالة أنيقة، مجلس راقي ومطبخ مجهز داخل عمارة جديدة مثالية للسكن المريح والراقي بجانب مشروع المربع"

          },
		          {
          "id":11,
          "order":11,
          "license_num":"7200498322",
          "image":"images/land/1.webp",
          "title":"شقة النرجس",
          "information":"حي النرجس - الرياض",
          "typeEn":"appartment",
          "typeAr":"شقة",
          "icon":"images/icons/navigation.png",
          "location":"الرياض",
          "status": false,
          "images":[               
              "images/rent/11/1.jpg",
              "images/rent/11/2.jpg",
              "images/rent/11/3.jpg",
              "images/rent/11/4.jpg"
          ],
          "detailTitle1":"عدد الغرف",
          "detailIcon1":"far fa-bed-alt",
          "detailInfo1":"2",
          "detailTitle2":"دورات المياة",
          "detailIcon2":"far fa-shower",
          "detailInfo2":"3",
          "detailTitle3":"المساحة",
          "detailIcon3":"far fa-chart-area",
          "detailInfo3":"450 متر",
          "detailTitle4":"السعر",
          "detailIcon4":"far fa-money-bill-alt",
          "detailInfo4":"60,000 <img src=\"/images/icons/Saudi_Riyal.svg\" width=\"12\">",
          "detailInfo4_2":"",
          "locationURL":"",
          "summary":"شقة في فيلا تقع بحي النرجس بين طرق عثمان بن عفان وسعود بن جلوي في موقع راقٍ ومميز قريب من جامعة الأميرة نورة، تقع في الدور الثاني تشمل على مطبخ راكب فخم وجديد غير مستخدم، 4 مكيفات راكبة جديدة، مدخلين مستقلين، مجلس واسع مع دورة مياة مستقلة، غرفتين نوم ماستر، صالة واسعة، عداد كهرباء مستقل والماء مشمول ضمن الايجار."

        },
          {
            "id":12,
            "order":12,
            "license_num":"7200475589",
            "image":"images/land/1.webp",
            "title":"شقة الصحافة",
            "information":"حي الصحافة - الرياض",
            "typeEn":"appartment",
            "typeAr":"شقق",
            "icon":"images/icons/navigation.png",
            "location":"الرياض",
            "status": false,
            "images":[               
                "images/rent/3/1.jpg",
                "images/rent/3/2.jpg",
                "images/rent/3/3.jpg",
                "images/rent/3/4.jpg",
                "images/rent/3/5.jpg",
                "images/rent/3/6.jpg",
                "images/rent/3/7.jpg",
                "images/rent/3/8.jpg",
                "images/rent/3/9.jpg",
                "images/rent/3/10.jpg",
                "images/rent/3/11.jpg",
                "images/rent/3/1.mp4",     
                "images/rent/3/2.mp4",           
                "images/rent/3/3.mp4"            
            ],
            "detailTitle1":"عدد الغرف",
            "detailIcon1":"far fa-bed-alt",
            "detailInfo1":"4",
            "detailTitle2":"دورات المياة",
            "detailIcon2":"far fa-shower",
            "detailInfo2":"2",
            "detailTitle3":"المساحة",
            "detailIcon3":"far fa-chart-area",
            "detailInfo3":"350 متر",
            "detailTitle4":"السعر",
            "detailIcon4":"far fa-money-bill-alt",
            "detailInfo4":"80,000 <img src=\"/images/icons/Saudi_Riyal.svg\" width=\"12\">",
            "detailInfo4_2":"",
            "locationURL":"",
            "summary":"شقة بحي الصحافة دور علوي بمدخل خاص مؤثثة بالكامل تبعد عن محطة المترو دقيقتين سيرا على الاقدام تحتوي على غرفتين نوم و مجلس وصالة ودورتين مياة وسطح خاص ومطبخ ومكيفات راكبة."

          },
		            {
            "id":13,
            "order":13,
            "license_num":"7200452185",
            "image":"images/land/1.webp",
            "title":"شقة العارض",
            "information":"حي العارض - الرياض",
            "typeEn":"appartment",
            "typeAr":"شقق",
            "icon":"images/icons/navigation.png",
            "location":"الرياض",
            "status": false,
            "images":[             
                "images/rent/2/1.jpg",
                "images/rent/2/2.jpg",
                "images/rent/2/3.jpg",
                "images/rent/2/4.jpg",
                "images/rent/2/5.jpg",
                "images/rent/2/6.jpg",
                "images/rent/2/7.jpg",
                "images/rent/2/8.jpg"            
            ],
            "detailTitle1":"عدد الغرف",
            "detailIcon1":"far fa-bed-alt",
            "detailInfo1":"3",
            "detailTitle2":"دورات المياة",
            "detailIcon2":"far fa-shower",
            "detailInfo2":"2",
            "detailTitle3":"المساحة",
            "detailIcon3":"far fa-chart-area",
            "detailInfo3":"96 متر",
            "detailTitle4":"السعر",
            "detailIcon4":"far fa-money-bill-alt",
            "detailInfo4":"75,000 <img src=\"/images/icons/Saudi_Riyal.svg\" width=\"12\"> دفعة",
            "detailInfo4_2":"80,000 <img src=\"/images/icons/Saudi_Riyal.svg\" width=\"12\"> دفعتين",
            "locationURL":"",
            "summary":"استمتع بتجربة سكنية راقية في شقة أرضية تتميز بتصميم أنيق وموقع استراتيجي قريب من جميع الخدمات تشمل على مدخل خاص، غرفتين نوم ماستر، صالة بتصميم عصري، مطبخ مجهز بالكامل، مستودع تخزين ودورتين مياة"

          }
      ]
  },
  {
    "name": "استثمار",
    "isActive": true,
    "description": [
      {
        "id":1,
        "order":1,
        "license_num":"7200467476",
        "image":"images/land/1.webp",
        "title":"منتجع العمارية",
        "information":"العمارية - الرياض",
        "typeEn":"resort",
        "typeAr":"منتجع",
        "icon":"images/icons/navigation.png",
        "location":"الرياض",
        "status": true,
        "images":[             
            "images/envistement/1/2.jpg",
            "images/envistement/1/1.jpg",
            "images/envistement/1/3.jpg",
            "images/envistement/1/4.jpg",
            "images/envistement/1/5.jpg",
            "images/envistement/1/6.jpg",
            "images/envistement/1/7.jpg",
            "images/envistement/1/8.jpg",
            "images/envistement/1/9.jpg",
            "images/envistement/1/10.jpg",
            "images/envistement/1/11.jpg",
            "images/envistement/1/12.jpg",
            "images/envistement/1/13.jpg",
            "images/envistement/1/14.jpg",
            "images/envistement/1/15.jpg",
            "images/envistement/1/16.jpg",
            "images/envistement/1/17.jpg",
            "images/envistement/1/18.jpg",
            "images/envistement/1/19.jpg",
            "images/envistement/1/20.jpg"           
        ],
        "detailTitle1":"عدد الغرف",
        "detailIcon1":"far fa-bed-alt",
        "detailInfo1":"4",
        "detailTitle2":"دورات المياة",
        "detailIcon2":"far fa-shower",
        "detailInfo2":"3",
        "detailTitle3":"المساحة",
        "detailIcon3":"far fa-chart-area",
        "detailInfo3":"800 متر",
        "detailTitle4":"السعر",
        "detailIcon4":"far fa-money-bill-alt",
        "detailInfo4":"170,000 <img src=\"/images/icons/Saudi_Riyal.svg\" width=\"12\">",
        "detailInfo4_2":"",
        "locationURL":"",
        "summary":" على أعلى قمم جبال العمارية وبارتفاع يمنحك إطلالات بانورامية ساحرة وأجواء نادرة من الصفاء والهدوء نقدم لك فرصة استثمارية في منتجعات خاصة تجمع بين الفخامة والخصوصية، تحتوي على مسابح وحدائق وجلسات بانورامية، كراج خاص وكاميرات أمنية، صالة ومجلس ومطبخ مؤثث بالكامل، غرفتين نوم واحدة منها ماستر، ثلاث دورات مياة"

      }
    ]
},
{
  "name": "بيع",
  "isActive": true,
  "description": [
  ]
}
]"""

CATEGORIES = json.loads(PROJECTS_JSON)
RENT, INVEST, BUY = CATEGORIES[0], CATEGORIES[1], CATEGORIES[2]
assert (RENT["name"], INVEST["name"], BUY["name"]) == ("تأجير", "استثمار", "بيع")
assert len(RENT["description"]) == 13 and len(INVEST["description"]) == 1 and len(BUY["description"]) == 0


def _by_id(items, iid):
    return next(it for it in items if it["id"] == iid)


def test_price_stripped_of_html_currency_icon_no_period_stated():
    row, _, why = R.map_listing("تأجير", _by_id(RENT["description"], 1))
    assert why == ""
    assert row.get("price_total") is None       # Rent rows never carry price_total
    assert row["price_annual"] == 92000         # "92,000 <img …>" -> 92000, verbatim
    assert row["rent_period"] is None           # no period word on this row — never defaulted


def test_annual_period_detected_from_the_trailing_word():
    row, _, why = R.map_listing("تأجير", _by_id(RENT["description"], 10))
    assert why == ""
    assert row["rent_period"] == "annual"
    assert row["price_annual"] == 100000        # "100,000 <img …> سنوي"


def test_status_false_rows_are_excluded():
    for iid in (11, 12, 13):
        row, _, why = R.map_listing("تأجير", _by_id(RENT["description"], iid))
        assert row is None
        assert why == "inactive"


def test_every_active_row_shares_the_one_homepage_url():
    rows = []
    for cat in CATEGORIES:
        for it in cat["description"]:
            row, _, _ = R.map_listing(cat["name"], it)
            if row:
                rows.append(row)
    assert len(rows) == 11  # 10 active rent + 1 investment + 0 buy, measured 2026-09-25
    assert {r["listing_url"] for r in rows} == {"https://alajlan-re.com/"}
    for r in rows:  # the one invariant that must never accidentally vary per-row
        assert r["listing_url"] == R.HOMEPAGE_URL


def test_category_scoped_ad_number_never_collides_across_categories():
    # id restarts at 1 in EVERY category — rent's id=1 and investment's id=1 are different units.
    rent_1, _, _ = R.map_listing("تأجير", _by_id(RENT["description"], 1))
    invest_1, _, _ = R.map_listing("استثمار", INVEST["description"][0])
    assert invest_1["ad_number"] == "ALJI1"
    assert rent_1["ad_number"] == "ALJR1"
    assert rent_1["ad_number"] != invest_1["ad_number"]


def test_investment_category_maps_to_buy_and_resort_is_a_commercial_type():
    row, bucket, why = R.map_listing("استثمار", INVEST["description"][0])
    assert why == ""
    assert row["transaction_type"] == "Buy"
    assert row["property_type"] == "Resort"     # per-platform override — not the shared map
    assert bucket == "commercial"
    assert row["price_total"] == 170000


def test_district_split_from_the_information_field():
    row, _, _ = R.map_listing("تأجير", _by_id(RENT["description"], 1))
    assert row["neighborhood"] == "حي النرجس"    # raw, verbatim
    assert row["district_ar"] == "حي النرجس"     # stubbed canonical == raw for this test
    assert row["city_ar"] == "الرياض"
    assert row["city_id"] == 3


def test_license_number_is_the_rega_ad_licence():
    row, _, _ = R.map_listing("تأجير", _by_id(RENT["description"], 1))
    assert row["license_number"] == "7200503415"


def test_empty_buy_category_is_walked_without_erroring():
    # the task's own point: بيع has 0 entries TODAY, but the loop must not special-case it away —
    # it has to be capable of reading a row the moment one appears.
    assert BUY["description"] == []
    for it in BUY["description"]:
        R.map_listing("بيع", it)  # would raise on a real entry if the path were broken; no-op here


def test_unmapped_category_name_is_skipped_not_guessed():
    row, _, why = R.map_listing("عرض خاص", {"id": 1, "status": True})
    assert row is None
    assert why == "category_unmapped"


def test_main_walks_all_three_categories(monkeypatch, capsys):
    """The real entry point, offline: stub the network fetch to return the captured categories,
    and the DB/upsert calls so nothing touches Supabase."""
    monkeypatch.setattr(R, "fetch_categories", lambda s: CATEGORIES)
    monkeypatch.setattr(R.db, "begin_run", lambda platform: None)
    written = {}
    monkeypatch.setattr(R.db, "upsert_alajlan_residential_batch", lambda rows: written.setdefault("res", rows))
    monkeypatch.setattr(R.db, "upsert_alajlan_commercial_batch", lambda rows: written.setdefault("com", rows))
    monkeypatch.setattr(R.db, "retire_superseded_siblings", lambda **kw: 0)
    monkeypatch.setattr(R.db, "prune_unseen", lambda *a, **kw: 0)
    monkeypatch.setattr(R.db, "end_run", lambda *a, **kw: True)
    monkeypatch.setattr(sys, "argv", ["run.py", "--type", "all"])
    assert R.main() == 0
    total = len(written["res"]) + len(written["com"])
    assert total == 11
    assert all(r["listing_url"] == R.HOMEPAGE_URL for r in written["res"] + written["com"])
