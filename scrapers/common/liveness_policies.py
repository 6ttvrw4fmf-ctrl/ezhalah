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
# amlakalahsa JOINS this set on 2026-09-12 (single-office Al-Ahsa WordPress+ACF listing site).
# CRAWL_PRESENCE_ONLY for the same reason as remal/amaall above: a small WordPress REST catalogue
# (6 CPTs, ~260 posts) re-read in full each run, with no per-listing revisit endpoint of its own.
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
    "aqaralsaudia": _P(
        _pol("aqaralsaudia", 3, 168), CANDIDATE_PLUS_DIRECT,
        "wp-json post status: a 404 the API itself attributes to rest_post_invalid_id (post deleted "
        "at source), or HTTP 200 carrying a status of trash/draft/pending/private/expired. A 404 "
        "WITHOUT that code, any 401/403/408/429/5xx, an unparseable body, an id mismatch and an "
        "unrecognised status are all UNKNOWN and hold the strike without deactivating.",
        "Absence from the crawl only SELECTS candidates; scrapers/aqaralsaudia/run.py::_verify_gone "
        "gives each at-grace row a DIRECT confirm before prune_unseen may deactivate it. "
        "Control-validated live 2026-09-13 against this platform's real retirement behaviour: it "
        "HARD-DELETES rather than flipping a status — id 9071 (live) answered HTTP 200 status=publish, "
        "while id 8990 (present in the feed earlier the same day, since removed) and a "
        "never-existing id 999999 both answered HTTP 404 rest_post_invalid_id. The status limb is "
        "implemented too so a future draft/trash post cannot read as alive."),
    "akariyoun": _P(
        _pol("akariyoun", 3, 168), CANDIDATE_PLUS_DIRECT,
        "the listing's OWN url: akariyoun hard-404s a page it no longer serves, so a 404 on that "
        "url is a real death signal. A 200 that still renders «رقم الاعلان» is LIVE. A 200 without "
        "it (a shell, a routing change), any 401/403/408/429/5xx, a transport failure, and a row "
        "whose listing_url we cannot look up are all UNKNOWN and hold the strike without "
        "deactivating.",
        "Absence from the crawl only SELECTS candidates; scrapers/akariyoun/run.py::_verify_gone "
        "gives each at-grace row a DIRECT confirm before prune_unseen may deactivate it. "
        "Control-validated live 2026-09-18: fyla-llbyaa-fy-hy-alghnamy-6 and ard-llbyaa-fy-hy-bdr "
        "(both live) answered HTTP 200 carrying the ad number, while this-slug-never-existed-zzz99 "
        "answered a clean HTTP 404. Unlike the WordPress siblings there is no REST api to attribute "
        "the 404 to, so the ad-number check on a 200 is what keeps a shell from reading as alive."),
    "ksaaqar": _P(
        _pol("ksaaqar", 3, 168), CRAWL_PRESENCE_ONLY,
        "the listing's OWN url: ksaaqar.com hard-404s an ad it no longer serves, so a 404 on that "
        "url is a real death signal. A 200 that still renders the spec block (the «النوع» / "
        "«رقم رخصة فال» labels) is LIVE. A 200 WITHOUT those labels is a shell or a routing change "
        "and is UNKNOWN, as are any 401/403/408/429/5xx, a transport failure, and a row whose "
        "listing_url we cannot look up — all hold the strike without deactivating.",
        "Absence from the crawl only SELECTS candidates. Control-validated live 2026-09-19: a real "
        "ad url answered HTTP 200 carrying the spec labels (191,125 bytes), while "
        "/ad/this-slug-never-existed-zzz99/ answered a clean HTTP 404 with none of them."),
    "sadiqeltajer": _P(
        _pol("sadiqeltajer", 3, 168), CRAWL_PRESENCE_ONLY,
        "«كود الاعلان» ON A 200 — NOT a 404. This source does NOT 404 a removed ad: control-"
        "validated live 2026-09-19, /ads/this-slug-never-existed-zzz99 answered HTTP **200** with "
        "3,892 bytes and no «كود الاعلان», while a real ad answered 200 with 233,232 bytes and the "
        "code present. A policy keyed on 404 would therefore NEVER retire anything here and sold "
        "listings would stay up forever. So: 200 WITH «كود الاعلان» is LIVE; 200 WITHOUT it is "
        "GONE; a 404, any 401/403/408/429/5xx, a transport failure and an unlookupable row are all "
        "UNKNOWN and hold the strike without deactivating.",
        "Absence from the crawl only SELECTS candidates; the direct confirm above decides. The "
        "asymmetry with ksaaqar is the point — the death signal was measured per platform, not "
        "assumed from the sibling."),
    # ── 2026-09-19 batch: seven small platforms ────────────────────────────────────────────────
    # The inblaj.net trio (gudai/safera/alhumaidan) share a PARSER, not a death signal — each was
    # control-validated on its own host.
    "gudai": _P(
        _pol("gudai", 3, 168), CRAWL_PRESENCE_ONLY,
        "the listing's OWN /property/ url. WordPress hard-404s a deleted post, so a 404 there is a "
        "real death signal. A 200 that still renders the detail block («تفاصيل العقار» on this "
        "theme variant) is LIVE; a 200 WITHOUT it is a shell or a theme change and is UNKNOWN, as "
        "are any 401/403/408/429/5xx, a transport failure and an unlookupable row.",
        "Absence from the crawl only SELECTS candidates. Tenant of the inblaj.net WordPress "
        "product; theme variant A (labelled, colon-separated)."),
    "safera": _P(
        _pol("safera", 3, 168), CRAWL_PRESENCE_ONLY,
        "the listing's OWN /property/ url; a deleted post 404s. On this tenant the detail block is "
        "«نظرة عامة» (theme variant B: no colons, and a «عروض مشابهه» tail), so THAT is the marker "
        "a 200 must carry to read as LIVE. Same UNKNOWN set as its siblings.",
        "Absence from the crawl only SELECTS candidates. The marker differs from gudai's because "
        "the THEME differs — the same product does not imply the same page."),
    "alhumaidan": _P(
        _pol("alhumaidan", 3, 168), CRAWL_PRESENCE_ONLY,
        "the listing's OWN /property/ url; a deleted post 404s, and a 200 must carry the detail "
        "block to read as LIVE. SEPARATELY from liveness, a title containing «تم الإيجار» / «تم "
        "البيع» is a TRANSACTED ad the office still displays: the scraper never ingests it, so it "
        "never becomes a row this policy has to retire.",
        "All 3 of this office's listings were «تم الإيجار» at onboarding, so it contributes 0 "
        "active rows today. That is its inventory, not a fault."),
    "aqarnajran": _P(
        _pol("aqarnajran", 3, 168), CRAWL_PRESENCE_ONLY,
        "the post's own url: a removed wp/v2 post 404s (control-validated live 2026-09-19 — "
        "/this-never-existed-xyz/ answered a clean 404 while a real post answered 200). A 200 "
        "without the «البند/التفاصيل» table is a shell and is UNKNOWN, as are any "
        "401/403/408/429/5xx, a transport failure and an unlookupable row.",
        "Absence from the REST listing only SELECTS candidates; the direct confirm decides."),
    "fahadalshahri": _P(
        _pol("fahadalshahri", 3, 168), CRAWL_PRESENCE_ONLY,
        "the product's own url: a removed WooCommerce product 404s (control-validated live "
        "2026-09-19). *** A 403 IS NOT DEATH ON THIS PLATFORM *** — the Store API and the site "
        "answer a BARE session and return 403 to curl_cffi's impersonated TLS fingerprint. A 403 "
        "here means the fingerprint, and is UNKNOWN. So are 401/408/429/5xx, a transport failure "
        "and an unlookupable row.",
        "Same shape as amlakalahsa: the working transport is the bare one, and 'fixing' a 403 by "
        "adding impersonation is how this source gets misread as blocked."),
    "compoundin": _P(
        _pol("compoundin", 3, 168), CRAWL_PRESENCE_ONLY,
        "«This compound is no longer listed» ON A 200 — NOT a 404. Control-validated live "
        "2026-09-19: a delisted compound answers HTTP **200** with that sentence in its <h1> and a "
        "strip of OTHER compounds beneath it, and 62 of the 129 compounds in the sitemap are in "
        "that state right now. A policy keyed on 404 would never retire anything here. So: 200 "
        "WITHOUT that sentence AND carrying unit cards is LIVE; 200 WITH it is GONE; a 404, any "
        "401/403/408/429/5xx, a transport failure and an unlookupable row are UNKNOWN.",
        "Rows are UNITS, not compounds, so one delisted compound retires every unit that belonged "
        "to it — which is correct: the units went with it."),
    "wslnaa": _P(
        _pol("wslnaa", 3, 168), CRAWL_PRESENCE_ONLY,
        "the tRPC record itself: /api/trpc/properties.bySlug returns status, active and deletedAt "
        "as FIELDS, so death is data here, not an HTTP code. status <> 'available', active false, "
        "or a non-null deletedAt is GONE. A transport failure, any non-200, and an unparseable "
        "body are UNKNOWN and hold the strike without deactivating.",
        "The served HTML carries no listing values at all, so the API is not an optimisation here "
        "— it is the only source of truth this platform has."),
    # ── 2026-09-21 batch: eleven platforms ─────────────────────────────────────────────────────
    # All eleven prune ONLY with a verify_gone oracle, routed through the shared law in
    # scrapers/common/http_liveness.py (a 401/403/429/5xx, a timeout or an empty body can never
    # read as a death). Every death signal below was measured live on 2026-09-21 against that
    # platform's own dead cohort (ids inside the live range the catalogue no longer carries) with
    # interleaved known-live controls; the numbers are in each scraper's LIVENESS block. TIER
    # UNCHANGED, for the aqargate reason: an at-grace oracle does not verify the population.
    # Three of them do NOT 404 a removed ad (ialqarawi, sakan, gomenassat), so their removals are
    # also gated by an in-run positive control that fails CLOSED.
    "alsidra": _P(
        _pol("alsidra", 3, 168), CANDIDATE_PLUS_DIRECT,
        "the post's own wp/v2 REST record: HTTP 404 carrying rest_post_invalid_id (deleted), or a "
        "200 for this id whose status is not publish, whose property_status is «مزاد», or whose "
        "own title/body says it closed (تم البيع/الإيجار…). A 404 without that code, a 401 (a "
        "trashed/draft post to a guest), any 403/429/5xx and an unparseable body are UNKNOWN.",
        "Measured: 26 of 26 sellable posts read LIVE, 20 of 20 auction posts GONE, a missing id "
        "404 rest_post_invalid_id. WordPress empties its trash to a real 404 within 30 days."),
    "moftah": _P(
        _pol("moftah", 3, 168), CANDIDATE_PLUS_DIRECT,
        "the product's own WooCommerce Store API record: HTTP 404 carrying "
        "woocommerce_rest_product_invalid_id, or a 200 for this id whose own words carry «مزاد» / "
        "a closed-deal phrase. The CDN's 6,192-byte fingerprint interstitial is a 403 and is "
        "UNKNOWN, as are 401/429/5xx and an unparseable body.",
        "Measured: 13 of 13 live products read LIVE; a missing id answers the invalid-id 404. The "
        "probe runs on the TLS profile session() negotiates (safari/firefox are served, chrome* "
        "is challenged from some networks)."),
    "masar": _P(
        _pol("masar", 3, 168), CANDIDATE_PLUS_DIRECT,
        "the post's own wp/v2/aqar REST record: HTTP 404 carrying rest_post_invalid_id, or a 200 "
        "for this id whose status is not publish or whose own words carry «مزاد» / a closed-deal "
        "phrase. The hcdn challenge page (served with HTTP 200, never JSON), a 401 for a "
        "trashed/draft post, any 403/429/5xx and an unparseable body are UNKNOWN.",
        "Measured: 9 of 9 live posts read LIVE; a missing id answers the invalid-id 404. The probe "
        "session clears the hcdn challenge before it asks."),
    "gomenassat": _P(
        _pol("gomenassat", 3, 168), CANDIDATE_PLUS_DIRECT,
        "*** NOT A 404 *** — a deleted offer answers HTTP 200 with «نأسف! هذه الصفحة غير متوفرة». "
        "The offer's OWN purpose badge (offer-header-info .property-badge, never the «عروض أخرى "
        "قريبة» cards) reading تم البيع / تم الإيجار / مزاد is GONE; any other badge is LIVE. "
        "Removals are gated by an in-run positive control that fails CLOSED.",
        "Measured over 516 ids the catalogue no longer offers: 21 of 21 answered the soft-404; 8 "
        "of 8 transacted offers carry their تم البيع/تم الإيجار badge; 10 of 10 live offers carry "
        "للبيع/للإيجار."),
    "sakan": _P(
        _pol("sakan", 3, 168), CANDIDATE_PLUS_DIRECT,
        "*** NOT A 404 *** — a removed listing 301s to the listings index (/ar/properties/buy, "
        "canonical /ar/properties/…, no SingleFamilyResidence payload). This id's own page whose "
        "«الحالة» has left «فعال», or whose title/description carries an auction/transacted token, "
        "is GONE; this id's own page otherwise is LIVE. Removals are gated by an in-run positive "
        "control that fails CLOSED.",
        "THE SITEMAP IS NOT THE CATALOGUE: of 40 ids sampled from the gaps inside the live range, "
        "37 redirected to the index and 3 were live «فعال» listings pdpmap.xml does not carry, so "
        "absence-only pruning would retire live inventory here — the probe self-heals them. 30 of "
        "30 live controls read LIVE."),
    "bossbih": _P(
        _pol("bossbih", 3, 168), CANDIDATE_PLUS_DIRECT,
        "the node's own /<nid> url: HTTP 404 (Drupal's themed 404 — the status decides, never "
        "whether the page parsed). A 200 carrying data-history-node-id=<nid> is LIVE unless its "
        "own title/description carries RETIRED_TOKENS (retired in place). Any 401/403/429/5xx, a "
        "transport failure and a 200 for another node are UNKNOWN.",
        "Measured: the office deletes nodes — 30 of 30 sampled from the 5,295 nids in the live "
        "range the catalogue no longer carries answered 404; 15 of 15 live controls read LIVE."),
    "alshawaf": _P(
        _pol("alshawaf", 3, 168), CANDIDATE_PLUS_DIRECT,
        "the node's own /<nid> url: HTTP 404 (Drupal's themed 404). A 200 that passes "
        "parse_detail's own proof (article node id AND the node block's wa.me link both name this "
        "nid) is LIVE unless its own h1/«العقار» line says مزاد / تم البيع… (closed in place). "
        "Any 401/403/429/5xx, a transport failure and an unproven 200 are UNKNOWN.",
        "Measured: 31 of 31 sampled from the 4,569 nids in the live range the catalogue no longer "
        "carries answered 404; 15 of 15 live controls read LIVE."),
    "ialqarawi": _P(
        _pol("ialqarawi", 3, 168), CANDIDATE_PLUS_DIRECT,
        "*** NOT A 404 *** — an id the site no longer serves answers HTTP 200 with the HOMEPAGE "
        "(its myCarousel slider, no «رقم العقار»), and a listing taken out of every category "
        "still serves its own page with «القسم» EMPTY; both are GONE. This id's own page with a "
        "category is LIVE unless its title/«تفاصيل العقار» carries the crawl's auction/sold "
        "words. Removals are gated by an in-run positive control that fails CLOSED.",
        "Measured over 120 of the 1,132 ids in the live range the catalogue no longer carries: "
        "111 homepage, 9 uncategorised pages; 60 of 60 indexed listings carry «القسم». Without the "
        "empty-category limb the probe would self-heal a delisted row forever, since no index can "
        "reach it again."),
    "aljassim": _P(
        _pol("aljassim", 3, 168), CANDIDATE_PLUS_DIRECT,
        "the node's own /<nid> url: HTTP 404 (Drupal's themed 404). A 200 that passes "
        "parse_detail's own proof (the article's data-history-node-id names this nid) is LIVE "
        "unless the crawl's own _AUCTION/_GONE patterns fire on its title/blocks. The hcdn "
        "challenge is a 403 and is UNKNOWN (the probe session clears it first), as are "
        "401/429/5xx, a transport failure and an unproven 200.",
        "Measured: 31 of 31 sampled from the 2,468 nids in the live range the catalogue no longer "
        "carries answered 404; 15 of 15 live controls read LIVE."),
    "almotmkenah": _P(
        _pol("almotmkenah", 3, 168), CANDIDATE_PLUS_DIRECT,
        "the source's own archive banner «هذا الاعلان لم يعد صالح تم نقله للأرشيف» on the ad's "
        "own page, read by THIS run's crawl (scrapers/almotmkenah/run.py::_verify_gone answers "
        "from the run's own per-ad status map). An ad this run did not reach is probed at its OWN "
        "stored listing_url under the shared law: HTTP 404 (a slug the site no longer has) or the "
        "archive banner is GONE, the ad's own page without it is LIVE, anything else UNKNOWN.",
        "339 of the 361 ads in the index are archived by the site itself; ~22 are live. Measured "
        "2026-09-21: a live slug with its tail changed and an invented slug both answer HTTP 404; "
        "6 of 6 live ads probed at their own URL read LIVE."),
    "nufouth": _P(
        _pol("nufouth", 3, 168), CANDIDATE_PLUS_DIRECT,
        "DATA, not an HTTP code (the wslnaa shape): the property's own API record "
        "(get_property_data) no longer carries this row's ad (by its digits), the ad's status has "
        "left «نشط», the unit (by the hash of its name) is gone from the ad, or the property now "
        "has no ads at all — GONE. The ad «نشط» with this unit is LIVE. A 403 from that API "
        "(Frappe's 'no such property') stays UNKNOWN by law; a property deleted outright is then "
        "retired by its own public page /B/<code> answering 200 «عذرًا، العقار المطلوب غير "
        "موجود.», gated fail-closed on the API disowning the same code (403 PermissionError).",
        "Measured: of 36 codes sampled between the 270 indexed ones, 8 answered 200 with zero ads "
        "(GONE) and 28 answered 403 (UNKNOWN by law); 25 of 25 live units read LIVE. 2026-09-21: "
        "/B/<code> read «غير موجود» on 13 of 13 gap codes and HTTP 500 on 6 of 6 live codes."),
    # ── 2026-09-24 batch: thirty-five platforms ─────────────────────────────────────────────────
    # All thirty-five prune ONLY with a verify_gone oracle handed to db.prune_unseen(), routed
    # through the shared law in scrapers/common/http_liveness.py (a 401/403/429/5xx, a timeout or
    # an empty body can never read as a death). Every death signal below is the one
    # scrapers/<slug>/run.py IMPLEMENTS and the numbers are the ones its own docstring MEASURED
    # (2026-09-23/24); nothing here is inferred. Same tier as the 2026-09-21 batch for the same
    # reason: absence from the crawl only SELECTS candidates and each gets a DIRECT re-fetch of its
    # own record before it may be deactivated; coverage is measured separately. Eleven of them
    # (dwelleo, justsa, jawher, m3tmd, senan, eilmalriyada, villassa, marksa, rightcompound,
    # livingcompound, azure) also build every row from a DIRECT fetch of its own record and stamp
    # it through db.mark_direct_alive — zero extra requests. Eight do NOT hard-404 a removed
    # listing and say so below: justsa, marksa, eydah, sodasyat, alrifai, villassa (the death is a
    # served 200), albdah (a 500 body, which the law never reads as a death — its GONE limb is
    # unreachable in production) and flow (a 404 is UNKNOWN there; only a 200 whose page JSON
    # names another fid is GONE). scrapers/common/tests/test_batch_2026_09_24_liveness_oracles.py
    # executes every signal below against its measured shapes and the law.
    "dwelleo": _P(
        _pol("dwelleo", 3, 168), CANDIDATE_PLUS_DIRECT,
        "the record's own API route GET api.dwelleo.sa/api/v1/properties/<id>: HTTP 422 carrying "
        "«The selected id is invalid.» or HTTP 404 carrying «العقار غير موجود» is GONE; a 200 whose "
        "data.id is this id is LIVE only while status is publish AND availability is available, "
        "otherwise GONE (sold/rented in place); a 200 for another id, an unparseable body and any "
        "401/403/429/5xx are UNKNOWN. Removals are canary-gated on a row THIS run mapped still "
        "answering live (fails CLOSED) and run only after a COMPLETE walk that collected >=98% of "
        "the site's own pagination.total, never on --limit or a single --type.",
        "RE-ONBOARDED 2026-09-24 (owner decision) after the 2026-06-23 removal. Measured 2026-09-24 "
        "over 30 ids drawn from the 7,926 gaps inside the completed 11,480-row walk: 28 answered "
        "422, 2 answered 404, 0 answered 200; 4 live controls → 200 publish/available. Every row "
        "built from its own detail record carries the direct-alive stamp."),
    "aqalemhajer": _P(
        _pol("aqalemhajer", 3, 168), CANDIDATE_PLUS_DIRECT,
        "the node's own /<nid> url: HTTP 404 (the office's themed «تم بيع العقار أو تأجيرة» page — "
        "the status decides). A 200 carrying data-history-node-id=<nid> is LIVE unless its own "
        "title/fields carry RETIRED_TOKENS (مزاد / تم البيع / مباع / محجوز …). A 200 for another "
        "node, any 401/403/429/5xx and a transport failure are UNKNOWN. Removals are gated on a "
        "complete enumeration (cards == the site's printed «عدد العقارات») and an in-run positive "
        "control (a card this crawl just enumerated re-read live) that fails CLOSED.",
        "Measured 2026-09-23 over a 30-id stride sample of the 1,568 ids inside the live range the "
        "catalogue no longer carries: 29 answered 404, 1 answered 200 for a NON-listing node (read "
        "LIVE, never pruned — and never in our tables); 3 of 3 live controls read LIVE."),
    "sakani": _P(
        _pol("sakani", 3, 168), CANDIDATE_PLUS_DIRECT,
        "the unit's own DETAIL API route (the SPA's only data call): HTTP 404 «not found» is GONE; "
        "a 200 whose attributes have left status published / publish true is GONE; a 200 whose "
        "REGA licence names a purpose other than rent is GONE (the unit lives on, the rental does "
        "not); a 200 published rent is LIVE. A Cloudflare challenge (403 text/html, once a 500 "
        "wrapping one) and a hidden unit's 403 are about OUR access and UNKNOWN by law. Pruning "
        "runs only after a complete, unlimited enumeration and only when three units parsed live "
        "THIS run answer LIVE through ONE warmed session — fails CLOSED.",
        "Measured 2026-09-23: 6 of 6 old ids and a bogus id → 404 not found; live rent 24858 and "
        "sale 24798 → 200 published; hidden 20250 → 403. Market-unit ids are SHARED with the sale "
        "marketplace, so absence from the rent catalogue alone is never death."),
    "shatri": _P(
        _pol("shatri", 3, 168), CANDIDATE_PLUS_DIRECT,
        "the post's own wp/v2/properties REST record: HTTP 404 carrying rest_post_invalid_id is "
        "GONE; a 200 for this id whose status is not publish, or whose property_label terms carry "
        "«تم البيع» (resolved through the live taxonomy), is GONE; otherwise LIVE. A 200 for "
        "another id, an unparseable body and any 401/403/429/5xx are UNKNOWN.",
        "Measured 2026-09-24: 74 posts on one REST page, 22 already labelled «تم البيع» — a skip at "
        "crawl and a death in the probe. The office retires in place by label; the invalid-id 404 "
        "is WordPress's own."),
    "alqasem": _P(
        _pol("alqasem", 3, 168), CANDIDATE_PLUS_DIRECT,
        "the post's own page (its stored listing_url, else /?p=<id>): HTTP 404 carrying the theme's "
        "«الصفحة غير موجودة» is GONE; a 200 whose body class carries single-property … "
        "postid-<id> is LIVE. A 404 without that title, a 200 for another post and any "
        "401/403/429/5xx are UNKNOWN. The REST API is walled (403 from a security plugin for every "
        "fingerprint), so the page is the only route.",
        "Measured 2026-09-24: /property-sitemap.xml == the /property/ archive (29 == 29) and the run "
        "refuses to prune when the two disagree."),
    "fkralemar": _P(
        _pol("fkralemar", 3, 168), CANDIDATE_PLUS_DIRECT,
        "THIS run's own complete catalogue read first: a card ribbon «مباع» is GONE (a sold "
        "product's own page is byte-identical in shape to a live one, so the page cannot say it). "
        "Otherwise the product's own /offers/<slug> page: HTTP 404 carrying «لم يتم العثور على "
        "الصفحة» is GONE; a 200 whose product-container carries data-unique-id=<id> is LIVE; "
        "anything else UNKNOWN.",
        "Measured 2026-09-24: 38 unique products across the three catalogue pages (10 «للبيع», 28 "
        "«مباع»), every page asserting data-pagination-products-left=0 (a page that says otherwise "
        "aborts the run). The sitemap lists 7 hidden products no catalogue page shows and is NOT "
        "the enumeration."),
    "wadod": _P(
        _pol("wadod", 3, 168), CANDIDATE_PLUS_DIRECT,
        "the listing's own /property/<id> page: HTTP 404 carrying the site's «غير متوفر» page is "
        "GONE; a 200 carrying «المعلومات الأساسية للعقار» is LIVE. An id that never existed answers "
        "HTTP 500, which the shared law reads as no opinion — as are 401/403/429 and a transport "
        "failure.",
        "Measured 2026-09-24: rented/sold ids 84, 48, 82 → 404 (3/3); live 92, 93, 80 → 200 (3/3); "
        "999999 → 500. Rented/sold cards carry no href on the catalogue, so the crawl never links "
        "them either."),
    "almuteb": _P(
        _pol("almuteb", 3, 168), CANDIDATE_PLUS_DIRECT,
        "the post's own wp/v2/properties REST record: HTTP 404 carrying rest_post_invalid_id is "
        "GONE; a 200 for this id whose status is not publish or whose property_status terms match "
        "the closed-deal vocabulary (تم البيع / تم الإيجار / مباع / مؤجر) is GONE; for a -U<i> "
        "multi-unit row, the parent 200 with fewer fave_multi_units than the unit's index is GONE "
        "(the post lives on, the unit was removed). Otherwise LIVE; a 200 for another id, an "
        "unparseable body and 401/403/429/5xx are UNKNOWN.",
        "Measured 2026-09-24: 10 posts, all publish, one carrying a Houzez multi-unit; the "
        "closed-deal ids are resolved from the live property_status taxonomy each run."),
    "aalbarrak": _P(
        _pol("aalbarrak", 3, 168), CANDIDATE_PLUS_DIRECT,
        "the post's own wp/v2/properties REST record: HTTP 404 carrying rest_post_invalid_id is "
        "GONE; a 200 for this id whose status is not publish or whose property_status terms carry "
        "the source's own «تم البيع» / «تم الايجار» flag is GONE; otherwise LIVE. A 200 for another "
        "id, an unparseable body and 401/403/429/5xx are UNKNOWN.",
        "Measured 2026-09-24: 10 posts (5 للبيع, 5 للإيجار); the «تم …» status terms exist in the "
        "taxonomy at 0 posts — the source's own SOLD/RENTED flag is a skip at crawl and a death in "
        "the probe."),
    "alrifai": _P(
        _pol("alrifai", 3, 168), CANDIDATE_PLUS_DIRECT,
        "*** NOT A 404 *** — the listing's own index.php?page=property-detail&id=<n> page, read "
        "under the shared law (blocked/throttled, 5xx and an empty body → UNKNOWN): a 200 "
        "rendering the EMPTY SHELL (no title) is GONE; a full page is GONE only when the site's "
        "complete, positive-controlled catalogue (index.php?page=properties) no longer lists this "
        "id, LIVE when it does. A catalogue that is unreadable or fails its control holds the "
        "verdict UNKNOWN.",
        "Measured 2026-09-24: one unpaginated catalogue page, 21 distinct ids; the office's own "
        "removal is delisting from that page, so the catalogue is re-read (cached per run) as the "
        "second limb."),
    "sodasyat": _P(
        _pol("sodasyat", 3, 168), CANDIDATE_PLUS_DIRECT,
        "*** NOT A 404 *** — the listing's own /single/<id> page: a 200 that arrived by a redirect "
        "OFF this path onto /search (its title «سداسيات - جميع العقارات») is GONE; a 200 carrying "
        "«اعلان رقم» is LIVE; anything else UNKNOWN. Removals run only when the site's printed «N "
        "نتيجه» counter equals the links enumerated.",
        "Measured 2026-09-24: 4 of 4 gone ids 302 → /search; 11 live cards on the one /search page, "
        "11/11 carrying «اعلان رقم»."),
    "hasaad": _P(
        _pol("hasaad", 3, 168), CANDIDATE_PLUS_DIRECT,
        "the unit's PROJECT page via /?p=<project post id>: HTTP 404 carrying WordPress's own "
        "error404 body class is GONE (a bare 404 from a WAF/CDN says nothing); a 200 for THIS "
        "project (postid-<id>) whose «الوحدات» card for unit-modal-<unit id> is green «متاح» is "
        "LIVE; the same page with the unit absent, red, or «مباع» / «تم البيع» is GONE; anything "
        "else UNKNOWN.",
        "Measured 2026-09-24: 3 live projects → 200 with their unit cards (3/3); 5 non-post ids and "
        "a fabricated slug → 404 error404 (6/6). Row grain is the UNIT MODEL (HSD<project>U<unit>), "
        "listing_url the project page where the price is shown."),
    "aqaralriyadh": _P(
        _pol("aqaralriyadh", 3, 168), CANDIDATE_PLUS_DIRECT,
        "the post's own wp/v2/posts REST record: HTTP 404 carrying rest_post_invalid_id is GONE; a "
        "200 publish record on this id's own route is LIVE; a 200 with any other status, a 401/403 "
        "(a post moved to draft/trash answers rest_forbidden to guests), any 429/5xx and an "
        "unparseable body are UNKNOWN. Pruning runs only after a complete, non-limited "
        "enumeration.",
        "Measured 2026-09-24: 15 non-post ids → 404 rest_post_invalid_id (15/15); 3 live controls → "
        "200 publish (3/3); the page side agrees (/?p=311 → 404, /?p=332 → 200)."),
    "justsa": _P(
        _pol("justsa", 3, 168), CANDIDATE_PLUS_DIRECT,
        "*** NOT A 404 *** — the unit's own /l/<id> page always answers HTTP 200: a body that is the "
        "25-byte «لم يتم العثور على الوحدة» with no «تفاصيل سريعة» is GONE; a page carrying "
        "«تفاصيل سريعة», the unit's J-number and status «متاح» is LIVE; the same page with status "
        "«مباع» / «مؤجر» is GONE (retired in place); anything else UNKNOWN. Pruning runs only after "
        "a complete, non-limited enumeration.",
        "Measured 2026-09-24: 4 of 4 non-unit ids → the not-found sentence; 5 of 5 live controls → "
        "57-64 KB naming their J-number; sold 624 / rented 674 still render with their status. "
        "Every row built from its own detail page carries the direct-alive stamp."),
    "snam": _P(
        _pol("snam", 3, 168), CANDIDATE_PLUS_DIRECT,
        "the unit's PROJECT record GET /api/public/projects/<id>: HTTP 404 carrying «تعذر العثور "
        "على المشروع» is GONE (the whole project is gone); a 200 project record in which this unit "
        "id is absent from properties[], or present with a status other than available or "
        "isArchived, is GONE; present and available is LIVE; an unparseable 200 and "
        "401/403/429/5xx are UNKNOWN. The site's /ar/properties/<id> page is NOT an oracle — the "
        "same app shell for any id.",
        "Measured 2026-09-24: 7 non-project ids → 404 (7/7); all 29 listed projects → 200 (29/29); "
        "72 units across them: 51 available, 11 reserved, 10 sold. Row grain is the UNIT "
        "(SNM<project>U<unit>)."),
    "jawher": _P(
        _pol("jawher", 3, 168), CANDIDATE_PLUS_DIRECT,
        "the record's own API detail route /api/public/v2/properties/<id>: HTTP 404 JSON carrying a "
        "«message» («No query results for model … Property N») is GONE; a 200 whose data.id is "
        "this id is LIVE only while availability_status == available, otherwise GONE "
        "(sold/reserved/unavailable rows stay served with a badge); a 200 for another record and "
        "401/403/429/5xx are UNKNOWN. The HTML page is a SOFT 404 (200 «Property Not Found») and "
        "never a death on its own. Removals are canary-gated on a row THIS run mapped (fails "
        "CLOSED) and run only after a complete, un-limited enumeration.",
        "Measured 2026-09-24: gone 24916/1/99999999 → 404 (3/3); sold 48506/45942/44329, "
        "unavailable 39450/26004, reserved 48840/36684 → 200 with that status (7/7); live "
        "24915/42818/52519 → 200 available (3/3). Every row built from its own record carries the "
        "direct-alive stamp. This file is also the engine m3tmd and senan import."),
    "m3tmd": _P(
        _pol("m3tmd", 3, 168), CANDIDATE_PLUS_DIRECT,
        "the same engine as jawher (scrapers/jawher/run.py::make_verify_gone on this tenant's host): "
        "the record's own API detail route — a 404 JSON with a «message» is GONE; a 200 for THIS id "
        "is LIVE only while availability_status == available, otherwise GONE; another record, an "
        "unparseable body and 401/403/429/5xx are UNKNOWN; canary-gated (fails CLOSED), after a "
        "complete enumeration only.",
        "Measured 2026-09-24 on this host: gone 37985/1/99999999 → 404 JSON (3/3); live "
        "37993/37767/37614 → 200 available (3/3); the HTML route soft-404s with 200 «Property Not "
        "Found». 46/46 available today. Every row built from its own record carries the "
        "direct-alive stamp."),
    "senan": _P(
        _pol("senan", 3, 168), CANDIDATE_PLUS_DIRECT,
        "the same engine as jawher (scrapers/jawher/run.py::make_verify_gone on this tenant's host): "
        "the record's own API detail route — a 404 JSON with a «message» is GONE; a 200 for THIS id "
        "is LIVE only while availability_status == available, otherwise GONE (a sold unit stays "
        "published with a «مباعة» badge); another record, an unparseable body and 401/403/429/5xx "
        "are UNKNOWN; canary-gated (fails CLOSED), after a complete enumeration only.",
        "Measured 2026-09-24 on this host: gone 44629 (archived, 404 with an empty message) / 1 / "
        "99999999 → 404 JSON (3/3); sold 41223/41222/44628 and unavailable 44610/44591/44579 → 200 "
        "with that status (6/6); live 44630/45254/41522 → 200 available (3/3). Every row built "
        "from its own record carries the direct-alive stamp."),
    "goldendeal": _P(
        _pol("goldendeal", 3, 168), CANDIDATE_PLUS_DIRECT,
        "the Nuzul tenant's own API record GET goldendeal.nzl-backend.com/api/public/properties/"
        "<id>: HTTP 404 carrying «No query results» is GONE; a 200 whose data.id is this id is "
        "LIVE only while availability_status is available, otherwise GONE (the office's own «مباع» "
        "/ «مؤجر» / «غير متاح» badge, served in place); another record, an unparseable body and "
        "401/403/429/5xx are UNKNOWN. The WEB page cannot be the oracle (an unknown id renders a "
        "200 «Property Not Found» shell; a retired id renders the full listing). Removals are "
        "canary-gated on an id THIS run mapped echoing itself (memoised, fails CLOSED) and run "
        "only after a complete enumeration (len(items) == meta.total, no --limit).",
        "Measured 2026-09-23: 4/4 live controls → 200 available; 2/2 retired in place (sold, "
        "unavailable) → 200 status ≠ available; 6/6 not-served ids (3 yameen ids + 3 in-range gaps "
        "53007/53011/53019) → 404. This file is also the engine yameen imports."),
    "thousand": _P(
        _pol("thousand", 3, 168), CANDIDATE_PLUS_DIRECT,
        "the listing's own /property/<cuid> page: HTTP 404 (a themed 23 KB page) is GONE; a 200 "
        "whose body echoes THIS listing's data-listing-id is LIVE; anything else (another listing, "
        "401/403/429/5xx, a transport failure) is UNKNOWN. Removals are canary-gated on one live "
        "control re-fetched in-run (memoised, fails CLOSED) and prune runs only after a complete "
        "enumeration (cards == the page's printed counter).",
        "Measured 2026-09-23: 3/3 mutated cuids → 404; 6/6 live controls in the probe and 105/105 "
        "detail pages in the full crawl → 200 echoing their id."),
    "yameen": _P(
        _pol("yameen", 3, 168), CANDIDATE_PLUS_DIRECT,
        "the same Nuzul engine as goldendeal (scrapers/goldendeal/run.py::verify_gone_for on tenant "
        "4561, host meteen.nzl-backend.com): a 404 «No query results» is GONE; a 200 for THIS id is "
        "LIVE only while availability_status is available, otherwise GONE (12 rented + 2 "
        "unavailable of 27 are served in place); another record and 401/403/429/5xx are UNKNOWN; "
        "canary-gated (fails CLOSED), complete enumeration only.",
        "Measured 2026-09-23: live 3/3 → 200 available; rented 3/3 → 200 status rented; "
        "cross-tenant goldendeal ids 3/3 → 404; the web page for a rented id renders the full "
        "listing (never gone)."),
    "ebriza": _P(
        _pol("ebriza", 3, 168), CANDIDATE_PLUS_DIRECT,
        "DATA on the POST-only detail route (action=get_property_data, judged through the shared "
        "law's decide/read_is_unbelievable): HTTP 404 carrying «No property found» is GONE; a 200 "
        "whose id echoes this id is LIVE while status is \"1\", otherwise GONE; an unparseable "
        "body, a 400 «Invalid ID», 401/403/429/5xx and no answer are UNKNOWN. The HTML page is NOT "
        "the oracle (a gone id still renders the shell with 200). Prune runs only after a COMPLETE "
        "walk (distinct ids == the site's own totals) and after three rows parsed live this run "
        "answer LIVE through the same route (fails CLOSED).",
        "Measured 2026-09-24: sitemap ids 59/67/68 (no longer on the API) → 404 «No property "
        "found»; ids 0 and -1 the same; live 770/769/308 → 200 with their id and status \"1\". The "
        "sitemap lists 574 ids of which only 207 exist — never enumerated from."),
    "eilmalriyada": _P(
        _pol("eilmalriyada", 3, 168), CANDIDATE_PLUS_DIRECT,
        "the record's own GET api.eilmalriyada.com/api/recent/<id>: HTTP 404 carrying «غير موجود» "
        "is GONE; a 200 whose id echoes this id is LIVE; an unparseable body, another record and "
        "401/403/429/5xx are UNKNOWN. The HTML is not the oracle (a gone id serves the bare shell "
        "with 200). Prune runs only after the one-shot catalogue parsed as a non-empty array AND "
        "three rows parsed live this run answer LIVE through the same route (fails CLOSED).",
        "Measured 2026-09-24: sitemap ids 136/169/170 and 999999 → 404 «العقار غير موجود»; "
        "controls 134/403/664 → 200 echoing their id. Every row built from its own record carries "
        "the direct-alive stamp."),
    "daryusuf": _P(
        _pol("daryusuf", 3, 168), CANDIDATE_PLUS_DIRECT,
        "the post's own wp/v2/portfolio REST record: HTTP 404 carrying rest_post_invalid_id is "
        "GONE; a 200 echoing this id is LIVE while status is publish, GONE with any other status; "
        "another id, an unparseable body and 401/403/429/5xx are UNKNOWN. Prune runs only after a "
        "COMPLETE walk (distinct ids == x-wp-total) AND three rows parsed live this run answer "
        "LIVE through the same route (fails CLOSED).",
        "Measured 2026-09-24: 9300/9200/9000 (not portfolio posts) → 404 rest_post_invalid_id; "
        "9338/9355/9329 → 200 publish."),
    "albdah": _P(
        _pol("albdah", 3, 168), CANDIDATE_PLUS_DIRECT,
        "*** NOT A 404 *** — the listing's own /property/<id>/details/ page. The signal reads HTTP "
        "500 carrying «DoesNotExist» (Django DEBUG is on — the site's own not-found) as GONE and a "
        "200 carrying the page's own «إعلان رقم <id>» as LIVE; any other 500, 401/403/429 and a "
        "transport failure are UNKNOWN. The shared law refuses a death on ANY 5xx, so that 500 "
        "limb alone is held UNKNOWN; the SECOND limb certifies the removal: this run's COMPLETE "
        "catalogue (per-type counters sum to the homepage's printed total) no longer lists the id, "
        "gated on a row THIS run mapped reading live (fails CLOSED).",
        "Measured 2026-09-24: 4/4 fabricated ids → 500 DoesNotExist; 10/10 live ids → 200 «إعلان "
        "رقم». The 5xx body is held by http_liveness read_is_unbelievable() as «the source is "
        "broken, not the listing», so the catalogue limb (alrifai's pattern) is the removal path "
        "production actually takes."),
    "eydah": _P(
        _pol("eydah", 3, 168), CANDIDATE_PLUS_DIRECT,
        "*** NOT A 404 *** — the offer's own stored listing_url (the host is case-sensitive, so "
        "never rebuilt from the ad number): a 200 carrying a RealEstateListing JSON-LD whose url is "
        "this url is LIVE; a 200 without one — the HOMEPAGE the site serves for a missing offer (a "
        "RealEstateAgent @graph, no RealEstateListing) — is GONE; a 404 is GONE; a 200 whose "
        "listing names another url and 401/403/429/5xx are UNKNOWN. Canary-gated on a row THIS run "
        "mapped (fails CLOSED); prune only when the index count equals the printed «N عرض "
        "مرخّص».",
        "Measured 2026-09-24: /offers/EY-9999.html, /offers/EY-1003.html and the wrong-case "
        "EY-1001 all → 200 with the homepage (89,891 B); both live pages → 200 with their own "
        "RealEstateListing."),
    "tamyaz": _P(
        _pol("tamyaz", 3, 168), CANDIDATE_PLUS_DIRECT,
        "the record's own GET /api/properties/<id>: HTTP 404 carrying «غير موجود» is GONE; a 200 "
        "JSON whose id is this id is LIVE unless published is false (the UI never shows it) — then "
        "GONE; another id, an unparseable body and 401/403/429/5xx are UNKNOWN. Canary-gated on a "
        "row THIS run mapped (fails CLOSED).",
        "Measured 2026-09-24: 3/3 fabricated ids → 404 «العقار غير موجود»; the live id → 200 with "
        "the same id. A 9-object catalogue read in one call."),
    "hazim": _P(
        _pol("hazim", 3, 168), CANDIDATE_PLUS_DIRECT,
        "the entity's own Base44 record GET …/entities/Property/<id>: HTTP 404 carrying «not "
        "found» is GONE; a 200 JSON whose id is this id is LIVE while status is «متاح», GONE with "
        "status مباع / مؤجر / محجوز (the admin form's closed list, which the crawl skips on "
        "sight), UNKNOWN with any other status; another id, an unparseable body and "
        "401/403/429/5xx are UNKNOWN. Canary-gated on a row THIS run mapped (fails CLOSED).",
        "Measured 2026-09-24: 4/4 fabricated 24-hex ids → 404 «Entity Property with ID … not "
        "found»; the live id → 200 status «متاح». A 6-row catalogue."),
    "villassa": _P(
        _pol("villassa", 3, 168), CANDIDATE_PLUS_DIRECT,
        "DATA, not an HTTP code: the record's own API detail — a 200 whose data.main.id is this id "
        "is LIVE while main.status == \"1\" and GONE whenever main.status is not \"1\" (measured: "
        "delisted rows read \"0\" — delisted in place, the record otherwise intact). A "
        "never-existing id answers HTTP 500 (Laravel «Undefined array "
        "key»), which the shared law can never read as a death, so such a row sits UNKNOWN; "
        "another record and 401/403/429 are UNKNOWN too. Canary-gated on a row THIS run mapped "
        "still reading \"1\" (fails CLOSED); prune only after the complete, non-limited "
        "enumeration.",
        "Measured 2026-09-23: 14/14 catalogue ids → 200 status \"1\"; 3/3 delisted ids (surfaced "
        "only inside similar_ads) → 200 status \"0\"; 4/4 never-existing ids → 500. The realistic "
        "removal on this source is the status flip. Every row built from its own record carries "
        "the direct-alive stamp."),
    "marksa": _P(
        _pol("marksa", 3, 168), CANDIDATE_PLUS_DIRECT,
        "*** NOT A 404 *** — the offer's own /ar/property/showitem/<id> page: a 200 whose <title> "
        "is the site's «الصفحة الرئيسية» soft-404 shell (blank spec cells, the logo as the only "
        "slide) is GONE; a 200 with a project title and populated cells is LIVE; a 200 that is not "
        "this site's page at all, and any non-200 (Mod_Security 406, 401/403/429/5xx, a transport "
        "failure), are UNKNOWN. Catalogue absence only SELECTS candidates — unlisted ids keep "
        "rendering full offers. Canary-gated on a row THIS run mapped (fails CLOSED); prune only "
        "after the complete, non-limited enumeration.",
        "Measured 2026-09-23: 4/4 never-existing ids → 200 soft-404 shell; 10/10 catalogue ids and "
        "4/4 unlisted-but-kept ids (500, 800, 878, 879) → LIVE. Every row built from its own page "
        "carries the direct-alive stamp."),
    "rightcompound": _P(
        _pol("rightcompound", 3, 168), CANDIDATE_PLUS_DIRECT,
        "the unit's COMPOUND page at the row's own stored listing_url: HTTP 404/410 is GONE; a 200 "
        "carrying the rc-cd-units list in which this villa id's block reads data-is-available=True "
        "is LIVE, the same page with the block absent or not available is GONE; a 200 without the "
        "unit list, and 401/403/429/5xx, are UNKNOWN. Canary-gated on a row THIS run mapped (fails "
        "CLOSED); the site's own /api/v1/compounds total is the completeness check.",
        "Measured 2026-09-24: 3/3 invented slugs → 404; /api/v1/compounds answers total 254 and the "
        "sitemap carries 254 compound pages. Row grain is the UNIT (RCP<villa id>, owner decision "
        "for compound sites); listing_url is the compound page. Every row built from its own "
        "compound page carries the direct-alive stamp."),
    "livingcompound": _P(
        _pol("livingcompound", 3, 168), CANDIDATE_PLUS_DIRECT,
        "WordPress's own /?p=<post id>: a REAL HTTP 404/410 is GONE; a 200 that landed on a page "
        "whose body class carries postid-<id> is LIVE unless its own status/label reads sold / "
        "rented / leased (then GONE); any other 200 and 401/403/429/5xx are UNKNOWN. Canary-gated "
        "on a row THIS run mapped (fails CLOSED); absence from the sitemap alone is never death.",
        "Measured 2026-09-24: 3/3 live ids → 301 to the property's own URL; 3/3 invented ids → a "
        "real 404. wp/v2/property REST is not exposed (rest_no_route), so the page is the route. "
        "Every row built from its own page carries the direct-alive stamp."),
    "azure": _P(
        _pol("azure", 3, 168), CANDIDATE_PLUS_DIRECT,
        "the unit type's COMPOUND page at the row's own stored listing_url: HTTP 404/410 is GONE; a "
        "200 carrying the unit panels whose hero badge reads Fully Leased / Coming Soon is GONE "
        "(the same status words the crawl skips on sight); otherwise LIVE when this unit type's "
        "key (the literal key first, then the ordinal-stripped one) is among the page's "
        "annual-panel unit names and GONE when the page lists units and this one is not among "
        "them; a 200 without a unit list and 401/403/429/5xx are UNKNOWN. Canary-gated on a row "
        "THIS run mapped (fails CLOSED).",
        "Row grain is the UNIT TYPE (AZR<compound slug>-<unit key>); the key is recovered from the "
        "stored listing_url because both slug and key can contain hyphens (al-reem, palma-i). "
        "Measured 2026-09-24 on all 16 compound pages. Every row built from its own compound page "
        "carries the direct-alive stamp."),
    "expattrusted": _P(
        _pol("expattrusted", 3, 168), CANDIDATE_PLUS_DIRECT,
        "the residence's COMPOUND page /p/en/property/<slug> (Next.js SSR, read from its "
        "__NEXT_DATA__ pageProps.property only — never the recommendations block): HTTP 404 is "
        "GONE; a 200 whose page JSON lists this residence id under residences[] is LIVE, the same "
        "page without it is GONE; a 200 without the page JSON and 401/403/429/5xx are UNKNOWN. "
        "Canary-gated on a row THIS run mapped (fails CLOSED).",
        "Row grain is the residence (unit type): measured 2026-09-24, 43 compounds, 55 residences on "
        "16 of them; 27 compounds publish no residence and yield no row."),
    "abaad": _P(
        _pol("abaad", 3, 168), CANDIDATE_PLUS_DIRECT,
        "the ad's OWN /api/v1/estate/get-estate/<id> record. *** A 200 IS NOT A LIFE HERE *** a "
        "de-listed abaad ad keeps serving its full detail page, so the decider is the REGA ad "
        "licence the record publishes about ITSELF: an HTTP 404 is GONE, and a 200 whose end_date "
        "(«تاريخ انتهاء رخصة الإعلان») has already passed is GONE; a 200 whose licence is still "
        "valid is LIVE; a licence expiring TODAY is held as UNKNOWN (the measured boundary, never "
        "resolved either way); a 200 without a readable end_date, a body that will not parse, and "
        "401/403/429/5xx are UNKNOWN. Canary-gated on a row THIS run mapped (fails CLOSED).",
        "Measured 2026-09-25: the catalogue went 405 -> 400 inside ~25 minutes and the five ids "
        "that left were EXACTLY the five whose end_date was that day, with zero of the remaining "
        "400 carrying a past expiry; validated on 12 sampled absent ids (4 x 404, 8 x "
        "200-with-lapsed-licence, 12/12). Absence from the catalogue only SELECTS candidates — "
        "scrapers/abaad/run.py::verify_gone gives the verdict."),
    "flow": _P(
        _pol("flow", 3, 168), CANDIDATE_PLUS_DIRECT,
        "the home type's own /home/fid/<fid> page under its property's available-homes route "
        "(Next.js SSR): a 200 whose page JSON externalRefId is this fid is LIVE, a 200 whose page "
        "JSON names another fid is GONE; a 200 without page JSON (the site's own 200 «Oops!» "
        "shell) and any non-200 — a 404 included, as well as 401/403/429/5xx — are UNKNOWN. "
        "Canary-gated on a row THIS run mapped (fails CLOSED).",
        "Measured 2026-09-24: 15 floorplans across riyadh-granada/narjis/olaya, all status "
        "available; riyadh-science-park's page is the site's own 200 «Oops!» shell (floorplans "
        "null) — a sitemap entry, not a catalogue member. Only riyadh-* slugs whose JSON region "
        "reads Riyadh are enumerated."),
    "rakez": _P(
        _pol("rakez", 3, 168), CANDIDATE_PLUS_DIRECT,
        "wp-json unit status: a 404 the API itself attributes to rest_post_invalid_id (the unit was "
        "deleted at source), OR an HTTP 200 whose acf.unit_status has left 'available' for "
        "'reserved'/'sold-out' — on this platform a unit stops being purchasable far more often "
        "than it is deleted. A bare 404, any 401/403/408/429/5xx, an unparseable body, an id "
        "mismatch and an unrecognised status are all UNKNOWN and hold the strike without "
        "deactivating.",
        "Absence from the crawl only SELECTS candidates; scrapers/rakez/run.py::_verify_gone gives "
        "each at-grace row a DIRECT confirm before prune_unseen may deactivate it. Measured "
        "2026-09-14 over all 14,319 units: 8,549 available, 4,030 reserved, 1,740 sold-out — the "
        "status flip is the dominant death signal here, which is why it is read as authoritative "
        "while a bare 404 is not."),
    "suwar": _P(
        _pol("suwar", 3, 168), CANDIDATE_PLUS_DIRECT,
        "wp-json post status: a 404 the API itself attributes to rest_post_invalid_id (post deleted "
        "at source), or HTTP 200 carrying a status of trash/draft/pending/private/expired. A 404 "
        "WITHOUT that code, any 401/403/408/429/5xx, an unparseable body, an id mismatch and an "
        "unrecognised status are all UNKNOWN and hold the strike without deactivating.",
        "Absence from the crawl only SELECTS candidates; scrapers/suwar/run.py::_verify_gone gives "
        "each at-grace row a DIRECT confirm before prune_unseen may deactivate it. "
        "Control-validated live 2026-09-14 against this platform's real retirement behaviour: it "
        "HARD-DELETES rather than flipping a status — id 22413 (live) answered HTTP 200 "
        "status=publish, while id 22400 (absent from the feed) and a never-existing id 999999 both "
        "answered HTTP 404 rest_post_invalid_id. The status limb is implemented too so a future "
        "draft/trash post cannot read as alive. NOTE this source ALSO states availability in its "
        "own page markup (<span class=\"status\">غير متاح</span>, 63 of 167 at onboarding); that is "
        "SOURCE-STATED retirement and deactivates through the scraper, never through this tier."),
    "aqargate": _P(
        _pol("aqargate", 3, 168), CANDIDATE_PLUS_DIRECT,
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
        p: _P(_pol(p, 3, 168), CANDIDATE_PLUS_DIRECT, sig,
              "Absence from the crawl only SELECTS candidates: scrapers/" + p + "/run.py hands "
              "prune_unseen a verify_gone oracle, so a row at grace gets a DIRECT re-fetch of its "
              "own URL and an affirmative answer before it may be deactivated. Every oracle here "
              "was EITHER control-validated against interleaved known-alive rows, OR — where the "
              "source is unreachable from our CI egress and so could not be exercised before "
              "wiring — gated by an in-run canary that fails CLOSED, which moves the same "
              "validation inside every run (see that platform's own signal string). And every "
              "UNKNOWN shape "
              "(no answer, 401/403/407/408/429, 5xx, empty body, unresolved redirect) holds the "
              "strike without deactivating. "
              "TIER CORRECTED 2026-09-21 (ops_incident #248/#578). This block used to end «TIER "
              "UNCHANGED and that is honest: the population still carries no recent affirmative "
              "verification», and that sentence was true only because of a DEFECT: prune_unseen's "
              "self-heal wrote missing_count/last_seen_at and threw the ALIVE verdict away, so no "
              "oracle on this list could ever record a verification no matter how well it ran. The "
              "tier grades the MECHANISM — the file's own definition of CANDIDATE_PLUS_DIRECT is "
              "«an absence signal selects candidates cheaply; each candidate then gets a DIRECT "
              "re-fetch before anything is deactivated», which is exactly this — and coverage is "
              "measured separately by pct_verified_in_sla. Whether a given platform's chain has "
              "actually RUN in production is the second, independent question, tracked in "
              "scrapers/oracle-never-observed.txt; a mechanism is not a coverage claim.")
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
            ("muktamel", "a redirect OFF this listing's own path — measured from the crawl's own "
                         "outcome counters, where `redirect_404` fired 84-98 times per shard across "
                         "all four 2026-09-21 runs while `dead_404` (a bare 404/410 status) fired "
                         "ZERO times; the URL is /real-estates/<id> with no slug, so the path cannot "
                         "change for a benign reason. 404/410 is kept as a second limb at no cost. "
                         "NOT pre-validated against a dead cohort — the host answers 403 CONNECT "
                         "from our cloud egress — so removals are gated by an in-run canary drawn "
                         "from ids this same run read as LIVE, failing CLOSED: no control, no "
                         "removal. `not_available_or_zero_price` is deliberately NOT a death: the "
                         "measured dead shape is the CONJUNCTION (isAvailable false AND price null) "
                         "while fetch_one()'s skip gate is a disjunction, and separating them needs "
                         "the Nuxt payload the signal is not handed"),
            ("mustqr", "a per-id PostgREST read with NO status filter — the row absent from the "
                       "source's own table, or present with a `status` other than «متاح». Identity "
                       "is guaranteed by construction (queried by primary key, and the returned "
                       "id is asserted equal), not by trusting a stored URL. NOT pre-validated "
                       "against a dead cohort: the API host answers 403 CONNECT from CI egress, so "
                       "removals are instead gated by an in-run canary drawn from rows the same "
                       "run already fetched, and it fails CLOSED — no canary, no removal"),
        )
    },
    **{
        p: _P(_pol(p, 3, 168), CRAWL_PRESENCE_ONLY,
              "none (absence from the crawl only)",
              "KNOWN GAP: no per-listing revisit exists. Small catalogue; the full feed is re-read "
              "each run, so absence is a strong (but still non-authoritative) hint. Rows here are "
              "reported as unverified, never as verified-alive.")
        for p in (
            "abralosol", "abwbna", "alhoshan", "alkhaas", "alobid", "alta", "amaall", "amlakalahsa", "aouj", "aqaratikom",
            "aqarmonthly", "arkaan", "awal", "azdad", "bahadhabab", "eaqartabuk", "erapulse",
            "fursaghyr", "jurash",
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
