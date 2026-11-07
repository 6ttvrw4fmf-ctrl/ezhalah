-- FIVE SOURCES LAUNCH STEP — apply ONLY when the owner says launch (docs/ops/FIVE_SOURCES_LAUNCH.md), in file order.
-- Generated 2026-11-05 from the APPLIED Property Finder launch migration 20261104183209 (the newest shape of this step) with the
-- platform list changed to the five sources (no platform list: re-closes what 02–05 re-open). It refuses if the live shape moved: re-generate, never force.
-- Every view stays read-only for the public key (20261018170933, verify-mon-views-are-not-public.ts). The Property Finder
-- launch wiring (20261104180049 / 180642 / 181014, copied from the 2026-10-16 Haraj files, which predate that rule) ends
-- each swap with «GRANT ALL … TO anon, authenticated». An applied migration cannot be rewritten (content parity), so the
-- writes are closed here, view by view, the way 20261022230940 was closed. SELECT is untouched: listing_location_index
-- stays readable by the app; v1, v2 and listing_extra_attrs were already closed entirely by 20261104181244.
revoke insert, update, delete, truncate on public.listing_native_location_v1 from public, anon, authenticated;
revoke insert, update, delete, truncate on public.active_listing_ids_v2 from public, anon, authenticated;
revoke insert, update, delete, truncate on public.listing_location_index from public, anon, authenticated;
revoke insert, update, delete, truncate on public.listing_extra_attrs from public, anon, authenticated;

do $verify$
declare v text;
begin
  foreach v in array array['listing_native_location_v1','active_listing_ids_v2','listing_location_index','listing_extra_attrs','listing_rich_attrs'] loop
    if has_table_privilege('anon', 'public.' || v, 'INSERT') or has_table_privilege('authenticated', 'public.' || v, 'UPDATE')
       or has_table_privilege('anon', 'public.' || v, 'DELETE') or has_table_privilege('authenticated', 'public.' || v, 'TRUNCATE') then
      raise exception '% is still writable by the public key', v;
    end if;
  end loop;
  if not has_table_privilege('anon', 'public.listing_location_index', 'SELECT') then
    raise exception 'listing_location_index lost the SELECT the app reads it with';
  end if;
  raise notice 'launch views are read-only for anon/authenticated; listing_location_index still readable';
end $verify$;