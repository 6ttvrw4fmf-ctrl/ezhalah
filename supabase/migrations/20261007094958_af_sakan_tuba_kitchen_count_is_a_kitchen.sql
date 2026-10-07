-- 🔬 AF engineer 2026-10-07: sakan + tuba ads print a labelled kitchen COUNT in their floor-details
-- block («… الصالات: 1 ، المطابخ: 1 …»). The shared prose reader knows «مطبخ», not the plural, so 2,619
-- sakan and 280 tuba ads stated a kitchen while storing NULL. Both parsers now read the count
-- (normalize.kitchen_from_count). NULL-only fill from the ad's own stored text; an ad whose prose also
-- negates a kitchen is left alone (a contradiction is not a statement). Dry run: 2,899 NULL→true,
-- 0 NULL→false, 0 rewrites.
update public.sakan_residential_listings
   set kitchen = (description ~ 'المطابخ\s*:\s*0*[1-9]')
 where kitchen is null
   and description ~ 'المطابخ\s*:\s*\d'
   and description !~ '(بدون|لا يوجد|لايوجد|غير)\s*مطبخ';

update public.tuba_residential_listings
   set kitchen = (description ~ 'المطابخ\s*:\s*0*[1-9]')
 where kitchen is null
   and description ~ 'المطابخ\s*:\s*\d'
   and description !~ '(بدون|لا يوجد|لايوجد|غير)\s*مطبخ';
