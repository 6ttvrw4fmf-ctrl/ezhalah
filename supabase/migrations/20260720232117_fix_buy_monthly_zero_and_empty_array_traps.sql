-- Fix 2 P0 bugs found in the 2026-07-20 post-deploy Filter QA sweep, confirmed identically present in
-- both location_search_candidates_ar and property_age_option_counts_ar (must never drift apart from
-- each other, per standing project rule).
--
-- (1) p_rent_period was never actually gated on deal_ar='إيجار'. Every Buy (بيع) row has
--     payment_monthly=false by construction, so p_rent_period='شهري' (Monthly) combined with p_deal='بيع'
--     required payment_monthly=true -- an impossible combination -- silently wiping 100% of real Buy
--     results to an empty response (verified live: 36,458 real Riyadh Buy listings -> 0). 'سنوي' (Yearly)
--     only "worked" by coincidence (it requires payment_monthly=false, which every Buy row already
--     satisfies). Fix: `s.deal_ar <> 'إيجار'` is a true no-op arm, so rent_period never filters a
--     non-Rent row, matching "meaningless for Buy, must be silently ignored".
--
-- (2) p_cities, p_districts, p_platforms, and p_beds_exact each treated an explicit empty array `[]`
--     as an ACTIVE filter matching nothing, instead of the same no-op as omitting/nulling the param --
--     inconsistent with p_amenities=[], which already behaves correctly (a different clause shape
--     happens to make it safe by construction). A future/other caller sending [] for an "unselected"
--     multi-select state (a very natural default, e.g. `useState<string[]>([])`) would see a silent,
--     unexplained empty result for an entire city even though real matches exist. Fix: treat an empty
--     array the same as null for each of these four params.
--
-- Per this project's RPC full-body-replace-hazard rule: both new bodies are built by taking
-- pg_get_functiondef() of the CURRENTLY LIVE function and replacing ONLY the exact substrings below,
-- with a RAISE EXCEPTION guard if the expected old text isn't found (or isn't found exactly once) --
-- never a hand-copied prior migration body, and never a silent no-op if the body has since drifted.

do $mig$
declare
  fn text;
  d text;
  n int;
begin
  foreach fn in array array['public.location_search_candidates_ar', 'public.property_age_option_counts_ar']
  loop
    d := pg_get_functiondef(fn::regproc);

    -- (1) rent_period must be a no-op for any non-Rent row.
    n := (length(d) - length(replace(d, 'p_rent_period is null', ''))) / length('p_rent_period is null');
    if n <> 1 then
      raise exception 'REFUSING (%): expected exactly 1 occurrence of "p_rent_period is null", found %. Body changed -- re-verify before replacing.', fn, n;
    end if;
    d := replace(d, 'p_rent_period is null', 'p_rent_period is null' || chr(10) || '           or s.deal_ar <> ''إيجار''');

    -- (2) p_cities: empty array = no filter.
    if d !~ 'p_cities\s+is null' then
      raise exception 'REFUSING (%): expected p_cities null-check not found.', fn;
    end if;
    d := regexp_replace(d, 'p_cities\s+is null', 'p_cities is null or cardinality(p_cities) = 0');

    -- (3) p_districts: empty array = no filter.
    if d !~ 'p_districts\s+is null' then
      raise exception 'REFUSING (%): expected p_districts null-check not found.', fn;
    end if;
    d := regexp_replace(d, 'p_districts\s+is null', 'p_districts is null or cardinality(p_districts) = 0');

    -- (4) p_platforms: empty array = no filter.
    if d !~ 'p_platforms\s+is null' then
      raise exception 'REFUSING (%): expected p_platforms null-check not found.', fn;
    end if;
    d := regexp_replace(d, 'p_platforms\s+is null', 'p_platforms is null or cardinality(p_platforms) = 0');

    -- (5) p_beds_exact: empty array = same as unset (treat like p_beds_min's own null check).
    n := (length(d) - length(replace(d, 'p_beds_exact is null', ''))) / length('p_beds_exact is null');
    if n <> 1 then
      raise exception 'REFUSING (%): expected exactly 1 occurrence of "p_beds_exact is null", found %.', fn, n;
    end if;
    d := replace(d, 'p_beds_exact is null', 'coalesce(cardinality(p_beds_exact), 0) = 0');

    n := (length(d) - length(replace(d, 'p_beds_exact is not null', ''))) / length('p_beds_exact is not null');
    if n <> 1 then
      raise exception 'REFUSING (%): expected exactly 1 occurrence of "p_beds_exact is not null", found %.', fn, n;
    end if;
    d := replace(d, 'p_beds_exact is not null', 'coalesce(cardinality(p_beds_exact), 0) > 0');

    execute d;
  end loop;
end
$mig$;

notify pgrst, 'reload schema';
