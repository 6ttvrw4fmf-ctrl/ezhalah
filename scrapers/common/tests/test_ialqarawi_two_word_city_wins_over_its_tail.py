"""ialqarawi: a two-word city in the title is the city, not its last word (2026-10-14).

Measured on production: «… بمدينة حفر الباطن» was served in «الباطن» (a Qassim village, 15 listings),
«… بمدينة رياض الخبراء» in «الخبراء» (10), and «… بحي الزهرة بمدينة المنورة» in «الزهرة» (3 rows whose
district became the city). city_from_title asked the one-word tail before the two-word name ending on
it. Windows are now anchored on their last token, longest first, and «(ب)مدينة المنورة» is read as
«المدينة المنورة».
"""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scrapers.common.arabic_location import norm_ar  # noqa: E402
from scrapers.ialqarawi import run as R  # noqa: E402

# The production catalog rows involved (loc_catalog_city, read 2026-10-14).
CATALOG = {"حفر الباطن": (47, 5), "الباطن": (2455, 4), "رياض الخبراء": (2467, 4), "الخبراء": (2486, 4),
           "المدينه المنوره": (14, 3), "الزهره": (3300, 6), "السلام": (4604, 1), "العوينه": (3063, 3),
           "الرياض": (1, 1), "بدر": (900, 3), "عنيزه": (80, 4)}


def _stub(monkeypatch):
    monkeypatch.setattr(R, "to_catalog", lambda name, region_hint=None: CATALOG.get(norm_ar(name), (None, None)))


def test_hafr_al_batin_is_not_the_qassim_village(monkeypatch):
    _stub(monkeypatch)
    assert R.city_from_title("للبيع دور ارضي بحي الشروق بمدينة حفر الباطن")[1] == 47


def test_riyadh_al_khabra_is_not_al_khabra(monkeypatch):
    _stub(monkeypatch)
    assert R.city_from_title("للبيع حوش بحي زبيدة بمدينة رياض الخبراء")[1] == 2467


def test_madinah_is_not_the_district_before_it(monkeypatch):
    _stub(monkeypatch)
    for t in ("للبيع دور بحي الزهرة بمدينة المنورة", "للبيع أرض سكنية بحي السلام بمدينة المنورة",
              "للبيع أرض خام بحي العوينة بمدينة المنورة"):
        assert R.city_from_title(t)[1] == 14, t


def test_one_word_cities_still_resolve(monkeypatch):
    _stub(monkeypatch)
    assert R.city_from_title("للبيع قصر بحي بدر بمدينة الرياض")[1] == 1
    assert R.city_from_title("للبيع أرض سكنية بحي المحمدية بعنيزة")[1] == 80
