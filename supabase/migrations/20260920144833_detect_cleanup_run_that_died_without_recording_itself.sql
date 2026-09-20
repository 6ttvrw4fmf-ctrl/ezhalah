-- A cleanup run that DIES must not vanish from the cleanup audit surface.
--
-- Earned 2026-09-20 by scrape_runs 49535 (cleanup:wasalt, 09:31:14 -> 10:21:46, ok=false,
-- 'canceling statement due to statement timeout' / 57014). cleanup_deletion_log is written BEFORE
-- the delete (DELETION_SAFETY.md §1), so by the time the timeout landed the run had already
-- published 500 claims that listings were permanently destroyed. It deleted 1 of them. Because the
-- cleanup_runs insert sits AFTER the delete loop and the except handler called only end_run(), the
-- run left NO row in cleanup_runs at all.
--
-- Measured over every cleanup:* run in the preceding 30 days: 49535 was the ONLY one without a
-- cleanup_runs row. Every CONTROLLED abort -- anomaly guard, fraction gate, health gate, the
-- inconclusive-evidence freeze -- wrote one. Only the uncontrolled death did not. So the audit
-- table was complete for every case except the one that went wrong, and a reader of cleanup_runs
-- saw wasalt's last action as the clean dry run that preceded it.
--
-- scrapers/common/cleanup.py is fixed in the same change to write the row on the failure path with
-- the TRUE partial count. That fix cannot cover a SIGKILL/OOM/runner-loss, where no Python handler
-- runs at all -- which is precisely why this detector exists rather than the code fix alone.

create or replace function public.ops_lifecycle_cleanup_run_unrecorded(p_inject jsonb default null)
returns table(run_id bigint, platform text, started_at timestamptz, finished_at timestamptz,
              ok boolean, claims_written bigint)
language plpgsql stable security invoker set search_path = public as $$
begin
  -- Injection contract, identical to ops_lifecycle_ledger_rows_not_deleted(): a non-null p_inject
  -- returns ONLY the injected rows, so the detector can prove the plumbing in both directions
  -- without depending on whether production happens to be clean today.
  if p_inject is not null then
    return query
      select (e->>'run_id')::bigint, e->>'platform',
             (e->>'started_at')::timestamptz, (e->>'finished_at')::timestamptz,
             (e->>'ok')::boolean, (e->>'claims_written')::bigint
        from jsonb_array_elements(p_inject) e;
    return;
  end if;

  return query
    select s.id, s.platform, s.started_at, s.finished_at, s.ok,
           (select count(*) from public.cleanup_deletion_log d where d.run_id = s.id)
      from public.scrape_runs s
     where s.platform like 'cleanup:%'
       and s.started_at > now() - interval '14 days'
       -- An in-flight run has not failed to record itself yet. Two hours is far above the longest
       -- cleanup run observed (49535 itself, 50m31s), so this can never flag a live run.
       and (s.finished_at is not null or s.started_at < now() - interval '2 hours')
       and not exists (
         select 1 from public.cleanup_runs c
          where c.platform = replace(s.platform, 'cleanup:', '')
            and c.ran_at between s.started_at
                             and coalesce(s.finished_at, s.started_at + interval '2 hours'));
end;
$$;

comment on function public.ops_lifecycle_cleanup_run_unrecorded(jsonb) is
  'Cleanup runs (scrape_runs platform cleanup:*) that ended with no cleanup_runs row in their own '
  'window. claims_written is how many cleanup_deletion_log rows the run published before dying -- '
  'the number that turns a run-health curiosity into a deletion-audit defect. p_inject returns only '
  'the injected rows, for the detector self-test. Born from run 49535, 2026-09-20.';


create or replace function public.mon_detect_cleanup_run_unrecorded()
returns int language plpgsql security definer set search_path = public as $$
declare
  n            int := 0;
  live         text[] := '{}';
  r            record;
  k            text;
  quiet_runs   int := 0;
  reports_hit  boolean;
  stays_silent boolean;
