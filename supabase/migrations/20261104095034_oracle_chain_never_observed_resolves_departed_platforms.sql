-- mon_detect_oracle_chain_never_observed: resolve the alert of a platform that LEFT the judged set (2026-11-04).
--
-- The detector judges only platforms registered DIRECT_REVISIT / CANDIDATE_PLUS_DIRECT that hold active rows,
-- and resolves a key only inside that loop. A platform that leaves the set — retired, its registry row
-- removed, or its last active row hidden — was never visited again, so its alert stayed open forever
-- describing a condition that is no longer true. Measured: almuteb (retired by migration 20261104094609,
-- owner decision 2, 0 active rows, no registry row) kept oracle_chain_never_observed:almuteb (alert 5239)
-- open after the detector re-ran. The fix resolves, after the loop, every open key whose platform is not
-- in the judged set. A platform still IN the set is judged exactly as before; nothing is raised less.

do $anchor$
declare
  v_def text := pg_get_functiondef('public.mon_detect_oracle_chain_never_observed()'::regprocedure);
begin
  if position('and c.active > 0' in v_def) = 0
     or position('oracle_chain_never_observed:__feed__' in v_def) = 0 then
    raise exception 'mon_detect_oracle_chain_never_observed changed since it was read — re-read before applying';
  end if;
  if position('left the judged set' in v_def) > 0 then
    raise exception 'mon_detect_oracle_chain_never_observed already resolves departed platforms';
  end if;
end
$anchor$;

create or replace function public.mon_detect_oracle_chain_never_observed()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
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
             count(*) filter (where verdict in ('GONE','LIVE')) as verdicts,
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

  -- A platform that left the judged set (no DIRECT_REVISIT / CANDIDATE_PLUS_DIRECT registration, or no
  -- active row) no longer makes the claim this alert grades, so its open alert is resolved here; the loop
  -- above never visits it again. The coverage feed was read non-empty above, so absence is a fact here.
  for r in
    select a.dedup_key
      from public.alert_event a
     where a.kind = 'oracle_chain_never_observed'
       and a.resolved_at is null
       and a.dedup_key like 'oracle_chain_never_observed:%'
       and a.dedup_key <> 'oracle_chain_never_observed:__feed__'
       and not exists (
         select 1 from public.ops_platform_liveness_coverage c
          where c.strategy in ('DIRECT_REVISIT', 'CANDIDATE_PLUS_DIRECT')
            and c.active > 0
            and 'oracle_chain_never_observed:' || c.platform = a.dedup_key)
  loop
    perform public.mon_resolve_key('oracle_chain_never_observed', r.dedup_key);
  end loop;

  return v_raised;
end
$function$;
