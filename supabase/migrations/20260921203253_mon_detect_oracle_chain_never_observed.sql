-- A DECLARED LIVENESS CHAIN THAT HAS NEVER BEEN SEEN TO RUN IS NOT COVERAGE.
--
-- OWNER RULE, 2026-09-21: "Do not mark a platform as covered merely because code exists. Prove the
-- full chain actually runs." docs/ops/LISTING_LIVENESS.md §9.1 states the same thing as a
-- measurement rather than a promise. Nothing enforced it.
--
-- WHAT THIS WATCHES. A platform registered DIRECT_REVISIT or CANDIDATE_PLUS_DIRECT is making a
-- claim: something re-fetches its listings' own URLs and reads an affirmative answer. This detector
-- asks production whether that has EVER happened, by either of the only two ways it can leave a
-- trace:
--   • a verification stamp (ops_platform_liveness_coverage.verified_ever — written only through
--     scrapers/common/liveness_contract.py), or
--   • a direct probe verdict (ops_stale_inactivation_probe, oracle 'prune_unseen.verify_gone').
-- Neither, on a platform holding active inventory, means the chain has never been observed to run.
--
-- IT IS MECHANISM-AGNOSTIC BY CONSTRUCTION. It does not know or care whether a platform verifies
-- through its own liveness module (aqar, gathern, wasalt, dealapp) or through prune_unseen's oracle
-- (the 29 re-tiered in the migration alongside this one). A platform that grows a third mechanism
-- tomorrow satisfies this the moment that mechanism leaves either trace — and a platform that
-- quietly stops satisfying it goes red without anyone remembering to add it anywhere.
--
-- WHY IT IS NOT THE COVERAGE RAMP. mon_detect_liveness_coverage_ramp asks whether coverage is
-- RISING toward 80%, needs a 48h-old baseline, and self-retires 2026-10-15. This asks the prior
-- question — has the chain produced a single verdict, ever — and is permanent. The ramp was also
-- blind to exactly this class until today: its filter is
-- `strategy in ('DIRECT_REVISIT','CANDIDATE_PLUS_DIRECT')`, and the 29 platforms that actually run
-- a direct oracle were all registered CRAWL_PRESENCE_ONLY, so it never looked at one of them.
--
-- UNPROVEN IS NOT BROKEN, AND THE ALERT SAYS WHICH. The probe fires only for a row that reaches
-- grace, so a small, stable catalogue where nothing ever goes missing may legitimately never
-- produce a verdict. `under_strike` is carried in the detail so the reader can tell that case from
-- a platform with candidates queueing up and an oracle producing nothing. Both are worth knowing;
-- only one is a defect. The honest word for both is UNPROVEN — never "covered".
--
-- FAILS CLOSED. An empty coverage feed is unjudgeable, not clean — the dark-detector shape this
-- repo has been burned by (nine silent detectors reading as a clean bill of health, 2026-08-10).
create or replace function public.mon_detect_oracle_chain_never_observed()
returns integer
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_raised int := 0;
  v_rows   int := 0;
  r record;
