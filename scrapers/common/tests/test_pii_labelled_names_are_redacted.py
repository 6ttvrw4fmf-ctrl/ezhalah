"""PDPL: a person's NAME behind a label never reaches a card. Every platform, both layers.

THE BUG THIS PINS (2026-09-27). A real-user test opened a Jeddah dealapp villa card that read
«صاحب الترخيص : <name> ... الموظف المسؤول عن الإعلان: <name>». redact_pii() and the DB floor
(_redact_pii_sql) only knew contact SHAPES (phones, 920, wa.me, e-mail); a name has no shape, only a
label. Active rows that day: dealapp 4,363 employee names + 1,416 licence holders, plus «المعلن:»,
«مسوق:», «مسؤول الإعلان:», «اسم المالك:» on aqar, tuba, dwelleo, muktamel and others.

Names below are invented; the SHAPES are the live ones.
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

from scrapers.common.pii import _NAME_LABEL_RE, redact_pii  # noqa: E402

_MIGRATIONS = Path(__file__).resolve().parents[3] / "supabase" / "migrations"


# ── A named label is redacted, the label itself stays ───────────────────────────────────────────
def test_dealapp_rega_block_names_are_redacted():
    src = ("صاحب الترخيص : سالم فهد تاريخ انتهاء رخصة الإعلان : 2026-10-01 المدينة: جدة "
           "الحي: الشاطئ الموظف المسؤول عن الإعلان: سالم فهد رقم")
    out = redact_pii(src)
    assert "سالم" not in out and "فهد" not in out, out
    assert "صاحب الترخيص : [redacted] تاريخ انتهاء رخصة الإعلان : 2026-10-01" in out, out
    assert "الموظف المسؤول عن الإعلان: [redacted] رقم" in out, out


def test_every_name_label_shape_is_redacted():
    for src in (
        "المعلن : سعد ناصر رقم الرخصة : 1100157237",
        "المعلن:[شركة النخبة العقارية] أرقام تصاريح الشركة",
        "مسوق:\nشركة الأفق للعقار\nرخصة فال: 1200006441",
        "**بيانات مسؤول الإعلان:** خالد بن سعد آل فلان رقم التواصل",
        "* اسم المالك: سمير سالم الزهراني 📏 حدود العقار",
        "اسم الوسيط: فهد العلي",
        "المسوقة العقارية: هند العلي",
        "الموظف المسئول عن الاعلان : نوره علي رقم",     # «مسئول» / «الاعلان» spellings
        "قريب من جامع صاحب الترخيص : احمد علي تاريخ",    # «جامع» ends in «مع»: still a name
        "بدون عمولة صاحب الترخيص : محمد علي تاريخ",       # «عمولة» guards broker labels only
    ):
        out = redact_pii(src)
        assert "[redacted]" in out, (src, out)
        for name in ("سعد ناصر", "النخبة", "الأفق", "خالد", "سمير", "فهد", "هند", "نوره", "احمد", "محمد"):
            assert name not in out, (src, out)


def test_a_long_company_name_is_covered_up_to_nine_words():
    out = redact_pii("صاحب الترخيص : شركة سعد حمد المطيري و خالد حمد المطيري العقارية تاريخ")
    assert "المطيري" not in out and out.endswith("[redacted] تاريخ"), out


# ── Text without a label, and places, are untouched ─────────────────────────────────────────────
def test_a_description_without_a_label_is_untouched():
    src = "فيلا فاخرة للبيع بحي الشاطئ جدة مساحة 400م 5 غرف نوم"
    assert redact_pii(src) == src


def test_city_and_district_after_a_name_are_not_redacted():
    """«الحي:» / «المدينة:» carry places, not people — and they end the name before them."""
    for src in ("صاحب الترخيص: سالم\nالمدينة: جدة\nالحي: الشاطئ",
                "مسؤول الإعلان: سالم المدينة: جدة الحي: الشاطئ",
                "وصف موقع العقار حسب الصك المدينة: جدة الحي: الشاطئ"):
        out = redact_pii(src)
        assert "المدينة: جدة" in out and "الحي: الشاطئ" in out, out
        assert "سالم" not in out, out


# ── Qualified labels are numbers / roles / terms, not names: they survive byte-identical ────────
def test_role_number_and_terms_fields_survive():
    for src in ("صفة المعلن: وسيط",
                "نوع المعلن: مالك",
                "رقم المعلن: 7112226",
                "رقم رخصة المعلن: 1100276721",
                "جوال المعلن : ((الرقم يظهر عند الضغط على اتصال))",
                "📌 عمولة الوسيط: على المشتري",
                "عمولة المسوق: على البائع",
                "رقم جوال مسؤول الإعلان : عمولة السعي على المشتري",
                "صاحب الترخيص :رقم7201007381 تاريخ"):
        assert redact_pii(src) == src, (src, redact_pii(src))


def test_redaction_is_idempotent():
    """The trigger re-runs on every UPDATE; a second pass must change nothing. The second shape broke
    57 live aqar rows: the name swallowed «صفة», and the next write redacted the ROLE «وسيط»."""
    for src in ("المعلن: [ شركة النخبة ] الموظف المسؤول عن الإعلان: سالم فهد رقم",
                "للعقارات مسؤول الإعلان: سالم فهد صفة المعلن: وسيط ومسوق عقاري رخصة فال: 12",
                "المسوق: سالم فهد عمولة الوسيط: على المشتري"):
        once = redact_pii(src)
        assert redact_pii(once) == once, (src, once)
        assert "سالم" not in once and ("صفة المعلن: وسيط" in once or "صفة" not in src), once


# ── The DB floor runs the SAME pattern: the two layers cannot drift apart ───────────────────────
def test_db_floor_migration_carries_the_identical_pattern():
    """The LATEST migration that (re)defines _redact_pii_sql is what prod runs; it must carry the
    exact Python pattern, so changing one without the other fails here."""
    files = sorted(f for f in _MIGRATIONS.glob("*.sql")
                   if "function public._redact_pii_sql" in f.read_text(encoding="utf-8"))
    assert files, "no migration defines public._redact_pii_sql"
    sql = files[-1].read_text(encoding="utf-8")
    assert "'" not in _NAME_LABEL_RE.pattern          # embeds in a SQL literal without escaping
    assert f"'{_NAME_LABEL_RE.pattern}', '\\1[redacted]', 'g'" in sql, (
        "scrapers/common/pii.py _NAME_LABEL_RE changed without a matching _redact_pii_sql migration")
