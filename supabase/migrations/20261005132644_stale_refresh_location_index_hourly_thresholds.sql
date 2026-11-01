-- The stale-refresh monitor follows the new hourly cadence of refresh-location-index (20261005132542).
-- Before: warn 30 h / crit 48 h, sized for the old daily job, so an hourly job that stopped would read as
-- healthy for 30 hours while every new phasea listing sat without a district. After: warn 3 h / crit 6 h,
-- the same thresholds listing_native_location_v1 (hourly, job :20) already uses. Tightens a guard only.
-- UNDO: set warn_after_minutes = 1800, crit_after_minutes = 2880 for both rows.
update public.mon_refresh_targets
   set warn_after_minutes = 180,
       crit_after_minutes = 360,
       notes = 'refreshed by refresh-location-index hourly at :15 (20261005132542, was daily); warn 3h / crit 6h like listing_native_location_v1',
       updated_at = now()
 where object_name in ('listing_location_canonical_mv', 'listing_location_index');
do $v$
begin
  if (select count(*) from public.mon_refresh_targets
       where object_name in ('listing_location_canonical_mv', 'listing_location_index')
         and warn_after_minutes = 180 and crit_after_minutes = 360 and active) <> 2 then
    raise exception 'stale-refresh thresholds not tightened';
  end if;
end
$v$;