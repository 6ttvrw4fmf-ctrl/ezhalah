-- CORRECTED re-application of 20260720232117_fix_buy_monthly_zero_and_empty_array_traps.sql, which was
-- reverted by 20260720232408_revert_broken_p_cities_p_districts_precedence_bug (both functions are back
-- to their exact original bodies as of that revert).
--
-- Root cause of the previous attempt's bug: `p_cities is null` and `p_districts is null` each appear
-- TWICE per function -- once in the production_ready-visibility gate
-- (`s.production_ready or (p_cities is null and p_districts is null and p_region_ids is null)`), and
-- once in each param's own filter clause. A plain (non-global) regexp_replace() hit the FIRST
-- occurrence -- the unrelated gate clause -- corrupting its AND/OR precedence, while leaving the real
-- filter clauses (the actual bug) unfixed. This version targets each occurrence by its own unique
-- surrounding context (verified via a `~` / occurrence-count check immediately before each edit, so it
-- fails loudly instead of silently touching the wrong text again) and fixes the gate clause correctly
-- with explicit parens to preserve AND/OR precedence.
--
-- Same 2 P0 bugs as before:
-- (1) p_rent_period wasn't gated on deal_ar='إيجار' -- Monthly ('شهري') combined with Buy ('بيع') requires
--     payment_monthly=true, which no Buy row ever has, silently zeroing 100% of real Buy results.
-- (2) p_cities/p_districts/p_platforms/p_beds_exact each treated an empty array `[]` as an active
--     "match nothing" filter instead of a no-op, unlike p_amenities=[] which is already safe.

do $mig$
declare
  fn text;
  d text;
  n int;
begin
  foreach fn in array array['public.location_search_candidates_ar', 'public.property_age_option_counts_ar']
  loop
    d := pg_get_functiondef(fn::regproc);

    -- (1) rent_period must be a no-op for any non-Rent row. Appears exactly once (not inside the gate).
    n := (length(d) - length(replace(d, 'p_rent_period is null', ''))) / length('p_rent_period is null');
    if n <> 1 then
      raise exception 'REFUSING (%): expected exactly 1 occurrence of "p_rent_period is null", found %.', fn, n;
    end if;
    d := replace(d, 'p_rent_period is null', 'p_rent_period is null' || chr(10) || '           or s.deal_ar <> ''إيجار''');

    -- (2) the production_ready-visibility gate: fix BOTH p_cities and p_districts here in one shot,
    --     with explicit parens so AND/OR precedence stays correct. This exact compound literal appears
    --     exactly once (verified above before writing this migration).
    n := (length(d) - length(replace(d, 'p_cities is null and p_districts is null and p_region_ids is null', '')))
         / length('p_cities is null and p_districts is null and p_region_ids is null');
    if n <> 1 then
      raise exception 'REFUSING (%): expected exactly 1 occurrence of the production_ready gate clause, found %.', fn, n;
    end if;
    d := replace(
      d,
      'p_cities is null and p_districts is null and p_region_ids is null',
      '(p_cities is null or cardinality(p_cities) = 0) and (p_districts is null or cardinality(p_districts) = 0) and p_region_ids is null'
    );

    -- (3) p_cities' OWN filter clause (distinct from the gate above -- this one is followed by
    --     "or normalize_ar(...)", which the gate occurrence never is).
    if d !~ 'p_cities\s+is null\s*\n\s*or normalize_ar' then
      raise exception 'REFUSING (%): expected p_cities filter-clause anchor not found.', fn;
    end if;
    d := regexp_replace(d, '(p_cities\s+is null)(\s*\n\s*or normalize_ar)', 'p_cities is null or cardinality(p_cities) = 0\2');

    -- (4) p_districts' OWN filter clause (distinct from the gate above -- this one is followed by
    --     "or norm_district_tok", which the gate occurrence never is).
    if d !~ 'p_districts\s+is null or norm_district_tok' then
      raise exception 'REFUSING (%): expected p_districts filter-clause anchor not found.', fn;
    end if;
    d := regexp_replace(d, 'p_districts\s+is null or norm_district_tok', 'p_districts is null or cardinality(p_districts) = 0 or norm_district_tok');

    -- (5) p_platforms: only ever appears once (no gate collision) -- confirmed before writing this migration.
    if d !~ 'p_platforms\s+is null or s\.platform' then
      raise exception 'REFUSING (%): expected p_platforms filter-clause anchor not found.', fn;
    end if;
    d := regexp_replace(d, 'p_platforms\s+is null or s\.platform', 'p_platforms is null or cardinality(p_platforms) = 0 or s.platform');

    -- (6) p_beds_exact: only ever appears once each for "is null" / "is not null" (no gate collision).
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
