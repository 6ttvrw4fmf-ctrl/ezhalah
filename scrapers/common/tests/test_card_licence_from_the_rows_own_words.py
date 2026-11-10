"""The card's «رقم رخصة الإعلان» row is filled from ANY place the row already states its REGA ad licence (2026-11-09).

Card parity (ops_card_parity, 11-07 → 11-09) found the source page printing a REGA ad licence that the card never
showed on 12 small platforms. The row itself held the licence on most of them — just not under the one key the card
reads (additional_info.rega_ad_license_number):
  · jurash 23104834: description «… ترخيص الإعلان العقاري: 7201204886» (32 of 43 live ads);
  · october 13175940: description «رقم الترخيص الإعلاني: 7201102134 رقم رخصة فال: 1200039840»;
  · fursaghyr 4367079: additional_info.license_number = "7201051556" (9 of 9 live ads);
  · aqar: 4,328 live ads with «رخصة الإعلان: 7100318476» only in the seller's text.
db._licence_on_card() used to copy only the `license_number` column. It now reads the column, the panel's own
license_number key and the ad's words (normalize.ad_licence_from_prose), in that order, and never guesses: a FAL
licence (1xxxxxxxxx) or two different numbers leave the card silent.

Runs the REAL db.py function. Run: python -m pytest scrapers/common/tests/test_card_licence_from_the_rows_own_words.py -v
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

from scrapers.common import db  # noqa: E402  -- the real module, never a copy
from scrapers.common.normalize import ad_licence_from_prose  # noqa: E402

KEY = "rega_ad_license_number"


def _row(**kw):
    r = {"ad_number": "X1", "additional_info": {}, "description": None, "title": None}
    r.update(kw)
    return r


def test_jurash_wording_with_alaqari_between_the_label_and_the_number():
    r = _row(description="أرض سكنية للبيع 450 ريال غير شامل ترخيص الإعلان العقاري: 7201204886")
    db._licence_on_card(r)
    assert r["additional_info"][KEY] == "7201204886"


def test_october_wording_takes_the_ad_licence_not_the_fal_licence_beside_it():
    r = _row(description="محل تجاري. رقم الترخيص الإعلاني: 7201102134 رقم رخصة فال: 1200039840")
    db._licence_on_card(r)
    assert r["additional_info"][KEY] == "7201102134"


def test_aqar_sellers_text_in_arabic_indic_digits():
    r = _row(description="🔐 رخصة الإعلان: ٧١٠٠٣١٨٤٧٦ 🔐 رخصة فال: 1102786")
    db._licence_on_card(r)
    assert r["additional_info"][KEY] == "7100318476"


def test_fursaghyr_panels_own_license_number_key_is_copied_onto_the_card_key():
    r = _row(additional_info={"license_number": "7201051556", "street": "x"})
    db._licence_on_card(r)
    assert r["additional_info"][KEY] == "7201051556"
    assert r["additional_info"]["license_number"] == "7201051556"   # the scraper's own key is untouched


def test_the_column_still_wins_and_fills_the_card_key():
    r = _row(license_number="7200000001", description="ترخيص الإعلان: 7200000002")
    db._licence_on_card(r)
    assert r["additional_info"][KEY] == "7200000001"
    assert r["license_number"] == "7200000001"


def test_a_licence_found_in_the_words_fills_an_empty_declared_column_only():
    declared = _row(license_number=None, description="ترخيص الإعلان: 7200000003")
    db._licence_on_card(declared)
    assert declared["license_number"] == "7200000003"
    undeclared = _row(description="ترخيص الإعلان: 7200000003")      # the table has no such column (october)
    db._licence_on_card(undeclared)
    assert "license_number" not in undeclared
    assert undeclared["additional_info"][KEY] == "7200000003"


def test_an_existing_card_key_is_never_overwritten():
    r = _row(additional_info={KEY: "7200000009"}, description="ترخيص الإعلان: 7200000002")
    db._licence_on_card(r)
    assert r["additional_info"][KEY] == "7200000009"


def test_fal_licence_or_two_numbers_leave_the_card_silent():
    for text in ("رخصة فال: 1200039840", "ترخيص: 1100012345",
                 "ترخيص الإعلان: 7200000001 ترخيص الإعلان: 7200000002"):
        r = _row(description=text)
        db._licence_on_card(r)
        assert KEY not in r["additional_info"], text
        assert ad_licence_from_prose(text) is None, text


def test_a_row_that_does_not_write_additional_info_is_left_alone():
    r = {"ad_number": "X1", "description": "ترخيص الإعلان: 7200000001", "license_number": None}
    db._licence_on_card(r)
    assert "additional_info" not in r
    assert r["license_number"] is None


def test_the_legacy_rows_array_panel_is_left_alone():
    rows = [{"key": "propertyAge", "label": "Age", "value": "جديد"}]
    r = _row(additional_info=rows, description="ترخيص الإعلان: 7200000001")
    db._licence_on_card(r)
    assert r["additional_info"] is rows and len(rows) == 1
