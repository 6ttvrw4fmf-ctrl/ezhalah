-- ─────────────────────────────────────────────────────────────────────────────────────────────────
-- Property Age Phase 2: the registry-driven, data-gated, self-generating age producer.
-- Implements the permanent platform-agnostic architecture (owner 2026-07-17). Replaces the hand-named
-- 4-table age source (aqar+wasalt inside listing_extra_attrs) with a producer that:
--   • enumerates EVERY %_listings table carrying the canonical `property_age` column (schema convention),
--   • applies a DATA-DRIVEN validity gate (rejects empty / build-year / sentinel / implausible),
--   • is filtered by a small REGISTRY (strategy + a `trusted` flag = the one honest human/auto seam),
--   • CODE-GENERATES the union into a plain view (fast at query time; no human ever edits a UNION).
-- Adding a platform later = INSERT one registry row after a spot-check, then rebuild — no view/code edit.
--
-- SCOPE = AGE ONLY. listing_extra_attrs still produces the 14 amenity attributes (furnished, direction,
-- floor, elevator, …) byte-identical; only property_age moves to the producer. v2 branch 1 is the only
-- branch touched (its LEFT JOIN listing_extra_attrs.property_age -> the producer); the souq24 and
-- unresolved_catchall branches stay identical (they are NULL today and stay NULL — Phase 3 wires souq24).
--
-- NO REGRESSION (proven read-only before writing this): the canonical-column producer reproduces the
-- CURRENT search age for aqar+wasalt EXACTLY (95,355/95,355, 0 lost) and recovers +17 real ages the old
-- JSONB CASE missed. NEW: raghdan (+247, canonical == its JSONB age_text 100%). EXCLUDED by the gate/
-- registry: aqarcity (all-zero canonical is sentinel-SHAPED — its real 13-value age is in JSONB, Phase 3),
-- aldarim (build years / mixed), mizlaj (reads the wrong field — Phase 3), ramzalqasim + erapulse
-- (canonical-only, no second source to corroborate → held untrusted until a spot-check).
--
-- Accuracy over coverage; never fabricate; unknown -> NULL. Governed by the price-fidelity rule.

