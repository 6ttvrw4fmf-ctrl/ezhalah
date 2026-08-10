"""PDPL: the columns the app RENDERS must never carry a broker's contact details. Every platform.

THE BUG THIS PINS (2026-08-09). `redact_pii()` was wired to `source_capture.source_text` and to
nothing else. `description` — the field users actually read — was written raw on every upsert path.
A one-off UPDATE cleaned 9,785 descriptions that same day and the work was reported as FIXED; it was
not, because ingestion kept writing new ones. Hours later aqar was back to:

    1,895 descriptions with Saudi mobile numbers
      684 descriptions with WhatsApp / Telegram links
      194 descriptions with e-mail addresses

several carrying the agent's NAME beside the number («حسام : 05XXXXXXXX»), which is unambiguously
personal data. Repairing rows without closing the write path is not a fix, it is a delay — so this
file asserts the WRITE PATH, not the stored data.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

from scrapers.common import db  # noqa: E402

_DB_PY = Path(db.__file__)

# Real shapes taken from live aqar descriptions on 2026-08-09.
REAL_DESCRIPTIONS = [
    "شقة فاخرة بحي النرجس\n\nمباشرة قسم المبيعات \n\nحسام : 0546928988",
    "للتواصل مع شركة إسهام الشرق :\nنهال / 0564191886\n\nمستشار مبيعات",
    "♦️الرجيعي للعقارات\n0547544999\n\n📍الموقع",
    "للتواصل مع مستشارك العقاري :\n0535058558 - 0534511021",
    "شقة للإيجار واتساب https://wa.me/966501234567",
    "تواصل معنا sales@example.com للحجز",
    "اتصل على +966 50 123 4567 أو 00966501234567",
]


def _redacted(text: str, col: str = "description") -> str:
    row = {col: text}
    db._redact_user_visible_text(row)
    return row[col] or ""


# ── No contact detail may survive, in any shape ─────────────────────────────────────────────────
def test_no_saudi_mobile_survives_any_real_description():
    for src in REAL_DESCRIPTIONS:
        out = _redacted(src)
        assert not re.search(r"(?:\+?966|00966)?\s*0?5[\d\s\-]{8,}", out), f"phone survived: {out!r}"


def test_no_whatsapp_or_telegram_link_survives():
    assert "wa.me" not in _redacted("شقة للإيجار واتساب https://wa.me/966501234567")
    assert "t.me" not in _redacted("تواصل t.me/agent123")


def test_no_email_survives():
    assert "@" not in _redacted("تواصل معنا sales@example.com للحجز")


def test_the_property_text_itself_is_preserved():
    """Redaction must not eat the listing. Only the contact details go."""
    out = _redacted("شقة فاخرة بحي النرجس\n\nحسام : 0546928988")
    assert "شقة فاخرة" in out and "النرجس" in out


def test_title_is_redacted_too():
    assert "0501234567" not in _redacted("شقة للإيجار 0501234567", col="title")


# ── The write path, not just the helper: a correct helper nobody calls fixes nothing ────────────
def test_every_upsert_path_redacts_user_visible_text():
    """The 2026-08-09 defect was precisely this: the redactor existed and the write path skipped it."""
    src = _DB_PY.read_text(encoding="utf-8")
    guards = src.count("_unknown_must_not_overwrite_known(")
    redacts = src.count("_redact_user_visible_text(")
    # one definition + one call beside every no-clobber guard call
    assert redacts >= guards, (
        f"{guards} upsert paths carry the no-clobber guard but only {redacts - 1} redact user-visible "
        "text — a platform is writing raw contact details")


def test_description_and_title_are_both_covered():
    assert set(db._USER_VISIBLE_TEXT_COLS) >= {"description", "title"}


def test_redaction_runs_after_the_no_clobber_guard():
    """Order matters: a description that is ONLY contact details must be able to reach NULL. If the
    redactor ran first, the no-clobber guard would delete the None and preserve the old PII."""
    src = _DB_PY.read_text(encoding="utf-8")
    body = src.split("def upsert_aqar_residential", 1)[1].split("def ", 1)[0]
    assert body.index("_unknown_must_not_overwrite_known(") < body.index("_redact_user_visible_text(")


def test_a_description_that_is_only_contact_details_becomes_null_not_kept():
    row = {"description": "0501234567"}
    db._redact_user_visible_text(row)
    assert row["description"] in (None, "[redacted]"), row["description"]
