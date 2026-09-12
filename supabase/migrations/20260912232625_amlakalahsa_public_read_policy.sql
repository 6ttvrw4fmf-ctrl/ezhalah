-- ROOT CAUSE of "90 matching listings found, only 1 card ever rendered" (found live 2026-09-12,
-- user report): amlakalahsa_residential_listings/commercial_listings were created via
-- `LIKE abwbna_residential_listings INCLUDING ALL` (20260912184037_amlakalahsa_tables.sql).
-- `LIKE ... INCLUDING ALL` never copies row-level-security POLICIES (only structure: columns,
-- defaults, constraints, indexes, storage) — and this schema apparently enables RLS by default on
-- every new public table, so the two new tables ended up RLS-ENABLED with ZERO policies attached.
-- With RLS on and no policy, Postgres/PostgREST default-denies every row to every role, including
-- anon and authenticated — regardless of the GRANT statement in that same migration (a GRANT is
-- necessary but not sufficient; RLS gates rows on top of it).
--
-- Effect measured live: search_listings_ar (a separate denormalized index, its own working RLS
-- policy) correctly reported the true count (90) via location_search_candidates_ar, and the
-- district-suggestion dropdown read the correct count too — but the results screen hydrates each
-- CARD by a raw anon-key fetch straight from the listing table by id (fetchRawByIds() in
-- src/data/remote.ts), which silently returned zero rows for amlakalahsa. Only muktamel's one card
-- (a table with a correct policy) ever mounted, while the closing message truthfully quoted the RPC's
-- correct total_count of 90 — "found 90, showed 1" was two different, both-correct layers of the
-- same pipeline disagreeing, not a miscount anywhere.
--
-- Fix: add the exact "public read" policy every sibling listing table already carries.
ALTER TABLE public.amlakalahsa_residential_listings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.amlakalahsa_commercial_listings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "public read" ON public.amlakalahsa_residential_listings;
DROP POLICY IF EXISTS "public read" ON public.amlakalahsa_commercial_listings;
CREATE POLICY "public read" ON public.amlakalahsa_residential_listings FOR SELECT USING (true);
CREATE POLICY "public read" ON public.amlakalahsa_commercial_listings FOR SELECT USING (true);
