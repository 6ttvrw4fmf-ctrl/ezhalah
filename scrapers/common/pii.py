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
    r"|\b9200\d{4,8}\b"                       # 9200… unified business lines
    r"|\b920\d{6}\b"                          # 920XXXXXX business lines
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
