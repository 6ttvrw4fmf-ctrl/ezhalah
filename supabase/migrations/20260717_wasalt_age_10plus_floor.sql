-- Retire the «10+ years» -> 12 fabrication in listing_extra_attrs (owner decision 2026-07-17).
-- Applied LIVE via Supabase MCP 2026-07-17 (version 20260717113xxx); this file mirrors it exactly.
--
-- Wasalt publishes an open-ended BUCKET, "10+ years". The view mapped it to the exact integer 12 — a
-- number the source never stated. Proof it is synthetic (live): 3,020 raw rows say '10+ years', 3,246
-- index rows sat at property_age=12, and rows at 11 or >=13 numbered EXACTLY 0. The standing
-- price-fidelity rule governs age identically, so the only number the source supports is the FLOOR: 10.
--
-- SURGICAL BY CONSTRUCTION: rewrites the view from its OWN live definition, replacing only the exact
-- token «WHEN '10+ years'::text THEN 12». listing_extra_attrs also produces 14 other attributes;
-- they are carried through byte-identical rather than retyped. Verified: the token occurs exactly 2x
-- and EVERY «THEN 12» in the view is one of those 2. Post-verified live: 16 columns intact.
DO $$
DECLARE old_def text; new_def text; n_before int;
BEGIN
  old_def := pg_get_viewdef('public.listing_extra_attrs'::regclass, true);
  n_before := (length(old_def) - length(replace(old_def, 'WHEN ''10+ years''::text THEN 12', '')))
              / length('WHEN ''10+ years''::text THEN 12');
  IF n_before = 0 THEN RAISE NOTICE 'already applied — nothing to do'; RETURN; END IF;
  IF n_before <> 2 THEN
    RAISE EXCEPTION 'REFUSING: expected exactly 2 occurrences of the 10+->12 mapping, found %.', n_before;
  END IF;
  IF ((length(old_def) - length(replace(old_def, 'THEN 12', ''))) / length('THEN 12')) <> 2 THEN
    RAISE EXCEPTION 'REFUSING: a THEN 12 exists outside the 10+ mapping; replacement is not safe.';
  END IF;
  new_def := replace(old_def, 'WHEN ''10+ years''::text THEN 12', 'WHEN ''10+ years''::text THEN 10');
  EXECUTE 'CREATE OR REPLACE VIEW public.listing_extra_attrs AS ' || new_def;
END $$;
