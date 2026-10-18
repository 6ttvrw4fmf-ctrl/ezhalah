-- 🆕 New Listings 10-18 (backlog #618 root, #588): an English-city overlay row outlives the city it was made from.
--
-- resolve_english_city_overlay() / resolve_english_city_before_sync() write listings_arabic_locations rows
-- (review_reason 'english_map_overlay') from the source row's `city`. Nothing ever retracted one. When a scraper
-- later settles the city as unknown (db.AUTHORITATIVE_NULL — the source names another region, or names no city),
-- the stored row goes NULL but the overlay keeps serving the OLD city: abralosol 17994690 «أرض للبيع في مدينة
-- الروضة – حائل» stored city NULL since 10-17 08:50 and was still served under الهفوف on 10-18 07:20; dealapp
-- 1284668 (city NULL) still served under مكة المكرمة. Measured 10-18: 10 active rows in this state.
-- A source row with a city is unaffected (the native path wins; measured on 8 dealapp rows with a moved city).
--
-- Fix: retract an overlay row whose source row now carries no city, every refresh (wired first into
-- resolve_english_city_before_sync, cron :20), plus the standing watch on the roster.

create or replace function public.retract_english_city_overlay_source_silent()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare t record; total int := 0; n int;
begin
  for t in
    select distinct l.source_table tn from public.listings_arabic_locations l
     where l.review_reason = 'english_map_overlay'
       and exists (select 1 from information_schema.columns c where c.table_schema = 'public'
                    and c.table_name = l.source_table and c.column_name = 'city')
       and exists (select 1 from information_schema.columns c where c.table_schema = 'public'
                    and c.table_name = l.source_table and c.column_name = 'id')
  loop
    begin
      execute format($q$
        delete from public.listings_arabic_locations l
         using public.%I r
         where l.source_table = %L and l.review_reason = 'english_map_overlay'
           and r.id = l.listing_id and nullif(btrim(r.city), '') is null
      $q$, t.tn, t.tn);
      get diagnostics n = row_count;
      total := total + n;
    exception when others then null;
    end;
  end loop;
  return total;
end $function$;

-- Wire it FIRST into the pre-sync resolver (needle edit on the live definition).
do $$
declare src text; out_def text;
begin
  src := pg_get_functiondef('public.resolve_english_city_before_sync()'::regprocedure);
  if position('retract_english_city_overlay_source_silent' in src) > 0 then
    raise notice 'already wired';
    return;
  end if;
  out_def := replace(src, E'begin\n  for t in',
    E'begin\n  begin\n    perform public.retract_english_city_overlay_source_silent();\n  exception when others then null;\n  end;\n  for t in');
  if out_def = src then
    raise exception 'resolve_english_city_before_sync anchor not found — refusing to guess';
  end if;
  execute out_def;
end $$;

-- The standing watch: an active served listing whose city comes ONLY from an overlay its source no longer supports.
create or replace function public.mon_detect_english_overlay_outlives_source_city()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare t record; v_n bigint := 0; k bigint; v_ex text; n int := 0;
begin
  for t in
    select distinct l.source_table tn from public.listings_arabic_locations l
     where l.review_reason = 'english_map_overlay'
       and exists (select 1 from information_schema.columns c where c.table_schema = 'public'
                    and c.table_name = l.source_table and c.column_name = 'city')
  loop
    begin
      execute format($q$
        select count(*), min(%L || ':' || l.listing_id) from public.listings_arabic_locations l
          join public.%I r on r.id = l.listing_id
         where l.source_table = %L and l.review_reason = 'english_map_overlay'
           and r.active and nullif(btrim(r.city), '') is null
      $q$, t.tn, t.tn, t.tn) into k, v_ex;
      if k > 0 then v_n := v_n + k; end if;
    exception when others then null;
    end;
  end loop;
  if v_n = 0 then
    perform public.mon_resolve_stale_keys('english_overlay_outlives_source_city', array[]::text[]);
    return 0;
  end if;
  n := public.mon_raise('P2', 'english_overlay_outlives_source_city', 'fleet', 'english_overlay_outlives_source_city:rows',
    jsonb_build_object('rows', v_n, 'example', v_ex,
      'why', 'The source settled this listing''s city as unknown, but an english_map_overlay row made from its old '
          || 'city still serves it under that city (abralosol 17994690 under الهفوف, 10-18).',
      'action', 'Check resolve_english_city_before_sync still calls retract_english_city_overlay_source_silent (cron :20).'));
  perform public.mon_resolve_stale_keys('english_overlay_outlives_source_city', array['english_overlay_outlives_source_city:rows']);
  return n;
end
$function$;

do $$
declare src text; out_def text;
begin
  src := pg_get_functiondef('public.mon_run_all_detectors()'::regprocedure);
  if position('mon_detect_english_overlay_outlives_source_city' in src) > 0 then
    raise notice 'already on the roster';
    return;
  end if;
  out_def := replace(src,
    E'    ''mon_detect_aqarcity_arabic_city_stranded'',',
    E'    ''mon_detect_aqarcity_arabic_city_stranded'',\n    ''mon_detect_english_overlay_outlives_source_city'',');
  if out_def = src then
    raise exception 'roster anchor not found — refusing to guess where the entry belongs';
  end if;
  execute out_def;
end $$;

insert into public.ops_repair_guarantee_registry (repair_version, repair_name, invariant, detector, registered_by,
                                                  last_verified_at, last_verdict, last_detail)
values (to_char(now() at time zone 'utc', 'YYYYMMDDHH24MISS'), 'english_overlay_retracted_when_source_silent',
        'No active listing whose source row carries no city keeps an english_map_overlay city in listings_arabic_locations.',
        'mon_detect_english_overlay_outlives_source_city', 'new_listings_engineer', now(), 'undetermined',
        jsonb_build_object('stale_before', 10, 'example', 'abralosol_residential_listings:17994690',
                           'cause_fix', 'retract_english_city_overlay_source_silent via resolve_english_city_before_sync',
                           'detector_on_roster', true))
on conflict do nothing;

-- Check block: EXECUTE the retraction and prove both directions.
do $$
declare k int;
begin
  perform public.retract_english_city_overlay_source_silent();
  if exists (select 1 from public.listings_arabic_locations
              where index_id = 'abralosol_residential_listings:17994690' and review_reason = 'english_map_overlay') then
    raise exception 'abralosol 17994690 overlay (city NULL at source) was not retracted';
  end if;
  -- a row whose source still carries its city keeps its overlay
  select count(*) into k from public.listings_arabic_locations l
    join public.dealapp_residential_listings r on r.id = l.listing_id
   where l.source_table = 'dealapp_residential_listings' and l.review_reason = 'english_map_overlay'
     and nullif(btrim(r.city), '') is not null;
  if k < 100 then raise exception 'retraction removed overlays whose source still has a city (% left)', k; end if;
  if public.mon_detect_english_overlay_outlives_source_city() <> 0 then
    raise exception 'detector fires right after the retraction';
  end if;
  if position('retract_english_city_overlay_source_silent' in pg_get_functiondef('public.resolve_english_city_before_sync()'::regprocedure)) = 0 then
    raise exception 'not wired into resolve_english_city_before_sync';
  end if;
  if position('mon_detect_english_overlay_outlives_source_city' in pg_get_functiondef('public.mon_run_all_detectors()'::regprocedure)) = 0 then
    raise exception 'detector not on the roster';
  end if;
end $$;
