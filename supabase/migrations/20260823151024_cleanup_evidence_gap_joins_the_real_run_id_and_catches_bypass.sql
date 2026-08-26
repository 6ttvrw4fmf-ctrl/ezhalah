-- Barrier 12 shipped with an id-space bug and would have cried wolf on every healthy run forever.
-- Found on its FIRST sweep, 2026-08-23 (Data Integrity run #39), minutes after PR #898 applied it.
--
-- THE BUG. mon_detect_cleanup_evidence_gap joined cleanup_deletion_log.run_id to cleanup_runs.id.
-- Those are two different id spaces and they never intersect:
--   cleanup_runs.id            1 .. 46      (18 rows, its own identity sequence)
--   cleanup_deletion_log.run_id 22158 .. 33803
-- The log's run_id is the SCRAPE_RUNS id, because scrapers/common/cleanup.py:219 does
-- `run_id = begin_run(f"cleanup:{platform}")` (a scrape_runs insert) and then writes that same
-- value at :366 into every log row — while :423 inserts the cleanup_runs summary row separately,
-- with NO column carrying the scrape_runs id. There is no join key between the two tables at all,
-- so the barrier's count was structurally always 0 and it raised P1 on 7 perfectly-evidenced runs.
--
-- The evidence was in fact COMPLETE. Re-joined on the real key, every engine run since the ledger
-- writer shipped matches to the row:
--   33803 aqarcity 231/231 · 33801 gathern 265/265 · 29990 aqarcity 261/261 · 29787 gathern 206/206
--   26135 gathern  227/227 · 25901 aqarcity  71/71  · 22158 aqarcity 133/133
-- A barrier that reports a false defect against correct behaviour is worse than no barrier: it
-- trains the reader to ignore the alarm, which is precisely what this one is for.
--
-- THE FIX IS ALSO A STRICT UPGRADE. Keying on scrape_runs rather than cleanup_runs lets the same
-- barrier see EVERY deletion path, not just the engine's — including the legacy no-recheck
-- deleter, which writes a scrape_runs row (`aqar_cleanup:<table>`) and no ledger row whatsoever.
-- That is the exact incident this session found: 5,533 aqar+wasalt rows hard-deleted on
-- 2026-08-23 02:03/02:31 UTC with zero per-row evidence, invisible to mon_detect_deletion_spike
-- (which reads cleanup_runs, a table the legacy path never writes). So limb B below is the
-- "deletion bypassed the engine" detector the incident review asked for, and it comes free.
--
-- Two limbs, each resolving on its own evaluated path (§25a — one predicate raises and resolves):
--   A  cleanup_evidence_gap:<scrape_run_id>   P1  an ENGINE run whose ledger row count <> the
--                                                 deletions it reported. Healthy reading: 0.
--   B  deletion_bypassed_engine:<platform>    P1  a NON-engine path deleted rows at all. Every
--                                                 such deletion is unevidenced by construction.
--
-- Limb A is floored at the ledger writer's own start (2026-08-01; first log row 2026-08-02
-- 03:30:45Z). Runs older than the writer have no ledger by definition and would cry wolf forever —
-- the §25b trap where one incident that predates its own fix looks exactly like a live defect.
-- Limb B needs no such floor: an unevidenced deletion is a real finding at any age, and it
-- aggregates per platform so a decade of legacy runs is one actionable alert, not thirty.
--
-- NOTE: superseded within the same session by 20260823151214, which adds the dry-run exclusion to
-- limb A and a limb C for unclassifiable runs. Kept as its own migration so the applied history
-- reads in the order it actually happened.

create or replace function public.mon_detect_cleanup_evidence_gap()
returns integer language plpgsql security definer set search_path to 'public' as $$
declare
  rec record;
  n int := 0;
  live_a text[] := '{}';
  live_b text[] := '{}';
  -- The ledger writer's own start. Before this, no engine run wrote cleanup_deletion_log at all.
  ledger_epoch constant timestamptz := timestamptz '2026-08-01 00:00:00+00';
begin
  -- ── LIMB A: an ENGINE run whose per-row evidence does not match what it reported deleting. ──
  for rec in
    select s.id, s.platform, s.rows_upserted as reported, s.started_at,
           (select count(*) from public.cleanup_deletion_log l where l.run_id = s.id) as logged
      from public.scrape_runs s
     where s.platform like 'cleanup:%'
       and coalesce(s.rows_upserted, 0) > 0
       and s.started_at > greatest(now() - interval '35 days', ledger_epoch)
  loop
    if rec.logged <> rec.reported then
      live_a := live_a || ('cleanup_evidence_gap:' || rec.id::text);
      n := n + public.mon_raise('P1', 'cleanup_evidence_gap',
        split_part(rec.platform, ':', 2), 'cleanup_evidence_gap:' || rec.id::text,
        jsonb_build_object(
          'why', 'An ENGINE cleanup run reported deleting N rows but cleanup_deletion_log holds a '
               || 'different number for that run_id. run_id is the SCRAPE_RUNS id (cleanup.py:219 '
               || 'begin_run -> :366 log rows), not cleanup_runs.id — do not "fix" this by joining '
               || 'cleanup_runs, which shares no key with the ledger and is how this barrier '
               || 'shipped broken on 2026-08-22.',
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

  return n;
end $$;

comment on function public.mon_detect_cleanup_evidence_gap() is
$c$Barrier 12, corrected 2026-08-23 (Data Integrity run #39) after it raised 7 false P1s on its
first sweep.

Two limbs, both keyed on scrape_runs.id — which IS cleanup_deletion_log.run_id (cleanup.py:219
begin_run -> :366). The original shipped joining cleanup_runs.id, a DIFFERENT id space (1..46 vs
22158..33803) that shares no key with the ledger, so its count was structurally always 0.

  A  cleanup_evidence_gap:<scrape_run_id>  P1  engine run (platform like 'cleanup:%') whose ledger
                                                row count <> reported deletions. Floored at the
                                                ledger epoch 2026-08-01 so pre-writer runs, which
                                                have no ledger by definition, do not cry wolf.
  B  deletion_bypassed_engine:<path>       P1  a non-engine deletion path deleted rows at all,
                                                aggregated per path. Unevidenced by construction;
                                                mon_detect_deletion_spike is blind to it because
                                                that reads cleanup_runs.

Healthy reading for A is 0. B reads 0 once every deletion path is on the engine.$c$;

-- The 7 open alerts were raised by the broken predicate against runs whose evidence is complete.
-- Resolve them explicitly rather than leaving false P1s standing; limb A's own resolve path would
-- not reach them because their dedup keys carry cleanup_runs ids that the corrected cohort never
-- produces.
update public.alert_event
   set resolved_at = now()
 where kind = 'cleanup_evidence_gap'
   and resolved_at is null
   and dedup_key in ('cleanup_evidence_gap:5','cleanup_evidence_gap:7','cleanup_evidence_gap:10',
                     'cleanup_evidence_gap:24','cleanup_evidence_gap:28','cleanup_evidence_gap:41',
                     'cleanup_evidence_gap:42');
