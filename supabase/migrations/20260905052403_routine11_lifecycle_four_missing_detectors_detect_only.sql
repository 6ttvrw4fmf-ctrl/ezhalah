-- ROUTINE #11 ♻️ LISTING LIFECYCLE — the four missing detectors (incident #25).
--
-- Until this migration, none of routine #11's alert kinds had a detector behind them:
-- scripts/lib/alertRouting.ts routes `inactive_still_searchable`, `inactive_still_counted`,
-- `unknown_treated_as_dead` and `deletion_clock_*` to routine-11-lifecycle, and migration
-- 20260905022312 named them, but no mon_raise() anywhere emitted one. The queue was
-- addressable and unfillable.
--
-- ALL FOUR ARE DETECT-ONLY. They raise and resolve alerts. Not one of them writes to a
-- listing table, and none of them may ever be given permission to: what stands at the end
-- of this lifecycle is a permanent, unrecoverable delete (docs/ops/LISTING_LIFECYCLE_ENGINEER.md §0).
--
-- Each resolves on its EVALUATED path via mon_resolve_stale_keys(), so the kinds are
-- clearable (mon_detect_unresolvable_alert_kinds) and none needs an
-- ops_alert_kind_autoresolve registration. Each is added to mon_run_all_detectors() in this
-- same migration — a detector outside the roster is decoration and mon_detect_orphaned_detectors()
-- fires on it (AGENTS.md).

-- ---------------------------------------------------------------------------------------
-- 1. The propagation cutoff — what "immediately" actually means on this chain.
-- ---------------------------------------------------------------------------------------
-- A deactivation does NOT reach search_listings_ar instantly, and that latency is normal
-- rather than a defect (LISTING_LIFECYCLE_ENGINEER.md §2.3). The chain is
--   raw.active=false  ->  REFRESH active_listing_ids_v2  ->  sync_search_listings_ar()
-- and in production those two jobs run in the "wrong" order within the hour (sync at :14,
-- refresh at :20), so a row deactivated at 04:25 legitimately survives the 05:14 sync and
-- only leaves the index at 06:14.
--
-- Rather than pick a magic grace interval, this reads what actually ran: the newest
-- successful sync, and the newest successful matview refresh that COMPLETED BEFORE it.
-- Any deactivation older than that timestamp has had one full refresh+sync cycle to take
-- effect. A leak that outlives it is a defect, not latency.
--
-- Jobs are resolved by what their command touches, not by jobid or jobname, so a renamed or
-- recreated cron entry does not silently blind the detector (a NULL cutoff suppresses the
-- alert, and the staleness guard in mon_detect_inactive_still_searchable() reports that
-- blindness loudly instead of reading as clean).
create or replace function public.ops_lifecycle_propagation_cutoff()
returns timestamptz
language sql
stable
security definer
set search_path = public
as $fn$
  with j as (
    select (select min(jobid) from cron.job where command ilike '%active_listing_ids_v2%')   as refresh_jobid,
           (select min(jobid) from cron.job where command ilike '%sync_search_listings_ar%') as sync_jobid
  ),
  last_sync as (
    select max(d.end_time) as ts
      from cron.job_run_details d, j
     where d.jobid = j.sync_jobid and d.status = 'succeeded'
  )
  select max(d.end_time)
    from cron.job_run_details d, j, last_sync ls
   where d.jobid = j.refresh_jobid
     and d.status = 'succeeded'
     and ls.ts is not null
     and d.end_time < ls.ts;
$fn$;

comment on function public.ops_lifecycle_propagation_cutoff() is
  'Routine #11. The newest active_listing_ids_v2 refresh that completed before the newest '
  'successful sync_search_listings_ar run. A listing deactivated before this instant has had '
  'one COMPLETE refresh+sync cycle to leave the served index; still being served after it is a '
  'defect, not propagation latency. Derived from recorded cron history — no magic grace interval.';

-- ---------------------------------------------------------------------------------------
-- 2. The shared leak resolver — ONE scope, read by both surface detectors.
-- ---------------------------------------------------------------------------------------
-- "A count surface must share the results scope — same resolver, never a second copy"
-- (LISTING_LIFECYCLE_ENGINEER.md §2.4). The same rule applies to the two detectors that
-- watch those surfaces: `inactive_still_searchable` and `inactive_still_counted` are two
-- claims about ONE set, so they read one function rather than two hand-kept copies that
-- can drift apart.
--
-- Candidates come from the aliveness matview (every arm of active_listing_ids_v2 is
-- "... WHERE active IS TRUE", so a deactivated row is dropped by the next refresh), and each
-- candidate is then CONFIRMED against its raw row. Rows whose raw row is gone entirely are
-- deliberately skipped: that is a hard-delete orphan, which mon_detect_orphaned_search_row()
-- already owns.
create or replace function public.ops_lifecycle_inactive_still_searchable()
returns table (source_table text, listing_id bigint, deactivated_at timestamptz,
               city_id integer, deal_ar text)
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_cut timestamptz;
  r     record;
