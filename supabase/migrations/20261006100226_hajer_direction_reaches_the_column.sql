-- 🔬 AF engineer 2026-10-06: hajer's structured REM field «واجهة العقار» (114 of 120 live rows publish it) was
-- captured into source_capture.rem_fields but never into the direction column the Advanced Filter's direction
-- question reads. The scraper now writes the column; this copies the value the scraper already captured from the
-- page (verbatim, never inferred) into the column, only where the column is still NULL.
update public.hajer_residential_listings
   set direction = btrim(source_capture->'rem_fields'->>'واجهة العقار')
 where direction is null
   and nullif(btrim(source_capture->'rem_fields'->>'واجهة العقار'), '') is not null;
update public.hajer_commercial_listings
   set direction = btrim(source_capture->'rem_fields'->>'واجهة العقار')
 where direction is null
   and nullif(btrim(source_capture->'rem_fields'->>'واجهة العقار'), '') is not null;
