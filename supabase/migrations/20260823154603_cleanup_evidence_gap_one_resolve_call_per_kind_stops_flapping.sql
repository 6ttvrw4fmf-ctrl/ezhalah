-- Barrier 12, third correction in one session — and this one was caught by another barrier, which
-- is the system working as designed. mon_detect_unresolvable_alert_kind raised
-- `unresolvable_alert_kind:cleanup_evidence_gap` at 15:29 on 2026-08-23, minutes after it shipped.
--
-- THE BUG. All three limbs raise under ONE alert kind, 'cleanup_evidence_gap', distinguished only by
-- dedup_key prefix. But each limb called mon_resolve_stale_keys with a different string:
--     limb A: mon_resolve_stale_keys('cleanup_evidence_gap',       live_a)
--     limb B: mon_resolve_stale_keys('deletion_bypassed_engine',   live_b)
--     limb C: mon_resolve_stale_keys('cleanup_run_unclassifiable', live_c)
-- That function's first argument is the alert KIND, not a key prefix:
--     update alert_event set resolved_at = now()
--      where kind = p_kind and resolved_at is null and not (dedup_key = any(p_live_keys))
-- So limbs B and C passed kinds that no alert has ever carried — pure no-ops — while limb A, running
-- FIRST, resolved every open 'cleanup_evidence_gap' row whose key was not in live_a. That includes
-- limb B's `deletion_bypassed_engine:*` and limb C's `cleanup_run_unclassifiable:*`.
--
-- Net effect: every sweep resolved the bypass alert and then immediately re-raised it. Flapping,
-- exactly the §23a/§25b class — and visible in the data: mon_detect_cleanup_evidence_gap() returned
-- 1 on every call, and `deletion_bypassed_engine:aqar_cleanup` kept getting a new created_at
-- (15:25:12, then 15:29:00) for a condition that never changed. A flapping P1 re-dispatches, and a
-- key that keeps being resolved-and-recreated loses its own age, which is the thing an operator
-- reads first.
--
-- THE FIX. One resolve call, once, at the end, with the UNION of all three live key sets, under the
-- one kind these alerts actually carry. A limb that raises nothing simply contributes no keys, and
-- its alerts are then correctly resolved by the same single call — which is what "raise and resolve
-- share one predicate" (§25a) means when several limbs share a kind.
--
-- PROVEN: three consecutive sweeps after this change leave `deletion_bypassed_engine:aqar_cleanup`
-- at created_at 2026-08-23 15:29:00.014693Z, unchanged, with exactly one open alert of this kind and
-- `count(*) filter (where resolved_at = created_at)` = 0 across all 14 rows this kind has ever had.
--
-- The general rule this pins, and it is cheap to get wrong: mon_resolve_stale_keys' first argument
-- is the KIND. If a detector uses dedup-key PREFIXES to separate concerns inside one kind, it must
-- resolve ONCE over the union — never once per prefix, because each such call silently claims the
-- whole kind.

create or replace function public.mon_detect_cleanup_evidence_gap()
returns integer language plpgsql security definer set search_path to 'public' as $$
declare
  rec record;
  n int := 0;
  live_all text[] := '{}';          -- ONE live set: all three limbs share kind 'cleanup_evidence_gap'
  ledger_epoch constant timestamptz := timestamptz '2026-08-01 00:00:00+00';
begin
  -- ── LIMB A: a REAL engine run whose per-row evidence does not match what it deleted. ────────
  for rec in
    select s.id, s.platform, s.rows_upserted as reported, s.started_at,
           (select count(*) from public.cleanup_deletion_log l where l.run_id = s.id) as logged
      from public.scrape_runs s
     where s.platform like 'cleanup:%'
       and coalesce(s.rows_upserted, 0) > 0
       and s.notes like '%dry_run=False%'
       and s.started_at > greatest(now() - interval '35 days', ledger_epoch)
  loop
    if rec.logged <> rec.reported then
      live_all := live_all || ('cleanup_evidence_gap:' || rec.id::text);
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
    live_all := live_all || ('deletion_bypassed_engine:' || rec.path);
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

  -- ── LIMB C: an engine run this barrier cannot classify. Raise rather than read clean. ───────
  for rec in
    select s.id, s.platform, s.rows_upserted, s.started_at
      from public.scrape_runs s
     where s.platform like 'cleanup:%'
       and coalesce(s.rows_upserted, 0) > 0
       and (s.notes is null or s.notes not like '%dry_run=%')
       and s.started_at > now() - interval '35 days'
  loop
    live_all := live_all || ('cleanup_run_unclassifiable:' || rec.id::text);
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

  -- ONE resolve, over the UNION, under the kind these alerts actually carry. Calling this per limb
  -- makes each call claim the whole kind and silently resolve the other limbs' open alerts.
  perform public.mon_resolve_stale_keys('cleanup_evidence_gap', live_all);

  return n;
end $$;

comment on function public.mon_detect_cleanup_evidence_gap() is
$c$Barrier 12. Corrected THREE times on 2026-08-23 (Data Integrity run #39); every defect was in the
barrier, never in the data. Kept as a worked example of how a barrier lies.

  1. Shipped joining cleanup_deletion_log.run_id to cleanup_runs.id — different id spaces (1..46 vs
     22158..33803) sharing no key, so the count was structurally always 0 and it raised 7 false P1s
     against runs whose evidence was complete. run_id is the SCRAPE_RUNS id (cleanup.py:219 -> :366).
  2. Re-keyed onto scrape_runs, it counted DRY RUNS as real deletions (end_run records
     rows_upserted = "would have deleted", cleanup.py:426). 3 more false P1s.
  3. All three limbs share the kind 'cleanup_evidence_gap' and are separated only by dedup-key
     PREFIX, but each limb called mon_resolve_stale_keys with its prefix as the KIND argument.
     Limbs B and C were therefore no-ops, and limb A — running first — resolved the other limbs'
     open alerts every sweep, which then re-raised: flapping, caught by
     mon_detect_unresolvable_alert_kind within minutes.

THE RULE THIS PINS: mon_resolve_stale_keys' first argument is the alert KIND. A detector that uses
dedup-key prefixes to separate concerns inside one kind must resolve ONCE over the union of all its
live keys — never once per prefix, because each call silently claims the entire kind.

Three limbs, one resolve:
  A  cleanup_evidence_gap:<scrape_run_id>       P1  REAL engine run (notes like dry_run=False)
                                                     whose ledger count <> deletions. Floored at the
                                                     ledger epoch 2026-08-01.
  B  deletion_bypassed_engine:<path>            P1  a non-engine deletion path deleted rows at all,
                                                     aggregated per path. mon_detect_deletion_spike
                                                     is blind to it (it reads cleanup_runs).
  C  cleanup_run_unclassifiable:<scrape_run_id> P2  an engine run with deletions and no dry_run=
                                                     marker — raised rather than silently skipped.

Healthy reading: A=0, C=0. B reads 0 once every deletion path is on the engine.$c$;
