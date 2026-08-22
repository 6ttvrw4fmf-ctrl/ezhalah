-- AN INACTIVATION LEDGER THAT NOTHING WRITES CANNOT PROVE AN INACTIVATION.
--
-- THE DEFECT (2026-08-22, Data Integrity run #37). Migration 20260812113726 created
-- `gathern_liveness_detail` as the per-row source-evidence ledger for gathern inactivations, and
-- its own comment states the contract: "written by scrapers/gathern/liveness.py on EVERY run
-- including dry-runs". The writer was never implemented. Ten days later the table held ZERO rows --
-- while the sweep went on inactivating listings: 17 runs, 2,954 rows, none of them re-checkable
-- from our own data. Only the aggregate line survived in scrape_runs.notes
-- ("scanned=1500 dead=1131 ..."), which cannot say WHICH row returned WHICH status on WHICH day.
--
-- This is a section 4 problem, not bookkeeping: "Do not trust our own inactive, stale,
-- missing_count, or deletion flags as proof -- those are Ezhalah state, not source evidence." The
-- sweep DOES re-fetch the source and DOES derive its verdict from a real HTTP status, so the
-- evidence existed at decision time and was thrown away. It is the exact pre-fix state wasalt was
-- rescued from by wasalt_liveness_pilot_detail, and why three separate audits had to re-derive
-- gathern liveness state by hand.
--
-- The scraper half ships in the same change (scrapers/gathern/liveness.py, pinned offline by
-- scripts/verify-gathern-liveness-evidence.ts, 22 checks -- 13 of which fail on the pre-fix file).
-- This migration is the LIVE half: it asks whether a sweep that inactivated rows actually left
-- evidence behind, because "we added the writer" and "the writer runs in production" are different
-- claims and only the second one protects anything.
--
-- GRANDFATHERING, deliberately. The contract starts at the timestamp below, not at the ledger's
-- creation. Runs before the writer shipped could not have written evidence and their per-row 404s
-- are genuinely gone (expired Actions logs) -- raising on them forever would be a permanently-red
-- detector, which by sections 23a/25a is worse than none: mon_raise() returns 0 for an already-open
-- dedup key, so a stuck alert silences the real re-occurrence it exists to catch.
--
-- RAISE AND RESOLVE SHARE ONE PREDICATE (section 25a). The same cohort query drives both branches --
-- there is no separately-worded "self-heal" clause that could disagree with the raise.

comment on column public.gathern_liveness_detail.verdict is
  'kill = 404/410 and the 3-strike grace is now reached - strike = 404/410, grace not yet reached - '
  'alive = HTTP 200 (row is rescued: missing_count reset, last_seen_at refreshed) - transient = '
  'anything else (429/5xx/timeout/no response) which NEVER counts as evidence of removal - '
  'dead_confirmed = 404/410 seen by the --recheck-dead resurrection pass on an ALREADY-inactive '
  'row (the kill is re-confirmed; nothing changes). Added 2026-08-22 with that pass.';

create or replace function public.mon_detect_gathern_liveness_evidence_gap()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  -- The evidence contract takes effect when the writer shipped. Everything earlier is grandfathered:
  -- its evidence cannot be recreated, and a detector that can never go green protects nothing.
  contract_start constant timestamptz := timestamptz '2026-08-22 08:15:00+00';
  v_runs int := 0; v_rows bigint := 0; v_sample jsonb := '[]'::jsonb; n int := 0;
begin
  select count(*), coalesce(sum(coalesce(r.rows_upserted, 0)), 0),
         coalesce(jsonb_agg(jsonb_build_object(
           'run_id', r.id, 'started_at', r.started_at, 'inactivated', r.rows_upserted)
           order by r.started_at desc), '[]'::jsonb)
    into v_runs, v_rows, v_sample
  from public.scrape_runs r
  where r.platform = 'gathern_liveness'
    and r.finished_at is not null
    and r.started_at > contract_start
    and coalesce(r.rows_upserted, 0) > 0          -- only runs that actually flipped rows inactive
    and not exists (
      select 1 from public.gathern_liveness_detail d
       where d.run_at >= r.started_at - interval '5 minutes'
         and d.run_at <= r.finished_at + interval '30 minutes');

  if v_runs > 0 then
    n := public.mon_raise('P1', 'gathern_liveness_evidence_gap', 'gathern',
      'gathern_liveness_evidence_gap',
      jsonb_build_object(
        'runs_without_evidence', v_runs,
        'rows_inactivated_without_evidence', v_rows,
        'sample', (select jsonb_agg(e) from (select e from jsonb_array_elements(v_sample) e limit 10) s),
        'why', 'A gathern liveness sweep inactivated rows and wrote NO per-row evidence to '
               'gathern_liveness_detail. Those inactivations cannot be re-checked from our own '
               'data - "was that kill correct?" would again need the source re-fetched by hand, '
               'and the per-row status survives only in an expiring Actions log.',
        'do_not', 'Do NOT resolve this by deleting or back-filling ledger rows. The evidence for a '
                  'run that did not write it is genuinely gone; inventing it would be worse than '
                  'the gap. Fix the writer in scrapers/gathern/liveness.py so the NEXT run records '
                  'its own decisions.'));
  else
    perform public.mon_resolve_key('gathern_liveness_evidence_gap', 'gathern_liveness_evidence_gap');
  end if;

  return n;
end
$function$;

comment on function public.mon_detect_gathern_liveness_evidence_gap() is
  'Every gathern liveness run that inactivated rows must have left per-row evidence in '
  'gathern_liveness_detail. Cohort keys on the RUN LOG (scrape_runs), which is the writer''s own '
  'clock - not on a downstream sync, so no row can drift in or out of it on another job''s '
  'schedule (section 24b). Measured cost 10 ms on an idle database (2026-08-22): read that as '
  'normal, and 60 s+ as a real regression. Runs before 2026-08-22 08:15 UTC are grandfathered - the '
  'writer did not exist and their evidence cannot be recreated. A standing 0 is the healthy reading '
  '(section 24c).';

-- Roster registration, in the SAME migration (AGENTS.md: a detector outside mon_run_all_detectors
-- is decoration, and mon_detect_orphaned_detectors fires on anything nothing reaches). Needle-edit
-- against the LIVE body -- never a pasted full array, which is how the roster lost entries four
-- times (scripts/verify-detector-roster-edits-are-guarded.ts).
do $roster$
declare
  src text; needle text := '''mon_detect_silent_scraper_death'',';
  ins text := '''mon_detect_silent_scraper_death'',
    ''mon_detect_gathern_liveness_evidence_gap'',';
begin
  select pg_get_functiondef(p.oid) into src
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname = 'mon_run_all_detectors';

  if src is null then
    raise exception 'mon_run_all_detectors not found';
  end if;

  if position('mon_detect_gathern_liveness_evidence_gap' in src) > 0 then
    raise notice 'already registered; nothing to do';
    return;
  end if;

  if (length(src) - length(replace(src, needle, ''))) / length(needle) <> 1 then
    raise exception 'roster needle not found exactly once - refusing a blind edit';
  end if;

  execute replace(src, needle, ins);
end
$roster$;

-- Reachability check: fail the migration if the roster cannot reach the new detector.
do $check$
declare src text;
begin
  select pg_get_functiondef(p.oid) into src
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname = 'mon_run_all_detectors';
  if position('mon_detect_gathern_liveness_evidence_gap' in src) = 0 then
    raise exception 'roster registration failed - detector would be decoration';
  end if;
end
$check$;
