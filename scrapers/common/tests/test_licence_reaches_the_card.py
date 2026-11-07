"""🦅 2026-11-06: a stored REGA ad licence reaches the card's «رقم رخصة الإعلان» row.

The card reads additional_info.rega_ad_license_number (src/data/remote.ts ADDL_FIELDS). ~37,000 live ads on
~45 sites stored the licence only in license_number (muhaysini 20,371 of 20,371), so no card showed it — the
fleet-wide form of the owner's 11-04 Property Finder finding. _ensure_capture() is every upsert path's funnel.
"""
from scrapers.common import db


def _row(**kw):
    r = {"listing_url": "https://example.sa/ad/1", "title": "شقة", "photo_urls": []}
    r.update(kw)
    return r


def test_a_stored_licence_reaches_the_card_key():
    r = _row(license_number="7200767759", additional_info={"features": ["مصعد"]})
    db._ensure_capture(r)
    assert r["additional_info"]["rega_ad_license_number"] == "7200767759"
    assert r["additional_info"]["features"] == ["مصعد"]          # the rest of the panel is kept


def test_an_explicit_null_panel_gets_the_licence():
    r = _row(license_number="7100000001", additional_info=None)
    db._ensure_capture(r)
    assert r["additional_info"] == {"rega_ad_license_number": "7100000001"}


def test_never_invents_a_panel_the_row_does_not_write():
    # an upsert replaces the whole column: a row without additional_info must not erase the stored one
    r = _row(license_number="7100000001")
    db._ensure_capture(r)
    assert "additional_info" not in r


def test_the_sites_own_key_wins_and_junk_is_not_a_licence():
    r = _row(license_number="7100000001", additional_info={"rega_ad_license_number": "7100000009"})
    db._ensure_capture(r)
    assert r["additional_info"]["rega_ad_license_number"] == "7100000009"
    for junk in ("1234", "0", "MA0001234", None, 7100000001):
        r = _row(license_number=junk, additional_info={})
        db._ensure_capture(r)
        assert "rega_ad_license_number" not in r["additional_info"], junk
