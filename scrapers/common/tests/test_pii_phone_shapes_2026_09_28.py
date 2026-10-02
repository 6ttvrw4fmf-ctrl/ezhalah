"""Contact numbers in the shapes the older patterns missed (night audit 2026-09-28: ~230 active aqar
descriptions still showed a phone on the card). Every shape is redacted; licences, registration
numbers, prices and areas — which are also long digit runs — are never touched."""
from pathlib import Path

import pytest

from scrapers.common.pii import _PHONE_SHAPES_RE, redact_pii

_MIGRATIONS = Path(__file__).resolve().parents[3] / "supabase" / "migrations"


@pytest.mark.parametrize("text", [
    "للتواصل ٠٥٥١٢٣٤٥٦٧ شكرا",          # Arabic-Indic digits (109 live rows)
    "للتواصل: 055 123 4567",             # spaced
    "للتواصل 055-123-4567",              # dashed
    "ابوغالية 0 5 5 1 2 3 4 5 6 7",      # one digit at a time
    "للمفاهمه ‭+966 (0) 58 123 4567",  # international, bracketed trunk zero
    "00966 55 512 3456",
    "واتس اب : 551234567",               # «واتس اب :» then 9 digits
    "للتواصل / ٠١١٤٥٦٧٨٩٠",              # Riyadh landline
    "0555.123.456 للاستفسار",
    "للتواصل +966-11-500-1234.",         # +966 landline (dwelleo)
    "Sales +966 13 800 1234 .",          # +966 landline, spaced (rightcompound)
    "اتصلوا بنا الآن 966115001234",      # bare 966 landline (dwelleo)
    "الرقم الموحد: +966920001234 مؤسسة",  # +966 unified 920 line
    "+971 50 123 4567",                  # + any country code
    "0020 1001234567",                   # 00 + country code, one separator
    "الافق ٠٠٥٦٤٠٠١٢٣٤ - x",             # ٠٠ prefix, Arabic-Indic digits
])
def test_every_contact_shape_is_redacted(text):
    out = redact_pii(text)
    assert "[redacted]" in out
    digits = "".join(c for c in out if c.isdigit())
    assert len(digits) < 7, out


@pytest.mark.parametrize("text", [
    "رقم ترخيص الاعلان (٧٢٠٠٥١٢٣٤٥)",     # REGA ad licence
    "رخصة فال ١١٠٠٠١٢٣٤٥",               # FAL licence
    "سجل تجاري رقم : ١٠١٠١٢٣٤٥٦",        # commercial registration
    "ترخيص 7100306688",
    "السعر 1,250,000 ريال", "بسعر ٥٠٠٠٠٠ ريال", "المساحة ٥٠٠ م", "رقم القطعه 1234 مخطط 5678",
    "رقم المخطط : 002345 0802 0801 مخطط", "المخطط 002345-0815-0801 الارض",   # plan numbers, not 00…
    "https://maps.google.com/?q=28.366812,45.966123456789", "?q=26.39,44.00123456789",  # coordinates
])
def test_regulatory_numbers_prices_and_areas_survive(text):
    assert redact_pii(text) == text


def test_redaction_is_idempotent():
    once = redact_pii("للتواصل ٠٥٥١٢٣٤٥٦٧ أو +966 (0) 58 123 4567 ترخيص ٧٢٠٠٥١٢٣٤٥")
    assert redact_pii(once) == once and "٧٢٠٠٥١٢٣٤٥" in once


def test_ksaaqar_international_number_redacts_only_the_phone():
    """ksaaqar ad KSA123412486002454 (2026-09-28): its real title, with the number swapped for a
    same-shape fake (00962 + 9 digits) so no real phone lands in git. Only the number may change."""
    title = "عقارات فلل قصور مصايف مزارع اراضي سكن استثماري في الأردن للبيع هاتف 00962791234567"
    once = redact_pii(title)
    assert once == "عقارات فلل قصور مصايف مزارع اراضي سكن استثماري في الأردن للبيع هاتف [redacted]"
    assert redact_pii(once) == once


def test_db_floor_migration_carries_the_identical_pattern():
    """The LATEST migration that (re)defines _redact_pii_sql is what prod runs; it must carry this
    exact pattern, so changing one without the other fails here."""
    files = sorted(f for f in _MIGRATIONS.glob("*.sql")
                   if "function public._redact_pii_sql" in f.read_text(encoding="utf-8"))
    sql = files[-1].read_text(encoding="utf-8")
    assert "'" not in _PHONE_SHAPES_RE.pattern
    assert f"'{_PHONE_SHAPES_RE.pattern}', '[redacted]', 'g'" in sql, (
        "scrapers/common/pii.py _PHONE_SHAPES_RE changed without a matching _redact_pii_sql migration")


# ── The legacy rules (0?5\d{8}, 966 5…, 920…) must not cut a map coordinate (2026-10-02) ─────────
# Digits below are invented; the SHAPES are the live ones (aqar «maps?q=21.[redacted]91211,39.2»,
# aqargate «adMapLatitude: 24.72201[redacted]6», dealapp/aqar «…42.[redacted]59»).
@pytest.mark.parametrize("text", [
    "https://maps.google.com/maps?q=21.54012345691211,39.2",
    "?q=16.920816823732,42.5401234567859",
    'adMapLatitude": 24.72201512345678, "adMapLongitude": 46.6',
    "خط العرض 21.44621512345679 واجهة العقار",
    "25.294036865234375%2C49.5401234567183594",
    "q=16.92012345,44.1",                     # 920… right after the decimal point
    "45.19665123456789",                      # 966… inside a fraction
    "21,54012345691211",                      # comma decimal
])
def test_a_map_coordinate_is_never_cut_by_a_phone_rule(text):
    assert redact_pii(text) == text


@pytest.mark.parametrize("text", [
    "للتواصل مع الوسيط معافا : 966.512345678 🏡 شقة",      # 966 + dot + mobile (aqar, 43 rows)
    "للتواصل مع الوسيط معافا : 996.512345678 🏡 شقة",      # the same with the «996» typo
    "وفر فيديو للعقار التواصل واتس اب. 0.512345678",       # «0.» + mobile
    "رقم التواصل : (0.512345678)",
    "زيارة: 996512345678",
])
def test_a_phone_after_a_dot_is_still_redacted(text):
    out = redact_pii(text)
    assert "[redacted]" in out and "512345678" not in out, out
    assert redact_pii(out) == out


def test_the_coordinate_guard_is_carried_byte_for_byte_by_the_db_floor_and_both_monitors():
    from scrapers.common.pii import _NOT_IN_A_COORDINATE as guard
    assert "'" not in guard and "$" not in guard
    files = sorted(f for f in _MIGRATIONS.glob("*.sql")
                   if "function public._redact_pii_sql" in f.read_text(encoding="utf-8"))
    sql = files[-1].read_text(encoding="utf-8")
    for legacy in (r"(\+?966|00966)\s*5\d[\d\s\-]{6,}", r"(0?5\d{8}|\y920\d{5,8}\y)"):
        assert f"'{guard}{legacy}'" in sql, f"_redact_pii_sql legacy layer lost the guard: {legacy}"
    mon = (r"(\+?966|00966|\y0)5[0-9]{8}", r"\y920[0-9]{5,8}\y")
    assert f"{guard}{mon[0]}|{guard}{mon[1]}|" in sql, "the PII monitors do not carry the coordinate guard"
