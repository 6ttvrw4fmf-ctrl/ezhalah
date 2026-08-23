-- Barrier: a crawl that could not enumerate its whole catalogue and therefore WITHHELD pruning.
--
-- Why this needs its own detector. souq24's harvest_ids() now returns a completeness flag and
-- main() refuses to prune when the browse harvest was truncated (see the 2026-08-23 fix). That is
-- the right behaviour — pruning off a short crawl inactivates live listings, the raghdan
-- under-enumeration shape — but it is SILENT SUCCESS: the run ends ok=true with rows upserted, so
-- every count-based and failure-based barrier stays green while stale listings quietly accumulate
-- because nothing is pruning them any more. Left unwatched, "we safely did not prune" becomes
-- "we have not pruned for three weeks and nobody noticed".
--
-- The same predicate also catches prune_unseen()'s own collapse guard tripping on any platform,
-- which is the identical situation reached by a different route.
--
-- Predicate proven in BOTH directions before this shipped, against the real note shapes: it
-- matches 'harvest incomplete: prune withheld' and 'prune guard tripped', and does NOT match
-- healthy notes ('pruned=0', 'pruned=12 reactivated=3'), a SIGINT kill (a different detector owns
-- that), or 'refreshed=354 killed=0 pending_kill=3' — the metric-substring trap that produced 32
-- false alerts earlier the same day.
create or replace function public.mon_detect_enumeration_incomplete()
returns integer language plpgsql security definer set search_path to 'public' as $fn$
declare n int := 0; live text[] := '{}'; r record;
begin
  for r in
    select split_part(platform, ':', 1) as fam,
           count(*) as runs,
           max(started_at) as last_seen,
           max(rows_seen) as best_rows_seen
      from public.scrape_runs
     where started_at >= now() - interval '72 hours'
       and notes ~* 'harvest incomplete|enumeration incomplete|prune withheld|prune guard tripped'
     group by 1
     order by 2 desc
  loop
    live := live || ('enumeration_incomplete:' || r.fam);
    n := n + public.mon_raise('P1', 'enumeration_incomplete', r.fam,
      'enumeration_incomplete:' || r.fam,
      jsonb_build_object('runs_72h', r.runs, 'last_seen', r.last_seen,
        'best_rows_seen', r.best_rows_seen,
        'why', 'this platform could not enumerate its full catalogue, so the run deliberately '
            || 'WITHHELD pruning rather than inactivate listings it simply never visited. That '
            || 'choice is correct and nothing is lost — but the run still reports ok=true with '
            || 'rows upserted, so no failure-based or count-based barrier can see it. While this '
            || 'persists, delisted ads are NOT being retired and the platform slowly fills with '
            || 'stale inventory.',
        'adjudicate', 'Fix the ENUMERATION, never the guard. Do not "resolve" this by allowing the '
            || 'prune to run on a short crawl - that is the raghdan under-enumeration shape and it '
            || 'inactivates live listings. For souq24 specifically, read the harvest line in the '
            || 'job log: it prints pages visited/total, elapsed, failures and the budget, which '
            || 'says immediately whether the source got slower or the page list got bigger.'));
  end loop;
  perform public.mon_resolve_stale_keys('enumeration_incomplete', live);
  return n;
end $fn$;

-- Roster wiring in the SAME migration (AGENTS.md): a detector nothing reaches is decoration, and
-- mon_detect_orphaned_detectors() fires on it. Patch the array in place rather than retyping the
-- roster, which risks silently dropping an entry. Idempotent.
do $do$
declare
  src text;
  nm  constant text := 'mon_detect_enumeration_incomplete';
  anchor constant text := '  fns text[] := array[' || E'\n';
begin
  select pg_get_functiondef(p.oid) into src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'mon_run_all_detectors';
  if src is null then
    raise exception 'mon_run_all_detectors not found - refusing to wire into nothing';
  end if;
  if position('''' || nm || '''' in src) > 0 then
    raise notice 'already rostered - nothing to do';
    return;
  end if;
  if position(anchor in src) = 0 then
    raise exception 'roster anchor not found - refusing to patch blind';
  end if;
  execute replace(src, anchor, anchor || '    ''' || nm || ''',' || E'\n');
end $do$;

-- Reachability check: fail the migration rather than ship decoration.
do $check$
declare src text;
begin
  select pg_get_functiondef(p.oid) into src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'mon_run_all_detectors';
  if position('mon_detect_enumeration_incomplete' in src) = 0 then
    raise exception 'roster registration failed - the detector would never run';
  end if;
end $check$;
