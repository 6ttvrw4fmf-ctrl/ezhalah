-- Recovered verbatim from production on 2026-07-20 (drift reconciliation): applied directly to prod via MCP as supabase_migrations.schema_migrations version 20260717113036, name 'wasalt_age_10plus_floor_not_fabricated_12'; this committed file is the source-of-truth record, NOT the apply path. Body is byte-for-byte the live statement (md5 efbd7cfd20c777fb5cf8ec45339683bc).
-- Retire the «10+ years» -> 12 fabrication in listing_extra_attrs (owner decision 2026-07-17).
--
-- Wasalt publishes an open-ended BUCKET, "10+ years". The view mapped it to the exact integer 12 — a
-- number the source never stated. Proof it is synthetic (live): 3,020 raw rows say '10+ years', 3,246
-- index rows sit at property_age=12, and rows at 11 or >=13 number EXACTLY 0. The standing
-- price-fidelity rule (a value must equal the source exactly, never estimated) governs age identically,
-- so the only number the source actually supports is the bucket FLOOR: 10.
--
-- Harmless for the 5 buckets either way (12 and 10 both land in «10+»), but it stops the DB asserting a
-- precise age nobody published, makes wasalt consistent with the aqar «أكثر من 10 سنوات» -> 10 mapping
-- landed in the same PR, and prevents a range query like p_age_max=12 returning possibly-decades-old
-- properties as if they were 12.
--
-- SURGICAL BY CONSTRUCTION: this rewrites the view from its OWN live definition, replacing only the
-- exact token «WHEN '10+ years'::text THEN 12». listing_extra_attrs also produces 14 other attributes
-- (furnished, direction, street_width_m, floor_number, tenant_category, license_number, elevator,
-- parking, kitchen, air_conditioner, maid_room, driver_room, private_entrance) — breaking those to fix
-- age would be a catastrophic own-goal, so they are carried through byte-identical rather than retyped.
-- Verified before running: the token occurs exactly 2x (residential + commercial), and EVERY «THEN 12»
-- in the view is one of those 2 — so nothing else can be caught by the replacement.

DO $$
DECLARE
  old_def text;
  new_def text;
  n_before int;
BEGIN
  old_def := pg_get_viewdef('public.listing_extra_attrs'::regclass, true);

  n_before := (length(old_def) - length(replace(old_def, 'WHEN ''10+ years''::text THEN 12', '')))
              / length('WHEN ''10+ years''::text THEN 12');
  IF n_before <> 2 THEN
    RAISE EXCEPTION 'REFUSING: expected exactly 2 occurrences of the 10+->12 mapping, found %. The view '
                    'changed shape; re-verify before replacing.', n_before;
  END IF;

  -- Guard: if any OTHER "THEN 12" existed we would be at risk of clobbering an unrelated mapping.
  IF ((length(old_def) - length(replace(old_def, 'THEN 12', ''))) / length('THEN 12')) <> 2 THEN
    RAISE EXCEPTION 'REFUSING: a THEN 12 exists outside the 10+ mapping; replacement is not safe.';
  END IF;

  new_def := replace(old_def, 'WHEN ''10+ years''::text THEN 12', 'WHEN ''10+ years''::text THEN 10');

  IF new_def = old_def THEN
    RAISE EXCEPTION 'REFUSING: replacement produced no change.';
  END IF;

  EXECUTE 'CREATE OR REPLACE VIEW public.listing_extra_attrs AS ' || new_def;
END $$;

-- Post-condition: the fabrication is gone and the floor is in place.
DO $$
DECLARE d text;
BEGIN
  d := pg_get_viewdef('public.listing_extra_attrs'::regclass, true);
  IF position('WHEN ''10+ years''::text THEN 12' in d) > 0 THEN
    RAISE EXCEPTION 'FAILED: the 10+->12 fabrication is still present.';
  END IF;
  IF position('WHEN ''10+ years''::text THEN 10' in d) = 0 THEN
    RAISE EXCEPTION 'FAILED: the 10+->10 floor mapping is absent.';
  END IF;
END $$;