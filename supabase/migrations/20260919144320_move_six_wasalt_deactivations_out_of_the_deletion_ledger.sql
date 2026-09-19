-- ============================================================================================
-- THE DEACTIVATION STANDS. THE CLAIM THAT THEY WERE DELETED DOES NOT.
-- routine-11-lifecycle, 2026-09-19. Companion to deletion_ledger_row_is_not_proof_of_a_delete.
--
-- Migration 20260919010944 deactivated six wasalt listings on genuinely DIRECT evidence — headed
-- Chromium (scrapers/wasalt/browser.py, the transport that actually reaches wasalt.sa), /ar AND
-- /en, Next.js page:"/404" with propertyDetailsV3 null on both, probed twice on 2026-09-19, with a
-- control listing returning a complete payload on the same probe. That is the strongest death
-- evidence the liveness contract recognises and NOTHING HERE REVERSES IT. The six rows stay
-- active=false. Restoring them would put a 404 back in front of users.
--
-- What that migration also did, in its step 2, was record the DEACTIVATION in
-- public.cleanup_deletion_log — "matching the shape the cleanup path already writes". That table
-- is not a shape, it is a claim: it is the per-row audit trail of PERMANENT DELETION, its
-- timestamp column is `deleted_at`, and DELETION_SAFETY.md has it written immediately before an
-- irreversible delete by the only sanctioned deleter. Nothing was deleted. All six raw rows are
-- still in wasalt_residential_listings, and purged_listings_archive holds nothing for them —
-- correctly, because there was no delete to archive.
--
-- MEASURED CONSEQUENCE, both halves already fixed or fixed here:
--   * 6 of the ledger's 1,792 rows were false. The other 1,786 really did delete their row
--     (gathern 978/0 present, aqarcity 770/0 and 38/0, wasalt 6/6 PRESENT).
--   * orphan_after_delete raised two P2s (alert_event 3911, 3912) that could NEVER go green: the
--     raw rows exist, so listing_native_location_v1 legitimately holds them and the archive
--     legitimately does not. The companion migration taught the detector the difference; these
--     two resolved at 14:42Z and the case is now reported as
--     lifecycle_deletion_log_without_delete (alert_event 4051), which THIS migration clears.
--
-- THE EVIDENCE IS NOT LOST AND WAS NEVER ONLY HERE. Step 1 of 20260919010944 wrote all six
-- verdicts to public.wasalt_liveness_pilot_detail (head 404 / get 404 / 'dead' /
-- has_property_details false), which is untouched. This migration additionally writes them to
-- ops_stale_inactivation_probe — the ledger a DEACTIVATION belongs in, and the one
-- mon_detect_unknown_treated_as_dead reads. That detector asks "was this row set active=false with
-- no GONE verdict recorded against its ad_number?" and for these six the honest answer was, until
-- now, "no evidence" — LISTING_LIFECYCLE_ENGINEER.md §4.1b exactly: the best-evidenced kills in
-- the system, indistinguishable in SQL from a crawl that timed out.
--
-- The six removed rows, verbatim, so the provenance survives this migration (all shared
-- deleted_at 2026-09-19 01:09:44.385922+00, run_id null, platform 'wasalt', reason
-- {verdict:dead, http_status:404, evidence:direct, routes_probed:[ar,en], both_routes_404:true,
--  method:manual_evidence_backed_repair, grace_window_ran:false, probe_tool:"scrapers/wasalt/
--  browser.py headed Chromium, probed twice 2026-09-19", why_sweep_could_not:"wasalt liveness is
--  unscheduled AND runs on the curl_cffi chrome124 + Saudi-proxy transport null-routed by
--  wasalt.sa since 2026-08-17 (issue #1019), so every read is UNKNOWN and no row can reach grace"}):
--   id 1792  listing 10882468  WST5882960  missing_count_before 2
--   id 1791  listing 11386318  WST5905546  missing_count_before 0
--   id 1790  listing 11677784  WST5906315  missing_count_before 0
--   id 1789  listing 11885924  WST5908744  missing_count_before 0
--   id 1788  listing 11890056  WST5907578  missing_count_before 0
--   id 1787  listing 11891280  WST5906562  missing_count_before 0
--
-- NOT CHANGED, DELIBERATELY: missing_count, which 20260919010944 raised to the grace value of 3.
-- It is the second half of the deletion engine's candidate predicate, so these rows will reach
-- DELETION_ELIGIBLE ~30 days after their last_seen_at (2026-10-07 .. 2026-10-17) on a strike count
-- that was written by hand rather than accumulated — the row's own reason says grace_window_ran
-- false. Lowering it would make the row look LESS struck than its evidence supports, and raising
-- the question of whether eligibility may be keyed on a hand-written strike count at all is
-- ops_incident #24, reserved to the owner. Recorded, not acted on. Two independent guards stand in
-- front of it meanwhile: the delete-time DIRECT re-probe (require_source_recheck=true) runs on the
-- same blocked transport and returns UNKNOWN, which SKIPS rather than deletes, and wasalt's
-- cleanup has aborted on the anomaly guard every run since 2026-08-23 (ops_incident #195).
-- ============================================================================================

-- ── 1. The evidence, in the ledger a DEACTIVATION belongs in. Written BEFORE the removal below. ──
insert into public.ops_stale_inactivation_probe
  (source_table, listing_id, listing_url, probed_at, http_status, body_bytes, page_title, verdict, oracle, note, ad_number)
select
  d.source_table,
  d.listing_id,
  d.listing_url,
  d.deleted_at,
  404,
  0,
  null,
  'GONE',
  'wasalt.manual_direct_probe.both_routes_404',
  'Relocated from cleanup_deletion_log (row id ' || d.id || ') by routine-11-lifecycle 2026-09-19. '
    || 'The DEACTIVATION performed by migration 20260919010944 is evidenced and stands; the row was '
    || 'never DELETED, so the claim recorded in the deletion ledger was false and has been removed. '
    || 'Original reason payload: ' || d.reason::text,
  d.ad_number
from public.cleanup_deletion_log d
where d.source_table = 'wasalt_residential_listings'
  and d.reason->>'method' = 'manual_evidence_backed_repair'
  -- Fail-safe: only relocate a claim whose listing is demonstrably STILL PRESENT. A row that has
  -- genuinely been deleted since keeps its ledger entry, because for that row the entry is true.
  and exists (select 1 from public.wasalt_residential_listings w where w.id = d.listing_id)
  and not exists (select 1 from public.ops_stale_inactivation_probe p
                   where p.source_table = d.source_table and p.listing_id = d.listing_id
                     and p.oracle = 'wasalt.manual_direct_probe.both_routes_404');

-- ── 2. Remove the false claims — and ONLY the ones whose evidence step 1 just preserved. ─────────
delete from public.cleanup_deletion_log d
where d.source_table = 'wasalt_residential_listings'
  and d.reason->>'method' = 'manual_evidence_backed_repair'
  and exists (select 1 from public.wasalt_residential_listings w where w.id = d.listing_id)
  and exists (select 1 from public.ops_stale_inactivation_probe p
               where p.source_table = d.source_table and p.listing_id = d.listing_id
                 and p.oracle = 'wasalt.manual_direct_probe.both_routes_404');
