-- A RAW-LAYER REPAIR CAN SILENTLY REVERT, AND NOTHING WAS WATCHING. Senior run #15, third pass.
--
-- Observed live today, on this run's own work. The corrective migration 20260813112916 repaired 13
-- aqaratikom rows (raw -> 'annual') and wrote the matching values straight into search_listings_ar.
-- Verified at 11:29: 43/43 reachable, pct_period_searchable 100.0. By 11:34 it was 69.8 again, the
-- 13 rows were NULL, and search_listings_ar.last_updated had gone BACKWARDS to 04:23.
--
-- MECHANISM. active_listing_ids_v2 is a MATERIALIZED VIEW refreshed hourly (cron jobid 17, minute
-- 0). sync_search_listings_ar() (jobid 28, minute 14) rebuilds search_listings_ar THROUGH it, via
-- listing_native_location_v2. So a raw repair applied between refreshes is invisible to the sync:
-- the matview still holds the pre-repair value, and the next sync faithfully writes that stale value
-- back over the index leg. The repair is correct in the raw layer and absent from what users search.
--
-- This is the index-layer twin of run #6's "one-crawl half-life", and EVERY repair migration in this
-- codebase that writes search_listings_ar directly shares the latent weakness -- including
-- 20260811133417 and this run's own 20260813064209 / 20260813064929. Those happened to survive only
-- because a matview refresh landed after the raw write and re-asserted the same value; that is
-- timing, not a guarantee. THE ORDERING RULE, now documented in docs/ops/ENGINEER_ROUTINES.md:
--
--     repair the RAW layer -> REFRESH active_listing_ids_v2 -> sync_search_listings_ar() -> verify
--
-- Writing search_listings_ar directly is fine as a fast path, but it is never the durable step.
--
-- WHAT THIS BARRIER ADDS. The revert was caught by hand, five minutes later, only because I happened
-- to re-read the metric. Nothing in the roster would have noticed: searchability_collapse re-fires
-- eventually, but it cannot say WHY, and a repair that reverts looks identical to one that never
-- worked. This detector states the invariant directly -- the served index must agree with the
-- relation the sync builds it from -- so a silent revert is reported as a revert.
create or replace function public.mon_detect_search_index_diverges_from_sync_source()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_rows jsonb; total int := 0; n int := 0;
begin
  -- search_listings_ar.rent_period_ar must equal the Arabic mapping of the rent_period carried by
  -- active_listing_ids_v2, because that is precisely what the next sync will write. Any disagreement
  -- means one of: a hand-edited index row the sync is about to clobber (a repair that will revert),
  -- a stale matview, or a sync that failed partway.
  select coalesce(jsonb_agg(x), '[]'::jsonb), count(*) into v_rows, total from (
    select jsonb_build_object(
             'platform', s.platform, 'source_table', s.source_table, 'listing_id', s.listing_id,
             'index_period', s.rent_period_ar, 'sync_source_period', a.rent_period) as x
      from public.search_listings_ar s
      join public.active_listing_ids_v2 a
        on a.source_table = s.source_table and a.listing_id = s.listing_id
     where s.deal_ar = 'إيجار'
       and s.rent_period_ar is distinct from
           (case a.rent_period when 'annual' then 'سنوي' when 'monthly' then 'شهري' else null end)
     limit 200
  ) t;

  if total > 0 then
    n := public.mon_raise('P1', 'search_index_diverges_from_sync_source', 'search_index',
      'search_index_diverges_from_sync_source',
      jsonb_build_object(
        'divergent_rows', total,
        'sample', (select jsonb_agg(e) from (select e from jsonb_array_elements(v_rows) e limit 10) s),
        'why', 'The served search index disagrees on rent period with active_listing_ids_v2, the '
               'relation sync_search_listings_ar() rebuilds it from. The index value is therefore '
               'NOT durable: the next sync (cron jobid 28, minute 14) will overwrite it with the '
               'matview value. Most often this is a raw-layer data repair whose index leg was '
               'written directly without refreshing active_listing_ids_v2 first (matview refresh is '
               'jobid 17, minute 0) — the repair looks verified and silently reverts within the '
               'hour. FIX: correct the RAW row, then REFRESH MATERIALIZED VIEW CONCURRENTLY '
               'active_listing_ids_v2, then run sync_search_listings_ar(), then re-verify. Do not '
               '"fix" this by editing search_listings_ar again; that reproduces the same revert.'));
  else
    perform public.mon_resolve_key('search_index_diverges_from_sync_source',
                                   'search_index_diverges_from_sync_source');
  end if;
  return n;
end $function$;

-- Roster wiring by NEEDLE-EDIT of the LIVE body (never a hand-pasted one).
do $$
declare
  v_def text; v_new text;
  anchor constant text := '''mon_detect_orphaned_detectors''';
  want constant text := '''mon_detect_search_index_diverges_from_sync_source''';
begin
  select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname='mon_run_all_detectors';
  if v_def is null then raise exception 'mon_run_all_detectors not found'; end if;

  if position(want in v_def) = 0 then
    if position(anchor in v_def) = 0 then
      raise exception 'roster anchor % not found -- refusing to guess an edit point', anchor;
    end if;
    v_new := replace(v_def, anchor, anchor || ', ' || want);
    if v_new = v_def then raise exception 'needle-edit produced no change'; end if;
    execute v_new;
  end if;

  select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname='mon_run_all_detectors';
  if position(want in v_def) = 0 then raise exception 'post-check: detector NOT in roster'; end if;
  if position(anchor in v_def) = 0 then raise exception 'post-check: anchor detector lost'; end if;
  if position('''mon_detect_rent_period_contradicts_capture''' in v_def) = 0
     or position('''mon_detect_source_limited_contradicted''' in v_def) = 0 then
    raise exception 'post-check: an earlier detector from this run fell out of the roster';
  end if;
end $$;