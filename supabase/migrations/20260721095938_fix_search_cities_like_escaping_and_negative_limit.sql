-- Fix 2 issues in search_cities_ar found in the 2026-07-20 post-deploy Filter QA sweep:
--
-- (1) P2: LIKE metacharacters (%, _) in the user-typed query weren't escaped before being embedded in
--     the `like '%' || v_norm || '%'` pattern, so typing a literal '%' or '_' matched EVERY row (SQL
--     wildcard semantics) instead of the honest empty result any other nonsense query correctly returns.
--     Confirmed live: p_query='%' and p_query='_' both returned the same 20 unrelated "top cities" as a
--     bare non-null query, instead of [].
-- (2) P3: a negative p_limit surfaced a raw Postgres error ("LIMIT must not be negative", SQLSTATE
--     2201W) instead of a clean, defensive response — not reachable by the shipped client (which only
--     ever sends 6 or 20), but worth guarding for any other caller.
--
-- Fix: escape backslash/%/_ in v_norm right after the existing tashkeel/hamza normalization (so the
-- escaping itself can never be bypassed by a query that also needs normalizing), add `escape '\'` to
-- both LIKE usages, and clamp p_limit to a sane non-negative floor (matching this codebase's existing
-- `greatest(p_offset, 0)` convention elsewhere).

do $mig$
declare
  d text;
  n int;
begin
  d := pg_get_functiondef('public.search_cities_ar'::regproc);

  -- (1a) insert the escaping step right after the existing hamza-fold line.
  n := (length(d) - length(replace(d, 'v_norm := translate(v_norm, ''أإآٱةى'', ''ااااهي''); -- fold hamza forms / taa marbuta / alef maksura', '')))
       / length('v_norm := translate(v_norm, ''أإآٱةى'', ''ااااهي''); -- fold hamza forms / taa marbuta / alef maksura');
  if n <> 1 then
    raise exception 'REFUSING: expected exactly 1 occurrence of the hamza-fold line, found %.', n;
  end if;
  d := replace(
    d,
    'v_norm := translate(v_norm, ''أإآٱةى'', ''ااااهي''); -- fold hamza forms / taa marbuta / alef maksura',
    'v_norm := translate(v_norm, ''أإآٱةى'', ''ااااهي''); -- fold hamza forms / taa marbuta / alef maksura' || chr(10)
      || '    v_norm := replace(replace(replace(v_norm, ''\'', ''\\''), ''%'', ''\%''), ''_'', ''\_''); -- escape LIKE metachars so a literal %/_ in the query never acts as a wildcard'
  );

  -- (1b) add escape clause to the main filter LIKE.
  n := (length(d) - length(replace(d, 'lc.city_norm like ''%'' || v_norm || ''%''', ''))) / length('lc.city_norm like ''%'' || v_norm || ''%''');
  if n <> 1 then
    raise exception 'REFUSING: expected exactly 1 occurrence of the main filter LIKE, found %.', n;
  end if;
  d := replace(d, 'lc.city_norm like ''%'' || v_norm || ''%''', 'lc.city_norm like ''%'' || v_norm || ''%'' escape ''\''');

  -- (1c) add escape clause to the prefix-match ranking LIKE.
  n := (length(d) - length(replace(d, 'lc.city_norm like v_norm || ''%''', ''))) / length('lc.city_norm like v_norm || ''%''');
  if n <> 1 then
    raise exception 'REFUSING: expected exactly 1 occurrence of the prefix-ranking LIKE, found %.', n;
  end if;
  d := replace(d, 'lc.city_norm like v_norm || ''%''', 'lc.city_norm like v_norm || ''%'' escape ''\''');

  -- (2) clamp a negative p_limit to 0 instead of letting it hit Postgres' own LIMIT validation.
  n := (length(d) - length(replace(d, 'v_limit := coalesce(p_limit, case when v_norm is null then 6 else 20 end);', '')))
       / length('v_limit := coalesce(p_limit, case when v_norm is null then 6 else 20 end);');
  if n <> 1 then
    raise exception 'REFUSING: expected exactly 1 occurrence of the v_limit assignment, found %.', n;
  end if;
  d := replace(
    d,
    'v_limit := coalesce(p_limit, case when v_norm is null then 6 else 20 end);',
    'v_limit := coalesce(p_limit, case when v_norm is null then 6 else 20 end);' || chr(10) || '  v_limit := greatest(v_limit, 0);'
  );

  execute d;
end
$mig$;

notify pgrst, 'reload schema';
