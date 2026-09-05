-- Trending must show the exact set a click returns: collapse canonical city clusters (owner 2026-09-04)
--
-- THE DEFECT (found in a full AF+Trending audit, proven via the anon path users hit):
--   top_cities_by_deal_ar GROUP BY s.city_id emitted one row PER city_id, but the results RPC
--   resolves a clicked city NAME through match_city_ids, which composite_match_city_ids expands over
--   loc_city_cluster. So the sole cluster al_ahsa surfaced TWO Trending rows — الهفوف (own 4,305) and
--   الاحساء (own 648) — while clicking EITHER delivered their union 4,953. Every Trending number for a
--   clustered city was ≠ its own click result.
--
-- OWNER RULE: «Every Trending number shown must equal the exact set the user gets when clicking it.»
--   And: if the canonical resolver intentionally treats two locations as ONE search entity through
--   match_city_ids, Trending must present that as ONE canonical option, not two misleading rows.
--   loc_city_cluster IS that canonical declaration (al_ahsa = {الهفوف 12, الاحساء 3677}: الاحساء the
--   governorate/oasis name the source publishes as a city, الهفوف its principal city). city_id 501
--   (الهفوف, region 1 / Riyadh) is NOT clustered and stays a separate row — canonical identity intact.
--
-- THE FIX collapses cluster members onto their representative (min city_id) in the OUTPUT stage only.
--   The cohort, the whole af/location predicate, and the CTE block are preserved BYTE-FOR-BYTE by
--   needle-editing the LIVE definition (pg_get_functiondef) and replacing ONLY the final SELECT — so
--   the price_total_effective clause and the ambiguity guards are untouched, and the af-count-surface
--   staleness detector cannot flag a retyped clause (there is no clause copy here). Signature is
--   unchanged, so this is a CREATE OR REPLACE with no new overload.
--
-- VERIFIED before applying (read-only, production): the collapse arithmetic returns الهفوف=4,953 as a
--   single row for Buy, == the results-RPC click; and there is exactly ONE cluster in the catalog.
do $mig$
declare v_def text; v_new text;
begin
  v_def := pg_get_functiondef('public.top_cities_by_deal_ar(text,text,text,text[],text[],text[],text[],text[],integer[],text[],text[],integer[],integer,numeric,numeric,integer,integer,integer,integer,boolean,boolean,text[],integer,integer[],boolean,text,text[],boolean,smallint,smallint,integer,integer,numeric,integer,text[],numeric,numeric)'::regprocedure);
  if position('cluster_rep' in v_def) > 0 then
    raise exception 'top_cities_by_deal_ar already collapses clusters — refusing (no-op / double apply)';
  end if;
  if position($old$  select co.city_id, c.city_ar, c.region_id, r.region_ar,
         count(*)::int as listing_count, total.t as total_in_cohort
  from cohort co
    join public.loc_catalog_city c on c.city_id = co.city_id
    left join public.loc_catalog_region r on r.region_id = c.region_id
    cross join total
  group by co.city_id, c.city_ar, c.region_id, r.region_ar, total.t
  order by listing_count desc;$old$ in v_def) = 0 then
    raise exception 'the expected output SELECT was not found verbatim in the live def — refusing a blind rebuild (did the clause re-splice change the tail?)';
  end if;
  v_new := replace(v_def, $old$  select co.city_id, c.city_ar, c.region_id, r.region_ar,
         count(*)::int as listing_count, total.t as total_in_cohort
  from cohort co
    join public.loc_catalog_city c on c.city_id = co.city_id
    left join public.loc_catalog_region r on r.region_id = c.region_id
    cross join total
  group by co.city_id, c.city_ar, c.region_id, r.region_ar, total.t
  order by listing_count desc;$old$, $new$  -- CLUSTER COLLAPSE (owner rule 2026-09-04): a Trending row's count MUST equal what CLICKING it
  -- returns. loc_city_cluster is the canonical resolver's OWN declaration that a set of city_ids is
  -- ONE search entity (composite_match_city_ids' CLUSTER EXPANSION packs every sibling into
  -- match_city_ids, so clicking any member's name delivers the whole cluster's union). Presenting each
  -- member as its own row showed e.g. الهفوف 4,305 and الاحساء 648 while BOTH clicked to 4,953. Collapse
  -- members onto their representative (min city_id in the cluster; for the sole cluster al_ahsa that is
  -- الهفوف 12 — the principal city, and its most-populated member) so the ONE row's count IS the union
  -- the click delivers. Non-clustered cities map to themselves and are byte-identical to before.
  -- Canonical identity is untouched: 12 and 3677 stay distinct catalog cities and الاحساء is still
  -- typeable; only the Trending PRESENTATION of the cluster is de-duplicated — the «one canonical
  -- option» the owner specified.
  , cluster_rep as (
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
  order by listing_count desc;$new$);
  if v_new = v_def then raise exception 'replacement did not apply'; end if;
  execute v_new;
end $mig$;

-- SELF-ASSERTION — prove the outcome, do not trust that it ran.
do $check$
declare v_def text; v_rows int; v_hofuf int;
begin
  v_def := pg_get_functiondef('public.top_cities_by_deal_ar(text,text,text,text[],text[],text[],text[],text[],integer[],text[],text[],integer[],integer,numeric,numeric,integer,integer,integer,integer,boolean,boolean,text[],integer,integer[],boolean,text,text[],boolean,smallint,smallint,integer,integer,numeric,integer,text[],numeric,numeric)'::regprocedure);
  if position('cluster_rep' in v_def) = 0 then raise exception 'collapse CTE missing after apply'; end if;
  -- al_ahsa now appears exactly once, labelled by the representative (12), with the union count.
  select count(*), max(listing_count) into v_rows, v_hofuf
    from public.top_cities_by_deal_ar(p_deal := 'بيع') where city_id in (12, 3677);
  if v_rows <> 1 then raise exception 'expected ONE al_ahsa Trending row after collapse, got %', v_rows; end if;
end $check$;
