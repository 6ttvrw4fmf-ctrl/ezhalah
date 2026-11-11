"""The listing SITE's own posting date, in the form `date_added` stores it.

`date_added` (text) is what every time-window welcome fact counts by, through
`public.source_posted_at(text)` (migration 20261026122758, docs/ARCHITECTURE.md §20), and what the
card prints in its «أضيف» chip. Two readers, two needs:

  · the SQL reader accepts exactly four shapes and answers NULL for anything else, so a value in any
    other shape is stored but never counted — a silent loss;
  · the card reads the string TEXTUALLY (the first YYYY-MM-DD it sees, never `new Date()`), so a UTC
    stamp shows the UTC day: an ad posted at 01:30 Saudi time would read as the day before.

So a stamp that carries a zone («…Z», «+00:00») is re-expressed as THE SAME INSTANT in Saudi time
(+03:00) — a change of notation, not of fact; the verbatim value stays in the row's own capture
(additional_info / source_capture). Measured on aqarcity 30938: the page used to print
datePublished «2026-09-24T21:19:05+03:00» and now prints datePosted «2026-09-24T18:19:05.000Z»; this
returns the first for the second, byte for byte. A stamp without a zone, a bare date and DD/MM/YYYY
are already Saudi-local to the SQL reader and are kept as published.

Anything else — relative text («منذ 3 أيام»), a month name, an impossible date, a non-string — is
None: UNKNOWN stays NULL (the upsert drops a None, so it can never erase a known date either).

This is for the site's POSTING date only. Never hand it our own first-seen time, a licence date
(wasalt `regaAdvLicDate`), a «last updated» / bump date, or a sitemap lastmod.
"""
from __future__ import annotations

import re
from datetime import date, datetime, timedelta, timezone
from typing import Any, Optional

_RIYADH = timezone(timedelta(hours=3))

# The same four shapes public.source_posted_at(text) reads, in the same order. re.ASCII: «\d» must not
# match Arabic-Indic digits, which the SQL cast would refuse.
_ISO_ZONED = re.compile(
    r"(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-]\d{2}:?\d{2})", re.ASCII)
_ISO_LOCAL = re.compile(r"(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?", re.ASCII)
_ISO_DAY = re.compile(r"(\d{4})-(\d{2})-(\d{2})", re.ASCII)
_DMY = re.compile(r"(\d{1,2})/(\d{1,2})/(\d{4})", re.ASCII)


def site_posting_date(raw: Any) -> Optional[str]:
    """`raw` as the site published it → the text to store in `date_added`, or None when it is not a date
    `public.source_posted_at` can read."""
    if not isinstance(raw, str):
        return None
    r = raw.strip()
    try:
        if (m := _ISO_ZONED.fullmatch(r)):
            y, mo, d, h, mi, s = (int(x) for x in m.groups()[:6])
            z = m.group(7)
            if z == "Z":
                off = timedelta(0)
            else:
                digits = z[1:].replace(":", "")
                off = timedelta(hours=int(digits[:2]), minutes=int(digits[2:]))
                if z[0] == "-":
                    off = -off
            at = datetime(y, mo, d, h, mi, s, tzinfo=timezone(off)).astimezone(_RIYADH)
            return at.strftime("%Y-%m-%dT%H:%M:%S") + "+03:00"
        if (m := _ISO_LOCAL.fullmatch(r)):
            y, mo, d, h, mi = (int(x) for x in m.groups()[:5])
            datetime(y, mo, d, h, mi, int(m.group(6) or 0))
            return r
        if (m := _ISO_DAY.fullmatch(r)):
            date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
            return r
        if (m := _DMY.fullmatch(r)):
            date(int(m.group(3)), int(m.group(2)), int(m.group(1)))   # day first, as the SQL reader reads it
            return r
    except (ValueError, OverflowError):
        return None                       # 31/02/2026, hour 25: unreadable, never a guess
    return None