begin
  select count(*) into v_rows from public.ops_platform_liveness_coverage;
  if v_rows = 0 then
    perform public.mon_raise('P2', 'oracle_chain_never_observed', 'monitoring',
      'oracle_chain_never_observed:__feed__',
      jsonb_build_object(
        'why', 'ops_platform_liveness_coverage returned NO rows, so no liveness claim can be '
            || 'graded at all. That is unjudgeable, never clean — check the coverage snapshot job.'));
    return 1;
  end if;
  perform public.mon_resolve_key('oracle_chain_never_observed', 'oracle_chain_never_observed:__feed__');

  for r in
    with ev as (
      select split_part(source_table, '_', 1) as platform,
             count(*) as verdicts,
             max(probed_at) as latest
        from public.ops_stale_inactivation_probe
       where oracle = 'prune_unseen.verify_gone'
       group by 1
    )
    select c.platform, c.strategy, c.active, c.verified_ever, c.under_strike,
           coalesce(e.verdicts, 0) as verdicts, e.latest
      from public.ops_platform_liveness_coverage c
      left join ev e on e.platform = c.platform
     where c.strategy in ('DIRECT_REVISIT', 'CANDIDATE_PLUS_DIRECT')
       and c.active > 0
  loop
    if r.verified_ever > 0 or r.verdicts > 0 then
      perform public.mon_resolve_key('oracle_chain_never_observed',
                                     'oracle_chain_never_observed:' || r.platform);
      continue;
    end if;

    perform public.mon_raise('P2', 'oracle_chain_never_observed', r.platform,
      'oracle_chain_never_observed:' || r.platform,
      jsonb_build_object(
        'platform', r.platform,
        'strategy', r.strategy,
        'active', r.active,
        'under_strike', r.under_strike,
        'verified_ever', 0,
        'direct_probe_verdicts', 0,
        'why', 'this platform is registered ' || r.strategy || ' — a claim that something '
            || 're-fetches its listings'' own URLs and reads an affirmative answer — and production '
            || 'holds NO evidence that has ever happened: zero verification stamps and zero direct '
            || 'probe verdicts, over ' || r.active || ' active listings. The chain exists in code '
            || 'and has never been observed to run. Per LISTING_LIVENESS.md §9.3 that makes every '
            || 'one of those listings UNKNOWN, and UNKNOWN never deactivates anything.',
        'how_to_tell_unproven_from_broken',
            case when r.under_strike > 0
                 then r.under_strike || ' row(s) are already under strike, so candidates ARE '
                      || 'queueing for the oracle and it is still producing nothing — investigate '
                      || 'the probe (blocked egress, a quarantined canary, an oracle that throws).'
                 else 'no row is under strike, so no candidate has yet reached grace. The oracle '
                      || 'may simply never have been asked. That is UNPROVEN, not broken — but it '
                      || 'also means its first real decision will be its first test.'
            end,
        'ledger', 'scrapers/oracle-never-observed.txt',
        'action', 'select split_part(source_table,''_'',1), verdict, count(*) from '
               || 'ops_stale_inactivation_probe where oracle = ''prune_unseen.verify_gone'' group by 1,2;'));
    v_raised := v_raised + 1;
  end loop;

  return v_raised;
end
$fn$;

comment on function public.mon_detect_oracle_chain_never_observed() is
  'Owner rule 2026-09-21: a platform is not covered because code exists. Raises P2 per platform '
  'whose registry tier claims a direct liveness mechanism while production holds no verification '
  'stamp and no direct probe verdict at all. Ledger: scrapers/oracle-never-observed.txt.';

-- ── ROSTER, in the SAME migration (AGENTS.md) ───────────────────────────────────────────────────
-- A detector nothing reaches is decoration, and mon_detect_orphaned_detectors() is right to say so.
-- The replace is anchored and asserted below, so a future edit to mon_run_all_detectors() that
-- moves the anchor makes this migration FAIL rather than silently install an unreachable detector.
do $roster$
declare
  v_src text;
  v_new text;
begin
  select prosrc into v_src from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'mon_run_all_detectors';
  if v_src is null then
    raise exception 'mon_run_all_detectors() not found — roster anchor missing';
  end if;
  if position('mon_detect_oracle_chain_never_observed' in v_src) > 0 then
    raise notice 'already on the roster';
    return;
  end if;
  if position('fns text[] := array[' in v_src) = 0 then
    raise exception 'roster anchor "fns text[] := array[" not found in mon_run_all_detectors()';
  end if;
  v_new := replace(v_src, 'fns text[] := array[',
                          'fns text[] := array[' || chr(10) ||
                          '    ''mon_detect_oracle_chain_never_observed'',');
  -- Recreated with the SAME attributes it already has, read from the catalog above rather than
  -- assumed: plpgsql, NOT security definer, no search_path setting. A roster edit must never be a
  -- silent privilege change.
  execute 'create or replace function public.mon_run_all_detectors() returns jsonb language plpgsql '
       || 'as $body$' || v_new || '$body$';
end
$roster$;

-- ── POST-APPLY ASSERTIONS, in this transaction ──────────────────────────────────────────────────
do $assert$
declare
  v_src text;
begin
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'public' and p.proname = 'mon_detect_oracle_chain_never_observed') then
    raise exception 'detector did not install';
  end if;
  select prosrc into v_src from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'mon_run_all_detectors';
  if position('mon_detect_oracle_chain_never_observed' in v_src) = 0 then
    raise exception 'detector installed but is NOT on the roster — it would never run';
  end if;
end
$assert$;
