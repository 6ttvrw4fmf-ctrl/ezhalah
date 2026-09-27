-- listing_extra_attrs_mv is readable with the publishable key, for the live coverage check (2026-09-27, owner-approved).
--
-- scripts/verify-all-platforms-have-extra-attrs-branch-live.ts (loader-active-platforms-check.yml)
-- counted rows per source_table in the LIVE view listing_extra_attrs, once for each of ~260 tables.
-- Every count made PostgREST plan the view's ~260-arm UNION (~22 MB), and the workflow's scheduled
-- runs lined up with four production restarts (09-26 11:38 and 21:23; 09-27 05:35 and 12:18). The
-- owner disabled the workflow on 2026-09-27.
--
-- The check now counts the saved copy that listing_native_location_v2 joins (20260927051226). It
-- holds the same rows, is unique on (source_table, listing_id), and a filtered count on it is an
-- index lookup. That migration kept the copy private. Granting SELECT exposes nothing new: the live
-- view it copies is already anon-selectable. Writes stay closed.

grant select on public.listing_extra_attrs_mv to anon, authenticated;

comment on materialized view public.listing_extra_attrs_mv is
  'Saved copy of listing_extra_attrs that listing_native_location_v2 joins (planning v2 over the live view cost ~292 MB). Refreshed by jobid 17 hourly. Anon-readable for the live coverage check, which must never count the live view per table.';

do $mig$
begin
  if not has_table_privilege('anon', 'public.listing_extra_attrs_mv', 'select') then
    raise exception 'anon still cannot read listing_extra_attrs_mv';
  end if;
  if has_table_privilege('anon', 'public.listing_extra_attrs_mv', 'insert, update, delete, truncate')
     or has_table_privilege('authenticated', 'public.listing_extra_attrs_mv', 'insert, update, delete, truncate') then
    raise exception 'listing_extra_attrs_mv must not be writable through the public API';
  end if;
  if not has_table_privilege('anon', 'public.listing_extra_attrs', 'select') then
    raise exception 'the live view is not anon-readable, so granting the copy WOULD expose new data; stop';
  end if;
end $mig$;
