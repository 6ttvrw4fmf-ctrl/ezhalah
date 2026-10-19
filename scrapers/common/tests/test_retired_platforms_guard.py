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
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))
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


def parse_slugs(text: str) -> set[str]:
    """Slugs from a RETIRED_PLATFORMS.txt body — one per line, blank lines and # comments skipped."""
    slugs = set()
    for line in text.splitlines():
        line = line.strip()
        if line and not line.startswith("#"):
            slugs.add(line)
    return slugs


def retired_slugs() -> set[str]:
    return parse_slugs(RETIRED_FILE.read_text(encoding="utf-8"))


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
    assert {"toor", "alnokhba", "deal"} <= slugs, (
        f"RETIRED_PLATFORMS.txt lost a known retired slug — has {sorted(slugs)}. Un-retiring a "
        "platform requires owner approval; see the file's header for the contract."
    )
    # muktamel was pinned here until 2026-09-19 and `deal` never was. Both were wrong in the same
    # way: this pin is a hand-kept copy of the file it guards, so it can only ever go stale — it
    # held muktamel for the two weeks muktamel was live. It is kept ONLY as anti-emptying
    # protection (a blanked file must not turn the matrix guard into a no-op). Whether a listed
    # slug still DESERVES to be listed is decided by the derived barrier below, not here.


def test_parser_sees_the_small_sources_matrix():
    """Dead-guard protection: if the matrix format drifts and the parser stops matching, this
    fails loudly instead of the guard silently passing on everything."""
    wf = WORKFLOWS_DIR / "small-sources-sync.yml"
    assert wf.is_file(), f"missing {wf}"
    found = {slug for _, slug in active_matrix_sources(wf.read_text(encoding="utf-8"))}
    assert len(found) >= 10, f"parser only matched {sorted(found)} — matrix format changed?"
    # Two known long-lived active sources, used purely as a canary that the matrix parser still
    # matches real entries. `dealapp` was one of them until 2026-08-11, when it moved OUT of this
    # matrix into the 12-shard fleet (.github/workflows/dealapp-sharded.yml, owner-approved option
    # b) — so it is deliberately no longer expected here, and verify-dealapp-crawl-budget.ts now
    # fails CI if it ever reappears in this file. `october` replaces it as the second canary.
    assert "sanadak" in found and "october" in found


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


# ── THE SECOND GUARD: is the retirement still TRUE? ─────────────────────────────────────────────
#
# Everything above keeps a retired slug OUT of a matrix. Not one line of it ever asks whether the
# slug still belongs on the list at all, and that blind spot has now cost twice:
#
#   · toor sat retired for 10 weeks on a reason ("the host IP-blocks us") that had stopped being
#     true. Found by the owner asking, not by a check. That produced
#     scripts/reprobe-retired-platforms.mjs — which answers "is the SITE up", weekly, over the
#     network.
#   · muktamel was un-retired in production on 2026-09-05 and this file was never updated. The
#     re-probe could not have caught it: muktamel was in that script's SKIP set, and even unskipped
#     "the site responds" is not the question. The question is whether OUR OWN registry still
#     agrees the platform is retired — and nothing asked it.
#
# So this is the cheap half the network probe cannot do: a slug listed as retired must not also be
# registered as production-searchable. It is a fact about two files in this repo, so it is hermetic,
# it runs on every PR, and it fails in the PR that creates the contradiction rather than a week
# later in a scheduled log.
#
# WHY liveness_policies.POLICIES IS THE RIGHT ORACLE. platform_registry is the authority on
# `status='active'`, and it is not anon-readable (a bare select returns zero rows — see the note in
# scripts/verify-active-platform-image-coverage-not-blind.ts), so a barrier cannot query it without
# a new RPC and a production migration. POLICIES is this repo's committed mirror of exactly that
# column: "THE LIVENESS REGISTRY — every production-searchable platform declares its strategy here",
# and its own header is explicit that it FOLLOWS production ("this mirror follows production, it
# does not vote"). It is also the file that already recorded the truth this one missed — muktamel
# left NOT_PRODUCTION_SEARCHABLE and gained a policy row on 2026-09-04, the very day the drift
# began. Reading it is therefore not a second opinion; it is the same fact, already in git.
#
# It is not read as TEXT, either: the module is imported and the real POLICIES dict is inspected, so
# renaming or restructuring the file cannot leave this asserting a string that no longer means
# anything.


def retirements_contradicted_by_the_registry(slugs: set[str]) -> list[str]:
    """Slugs claimed retired that the liveness registry grades as production-searchable.

    Pure in its input so the pre-fix file can be fed to it verbatim (see the mutation proof below).
    """
    from scrapers.common.liveness_policies import POLICIES

    return sorted(s for s in slugs if s in POLICIES)


def test_the_registry_oracle_is_populated():
    """Dead-guard protection, the same shape as test_parser_sees_the_small_sources_matrix: if
    POLICIES is emptied, renamed or restructured, the barrier below would pass on everything."""
    from scrapers.common.liveness_policies import POLICIES

    assert len(POLICIES) >= 40, f"liveness registry only has {len(POLICIES)} rows — structure changed?"
    assert "aqar" in POLICIES and "wasalt" in POLICIES


def test_no_retired_platform_is_live_in_the_liveness_registry():
    """THE barrier. A platform cannot be retired here and production-searchable there."""
    offenders = retirements_contradicted_by_the_registry(retired_slugs())
    assert not offenders, (
        "slug(s) listed in RETIRED_PLATFORMS.txt are registered as PRODUCTION-SEARCHABLE in "
        f"scrapers/common/liveness_policies.py: {', '.join(offenders)}.\n"
        "These two files disagree about whether the platform exists. One of them is wrong:\n"
        "  · if the platform IS live, delete its slug from RETIRED_PLATFORMS.txt (keep the comment "
        "as history, like jazwtn/awal/muktamel) — every reference to that file is a guard that "
        "keeps the slug OUT of work it belongs in, and it fails silently;\n"
        "  · if the platform is genuinely retired, remove its POLICIES row and add it to "
        "NOT_PRODUCTION_SEARCHABLE in the same change."
    )


# The slug block of RETIRED_PLATFORMS.txt EXACTLY as it stood before the 2026-09-19 fix. Kept
# verbatim so the proof below is that this barrier catches the REAL defect, on the REAL file
# content, rather than on a hypothetical one shaped to be caught.
PRE_FIX_FILE = """# muktamel  — paused 2026-07-15: runs on its OWN gated weekly workflow (muktamel-sync.yml), never
#             the shared matrix; listed here so it cannot re-enter any matrix while paused.
toor
alnokhba
muktamel
deal
"""


def test_the_barrier_fails_on_the_pre_fix_file():
    """MUTATION PROOF. Passing today is not evidence: feed it the file as it actually was and it
    must name muktamel. Without this, a barrier that always returned [] would look identical."""
    assert parse_slugs(PRE_FIX_FILE) == {"toor", "alnokhba", "muktamel", "deal"}
    assert retirements_contradicted_by_the_registry(parse_slugs(PRE_FIX_FILE)) == ["muktamel"]


def test_the_barrier_is_not_vacuous():
    """...and the converse: it must stay silent on the three slugs that ARE genuinely retired, or
    the proof above would be satisfied by a predicate that simply always fires."""
    assert retirements_contradicted_by_the_registry({"toor", "alnokhba", "deal"}) == []
