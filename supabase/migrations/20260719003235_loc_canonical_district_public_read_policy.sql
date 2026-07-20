-- Recovered verbatim from production on 2026-07-20 (drift reconciliation): applied directly to prod via MCP as supabase_migrations.schema_migrations version 20260719003235, name 'loc_canonical_district_public_read_policy'; this committed file is the source-of-truth record, NOT the apply path. Body is byte-for-byte the live statement (md5 37736aefc03268f6d486425a4bcde77a).
-- loc_canonical_district had RLS ENABLED but NO policy → anon/authenticated SELECT returned 0 rows,
-- so district_options_ar (SECURITY INVOKER, runs as the caller) produced an EMPTY district list for real
-- users, even though privileged/MCP access saw all 5,782 rows. This is the classic RLS-vs-privileged
-- divergence: verify via the anon key, not MCP. Add a public read policy mirroring search_listings_ar's
-- slar_public_read. This is public reference data (city_id + canonical district name), no PII.
CREATE POLICY lcd_public_read ON public.loc_canonical_district FOR SELECT TO public USING (true);