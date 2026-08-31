-- INCIDENT FIX: loc_classify()'s city_cands/dist_cands correlated subqueries each ran
-- `count(*) FROM public.listing_native_location_v2` once PER catalog candidate row.
-- listing_native_location_v2 is a plain VIEW (4-way UNION ALL + LEFT JOIN LATERAL, no indexes
-- of its own) -- EXPLAIN ANALYZE showed ONE such count(*) costs ~31s / ~5.8M buffer hits, so
-- any twin/region_or_city case (2+ candidate rows) blows through the anon/authenticated
-- PostgREST statement_timeout (20s) and even the 120s cluster default. Reproduced live via the
-- real PostgREST path: POST /rest/v1/rpc/loc_classify {"p_token":"الرياض"} -> HTTP 500
-- {"code":"57014","message":"canceling statement due to statement timeout"} at 20.48s wall,
-- for the SIMPLEST possible case (one candidate row).
--
-- Fix: point both correlated subqueries at public.search_listings_ar instead -- same
-- city_id/district_ar-shaped columns, already indexed (idx_slar_city_id, idx_slar_district_norm/
-- idx_slar_district_tok), synced hourly from the same v1/v2 pipeline (docs/LOCATION_SYSTEM.md).
-- Verified before/after on the three known ambiguity cases (kind + candidate counts identical,
-- only this migration's table name changed):
--   'الرياض'        region_or_city, 1 city candidate            -- unchanged (kind never reads inv)
--   'الحفيرة'       twin_city, 10 candidates / 5 regions        -- unchanged (kind never reads inv)
--   'حي العزيزية'   twin_district, dist_n=53, dist_inv_n=24     -- IDENTICAL 24/53 old view vs new table
-- Execution time: ~31s-to-timeout per row (old) -> ~2ms-13ms per row via idx_slar_city_id (new);
-- the full 53-candidate العزيزية case: unindexed-view estimate ~1600s (never completes) -> 1.9s.
-- No other line of the function changed.
CREATE OR REPLACE FUNCTION public.loc_classify(p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
AS $function$
declare
  tok text; bare text; tok_norm text; dist_intent boolean;
  city_cands jsonb; dist_cands jsonb; dist_inv jsonb;
  is_region boolean; is_city boolean;
  city_n int; dist_n int; dist_inv_n int;
begin
  tok := btrim(coalesce(p_token,''));
  if tok = '' then return jsonb_build_object('kind','none'); end if;

  if tok ~ '^[A-Za-z .''-]+$' then
    select city_ar into bare from public.loc_city_map where city_key = lower(tok) limit 1;
    if bare is null then bare := tok; end if;
  else
    bare := tok;
  end if;

  dist_intent := bare ~ '^(حي|بحي)\s';
  bare := btrim(regexp_replace(bare, '^(حي|مدينة|منطقة|في|بمدينة|بحي|بمنطقة)\s+', ''));
  tok_norm := normalize_ar(bare);

  select coalesce(jsonb_agg(x order by inv desc), '[]'::jsonb) into city_cands from (
    select c.city_ar, r.region_ar, c.city_id,
           (select count(*) from public.search_listings_ar v where v.city_id=c.city_id) inv
    from public.loc_catalog_city c join public.loc_catalog_region r on r.region_id=c.region_id
    where normalize_ar(c.city_ar) = tok_norm
  ) x;

  select coalesce(jsonb_agg(x order by inv desc), '[]'::jsonb) into dist_cands from (
    select d.district_ar, c.city_ar, r.region_ar, c.city_id,
           (select count(*) from public.search_listings_ar v
             where v.city_id=c.city_id
               and normalize_ar(coalesce(v.district_ar,'')) in (normalize_ar(d.district_ar), tok_norm)) inv
    from public.loc_catalog_district d
      join public.loc_catalog_city c on c.city_id=d.city_id
      join public.loc_catalog_region r on r.region_id=c.region_id
    where normalize_ar(d.district_ar) in (tok_norm, normalize_ar('حي '||bare))
  ) x;

  select coalesce(jsonb_agg(e order by (e->>'inv')::int desc), '[]'::jsonb) into dist_inv
  from jsonb_array_elements(dist_cands) e where (e->>'inv')::int > 0;

  select exists(select 1 from public.loc_catalog_region r
                where normalize_ar(r.region_ar)=tok_norm
                   or normalize_ar(r.region_ar)=normalize_ar('منطقة '||bare)) into is_region;
  select exists(select 1 from public.loc_catalog_city c where normalize_ar(c.city_ar)=tok_norm) into is_city;

  city_n := jsonb_array_length(city_cands);
  dist_n := jsonb_array_length(dist_cands);
  dist_inv_n := jsonb_array_length(dist_inv);

  -- 1) explicit «حي …» → district handling
  if dist_intent then
    if dist_inv_n >= 2 then
      return jsonb_build_object('kind','twin_district','name',bare,'cities',dist_inv,'all_cities',dist_cands);
    elsif dist_inv_n = 1 then
      return jsonb_build_object('kind','district','name',bare,'cities',dist_inv);
    else
      return jsonb_build_object('kind','district_empty','name',bare,'all_cities',dist_cands);
    end if;
  end if;
  -- 2) region/city same name (الرياض/جازان/تبوك/…) wins over an incidental same-named حي elsewhere
  if is_region and is_city then
    return jsonb_build_object('kind','region_or_city','name',bare,'cities',city_cands);
  end if;
  -- 3) pure region name (no same-name city)
  if is_region and not is_city then
    return jsonb_build_object('kind','region','name',bare);
  end if;
  -- 4) twin / single city
  if city_n >= 2 then
    return jsonb_build_object('kind','twin_city','name',bare,'regions',city_cands);
  end if;
  if city_n = 1 then
    return jsonb_build_object('kind','city','name',bare,'regions',city_cands);
  end if;
  -- 5) bare district token (no حي prefix, not a city)
  if dist_inv_n >= 2 then
    return jsonb_build_object('kind','twin_district','name',bare,'cities',dist_inv,'all_cities',dist_cands);
  end if;
  if dist_n >= 1 then
    return jsonb_build_object('kind','district','name',bare,'cities', case when dist_inv_n>=1 then dist_inv else dist_cands end);
  end if;
  return jsonb_build_object('kind','none','name',bare);
end $function$;
