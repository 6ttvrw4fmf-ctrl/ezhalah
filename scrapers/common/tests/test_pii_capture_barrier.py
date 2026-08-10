"""The capture barrier: redact contact PII from stored captures WITHOUT destroying regulatory data.

Owner rule 2026-08-09, both halves, and the second half is the one that is easy to get wrong:

  A. personal contact info (phones, WhatsApp, e-mail, names tied to contact) -> REDACT
  B. regulatory / property data (FAL + REGA licences, deed / plan / parcel, coordinates,
     seller licence identifiers)                                            -> PRESERVE

  "Do not blindly remove structured regulatory information."

WHY THE FREE-TEXT RULE EXISTS. Running the phone regex over a whole capture is a CATEGORY ERROR:
`0?5\\d{8}` reduces to "any nine digits starting with 5", which matched sanadak's latitude on 497
rows, longitude on 434, sellingSqMeterPrice on 224 and photo-URL ids on 847. Redacting those would
have corrupted coordinates and prices while fixing nothing — no human is reachable through a
latitude. Real contact PII lives in prose, and one live sanadak field carried both classes at once:

    «واتس : 0598060020 ... ترخيص 7100306688»
     ^^^^^^^^^^^^^^^^^ redact       ^^^^^^^^^^ preserve (REGA advertisement licence)
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

from scrapers.common import db  # noqa: E402
from scrapers.common.pii import redact_capture  # noqa: E402

# A real sanadak capture shape, both data classes present.
LIVE_CAPTURE = {
    "description": "للتواصل والاستفسار:0535204545\nرقم الترخيص:7201063553",
    "latitude": "24.7136523",
    "longitude": "46.6752956",
    "sellingSqMeterPrice": "512345678",   # 9 digits starting with 5 — NOT a phone
    "lotSize": "256.56",
    "districtId": "d76687a6-6a18-4d2c-a4cb-a10d3f96841d",
    "sellerLicenseNumber": "7100306688",
    "landNumber": "2/605",
    "qrCodeUrl": "https://rega.gov.sa/q/598060020",
    "_photo_urls_all": ["https://cdn.example/051667975_1779615663618.jpg"],
    "responsible_employee_phone_number": "0554253033",
    "responsible_employee_name": "احمد علي سليمان",
}


# ── A: contact PII must go ──────────────────────────────────────────────────────────────────────
def test_phone_in_free_text_is_redacted():
    assert "0535204545" not in redact_capture(LIVE_CAPTURE)["description"]


def test_contact_channel_keys_are_dropped_entirely():
    out = redact_capture(LIVE_CAPTURE)
    assert "responsible_employee_phone_number" not in out
    assert "responsible_employee_name" not in out


def test_whatsapp_and_email_in_free_text_go():
    out = redact_capture({"notes": "واتساب https://wa.me/966501234567 و a@b.com للحجز"})
    assert "wa.me" not in out["notes"] and "a@b.com" not in out["notes"]


# ── B: regulatory / property data must SURVIVE byte-identical ───────────────────────────────────
def test_coordinates_survive_untouched():
    out = redact_capture(LIVE_CAPTURE)
    assert out["latitude"] == "24.7136523" and out["longitude"] == "46.6752956"


def test_prices_areas_and_ids_survive_untouched():
    out = redact_capture(LIVE_CAPTURE)
    assert out["sellingSqMeterPrice"] == "512345678", "a 9-digit price is not a phone number"
    assert out["lotSize"] == "256.56"
    assert out["districtId"] == LIVE_CAPTURE["districtId"]


def test_licence_numbers_survive_even_inside_free_text():
    out = redact_capture(LIVE_CAPTURE)
    assert out["sellerLicenseNumber"] == "7100306688", "seller LICENCE is regulatory data, not PII"
    assert "7201063553" in out["description"], "REGA licence must survive redaction of its neighbour"


def test_deed_plan_and_photo_urls_survive():
    out = redact_capture(LIVE_CAPTURE)
    assert out["landNumber"] == "2/605"
    assert out["qrCodeUrl"] == LIVE_CAPTURE["qrCodeUrl"]
    assert out["_photo_urls_all"] == LIVE_CAPTURE["_photo_urls_all"]


def test_the_narrow_contact_key_list_does_not_catch_licence_keys():
    """CONTACT_CHANNEL_KEYS must stay narrow. If it ever grows to include seller/owner/broker it
    will start deleting licence identifiers we may lawfully need."""
    from scrapers.common.pii import CONTACT_CHANNEL_KEYS
    for banned in ("seller", "owner", "broker", "agent", "licen"):
        assert not any(banned == k for k in CONTACT_CHANNEL_KEYS), banned
    assert "sellerLicenseNumber" in redact_capture({"sellerLicenseNumber": "7100306688"})


# ── The write path: a correct helper nobody calls fixes nothing ─────────────────────────────────
def test_ensure_capture_applies_the_barrier():
    r = {"listing_url": "https://x/1", "photo_urls": [],
         "source_capture": dict(LIVE_CAPTURE)}
    db._ensure_capture(r)
    cap = r["source_capture"]
    assert "responsible_employee_phone_number" not in cap
    assert "0535204545" not in cap["description"]
    assert cap["latitude"] == "24.7136523" and cap["sellerLicenseNumber"] == "7100306688"


def test_every_upsert_path_runs_ensure_capture():
    """_ensure_capture is where the barrier lives, so every write path must call it."""
    src = Path(db.__file__).read_text(encoding="utf-8")
    assert src.count("_ensure_capture(") >= src.count("_unknown_must_not_overwrite_known(")


def test_barrier_is_inside_ensure_capture_not_dead_code_after_a_return():
    """It was briefly appended after a `return` in a neighbouring function and silently did nothing."""
    src = Path(db.__file__).read_text(encoding="utf-8")
    fn = src.split("def _ensure_capture(", 1)[1].split("\ndef ", 1)[0]
    assert "redact_capture(" in fn, "the barrier is not inside _ensure_capture"
