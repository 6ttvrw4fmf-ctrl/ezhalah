-- STEP 1 of the restore of the 11 objects the listing_location_index CASCADE (20260914114002)
-- dropped.
--
-- Full chain the CASCADE walked (the planning query saw only the first hop):
--   listing_location_index
--     -> listing_location_canonical (+ _mv)            [restored in the splice migration]
--        -> listing_native_location_v1                  [step 2, from the byte-verified mirror]
--           -> listing_native_location_v2               [step 3]
--              -> mon_search_index_city_drift           [step 3]
--              -> platforms_deprecated_status           [step 3]
--              -> platforms_unsearchable                [step 3]
--        -> phasea_shadow_resolution, buy_location_index, rent_location_index,
--           location_index_live, location_review, ops_freshness_by_layer   [this step]
--
-- This step restores the six that do NOT depend on v1, because v1's own body reads
-- phasea_shadow_resolution and cannot be created until it exists.
--
-- ONLY MISSING OBJECTS ARE TOUCHED. Every statement is guarded by `to_regclass(...) is null`, so a
-- snapshot that has gone stale for an object still live can never CREATE OR REPLACE over it. The
-- snapshot is the right source for these six: every platform activation since it was taken
-- captures and replays them verbatim rather than redefining them, so their text has not moved.
do $restore$
declare
  r record; okc int; last_okc int := -1; pass int; failed text[] := '{}';
  targets constant text[] := array[
    'phasea_shadow_resolution','buy_location_index','rent_location_index',
    'location_index_live','location_review','ops_freshness_by_layer'];
  t text; still_missing text[] := '{}';
begin
  for pass in 1..8 loop
    okc := 0;
    for r in
      select ddl, obj_name, obj_kind, ordinal, id from ops_ddl_snapshot
      where label = 'pre_azdad_activation_20260906'
        and obj_name = any(targets)
      order by case obj_kind when 'view' then 1 when 'matview' then 1 when 'index' then 2 else 3 end,
               ordinal, id
    loop
      -- never replace something that is currently alive
      if r.obj_kind in ('view','matview') and to_regclass('public.'||r.obj_name) is not null then
        okc := okc + 1;
        continue;
      end if;
      begin
        execute r.ddl;
        okc := okc + 1;
      exception
        when duplicate_table or duplicate_object then okc := okc + 1;
        when others then failed := array_append(failed, r.obj_kind||':'||r.obj_name||' -> '||sqlerrm);
      end;
    end loop;
    exit when okc = last_okc and pass > 1;
    last_okc := okc;
  end loop;

  foreach t in array targets loop
    if to_regclass('public.'||t) is null then
      still_missing := array_append(still_missing, t);
    end if;
  end loop;
  if array_length(still_missing,1) is not null then
    raise exception 'step 1 did not restore: % (last errors: %)',
      array_to_string(still_missing, ', '), array_to_string(failed[1:5], ' | ');
  end if;
  raise notice 'step 1 restored all six; non-fatal replay errors: %', coalesce(array_length(failed,1),0);
end
$restore$;