begin
  v_cut := public.ops_lifecycle_propagation_cutoff();
  if v_cut is null then
    return;  -- cannot date a full cycle; the caller's staleness guard reports the blindness
  end if;

  for r in
    select distinct s.source_table as st
      from public.search_listings_ar s
      left join public.active_listing_ids_v2 m
        on m.source_table = s.source_table and m.listing_id = s.listing_id
     where m.listing_id is null
  loop
    -- A served table with no `active` column cannot be adjudicated here; skip rather than
    -- crash the sweep. (No such table exists today; this is defence, not a known case.)
    if not exists (select 1 from information_schema.columns c
                    where c.table_schema = 'public' and c.table_name = r.st
                      and c.column_name = 'active') then
      continue;
    end if;

    return query execute format($q$
      select %1$L::text, s.listing_id, t.deactivated_at, s.city_id, s.deal_ar
        from public.search_listings_ar s
        left join public.active_listing_ids_v2 m
          on m.source_table = s.source_table and m.listing_id = s.listing_id
        join public.%1$I t on t.id = s.listing_id
       where s.source_table = %1$L
         and m.listing_id is null
         and t.active is not true
         and (t.deactivated_at is null or t.deactivated_at < %2$L::timestamptz)
    $q$, r.st, v_cut);
  end loop;
end;
$fn$;

comment on function public.ops_lifecycle_inactive_still_searchable() is
  'Routine #11 shared resolver. Rows still present in search_listings_ar whose raw row is '
  'active=false and whose deactivation already outlived one complete refresh+sync cycle. '
  'Read by BOTH mon_detect_inactive_still_searchable() and mon_detect_inactive_still_counted() '
  'so the results scope and the count scope can never be two different copies.';

-- ---------------------------------------------------------------------------------------
-- 3. inactive_still_searchable — a confirmed-inactive row a user can still be shown.
-- ---------------------------------------------------------------------------------------
create or replace function public.mon_detect_inactive_still_searchable()
returns integer
language plpgsql
security definer
set search_path = public
as $fn$
declare
  n     int := 0;
  live  text[] := '{}';
  r     record;
  v_cut timestamptz;
  v_mv  timestamptz;
begin
  v_cut := public.ops_lifecycle_propagation_cutoff();
  v_mv  := (select max(refreshed_at) from public.mon_mv_refresh_log
             where object_name = 'active_listing_ids_v2');

  -- A monitor that cannot see is not a clean bill of health (AGENTS.md). If the aliveness
  -- matview has not refreshed, every deactivation since then is still being served and this
  -- detector's candidate generator is blind — say so instead of returning 0.
  if v_cut is null or v_mv is null or v_mv < now() - interval '3 hours' then
    live := live || 'inactive_still_searchable:BLIND';
    n := n + public.mon_raise('P1', 'inactive_still_searchable', 'search',
      'inactive_still_searchable:BLIND',
      jsonb_build_object(
        'blind', true,
        'last_matview_refresh', v_mv,
        'propagation_cutoff', v_cut,
        'why', 'This detector finds confirmed-inactive rows still served by search_listings_ar '
            || 'by comparing the served index against active_listing_ids_v2. That matview has '
            || 'not refreshed recently (or no complete refresh+sync cycle can be dated from '
            || 'cron history), so the comparison proves nothing and a 0 here would be a lie: '
            || 'every listing deactivated since the last refresh is STILL BEING SERVED.',
        'action', 'Fix the refresh/sync chain first (mon_detect_stale_refresh, '
            || 'mon_detect_search_index_freshness own that half). Do NOT deactivate or delete '
            || 'anything in response to this alert.'));
    perform public.mon_resolve_stale_keys('inactive_still_searchable', live);
    return n;
  end if;

  for r in
    select l.source_table,
           count(*)                                as leaked,
           min(l.deactivated_at)                   as oldest_deactivation,
           (array_agg(l.listing_id order by l.listing_id))[1:20] as sample_ids
      from public.ops_lifecycle_inactive_still_searchable() l
     group by l.source_table
  loop
    live := live || ('inactive_still_searchable:' || r.source_table);
    n := n + public.mon_raise('P1', 'inactive_still_searchable',
      regexp_replace(r.source_table, '_(residential|commercial)_listings$', ''),
      'inactive_still_searchable:' || r.source_table,
      jsonb_build_object(
        'source_table', r.source_table,
        'leaked_rows', r.leaked,
        'oldest_deactivation', r.oldest_deactivation,
        'propagation_cutoff', v_cut,
        'sample_listing_ids', to_jsonb(r.sample_ids),
        'why', 'These rows are active=false in their source table but are STILL returned by '
            || 'location_search_candidates_ar, because they are still in search_listings_ar. '
            || 'This is not propagation latency: their deactivation predates a COMPLETE '
            || 'refresh(active_listing_ids_v2)+sync(search_listings_ar) cycle, so the pipeline '
            || 'has already had its chance to remove them. The owner rule is that a '
            || 'source-confirmed removed listing stops being visible immediately.',
        'likely_cause', 'The sync DELETE leg aborted. sync_search_listings_ar() refuses to '
            || 'delete when the absent-row count exceeds greatest(2000, 15%) and writes a '
            || 'sync_delete_circuit_breaker row to location_pipeline_alerts instead — check '
            || 'there first. prune_inactive_from_search() is the second remover in that body.',
        'action', 'Repair ordering is raw -> matview -> sync -> verify. Writing '
            || 'search_listings_ar directly is NOT durable and reverts on the next sync. '
            || 'Do NOT respond by deleting listings.'));
  end loop;

  perform public.mon_resolve_stale_keys('inactive_still_searchable', live);
  return n;
