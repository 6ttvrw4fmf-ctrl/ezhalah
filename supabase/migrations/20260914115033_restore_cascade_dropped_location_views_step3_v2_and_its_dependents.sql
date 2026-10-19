-- STEP 3 (final): restore listing_native_location_v2 and the three views that hang off it —
-- mon_search_index_city_drift, platforms_deprecated_status, platforms_unsearchable. That dependent
-- set is not guessed: migration 20260913221143 names exactly these when it captures "v2 and its 3
-- dependents" before its own CASCADE.
--
-- WHY THE 2026-09-06 SNAPSHOT IS THE CURRENT TEXT FOR THESE FOUR. v2 selects FROM
-- listing_native_location_v1 by name and never enumerates platform tables, and the same is true of
-- its three dependents — so, unlike v1, none of them changes when a platform is activated. Every
-- activation since has captured them with pg_get_viewdef and replayed them verbatim rather than
-- redefining them, so the text has not moved since the snapshot was taken.
--
-- Guarded by to_regclass so nothing still alive is replaced.
do $restore$
declare
  r record; okc int; last_okc int := -1; pass int; failed text[] := '{}';
  targets constant text[] := array['listing_native_location_v2','mon_search_index_city_drift',
                                   'platforms_deprecated_status','platforms_unsearchable'];
  t text; still_missing text[] := '{}';
begin
  for pass in 1..8 loop
    okc := 0;
    for r in
      select ddl, obj_name, obj_kind, ordinal, id from ops_ddl_snapshot
      where label = 'pre_azdad_activation_20260906' and obj_name = any(targets)
      order by case obj_kind when 'view' then 1 when 'matview' then 1 when 'index' then 2 else 3 end,
               ordinal, id
    loop
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
    raise exception 'step 3 did not restore: % (errors: %)',
      array_to_string(still_missing,', '), array_to_string(failed[1:5],' | ');
  end if;
end
$restore$;

-- EVERY object the CASCADE took must now be back, and the function that first exposed the breakage
-- must run. search_index_freshness() failed with 42P01 while v2 was missing; it is the canary here.
do $verify$
declare missing text[] := '{}'; t text;
begin
  foreach t in array array['listing_location_index','listing_location_canonical',
      'listing_location_canonical_mv','listing_native_location_v1','listing_native_location_v2',
      'phasea_shadow_resolution','buy_location_index','rent_location_index','location_index_live',
      'location_review','ops_freshness_by_layer','mon_search_index_city_drift',
      'platforms_deprecated_status','platforms_unsearchable'] loop
    if to_regclass('public.'||t) is null then missing := array_append(missing, t); end if;
  end loop;
  if array_length(missing,1) is not null then
    raise exception 'still missing after the full restore: %', array_to_string(missing, ', ');
  end if;
  if (select count(*) from public.listing_native_location_v2 where production_ready) = 0 then
    raise exception 'listing_native_location_v2 has no production_ready rows';
  end if;
  perform public.search_index_freshness();
  raise notice 'full restore verified: all 14 objects present, v2 populated, search_index_freshness() runs';
end
$verify$;
