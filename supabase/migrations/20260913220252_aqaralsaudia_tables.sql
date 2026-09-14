-- New platform (owner-approved 2026-09-13): العروض العقارية (aqaralsaudia.com) — WordPress +
-- RealHomes theme, Riyadh-only office, 19 stated listings of which 3 are قيد الإنشاء (under
-- construction) and are excluded by the owner's standing rule: a COMPLETED property is a real
-- listing, a not-yet-built one is not.
--
-- Schema cloned from the established shared shape via LIKE ... INCLUDING ALL, same as every sibling
-- platform — nothing hand-typed, nothing to drift.
--
-- RLS IS CREATED HERE, IN THE SAME MIGRATION, ON PURPOSE. `LIKE ... INCLUDING ALL` copies columns,
-- defaults, constraints, indexes and storage but NEVER row-level-security policies, and this schema
-- enables RLS by default on new public tables — so a table created without an explicit policy ends
-- up RLS-enabled with ZERO policies, which default-denies every row to anon/authenticated no matter
-- what the GRANT says. That is exactly the "90 matching listings found, only 1 card ever rendered"
-- bug amlakalahsa hit on 2026-09-12 (see 20260912232625_amlakalahsa_public_read_policy.sql, which
-- had to be applied days later as a fix). Folding the policy in from the start so this platform
-- never has that window at all.
CREATE TABLE public.aqaralsaudia_residential_listings (LIKE public.amlakalahsa_residential_listings INCLUDING ALL);
CREATE TABLE public.aqaralsaudia_commercial_listings (LIKE public.amlakalahsa_commercial_listings INCLUDING ALL);

ALTER TABLE public.aqaralsaudia_residential_listings ALTER COLUMN source SET DEFAULT 'AqarAlSaudia';
ALTER TABLE public.aqaralsaudia_commercial_listings ALTER COLUMN source SET DEFAULT 'AqarAlSaudia';

GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
  ON public.aqaralsaudia_residential_listings, public.aqaralsaudia_commercial_listings
  TO anon, authenticated, postgres, service_role;

ALTER TABLE public.aqaralsaudia_residential_listings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.aqaralsaudia_commercial_listings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "public read" ON public.aqaralsaudia_residential_listings;
DROP POLICY IF EXISTS "public read" ON public.aqaralsaudia_commercial_listings;
CREATE POLICY "public read" ON public.aqaralsaudia_residential_listings FOR SELECT USING (true);
CREATE POLICY "public read" ON public.aqaralsaudia_commercial_listings FOR SELECT USING (true);

DO $check$
BEGIN
  IF (SELECT count(*) FROM information_schema.columns WHERE table_name='aqaralsaudia_residential_listings')
     <> (SELECT count(*) FROM information_schema.columns WHERE table_name='amlakalahsa_residential_listings') THEN
    RAISE EXCEPTION 'column count mismatch after LIKE INCLUDING ALL — refusing silently';
  END IF;
  -- the policy check the amlakalahsa outage taught us to make explicit
  IF (SELECT count(*) FROM pg_policies
       WHERE tablename IN ('aqaralsaudia_residential_listings','aqaralsaudia_commercial_listings')
         AND policyname = 'public read') <> 2 THEN
    RAISE EXCEPTION 'public read policy missing — anon would see zero rows (the 2026-09-12 amlakalahsa bug)';
  END IF;
END $check$;