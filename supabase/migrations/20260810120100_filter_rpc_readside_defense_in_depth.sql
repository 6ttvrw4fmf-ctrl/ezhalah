-- READ-SIDE DEFENSE-IN-DEPTH for the normal Filter RPC (location_search_candidates_ar).
-- Belt-and-suspenders over the production_ready flag: even if a row is wrongly production_ready, the
-- Filter itself refuses to return an Ezhalah-side INVALID row. Blocks ONLY:
--   * negative/impossible parser output (area<0, price<0)   [0 stays legal — "on request"/"unknown"]
--   * missing required deal field (deal_ar is null)
--   * broken production_ready state (production_ready=true but no resolved city/region)
-- SOURCE IS TRUTH: it NEVER hides a source-published price by magnitude, and it does NOT change the
-- countrywide unresolved-location branch (those rows are not production_ready, so the location clause
-- does not constrain them). Injected surgically from the live definition (RPC-hazard rule) with an
-- anchor-count guard so a drifted definition aborts instead of being mis-rewritten.
do $mig$
declare def text;
        anchor text := 'and (s.region_id is null or s.city_id is null)))';
        oid_target oid;
        n_anchor int;
begin
  select p.oid into oid_target
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='location_search_candidates_ar';
  def := pg_get_functiondef(oid_target);

  if position('not s.production_ready or (s.city_id is not null and s.region_id is not null)' in def) > 0 then
    raise notice 'read-side guard already present — no-op'; return;
  end if;

  n_anchor := (length(def) - length(replace(def, anchor, ''))) / length(anchor);
  if n_anchor <> 1 then
    raise exception 'anchor found % times (expected 1) — aborting to avoid a bad rewrite', n_anchor;
  end if;

  def := replace(def, anchor, anchor
    || E'\n      -- read-side defense-in-depth (2026-08): block only Ezhalah-side impossible/invalid states;'
    || E'\n      -- never hides a source price (no magnitude check; 0 legal); production_ready must have a location.'
    || E'\n      and coalesce(s.area_m2, 0) >= 0 and coalesce(s.price_total, 0) >= 0 and coalesce(s.price_annual, 0) >= 0'
    || E'\n      and s.deal_ar is not null'
    || E'\n      and (not s.production_ready or (s.city_id is not null and s.region_id is not null))'
  );
  execute def;
  raise notice 'read-side guard injected into location_search_candidates_ar';
end $mig$;

-- REGRESSION TRIPWIRE: fail the migration if the guard is not present after this runs. A future deploy
-- that re-creates the RPC without the guard (the classic "guard silently removed" regression) trips here.
-- Backed at runtime by mon_detect_filter_barrier_leaks (continuous P1 alert on any real leak).
do $tw$
begin
  if position('not s.production_ready or (s.city_id is not null and s.region_id is not null)'
      in pg_get_functiondef((select oid from pg_proc
                             where proname='location_search_candidates_ar'
                               and pronamespace='public'::regnamespace))) = 0 then
    raise exception 'REGRESSION: read-side barrier guard missing from location_search_candidates_ar';
  end if;
  raise notice 'read-side barrier guard verified present';
end $tw$;
