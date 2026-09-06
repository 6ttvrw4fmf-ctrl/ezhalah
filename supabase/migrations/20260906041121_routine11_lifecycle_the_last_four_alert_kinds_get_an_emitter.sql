-- ROUTINE #11 ♻️ LISTING LIFECYCLE — the LAST four alert kinds get an emitter (ops_incident #25).
--
-- Migration 20260905052403 gave four of routine #11's declared alert kinds a detector. Five were
-- still decoration when this ran, measured against production 2026-09-06:
--
--   kind                            emitter
--   false_resurrection              (none)
--   orphan_after_delete             (none)
--   lifecycle_duplicate_stale_copy  (none)
--   deletion_clock_stalled          (none)
--   deletion_clock_unearned         (none — but its CLAIM is emitted as deletion_clock_without_evidence;
--                                    docs/ops/LISTING_LIFECYCLE_ENGINEER.md §4 row 7 is reconciled to
--                                    the shipped name in the same commit, rather than a second detector
--                                    being built for the same assertion under a second name.)
--
-- This migration builds the remaining four. All four are DETECT-ONLY: they raise and resolve alerts
-- and not one of them writes to a listing table, a location table or an index. What stands at the end
-- of this chain is a permanent, unrecoverable delete (LISTING_LIFECYCLE_ENGINEER.md §0), so a monitor
-- on it may never also be an actor on it.
--
-- Each detector's decision is a SEPARATE pure resolver (`ops_lifecycle_*`) from the raising wrapper
-- (`mon_detect_*`), the split migration 20260906021124 introduced, so the predicate can be executed
-- against an injected input and watched to catch a defect that is not currently present. Each wrapper
-- resolves on its EVALUATED path via mon_resolve_stale_keys(), so no kind needs an
-- ops_alert_kind_autoresolve registration and none can get stuck lit. Each is added to
-- mon_run_all_detectors() in this SAME migration — a detector outside the roster is decoration and
-- mon_detect_orphaned_detectors() fires on it (AGENTS.md).
--
-- WHAT THEY FOUND ON FIRST EVALUATION (production, 2026-09-06, before this shipped):
--   * orphan_after_delete            — 1,355 permanently deleted listings still present in
--                                      listing_native_location_v1 after a refresh that POST-DATES the
--                                      delete. Cause located: nv1's "legacy" arm reads
--                                      listings_arabic_locations, which is never cleaned when a raw row
--                                      is deleted (708 of 978 deleted gathern rows are still in it).
--   * deletion_clock_stalled         — aqar 18,519 / wasalt 7,662 / gathern 1,225 eligible rows whose
--                                      every run aborts on the anomaly breaker. The engine's own
--                                      abort_reason already says "a STANDING backlog above the floor
--                                      aborts every run and can never drain" — and nothing was
--                                      reporting it. aqar grew 4,921 → 18,519 in seven days.
--   * lifecycle_duplicate_stale_copy — 19 source URLs across 6 platforms present in BOTH the
--                                      residential and the commercial table, where one copy is inactive
--                                      and the other is active AND still served.
--   * false_resurrection             — clean (0). Its mutation proof is therefore an injected one.
--
-- None of those four findings is repaired here. Repairing them means writing to location tables, to a
-- retention threshold, or to a listing's active state — three different owners and, for the middle one,
-- an explicit owner decision (LISTING_LIVENESS.md §7: a backlog that will not drain is evidence about
-- the VERIFIER, never permission to delete). They are routed as incidents instead, which is what §G.3
-- says to do with a defect you can see and must not touch.

