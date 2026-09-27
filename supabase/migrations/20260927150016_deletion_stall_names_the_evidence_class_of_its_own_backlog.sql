-- A STALLED DELETION QUEUE MUST NAME THE EVIDENCE CLASS OF ITS OWN BACKLOG
-- (routine-11-lifecycle, 2026-09-27)
--
-- WHAT HAPPENED
-- -------------
-- mon_detect_deletion_clock_stalled fired for the first time ever on 2026-09-27 03:59 (alert_event
-- 6325, aqarcity: 331 candidates, 0 deleted, anomaly breaker at 312). Its payload told the reader:
--
--   why_it_matters: "It means the verification the deletion depends on is not happening, so nobody
--                    is learning whether those listings are alive or dead"
--   action:         "fix the VERIFICATION side: re-probe the candidates so the real live/dead split
--                    is known, and bring the finding (with that measurement) to the owner"
--
-- Both sentences are hardcoded string constants. Neither was measured. For aqarcity both are FALSE:
-- all 334 eligible rows carry a DIRECT GONE verdict from prune_unseen.verify_gone whose note reads
-- «هذا الإعلان منتهي» — the source's OWN expired banner, on the listing's own URL. The verification
-- side is complete. The re-probe the alert demands has already happened, a month ago, for every row.
--
-- Measured across all four delete-enabled platforms the same hour (latest verdict per eligible row,
-- joined on listing_id OR ad_number — see the identity note below):
--
--   platform   eligible   latest GONE   no verdict at all   % GONE
--   aqarcity        334           334                   0   100.0     <- verification COMPLETE
--   aqar         26,032             6              26,026     0.0     <- verification INCOMPLETE
--   gathern       1,686             0               1,686     0.0     <- verification INCOMPLETE
--   wasalt       12,540             0              12,540     0.0     <- verification INCOMPLETE
--
-- So BOTH cases are live in production right now, they need OPPOSITE responses, and the detector
-- emits identical text for them. On aqar/gathern/wasalt the stock advice is exactly right and the
-- five standing deletion_clock_without_evidence P1s say so. On aqarcity it sends the responder to
-- re-measure something already measured, and hides the real blocker: aqarcity is the ONLY enabled
-- platform with platform_retention_policy.drain_backlog = false (aqar, gathern and wasalt were all
-- flipped true), so its queue has no sanctioned way to drain at all.
--
-- This is LISTING_LIFECYCLE_ENGINEER.md §8.3's trap and §2.3's lesson 2 in their exact form: a
-- detector right about the WHAT and wrong about the WHY, whose remedy field sends every responder
-- down a path that does not apply. A P2 whose prescribed action cannot work is how a real breaker
-- stops being trusted.
--
-- WHAT THIS CHANGES, AND WHAT IT DELIBERATELY DOES NOT
-- ---------------------------------------------------
-- It adds INFORMATION to a detector. It does not touch a threshold, a cap, a floor, a policy row or
-- the deleter. Nothing is deleted faster, nothing is deleted at all. The alert still raises, at the
-- same P2, under the same kind and the same dedup key, and mon_resolve_stale_keys behaves as before.
-- The `do_not` paragraph is emitted BYTE-IDENTICALLY in every branch: no evidence class is
-- permission, and SOURCE_CONFIRMED_DEAD least of all — a fully-evidenced backlog is still an owner
-- decision, because draining it means changing drain_backlog or a threshold (AGENTS.md RED #4/#8,
-- LISTING_LIVENESS.md §7, DELETION_SAFETY.md §6).
--
-- CONTRADICTED is its own class and outranks every other, including SOURCE_CONFIRMED_DEAD. A
-- deletion-eligible row whose LATEST source verdict is LIVE is a RESTORE candidate (§3.1's
-- DELETION_ELIGIBLE -> RESTORED), and folding it into "partially verified" would let the one row
-- that must never be deleted hide inside a percentage. It is zero today; the class exists so that a
-- future non-zero cannot arrive silently.
--
-- TWO MEASUREMENT RULES THIS ENCODES, BOTH LEARNED THE HARD WAY THIS RUN
-- ---------------------------------------------------------------------
-- 1. LATEST verdict per row, never "a GONE exists". §4.1c: a source that relists a unit publishes
--    the reversal, and an older GONE that a newer LIVE has superseded is not evidence of death.
-- 2. Join on listing_id OR ad_number, never one alone. ops_stale_inactivation_probe's identity
--    columns are populated inconsistently per writer, and measured this run the two joins disagree
--    in OPPOSITE directions on the two platforms that matter most:
--      aqarcity  334 eligible: 334 matched by ad_number,   0 matched by listing_id
--      aqar   26,032 eligible:   0 matched by ad_number,   6 matched by listing_id
--    A single-column join therefore under-counts evidence, which mislabels an EVIDENCED backlog as
--    UNVERIFIED. That direction is safe for deletion (it never manufactures a death) but it is
--    exactly the mislabel this migration exists to stop, so both columns are consulted. Five probe
--    rows fleet-wide (gathern_residential_listings) carry NEITHER column and are unattributable to
--    any row by any join; they count as no_verdict, which is the honest answer.

