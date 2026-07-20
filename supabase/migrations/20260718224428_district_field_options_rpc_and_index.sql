-- Recovered verbatim from production on 2026-07-20 (drift reconciliation): applied directly to prod via MCP as supabase_migrations.schema_migrations version 20260718224428, name 'district_field_options_rpc_and_index'; this committed file is the source-of-truth record, NOT the apply path. Body is byte-for-byte the live statement (md5 0f92815f25ed1bfafa76fc63c5cb48e2).
-- District filter field backend (read-only additions; no change to the live search tokenizer or its
-- refresh pipeline — the hamza recall gap is handled at THIS read layer + by returning both spellings).
--
-- 1) Composite expression index so the per-city district aggregate is index-served, not a 66k-row
--    heap scan + per-row tokenize. Built with the CURRENT norm_district_tok (no reindex of anything).
CREATE INDEX IF NOT EXISTS idx_slar_city_district_tok
  ON public.search_listings_ar (city_id, norm_district_tok(district_ar))
  WHERE production_ready AND district_ar IS NOT NULL;

-- 2) The one RPC that powers BOTH district behaviors for a chosen city, in one call:
--    * complete canonical catalog for the city (loc_canonical_district) — incl. zero-listing districts,
--    * live active-listing counts (search_listings_ar) for the Top-6 popularity ranking,
--    * hamza-twin dedup ON READ (fold trailing ء) so «الصفا»/«الصفاء» show as ONE row, counts summed,
--    * match_values = every raw canonical spelling in the folded group → the client sends ALL of them
--      to p_districts so search recall is complete WITHOUT changing the global tokenizer.
-- Frontend usage: Top-6 = rows where listing_count>0 (ranked desc, take 6); autocomplete = filter ALL
-- rows (incl. listing_count=0) by typed text. Everything scoped to p_city_id → another city can never appear.
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
           regexp_replace(c.district_norm, 'ء$', '') AS fold,   -- fold a trailing hamza to merge twins
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