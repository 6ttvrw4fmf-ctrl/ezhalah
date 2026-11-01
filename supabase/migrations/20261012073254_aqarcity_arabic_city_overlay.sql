-- 🆕 New Listings Engineer 2026-10-12. AQARCITY TOWNS NEVER REACHED SEARCH SINCE JULY. aqarcity publishes its city in
-- Arabic (additional_info.city_ar, «بلجرشى», «ضيده», «الفويلق») and the scraper's `city` column holds only the names its
-- old English list knows. Every other town reached search through the frozen listings_arabic_locations snapshot, so
-- rows first seen after it (2026-07-12 on) stayed city-less and NOT production_ready: 120 active listings, 4 of them
-- today's arrivals (aqarcity 17370722 «ضيده», 17370735 «بلجرشى»). The English overlay that runs before every sync
-- (resolve_english_city_before_sync, cron :20) only reads English `city`.
-- The pin: the catalog city with that name (normalize_ar, aliases included), inside the region the ad publishes;
-- with no region published, only a name unique in the whole catalog — the fleet's to_catalog() rule. An ambiguous or
-- unknown name stays unplaced (honest unknown). Measured before apply: 73 of the 120 placed, 47 left honestly unplaced.

create or replace function public.aqarcity_arabic_city_pin(p_city_ar text, p_region_en text)
 returns table(city_ar text, region_ar text)
 language sql
 stable
 set search_path to 'public'
as $function$
  with rid(en, region_id) as (values ('Riyadh',1),('Makkah',2),('Mecca',2),('Madinah',3),('Medina',3),('Qassim',4),
         ('Eastern Province',5),('Eastern',5),('Asir',6),('Tabuk',7),('Hail',8),('Northern Borders',9),('Jazan',10),
         ('Najran',11),('Al Bahah',12),('Al Baha',12),('Al Jawf',13)),
  hint as (select (select r.region_id from rid r where r.en = btrim(p_region_en)) as region_id)
  select min(cc.city_ar), min(cr.region_ar)
    from hint h, public.loc_catalog_city cc
    join public.loc_catalog_region cr on cr.region_id = cc.region_id
   where nullif(btrim(p_city_ar), '') is not null
     and (nullif(btrim(p_region_en), '') is null or h.region_id is not null)   -- a region we cannot read: no pin
     and (normalize_ar(cc.city_ar) = normalize_ar(p_city_ar)
          or exists (select 1 from public.loc_catalog_city_alias al
                      where al.alias_norm = normalize_ar(p_city_ar) and al.city_id = cc.city_id))
     and (h.region_id is null or cc.region_id = h.region_id)
  having count(distinct cc.city_id) = 1
$function$;

create or replace function public.resolve_aqarcity_arabic_city_before_sync()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare t text; total int := 0; n int;
begin
  foreach t in array array['aqarcity_residential_listings', 'aqarcity_commercial_listings'] loop
    execute format($q$
      insert into public.listings_arabic_locations
        (index_id, platform, source_table, listing_id, purpose, raw_city_en, city_ar, region_ar, matched, review_reason)
      select %1$L||':'||r.id::text, 'aqarcity', %1$L, r.id,
             case when lower(r.transaction_type) = 'buy' then 'buy' else 'rent' end,
             r.city, pin.city_ar, pin.region_ar, true, 'aqarcity_arabic_city_overlay'
        from public.%1$I r
        cross join lateral public.aqarcity_arabic_city_pin(r.additional_info->>'city_ar', r.region) pin
       where r.active
         and lower(r.transaction_type) in ('buy', 'rent')
         and pin.city_ar is not null
         and not exists (select 1 from public.search_listings_ar s
                          where s.source_table = %1$L and s.listing_id = r.id and s.city_id is not null)
         and not exists (select 1 from public.listings_arabic_locations l
                          where l.index_id = %1$L||':'||r.id::text and l.matched and l.city_ar is not null)
      on conflict (index_id) do update
        set city_ar = excluded.city_ar, region_ar = excluded.region_ar,
            matched = true, review_reason = 'aqarcity_arabic_city_overlay'
        where public.listings_arabic_locations.city_ar is null or public.listings_arabic_locations.matched is not true
    $q$, t);
    get diagnostics n = row_count;
    total := total + n;
  end loop;
  return total;
end $function$;

-- Wire it into the pre-sync resolver (needle edit on the live definition: one call before its return).
do $$
declare src text; out_def text;
begin
  src := pg_get_functiondef('public.resolve_english_city_before_sync()'::regprocedure);
  if position('resolve_aqarcity_arabic_city_before_sync' in src) > 0 then
    raise notice 'already wired';
    return;
  end if;
  out_def := replace(src, E'  return total;\nend $function$',
    E'  begin\n    total := total + public.resolve_aqarcity_arabic_city_before_sync();\n  exception when others then null;\n  end;\n  return total;\nend $function$');
  if out_def = src then
    raise exception 'resolve_english_city_before_sync anchor not found — refusing to guess';
  end if;
  execute out_def;
end $$;

