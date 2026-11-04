-- Move wasalt DEACTIVATIONS out of the DELETION ledger (lifecycle_deletion_log_without_delete).
--
-- cleanup_deletion_log is written before a delete, so a row there claims a listing was permanently
-- destroyed. 133 wasalt rows claim that and the listings are still present (all inactive):
--   * 131 'manual_bulk_verified' rows written 2026-09-19 (direct 404 from a non-proxy IP);
--   * 2 'manual_evidence_backed_repair' rows written by 20261104013008 (both routes 404, read twice).
-- The deactivations are evidenced and STAND. Only the false "deleted" claim moves: its evidence is
-- preserved verbatim in ops_stale_inactivation_probe (the ledger a deactivation belongs in), exactly
-- as 20260919144320 did for six earlier rows. Fail-safe: a claim whose listing has genuinely been
-- deleted since keeps its ledger entry (for that row it is true), and only rows still INACTIVE move.
do $mig$
declare moved int; removed int;
begin
  insert into public.ops_stale_inactivation_probe
    (source_table, listing_id, listing_url, probed_at, http_status, body_bytes, page_title, verdict, oracle, note, ad_number)
  select d.source_table, d.listing_id, d.listing_url, d.deleted_at, 404, 0, null, 'GONE',
         'wasalt.' || (d.reason->>'method') || '.direct_404',
         'Relocated from cleanup_deletion_log (row id ' || d.id || ') on 2026-11-04. The DEACTIVATION is '
           || 'evidenced and stands; the row was never DELETED, so the deletion-ledger claim was false and '
           || 'has been removed. Original reason payload: ' || d.reason::text,
         d.ad_number
    from public.cleanup_deletion_log d
   where d.source_table in ('wasalt_residential_listings', 'wasalt_commercial_listings')
     and d.reason->>'method' in ('manual_bulk_verified', 'manual_evidence_backed_repair')
     and d.run_id is null
     and ((d.source_table = 'wasalt_residential_listings'
           and exists (select 1 from public.wasalt_residential_listings w where w.id = d.listing_id and not w.active))
       or (d.source_table = 'wasalt_commercial_listings'
           and exists (select 1 from public.wasalt_commercial_listings w where w.id = d.listing_id and not w.active)))
     and not exists (select 1 from public.ops_stale_inactivation_probe p
                      where p.source_table = d.source_table and p.listing_id = d.listing_id
                        and p.oracle = 'wasalt.' || (d.reason->>'method') || '.direct_404');
  get diagnostics moved = row_count;

  delete from public.cleanup_deletion_log d
   where d.source_table in ('wasalt_residential_listings', 'wasalt_commercial_listings')
     and d.reason->>'method' in ('manual_bulk_verified', 'manual_evidence_backed_repair')
     and d.run_id is null
     and ((d.source_table = 'wasalt_residential_listings'
           and exists (select 1 from public.wasalt_residential_listings w where w.id = d.listing_id and not w.active))
       or (d.source_table = 'wasalt_commercial_listings'
           and exists (select 1 from public.wasalt_commercial_listings w where w.id = d.listing_id and not w.active)))
     and exists (select 1 from public.ops_stale_inactivation_probe p
                  where p.source_table = d.source_table and p.listing_id = d.listing_id
                    and p.oracle = 'wasalt.' || (d.reason->>'method') || '.direct_404');
  get diagnostics removed = row_count;

  if moved <> 133 or removed <> 133 then
    raise exception 'expected to relocate exactly 133 false deletion claims, moved=% removed=%', moved, removed;
  end if;
end
$mig$;
