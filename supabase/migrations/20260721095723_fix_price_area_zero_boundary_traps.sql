-- Fix the "0 = no-limit" boundary bug (P1: p_price_max/p_area_max=0; P2: p_price_min/p_area_min=0)
-- found in the 2026-07-20 post-deploy Filter QA sweep, in both location_search_candidates_ar and
-- property_age_option_counts_ar. This project's own documented convention is "0 = no-limit" for price
-- (and, per the QA finding's reasoning, area follows the same logic) -- but the live SQL never actually
-- implemented that: any explicit 0 was passed straight through arithmetic/null-checks as a literal
-- boundary value instead of being treated as "unset".
--
-- Two distinct sub-bugs, same root cause (COALESCE/IS NULL only special-case NULL, not 0):
--   (1) p_price_max=0 / p_area_max=0: coalesce(p_price_max,1e15) evaluates to 0 (not 1e15) when the
--       input is a literal 0, since coalesce only substitutes on NULL. An upper bound of 0 excludes
--       every real listing (price/area can't be <=0), silently zeroing 100% of results.
--   (2) p_price_min=0 / p_area_min=0: passing an explicit 0 activates the STRICT "price/area must be
--       non-null and positive" branch (since it's no longer NULL), excluding listings with missing/
--       invalid price or area that the true unfiltered baseline includes -- inconsistent with omitting
--       the parameter entirely.
--
-- Fix: wrap every one of these 4 params with nullif(param, 0) so a literal 0 is treated exactly the
-- same as NULL everywhere it's checked/used. Verified before writing: each anchor below occurs exactly
-- once per function, except `coalesce(p_price_max,1e15)` which occurs exactly twice (Buy branch + Rent
-- branch, byte-identical text, both requiring the identical fix) -- global replace is correct there.

do $mig$
declare
  fn text;
  d text;
  n int;
begin
  foreach fn in array array['public.location_search_candidates_ar', 'public.property_age_option_counts_ar']
  loop
    d := pg_get_functiondef(fn::regproc);

    -- (1) the combined "no price filter at all" gate: treat 0+0 (or 0+null, null+0) the same as null+null.
    n := (length(d) - length(replace(d, 'p_price_min is null and p_price_max is null', '')))
         / length('p_price_min is null and p_price_max is null');
    if n <> 1 then
      raise exception 'REFUSING (%): expected exactly 1 occurrence of the price null-check, found %.', fn, n;
    end if;
    d := replace(d, 'p_price_min is null and p_price_max is null', 'nullif(p_price_min,0) is null and nullif(p_price_max,0) is null');

    -- (2) price_max upper-bound coalesce: appears twice (Buy + Rent branches), both need the same fix.
    n := (length(d) - length(replace(d, 'coalesce(p_price_max,1e15)', ''))) / length('coalesce(p_price_max,1e15)');
    if n <> 2 then
      raise exception 'REFUSING (%): expected exactly 2 occurrences of coalesce(p_price_max,1e15), found %.', fn, n;
    end if;
    d := replace(d, 'coalesce(p_price_max,1e15)', 'coalesce(nullif(p_price_max,0),1e15)');

    -- (3) area_min lower-bound null-check.
    n := (length(d) - length(replace(d, 'p_area_min is null or', ''))) / length('p_area_min is null or');
    if n <> 1 then
      raise exception 'REFUSING (%): expected exactly 1 occurrence of the area_min null-check, found %.', fn, n;
    end if;
    d := replace(d, 'p_area_min is null or', 'nullif(p_area_min,0) is null or');

    -- (4) area_max upper-bound null-check.
    n := (length(d) - length(replace(d, 'p_area_max is null or', ''))) / length('p_area_max is null or');
    if n <> 1 then
      raise exception 'REFUSING (%): expected exactly 1 occurrence of the area_max null-check, found %.', fn, n;
    end if;
    d := replace(d, 'p_area_max is null or', 'nullif(p_area_max,0) is null or');

    execute d;
  end loop;
end
$mig$;

notify pgrst, 'reload schema';
