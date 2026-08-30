"""The Ezhalah listing-liveness contract — ONE decision function every platform inherits.

THE PERMANENT RULE (owner, 2026-08-30):

    `active = true` must mean we have reasonable RECENT EVIDENCE that the listing is live —
    not merely that nobody has yet proved it dead.

WHY THIS FILE EXISTS. Before it, every platform re-implemented the same three-way decision in its
own scraper, and each copy could drift on its own. That is not hypothetical: aqar spent weeks
reporting soft-closed ads as healthy because ITS copy of `looks_dead()` did not know about the
«مغلق» badge, while 26 of 29 platforms had no per-URL revisit at all and inferred liveness purely
from "did today's crawl see it". Both failures are invisible in aggregate — the counts look fine,
the crawl reports success, and the dead inventory is only found by hand, months later. A single
shared decision, pinned by mutation-proven barriers, is what makes that class of drift impossible.

THE THREE-VALUED LAW. A source response is ALIVE, DEAD, or UNKNOWN — never two-valued:

    ALIVE    affirmative positive evidence the listing is still offered.
    DEAD     affirmative evidence the source itself says it is gone.
    UNKNOWN  everything else. Reported, never acted on in either direction.

UNKNOWN IS NOT DEAD, AND THIS IS THE WHOLE POINT. A timeout, a 403, a 429, a 5xx, a proxy failure,
a redirect we did not resolve, a body we could not parse — every one of those is a statement about
OUR read, not about the listing. Treating them as death is how a blocked crawl silently deletes
live inventory. `classify_response()` therefore returns UNKNOWN for all of them, and `decide()`
refuses to strike or deactivate on UNKNOWN under any policy.

ABSENCE IS NOT DEATH EITHER. "The crawler did not see it" and "a sitemap no longer lists it" are
ABSENCE signals. They are legitimate *candidate* filters — cheap ways to choose which rows to
re-probe first — but they can never, alone, deactivate a row. A platform whose only death signal is
absence must obtain a second, affirmative, per-listing signal before anything is deactivated. That
is `EvidenceKind.ABSENCE` below, and `decide()` hard-refuses it.

WHAT "SEEN" MEANS, PRECISELY. `last_seen_at` means the crawler encountered the ad somewhere — a
browse page, a feed, a sitemap. `last_verified_alive_at` means we fetched THAT listing and the
source affirmatively told us it is live. They are not the same claim and must never be written from
the same event; conflating them is what let months-old inventory read as fresh.
"""
from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from typing import Callable, Optional

# ── Verdicts ─────────────────────────────────────────────────────────────────────────────────────
ALIVE = "alive"
DEAD = "dead"
UNKNOWN = "unknown"
VERDICTS = (ALIVE, DEAD, UNKNOWN)


class EvidenceKind(str, Enum):
    """How a verdict was obtained. Only DIRECT evidence may ever deactivate."""

    DIRECT = "direct"      # we fetched THIS listing's own URL/record and the source answered
    ABSENCE = "absence"    # it merely stopped appearing in a crawl/sitemap/feed — NEVER a death
    ADJUDICATED = "adjudicated"  # a human/owner-reviewed decision (e.g. a duplicate retirement)


# Statuses that describe OUR read failing, not the listing dying. Never DEAD.
_BLOCKED_OR_THROTTLED = frozenset({401, 402, 403, 407, 408, 429})


def classify_response(
    status: Optional[int],
    body: str = "",
    *,
    dead_marker: Optional[Callable[[str], bool]] = None,
    alive_marker: Optional[Callable[[str], bool]] = None,
) -> str:
    """Map one source response to ALIVE / DEAD / UNKNOWN. Pure; no I/O, no platform knowledge.

    `dead_marker`  — platform-specific "this body says it is gone" (aqar's «مغلق» badge + missing
                     offers node, aqarcity's «الإعلان منتهي» banner, …). Only consulted on a 200.
    `alive_marker` — platform-specific "this body positively shows a live listing". When supplied
                     and it does NOT match, the result is UNKNOWN, never ALIVE: a 200 that we
                     cannot recognise is an unreadable answer, not a healthy one. This is what
                     stops an SPA shell (dealapp serves the same 200 shell for a real id and a
                     bogus one) from being counted as positive verification.
    """
    if status is None:
        return UNKNOWN                       # network error / proxy failure / timeout
    if status in _BLOCKED_OR_THROTTLED:
        return UNKNOWN                       # blocked or rate-limited: says nothing about the ad
    if 500 <= status <= 599:
        return UNKNOWN                       # the source is broken, not the listing
    if status in (404, 410):
        return DEAD                          # the source itself says it is gone
    if status == 200:
        if dead_marker is not None and dead_marker(body):
            return DEAD
        if alive_marker is not None and not alive_marker(body):
            return UNKNOWN                   # cannot confirm ⇒ not verification
        return ALIVE
    return UNKNOWN                           # 3xx we did not resolve, and anything unexpected


