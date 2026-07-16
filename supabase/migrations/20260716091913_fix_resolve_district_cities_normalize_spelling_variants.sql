-- RECOVERED FROM PRODUCTION 2026-07-16: this migration was applied directly to prod (via
-- MCP/psql) without being committed — recovered verbatim from
-- supabase_migrations.schema_migrations so a clean clone reconstructs the real schema. Do not
-- edit. See the 2026-07-16 search outage (PGRST203 ambiguous overload) this drift caused.

-- Fix (same-session correction): group by normalize_ar(city_ar) so spelling variants of the SAME
-- city (المزاحمية / المزاحميه, بريدة / بريده, etc — the exact same variance the main search RPC
-- itself folds via normalize_ar in its own city_tokens CTE) don't inflate the distinct-city count and
-- cause a false "ambiguous" verdict. Returns one row per normalized city, using the most-frequent raw
-- spelling as the display value, with match_count summed across all its variants.
CREATE OR REPLACE FUNCTION public.resolve_district_cities(p_districts text[])
RETURNS TABLE(city_ar text, match_count bigint)
LANGUAGE sql STABLE AS $$
  with raw as (
    select s.city_ar, normalize_ar(s.city_ar) as city_norm, count(*) as n
    from public.search_listings_ar s
    where s.production_ready
      and s.city_ar is not null
      and norm_district_tok(s.district_ar) in (
        select norm_district_tok(d) from unnest(coalesce(p_districts, '{}')) d
      )
    group by s.city_ar, normalize_ar(s.city_ar)
  ), ranked as (
    select city_norm, city_ar, n,
           row_number() over (partition by city_norm order by n desc, city_ar) as rn,
           sum(n) over (partition by city_norm) as total_n
    from raw
  )
  select city_ar, total_n as match_count
  from ranked
  where rn = 1
  order by match_count desc;
$$;
