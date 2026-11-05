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
