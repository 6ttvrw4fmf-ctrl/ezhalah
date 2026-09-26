"""stated_city() places a listing only in a city its prose NAMES («مدينة X»).

Regression for squares, 2026-09-26: resolve_slug() on listing prose filed 9 of 16 listings in towns
that were only words in the text — «العمارة» (the building), «الخرج» (from «طريق الخرج»), «حجاب»
(from «سوق حجاب»), «العروس» (from «درة العروس»), «الخليج»/«السلام» (the district names). Every
sentence below is copied from those live listings.
"""
import pytest

from scrapers.common import arabic_location as al

_TOWNS = {  # every catalog city the squares prose brushed against, real ids from loc_catalog_city
    "الرياض": (3, 1), "بريدة": (11, 4), "الخرج": (1061, 1), "العمارة": (1300, 1),
    "الخليج": (1470, 1), "حجاب": (1560, 1), "العروس": (3511, 2), "السلام": (4604, 1),
}


@pytest.fixture(autouse=True)
def _catalog(monkeypatch):
    monkeypatch.setattr(al, "_load", lambda: None)
    monkeypatch.setattr(al, "to_catalog", lambda c, region_hint=None: _TOWNS.get((c or "").strip(), (None, None)))


@pytest.mark.parametrize("text, city", [
    ("للبيع فلل البساتين في مدينة بريدة", "بريدة"),
    ("للبيع ارض سكنية في حي المهدية بمدينة الرياض واجهة جنوبية", "الرياض"),
    ("يقع العقار في منطقة زراعية في حي هيت التابع لمدينة الرياض قريب من طريق الخرج السريع", "الرياض"),
    ("ارض سكنية حي السويلميه . مــدينة بريــدة", "بريدة"),            # tatweel inside «مدينة» itself
])
def test_a_named_city_is_found(text, city):
    assert al.stated_city(text)[0] == city


@pytest.mark.parametrize("text", [
    "العماره في منطقة العزيزية الجنوبية يوجد مصعد في العمارة",
    "تقع بالقرب من طرق رئيسية مثل طريق الخرج والدائري الشرقي",
    "للبيع محلات تجارية بحي النسيم في سوق حجاب",
    "شقة مفروشة في درة العروس للإيجار",
    "للبيع فيلا في حي الخليج المساحة : 480 متر مربع",
    "للبيع فيلا في حي السلام المساحة : 360 متر مربع",
])
def test_a_town_named_only_by_a_street_or_district_is_not_a_city(text):
    assert al.stated_city(text) == (None, None, None)

