-- Extend the read-side defense-in-depth guard (PR #409, applied to location_search_candidates_ar
-- only) to the two sibling COUNT RPCs the Advanced Filter uses for its live per-option counts:
-- apartment_guided_counts_ar and property_age_option_counts_ar.
--
-- ROOT CAUSE / WHY THIS MATTERS: docs/ADVANCED_FILTER_DESIGN_CONTRACT.md §8 is explicit —
-- "Aggregate: the footer Show {N} live count on every card. N = exactly what Search will return
-- for the current selection (count == search, always — same predicate at count and search time)."
-- All three RPCs share the identical base eligibility clause (production_ready OR
-- genuinely-unlocated-and-not-price-gated) verbatim — confirmed live 2026-08-10, byte-identical
-- text in all three pg_get_functiondef() outputs. But PR #409's read-side hardening (blocks a
-- production_ready row from ever being served if it carries a negative price/area, a null deal, or
-- production_ready=true with no resolved location — belt-and-suspenders over the write-side gate)
-- was applied to location_search_candidates_ar ONLY. If a bad row ever slipped past the write-side
-- gate, the SEARCH would correctly hide it while the COUNT RPCs would still count it — a live
-- violation of "count == search, always" that would surface as a real-but-invisible-until-tested
-- filter bug (a count the user sees that the search can never fulfil).
--
-- Currently a NO-OP on live data (mon_filter_barrier_leaks shows 0 leaks across 185k+ rows, 2026-08-10
-- filter audit) — the self-test below proves counts are numerically UNCHANGED by this migration.
-- The value is future protection, matching the exact contract the Design Contract already promises.
--
-- Same anchor-count-guard technique as PR #409: locate the anchor text, verify it occurs EXACTLY
-- once (abort otherwise, never a blind rewrite), inject the guard immediately after it.
--
-- APPLIED TO PRODUCTION 2026-08-10 14:54 UTC under the deploy lock (2026-08-10 filter audit). Both
-- self-tests passed live: the anchor was found exactly once in each function, the guard was
-- injected and verified present, and both count RPCs returned the EXACT same baseline (109581 for
-- p_deal='بيع') before and after — confirmed a provable no-op on today's data.

do $mig_apt$
declare def text;
        anchor text := 'and (s.region_id is null or s.city_id is null)))';
        oid_target oid;
        n_anchor int;
begin
  select p.oid into oid_target
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'apartment_guided_counts_ar';
  def := pg_get_functiondef(oid_target);

  if position('not s.production_ready or (s.city_id is not null and s.region_id is not null)' in def) > 0 then
    raise notice 'apartment_guided_counts_ar: read-side guard already present — no-op';
  else
    n_anchor := (length(def) - length(replace(def, anchor, ''))) / length(anchor);
    if n_anchor <> 1 then
      raise exception 'apartment_guided_counts_ar: anchor found % times (expected 1) — aborting', n_anchor;
    end if;

    def := replace(def, anchor, anchor
      || E'\n      -- read-side defense-in-depth (2026-08-10, filter audit) — mirrors location_search_candidates_ar'
      || E'\n      -- (PR #409): the Advanced Filter contract requires count == search, always (same predicate).'
      || E'\n      -- Never hides a source price (no magnitude check; 0 legal); production_ready must have a location.'
      || E'\n      and coalesce(s.area_m2, 0) >= 0 and coalesce(s.price_total, 0) >= 0 and coalesce(s.price_annual, 0) >= 0'
      || E'\n      and s.deal_ar is not null'
      || E'\n      and (not s.production_ready or (s.city_id is not null and s.region_id is not null))'
    );
    execute def;
    raise notice 'apartment_guided_counts_ar: read-side guard injected';
  end if;
end $mig_apt$;

do $mig_age$
declare def text;
        anchor text := 'and (s.region_id is null or s.city_id is null)))';
        oid_target oid;
        n_anchor int;
begin
  select p.oid into oid_target
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'property_age_option_counts_ar';
  def := pg_get_functiondef(oid_target);

  if position('not s.production_ready or (s.city_id is not null and s.region_id is not null)' in def) > 0 then
    raise notice 'property_age_option_counts_ar: read-side guard already present — no-op';
  else
    n_anchor := (length(def) - length(replace(def, anchor, ''))) / length(anchor);
    if n_anchor <> 1 then
      raise exception 'property_age_option_counts_ar: anchor found % times (expected 1) — aborting', n_anchor;
    end if;

    def := replace(def, anchor, anchor
      || E'\n      -- read-side defense-in-depth (2026-08-10, filter audit) — mirrors location_search_candidates_ar'
      || E'\n      -- (PR #409): the Advanced Filter contract requires count == search, always (same predicate).'
      || E'\n      -- Never hides a source price (no magnitude check; 0 legal); production_ready must have a location.'
      || E'\n      and coalesce(s.area_m2, 0) >= 0 and coalesce(s.price_total, 0) >= 0 and coalesce(s.price_annual, 0) >= 0'
      || E'\n      and s.deal_ar is not null'
      || E'\n      and (not s.production_ready or (s.city_id is not null and s.region_id is not null))'
    );
    execute def;
    raise notice 'property_age_option_counts_ar: read-side guard injected';
  end if;
end $mig_age$;

-- REGRESSION TRIPWIRE: fail the migration if either guard is not present after this runs (the
-- classic "guard silently removed/never applied" regression this whole PR pattern exists to catch).
do $tw$
begin
  if position('not s.production_ready or (s.city_id is not null and s.region_id is not null)'
      in pg_get_functiondef((select oid from pg_proc
                             where proname = 'apartment_guided_counts_ar'
                               and pronamespace = 'public'::regnamespace))) = 0 then
    raise exception 'REGRESSION: read-side guard missing from apartment_guided_counts_ar';
  end if;
  if position('not s.production_ready or (s.city_id is not null and s.region_id is not null)'
      in pg_get_functiondef((select oid from pg_proc
                             where proname = 'property_age_option_counts_ar'
                               and pronamespace = 'public'::regnamespace))) = 0 then
    raise exception 'REGRESSION: read-side guard missing from property_age_option_counts_ar';
  end if;
  raise notice 'read-side guard verified present on both count RPCs';
end $tw$;

-- PROOF this is a no-op on today's live data (mon_filter_barrier_leaks: 0 leaks). If any of these
-- ever fail, that itself is proof the guard just started doing real work — investigate the delta,
-- don't revert the guard.
do $proof$
declare v_apt_after bigint;
        v_age_after bigint;
begin
  -- Baselines captured live immediately before this migration (2026-08-10 filter audit):
  --   apartment_guided_counts_ar(p_deal=>'بيع') cnt_total_base = 109581
  --   property_age_option_counts_ar(p_deal=>'بيع') cnt_total = 109581
  select cnt_total_base into v_apt_after from apartment_guided_counts_ar(p_deal := 'بيع');
  select cnt_total into v_age_after from property_age_option_counts_ar(p_deal := 'بيع');
  if v_apt_after <> 109581 then
    raise exception 'apartment_guided_counts_ar(بيع) changed: baseline=109581 now=%  — guard is not a no-op, investigate before trusting this migration', v_apt_after;
  end if;
  if v_age_after <> 109581 then
    raise exception 'property_age_option_counts_ar(بيع) changed: baseline=109581 now=%  — guard is not a no-op, investigate before trusting this migration', v_age_after;
  end if;
  raise notice 'count-RPC hardening confirmed a no-op on live data — both counts unchanged at 109581';
end $proof$;
