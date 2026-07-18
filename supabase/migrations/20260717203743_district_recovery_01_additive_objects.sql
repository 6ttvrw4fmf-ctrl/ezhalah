-- District recovery — Migration 1 of 3: ADDITIVE objects (nothing reads these yet).
-- Owner-approved 2026-07-17. Recovers districts the pipeline dropped by never reading the raw
-- `neighborhood` column. NEVER-GUESS: English only if the bridge translation is globally unambiguous
-- AND the resulting Arabic district is already attested in the listing's confirmed city; Arabic only if
-- it normalizes to a district already attested in that city. Anything ambiguous/unmapped -> NULL.

-- 1) Canonical district snapshot (breaks the circular dependency: resolver reads this, not the live index).
create table if not exists public.loc_canonical_district (
  city_id integer not null,
  district_norm text not null,
  canonical_district_ar text not null,
  source text not null,               -- 'catalog' | 'live'
  refreshed_at timestamptz not null default now(),
  primary key (city_id, district_norm)
);

create or replace function public.refresh_loc_canonical_district()
returns bigint
language plpgsql
as $$
declare n bigint;
begin
  truncate public.loc_canonical_district;
  insert into public.loc_canonical_district (city_id, district_norm, canonical_district_ar, source, refreshed_at)
  with cat as (
    select city_id, norm_district_tok(district_ar) k, district_ar sp, 0 as pref, 1::bigint cnt
    from public.loc_catalog_district
    where district_ar is not null and btrim(district_ar) <> ''
  ),
  liv as (
    select city_id, norm_district_tok(district_ar) k, district_ar sp, 1 as pref, count(*)::bigint cnt
    from public.search_listings_ar
    where production_ready and district_ar is not null and btrim(district_ar) <> ''
    group by 1,2,3
  ),
  allrows as (select * from cat union all select * from liv),
  ranked as (
    select city_id, k, sp, pref,
      row_number() over (partition by city_id, k order by pref asc, cnt desc, length(sp) asc, sp asc) rn
    from allrows
    where k is not null and k <> ''
  )
  select city_id, k, sp, case when pref = 0 then 'catalog' else 'live' end, now()
  from ranked where rn = 1;
  get diagnostics n = row_count;
  return n;
end;
$$;

-- 2) The resolver. Reproduces exactly the audited "safe" set (Arabic-canonical-in-city + English-unambiguous-attested).
create or replace function public.resolve_district_ar(p_city_id integer, p_neighborhood text)
returns text
language plpgsql
stable
as $$
declare
  v text := btrim(coalesce(p_neighborhood, ''));
  k text;
  en text;
  gk integer;
  result text;
begin
  if v = '' or p_city_id is null then
    return null;
  end if;

  if v ~ '[ء-ي]' then
    -- Arabic: accept only if it normalizes to a district already attested in THIS city.
    k := norm_district_tok(v);
    if k is null or k = '' then return null; end if;
    select canonical_district_ar into result
      from public.loc_canonical_district
     where city_id = p_city_id and district_norm = k;
    return result;  -- NULL => not attested in this city (never-guess: leave unmatched)
  else
    -- English/Latin: translate via bridge; require UNAMBIGUOUS translation AND attested in this city.
    en := norm_en_district(v);
    if en is null or en = '' then return null; end if;
    select count(distinct norm_district_tok(district_ar)) into gk
      from public.district_name_bridge
     where norm_en_district(district_en) = en;
    if gk is distinct from 1 then
      return null;  -- 0 => no translation; >1 => ambiguous. Never guess.
    end if;
    select distinct norm_district_tok(district_ar) into k
      from public.district_name_bridge
     where norm_en_district(district_en) = en;
    select canonical_district_ar into result
      from public.loc_canonical_district
     where city_id = p_city_id and district_norm = k;
    return result;  -- NULL => translated district not attested in this city: leave unmatched
  end if;
end;
$$;

-- 3) Materialized recovery map (source_table, listing_id) -> recovered Arabic district. v2 will COALESCE onto this.
create table if not exists public.district_recovery (
  source_table text not null,
  listing_id bigint not null,
  district_ar text not null,
  resolved_at timestamptz not null default now(),
  primary key (source_table, listing_id)
);

-- Self-maintaining: iterates every *_listings table that has a `neighborhood` column, bounded per-table
-- (v1 filtered to that platform's null-district rows, PK lookup into the source). Keyed off v1.district_ar
-- (the NATIVE district, which this fix never touches) so it can never flip-flop across refreshes.
create or replace function public.refresh_district_recovery()
returns bigint
language plpgsql
as $$
declare
  r record;
  n bigint := 0;
  m bigint;
begin
  truncate public.district_recovery;
  for r in
    select c.table_name as t
    from information_schema.columns c
    where c.table_schema = 'public' and c.column_name = 'neighborhood' and c.table_name like '%\_listings'
      and exists (select 1 from information_schema.columns i
                  where i.table_schema = 'public' and i.table_name = c.table_name and i.column_name = 'id')
  loop
    execute format($f$
      insert into public.district_recovery (source_table, listing_id, district_ar, resolved_at)
      select %L, v1.listing_id, d.val, now()
      from public.listing_native_location_v1 v1
      join (select distinct on (id) id, neighborhood from public.%I order by id, neighborhood) x
        on x.id = v1.listing_id
      cross join lateral (select public.resolve_district_ar(v1.city_id, x.neighborhood) as val) d
      where v1.source_table = %L
        and v1.city_id is not null
        and (v1.district_ar is null or btrim(v1.district_ar) = '')
        and d.val is not null
      on conflict (source_table, listing_id)
        do update set district_ar = excluded.district_ar, resolved_at = excluded.resolved_at
    $f$, r.t, r.t, r.t);
    get diagnostics m = row_count;
    n := n + m;
  end loop;
  return n;
end;
$$;
