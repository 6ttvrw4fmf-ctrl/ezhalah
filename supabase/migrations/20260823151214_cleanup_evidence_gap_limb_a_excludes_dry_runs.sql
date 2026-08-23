-- Limb A of barrier 12 counted DRY RUNS as real deletions. Caught on its own first sweep,
-- 2026-08-23 (Data Integrity run #39) — the second measurement defect in this barrier in one hour,
-- and this one was mine.
--
-- A dry run deletes nothing and therefore correctly writes no cleanup_deletion_log rows, but
-- scrapers/common/cleanup.py:426 calls end_run(..., rows_upserted=stats["deleted"]) unconditionally,
-- so the scrape_runs row records the number it WOULD have deleted. Keying on scrape_runs (which the
-- previous migration did, correctly, to reach the bypass path) lost the dry_run flag that
-- cleanup_runs carries as a real column. Result: 3 false P1s on runs 26133, 26134 and 27737 —
-- gathern dry runs of 2026-08-09 13:36/13:43 and 2026-08-12 13:02, every one of them notes
-- 'deleted=227 reactivated=73 skipped=0 dry_run=True'.
--
-- The dry_run marker in notes is the only carrier on this path, and it is reliable: of 13 engine
-- runs with rows_upserted > 0, 7 are marked dry_run=False, 6 dry_run=True, and ZERO have no marker.
-- The 7 marked-real are exactly the 7 whose ledger matches to the row.
--
-- Matched POSITIVELY (`like '%dry_run=False%'`), never negatively. `notes not like ...` is NULL for
-- a NULL notes column and would silently drop such rows — the "prose counted as code, NULL counted
-- as false" trap this repo has now hit three times (run #35b's deep-fill budget condition saw 93 of
-- 2,571 runs for exactly this reason).
--
-- And the third state is raised, not skipped: a `cleanup:%` run with deletions whose notes carry NO
-- dry_run marker cannot be classified by this barrier, and a barrier that cannot classify its
-- subject must say so rather than read clean (§23b — never let a missing input become a passing
-- reading). Today that limb is 0 and must stay 0; if the writer ever stops emitting the marker, the
-- barrier goes red instead of going blind.
--
-- MUTATION PROOF, run against live production data at apply time (read-only, four directions):
--   shipped predicate                    0 raised / cohort 7   (green on healthy data)
--   mutated: logged <> reported + 1      7 raised / cohort 7   (meaningful, not vacuous)
--   mutated: drop the dry_run filter     3 raised / cohort 10  (reproduces exactly the 3 false +ves)
--   mutated: the original cleanup_runs join  7 raised / cohort 7 (the shipped bug, on healthy runs)

create or replace function public.mon_detect_cleanup_evidence_gap()
returns integer language plpgsql security definer set search_path to 'public' as $$
declare
  rec record;
  n int := 0;
  live_a text[] := '{}';
  live_b text[] := '{}';
  live_c text[] := '{}';
  ledger_epoch constant timestamptz := timestamptz '2026-08-01 00:00:00+00';
