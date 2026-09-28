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

# Contact numbers in the SHAPES the patterns above miss (night audit 2026-09-28: ~230 live aqar
# descriptions still showed a phone). Measured on active rows: Arabic-Indic digits «٠٥٥١٢٣٤٥٦٧»
# (109), a mobile split by spaces / dashes / dots «055 123 4567», «0 5 5 1 2 …» (86), the
# international form with a bracketed trunk zero «+966 (0) 58 123 4567» (31), a Riyadh/Jeddah
# landline «٠١١ …» (3) and «واتس اب : 5XXXXXXXX» (6). One pattern, every shape, either digit set;
# no digit may touch either end, so REGA/FAL licences («٧٢٠٠…», «١١٠٠…»), CR numbers, prices and
# areas never match. The SAME pattern text runs in the DB floor (_redact_pii_sql) — a test pins it.
_D = r"[0-9٠-٩]"
_SEP = r"[\s.\-]?"
_PHONE_SHAPES_RE = re.compile(
    r"واتس\S*(?:\s+اب)?\s*[:\-]?\s*\+?" + _D + r"(?:[\s\-]?" + _D + r"){7,11}"
    + r"|(?<![0-9٠-٩])(?:"
    + r"(?:\+|00)?(?:966|٩٦٦)[\s.\-]*(?:\([0٠]\))?[\s.\-]*[0٠]?[5٥](?:" + _SEP + _D + r"){8}"
    + r"|[0٠]" + _SEP + r"[5٥](?:" + _SEP + _D + r"){8}"
    + r"|٥[٠-٩]{8}"
    + r"|[0٠]" + _SEP + r"[1١][1-7١-٧](?:" + _SEP + _D + r"){7}"
    + r")(?![0-9٠-٩])"
)

# A PERSON'S NAME behind a label (owner PDPL rule, 2026-09-27). REGA's standard ad block prints
# «صاحب الترخيص : <licence holder>» and «الموظف المسؤول عن الإعلان: <employee>»; on 2026-09-27
# dealapp alone showed 4,363 such names on result cards. The label stays, the name becomes
# [redacted] — the same token phones get.
#   • a whole-word qualifier in front makes the label a number/phone/role/terms field whose value is
#     NOT a name and must survive: «رقم المعلن», «جوال المعلن», «صفة المعلن: وسيط», and — for the
#     broker/marketer labels only — «عمولة الوسيط: على المشتري». Whole-word matters: «قريب من جامع
#     صاحب الترخيص : <name>» ends in «مع» and «بدون عمولة صاحب الترخيص» has «عمولة»; both are names.
#   • the name is letters only — at most 9 words on one line — and stops at a digit, punctuation,
#     a stop word («رقم», «تاريخ», any qualifier, …) or the next «label:». So «المدينة: جدة
#     الحي: النرجس» after a name is untouched: places, not people, and no place label is listed.
# The SAME pattern text runs in the DB floor (_redact_pii_sql); a test pins the two byte-identical.
_L = r"[ء-يA-Za-z]"    # one Arabic/Latin letter (U+0621..U+064A: no digits, punctuation or harakat)


def _not_after(*words: str) -> str:
    """Not preceded by any of these as a WHOLE word (fixed-width lookbehinds, valid in re and PG)."""
    return "".join(rf"(?<!(?<!{_L}){w}\s)" for w in words)


_QUALIFIERS = ("جوال", "رقم", "هاتف", "صفة", "صفه", "نوع", "تصنيف")   # «صفة المعلن: وسيط»
_TERMS = ("عمولة", "عموله", "أتعاب", "اتعاب", "سعي")                  # «عمولة الوسيط: على المشتري»
_TERMS_OF = _not_after(*_TERMS)
_NAME_LABELS = (
    r"(?:الموظف\s+)?(?:ال)?مس[ؤئو]ول(?:\s+عن)?\s+ال[إاأ]علان"
    r"|الموظف\s+(?:ال)?مس[ؤئو]ول"
    r"|صاحب\s+(?:ال)?ترخيص"
    r"|(?:اسم\s+)?(?:ال)?معلن"
    rf"|{_TERMS_OF}(?:اسم\s+)?(?:ال)?مسوق[ةه]?(?:\s+(?:ال)?عقاري[ةه]?)?"
    rf"|{_TERMS_OF}(?:اسم\s+)?(?:ال)?وسيط(?:\s+(?:ال)?عقاري)?"
    r"|اسم\s+(?:ال)?(?:مالك|موظف|وكيل)"
)
# Every qualifier is also a stop word. Otherwise «مسؤول الإعلان: <name> صفة المعلن: وسيط» swallows
# «صفة» with the name, and the NEXT write (the trigger re-runs on every UPDATE) sees a bare
# «المعلن: وسيط» and redacts the role — measured on 57 aqar rows, 2026-09-27. Redaction must be
# idempotent.
_STOP_WORDS = ("الرقم", "الجوال", "الهاتف", "تاريخ", "رخصة", "رخصه", "ترخيص", "الترخيص", "للتواصل",
               "التواصل", "تواصل", "واتس", "واتساب", "الضمانات", "نأمل") + _QUALIFIERS + _TERMS
_NOT_A_NAME_WORD = (
    rf"(?!(?:{'|'.join(_STOP_WORDS)})(?!{_L})|{_L}+[ \t]*:|(?:{_NAME_LABELS})[ \t]*:)"
)
_NAME_LABEL_RE = re.compile(
    rf"(?<!{_L})"                       # whole word: «صفة المعلن» must not match from its «معلن»
    + _not_after(*_QUALIFIERS)
    + rf"(و?(?:{_NAME_LABELS})[ \t]*:[ \t*]*(?:\r?\n[ \t*]*)?)"
    + rf'(?:[\[(«"][ \t]*)?{_NOT_A_NAME_WORD}{_L}+(?:[ \t]+{_NOT_A_NAME_WORD}{_L}+){{0,8}}'
    + r'(?:[ \t]*[\])»"])?'
)


def redact_pii(text: Any) -> Any:
    """Remove Saudi contact numbers, WhatsApp/Telegram handles, emails and labelled advertiser /
    ad-officer names from free text.
    Returns the cleaned string (whitespace-collapsed), or None if nothing readable remains.
    Non-string input is returned unchanged."""
    if not isinstance(text, str) or not text:
        return text
    out = _WA_RE.sub(_REDACTED, text)
    out = _EMAIL_RE.sub(_REDACTED, out)
    out = _PHONE_LOOSE.sub(_REDACTED, out)
    out = _PHONE_SHAPES_RE.sub(_REDACTED, out)
    out = _PHONE_RE.sub(_REDACTED, out)
    out = _NAME_LABEL_RE.sub(r"\1" + _REDACTED, out)   # before the collapse: a line break ends a name
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
    # The same channels as Arabic spec-table LABELS (sakan's «اسم الموظف المسؤول» / «هاتف الموظف
    # المسؤول», 2026-09-21). Written space-free because _is_contact_channel_key strips spaces.
    # «البريد» alone is deliberately absent: it would also drop «الرمز البريدي» (a postal code).
    "هاتف", "جوال", "واتس", "اسمالموظف", "البريدالإلكتروني", "البريدالالكتروني", "ايميل", "إيميل",
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