end;
$fn$;

-- ---------------------------------------------------------------------------------------
-- 4. inactive_still_counted — the number the user is shown includes dead inventory.
-- ---------------------------------------------------------------------------------------
-- A distinct claim from #3: a leaked row is not only reachable, it INFLATES the counts that
-- promise how much inventory exists. top_cities_by_deal_ar(), district_options_ar(),
-- apartment_guided_counts_ar() and property_age_option_counts_ar() all count
-- search_listings_ar rows grouped by city, so every leaked row with a city_id is an
-- over-count on a surface the user reads as a promise (the الهفوف shape: 2,478 promised,
-- 109 delivered). Rows with a NULL city_id are excluded — they are outside those cohorts.
create or replace function public.mon_detect_inactive_still_counted()
returns integer
language plpgsql
security definer
set search_path = public
as $fn$
declare
  n    int := 0;
  live text[] := '{}';
  r    record;
begin
  for r in
    with per_city as (
      select l.source_table, l.city_id, count(*) as c
        from public.ops_lifecycle_inactive_still_searchable() l
       where l.city_id is not null
       group by 1, 2
    )
    select p.source_table,
           sum(p.c)::bigint             as inflated_by,
           count(*)::int                as cities_affected,
           jsonb_object_agg(p.city_id::text, p.c) as by_city
      from per_city p
     group by p.source_table
  loop
    live := live || ('inactive_still_counted:' || r.source_table);
    n := n + public.mon_raise('P1', 'inactive_still_counted',
      regexp_replace(r.source_table, '_(residential|commercial)_listings$', ''),
      'inactive_still_counted:' || r.source_table,
      jsonb_build_object(
        'source_table', r.source_table,
        'inflated_by', r.inflated_by,
        'cities_affected', r.cities_affected,
        'per_city_id', r.by_city,
        'why', 'Every count surface reads search_listings_ar with the SAME scope as the results '
            || 'resolver: top_cities_by_deal_ar (Trending), district_options_ar, '
            || 'apartment_guided_counts_ar, property_age_option_counts_ar. These rows are '
            || 'active=false at source yet still in that index, so each listed count for the '
            || 'affected cities is overstated by exactly this many listings. A count is a '
            || 'promise about deliverable inventory.',
        'action', 'Same root cause and same repair as inactive_still_searchable — fix the '
            || 'removal leg, never the count clause. Excluding dead rows in the count while '
            || 'leaving them in results would make the two scopes disagree, which is the '
            || 'second-worst outcome after both being wrong.'));
  end loop;

  perform public.mon_resolve_stale_keys('inactive_still_counted', live);
  return n;
end;
$fn$;

