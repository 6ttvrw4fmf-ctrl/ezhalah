"""akariyoun + ksaaqar amenities come from the ad's OWN description block (🔬 AF engineer, 2026-10-08).

Neither site publishes a structured kitchen / lift / parking / maid-room field, so the ad's description is
the only statement and prose is lawful there (four outcomes, line by line). Both parsers never read it:
akariyoun 0 of 8 findable and ksaaqar 0 of 5 on ops_af_score 2026-10-08 — every one an ad saying «مطبخ
راكب», «مصعد», «موقف خاص» stored NULL. Markup below is verbatim from the live pages re-read that night
(source-reread run 37756729780: akariyoun 15461894 / 16107156, ksaaqar 12226455 / 12226526), phone numbers
removed.

    python -m pytest scrapers/common/tests/test_description_amenities_akariyoun_ksaaqar.py -q
"""
from __future__ import annotations

import sys

sys.path.insert(0, ".")

import scrapers.akariyoun.run as AK  # noqa: E402
import scrapers.ksaaqar.run as KS  # noqa: E402

AK_PAGE = (
    '<div class="property_block_wrap_header"><a data-bs-toggle="collapse">'
    '<h4 class="property_block_title">الوصف</h4></a></div>'
    '<div id="clTwo" class="panel-collapse collapse show"><div class="block-body">'
    '<p>للإيجار شقة من عمارة دور أول<br>الموقع : الرياض - الياسمين<br>المساحة : 150م<br>'
    'عبارة عن :<br>مجلس - صالة - مطبخ - غرفة غسيل - 3 غرف وحدة ماستر .</p><p>عدد دورات المياه : 3</p>'
    '<p>- مطبخ راكب<br>- 6 مكيفات سبيلت<br>- ⁠كهرب مستقل<br>- ⁠فرن كهربائي<br>- مصعد<br>- ⁠موقف خاص</p>'
    '<p>السعر : 75,000</p></div></div>'
)
# The site's own ad-creation form and the district's services are on EVERY page: never the ad.
AK_CHROME = ('<form><label>الرجاء اختيار الحي الذي تريد إضافة إعلانك فيه</label><span>مصعد</span>'
             '<span>غرفة خادمة</span></form><h6>الخدمات المتوفرة في الحي</h6><li><span>موقف سيارات</span></li>')

KS_PAGE = (
    '<ul><li>التكييف : <span>نعم </span></li><li>التأثيث : <span>غير مفروشة </span></li></ul></div>'
    '<div id="adt-ad-description-box" class="adt-ad-description">\n<h4>الوصف:</h4>\n'
    '<p>السلام عليكم ورحمه الله\nيتوفر لدينا شقة للايجار فاخره\nغرفتين نوم\nصالة\nمجلس\nمطبخ\nمكيفات\n'
    'شقة واسعة\nقريبة من جميع الخدامات\nيوجد مصعد\nتوفر صرف صحي\nايجار السنوي 25 الف</p>\n'
    '<div class="adforest-owner-text"><p>أخبر المالك أنك شاهدت الإعلان</p></div>'
)


def test_akariyoun_reads_its_description_panel():
    out = AK.parse_description_amenities(AK_CHROME + AK_PAGE)
    assert out.get("kitchen") is True and out.get("elevator") is True and out.get("parking") is True
    assert out.get("laundry_room") is True


def test_akariyoun_never_reads_the_form_or_the_district():
    assert AK.parse_description_amenities(AK_CHROME) == {}, "no description panel = no statement"
    assert "maid_room" not in AK.parse_description_amenities(AK_CHROME + AK_PAGE)


def test_akariyoun_negation_and_prepared_are_not_yes():
    prepared = AK.parse_description_amenities(AK_PAGE.replace("- مصعد", "- تأسيس مصعد"))
    assert prepared.get("elevator") is None, "«تأسيس مصعد» is a prepared shaft: unknown, never yes"
    negated = AK.parse_description_amenities(AK_PAGE.replace("- مصعد", "- لا يوجد مصعد"))
    assert negated.get("elevator") is False, "«لا يوجد مصعد» is the source saying no"


def test_akariyoun_services_stay_structured():
    assert "optical_fibers" not in AK.parse_description_amenities(AK_PAGE.replace("مصعد", "مصعد<br>ألياف بصرية"))


def test_akariyoun_map_listing_carries_them():
    AK.to_catalog = lambda city_ar, region_hint=None: (1, 1)
    AK.find_district_in_text = lambda text, city_id: text
    page = ("<html><head><title>شقة للإيجار - Akariyoun</title></head><body><span>الرياض - الياسمين</span>"
            "<p>رقم الاعلان : 973</p><p>نوع العقار: شقة</p><p>للإيجار</p>" + AK_CHROME + AK_PAGE + "</body></html>")
    row, _cat, _raw = AK.map_listing("shk-x", page)
    assert row is not None and row["kitchen"] is True and row["elevator"] is True and row["parking"] is True


def test_ksaaqar_reads_its_description_box_only():
    out = KS.parse_description_amenities(KS_PAGE)
    assert out.get("kitchen") is True and out.get("elevator") is True
    assert "air_conditioner" not in out, "AC is ksaaqar's structured «التكييف» — never prose"
    assert "furnished" not in out


def test_ksaaqar_no_box_no_statement():
    assert KS.parse_description_amenities('<li>التكييف : <span>نعم</span></li><p>مصعد</p>') == {}


def test_ksaaqar_proximity_is_not_the_unit():
    out = KS.parse_description_amenities(KS_PAGE.replace("يوجد مصعد", "قريب من مواقف عامة"))
    assert "parking" not in out and "elevator" not in out
