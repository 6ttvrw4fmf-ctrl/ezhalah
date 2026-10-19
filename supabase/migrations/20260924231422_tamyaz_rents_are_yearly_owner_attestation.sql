-- tamyaz's UI stamps a universal «/ سنة» beside every rent row (no per-listing period field exists
-- on the API at all), which an earlier same-day review had rejected as too broad to trust for any
-- ONE listing. The owner then checked the live site directly and confirmed: "those are yearly,
-- you can tell from the price, they mention it" (2026-09-24). That is a platform-level statement —
-- the same class as azure's Paid-Annually-tab-only read and rightcompound's "not monthly"
-- disclaimer — so scrapers/tamyaz/run.py now falls back to rent_period='annual' when a listing's
-- own title+desc state nothing (a stated period, or a daily/weekly rate, still wins). This row
-- keeps mon_detect_manufactured_rent_period quiet once the table holds 20 rent rows, same as
-- wadod (20260924224146) and azure/rightcompound (20260924171605).
insert into public.ops_rent_period_single_value_ok (table_name, only_value, reason)
select 'tamyaz_residential_listings', 'annual',
       'owner attestation 2026-09-24 ("those are yearly, they mention it") after checking the live site: the UI stamps a universal «/ سنة» on every rent row; scrapers/tamyaz/run.py falls back to annual only when the listing itself states no period, and never for a daily/weekly rate.'
where not exists (select 1 from public.ops_rent_period_single_value_ok o where o.table_name = 'tamyaz_residential_listings');
