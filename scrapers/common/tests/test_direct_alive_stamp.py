"""The three tier-1 sweeps must record the verdict they already reached.

aqar, gathern and wasalt each fetch a listing's own URL and reach an explicit "alive" branch. Until
2026-08-30 they wrote `last_seen_at` and `missing_count=0` there and nothing else — so
`last_verified_alive_at` stayed NULL across 173,501 active rows no matter how well those sweeps ran,
and ops_platform_liveness_coverage would have reported a fleet with no verification rather than
three working sweeps that never recorded their result.

These tests pin the two halves of the fix: the stamp exists in the contract, and each sweep's alive
branch actually asks for it. scripts/verify-liveness-registry-mirror.ts proves the same wiring from
the other side (and mutation-proves it); this file is the Python-side unit check.
"""
from __future__ import annotations

import re
from pathlib import Path

import pytest

from scrapers.common.liveness_contract import (
    ALIVE, DEAD, UNKNOWN, Decision, EvidenceKind, LivenessPolicy, decide,
    direct_alive_patch, presence_patch, verification_patch,
)

NOW = "2026-08-30T19:00:00+00:00"
SCRAPERS = Path(__file__).resolve().parents[2]


def test_direct_alive_patch_stamps_exactly_the_verification_column():
    assert direct_alive_patch(now_iso=NOW) == {"last_verified_alive_at": NOW}


def test_it_agrees_with_the_decision_derived_stamp():
    """Two doors to one rule; they must open onto the same room."""
    d = decide(ALIVE, strikes=2, policy=LivenessPolicy(platform="aqar"),
               evidence=EvidenceKind.DIRECT)
    assert verification_patch(d, now_iso=NOW) == direct_alive_patch(now_iso=NOW)


@pytest.mark.parametrize("verdict", [DEAD, UNKNOWN])
def test_nothing_but_alive_produces_a_stamp(verdict):
    d = decide(verdict, strikes=0, policy=LivenessPolicy(platform="aqar"),
               evidence=EvidenceKind.DIRECT)
    assert verification_patch(d, now_iso=NOW) == {}


def test_absence_produces_no_stamp_even_when_the_verdict_says_alive():
    """A listing present in a feed has not been verified — it has been noticed."""
    d = decide(ALIVE, strikes=0, policy=LivenessPolicy(platform="dealapp"),
               evidence=EvidenceKind.ABSENCE)
    assert verification_patch(d, now_iso=NOW) == {}


def test_crawler_presence_alone_still_stamps_nothing():
    assert presence_patch(LivenessPolicy(platform="abeea"), now_iso=NOW) == {}


@pytest.mark.parametrize("platform", ["aqar", "gathern", "wasalt"])
def test_each_tier1_sweep_stamps_on_its_alive_path(platform):
    src = (SCRAPERS / platform / "liveness.py").read_text()
    assert "direct_alive_patch" in src, (
        f"{platform}/liveness.py reaches an explicit alive branch but never records it. Every row "
        f"it proves alive is written back with no evidence that it was proven, and the coverage "
        f"dashboard reads 0% for {platform} forever.")
    # The stamp belongs to the ALIVE branch. It must never sit in the same update as active=False.
    for m in re.finditer(r"update\(\{[^}]*\}", src, re.S):
        payload = m.group(0)
        if "direct_alive_patch" in payload:
            assert '"active": False' not in payload, (
                f"{platform}: a deactivation payload carries a verification stamp")


def test_the_stamp_is_not_hand_written_anywhere_in_the_tier1_sweeps():
    """One rule, one place. A sweep that sets the column itself can stamp a row it never read."""
    for platform in ("aqar", "gathern", "wasalt", "dealapp"):
        for name in ("liveness.py", "liveness_run.py"):
            path = SCRAPERS / platform / name
            if not path.exists():
                continue
            code = re.sub(r"#[^\n]*", "", path.read_text())
            assert not re.search(r"""["']last_verified_alive_at["']\s*:""", code), (
                f"{platform}/{name} writes last_verified_alive_at directly — route it through "
                f"direct_alive_patch() or verification_patch()")


def test_a_decision_cannot_claim_verification_without_being_alive():
    """The dataclass default is the safe one: a hand-built Decision does not stamp by accident."""
    assert verification_patch(Decision(action="none", reason="x", strikes=0), now_iso=NOW) == {}
