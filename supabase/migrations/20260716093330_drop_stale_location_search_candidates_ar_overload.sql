-- RECOVERED FROM PRODUCTION 2026-07-16: this migration was applied directly to prod (via
-- MCP/psql) without being committed — recovered verbatim from
-- supabase_migrations.schema_migrations so a clean clone reconstructs the real schema. Do not
-- edit. See the 2026-07-16 search outage (PGRST203 ambiguous overload) this drift caused.

-- CRITICAL fix (owner 2026-07-16, adversarial review): adding p_category via CREATE OR REPLACE FUNCTION
-- changed the signature, so Postgres created a NEW overload (oid 1781729, 34 args) instead of replacing
-- the old one (oid 1649738, 33 args, no p_category). Any caller posting to this RPC without p_category
-- in the body would resolve to the OLD, category-impure overload via PostgREST's overload matching,
-- silently reopening the exact bug just fixed. Drop the stale overload so only the p_category-aware
-- version can ever be called.
DROP FUNCTION public.location_search_candidates_ar(
  text, text[], text[], text[], text[], integer, integer, integer[], text[], numeric, numeric, text,
  integer, integer, integer[], integer, integer, boolean, integer, text, text[], boolean, text[],
  integer, text[], text[], integer, integer[], smallint, smallint, integer, integer, boolean
);
