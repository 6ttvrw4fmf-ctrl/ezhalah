"""The BRACKETED positive control supersedes the lagging alive-rate proxy (ops_incident #183).

Why this exists, measured on gathern 2026-09-11 in ONE run whose two signals flatly contradicted:

    canary   10/10 known-alive controls -> HTTP 200   (the source is answering perfectly)
    worklist 1,469 of 1,500 -> 404, alive_rate 2.1%   (this stale cohort really is dead)
    verdict  TRUST-QUARANTINED "the source is not answering this run reliably"   <- wrong

The rate and the canary ask the SAME question (see liveness_trust's module header). The rate is a
proxy that cannot separate "the source is lying" from "this cohort is genuinely dead", and the
worklist is selected by --min-stale-days, i.e. built out of the rows most likely to be gone. It got
worse with scale — 8.3% at n=60, 6.0% at n=150, 2.1% at n=1500 — because the worklist is ordered
oldest-stale-first, so only a PARTIAL run could ever clear the floor.

These cases execute the real predicate. They pin, in both directions, that the supersession is
narrow: it requires a positive control, it never rescues a failed one, and it never loosens a
constant.
"""
from __future__ import annotations

from scrapers.common.liveness_trust import (
    MIN_ALIVE_RATE_FOR_TRUST,
    MIN_PROBES_FOR_TRUST,
    canary_environment_ok,
    environment_is_trustworthy,
)


# ── The defect this change exists to fix ────────────────────────────────────────────────────────

def test_the_real_2026_09_11_run_is_now_trusted():
    """1,469 dead of 1,500, with 10/10 bracketed controls alive. Genuinely dead cohort, live source."""
    assert environment_is_trustworthy(31, 1500, canary_ok=True) is True


def test_the_same_run_without_a_control_is_still_refused():
    """No canary => no direct evidence => the proxy still governs, and still says no. Unchanged."""
    assert environment_is_trustworthy(31, 1500) is False
    assert environment_is_trustworthy(31, 1500, canary_ok=None) is False


def test_scale_no_longer_condemns_an_honest_run():
    """8.3% at n=60, 6.0% at n=150, 2.1% at n=1500 — all real gathern samples, all now trusted."""
    for alive, seen in ((5, 60), (9, 150), (31, 1500)):
        assert environment_is_trustworthy(alive, seen, canary_ok=True) is True
        assert environment_is_trustworthy(alive, seen) is False   # what it did before


# ── The supersession is NARROW ──────────────────────────────────────────────────────────────────

def test_failed_control_is_never_rescued_by_a_healthy_rate():
    """A blocked environment can still produce a decent-looking rate on a lucky slice. Control wins."""
    assert environment_is_trustworthy(90, 100, canary_ok=False) is False
    assert environment_is_trustworthy(1000, 1000, canary_ok=False) is False


def test_failed_control_is_not_read_as_the_listings_being_alive():
    """False means 'this run learned nothing it may act on' — never a verdict about the rows."""
    assert environment_is_trustworthy(0, 500, canary_ok=False) is False


def test_degenerate_input_still_fails_closed_even_with_a_passing_control():
    """A control cannot manufacture evidence out of a run that probed nothing or counted wrongly."""
    assert environment_is_trustworthy(0, 0, canary_ok=True) is False
    assert environment_is_trustworthy(-1, 100, canary_ok=True) is False
    assert environment_is_trustworthy(5, -3, canary_ok=True) is False


# ── Nothing was loosened ────────────────────────────────────────────────────────────────────────

def test_constants_are_untouched():
    assert MIN_ALIVE_RATE_FOR_TRUST == 0.20
    assert MIN_PROBES_FOR_TRUST == 25


def test_default_path_is_byte_for_byte_the_old_behaviour():
    """Every caller that does not run canaries (dealapp) must be completely unaffected."""
    def old_gate(alive: int, probes: int) -> bool:
        if probes < MIN_PROBES_FOR_TRUST or probes <= 0:
            return False
        if alive < 0:
            return False
        return (alive / probes) >= MIN_ALIVE_RATE_FOR_TRUST

    for alive, probes in [
        (30, 100), (1, 100), (24, 25), (5, 25), (4, 25), (0, 30), (10, 10),
        (-1, 100), (0, 0), (20, 100), (19, 100), (250, 1000), (199, 1000),
    ]:
        assert environment_is_trustworthy(alive, probes) is old_gate(alive, probes), (alive, probes)


def test_min_probes_is_deliberately_not_applied_on_the_control_path():
    """A thin sample produces a noisy RATE. On the control path no rate is consulted, so the
    guard that exists to protect the rate has nothing to protect. The control still had to pass
    canary_environment_ok, which carries its OWN MIN_CANARIES floor."""
    assert environment_is_trustworthy(2, 10, canary_ok=True) is True
    assert environment_is_trustworthy(2, 10) is False


# ── The control's own floor is what makes canary_ok=True expensive to obtain ─────────────────────

def test_canary_floor_still_governs_what_may_become_canary_ok_true():
    assert canary_environment_ok(10, 10) is True
    assert canary_environment_ok(6, 10) is True            # 60% exactly
    assert canary_environment_ok(5, 10) is False           # below 60%
    assert canary_environment_ok(4, 4) is False            # too few controls -> fail CLOSED
    assert canary_environment_ok(0, 0) is False


def test_a_bracket_is_an_AND_not_an_OR():
    """gathern computes canary_ok = open AND close. Healthy start, blocked finish => untrusted."""
    for open_ok, close_ok in ((True, False), (False, True), (False, False)):
        assert environment_is_trustworthy(31, 1500, canary_ok=bool(open_ok and close_ok)) is False
    assert environment_is_trustworthy(31, 1500, canary_ok=bool(True and True)) is True
