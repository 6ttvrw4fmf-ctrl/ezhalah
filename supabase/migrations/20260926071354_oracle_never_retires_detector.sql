-- AN ORACLE THAT HAS NEVER ONCE ANSWERED IS NOT A COVERED PLATFORM.
--
-- Measured 2026-09-26 (routine #3). muktamel's prune_unseen.verify_gone oracle has been asked
-- 1,132 times since 2026-09-22 and has returned UNKNOWN on every single one — zero GONE, zero
-- LIVE. It is the only platform in the fleet whose verify_gone has never produced an affirmative
-- verdict (sakan 232/232 LIVE and hajer 8/8 LIVE are healthy by comparison).
--
-- Nothing was watching, and the reason is the shape LISTING_LIVENESS.md §9.6 names: a tier is a
-- MECHANISM, coverage is EVIDENCE, and reading one as the other switches monitors off.
-- mon_detect_oracle_chain_never_observed() clears a platform when
--     verified_ever > 0  OR  verdicts > 0
-- where `verdicts` counted probe rows of ANY verdict. Two independent ways that let muktamel pass:
--   1. UNKNOWN counted as observation. UNKNOWN is the oracle saying "I could not tell" — counting
--      it as proof the chain works is counting silence as health, which §9 forbids in terms.
--      `oracle_chain_never_observed:muktamel` was raised 2026-09-21 20:33 and RESOLVED
--      2026-09-22 05:29 — the first sweep after the first UNKNOWNs landed.
--   2. Even with (1) fixed, muktamel's own-page ALIVE stamps (PR #4434, 2026-09-25) put
--      verified_ever at 1,703, so the OR's other limb clears it anyway. The ALIVE half of the
--      chain works; the GONE half has never retired anything. One detector answering "has this
--      chain been observed at all?" cannot see a platform that can confirm life and never death.
--
-- WHAT IT COSTS. UNKNOWN correctly never kills (liveness_contract.decide() returns action='none';
-- verified at line 166), so this has deactivated nothing and no listing needs restoring. The harm
-- is the other direction, and it is exactly the owner's second sentence in §9: "if the liveness
-- checker or its scheduled job stops working, Ezhalah must detect THAT failure too, instead of
-- silently accumulating stale listings." 369 muktamel rows sit at or past grace right now with
-- strikes as high as 7 — more than double the grace of 3 — unretirable, still served, while every
-- monitor reads green.
--
-- This migration does two things:
--   (a) adds mon_oracle_never_retires() — a PURE predicate, so a barrier can EXECUTE it against
--       injected rows rather than grep its source (the mon_orphaned_detectors() precedent), plus
--       its mon_detect_* raiser and its roster entry, in this one migration as AGENTS.md requires;
--   (b) narrows the `verdicts` limb of mon_detect_oracle_chain_never_observed() to AFFIRMATIVE
--       verdicts only. Measured before applying: the five platforms that limb currently clears
--       (mustqr, ebriza, aqargate, abeea, nowaisiry) all hold real GONE verdicts, so this widens
--       nothing today and closes the hole for the next platform that has no own-page stamps.
--
-- p_min_asks = 25 is not a new number: it is liveness_trust.MIN_PROBES_FOR_TRUST, the same floor
-- mon_detect_liveness_oracle_untrustworthy() already uses, so "asked enough to judge" means one
-- thing across the fleet. Below it, an all-UNKNOWN run is two timeouts, not a broken oracle.

create or replace function public.mon_oracle_never_retires(p_min_asks int default 25)
returns table(platform text, strategy text, active bigint, under_strike bigint,
              asks bigint, affirmative bigint, unknown_asks bigint, latest timestamptz)
language sql stable security definer set search_path = public as $fn$
  with ev as (
    select split_part(p.source_table, '_', 1) as platform,
           count(*)                                              as asks,
           count(*) filter (where p.verdict in ('GONE','LIVE'))  as affirmative,
           count(*) filter (where p.verdict = 'UNKNOWN')         as unknown_asks,
           max(p.probed_at)                                      as latest
      from public.ops_stale_inactivation_probe p
     where p.oracle = 'prune_unseen.verify_gone'
     group by 1
  )
  select c.platform, c.strategy, c.active, c.under_strike,
         e.asks, e.affirmative, e.unknown_asks, e.latest
    from public.ops_platform_liveness_coverage c
    join ev e on e.platform = c.platform
   where c.strategy in ('DIRECT_REVISIT','CANDIDATE_PLUS_DIRECT')
     and c.active > 0
     and e.asks >= p_min_asks
     and e.affirmative = 0;
$fn$;

comment on function public.mon_oracle_never_retires(int) is
  'Platforms whose prune_unseen.verify_gone oracle has been asked at least p_min_asks times and has '
  'NEVER returned an affirmative verdict (GONE or LIVE). Pure and stable so a barrier can execute it '
  'against injected probe rows. An all-UNKNOWN oracle kills nothing (correct) but also retires '
  'nothing, so dead inventory accumulates while coverage reads healthy — LISTING_LIVENESS.md §9.';

create or replace function public.mon_detect_oracle_never_retires()
returns int language plpgsql security definer set search_path = public as $fn$
declare
  n    int := 0;
  live text[] := '{}';
  r    record;
begin
  for r in select * from public.mon_oracle_never_retires() loop
    live := live || ('oracle_never_retires:' || r.platform);
    n := n + public.mon_raise('P1', 'oracle_never_retires', r.platform,
      'oracle_never_retires:' || r.platform,
      jsonb_build_object(
        'platform', r.platform,
        'strategy', r.strategy,
        'active', r.active,
        'under_strike', r.under_strike,
        'asks', r.asks,
        'affirmative_verdicts', 0,
        'unknown_verdicts', r.unknown_asks,
        'latest_probe', r.latest,
        'why', 'this platform is registered ' || r.strategy || ', a claim that it re-fetches a '
            || 'listing''s own URL and reads an affirmative answer. Its verify_gone oracle has been '
            || 'asked ' || r.asks || ' times and has returned GONE or LIVE exactly ZERO times — '
            || r.unknown_asks || ' of those answers were UNKNOWN. UNKNOWN is the oracle saying "I '
            || 'could not tell", not evidence that it works.',
        'what_this_is_not', 'This is NOT a false-inactivation alert and must never be answered by '
            || 'deactivating anything. liveness_contract.decide() returns action=''none'' on '
            || 'UNKNOWN, so this oracle has killed nothing. The defect is the opposite direction: '
            || 'it can never RETIRE anything either, so ads removed at source keep being served.',
        'why_it_matters', r.under_strike || ' active row(s) are under strike on this platform and '
            || 'cannot reach a verdict, because the only thing allowed to retire them answers '
            || 'UNKNOWN every time. LISTING_LIVENESS.md §9: "if the liveness checker or its '
            || 'scheduled job stops working, Ezhalah must detect THAT failure too, instead of '
            || 'silently accumulating stale listings."',
        'action', 'Fix the PROBE, never the floor. Re-measure the oracle from the egress the job '
            || 'really uses (CI — .github/workflows/oracle-feasibility-probe.yml), because an '
            || 'UNKNOWN storm is usually blocked egress, a canary that never validates, a changed '
            || 'response shape, or an oracle that throws. Do NOT resolve this by lowering the grace '
            || 'count, widening the crawl, relaxing the canary, or deactivating the stranded rows.',
        'boundary', 'mon_detect_oracle_chain_never_observed() asks whether a chain has EVER been '
            || 'observed and is satisfied by own-page ALIVE stamps alone; a platform whose ALIVE '
            || 'half works and whose GONE half is 100% UNKNOWN passes it. This detector asks the '
            || 'narrower question: can the oracle ever retire anything?'));
  end loop;

  perform public.mon_resolve_stale_keys('oracle_never_retires', live);
  return n;
end
$fn$;

-- Roster + the affirmative-verdict narrowing, both applied by rewriting the LIVE definition rather
-- than retyping it (AGENTS.md "Token-Efficient Engineering"). Each step FAILS LOUDLY if its anchor
-- is missing, so a future refactor cannot turn this into a silent no-op — the failure direction
-- this repo has been burned by.
do $mig$
declare
  src text;
  out_src text;
begin
  -- (1) roster: a detector outside mon_run_all_detectors is decoration.
  select pg_get_functiondef(oid) into src from pg_proc
   where proname = 'mon_run_all_detectors' and pronamespace = 'public'::regnamespace;
  if src is null then
    raise exception 'mon_run_all_detectors not found';
  end if;
  if position('mon_detect_oracle_never_retires' in src) > 0 then
    raise notice 'roster already carries mon_detect_oracle_never_retires';
  else
    if position('''mon_detect_oracle_chain_never_observed'',' in src) = 0 then
      raise exception 'roster anchor mon_detect_oracle_chain_never_observed not found';
    end if;
    out_src := replace(src,
      '''mon_detect_oracle_chain_never_observed'',',
      '''mon_detect_oracle_chain_never_observed'',' || chr(10)
        || '    ''mon_detect_oracle_never_retires'',');
    execute out_src;
  end if;

  -- (2) UNKNOWN is not an observation.
  select pg_get_functiondef(oid) into src from pg_proc
   where proname = 'mon_detect_oracle_chain_never_observed' and pronamespace = 'public'::regnamespace;
  if src is null then
    raise exception 'mon_detect_oracle_chain_never_observed not found';
  end if;
  if position('count(*) filter (where verdict in (''GONE'',''LIVE'')) as verdicts' in src) > 0 then
    raise notice 'oracle_chain_never_observed already counts affirmative verdicts only';
  else
    if position('count(*) as verdicts,' in src) = 0 then
      raise exception 'verdict-count anchor not found in mon_detect_oracle_chain_never_observed';
    end if;
    out_src := replace(src, 'count(*) as verdicts,',
      'count(*) filter (where verdict in (''GONE'',''LIVE'')) as verdicts,');
    execute out_src;
  end if;
end
$mig$;
