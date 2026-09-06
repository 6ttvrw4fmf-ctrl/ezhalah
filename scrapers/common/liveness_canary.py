"""IN-RUN POSITIVE CONTROL — prove the environment before believing a single death verdict.

`docs/ops/LISTING_LIVENESS.md` §5.4 named this instrument and recorded that it did not exist:

    "An aggregate rate is a lagging signal. The sharper instrument for a source like this is an
     in-run positive control: probe a handful of known-alive canaries; if the canaries 404, the run
     is blocked, whatever the rest of the batch says. Not yet built — recorded here so it is not
     rediscovered from scratch."

This is that instrument. `liveness_trust.canary_environment_ok()` was already the pure predicate;
what was missing is the thing that actually ASSEMBLES a control set during a run and caches the
answer. Both live here so a platform gets the control by wiring one object, not by re-deriving the
policy.

WHY A CONTROL SET AND NOT JUST THE AGGREGATE RATE. `environment_is_trustworthy()` condemns a run
only after the whole batch is probed — on 2026-09-01 that meant 302 gathern rows were already
inactivated by the time the number existed. A canary asks the same question FIRST, against listings
the source has *already* proven alive this very run, and costs a handful of extra fetches.

WHY THE CANARIES COME FROM THE RUN ITSELF. The scraper has just enumerated and parsed the live
catalogue; every ad_number in that set is one the source served us minutes ago. That makes it a free,
always-fresh, non-stale control set — no fixture to maintain and no hardcoded id that quietly dies.

THE ASYMMETRY THAT MAKES THIS SAFE. A blocked or degraded environment can manufacture a 404 or an
empty shell; it cannot manufacture a *live listing page*. So canaries coming back ALIVE is positive
evidence the environment is honest, while canaries coming back dead is evidence about US. This is
the same reasoning `DELETION_SAFETY.md` §2.4 uses to leave restorative writes ungated.

FAIL-CLOSED, ALWAYS. Too few canaries, a probe that throws, or a rate under the floor all mean
`ok()` is False — and False must never be read as "the listings are dead". It means this run learned
nothing it may act on, so nothing is deactivated.
"""
from __future__ import annotations

from typing import Callable, Iterable, Optional

from scrapers.common.liveness_trust import (
    MIN_CANARIES,
    MIN_CANARY_ALIVE_RATE,
    canary_environment_ok,
)


class InRunCanary:
    """Lazily-evaluated, once-per-run positive control over a platform's own live oracle.

    Usage, from inside a scraper that has just parsed its catalogue:

        canary = InRunCanary(_probe_is_alive, label="raghdan")
        canary.offer(r["ad_number"] for r in rows_seen)      # known-live this run
        ...
        if verdict_looks_dead and not canary.ok():
            return "unknown", canary.reason()                # environment unproven -> never kill

    `probe_is_alive(ad_number)` must return True ONLY on an affirmative live answer. Anything it
    cannot confirm must be False — a probe that raises is caught here and counted as not-alive.
    """

    def __init__(
        self,
        probe_is_alive: Callable[[str], bool],
        *,
        label: str = "",
        sample: int = MIN_CANARIES,
        min_rate: float = MIN_CANARY_ALIVE_RATE,
    ) -> None:
        self._probe = probe_is_alive
        self._label = label
        self._sample = max(int(sample), MIN_CANARIES)
        self._min_rate = min_rate
        self._candidates: list[str] = []
        self._seen: set[str] = set()
        self._result: Optional[bool] = None
        self._reason: str = "canary control not yet evaluated"

    def offer(self, ad_numbers: Iterable[str]) -> None:
        """Add ad_numbers the source served us THIS RUN. Order is preserved and duplicates dropped."""
        if self._result is not None:      # already decided; a later offer must not change history
            return
        for a in ad_numbers:
            if a and a not in self._seen:
                self._seen.add(a)
                self._candidates.append(a)

    def reason(self) -> str:
        return self._reason

    def ok(self) -> bool:
        """True only if the control set came back alive. Evaluated once, then cached."""
        if self._result is not None:
            return self._result

        # Spread the sample across the catalogue rather than taking the first N: a contiguous head
        # is often one city/shard, which would make the control agree with itself.
        n = len(self._candidates)
        if n < self._sample:
            self._result = False
            self._reason = (f"canary control UNPROVEN ({self._label}): only {n} candidate(s), "
                            f"need {self._sample} — fail-closed, no deactivation")
            return False
        step = max(n // self._sample, 1)
        picked = self._candidates[::step][: self._sample]

        alive = 0
        for ad in picked:
            try:
                if self._probe(ad):
                    alive += 1
            except Exception:  # noqa: BLE001 — a probe that throws is NOT a live canary
                pass

        self._result = canary_environment_ok(alive, len(picked), self._sample, self._min_rate)
        self._reason = (f"canary control {'PASSED' if self._result else 'FAILED'} ({self._label}): "
                        f"{alive}/{len(picked)} known-live listings verified alive, "
                        f"floor {self._min_rate:.0%}")
        return self._result