-- ---------------------------------------------------------------------------------------
-- 1. false_resurrection — the source said DEAD and the row is live again with nothing that said ALIVE.
-- ---------------------------------------------------------------------------------------
-- LISTING_LIFECYCLE_ENGINEER.md §4 barrier 5: "a row deactivated on DIRECT source-confirmed evidence is
-- not returned to active = true by auto_recover_false_inactive(), by a re-seen crawl, by prune_unseen()'s
-- reset-on-seen, or by pagination replaying a cached page. Only DIRECT ALIVE evidence, or a recorded
-- adjudication, may restore it."
--
-- The two facts the database actually records are: a DIRECT verdict in ops_stale_inactivation_probe, and
-- last_verified_alive_at, which LISTING_LIVENESS.md defines as "proven alive" and which only
-- scrapers/common/liveness_contract.py may write. last_seen_at is deliberately NOT consulted: "seen by
-- the crawler" is a different fact from "proven alive", and treating crawl presence as a resurrection
-- licence is precisely the defect this kind is named for.
--
-- The predicate takes the LATEST probe per ad_number and asks whether it is GONE — not "is there a GONE
-- somewhere in the history", which would keep firing on a listing the source has since re-confirmed.
--
-- p_inject appends synthetic probe rows to the SAME candidate set, before the same latest-verdict
-- filter, so a proof can ask "would you notice a resurrection?" without creating one. Injected rows are
-- flagged in the output and the raising wrapper never passes any.
create or replace function public.ops_lifecycle_false_resurrection(p_inject jsonb default '[]'::jsonb)
returns table (source_table text, ad_number text, listing_id bigint,
               gone_at timestamptz, last_verified_alive_at timestamptz, injected boolean)
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_inject jsonb := coalesce(p_inject, '[]'::jsonb);
  r        record;
begin
  for r in
    select s.st
      from (
        select p.source_table as st
          from public.ops_stale_inactivation_probe p
         where p.verdict = 'GONE' and p.ad_number is not null
         group by 1
        union
        select x->>'source_table'
          from jsonb_array_elements(v_inject) x
      ) s
     where s.st is not null
       and to_regclass('public.' || quote_ident(s.st)) is not null
       and (select count(*) from information_schema.columns c
             where c.table_schema = 'public' and c.table_name = s.st
               and c.column_name in ('ad_number', 'active', 'last_verified_alive_at', 'id')) = 4
  loop
    return query execute format($q$
      with all_probes as (
        select p.ad_number, p.verdict, p.probed_at, false as injected
          from public.ops_stale_inactivation_probe p
         where p.source_table = %1$L and p.ad_number is not null
        union all
        select x->>'ad_number', coalesce(x->>'verdict', 'GONE'), (x->>'probed_at')::timestamptz, true
          from jsonb_array_elements(%2$L::jsonb) x
         where x->>'source_table' = %1$L and x->>'ad_number' is not null
      ),
      latest as (
        select distinct on (a.ad_number) a.ad_number, a.verdict, a.probed_at, a.injected
          from all_probes a
         order by a.ad_number, a.probed_at desc
      )
      select %1$L::text, t.ad_number, t.id::bigint, l.probed_at, t.last_verified_alive_at, l.injected
        from latest l
        join public.%1$I t on t.ad_number = l.ad_number
       where l.verdict = 'GONE'
         and t.active is true
         and (t.last_verified_alive_at is null or t.last_verified_alive_at < l.probed_at)
    $q$, r.st, v_inject::text);
  end loop;
end;
$fn$;

comment on function public.ops_lifecycle_false_resurrection(jsonb) is
  'Routine #11 pure resolver. Rows that are active=true while the LATEST direct probe of their ad '
  'says GONE and nothing has since proven them alive (last_verified_alive_at is NULL or older than '
  'that verdict). Crawl presence is deliberately not accepted as ALIVE evidence. p_inject appends '
  'synthetic probes through the same filter so the predicate can be mutation-proven while production '
  'is clean. Writes nothing.';

