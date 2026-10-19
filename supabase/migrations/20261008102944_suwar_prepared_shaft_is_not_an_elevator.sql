-- 🔬 AF engineer 2026-10-08: suwar «مؤسس مصعد» is a prepared lift SHAFT, not a lift; «مصعدين» is two lifts.
--
-- suwar's own feature taxonomy (property_feature, stored verbatim in additional_info.features_ar) names
-- «مؤسس مصعد» on 22 live listings with no real lift term, and the parser mapped it to elevator = true, so
-- the Advanced Filter «مصعد» showed buildings with no lift. «مصعدين» was not mapped at all (3 listings
-- stayed NULL). Same class as the 2026-10-07 sakan prepared-elevator repair; the parser half ships in
-- PR #6434 (suwar _FEATURE_COLUMNS + AUTHORITATIVE_NULL for a shaft-only list). Rows are repaired from
-- the source's own stored terms only, and the served index is re-derived as the sync maps elevator
-- (a pass-through). Rolled-back dry run: 36 shaft-only rows -> NULL, 3 -> true, 25 served rows,
-- suwar served elevator = yes 31 -> 12.
do $$
declare n_shaft int; n_two int; n_srv int;
begin
  update public.suwar_residential_listings x set elevator = null
   where x.elevator is true
     and coalesce((x.additional_info->'features_ar') ? 'مؤسس مصعد', false)
     and not coalesce((x.additional_info->'features_ar') ?| array['مصعد','مصعدين'], false);
  get diagnostics n_shaft = row_count;
  update public.suwar_residential_listings x set elevator = true
   where x.elevator is null and coalesce((x.additional_info->'features_ar') ? 'مصعدين', false);
  get diagnostics n_two = row_count;
  update public.search_listings_ar s set elevator = x.elevator from public.suwar_residential_listings x
   where s.source_table = 'suwar_residential_listings' and s.listing_id = x.id and s.elevator is distinct from x.elevator;
  get diagnostics n_srv = row_count;
  raise notice 'suwar shaft repair: % -> NULL, % -> true, % served', n_shaft, n_two, n_srv;
end $$;
