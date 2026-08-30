"""MUTATION PROOF for the liveness contract — it runs where pytest is guaranteed to exist.

WHY IT LIVES HERE AND NOT IN THE TS BARRIER. The proof needs to run pytest against a deliberately
broken copy of the contract. `npm test` (full-verification-ci.yml) has no Python toolchain, so a
TS-hosted proof there could only fail closed (correct, but permanently red) or skip (vacuous, which
is worse than nothing). `common-location-tests.yml` already installs pytest + the scraper
requirements and runs this directory, so the proof runs with its dependencies guaranteed.

scripts/verify-liveness-contract.ts keeps the pure-JS half (registry completeness + the static
source assertions) AND asserts that this file still exists and still names every protection — so
the proof cannot be quietly deleted to make anything green.

Each mutation below breaks ONE protection the owner named. If the contract suite still passes with
that protection removed, the protection is decoration and this test fails.
"""
from __future__ import annotations

import shutil
import subprocess
import sys
from pathlib import Path

import pytest

CONTRACT = Path(__file__).resolve().parents[1] / "liveness_contract.py"
SUITE = "scrapers/common/tests/test_liveness_contract.py"
REPO = Path(__file__).resolve().parents[3]

# (name, find, replace) — `name` is matched by the TS barrier, keep them in sync.
MUTATIONS: list[tuple[str, str, str]] = [
    ("failed_request_can_deactivate",
     "    if status is None:\n        return UNKNOWN",
     "    if status is None:\n        return DEAD"),
    ("blocked_or_throttled_counts_as_death",
     "    if status in _BLOCKED_OR_THROTTLED:\n        return UNKNOWN",
     "    if status in _BLOCKED_OR_THROTTLED:\n        return DEAD"),
    ("5xx_counts_as_death",
     "    if 500 <= status <= 599:\n        return UNKNOWN",
     "    if 500 <= status <= 599:\n        return DEAD"),
    ("absence_alone_can_deactivate",
     "    if evidence is EvidenceKind.ABSENCE:",
     "    if False:"),
    ("unknown_accumulates_a_strike",
     '    if verdict == UNKNOWN:\n        return Decision(action="none", reason="unknown_response_never_counts_as_death",\n                        strikes=strikes)',
     '    if verdict == UNKNOWN:\n        return Decision(action="strike", reason="x", strikes=strikes + 1)'),
    ("unrecognised_200_is_positive_verification",
     "        if alive_marker is not None and not alive_marker(body):\n            return UNKNOWN",
     "        if False:\n            return UNKNOWN"),
    ("grace_window_bypassed",
     "    if new_strikes >= policy.grace:",
     "    if True:"),
    ("alive_stops_resetting_strikes",
     '        return Decision(action="reset", reason="source_confirmed_alive", strikes=0,\n                        verified_alive=True)',
     '        return Decision(action="none", reason="source_confirmed_alive", strikes=strikes)'),
    ("policy_may_opt_out_of_absence_rule",
     "        if not self.absence_is_candidate_only:",
     "        if False:"),
    ("never_verified_stops_counting_as_stale",
     "    if hours_since_verified is None:\n        return True",
     "    if hours_since_verified is None:\n        return False"),
]


def _suite_passes() -> bool:
    """Run the contract suite in a subprocess against whatever is currently on disk."""
    proc = subprocess.run(
        [sys.executable, "-m", "pytest", SUITE, "-q", "-p", "no:cacheprovider"],
        cwd=REPO, capture_output=True, text=True,
    )
    return proc.returncode == 0


@pytest.fixture()
def restore_contract(tmp_path):
    """Always put the real contract back, even if the test body raises."""
    backup = tmp_path / "liveness_contract.py.bak"
    shutil.copyfile(CONTRACT, backup)
    try:
        yield
    finally:
        shutil.copyfile(backup, CONTRACT)


def test_the_contract_suite_passes_as_shipped():
    assert _suite_passes(), "the contract suite must be green before mutations mean anything"


@pytest.mark.parametrize("name,find,replace", MUTATIONS, ids=[m[0] for m in MUTATIONS])
def test_each_protection_is_mutation_proven(name, find, replace, restore_contract):
    original = CONTRACT.read_text(encoding="utf-8")
    assert find in original, (
        f"mutation target for {name!r} is no longer in liveness_contract.py — this proof has "
        f"drifted from the module it guards; update both together.")

    CONTRACT.write_text(original.replace(find, replace), encoding="utf-8")
    survived = _suite_passes()
    CONTRACT.write_text(original, encoding="utf-8")   # restore before asserting

    assert not survived, (
        f"MUTATION SURVIVED: breaking {name!r} did not fail a single test. That protection is "
        f"decoration — add a test that fails when it is removed.")


def test_contract_is_byte_identical_after_all_mutations():
    src = CONTRACT.read_text(encoding="utf-8")
    assert "return UNKNOWN" in src and "EvidenceKind.ABSENCE" in src, (
        "the contract was not restored correctly after mutation testing")
