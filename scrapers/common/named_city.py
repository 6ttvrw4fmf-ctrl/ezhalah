"""The ONE city an ad's own words name — or None (backlog 1205, 2026-11-02).

Some small brokerages leave their structured city empty while their own text says it: ramzalqasim
«📍 الموقع: حي الرحاب – عنيزة», «أرض في شمال بريدة», «عمارة في حي الريان بالرس»; erapulse «… بحي الصفاء – بريدة».
Rule (SOURCE IS TRUTH — never guess):
  · a city counts only as a WHOLE word, optionally with ONE glued preposition (ب / و / ل / ف / وب): «بالرس» is
    الرس, but «المدارس» is not, and «الرسالة» is not;
  · a city right after «طريق» / «شارع» is a road name («طريق بريدة» runs through عنيزة), not where the ad is;
  · two DIFFERENT cities named → ambiguous → None. Never a default, never the agency's home town.
"""
from __future__ import annotations

import re
from typing import Iterable, Optional

# Qassim cities as the region's ads write them → the canonical English name normalize.map_city uses.
QASSIM_CITIES = {
    "بريدة": "Buraidah", "بريده": "Buraidah",
    "عنيزة": "Unaizah", "عنيزه": "Unaizah",
    "الرس": "Ar Rass",
    "البكيرية": "Al Bukayriyah", "البكيريه": "Al Bukayriyah",
    "المذنب": "Al Mithnab",
    "البدائع": "Al Badai", "البدايع": "Al Badai",
    "رياض الخبراء": "Riyadh Al Khabra",
    "النبهانية": "An Nabhaniyah",
    "الشماسية": "Ash Shamasiyah",
}

_ROAD_WORDS = ("طريق", "شارع")
_PREFIX = r"(?:وب|ب|و|ل|ف)?"


def _pattern(word: str) -> re.Pattern[str]:
    # «الرس» glued to «ب» is «بالرس»; a word starting with ال keeps its ال after the preposition.
    return re.compile(r"(?<![\w؀-ۿ])" + _PREFIX + re.escape(word) + r"(?![\w؀-ۿ])")


_PATTERNS = {w: _pattern(w) for w in QASSIM_CITIES}


def named_cities(text: str, cities: dict[str, str] = QASSIM_CITIES) -> set[str]:
    """Every canonical city the text names as a place (road names excluded)."""
    found: set[str] = set()
    if not text:
        return found
    for word, canon in cities.items():
        rx = _PATTERNS.get(word) or _pattern(word)
        for m in rx.finditer(text):
            before = text[:m.start()].split()[-1:] or [""]
            if before[0] in _ROAD_WORDS:
                continue
            found.add(canon)
    return found


def single_named_city(texts: Iterable[Optional[str]], cities: dict[str, str] = QASSIM_CITIES) -> Optional[tuple[str, str]]:
    """(canonical, Arabic as written first) when the ad's own texts name exactly ONE city, else None."""
    joined = "\n".join(t for t in texts if t)
    found = named_cities(joined, cities)
    if len(found) != 1:
        return None
    canon = next(iter(found))
    first = min((m.start(), w) for w, c in cities.items() if c == canon
                for m in (_PATTERNS.get(w) or _pattern(w)).finditer(joined))
    return canon, first[1]
