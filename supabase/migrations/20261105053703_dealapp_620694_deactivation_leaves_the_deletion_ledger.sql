-- A DEACTIVATION IS NOT A DELETION (verify-deactivation-is-not-written-to-deletion-ledger.ts). 20261105042913 hid dealapp
-- 24071630 (DA620694) on direct evidence — its page redirects to the dealapp home page, read twice, live control — and
-- wrote that into cleanup_deletion_log, the ledger of HARD deletes. The row was never deleted, so that claim is false.
-- Same relocation as 20261104033440: the deactivation stands, its evidence moves to ops_stale_inactivation_probe
-- (ops_adjudicated_retraction already keeps it hidden), and the false deletion claim is removed. Exactly one row.
do $mig$
declare moved int; removed int;
begin
  insert into public.ops_stale_inactivation_probe
    (source_table, listing_id, listing_url, probed_at, http_status, body_bytes, page_title, verdict, oracle, note, ad_number)
  select d.source_table, d.listing_id, d.listing_url, d.deleted_at, 200, 0, null, 'GONE',
         'dealapp.manual_evidence_backed_repair.redirected_away',
         'Relocated from cleanup_deletion_log (row id ' || d.id || ') on 2026-11-05. The DEACTIVATION is evidenced and '
           || 'stands; the row was never DELETED. Original reason payload: ' || d.reason::text,
         d.ad_number
    from public.cleanup_deletion_log d
   where d.source_table = 'dealapp_residential_listings' and d.listing_id = 24071630
     and d.reason->>'method' = 'manual_evidence_backed_repair' and d.run_id is null
     and exists (select 1 from public.dealapp_residential_listings x where x.id = d.listing_id and not x.active)
     and not exists (select 1 from public.ops_stale_inactivation_probe p
                      where p.source_table = d.source_table and p.listing_id = d.listing_id
                        and p.oracle = 'dealapp.manual_evidence_backed_repair.redirected_away');
  get diagnostics moved = row_count;
  delete from public.cleanup_deletion_log d
   where d.source_table = 'dealapp_residential_listings' and d.listing_id = 24071630
     and d.reason->>'method' = 'manual_evidence_backed_repair' and d.run_id is null
     and exists (select 1 from public.ops_stale_inactivation_probe p
                  where p.source_table = d.source_table and p.listing_id = d.listing_id
                    and p.oracle = 'dealapp.manual_evidence_backed_repair.redirected_away');
  get diagnostics removed = row_count;
  if moved <> 1 or removed <> 1 then
    raise exception 'expected to relocate exactly 1 false deletion claim, moved=% removed=%', moved, removed;
  end if;
end
$mig$;