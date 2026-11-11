-- ⚡ Scraping Engineer 2026-11-09 (owner followup 3292: «fix the ones that come back, the root»).
-- repeat_bug:dealapp_shard_coverage — dealapp_shard_under_coverage re-opened 4 times in 7 days (alerts 12808, 13354,
-- 13491, 13941), every time at the first sweeps after dealapp-sharded.yml starts (00:33 UTC since 20261103052955) and
-- resolved 1-3 h later as the shards finished. Cause: «re-confirmed» was counted as last_seen_at in a ROLLING 24 h,
-- so at 00:59 yesterday's 00:33-00:59 shard output had already aged out while tonight's shards were still walking.
-- Measured 05:10 UTC 11-09 after the fleet: 24 h = 58,211 / 58,792 (99.0 %); at 00:59 it read 0.759 — a mid-batch
-- artifact, the same shape 20261103052507 fixed for missing_run. Now the coverage window is the same daily cycle
-- (30 h: a daily dispatch plus the longest shard). A fleet that misses a day still drops below 0.80 within 30 h, and
-- missing_run names the shards. Body otherwise unchanged; same signature, no DROP.
create or replace function public.mon_detect_dealapp_shard_coverage()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_shards int := coalesce((select split_part(r.platform, '/', 2)::int from public.scrape_runs r where r.platform ~ '^dealapp:[0-9]+/[0-9]+$' order by r.started_at desc limit 1), 12);
  v_active bigint; v_orphan bigint; v_seen24 bigint; v_stale7 bigint;
  v_missing int[]; v_blocked int; v_cov numeric; n int := 0;
begin
  select count(*), count(*) filter (where ad_number !~ '[0-9]'),
         count(*) filter (where last_seen_at > now() - interval '30 hours'),  -- one daily cycle: see header
         count(*) filter (where last_seen_at < now() - interval '7 days')
    into v_active, v_orphan, v_seen24, v_stale7
  from (
    select ad_number, last_seen_at from public.dealapp_residential_listings where active
    union all
    select ad_number, last_seen_at from public.dealapp_commercial_listings where active
  ) s;

  -- Which shards did NOT complete a healthy run in the last DAILY CYCLE. The fleet is dispatched daily and a
  -- shard can take ~4 h, so the window is 30 h: at 02:59 yesterday's 02:33 runs (24 h 26 min ago) still count
  -- while tonight's are in flight (2026-11-03, alert 12799). Anything missing is a slice nobody visited.
  select array_agg(g.sh order by g.sh) into v_missing
  from generate_series(0, v_shards - 1) g(sh)
  where not exists (
    select 1 from public.scrape_runs r
    where r.platform = 'dealapp:' || g.sh || '/' || v_shards
      and r.started_at > now() - interval '30 hours'
      and r.ok
  );

  -- Blocked shards: dealapp's origin trips a login-wall under burst (2 of 8 runs on 2026-08-11).
  -- These prune nothing by design; they are reported so a systematic block is visible early.
  -- A run still in flight (finished_at null) has rows_seen 0 because it has not finished, not because it was blocked.
  select count(*) into v_blocked from public.scrape_runs
   where platform like 'dealapp:%/' || v_shards
     and started_at > now() - interval '24 hours'
     and finished_at is not null
     and coalesce(rows_seen, 0) = 0;

  v_cov := round(v_seen24::numeric / nullif(v_active, 0), 3);

  -- P1: a listing owned by no shard can never be re-confirmed or aged out — it is invisible
  -- inventory, the exact failure sharding is supposed to eliminate.
  if v_orphan > 0 then
    n := n + public.mon_raise('P1', 'dealapp_shard_coverage', 'dealapp',
      'dealapp_shard_orphan_ids',
      jsonb_build_object('orphan_rows', v_orphan, 'active', v_active,
        'why', 'active dealapp rows whose ad_number has no digits belong to NO shard under '
               'int(ad_number)%N, so no shard will ever fetch them and prune_unseen will never '
               'see them. Fix the ad_number, never widen a shard to swallow them.'));
  else
    perform public.mon_resolve_key('dealapp_shard_coverage', 'dealapp_shard_orphan_ids');
  end if;

  -- P1: a shard that did not run leaves ~1/N of inventory unvisited, silently.
  if v_missing is not null and array_length(v_missing, 1) > 0 then
    n := n + public.mon_raise('P1', 'dealapp_shard_coverage', 'dealapp',
      'dealapp_shard_missing_run',
      jsonb_build_object('missing_shards', to_jsonb(v_missing),
        'ran', v_shards - array_length(v_missing, 1), 'of', v_shards,
        'blocked_zero_row_runs', v_blocked,
        'why', 'these shards have no healthy run in 30h (one daily cycle plus the longest shard), so their '
               'slice of the active inventory was not re-confirmed. Dispatch dealapp-sharded.yml; do NOT '
               'compensate by widening another shard, which would break the exactly-one-shard partition.'));
  else
    perform public.mon_resolve_key('dealapp_shard_coverage', 'dealapp_shard_missing_run');
  end if;

  -- P2: the fleet ran but did not actually reach the inventory. Below prune_unseen's 0.80 floor the
  -- coverage guard trips and NOTHING is ever aged out — the precise state that made the standing
  -- stale_active alerts unfixable before sharding.
  if v_active > 0 and coalesce(v_cov, 0) < 0.80 then
    n := n + public.mon_raise('P2', 'dealapp_shard_coverage', 'dealapp',
      'dealapp_shard_under_coverage',
      jsonb_build_object('coverage_24h', v_cov, 'seen_24h', v_seen24, 'window_hours', 30, 'active', v_active,
        'stale_7d', v_stale7, 'blocked_zero_row_runs', v_blocked,
        'floor', 0.80,
        'why', 'the fleet re-confirmed less than prune_unseen''s PRUNE_MIN_COVERAGE floor, so the '
               'partial-scrape guard will keep returning -1 and no dead listing can age out. '
               'Check for blocked shards or a shard count that no longer fits throughput.'));
  else
    perform public.mon_resolve_key('dealapp_shard_coverage', 'dealapp_shard_under_coverage');
  end if;

  return n;
end
$function$;

do $chk$ begin
  if pg_get_functiondef('public.mon_detect_dealapp_shard_coverage()'::regprocedure)
       not like '%last_seen_at > now() - interval ''30 hours''%' then
    raise exception 'dealapp coverage window not applied';
  end if;
end $chk$;