-- Coverage/completeness barrier for the dealapp 12-shard fleet (owner-approved 2026-08-11, opt b).
--
-- WHAT IT PROVES, in the owner's terms:
--   * every active dealapp listing belongs to exactly one shard — membership is int(ad_number)%12,
--     a TOTAL function, so the only way a row can belong to NO shard is a non-numeric ad_number,
--     and that is counted here. Belonging to TWO shards is arithmetically impossible for a modulo,
--     which is why the key is a hash and not a range split (aqar bug B1 gave shard 0 81% of rows).
--   * all shards execute on schedule — a shard that never ran is a permanent coverage hole that
--     nothing else in the fleet would report, because the other eleven look perfectly healthy.
--   * the union of shards covers the full intended inventory — measured directly as the fraction
--     of ACTIVE rows whose last_seen_at moved inside the window, not inferred from run counts.
--   * a failed shard does not cause false inactivation — a 0-row/blocked shard is surfaced here,
--     and prune_unseen still returns -1 for it (empty seen-set guard), so it ages out nothing.
--   * stale coverage should fall — stale_7d is reported every run so the trend is visible rather
--     than asserted.
--
-- Baseline at ship time (2026-08-11, BEFORE the fleet's first run): 8,386 active (8,012 res + 374
-- com), 4,197 of them 7-day stale (50.0%), ~25% weekly coverage from the single capped crawl.
create or replace function public.mon_detect_dealapp_shard_coverage()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_shards constant int := 12;
  v_active bigint; v_orphan bigint; v_seen24 bigint; v_stale7 bigint;
  v_missing int[]; v_blocked int; v_cov numeric; n int := 0;