@dataclass(frozen=True)
class LivenessPolicy:
    """A platform's registered liveness strategy. No production-searchable platform may omit one.

    grace                 consecutive DIRECT dead verdicts required before deactivating.
    max_verification_age_hours  the SLA: beyond this, an active row is STALE and must alert.
    absence_is_candidate_only   always True; present so the rule is explicit at every call site
                                rather than implied. A platform cannot opt out.
    """

    platform: str
    grace: int = 3
    max_verification_age_hours: int = 72
    absence_is_candidate_only: bool = True
    # Whether merely appearing in this platform's feed counts as PROOF OF LIFE. Defaults to False
    # and must stay False unless a platform's source is documented to publish only live ads — the
    # burden is on the claim, not on the doubt. When False (the norm), crawler presence updates
    # last_seen_at and nothing else; only a DIRECT ALIVE verdict stamps last_verified_alive_at.
    presence_is_positive_evidence: bool = False

    def __post_init__(self) -> None:
        if self.grace < 1:
            raise ValueError("grace must be >= 1: a single reading may never retire a listing")
        if not self.absence_is_candidate_only:
            raise ValueError(
                "absence_is_candidate_only cannot be disabled — absence from a crawl or sitemap is "
                "never, on its own, evidence of death (owner rule 2026-08-30)")


@dataclass(frozen=True)
class Decision:
    """What to do with one listing, and the auditable reason for it."""

    action: str      # 'deactivate' | 'strike' | 'reset' | 'none'
    reason: str      # machine-readable, stored on every active=true→false transition
    strikes: int     # the strike count to persist
    verified_alive: bool = False   # True ⇒ caller must stamp last_verified_alive_at


def decide(
    verdict: str,
    *,
    strikes: int,
    policy: LivenessPolicy,
    evidence: EvidenceKind = EvidenceKind.DIRECT,
) -> Decision:
    """The single choke point. Every `active=true → false` in Ezhalah must originate here.

    Guarantees, each pinned by a mutation-proven barrier:
      1. UNKNOWN never deactivates and never strikes — the row is left exactly as it was.
      2. ABSENCE evidence never deactivates and never strikes, whatever the verdict says.
      3. DEAD deactivates only on DIRECT evidence AND only once strikes reach the policy grace.
      4. ALIVE always resets strikes to 0 and reports verified_alive so the caller can stamp
         last_verified_alive_at.
      5. Every returned action carries a non-empty reason — there is no unattributed transition.
    """
    if verdict not in VERDICTS:
        raise ValueError(f"unknown verdict {verdict!r}; expected one of {VERDICTS}")

    # (2) Absence can select a candidate to re-probe. It can never itself move a row.
    if evidence is EvidenceKind.ABSENCE:
        return Decision(
            action="none",
            reason=f"absence_is_candidate_only:{verdict}",
            strikes=strikes,
        )

    # (1) Our read failed, or the source refused us. That is not information about the listing.
    if verdict == UNKNOWN:
        return Decision(action="none", reason="unknown_response_never_counts_as_death",
                        strikes=strikes)

    # (4) Positive verification: clear the strike history and record the proof of life.
    if verdict == ALIVE:
        return Decision(action="reset", reason="source_confirmed_alive", strikes=0,
                        verified_alive=True)

    # (3) Affirmative, direct death evidence — still subject to the grace window.
    new_strikes = strikes + 1
    if new_strikes >= policy.grace:
        return Decision(
            action="deactivate",
            reason=f"source_confirmed_dead:direct:strikes={new_strikes}/{policy.grace}",
            strikes=new_strikes,
        )
    return Decision(
        action="strike",
        reason=f"source_confirmed_dead:direct:strikes={new_strikes}/{policy.grace}",
        strikes=new_strikes,
    )


def is_stale(hours_since_verified: Optional[float], policy: LivenessPolicy) -> bool:
    """True when an active listing has gone past its platform's verification SLA.

    `None` (never positively verified) is STALE, deliberately: a row nobody has ever confirmed is
    exactly the inventory this contract exists to surface, not a row to give the benefit of the
    doubt. Being stale is a MONITORING state — it never deactivates anything."""
    if hours_since_verified is None:
        return True
    return hours_since_verified > policy.max_verification_age_hours


def verification_patch(decision: Decision, *, now_iso: str) -> dict:
    """The ONLY sanctioned way to write `last_verified_alive_at`.

    Callers must never set that column by hand. It is stamped exactly when the source affirmatively
    said ALIVE on DIRECT evidence — which is the single case where `Decision.verified_alive` is
    True. An UNKNOWN read (timeout, 403, 429, 5xx, unrecognised 200) and an ABSENCE signal both
    return an EMPTY patch, so a blocked crawl can never refresh a verification timestamp and make
    dead inventory look freshly checked. That failure would be worse than the one this column was
    added to fix: it would put a confident, recent-looking timestamp on a listing nobody verified.
    """
    return {"last_verified_alive_at": now_iso} if decision.verified_alive else {}


def presence_patch(policy: LivenessPolicy, *, now_iso: str) -> dict:
    """What a mere crawler sighting may write. Normally nothing.

    Appearing in a feed is not proof a listing is live — a source can keep serving closed ads in
    its browse pages (aqar does exactly this, which is how 13,139 dead rows stayed 'healthy'). So
    presence stamps `last_verified_alive_at` ONLY for a platform that has explicitly declared
    `presence_is_positive_evidence=True` in the registry, i.e. its source is documented to publish
    live ads only. Every other platform gets an empty patch and keeps `last_seen_at` as the sole
    record of the sighting.
    """
    return {"last_verified_alive_at": now_iso} if policy.presence_is_positive_evidence else {}
