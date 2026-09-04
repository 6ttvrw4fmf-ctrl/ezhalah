// Which of the seven daily engineer routines owns an alert, by alert KIND.
//
// WHY THIS FILE EXISTS. Delivery was fixed on 2026-08-26 (alert-dispatch.yml files one GitHub
// issue per dedup_key). Delivery is not the same as OWNERSHIP: measured 2026-08-28, 55 open
// `[alert]` issues carried `ezhalah-alert` + a severity label and nothing else -- no owner, and
// 18 open P1s with acknowledged_at NULL, the oldest since 2026-08-11. An issue nobody owns is
// the same failure as an alert nobody receives, one step later.
//
// Sentry got routed to the seven routines on 2026-08-28 (docs/ops/SENTRY_ROUTING.md, PR #1181).
// alert_event did not. This is that same routing, for the other queue, and it deliberately reuses
// SENTRY_ROUTING's two load-bearing conventions rather than inventing a second scheme:
//   * routine #2 (🎖️ Senior Production) is the STANDING TRIAGE ROUTER for anything ambiguous;
//   * one owner per item, so seven engineers do not work the same incident.
//
// THIS FILE IS EXECUTED BY THE WORKFLOW, NOT MIRRORED BY IT. alert-dispatch.yml checks the repo
// out and calls routineForKind() directly. That is the whole reason there is no drift barrier
// here comparable to scripts/lib/alertDelivery.ts: alertDelivery states a contract that three
// components each re-implement, so it needs a three-way agreement check. A mapping with exactly
// one implementation cannot disagree with itself. Do not "mirror" this table into the workflow or
// into SQL -- that would create the drift this shape avoids.
//
// ROUTING IS TOTAL BY CONSTRUCTION. routineForKind() returns a routine for EVERY string, because
// the alternative -- a kind with no match -- is an alert that gets filed with no owner, which is
// the exact hole this closes. There are 103 distinct kinds in alert_event as of 2026-08-28 and
// new detectors add more every week, so an exhaustive kind list would rot into that hole within
// days. Patterns + a mandatory fallback is what keeps it total.

/** The seven daily routines, keyed by their number in docs/ops/ENGINEER_ROUTINES.md. */
export const ROUTINES = {
  1: { label: 'routine-1-scraping', name: '⚡ Junior Scraping' },
  2: { label: 'routine-2-production', name: '🎖️ Senior Production' },
  3: { label: 'routine-3-data-integrity', name: '🛡️ Data Integrity (Normal Filter)' },
  4: { label: 'routine-4-search-qa', name: '🧪 Search & Matching QA' },
  5: { label: 'routine-5-af-trending', name: '🎯 Advanced Filter + Trending' },
  6: { label: 'routine-6-journey', name: '👣 Journey & Persistence' },
  7: { label: 'routine-7-seam', name: '🧵 Systems Seam' },
} as const;

export type RoutineNumber = keyof typeof ROUTINES;

/** Routine that owns anything the patterns below do not claim. See §2 row 2 of SENTRY_ROUTING. */
export const FALLBACK_ROUTINE: RoutineNumber = 2;

/**
 * Ordered rules; FIRST MATCH WINS. Order is load-bearing, not cosmetic:
 *
 *  - #7 runs first because seam kinds carry words the broad data-integrity patterns also match.
 *    `stale_no_remediation_path` is a seam failure (a detector with nowhere to hand its finding),
 *    but `^stale_` in #3 would otherwise swallow it.
 *  - #3 runs LAST before the fallback because its patterns are the broadest (`price`, `district`,
 *    `^stale_`, `^legacy_`); anything more specific must get its claim in first.
 *
 * Every pattern below is anchored or specific enough that widening one is a visible edit. If you
 * add a detector, add its kind here in the same change -- an unrouted kind is not an error, it
 * lands on #2, but #2 inheriting the whole backlog by default is how a triage router stops being
 * read.
 */
