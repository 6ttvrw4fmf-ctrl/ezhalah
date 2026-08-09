-- souq24 wrote the source's MONTHLY figure straight into price_annual. Because the app divides
-- price_annual by 12 to render the per-month price, the card showed one TWELFTH of what souq24
-- published. Root cause fixed in scrapers/souq24/run.py (same ×12 storage convention gathern /
-- aqarmonthly / wasalt already use); these are the 3 live rows it already produced.
--
-- Every value below was READ OFF THE LIVE SOURCE PAGE on 2026-08-09 — no estimation, no inference:
--   ad 1106 (row 648154): «5,000 شهري»  → 5000×12 = 60000   (displayed 417/mo → 5,000/mo)
--   ad 1117 (row 648153): «5,000 شهري»  → 5000×12 = 60000   (displayed 417/mo → 5,000/mo)
--   ad 1208 (row 648134): «1,500 شهري»  → 1500×12 = 18000   (displayed 125/mo → 1,500/mo)
-- The DISPLAYED number now equals the source's number exactly. rent_period was already correct
-- ('monthly'); only the storage container was wrong. Repairing RAW so the hourly matview + sync
-- carry it through and the next scrape does not undo it.
update public.souq24_residential_listings set price_annual = 60000 where id = 648154 and price_annual = 5000;
update public.souq24_residential_listings set price_annual = 60000 where id = 648153 and price_annual = 5000;
update public.souq24_residential_listings set price_annual = 18000 where id = 648134 and price_annual = 1500;