create or replace function public.mon_detect_false_resurrection()
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
    select f.source_table as st,
           count(*)                                            as rows_back,
           min(f.gone_at)                                      as oldest_gone_verdict,
           (array_agg(f.ad_number order by f.ad_number))[1:20] as sample_ads,
           count(*) filter (where f.last_verified_alive_at is null) as never_proven_alive
      from public.ops_lifecycle_false_resurrection() f
     where not f.injected
     group by 1
  loop
    live := live || ('false_resurrection:' || r.st);
    n := n + public.mon_raise('P1', 'false_resurrection',
      regexp_replace(r.st, '_(residential|commercial)_listings$', ''),
      'false_resurrection:' || r.st,
      jsonb_build_object(
        'source_table', r.st,
        'rows_active_again', r.rows_back,
        'never_proven_alive', r.never_proven_alive,
        'oldest_gone_verdict', r.oldest_gone_verdict,
        'sample_ad_numbers', to_jsonb(r.sample_ads),
        'why', 'The most recent DIRECT probe of each of these ads returned GONE — a fetch of the '
            || 'listing''s own URL, the only evidence class allowed to kill. The rows are '
            || 'nevertheless active=true again, and last_verified_alive_at is either NULL or older '
            || 'than that GONE verdict, so nothing has proven them alive since. A user can be shown '
            || 'a listing our own source check says no longer exists.',
        'what_this_is_not', 'This is not "the crawl saw it again". last_seen_at is deliberately not '
            || 'consulted: LISTING_LIVENESS.md separates "seen by the crawler" from "proven alive", '
            || 'and only scrapers/common/liveness_contract.py may write last_verified_alive_at. A '
            || 'row restored by crawl presence alone after a DIRECT GONE verdict IS this defect.',
        'likely_cause', 'auto_recover_false_inactive() losing its adjudication or '
            || 'sibling-supersession guard; prune_unseen() resetting strikes on a re-seen ad; or a '
            || 're-ingest that flipped active without a liveness_contract write.',
        'action', 'Re-probe each ad by DIRECT fetch of its own URL. If the source serves it, the row '
            || 'is right and the missing thing is the last_verified_alive_at stamp — fix the writer, '
            || 'not the row. If the source does not serve it, the restore was wrong. Do NOT bulk '
            || 'deactivate on this alert: it reports a CONTRADICTION, not a death.'));
  end loop;

  perform public.mon_resolve_stale_keys('false_resurrection', live);
  return n;
end;
$fn$;

-- ---------------------------------------------------------------------------------------
-- 2. orphan_after_delete — the delete happened somewhere and not everywhere.
-- ---------------------------------------------------------------------------------------
-- §4 barrier 9: after a delete, no (source_table, listing_id) survives in search_listings_ar,
-- active_listing_ids_v2, listing_native_location_v1/v2 or listing_location_index, and
-- purged_listings_archive holds the archived row. "Deletion is complete and consistent, or it did not
-- happen."
--
-- mon_detect_orphaned_search_row() already watches ONE side of this (an index row whose raw row is
-- gone, discovered from the index). This walks the other way — from the delete LEDGER, which knows
-- exactly which rows were removed and when — and covers four more surfaces plus the archive.
--
-- PROPAGATION IS NOT AN ORPHAN. Each surface is compared only against deletes that predate that
-- surface's own last completed refresh, read from mon_mv_refresh_log / cron history rather than a
-- magic grace interval. The most recent delete batch on 2026-09-06 ran at 03:31, eleven minutes after
-- the 03:20 matview refresh; every one of its rows was still in nv1 and NONE of them was a defect.
--
-- The archive limb is bounded below by the archive's OWN first row, not by a hardcoded date: archiving
-- began 2026-08-30 and the 1,394 deletes before it can never be archived retroactively. Alarming
-- forever about unrepairable history is how a detector teaches people to ignore it. If the archive is
-- empty the bound vanishes and every delete is reported, because "nothing is being archived at all" is
-- the defect this limb exists for.
create or replace function public.ops_lifecycle_orphan_after_delete()
returns table (surface text, source_table text, orphan_rows bigint,
               oldest_deleted_at timestamptz, sample_ids bigint[])
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_sync    timestamptz := public.ops_lifecycle_propagation_cutoff();
  v_alids   timestamptz;
  v_nv1     timestamptz;
  v_lli     timestamptz;
  v_archive timestamptz;
