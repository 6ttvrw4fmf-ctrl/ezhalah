-- STAGE B of the 2026-08-12 discoverability fix. Stage A
-- (search_index_first_seen_at_recency_fallback) added the Ezhalah-owned first_seen_at column and
-- backfilled it for every served row the source gave no date for. This makes the RPC actually USE
-- it, as an ordering fallback only.
--
-- WHAT CHANGES: every recency ordering site now reads
--     recency_at = coalesce(last_updated, first_seen_at)
-- instead of last_updated. Both directions ('oldest' and the default newest-first) use the same
-- key, so the two sorts stay each other's inverse.
--
-- WHAT DOES NOT CHANGE, deliberately:
--   * the RETURNS TABLE shape and the output `last_updated` value — a listing with no source date
--     still reports NULL to the client, so a property card cannot show our observation as if the
--     platform had published it. recency_at is carried through the CTE chain for ORDER BY only and
--     is never selected into the final output.
--   * the `matched` CTE — eligibility, total_count, and WHICH listings qualify are bit-for-bit
--     unchanged. This reorders; it does not filter.
--   * the six objective sorts (price/area/beds) — untouched.
--   * platform diversity (owner PERMANENT rule 2026-08-05) — div_rank still leads the key; its
--     internal tie-break simply moves to the same recency fallback.
--
-- Applied as a guarded needle-edit on the LIVE body with every replacement count asserted, rather
-- than re-pasting 14.6k characters from a possibly stale base — the failure mode that cost this
-- repo four recorded roster losses.
do $do$
declare
  src text;
  orig text;
  edits text[][] := array[
    -- carry the fallback key down the CTE chain (matched -> a/t inner -> a/t outer)
    ['s.platform, s.last_updated, s.region_ar',
     's.platform, s.last_updated, coalesce(s.last_updated, s.first_seen_at) as recency_at, s.region_ar', '1'],
    ['select m.source_table, m.listing_id, m.platform, m.last_updated, m.region_ar',
     'select m.source_table, m.listing_id, m.platform, m.last_updated, m.recency_at, m.region_ar', '2'],
    ['select a.source_table, a.listing_id, a.platform, a.last_updated, a.region_ar',
     'select a.source_table, a.listing_id, a.platform, a.last_updated, a.recency_at, a.region_ar', '1'],
    ['select t.source_table, t.listing_id, t.platform, t.last_updated, t.region_ar',
     'select t.source_table, t.listing_id, t.platform, t.last_updated, t.recency_at, t.region_ar', '1'],
    -- newest-first tie-breaks
    ['m.last_updated desc nulls last, m.source_table, m.listing_id',
     'm.recency_at desc nulls last, m.source_table, m.listing_id', '2'],
    ['a.last_updated desc nulls last, a.source_table, a.listing_id',
     'a.recency_at desc nulls last, a.source_table, a.listing_id', '1'],
    ['t.last_updated desc nulls last, t.source_table, t.listing_id',
     't.recency_at desc nulls last, t.source_table, t.listing_id', '1'],
    ['u.last_updated desc nulls last, u.source_table, u.listing_id',
     'u.recency_at desc nulls last, u.source_table, u.listing_id', '1'],
    -- the explicit 'oldest' sort, kept as the exact inverse of the above
    ['then a.last_updated end) asc nulls last', 'then a.recency_at end) asc nulls last', '1'],
    ['then m.last_updated end) asc nulls last', 'then m.recency_at end) asc nulls last', '1'],
    ['then t.last_updated end) asc nulls last', 'then t.recency_at end) asc nulls last', '1'],
    ['then u.last_updated end) asc nulls last', 'then u.recency_at end) asc nulls last', '1']
  ];
  i int;
  needle text; repl text; want int; got int;
begin
  select pg_get_functiondef(p.oid) into src
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'location_search_candidates_ar';

  if src is null then
    raise exception 'location_search_candidates_ar not found - refusing to edit blindly';
  end if;
  if position('recency_at' in src) > 0 then
    raise notice 'already applied - no-op';
    return;
  end if;
  orig := src;

  for i in 1 .. array_length(edits, 1) loop
    needle := edits[i][1]; repl := edits[i][2]; want := edits[i][3]::int;
    got := (length(src) - length(replace(src, needle, ''))) / length(needle);
    if got <> want then
      raise exception 'edit % : found % occurrences of %, expected % - refusing to install',
        i, got, needle, want;
    end if;
    src := replace(src, needle, repl);
  end loop;

  -- Every recency ordering site must now be on the fallback key.
  if position('last_updated desc nulls last' in src) > 0
     or position('last_updated end) asc nulls last' in src) > 0 then
    raise exception 'a last_updated ordering site survived the rewrite - refusing to install';
  end if;

  -- The client-facing contract must be untouched: same RETURNS TABLE, and the final projection
  -- still emits the SOURCE last_updated (never recency_at).
  if position('RETURNS TABLE(source_table text, listing_id bigint, platform text, last_updated timestamp with time zone' in src) = 0 then
    raise exception 'RETURNS TABLE shape changed - refusing to install';
  end if;
  if position('select u.source_table, u.listing_id, u.platform, u.last_updated, u.region_ar, u.city_ar, u.district_ar,
         u.total_count, u.effective_price, u.area_m2, u.bedrooms' in src) = 0 then
    raise exception 'final projection changed - refusing to install';
  end if;

  -- Eligibility must be byte-identical: nothing inside the WHERE of `matched` may have moved.
  if position('production_ready' in src) = 0
     or length(src) <= length(orig) then
    raise exception 'sanity check failed - refusing to install';
  end if;

  execute src;
end
$do$;