-- The standing watch: an active aqarcity listing the pin CAN place that search still serves city-less.
create or replace function public.mon_detect_aqarcity_arabic_city_stranded()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_seen bigint; v_n bigint; v_ex bigint; n int := 0;
begin
  select count(*) into v_seen from public.search_listings_ar where platform = 'aqarcity';
  if v_seen = 0 then
    n := public.mon_raise('P2', 'aqarcity_arabic_city_stranded', 'aqarcity', 'aqarcity_arabic_city_stranded:BLIND',
      jsonb_build_object('blind', true, 'why', 'search_listings_ar holds no aqarcity row, so this detector proves nothing.'));
    perform public.mon_resolve_stale_keys('aqarcity_arabic_city_stranded', array['aqarcity_arabic_city_stranded:BLIND']);
    return n;
  end if;
  select count(*), min(x.id) into v_n, v_ex from (
    select r.id from public.aqarcity_residential_listings r
      join public.search_listings_ar s on s.source_table = 'aqarcity_residential_listings' and s.listing_id = r.id
     where r.active and s.city_id is null
       and exists (select 1 from public.aqarcity_arabic_city_pin(r.additional_info->>'city_ar', r.region) p where p.city_ar is not null)
    union all
    select r.id from public.aqarcity_commercial_listings r
      join public.search_listings_ar s on s.source_table = 'aqarcity_commercial_listings' and s.listing_id = r.id
     where r.active and s.city_id is null
       and exists (select 1 from public.aqarcity_arabic_city_pin(r.additional_info->>'city_ar', r.region) p where p.city_ar is not null)
  ) x;
  if coalesce(v_n, 0) = 0 then
    perform public.mon_resolve_stale_keys('aqarcity_arabic_city_stranded', array[]::text[]);
    return 0;
  end if;
  n := public.mon_raise('P2', 'aqarcity_arabic_city_stranded', 'aqarcity', 'aqarcity_arabic_city_stranded:stranded',
    jsonb_build_object('rows', v_n, 'example', 'aqarcity:' || v_ex,
      'why', 'An active aqarcity listing names a town the catalog places (aqarcity_arabic_city_pin) but search serves it '
          || 'with no city, so it is not production_ready and no customer can find it.',
      'action', 'Check resolve_english_city_before_sync still calls resolve_aqarcity_arabic_city_before_sync (cron :20) '
          || 'and that the :20 refresh / :22 sync ran; a row placed after the last sync clears on the next one.'));
  perform public.mon_resolve_stale_keys('aqarcity_arabic_city_stranded', array['aqarcity_arabic_city_stranded:stranded']);
  return n;
end
$function$;

do $$
declare src text; out_def text;
begin
  src := pg_get_functiondef('public.mon_run_all_detectors()'::regprocedure);
  if position('mon_detect_aqarcity_arabic_city_stranded' in src) > 0 then
    raise notice 'mon_detect_aqarcity_arabic_city_stranded already on the roster';
    return;
  end if;
  out_def := replace(src,
    E'    ''mon_detect_district_plan_number_stranded'',',
    E'    ''mon_detect_district_plan_number_stranded'',\n    ''mon_detect_aqarcity_arabic_city_stranded'',');
  if out_def = src then
    raise exception 'roster anchor not found — refusing to guess where the entry belongs';
  end if;
  execute out_def;
end $$;

insert into public.ops_repair_guarantee_registry (repair_version, repair_name, invariant, detector, registered_by,
                                                  last_verified_at, last_verdict, last_detail)
values (to_char(now() at time zone 'utc', 'YYYYMMDDHH24MISS'), 'aqarcity_arabic_city_overlay',
        'No active aqarcity listing whose Arabic city the catalog places (unique in its published region, or unique '
        || 'nationwide when none is published) is served city-less after the :20 refresh / :22 sync.',
        'mon_detect_aqarcity_arabic_city_stranded', 'new_listings_engineer', now(), 'undetermined',
        jsonb_build_object('stranded_before', 120, 'placeable_before', 73, 'example', 'aqarcity_residential_listings:17370735',
                           'cause_fix', 'resolve_aqarcity_arabic_city_before_sync via resolve_english_city_before_sync',
                           'detector_on_roster', true))
on conflict do nothing;

-- Check block: EXECUTE the pin on known answers and the resolver itself.
do $$
declare v text; k int;
begin
  select city_ar into v from public.aqarcity_arabic_city_pin('بلجرشى', 'Al Bahah');
  if v is distinct from 'بلجرشي' then raise exception 'pin(بلجرشى, Al Bahah) = %, want بلجرشي', v; end if;
  select city_ar into v from public.aqarcity_arabic_city_pin('ضيده', null);
  if v is distinct from 'ضيدة' then raise exception 'pin(ضيده, null) = %, want ضيدة', v; end if;
  select count(*) into k from public.aqarcity_arabic_city_pin('الشيحيه', null);   -- three regions: no pin
  if k <> 0 then raise exception 'ambiguous الشيحيه placed without a region'; end if;
  select city_ar into v from public.aqarcity_arabic_city_pin('الشيحيه', 'Hail');
  if v is distinct from 'الشيحية' then raise exception 'pin(الشيحيه, Hail) = %', v; end if;
  select count(*) into k from public.aqarcity_arabic_city_pin('بلجرشى', 'Nowhere');  -- unreadable region: no pin
  if k <> 0 then raise exception 'an unreadable region must not fall back to nationwide'; end if;
  k := public.resolve_aqarcity_arabic_city_before_sync();
  if k < 50 then raise exception 'resolver placed only % rows (measured 73 placeable)', k; end if;
  if position('resolve_aqarcity_arabic_city_before_sync' in pg_get_functiondef('public.resolve_english_city_before_sync()'::regprocedure)) = 0 then
    raise exception 'not wired into resolve_english_city_before_sync';
  end if;
end $$;
