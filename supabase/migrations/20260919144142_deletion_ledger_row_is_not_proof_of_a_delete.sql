-- ============================================================================================
-- A cleanup_deletion_log ROW IS NOT PROOF THAT A DELETE HAPPENED (routine-11-lifecycle, 2026-09-19)
--
-- WHAT WAS WRONG. ops_lifecycle_orphan_after_delete() opens with
--     ledger as (select d.source_table, d.listing_id, d.deleted_at from public.cleanup_deletion_log d)
-- and every one of its six arms then asks "the row was deleted, so why is it still in <surface>?".
-- Nothing checks whether the raw row is actually GONE. DELETION_SAFETY.md requires the ledger row
-- to be written BEFORE the delete, so a ledger row proves only that a delete was INTENDED.
--
-- The detector's own action text already tells the reader about this case —
--     "do NOT delete an orphan row whose raw listing is actually still present: that is a
--      different (and opposite) bug"
-- — but the predicate never implemented the distinction it documents. So the opposite bug is
-- reported AS the bug it is the opposite of, and, because the raw row legitimately keeps its
-- location/index rows, the alert can never go green. It is a permanent, unfixable-by-design P2.
--
-- MEASURED NOW, over the whole ledger (1,792 rows, four source tables):
--     gathern_residential_listings   978 rows   0 still present
--     aqarcity_residential_listings  770 rows   0 still present
--     aqarcity_commercial_listings    38 rows   0 still present
--     wasalt_residential_listings      6 rows   6 STILL PRESENT   <-- every false row is here
-- Every genuine cleanup-engine delete really deleted its row. The six exceptions are the
-- hand-written repair 20260919010944, which deactivated six wasalt listings on a real DIRECT
-- 404 (headed Chromium, /ar and /en, probed twice, live control) and then recorded that
-- DEACTIVATION in the DELETION ledger — "matching the shape the cleanup path already writes".
-- The deactivation is earned and is NOT reversed here; only the claim that the rows were deleted
-- is, in the companion repair migration.
--
-- WHY THIS MATTERS BEYOND SIX ROWS. orphan_after_delete is the detector that catches an
-- irreversible delete that only half-propagated. LISTING_LIFECYCLE_ENGINEER.md §4.1b and §8.3 say
-- it in bold about exactly this class: a detector readers learn to dismiss is dark on the day it
-- is right. A P2 that can never be cleared is how that training happens.
--
-- WHAT THIS DOES NOT DO: it does not silence the case. AGENTS.md — never silence a barrier to make
-- it green; make it distinguish cases, and prove both directions. The excluded rows are raised
-- under their own correctly-named kind instead.
-- ============================================================================================

-- ── 1. The predicate, with the injected-input seam the self-test needs ──────────────────────────
-- Returns the ledger rows whose raw listing IS STILL PRESENT, i.e. the deletes that never
-- happened. One indexed join per distinct source table in the ledger (four today), not one
-- dynamic query per ledger row — this runs on the half-hourly roster sweep.
--
-- p_inject is the SELF-TEST SEAM, the shape ops_lifecycle_dead_copy_is_a_contradiction() already
-- established: a detector that cannot exercise its predicate without WRITING rows cannot prove the
-- predicate still discriminates, and a self-test that writes is not a self-test.
create or replace function public.ops_lifecycle_ledger_rows_not_deleted(p_inject jsonb default null)
returns table(source_table text, listing_id bigint)
language plpgsql
stable
security definer
set search_path to 'public'
as $fn$
declare
  t text;
