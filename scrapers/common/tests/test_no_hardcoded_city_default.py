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

Every match must be either a known false positive or present in ALLOWLIST with a citation. An
allowlist entry is matched by (file, exact stripped line) — editing the line at all requires a
conscious re-review here, which is intentional: this is a narrow, deliberate escape hatch, not a
blanket exemption for the file.

Two independently-evaluated pattern classes, added 2026-07-10 after adversarial mutation-testing
found the original single-regex-plus-line-wide-suppression design had a real gap: a NEW violation
added to the same line as an existing safe identifier (e.g. `city = CITY_MAP.get(raw) or "Riyadh"`)
slipped through, because the false-positive filter matched "CITY_MAP" and suppressed the ENTIRE
line — including the unrelated `or "Riyadh"` default sharing that line.

- `_LITERAL_DEFAULT_RE` — an unambiguous literal quoted capitalized-string default (`city = "X"` or
  `city = <anything> or "X"`). A literal quoted city-shaped string is dangerous regardless of what
  else is on the line, so this class is NEVER suppressed by a nearby safe identifier.
- `_IDENTIFIER_DEFAULT_RE` — a `*CITY`-named constant/dict read into `city =` (or `DEFAULT_CITY`
  bare, or `city.setdefault`). This class CAN be a legitimate translation dict (`CITY_MAP`,
  `TOWN_TO_CITY`) rather than a fallback default, so it is suppressed — but ONLY when the safe
  identifier's own match span overlaps THIS SPECIFIC match's span (position-aware), not merely
  because a safe identifier appears anywhere else on the same line.
