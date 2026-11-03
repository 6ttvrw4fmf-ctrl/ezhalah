-- 🆕 New Listings Engineer 2026-11-03: alert district_copies_unlisted (11383) — «حي عبدالله فؤاد» (الدمام, city 13)
-- is served on 84 active ads from 7 sites (aqar 50, dealapp 17, wasalt 12, sakan 2, sakani 1, muktamel 1,
-- muhaysini 1) and is NOT on الدمام's list, so its copy «عبد الله فؤاد» (1 ad) shows as a second district.
-- Rulebook §«How to match districts» rule 9: add the real district name, ONE spelling, through the guards;
-- loc_display_district_ar() folds the copy at the next sync. Admission rule (20261011133138 / 20261018035154):
-- ≥ 3 distinct active ads, not a city in loc_catalog_city, not a plan / direction / number, no catalogued or
-- retired twin, no ops_district_name_decision row. Spelling = the majority source form.
insert into public.loc_catalog_district (city_id, district_ar, district_norm)
values (13, 'حي عبدالله فؤاد', public.norm_district_tok('حي عبدالله فؤاد'))
on conflict (city_id, district_norm) do nothing;

do $$
begin
  if not exists (select 1 from public.loc_catalog_district
                  where city_id = 13 and district_norm = public.norm_district_tok('حي عبدالله فؤاد')
                    and retired_at is null) then
    raise exception 'حي عبدالله فؤاد did not land on الدمام''s list';
  end if;
end $$;