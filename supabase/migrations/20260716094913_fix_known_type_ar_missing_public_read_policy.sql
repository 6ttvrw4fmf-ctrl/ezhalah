-- RECOVERED FROM PRODUCTION 2026-07-16: this migration was applied directly to prod (via
-- MCP/psql) without being committed — recovered verbatim from
-- supabase_migrations.schema_migrations so a clean clone reconstructs the real schema. Do not
-- edit. See the 2026-07-16 search outage (PGRST203 ambiguous overload) this drift caused.

-- CRITICAL production fix (2026-07-16, caught by live anon-key verification after deploy): every
-- other catalog table location_search_candidates_ar reads (city_name_bridge, district_name_bridge,
-- loc_catalog_city, loc_catalog_city_alias, search_listings_ar, type_label_ar) has a public SELECT
-- policy, but known_type_ar — added in this same day's category-purity fix — was missed. The RPC is
-- SECURITY INVOKER (runs as the calling role), so under the real anon key, RLS on known_type_ar with
-- NO policy silently hid every row from the EXISTS(...) check, making p_category match NOTHING for
-- real users — the exact opposite of "never regress search" while my own testing (via a privileged
-- DB connection that bypasses RLS) never caught it. Mirrors the existing pattern exactly.
CREATE POLICY knta_public_read ON public.known_type_ar FOR SELECT TO public USING (true);
