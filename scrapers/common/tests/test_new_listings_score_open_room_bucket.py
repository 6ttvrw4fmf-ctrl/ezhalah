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
    assert "هاتف" not in out
    assert "stored=640000" in out
    assert "district: stored='حي الزهور' page=[]" in out


def test_no_separator_bucket_stays_with_its_own_field():
    line = "<p>عدد غرف النوم: 4 الحمامات: 7+</p>"
    assert _cmp({"bedrooms": 9}, line, "bedrooms") == S.MISMATCH
    assert _cmp({"bathrooms": 9}, line, "bathrooms") == S.MATCH


def test_the_log_never_carries_the_sellers_prose(capsys):
    page = S.page_evidence("<p>غرف النوم 4 للتواصل مع أحمد</p>")
    S._log_verdicts("t:2", {"bedrooms": S.MISMATCH}, {"bedrooms": 5}, page)
    out = capsys.readouterr().out
    assert "أحمد" not in out and "4" in out


def test_a_monthly_price_logs_the_monthly_figure(capsys):
    page = S.page_evidence("<p>الإيجار 1100 ريال شهريا</p>")
    S._log_verdicts("t:3", {"price": S.MISMATCH}, {"price_annual": 12000, "rent_period_ar": "شهري"}, page)
    assert "stored=1000.0" in capsys.readouterr().out


def test_a_bucket_after_the_other_field_stays_with_it():
    line = "<p>الحمامات: 7+ غرف النوم: 4</p>"
    assert _cmp({"bedrooms": 9}, line, "bedrooms") == S.MISMATCH
    assert _cmp({"bathrooms": 9}, line, "bathrooms") == S.MATCH
    assert _cmp({"bedrooms": 20}, "<p>+7 غرف نوم</p>", "bedrooms") == S.MATCH


def test_room_keywords_match_the_field_registry():
    kws = {n: k for n, _, _, k in S.FIELDS}
    assert S.ROOM_KW["bedrooms"] == kws["bedrooms"] and S.ROOM_KW["bathrooms"] == kws["bathrooms"]


def test_a_room_phrase_without_colon_labels_its_bucket():
    line = "<p>غرف النوم 7+ حمامات: 4</p>"
    assert _cmp({"bedrooms": 9}, line, "bedrooms") == S.MATCH
    assert _cmp({"bathrooms": 9}, line, "bathrooms") == S.MISMATCH


def test_a_second_label_in_the_span_does_not_give_the_bucket_away():
    line = "<p>غرف: الحمامات: 7+</p>"
    assert _cmp({"bedrooms": 9}, line, "bedrooms") == S.MISMATCH
    assert _cmp({"bathrooms": 9}, line, "bathrooms") == S.MATCH


def test_safe_evidence_never_carries_a_phone():
    out = S._safe_evidence(r"غرف", "غرف النوم 4 جوال ٠٥٠١٢٣٤٥٦٧ و 966501234567 السعر 1,600,000")
    assert "0501234567" not in out and "966501234567" not in out and "4" in out and "1,600,000" in out


def test_safe_evidence_drops_a_punctuated_mobile():
    out = S._safe_evidence(r"غرف", "غرف النوم 4 تواصل 050,123,4567 او 0501.234.567 السعر 1,600,000")
    assert "050,123,4567" not in out and "0501.234.567" not in out and "1,600,000" in out


def test_the_log_never_carries_a_comma_grouped_phone(capsys):
    # CodeRabbit PDPL Major on #11053: «هاتف 050,123,4567» on a room line, end to end through _log_verdicts.
    page = S.page_evidence("<p>غرف النوم 4 هاتف 050,123,4567</p>")
    S._log_verdicts("t:4", {"bedrooms": S.MISMATCH}, {"bedrooms": 5}, page)
    out = capsys.readouterr().out
    assert "050" not in out and "4567" not in out and "'غرف 4'" in out


def test_the_log_never_carries_a_comma_grouped_landline(capsys):
    # CodeRabbit PDPL Major on #11053 (03b766d): «هاتف 011,234,5678» is a landline redact_pii leaves intact.
    for phone in ("011,234,5678", "011.234.5678", "0112345678", "011,234,567"):
        page = S.page_evidence(f"<p>غرف النوم 4 هاتف {phone}</p>")
        S._log_verdicts("t:5", {"bedrooms": S.MISMATCH}, {"bedrooms": 5}, page)
        out = capsys.readouterr().out
        assert "011" not in out and "234" not in out and "'غرف 4'" in out, (phone, out)


def test_grouped_prices_still_reach_the_log():
    assert S._safe_evidence(r"السعر", "السعر 1,600,000 ريال") == "السعر 1,600,000"
    assert S._safe_evidence(r"السعر", "السعر 2.500.000") == "السعر 2.500.000"
    assert S._safe_evidence(r"السعر", "السعر 125,000,000") == "السعر 125,000,000"


def test_an_unprefixed_or_966_phone_is_not_logged():
    for phone in ("512345678", "51,234,5678", "+966512345678", "966 51 234 5678", "00966112345678"):
        assert "5678" not in S._safe_evidence(r"غرف", f"غرف 4 {phone}"), phone


def test_the_log_never_carries_a_price_grouped_mobile(capsys):
    # CodeRabbit PDPL Major on #11053 (0bd8605): «هاتف 512,345,678» looks like a grouped price but is a mobile.
    for phone in ("512,345,678", "512.345.678"):
        page = S.page_evidence(f"<p>غرف النوم 4 هاتف {phone}</p>")
        S._log_verdicts("t:6", {"bedrooms": S.MISMATCH}, {"bedrooms": 5}, page)
        out = capsys.readouterr().out
        assert "345" not in out and "'غرف 4'" in out, (phone, out)
