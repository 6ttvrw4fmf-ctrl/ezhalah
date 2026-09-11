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

# REGISTERED IS NOT THE SAME AS SEARCHABLE (2026-09-03, corrected 2026-09-04). abralosol, aouj,
# arkaan, rawasidark and therc have 4,314 production_ready rows live in search_listings_ar and rows in
# ops_liveness_registry (migration 20260903042707), so MONITORING must know their strategy — a live
# row nothing grades is exactly the blind spot this registry exists to remove.
#
# They ARE searchable now: PR #1548 added all ten tables to the client lists, and the searchable
# inventory is no longer a hand-kept list at all — src/data/remote.ts's SEARCHABLE_TABLES is generated
# from production's own union arms (scripts/gen-searchable-tables.ts). The join between "live in the
# database" and "reachable by a real search" is asserted, in both directions, by
# scripts/verify-searchable-scope-matches-inventory.ts, which superseded
# verify-every-live-table-is-searchable.ts and its acknowledged-debt list.
#
# Platforms that exist in scrapers/ but are NOT production-searchable, so they need no policy.
# Kept in sync with scrapers/RETIRED_PLATFORMS.txt + the paused/gated ones.
# muktamel LEFT this set on 2026-09-04 (migration
# 20260904151723_muktamel_liveness_policy_paused_is_not_unsearchable): "paused" was a CADENCE fact —
# its two tables never left the client scope, and a gated run put 523 production_ready rows into
# search_listings_ar with 0 ever verified alive and no grace contract. Production re-seeded the
# registry with it at CRAWL_PRESENCE_ONLY/3/168; this mirror follows production, it does not vote.
# awal LEFT this set on 2026-09-04 (migration 20260905023206_awal_un_retired_source_serves_real_listings_again):
# awaalun.com no longer serves the 2026-07-28 parking-page stub — x-wp-total 128, 128 distinct
# ad_numbers parsed by the unchanged shipped scraper. Registered at CRAWL_PRESENCE_ONLY/168/3 below.
# alta and shmoualshmal JOIN this set on 2026-09-05 (owner-instructed, from the 40-candidate audit).
# CRAWL_PRESENCE_ONLY is the honest tier for both: each is a small WordPress REST catalogue re-read
# in full every run, with no per-listing revisit endpoint, so absence is a strong hint and never
# proof. alta additionally publishes an explicit property_status (تم البيع / تم التأجير / غير متاح)
# which its scraper reads directly — that is SOURCE-STATED removal, a stronger signal than crawl
# absence, and it deactivates through the scraper, never through this monitoring tier.
# remal and amaall JOIN this set on 2026-09-06 (owner-instructed, continuing the 40-candidate
# audit). CRAWL_PRESENCE_ONLY is the honest tier for both: small WordPress catalogues re-read in
# full each run with no per-listing revisit endpoint. amaall additionally publishes an explicit
# property_status (تم البيع / تم التأجير / تم التأجير بالكامل) which its scraper reads directly —
# that is SOURCE-STATED removal and deactivates through the scraper, never through this tier.
# abwbna JOINS this set on 2026-09-06 (owner-instructed, continuing the 40-candidate audit).
# CRAWL_PRESENCE_ONLY is the honest tier here too, for a different reason than the WordPress
# sources above: abwbna is a full-refresh crawl of the SAME Nuzul SaaS platform aldarim already
# runs (a different tenant, same public JSON API) — every run reads the COMPLETE current inventory
# and prunes anything not seen, exactly aldarim's own registered tier. See scrapers/abwbna/run.py.
# bahadhabab and alobid JOIN this set on 2026-09-06 alongside abwbna — the third and fourth Nuzul
# SaaS tenants found the same way (a full-refresh crawl of the SAME platform aldarim already runs,
# a different tenant, same public JSON API). Same tier as aldarim/abwbna for the same reason.
NOT_PRODUCTION_SEARCHABLE = frozenset({"toor", "alnokhba", "deal", "common"})


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
    # aqargate is spelled out rather than left in the comprehension below, because the
    # comprehension's shared death_signals string ("none (absence from the crawl only)") stopped
    # being true for it on 2026-09-06: its prune now requires an affirmative per-listing answer.
    # The TIER is deliberately unchanged, and that is the honest reading, not a downgrade:
    # CANDIDATE_PLUS_DIRECT is what the DEACTIVATION PATH now does, but the tier and its SLA measure
    # whether the POPULATION carries recent affirmative verification — and it still does not, because
    # prune_unseen() probes only the handful of rows already at grace and never stamps
    # last_verified_alive_at. Relabelling it tier 2 today would claim coverage nothing measures and
    # would raise a guaranteed P1 liveness_verification_sla from 2026-09-13 (floor 50%, actual ~0%),
    # which LISTING_LIVENESS.md §7 forbids answering with a label change. Promoting it is earned by
    # adding a sweep that verifies the population, not by editing this string.
    "aqargate": _P(
        _pol("aqargate", 3, 168), CRAWL_PRESENCE_ONLY,
        "wp-json post status: `expired` (and draft/pending/private/trash/future), or a 404 the API "
        "itself attributes to rest_post_invalid_id (post deleted). A 404 WITHOUT that code, any "
        "401/403/408/429/5xx, an unparseable body, an id mismatch and an unrecognised status are all "
        "UNKNOWN and hold the strike without deactivating.",
        "Absence from the full-catalogue crawl now only SELECTS candidates; scrapers/aqargate/run.py"
        "::_verify_gone gives each at-grace row a DIRECT confirm before prune_unseen may deactivate "
        "it. Control-validated 2026-09-06 against the failure mode this platform actually uses: "
        "aqargate usually does NOT delete a lapsed post, it flips wp status publish -> expired and "
        "keeps serving HTTP 200, so a naive 200⇒live oracle would have called every expired ad "
        "alive. Measured that day: 7/7 rows aged out were `expired`, 8/8 healthy rows `publish`, and "
        "the only 3 active rows absent from the source's 200-id published set were exactly the 3 "
        "carrying strikes (1 expired, 2 hard-deleted). Population coverage is still 0% — see the "
        "tier note above.",
    ),
    # ── Tier 3a: the deactivation path IS direct, but the population is still unverified ─────────
    # Same reasoning as aqargate immediately above, applied to every other platform whose prune
    # gained an oracle. These are NOT relabelled tier 2: CANDIDATE_PLUS_DIRECT would be a claim
    # about POPULATION coverage, and prune_unseen() probes only the handful of rows already at
    # grace and never stamps last_verified_alive_at — so the SLA these rows are graded against is
    # still unmet and saying otherwise would answer a real gap with a label change
    # (LISTING_LIVENESS.md §7). What HAS changed is the death_signals string, which is why they are
    # pulled out of the comprehension below: "none (absence from the crawl only)" became FALSE for
    # each of them the day its oracle shipped, and a registry that misdescribes its own evidence is
    # the same failure as a dark detector reading as a clean bill of health.
    **{
        p: _P(_pol(p, 3, 168), CRAWL_PRESENCE_ONLY, sig,
              "Absence from the crawl now only SELECTS candidates: scrapers/" + p + "/run.py hands "
              "prune_unseen a verify_gone oracle, so a row at grace gets a DIRECT re-fetch of its "
              "own URL and an affirmative answer before it may be deactivated. Every oracle here "
              "was control-validated against interleaved known-alive rows, and every UNKNOWN shape "
              "(no answer, 401/403/407/408/429, 5xx, empty body, unresolved redirect) holds the "
              "strike without deactivating. TIER UNCHANGED and that is honest: the population still "
              "carries no recent affirmative verification, so these rows are reported as unverified "
              "— never as verified-alive.")
        for p, sig in (
            ("abeea", "the listing's own page answering with an affirmative removal; a 200 we cannot "
                      "recognise is UNKNOWN (9 rows were once wrongly restored by a 200-means-alive rule)"),
            ("aldarim", "a 200 SOFT-404 titled «Property Not Found» with no RealEstate schema block, "
                        "and CANARY-GATED: the not-found page is rendered by a front end whose "
                        "backend a degraded run may fail to reach, so no removal is believed unless "
                        "the site is still rendering real listings to us that second. A RealEstate "
                        "block IS proof of life. Measured on 50 live controls and 6 not-served ids; "
                        "the removal limb has no real dead cohort — this platform has never "
                        "deactivated a listing — which is why it is gated"),
            ("aqarcity", "the «الإعلان منتهي» expiry banner on the listing's own page, plus 404/410"),
            ("eastabha", "this listing's OWN slider-property-status ribbon reading تأجرت / تم البيع "
                         "(the related-listings carousel's ribbons are explicitly not read), plus 404/410"),
            ("hajer", "this listing's OWN property-status-badge reading status-sold / status-rented, "
                      "read as a class attribute with <style> stripped first — the site ships the "
                      "Arabic status words in its CSS palette on every page, live ones included. "
                      "status-available is read as PROOF OF LIFE and resets the strike counter. NO "
                      "404 limb: unmeasured here, and an edited WordPress slug 404s a live listing"),
            ("jazwtn", "404/410 on the listing's own URL (29/31 dead rows, 0/40 controls)"),
            ("mizlaj", "404/410 on the listing's own URL"),
            ("nowaisiry", "404/410 on the listing's own URL"),
            ("raghdan", "404 with no listing payload; a 200 carrying RealEstateListing schema is alive"),
            ("sanadak", "a SOFT-404 identified by the listing object for THIS url being absent — the "
                        "row's own stored listing_url is used, because 39 of 1,724 rows store another "
                        "listing's URL. Removals are additionally gated by an in-run canary"),
            ("souq24", "a redirect OFF this ad's own path (14/14 dead rows, 0/40 controls), plus 404/410"),
            ("jurash", "this listing's OWN print_r-dumped `status` field reading تم البيع / تم "
                       "التأجير / مباع / مؤجر / محجوز (GONE_STATUS) — read off the SAME detail-page "
                       "fetch every crawl already makes, not a separate revisit. Every kill is pinned "
                       "the crawl it is read (_pin_sold_inactive), and now mirrors GONE evidence into "
                       "ops_stale_inactivation_probe (ops_incident #144, 2026-09-11). Control-validated "
                       "against interleaved live controls: 13/13 already-deactivated rows carried a "
                       "sold/rented status token, 10/10 known-active rows carried للبيع. NO 404 limb: "
                       "unmeasured here, and jurash is a boutique ~11-listing catalogue — an edited "
                       "listing could plausibly 404 without being gone"),
        )
    },
    **{
        p: _P(_pol(p, 3, 168), CRAWL_PRESENCE_ONLY,
              "none (absence from the crawl only)",
              "KNOWN GAP: no per-listing revisit exists. Small catalogue; the full feed is re-read "
              "each run, so absence is a strong (but still non-authoritative) hint. Rows here are "
              "reported as unverified, never as verified-alive.")
        for p in (
            "abralosol", "abwbna", "alhoshan", "alkhaas", "alobid", "alta", "amaall", "aouj", "aqaratikom",
            "aqarmonthly", "arkaan", "awal", "azdad", "bahadhabab", "eaqartabuk", "erapulse",
            "fursaghyr", "muktamel", "mustqr",
            "october",
            "ramzalqasim", "rawasidark", "remal", "sadin", "satel",
            "shmoualshmal", "therc",
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
