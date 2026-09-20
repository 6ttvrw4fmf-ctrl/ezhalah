-- The served search index sync evaluated the same expensive anti-join TWICE per pass:
-- once as count(*) into v_del_pending (line 91) and again as the DELETE predicate (line 103).
-- listing_native_location_v2 is a VIEW over ~150 platform tables, so each evaluation costs
-- 7.25 s on an idle database (measured 2026-09-20, EXPLAIN ANALYZE, 225,926 index rows).
--
-- jobid 28 (:22) overlaps jobid 17 (:20), which runs REFRESH MATERIALIZED VIEW CONCURRENTLY
-- for 6m23s. Under that contention the second evaluation burned the job's whole 600 s
-- statement_timeout and the function aborted at line 103 -- rolling back the INSERT that had
-- already succeeded. Net effect: an entire hourly pass propagated NOTHING. Observed
-- 2026-09-20 06:22 and 2026-09-04 15:14, same statement both times.
--
-- The set is snapshot-stable inside the one transaction, so computing it once and deleting by
-- key is semantically identical to re-running the predicate. The circuit breaker is untouched
-- and still reads the same count from the same predicate.

create unlogged table if not exists public.sync_search_doomed_keys (
  source_table text   not null,
  listing_id   bigint not null,
  primary key (source_table, listing_id)
);

comment on table public.sync_search_doomed_keys is
  'Scratch set for sync_search_listings_ar(): the search_listings_ar rows absent from '
  'listing_native_location_v2 in THIS pass. Populated once per pass and deleted by key, so the '
  '7.25 s fleet-wide anti-join is evaluated once instead of twice. Not a source of truth -- it '
  'holds only the current pass and is truncated at the start of the next one.';

do $mig$
declare src text; n int;
begin
  select prosrc into src from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname = 'sync_search_listings_ar';
  if src is null then raise exception 'sync_search_listings_ar() not found'; end if;

  -- Fail closed: this migration only makes sense against the exact shape it was written for.
  n := (length(src) - length(replace(src, 'not exists (select 1 from listing_native_location_v2', '')))
       / length('not exists (select 1 from listing_native_location_v2');
  if n <> 2 then
    raise exception 'expected exactly 2 anti-join occurrences, found %; refusing to rewrite', n;
  end if;

  -- (1) count-side -> populate the key set once, take the count from row_count
  src := replace(src,
'  select count(*) into v_del_pending from search_listings_ar s
    where not exists (select 1 from listing_native_location_v2 v
                      where v.source_table = s.source_table and v.listing_id = s.listing_id
                        and lower(v.transaction_type) in (''buy'',''rent''));',
'  truncate public.sync_search_doomed_keys;
  insert into public.sync_search_doomed_keys (source_table, listing_id)
  select s.source_table, s.listing_id from search_listings_ar s
    where not exists (select 1 from listing_native_location_v2 v
                      where v.source_table = s.source_table and v.listing_id = s.listing_id
                        and lower(v.transaction_type) in (''buy'',''rent''));
  get diagnostics v_del_pending = row_count;');

  -- (2) delete-side -> keyed delete against the set computed above
  src := replace(src,
'    delete from search_listings_ar s
      where not exists (select 1 from listing_native_location_v2 v
                        where v.source_table = s.source_table and v.listing_id = s.listing_id
                          and lower(v.transaction_type) in (''buy'',''rent''));',
'    delete from search_listings_ar s using public.sync_search_doomed_keys d
      where s.source_table = d.source_table and s.listing_id = d.listing_id;');

  -- Post-swap shape: exactly ONE anti-join left, and the keyed delete is present.
  n := (length(src) - length(replace(src, 'not exists (select 1 from listing_native_location_v2', '')))
       / length('not exists (select 1 from listing_native_location_v2');
  if n <> 1 then
    raise exception 'post-swap expected exactly 1 anti-join, found %', n;
  end if;
  if position('sync_search_doomed_keys d' in src) = 0
     or position('get diagnostics v_del_pending = row_count;' in src) = 0 then
    raise exception 'post-swap shape check failed -- replacement did not apply';
  end if;

  execute format(
    'create or replace function public.sync_search_listings_ar() returns table(upserted bigint, deleted bigint) language plpgsql as %L',
    src);
end $mig$;
