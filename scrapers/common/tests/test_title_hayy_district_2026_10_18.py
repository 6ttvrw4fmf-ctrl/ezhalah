"""A title that names its district: «حي X» from the ad's own title, exact keys only (2026-10-18).

ialqarawi (100 of 231 rows with no district) and ksaaqar (44 of 377) titles say «بحي X»; X is often a district the
catalogue lacks but the served index already carries for that city (another source's word — the Filter offers it).
The title's own spelling is kept when its key is EXACTLY a known key for the city; a direction («شرق الرياض»), a
place word or a preposition is never a district name, and nothing fuzzy is accepted. Titles below are recorded.

Run: python -m pytest scrapers/common/tests/test_title_hayy_district_2026_10_18.py -v
"""
import pytest

from scrapers.common import arabic_location as AL

KNOWN = frozenset(AL.norm_district_tok(x) for x in ("المليداء", "شعب عامر", "المروة", "العارض", "الأندلس", "الشرق"))


@pytest.mark.parametrize("title, want", [
    ("للبيع أرض سكنية بحي المليداء بمدينة بريدة", "حي المليداء"),          # ialqarawi
    ("للبيع مزرعة بحي شعب عامر مدينة مكة المكرمة", "حي شعب عامر"),          # two words, ialqarawi
    ("شقق تمليك للبيع بحي المروة", "حي المروة"),                           # ksaaqar
    ("للبيع فيلا مساحة 338 حي العارض", "حي العارض"),                       # ksaaqar
])
def test_a_titled_known_district_is_kept_in_the_titles_spelling(title, want):
    assert AL.title_hayy_district(title, KNOWN) == want


@pytest.mark.parametrize("title", [
    "للبيع أرض سكنية بمخطط شرق الرياض",                    # no «حي»
    "للبيع أرض خام بحي شرق الرياض",                        # a direction, not «الشرق»
    "للبيع أرض زراعية مقام عليها فيلا دورين بحي بالقرب من طريق المدينة",   # a preposition
    "فله للبيع في حي راقي جدا قريب من البحر",              # «a fancy area», not a district
    "للبيع أرض سكنية بحي العزالة بمدينة حائل",             # a district nobody knows for the city: nothing
    "للبيع أرض سكنية بحي المليد بمدينة بريدة",              # a near miss of «المليداء» is not it (never fuzzy)
])
def test_mutation_no_direction_place_word_or_near_miss_is_a_district(title):
    assert AL.title_hayy_district(title, KNOWN) is None


def test_the_ksaaqar_row_takes_the_titles_district_and_its_provenance(monkeypatch):
    import scrapers.ksaaqar.run as K
    from scrapers.common.tests.test_ksaaqar_location_field_district_2026_10_18 import SPEC, _post
    monkeypatch.setattr(K, "to_catalog", lambda city_ar, region_hint=None: (1, 1))
    monkeypatch.setattr(K, "find_district_in_text", lambda text, city_id: None)
    monkeypatch.setattr(K, "known_district_keys", lambda city_id: KNOWN)
    row, _cat, why = K.map_listing(_post("شقق تمليك للبيع بحي المروة"), SPEC.replace("الملقا، ", "عقارات الرياض، "), "")
    assert row is not None, why
    assert row["district_ar"] == "حي المروة" and row["neighborhood"] == "حي المروة"
    assert row["additional_info"]["district_source"] == "title"


def test_no_database_means_nothing_known():
    assert AL.known_district_keys(1) == frozenset() or AL.os.environ.get("SUPABASE_URL")
