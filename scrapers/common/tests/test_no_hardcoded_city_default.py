"""Centralized enforcement of the permanent rule (owner directive, 2026-07-10):

    No scraper may default a missing or unresolved location to a specific real city. If the
    source does not provide enough evidence for an exact catalog match, store it as unresolved.

This is a repo-wide static sweep — the same regex shape used to manually find Deal, Ramzalqasim,
Al Nokhba, Nowaisiry, and Awal's violations of this rule — turned into a test so a FUTURE scraper
(or a regression in an existing one) that reintroduces the pattern fails the build instead of
silently shipping. This complements, not replaces, the runtime `guard_location_update()` DB-write
gate: that gate only catches known PLACEHOLDER tokens ("Other"/"Unknown"/...); it cannot catch a
scraper hardcoding an assumed-real city name (e.g. "Riyadh", "Sakaka") as a fallback, which is a
different bug shape this test exists to close.

Every match must be either a known false positive (a `city_ar`/`city_map`/`city_id`-style
identifier, filtered below) or present in ALLOWLIST with a citation. An allowlist entry is matched
by (file, exact stripped line) — editing the line at all requires a conscious re-review here, which
is intentional: this is a narrow, deliberate escape hatch, not a blanket exemption for the file.
"""
from __future__ import annotations

import re
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
SCRAPERS_DIR = REPO_ROOT / "scrapers"

# Same shape as the manual sweep that found every violation fixed in this PR + its follow-up.
_CANDIDATE_RE = re.compile(
    r'city\s*=\s*"[A-Z]'          # city = "Riyadh"
    r'|city\s*=\s*[A-Za-z_]*CITY'  # city = SOME_CITY / DEFAULT_CITY
    r'|DEFAULT_CITY'
    r'|city\.setdefault'
    r'|city\s+or\s+"[A-Z]'         # city or "Riyadh"
)
_FALSE_POSITIVE_RE = re.compile(
    r"city_map|city_en|city_ar|city_key|city_seg|city_id|city_norm", re.IGNORECASE
)

# (relative file path, exact stripped source line, citation). A hardcoded "this whole brokerage
# operates in exactly one real city/region" constant is a DIFFERENT, already-accepted pattern from
# the bug this rule targets (guessing on a per-row parse failure) — see docs/LOCATION_RESOLUTION.md
# "Known accepted single-city/region constants" for the full writeup of each entry below.
ALLOWLIST_ENTRIES: list[tuple[str, str, str]] = [
    (
        "scrapers/awal/run.py",
        'LOC_DEFAULT_CITY = {"arar": "Arar"}',
        "Awal: single-slug 'arar'->'Arar' constant. Claimed (code comment) that every RTCL "
        "'arar'-taxonomy listing is genuinely in Arar city. NOT yet independently verified live — "
        "owner directive 2026-07-10 was explicit: 'do not change the Arar branch until it is "
        "independently verified.' Tracked as a known-pending item in docs/LOCATION_RESOLUTION.md; "
        "do not extend, do not silently re-approve if the surrounding code changes.",
    ),
    (
        "scrapers/awal/run.py",
        'city = LOC_DEFAULT_CITY.get(loc_slug or "")',
        "Awal: the fixed usage line (2026-07-10) — falls through to None for 'jouf' and any "
        "unknown slug; only 'arar' (see entry above) still maps to a real city. Flagged here only "
        "because the regex matches any read of a '*CITY'-named constant into `city =`, safe or not "
        "— re-review is required if this line changes.",
    ),
    (
        "scrapers/mustqr/run.py",
        'DEFAULT_CITY = "Hail"',
        "Mustqr: claimed (code comment) to be a single-city Hail-based brokerage; a 20-neighborhood "
        "live sample showed no obviously-foreign town names, but a direct check against Mustqr's own "
        "source API was NOT possible (no valid API key available). NOT independently verified — "
        "owner directive 2026-07-10: 'Do not change Mustqr yet. First obtain stronger evidence.' "
        "Tracked as a known-pending item in docs/LOCATION_RESOLUTION.md.",
    ),
    (
        "scrapers/mustqr/run.py",
        'DEFAULT_REGION = "Hail"',
        "Same Mustqr single-brokerage claim as DEFAULT_CITY above — region, not city, but swept up "
        "by the same DEFAULT_CITY-shaped regex; tracked/pending together.",
    ),
    (
        "scrapers/mustqr/run.py",
        '"city": DEFAULT_CITY,',
        "Usage site of the DEFAULT_CITY constant above — same pending-verification status, not a "
        "separate claim.",
    ),
    (
        "scrapers/souq24/run.py",
        'city = TOWN_TO_CITY.get(raw_city) or TOWN_TO_CITY.get(key)',
        "Souq24: TOWN_TO_CITY is a translation dict (town name -> canonical city), not a fallback "
        "default — confirmed 2026-07-10 during the universal-rule sweep. Falls through to None "
        "cleanly when neither key matches (verified: no hardcoded final default anywhere in this "
        "chain). Flagged only because the regex matches any '*CITY'-named dict read into `city =`.",
    ),
]


