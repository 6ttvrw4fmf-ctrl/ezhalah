-- APPLIED 2026-10-18 (owner session), third step after 20261018081657 / 20261018083435.
--
-- WASALT (owner 10-18 «fix everything»): 580 live wasalt rows served no district. 239 of them carry an English zone
-- («Al-Khaleej», «Ghirnatah», «Al-Yarmuk») that the source-attested EN→AR bridge (district_name_bridge: wasalt's own
-- /en ↔ /ar pairs for the same listing, «An-Narjis/Riyadh → حي النرجس» ×3,180) translates EXACTLY — yet the recovery
-- passed v1.city_id, which is NULL for them (their /ar page answered a shell, so v1's native arm has no Arabic city),
-- and resolve_district_ar() answers NULL without a city. The index serves a city for every one of them (v2's alias /
-- bridge fallbacks): the district is now resolved in the city the user actually filters on — coalesce(v1.city_id,
-- the served city). Fleet-wide the same gap held ksaaqar 41, bahadhabab 23, sirdab 7, aqarmonthly 3, alhoshan 1.
-- Nothing is guessed: the English branch still requires ONE translation (n_distinct = 1) attested in THAT city.
--
-- ONE ALLOWLIST: #7485 created public.ops_district_silent_source (+ district_blank_unexplained, its daily P2) the same
-- morning as 20261018083435 created public.district_silent_proven (+ my P2 'district_null_unproven'). Two tables and two
-- alarms for one question is how proofs get written to the wrong place: mine are retired — the measurement reads
-- #7485's table, my P2 limb is removed (its open alert resolved), my empty table dropped. P1 'source_district_dropped'
-- (the source names a district, we serve none) stays: #7485's detector does not separate it from a blank source.
--
-- PROOF at apply: wasalt rows whose English zone resolves in the served city drop to 0; the v1-city-only recovery
-- restored in a rolled-back sub-transaction re-drops ≥ 200; the open P2 is resolved; P1 still rostered.

create or replace function public.refresh_district_recovery_table(p_table text)
returns bigint
language plpgsql
as $function$
declare m bigint; n bigint := 0; has_url boolean;
begin
  select exists (select 1 from information_schema.columns c
                  where c.table_schema = 'public' and c.table_name = p_table and c.column_name = 'listing_url') into has_url;
  delete from public.district_recovery where source_table = p_table;
  execute format($f$
    insert into public.district_recovery (source_table, listing_id, district_ar, resolved_at, verbatim)
    select %1$L, v1.listing_id, d.val, now(),
           public.norm_district_tok(d.val) = public.norm_district_tok(x.neighborhood)
    from public.listing_native_location_v1 v1
    join (select distinct on (id) id, neighborhood, %3$s as listing_url from public.%2$I order by id, neighborhood) x
      on x.id = v1.listing_id
    -- 2026-10-18: the city the user filters on when v1 has none (wasalt shell pages, 239 rows)
    left join public.search_listings_ar s on s.source_table = v1.source_table and s.listing_id = v1.listing_id
    cross join lateral (select public.district_recovery_value(v1.platform, coalesce(v1.city_id, s.city_id), x.neighborhood, x.listing_url) as val) d
    where v1.source_table = %1$L
      and (v1.district_ar is null or btrim(v1.district_ar) = '')
      and d.val is not null
      and not exists (
            select 1 from public.listing_source_district_ar sd
            where sd.source_table = v1.source_table and sd.listing_id = v1.listing_id)
    on conflict (source_table, listing_id)
      do update set district_ar = excluded.district_ar, resolved_at = excluded.resolved_at,
                    verbatim = excluded.verbatim
  $f$, p_table, p_table, case when has_url then 'listing_url' else 'null::text' end);
  get diagnostics m = row_count;
  n := n + m;

  insert into public.district_recovery (source_table, listing_id, district_ar, resolved_at, verbatim)
  select v1.source_table, v1.listing_id, d.val, now(),
         public.norm_district_tok(d.val) = public.norm_district_tok(sd.source_district_ar)
  from public.listing_native_location_v1 v1
  join public.listing_source_district_ar sd
    on sd.source_table = v1.source_table and sd.listing_id = v1.listing_id
  left join public.search_listings_ar s on s.source_table = v1.source_table and s.listing_id = v1.listing_id
  cross join lateral (select public.district_recovery_value(v1.platform, coalesce(v1.city_id, s.city_id), sd.source_district_ar) as val) d
  where v1.source_table = p_table
    and (v1.district_ar is null or btrim(v1.district_ar) = '')
    and d.val is not null
  on conflict (source_table, listing_id)
    do update set district_ar = excluded.district_ar, resolved_at = excluded.resolved_at,
                  verbatim = excluded.verbatim;
  get diagnostics m = row_count;
  return n + m;
end $function$;

-- The measurement reads #7485's allowlist (a platform-wide proof = source_table null there).
create or replace function public.source_district_dropped_rows(p_grace interval default interval '0')
returns table (platform text, source_table text, null_rows bigint, dropped bigint, blank bigint, numbered bigint,
               english bigint, silent_proven boolean)
language plpgsql stable security definer set search_path to 'public'
as $function$
declare t text;
begin
  for t in
    select c.table_name from information_schema.columns c
    where c.table_schema = 'public' and c.column_name = 'neighborhood' and c.table_name ~ '_(residential|commercial)_listings$'
      and exists (select 1 from information_schema.columns i
                  where i.table_schema = 'public' and i.table_name = c.table_name and i.column_name = 'id')
  loop
    return query execute format($q$
      with r as (
        select nullif(btrim(r.neighborhood), '') as nb, s.last_updated,
               exists (select 1 from public.listings_arabic_locations l
                        where l.source_table = s.source_table and l.listing_id = s.listing_id
                          and l.review_reason like 'city_only_match%%') as city_only
        from public.search_listings_ar s
        join public.%I r on r.id = s.listing_id
        where s.source_table = %L and s.production_ready and s.district_ar is null
      )
      select %L::text, %L::text, count(*)::bigint,
             count(*) filter (where nb ~ '[ء-ي]' and nb !~ '[0-9٠-٩]'
                                and public.norm_district_tok(nb) not in
                                    ('', public.norm_district_tok('غير محدد'), public.norm_district_tok('اخرى'), public.norm_district_tok('أخرى'))
                                and not city_only and (last_updated is null or last_updated < now() - $1))::bigint,
             count(*) filter (where not city_only and (nb is null or public.norm_district_tok(nb) in
                                    ('', public.norm_district_tok('غير محدد'), public.norm_district_tok('اخرى'), public.norm_district_tok('أخرى'))))::bigint,
             count(*) filter (where nb ~ '[ء-ي]' and nb ~ '[0-9٠-٩]')::bigint,
             count(*) filter (where nb is not null and nb !~ '[ء-ي]')::bigint,
             exists (select 1 from public.ops_district_silent_source o where o.platform = %L and o.source_table is null)
      from r
      having count(*) > 0 $q$,
      t, t, regexp_replace(t, '_(residential|commercial)_listings$', ''), t,
      regexp_replace(t, '_(residential|commercial)_listings$', '')) using p_grace;
  end loop;
end $function$;

-- P1 only: the source names a district and we serve none. Blank sources are #7485's district_blank_unexplained.
create or replace function public.mon_detect_source_district_dropped()
returns integer
language plpgsql security definer set search_path to 'public'
as $function$
declare v_dropped bigint; v_table jsonb; v_open text; r int := 0;
begin
  with t as (
    select d.platform, sum(d.null_rows) null_rows, sum(d.dropped) dropped, sum(d.blank) blank, sum(d.numbered) numbered,
           sum(d.english) english
    from public.source_district_dropped_rows(interval '3 hours') d group by d.platform
  )
  select coalesce(sum(dropped), 0),
         coalesce(jsonb_agg(jsonb_build_object('platform', platform, 'null_rows', null_rows, 'dropped', dropped, 'blank', blank,
                    'numbered', numbered, 'english', english) order by dropped desc, null_rows desc), '[]'::jsonb)
    into v_dropped, v_table
  from t;
  select severity into v_open from public.alert_event
   where dedup_key = 'source_district_dropped' and resolved_at is null order by created_at desc limit 1;
  if v_dropped = 0 then
    if v_open is not null then perform public.mon_resolve('source_district_dropped', 'location_pipeline'); end if;
  elsif v_open is null then
    r := public.mon_raise('P1', 'source_district_dropped', 'location_pipeline', 'source_district_dropped',
      jsonb_build_object('dropped', v_dropped, 'per_platform', v_table, 'for', '🔧',
        'why', 'The source field names an Arabic district for these live ads and OUR index serves none (older than the 3 h pipeline grace). SOURCE IS TRUTH: district_recovery_value() carries the source word when the catalog has no match, resolved in the served city (20261018081657 → 20261018111622). Check refresh_district_recovery() ran (cron 45/17) and the sync wrote; never fix by hand-NULLing the source. Blank sources: district_blank_unexplained (#7485).'));
  end if;
  return r;
end $function$;

-- Retire the duplicate allowlist and its alarm.
select public.mon_resolve('district_null_unproven', 'location_pipeline')
 where exists (select 1 from public.alert_event where dedup_key = 'district_null_unproven' and resolved_at is null);
do $drop$
begin
  if (select count(*) from public.district_silent_proven) > 0 then
    raise exception 'district_silent_proven holds rows — move them to ops_district_silent_source first';
  end if;
end $drop$;
drop table public.district_silent_proven;

-- PROOF
create or replace function pg_temp.wasalt_resolvable_dropped() returns bigint language sql as $t$
  select count(*) from public.listing_native_location_v2 v
    join public.wasalt_residential_listings w on w.id = v.listing_id
    join public.search_listings_ar s on s.source_table = v.source_table and s.listing_id = v.listing_id
   where v.source_table = 'wasalt_residential_listings' and v.district_ar is null
     and exists (select 1 from public.listing_native_location_v1 v1 where v1.source_table = v.source_table and v1.listing_id = v.listing_id)
     and public.resolve_district_ar(s.city_id, w.neighborhood) is not null
$t$;

do $proof$
declare n bigint; r bigint; before_n bigint;
begin
  before_n := pg_temp.wasalt_resolvable_dropped();
  perform public.refresh_district_recovery_table('wasalt_residential_listings');
  n := pg_temp.wasalt_resolvable_dropped();
  if n <> 0 then raise exception 'PROOF: % wasalt rows still drop a district their served city resolves', n; end if;
  if before_n < 200 then raise exception 'PROOF: expected ≥ 200 resolvable dropped wasalt rows before, saw %', before_n; end if;

  begin
    execute replace(pg_get_functiondef('public.refresh_district_recovery_table'::regproc),
                    'coalesce(v1.city_id, s.city_id)', 'v1.city_id');
    perform public.refresh_district_recovery_table('wasalt_residential_listings');
    r := pg_temp.wasalt_resolvable_dropped();
    if r < 200 then raise exception 'PROOF: with the v1-city-only recovery restored only % rows dropped, want ≥ 200', r; end if;
    raise exception 'ROLLBACK_REVERT';
  exception when others then
    if sqlerrm <> 'ROLLBACK_REVERT' then raise; end if;
  end;
  if pg_temp.wasalt_resolvable_dropped() <> 0 then raise exception 'PROOF: the revert survived the rollback'; end if;
  if exists (select 1 from public.alert_event where dedup_key = 'district_null_unproven' and resolved_at is null) then
    raise exception 'PROOF: the retired P2 is still open';
  end if;
  if (select count(*) from unnest(public.mon_orphaned_detectors()) o where o = 'mon_detect_source_district_dropped') <> 0 then
    raise exception 'PROOF: the detector reads as orphaned';
  end if;
  raise notice 'PROOF OK: wasalt % → 0 (served-city recovery); v1-city-only → caught; duplicate allowlist retired', before_n;
end $proof$;
