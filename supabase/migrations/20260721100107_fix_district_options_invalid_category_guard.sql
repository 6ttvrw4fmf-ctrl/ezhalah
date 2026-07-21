-- Fix P3 found in the 2026-07-20 post-deploy Filter QA sweep: district_options_ar's p_category
-- predicate (`p_category IS NULL OR EXISTS (... k.macro = p_category OR k.macro = 'both' ...)`) never
-- validates p_category itself -- an unrecognized string (a typo, or a future enum value) still matches
-- every district-type row whose known_type_ar.macro='both' (عمارة/غير معروف), silently returning a
-- small-but-plausible-looking non-zero district list instead of erroring or falling back to the
-- unscoped/global ranking. Confirmed live: p_category='garbage' returned a full 374-row catalog with
-- non-zero counts that matched neither the NULL/global ranking nor Residential nor Commercial.
-- Not reachable today (the client's Category TypeScript type is a strict union), but worth closing at
-- the RPC layer for any other/future caller.
--
-- Fix: normalize p_category to NULL whenever it isn't exactly 'Residential' or 'Commercial', via a new
-- CTE referenced everywhere the raw parameter was used inside the query -- so an invalid value falls
-- back to the same honest global ranking a NULL p_category already produces, rather than a misleadingly
-- non-empty "both"-only result.

do $mig$
declare
  d text;
  n int;
begin
  d := pg_get_functiondef('public.district_options_ar'::regproc);

  -- (1) inject a normalizing CTE right after the opening WITH.
  n := (length(d) - length(replace(d, 'WITH live AS (', ''))) / length('WITH live AS (');
  if n <> 1 then
    raise exception 'REFUSING: expected exactly 1 occurrence of "WITH live AS (", found %.', n;
  end if;
  d := replace(
    d,
    'WITH live AS (',
    'WITH valid_category AS (' || chr(10)
      || '    SELECT CASE WHEN p_category IN (''Residential'',''Commercial'') THEN p_category ELSE NULL END AS v' || chr(10)
      || '  ),' || chr(10)
      || '  live AS ('
  );

  -- (2) cross-join valid_category into the live CTE's FROM clause.
  n := (length(d) - length(replace(d, 'FROM public.search_listings_ar s', ''))) / length('FROM public.search_listings_ar s');
  if n <> 1 then
    raise exception 'REFUSING: expected exactly 1 occurrence of the live CTE''s FROM clause, found %.', n;
  end if;
  d := replace(d, 'FROM public.search_listings_ar s', 'FROM public.search_listings_ar s, valid_category');

  -- (3) reference the normalized value instead of the raw parameter.
  n := (length(d) - length(replace(d, 'p_category IS NULL OR EXISTS', ''))) / length('p_category IS NULL OR EXISTS');
  if n <> 1 then
    raise exception 'REFUSING: expected exactly 1 occurrence of "p_category IS NULL OR EXISTS", found %.', n;
  end if;
  d := replace(d, 'p_category IS NULL OR EXISTS', 'valid_category.v IS NULL OR EXISTS');

  n := (length(d) - length(replace(d, 'k.macro = p_category OR k.macro = ''both''', '')))
       / length('k.macro = p_category OR k.macro = ''both''');
  if n <> 1 then
    raise exception 'REFUSING: expected exactly 1 occurrence of the macro-match clause, found %.', n;
  end if;
  d := replace(d, 'k.macro = p_category OR k.macro = ''both''', 'k.macro = valid_category.v OR k.macro = ''both''');

  execute d;
end
$mig$;

notify pgrst, 'reload schema';
