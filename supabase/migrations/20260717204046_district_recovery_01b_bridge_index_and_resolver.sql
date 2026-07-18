-- District recovery — Migration 1b: precomputed EN->AR bridge lookup (perf) + resolver using it.
create table if not exists public.bridge_en_district (
  en_norm text primary key,
  district_norm text,
  n_distinct integer not null
);

create or replace function public.refresh_bridge_en_district()
returns bigint
language plpgsql
as $$
declare n bigint;
begin
  truncate public.bridge_en_district;
  insert into public.bridge_en_district (en_norm, district_norm, n_distinct)
  select en_norm,
         case when count(distinct dk) = 1 then min(dk) else null end,
         count(distinct dk)::int
  from (
    select norm_en_district(district_en) en_norm, norm_district_tok(district_ar) dk
    from public.district_name_bridge
  ) z
  where en_norm is not null and en_norm <> '' and dk is not null and dk <> ''
  group by en_norm;
  get diagnostics n = row_count;
  return n;
end;
$$;

create or replace function public.resolve_district_ar(p_city_id integer, p_neighborhood text)
returns text
language plpgsql
stable
as $$
declare
  v text := btrim(coalesce(p_neighborhood, ''));
  k text;
  en text;
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
    return result;
  else
    -- English/Latin: require UNAMBIGUOUS bridge translation AND attestation in this city.
    en := norm_en_district(v);
    if en is null or en = '' then return null; end if;
    select district_norm into k
      from public.bridge_en_district
     where en_norm = en and n_distinct = 1;
    if k is null then return null; end if;   -- no translation, or ambiguous
    select canonical_district_ar into result
      from public.loc_canonical_district
     where city_id = p_city_id and district_norm = k;
    return result;
  end if;
end;
$$;
