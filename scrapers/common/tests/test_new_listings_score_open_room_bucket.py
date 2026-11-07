"""new_listings_score: «+7 غرف نوم» / «7+ حمامات» is an open bucket (N or more), not a count (🆕, 2026-11-07).

Score run 42343488034 put propertyfinder under 99% on 24671162: the page prints «عدد غرف النوم +7 غرف نوم» and
«الحمامات 7+ حمامات», while Property Finder's own payload says bedrooms_value 20, bathrooms_value 9 (we store those).
A stored count at or above the bucket's floor matches; a count below it is still a MISMATCH.
"""
from scrapers.common import new_listings_score as S


def _cmp(stored: dict, body: str, field: str) -> str:
    return S.compare_listing(stored, S.page_evidence(body))[field]


PF = "<p>عدد غرف النوم</p><p>+7 غرف نوم</p><p>الحمامات</p><p>7+ حمامات</p>"


def test_counts_at_or_above_the_bucket_match():
    assert _cmp({"bedrooms": 20}, PF, "bedrooms") == S.MATCH
    assert _cmp({"bedrooms": 7}, PF, "bedrooms") == S.MATCH
    assert _cmp({"bathrooms": 9}, PF, "bathrooms") == S.MATCH


def test_counts_below_the_bucket_still_mismatch():
    assert _cmp({"bedrooms": 5}, PF, "bedrooms") == S.MISMATCH
    assert _cmp({"bathrooms": 3}, PF, "bathrooms") == S.MISMATCH


def test_a_plain_count_is_unchanged():
    assert _cmp({"bedrooms": 20}, "<p>4 غرف نوم</p>", "bedrooms") == S.MISMATCH


def test_the_bucket_belongs_to_its_own_field_coderabbit_11031():
    line = "<p>عدد غرف النوم: 4، الحمامات: 7+</p>"
    assert _cmp({"bedrooms": 9}, line, "bedrooms") == S.MISMATCH
    assert _cmp({"bathrooms": 9}, line, "bathrooms") == S.MATCH


def test_the_mismatch_log_redacts_phones_and_names_the_compared_price(capsys):
    page = S.page_evidence("<p>غرف النوم 4 هاتف 0501234567</p><p>السعر 650,000 ريال</p>")
    S._log_verdicts("t:1", {"bedrooms": S.MISMATCH, "price": S.MISMATCH, "district": S.MISMATCH},
                    {"bedrooms": 5, "price_total": 640000, "district_ar": "حي الزهور"}, page)
    out = capsys.readouterr().out
    assert "0501234567" not in out
    assert "stored=640000" in out
    assert "district: stored='حي الزهور' page=[]" in out
