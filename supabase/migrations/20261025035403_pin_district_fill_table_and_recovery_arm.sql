create table if not exists public.listing_pin_district (
  source_table text   not null,
  listing_id   bigint not null,
  city_id      integer not null,
  district_ar  text   not null,
  basis        text   not null default 'apple_pin',
  support      integer,
  against      integer,
  run_id       text   not null,
  created_at   timestamptz not null default now(),
  applied      boolean not null default false,
  primary key (source_table, listing_id)
);
comment on table public.listing_pin_district is
  'Pin-derived district for ads that have none (owner 2026-10-24). district_ar is OUR catalog spelling. support/against = ads with a district within ~440 m of the pin that agree/disagree. applied=false rows are inert.';
alter table public.listing_pin_district enable row level security;
revoke all on table public.listing_pin_district from public, anon, authenticated;

alter table public.district_recovery add column if not exists basis text;
comment on column public.district_recovery.basis is
  'NULL = recovered from the ad''s own words; ''pin'' = filled from the ad''s pin (listing_pin_district). Pin rows are verbatim = false.';

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
      and p.city_id = coalesce(v1.city_id, s.city_id)
      and (v1.district_ar is null or btrim(v1.district_ar) = '')
      and nullif(btrim(x.neighborhood), '') is null
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