"""Hermetic guard: a retired platform must never re-enter an active workflow matrix.

toor was formally retired 2026-07-06 (commit d5ca9d6 removed its small-sources-sync.yml matrix
line, owner-approved: toor.ooo IP-blocks datacenter + proxy IPs, 0 rows for weeks) — and PR #77
(da19962) silently re-added that exact line eight days later, putting a dead platform back on the
daily cron. A one-time removal is clearly not a durable retirement, so this test makes the
regression un-mergeable: it parses every .github/workflows/*.yml for ACTIVE (non-commented)
platform-matrix `source:` entries and FAILS if any slug listed in scrapers/RETIRED_PLATFORMS.txt
appears.

Zero dependencies beyond pytest — plain-text parsing on purpose. pyyaml is NOT in
scrapers/requirements.txt (the CI job installs only pytest + those pins), and a YAML loader would
also erase the comment/active distinction this guard hinges on.
"""
from __future__ import annotations

import re
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
WORKFLOWS_DIR = REPO_ROOT / ".github" / "workflows"
RETIRED_FILE = REPO_ROOT / "scrapers" / "RETIRED_PLATFORMS.txt"

# An ACTIVE matrix entry that names a platform, in either house style:
#     - { source: toor,        cmd: "python -m scrapers.toor.run --type all" }
#     - source: toor
#       source: toor
# Deliberately does NOT match the other `source` look-alikes in these workflows:
#   • the workflow_dispatch input key `source:` (no value on that line),
#   • `${{ matrix.source }}` / `github.event.inputs.source` expressions (no `source:` key),
#   • any line whose first non-blank character is `#` (comments are filtered before matching).
_SOURCE_RE = re.compile(r"""^\s*(?:-\s*)?\{?\s*source:\s*["']?([A-Za-z0-9_-]+)""")


def retired_slugs() -> set[str]:
    """Slugs from RETIRED_PLATFORMS.txt — one per line, blank lines and # comments skipped."""
    slugs = set()
    for line in RETIRED_FILE.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#"):
            slugs.add(line)
    return slugs


def active_matrix_sources(text: str):
    """Yield (lineno, slug) for every ACTIVE `source:` matrix entry in a workflow file's text."""
    for lineno, line in enumerate(text.splitlines(), 1):
        if line.lstrip().startswith("#"):
            continue  # a commented-out / NOTE line is not an active matrix entry
        m = _SOURCE_RE.match(line)
        if m:
            yield lineno, m.group(1)


def test_retired_platforms_file_lists_the_known_retirees():
    """The registry itself must exist, parse, and carry the three known retirements — an emptied
    or reformatted file would otherwise turn the whole guard into a silent no-op."""
    assert RETIRED_FILE.is_file(), f"missing {RETIRED_FILE}"
    slugs = retired_slugs()
    assert {"toor", "alnokhba", "muktamel"} <= slugs, (
        f"RETIRED_PLATFORMS.txt lost a known retired slug — has {sorted(slugs)}. Un-retiring a "
        "platform requires owner approval; see the file's header for the contract."
    )


def test_parser_sees_the_small_sources_matrix():
    """Dead-guard protection: if the matrix format drifts and the parser stops matching, this
    fails loudly instead of the guard silently passing on everything."""
    wf = WORKFLOWS_DIR / "small-sources-sync.yml"
    assert wf.is_file(), f"missing {wf}"
    found = {slug for _, slug in active_matrix_sources(wf.read_text(encoding="utf-8"))}
    assert len(found) >= 10, f"parser only matched {sorted(found)} — matrix format changed?"
    assert "sanadak" in found and "dealapp" in found  # two known long-lived active sources


def test_parser_distinguishes_active_entries_from_comments():
    snippet = (
        "      matrix:\n"
        "        include:\n"
        '          - { source: sanadak, cmd: "python -m scrapers.sanadak.run --type all" }\n'
        '          # - { source: toor, cmd: "python -m scrapers.toor.run --type all" }\n'
        "          # NOTE: source: alnokhba was removed 2026-07-14.\n"
        "          - source: hajer\n"
    )
    assert [s for _, s in active_matrix_sources(snippet)] == ["sanadak", "hajer"]


def test_parser_ignores_the_dispatch_input_and_expressions():
    snippet = (
        "on:\n"
        "  workflow_dispatch:\n"
        "    inputs:\n"
        "      source:\n"
        '        description: "Single source to run (blank = all)"\n'
        "    if: ${{ github.event.inputs.source == '' || github.event.inputs.source == matrix.source }}\n"
        "      - name: Sync ${{ matrix.source }}\n"
    )
    assert list(active_matrix_sources(snippet)) == []


def test_no_retired_platform_in_any_active_workflow_matrix():
    """THE guard. Scans every workflow yml (not just small-sources-sync.yml) so a retired platform
    can't sneak back in via a new/renamed matrix workflow either."""
    retired = retired_slugs()
    offenders = []
    for wf in sorted(WORKFLOWS_DIR.glob("*.yml")):
        for lineno, slug in active_matrix_sources(wf.read_text(encoding="utf-8")):
            if slug in retired:
                offenders.append(f"{wf.relative_to(REPO_ROOT)}:{lineno} → source: {slug}")
    assert not offenders, (
        "RETIRED platform(s) re-added to an active workflow matrix:\n  "
        + "\n  ".join(offenders)
        + "\nRetired platforms (scrapers/RETIRED_PLATFORMS.txt) must stay out of every matrix — "
        "see the file header for the un-retire procedure (owner approval required). "
        "This exact regression already happened once: PR #77 re-added toor after d5ca9d6 retired it."
    )
