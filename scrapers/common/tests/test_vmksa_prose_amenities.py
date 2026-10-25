"""vmksa: the ad's own description answers kitchen / lift / parking / furnished, YES or nothing — vmksa publishes
no structured field for them (its lists are utilities only). 🔬 2026-10-18: 187 listings, every amenity column
NULL, ops_af_score vmksa 0 of 4 findable.

Run: python -m pytest scrapers/common/tests/test_vmksa_prose_amenities.py -v
"""
from __future__ import annotations

import scrapers.vmksa.run as R


def test_description_states_kitchen_and_parking():
    # verbatim vmksa_residential_listings:13604857 (phone-free excerpt)
    d = ("الشقة 4 غرف + 3 حمامات + صالة + مطبخ ــــــــ المميزات والضمانات ــــــــ خزانات داخلية وارضي مستقل "
         "يوجد عداد كهرباء يوجد موقف سيارة مستقل ومضلل")
    got = R.prose_answers(d)
    assert got.get("kitchen") is True and got.get("parking") is True


def test_villa_kitchen():
    # verbatim vmksa_residential_listings:13604867 excerpt
    d = "الدور الأرضي يتكون من مجلس ومقلط وصاله ومطبخ دورتين مياه درج داخلي"
    assert R.prose_answers(d).get("kitchen") is True


def test_negation_is_a_no_and_prepared_stays_unknown():
    assert R.prose_answers("بدون مصعد").get("elevator") is False     # owner 2026-10-24
    assert R.prose_answers("تأسيس مصعد").get("elevator") is None


def test_fiber_is_structured_only():
    assert "optical_fibers" not in R.prose_answers("يوجد الياف بصرية")


def test_silence_is_nothing():
    assert R.prose_answers("") == {} and R.prose_answers(None) == {}
