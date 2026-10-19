-- 🔬 AF engineer 2026-10-05: ksaaqar's own structured «التكييف : نعم / لا يوجد» field was parsed but filed only in
-- additional_info.air_conditioning, never in air_conditioner — the column the Advanced Filter AC chip reads.
-- 437 published «yes» and 94 published «no» were invisible. The scraper now writes the column; this copies the
-- value the scraper already captured from the page (a JSON boolean, never inferred) into the column, only where
-- the column is still NULL.
update public.ksaaqar_residential_listings
   set air_conditioner = (additional_info->>'air_conditioning')::boolean
 where air_conditioner is null
   and jsonb_typeof(additional_info->'air_conditioning') = 'boolean';
update public.ksaaqar_commercial_listings
   set air_conditioner = (additional_info->>'air_conditioning')::boolean
 where air_conditioner is null
   and jsonb_typeof(additional_info->'air_conditioning') = 'boolean';
