"""Barrier for the platform-wide listing-liveness contract (owner rule, 2026-08-30).

Each test here corresponds to one protection the owner named. Every one is mutation-proven: the
matching mutation is listed in scripts/verify-liveness-contract.ts, which executes them against a
mutated copy of the module and fails if any mutation survives.

The failures these exist to prevent are all REAL and all measured on production 2026-08-30:
  · aqar reported soft-closed ads healthy for weeks because its private `looks_dead()` copy did not
    know the «مغلق» badge — 13,139 dead rows retired in a single day once it did.
  · 26 of 29 platforms had no per-URL revisit at all; liveness was inferred from crawl presence.
  · gathern probes 1,500 rows/day against 29,275 active — a 19.5-day cycle, ~1,260 confirmed-dead
    listings searchable at audit time.
  · dealapp returns an identical 200 SPA shell for a real id AND a bogus one, so a naive
    "200 ⇒ alive" rule would have manufactured positive verification out of nothing.
"""
from __future__ import annotations

import pytest

from scrapers.common.liveness_contract import (
    ALIVE, DEAD, UNKNOWN, Decision, EvidenceKind, LivenessPolicy, classify_response, decide,
    is_stale,
)

POLICY = LivenessPolicy(platform="testp", grace=3, max_verification_age_hours=72)


# ── 1. A failed request can never deactivate ────────────────────────────────────────────────────
def test_network_failure_is_unknown_never_dead():
    assert classify_response(None) == UNKNOWN
    d = decide(UNKNOWN, strikes=2, policy=POLICY)
    assert d.action == "none" and d.strikes == 2, "a failed read must leave the row untouched"


@pytest.mark.parametrize("status", [401, 402, 403, 407, 408, 429])
def test_blocked_or_throttled_is_unknown_never_dead(status):
    """403/429 say the SOURCE refused US. They say nothing about the listing."""
    assert classify_response(status) == UNKNOWN
    assert decide(classify_response(status), strikes=2, policy=POLICY).action == "none"


@pytest.mark.parametrize("status", [500, 502, 503, 504, 599])
def test_5xx_is_unknown_never_dead(status):
    """The source is broken, not the listing."""
    assert classify_response(status) == UNKNOWN
    assert decide(classify_response(status), strikes=2, policy=POLICY).action == "none"


def test_unresolved_redirect_and_odd_statuses_are_unknown():
    for status in (301, 302, 307, 418, 999):
        assert classify_response(status) == UNKNOWN, status


def test_unknown_never_accumulates_a_strike_even_at_the_grace_boundary():
    """The dangerous case: a row already at grace-1 must not be pushed over by a blocked read."""
    d = decide(UNKNOWN, strikes=POLICY.grace - 1, policy=POLICY)
    assert d.action == "none" and d.strikes == POLICY.grace - 1


# ── 2. Crawler/sitemap absence alone can never deactivate ───────────────────────────────────────
@pytest.mark.parametrize("verdict", [ALIVE, DEAD, UNKNOWN])
def test_absence_evidence_can_never_move_a_row(verdict):
    """Absence selects a candidate to re-probe. It is never itself a death — not even when the
    absence signal is the source's OWN sitemap (dealapp: 3,244 of 14,568 active rows absent)."""
    d = decide(verdict, strikes=2, policy=POLICY, evidence=EvidenceKind.ABSENCE)
    assert d.action == "none"
    assert d.strikes == 2
    assert "absence_is_candidate_only" in d.reason


def test_policy_cannot_opt_out_of_the_absence_rule():
    with pytest.raises(ValueError, match="absence"):
        LivenessPolicy(platform="rogue", absence_is_candidate_only=False)


# ── 3. A positive alive response stays / reactivates correctly ──────────────────────────────────
def test_alive_resets_strikes_and_reports_verification():
    d = decide(ALIVE, strikes=2, policy=POLICY)
    assert d.action == "reset" and d.strikes == 0
    assert d.verified_alive is True, "an ALIVE read is what stamps last_verified_alive_at"


def test_a_200_we_cannot_recognise_is_not_verification():
    """dealapp's shell: a real id and a bogus id both return 200. With an alive_marker that does
    not match, the answer must be UNKNOWN — never manufactured positive verification."""
    shell = "<html>ng-state but no listing schema</html>"
    v = classify_response(200, shell, alive_marker=lambda b: "real-estate-listing-schema" in b)
    assert v == UNKNOWN
    assert decide(v, strikes=0, policy=POLICY).verified_alive is False


def test_a_200_with_a_positive_marker_is_alive():
    good = '<html>real-estate-listing-schema-501525 …</html>'
    assert classify_response(200, good, alive_marker=lambda b: "real-estate-listing-schema" in b) == ALIVE


# ── 4. Confirmed death + required strikes becomes unsearchable ──────────────────────────────────
def test_hard_404_and_410_are_dead():
    assert classify_response(404) == DEAD
    assert classify_response(410) == DEAD


def test_platform_dead_marker_on_a_200_is_dead():
    """aqar's soft close: HTTP 200, no removal phrase, but the platform's own marker matches."""
    body = "<span class='badge'>مغلق</span>"
    assert classify_response(200, body, dead_marker=lambda b: "مغلق" in b) == DEAD


def test_death_requires_the_full_grace_before_deactivating():
    strikes = 0
    for expected in ("strike", "strike", "deactivate"):
        d = decide(DEAD, strikes=strikes, policy=POLICY)
        assert d.action == expected, f"strike {strikes} → {d.action}, wanted {expected}"
        strikes = d.strikes
    assert strikes == 3


def test_deactivation_always_carries_an_auditable_reason():
    d = decide(DEAD, strikes=2, policy=POLICY)
    assert d.action == "deactivate"
    assert d.reason and "source_confirmed_dead" in d.reason and "direct" in d.reason


def test_every_decision_has_a_non_empty_reason():
    for verdict in (ALIVE, DEAD, UNKNOWN):
        for ev in EvidenceKind:
            d = decide(verdict, strikes=1, policy=POLICY, evidence=ev)
            assert d.reason.strip(), f"{verdict}/{ev} produced an unattributed transition"


def test_grace_of_zero_is_rejected():
    """A single reading may never retire a listing, whatever a future policy row claims."""
    with pytest.raises(ValueError, match="grace"):
        LivenessPolicy(platform="rogue", grace=0)


# ── 5. Stale is a MONITORING state, never a deactivation ────────────────────────────────────────
def test_never_verified_counts_as_stale():
    assert is_stale(None, POLICY) is True


def test_stale_boundary_follows_the_platform_sla():
    assert is_stale(POLICY.max_verification_age_hours - 1, POLICY) is False
    assert is_stale(POLICY.max_verification_age_hours + 1, POLICY) is True


def test_staleness_alone_does_not_deactivate():
    """Being past the SLA makes a row ALERT-worthy, not dead. The only path to deactivate is
    decide(DEAD, direct, grace) — staleness is not an input to it at all."""
    assert is_stale(10_000, POLICY) is True
    assert decide(UNKNOWN, strikes=0, policy=POLICY).action == "none"
