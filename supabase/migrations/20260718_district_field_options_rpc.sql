-- District filter field backend — read-only additions (applied live via MCP 2026-07-18 under the deploy
-- lock; this file mirrors prod for git parity). No change to the live search tokenizer or its refresh
-- pipeline: the hamza-twin recall gap is handled at THIS read layer + by returning every spelling.
--
-- district_options_ar(p_city_id) powers BOTH district behaviors in one call for a chosen city:
--   * complete canonical catalog (loc_canonical_district) incl. zero-listing districts (stay findable),
--   * live active-listing counts (search_listings_ar) for the Top-6 popularity ranking,
--   * hamza-twin dedup ON READ (fold trailing ء) so «الصفا»/«الصفاء» are ONE row, counts summed,
--   * match_values = every raw canonical spelling in the folded group → the client sends ALL of them to
--     p_districts so search recall is complete WITHOUT touching norm_district_tok / its expression index.
-- Frontend: Top-6 = rows with listing_count>0 (desc, take 6); autocomplete = filter ALL rows by text.
-- Scoped to p_city_id → another city's districts can never appear.
--
-- NOTE: a composite expression index (city_id, norm_district_tok(district_ar)) was trialed and DROPPED —
-- the planner still bitmap-scans + recomputes tokens, so it gave no gain over the existing idx_slar_city_id
-- while adding write cost. The ~350ms per-city aggregate is load-once-per-city-select (matches the city
-- field's budget), so no index/matview is warranted yet.
CREATE OR REPLACE FUNCTION public.district_options_ar(p_city_id integer)
RETURNS TABLE(district_ar text, listing_count integer, match_values text[])
LANGUAGE sql STABLE AS $fn$
  WITH live AS (
    SELECT norm_district_tok(district_ar) AS tok, count(*)::int AS n
    FROM public.search_listings_ar
    WHERE city_id = p_city_id AND production_ready AND district_ar IS NOT NULL
    GROUP BY 1
  ),
  cat AS (
    SELECT c.canonical_district_ar,
           regexp_replace(c.district_norm, 'ء$', '') AS fold,
           COALESCE(l.n, 0) AS n
    FROM public.loc_canonical_district c
    LEFT JOIN live l ON l.tok = c.district_norm
    WHERE c.city_id = p_city_id
  )
  SELECT (array_agg(canonical_district_ar ORDER BY n DESC, canonical_district_ar))[1] AS district_ar,
         sum(n)::int AS listing_count,
         array_agg(DISTINCT canonical_district_ar) AS match_values
  FROM cat
  GROUP BY fold
  ORDER BY listing_count DESC, district_ar;
$fn$;

GRANT EXECUTE ON FUNCTION public.district_options_ar(integer) TO anon, authenticated;
