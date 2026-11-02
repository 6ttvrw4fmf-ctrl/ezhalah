-- 🆕 New Listings 2026-10-26 (backlog #657): snam publishes the English neighbourhood «Ad Dirah» for 14 Riyadh ads.
-- It is الرياض's catalogue district «الديرة»: the snam scraper maps it (PR #7847) and all 14 are served as
-- «حي الديرة» today; only the raw rows (snam dormant since 10-18) still hold NULL, so the alarm kept counting them.
-- An English name is a spelling, never a new catalogue row: recorded as a variant.
insert into public.ops_district_name_decision (city_id, name_norm, decision, why)
values (3, public.norm_district_tok('Ad Dirah'), 'variant',
        'snam English «Ad Dirah» = الرياض catalogue «الديرة»; mapped in scrapers/snam/run.py (PR #7847); 14 ads served as «حي الديرة» (New Listings 2026-10-26)')
on conflict (city_id, name_norm) do nothing;

do $$ begin
  if exists (select 1 from public.unknown_named_districts(3) u where u.city_id = 3 and u.name = 'Ad Dirah') then
    raise exception 'Ad Dirah still listed as unknown';
  end if;
end $$;
