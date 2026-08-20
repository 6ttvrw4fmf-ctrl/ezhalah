-- The exact source_table scopes the production client sends to location_search_candidates_ar, HARVESTED
-- from real browser requests (not copied from src/), so the QA differential oracle can be driven by a short
-- scope label instead of a 31-element array per search. Also makes client-vs-index scope drift visible:
-- a table that exists in search_listings_ar but in no client scope is unreachable by that kind of search.
create table if not exists public.ops_qa_scope (
  scope        text primary key,
  tables       text[] not null,
  harvested_at timestamptz not null default now(),
  note         text
);
insert into public.ops_qa_scope (scope, tables, note) values
 ('res', array['aqar_residential_listings','wasalt_residential_listings','aldarim_residential_listings','aqargate_residential_listings','alhoshan_residential_listings','hajer_residential_listings','sanadak_residential_listings','eastabha_residential_listings','aqarcity_residential_listings','raghdan_residential_listings','eaqartabuk_residential_listings','satel_residential_listings','sadin_residential_listings','toor_residential_listings','mustqr_residential_listings','ramzalqasim_residential_listings','fursaghyr_residential_listings','jazwtn_residential_listings','mizlaj_residential_listings','muktamel_residential_listings','aqaratikom_residential_listings','awal_residential_listings','alkhaas_residential_listings','abeea_residential_listings','jurash_residential_listings','alnokhba_residential_listings','dealapp_residential_listings','erapulse_residential_listings','nowaisiry_residential_listings','october_residential_listings','souq24_residential_listings'],
  'RES_TABLES as sent by production on a non-monthly search (harvested 2026-08-20)'),
 ('resm', array['aqar_residential_listings','wasalt_residential_listings','aldarim_residential_listings','aqargate_residential_listings','alhoshan_residential_listings','hajer_residential_listings','sanadak_residential_listings','eastabha_residential_listings','aqarcity_residential_listings','raghdan_residential_listings','eaqartabuk_residential_listings','satel_residential_listings','sadin_residential_listings','toor_residential_listings','mustqr_residential_listings','ramzalqasim_residential_listings','fursaghyr_residential_listings','jazwtn_residential_listings','mizlaj_residential_listings','muktamel_residential_listings','aqaratikom_residential_listings','awal_residential_listings','alkhaas_residential_listings','abeea_residential_listings','jurash_residential_listings','alnokhba_residential_listings','dealapp_residential_listings','erapulse_residential_listings','nowaisiry_residential_listings','october_residential_listings','souq24_residential_listings','gathern_residential_listings','aqarmonthly_residential_listings'],
  'RES_TABLES + the two monthly-only sources, as sent when the period scope includes شهري'),
 ('com', array['aqar_commercial_listings','wasalt_commercial_listings','aldarim_commercial_listings','aqargate_commercial_listings','alhoshan_commercial_listings','hajer_commercial_listings','sanadak_commercial_listings','eastabha_commercial_listings','aqarcity_commercial_listings','raghdan_commercial_listings','eaqartabuk_commercial_listings','satel_commercial_listings','sadin_commercial_listings','toor_commercial_listings','mustqr_commercial_listings','ramzalqasim_commercial_listings','fursaghyr_commercial_listings','jazwtn_commercial_listings','mizlaj_commercial_listings','muktamel_commercial_listings','aqaratikom_commercial_listings','awal_commercial_listings','alkhaas_commercial_listings','abeea_commercial_listings','jurash_commercial_listings','alnokhba_commercial_listings','dealapp_commercial_listings','erapulse_commercial_listings','nowaisiry_commercial_listings','october_commercial_listings','souq24_commercial_listings'],
  'COM_TABLES as sent by production (harvested 2026-08-20)')
on conflict (scope) do update set tables = excluded.tables, harvested_at = now(), note = excluded.note;

create or replace function public.ops_qa_scope_tables(p_scope text)
returns text[] language sql stable as $$ select tables from public.ops_qa_scope where scope = p_scope $$;

-- Scope-label overload of the differential oracle (§40.5) — same predicate, short call site.
create or replace function public.ops_qa_search_differential(
  p_scope      text,
  p_types      text[],
  p_scope2     text     default null,
  p_types2     text[]   default null,
  p_deal       text     default null,
  p_period     text     default null,
  p_cat        text     default null,
  p_cities     text[]   default null,
  p_districts  text[]   default null,
  p_region_ids int[]    default null,
  p_amin       int      default null,
  p_amax       int      default null,
  p_beds       int[]    default null,
  p_bmin       int      default null,
  p_pmin       numeric  default null,
  p_pmax       numeric  default null
) returns table(n bigint, h text)
language sql stable as $$
  select d.n, d.h from public.ops_qa_search_differential(
    public.ops_qa_scope_tables(p_scope), p_types,
    case when p_scope2 is null then null else public.ops_qa_scope_tables(p_scope2) end, p_types2,
    p_deal, p_period, p_cat, p_cities, p_districts, p_region_ids,
    p_amin, p_amax, p_beds, p_bmin, p_pmin, p_pmax) d
$$;
grant execute on function public.ops_qa_scope_tables(text) to authenticated, service_role;
grant execute on function public.ops_qa_search_differential(text,text[],text,text[],text,text,text,text[],text[],int[],int,int,int[],int,numeric,numeric) to authenticated, service_role;
