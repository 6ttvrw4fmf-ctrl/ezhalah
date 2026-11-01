-- 🔬 AF engineer 2026-10-05: an UNTOUCHED room block on the aldarim SaaS (aldarim / abwbna / alobid /
-- bahadhabab) is silence, not «no». The block (bedrooms, bathrooms, living_rooms, kitchens, …) defaults
-- to 0 when the advertiser never fills it; aldarim 53104 is a six-bedroom villa whose block reads all 0
-- while its own description lists «2 غرفة خادمة», «2غرفة سائق», «مطبخ». We stored kitchen / maid_room /
-- driver_room / balcony_terrace = false on 446 such rows (0 of them true). The scrapers now emit NULL
-- (normalize.silence_unfilled_room_block); the upsert drops None, so the stored «no» is reverted here.
-- Only rows whose block is entirely 0/absent are touched; a filled block keeps its real zeros.
do $$
declare t text;
begin
  foreach t in array array['aldarim_residential','aldarim_commercial','abwbna_residential','abwbna_commercial',
                           'alobid_residential','alobid_commercial','bahadhabab_residential','bahadhabab_commercial'] loop
    execute format($q$
      update public.%I_listings x
         set kitchen = null, maid_room = null, driver_room = null, balcony_terrace = null
       where x.source_capture is not null
         and (x.kitchen is false or x.maid_room is false or x.driver_room is false or x.balcony_terrace is false)
         and not coalesce(x.kitchen or x.maid_room or x.driver_room or x.balcony_terrace, false)
         and coalesce(nullif(x.source_capture->>'bedrooms','')::numeric, 0) = 0
         and coalesce(nullif(x.source_capture->>'bathrooms','')::numeric, 0) = 0
         and coalesce(nullif(x.source_capture->>'living_rooms','')::numeric, 0) = 0
         and coalesce(nullif(x.source_capture->>'kitchens','')::numeric, 0) = 0
    $q$, t);
  end loop;
end $$;
