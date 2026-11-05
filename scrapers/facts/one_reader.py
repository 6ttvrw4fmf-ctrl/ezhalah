"""ONE READER (owner 2026-11-03, «clear them»).

The yes / no a scraper stores for an amenity column it reads from the ad's PROSE (dealapp, rakez, wasalt — sites with
no structured field for it) comes from the Advanced Filter's word reader (scrapers/facts/word_checker.py), never from the
older, looser normalize.prose_amenities: that matcher served ~2,400 yeses the ad's words do not state («مداخل مكيفة» =
air-conditioned lobbies as unit AC, «مكان مخصص للمصعد» = a reserved shaft as an elevator). Kept in its own module so
adopting it does not change word_checker.py, whose hash is the reader version (a change there re-reads every ad).
"""
from __future__ import annotations

from typing import Iterable, Optional

from scrapers.facts import word_checker as W


def amenity_answers(text: Optional[str], columns: Iterable[str], rename: Optional[dict[str, str]] = None) -> dict[str, bool]:
    """{column: True|False} the word reader finds in `text`, limited to `columns`; `rename` maps a reader key to the
    table's column name (balcony → balcony_terrace). Silence, prepared-only and nearby give no key."""
    if not text or not str(text).strip():
        return {}
    cols = set(columns)
    rename = rename or {}
    said = {rename.get(k, k): v for k, v in W.facts_of(W.clean_text(None, str(text))).items() if isinstance(v, bool)}
    return {c: v for c, v in said.items() if c in cols}


# The columns normalize.prose_amenities filled, under the same names (balcony_terrace is the tables' balcony column), so a
# scraper that called it swaps one line: `prose = listing_amenities(text)` (2026-11-05: Keller Williams, Asas Makeen, Al Rajhi
# and STeam were staged on the old matcher the day the one-reader guard landed).
LISTING_COLUMNS = ("air_conditioner", "balcony_terrace", "car_entrance", "driver_room", "elevator", "furnished", "kitchen",
                   "laundry_room", "maid_room", "optical_fibers", "parking", "private_entrance")


def listing_amenities(text: Optional[str], skip: Iterable[str] = ()) -> dict[str, bool]:
    """The ONE reader's answers for the old matcher's columns; `skip` = columns the site publishes structurally."""
    skipped = set(skip)
    return {c: v for c, v in amenity_answers(text, LISTING_COLUMNS, {"balcony": "balcony_terrace"}).items() if c not in skipped}
