-- 🔧 2026-11-09 — alert data_live_check_failed «workflow_failed:audit-invariants.yml» (P1, 13:17 UTC): the
-- unverified-inactivation invariant found ONE listing «deactivated in the last 24 h with no ledger row»:
-- dealapp_residential_listings 646452 (ad DA503562, last seen at source 2026-07-02, missing_count 0).
--
-- ROOT CAUSE (proven from the row and the migration log): nothing hid it today. It has been inactive since
-- 2026-07-10 14:27:37.481433 (ops_legacy_pin_backup_20260717 holds that stamp; 187 siblings of the same July
-- prune carry the identical value). The adjudication-guard migration «adjudicated_rows_stay_hidden_through_crawl_upsert» (production version ending …124411,
-- applied 12:44:11) ran a SELF-TEST step 4 that picked ONE REAL non-adjudicated inactive dealapp row with
-- `limit 1`, flipped it active=true and back to active=false «-- restore». The restore was not a restore:
-- trg_set_deactivated_at NULLs deactivated_at on the flip to true and stamps now() on the flip back, so the row
-- now reads «deactivated 2026-11-09 12:44:11» — a fresh, unledgered deactivation to every monitor, and its real
-- July stamp was lost. (The row never reached the served index: the sync did not run inside that transaction.)
--
-- REPAIR: put the evidenced July stamp back. Nothing else about the row changes (active stays false — it has
-- been gone from the source for four months; this is NOT a new deactivation, so no adjudication row is written).
-- Guarded by the row's own evidence, in the same statement.
update public.dealapp_residential_listings d
   set deactivated_at = b.deactivated_at
  from public.ops_legacy_pin_backup_20260717 b
 where d.id = 646452 and not d.active
   and b.source_table = 'dealapp_residential_listings' and b.listing_id = d.id
   and d.deactivated_at >= '2026-11-09 12:44:00+00' and d.deactivated_at < '2026-11-09 12:45:00+00'
   and b.deactivated_at = '2026-07-10 14:27:37.481433+00';

-- Guarantee: the class this repairs — a listing stamped «deactivated» with no page reading behind it — is watched by
-- mon_detect_unverified_inactivation() (daily; the same view audit-invariants.yml reads), enrolled here as the rule requires.
insert into public.ops_repair_guarantee_registry (repair_version, repair_name, invariant, detector, registered_by) values
  ('20261109142000', 'dealapp_646452_deactivated_at_restored_after_self_test_restamp',
   'No listing carries a deactivated_at inside the last 24 hours without a GONE/SUPERSEDED/kill ledger row for it (ops_stale_inactivation_probe, *_liveness_detail) or an adjudication; a migration self-test that flips a real row and back re-stamps it and is caught here.',
   'mon_detect_unverified_inactivation', 'qa 2026-11-09 (alert data_live_check_failed audit-invariants.yml)')
on conflict do nothing;
do $$
declare roster text := pg_get_functiondef('public.mon_run_all_detectors()'::regprocedure);
begin
  if to_regproc('public.mon_detect_unverified_inactivation') is null then raise exception 'enrolment names a detector that does not exist'; end if;
  if position('mon_detect_unverified_inactivation' in roster) = 0
     and not exists (select 1 from cron.job j where j.active and position('mon_detect_unverified_inactivation' in j.command) > 0) then
    raise exception 'enrolment names a detector nothing runs: mon_detect_unverified_inactivation';
  end if;
end $$;

-- Proof (reads only): exactly one row carries the July stamp again, and the 24-hour invariant no longer counts
-- it. Writes no listing or ops row beyond the one repaired above.
do $$
declare v_stamp timestamptz; v_active boolean; v_n int;
begin
  select deactivated_at, active into v_stamp, v_active from public.dealapp_residential_listings where id = 646452;
  if v_active then raise exception 'PROOF: 646452 is active — this repair must not activate anything'; end if;
  if v_stamp is distinct from '2026-07-10 14:27:37.481433+00'::timestamptz then
    raise exception 'PROOF: 646452 deactivated_at is %, expected the July stamp', v_stamp;
  end if;
  select unverified into v_n from public.mon_unverified_inactivation_counts(interval '24 hours');
  if v_n <> 0 then raise exception 'PROOF: unverified inactivations in 24 h still %, expected 0', v_n; end if;
  raise notice 'PROOF OK: 646452 inactive since %, unverified-inactivation count 0', v_stamp;
end $$;
