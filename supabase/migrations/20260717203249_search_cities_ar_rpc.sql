-- Recovered verbatim from production on 2026-07-20 (drift reconciliation): applied directly to prod via MCP as supabase_migrations.schema_migrations version 20260717203249, name 'search_cities_ar_rpc'; this committed file is the source-of-truth record, NOT the apply path. Body is byte-for-byte the live statement (md5 59285c6eee295d18a55027e82b832d54).
-- City-only search RPC (owner spec 2026-07-17): backs the Filter form's City field.
--
-- p_query IS NULL/blank -> Top 6 cities in Saudi Arabia by LIVE production-ready listing count
--   (city_listing_counts_ar is a live view over search_listings_ar joined to the canonical
--   loc_catalog_city/loc_catalog_region -- never hardcoded, always current).
-- p_query given -> cities-only autocomplete: normalizes the typed text the SAME way
--   loc_catalog_city.city_norm was built (tashkeel/tatweel stripped; hamza forms + alef maksura +
--   taa marbuta folded), then substring-matches against city_norm, ranking prefix matches first
--   and breaking ties by listing count. NEVER matches districts, regions, or landmarks -- those
--   tables are not queried at all.
--
-- Both branches key strictly on the real city_id/region_id from loc_catalog_city/loc_catalog_region,
-- so two cities that share an Arabic name (confirmed live: الباحة, الهفوف, القويعية, ...) are always
-- returned as distinct rows with their own region -- never merged or guessed.
create or replace function public.search_cities_ar(p_query text default null, p_limit int default null)
returns table (
  city_id integer,
  city_ar text,
  region_id integer,
  region_ar text,
  listing_count bigint
)
language plpgsql
stable
security definer
set search_path = public
as $function$
declare
  v_norm text;
  v_limit int;
begin
  v_norm := nullif(btrim(coalesce(p_query, '')), '');
  if v_norm is not null then
    v_norm := lower(v_norm);
    v_norm := regexp_replace(v_norm, '[ً-ٰٟـ]', '', 'g'); -- strip tashkeel + tatweel
    v_norm := translate(v_norm, 'أإآٱةى', 'ااااهي'); -- fold hamza forms / taa marbuta / alef maksura
  end if;

  v_limit := coalesce(p_limit, case when v_norm is null then 6 else 20 end);

  return query
  select cc.city_id, cc.city_ar, cc.region_id, cc.region_ar, cc.listing_count
  from public.city_listing_counts_ar cc
  join public.loc_catalog_city lc on lc.city_id = cc.city_id
  where v_norm is null or lc.city_norm like '%' || v_norm || '%'
  order by
    (v_norm is not null and lc.city_norm like v_norm || '%') desc, -- prefix matches rank first
    cc.listing_count desc
  limit v_limit;
end;
$function$;

grant execute on function public.search_cities_ar(text, int) to anon, authenticated;
