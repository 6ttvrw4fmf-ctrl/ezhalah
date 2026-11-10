"""⚡ 2026-11-10: a property-type noun without «ال» is the property, never a district.

norm_district_tok() drops the article, so «شقة» (apartment) equalled Buraydah's district «الشقة»: albdah filed
«شقة للإيجار في بريدة في العليا» (19983353) and «شقة للبيع في بريدة» (19983374) under «حي الشقة».
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

from scrapers.common import arabic_location as L  # noqa: E402

CITY = 777


def _catalog(monkeypatch, names):
    monkeypatch.setattr(L, "_load", lambda: None)
    known = {L.norm_district_tok(n) for n in names}
    monkeypatch.setitem(L._DISTRICT_BY_CITY, CITY, known)
    for n in names:
        monkeypatch.setitem(L._DISTRICT_AR_BY_NORM, L.norm_district_tok(n), "حي " + n.removeprefix("ال"))
    monkeypatch.setattr(L, "_squeezed_key", lambda cid, n: None)


def test_the_word_apartment_is_not_the_district_alshiqqa(monkeypatch):
    _catalog(monkeypatch, ["الشقة", "الصفراء"])
    assert L.find_district_in_text("شقة للبيع في بريدة", CITY) is None
    assert L.find_district_in_text("شقة للإيجار في بريدة في العليا", CITY) is None
    assert L.find_district_in_text("مزرعة للبيع", CITY) is None


def test_a_district_named_with_its_article_still_matches(monkeypatch):
    _catalog(monkeypatch, ["الشقة", "الصفراء"])
    assert L.find_district_in_text("أرض للبيع في بريدة في الشقة", CITY) is not None
    assert L.find_district_in_text("شقة للإيجار في بريدة في الصفراء", CITY) is not None
    assert L.find_district_in_text("أرض للبيع حي الشقة", CITY) is not None

