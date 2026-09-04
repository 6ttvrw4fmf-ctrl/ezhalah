"""THE LIVENESS REGISTRY — every production-searchable platform declares its strategy here.

A platform may not become production-searchable without an entry. `scripts/verify-liveness-
contract.ts` fails CI when a non-retired scraper directory has no policy, so a new platform cannot
be onboarded with its liveness question left unanswered — which is exactly how 26 of 29 platforms
ended up inferring liveness purely from crawl presence, with nobody having decided that.

STRATEGY tiers, strongest first:

  DIRECT_REVISIT              We periodically re-fetch each listing's own URL and read an
                              affirmative live/dead answer. The only tier that can satisfy the
                              owner rule on its own.
  CANDIDATE_PLUS_DIRECT       An absence signal (the source's own sitemap/feed) selects candidates
                              cheaply; each candidate then gets a DIRECT re-fetch before anything
                              is deactivated. Absence alone never deactivates — see
                              liveness_contract.EvidenceKind.ABSENCE.
  CRAWL_PRESENCE_ONLY         We only know the ad was in the crawl. This tier CANNOT satisfy the
                              owner rule and is recorded as a known gap, not as an approved design.
                              Rows on these platforms are reported as unverified by the staleness
                              monitor rather than being quietly counted as healthy.

`max_verification_age_hours` is the SLA: an active row not positively verified within it is STALE
and must surface on monitoring. It is a MONITORING threshold — nothing here ever deactivates a row.
Deactivation happens only through `liveness_contract.decide()`.
"""
from __future__ import annotations

from scrapers.common.liveness_contract import LivenessPolicy

DIRECT_REVISIT = "DIRECT_REVISIT"
CANDIDATE_PLUS_DIRECT = "CANDIDATE_PLUS_DIRECT"
CRAWL_PRESENCE_ONLY = "CRAWL_PRESENCE_ONLY"

# REGISTERED IS NOT THE SAME AS SEARCHABLE (2026-09-03). abralosol, aouj, arkaan, rawasidark and
# therc have 4,314 production_ready rows live in search_listings_ar and rows in
# ops_liveness_registry (migration 20260903042707), so MONITORING must know their strategy — a live
# row nothing grades is exactly the blind spot this registry exists to remove. They are deliberately
# NOT in the client's RES_TABLES/COM_TABLES and no search can return them yet: district
# canonicalization, af_platform_mapping and a SOURCE_TOKENS entry are still missing per platform.
# Their unreachability is declared and counted by scripts/verify-every-live-table-is-searchable.ts.
#
# Platforms that exist in scrapers/ but are NOT production-searchable, so they need no policy.
#
# "PAUSED" IS NOT "NOT SEARCHABLE" (2026-09-04). muktamel sat in this set from 2026-07-15 because it
# was "paused": moved off the shared cron matrix onto its own gated weekly workflow. That is a
# CADENCE fact, not a searchability fact — its rows stayed in the client's RES_TABLES/COM_TABLES the
# whole time, and on 2026-09-03 a gated run put 523 production_ready rows into search_listings_ar.
# The exemption then silenced the one rule that mattered: 523 user-visible listings with no liveness
# strategy, 0 ever verified alive, and 4 already accruing strikes under no grace contract. CI stayed
# green because this check compares against the scrapers/ DIRECTORY LISTING, never against
# production. An entry here is a CLAIM ABOUT PRODUCTION, and this file cannot verify it.
#
# So the claim is now checked where production truth lives: mon_detect_platform_monitoring_scope_gap()
# derives the searchable platform set from search_listings_ar every sweep and raises P1 on any
# platform missing from ops_liveness_registry — no list to maintain, future platforms covered by
# construction. Adding a slug here no longer hides anything.
#
# Kept in sync with scrapers/RETIRED_PLATFORMS.txt. Membership requires ZERO production_ready rows.
NOT_PRODUCTION_SEARCHABLE = frozenset({"toor", "alnokhba", "awal", "deal", "common"})


class _P(dict):
    """One registry row: the policy plus the human-readable strategy and death signals."""

    def __init__(self, policy: LivenessPolicy, strategy: str, death_signals: str, note: str = ""):
        super().__init__(policy=policy, strategy=strategy, death_signals=death_signals, note=note)


def _pol(platform: str, grace: int, sla_h: int) -> LivenessPolicy:
    return LivenessPolicy(platform=platform, grace=grace, max_verification_age_hours=sla_h)


