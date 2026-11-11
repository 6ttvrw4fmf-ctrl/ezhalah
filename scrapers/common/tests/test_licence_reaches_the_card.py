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


# ── 🔧 2026-11-09: the licence the ad states only in its OWN TEXT reaches the card too ─────────────────────
# card_parity_card_missing (13 alerts, aqargate/abeea/…): the source page printed the REGA ad licence, the
# scraper never parsed it, the card showed no licence row. Measured live: aqar 401, abeea 114, aldarim 57 cards.

def test_a_licence_stated_only_in_the_description_reaches_the_card():
    for text, lic in (
        ("شقة للإيجار ترخيص الإعلان:* 7100295545 للتواصل", "7100295545"),          # aqar 2634535's prose shape
        ("السعر: 850,000 ريال 🔐 رخصة الإعلان: 7100318476 🔐", "7100318476"),     # aqargate 10984251
        ("Plot Number: 29 Building Number 29 Advertisement License: 7200421226", "7200421226"),  # abeea 645956
        ("ترخيص الاعلان:‏7201083710", "7201083710"),
    ):
        r = _row(description=text, additional_info={})
        db._ensure_capture(r)
        assert r["additional_info"].get("rega_ad_license_number") == lic, text


def test_prose_never_invents_a_licence():
    for text in (
        "السعر 7100295545 ريال",                                   # a bare number is not a licence
        "رخصة فال: 1100029634",                                     # the broker's FAL licence, not the ad's
        "ترخيص الإعلان: 7100000001 وترخيص الإعلان: 7200000002",   # two different licences: say nothing
        "ترخيص الإعلان: 1234567890",                               # not the 71/72 REGA ad-licence shape
        None,
    ):
        r = _row(description=text, additional_info={})
        db._ensure_capture(r)
        assert "rega_ad_license_number" not in r["additional_info"], text


def test_the_parsed_licence_beats_the_prose():
    r = _row(license_number="7200767759", description="ترخيص الإعلان: 7100000001", additional_info={})
    db._ensure_capture(r)
    assert r["additional_info"]["rega_ad_license_number"] == "7200767759"
    r = _row(description="ترخيص الإعلان: 7100000001")           # no panel written → nothing invented
    db._ensure_capture(r)
    assert "additional_info" not in r


def test_decorated_prose_licences_aqar_shapes():
    # the shapes 225 of 337 live aqar cards printed and the first prose reader missed (🔧 2026-11-09)
    for text in ("رخصة الإعلان (7100254642)", "ترخيص الإعلاني : - 7100254642", "ترخيص اعلاني (7100254642",
                 "ترخيص الإعلان: [7100254642]", "ترخيص الإعلاني | 7100254642", "ترخيص اعلاني : ((7100254642))",
                 "رخصة الإعلان (الهيئة العامة للعقار): 7100254642", "ترخيص الاعلان \\7100254642",
                 "ترخيص إعلان معتمد7100254642", "ترخيص اعلان رقم( 7100254642", "ترخيص اعلانها (7100254642"):
        r = _row(description=text, additional_info={})
        db._ensure_capture(r)
        assert r["additional_info"].get("rega_ad_license_number") == "7100254642", text
    # a word between label and number is not decoration: «ترخيص الإعلان ورقم التواصل 7100254642»
    r = _row(description="ترخيص الإعلان ورقم التواصل 7100254642", additional_info={})
    db._ensure_capture(r)
    assert "rega_ad_license_number" not in r["additional_info"]


def test_aqar_never_reads_its_prose_licence():
    # aqar states its licence in a structured payload field; its prose disagrees on 2.6% of rows (181 of 7,064)
    r = _row(listing_url="https://sa.aqar.fm/شقق-للإيجار/جدة/x-6756952", description="ترخيص الإعلان: 7100295545",
             additional_info={})
    db._ensure_capture(r)
    assert "rega_ad_license_number" not in r["additional_info"]