-- ---------------------------------------------------------------------------------------
-- 5. unknown_treated_as_dead — the rule that protects the irreversible path.
-- ---------------------------------------------------------------------------------------
-- Liveness is THREE-valued and UNKNOWN NEVER DEACTIVATES ANYTHING (LISTING_LIVENESS.md §1).
-- Only DIRECT evidence — a fetch of the listing's own URL — may kill (§2). Absence from a
-- crawl, a feed, a sitemap or an enumeration is EvidenceKind.ABSENCE and returns action="none".
--
-- Two shapes are reported, and both are read straight off the system's own declarations:
--
--   (a) The platform's declared liveness strategy in ops_liveness_registry is
--       CRAWL_PRESENCE_ONLY. That declaration says, in the registry's own words, that we only
--       know the ad was in the crawl — there is NO direct oracle for this platform. A
--       deactivation there therefore cannot rest on DIRECT evidence unless prune_unseen's
--       verify_gone oracle recorded a GONE verdict for that ad_number, which is checked.
--
--   (b) An explicit UNKNOWN verdict. prune_unseen writes verdict='UNKNOWN' when its oracle
--       could not decide, and a held strike must never deactivate. A row that is inactive
--       while its own most recent probe says UNKNOWN is the rule failing in the sharpest
--       possible way, so it is reported on ANY platform regardless of tier.
--
-- This does NOT duplicate mon_detect_prune_kill_without_source_verdict(), which iterates only
-- the three tables in ops_oracle_required_platform and asks a different question (was the
-- verify_gone wiring dropped?) and routes to routine #3. This one is platform-agnostic over
-- every CRAWL_PRESENCE_ONLY table and asks §0's question: was there any DIRECT evidence at all?
create or replace function public.mon_detect_unknown_treated_as_dead()
returns integer
language plpgsql
security definer
set search_path = public
as $fn$
declare
  n           int := 0;
  live        text[] := '{}';
  r           record;
  v_no_ev     bigint;
  v_unknown   bigint;
  v_total     bigint;
begin
  for r in
    select c.table_name as tbl,
           regexp_replace(c.table_name, '_(residential|commercial)_listings$', '') as platform,
           coalesce(g.strategy, '(unregistered)') as strategy
      from information_schema.columns c
      left join public.ops_liveness_registry g
        on g.platform = regexp_replace(c.table_name, '_(residential|commercial)_listings$', '')
     where c.table_schema = 'public'
       and c.column_name = 'deactivated_at'
       and c.table_name like '%\_listings'
       and coalesce(g.strategy, '(unregistered)') <> 'DIRECT_REVISIT'
       and coalesce(g.strategy, '(unregistered)') <> 'CANDIDATE_PLUS_DIRECT'
  loop
    execute format($q$
      select
        count(*) filter (where not exists (
          select 1 from public.ops_stale_inactivation_probe p
           where p.source_table = %1$L and p.ad_number = t.ad_number
             and p.verdict = 'GONE'
             and p.probed_at >= t.deactivated_at - interval '1 hour')),
        count(*) filter (where exists (
          select 1 from public.ops_stale_inactivation_probe p
           where p.source_table = %1$L and p.ad_number = t.ad_number
             and p.verdict = 'UNKNOWN'
             and p.probed_at >= t.deactivated_at - interval '1 hour')),
        count(*)
      from public.%1$I t
      where t.active = false and t.deactivated_at >= now() - interval '48 hours'
    $q$, r.tbl) into v_no_ev, v_unknown, v_total;

    if coalesce(v_no_ev, 0) > 0 or coalesce(v_unknown, 0) > 0 then
      live := live || ('unknown_treated_as_dead:' || r.tbl);
      n := n + public.mon_raise('P1', 'unknown_treated_as_dead', r.platform,
        'unknown_treated_as_dead:' || r.tbl,
        jsonb_build_object(
          'source_table', r.tbl,
          'liveness_strategy', r.strategy,
          'deactivated_48h', v_total,
          'without_direct_evidence', v_no_ev,
          'oracle_said_unknown', v_unknown,
          'why', 'UNKNOWN IS NOT DEAD. This platform declares liveness strategy "'
              || r.strategy || '" in ops_liveness_registry, which means we know only that the ad '
              || 'was (or was not) in our crawl — absence is EvidenceKind.ABSENCE and decide() '
              || 'returns action="none" for it, always. These rows were nevertheless set '
              || 'active=false, and no GONE verdict was recorded against their ad_number in '
              || 'ops_stale_inactivation_probe at the time. A timeout, a 403/429/5xx, a shell '
              || 'body, a parser failure or a crawl that simply did not run all look exactly '
              || 'like this.',
          'why_it_matters', 'A deactivation is recoverable. What follows it is not: '
              || 'the row now ages toward the 30-day retention window, and at the end of that '
              || 'window scrapers/common/cleanup.py deletes it permanently. Of 21,371 rows a '
              || 'legacy age-and-strike deleter removed, 10,617 left no source key at all and '
              || 'are unknowable in either direction.',
          'action', 'Re-probe the affected rows by DIRECT fetch of each listing''s own URL and '
              || 'RESTORE every one the source still serves (a restorative write is never gated). '
              || 'Then give the platform a real oracle — pass verify_gone= in its scraper, or move '
              || 'it off CRAWL_PRESENCE_ONLY. Do NOT resolve this by widening the crawl, relaxing '
              || 'the grace count, or deleting anything.',
          'boundary', 'mon_detect_prune_kill_without_source_verdict() asks a different question '
              || '(was verify_gone wiring dropped on an oracle-REQUIRED platform?) over only the '
              || 'three tables in ops_oracle_required_platform, and routes to routine #3. This '
              || 'detector is platform-agnostic and routes to routine-11-lifecycle.'));
    end if;
  end loop;

  perform public.mon_resolve_stale_keys('unknown_treated_as_dead', live);
  return n;
