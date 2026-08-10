"""Canonical PDPL redaction — the ONE redactor every scraper shares.

Replaces the per-platform copies that had drifted apart (aqar `_redact_pii`,
ramzalqasim `_redact` + `_PHONE_RE`/`_PHONE_LOOSE`, and the scattered `_PII`
field-name blocklists in aqargate/alhoshan/aldarim/…). Import from here so a
PDPL rule is fixed in exactly one place:

    from scrapers.common.pii import redact_pii, strip_pii_fields

PDPL: we never store broker/owner identity or any contact number. Listing
CONTENT (specs, description text, photo URLs) is fine; personal contact data
(phones, WhatsApp handles, emails, advertiser/agent names) is not.
"""
from __future__ import annotations

import re
from typing import Any

_REDACTED = "[redacted]"

# Messaging handles / contact links (strip whole token, incl. any leading scheme).
_WA_RE = re.compile(
    r"(?:https?://)?(?:api\.whatsapp\.com/send\S*|wa\.me/\S+|t\.me/\S+|whatsapp[:\s]\S*)",
    re.IGNORECASE,
)
_EMAIL_RE = re.compile(r"[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}")

# Bracketed loose Saudi mobile e.g. «050 123 4567» / (0501234567) — run BEFORE the
# strict pattern so the surrounding brackets go too.
_PHONE_LOOSE = re.compile(r"[\(\[\{«]{1,3}\s*0?5[\d\s\.\-]{7,}\s*[\)\]\}»]{1,3}")

# Saudi phone numbers + Arabic "واتساب <number>" (union of the strongest per-scraper patterns).
_PHONE_RE = re.compile(
    r"(?:\+?966|00966)\s*5\d[\d\s\-]{6,}"   # +966 5X…, 00966 5X…
    r"|0?5\d{8}"                              # 05XXXXXXXX / 5XXXXXXXX
    r"|\b920\d{5,8}\b"                        # 920… unified business lines. 5-8 trailing digits:
                                              # live aqar ad 109347 carried «للتواصل : 92015189»
                                              # (920 + FIVE digits), which the old 9200\d{4,8} /
                                              # 920\d{6} pair matched neither of. (2026-08-09)
    r"|واتس\S*\s*\d[\d\s\-]{6,}"              # واتساب/واتس اب followed by digits
)


def redact_pii(text: Any) -> Any:
    """Remove Saudi contact numbers, WhatsApp/Telegram handles and emails from free text.
    Returns the cleaned string (whitespace-collapsed), or None if nothing readable remains.
    Non-string input is returned unchanged."""
    if not isinstance(text, str) or not text:
        return text
    out = _WA_RE.sub(_REDACTED, text)
    out = _EMAIL_RE.sub(_REDACTED, out)
    out = _PHONE_LOOSE.sub(_REDACTED, out)
    out = _PHONE_RE.sub(_REDACTED, out)
    out = re.sub(r"\s+", " ", out).strip()
    return out or None


# Field-NAME substrings that carry advertiser/broker/owner identity or a contact channel.
# Matched case-insensitively against dict keys; the whole field is dropped, not scrubbed.
PII_FIELD_KEYS: tuple[str, ...] = (
    "advertiser", "broker", "brokerage", "owner", "employee", "agent", "seller",
    "phone", "mobile", "whatsapp", "telephone", "contact", "email", "lead",
    "reservation", "rega_advertiser", "responsible",
)


def _is_pii_key(key: Any) -> bool:
    kl = str(key).lower()
    return any(p in kl for p in PII_FIELD_KEYS)


def strip_pii_fields(obj: Any) -> Any:
    """Recursively drop dict keys whose NAME signals PII (advertiserName, ownerPhone,
    contactEmail, …). Free-text values are not phone-scrubbed here — pair with
    redact_pii() for that. Lists/scalars pass through with their PII keys removed."""
    if isinstance(obj, dict):
        return {k: strip_pii_fields(v) for k, v in obj.items() if not _is_pii_key(k)}
    if isinstance(obj, list):
        return [strip_pii_fields(v) for v in obj]
    return obj


