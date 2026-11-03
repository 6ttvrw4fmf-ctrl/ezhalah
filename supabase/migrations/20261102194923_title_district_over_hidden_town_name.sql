-- A TITLE DISTRICT REPLACES ONLY A SOURCE DISTRICT THAT SHOWS AS NOTHING (backlog 1165). Measured after the first
-- pass: 48 of 111 title districts were not served, because aqar's own «district» field holds the TOWN's name
-- («حي الشماسية» in الشماسية, «حي صامطة» in صامطة) — loc_display_district_ar() hides it (a town is not a district), so
-- the ad shows NO district, yet the title arm stepped aside because the field was not empty. Now:
--   * the title arm also fills an ad whose source district DISPLAYS as nothing, and may replace a recovered value
--     that displays as nothing — never a district that shows;
--   * listing_native_location_v2 serves a 'title' recovery ahead of such a hidden source value.
-- Both patched on the live bodies; each fails closed if its anchor is not found exactly once.
set local lock_timeout = '15s';
do $mig$
declare
  d text := pg_get_functiondef('public.refresh_district_recovery_table(text)'::regprocedure);
  old_txt constant text := $o$     and (v1.district_ar is null or btrim(v1.district_ar) = '')
  on conflict (source_table, listing_id) do nothing;

  -- LOSS GUARD$o$;
  new_txt constant text := $n$     and public.loc_display_district_ar(coalesce(s.city_id, v1.city_id), v1.district_ar) is null
  on conflict (source_table, listing_id) do update
    set district_ar = excluded.district_ar, basis = 'title', verbatim = false, resolved_at = excluded.resolved_at
    where public.loc_display_district_ar(
            (select lt.city_id from public.listing_title_district lt
              where lt.source_table = excluded.source_table and lt.listing_id = excluded.listing_id),
            _drt.district_ar) is null;

  -- LOSS GUARD$n$;
begin
  if (length(d) - length(replace(d, old_txt, ''))) / length(old_txt) <> 1 then
    raise exception 'refresh_district_recovery_table: title arm tail not found exactly once';
  end if;
  execute replace(d, old_txt, new_txt);
  if position('basis = ''title'', verbatim = false' in pg_get_functiondef('public.refresh_district_recovery_table(text)'::regprocedure)) = 0 then
    raise exception 'refresh_district_recovery_table: title arm patch did not land';
  end if;
end
$mig$;

do $mig$
declare
  d text := pg_get_viewdef('public.listing_native_location_v2'::regclass);
  old_txt constant text := 'ELSE COALESCE(v1.district_ar, dr.district_ar)';
  new_txt constant text := 'ELSE CASE WHEN (dr.basis = ''title''::text) THEN dr.district_ar ELSE COALESCE(v1.district_ar, dr.district_ar) END';
begin
  if (length(d) - length(replace(d, old_txt, ''))) / length(old_txt) <> 1 then
    raise exception 'listing_native_location_v2: district else-branch not found exactly once';
  end if;
  execute 'create or replace view public.listing_native_location_v2 as ' || replace(d, old_txt, new_txt);
  if position('dr.basis = ''title''::text' in pg_get_viewdef('public.listing_native_location_v2'::regclass)) = 0 then
    raise exception 'listing_native_location_v2: title-over-hidden patch did not land';
  end if;
end
$mig$;
