-- served_after_source_gone asserted source confirmation it never had.
--
-- The view's predicate was purely `missing_count >= 3 and last_seen_at < now() - 3 days` — CRAWL
-- ABSENCE. It never consulted last_verified_alive_at, yet the detector is named
-- ..._source_confirmed_gone and its message told the reader that "the source no longer serves"
-- these rows and that the only thing between users and a clean index was a stuck deletion path.
-- The deletion_spike alert then offers the matching remedy: "raise anomaly_floor above it".
--
-- Measured 2026-08-31 on wasalt_residential_listings: 3,367 struck-active rows, still_served
-- 3,364 — and ALL 3,367 carry last_verified_alive_at IS NULL. verified_ever is 0 across all
-- 54,054 active wasalt rows, i.e. wasalt's DIRECT_REVISIT oracle has never once succeeded (it
-- needs WASALT_PROXY_URL; a datacenter IP gets HTTP 403, which liveness_policies.py documents as
-- UNKNOWN and "must never be read as death"). Those rows are UNKNOWN, not DEAD. Draining that
-- backlog would have been a 3,364-row mass FALSE inactivation, and the guard that keeps aborting
-- is correct.
--
-- docs/ops/LISTING_LIVENESS.md: liveness is THREE-valued; absence from our crawl is a candidate
-- signal and never a verdict; only a DIRECT fetch of the listing's own URL can kill. A barrier
-- that collapses UNKNOWN into DEAD in its own alert text pushes the next reader across exactly
-- that line. Per §19 the measurement was the likelier defect, and it was.
--
-- The gate is NOT weakened: every table that was reported is still reported, at P1 whenever rows
-- are still served, and nothing is auto-resolved. What changes is that the finding now carries the
-- evidence class it actually has, and the drain hint appears ONLY where a working oracle makes a
-- drain meaningful.

drop view if exists public.mon_served_after_source_gone;

create view public.mon_served_after_source_gone as
select
  z.tbl as source_table,
  split_part(z.tbl::text, '_', 1) as platform,
  reg.strategy,
  z.struck_active,
  z.still_served,
  z.struck_direct_verified,
  z.oracle_verifications,
  -- The discriminator. A table whose direct oracle has NEVER produced a single verification
  -- cannot have produced a death verdict either, so every strike on it is crawl absence.
  (z.oracle_verifications > 0) as oracle_has_ever_worked
from (
  select t.tbl,
    (xpath('/row/a/text()', query_to_xml(format(
      'select count(*) a from public.%I where active and coalesce(missing_count,0) >= 3 '
      'and last_seen_at < now() - interval ''3 days''', t.tbl), false, true, '')))[1]::text::bigint
      as struck_active,
    (xpath('/row/a/text()', query_to_xml(format(
      'select count(*) a from public.%I c join public.search_listings_ar s '
      '  on s.source_table = %L and s.listing_id = c.id '
      ' where c.active and coalesce(c.missing_count,0) >= 3 '
      '   and c.last_seen_at < now() - interval ''3 days'' and s.production_ready',
      t.tbl, t.tbl), false, true, '')))[1]::text::bigint as still_served,
    -- Struck rows a direct fetch DID once prove alive: a later strike on these is meaningful,
    -- because the oracle demonstrably reaches this platform.
    (xpath('/row/a/text()', query_to_xml(format(
      'select count(*) a from public.%I where active and coalesce(missing_count,0) >= 3 '
      'and last_seen_at < now() - interval ''3 days'' and last_verified_alive_at is not null',
      t.tbl), false, true, '')))[1]::text::bigint as struck_direct_verified,
    (xpath('/row/a/text()', query_to_xml(format(
      'select count(*) a from public.%I where last_verified_alive_at is not null', t.tbl),
      false, true, '')))[1]::text::bigint as oracle_verifications
  from (
    select c.relname as tbl
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r'
       and c.relname ~ '_(residential|commercial)_listings$'
  ) t
) z
left join public.ops_liveness_registry reg
       on reg.platform = split_part(z.tbl::text, '_', 1)
where z.struck_active > 0;

