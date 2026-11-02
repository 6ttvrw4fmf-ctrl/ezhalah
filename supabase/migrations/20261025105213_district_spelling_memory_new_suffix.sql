create table if not exists public.loc_district_alias (
  city_id    integer     not null,
  from_norm  text        not null,
  to_norm    text        not null,
  why        text        not null,
  decided_by text        not null,
  decided_at timestamptz not null default now(),
  primary key (city_id, from_norm),
  check (from_norm <> to_norm)
);
comment on table public.loc_district_alias is
  'Spelling memory (owner-approved, one row per name): a spelling sites use (from_norm = norm_district_tok) that IS one of our districts (to_norm). Applied by loc_display_district_ar, so the served index, its token, the picker and the counts all fold into one district. Cards keep the source''s own words.';
alter table public.loc_district_alias enable row level security;
revoke all on table public.loc_district_alias from public, anon, authenticated;

insert into public.loc_district_alias (city_id, from_norm, to_norm, why, decided_by)
select v.city_id, public.norm_district_tok(v.site_spelling), public.norm_district_tok(v.our_district), v.why, 'owner'
from (values
  (6,  'الهجلة الجديد',  'حي الهجلة',   'owner 2026-10-25: «الهجلة الجديد» is «الهجلة»; sites add «الجديد», there is no separate place'),
  (6,  'الشبيكة الجديد', 'حي الشبيكة',  'owner 2026-10-25: «الشبيكة الجديد» is «الشبيكة»'),
  (10, 'السويفلة الجديد', 'حي السويفلة', 'owner 2026-10-25: «السويفلة الجديد» is «السويفلة»')
) as v(city_id, site_spelling, our_district, why)
on conflict (city_id, from_norm) do nothing;

-- every alias must point at a district that is really in our list for that city
do $chk$
declare bad text;
begin
  select string_agg(a.city_id || ':' || a.to_norm, ', ') into bad
    from public.loc_district_alias a
   where not exists (select 1 from public.loc_catalog_district d where d.city_id = a.city_id and d.district_norm = a.to_norm);
  if bad is not null then raise exception 'alias target not in loc_catalog_district: %', bad; end if;
end $chk$;

CREATE OR REPLACE FUNCTION public.loc_display_district_ar(p_city_id integer, p_raw text)
 RETURNS text
 LANGUAGE sql
 STABLE
AS $function$
  select case when p_raw is null then null else
    coalesce((select k.display_ar from public.loc_display_district_canon k
               where k.city_id = p_city_id
                 and k.district_norm = coalesce(
                       (select a.to_norm from public.loc_district_alias a
                         where a.city_id = p_city_id and a.from_norm = norm_district_tok(p_raw)),
                       norm_district_tok(p_raw))), p_raw)
  end
$function$;

-- apply-time proof: the three spellings now display as our district, and a name without an alias is unchanged
do $proof$
begin
  if public.loc_display_district_ar(6, 'الهجلة الجديد') is distinct from (select display_ar from public.loc_display_district_canon where city_id = 6 and district_norm = public.norm_district_tok('حي الهجلة')) then
    raise exception 'الهجلة الجديد did not fold into الهجلة';
  end if;
  if public.loc_display_district_ar(10, 'السويفلة الجديد') is distinct from (select display_ar from public.loc_display_district_canon where city_id = 10 and district_norm = public.norm_district_tok('حي السويفلة')) then
    raise exception 'السويفلة الجديد did not fold into السويفلة';
  end if;
  if public.loc_display_district_ar(3, 'حي منفوحة الجديدة') is distinct from coalesce((select display_ar from public.loc_display_district_canon where city_id = 3 and district_norm = public.norm_district_tok('حي منفوحة الجديدة')), 'حي منفوحة الجديدة') then
    raise exception 'منفوحة الجديدة changed although it has no alias (it is a separate district)';
  end if;
end $proof$;