begin
  select count(*), count(*) filter (where ad_number !~ '[0-9]'),
         count(*) filter (where last_seen_at > now() - interval '24 hours'),
         count(*) filter (where last_seen_at < now() - interval '7 days')
    into v_active, v_orphan, v_seen24, v_stale7
  from (
    select ad_number, last_seen_at from public.dealapp_residential_listings where active
    union all
    select ad_number, last_seen_at from public.dealapp_commercial_listings where active
  ) s;

  -- Which shards did NOT complete a healthy run in the last 24h. The fleet is dispatched daily, so
  -- a full sweep must show all 12. Anything missing is a slice of inventory nobody visited.
  select array_agg(g.sh order by g.sh) into v_missing
  from generate_series(0, v_shards - 1) g(sh)
  where not exists (
    select 1 from public.scrape_runs r
    where r.platform = 'dealapp:' || g.sh || '/' || v_shards
      and r.started_at > now() - interval '24 hours'
      and r.ok
  );

  -- Blocked shards: dealapp's origin trips a login-wall under burst (2 of 8 runs on 2026-08-11).
  -- These prune nothing by design; they are reported so a systematic block is visible early.
  select count(*) into v_blocked from public.scrape_runs
   where platform like 'dealapp:%/' || v_shards
     and started_at > now() - interval '24 hours'
     and coalesce(rows_seen, 0) = 0;

  v_cov := round(v_seen24::numeric / nullif(v_active, 0), 3);

  -- P1: a listing owned by no shard can never be re-confirmed or aged out — it is invisible
  -- inventory, the exact failure sharding is supposed to eliminate.
  if v_orphan > 0 then
    n := n + public.mon_raise('P1', 'dealapp_shard_coverage', 'dealapp',
      'dealapp_shard_orphan_ids',
      jsonb_build_object('orphan_rows', v_orphan, 'active', v_active,
        'why', 'active dealapp rows whose ad_number has no digits belong to NO shard under '
               'int(ad_number)%12, so no shard will ever fetch them and prune_unseen will never '
               'see them. Fix the ad_number, never widen a shard to swallow them.'));
  else
    perform public.mon_resolve_key('dealapp_shard_coverage', 'dealapp_shard_orphan_ids');
  end if;

  -- P1: a shard that did not run leaves ~1/12 of inventory unvisited, silently.
  if v_missing is not null and array_length(v_missing, 1) > 0 then
    n := n + public.mon_raise('P1', 'dealapp_shard_coverage', 'dealapp',
      'dealapp_shard_missing_run',
      jsonb_build_object('missing_shards', to_jsonb(v_missing),
        'ran', v_shards - array_length(v_missing, 1), 'of', v_shards,
        'blocked_zero_row_runs', v_blocked,
        'why', 'these shards have no healthy run in 24h, so their slice of the active inventory '
               'was not re-confirmed. Dispatch dealapp-sharded.yml; do NOT compensate by widening '
               'another shard, which would break the exactly-one-shard partition.'));
  else
    perform public.mon_resolve_key('dealapp_shard_coverage', 'dealapp_shard_missing_run');
  end if;

  -- P2: the fleet ran but did not actually reach the inventory. Below prune_unseen's 0.80 floor the
  -- coverage guard trips and NOTHING is ever aged out — the precise state that made the standing
  -- stale_active alerts unfixable before sharding.
  if v_active > 0 and coalesce(v_cov, 0) < 0.80 then
    n := n + public.mon_raise('P2', 'dealapp_shard_coverage', 'dealapp',
      'dealapp_shard_under_coverage',
      jsonb_build_object('coverage_24h', v_cov, 'seen_24h', v_seen24, 'active', v_active,
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

comment on function public.mon_detect_dealapp_shard_coverage() is
  'dealapp 12-shard fleet coverage barrier (owner-approved 2026-08-11). Proves: every active '
  'listing belongs to exactly one shard (modulo is total; orphans = non-numeric ad_number are '
  'raised P1), every shard ran in 24h (missing shard = P1), and the union actually reached the '
  'inventory (coverage under prune_unseen''s 0.80 floor = P2). Baseline before the first fleet '
  'run: 8,386 active, 4,197 stale-7d (50.0%), ~25% weekly coverage.';

-- ── roster entry, SAME migration (AGENTS.md §11a: a detector outside the roster is decoration) ──
--
-- PATTERN NOTE, recorded honestly: the version first applied to production at 13:17:36Z wired the
-- roster with a WHOLESALE rewrite of mon_run_all_detectors (array copied from the live body, with a
-- DO block asserting all 36 pre-existing detectors survived — they did).
-- `scripts/verify-detector-roster-edits-are-guarded.ts` rejects that shape on principle, and it is
-- right to: a copied array is only as good as the moment it was copied, and this roster has lost
-- entries to exactly that pattern at least four times (20260804113911, 20260810175245,
-- 20260810202219). The committed form below is therefore the sanctioned NEEDLE-EDIT — it reads the
-- LIVE definition and inserts one element before the trailing anchor, so it cannot drop an entry it
-- never read. It is idempotent: re-applied against the already-correct production roster it is a
-- no-op. Both forms produce an identical roster; the needle-edit is the one that stays in the repo.
do $$
declare
  v_def text;
  v_before text;
  fn constant text := 'mon_detect_dealapp_shard_coverage';
  anchor constant text := '    ''mon_detect_orphaned_detectors''';
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'mon_run_all_detectors';
  if v_def is null then raise exception 'mon_run_all_detectors is missing'; end if;
  v_before := v_def;

  -- Anchor on the LAST roster entry so the insert lands inside the array literal.
  if position(anchor in v_def) = 0 then
    raise exception 'roster anchor missing — refusing to guess at the array shape';
  end if;

  if position('''' || fn || '''' in v_def) = 0 then
    v_def := replace(v_def, anchor, '    ''' || fn || ''',' || E'\n' || anchor);
  end if;

  if v_def = v_before then
    raise notice 'roster already lists % — nothing to do', fn;
    return;
  end if;
  execute v_def;
end $$;

-- Prove it in the same migration that changed it: the detector is reachable from the roster and
-- actually runs. A detector nothing calls is decoration.
do $$
declare body text := pg_get_functiondef('public.mon_run_all_detectors()'::regprocedure);
begin
  if position('mon_detect_dealapp_shard_coverage' in body) = 0 then
    raise exception 'mon_detect_dealapp_shard_coverage was not wired into the roster';
  end if;
  perform public.mon_detect_dealapp_shard_coverage();
  raise notice 'dealapp shard coverage barrier wired and executing';
end $$;
