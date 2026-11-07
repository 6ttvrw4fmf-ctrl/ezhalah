"""tamyaz files some ads under its category PLURALS (2026-11-07).

Every nightly run since 11-02 skipped 4 live ads as type_unmapped_فيلل / _عمائر ×2 / _مكاتب, so they never reached a
customer. They are the same types as the singulars the scraper already maps; the title check still skips an ad
whose own first word names a different type.
"""
from __future__ import annotations

import pytest

from scrapers.tamyaz import run as T


@pytest.fixture(autouse=True)
def _no_catalogue(monkeypatch):
    monkeypatch.setattr(T, "to_catalog", lambda city, region=None: (6, 2))
    monkeypatch.setattr(T, "find_district_in_text", lambda text, cid: None)


def _p(type_ar, title):
    return {"id": "prop-1", "published": True, "title": {"ar": title}, "type": {"ar": type_ar},
            "location": {"ar": "منطقة مكة المكرمة - جدة - الورود"}, "price": 2500000, "forSale": True}


@pytest.mark.parametrize("type_ar,title,want", [
    ("فيلل", "فيلا للبيع في جدة", "Villa"),
    ("عمائر", "عمارة للبيع جدة", "Building"),
    ("مكاتب", "مكتب للبيع", "Office"),
])
def test_plural_type_reaches_the_index(type_ar, title, want):
    row, _cat, why = T.map_listing(_p(type_ar, title))
    assert row is not None, why
    assert row["property_type"] == want


def test_a_plural_type_contradicted_by_the_title_is_still_skipped():
    row, _cat, why = T.map_listing(_p("فيلل", "شقة للبيع في جدة"))
    assert row is None and why == "type_title_conflict"
