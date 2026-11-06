-- 🆕 New Listings Engineer 2026-11-05, contract G (unknown_named_districts(3)): Property Finder (live 11-04) names
-- «درة العروس» on 6 جدة ads (pins 21.940N 38.957E; title «شقة للإيجار في حي درة العروس, مدينة جدة»), and the index
-- already serves «درة العروس» on 148 active جدة ads from other sites (pins 21.943N 38.956E) — a real place with no
-- districts of its own, so a DISTRICT of جدة (rulebook rule 10). Admission rule (20261011133138 / 20261018035154):
-- ≥ 3 distinct active ads, not a city in loc_catalog_city, not a plan / direction / number, verdict «new» from
-- unknown_named_districts_checked(3) (no twin). Spelling = the majority served form.
-- The other three PF names are SPELLINGS of catalogued districts (by pin), mapped in scrapers/propertyfinder/run.py
-- (PR #10651), recorded here as 'variant' so the alarm reads them as decided.
insert into public.loc_catalog_district (city_id, district_ar, district_norm)
values (18, 'درة العروس', public.norm_district_tok('درة العروس'))
on conflict (city_id, district_norm) do nothing;

insert into public.ops_district_name_decision (city_id, name_norm, decision, why) values
  (3, public.norm_district_tok('مطار الملك خالد الدولي'), 'variant',
   'propertyfinder spelling of «مطار الملك خالد» (pins 24.952N 46.632E vs served 24.937N 46.640E); mapped in scrapers/propertyfinder/run.py, 🆕 2026-11-05'),
  (6, public.norm_district_tok('ريع اذاخر'), 'variant',
   'propertyfinder spelling of «حي ريع زاخر» (pins 21.444N 39.834E vs served 21.455N 39.837E); mapped in scrapers/propertyfinder/run.py, 🆕 2026-11-05'),
  (6, public.norm_district_tok('الهجلة الجديد'), 'variant',
   'propertyfinder spelling of «حي الهجلة» (pins 21.287N 39.827E vs served 21.294N 39.840E); mapped in scrapers/propertyfinder/run.py, 🆕 2026-11-05')
on conflict do nothing;

do $$
begin
  if not exists (select 1 from public.loc_catalog_district
                  where city_id = 18 and district_norm = public.norm_district_tok('درة العروس') and retired_at is null) then
    raise exception 'درة العروس did not land on جدة''s list';
  end if;
  if (select count(*) from public.unknown_named_districts(3) u where u.platform = 'propertyfinder') <> 0 then
    raise exception 'propertyfinder still has unknown named districts';
  end if;
end $$;
