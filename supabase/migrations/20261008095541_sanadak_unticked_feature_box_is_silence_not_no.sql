-- 🔬 AF engineer 2026-10-08: sanadak's unticked feature box is silence, not «no».
--
-- sanadak's listing payload carries isDriverRoomAvailable / isSwimmingPoolAvailable / isGymAvailable /
-- isGardenAvailable on EVERY ad (677 of 677 live), false by default. The page prints its feature grid
-- («غرفة سائق: متاح», «مصعد: غير متوفر») only when the advertiser filled the form; on ads that did not,
-- the grid is absent and the payload still says false. Measured on the live pages (source-reread run
-- 37759535275): sanadak_residential_listings:12839000 and :5174841 store driver_room = false, print no
-- feature grid, and their own description states «غرفة سائق»; :11781246 prints the grid. Nothing in the
-- payload tells the two apart, so false is not a statement the source made: it is unknown, and unknown
-- is never «no» (ADVANCED_FILTER_SOURCE_TRUTH §1). A ticked box (true) stays yes.
-- 806 of 835 served sanadak rows said driver_room = false before this.
--
-- Both views are rebuilt from their LIVE definitions with only these CASE arms changed (rolled-back dry
-- run: each new definition reverts byte-for-byte to the old one when only these arms are reverted, and
-- all 5 arms sit in sanadak blocks), and the served index is re-derived exactly as
-- sync_search_listings_ar() would compute it from the views.
do $$
declare
  v_def text;
  n_dr int; n_pool int; n_gym int; n_garden int;
begin
  v_def := pg_get_viewdef('public.listing_extra_attrs_v0'::regclass);
  v_def := regexp_replace(v_def,
    '(CASE \((\w+)\.source_capture ->> ''isDriverRoomAvailable''::text\)\s+WHEN ''true''::text THEN true\s+WHEN ''false''::text THEN )false',
    '\1NULL::boolean', 'g');
  execute 'create or replace view public.listing_extra_attrs_v0 as ' || v_def;

  v_def := pg_get_viewdef('public.listing_rich_attrs'::regclass);
  v_def := regexp_replace(v_def,
    '(CASE \((\w+)\.source_capture ->> ''(isSwimmingPoolAvailable|isGymAvailable|isGardenAvailable)''::text\)\s+WHEN ''true''::text THEN true\s+WHEN ''false''::text THEN )false',
    '\1NULL::boolean', 'g');
  execute 'create or replace view public.listing_rich_attrs as ' || v_def;

  if pg_get_viewdef('public.listing_extra_attrs_v0'::regclass) ~ 'isDriverRoomAvailable''::text\)\s+WHEN ''true''::text THEN true\s+WHEN ''false''::text THEN false'
     or pg_get_viewdef('public.listing_rich_attrs'::regclass) ~ '(isSwimmingPoolAvailable|isGymAvailable|isGardenAvailable)''::text\)\s+WHEN ''true''::text THEN true\s+WHEN ''false''::text THEN false' then
    raise exception 'sanadak checkbox arms still map false to false';
  end if;

  update public.search_listings_ar set driver_room = null
   where platform = 'sanadak' and driver_room is false;
  get diagnostics n_dr = row_count;
  update public.search_listings_ar set pool = null where platform = 'sanadak' and pool is false;
  get diagnostics n_pool = row_count;
  update public.search_listings_ar set gym = null where platform = 'sanadak' and gym is false;
  get diagnostics n_gym = row_count;
  update public.search_listings_ar set garden = null where platform = 'sanadak' and garden is false;
  get diagnostics n_garden = row_count;
  raise notice 'sanadak unticked box -> NULL in search: driver_room %, pool %, gym %, garden %', n_dr, n_pool, n_gym, n_garden;
end $$;