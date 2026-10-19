-- A DOWN SITE'S LISTINGS LEAVE SEARCH — ALL OF THEM, INCLUDING THE ONES WITH NO CITY.
--
-- Owner rule 2026-09-26: a source site that is down on its side goes platform_registry 'dormant'
-- and its listings leave search. The v2 gate does that by setting production_ready = false.
-- But every search RPC (location_search_candidates_ar, the Advanced Filter counts,
-- district_options_ar, top_cities_by_deal_ar, ...) also serves NON-ready rows that have no
-- city/region to a search with NO location at all — a deliberate branch for unlocated listings.
-- A down site's unlocated rows therefore still reached users on a no-location search (measured
-- 2026-10-09: 1 nafithh row; nafithh.sa is NXDOMAIN since 2026-10-06, so its card links nowhere).
--
-- Fixed once, where every one of those RPCs reads from: the search index. Each sync pass now
--   (1) removes a dormant platform's unlocated rows from search_listings_ar, and
--   (2) does not insert them while the platform stays dormant.
-- Located rows of a dormant site are untouched (production_ready = false already hides them, and
-- reactivate_recovered_dormant_platforms still counts them). Nothing in a source table changes;
-- the first pass after the site is active again re-inserts the rows from listing_native_location_v2.
-- The delete is its own statement, outside the doomed-keys circuit breaker, so a large site going
-- down can never trip the breaker and freeze the routine deletes of every other platform.
--
-- Same live-body rewrite pattern as 20260920071128: edits whatever body is in production, fails
-- closed unless every anchor appears exactly once, and checks the result before replacing.

do $mig$
declare src text; n int; anchor text;
begin
  select prosrc into src from pg_proc where oid = 'public.sync_search_listings_ar()'::regprocedure;
  if src is null then raise exception 'sync_search_listings_ar() not found'; end if;
  if position('v_dormant' in src) > 0 then
    raise exception 'sync_search_listings_ar() already carries v_dormant; refusing to apply twice';
  end if;

  foreach anchor in array array[
    'declare v_upserted bigint; v_deleted bigint; v_since timestamptz; v_del_pending bigint; v_total_now bigint; v_threshold bigint;',
    '  if not public.search_index_writer_lock() then return; end if;
',
    '  where lower(v.transaction_type) in (''buy'',''rent'')
    and (v.last_updated is null or v.last_updated > v_since
',
    '  v_deleted := v_deleted + public.prune_inactive_from_search();
'] loop
    n := (length(src) - length(replace(src, anchor, ''))) / length(anchor);
    if n <> 1 then
      raise exception 'expected exactly 1 occurrence of anchor %, found %; refusing to rewrite', anchor, n;
    end if;
  end loop;

  src := replace(src,
'declare v_upserted bigint; v_deleted bigint; v_since timestamptz; v_del_pending bigint; v_total_now bigint; v_threshold bigint;',
'declare v_upserted bigint; v_deleted bigint; v_since timestamptz; v_del_pending bigint; v_total_now bigint; v_threshold bigint;
        v_dormant text[]; v_dormant_unlocated bigint;');

  src := replace(src,
'  if not public.search_index_writer_lock() then return; end if;
',
'  if not public.search_index_writer_lock() then return; end if;
  -- A down site''s unlocated rows leave the index (production_ready alone cannot hide them from a
  -- no-location search); they return on the first pass after the site is active again.
  v_dormant := array(select platform from public.platform_registry where kind = ''source'' and status = ''dormant'');
  delete from search_listings_ar s
   where s.platform = any(v_dormant) and (s.region_id is null or s.city_id is null);
  get diagnostics v_dormant_unlocated = row_count;
');

  src := replace(src,
'  where lower(v.transaction_type) in (''buy'',''rent'')
    and (v.last_updated is null or v.last_updated > v_since
',
'  where lower(v.transaction_type) in (''buy'',''rent'')
    and not (v.platform = any(v_dormant) and (v.region_id is null or v.city_id is null))
    and (v.last_updated is null or v.last_updated > v_since
');

  src := replace(src,
'  v_deleted := v_deleted + public.prune_inactive_from_search();
',
'  v_deleted := v_deleted + public.prune_inactive_from_search() + v_dormant_unlocated;
');

  -- Post-swap shape: each piece present exactly once.
  foreach anchor in array array[
    'v_dormant text[]; v_dormant_unlocated bigint;',
    'where s.platform = any(v_dormant) and (s.region_id is null or s.city_id is null);',
    'and not (v.platform = any(v_dormant) and (v.region_id is null or v.city_id is null))',
    'public.prune_inactive_from_search() + v_dormant_unlocated;'] loop
    n := (length(src) - length(replace(src, anchor, ''))) / length(anchor);
    if n <> 1 then
      raise exception 'post-swap expected exactly 1 occurrence of %, found %', anchor, n;
    end if;
  end loop;

  execute format(
    'create or replace function public.sync_search_listings_ar() returns table(upserted bigint, deleted bigint) language plpgsql as %L',
    src);
end $mig$;
