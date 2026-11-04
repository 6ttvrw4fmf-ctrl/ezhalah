-- age_resolver_platform_gap (🔬 2026-11-04, alert 1232), batch 2: six more of the unregistered tables judged against a
-- live page each (Supabase net.http_get, HTTP 200, 2026-11-04 ~10:25 UTC), stored value vs the ad's own words:
--   sqcc_residential 13707581 stored 19 — page «العمر : 19 سنة»;   sqcc_commercial 13707675 stored 13 — «العمر : 13 سنة»
--   safera_residential 12390412 stored 16 — «العمر : 16 سنه»;      sadiqeltajer_commercial 12219375 stored 0 — «العمر : جديده»
--   eastabha_residential 595318 stored 9 — «العماره عمرها ٩ سنوات»
--   gudai_residential 12390330 stored 7 — the page prints no age at all → WITHHELD (unverifiable)
-- abwbna (residential + commercial) stay open: the page carries a «عمر العقار (سنة البناء)» label whose value was not
-- readable from the re-read; not registered until it is.
insert into public.age_source_registry (source_table, strategy, trusted, note, updated_at) values
  ('sqcc_residential_listings', 'canonical_column', true, 'TRUSTED 2026-11-04: 13707581 stored 19 = page «العمر : 19 سنة» (re-read HTTP 200).', now()),
  ('sqcc_commercial_listings', 'canonical_column', true, 'TRUSTED 2026-11-04: 13707675 stored 13 = page «العمر : 13 سنة» (re-read HTTP 200).', now()),
  ('safera_residential_listings', 'canonical_column', true, 'TRUSTED 2026-11-04: 12390412 stored 16 = page «العمر : 16 سنه» (re-read HTTP 200).', now()),
  ('sadiqeltajer_commercial_listings', 'canonical_column', true, 'TRUSTED 2026-11-04: 12219375 stored 0 = page «العمر : جديده» (re-read HTTP 200).', now()),
  ('eastabha_residential_listings', 'canonical_column', true, 'TRUSTED 2026-11-04: 595318 stored 9 = page «العماره عمرها ٩ سنوات» (re-read HTTP 200).', now()),
  ('gudai_residential_listings', 'canonical_column', false, 'WITHHELD 2026-11-04: 12390330 stored 7, the page prints no age at all (re-read HTTP 200); unverifiable.', now())
on conflict (source_table) do nothing;