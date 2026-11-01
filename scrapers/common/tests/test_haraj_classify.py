"""Backlog 311 (owner 2026-10-09): only real property OFFERS from Haraj may become listings.
The titles below are the owner session's 2026-10-09 sample (ids in the backlog evidence) plus traps.
Run: python -m pytest scrapers/common/tests/test_haraj_classify.py -v
"""
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

from scrapers.haraj.classify import classify  # noqa: E402

REQUESTS = ["طلب شقه للايجار مستعجل لا ام وولدها", "مطلوب شقه للايجار في حي النرجس", "ابغا شقة عزاب", "مطلوب عمارة للإيجار",
            "أبحث عن أرض في شمال الرياض", "ابي فيلا للبيع بالتقسيط", "نبي استراحة للإيجار الشهري",
            "من عنده ارض للبيع في الخرج", "أرغب في شراء دور",
            # «و/ف» glued to the request word (HRJ11190725389, owner check 2026-10-17)
            "بنت وابحث عن استديو للإيجار بشرق الرياض", "وابغى شقة للايجار في جدة", "فنبي ارض في الخرج"]
OTHER = ["عامل مغسله يبحث عن عمل", "حارس يبحث عن عمل", "غرفة نوم للبيع نظيفة", "نقل عفش داخل الرياض",
         "تقبيل محل كوفي للبيع", "سائق خاص للتنازل"]
OFFERS = [("شقة للبيع في حي الياسمين", "شقة 3 غرف"), ("ارض للبيع حي العارض", "المساحة 600"),
          ("فيلا للإيجار", "رقم ترخيص الاعلان 7100000000"), ("عمارة", "إعلان: بيع\nنوع العقار: عمارة")]
DOUBT = ["ارض", "شقة", "الحلقة الشرقية"]


@pytest.mark.parametrize("t", REQUESTS)
def test_requests_never_offer(t):
    assert classify(t, "")[0] == "request"


@pytest.mark.parametrize("t", OTHER)
def test_non_property_never_offer(t):
    assert classify(t, "")[0] in ("other", "request")


@pytest.mark.parametrize("t,b", OFFERS)
def test_offers(t, b):
    assert classify(t, b)[0] == "offer"


@pytest.mark.parametrize("t", DOUBT)
def test_vague_is_not_shown(t):
    assert classify(t, "")[0] == "doubt"


def test_request_in_body_beats_offer_title():
    assert classify("شقة للبيع", "مطلوب شقة بنفس المواصفات")[0] == "request"


# Shadow crawl 2026-10-10 (CI run 38027005483), the hand-check's three misses:
def test_elongated_request_is_a_request():
    assert classify("مطلوووببب وحدتين ببصك واحد للبيع", "")[0] == "request"          # 11190238937


def test_broker_service_post_is_not_an_offer():
    assert classify("انصاف اراضي للبيع", "نقدم لكم بكل سرور خدمة الاعلان عن العروض لديكم")[0] == "other"  # 11190241825


def test_bedroom_in_an_apartment_body_does_not_kill_the_offer():
    assert classify("شقة مفروشة للايجار", "تتكون من غرفة نوم وصالة كبيرة ومطبخ")[0] == "offer"  # 11190241633
    assert classify("غرفة نوم للبيع نظيفة", "")[0] == "other"


# Shadow v2 2026-10-10 (CI run 38027397165): a partnership/marketing post is not an offer; «تمليك» and «حوش» are.
def test_partnership_and_marketer_posts_are_not_offers():
    assert classify("محل ايجار او شريك خضار وفواكهه", "")[0] == "other"               # 11190239193
    assert classify("الخرج", "عندك أرض أو بيت وتبي تسوّقه؟ تواصل معي")[0] == "other"  # 11190239013


def test_ownership_and_yard_offers():
    assert classify("شقق تمليك 6 غرف فاخرة حي الروابي", "")[0] == "offer"            # 11190238312
    assert classify("حوش كبير للإيجار 5040م2", "")[0] == "offer"                       # 11190238317


# Shadow v3 2026-10-10 (CI run 38028407965): a request with a suffixed request word reached «offer».
@pytest.mark.parametrize("t,b", [
    ("شقة للايجار", "تكفون محتاجه شقة عوائل بالسلي او السعادة تكون شهري"),   # 11190236890
    ("شقة للايجار", "محتاجين شقة 3 غرف"),
    ("فيلا للبيع", "ابيها قريبة من المدارس"),
    ("ارض للبيع", "ادور ارض في الخرج"),
    ("شقة للايجار", "اللي عنده شقة يكلمني"),
])
def test_suffixed_and_pleading_requests(t, b):
    assert classify(t, b)[0] == "request"


