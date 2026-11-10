"""The office's own type word, read from an ad TITLE with the closed, boundary-safe vocabulary.

One reader for every scraper (🦅 2026-11-10): `parse_type_ar` lives with the inblaj tenants that first needed it
(scrapers/common/inblaj_platform.py, safera / gudai / alhumaidan). A crawler that only wants the title reader
imports it from HERE, so that importing a text reader is never mistaken for adopting the inblaj fetch path
(scrapers/common/tests/test_crawler_fetch_resilience_ratchet.py reads «inblaj_platform» in a crawler as «uses the
shared resilient fetch»; erapulse still fetches with its own session and must stay on that list).
"""
from __future__ import annotations

from typing import Optional

from scrapers.common import normalize
from scrapers.common.inblaj_platform import parse_type_ar


def canonical_type_from_title(title: Optional[str]) -> Optional[str]:
    """The canonical English type the title names («فله مودرن -حي الربوة للبيع» → Villa), or None when it names none."""
    word = parse_type_ar(title or "", "")
    return normalize.map_type_exact(word) if word else None


__all__ = ["parse_type_ar", "canonical_type_from_title"]
