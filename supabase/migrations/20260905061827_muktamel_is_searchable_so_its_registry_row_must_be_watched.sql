-- The second half of the 2026-09-04 muktamel ruling.
--
-- 20260904151723_muktamel_liveness_policy_paused_is_not_unsearchable settled that "paused" is a
-- CADENCE fact and does not make a platform unsearchable, and corrected ops_liveness_registry.
-- platform_registry.status was left at 'dormant' carrying a note that said "0 rows ever active" —
-- a claim production had already contradicted.
--
-- Measured immediately before this write (2026-09-05 06:17Z), and captured in the alert this
-- migration clears (registry_orphan_unmonitored:muktamel, P1):
--   · 523 production_ready rows in search_listings_ar (483 residential + 41 commercial active)
--   · 28 scrape_runs in the last 7 days, most recent 2026-09-05 06:00:30Z
--   · ABSENT from mon_detect_silent_scraper_death's cohort (37 platforms, muktamel not among them)
--
-- BLAST RADIUS, enumerated rather than assumed: every reader of platform_registry in this database
-- is a monitoring function — mon_auto_register_platform, mon_detect_field_integrity,
-- mon_detect_legacy_alert_tables, mon_detect_manufactured_rent_period, mon_detect_registry_orphans,
-- mon_detect_silent_scraper_death, mon_detect_stale_active_fraction,
-- mon_detect_stale_no_remediation_path, mon_detect_unattributable_platform_runs,
-- mon_detect_zero_new_stall, mon_selftest_reconcile_dangling_scrape_runs. No view, no materialized
-- view, no dispatcher, no deletion job and no product path reads it. This change therefore only
-- WIDENS monitoring onto a platform that was already running and already user-visible; it starts
-- nothing, deletes nothing, and touches no listing data.
--
-- No cadence override is added: the default (expected_hours 24 → a max(48,24)=48h death bar) is the
-- honest bar for a platform observed running ~4x/day, and inventing a tighter one is not a fact
-- this run established.
UPDATE public.platform_registry
   SET status = 'active',
       notes  = 'ACTIVE and production-searchable. Corrected 2026-09-05 (senior production run): the '
             || 'row read status=dormant with a note claiming "0 rows ever active", while production '
             || 'served 523 production_ready rows in search_listings_ar and had run the scraper 28 '
             || 'times in 7 days (latest 2026-09-05 06:00:30Z). Because every per-platform detector '
             || 'filters on status=''active'' AND kind=''source'', muktamel was excluded from '
             || 'mon_detect_silent_scraper_death entirely — a dead capture would have stranded 523 '
             || 'searchable listings with no alert. This completes the ruling of '
             || '20260904151723_muktamel_liveness_policy_paused_is_not_unsearchable, which corrected '
             || 'ops_liveness_registry but left this row stale. Prior value: status=dormant, notes='
             || '"paused 2026-07-14 via cron.alter_job(14, active=>false) — pause-only, NOT '
             || 'deprecated (20260714_pause_muktamel_cron.sql); 0 rows ever active; status corrected '
             || 'retired→dormant by Batch 1 to match the pause".'
 WHERE platform = 'muktamel'
   AND status <> 'active';