begin
  -- ── LIMB A: a REAL engine run whose per-row evidence does not match what it deleted. ────────
  for rec in
    select s.id, s.platform, s.rows_upserted as reported, s.started_at,
           (select count(*) from public.cleanup_deletion_log l where l.run_id = s.id) as logged
      from public.scrape_runs s
     where s.platform like 'cleanup:%'
       and coalesce(s.rows_upserted, 0) > 0
       and s.notes like '%dry_run=False%'        -- POSITIVE match; a dry run deletes nothing
       and s.started_at > greatest(now() - interval '35 days', ledger_epoch)
  loop
    if rec.logged <> rec.reported then
      live_a := live_a || ('cleanup_evidence_gap:' || rec.id::text);
      n := n + public.mon_raise('P1', 'cleanup_evidence_gap',
        split_part(rec.platform, ':', 2), 'cleanup_evidence_gap:' || rec.id::text,
        jsonb_build_object(
          'why', 'A REAL (non-dry) engine cleanup run reported deleting N rows but '
               || 'cleanup_deletion_log holds a different number for that run_id. run_id is the '
               || 'SCRAPE_RUNS id (cleanup.py:219 begin_run -> :366 log rows), not cleanup_runs.id.',
          'do_not', 'Do NOT backfill synthetic ledger rows: evidence a run never wrote is gone. '
                 || 'Fix the writer so the NEXT run records its own decisions.',
          'scrape_run_id', rec.id, 'platform', rec.platform,
          'reported_deleted', rec.reported, 'log_rows_found', rec.logged, 'ran_at', rec.started_at));
    end if;
  end loop;
  perform public.mon_resolve_stale_keys('cleanup_evidence_gap', live_a);

  -- ── LIMB B: a deletion path that is not the safe engine. Unevidenced by construction. ───────
  for rec in
    select split_part(s.platform, ':', 1) as path,
           sum(s.rows_upserted)::bigint as deleted_total,
           count(*)::int                as runs,
           max(s.started_at)            as last_run,
           min(s.started_at)            as first_run,
           array_agg(distinct split_part(s.platform, ':', 2)) as tables_touched
      from public.scrape_runs s
     where s.platform not like 'cleanup:%'
       and s.platform like '%cleanup%'
       and coalesce(s.rows_upserted, 0) > 0
       and s.started_at > now() - interval '35 days'
     group by 1
  loop
    live_b := live_b || ('deletion_bypassed_engine:' || rec.path);
    n := n + public.mon_raise('P1', 'cleanup_evidence_gap', rec.path,
      'deletion_bypassed_engine:' || rec.path,
      jsonb_build_object(
        'why', 'Rows were HARD-DELETED by a path that is not scrapers/common/cleanup.py, so none '
             || 'of the engine guarantees applied: no final live re-probe before deleting, no '
             || 'anomaly or fraction circuit breaker, and no per-row audit trail. Nothing records '
             || 'WHICH listings were removed, so a false deletion here is unprovable and '
             || 'unrecoverable. mon_detect_deletion_spike cannot see this either — it reads '
             || 'cleanup_runs, which a bypass path never writes.',
        'context', 'gathern''s own 18-day pilot measured 14 of 50 age+strike-eligible rows STILL '
                || 'LIVE at the final recheck (28%). A path that deletes on age and strike count '
                || 'with no recheck is therefore expected to remove live listings, not merely '
                || 'risk it.',
        'action', 'Migrate the path onto the engine (platform_retention_policy.enabled) and retire '
               || 'its entrypoint. This limb resolves by itself once the path stops deleting.',
        'bypass_path', rec.path, 'runs_35d', rec.runs, 'rows_deleted_35d', rec.deleted_total,
        'tables_touched', to_jsonb(rec.tables_touched),
        'first_run', rec.first_run, 'last_run', rec.last_run));
  end loop;
  perform public.mon_resolve_stale_keys('deletion_bypassed_engine', live_b);

  -- ── LIMB C: an engine run this barrier cannot classify. Raise rather than read clean. ───────
  for rec in
    select s.id, s.platform, s.rows_upserted, s.started_at
      from public.scrape_runs s
     where s.platform like 'cleanup:%'
       and coalesce(s.rows_upserted, 0) > 0
       and (s.notes is null or s.notes not like '%dry_run=%')
       and s.started_at > now() - interval '35 days'
  loop
    live_c := live_c || ('cleanup_run_unclassifiable:' || rec.id::text);
    n := n + public.mon_raise('P2', 'cleanup_evidence_gap',
      split_part(rec.platform, ':', 2), 'cleanup_run_unclassifiable:' || rec.id::text,
      jsonb_build_object(
        'why', 'An engine cleanup run recorded deletions but its notes carry no dry_run= marker, '
             || 'so limb A cannot tell a real deletion from a dry run and this run is NOT being '
             || 'evidence-checked. The marker is the only carrier of that flag on scrape_runs.',
        'action', 'Restore the dry_run= marker in cleanup.py''s end_run notes, or give scrape_runs '
               || 'a real column for it. Do not widen limb A to guess.',
        'scrape_run_id', rec.id, 'platform', rec.platform, 'reported_deleted', rec.rows_upserted,
        'ran_at', rec.started_at));
  end loop;
  perform public.mon_resolve_stale_keys('cleanup_run_unclassifiable', live_c);

  return n;
end $$;

comment on function public.mon_detect_cleanup_evidence_gap() is
$c$Barrier 12. Twice corrected on 2026-08-23 (Data Integrity run #39) — both defects were in the
barrier, never in the data.

  1. It shipped joining cleanup_deletion_log.run_id to cleanup_runs.id: different id spaces
     (1..46 vs 22158..33803) sharing no key, so the count was structurally always 0 and it raised
     7 false P1s against runs whose evidence was complete. run_id is the SCRAPE_RUNS id
     (cleanup.py:219 begin_run -> :366).
  2. Re-keyed on scrape_runs, it then counted DRY RUNS as real deletions, because end_run records
     rows_upserted = "would have deleted" (cleanup.py:426). 3 more false P1s.

Three limbs, each resolving on its own evaluated path via mon_resolve_stale_keys (§25a):

  A  cleanup_evidence_gap:<scrape_run_id>       P1  REAL engine run (notes like dry_run=False)
                                                     whose ledger count <> deletions. Floored at
                                                     the ledger epoch 2026-08-01.
  B  deletion_bypassed_engine:<path>            P1  a non-engine deletion path deleted rows at
                                                     all, aggregated per path. Unevidenced by
                                                     construction; mon_detect_deletion_spike is
                                                     blind to it (it reads cleanup_runs).
  C  cleanup_run_unclassifiable:<scrape_run_id> P2  an engine run with deletions and no dry_run=
                                                     marker — unclassifiable, so it is raised
                                                     rather than silently skipped.

Healthy reading: A=0, C=0. B reads 0 once every deletion path is on the engine.$c$;

-- Resolve the 3 dry-run false positives from the previous revision.
update public.alert_event
   set resolved_at = now()
 where kind = 'cleanup_evidence_gap'
   and resolved_at is null
   and dedup_key in ('cleanup_evidence_gap:26133','cleanup_evidence_gap:26134',
                     'cleanup_evidence_gap:27737');
