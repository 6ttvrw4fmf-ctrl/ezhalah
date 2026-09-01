"""Dealapp liveness — CANDIDATE_PLUS_DIRECT, built on the contract in scrapers/common/liveness_contract.

THE PROBLEM THIS SOLVES. Dealapp had NO liveness mechanism of any kind: 15,899 active listings, 65%
of them unseen by any crawl in 48h, and no way to tell a live ad from a dead one. Its bare listing
URL cannot discriminate — measured 2026-08-30, a REAL id and a BOGUS id both return HTTP 200 with
an identical ~131KB Angular shell, `ng-state` hydrated and no listing schema in either. So any
`200 ⇒ alive` rule would manufacture verification out of nothing.

THE TWO SIGNALS THAT DO WORK.

  CANDIDATES come from dealapp's OWN sitemap. sitemap.xml indexes 16 files; 5-16 enumerate
  individual /ad-details/{id} URLs — 56,514 distinct live ids, refreshed daily. Of our 14,568
  active residential rows, 11,324 appear in it and 3,244 do not. That is a strong prioritisation
  signal and NOTHING MORE: it is absence, and absence never deactivates (EvidenceKind.ABSENCE is
  hard-refused by decide()). It only decides which rows to re-probe first.

  VERDICTS come from a direct per-listing fetch, mapped conservatively below.

WHY A SCHEMA-LESS 200 IS `UNKNOWN` AND NOT `DEAD`.

scrapers/dealapp/run.py's diagnostic taxonomy calls `same_url_ng_state_no_schema` "the cleanest
'genuinely gone' signal". As a DIAGNOSTIC that is fair. As a DEACTIVATION rule it is unsafe, and
the measurement above is why: a container that dealapp serves shells to sees that exact shape for
listings that are perfectly alive. Wiring it to DEAD would mass-kill live inventory the moment the
runner's egress changed — the precise failure this whole architecture exists to prevent. So:

    404 / 410                      → DEAD   (the source says gone)
    redirected away from /ad-details → DEAD (dealapp itself moved us off the ad path)
    200 with this ad's listing schema → ALIVE
    200 without it (shell, or hydrated-but-empty) → UNKNOWN
    timeout / 403 / 429 / 5xx / anything else     → UNKNOWN

Rows that stay UNKNOWN are never deactivated and never verified: they age past the SLA and surface
on the staleness monitor as unverified inventory, which is an honest state and a visible one.

THE ENVIRONMENT GUARD. If a run's schema-present rate collapses, we are being shelled rather than
told the truth, and every DEAD verdict in that run is suspect too. `environment_is_trustworthy()`
requires a floor of positively-verified rows before ANY deactivation is written; below it the run
records strikes-free and reports, changing nothing. Same posture as cleanup.py's inconclusive
freeze: refuse to act on evidence the run itself shows is unreliable.
"""
from __future__ import annotations

import re
from typing import Optional

from scrapers.common.liveness_contract import ALIVE, DEAD, UNKNOWN

AD_PATH = "/ad-details/"

# A run must positively verify at least this share of its probes before any deactivation is
# trusted. Healthy runs sit far above it; a shelled environment sits at ~0.
MIN_ALIVE_RATE_FOR_TRUST = 0.20
MIN_PROBES_FOR_TRUST = 25


def listing_schema_present(body: str, adid: str) -> bool:
    """True iff THIS ad's server-rendered listing schema is in the page.

    Scoped to the id on purpose. A generic 'is there any schema block' test would pass on a
    recommendations rail or a template fragment that mentions some other listing, which is how a
    shell page could be mistaken for a verified one."""
    if not body or not adid:
        return False
    return bool(re.search(rf"real-estate-listing-schema-{re.escape(str(adid))}\b", body))


def sold_or_rented(body: str) -> bool:
    """The source's own 'this ad is no longer on offer' markers.

    Only consulted when the listing schema IS present — i.e. dealapp really rendered this ad and
    told us its availability. Never inferred from a shell."""
    if not body:
        return False
    if re.search(r'"availability"\s*:\s*"[^"]*(SoldOut|OutOfStock)', body):
        return True
    return bool(re.search(r"\b(مباع|مؤجر)\b", body))


def classify_dealapp(
    status: Optional[int],
    *,
    body: str = "",
    adid: str = "",
    final_url: str = "",
    requested_url: str = "",
) -> str:
    """One dealapp response → ALIVE / DEAD / UNKNOWN. Pure: no I/O, unit-testable offline."""
    if status in (404, 410):
        return DEAD

    if status == 200:
        # dealapp moved us off the ad path entirely — its own statement that the id is gone.
        if final_url and requested_url:
            wanted = requested_url.split("//", 1)[-1].split("/", 1)[-1]
            if wanted and wanted not in final_url:
                return DEAD
        if listing_schema_present(body, adid):
            # The ad really rendered. Now its own availability field decides.
            return DEAD if sold_or_rented(body) else ALIVE
        # Hydrated but schema-less, or a bare shell: we cannot read this page. NOT a death.
        return UNKNOWN

    # None (network/proxy failure), 401/403/429, 5xx, unresolved 3xx, anything unexpected.
    return UNKNOWN


def environment_is_trustworthy(alive_count: int, probe_count: int) -> bool:
    """May this run's DEAD verdicts be acted on at all?

    A run whose probes almost never surface a listing schema is being served shells, and its 404s
    and redirects cannot be distinguished from the same degradation. Below the floor we refuse to
    deactivate anything — the run still reports, and the rows stay untouched and unverified."""
    if probe_count < MIN_PROBES_FOR_TRUST:
        return False
    return (alive_count / probe_count) >= MIN_ALIVE_RATE_FOR_TRUST


def sitemap_candidate_rank(adid: str, sitemap_ids: frozenset[str]) -> int:
    """Probe order only. 0 = absent from dealapp's sitemap (probe first), 1 = present.

    This is the ONLY use of the sitemap. It selects what to look at; it never contributes to a
    verdict, because absence is not evidence of death."""
    return 0 if str(adid) not in sitemap_ids else 1
