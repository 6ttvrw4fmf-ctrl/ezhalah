"""Haraj post classifier — OFFER vs REQUEST vs NOT-PROPERTY (owner order 2026-10-09, backlog 311).

The owner's one rule: only real property OFFERS may ever become listings. A REQUEST («مطلوب شقة»,
«ابغى ارض») or a non-property post (job seekers, workers, furniture, services) must never appear.
Doubt is NOT shown (source is truth: a half-understood post is not a listing). So the order is:

  1. any request phrase in the title or body          -> "request"   (never stored)
  2. any non-property phrase (jobs, workers, goods)    -> "other"     (never stored)
  3. the REGA ad block, OR an offer phrase + a type    -> "offer"
  4. anything else                                     -> "doubt"     (never stored)

Pure functions only — no network, no DB — so every rule is pinned by
scrapers/common/tests/test_haraj_classify.py.
"""
from __future__ import annotations

import re
from typing import Optional

_AR = "ء-ي"
_B = rf"(?<![{_AR}])"     # Arabic whole-word boundaries
_E = rf"(?![{_AR}])"


def _norm(s: Optional[str]) -> str:
    s = s or ""
    s = re.sub(r"[ًٌٍَُِّْـ]", "", s)                  # tashkeel + tatweel
    s = re.sub(r"[أإآ]", "ا", s)
    s = s.replace("ى", "ي").replace("ة", "ه")
    s = re.sub(r"(.)\1{2,}", r"\1", s)                 # «مطلوووببب» -> «مطلوب» (shadow 2026-10-10)
    return re.sub(r"\s+", " ", s).strip()


# Requests: someone LOOKING for a property. Normalised spelling (أ→ا, ى→ي, ة→ه).
# A request word may carry a gender / number / object suffix: «محتاجه», «محتاجين», «ابيها», «ابغاها»
# (shadow v3 2026-10-10: «تكفون محتاجه شقة عوائل» slipped through as an offer because only «محتاج»
# was listed). «تكفون / تكفى» (please, I beg you) opens requests, never offers.
_REQUEST = re.compile(
    # «نبينا» (our Prophet, in a seller's opening blessing) is not «نبي» + «نا» (shadow 2026-10-12,
    # 11190371478 «للبيع شقة تمليك … اللهم صل وسلم على نبينا محمد» read as a request).
    # «و/ف» glued in front is still the word: «بنت وابحث عن استديو للإيجار» (HRJ11190725389 stored as an
    # offer, owner check 2026-10-17). The «نبينا» look-ahead sits AFTER the prefix so «ونبينا» stays a blessing.
    _B + r"(?:[وف])?(?!نبينا" + _E + r")(?:"
    r"(?:بحث|مطلوب|نبي|ابغي|ابغا|ابي|ابحث|نبحث|يبحث|تبحث|احتاج|نحتاج|تحتاج|يحتاج|محتاج|بحاجه|ودي|"
    r"ارغب|نرغب|يرغب|ترغب|ادور|ندور|يدور|تدور)(?:ه|ها|ين|ون|هم|نا|ي)?|"
    r"تكفون|تكفي|من عنده|مين عنده|من لديه|احد عنده|ممكن احد|اللي عنده|الي عنده|اللي يعرف|الي يعرف|"
    # «… يكون في الربع» — where the unit SHOULD be is a seeker's wish (gate #3 2026-10-12, 11190353094
    # «محلات ايجار على شارع تجاري في حي الملقا او حطين او العارض», body «يكون في الربع الأحياء هاذي»).
    r"يكون في|يكون ب|تكون في|تكون ب"
    r")" + _E
)

# A title that OPENS with «طلب» is a request («طلب شقه للايجار مستعجل», Haraj 18263109 was stored as an offer,
# 2026-10-17). Title start only: «السعر عند الطلب» / «حسب الطلب» inside an offer stay offers.
_REQUEST_TITLE_START = re.compile(r"^(?:ال)?طلب" + _E)

# A title offering a choice of neighbourhoods («في حي الملقا او حطين او العارض») describes what a
# seeker will accept, never one unit's address (gate #3 2026-10-12, 11190353094). Title only.
_ALTERNATIVES_TITLE = re.compile(_B + r"حي\s+[^\s]+(?:\s+[^\s]+)?\s+او\s+(?:حي\s+)?[^\s]+")

# Not property: jobs, workers, services, goods.
_OTHER = re.compile(
    _B + r"(?:"
    r"عامل|عماله|عمال|حارس|سائق|سواق|خادمه|عاملات|وظيفه|وظائف|عن عمل|راتب|نقل كفاله|كفاله|"
    r"نقل عفش|عفش|سياره|سيارات|جوال|(?:لل|ل|و|ب)?(?:ال)?تقبيل|مقاول|مقاولات|ترميم|صيانه|"
    r"دهانات|سباك|تنظيف|مكافحه حشرات|مظلات|سواتر|عزل|تشطيب|نقوم ب|نوفر لكم|نقدم لكم|خدمه الاعلان|"
    r"خدمه تسويق|نسوق لك|معلن عقاري|شريك|شراكه|تسوقه|نخدمك|"
    # A broker's services post and a transport / licensing office (shadow 2026-10-12: 11190372375 «لديك
    # الرغبة في شراء ارض او … بيع ارض … نوفر لك السعر», 11190376087 «نقل ثقيل وخفيف … نستخلص كافة اجراءات»).
    r"نوفر لك|لديك الرغبه|حاب تستفسر|نقل ثقيل|نقل خفيف|نستخلص|"
    # A broker's «we buy and sell in these plans» and a stock list across neighbourhoods name no unit
    # (shadow 2026-10-12 window 2: 11190324509 «للبيع والشراء في مخططات طيبه الفرعيه», 11190324807
    # «يوجد لدينا شقق مفروشة … بعدة احياء»).
    r"للبيع والشراء|البيع والشراء|يوجد لدينا|بعده احياء|بعده مواقع|"
    # An agency's catalogue ad («يتوفر لدينا شقق وأراضي ومزارع») names no unit: not a listing
    # (shadow 2026-10-11, 11190296071).
    r"يتوفر لدينا|تتوفر لدينا|متوفر لدينا|متوفره لدينا"
    r")" + _E
)