end;
$fn$;

-- ---------------------------------------------------------------------------------------
-- 6. deletion_clock_without_evidence — a row aging toward an irreversible delete on absence.
-- ---------------------------------------------------------------------------------------
-- The engine's eligibility predicate is `active=false AND missing_count >= min_missing_count
-- AND last_seen_at < cutoff`, and _age_days() measures from last_seen_at — a column that means
-- "a crawl encountered this row", not "the source said it is alive". missing_count is
-- accumulated by prune_unseen() from crawl ABSENCE. So the clock is not evidence-gated; only
-- the delete is, by the fresh per-row DIRECT re-probe (require_source_recheck).
--
-- Changing that predicate changes deletion semantics fleet-wide and is an OWNER decision
-- (ops_incident #24) — this detector deliberately does not change it. It makes the exposure
-- visible and attributable instead: how many rows are one guard away from a permanent delete
-- with no recorded source verdict of any kind behind them.
--
-- Scope: only platforms with platform_retention_policy.enabled = true, because only those
-- have a deleter that can actually run. Each platform's OWN thresholds are used, never a
-- hardcoded 30/3 — a barrier that pins today's numbers goes green the day someone changes them.
create or replace function public.mon_detect_deletion_clock_without_evidence()
returns integer
language plpgsql
security definer
set search_path = public
as $fn$
declare
  n        int := 0;
  live     text[] := '{}';
  r        record;
  v_unevid bigint;
  v_total  bigint;
  v_oldest timestamptz;
begin
  for r in
    select p.platform, c.table_name as tbl, p.min_inactive_days, p.min_missing_count,
           p.require_source_recheck,
           coalesce(g.strategy, '(unregistered)') as strategy
      from public.platform_retention_policy p
      join information_schema.columns c
        on c.table_schema = 'public' and c.column_name = 'deactivated_at'
       and c.table_name like p.platform || '\_%\_listings'
      left join public.ops_liveness_registry g on g.platform = p.platform
     where p.enabled
  loop
    execute format($q$
      select
        count(*) filter (where t.last_verified_alive_at is null
                           and not exists (
                             select 1 from public.ops_stale_inactivation_probe p
                              where p.source_table = %1$L and p.ad_number = t.ad_number
                                and p.verdict = 'GONE'
                                and p.probed_at >= t.deactivated_at - interval '1 hour')),
        count(*),
        min(t.last_seen_at)
      from public.%1$I t
      where t.active = false
        and coalesce(t.missing_count, 0) >= %2$s
        and t.last_seen_at < now() - (%3$s || ' days')::interval
    $q$, r.tbl, r.min_missing_count, r.min_inactive_days) into v_unevid, v_total, v_oldest;

    if coalesce(v_unevid, 0) > 0 then
      live := live || ('deletion_clock_without_evidence:' || r.tbl);
      n := n + public.mon_raise('P1', 'deletion_clock_without_evidence', r.platform,
        'deletion_clock_without_evidence:' || r.tbl,
        jsonb_build_object(
          'source_table', r.tbl,
          'liveness_strategy', r.strategy,
          'retention_window_days', r.min_inactive_days,
          'min_missing_count', r.min_missing_count,
          'require_source_recheck', r.require_source_recheck,
          'deletion_eligible_now', v_total,
          'eligible_without_any_source_verdict', v_unevid,
          'oldest_last_seen_at', v_oldest,
          'why', 'These rows satisfy the deletion engine''s eligibility predicate on this '
              || 'platform''s own thresholds, and NOTHING in the database records a source '
              || 'verdict about them: last_verified_alive_at is NULL (the source never once '
              || 'affirmed them alive) and no GONE probe exists for their ad_number. Their only '
              || 'signal is absence from our crawl, which LISTING_LIVENESS.md classifies as '
              || 'UNKNOWN and never as death.',
          'what_stands_between', case when r.require_source_recheck
              then 'One guard: the fresh per-row DIRECT re-probe at delete time '
                || '(require_source_recheck=true). It is doing its job — real runs reactivate a '
                || 'meaningful fraction — but it is ONE guard on an irreversible action.'
              else 'NOTHING. require_source_recheck is FALSE on this platform, so eligibility '
                || 'accumulated from absence leads straight to a permanent delete. This is a P0 '
                || 'shape; raise it to the owner immediately.' end,
          'owner_decision', 'Gating the CANDIDATE predicate on DIRECT evidence (rather than only '
              || 'the delete step) changes deactivation and deletion semantics for every '
              || 'platform. It is recorded as ops_incident #24 and is explicitly reserved to the '
              || 'owner. No routine may change it autonomously.',
          'do_not', 'Do NOT drain this backlog, raise a cap, lower a floor, or delete faster to '
              || 'make this number go down. A backlog that will not drain is evidence about the '
              || 'VERIFIER, not permission to delete (LISTING_LIVENESS.md §7). The way this alert '
              || 'goes green is more verification, never more deletion.'));
    end if;
  end loop;

  perform public.mon_resolve_stale_keys('deletion_clock_without_evidence', live);
  return n;
end;
$fn$;

-- ---------------------------------------------------------------------------------------
-- 7. ROSTER — same migration, per AGENTS.md. A detector outside it is decoration.
-- ---------------------------------------------------------------------------------------
-- Needle-edited from the LIVE function body rather than retyped: mon_run_all_detectors() is a
-- ~7KB array that several sessions extend concurrently, and rebuilding it from a stale copy is
-- exactly how mon_detect_unverified_inactivation went dark 8h after it was wired. The edit
-- asserts it actually matched, so a silent no-op cannot ship.
do $roster$
declare
  v_src text;
  v_new text;
begin
  select p.prosrc into v_src
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname = 'mon_run_all_detectors';

  if v_src is null then
    raise exception 'mon_run_all_detectors() not found — roster cannot be extended';
  end if;

  if position('mon_detect_inactive_still_searchable' in v_src) > 0 then
    raise notice 'roster already carries the routine-11 detectors; nothing to do';
    return;
  end if;

  v_new := replace(
    v_src,
    $old$'mon_detect_alert_queue_unworked'
  ]$old$,
    $new$'mon_detect_alert_queue_unworked',
    -- routine #11 ♻️ listing lifecycle (incident #25): detect-only, never write to a listing
    'mon_detect_inactive_still_searchable',
    'mon_detect_inactive_still_counted',
    'mon_detect_unknown_treated_as_dead',
    'mon_detect_deletion_clock_without_evidence'
  ]$new$);

  if v_new = v_src then
    raise exception 'roster needle did not match — mon_run_all_detectors() body changed shape; '
                    'refusing to leave four detectors orphaned outside the sweep';
  end if;

  -- Distinctive dollar-quote tag: the body being re-wrapped is 7KB of other people's SQL and
  -- must not be able to terminate its own quoting.
  if position('$mon_roster_body$' in v_new) > 0 then
    raise exception 'refusing to re-wrap mon_run_all_detectors(): its body contains the quote tag';
  end if;
  execute 'create or replace function public.mon_run_all_detectors() returns jsonb '
       || 'language plpgsql as $mon_roster_body$' || v_new || '$mon_roster_body$';
end;
$roster$;

-- The roster edit above is the whole point of doing this in one migration; assert it landed.
do $verify$
begin
  if (select position('mon_detect_deletion_clock_without_evidence'
                      in pg_get_functiondef(p.oid))
        from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
       where ns.nspname = 'public' and p.proname = 'mon_run_all_detectors') = 0 then
    raise exception 'roster verification failed: the four routine-11 detectors are not reachable '
                    'from mon_run_all_detectors()';
  end if;
end;
$verify$;