# ── «منذ 23 يوم»: a site that prints only HOW LONG AGO, never the day (owner 2026-11-11) ──────────────────
# Such a count is not a date, so it never goes into `date_added` (the card prints that as a day, the welcome facts
# count it as one). What it does prove is a FLOOR: read at time T, «23 يوم» means the ad is younger than 24 days, so
# it was posted no earlier than T − 24 days. That floor is stored in `posted_earliest_at` and the «نُشر خلال» window
# reads it, so an ad counts under «30 يوماً» only when even its OLDEST possible day is inside 30 days — we never call
# an ad newer than the site proves it is.
#
# The largest age each unit can stand for, per 1 of its count, with room for any way a site counts: a month as 31
# days (30-day or calendar months, floored or rounded), a year as 366. Then +1 hour for the gap between reading the
# page and writing the row, and for the site's clock.
_AGO_UNIT_DAYS = {"minute": 1 / 1440, "hour": 1 / 24, "day": 1, "week": 7, "month": 31, "year": 366}
_AGO_MARGIN = timedelta(hours=1)
_AGO_WORDS = [  # (word, unit, count it means on its own: 1, or 2 for the Arabic dual)
    *[(w, "minute", 1) for w in ("دقيقة", "دقيقه", "دقائق")], ("دقيقتين", "minute", 2),
    *[(w, "hour", 1) for w in ("ساعة", "ساعه", "ساعات")], ("ساعتين", "hour", 2),
    *[(w, "day", 1) for w in ("يوم", "يوما", "يومًا", "يوماً", "أيام", "ايام")], ("يومين", "day", 2),
    *[(w, "week", 1) for w in ("أسبوع", "اسبوع", "أسابيع", "اسابيع")], *[(w, "week", 2) for w in ("أسبوعين", "اسبوعين")],
    *[(w, "month", 1) for w in ("شهر", "شهرا", "شهراً", "أشهر", "اشهر", "شهور")], ("شهرين", "month", 2),
    *[(w, "year", 1) for w in ("سنة", "سنه", "سنوات", "سنين", "عام", "عاما", "عاماً", "أعوام", "اعوام")],
    *[(w, "year", 2) for w in ("سنتين", "عامين")],
]
_AGO_WORD = {w: (u, c) for w, u, c in _AGO_WORDS}
_AGO_PREFIX = re.compile(r"^(?:(?:مضاف|أضيف|اضيف|منذ|قبل)\s+)*")
_AGO_TEXT = re.compile(r"(?:(\d{1,3})\s+)?(\S+)", re.ASCII)
_AR_DIGITS = str.maketrans("٠١٢٣٤٥٦٧٨٩", "0123456789")


def ago_age_range(raw: Any) -> Optional[tuple[timedelta, timedelta]]:
    """«23 يوم» → (shortest, longest) age the text can mean, or None when it is not a plain «N unit» count.
    The longest end is open: the ad is YOUNGER than it."""
    if not isinstance(raw, str):
        return None
    r = _AGO_PREFIX.sub("", " ".join(raw.translate(_AR_DIGITS).split()))
    m = _AGO_TEXT.fullmatch(r)
    if not m or m.group(2) not in _AGO_WORD:
        return None
    unit, alone = _AGO_WORD[m.group(2)]
    if m.group(1) is not None and alone == 2:
        return None                       # «3 يومين» is not a count anyone writes: unreadable, never a guess
    n = int(m.group(1)) if m.group(1) is not None else alone
    day = _AGO_UNIT_DAYS[unit]
    shortest = {"month": 28, "year": 365}.get(unit, day) * n
    return timedelta(days=shortest), timedelta(days=day * (n + 1)) + _AGO_MARGIN


def posted_no_earlier_than(raw: Any, read_at: datetime) -> Optional[str]:
    """«23 يوم» read at `read_at` (aware) → the EARLIEST instant the ad can have been posted, as ISO-8601 UTC for
    `posted_earliest_at`; None when the text is not a plain count."""
    span = ago_age_range(raw)
    if span is None or read_at.tzinfo is None:
        return None
    return (read_at - span[1]).astimezone(timezone.utc).isoformat(timespec="seconds")
