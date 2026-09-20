-- §3 of docs/ops/DATA_INTEGRITY_ENGINEER.md asks for a propagation SLA and nothing measured it.
--
-- 2026-09-20: 16 arkaan_commercial rows scraped 04:54 were still absent from search_listings_ar at
-- 07:06 -- unreachable by every user-facing path for 2h12m. Two passes missed them for DIFFERENT
-- reasons: 05:22 read a pre-refresh snapshot (ops_incident #354, routed to routine-7-seam) and
-- 06:22 aborted on a statement timeout and rolled back its own INSERT. cron_fail:28 saw the second
-- but not the first, and neither says "listings we hold are not reachable".
--
-- This detector measures the HARM instead of either cause: after a pass that SUCCEEDED and has had
-- time to settle, every listing_native_location_v2 row with a buy/rent deal must be in the served
-- index. It is deliberately blind to why.
--
-- §24b: the cohort keys on search_listings_ar, which only moves when jobid 28 runs, so evaluating
-- it at an arbitrary moment would measure the SCHEDULE and flap. It therefore evaluates ONLY in a
-- settled window -- last pass succeeded, finished 10..55 minutes ago -- and outside that window
-- returns 0 WITHOUT resolving, because a detector that did not run must never resolve what it did
-- not check (§23a).
--
-- Measured cost 2026-09-20: the anti-join over 225,926 index rows against v2 (a VIEW over ~150
-- platform tables) is 7.25 s on an idle database. 7-12 s is normal here; 60 s+ is a real regression.

create or replace function public.mon_detect_sync_pass_left_rows_unindexed()
returns int language plpgsql as $fn$
declare
  n int := 0;
  v_fin timestamptz;
  v_status text;
  v_missing bigint;
  v_samples jsonb;
begin
  select d.end_time, d.status into v_fin, v_status
    from cron.job_run_details d
   where d.jobid = 28
   order by d.start_time desc
   limit 1;

  -- Not a settled window: do not evaluate, and do NOT resolve (§23a).
  if v_fin is null or v_status is distinct from 'succeeded'
     or v_fin > now() - interval '10 minutes'
     or v_fin < now() - interval '55 minutes' then
    return 0;
  end if;

  select count(*), coalesce(jsonb_agg(to_jsonb(x) order by x.source_table, x.listing_id) filter (where x.rn <= 20), '[]'::jsonb)
    into v_missing, v_samples
  from (
    select v.source_table, v.listing_id, v.platform, v.production_ready,
           row_number() over (order by v.source_table, v.listing_id) rn
      from public.listing_native_location_v2 v
     where lower(v.transaction_type) in ('buy','rent')
       and not exists (select 1 from public.search_listings_ar s
                        where s.source_table = v.source_table and s.listing_id = v.listing_id)
  ) x;

  if v_missing > 0 then
    n := n + public.mon_raise('P1', 'sync_pass_left_rows_unindexed', 'search',
      'sync_pass_left_rows_unindexed',
      jsonb_build_object(
        'missing', v_missing,
        'samples', v_samples,
        'last_pass_finished', v_fin,
        'why', 'These listings are in listing_native_location_v2 with a buy/rent deal, so the sync '
            || 'should have indexed them, and the last pass SUCCEEDED and has had time to settle. '
            || 'They are in no user-facing result: not the Normal Filter, not a city or district '
            || 'count, not Trending. Ezhalah holds them and no user can reach them.',
        'action', 'Read cron.job_run_details for jobid 28: a pass that FAILED rolls back its own '
            || 'INSERT, and a pass that started before jobid 17 committed its REFRESH read a stale '
            || 'snapshot and skipped rows while still reporting success (ops_incident #354).',
        'do_not', 'Do NOT insert into search_listings_ar by hand. sync_search_listings_ar() is its '
            || 'only writer; a hand-written row is not reproducible and drifts on the next pass.'));
  else
    perform public.mon_resolve_stale_keys('sync_pass_left_rows_unindexed', array[]::text[]);
  end if;

  return n;
end $fn$;

comment on function public.mon_detect_sync_pass_left_rows_unindexed() is
  'P1. Every listing_native_location_v2 row with a buy/rent deal must reach search_listings_ar. '
  'Evaluates only in a settled window (last jobid-28 pass succeeded, finished 10..55 min ago) so it '
  'measures propagation and not the cron schedule (§24b). Measured cost 2026-09-20: ~7.25 s idle; '
  '60 s+ is a real regression, not contention. Born from the 2026-09-20 arkaan cohort: 16 rows '
  'unreachable for 2h12m across two passes that failed for two different reasons.';

-- §11a: a barrier nothing calls is decoration -- the roster entry lands in the SAME migration.
do $mig$
declare src text; before_len int;
begin
  select prosrc into src from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname = 'mon_run_all_detectors';
  if src is null then raise exception 'mon_run_all_detectors not found'; end if;

  if position('mon_detect_sync_pass_left_rows_unindexed' in src) > 0 then
    return; -- already registered
  end if;

  before_len := length(src);
  src := replace(src,
    '''mon_detect_duplex_reachability'',''mon_detect_rent_period_unreachable'',',
    '''mon_detect_duplex_reachability'',''mon_detect_rent_period_unreachable'',''mon_detect_sync_pass_left_rows_unindexed'',');

  if length(src) = before_len then
    raise exception 'roster anchor not matched -- refusing to leave the detector orphaned';
  end if;

  execute format('create or replace function public.mon_run_all_detectors() returns jsonb language plpgsql as %L', src);
end $mig$;
