-- THE SYNC'S CHANGE-DETECTOR COMPARED THE STORED *CANONICAL* LABEL AGAINST THE *RAW* SOURCE LABEL.
-- Found by the daily Search & Matching QA run, 2026-08-24, chasing an open card_label_contract P2.
--
-- WHAT THE USER SAW. A single result list rendered one district two ways -- «حي أبها الجديدة» next to
-- «حي ابها الجديدة», «أم الجود» next to «حي أم الجود» -- which is a direct breach of the owner's
-- visible-output contract (docs/ops/SEARCH_MATCH_QA_ENGINEER.md §42.1: one canonical rendering per
-- (city_id, normalised district), so a result list can never show two spellings of one place).
--
-- MECHANISM. sync_search_listings_ar() WRITES canonical labels -- the INSERT ... SELECT passes both
-- through loc_display_city_ar()/loc_display_district_ar(). But the row-selection predicate that
-- decides WHICH rows to re-visit compared the stored value against the RAW view column:
--
--     or s3.district_ar is distinct from v.district_ar      -- stored(canonical) vs raw
--     or s3.city_ar     is distinct from v.city_ar
--
-- Stored is canonical; v.* is raw. Comparing them is comparing two different quantities, and it is
-- wrong in BOTH directions:
--
--   1. STUCK (the user-visible half). When the raw label happens to equal what is already stored but
--      differs from the canonical rendering -- e.g. raw «حي ال قيشه» stored «حي ال قيشه», canonical
--      «ال قيشه» -- the comparison is FALSE. The row is outside the fresh-window branch, it exists,
--      and no other column changed, so every OR branch is false and the sync NEVER re-selects it.
--      The non-canonical label is frozen into the served index permanently. Measured today: 3 rows
--      (aqarmonthly listing 7059923 has been stuck since its 2026-08-08 last_updated).
--
--   2. CHURN (the invisible half). Whenever the canonical rendering differs from the raw -- true of
--      every row the 2026-08-22 relabel touched -- the comparison is permanently TRUE, so the row is
--      re-upserted on EVERY hourly sync forever, for a write that changes nothing. Measured today:
--      41,278 district rows + 3,995 city rows = 45,273 of a 203,854-row index, ~22%, re-written
--      every hour on the instance where the search RPC is already 64.4% of all database time.
--
-- THE FIX. Compare the stored value against WHAT THE SYNC WOULD ACTUALLY WRITE -- the same display
-- expressions the INSERT already uses. One change, both directions: the stuck rows become visible to
-- the sync and self-heal, and the 45,273 phantom updates stop.
--
-- Applied as a NEEDLE-EDIT of the LIVE body, never a hand-pasted copy: this function is long, it is
-- edited by several routines, and re-pasting a remembered version is how a concurrent engineer's
-- change gets silently reverted (AGENTS.md, deployment safety overrides autonomy).

do $$
declare
  v_def text; v_new text; v_hits int;
  d_old constant text := 'or s3.district_ar is distinct from v.district_ar';
  d_new constant text := 'or s3.district_ar is distinct from public.loc_display_district_ar(v.city_id, v.district_ar)';
  c_old constant text := 'or s3.city_ar is distinct from v.city_ar';
  c_new constant text := 'or s3.city_ar is distinct from public.loc_display_city_ar(v.city_id, v.city_ar)';
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'sync_search_listings_ar';
  if v_def is null then raise exception 'sync_search_listings_ar not found'; end if;

  -- Refuse to guess. Each needle must appear EXACTLY once, or the body has moved under us.
  v_hits := (length(v_def) - length(replace(v_def, d_old, ''))) / length(d_old);
  if v_hits <> 1 then raise exception 'district needle found % times, expected 1', v_hits; end if;
  v_hits := (length(v_def) - length(replace(v_def, c_old, ''))) / length(c_old);
  if v_hits <> 1 then raise exception 'city needle found % times, expected 1', v_hits; end if;

  -- The INSERT must already write through the display functions; if it does not, this fix is aimed
  -- at the wrong layer and must not be applied.
  if position('public.loc_display_district_ar(v.city_id, v.district_ar)' in v_def) = 0
     or position('public.loc_display_city_ar(v.city_id, v.city_ar)' in v_def) = 0 then
    raise exception 'INSERT no longer writes canonical labels -- refusing to edit change-detection';
  end if;

  v_new := replace(replace(v_def, d_old, d_new), c_old, c_new);
  if v_new = v_def then raise exception 'needle-edit produced no change'; end if;
  execute v_new;

  -- Post-check against the LIVE body, not against the string we just built.
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'sync_search_listings_ar';
  if position(d_new in v_def) = 0 or position(c_new in v_def) = 0 then
    raise exception 'post-check: fixed comparison not present in live body';
  end if;
  if position(d_old || E'\n' in v_def) > 0 or position(c_old || E'\n' in v_def) > 0 then
    raise exception 'post-check: raw-vs-canonical comparison still present';
  end if;
  -- Nothing else may have been lost in the rewrite.
  if position('prune_inactive_from_search' in v_def) = 0
     or position('sync_delete_circuit_breaker' in v_def) = 0
     or position('refresh_district_name_bridge' in v_def) = 0 then
    raise exception 'post-check: unrelated sync behaviour disappeared';
  end if;
