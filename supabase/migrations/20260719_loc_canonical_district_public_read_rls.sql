-- FIX (applied live via MCP 2026-07-19 under the deploy lock; mirrored for git parity): loc_canonical_district
-- had RLS ENABLED but NO policy, so anon/authenticated SELECT returned 0 rows. district_options_ar is
-- SECURITY INVOKER (runs as the caller), so for real users the district autocomplete came back EMPTY —
-- even though privileged/MCP access saw all 5,782 rows (the classic RLS-vs-privileged divergence; caught by
-- verifying via the deployed anon key, not MCP). Adds a public read policy mirroring search_listings_ar's
-- slar_public_read. Public reference data (city_id + canonical district name), no PII.
CREATE POLICY lcd_public_read ON public.loc_canonical_district FOR SELECT TO public USING (true);