begin
  select max(refreshed_at) into v_alids from public.mon_mv_refresh_log
   where object_name = 'active_listing_ids_v2';
  select max(refreshed_at) into v_nv1 from public.mon_mv_refresh_log
   where object_name = 'listing_native_location_v1';
  select max(refreshed_at) into v_lli from public.mon_mv_refresh_log
   where object_name = 'listing_location_index';
  select min(deleted_at) into v_archive from public.purged_listings_archive;

  return query
  with ledger as (
    select d.source_table as st, d.listing_id as lid, d.deleted_at
      from public.cleanup_deletion_log d
  ),
  hits as (
    select 'search_listings_ar'::text as surface, l.st, l.lid, l.deleted_at
      from ledger l
      join public.search_listings_ar s on s.source_table = l.st and s.listing_id = l.lid
     where v_sync is not null and l.deleted_at < v_sync
    union all
    select 'active_listing_ids_v2', l.st, l.lid, l.deleted_at
      from ledger l
      join public.active_listing_ids_v2 m on m.source_table = l.st and m.listing_id = l.lid
     where v_alids is not null and l.deleted_at < v_alids
    union all
    select 'listing_native_location_v1', l.st, l.lid, l.deleted_at
      from ledger l
      join public.listing_native_location_v1 n on n.source_table = l.st and n.listing_id = l.lid
     where v_nv1 is not null and l.deleted_at < v_nv1
    union all
    -- nv2 is a VIEW, so it has no refresh of its own; it is graded against the EARLIEST cutoff of the
    -- objects underneath it, which is the conservative choice (fewer rows judged, never more).
    select 'listing_native_location_v2', l.st, l.lid, l.deleted_at
      from ledger l
      join public.listing_native_location_v2 n2 on n2.source_table = l.st and n2.listing_id = l.lid
     where least(v_nv1, v_sync) is not null and l.deleted_at < least(v_nv1, v_sync)
    union all
    select 'listing_location_index', l.st, l.lid, l.deleted_at
      from ledger l
      join public.listing_location_index i on i.source_table = l.st and i.listing_id = l.lid
     where v_lli is not null and l.deleted_at < v_lli
    union all
    select 'purged_listings_archive', l.st, l.lid, l.deleted_at
      from ledger l
     where (v_archive is null or l.deleted_at >= v_archive)
       and not exists (select 1 from public.purged_listings_archive a
                        where a.source_table = l.st and a.listing_id = l.lid)
  )
  select h.surface, h.st, count(*)::bigint, min(h.deleted_at),
         (array_agg(h.lid order by h.lid))[1:20]
    from hits h
   group by h.surface, h.st;
end;
$fn$;

comment on function public.ops_lifecycle_orphan_after_delete() is
  'Routine #11 pure resolver. Permanently deleted listings (cleanup_deletion_log) that still exist in '
  'a served or derived surface after that surface''s own last refresh, plus deletes with no '
  'purged_listings_archive row since archiving began. Propagation latency is excluded by construction: '
  'each surface is graded only on deletes older than its own last completed refresh. Writes nothing.';

create or replace function public.mon_detect_orphan_after_delete()
returns integer
language plpgsql
security definer
set search_path = public
as $fn$
declare
  n    int := 0;
  live text[] := '{}';
  r    record;
  k    text;
