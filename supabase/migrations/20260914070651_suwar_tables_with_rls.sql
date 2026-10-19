-- New platform (owner-approved 2026-09-14): سوار العقارية (suwar.sa) — a Makkah freehold developer,
-- 167 published listings, 150 ingestible. Schema cloned from the established shared shape via
-- LIKE ... INCLUDING ALL so it inherits the same columns/defaults/indexes/storage as every sibling.
--
-- RLS IS CREATED IN THIS SAME MIGRATION, DELIBERATELY. `LIKE ... INCLUDING ALL` copies structure —
-- columns, defaults, constraints, indexes, storage — and NEVER copies row-level-security policies,
-- while this schema enables RLS by default on every new public table. amlakalahsa was created
-- without them on 2026-09-12 and spent a day as the "90 matching listings found, only 1 card ever
-- rendered" bug: the search index counted correctly while the card hydration path (a raw anon-key
-- read straight from the listing table) was default-denied every row. Splitting the policy into a
-- later migration is what allowed that gap to exist, so it does not get split here.
CREATE TABLE public.suwar_residential_listings (LIKE public.abwbna_residential_listings INCLUDING ALL);
CREATE TABLE public.suwar_commercial_listings (LIKE public.abwbna_commercial_listings INCLUDING ALL);

ALTER TABLE public.suwar_residential_listings ALTER COLUMN source SET DEFAULT 'Suwar';
ALTER TABLE public.suwar_commercial_listings ALTER COLUMN source SET DEFAULT 'Suwar';

GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
  ON public.suwar_residential_listings, public.suwar_commercial_listings
  TO anon, authenticated, postgres, service_role;

ALTER TABLE public.suwar_residential_listings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.suwar_commercial_listings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "public read" ON public.suwar_residential_listings;
DROP POLICY IF EXISTS "public read" ON public.suwar_commercial_listings;
CREATE POLICY "public read" ON public.suwar_residential_listings FOR SELECT USING (true);
CREATE POLICY "public read" ON public.suwar_commercial_listings FOR SELECT USING (true);

DO $check$
DECLARE n_res int; n_com int;
BEGIN
  IF (SELECT count(*) FROM information_schema.columns WHERE table_name='suwar_residential_listings')
     <> (SELECT count(*) FROM information_schema.columns WHERE table_name='abwbna_residential_listings') THEN
    RAISE EXCEPTION 'column count mismatch after LIKE INCLUDING ALL — refusing silently';
  END IF;
  -- the whole point of this migration: prove the policy EXISTS, on both tables, right now.
  SELECT count(*) INTO n_res FROM pg_policies
   WHERE schemaname='public' AND tablename='suwar_residential_listings' AND policyname='public read';
  SELECT count(*) INTO n_com FROM pg_policies
   WHERE schemaname='public' AND tablename='suwar_commercial_listings' AND policyname='public read';
  IF n_res <> 1 OR n_com <> 1 THEN
    RAISE EXCEPTION 'public read policy missing (res=%, com=%) — this is the amlakalahsa 90-found-1-shown bug', n_res, n_com;
  END IF;
END $check$;