begin
  -- SELF-TEST, BOTH DIRECTIONS, BEFORE ANYTHING IS REPORTED. A predicate that always returns rows
  -- would cry wolf on every healthy cleanup; one that never returns rows restores the silence this
  -- migration exists to end -- and neither is visible by reading the committed SQL.
  select exists(select 1 from public.ops_lifecycle_cleanup_run_unrecorded(
           '[{"run_id":-1,"platform":"cleanup:__selftest","claims_written":1}]'::jsonb))
    into reports_hit;
  select not exists(select 1 from public.ops_lifecycle_cleanup_run_unrecorded('[]'::jsonb))
    into stays_silent;

  if not (reports_hit and stays_silent) then
    return public.mon_raise('P1', 'lifecycle_cleanup_predicate_blind', 'all',
      'lifecycle_cleanup_predicate_blind',
      jsonb_build_object(
        'why', 'ops_lifecycle_cleanup_run_unrecorded() no longer discriminates, so '
            || 'lifecycle_cleanup_run_unrecorded is either crying wolf on healthy runs or has gone '
            || 'dark. Do not trust that kind until this is green.',
        'reports_an_injected_row', reports_hit,
        'silent_on_an_empty_inject', stays_silent));
  end if;
  perform public.mon_resolve_key('lifecycle_cleanup_predicate_blind',
                                 'lifecycle_cleanup_predicate_blind');

  for r in select * from public.ops_lifecycle_cleanup_run_unrecorded() loop
    -- A run that died before publishing any deletion claim is a RUN-HEALTH problem and belongs to
    -- the scraping routine (dangling_scrape_run / run_killed_by_timeout already watch that shape).
    -- What is this routine's is a run that published claims of permanent deletion and then left
    -- nothing in the cleanup audit surface to explain them. Counted, not raised, so the two are
    -- never confused and this kind cannot cry wolf on someone else's defect.
    if coalesce(r.claims_written, 0) = 0 then
      quiet_runs := quiet_runs + 1;
      continue;
    end if;

    -- Keyed per RUN, deliberately. A kind keyed per platform would fold the next occurrence into
    -- an already-open alert and mon_raise() would return 0 for it (AGENTS.md: read open_alerts,
    -- not the count) -- so a second failed run would be invisible behind the first.
    k := 'lifecycle_cleanup_run_unrecorded:' || r.run_id;
    live := live || k;
    n := n + public.mon_raise(
      'P2',
      'lifecycle_cleanup_run_unrecorded',
      replace(r.platform, 'cleanup:', ''),
      k,
      jsonb_build_object(
        'scrape_run_id', r.run_id,
        'platform', r.platform,
        'started_at', r.started_at,
        'finished_at', r.finished_at,
        'ok', r.ok,
        'deletion_claims_published', r.claims_written,
        'why', 'This cleanup run wrote ' || r.claims_written || ' row(s) into cleanup_deletion_log '
            || '-- the audit trail of PERMANENT deletion -- and then ended without writing a '
            || 'cleanup_runs row. The ledger is written BEFORE the delete, so those rows are claims '
            || 'that a delete was INTENDED, and there is now no run record saying whether it '
            || 'happened, how far it got, or why it stopped.',
        'read_this_before_repairing', 'Do NOT assume the listings are gone and do NOT delete the '
            || 'ledger rows to tidy up. Check ops_lifecycle_ledger_rows_not_deleted() for which of '
            || 'them still have a live raw row: a partial delete is the expected shape here (run '
            || '49535 deleted 1 of 500). Rows still present are NOT orphans and must not be '
            || 'deleted to make the ledger true.',
        'do_not', 'Do NOT complete the delete from here. The sanctioned deleter '
            || '(scrapers/common/cleanup.py) owns it, with its own fresh per-row DIRECT re-probe '
            || 'and its caps -- and a row that is still present has NOT been re-verified today.',
        'action', 'Find why the run died (scrape_runs.notes carries the error; 49535 was a 57014 '
            || 'statement timeout in the delete loop). If it is a timeout, the delete batch or the '
            || 'statement_timeout is the lever -- never the guards, the caps or the retention '
            || 'window.',
        'runs_with_no_claims_not_raised', quiet_runs));
  end loop;

  perform public.mon_resolve_stale_keys('lifecycle_cleanup_run_unrecorded', live);
  return n;
end;
$$;

comment on function public.mon_detect_cleanup_run_unrecorded() is
  'P2 lifecycle_cleanup_run_unrecorded: a cleanup run published deletion-ledger claims and then '
  'ended with no cleanup_runs row. Keyed per run so a second occurrence cannot hide behind the '
  'first. Run 49535 (2026-09-20) is the founding case: 500 claims, 1 delete, no run row.';


-- A detector nothing calls is decoration (mon_detect_orphaned_detectors fires on one), so the
-- roster entry lands in the SAME migration.
do $mig$
declare src text; before_len int;
begin
  select prosrc into src from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname = 'mon_run_all_detectors';
  if src is null then raise exception 'mon_run_all_detectors not found'; end if;

  if position('mon_detect_cleanup_run_unrecorded' in src) > 0 then
    return; -- already registered
  end if;

  before_len := length(src);
  src := replace(src,
    '''mon_detect_deletion_on_inconclusive_evidence'',',
    '''mon_detect_deletion_on_inconclusive_evidence'',''mon_detect_cleanup_run_unrecorded'',');

  if length(src) = before_len then
    raise exception 'roster anchor not matched -- refusing to leave the detector orphaned';
  end if;

  execute format('create or replace function public.mon_run_all_detectors() returns jsonb language plpgsql as %L', src);
end $mig$;