# ── The capture barrier: redact FREE TEXT only, never structured/regulatory values ───────────────
# Owner rule 2026-08-09: "Do not blindly remove structured regulatory information." The distinction
# is not optional — it is the difference between a privacy fix and data destruction.
#
# WHY THIS SHAPE. Running the phone regex over a whole capture blindly is a CATEGORY ERROR. The
# mobile pattern `0?5\d{8}` reduces to "any nine digits starting with 5", which matches sanadak's
# `latitude` (497 rows), `longitude` (434), `sellingSqMeterPrice` (224), photo-URL ids (847) and
# `lotSize`. Redacting those would corrupt coordinates and prices to fix nothing: they are numbers,
# not prose, and no human is reachable through them.
#
# Real contact PII lives in FREE TEXT. Live sanadak capture, one field, both classes side by side:
#     «واتس : 0598060020 ... ترخيص 7100306688»
#      ^^^^^^^^^^^^^^^^^ redact          ^^^^^^^^^^ PRESERVE (REGA advertisement licence)
# Saudi mobiles start 05/5/+9665 and 920-lines are business switchboards; REGA/FAL licences are
# 10-digit 7-prefixed, deed/plan/parcel numbers carry slashes and letters. The patterns above target
# the former and leave the latter untouched — verified against live rows.

# Keys that ARE a contact channel: the whole value is dropped, never scrubbed. Deliberately NARROW —
# it must NOT catch sellerLicenseNumber / ownerType / brokerLicence, which are regulatory data we
# may lawfully need. That is why "seller"/"owner"/"broker"/"agent" are absent here even though
# PII_FIELD_KEYS (used by strip_pii_fields for a different, stricter purpose) includes them.
CONTACT_CHANNEL_KEYS: tuple[str, ...] = (
    "phone", "mobile", "whatsapp", "telegram", "telephone", "email", "e_mail",
    "contactnumber", "contact_number", "responsible_employee_name",
)

# Unambiguous Saudi contact numbers standing alone as an entire field value.
_BARE_CONTACT_ONLY = re.compile(r"\s*(?:(?:\+|00)?966\s*5\d[\d\s\-]{6,}|0\s*5\d{8}|920\d{5,8})\s*")

_URLISH = re.compile(r"^\s*(?:https?://|//|/|data:|blob:)", re.IGNORECASE)


def is_free_text(v: Any) -> bool:
    """True only for prose that could hide a contact detail.

    Excludes anything numeric (coordinates, prices, areas, ids) and anything URL-shaped (photo and
    QR links) — those cannot carry a reachable contact and must survive byte-identical.
    """
    if not isinstance(v, str) or len(v.strip()) < 8:
        return False
    if _URLISH.match(v):
        return False
    try:
        float(v.strip().replace(",", ""))
    except ValueError:
        return True           # has letters/punctuation: prose, always checkable
    # A BARE number. Almost always a structured source fact (latitude 24.7136523, price per m2
    # 512345678, REGA licence 7100306688, lot size 256.56) — those must survive byte-identical.
    # The one exception is a value that is a phone number and nothing else, e.g. a description
    # reduced to «0501234567». Only the UNAMBIGUOUS Saudi contact shapes qualify: a leading 0
    # before the 5, an explicit +966/00966, or a 920 business line. A bare "512345678" stays a
    # number, because nothing distinguishes it from a price and a price is the likelier reading.
    return bool(_BARE_CONTACT_ONLY.fullmatch(v.strip()))


def _is_contact_channel_key(key: Any) -> bool:
    kl = str(key).lower().replace(" ", "")
    return any(p in kl for p in CONTACT_CHANNEL_KEYS)


def redact_capture(obj: Any) -> Any:
    """Recursively make a stored capture PDPL-safe WITHOUT destroying regulatory/property data.

    - a key that names a contact channel  -> dropped entirely
    - a free-text string value            -> run through redact_pii()
    - numbers, URLs, ids, licences, deeds, coordinates -> returned UNCHANGED
    """
    if isinstance(obj, dict):
        return {k: redact_capture(v) for k, v in obj.items() if not _is_contact_channel_key(k)}
    if isinstance(obj, list):
        return [redact_capture(v) for v in obj]
    if isinstance(obj, str) and is_free_text(obj):
        return redact_pii(obj)
    return obj
