-- The UNFILTERED per-platform oracle facts, so the judgement can be checked rather than trusted.
--
-- mon_oracle_never_retires() returns only the platforms it FLAGS, which is the right shape for the
-- detector and the wrong shape for verifying it: from the flagged set alone you cannot tell a
-- correct rule from one that flags nothing, and "flags nothing" is exactly how this defect hid for
-- four days. This function returns every oracle-claiming platform with its raw counts, so
-- scripts/verify-oracle-never-retires-live.ts can apply the SHARED TypeScript predicate
-- (scripts/lib/oracleRetirement.ts) to the same inputs the SQL saw and assert the two agree on the
-- whole fleet — SQL and TS bonded, neither able to drift into being the only one that is right.

create or replace function public.mon_oracle_retirement_facts()
returns table(platform text, strategy text, active bigint,
              asks bigint, affirmative bigint, unknown_asks bigint)
language sql stable security definer set search_path = public as $fn$
  with ev as (
    select split_part(p.source_table, '_', 1) as platform,
           count(*)                                              as asks,
           count(*) filter (where p.verdict in ('GONE','LIVE'))  as affirmative,
           count(*) filter (where p.verdict = 'UNKNOWN')         as unknown_asks
      from public.ops_stale_inactivation_probe p
     where p.oracle = 'prune_unseen.verify_gone'
     group by 1
  )
  select c.platform, c.strategy, c.active,
         coalesce(e.asks, 0), coalesce(e.affirmative, 0), coalesce(e.unknown_asks, 0)
    from public.ops_platform_liveness_coverage c
    left join ev e on e.platform = c.platform
   where c.strategy in ('DIRECT_REVISIT','CANDIDATE_PLUS_DIRECT');
$fn$;

comment on function public.mon_oracle_retirement_facts() is
  'Unfiltered verify_gone oracle counts per oracle-claiming platform. The evidence behind '
  'mon_oracle_never_retires(); exists so a live check can re-derive that verdict with the shared '
  'predicate instead of trusting it (routine #3, 2026-09-26).';
