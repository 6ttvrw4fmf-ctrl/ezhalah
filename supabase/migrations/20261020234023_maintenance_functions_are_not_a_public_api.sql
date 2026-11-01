-- SECURITY PHASE 1.1 (owner-approved plan, 2026-10-20): maintenance jobs and the raw-predicate function are
-- not a public API.
--
-- The 2026-10-18 lockdown (*_secdef_functions_are_not_a_public_api.sql) covers SECURITY DEFINER functions. These
-- fifteen are SECURITY INVOKER, so it never touched them, and every one was EXECUTE-able with the publishable key:
--   * ops_af_option_db_truth(p_row_pred text) splices the caller's raw text into dynamic SQL — anyone could run
--     their own read query (bounded only by the 20 s statement_timeout: a free DoS lever).
--   * the rest are batch repairs / syncs / rebuilds (sync_listing_photos, rebuild_af_filter_rpcs, …) and their
--     sync_all_* / ops_*_run wrappers: expensive jobs any visitor could start.
-- Nothing in src/, api/, middleware.ts, scrapers/ or any workflow calls them with the anon/authenticated key
-- (checked 2026-10-20). Their real callers are SECURITY DEFINER detectors and pg_cron (both run as the owner,
-- unaffected) and service-role tooling (kept below).
--
-- Rollback: grant execute on function <sig> to anon, authenticated;
do $mig$
declare
  sig text;
  sigs text[] := array[
    'public.ops_af_option_db_truth(text,text,text,text)',
    'public.ops_af_option_truth_sweep(text,text,text,integer,boolean,integer,integer)',
    'public.ops_af_cert_cohort(text,text,text,text)',
    'public.ops_nf_cert_cell(text,text,jsonb)',
    'public.ops_nf_cert_run(text,integer)',
    'public.rebuild_af_filter_rpcs()',
    'public.refresh_district_recovery_table(text)',
    'public.refresh_district_recovery()',
    'public.repair_blanket_false_batch(integer)',
    'public.repair_manufactured_negatives(text,boolean)',
    'public.sync_listing_photos(text)',
    'public.sync_all_listing_photos()',
    'public.sync_listing_rich_attrs(text)',
    'public.sync_all_rich_attrs(text[])',
    'public.backfill_location_display_labels(integer)'
  ];
begin
  foreach sig in array sigs loop
    execute format('revoke execute on function %s from public, anon, authenticated', sig);
    execute format('grant execute on function %s to service_role', sig);
  end loop;
end
$mig$;
