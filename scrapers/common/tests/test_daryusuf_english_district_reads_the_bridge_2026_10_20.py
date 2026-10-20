"""daryusuf's English-only posts name their district in English («Apartment for Rent, Al Difaa District,
Madinah») and were stored with district_ar NULL: ~190 Madinah/Jeddah ads a customer who picks the district
never found (unknown_named_districts, 2026-10-20: «Al Difaa district» 5, «Al Salam district» 5, «Shuran
district» 5, «Al Safa district» 5 …). The answer is the shared source-attested bridge (dealapp's bilingual
pairs, public.district_name_bridge) — the rightcompound/compoundin path — confirmed against the city's own
catalogue. Bridge pairs below are VERBATIM rows of district_name_bridge read 2026-10-20. Runs the SHIPPING
`map_listing` / `english_district`; offline."""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

from scrapers.daryusuf import run as R  # noqa: E402

_CITIES = {"المدينة المنورة": (14, 3), "جدة": (18, 2)}
_CATALOG = {14: {"حي الدفاع", "حي السلام", "حي شوران", "حي المطار", "حي العنابس"}, 18: {"حي الصفا"}}
_BRIDGE = {
    "Medina": (("Al Difaa district", "حي الدفاع"), ("Ad Difa Dist.", "حي الدفاع"), ("Al Salam District", "حي السلام"),
               ("Shuran Dist.", "حي شوران"), ("Al-Matar District", "حي المطار"), ("Al Anabis district", "حي العنابس"),
               ("Al Nakhil", "حي النخيل"), ("Al Nakhil", "حي النخيل الغربي")),       # two answers = no answer
    "Jeddah": (("Al Safa district", "حي الصفا"),),
}


@pytest.fixture(autouse=True)
def _offline(monkeypatch):
    monkeypatch.setattr(R, "to_catalog", lambda c, region_hint=None: _CITIES.get(c, (None, None)))
    monkeypatch.setattr(R, "find_district_in_text",
                        lambda t, cid: t if t and t in _CATALOG.get(cid, set()) else None)
    monkeypatch.setattr(R, "bridge_rows", lambda city_en: _BRIDGE.get(city_en, ()))
    R._bridge_en_ar.cache_clear()


def _post(title: str, pid: int = 9901) -> dict:
    return {"id": pid, "link": f"https://daryusuf.com/en/portfolio/x-{pid}/", "status": "publish",
            "title": {"rendered": title}, "content": {"rendered": "<h2>30,000 SAR/ Year</h2>"},
            "portfolio_cat": [170], "featured_media": pid, "date_gmt": "2026-10-19T10:00:00",
            "modified_gmt": "2026-10-19T10:00:00"}


@pytest.mark.parametrize("title,district", [
    ("Apartment for Rent, Al Difaa District, Madinah", "حي الدفاع"),
    ("Apartment for Rent, Al-Matar District, Madinah", "حي المطار"),
    ("Apartment for Rent, Shuran district, Madinah", "حي شوران"),
    ("Apartment for Rent, Al Safa district, Jeddah", "حي الصفا"),
])
def test_an_english_district_reaches_the_catalogue(title, district):
    row, _, why = R.map_listing(_post(title), {170: "apartments-for-rent"})
    assert row and not why
    assert row["district_ar"] == district
    assert row["neighborhood"].endswith(("District", "district"))           # the source's words stay on the card


def test_a_name_the_bridge_does_not_hold_stays_null():
    assert R.english_district("Al-Aridh District", "المدينة المنورة", 14) is None   # bridge spells it «Al-Arid»
    assert R.english_district("Al Nakhil District", "المدينة المنورة", 14) is None  # two Arabic answers


def test_the_bridge_answer_must_be_in_this_citys_catalogue():
    assert R.english_district("Al Safa district", "المدينة المنورة", 14) is None    # Jeddah's pair, not Madinah's


def test_a_tail_is_tried_but_never_past_a_direction_word():
    assert R.english_district("Furnished Apartment Al Salam District", "المدينة المنورة", 14) == "حي السلام"
    assert R.english_district("North Al Salam District", "المدينة المنورة", 14) is None
