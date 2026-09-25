-- wadod publishes 7 Riyadh rentals whose pages state only the payment split («دفعة واحدة» /
-- «دفعتين»), never a period, so the scraper left rent_period NULL and the rows stayed out of every
-- rent search (owner rule 2026-09-21: yearly only when the source says so). On 2026-09-24 the owner
-- looked at the seven pages and attested «those are yearly». That is a platform-level statement,
-- not a parser default: scrapers/wadod/run.py now writes rent_period='annual' for a silent page
-- (a page that names سنوي/شهري/يومي still wins), and this row keeps
-- mon_detect_manufactured_rent_period from raising once the table holds 20 rent rows — the same
-- registration rightcompound and azure carry (20260924171605).
insert into public.ops_rent_period_single_value_ok (table_name, only_value, reason)
select 'wadod_residential_listings', 'annual',
       'owner attestation 2026-09-24 («those are yearly») after reading the 7 pages: the site states only the payment split «دفعة واحدة»/«دفعتين»; scrapers/wadod/run.py writes annual for a silent page, a named period still wins.'
where not exists (select 1 from public.ops_rent_period_single_value_ok o where o.table_name = 'wadod_residential_listings');
