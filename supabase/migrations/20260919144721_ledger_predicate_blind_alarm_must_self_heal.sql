-- The blind-detector alarm had no way back down (routine-11-lifecycle, 2026-09-19).
--
-- mon_detect_deletion_log_without_delete() raises lifecycle_ledger_predicate_blind when its
-- self-test stops discriminating, but on the HEALTHY path it resolved nothing — so once raised the
-- alert would stay open forever, even after the predicate was repaired.
--
-- That is not cosmetic, and AGENTS.md says why in its own words: mon_raise() returns 0 when its
-- dedup key is already open, so an all-zero sweep can sit on top of open alerts — nine dark
-- detectors once read as a clean bill of health. A permanently-open alert is exactly how a real
-- signal stops being trusted. mon_detect_lifecycle_duplicate_stale_copy() already had this right
-- (20260906150549 line 166); this copies its shape.
--
-- Body is otherwise byte-identical to 20260919144142's definition.
create or replace function public.mon_detect_deletion_log_without_delete()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  n            int := 0;
  live         text[] := '{}';
  r            record;
  k            text;
  reports_hit  boolean;
  stays_silent boolean;
begin
  -- ── SELF-TEST, BEFORE ANYTHING IS REPORTED ───────────────────────────────────────────────────
  -- Both directions. A predicate that always returns rows would suppress every genuine orphan;
  -- one that never returns rows restores the bug this migration fixes AND makes this detector
  -- dark. Neither failure is visible by reading the committed SQL — 2026-09-06 proved that, when
  -- a `create or replace` expected to roll back did not and a mutant ran live in production.
  select exists(select 1 from public.ops_lifecycle_ledger_rows_not_deleted(
           '[{"tbl":"__selftest_not_a_real_table","listing_id":-1}]'::jsonb)) into reports_hit;
  select not exists(select 1 from public.ops_lifecycle_ledger_rows_not_deleted('[]'::jsonb))
    into stays_silent;

  if not (reports_hit and stays_silent) then
    return public.mon_raise('P1', 'lifecycle_ledger_predicate_blind', 'all',
      'lifecycle_ledger_predicate_blind',
      jsonb_build_object(
        'why', 'ops_lifecycle_ledger_rows_not_deleted() no longer discriminates. While this is true '
            || 'the orphan_after_delete detector is either suppressing real orphans (predicate always '
            || 'reports) or has silently reverted to treating every cleanup_deletion_log row as a '
            || 'completed delete (predicate never reports). Do not trust either alert kind until this '
            || 'is green.',
        'reports_an_injected_row', reports_hit,
        'silent_on_an_empty_ledger', stays_silent,
        'action', 'Read pg_get_functiondef(''public.ops_lifecycle_ledger_rows_not_deleted(jsonb)'') '
            || 'against supabase/migrations — a create-or-replace that was expected to roll back may '
            || 'not have.'));
  end if;

  -- The self-test passed, so a previously-raised blind alarm is no longer true. An alert nothing
  -- can lower is an alert people learn to scroll past.
  perform public.mon_resolve_key('lifecycle_ledger_predicate_blind', 'lifecycle_ledger_predicate_blind');

  for r in
    select nd.source_table as st, count(*)::bigint as rows_claimed,
           min(d.deleted_at) as oldest_claim,
           (array_agg(nd.listing_id order by nd.listing_id))[1:20] as sample_ids
      from public.ops_lifecycle_ledger_rows_not_deleted() nd
      join public.cleanup_deletion_log d
        on d.source_table = nd.source_table and d.listing_id = nd.listing_id
     group by nd.source_table
  loop
    k := 'lifecycle_deletion_log_without_delete:' || r.st;
    live := live || k;
    n := n + public.mon_raise(
      'P2',
      'lifecycle_deletion_log_without_delete',
      regexp_replace(r.st, '_(residential|commercial)_listings$', ''),
      k,
      jsonb_build_object(
        'source_table', r.st,
        'rows_claimed_deleted_but_present', r.rows_claimed,
        'oldest_claim', r.oldest_claim,
        'sample_listing_ids', to_jsonb(r.sample_ids),
        'why', 'cleanup_deletion_log says these listings were permanently deleted, and their raw '
            || 'rows are still in the source table. DELETION_SAFETY.md has the ledger row written '
            || 'BEFORE the delete, so a row here proves only that a delete was INTENDED. This is the '
            || 'audit trail of an irreversible action carrying entries that are not true.',
        'this_is_not_an_orphan', 'The opposite. An orphan is an index row pointing at a listing that '
            || 'is gone. These listings are PRESENT, so their location and index rows are correct and '
            || 'their absence from purged_listings_archive is correct. They are excluded from '
            || 'orphan_after_delete precisely so that alert can still reach zero.',
        'action', 'Adjudicate each row. If the listing is genuinely gone at source and was merely '
            || 'DEACTIVATED, the evidence belongs in ops_stale_inactivation_probe and the '
            || 'cleanup_deletion_log row is false — remove the false claim, never the listing. If the '
            || 'delete was intended and did not happen, do NOT complete it from here: the sanctioned '
            || 'deleter (scrapers/common/cleanup.py) owns that, with its own fresh per-row DIRECT '
            || 're-probe and its caps.',
        'do_not', 'Do NOT delete the raw listings to make the ledger true, and do NOT resolve this by '
            || 'deleting the ledger row without first preserving the evidence it carries. Writing a '
            || 'deactivation into the DELETION ledger is how these rows got here (migration '
            || '20260919010944); ops_stale_inactivation_probe is the ledger a deactivation belongs in.'));
  end loop;

  perform public.mon_resolve_stale_keys('lifecycle_deletion_log_without_delete', live);
  return n;
end;
$fn$;