-- ── The classifier. ONE code path decides the class, whether the census came from production or ──
-- ── from an injected list — so the detector's self-test below is a statement about the function ──
-- ── that really classifies production, not about a copy of it.                                  ──
create or replace function public.ops_lifecycle_backlog_evidence_class(
  p_platform text,
  p_inject   jsonb default null
)
returns table(
  eligible       bigint,
  latest_gone    bigint,
  latest_live    bigint,
  latest_unknown bigint,
  no_verdict     bigint,
  evidence_class text
)
language plpgsql
stable
security definer
set search_path to 'public'
as $fn$
declare
  pol record;
  t   text;
  v_e bigint := 0; v_g bigint := 0; v_l bigint := 0; v_u bigint := 0; v_n bigint := 0;
  c_e bigint;      c_g bigint;      c_l bigint;      c_u bigint;      c_n bigint;
begin
  if p_inject is not null then
    -- The injected input is a list of per-row LATEST verdicts: 'GONE' | 'LIVE' | 'UNKNOWN' | null.
    -- This is the seam the detector needs to test the classifier without writing a single row.
    select count(*),
           count(*) filter (where x.v = 'GONE'),
           count(*) filter (where x.v = 'LIVE'),
           count(*) filter (where x.v = 'UNKNOWN'),
           count(*) filter (where x.v is null)
      into v_e, v_g, v_l, v_u, v_n
      from jsonb_array_elements(p_inject) as e(j)
      cross join lateral (select nullif(e.j #>> '{}', '') as v) as x;
  else
    select p.min_inactive_days, p.min_missing_count into pol
      from public.platform_retention_policy p
     where p.platform = p_platform and p.enabled;
    -- A platform that is not enabled has no deletion queue to classify. Return no row rather than
    -- a zeroed one, so a caller cannot read "not enabled" as "empty and therefore fine".
    if not found then return; end if;

    -- Tables by SHAPE, and the platform's OWN thresholds, read per call — the same discipline
    -- ops_lifecycle_deletion_backlog() uses, for the same reason: a hardcoded 30/3 goes green the
    -- day someone changes them.
    for t in
      select c2.table_name from information_schema.columns c2
       where c2.table_schema = 'public'
         and c2.column_name  = 'deactivated_at'
         and c2.table_name like p_platform || '\_%\_listings'
    loop
      -- `as materialized` is load-bearing, not style: inlined, the planner duplicates the correlated
      -- subquery once per count(... filter ...) — measured 543 ms and 260,959 buffers on
      -- wasalt_residential_listings for work that costs a quarter of that done once.
      execute format($q$
        with elig as materialized (
          select t.id, t.ad_number
            from public.%1$I t
           where t.active = false
             and coalesce(t.missing_count, 0) >= %2$s
             and t.last_seen_at < now() - (%3$L || ' days')::interval
        ), latest as materialized (
          select (select p.verdict
                    from public.ops_stale_inactivation_probe p
                   where p.source_table = %4$L
                     and ( (p.listing_id is not null and p.listing_id = e.id)
                        or (p.ad_number  is not null and e.ad_number is not null
                            and p.ad_number = e.ad_number) )
                   order by p.probed_at desc
                   limit 1) as v
            from elig e
        )
        select count(*),
               count(*) filter (where v = 'GONE'),
               count(*) filter (where v = 'LIVE'),
               count(*) filter (where v = 'UNKNOWN'),
               count(*) filter (where v is null)
          from latest
      $q$, t, pol.min_missing_count, pol.min_inactive_days, t)
      into c_e, c_g, c_l, c_u, c_n;
      v_e := v_e + coalesce(c_e, 0);
      v_g := v_g + coalesce(c_g, 0);
      v_l := v_l + coalesce(c_l, 0);
      v_u := v_u + coalesce(c_u, 0);
      v_n := v_n + coalesce(c_n, 0);
    end loop;
  end if;

  return query select v_e, v_g, v_l, v_u, v_n,
    case
      -- Nothing is eligible, so there is no queue to describe.
      when v_e = 0         then 'EMPTY'
      -- Outranks everything: the source's LATEST word on at least one eligible row is that it is
      -- ALIVE. That row is a restore candidate and must never be deleted, whatever the rest say.
      when v_l > 0         then 'CONTRADICTED'
      -- Not one row in the queue carries a source verdict. The clock was started by crawl absence
      -- alone and only the delete-time re-probe stands between it and an irreversible delete.
      when v_g = 0         then 'UNVERIFIED'
      -- Every eligible row's latest verdict is a DIRECT GONE. The verifier has done its job.
      when (v_u + v_n) = 0 then 'SOURCE_CONFIRMED_DEAD'
      else                      'PARTIALLY_VERIFIED'
    end;
end;
$fn$;

comment on function public.ops_lifecycle_backlog_evidence_class(text, jsonb) is
  'Classifies the EVIDENCE behind a delete-enabled platform''s deletion-eligible backlog: '
  'SOURCE_CONFIRMED_DEAD / PARTIALLY_VERIFIED / UNVERIFIED / CONTRADICTED / EMPTY. Latest verdict '
  'per row (§4.1c), joined on listing_id OR ad_number because ops_stale_inactivation_probe''s '
  'identity columns are populated inconsistently per writer. p_inject takes a list of per-row '
  'verdicts so mon_detect_deletion_clock_stalled can self-test this classifier every sweep without '
  'writing rows. A class is a DESCRIPTION, never permission: draining any backlog is an owner '
  'decision (AGENTS.md RED #4/#8).';

-- ── The detector. Same kind, same severity, same dedup key, same resolve behaviour. What changes ──
-- ── is that it MEASURES what it used to assert.                                                 ──
create or replace function public.mon_detect_deletion_clock_stalled()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  n          int := 0;
  live       text[] := '{}';
  r          record;
  ev         record;
  t_dead     text; t_unver text; t_part text; t_contra text;
  v_why      text;
  v_action   text;
  -- Emitted byte-identically in every branch. No class is permission.
  c_do_not   text :=
      'This alert NEVER authorises raising anomaly_floor, anomaly_factor, max_delete_per_run or '
   || 'min_inactive_days, setting drain_backlog, forcing a run, or deleting by hand — and that is '
   || 'true of EVERY evidence class, SOURCE_CONFIRMED_DEAD included. LISTING_LIVENESS.md §7 and '
   || 'DELETION_SAFETY.md §6: a backlog that will not drain is evidence about the VERIFIER, never '
   || 'permission to delete. Every threshold and every retention-policy field here is an owner '
   || 'decision (AGENTS.md RED #4/#8).';
begin
  -- ── SELF-TEST, BEFORE ANYTHING IS REPORTED ──────────────────────────────────────────────────
  -- Four directions, because a classifier that collapses to one answer is invisible in the SQL.
  -- One that always says UNVERIFIED restores the defect this migration fixes; one that always says
  -- SOURCE_CONFIRMED_DEAD is far worse — it would tell every responder that a backlog started by
  -- crawl absence alone had been source-confirmed. 2026-09-06 proved a `create or replace` expected
  -- to roll back may not, so this is checked in production on every sweep, not at review time.
  select evidence_class into t_dead
    from public.ops_lifecycle_backlog_evidence_class('__selftest', '["GONE","GONE"]'::jsonb);
  select evidence_class into t_unver
    from public.ops_lifecycle_backlog_evidence_class('__selftest', '[null,null]'::jsonb);
  select evidence_class into t_part
    from public.ops_lifecycle_backlog_evidence_class('__selftest', '["GONE",null]'::jsonb);
  select evidence_class into t_contra
    from public.ops_lifecycle_backlog_evidence_class('__selftest', '["GONE","LIVE"]'::jsonb);

  if coalesce(t_dead,'') <> 'SOURCE_CONFIRMED_DEAD'
     or coalesce(t_unver,'')  <> 'UNVERIFIED'
     or coalesce(t_part,'')   <> 'PARTIALLY_VERIFIED'
     or coalesce(t_contra,'') <> 'CONTRADICTED' then
    return public.mon_raise('P1', 'lifecycle_evidence_class_blind', 'all',
      'lifecycle_evidence_class_blind',
      jsonb_build_object(
        'why', 'ops_lifecycle_backlog_evidence_class() no longer discriminates, so every '
            || 'deletion_clock_stalled alert is now carrying an evidence class that may be wrong in '
            || 'either direction. Do not act on the action text of any deletion_clock_stalled alert '
            || 'until this is green.',
        'all_gone_should_be_SOURCE_CONFIRMED_DEAD', t_dead,
        'no_verdicts_should_be_UNVERIFIED', t_unver,
        'mixed_should_be_PARTIALLY_VERIFIED', t_part,
        'any_live_should_be_CONTRADICTED', t_contra,
        'action', 'Diff pg_get_functiondef('
            || '''public.ops_lifecycle_backlog_evidence_class(text,jsonb)'') against '
            || 'supabase/migrations — a create-or-replace that was expected to roll back may not '
            || 'have. Do NOT repair this by widening a class.'));
  end if;

  -- The self-test passed, so a previously-raised blind alarm is no longer true. mon_raise() returns
  -- 0 on an already-open dedup key, so an alarm nothing lowers would sit under every later all-zero
  -- sweep and make it read as a clean bill of health (AGENTS.md's nine dark detectors).
  perform public.mon_resolve_key('lifecycle_evidence_class_blind', 'lifecycle_evidence_class_blind');

  for r in
    select * from public.ops_lifecycle_deletion_backlog() b
     where b.eligible_now > 0
       and coalesce(b.candidates_last_run, 0) > 0
       and coalesce(b.deleted_last_run, 0) = 0
  loop
    select * into ev from public.ops_lifecycle_backlog_evidence_class(r.platform);

    -- The WHY and the ACTION are now derived from what this platform's queue actually carries.
    if ev.evidence_class = 'CONTRADICTED' then
      v_why := 'A stuck deletion queue is not "safe by default" — and on this platform it is worse '
            || 'than stuck: the LATEST source verdict on ' || ev.latest_live || ' of the ' || ev.eligible
            || ' eligible rows is that the listing is ALIVE. Those rows are RESTORE candidates '
            || 'sitting in a deletion queue.';
      v_action := 'Deal with the ' || ev.latest_live || ' contradicted row(s) FIRST, before anything '
            || 'about the stall: re-probe each by DIRECT fetch of its own URL and, where the source '
            || 'serves it, restore it (active=true, missing_count=0) and cancel its clock — a '
            || 'restorative write is never gated (§0 corollary 2). Only then read the abort_reason.';
    elsif ev.evidence_class = 'UNVERIFIED' then
      v_why := 'A stuck deletion queue is not "safe by default". Not one of the ' || ev.eligible
            || ' eligible rows carries a source verdict, so the verification the deletion depends on '
            || 'is not happening: nobody is learning whether those listings are alive or dead, and '
            || 'rows nobody re-probes drift further from the source every day. It is also how a real '
            || 'breaker stops being trusted: it fires every week and no one is told.';
      v_action := 'Fix the VERIFICATION side: re-probe the candidates so the real live/dead split is '
            || 'known, and bring the finding (with that measurement) to the owner. The way this alert '
            || 'goes green is more verification, never more deletion.';
    elsif ev.evidence_class = 'PARTIALLY_VERIFIED' then
      v_why := 'A stuck deletion queue is not "safe by default". ' || ev.latest_gone || ' of the '
            || ev.eligible || ' eligible rows carry a DIRECT GONE verdict and '
            || (ev.no_verdict + ev.latest_unknown) || ' carry none, so this queue is a mixture of '
            || 'source-confirmed dead listings and rows whose only signal is absence from our crawl.';
      v_action := 'Split the cohort before doing anything else — the two halves need different '
            || 'things. Re-probe the ' || (ev.no_verdict + ev.latest_unknown) || ' unverified rows to '
            || 'learn their real live/dead split; for the ' || ev.latest_gone || ' already-evidenced '
            || 'rows the verification side is done and the remaining blocker is the gate, which is an '
            || 'owner decision. Report both numbers.';
    elsif ev.evidence_class = 'SOURCE_CONFIRMED_DEAD' then
      v_why := 'A stuck deletion queue is not "safe by default", and on this platform the usual '
            || 'cause is ruled out: all ' || ev.eligible || ' eligible rows carry a DIRECT GONE '
            || 'verdict as their LATEST source reading. The verifier has done its job. What is stuck '
            || 'is the gate, and because the anomaly breaker compares against a median of recent '
            || 'runs, a standing backlog above the floor aborts every subsequent run — so this state '
            || 'is self-reinforcing and will not clear on its own.';
      v_action := 'Do NOT re-probe to "learn the split" — it is already known and recorded per row in '
            || 'ops_stale_inactivation_probe. Read the abort_reason above, check whether '
            || 'platform_retention_policy.drain_backlog is false for this platform (the sanctioned '
            || 'system-paced drain, which still source-re-verifies every row and still aborts on a '
            || 'real spike), and bring THAT to the owner as the decision it is. An engineer may '
            || 'measure and propose; only the owner may change the gate.';
    else
      v_why := 'The retention engine ran for this platform, found candidates, and removed none of '
            || 'them; the evidence class of the backlog could not be measured ('
            || coalesce(ev.evidence_class, 'no row returned') || ').';
      v_action := 'Read the abort_reason above, then establish the evidence class by hand before '
            || 'deciding anything: ops_lifecycle_backlog_evidence_class(''' || r.platform || ''').';
    end if;

    live := live || ('deletion_clock_stalled:' || r.platform);
    n := n + public.mon_raise('P2', 'deletion_clock_stalled', r.platform,
      'deletion_clock_stalled:' || r.platform,
      jsonb_build_object(
        'platform', r.platform,
        'eligible_now', r.eligible_now,
        'last_run_at', r.last_run_at,
        'candidates_last_run', r.candidates_last_run,
        'deleted_last_run', r.deleted_last_run,
        'aborted', r.aborted,
        'engine_abort_reason', r.abort_reason,
        'last_run_that_deleted_anything', r.last_drain_at,
        -- MEASURED, not asserted. This is the whole point of the change.
        'evidence_class', ev.evidence_class,
        'backlog_latest_gone', ev.latest_gone,
        'backlog_latest_live', ev.latest_live,
        'backlog_latest_unknown', ev.latest_unknown,
        'backlog_no_verdict', ev.no_verdict,
        'evidence_measured_how', 'Latest verdict per eligible row from '
            || 'ops_stale_inactivation_probe, joined on listing_id OR ad_number (that ledger''s '
            || 'identity columns are populated inconsistently per writer, and a single-column join '
            || 'under-counts evidence). An older GONE superseded by a newer LIVE does not count as '
            || 'death (§4.1c).',
        'why', 'The retention engine ran for this platform, found candidates, and removed none of '
            || 'them. The queue is therefore not moving, and each run makes it larger. The engine '
            || 'records the reason in cleanup_runs.abort_reason.',
        'why_it_matters', v_why,
        'do_not', c_do_not,
        'action', v_action));
  end loop;

  perform public.mon_resolve_stale_keys('deletion_clock_stalled', live);
  return n;
end;
$fn$;
