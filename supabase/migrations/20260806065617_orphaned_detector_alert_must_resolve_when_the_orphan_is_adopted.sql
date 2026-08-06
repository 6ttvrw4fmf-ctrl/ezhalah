-- mon_detect_orphaned_detectors() can raise but never clear.
--
-- It has no mon_resolve branch, so once an orphan is adopted the alert stays open forever. Proven
-- today: the 2026-08-04 19:50 alert names exactly one orphan, mon_detect_price_source_mismatch,
-- which migration 20260806063544 wired into mon_run_all_detectors 3 minutes before this one — the
-- detector then ran clean on the real scheduled sweep at 06:50Z (0 orphans) and the alert still
-- sat open on the dashboard.
--
-- A signal that can only ever go one way is not a signal. It is exactly how a dashboard trains its
-- readers to skip a whole alert class — and this run has already found one detector that had
-- inverted and one that was orphaned, both of which stayed invisible longer than they should have.
--
-- Detect-only, and the raise path is unchanged (same severity, same dedup key, same payload).
-- Only the "all clear" case is added.

create or replace function public.mon_detect_orphaned_detectors()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare n int := 0; orphans text[];
begin
  -- Reachability, not intent: a mon_detect_* function must be called by mon_run_all_detectors or
  -- own a cron job (district_resolution/price_fidelity/wasalt_enrich_backlog each own one). This
  -- is the guard for the defect class itself — a later create-or-replace rebuilding the sweep from
  -- a stale base is how mon_detect_unverified_inactivation went dark 8h after run #3 wired it.
  select coalesce(array_agg(p.proname order by p.proname), '{}') into orphans
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname like 'mon\_detect\_%'
     and p.proname <> 'mon_detect_orphaned_detectors'
     and not exists (select 1 from pg_proc r
                      where r.pronamespace = 'public'::regnamespace
                        and r.proname = 'mon_run_all_detectors'
                        and position(p.proname in pg_get_functiondef(r.oid)) > 0)
     and not exists (select 1 from cron.job j where position(p.proname in j.command) > 0);

  if cardinality(orphans) > 0 then
    n := public.mon_raise('P2', 'orphaned_detector', 'all',
      'orphaned_detector:' || array_to_string(orphans, ','),
      jsonb_build_object('orphans', to_jsonb(orphans),
        'why', 'these mon_detect_* functions are reachable from neither mon_run_all_detectors nor a cron job, so they never run and their contract is unmonitored'));
  else
    -- Every detector is reachable again: clear the class rather than leaving a fixed problem lit.
    perform public.mon_resolve('orphaned_detector', 'all');
  end if;

  return n;
end $function$;