# Furniture words count only in the TITLE: «غرفة نوم» in an apartment offer's BODY describes the flat
# (shadow 2026-10-10, 11190241633), while a furniture post names it in its title.
# Shadow 2026-10-11 (105 «offer» verdicts hand-checked): a «محل … للبيع» on Haraj is usually a
# BUSINESS for sale (a tailor's, a clothing shop with its stock), and a car model in the title is a car
# (11190298600, 11190299205, 11190299633). Title-only, like the furniture words: a flat's body may say
# «قريب من مطعم».
_OTHER_TITLE = re.compile(
    _B + r"(?:غرفه نوم|غرف نوم|كنب|كنبه|طقم|دولاب|مطبخ مستعمل|"
    r"كماليات|ملابس|خياط|خياطه|بضاعه|معدات|مطعم|كوفي|كافيه|بقاله|صالون|حلاق|مشغل|"
    # Shadow 2026-10-12 gate #3: a buffet and a tea shop sold as going businesses, and a portable
    # sheet-metal room sold as goods (11190352246, 11190346681, 11190351832).
    r"بوفيه|شاهي|مشروبات|شينكو|"
    r"كامري|كورولا|هايلكس|لاندكروزر|يوكن|تاهو|سوناتا|النترا|اكسنت|جمس|ددسن|لكزس|مرسيدس|افالون|اكورد|"
    r"كابرس|شاص|فورد|نيسان|هونداي|تويوتا|"
    # A broker's catalogue or intake post names no unit (fresh shadow 2026-10-11: «يوجد لدينا أراضي وعمائر
    # عروض قويه», «نستقل شقق للايجار … نستقبل الشقق», «موجود جيمع البيوت للبيع»).
    r"عروض|العروض|جميع|جيمع|نستقبل|نستقل|لدينا)" + _E)

# The REGA (الهيئة العامة للعقار) ad block every licensed Saudi property ad carries.
# A catalogue title names two kinds of unit at once («ادوار وشقق للبيع», «شقق وملحق فلل للبيع في جده»,
# shadow 2026-10-12) and no single unit. One building that IS a villa plus flats («فيلا و3 شقق») names a
# singular first and is not caught.
_CATALOGUE_TITLE = re.compile(
    _B + r"(?:شقق|ادوار|فلل|اراضي|محلات|عمائر|مكاتب|مستودعات)\s+و\s*(?:ملحق\s+|ملاحق\s+)?"
    r"(?:شقق|ادوار|فلل|اراضي|محلات|عمائر|مكاتب|مستودعات)" + _E
    # Two neighbourhoods at once («… الحي الاول والحي الثاني», «حي النرجس وحي الياسمين») is a stock list,
    # not one unit's address (gate #3 2026-10-12, 11190351267 «شقق للبيع بضاحية الجبيل الحي الاول والحي
    # الثاني»).
    + r"|" + _B + r"(?:ال)?حي\s+[^\s]+\s+و\s*(?:ال)?حي" + _E)

_REGA = re.compile(
    r"رقم ترخيص الاعلان|ترخيص الاعلان|رقم الترخيص|رخصه فال|رقم المعلن|سعر الوحده|نوع العقار|"
    r"اعلان\s*:\s*(?:بيع|ايجار|تاجير)"
)

_OFFER_PHRASE = re.compile(_B + r"(?:للبيع|للايجار|للاجار|للتاجير|ايجار|بيع|تمليك)" + _E)

_TYPE = re.compile(
    _B + r"(?:ال)?(?:"
    r"شقه|شقق|فيلا|فله|فلل|ارض|اراضي|عماره|عمائر|دور|ادوار|استراحه|استراحات|محل|محلات|مستودع|"
    r"مستودعات|مزرعه|مزارع|شاليه|شاليهات|بيت|بيوت|منزل|دبلكس|دوبلكس|مكتب|مكاتب|معرض|غرفه|غرف|"
    r"قصر|مخطط|بلك|عقار|ملحق|روف|تاون هاوس|مجمع|بنايه|حوش"
    r")" + _E
)


def classify(title: Optional[str], body: Optional[str]) -> tuple[str, str]:
    """(verdict, reason). verdict ∈ offer | request | other | doubt. Only 'offer' may be stored."""
    t, b = _norm(title), _norm(body)
    both = f"{t} \n {b}"
    m = _REQUEST.search(both) or _REQUEST_TITLE_START.search(t) or _ALTERNATIVES_TITLE.search(t)
    if m:
        return "request", f"request word «{m.group(0)}»"
    m = _OTHER.search(both) or _OTHER_TITLE.search(t) or _CATALOGUE_TITLE.search(t)
    if m:
        return "other", f"non-property word «{m.group(0)}»"
    if _REGA.search(b) and _TYPE.search(both):
        return "offer", "REGA ad block + property type"
    mo, mt = _OFFER_PHRASE.search(both), _TYPE.search(both)
    if mo and mt:
        return "offer", f"offer «{mo.group(0)}» + type «{mt.group(0)}»"
    return "doubt", "no REGA block and no offer phrase with a property type"
