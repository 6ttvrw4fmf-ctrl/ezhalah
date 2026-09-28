"""october: «كشك للإيجار» and «موقع تأجير صراف ألي» were stored «Other» → «غير معروف» on the card and
in no نوع filter (2026-09-28). The ad's own title names an existing clean type."""
import scrapers.october.run as R


def test_a_kiosk_and_an_atm_site_are_read_from_the_title():
    assert R._type_for("other", "كشك للإيجار", "other للإيجار") == "Kiosk"
    assert R._type_for("other", "موقع تأجير صراف ألي", "other للإيجار") == "ATM Site"


def test_the_index_token_still_wins_and_an_unnamed_type_stays_other():
    assert R._type_for("villa", "كشك", "") == "Villa"
    assert R._type_for("other", "فرصة استثمارية", "other للإيجار") == "Other"
