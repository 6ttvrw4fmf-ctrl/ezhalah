-- haraj: the plural «الاف» after a number already written in thousands («مساحه 5000 الاف متر») is 5,000 m², not 5,000,000.
-- scrapers/haraj/prose.py::area_of multiplied it (fixed in the same change). Repair the 3 measured rows to the seller's
-- own figure; guarded on the mis-scaled value. Watched by mon_detect_field_integrity (area > 1,000,000 m² on a non-land
-- type re-raises field_integrity_extreme_magnitude if the old parse ever returns).
update public.haraj_residential_listings set area_m2 = 5000 where id = 19008644 and area_m2 = 5000000;
update public.haraj_residential_listings set area_m2 = 8000 where id = 20813689 and area_m2 = 8000000;
update public.haraj_residential_listings set area_m2 = 3000 where id = 20837877 and area_m2 = 3000000;