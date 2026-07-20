-- Recovered verbatim from production on 2026-07-20 (drift reconciliation): applied directly to prod via MCP as supabase_migrations.schema_migrations version 20260717194534, name '20260717194500_aqarmonthly_rls_public_read'; this committed file is the source-of-truth record, NOT the apply path. Body is byte-for-byte the live statement (md5 03597cc37d3e6257b3e4a5877e184f76).
-- Wave 1 / P0: aqarmonthly_residential_listings had RLS enabled with ZERO policies.
-- Anon (real users) saw 0 of 1,450 active rows: the search RPC returned them as candidates
-- but card hydration (anon SELECT by id) returned [] -> phantom slots + inflated matchTotal.
-- Root cause: the table was created out-of-band without the anon-read policy every other
-- listing table has. Fix = add the SELECT policy, matching aqar_residential's (active=true)
-- pattern so only active rows are exposed (inactive stay hidden, consistent with search).
create policy "aqarmonthly_res_public_read"
  on public.aqarmonthly_residential_listings
  for select
  to public
  using (active = true);