def _iter_py_files():
    for path in SCRAPERS_DIR.rglob("*.py"):
        if "__pycache__" in path.parts or path.parent.name == "tests":
            continue
        yield path


def test_no_new_hardcoded_city_default_outside_allowlist():
    allowlist_lookup = {
        (rel, line.strip()): reason for rel, line, reason in ALLOWLIST_ENTRIES
    }
    seen_allowlist_keys: set[tuple[str, str]] = set()
    violations: list[str] = []

    for path in _iter_py_files():
        rel = str(path.relative_to(REPO_ROOT))
        for lineno, raw_line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
            if raw_line.strip().startswith("#"):
                continue  # prose documenting the pattern (e.g. explaining a removed default)
            if not _CANDIDATE_RE.search(raw_line):
                continue
            if _FALSE_POSITIVE_RE.search(raw_line):
                continue
            key = (rel, raw_line.strip())
            if key in allowlist_lookup:
                seen_allowlist_keys.add(key)
                continue
            violations.append(f"{rel}:{lineno}: {raw_line.strip()!r}")

    assert not violations, (
        "Found hardcoded specific-city-default pattern(s) not in ALLOWLIST — this violates the "
        "permanent rule 'no scraper may default a missing/unresolved location to a specific real "
        "city' (owner directive 2026-07-10). If genuinely a new single-city/region brokerage "
        "constant (not a per-row guess), add a citation to ALLOWLIST_ENTRIES in this file AND to "
        "docs/LOCATION_RESOLUTION.md; otherwise fix the scraper to leave the value unresolved "
        "(None) instead of guessing:\n" + "\n".join(violations)
    )


def test_allowlist_has_no_stale_entries():
    # If a line in ALLOWLIST_ENTRIES no longer exists verbatim in its file (renamed var, refactor,
    # or — hopefully — finally independently verified and rewritten), the entry is stale: either the
    # file changed underneath an unreviewed exemption, or the exemption can be deleted. Either way,
    # a human needs to look, not have the test silently stop checking a real file.
    allowlist_lookup = {(rel, line.strip()) for rel, line, _ in ALLOWLIST_ENTRIES}
    found_in_repo: set[tuple[str, str]] = set()
    for path in _iter_py_files():
        rel = str(path.relative_to(REPO_ROOT))
        text_lines = {ln.strip() for ln in path.read_text(encoding="utf-8").splitlines()}
        for key_rel, key_line in allowlist_lookup:
            if key_rel == rel and key_line in text_lines:
                found_in_repo.add((key_rel, key_line))
    stale = allowlist_lookup - found_in_repo
    assert not stale, f"ALLOWLIST_ENTRIES has stale entries no longer found verbatim: {stale}"