def test_real_offers_survive_the_wider_request_list():
    assert classify("بيت دور وشقتين للبيع في حي العاصمة", "غرض الإعلان: بيع\nنوع العقار: فيلا")[0] == "offer"
    assert classify("استراحة للايجار", "استراحة للايجار الموقع الفريع قريبة لجميع الخدمات")[0] == "offer"
    assert classify("للبيع ارض سكني في حي القيروان", "للبيع ارض سكنية مقابل مسجد وحديقة")[0] == "offer"


# Shadow 2026-10-11 (run 38114068690): of 105 «offer» verdicts hand-checked, these four were not
# property listings and two were shop key-money transfers. Verbatim titles.
@pytest.mark.parametrize("t,b", [
    ("محل خياط نسائي للبيع ( شارع الاستاذ الرياضي )", "راجع اعلاني السابق"),
    ("محل للبيع كماليات ملابس شناط ملابس رجالي نسائي ولادي بناتي", "محل كامل متكامل للبيع"),
    ("كامري دور للبيع ( الروان )", ""),
    ("يتوفر لدينا شقق سكنيه وأراضي سكنيه ومزارع", "صاحب الترخيص : رخصة فال للوساطة والتسويق"),
    ("محل تجاري لتقبيل او ايجار", ""),
    ("محل لتقبيل مشطب جاهز ايجار 42الف سنوي فتحتين 94 متر السعر", "محل لتقبيل مشطب جاهز فتحتين"),
    ("يوجد لدينا أراضي وعمائر عروض قويه ومميزه", "صاحب الترخيص : رخصة فال للوساطة والتسويق"),
    ("نستقل شقق للايجار السنوي", "نستقبل الشقق"),
    ("موجود جيمع البيوت للبيع", ""),
    ("افضل العروض العقارية للبيع في حي الجزيرة جوهرة العروس جزء 2س", ""),
])
def test_business_car_and_catalogue_posts_are_not_offers(t, b):
    assert classify(t, b)[0] != "offer"


@pytest.mark.parametrize("t,b", [
    ("محل للايجار", "محل للإيجار في موقع مميز على مخرج حي لبن"),
    ("للبيع دور ارضي بصك مستقل بحي العزيزية", "معلومات العقار حسب الرخصة غرض الإعلان: Sell"),
    ("مستودع للايجار مساحه 330 م ايجار 100 الف", "مستودع للايجار مساحه 330 متر الموقع : العزيزية"),
    ("ارض للبيع مساحة 900 مخطط ولي العهد شهداء الوطن", ""),
])
def test_real_offers_from_the_same_sample_survive(t, b):
    assert classify(t, b)[0] == "offer"


# Shadow 2026-10-12 (run 38206642958, untouched window 10-11 21:00 → 10-12 04:00): of 92 «offer» verdicts
# hand-checked, these 7 were not offers. Verbatim titles and the body words that decide them.
@pytest.mark.parametrize("t,b", [
    ("بحث بيت شعبي فالدويمة للإيجار", "بحث لبيت شعبي فالدويمة لا يتجاوز سعره 1000 لعائلة صغيرة"),
    ("حوش مع مكتب للايجار", "نقل ثقيل وخفيف؛ نقل متخصص اجره عامه ؛ نقل تعليمي نستخلص كافة اجراءات الرخصه"),
    ("مخطط طيبة الفرعية مكتب ابوراكان للعقار",
     "🔵لديك الرغبة في شراء ارض 🔵او لديك الرغبة في بيع ارض 🔵او حاب تستفسر عن سعر ارضك 🔵نوفر لك السعر"),
    ("شقق وملحق فلل للبيع في جده", ""),
    ("ادوار وشقق للبيع", ""),
    ("محل خضار وفواكهة للإيجار او التقبيل", "محل للإيجار الشهري او التقبيل الموقع : حي المغيسلة"),
    ("شقة للإيجار والتقبيل حي الوشام الرياض", ""),
])
def test_shadow_2026_10_12_misses_are_not_offers(t, b):
    assert classify(t, b)[0] != "offer"