-- ── 1. REGISTRY ─────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS age_source_registry (
  source_table text PRIMARY KEY,
  strategy     text NOT NULL DEFAULT 'canonical_column'
               CHECK (strategy IN ('canonical_column','ignore')),   -- jsonb strategies arrive in Phase 3
  trusted      boolean NOT NULL DEFAULT false,   -- a canonical-only column flows ONLY once verified;
                                                 -- this row (not a view edit) is the onboarding seam
  note         text,
  updated_at   timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE age_source_registry IS
  'Per-source Property Age strategy. Default (no row) = a candidate the gate sees but that stays OUT of '
  'search until trusted=true. Onboard a platform: verify its age, INSERT one row, SELECT rebuild_age_producer().';

INSERT INTO age_source_registry (source_table, strategy, trusted, note) VALUES
  ('aqar_residential_listings',   'canonical_column', true,  'verified: numeric tokens 100% source-faithful; parser recovers جديد/سنتين/10+'),
  ('aqar_commercial_listings',    'canonical_column', true,  'verified with residential'),
  ('wasalt_residential_listings', 'canonical_column', true,  'verified: canonical == JSONB completionYear 100% after PR #133 de-corrupt'),
  ('wasalt_commercial_listings',  'canonical_column', true,  'verified with residential'),
  ('raghdan_residential_listings','canonical_column', true,  'verified: canonical == JSONB age_text 100% of 247 rows'),
  ('raghdan_commercial_listings', 'canonical_column', true,  'verified with residential'),
  ('aqarcity_residential_listings','ignore', false, 'canonical is all-0 (sentinel-SHAPED); real 13-value age is in additional_info.property_age → Phase 3 JSONB'),
  ('aqarcity_commercial_listings', 'ignore', false, 'as residential'),
  ('aldarim_residential_listings', 'ignore', false, 'canonical holds BUILD YEARS (max 2026) / mixed semantics → needs year→age transform'),
  ('aldarim_commercial_listings',  'ignore', false, 'as residential'),
  ('mizlaj_residential_listings',  'ignore', false, 'reads broker free int, not REGA authoritative field → Phase 3'),
  ('mizlaj_commercial_listings',   'ignore', false, 'as residential'),
  ('ramzalqasim_residential_listings','canonical_column', false, 'HELD: canonical-only, no 2nd source to corroborate; spot-check before trusting'),
  ('erapulse_residential_listings',   'canonical_column', false, 'HELD: canonical-only (JSONB key is usage, not age); 13 rows; spot-check before trusting')
ON CONFLICT (source_table) DO NOTHING;

-- ── 2. DATA-DRIVEN HEALTH GATE ──────────────────────────────────────────────────────────────────────
-- Verdict computed from each table's OWN data, so a brand-new platform is judged automatically with no
-- rule written for it. Rule ORDER matters: too_small BEFORE sentinel (a 1-row table has n_distinct=1 but
-- is not a sentinel). NOTE the honest limit: this can only FAIL-SAFE (reject bad shapes); it cannot detect
-- subtle corruption (it rated wasalt's old +1 column "plausible"). That is why `trusted` exists.
CREATE OR REPLACE FUNCTION public.age_source_health()
RETURNS TABLE(source_table text, n_aged bigint, n_distinct bigint, min_age int, max_age int,
              n_yearlike bigint, verdict text)
LANGUAGE plpgsql STABLE AS $fn$
DECLARE t text; na bigint; nd bigint; mn int; mx int; ny bigint;
BEGIN
  FOR t IN
    SELECT c.table_name FROM information_schema.columns c
    JOIN information_schema.tables tb
      ON tb.table_schema=c.table_schema AND tb.table_name=c.table_name AND tb.table_type='BASE TABLE'
    WHERE c.table_schema='public' AND c.column_name='property_age' AND c.table_name LIKE '%\_listings'
    ORDER BY 1
  LOOP
    EXECUTE format(
      'SELECT count(*) FILTER (WHERE property_age IS NOT NULL), count(DISTINCT property_age),
              min(property_age)::int, max(property_age)::int,
              count(*) FILTER (WHERE property_age > 1900)
       FROM public.%I WHERE active', t)
      INTO na, nd, mn, mx, ny;
    source_table := t; n_aged := na; n_distinct := nd; min_age := mn; max_age := mx; n_yearlike := ny;
    verdict := CASE
                 WHEN na = 0        THEN 'empty'
                 WHEN na < 5        THEN 'too_small'
                 WHEN ny > 0        THEN 'build_year'
                 WHEN mx > 100      THEN 'implausible'
                 WHEN nd = 1        THEN 'sentinel'
                 ELSE 'ok'
               END;
    RETURN NEXT;
  END LOOP;
END $fn$;

-- ── 3. THE GENERATOR ────────────────────────────────────────────────────────────────────────────────
-- Rebuilds listing_age_resolved(source_table, listing_id, property_age) as a plain view whose body is a
-- UNION ALL over every table that is registry canonical_column + trusted AND passes the gate. No human
-- edits the union. Returns a human-readable summary of what it included/skipped.
CREATE OR REPLACE FUNCTION public.rebuild_age_producer()
RETURNS text
LANGUAGE plpgsql AS $fn$
DECLARE
  parts text[] := '{}';
  included text[] := '{}';
  r record;
BEGIN
  FOR r IN
    SELECT reg.source_table, h.verdict, h.n_aged
    FROM age_source_registry reg
    JOIN public.age_source_health() h ON h.source_table = reg.source_table
    WHERE reg.strategy = 'canonical_column' AND reg.trusted = true AND h.verdict = 'ok'
    ORDER BY reg.source_table
  LOOP
    parts := parts || format(
      'SELECT %L::text AS source_table, id AS listing_id, property_age
         FROM public.%I WHERE active AND property_age BETWEEN 0 AND 100',
      r.source_table, r.source_table);
    included := included || (r.source_table || '(' || r.n_aged || ')');
  END LOOP;

  IF array_length(parts,1) IS NULL THEN
    -- Never leave a dangling/empty definition that later objects depend on.
    parts := ARRAY['SELECT NULL::text AS source_table, NULL::bigint AS listing_id, NULL::smallint AS property_age WHERE false'];
  END IF;

  EXECUTE 'CREATE OR REPLACE VIEW public.listing_age_resolved AS ' || array_to_string(parts, ' UNION ALL ');
  RETURN 'listing_age_resolved rebuilt from ' || coalesce(array_length(included,1),0)
         || ' trusted+ok source(s): ' || coalesce(array_to_string(included, ', '), '(none)');
END $fn$;

COMMENT ON FUNCTION public.rebuild_age_producer() IS
  'Regenerates listing_age_resolved from age_source_registry + age_source_health(). Run after changing '
  'the registry or onboarding a platform. Safe to run any time; idempotent.';

-- Build it now.
SELECT public.rebuild_age_producer();

-- ── 4. WIRE INTO SEARCH (v2 branch 1 only; other branches + all 14 amenity attrs untouched) ──────────
-- Surgical, guarded string rewrite of listing_native_location_v2's own live definition: swap branch 1's
-- age source (ea.property_age -> the producer) and add the producer join. Everything else byte-identical.
DO $$
DECLARE d text; n int;
BEGIN
  d := pg_get_viewdef('public.listing_native_location_v2'::regclass, true);

  -- Guard A: 'ea.property_age' must occur exactly once (branch 1's age source; other branches use
  -- 'NULL::smallint AS property_age', which we deliberately leave alone).
  n := (length(d) - length(replace(d, 'ea.property_age', ''))) / length('ea.property_age');
  IF n <> 1 THEN RAISE EXCEPTION 'REFUSING: expected exactly 1 ea.property_age, found %', n; END IF;

  -- Guard B: the listing_extra_attrs join we anchor the producer join after must be present verbatim.
  IF position('LEFT JOIN listing_extra_attrs ea ON ea.source_table = v1.source_table AND ea.listing_id = v1.listing_id' in d) = 0 THEN
    RAISE EXCEPTION 'REFUSING: the listing_extra_attrs join anchor was not found — v2 shape changed';
  END IF;

  d := replace(d, 'ea.property_age', 'ar.property_age');
  d := replace(d,
    'LEFT JOIN listing_extra_attrs ea ON ea.source_table = v1.source_table AND ea.listing_id = v1.listing_id',
    'LEFT JOIN listing_extra_attrs ea ON ea.source_table = v1.source_table AND ea.listing_id = v1.listing_id'
    || E'\n     LEFT JOIN listing_age_resolved ar ON ar.source_table = v1.source_table AND ar.listing_id = v1.listing_id');

  EXECUTE 'CREATE OR REPLACE VIEW public.listing_native_location_v2 AS ' || d;
END $$;
