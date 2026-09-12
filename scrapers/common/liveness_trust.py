"""RUN-LEVEL TRUST — may this sweep's DEAD verdicts be acted on at all?

`docs/ops/LISTING_LIVENESS.md` §5 states the rule ("a run that cannot be trusted may not kill") but
until 2026-09-03 only `scrapers/dealapp/liveness.py` implemented it. Gathern paid for that gap:

    oracle alive-rate, gathern_liveness_detail
      2026-08-23..08-31   66 74 79 72 77 72 76 84 62  %   (nine healthy days)
      2026-09-01           3.8 %
      2026-09-02           0.7 %   -> 106 rows inactivated on degraded 404s
      2026-09-03           0.5 %   -> 1,016-row kill batch (anomaly cap held it)

Real inventory does not fall from 75% alive to 0.5% overnight across a whole cohort. The source
began serving 404s to our egress; every 404 in those runs is UNKNOWN, not death. The per-row
anomaly/kill cap caught the *big* batch on 09-03, but it is a batch-SIZE guard: on 09-02 the batch
(106) sat under the cap and landed, and strikes were written on every degraded day regardless.
A size cap cannot see that the whole run's evidence is untrustworthy. This predicate can.

It is deliberately the same shape and the same constants as dealapp's, so the two platforms cannot
drift into different definitions of "trustworthy".
"""
from __future__ import annotations

# A run must positively verify at least this share of its probes before any strike or deactivation
# is trusted. Healthy gathern runs sit at 62-84% and healthy dealapp proxy runs at ~24%; a blocked
# or shelled environment sits near 0.
MIN_ALIVE_RATE_FOR_TRUST = 0.20
# Below this many probes a rate is noise, so we refuse rather than guess. Fail CLOSED.
MIN_PROBES_FOR_TRUST = 25


# ── In-run positive control (canary) ────────────────────────────────────────────────────────────
# The aggregate rate above is a LAGGING signal: it only condemns a run after the whole batch has
# been probed, and on 2026-09-01 that meant a third of the damage was already decided by the time
# the number existed. A canary asks the same question FIRST and on purpose: probe a handful of
# listings the source itself has already proven alive, before touching the real worklist. If those
# come back 404, the environment is lying and nothing else this run says can be believed.
#
# Sized as a MAJORITY rather than unanimity on purpose. A canary drawn from real inventory can
# genuinely be delisted between runs; demanding 5/5 would let one honest death wedge the sweep shut
# forever. 60% separates "one canary died" from "the source is refusing us".
MIN_CANARIES = 5
MIN_CANARY_ALIVE_RATE = 0.60


def canary_environment_ok(
    alive_count: int,
    probe_count: int,
    min_canaries: int = MIN_CANARIES,
    min_rate: float = MIN_CANARY_ALIVE_RATE,
) -> bool:
    """Did the known-alive controls actually come back alive?

    FAIL-CLOSED on too few canaries: a run that cannot assemble a control set has not proven its
    environment, and an unproven environment may not kill. False here must never be read as "the
    listings are dead" — it means this run learned nothing it may act on.
    """
    if probe_count < min_canaries or probe_count <= 0:
        return False
    if alive_count < 0:
        return False
    return (alive_count / probe_count) >= min_rate


def environment_is_trustworthy(
    alive_count: int,
    probe_count: int,
    min_rate: float = MIN_ALIVE_RATE_FOR_TRUST,
    min_probes: int = MIN_PROBES_FOR_TRUST,
    canary_ok: bool | None = None,
) -> bool:
    """May this run write strikes / deactivations?

    FAIL-CLOSED in every degenerate case: too few probes, no probes, or a nonsensical count all
    return False. A False result must never be read as "the listings are alive" — it means this
    run learned nothing it may act on, so the rows stay exactly as they were.

    Note what is NOT gated by this: writes in the *restorative* direction. A 200 cannot be
    manufactured by a block (a blocked environment produces 404s and shells, not live pages), and
    `docs/ops/DELETION_SAFETY.md` §2.4 keeps reactivations during an inconclusive freeze for
    exactly that reason — restoring a live listing is the fail-safe direction.

    ── canary_ok: the LEADING control supersedes the LAGGING proxy (2026-09-11, ops_incident #183)

    Read this module's header: the aggregate alive-rate and the canary ask THE SAME QUESTION —
    "is this environment answering truthfully?" — one after the fact, one before. The rate was
    only ever a proxy, adopted because no positive control existed yet. It has one structural
    flaw as a proxy: it cannot separate "the source is lying to us" from "this cohort really is
    mostly dead", because both look like a low alive-rate. The worklist is selected by
    `--min-stale-days`, i.e. deliberately composed of the rows most likely to be gone, so a low
    rate is the EXPECTED result of a correct run against a healthy source.

    Measured on gathern 2026-09-11, after PR #2271 made the canary pool trustworthy — one run,
    both signals, flatly contradicting each other:

        canary   10/10 known-alive controls -> HTTP 200   (the source is answering perfectly)
        worklist 1,469 of 1,500 -> 404, alive_rate 2.1%   (this stale cohort really is dead)
        verdict  TRUST-QUARANTINED "the source is not answering this run reliably"  <- wrong

    And it worsens with scale, because the worklist is ordered oldest-stale-first: 8.3% at n=60,
    6.0% at n=150, 2.1% at n=1500. The more complete and more honest the run, the more certainly
    it condemned itself. Only a partial run could ever clear the floor.

    So when a purpose-built positive control has PROVEN the environment across the run's window,
    that direct evidence stands and the proxy is not consulted. This is not a lowered threshold:
    MIN_ALIVE_RATE_FOR_TRUST and MIN_PROBES_FOR_TRUST are untouched, and every fail-closed branch
    below still applies.

    THE CALLER MUST EARN `canary_ok=True` BY BRACKETING THE RUN — controls probed BEFORE the
    worklist *and again after it*, both passing `canary_environment_ok`. A single opening canary
    only proves the environment at run start, which would reopen exactly the mid-run degradation
    the rate gate was built to catch (2026-09-01: healthy early, blocked by the end). Bracketing
    closes that window with direct evidence instead of inference.

        None  (default) -> the proxy decides, exactly as before. Unchanged for every caller that
                           does not run canaries, which is why dealapp is byte-for-byte unaffected.
        False           -> untrusted, full stop. The control failed; nothing here can rescue it.
        True            -> the environment is proven for this window; the proxy is not consulted.
    """
    if probe_count <= 0:
        return False
    if alive_count < 0:
        return False
    if canary_ok is False:
        return False
    if canary_ok is True:
        # Proven by direct positive control at both ends of the run. The degenerate guards above
        # still ran; min_probes deliberately does not, because its whole job was to stop a thin
        # sample producing a noisy RATE, and no rate is being consulted on this path.
        return True
    if probe_count < min_probes:
        return False
    return (alive_count / probe_count) >= min_rate