begin
  for r in select * from public.ops_lifecycle_orphan_after_delete() loop
    k := 'orphan_after_delete:' || r.surface || ':' || r.source_table;
    live := live || k;
    n := n + public.mon_raise(
      -- A user can reach the first two. The rest are internal consistency, which is why they are not
      -- dressed up as the same emergency; neither is dismissed.
      case when r.surface in ('search_listings_ar', 'active_listing_ids_v2') then 'P1' else 'P2' end,
      'orphan_after_delete',
      regexp_replace(r.source_table, '_(residential|commercial)_listings$', ''),
      k,
      jsonb_build_object(
        'surface', r.surface,
        'source_table', r.source_table,
        'orphan_rows', r.orphan_rows,
        'oldest_deleted_at', r.oldest_deleted_at,
        'sample_listing_ids', to_jsonb(r.sample_ids),
        'why', case r.surface
          when 'purged_listings_archive' then
            'These listings were permanently deleted and cleanup_deletion_log recorded it, but no '
            || 'purged_listings_archive row holds what was deleted. The audit trail DELETION_SAFETY.md '
            || 'requires is written before the delete, so a missing archive row means the row is gone '
            || 'and unrecoverable with no copy of what it was.'
          else
            'These listings were permanently deleted from their source table, yet ' || r.surface
            || ' still holds a row for them — and it has already had a full refresh cycle since the '
            || 'delete, so this is not propagation latency. A delete that lands in one place and not '
            || 'another leaves an index pointing at nothing.' end,
        'known_cause_2026_09_06', 'listing_native_location_v1''s "legacy" arm reads '
            || 'listings_arabic_locations, which is not cleaned when a raw row is deleted: 708 of 978 '
            || 'deleted gathern rows were still in it. Check that table (and listing_location_canonical) '
            || 'before looking anywhere else.',
        'boundary', 'mon_detect_orphaned_search_row() watches the same shape from the INDEX side and '
            || 'covers search_listings_ar only. This detector walks from the delete LEDGER and covers '
            || 'five surfaces plus the archive.',
        'action', 'Propagate the delete the rest of the way — the repair order is raw -> matview -> '
            || 'sync -> verify. Do NOT respond by deleting more listings, and do NOT delete an orphan '
            || 'row whose raw listing is actually still present: that is a different (and opposite) '
            || 'bug.'));
  end loop;

  perform public.mon_resolve_stale_keys('orphan_after_delete', live);
  return n;
end;
$fn$;

-- ---------------------------------------------------------------------------------------
-- 3. lifecycle_duplicate_stale_copy — two copies of one source URL disagreeing about life.
-- ---------------------------------------------------------------------------------------
-- §4 barrier 10: where the same source listing exists in more than one table (the
-- residential/commercial URL collision repaired by 20260830140110, and the retire_superseded_siblings()
-- path), a confirmed-dead listing must be dead in EVERY copy, and no superseded sibling may remain
-- searchable.
--
-- Identity is the listing_url — the same URL in two of our tables is the same page on the source, which
-- cannot be simultaneously gone and live. So this reports a CONTRADICTION, and deliberately does not
-- name a winner: if it copied the dead state across it would be killing a listing on our own
-- bookkeeping rather than on source evidence, which is the exact rule (§0, UNKNOWN IS NOT DEAD) this
-- routine exists to protect. The alert says "ask the source", never "kill the twin".
--
-- Only pairs whose LIVE copy is actually served are reported. A disagreement nobody can be shown is
-- bookkeeping; a disagreement a user is being shown is the failure the barrier is named for.
create or replace function public.ops_lifecycle_duplicate_stale_copy()
returns table (platform text, listing_url text, dead_table text, dead_id bigint,
               live_table text, live_id bigint)
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  r record;
begin
  for r in
    select regexp_replace(t.table_name, '_(residential|commercial)_listings$', '') as p
      from information_schema.tables t
     where t.table_schema = 'public' and t.table_name ~ '_(residential|commercial)_listings$'
     group by 1
    having count(*) filter (where t.table_name like '%\_residential\_listings') = 1
       and count(*) filter (where t.table_name like '%\_commercial\_listings')  = 1
  loop
    -- Both tables must actually carry listing_url; a platform captured without it cannot be joined on
    -- identity and is skipped rather than guessed at.
    if (select count(*) from information_schema.columns c
         where c.table_schema = 'public'
           and c.table_name in (r.p || '_residential_listings', r.p || '_commercial_listings')
           and c.column_name = 'listing_url') <> 2 then
      continue;
    end if;

    return query execute format($q$
      select %1$L::text, res.listing_url,
             case when res.active is not true then %2$L else %3$L end::text,
             case when res.active is not true then res.id  else com.id  end,
             case when res.active is not true then %3$L else %2$L end::text,
             case when res.active is not true then com.id  else res.id  end
        from public.%2$I res
        join public.%3$I com on com.listing_url = res.listing_url
       where res.listing_url is not null
         and (res.active is not true) <> (com.active is not true)
         and exists (
           select 1 from public.search_listings_ar s
            where (s.source_table = %2$L and s.listing_id = res.id and res.active is true)
               or (s.source_table = %3$L and s.listing_id = com.id and com.active is true))
    $q$, r.p, r.p || '_residential_listings', r.p || '_commercial_listings');
  end loop;
