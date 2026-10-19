-- eastabha residential carries «furnished» from the ad's own words (🔬 AF engineer, 2026-10-18, backlog 626).
-- eastabha's WP Residence feature checklist has no furnished item and the table had no column, so
-- listing_extra_attrs_v0 read «NULL::boolean AS furnished» and the 37 of 175 active ads whose text names their
-- furnishing never answered the Advanced Filter's furnished question (ops_af_score 10-17 and 10-18: the eastabha
-- misses asked furnished). By law §2 the ad's words are then the statement, read by the shared
-- normalize.amenities_from_lines; scrapers/eastabha/run.py furnished_answer() writes it on every crawl.
-- No rows are written here: the next crawl fills the column. Same shape as 20261016153455 (eaqartabuk).
alter table public.eastabha_residential_listings add column if not exists furnished boolean;

do $m$
declare
  v text := pg_get_viewdef('public.listing_extra_attrs_v0'::regclass);
  o text := $q$SELECT 'eastabha_residential_listings'::text AS source_table,
    x.id AS listing_id,
    NULL::boolean AS furnished,$q$;
  n text := $q$SELECT 'eastabha_residential_listings'::text AS source_table,
    x.id AS listing_id,
    x.furnished AS furnished,$q$;
  hits int;
begin
  hits := (length(v) - length(replace(v, o, ''))) / length(o);
  if hits <> 1 then raise exception 'eastabha residential anchor matched % times (want 1)', hits; end if;
  execute 'create or replace view public.listing_extra_attrs_v0 as ' || replace(v, o, n);
end $m$;

do $c$
begin
  -- pg_get_viewdef prints «x.furnished,» (the alias equals the column name, so it is dropped).
  if position($q$x.furnished,$q$ in
       substr(pg_get_viewdef('public.listing_extra_attrs_v0'::regclass),
              position($q$'eastabha_residential_listings'::text$q$ in pg_get_viewdef('public.listing_extra_attrs_v0'::regclass)), 200)) = 0 then
    raise exception 'eastabha furnished arm did not land in listing_extra_attrs_v0';
  end if;
end $c$;
