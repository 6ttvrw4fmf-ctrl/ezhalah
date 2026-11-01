"""wslnaa: the bathroom count the ad's own layout sentence states (🔬 AF engineer, 2026-10-11, backlog 263).

wslnaa's payload has no bathroom field; its description is the only place the count is stated. Every sentence
below is verbatim from a live wslnaa ad (stored description, 2026-10-11). A mix of a singular and a dual is not
summed: «غرفة ماستر بدورة مياه، ودورتي مياه» is 3 in total, and guessing 2 would be a wrong answer.
"""
import sys
from unittest import mock

import pytest

sys.path.insert(0, ".")

for name in ("supabase", "dotenv"):
    if name not in sys.modules:
        stub = mock.MagicMock()
        if name == "dotenv":
            stub.load_dotenv = lambda *a, **k: None
        sys.modules[name] = stub

import scrapers.wslnaa.run as W  # noqa: E402

W.to_catalog = lambda city_ar, region_hint=None: (1, 1)
W.find_district_in_text = lambda text, city_id: None

CASES = [
    # wslnaa_residential_listings:15456263
    ("تتكون من غرفتي نوم وصالة صغيرة ومطبخ ودورتي مياه. الإيجار السنوي 40,000 ريال شامل كل شيء.", 2),
    # :12390352 — the digit count wins; the explanatory singular after it is not a second count
    ("تتكون من 3 غرف نوم و4 دورات مياه وصالة كبيرة ومطبخ، وكل غرفة نوم معها دورة مياه.", 4),
    # :15456258
    ("تتكون من غرفتي نوم وصالة كبيرة ومطبخ و3 دورات مياه.", 3),
    # :15456276 — a studio
    ("يتكون من غرفة بدون صالة ومطبخ ودورة مياه. الإيجار السنوي 20,000 ريال شامل كل شيء.", 1),
    # :12390346 — master bath plus two: 3 in total, not stated as one number → unknown
    ("تتكون من غرفتي نوم، منها غرفة ماستر بدورة مياه، ودورتي مياه وصالة ومطبخ.", None),
    ("شقة واسعة قريبة من الخدمات.", None),
]


@pytest.mark.parametrize("text,baths", CASES)
def test_the_layout_sentence_states_the_count(text, baths):
    assert W._bathrooms_from_text(text) == baths


def _p(type_en: str, description: str) -> dict:
    return {"id": 1, "active": True, "status": "available", "type": type_en, "mode": "rent", "region": "الرياض",
            "district": "الملز", "price": 40000, "rentPeriod": "yearly", "slug": "x", "description": description}


def test_an_apartment_row_carries_it():
    row, _, why = W.map_listing(_p("apartment", CASES[0][0]))
    assert why == "" and row["bathrooms"] == 2


def test_a_building_does_not_turn_each_flats_bathroom_into_its_own():
    # :12390342 «41 شقة … كل شقة تتكون من غرفة ومطبخ ودورة مياه» — one per flat, not one for the building
    row, _, why = W.map_listing(_p("building", "يضم 41 شقة متاحة، كل شقة تتكون من غرفة ومطبخ ودورة مياه"))
    assert why == "" and row["bathrooms"] is None
