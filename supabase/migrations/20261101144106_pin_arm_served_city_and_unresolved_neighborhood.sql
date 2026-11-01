-- Pin arm: judge the pin in the SERVED city, and let it fill an ad whose neighborhood text resolved to no district
-- (backlog 1099, owner session 2026-10-30; 🆕 2026-11-01).
-- Measured 2026-11-01 07:15 UTC: 87 applied listing_pin_district rows still served with NO district (rightcompound 60,
-- wasalt 9, haraj 6, abeea 5, gathern 3, muktamel 3, ialqarawi 1). Two clauses blocked them:
--   1. p.city_id = coalesce(v1.city_id, s.city_id): v1 holds the RAW site city, the index serves the corrected one
--      (listing_city_correction), and the pin was judged in the served city -> now coalesce(s.city_id, v1.city_id).
--   2. nullif(btrim(x.neighborhood), '') is null: «Doha», «Moh», «AL- Thumamah street» are not blank, but they resolved to
--      no district (served district_ar NULL). The pin may now fill such an ad; a neighborhood that DID resolve already holds
--      its row in _drt (the arms above run first), so it still wins — written out explicitly, not left to ON CONFLICT.
-- Everything else is the live definition byte-for-byte (md5 of the edited live text = 24ca0091ac0264828b7761179f48ba76).
-- The source-stated district, the native district, ON CONFLICT DO NOTHING, the loss guard: unchanged.
-- Undo: re-run the previous definition (pg_get_functiondef md5 68099c4195b5c440ecbb8b3e4de0302b, migration 20261025035403 arm).
CREATE OR REPLACE FUNCTION public.refresh_district_recovery_table(p_table text)
 RETURNS bigint
 LANGUAGE plpgsql
AS $function$
declare m bigint; n bigint := 0; has_url boolean; v_elig bigint; v_lost bigint;
begin
  select exists (select 1 from information_schema.columns c
                  where c.table_schema = 'public' and c.table_name = p_table and c.column_name = 'listing_url') into has_url;
  create temp table if not exists _drt (
    source_table text, listing_id bigint, district_ar text, resolved_at timestamptz, verbatim boolean, basis text,
    primary key (source_table, listing_id)) on commit drop;
  delete from _drt;

  execute format($f$
    insert into _drt (source_table, listing_id, district_ar, resolved_at, verbatim)
    select %1$L, v1.listing_id, d.val, now(),
           public.norm_district_tok(d.val) = public.norm_district_tok(x.neighborhood)
    from public.listing_native_location_v1 v1
    join (select distinct on (id) id, neighborhood, %3$s as listing_url from public.%2$I order by id, neighborhood) x
      on x.id = v1.listing_id
    left join public.search_listings_ar s on s.source_table = v1.source_table and s.listing_id = v1.listing_id
    cross join lateral (select public.district_recovery_value(v1.platform, coalesce(v1.city_id, s.city_id), x.neighborhood, x.listing_url) as val) d
    where v1.source_table = %1$L
      and (v1.district_ar is null or btrim(v1.district_ar) = '')
      and d.val is not null
      and not exists (
            select 1 from public.listing_source_district_ar sd
            where sd.source_table = v1.source_table and sd.listing_id = v1.listing_id)
    on conflict (source_table, listing_id) do nothing
  $f$, p_table, p_table, case when has_url then 'listing_url' else 'null::text' end);

  insert into _drt (source_table, listing_id, district_ar, resolved_at, verbatim)
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
  on conflict (source_table, listing_id) do update
    set district_ar = excluded.district_ar, resolved_at = excluded.resolved_at, verbatim = excluded.verbatim;

  -- PIN ARM (owner 2026-10-24), LAST and ON CONFLICT DO NOTHING: it only fills an ad that nothing above resolved.
  -- It never touches an ad whose source states a district, whose native/recovered district exists, or whose
  -- neighborhood is not blank; and the pin's city must be the city the ad is served in.
  execute format($f$
    insert into _drt (source_table, listing_id, district_ar, resolved_at, verbatim, basis)
    select p.source_table, p.listing_id, p.district_ar, now(), false, 'pin'
    from public.listing_pin_district p
    join public.listing_native_location_v1 v1 on v1.source_table = p.source_table and v1.listing_id = p.listing_id
    join (select distinct on (id) id, neighborhood from public.%1$I order by id, neighborhood) x on x.id = p.listing_id
    left join public.search_listings_ar s on s.source_table = p.source_table and s.listing_id = p.listing_id
    where p.source_table = %2$L
      and p.applied
      and p.city_id = coalesce(s.city_id, v1.city_id)
      and (v1.district_ar is null or btrim(v1.district_ar) = '')
      and (nullif(btrim(x.neighborhood), '') is null
           or not exists (select 1 from _drt t where t.source_table = p.source_table and t.listing_id = p.listing_id))
      and not exists (
            select 1 from public.listing_source_district_ar sd
            where sd.source_table = p.source_table and sd.listing_id = p.listing_id)
    on conflict (source_table, listing_id) do nothing
  $f$, p_table, p_table);

  -- LOSS GUARD: districts recovered last time for listings STILL eligible in v1, missing from the new set
  select count(*), count(*) filter (where n2.listing_id is null) into v_elig, v_lost
    from public.district_recovery o
    join public.listing_native_location_v1 v1 on v1.source_table = o.source_table and v1.listing_id = o.listing_id
    left join _drt n2 on n2.source_table = o.source_table and n2.listing_id = o.listing_id
   where o.source_table = p_table and (v1.district_ar is null or btrim(v1.district_ar) = '');
  if v_elig >= 50 and v_lost > 0.01 * v_elig then
    insert into public.location_pipeline_alerts (alert_type, metric, detail)
    values ('district_recovery_shrank', v_lost,
            format('%s: the new refill would lose %s of %s recovered districts of still-eligible listings (> 1%%) — kept the previous rows (owner 10-18: never drop a district). Find what changed in resolve_district_ar / district_recovery_value / the catalog.', p_table, v_lost, v_elig));
    return 0;
  end if;

  delete from public.district_recovery where source_table = p_table;
  insert into public.district_recovery (source_table, listing_id, district_ar, resolved_at, verbatim, basis)
  select source_table, listing_id, district_ar, resolved_at, verbatim, basis from _drt;
  get diagnostics m = row_count;
  return m;
end $function$;

-- Check block: EXECUTE the new function on the largest affected table and prove the pin rows land.
do $chk$
declare v_n bigint; v_pin bigint;
begin
  v_n := public.refresh_district_recovery_table('rightcompound_residential_listings');
  select count(*) into v_pin
    from public.district_recovery r
    join public.listing_pin_district p on p.source_table = r.source_table and p.listing_id = r.listing_id
   where r.source_table = 'rightcompound_residential_listings' and r.basis = 'pin' and p.applied;
  if v_pin < 60 then
    raise exception 'pin arm check failed: % rightcompound pin rows in district_recovery (expected >= 60), refill returned %', v_pin, v_n;
  end if;
  raise notice 'pin arm ok: % rightcompound pin rows, refill %', v_pin, v_n;
end $chk$;
