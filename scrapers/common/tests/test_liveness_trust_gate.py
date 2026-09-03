"""Guards for the run-level TRUST gate — the rule that a sweep which cannot be trusted may not kill.

This exists because of a measured production incident, not a hypothetical. Gathern's oracle
alive-rate held 62-84% for nine days and then collapsed to 3.8 / 0.7 / 0.5% on 2026-09-01..03 when
the source began serving 404s to our egress. The per-batch anomaly cap caught the oversized 09-03
batch but was structurally blind to the 09-02 one (106 rows, under the cap), which landed: live
listings inactivated on 404s that meant "we were blocked", not "this unit is gone".

The gate must fail CLOSED. Every assertion below is written so that loosening the gate — dropping
the rate floor, dropping the probe floor, or treating a degenerate run as trustworthy — turns it
red.

    python -m pytest scrapers/common/tests/test_liveness_trust_gate.py -q
"""
from __future__ import annotations

import pytest

from scrapers.common.liveness_trust import (
    MIN_ALIVE_RATE_FOR_TRUST,
    MIN_CANARIES,
    MIN_CANARY_ALIVE_RATE,
    MIN_PROBES_FOR_TRUST,
    canary_environment_ok,
    environment_is_trustworthy,
)

# The real gathern_liveness_detail daily alive-rates either side of the incident.
HEALTHY_DAYS = {           # 2026-08-23 .. 08-31, alive / probed
    "08-23": (995, 1500), "08-24": (1107, 1500), "08-25": (1180, 1500),
    "08-26": (1076, 1500), "08-27": (1151, 1500), "08-28": (1084, 1500),
    "08-29": (1133, 1500), "08-30": (5468, 6500), "08-31": (933, 1500),
}
DEGRADED_DAYS = {          # 2026-09-01 .. 09-03 — the false-death window
    "09-01": (57, 1500), "09-02": (10, 1500), "09-03": (7, 1500),
}


@pytest.mark.parametrize("day", sorted(HEALTHY_DAYS))
def test_healthy_gathern_days_are_trusted(day):
    """A normal sweep must still be able to act — a gate that blocks everything is not a gate."""
    alive, probed = HEALTHY_DAYS[day]
    assert environment_is_trustworthy(alive, probed), f"{day} wrongly quarantined"


@pytest.mark.parametrize("day", sorted(DEGRADED_DAYS))
def test_degraded_gathern_days_are_quarantined(day):
    """The incident days MUST be refused. This is the assertion that would have saved the 106 rows
    inactivated on 2026-09-02 (and the 302 on 09-01)."""
    alive, probed = DEGRADED_DAYS[day]
    assert not environment_is_trustworthy(alive, probed), f"{day} wrongly trusted"


def test_the_0902_batch_that_slipped_under_the_anomaly_cap_is_now_refused():
    """Regression pin on the exact hole: 106 kills is far below the 585 cap, so the cap allowed it.
    Trust is evaluated on the RUN's evidence, not the batch's size, so it refuses regardless."""
    alive, probed = DEGRADED_DAYS["09-02"]
    assert not environment_is_trustworthy(alive, probed)


def test_fails_closed_on_too_few_probes():
    """A rate computed from a handful of probes is noise. Refuse rather than guess — even when
    every single probe came back alive."""
    assert not environment_is_trustworthy(MIN_PROBES_FOR_TRUST - 1, MIN_PROBES_FOR_TRUST - 1)
    assert not environment_is_trustworthy(1, 1)
    assert not environment_is_trustworthy(0, 0)          # empty run: nothing learned, nothing acted on
    assert not environment_is_trustworthy(24, 24)        # 100% alive but under the probe floor


def test_fails_closed_on_degenerate_counts():
    assert not environment_is_trustworthy(-1, 100)
    assert not environment_is_trustworthy(0, -5)


def test_boundary_is_inclusive_at_the_floor():
    """Exactly at the floor is trusted; a hair under is not. Pins the comparison operator."""
    n = 1000
    at_floor = int(MIN_ALIVE_RATE_FOR_TRUST * n)         # 200/1000 = 0.20
    assert environment_is_trustworthy(at_floor, n)
    assert not environment_is_trustworthy(at_floor - 1, n)


def test_probe_floor_boundary():
    """At exactly MIN_PROBES_FOR_TRUST a healthy rate is trusted; one probe fewer is not."""
    alive = MIN_PROBES_FOR_TRUST          # 100% alive
    assert environment_is_trustworthy(alive, MIN_PROBES_FOR_TRUST)
    assert not environment_is_trustworthy(alive - 1, MIN_PROBES_FOR_TRUST - 1)


def test_constants_match_the_dealapp_reference_shape():
    """The two platforms must not drift into different definitions of 'trustworthy'
    (docs/ops/LISTING_LIVENESS.md §5)."""
    from scrapers.dealapp.liveness import (
        MIN_ALIVE_RATE_FOR_TRUST as DEALAPP_RATE,
        MIN_PROBES_FOR_TRUST as DEALAPP_PROBES,
    )
    assert MIN_ALIVE_RATE_FOR_TRUST == DEALAPP_RATE
    assert MIN_PROBES_FOR_TRUST == DEALAPP_PROBES


# ── The in-run positive control (canary) ────────────────────────────────────────────────────────

def test_canary_all_controls_alive_passes():
    """The ordinary healthy case must proceed — a control that never passes is not a control."""
    assert canary_environment_ok(10, 10)
    assert canary_environment_ok(8, 10)


def test_canary_blocked_environment_is_refused():
    """The 2026-09-01 shape: controls the source itself proved alive now answer 404."""
    assert not canary_environment_ok(0, 10)
    assert not canary_environment_ok(1, 10)


def test_canary_tolerates_a_genuinely_dead_control_but_not_a_blockade():
    """A canary drawn from real inventory can legitimately die between runs. Demanding unanimity
    would let one honest death wedge the sweep shut forever; demanding a majority would not."""
    assert canary_environment_ok(9, 10)                     # one died naturally -> still run
    assert canary_environment_ok(6, 10)                     # exactly at the floor
    assert not canary_environment_ok(5, 10)                 # half is not a working environment


def test_canary_fails_closed_on_too_few_controls():
    """No control set = no proof. Refuse, even when every control that DID answer was alive."""
    assert not canary_environment_ok(MIN_CANARIES - 1, MIN_CANARIES - 1)
    assert not canary_environment_ok(0, 0)
    assert not canary_environment_ok(1, 1)


def test_canary_fails_closed_on_degenerate_counts():
    assert not canary_environment_ok(-1, 10)
    assert not canary_environment_ok(0, -3)


def test_canary_is_strictly_earlier_evidence_than_the_aggregate_gate():
    """Both guards must condemn the incident, but the canary does it on ~10 probes rather than
    1,500 — that difference is 302 rows on 2026-09-01."""
    blocked_canary, blocked_batch = (0, 10), (57, 1500)
    assert not canary_environment_ok(*blocked_canary)
    assert not environment_is_trustworthy(*blocked_batch)
    assert blocked_canary[1] < blocked_batch[1]


def test_gate_separates_the_incident_cleanly_with_margin():
    """The floor must sit clearly between the two regimes, not graze one of them. Worst healthy day
    is ~62%, worst degraded day ~0.5% — a 0.20 floor has margin on both sides."""
    worst_healthy = min(a / p for a, p in HEALTHY_DAYS.values())
    best_degraded = max(a / p for a, p in DEGRADED_DAYS.values())
    assert best_degraded < MIN_ALIVE_RATE_FOR_TRUST < worst_healthy
