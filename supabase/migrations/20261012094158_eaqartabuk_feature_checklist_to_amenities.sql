-- eaqartabuk: its STRUCTURED feature checklist reaches the Advanced Filter (🔬 AF engineer, 2026-10-12, backlog 461).
-- The candles-map «features» list («مصعد», «مطبخ», «مداخل خاصة», «مدخل خاص», «كراج», «غرفة غسيل») was kept in
-- additional_info.features only, so on active ads 90 lifts, 36 kitchens, 176 private entrances, 12 garages and
-- 154 laundry rooms were NULL to every amenity question. A LISTED feature is a yes; an unlisted one stays
-- unknown (an unticked box is not a stated «no»). scrapers/eaqartabuk/run.py feature_answers() writes the same on
-- every crawl from this change on. Values come from each row's own stored list; written only where NULL.
do $b$
declare r record; n int; total int := 0;
begin
  for r in select * from (values
    ('مصعد', 'elevator'), ('مطبخ', 'kitchen'), ('مداخل خاصة', 'private_entrance'),
    ('مدخل خاص', 'private_entrance'), ('كراج', 'parking'), ('غرفة غسيل', 'laundry_room')
  ) v(label, col) loop
    execute format(
      'update public.eaqartabuk_residential_listings set %I = true
        where active and %I is null and jsonb_typeof(additional_info->''features'') = ''array''
          and additional_info->''features'' ? $1', r.col, r.col) using r.label;
    get diagnostics n = row_count; total := total + n;
    execute format(
      'update public.eaqartabuk_commercial_listings set %I = true
        where active and %I is null and jsonb_typeof(additional_info->''features'') = ''array''
          and additional_info->''features'' ? $1', r.col, r.col) using r.label;
    get diagnostics n = row_count; total := total + n;
  end loop;
  raise notice 'eaqartabuk feature checklist: % values written', total;
  if total = 0 or total > 600 then raise exception 'backfill out of range: %', total; end if;
end $b$;