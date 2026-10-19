-- THE STRIKE COUNTER IS NOT EVIDENCE. mon_unverified_inactivation_counts() now reads the ledgers.
--
-- Since 2026-07-28 a deactivation counted as UNVERIFIED only when coalesce(missing_count,0) < 3, so a
-- statement that set active=false together with missing_count=3 was invisible to this monitor and to
-- auto_recover_false_inactive(), with or without a page reading behind it, and an evidenced hide
-- whose counter stayed under 3 raised a false P1 (653 gathern rows, 2026-09-28).
--
-- NEW RULE. A deactivation is VERIFIED when a ledger row for THAT listing says gone, stamped between
-- 96 hours before and 15 minutes after its deactivated_at, and not older than the listing's newest
-- alive reading: ops_stale_inactivation_probe (GONE or SUPERSEDED, by listing_id or ad_number),
-- aqar_liveness_detail / dealapp_liveness_detail (kill, applied), gathern_liveness_detail (kill or
-- dead_confirmed, applied; gathern_residential_listings only). On SOURCE_LIST_PRESENCE and
-- CRAWL_PRESENCE_ONLY platforms, which hide on three complete-crawl misses and are graded by
-- mon_detect_unknown_treated_as_dead(), only rows with missing_count < 3 are counted. The twin split
-- (a copy whose listing_url is still active in the sibling table) is unchanged.
--
-- MEASURED read-only on production 2026-10-02 (303 tables, 47,229 hides in 7 days): last 24 h old
-- 0 unverified / 205 deduplicated, new 66 / 205; last 7 d old 653 / 216, new 67 / 216. The 66 are
-- aqar_residential rows hidden 01:07-01:10 UTC by sweep shard id%16=7, which died before flushing its
-- kill rows (a real finding; the P1 it raises is correct). Tolerances measured: the latest ledger row
-- after a hide was 2 min 02 s; the oldest reading applied by a bulk hide was 3 d 09 h (dealapp).
-- Cost: 1.77 s for the 24 h window on the whole fleet (old function 1.34 s).
-- mon_detect_unverified_inactivation() is replaced with the same logic, kinds, keys and thresholds;
-- only its contract, hint and P2 wording change to describe the ledgers. Full measurement and
-- evidence map: the pull request that mirrors this file.
-- Precondition checked at apply time: live md5 364f925e0c9a85a1b5198bd5c9ef2933 (counts) and
-- f30c15131f1adffb940a73cea6ebf210 (detect).
create or replace function public.mon_unverified_inactivation_counts(p_since interval)
 returns table(unverified bigint, deduplicated bigint)
 language plpgsql
 stable
 security definer
 set search_path to 'public'
as $function$
begin
  return query
  with t as (
    select tablename,
           case when tablename like '%\_commercial\_listings' then
                  regexp_replace(tablename, '_commercial_listings$', '_residential_listings')
                else regexp_replace(tablename, '_residential_listings$', '_commercial_listings') end as sibling
      from pg_tables
     where schemaname = 'public' and tablename ~ '_(residential|commercial)_listings$'
  ), s as (
    select t.tablename, t.sibling,
           exists (select 1 from pg_tables p where p.schemaname = 'public' and p.tablename = t.sibling) as sib_exists,
           exists (select 1 from public.ops_liveness_registry g
                    where g.platform = regexp_replace(t.tablename, '_(residential|commercial)_listings$', '')
                      and g.strategy in ('SOURCE_LIST_PRESENCE', 'CRAWL_PRESENCE_ONLY')) as absence_tier
      from t
  ), counted as (
    select (xpath('/row/n/text()', d.doc))[1]::text::bigint as n,
           (xpath('/row/n_twin/text()', d.doc))[1]::text::bigint as n_twin
      from s,
      lateral (
        select query_to_xml(format($q$
          select count(*) filter (where not y.twin and not y.superseded) as n,
                 count(*) filter (where y.twin) as n_twin
            from (
              select %5$s as twin,
                     (exists (select 1 from public.ops_stale_inactivation_probe p
                               where p.source_table = %1$L and p.listing_id = x.id and p.verdict = 'SUPERSEDED'
                                 and p.probed_at between x.deactivated_at - interval '96 hours'
                                                     and x.deactivated_at + interval '15 minutes'
                                 and p.probed_at >= v.alive_at)
                      or exists (select 1 from public.ops_stale_inactivation_probe p
                                  where p.source_table = %1$L and p.ad_number = x.ad_number and p.verdict = 'SUPERSEDED'
                                    and p.probed_at between x.deactivated_at - interval '96 hours'
                                                        and x.deactivated_at + interval '15 minutes'
                                    and p.probed_at >= v.alive_at)) as superseded
                from public.%1$I x
               cross join lateral (
                 select coalesce(greatest(x.last_verified_alive_at,
                          (select max(l.probed_at) from public.ops_stale_inactivation_probe l
                            where l.source_table = %1$L and l.listing_id = x.id
                              and l.verdict = 'LIVE' and l.probed_at <= x.deactivated_at),
                          (select max(l.probed_at) from public.ops_stale_inactivation_probe l
                            where l.source_table = %1$L and l.ad_number = x.ad_number
                              and l.verdict = 'LIVE' and l.probed_at <= x.deactivated_at)), '-infinity') as alive_at
               ) v
               where x.active = false
                 and x.deactivated_at >= now() - %2$L::interval
                 and not exists (select 1 from public.ops_adjudicated_listing j
                                  where j.tbl = %1$L and j.listing_id = x.id)
                 %3$s
                 and not exists (select 1 from public.ops_stale_inactivation_probe p
                                  where p.source_table = %1$L and p.listing_id = x.id and p.verdict = 'GONE'
                                    and p.probed_at between x.deactivated_at - interval '96 hours'
                                                        and x.deactivated_at + interval '15 minutes'
                                    and p.probed_at >= v.alive_at)
                 and not exists (select 1 from public.ops_stale_inactivation_probe p
                                  where p.source_table = %1$L and p.ad_number = x.ad_number and p.verdict = 'GONE'
                                    and p.probed_at between x.deactivated_at - interval '96 hours'
                                                        and x.deactivated_at + interval '15 minutes'
                                    and p.probed_at >= v.alive_at)
                 and not exists (select 1 from public.aqar_liveness_detail a
                                  where a.source_table = %1$L and a.listing_id = x.id
                                    and a.verdict = 'kill' and a.applied
                                    and a.run_at between x.deactivated_at - interval '96 hours'
                                                     and x.deactivated_at + interval '15 minutes'
                                    and a.run_at >= v.alive_at)
                 and not exists (select 1 from public.dealapp_liveness_detail a
                                  where a.source_table = %1$L and a.listing_id = x.id
                                    and a.verdict = 'kill' and a.applied
                                    and a.run_at between x.deactivated_at - interval '96 hours'
                                                     and x.deactivated_at + interval '15 minutes'
                                    and a.run_at >= v.alive_at)
                 %4$s
              offset 0
            ) y
        $q$,
          s.tablename,
          p_since,
          case when s.absence_tier then 'and coalesce(x.missing_count,0) < 3' else '' end,
          case when s.tablename = 'gathern_residential_listings' then $g$
                 and not exists (select 1 from public.gathern_liveness_detail g
                                  where g.listing_id = x.id
                                    and g.verdict in ('kill', 'dead_confirmed') and g.applied
                                    and g.run_at between x.deactivated_at - interval '96 hours'
                                                     and x.deactivated_at + interval '15 minutes'
                                    and g.run_at >= v.alive_at)$g$
               else '' end,
          case when s.sib_exists then
                 format('exists (select 1 from public.%I y where y.listing_url = x.listing_url and y.active)', s.sibling)
               else 'false' end
        ), false, true, '') as doc
        offset 0
      ) d
  )
  select coalesce(sum(c.n), 0)::bigint, coalesce(sum(c.n_twin), 0)::bigint from counted c;
