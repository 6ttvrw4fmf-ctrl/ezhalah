"""The PII barrier must be impossible to bypass — by a new platform, a new column, or a good intention.

Owner rule 2026-08-10: add regression barriers that fail if
  1. a phone/email/usable messaging contact can reach a public text field
  2. private free-text capture can retain prohibited contact PII
  3. a new platform bypasses redaction
  4. a new text field bypasses monitoring
  5. legitimate structured regulatory/property numbers are accidentally redacted

(5) is the one that protects the SOURCE, and it is the easiest to lose: widening a pattern or a key
list to catch one more phone number is exactly how a REGA licence gets deleted.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

from scrapers.common import db  # noqa: E402
from scrapers.common.pii import CONTACT_CHANNEL_KEYS, redact_capture, redact_pii  # noqa: E402

_DB = Path(db.__file__).read_text(encoding="utf-8")

CONTACT_SHAPES = [
    "0501234567", "+966501234567", "00966501234567", "966 50 123 4567",
    "0566300642", "92015189", "9200123456",
    "https://wa.me/966501234567", "t.me/agent", "sales@example.com",
]

# Real source values that MUST survive byte-identical.
REGULATORY = {
    "REGA advertisement licence": "7100306688",
    "FAL broker licence":         "1200012345",
    "deed / plan / parcel":       "2/605",
    "national address building":  "3454",
    "postal code":                "12274",
    "latitude":                   "24.7136523",
    "longitude":                  "46.6752956",
    "price per m2":               "512345678",
    "lot size":                   "256.56",
    "photo url":                  "https://cdn.example/051667975_1779615663618.jpg",
    "REGA QR url":                "https://rega.gov.sa/q/598060020",
}


# ── 1 + 3: no public text column, on any platform, may keep a contact detail ────────────────────
def test_every_contact_shape_is_removed_from_every_guarded_column():
    for col in db._USER_VISIBLE_TEXT_COLS:
        for shape in CONTACT_SHAPES:
            row = {col: f"عقار مميز {shape} للتواصل"}
            db._redact_user_visible_text(row)
            left = row[col] or ""
            assert not re.search(r"\d{7,}", left.replace("redacted", "")), f"{col} kept {shape}: {left}"
            assert "wa.me" not in left and "@example" not in left


def test_a_new_platform_cannot_bypass_redaction():
    """Every write path must run BOTH barriers. Counted against the no-clobber guard, which every
    upsert already calls — so adding an upsert without redaction fails here."""
    guards = _DB.count("_unknown_must_not_overwrite_known(")
    assert _DB.count("_redact_user_visible_text(") >= guards
    assert _DB.count("_ensure_capture(") >= guards


# ── 2: private capture free text ────────────────────────────────────────────────────────────────
def test_private_capture_free_text_cannot_retain_contact_pii():
    for shape in CONTACT_SHAPES:
        out = redact_capture({"description": f"للتواصل {shape}", "source_text": f"واتساب {shape}"})
        for v in out.values():
            assert not re.search(r"\d{7,}", (v or "").replace("redacted", "")), v


def test_contact_channel_keys_are_dropped_whole():
    out = redact_capture({"responsible_employee_phone_number": "0554253033",
                          "ownerMobile": "0501234567", "contactEmail": "a@b.com"})
    assert out == {}, out


# ── 5: THE SOURCE-PROTECTION BARRIER — regulatory data must never be collateral damage ──────────
def test_regulatory_and_property_values_survive_byte_identical():
    """Asserted through the paths we ACTUALLY use — both of which gate on is_free_text().

    Raw redact_pii() is deliberately ungated and would mangle a bare 9-digit price (512345678
    satisfies "nine digits starting with 5"). That is why neither caller ever hands it a bare
    value: db._redact_user_visible_text and pii.redact_capture both check is_free_text() first.
    This test pins the CALLERS, because they are what runs in production."""
    for label, value in REGULATORY.items():
        out = redact_capture({"k": value})
        assert out["k"] == value, f"{label} altered inside a capture: {out['k']}"
        for col in db._USER_VISIBLE_TEXT_COLS:
            row = {col: value}
            db._redact_user_visible_text(row)
            assert row[col] == value, f"{label} altered in column {col}: {row[col]}"


def test_the_free_text_gate_is_what_protects_structured_values():
    from scrapers.common.pii import is_free_text
    for numeric in ("512345678", "24.7136523", "7100306688", "256.56"):
        assert not is_free_text(numeric), numeric
    for url in ("https://cdn.example/051667975_1.jpg", "https://rega.gov.sa/q/598060020"):
        assert not is_free_text(url), url
    assert is_free_text("للتواصل مع المكتب 0501234567 شكرا")


def test_a_licence_survives_even_beside_a_phone_number():
    """The real sanadak shape — both classes in one string."""
    out = redact_pii("واتس : 0598060020 ... ترخيص 7100306688")
    assert "0598060020" not in out and "7100306688" in out


def test_contact_key_list_stays_narrow_enough_to_keep_licences():
    for banned in ("seller", "owner", "broker", "agent", "licen", "deed", "plan", "parcel"):
        assert banned not in CONTACT_CHANNEL_KEYS, f"{banned!r} would delete regulatory data"
    for k in ("sellerLicenseNumber", "brokerFalLicence", "ownerType", "deedNumber", "planNumber"):
        assert k in redact_capture({k: "7100306688"}), f"{k} was dropped"


# ── 4: a new text field cannot escape monitoring ────────────────────────────────────────────────
def test_the_production_monitor_is_dynamic_not_a_hand_listed_set():
    """The predecessor watched one column on five tables and reported zero while 78 broker mobiles
    sat in street_name. The replacement must enumerate columns at run time."""
    sql = "\n".join(p.read_text(encoding="utf-8")
                    for p in Path("supabase/migrations").glob("*mon_pii_dynamic*"))
    assert "information_schema.columns" in sql and "mon_check_pii_leaks" in sql
    assert "data_type in ('text', 'character varying')" in sql


def test_the_capture_sweeper_is_batched_so_it_always_completes():
    """A monitor that times out on our largest platform verifies nothing."""
    sql = "\n".join(p.read_text(encoding="utf-8")
                    for p in Path("supabase/migrations").glob("*pii_capture_scanner*"))
    assert "mon_scan_pii_capture_batch" in sql and "p_budget" in sql
    assert "mon_pii_scan_state" in sql, "the sweeper must carry a cursor, not restart every run"
