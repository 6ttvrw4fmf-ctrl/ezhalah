-- CORRECTIVE RE-APPLICATION: a concurrent session's migration (20260721100453_trending_period_scope,
-- applied ~4 minutes after fix_district_options_invalid_category_guard) did
-- `DROP FUNCTION district_options_ar(integer,text,text)` + `CREATE FUNCTION` with a 4th
-- p_payment_monthly parameter, built from a body snapshot that predated the category-validation fix --
-- unintentionally reverting it (confirmed live: p_category='garbage' had gone back to matching only
-- the macro='both' rows instead of the honest global ranking). This project's own concurrent-session
-- incident history (2026-07-15/16) is exactly this class of collision. Re-applying the identical fix
-- logic to the NEW 4-arg signature -- p_payment_monthly is untouched, added alongside p_deal/p_category
-- with no interaction with the category-validation CTE.

do $mig$
declare
  d text;
  n int;
begin
  d := pg_get_functiondef('public.district_options_ar'::regproc);

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

  n := (length(d) - length(replace(d, 'FROM public.search_listings_ar s', ''))) / length('FROM public.search_listings_ar s');
  if n <> 1 then
    raise exception 'REFUSING: expected exactly 1 occurrence of the live CTE''s FROM clause, found %.', n;
  end if;
  d := replace(d, 'FROM public.search_listings_ar s', 'FROM public.search_listings_ar s, valid_category');

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
