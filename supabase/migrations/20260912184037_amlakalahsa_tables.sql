-- New platform (owner-approved 2026-09-12): أملاك الأحساء (amlakalahsa.com) — WordPress + ACF,
-- Al-Ahsa-only real-estate office, ~262 stated active listings. Schema cloned from the established
-- shared shape (same pattern every sibling platform uses) via LIKE ... INCLUDING ALL, so it inherits
-- the same columns/defaults/indexes/storage as every other listing table — nothing hand-typed,
-- nothing to drift. Scraper + tests land separately; this migration only creates the tables so the
-- scraper's dry run has somewhere real to write once approved.
CREATE TABLE public.amlakalahsa_residential_listings (LIKE public.abwbna_residential_listings INCLUDING ALL);
CREATE TABLE public.amlakalahsa_commercial_listings (LIKE public.abwbna_commercial_listings INCLUDING ALL);

ALTER TABLE public.amlakalahsa_residential_listings ALTER COLUMN source SET DEFAULT 'AmlakAlAhsa';
ALTER TABLE public.amlakalahsa_commercial_listings ALTER COLUMN source SET DEFAULT 'AmlakAlAhsa';

GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
  ON public.amlakalahsa_residential_listings, public.amlakalahsa_commercial_listings
  TO anon, authenticated, postgres, service_role;

DO $check$
BEGIN
  IF (SELECT count(*) FROM information_schema.columns WHERE table_name='amlakalahsa_residential_listings')
     <> (SELECT count(*) FROM information_schema.columns WHERE table_name='abwbna_residential_listings') THEN
    RAISE EXCEPTION 'column count mismatch after LIKE INCLUDING ALL — refusing silently';
  END IF;
END $check$;
