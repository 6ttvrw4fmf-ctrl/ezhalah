"""A NEW scraper reads prose amenities with the ONE reader (owner 2026-11-03, «one reader»; guard added 2026-11-05).

On 2026-11-04 Property Finder launched filling kitchen / AC / lift / maid room from its prose with the older
normalize.prose_amenities — the matcher the 11-03 audit found storing «مداخل مكيفة» (a lobby) as unit AC — a day after the
rule said every prose amenity comes from scrapers/facts/one_reader.amenity_answers. Nothing checked it. This does:
the scrapers that still call the old matcher are a SHRINK-ONLY list (old_prose_matcher_baseline.txt). A file that is not
on it may not call the old matcher; a listed file that no longer calls it must be deleted from the list (stale).
"""
from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
BASELINE = Path(__file__).with_name("old_prose_matcher_baseline.txt")
# amenities_from_lines() is the same old matcher run per line (🔬 2026-11-14): five scrapers called it and the guard,
# matching only the two names above, could not see them (aqarcity, eaqartabuk, eastabha, hajer, sirdab).
OLD = re.compile(r"\b(?:prose_amenities|amenities_from_text|amenities_from_lines)\(")


def _callers() -> set[str]:
    out = set()
    for p in (ROOT / "scrapers").rglob("*.py"):
        rel = p.relative_to(ROOT).as_posix()
        if rel.startswith(("scrapers/common/", "scrapers/facts/")) or "/tests/" in rel or p.name.startswith("test_"):
            continue
        if OLD.search(p.read_text(encoding="utf-8", errors="ignore")):
            out.add(rel)
    return out


def _baseline() -> set[str]:
    return {ln.strip() for ln in BASELINE.read_text(encoding="utf-8").splitlines() if ln.strip() and not ln.startswith("#")}


def test_no_new_scraper_uses_the_old_prose_matcher():
    new = _callers() - _baseline()
    assert not new, f"use scrapers.facts.one_reader.amenity_answers, not the old matcher: {sorted(new)}"


def test_the_baseline_only_shrinks():
    stale = _baseline() - _callers()
    assert not stale, f"these no longer call the old matcher — delete them from {BASELINE.name}: {sorted(stale)}"


def test_property_finder_reads_with_the_one_reader():
    src = (ROOT / "scrapers/propertyfinder/run.py").read_text(encoding="utf-8")
    assert "amenity_answers(" in src and not OLD.search(src)
