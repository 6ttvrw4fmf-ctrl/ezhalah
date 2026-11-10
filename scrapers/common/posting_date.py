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