end;
$fn$;

comment on function public.ops_lifecycle_duplicate_stale_copy() is
  'Routine #11 pure resolver. One source listing_url held in both a platform''s residential and '
  'commercial table where the two copies disagree about active, and the live copy is still served. '
  'Reports the contradiction only — it names no winner, because killing a twin on our own bookkeeping '
  'rather than on source evidence is the rule this routine protects. Writes nothing.';

create or replace function public.mon_detect_lifecycle_duplicate_stale_copy()
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
    select d.platform,
           count(*)                                                as pairs,
           (array_agg(d.listing_url order by d.listing_url))[1:10] as sample_urls,
           (array_agg(d.live_table  order by d.listing_url))[1:10] as live_tables
      from public.ops_lifecycle_duplicate_stale_copy() d
     group by 1
  loop
    live := live || ('lifecycle_duplicate_stale_copy:' || r.platform);
    -- P2, honestly: the contradiction is proven, its DIRECTION is not. Neither copy has been checked
    -- against the source by this detector, and it must not imply that the served one is the wrong one.
    n := n + public.mon_raise('P2', 'lifecycle_duplicate_stale_copy', r.platform,
      'lifecycle_duplicate_stale_copy:' || r.platform,
      jsonb_build_object(
        'platform', r.platform,
        'contradicting_pairs', r.pairs,
        'sample_listing_urls', to_jsonb(r.sample_urls),
        'served_from', to_jsonb(r.live_tables),
        'why', 'These source URLs exist in BOTH this platform''s residential and commercial table. '
            || 'One copy is inactive, the other is active and still returned by search — so our two '
            || 'records of the same page on the source disagree about whether that page still exists. '
            || 'One of them is wrong and this detector cannot tell which.',
        'do_not', 'Do NOT resolve this by copying the dead state onto the live twin. That would be a '
            || 'deactivation justified by our own bookkeeping instead of by the source, which is the '
            || 'rule (LISTING_LIVENESS.md §1: only a DIRECT fetch may kill) this routine exists to '
            || 'protect. Equally, do not reactivate the dead copy on the strength of its twin.',
        'action', 'Fetch the shared listing_url directly, once, and make BOTH copies match what the '
            || 'source returns — restore both if it serves the page, deactivate both if it is gone. '
            || 'Then find why one listing was captured into two tables: the residential/commercial URL '
            || 'collision repaired by migration 20260830140110 is the known shape.'));
  end loop;

  perform public.mon_resolve_stale_keys('lifecycle_duplicate_stale_copy', live);
  return n;
end;
$fn$;

