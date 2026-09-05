-- Revert the top_cities_by_deal_ar cluster collapse (2026-09-04) — the collapse belongs CLIENT-side.
--
-- WHY REVERTED. Collapsing clusters inside top_cities_by_deal_ar made the Trending count correct
-- (الهفوف 4,953 == click) but OVER-REACHED: that RPC also feeds the city AUTOCOMPLETE pool
-- (CITY_FIELD_POOLS -> matchCitiesByText), and the city field is tap-only (city-id-search identity
-- rule). Removing الاحساء's row from the pool made الاحساء UNSELECTABLE by typing — a real regression
-- (verified live: typing «الاحساء» returned zero suggestions). Trending (top-6 shown on focus) and
-- typing must be collapsed TOGETHER, and only the client distinguishes those two surfaces, so the
-- collapse must live there — where typing any cluster-member name can still resolve to the one
-- canonical option. This restores the RPC to per-city rows (the pre-collapse status quo); the
-- client-side collapse ships in a follow-up once the frontend deploy is unblocked.
--
-- Needle-edits the LIVE def (reverse of the collapse), preserving the clause/CTE byte-for-byte.
do $mig$
declare v_def text; v_new text;
begin
  v_def := pg_get_functiondef('public.top_cities_by_deal_ar(text,text,text,text[],text[],text[],text[],text[],integer[],text[],text[],integer[],integer,numeric,numeric,integer,integer,integer,integer,boolean,boolean,text[],integer,integer[],boolean,text,text[],boolean,smallint,smallint,integer,integer,numeric,integer,text[],numeric,numeric)'::regprocedure);
  if position('cluster_rep' in v_def) = 0 then
    raise exception 'top_cities_by_deal_ar has no cluster_rep — nothing to revert (already per-city)';
  end if;
  v_new := replace(v_def, $new$  , cluster_rep as (
    select city_id, min(city_id) over (partition by cluster_key) as rep_id from public.loc_city_cluster
  )
  select coalesce(cr.rep_id, co.city_id) as city_id, c.city_ar, c.region_id, r.region_ar,
         count(*)::int as listing_count, total.t as total_in_cohort
  from cohort co
    left join cluster_rep cr on cr.city_id = co.city_id
    join public.loc_catalog_city c on c.city_id = coalesce(cr.rep_id, co.city_id)
    left join public.loc_catalog_region r on r.region_id = c.region_id
    cross join total
  group by coalesce(cr.rep_id, co.city_id), c.city_ar, c.region_id, r.region_ar, total.t
  order by listing_count desc;$new$, $old$  select co.city_id, c.city_ar, c.region_id, r.region_ar,
         count(*)::int as listing_count, total.t as total_in_cohort
  from cohort co
    join public.loc_catalog_city c on c.city_id = co.city_id
    left join public.loc_catalog_region r on r.region_id = c.region_id
    cross join total
  group by co.city_id, c.city_ar, c.region_id, r.region_ar, total.t
  order by listing_count desc;$old$);
  if v_new = v_def then raise exception 'reverse replacement did not apply'; end if;
  execute v_new;
end $mig$;
-- NOTE: this mirror records the SEMANTIC revert; the live apply on 2026-09-04 stripped the collapse
-- comment block as part of the same reverse edit. The net live state is per-city (self-checked: 2
-- al_ahsa rows), which this migration reproduces from any collapsed starting def.