POLICIES: dict[str, _P] = {
    # ── Tier 1: direct per-URL revisit ──────────────────────────────────────────────────────────
    "aqar": _P(
        _pol("aqar", 3, 48), DIRECT_REVISIT,
        "404/410; DEAD_MARKERS phrases; two-factor soft close («مغلق» badge AND no offers node)",
        "Daily sharded sweep (16 shards, ~97k probes/day) covers the active population each day.",
    ),
    "gathern": _P(
        _pol("gathern", 3, 96), DIRECT_REVISIT,
        "hard 404 only — a booked-but-listed 200 is NOT death on this platform",
        "Source rate-limits detail pages globally (~2 req/s). Coverage rate is the binding "
        "constraint, not signal quality: at 1,500 probes/day against 29k active the cycle was "
        "19.5 days and ~1,260 dead rows stayed searchable (measured 2026-08-30).",
    ),
    "wasalt": _P(
        _pol("wasalt", 3, 96), DIRECT_REVISIT,
        "404 (shares aqar's marker set)",
        "Requires the Saudi residential proxy (WASALT_PROXY_URL); datacenter IPs get HTTP 403, "
        "which is UNKNOWN and must never be read as death.",
    ),
    # ── Tier 2: source-published candidate set, then a direct confirm ───────────────────────────
    "dealapp": _P(
        _pol("dealapp", 3, 96), CANDIDATE_PLUS_DIRECT,
        "sitemap absence selects candidates; deactivation needs a DIRECT confirm "
        "(redirected_away, or a hydrated ng-state with no listing schema, or offers.availability "
        "SoldOut/OutOfStock)",
        "The bare listing URL cannot discriminate: a real id and a bogus id both return an "
        "identical ~131KB SPA shell, so a naive 200⇒alive rule manufactures verification out of "
        "nothing — hence the alive_marker requirement. The source publishes its live set across "
        "sitemap-5..16 (~56.5k ids, refreshed daily). "
        "EGRESS-LIMITED: the first production run (2026-08-30, dry, 300 probes) read alive=37 "
        "(12.3%), unknown=263, dead=0 and QUARANTINED itself — dealapp serves the schema-less "
        "shell to GitHub Actions egress for ~88% of ids, matching the 78-83% measured 2026-08-26. "
        "The contract behaved exactly as designed (0 false deaths where a naive 200⇒alive rule "
        "would have manufactured 263), but from CI this platform cannot reach useful coverage. "
        "The Saudi residential proxy was then measured under a bounded run (2026-08-30, dry, 300 "
        "probes, same cohort): alive rose 37 -> 71 (12.3% -> 23.7%, clearing the 20% trust floor) "
        "but dead stayed 0. Across 600 probes on both egress paths dealapp has produced ZERO death "
        "verdicts, so the proxy buys coverage, not discrimination. NOT attached to the schedule; "
        "see docs/ops/LISTING_LIVENESS.md §5.1-5.2.",
    ),
    # ── Tier 3: known gaps — recorded honestly so monitoring can see them ───────────────────────
    **{
        p: _P(_pol(p, 3, 168), CRAWL_PRESENCE_ONLY,
              "none (absence from the crawl only)",
              "KNOWN GAP: no per-listing revisit exists. Small catalogue; the full feed is re-read "
              "each run, so absence is a strong (but still non-authoritative) hint. Rows here are "
              "reported as unverified, never as verified-alive.")
        for p in (
            "abeea", "abralosol", "aldarim", "alhoshan", "alkhaas", "aouj", "aqaratikom",
            "aqarcity", "aqargate", "aqarmonthly", "arkaan", "eaqartabuk", "eastabha", "erapulse",
            "fursaghyr", "hajer", "jazwtn", "jurash", "mizlaj", "muktamel", "mustqr", "nowaisiry",
            "october", "raghdan", "ramzalqasim", "rawasidark", "sadin", "sanadak", "satel",
            "souq24", "therc",
        )
    },
}


def policy_for(platform: str) -> LivenessPolicy:
    """The registered policy, or a hard error. There is no silent default — an unregistered
    platform must fail loudly rather than inherit someone else's grace window."""
    row = POLICIES.get(platform)
    if row is None:
        raise KeyError(
            f"platform {platform!r} has no liveness policy. Register it in "
            f"scrapers/common/liveness_policies.py before making it production-searchable "
            f"(owner rule 2026-08-30).")
    return row["policy"]


def strategy_for(platform: str) -> str:
    return POLICIES[platform]["strategy"]
