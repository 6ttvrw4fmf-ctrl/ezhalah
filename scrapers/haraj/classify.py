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
    return re.sub(r"\s+", " ", s).strip()


# Requests: someone LOOKING for a property. Normalised spelling (أ→ا, ى→ي, ة→ه).
_REQUEST = re.compile(
    _B + r"(?:"
    r"مطلوب|مطلوبه|نبي|ابغي|ابغا|ابغى|ابي|ابحث|نبحث|يبحث|تبحث|احتاج|نحتاج|محتاج|ودي|"
    r"ارغب|نرغب|يرغب|من عنده|مين عنده|من لديه|احد عنده|ممكن احد"
    r")" + _E
)

# Not property: jobs, workers, services, goods.
_OTHER = re.compile(
    _B + r"(?:"
    r"عامل|عماله|عمال|حارس|سائق|سواق|خادمه|عاملات|وظيفه|وظائف|عن عمل|راتب|نقل كفاله|كفاله|"
    r"نقل عفش|عفش|غرفه نوم|غرف نوم|كنب|سياره|سيارات|جوال|تقبيل|مقاول|مقاولات|ترميم|صيانه|"
    r"دهانات|سباك|تنظيف|مكافحه حشرات|مظلات|سواتر|عزل|تشطيب|نقوم ب|نوفر لكم"
    r")" + _E
)

# The REGA (الهيئة العامة للعقار) ad block every licensed Saudi property ad carries.
_REGA = re.compile(
    r"رقم ترخيص الاعلان|ترخيص الاعلان|رقم الترخيص|رخصه فال|رقم المعلن|سعر الوحده|نوع العقار|"
    r"اعلان\s*:\s*(?:بيع|ايجار|تاجير)"
)

_OFFER_PHRASE = re.compile(_B + r"(?:للبيع|للايجار|للاجار|للتاجير|ايجار|بيع)" + _E)

_TYPE = re.compile(
    _B + r"(?:ال)?(?:"
    r"شقه|شقق|فيلا|فله|فلل|ارض|اراضي|عماره|عمائر|دور|ادوار|استراحه|استراحات|محل|محلات|مستودع|"
    r"مستودعات|مزرعه|مزارع|شاليه|شاليهات|بيت|بيوت|منزل|دبلكس|دوبلكس|مكتب|مكاتب|معرض|غرفه|غرف|"
    r"قصر|مخطط|بلك|عقار|ملحق|روف|تاون هاوس|مجمع|بنايه"
    r")" + _E
)


def classify(title: Optional[str], body: Optional[str]) -> tuple[str, str]:
    """(verdict, reason). verdict ∈ offer | request | other | doubt. Only 'offer' may be stored."""
    t, b = _norm(title), _norm(body)
    both = f"{t} \n {b}"
    m = _REQUEST.search(both)
    if m:
        return "request", f"request word «{m.group(0)}»"
    m = _OTHER.search(both)
    if m:
        return "other", f"non-property word «{m.group(0)}»"
    if _REGA.search(b) and _TYPE.search(both):
        return "offer", "REGA ad block + property type"
    mo, mt = _OFFER_PHRASE.search(both), _TYPE.search(both)
    if mo and mt:
        return "offer", f"offer «{mo.group(0)}» + type «{mt.group(0)}»"
    return "doubt", "no REGA block and no offer phrase with a property type"