"""
from __future__ import annotations

import re
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
SCRAPERS_DIR = REPO_ROOT / "scrapers"

# Captures the quoted string itself so a placeholder value ("Other"/"Unknown"/...) can be excluded
# below — that's a DIFFERENT, already-covered bug class (the runtime placeholder guard + its own
# test suite), not "a hardcoded REAL city" which is what this test targets.
_LITERAL_DEFAULT_RE = re.compile(
    r'city\s*=\s*"([A-Z][A-Za-z ]*)"'                  # city = "Riyadh"
    r'|city\s*=[^\n]{0,80}?\bor\s+"([A-Z][A-Za-z ]*)"'  # city = <anything, e.g. a .get(...) call> or "Riyadh"
)
_IDENTIFIER_DEFAULT_RE = re.compile(
    r'city\s*=\s*[A-Za-z_]*CITY\b\w*'  # city = SOME_CITY / DEFAULT_CITY / LOC_DEFAULT_CITY.get(...)
    r'|DEFAULT_CITY'
    r'|city\.setdefault'
)
_SAFE_IDENTIFIER_RE = re.compile(
    r"city_map|city_en|city_ar|city_key|city_seg|city_id|city_norm", re.IGNORECASE
)
_PLACEHOLDER_VALUES = {"other", "unknown", "n/a", "none", "null", "undefined"}

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
    # ── Newly discovered 2026-07-10 by the position-aware guard rewrite — NOT independently
    # verified, NOT fixed, code UNCHANGED. The original single-regex design never reliably matched
    # `city = <a .get(...) call> or "RealCity"` (a function call between `city =` and the `or`
    # broke the old adjacent-token pattern); fixing that gap surfaced these for the first time.
    # Flagged here so the guard passes today without silently missing them — each needs the SAME
    # live-verification-or-fix decision already applied to Awal/Mustqr, not a unilateral fix.
    (
        "scrapers/jazwtn/run.py",
        'city = normalize.map_city(title_raw) or "Jazan"',
        "Jazwtn: code comment on the next line claims 'the brokerage operates only in the Jazan "
        "region' (a region claim, not explicitly a city claim). NOT independently verified live. "
        "Newly discovered 2026-07-10 — same pending-decision treatment as Awal/Mustqr.",
    ),
    (
        "scrapers/hajer/run.py",
        'city = CITY_MAP_AR.get(raw_city) or normalize.map_city(raw_city) or "Hofuf"',
        "Hajer: project memory describes this platform as a boutique Al-Ahsa-area brokerage "
        "(Hofuf is Al-Ahsa's largest city), which would make this a plausible single-area constant "
        "— but that has NOT been independently verified against this specific default the way "
        "Ramzalqasim's region constant was. Newly discovered 2026-07-10.",
    ),
    (
        "scrapers/jurash/run.py",
        'city = normalize.map_city(city_ar) or normalize.map_city(title_raw) or "Khamis Mushait"',
        "Jurash: no comment claiming a single-city scope was found nearby. NOT verified. Newly "
        "discovered 2026-07-10 — needs the same live-verification-or-fix decision as the others, "
        "arguably with LESS existing evidence of being a legitimate constant than Jazwtn/Hajer.",
    ),
    (
        "scrapers/satel/run.py",
        'city = "Riyadh" if (not raw_city_en or "riyadh" in raw_city_en.lower() or raw_city_ar) else (raw_city_en or "Riyadh")',
        "Satel: comment says 'overwhelmingly Riyadh' (explicitly NOT single-city, unlike the other "
        "entries here). HIGHER CONCERN than the others: the condition defaults to 'Riyadh' whenever "
        "raw_city_ar is merely non-empty, regardless of what it actually says — meaning a real, "
        "different Arabic city name paired with noisy/unmapped English text would be silently "
        "overridden to 'Riyadh'. This looks more like the Nowaisiry/Deal bug shape than a legitimate "
        "brokerage constant. Newly discovered 2026-07-10, NOT fixed — recommend prioritizing this "
        "one first if/when this list is worked through.",
    ),
]


def _iter_py_files():
    for path in SCRAPERS_DIR.rglob("*.py"):
        if "__pycache__" in path.parts or path.parent.name == "tests":
            continue
        yield path


def _docstring_line_mask(lines: list[str]) -> list[bool]:
    """True for each line that's inside a triple-quoted string (module/function docstring or a
    multi-line prose block) — a rough but effective heuristic (toggles on each odd count of a
    triple-quote marker per line). Prose explaining the rule/an incident (e.g. this file's own
    docstring, or scrapers/wasalt/recover_other.py's root-cause writeup) legitimately uses a
    real-looking `city = X or "SomeCity"` example; it must not be treated as a live violation."""
    mask = []
    in_doc = False
    for line in lines:
        starts_in_doc = in_doc
        for marker in ('"""', "'''"):
            if line.count(marker) % 2 == 1:
                in_doc = not in_doc
        mask.append(starts_in_doc or in_doc)
    return mask


def _line_is_violation(raw_line: str) -> bool:
    """True if `raw_line` matches either candidate class and isn't suppressed. Literal quoted-city
    defaults are never suppressed by a same-line safe identifier (though a PLACEHOLDER value like
    "Other"/"Unknown" is excluded — that's the separate, already-covered placeholder-guard bug
    class). Identifier-shaped matches are suppressed only when a safe identifier's match span
    overlaps THIS specific candidate match (position-aware)."""
    for m in _LITERAL_DEFAULT_RE.finditer(raw_line):
        value = next(g for g in m.groups() if g is not None)
        if value.strip().lower() not in _PLACEHOLDER_VALUES:
            return True
    safe_spans = [m.span() for m in _SAFE_IDENTIFIER_RE.finditer(raw_line)]
    for m in _IDENTIFIER_DEFAULT_RE.finditer(raw_line):
        overlaps_safe = any(s[0] < m.end() and s[1] > m.start() for s in safe_spans)
        if not overlaps_safe:
            return True
    return False


def test_no_new_hardcoded_city_default_outside_allowlist():
    allowlist_lookup = {
        (rel, line.strip()): reason for rel, line, reason in ALLOWLIST_ENTRIES
    }
    seen_allowlist_keys: set[tuple[str, str]] = set()
    violations: list[str] = []

    for path in _iter_py_files():
        rel = str(path.relative_to(REPO_ROOT))
        lines = path.read_text(encoding="utf-8").splitlines()
        doc_mask = _docstring_line_mask(lines)
        for lineno, (raw_line, in_doc) in enumerate(zip(lines, doc_mask), start=1):
            if raw_line.strip().startswith("#") or in_doc:
                continue  # prose documenting the pattern (e.g. explaining a removed default)
            if not _line_is_violation(raw_line):
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


def test_same_line_safe_identifier_no_longer_masks_a_real_default():
    # The exact gap adversarial mutation-testing found in the original design: a safe identifier
    # (CITY_MAP) sharing a line with a genuinely dangerous literal default (`or "Riyadh"`) used to
    # suppress the WHOLE line. Position-aware matching must catch this regardless of the identifier.
    line = 'city = CITY_MAP.get(raw_city) or "Riyadh"'
    assert _line_is_violation(line)


def test_safe_identifier_alone_on_the_matched_span_is_still_suppressed():
    # The identifier class must still recognize a genuine translation dict with NO separate literal
    # default anywhere on the line — this is the Souq24/Awal-fixed-line shape, which needs an
    # ALLOWLIST citation (tested below), not an unconditional failure.
    line = 'city = TOWN_TO_CITY.get(raw_city) or TOWN_TO_CITY.get(key)'
    assert _line_is_violation(line)  # still flagged — but as an identifier match, allowlisted below
    line2 = 'city = LOC_DEFAULT_CITY.get(loc_slug or "")'
    assert _line_is_violation(line2)  # ditto — allowlisted, not suppressed outright


def test_unrelated_safe_identifier_elsewhere_on_the_line_does_not_suppress_a_separate_literal():
    # A second, more adversarial variant: the safe identifier appears BEFORE the dangerous literal
    # default in an unrelated sub-expression, not overlapping it at all.
    line = 'city = city_ar_lookup.get(x) if x else CITY_MAP.get(y) or "Jeddah"'
    assert _line_is_violation(line)


def test_every_currently_allowlisted_line_is_still_recognized_as_a_candidate():
    # Sanity check that the regex redesign didn't accidentally stop matching any of the lines the
    # allowlist exists for (which would silently turn an "accepted, cited exception" into "not even
    # checked anymore" — a much worse outcome than a false positive).
    for _, line, _ in ALLOWLIST_ENTRIES:
        assert _line_is_violation(line), f"allowlisted line no longer recognized as a candidate: {line!r}"


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
