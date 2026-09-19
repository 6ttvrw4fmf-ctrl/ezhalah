-- KSA Aqar stores the city and district the source itself printed, alongside the canonical
-- English `city`. Same two shadow columns every recent platform carries (akariyoun 20260918234013,
-- suwar, rakez): `city_ar` / `district_ar` are the ARABIC-CANONICAL location the card displays and
-- the location index matches on, while `city` stays the English canonical for legacy consumers.
--
-- Without these, the upsert sends keys the table does not have and PostgREST rejects the WHOLE
-- batch with PGRST204 — every row lost, not just the unknown field (the living_rooms/majlis_rooms
-- incident). Applied BEFORE the first sweep writes, deliberately.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['ksaaqar_residential_listings','ksaaqar_commercial_listings'] LOOP
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS city_ar text', t);
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS district_ar text', t);
  END LOOP;
END $$;