end $function$;

-- Same detector, same kinds, same dedup keys, same thresholds, same auto-resolve. Only the words
-- that tell the reader what the number means are changed, to match the function above.
create or replace function public.mon_detect_unverified_inactivation()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare n int := 0; cnt int; dedup int;
begin
  select unverified_inactivations_24h, deduplicated_copies_24h
    into cnt, dedup
    from public.mon_unverified_inactivations_24h;

  if coalesce(cnt, 0) > 0 then
    -- Day-scoped dedup key: one alert per breach-day; a resolved alert never blocks a new day's breach.
    n := public.mon_raise('P1', 'unverified_inactivation', 'all',
      'unverified_inactivation:' || current_date,
      jsonb_build_object('count_24h', cnt,
        'deduplicated_copies_24h', dedup,
        'contract', 'every hide carries its evidence (docs/ops/LISTING_LIVENESS.md): a listing set active=false with no ledger row for THAT listing stamped from 96 hours before to 15 minutes after its deactivated_at is unverified. The strike counter missing_count is not evidence.',
        'excluded', 'deduplicated_copies_24h rows are NOT counted above: each one''s listing_url is still ACTIVE in the same platform''s sibling table, so the listing never left searchable inventory (res/com collision repair). Decided per row against live state, never a waiver list.',
        'hint', 'per-row detail: rows with active=false and deactivated_at in the last 24 h that have NO row in any of the four ledgers stamped between deactivated_at - 96 hours and deactivated_at + 15 minutes: ops_stale_inactivation_probe (verdict GONE or SUPERSEDED, matched on source_table + listing_id or source_table + ad_number, column probed_at); aqar_liveness_detail and dealapp_liveness_detail (verdict kill and applied, source_table + listing_id, column run_at); gathern_liveness_detail (verdict kill or dead_confirmed and applied, listing_id, column run_at, gathern_residential_listings only). A ledger row older than the listing''s newest alive reading (last_verified_alive_at, or a LIVE row in ops_stale_inactivation_probe probed at or before the hide) does not count. On a platform registered SOURCE_LIST_PRESENCE or CRAWL_PRESENCE_ONLY only rows with missing_count < 3 are counted; on every other platform missing_count says nothing. Group the rows by table and by exact deactivated_at to find the job that hid them. Ready query: docs/ops/LIFECYCLE_ENGINEER.md, section «Lessons from real breakages».'));
  end if;

  -- The escape hatch may not become the road. If de-duplication accounts for most of the day's
  -- deactivations, that is a finding about the collision repair, not something to absorb quietly.
  if coalesce(dedup, 0) >= 5 and coalesce(dedup, 0) >= coalesce(cnt, 0) then
    n := n + public.mon_raise('P2', 'deduplicated_copy_flood', 'all',
      'deduplicated_copy_flood:' || current_date,
      jsonb_build_object('deduplicated_copies_24h', dedup, 'unverified_inactivations_24h', cnt,
        'why', 'Most of today''s deactivations with no ledger row of their own were duplicate copies whose URL stays active in the sibling table. Individually benign, but at this rate the res/com classifier is misfiling listings on ingest and should be looked at.'));
  end if;

  -- Point-in-time events: auto-resolve after ~2 days, same pattern as mass_inactivation.
  update public.alert_event set resolved_at = now()
   where kind in ('unverified_inactivation', 'deduplicated_copy_flood') and resolved_at is null
     and created_at < now() - interval '2 days';

  return n;
end $function$;
