"""ramzalqasim / erapulse: no structured city → the ONE Qassim city the ad's own words name (backlog 1205).

65 active rows (ramzalqasim 43, erapulse 22) sat quarantined with city NULL while their own text names the city
(«📍 الموقع: حي الرحاب – عنيزة», «أرضين في شمال بريدة», «للإيجار وحده علويه بحي الصفاء – بريدة»). Texts below are
the live rows' own words (2026-11-02). Never a default: two cities, a road name, or a city word inside another
word leave the city NULL. erapulse's page heading «في بريدة» is NOT used — its only addressLocality is the
agency's office (RealEstateAgent), so it is no proof of where the ad is.
"""
from __future__ import annotations

import sys
import types

_supabase_mod = types.ModuleType("supabase")
_supabase_mod.Client = object
_supabase_mod.create_client = lambda url, key: object()
sys.modules.setdefault("supabase", _supabase_mod)
_dotenv_mod = types.ModuleType("dotenv")
_dotenv_mod.load_dotenv = lambda *a, **k: None
sys.modules.setdefault("dotenv", _dotenv_mod)

import pytest  # noqa: E402

from scrapers.common.named_city import single_named_city  # noqa: E402
from scrapers.erapulse.run import parse_location  # noqa: E402
from scrapers.ramzalqasim.run import map_marker  # noqa: E402


@pytest.mark.parametrize("text, want", [
    ("🚨 للبيع – دوبلكس في وسط عنيزة! 📍 الموقع: حي وسط عنيزة – موقع مميز", "Unaizah"),   # ramz 615862
    ("🚨 للبيع – أرضين في شمال بريدة! 📍 الموقع: حي النقيب الشمالي", "Buraidah"),        # ramz 615884
    ("✅ للبيع – عمارة جديدة في حي الريان بالرس", "Ar Rass"),                            # ramz 615869
    ("📍 الموقع: محافظة البدائع 📐 المساحة: 537.5 م²", "Al Badai"),                      # ramz 615851
    ("📍 للبيع أرض سكنية في حي رامات - البدايع", "Al Badai"),                            # ramz 615841
    ("للإيجار وحده علويه بحي الصفاء – بريدة", "Buraidah"),                               # erapulse 648059
    ("حي المصيف – عنيزة قريب من طريق بريدة", "Unaizah"),          # a road named for a city is not the place
    # 2026-11-04: Arabic punctuation right after the city is a word END, not a letter (erapulse 20551803).
    ("تطرح شركة نبض العصر للعقارات فيلا للبيع في حي الفايزية بمدينة بريدة، مصممة لتلبي", "Buraidah"),
    ("أرض للبيع في عنيزة؛ على شارعين", "Unaizah"),
    ("هل تبحث عن فيلا في الرس؟", "Ar Rass"),
])
def test_one_city_named_by_the_ad_is_taken(text, want):
    assert single_named_city([text])[0] == want


@pytest.mark.parametrize("text", [
    "📍 الموقع: حي الخزامى، القصيم",          # region only (ramz 615907)
    "قريب من المدارس والخدمات",               # «الرس» inside «المدارس»
    "أرض في بريدة وعنيزة",                     # two cities → ambiguous
    "📍 الموقع: حي الصهيل",                    # no city at all
    "",
])
def test_no_single_city_stays_null(text):
    assert single_named_city([text]) is None


def test_erapulse_location_no_longer_reads_alras_out_of_almadaris():
    city, _region, _hood = parse_location("حي الفايزية قريب من المدارس")
    assert city is None


def _ramz(description, city=""):
    rec = {"id": 615872, "price": "540000.00", "area": 816.5, "status": "sell", "type": "land", "city": city,
           "district": "الرحاب", "real_estate_age": "جديد", "width_street": "20", "bedrooms": 0, "bathroom": 0,
           "avalible": "available", "description": description}
    row, _cat, _gone = map_marker(rec)
    assert row is not None
    return row


def test_ramzalqasim_row_takes_the_description_city():
    row = _ramz("🚨 للبيع – أرض سكنية في حي الرحاب بعنيزة! 📍 الموقع: حي الرحاب – عنيزة")
    assert row["city"] == "Unaizah"
    assert row["additional_info"]["city_ar"] == "عنيزة" and row["additional_info"]["city_source"] == "description"


def test_ramzalqasim_structured_city_still_wins_and_silence_stays_null():
    assert _ramz("حي الرحاب – عنيزة", city="بريدة")["city"] == "Buraidah"
    row = _ramz("📍 الموقع: حي الرحاب – موقع مميز")
    assert row["city"] is None and "city_source" not in row["additional_info"]


def _era(title, location, description=""):
    from scrapers.erapulse.run import map_listing
    p = {"id": "cmlu12xfj004ku3m8a9vx32vk", "refNumber": "REF-MLU12XET-CD3SX", "status": "ACTIVE", "type": "RESIDENTIAL",
         "subType": "DUPLEX", "isForRent": True, "rentPrice": 30000, "rentPeriod": "YEARLY", "title": title,
         "description": description, "location": location,
         "area": 200, "images": []}
    row, _cat = map_listing(p, {})
    return row


def test_erapulse_row_takes_the_title_city_and_keeps_null_without_one():
    row = _era("للإيجار وحده علويه بحي الصفاء – بريدة", "حي الصفا")          # erapulse 648059, live words
    assert row is not None and row["city"] == "Buraidah"
    assert row["additional_info"]["city_source"] == "title_or_description"
    bare = _era("شاليه بحي التوفيق", "التوفيق")                               # erapulse 648063: names no city
    assert bare is not None and bare["city"] is None and "city_source" not in bare["additional_info"]


def test_arabic_punctuation_does_not_glue_a_city_into_a_longer_word():
    # «المدارس،» is still a word that merely ENDS in الرس — the comma fix must not open that door.
    assert single_named_city(["قريبة من المدارس، والخدمات"]) is None
    # and a real two-city text stays ambiguous with punctuation in between
    assert single_named_city(["بين بريدة، وعنيزة"]) is None