-- ---------------------------------------------------------------------------------------
-- 4. deletion_clock_stalled — the OTHER direction, and the one nobody was watching.
-- ---------------------------------------------------------------------------------------
-- §4 barrier 8: rows that HAVE been source-confirmed inactive for their platform's full window do not
-- accumulate unboundedly, and a run that reports success while deleting nothing is visible with the
-- reason it is not draining.
--
-- Measured 2026-09-06: aqar 18,519 eligible, wasalt 7,662, gathern 1,225 — every run aborting on the
-- anomaly breaker, week after week. The engine already writes the diagnosis into cleanup_runs.abort_reason
-- ("a STANDING backlog above the floor aborts every run and can never drain"), and until this detector
-- nothing read it. That is the shape AGENTS.md warns about from the other side: the system knew, and
-- said so, into a table with no reader.
--
-- The trigger is not a threshold. A platform is stalled when its most recent REAL (non-dry-run) cleanup
-- run had candidates and deleted none — aborted, frozen, gated or capped to zero. That self-resolves on
-- the next run that drains anything, needs no magic window, and cannot be tuned green.
--
-- THIS ALERT IS NEVER A LICENCE TO DELETE FASTER. LISTING_LIVENESS.md §7 and DELETION_SAFETY.md §6: a
-- backlog that will not drain is evidence about the VERIFIER, not permission to delete. Raising
-- anomaly_floor or max_delete_per_run to silence it is an owner decision and, on the two biggest
-- platforms, would not even work — the engine says so itself in the abort_reason it records.
create or replace function public.ops_lifecycle_deletion_backlog()
returns table (platform text, eligible_now bigint, last_run_at timestamptz,
               candidates_last_run integer, deleted_last_run integer,
               aborted boolean, abort_reason text, last_drain_at timestamptz)
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  r   record;
  v_n bigint;
begin
  for r in
    select p.platform, p.min_inactive_days, p.min_missing_count
      from public.platform_retention_policy p
     where p.enabled
  loop
    v_n := 0;
    -- The platform's OWN thresholds, read per run. A detector that hardcodes 30/3 goes green the day
    -- someone changes them, which is the failure mode §4 calls "pinning the implementation".
    declare
      t text;
      c bigint;
    begin
      for t in
        select c2.table_name from information_schema.columns c2
         where c2.table_schema = 'public' and c2.column_name = 'deactivated_at'
           and c2.table_name like r.platform || '\_%\_listings'
      loop
        execute format($q$
          select count(*) from public.%1$I t
           where t.active = false
             and coalesce(t.missing_count, 0) >= %2$s
             and t.last_seen_at < now() - (%3$s || ' days')::interval
        $q$, t, r.min_missing_count, r.min_inactive_days) into c;
        v_n := v_n + coalesce(c, 0);
      end loop;
    end;

    -- LEFT JOIN, not a plain FROM: an enabled platform that has NEVER run cleanup must still appear
    -- with its backlog rather than vanish from the report because there is no run row to join to.
    return query
      select r.platform, v_n,
             lr.ran_at, lr.candidates, lr.deleted, lr.aborted, lr.abort_reason,
             (select max(d.ran_at) from public.cleanup_runs d
               where d.platform = r.platform and d.dry_run is not true and coalesce(d.deleted, 0) > 0)
        from (select 1) one
        left join lateral (select * from public.cleanup_runs cr
                            where cr.platform = r.platform and cr.dry_run is not true
                            order by cr.ran_at desc limit 1) lr on true;
  end loop;
end;
$fn$;

comment on function public.ops_lifecycle_deletion_backlog() is
  'Routine #11 pure resolver. Per enabled retention platform: how many rows currently satisfy that '
  'platform''s OWN eligibility thresholds, and what its most recent real cleanup run did about them '
  '(candidates, deleted, aborted, abort_reason) plus the last time anything actually drained. Reports '
  'the backlog and the engine''s own stated reason; recommends nothing. Writes nothing.';

