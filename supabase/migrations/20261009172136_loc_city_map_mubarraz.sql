-- 🔧 QA 2026-10-09: abralosol now books an ad whose own text or evidenced district places it in
-- المبرز under the English city «Mubarraz» (scrapers/abralosol/run.py, MUBARRAZ_DISTRICTS). Give that
-- key its one catalog pin: المبرز, catalog city 2748, المنطقة الشرقية (region 5). Additive; no other
-- key changes.
insert into public.loc_city_map (city_key, city_ar, region_ar)
values ('mubarraz', 'المبرز', 'المنطقة الشرقية')
on conflict (city_key) do nothing;