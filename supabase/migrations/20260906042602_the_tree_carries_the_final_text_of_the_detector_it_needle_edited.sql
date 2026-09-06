-- A NEEDLE-EDITED FUNCTION MUST STILL HAVE ITS FINAL TEXT SOMEWHERE IN THE TREE.
--
-- 20260906041121 created mon_detect_orphan_after_delete(). 20260906041751 rewrote it in place with a
-- needle-edit off the live body (moving the severity out of mon_raise's first argument, so the kind it
-- raises is readable without evaluating a CASE). Both are correct and both are mirrored — but between
-- them, NO file in supabase/migrations contains the function's final source. The first file holds a
-- shape that no longer exists and the second holds only the diff that produced it.
--
-- That matters twice over:
--   * the migration mirror exists so the tree can answer "what is this object", and after a
--     needle-edit it could not;
--   * scripts/verify-declared-alert-kind-has-an-emitter.ts reads the migration tree to check that a
--     declared kind has an emitter, and it correctly reported `orphan_after_delete` as having none —
--     because the only text it could find was the pre-rewrite shape the previous migration deliberately
--     removed.
--
-- Needle-editing a live body stays the right technique for a shared object several sessions extend
-- concurrently (mon_run_all_detectors). For a single-owner function it is not: this restates the whole
-- definition, byte-for-byte what production runs as of 2026-09-06, and is a no-op against it.
create or replace function public.mon_detect_orphan_after_delete()
returns integer
language plpgsql
security definer
set search_path = public
as $fn$
declare
  n    int := 0;
  live text[] := '{}';
  r    record;
  k    text;
  sev  text;
begin
  for r in select * from public.ops_lifecycle_orphan_after_delete() loop
    k := 'orphan_after_delete:' || r.surface || ':' || r.source_table;
    live := live || k;
    -- A user can reach the first two. The rest are internal consistency, which is why they are not
    -- dressed up as the same emergency; neither is dismissed.
    sev := case when r.surface in ('search_listings_ar', 'active_listing_ids_v2')
                then 'P1' else 'P2' end;
    n := n + public.mon_raise(
      sev,
      'orphan_after_delete',
      regexp_replace(r.source_table, '_(residential|commercial)_listings$', ''),
      k,
      jsonb_build_object(
        'surface', r.surface,
        'source_table', r.source_table,
        'orphan_rows', r.orphan_rows,
        'oldest_deleted_at', r.oldest_deleted_at,
        'sample_listing_ids', to_jsonb(r.sample_ids),
        'why', case r.surface
          when 'purged_listings_archive' then
            'These listings were permanently deleted and cleanup_deletion_log recorded it, but no '
            || 'purged_listings_archive row holds what was deleted. The audit trail DELETION_SAFETY.md '
            || 'requires is written before the delete, so a missing archive row means the row is gone '
            || 'and unrecoverable with no copy of what it was.'
          else
            'These listings were permanently deleted from their source table, yet ' || r.surface
            || ' still holds a row for them — and it has already had a full refresh cycle since the '
            || 'delete, so this is not propagation latency. A delete that lands in one place and not '
            || 'another leaves an index pointing at nothing.' end,
        'known_cause_2026_09_06', 'listing_native_location_v1''s "legacy" arm reads '
            || 'listings_arabic_locations, which is not cleaned when a raw row is deleted: 708 of 978 '
            || 'deleted gathern rows were still in it. Check that table (and listing_location_canonical) '
            || 'before looking anywhere else.',
        'boundary', 'mon_detect_orphaned_search_row() watches the same shape from the INDEX side and '
            || 'covers search_listings_ar only. This detector walks from the delete LEDGER and covers '
            || 'five surfaces plus the archive.',
        'action', 'Propagate the delete the rest of the way — the repair order is raw -> matview -> '
            || 'sync -> verify. Do NOT respond by deleting more listings, and do NOT delete an orphan '
            || 'row whose raw listing is actually still present: that is a different (and opposite) '
            || 'bug.'));
  end loop;

  perform public.mon_resolve_stale_keys('orphan_after_delete', live);
  return n;
end;
$fn$;

-- Still emittable, still rostered, still the same kind.
do $verify$
begin
  if 'orphan_after_delete' = any (public.mon_declared_kinds_without_emitter()) then
    raise exception 'orphan_after_delete lost its emitter in the restatement';
  end if;
  if position('mon_detect_orphan_after_delete'
              in pg_get_functiondef('public.mon_run_all_detectors'::regproc)) = 0 then
    raise exception 'orphan_after_delete detector fell out of the sweep roster';
  end if;
end;
$verify$;