end $$;

-- ── THE BARRIER FOR THE CLASS ────────────────────────────────────────────────────────────────────
-- mon_detect_card_label_contract() (2026-08-22) reports the SYMPTOM: a card whose label is not
-- canonical. It cannot say whether the sync will repair that by itself, so a transient row mid-cycle
-- and a row frozen since 2026-08-08 look identical -- and the frozen one is the actual defect.
--
-- This detector states the DURABILITY invariant instead, the label twin of
-- mon_detect_search_index_diverges_from_sync_source (2026-08-13): the served label must equal what
-- the next sync would write. Rows are only counted once they are older than two sync cycles, so a
-- freshly-ingested row that has not met a sync yet is never reported -- the count is exactly "rows
-- the sync has already had its chance at and did not fix", which is 0 by construction once the
-- change-detector compares like with like.
--
-- Daily-gated: it joins the full index against listing_native_location_v2, and detector_sweep_budget
-- is already open (P2) against the twice-hourly roster.
create or replace function public.mon_detect_index_label_unrepairable()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_n bigint := 0; v_sample jsonb; n int := 0;
begin
  if not public.mon_claim_daily_slot('index_label_unrepairable') then return 0; end if;

  -- MATERIALIZED so the (expensive) join is executed once and both the count and the sample are
  -- read from the same snapshot -- a second pass could disagree with the first mid-sync.
  with bad as materialized (
    select s.source_table, s.listing_id, s.platform, s.city_id,
           s.city_ar     as served_city,
           s.district_ar as served_district,
           public.loc_display_city_ar(v.city_id, v.city_ar)         as sync_would_write_city,
           public.loc_display_district_ar(v.city_id, v.district_ar) as sync_would_write_district,
           v.city_ar     as raw_city,
           v.district_ar as raw_district,
           v.last_updated
      from public.search_listings_ar s
      join public.listing_native_location_v2 v
        on v.source_table = s.source_table and v.listing_id = s.listing_id
     where s.production_ready
       and coalesce(v.last_updated, 'epoch'::timestamptz) < now() - interval '2 hours'
       and (s.city_ar     is distinct from public.loc_display_city_ar(v.city_id, v.city_ar)
         or s.district_ar is distinct from public.loc_display_district_ar(v.city_id, v.district_ar))
  )
  select count(*), (select jsonb_agg(to_jsonb(t)) from (select * from bad limit 10) t)
    into v_n, v_sample
    from bad;

  if v_n = 0 then
    perform public.mon_resolve_key('index_label_unrepairable', 'index_label_unrepairable');
    return 0;
  end if;

  n := public.mon_raise('P2', 'index_label_unrepairable', 'search_index', 'index_label_unrepairable',
    jsonb_build_object(
      'unrepairable_rows', v_n,
      'sample', v_sample,
      'why', 'The label these listings are SERVED with is not the label sync_search_listings_ar() '
             'would write, and the rows are older than two sync cycles -- so the sync has already '
             'had its chance and did not repair them. That means the served label is frozen, not '
             'merely stale, and a result list can render one place two ways '
             '(SEARCH_MATCH_QA_ENGINEER.md §42.1). The historic cause is a change-detection '
             'predicate that compares the STORED canonical label against the RAW source label '
             'instead of against the display expression the INSERT actually writes -- when raw and '
             'stored coincide but differ from canonical, every OR branch is false and the row is '
             'never re-selected.',
      'fix', 'Confirm the change-detection arm of sync_search_listings_ar() still reads '
             '"s3.district_ar is distinct from public.loc_display_district_ar(v.city_id, v.district_ar)" '
             '(and the city twin). Then repair the served rows with '
             'backfill_location_display_labels(). Do NOT edit source truth: only the index DISPLAY '
             'columns are canonicalised, the raw labels stay as published.'));
  return n;
end $function$;

-- Roster wiring by NEEDLE-EDIT of the LIVE body. A detector nothing reaches is decoration, and
-- mon_detect_orphaned_detectors() fires on exactly that.
do $$
declare
  v_def text; v_new text;
  anchor constant text := '''mon_detect_orphaned_detectors''';
  want   constant text := '''mon_detect_index_label_unrepairable''';
begin
  select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'mon_run_all_detectors';
  if v_def is null then raise exception 'mon_run_all_detectors not found'; end if;

  if position(want in v_def) = 0 then
    if position(anchor in v_def) = 0 then
      raise exception 'roster anchor % not found -- refusing to guess an edit point', anchor;
    end if;
    v_new := replace(v_def, anchor, anchor || ', ' || want);
    if v_new = v_def then raise exception 'needle-edit produced no change'; end if;
    execute v_new;
  end if;

  select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'mon_run_all_detectors';
  if position(want in v_def) = 0 then raise exception 'post-check: detector NOT in roster'; end if;
  if position(anchor in v_def) = 0 then raise exception 'post-check: anchor detector lost'; end if;
  if position('''mon_detect_card_label_contract''' in v_def) = 0
     or position('''mon_detect_search_index_diverges_from_sync_source''' in v_def) = 0 then
    raise exception 'post-check: a sibling label/durability detector fell out of the roster';
  end if;
end $$;
