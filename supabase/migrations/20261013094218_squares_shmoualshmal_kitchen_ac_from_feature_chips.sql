-- squares and shmoualshmal: kitchen and AC from each ad's own STRUCTURED feature chips (🔬 AF engineer, 2026-10-13).
-- Both sites publish a feature list and both parsers already map named chips to columns, but squares' exact-word map
-- knew only «مطبخ», not the site's «مطبخ كامل», nor «مكيف إسبليت»; shmoualshmal's map did not name «مطبخ» at all.
-- So 6 of 6 active shmoualshmal ads and 3 of 14 active squares ads stated a kitchen or AC and stored NULL, and a
-- customer asking the Advanced Filter for one never found them (backlog 461). scrapers/squares/run.py and
-- scrapers/shmoualshmal/run.py now map those chips on every crawl. Values: each row's own captured chip list,
-- additional_info.features_ar, read 2026-10-13. Written only where the column is NULL; true only.
do $b$
declare n int; total int := 0;
begin
  update public.shmoualshmal_residential_listings set kitchen = true
   where kitchen is null and active and id = any(array[10561110,10561111,10561112,10561113,10561114,10561115]::bigint[])
     and additional_info->'features_ar' ? 'مطبخ';
  get diagnostics n = row_count; total := total + n;
  update public.squares_residential_listings set kitchen = true
   where kitchen is null and active and id = any(array[13602723,13602728]::bigint[])
     and additional_info->'features_ar' ? 'مطبخ كامل';
  get diagnostics n = row_count; total := total + n;
  update public.squares_residential_listings set air_conditioner = true
   where air_conditioner is null and active and id = any(array[13602723,13602726]::bigint[])
     and additional_info->'features_ar' ? 'مكيف إسبليت';
  get diagnostics n = row_count; total := total + n;
  raise notice 'feature chip answers: % values written', total;
  if total = 0 or total > 10 then raise exception 'backfill out of range: % of 10', total; end if;
end $b$;