@pytest.mark.parametrize("t,b", [
    # «نبينا» in the seller's blessing is not the request word «نبي» (it was dropped as a request).
    ("للبيع شقة تمليك جديدة فاخره 5غرف حي جبرة بحوش للجادين",
     "اللهم صل وسلم على نبينا محمد.. للبيع شقه تمليك جديدة فاخرة بحي قصر جبره"),
    # One building that is a villa plus flats, and shops plus a plot on one deed, stay offers.
    ("فيلا و3 شقق للبيع بحي الحسام بالدمام", "للبيع ( فيلا و3 شقق بحي الحسام الدمام )"),
    ("محلات تجارية وأرض في الحسينيه شارع تجاري للبيع بصك اكتروني", ""),
    ("للإيجار استراحه للشركات والعمال الدوادمي", "للايجار استراحه في الدوادمي مخطط ابن شميسان"),
])
def test_shadow_2026_10_12_real_offers_survive(t, b):
    assert classify(t, b)[0] == "offer"


# Shadow 2026-10-12 window 2 (run 38209047358, files 10-11-08 → 13 KSA): 110 offers hand-checked, 2 were
# broker posts with no unit.
@pytest.mark.parametrize("t,b", [
    ("مكتب ابو طريخم البقمي للعقار في مخطط طيبه الفرعيه شمال جده",
     "للبيع والشراء في مخططات طيبه الفرعيه احي الوداد مخطط 598-597 احي الندى"),
    ("شقق مفروشة ايجار شهري بعدة مواقع",
     "بسم الله ماشاءالله يوجد لدينا شقق مفروشة جاهزة للإيجار الشهري في جدة بعدة احياء مختلفة"),
])
def test_shadow_2026_10_12_window2_brokers_are_not_offers(t, b):
    assert classify(t, b)[0] != "offer"


# Shadow 2026-10-12 gate #3 (run 38211044586): businesses and goods, verbatim titles.
@pytest.mark.parametrize("t,b", [
    ("محل للبيع. بوفيه شغاله لها اكثر من 13 سنه. فرصه الي يبغي محل", "عندي بوفيه للبيع شغاله لها اكثر من 13 سنه"),
    ("محل شاهي للبيع", "محل شاهي ومشروبات للبيع مجهز بجميع اغراض"),
    ("غرفة شينكو للبيع كبيرة", ""),
])
def test_shadow_2026_10_12_gate3_business_and_goods_are_not_offers(t, b):
    assert classify(t, b)[0] != "offer"


# Gate #3 (run 38211044586), the two shapes left open on 10-12, verbatim: a seeker naming the
# neighbourhoods they would accept, and a stock list across two neighbourhoods.
@pytest.mark.parametrize("t,b,want", [
    ("محلات ايجار على شارع تجاري في حي الملقا او حطين او العارض", "يكون في الربع ‏ الأحياء هاذي", "request"),
    ("محلات ايجار على شارع تجاري في حي الملقا او حطين او العارض", "", "request"),
    ("شقق للبيع بضاحية الجبيل الحي الاول والحي الثاني", "", "other"),
    ("شقق للبيع في حي النرجس وحي الياسمين", "", "other"),
])
def test_gate3_open_shapes(t, b, want):
    assert classify(t, b)[0] == want


@pytest.mark.parametrize("t,b", [
    ("شقة للبيع في حي الياسمين", "شقة 3 غرف"),
    ("فيلا للبيع حي الملقا", "الواجهة شمالية او شرقية حسب الاختيار"),     # «او» in the body, not a choice of districts
    ("ارض للبيع في الحي الاول بضاحية الجبيل", "المساحة 600"),             # one neighbourhood
])
def test_gate3_one_unit_one_neighbourhood_stays_an_offer(t, b):
    assert classify(t, b)[0] == "offer"


def test_price_on_request_inside_an_offer_stays_an_offer():
    # «طلب» opens a request only at the start of the TITLE (Haraj 18263109, 2026-10-17)
    assert classify("شقة للايجار حي النرجس", "السعر عند الطلب")[0] == "offer"


def test_glued_conjunction_keeps_the_blessing_an_offer():
    # the «نبينا» look-ahead must sit after the optional «و/ف»: «ونبينا» is still the Prophet, not «نبي»
    assert classify("للبيع شقه تمليك حي النرجس", "وصلى الله وسلم ونبينا محمد")[0] == "offer"