export const ROUTING_RULES: ReadonlyArray<{ routine: RoutineNumber; test: RegExp }> = [
  // 7 🧵 Systems Seam — cron→detector→alert, migration→mirror→prod, RLS, monitoring's own plumbing.
  { routine: 7, test: /^(alert_delivery|alert_acknowledgment|alert_dispatch)/ },
  { routine: 7, test: /^(cron_|migration_drift|sql_mirror_drift|deploy_lock_misuse)/ },
  { routine: 7, test: /^(detector_|orphaned_detector|unresolvable_|monitoring_watchdog)/ },
  { routine: 7, test: /^(registry_orphans|repair_guarantee|loc_rel_|rls_)/ },
  { routine: 7, test: /^(stale_no_remediation_path|frontend_runtime_gate_missing)$/ },
  // ai_cost_health — the DeepSeek spend/cache/model-tier monitors (2026-08-29). Seam work: it is
  // the integration with an external paid provider, and every one of its findings is answered in
  // the same places this routine already owns (edge function, deploy path, detector plumbing).
  // Explicitly routed rather than left to the #2 fallback, so a cost alert arrives with an owner.
  { routine: 7, test: /^ai_cost_health$/ },
  { routine: 7, test: /^search_index_diverges_from_sync_source$/ },
  // The `*_check_failed` family (2026-09-04) — a SCHEDULED WORKFLOW ITSELF went red. Raised by
  // scripts/ops/raise-workflow-alert.mjs, one open alert per workflow file, self-healing on the
  // next green run. Before it, 17 scheduled workflows could fail and alert nobody (issue #1349:
  // ui-parity red five nights, zero alerts). Each kind is routed to the routine that owns the
  // SURFACE the dead check was watching, per this file's rule that ownership follows the surface —
  // so the engineer who would have received the finding also receives the fact that the finder
  // stopped working. `seam_check_failed` is the deploy/certification plumbing this routine owns.
  { routine: 7, test: /^seam_check_failed$/ },
  // p0_delivery_sla — the 5-minute P0 delivery SLO and its dedicated fast lane (2026-08-30). This
  // routine owns that mechanism end to end, yet the kind matched no rule and fell through to the
  // #2 fallback: the alert saying "a P0 did not reach a human in time" was itself being filed to
  // the triage router rather than to the routine that can fix the delivery path. That is precisely
  // the "#2 inheriting the whole backlog by default" failure this file's own header warns about.
  // Deliberately a prefix, so limb 3's `p0_delivery_sla_late` and any future p0_delivery_* key
  // arrive with the same owner instead of silently re-opening this hole.
  { routine: 7, test: /^p0_delivery/ },

  // 5 🎯 Advanced Filter + Trending — before #3/#4, whose patterns overlap AF field names.
  // `af_live_check_failed` (the workflow-failure family above) needs no rule of its own: `^af_`
  // already claims it, and adding a redundant pattern would be a second statement of the same fact.
  // scripts/verify-scheduled-checks-alert-on-failure.ts EXECUTES routineForKind() on that kind, so
  // narrowing `^af_` later cannot silently drop it onto the #2 fallback.
  { routine: 5, test: /^(af_|monthly_af|trending_)/ },

  // 4 🧪 Search & Matching QA — the served search surface, matching, diversity, card handoff.
  { routine: 4, test: /^(search_gate_leak|searchability_collapse|filter_barrier_leak)$/ },
  { routine: 4, test: /^(filter_default_suppresses_inventory|unsortable_served_listing)$/ },
  { routine: 4, test: /^(unlocated_search_contract|ranking_|diversity|card_)/ },
  { routine: 4, test: /^search_live_check_failed$/ },

  // 1 ⚡ Junior Scraping — the capture layer: runs, sources, proxies, per-platform fetch health.
  { routine: 1, test: /^(silent_scraper_death|silent_partial_success|zero_new_stall)$/ },
  { routine: 1, test: /^(run_|dangling_scrape_run|proxy_|scraper_|enumeration_incomplete)/ },
  { routine: 1, test: /^(legacy_scraper_freshness|dealapp_shard|aqar_deep_fill_health)/ },
  { routine: 1, test: /^(wasalt_enrich|summary_only_capture|unattributable_platform_runs)/ },
  { routine: 1, test: /^(liveness_cap_degraded|source_limited_contradicted|unprobed_source_waiver)/ },
  { routine: 1, test: /^gathern_liveness/ },
  { routine: 1, test: /^ingestion_check_failed$/ },

  // 6 👣 Journey & Persistence — chat/session/auth state, never matching itself.
  { routine: 6, test: /^(transcript_|filter_state_lost|chat_|session_|auth|sidebar)/ },
  { routine: 6, test: /^journey_live_check_failed$/ },

  // 3 🛡️ Data Integrity — source-truth on listing fields. Broadest; must stay last.
  { routine: 3, test: /price|district|amenity|^rent_period|^manufactured_rent_period/ },
  { routine: 3, test: /^(field_integrity|city_|region_label|english_|type_|v2_discards)/ },
  { routine: 3, test: /^(deletion_spike|mass_inactivation|unverified_inactivation|inactivation)/ },
  { routine: 3, test: /^(stale_|quarantine_growth|prune_|cleanup_evidence_gap)/ },
  { routine: 3, test: /^(served_after_source_gone|deleted_but_source_live|unledgered_hard_delete)/ },
  { routine: 3, test: /^(legacy_|duplex|fabricated_|url_collision|rows_collapse)/ },
  { routine: 3, test: /^(wasalt_annualisation_fabricated|gathern_rating_source_truth)$/ },
  { routine: 3, test: /^(phasea_offregion_pick|discarded_location_resolution|aqar)/ },
  { routine: 3, test: /^(commercial_|index_label_unrepairable|refresh_coverage|orphaned_search_row)/ },
  { routine: 3, test: /^search_index_freshness$/ },
  { routine: 3, test: /^data_live_check_failed$/ },
];

/** Every routine label, for `gh label create`. */
export const ALERT_ROUTINE_LABELS: readonly string[] = Object.values(ROUTINES).map((r) => r.label);

/**
 * The owning routine for an alert kind. TOTAL: always returns a routine, never null/undefined.
 * An unmatched kind routes to FALLBACK_ROUTINE, which is a real owner with a triage mandate --
 * not a bin.
 */
export function routineForKind(kind: string): RoutineNumber {
  for (const rule of ROUTING_RULES) if (rule.test.test(kind)) return rule.routine;
  return FALLBACK_ROUTINE;
}

/** The GitHub label for an alert kind. Also total, for the same reason. */
export function labelForKind(kind: string): string {
  return ROUTINES[routineForKind(kind)].label;
}
