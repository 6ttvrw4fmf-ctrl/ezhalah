"""opensooq: amenities from the ad's own words, yes or nothing (🔬 AF engineer, 2026-10-14).

opensooq has no structured amenity field (its card chips carry rooms, baths, furnished, area, floor, age and
period). CI source-reread 38544519028: 13605230 says «مطبخ مجهز بالأجهزة الكهربائية … مصعد خاص من داخل الشقة»
and stored NULL for both; 0 of 62 active ads carried any amenity answer.
"""
import pytest

import scrapers.opensooq.run as R


@pytest.fixture(autouse=True)
def _catalog(monkeypatch):
    monkeypatch.setattr(R, "to_catalog", lambda c, region_hint=None: (18, 2) if c else (None, None))
    monkeypatch.setattr(R, "find_district_in_text", lambda t, cid: None)


def _x(desc):
    return {"id": 1, "cat1_code": "RealEstateForSale", "cat2_code": "ApartmentsForSale", "title": "شقة فاخرة للبيع",
            "price_amount": "660,000 ريال", "city_label": "المدينة المنورة", "nhood_label": "شوران",
            "cps": ["مفروشة"], "masked_description": desc}


def test_the_ad_words_answer_kitchen_and_elevator():
    (row, _), _ = R.map_listing(_x("التفاصيل: • 4 غرف + صالة • مطبخ مجهز بالأجهزة الكهربائية • مصعد خاص من داخل الشقة…"))
    assert row["kitchen"] is True and row["elevator"] is True
    assert row["furnished"] is True          # still the chip's answer


def test_prose_says_an_explicit_no_and_never_touches_furnished():
    (row, _), _ = R.map_listing(_x("لا يوجد مصعد، الشقة غير مؤثثة"))
    assert row["elevator"] is False and row["furnished"] is True   # the structured chip still wins furnished
    (row, _), _ = R.map_listing(_x(""))
    assert not any(c in row for c in R._PROSE_COLS)
