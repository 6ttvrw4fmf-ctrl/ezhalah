-- PROPERTY FINDER LAUNCH — the internal views stay private (security phase 1.3, 20261021003001).
-- The launch wiring (02/03/04/05, copied from the 2026-10-16 Haraj files, which predate phase 1.3) ends each swap
-- with «GRANT ALL … TO anon, authenticated», and the dependent replay re-creates views that pick up the schema's
-- default privileges (anon/authenticated = SELECT/REFERENCES/TRIGGER/MAINTAIN). Measured before and after the
-- launch on 2026-11-04: these objects were postgres + service_role only before, and had gained anon/authenticated
-- after. This puts every one back exactly as it was; nothing the app reads changes (listing_location_index,
-- listing_location_canonical_mv and location_index_live stay public on purpose, as they were).
do $acl$
declare v text;
begin
  foreach v in array array[
    'active_listing_ids_v2', 'listing_native_location_v1', 'listing_native_location_v2', 'listing_extra_attrs',
    'listing_location_canonical', 'buy_location_index', 'rent_location_index', 'location_review',
    'ops_freshness_by_layer', 'phasea_shadow_resolution', 'platforms_deprecated_status', 'platforms_unsearchable'
  ] loop
    execute format('revoke all on public.%I from anon, authenticated', v);
    execute format('grant select on public.%I to service_role', v);
  end loop;
  -- listing_rich_attrs read anon/authenticated = SELECT/REFERENCES/TRIGGER/MAINTAIN before the launch; 05 widened it to ALL.
  revoke insert, update, delete, truncate on public.listing_rich_attrs from anon, authenticated;
end
$acl$;

do $verify$
declare v text;
begin
  foreach v in array array[
    'active_listing_ids_v2', 'listing_native_location_v1', 'listing_native_location_v2', 'listing_extra_attrs',
    'listing_location_canonical', 'buy_location_index', 'rent_location_index', 'location_review',
    'ops_freshness_by_layer', 'phasea_shadow_resolution', 'platforms_deprecated_status', 'platforms_unsearchable'
  ] loop
    if has_table_privilege('anon', 'public.' || v, 'SELECT') or has_table_privilege('authenticated', 'public.' || v, 'SELECT') then
      raise exception '% is still readable by anon/authenticated', v;
    end if;
  end loop;
  if has_table_privilege('anon', 'public.listing_rich_attrs', 'INSERT')
     or not has_table_privilege('anon', 'public.listing_location_index', 'SELECT')
     or not has_table_privilege('anon', 'public.listing_location_canonical_mv', 'SELECT')
     or not has_table_privilege('anon', 'public.location_index_live', 'SELECT') then
    raise exception 'public read surface is not what it was before the launch';
  end if;
  raise notice 'internal views private again; the app''s public reads unchanged';
end $verify$;
