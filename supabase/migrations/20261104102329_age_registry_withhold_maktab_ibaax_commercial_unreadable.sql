-- age_resolver_platform_gap (🔬 2026-11-04, alert 1232): two of the ten unregistered tables adjudicated against their
-- live pages, the ibaax_residential precedent (REFUSED 2026-10-12). Re-read from Supabase (net.http_get, HTTP 200):
-- maktab.sa/details/111 and /104 are a 3,093-byte client-side shell with no «عمر» anywhere; ibaax commercial
-- 14400017 / 13569261 a 1,922-byte shell, and 10 of its 15 aged rows store 0. The age cannot be proven equal to what the
-- advertiser stated, so it is WITHHELD by decision (trusted = false), not by silence. Re-admit when a re-read shows it.
insert into public.age_source_registry (source_table, strategy, trusted, note, updated_at) values
  ('maktab_commercial_listings', 'canonical_column', false,
   'WITHHELD 2026-11-04: pages are a client-side shell to the re-reader (maktab.sa/details/111, /104: 3,093 bytes, no «عمر»); 19 aged rows unverifiable. Re-admit only when a re-read shows the age.', now()),
  ('ibaax_commercial_listings', 'canonical_column', false,
   'WITHHELD 2026-11-04 (as ibaax_residential 2026-10-12): pages are a client-side shell (14400017 / 13569261: 1,922 bytes) and 10 of the 15 aged rows store 0; unverifiable.', now())
on conflict (source_table) do nothing;