create or replace function public.mon_detect_deletion_clock_stalled()
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
    select * from public.ops_lifecycle_deletion_backlog() b
     where b.eligible_now > 0
       and coalesce(b.candidates_last_run, 0) > 0
       and coalesce(b.deleted_last_run, 0) = 0
  loop
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
        'why', 'The retention engine ran for this platform, found candidates, and removed none of '
            || 'them. The queue is therefore not moving, and each run makes it larger — which on the '
            || 'anomaly breaker is self-reinforcing: a standing backlog above the floor aborts every '
            || 'subsequent run. The engine records the reason in cleanup_runs.abort_reason and, until '
            || 'this detector, nothing read that column.',
        'why_it_matters', 'A stuck deletion queue is not "safe by default". It means the verification '
            || 'the deletion depends on is not happening, so nobody is learning whether those listings '
            || 'are alive or dead — and rows nobody re-probes drift further from the source every day. '
            || 'It is also how a real breaker stops being trusted: it fires every week and no one is '
            || 'told.',
        'do_not', 'This alert NEVER authorises raising anomaly_floor, anomaly_factor, '
            || 'max_delete_per_run or min_inactive_days, forcing a run, or deleting by hand. '
            || 'LISTING_LIVENESS.md §7 and DELETION_SAFETY.md §6: a backlog that will not drain is '
            || 'evidence about the VERIFIER, never permission to delete. Every threshold here is an '
            || 'owner decision.',
        'action', 'Read the abort_reason above and fix the VERIFICATION side: re-probe the candidates '
            || 'so the real live/dead split is known, and bring the finding (with that measurement) to '
            || 'the owner. On aqar and wasalt the engine has already recorded that raising the anomaly '
            || 'floor alone would not unblock the run — the mass-inactivation percentage gate would '
            || 'abort it instead, so both gates are one decision, not two.'));
  end loop;

  perform public.mon_resolve_stale_keys('deletion_clock_stalled', live);
  return n;
end;
$fn$;

-- ---------------------------------------------------------------------------------------
-- 5. ROSTER — same migration, per AGENTS.md. A detector outside it is decoration.
-- ---------------------------------------------------------------------------------------
-- Needle-edited off the LIVE body (never a remembered copy), with a hard assertion that the needle
-- matched: mon_run_all_detectors() is a large array that several sessions extend concurrently, and
-- rebuilding it from a stale base is how mon_detect_unverified_inactivation went dark 8h after it was
-- wired (scripts/verify-detector-roster-edits-are-guarded.ts).
do $roster$
declare
  v_src text;
  v_new text;
  v_before int;
  v_after  int;
begin
  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname = 'mon_run_all_detectors';

  if v_src is null then
    raise exception 'mon_run_all_detectors() not found — roster cannot be extended';
  end if;

  if position('mon_detect_false_resurrection' in v_src) > 0 then
    raise notice 'roster already carries the four lifecycle detectors; nothing to do';
    return;
  end if;

  v_before := (select count(*) from regexp_matches(v_src, '''mon_detect_[a-z0-9_]+''', 'g'));

  v_new := replace(
    v_src,
    $old$'mon_detect_deletion_clock_without_evidence'$old$,
    $new$'mon_detect_deletion_clock_without_evidence',
    -- routine #11 ♻️ listing lifecycle (incident #25), the remaining four kinds. Detect-only:
    -- not one of these writes to a listing, a location table or an index.
    'mon_detect_false_resurrection',
    'mon_detect_orphan_after_delete',
    'mon_detect_lifecycle_duplicate_stale_copy',
    'mon_detect_deletion_clock_stalled'$new$);

  if v_new = v_src then
    raise exception 'roster needle did not match — mon_run_all_detectors() body changed shape; '
                    'refusing to leave four detectors orphaned outside the sweep';
  end if;

  v_after := (select count(*) from regexp_matches(v_new, '''mon_detect_[a-z0-9_]+''', 'g'));
  if v_after <> v_before + 4 then
    raise exception 'roster grew by % entries, expected exactly 4 — refusing to write', v_after - v_before;
  end if;

  execute v_new;
end;
$roster$;

do $verify$
begin
  if (select count(*) from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
       where ns.nspname = 'public' and p.proname = 'mon_run_all_detectors'
         and pg_get_functiondef(p.oid) like '%mon_detect_false_resurrection%'
         and pg_get_functiondef(p.oid) like '%mon_detect_orphan_after_delete%'
         and pg_get_functiondef(p.oid) like '%mon_detect_lifecycle_duplicate_stale_copy%'
         and pg_get_functiondef(p.oid) like '%mon_detect_deletion_clock_stalled%') <> 1 then
    raise exception 'roster verification failed: the four lifecycle detectors are not reachable from '
                    'mon_run_all_detectors()';
  end if;
end;
$verify$;