create or replace function public.mon_detect_served_after_source_confirmed_gone()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  n int := 0;
  r record;
  seen text[] := array[]::text[];
begin
  for r in select * from public.mon_served_after_source_gone order by still_served desc loop
    seen := seen || r.source_table;

    if r.oracle_has_ever_worked then
      -- A working direct oracle exists for this platform, so a full-grace strike is real evidence
      -- and a stuck deletion path is the likely cause. Unchanged from the original contract.
      n := n + public.mon_raise(
        case when r.still_served > 0 then 'P1' else 'P2' end,
        'served_after_source_gone', r.platform,
        'served_after_source_gone:' || r.source_table,
        jsonb_build_object(
          'source_table', r.source_table,
          'evidence_class', 'DIRECT_VERIFICATION_AVAILABLE',
          'strategy', r.strategy,
          'struck_active', r.struck_active,
          'still_served', r.still_served,
          'struck_direct_verified', r.struck_direct_verified,
          'oracle_verifications', r.oracle_verifications,
          'why', 'These rows carry the FULL strike grace and have not been seen for 3+ days, yet '
                 'they are still active and ' || r.still_served || ' of them are production_ready '
                 '— real users can find and click a listing the source may no longer serve. This '
                 'platform''s direct oracle DOES work (' || r.oracle_verifications || ' rows carry '
                 'a real verification), so a stuck deletion path is the likely cause: a liveness '
                 'kill-cap/anomaly gate refusing the batch, a prune circuit breaker, or a disabled '
                 'cleanup policy. DIAGNOSE THAT — do NOT loosen the cap to clear the backlog. '
                 'Actioning a batch this size is a bulk listing operation and an owner decision '
                 '(AGENTS.md RED list); the guard refusing it is working as designed. Confirm each '
                 'row against the source before it is actioned: only the ' ||
                 r.struck_direct_verified || ' struck_direct_verified rows have ever been reached '
                 'directly.'));
    else
      -- NO oracle has ever succeeded here. Every strike is crawl absence, which
      -- docs/ops/LISTING_LIVENESS.md rules is a candidate signal and NEVER a verdict. The backlog
      -- is UNKNOWN, not dead, and the remedy is upstream: make the oracle work.
      n := n + public.mon_raise(
        'P1',
        'served_after_source_gone', r.platform,
        'served_after_source_gone:' || r.source_table,
        jsonb_build_object(
          'source_table', r.source_table,
          'evidence_class', 'NO_DIRECT_VERIFICATION_EVER',
          'strategy', r.strategy,
          'struck_active', r.struck_active,
          'still_served', r.still_served,
          'struck_direct_verified', r.struck_direct_verified,
          'oracle_verifications', 0,
          'why', 'READ THIS BEFORE ACTIONING ANYTHING. ' || r.struck_active || ' rows carry the '
                 'full strike grace, but NOT ONE row in this table has ever been verified alive by '
                 'a direct fetch (last_verified_alive_at is null everywhere). The declared strategy '
                 'is ' || coalesce(r.strategy, 'UNREGISTERED') || ', so these strikes came from '
                 'CRAWL ABSENCE alone — which LISTING_LIVENESS rules is a candidate signal and '
                 'NEVER a verdict. These rows are UNKNOWN, not gone, and inactivating them would '
                 'be a mass FALSE inactivation. A deletion_spike/anomaly gate aborting on this '
                 'backlog is CORRECT: do NOT raise anomaly_floor and do NOT force a drain. The '
                 'real defect is upstream — the direct oracle for this platform has never once '
                 'succeeded. Fix that (for wasalt: WASALT_PROXY_URL; a datacenter IP returns HTTP '
                 '403, which is UNKNOWN and must never be read as death), then re-assess.'));
    end if;
  end loop;

  perform public.mon_resolve_key('served_after_source_gone', 'served_after_source_gone:' || t.relname)
    from pg_class t join pg_namespace ns on ns.oid = t.relnamespace
   where ns.nspname = 'public' and t.relkind = 'r'
     and t.relname ~ '_(residential|commercial)_listings$'
     and not (t.relname = any(seen));

  return n;
end $function$;
