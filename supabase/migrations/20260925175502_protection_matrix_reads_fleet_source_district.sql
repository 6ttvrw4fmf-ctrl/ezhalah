-- ops_platform_protection_matrix(): district_source_check now reads listing_source_district_ar_fleet
-- (the input mon_detect_district_contradicts_source actually compares against since 20260925175435).
-- Anchor splice, raises if the anchor moved.
do $$
declare
  body text;
  anchor constant text := 'from public.listing_source_district_ar d join st using (source_table)';
begin
  select pg_get_functiondef('public.ops_platform_protection_matrix'::regproc) into body;
  if position(anchor in body) = 0 then
    raise exception 'anchor not found in ops_platform_protection_matrix()';
  end if;
  execute replace(body, anchor, 'from public.listing_source_district_ar_fleet d join st using (source_table)');
end $$;
