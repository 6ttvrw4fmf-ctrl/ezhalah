"""Backlog 311 (owner 2026-10-09): only real property OFFERS from Haraj may become listings.
The titles below are the owner session's 2026-10-09 sample (ids in the backlog evidence) plus traps.
Run: python -m pytest scrapers/common/tests/test_haraj_classify.py -v
"""
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

from scrapers.haraj.classify import classify  # noqa: E402

REQUESTS = ["مطلوب شقه للايجار في حي النرجس", "ابغا شقة عزاب", "مطلوب عمارة للإيجار",
            "أبحث عن أرض في شمال الرياض", "ابي فيلا للبيع بالتقسيط", "نبي استراحة للإيجار الشهري",
            "من عنده ارض للبيع في الخرج", "أرغب في شراء دور"]
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
