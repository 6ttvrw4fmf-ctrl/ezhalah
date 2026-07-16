"""Batch 2 type-truth guard (2026-07-16 owner directive): an UNMAPPED raw property type must be
quarantined + alerted — preserved RAW so the hourly DB novel-type detector
(detect_novel_property_types) fires — never confidently misclassified as "Residential Land".

Live data proved the old `map_type(x) or "Residential Land"` fallback fired constantly
(ramzalqasim 63% / alkhaas 46% of rows stored as 'أرض سكنية'), silently mislabeling every
unknown source type as land. This hermetic source-lint (no network/DB) keeps it dead:

  1. No scrapers/*/run.py may contain an `or "Residential Land"` fallback EXCEPT the annotated
     routing-legacy line — `property_type = <mapped> or "Residential Land"` carrying the
     `type-truth: routing-legacy` marker — which exists ONLY so residential/commercial table
     routing and field-sanity rules stay byte-identical; it is never stored.
  2. Every repaired scraper must keep storing the raw-preserving `stored_property_type` in its
     row dict (guards against reverting the row assignment while keeping the marker).

Run: python -m pytest scrapers/common/tests/test_no_type_default_fallback.py -v
"""
from __future__ import annotations

import re
from pathlib import Path

SCRAPERS_DIR = Path(__file__).resolve().parents[2]  # …/scrapers
REPO_ROOT = SCRAPERS_DIR.parent

FALLBACK_RE = re.compile(r"""or\s+(?P<q>["'])Residential Land(?P=q)""")
MARKER = "type-truth: routing-legacy"
# The ONLY shape the marker may bless: a plain routing-legacy assignment to property_type.
LEGACY_LINE_RE = re.compile(
    r"""^\s*property_type\s*=\s*\w+\s+or\s+(?P<q>["'])Residential Land(?P=q)\s*#"""
)

# The 10 scrapers repaired in Batch 2 (2026-07-16) — each must store the raw-preserving value.
REPAIRED = [
    "alkhaas", "aqaratikom", "aqarcity", "jurash", "muktamel",
    "raghdan", "ramzalqasim", "sadin", "sanadak", "souq24",
]


def _run_py_files() -> list[Path]:
    files = sorted(SCRAPERS_DIR.glob("*/run.py"))
    assert files, f"no scrapers/*/run.py found under {SCRAPERS_DIR}"
    return files


def test_no_residential_land_type_fallback_reappears():
    offenders: list[str] = []
    for path in _run_py_files():
        for lineno, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
            if not FALLBACK_RE.search(line):
                continue
            # Allowed ONLY as the annotated routing-legacy line (never stored).
            if MARKER in line and LEGACY_LINE_RE.match(line):
                continue
            offenders.append(f"{path.relative_to(REPO_ROOT)}:{lineno}: {line.strip()}")
    assert not offenders, (
        "Banned `or \"Residential Land\"` type fallback found — unknown property types must be "
        "preserved RAW (quarantine + alert via detect_novel_property_types), never confidently "
        "misclassified (owner directive 2026-07-16):\n" + "\n".join(offenders)
    )


def test_repaired_scrapers_store_raw_preserving_type():
    for name in REPAIRED:
        src = (SCRAPERS_DIR / name / "run.py").read_text(encoding="utf-8")
        assert '"property_type": stored_property_type' in src, (
            f"scrapers/{name}/run.py no longer stores stored_property_type — the row must carry "
            "the raw source type when the mapping misses (owner directive 2026-07-16)"
        )
        assert '"property_type": property_type' not in src, (
            f"scrapers/{name}/run.py stores the routing-legacy property_type again — that value "
            "confidently misclassifies unmapped types as Residential Land; store "
            "stored_property_type instead"
        )
