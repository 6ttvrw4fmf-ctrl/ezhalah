-- eaqartabuk residential carries «furnished» from the ad's own words (🔬 AF engineer, 2026-10-16, backlog 552).
-- eaqartabuk's feature checklist has no furnished item and the table had no column, so listing_extra_attrs_v0
-- read «NULL::boolean AS furnished» and the 18 active ads whose text names their furnishing never answered the
-- Advanced Filter's furnished question. By law §2 the ad's words are then the statement, read by the shared
-- normalize.amenities_from_lines (fixed in the same PR for «الغير مفروش», partly furnished and floor coverings);
-- scrapers/eaqartabuk/run.py furnished_answer() writes it on every crawl from now on.
-- Back-fill values: that reader run on 2026-10-16 over every active ad whose text names furnishing: 15 yes,
-- 1 stated no, 2 unknown (598379 partly furnished, 598600 a turf roof). Written only where NULL.
-- Also: the reader's partly-furnished rule now outranks a plain «مفروشة» elsewhere in the same ad, which
-- changes 6 more dealapp answers YES -> unknown on top of the 33 in 20261016152522 (same replay, 1,831 ads).
alter table public.eaqartabuk_residential_listings add column if not exists furnished boolean;

do $m$
declare
  v text := pg_get_viewdef('public.listing_extra_attrs_v0'::regclass);
  o text := $q$SELECT 'eaqartabuk_residential_listings'::text AS source_table,
    x.id AS listing_id,
    NULL::boolean AS furnished,$q$;
  n text := $q$SELECT 'eaqartabuk_residential_listings'::text AS source_table,
    x.id AS listing_id,
    x.furnished AS furnished,$q$;
  hits int;
begin
  hits := (length(v) - length(replace(v, o, ''))) / length(o);
  if hits <> 1 then raise exception 'eaqartabuk residential anchor matched % times (want 1)', hits; end if;
  execute 'create or replace view public.listing_extra_attrs_v0 as ' || replace(v, o, n);
end $m$;

update public.eaqartabuk_residential_listings set furnished = true
 where furnished is null
   and id = any('{598306,598381,598408,598411,598414,598415,598454,598478,598494,598495,598496,598544,598594,598681,1648007}'::bigint[]);
update public.eaqartabuk_residential_listings set furnished = false
 where furnished is null and id = 598341;

update public.dealapp_residential_listings set furnished = null
 where furnished is true
   and id = any('{8885476,14985571,14986597,16315096,17349132,17927586}'::bigint[]);

do $c$
declare v_view int; v_tab int;
begin
  select count(*) into v_tab from public.eaqartabuk_residential_listings where active and furnished is not null;
  select count(*) into v_view from public.listing_extra_attrs_v0
   where source_table = 'eaqartabuk_residential_listings' and furnished is not null;
  if v_tab < 16 or v_view <> v_tab then
    raise exception 'eaqartabuk furnished did not land: table % view %', v_tab, v_view;
  end if;
  if public.mon_detect_dealapp_partial_furnished_as_yes() <> 0 then
    raise exception 'a dealapp partial furnishing is still stored as yes';
  end if;
end $c$;