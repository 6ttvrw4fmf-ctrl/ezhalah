"""The PDPL sanitizer cuts a CONTACT clause, never an English fixture (🔬 2026-11-05, Property Finder review).

«insta» and «snap» were bare prefixes in _CONTACT_CLAUSE_RE, so «Fully installed kitchen with appliances * Curtains installed
throughout» was cut to «Fully»: every English ad lost «installed kitchen», «installed AC», … before the word reader and the AI
reader saw it. They are whole words now; the contact data is still removed.
"""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scrapers.facts.extract import sanitize  # noqa: E402
from scrapers.facts import word_checker as W  # noqa: E402


def test_installed_is_not_instagram():
    out = sanitize(None, "Bedrooms: 3 * Fully installed kitchen with appliances * Curtains installed throughout * Parking")
    assert "installed kitchen with appliances" in out, out
    assert W.facts_of(W.clean_text(None, "Fully installed kitchen with appliances")).get("kitchen") is True


def test_snapshot_is_not_snapchat():
    assert "snapshot" in sanitize(None, "a snapshot of the view, kitchen and two balconies")


def test_social_handles_are_still_cut():
    for text in ("مطبخ راكب insta ahmed_home", "kitchen ready, instagram: @ahmed.home", "مطبخ راكب سناب ahmed", "kitchen ready snap ahmed99"):
        out = sanitize(None, text)
        assert "ahmed" not in out, out