begin
  if p_inject is not null then
    return query
      select e->>'tbl', (e->>'listing_id')::bigint
        from jsonb_array_elements(p_inject) e;
    return;
  end if;

  for t in select distinct d.source_table from public.cleanup_deletion_log d loop
    -- A table we cannot resolve tells us NOTHING about whether the row was deleted. Skipping it
    -- leaves the orphan arms judging it exactly as they do today, rather than newly suppressing a
    -- real orphan or newly inventing a false-ledger report. Unknown changes nothing, in either
    -- direction.
    if to_regclass('public.' || quote_ident(t)) is null then
      continue;
    end if;

    return query execute format(
      'select $1::text, d.listing_id
         from public.cleanup_deletion_log d
         join public.%I r on r.id = d.listing_id
        where d.source_table = $1', t) using t;
  end loop;
end;
$fn$;

-- ── 2. The orphan generator now judges only rows that were REALLY deleted ───────────────────────
create or replace function public.ops_lifecycle_orphan_after_delete()
returns table(surface text, source_table text, orphan_rows bigint, oldest_deleted_at timestamp with time zone, sample_ids bigint[])
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_sync    timestamptz := public.ops_lifecycle_propagation_cutoff();
  v_alids   timestamptz;
  v_nv1     timestamptz;
  v_lli     timestamptz;
  v_archive timestamptz;
begin
  select max(refreshed_at) into v_alids from public.mon_mv_refresh_log
   where object_name = 'active_listing_ids_v2';
  select max(refreshed_at) into v_nv1 from public.mon_mv_refresh_log
   where object_name = 'listing_native_location_v1';
  select max(refreshed_at) into v_lli from public.mon_mv_refresh_log
   where object_name = 'listing_location_index';
  select min(deleted_at) into v_archive from public.purged_listings_archive;

  return query
  with notdeleted as materialized (
    -- Evaluated ONCE. A row here was never deleted, so it is not an orphan of anything: its
    -- location/index rows are correct and its absence from purged_listings_archive is correct.
    select nd.source_table as st, nd.listing_id as lid
      from public.ops_lifecycle_ledger_rows_not_deleted() nd
  ),
  ledger as (
    select d.source_table as st, d.listing_id as lid, d.deleted_at
      from public.cleanup_deletion_log d
     where not exists (select 1 from notdeleted n where n.st = d.source_table and n.lid = d.listing_id)
  ),
  hits as (
    select 'search_listings_ar'::text as surface, l.st, l.lid, l.deleted_at
      from ledger l
      join public.search_listings_ar s on s.source_table = l.st and s.listing_id = l.lid
     where v_sync is not null and l.deleted_at < v_sync
    union all
    select 'active_listing_ids_v2', l.st, l.lid, l.deleted_at
      from ledger l
      join public.active_listing_ids_v2 m on m.source_table = l.st and m.listing_id = l.lid
     where v_alids is not null and l.deleted_at < v_alids
    union all
    select 'listing_native_location_v1', l.st, l.lid, l.deleted_at
      from ledger l
      join public.listing_native_location_v1 n on n.source_table = l.st and n.listing_id = l.lid
     where v_nv1 is not null and l.deleted_at < v_nv1
    union all
    -- nv2 is a VIEW, so it has no refresh of its own; it is graded against the EARLIEST cutoff of the
    -- objects underneath it, which is the conservative choice (fewer rows judged, never more).
    select 'listing_native_location_v2', l.st, l.lid, l.deleted_at
      from ledger l
      join public.listing_native_location_v2 n2 on n2.source_table = l.st and n2.listing_id = l.lid
     where least(v_nv1, v_sync) is not null and l.deleted_at < least(v_nv1, v_sync)
    union all
    select 'listing_location_index', l.st, l.lid, l.deleted_at
      from ledger l
      join public.listing_location_index i on i.source_table = l.st and i.listing_id = l.lid
     where v_lli is not null and l.deleted_at < v_lli
    union all
    select 'purged_listings_archive', l.st, l.lid, l.deleted_at
      from ledger l
     where (v_archive is null or l.deleted_at >= v_archive)
       and not exists (select 1 from public.purged_listings_archive a
                        where a.source_table = l.st and a.listing_id = l.lid)
  )
  select h.surface, h.st, count(*)::bigint, min(h.deleted_at),
         (array_agg(h.lid order by h.lid))[1:20]
    from hits h
   group by h.surface, h.st;
end;
$function$;

-- ── 3. The excluded rows get their own, correctly-named alert ───────────────────────────────────
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

-- ── 4. Roster entry, in the SAME migration (AGENTS.md; mon_detect_orphaned_detectors fires
--       on any detector nothing reaches, and a detector outside the roster is decoration) ────────
do $$
declare src text; out_def text;
begin
  src := pg_get_functiondef('public.mon_run_all_detectors()'::regprocedure);
  if position('mon_detect_deletion_log_without_delete' in src) > 0 then
    raise notice 'mon_detect_deletion_log_without_delete already on the roster';
    return;
  end if;
  out_def := replace(src,
    E'    ''mon_detect_orphan_after_delete'',',
    E'    ''mon_detect_orphan_after_delete'', ''mon_detect_deletion_log_without_delete'',');
  if out_def = src then
    raise exception 'roster anchor not found — refusing to guess where the entry belongs';
  end if;
  execute out_def;
end $$;
