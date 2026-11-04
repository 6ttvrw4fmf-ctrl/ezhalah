-- city_resolution_ignores_region: the structural limb judges RESOLVERS, not every body that mentions a city name (alert 9920).
--
-- WHY. The limb flagged any function/view whose text mentions loc_catalog_city AND «city_norm» (or normalize_ar(…city…))
-- but not loc_catalog_region. Since 2026-10-18 it has held three objects open that resolve nothing:
--   * trg_city_list_guard     — the catalogue's own insert/update guard; it ASSIGNS new.city_norm := normalize_ar(new.city_ar);
--   * unknown_named_districts — collects every city name to EXCLUDE from district candidates (select cc.city_norm as v …);
--   * build_welcome_insights  — strips «حي»/«ال» off c.city_norm to keep a city name out of a district list (… not in (…)).
-- None of them turns a listing's city NAME into a city_id, which is the only thing the invariant («resolve the city WITHIN
-- the published region») is about. A detector that cannot tell a resolver from a mention reads a standing P1 forever.
--
-- WHAT. A resolver COMPARES a city name: «city_norm = …», «city_norm in (…)», «… = x.city_norm», «normalize_ar(x.city…) = …»
-- or «… = normalize_ar(x.city…)». The limb now requires one of those shapes. Proven both ways below against the three
-- bodies above (now clear) and against a global-uniqueness resolver (still caught). Nothing is exempted or baselined:
-- ops_city_resolution_exempt is untouched, and every exempt resolver still matches the new shape (measured 9/9).
do $mig$
declare
  d text := pg_get_functiondef('public.mon_detect_city_resolution_ignores_region()'::regprocedure);
  a_old constant text := $o$    and (o.body ~* 'city_norm' or o.body ~* 'normalize_ar\s*\(\s*[a-z0-9_.]*city')$o$;
  a_new constant text := $n$    -- a RESOLVER compares a city NAME (alert 9920): a mere mention, assignment or exclusion list is not one
    and (o.body ~* 'city_norm\s*(=|\s+in\s*\()'
         or o.body ~* '=\s*\(?\s*[a-z0-9_.]*city_norm'
         or o.body ~* 'normalize_ar\s*\(\s*[a-z0-9_.]*city[a-z0-9_]*\s*\)\s*\)?\s*(=|\s+in\s*\()'
         or o.body ~* '=\s*\(?\s*normalize_ar\s*\(\s*[a-z0-9_.]*city')$n$;
  shape constant text[] := array[
    'city_norm\s*(=|\s+in\s*\()',
    '=\s*\(?\s*[a-z0-9_.]*city_norm',
    'normalize_ar\s*\(\s*[a-z0-9_.]*city[a-z0-9_]*\s*\)\s*\)?\s*(=|\s+in\s*\()',
    '=\s*\(?\s*normalize_ar\s*\(\s*[a-z0-9_.]*city'];
  f text; hit boolean; p text;
begin
  if position(a_old in d) = 0 then
    raise exception 'mon_detect_city_resolution_ignores_region: structural predicate anchor not found';
  end if;
  execute replace(d, a_old, a_new);
  if position($q$city_norm\s*(=|\s+in\s*\()$q$ in pg_get_functiondef('public.mon_detect_city_resolution_ignores_region()'::regprocedure)) = 0 then
    raise exception 'mon_detect_city_resolution_ignores_region: patch did not land';
  end if;

  -- PROOF 1: the three live non-resolvers do not match the resolver shape.
  foreach f in array array['trg_city_list_guard', 'unknown_named_districts', 'build_welcome_insights'] loop
    select pg_get_functiondef(p2.oid) into p from pg_proc p2 where p2.proname = f and p2.pronamespace = 'public'::regnamespace limit 1;
    if p is null then raise exception 'PROOF: % not found', f; end if;
    select bool_or(p ~* s) into hit from unnest(shape) s;
    if hit then raise exception 'PROOF: % still reads as a resolver', f; end if;
  end loop;

  -- PROOF 2: a global-uniqueness resolver (the run #29 shape) and a normalize_ar comparison are still caught.
  select bool_or($b$select c.city_id from public.loc_catalog_city c where c.city_norm = normalize_ar(x.city_ar) limit 1$b$ ~* s)
    into hit from unnest(shape) s;
  if not hit then raise exception 'PROOF: a name-only city lookup is no longer caught'; end if;
  select bool_or($b$join public.loc_catalog_city cc on normalize_ar(cc.city_ar) = normalize_ar(l.city_ar)$b$ ~* s)
    into hit from unnest(shape) s;
  if not hit then raise exception 'PROOF: a normalize_ar city join is no longer caught'; end if;

  -- PROOF 3: every exempt resolver still matches (the exemption, not blindness, is what keeps it quiet).
  if exists (
    select 1 from public.ops_city_resolution_exempt e
      join pg_proc p3 on p3.proname = e.object_name and p3.pronamespace = 'public'::regnamespace and p3.prokind = 'f'
     where e.object_name <> 'search_cities_ar'
       and not exists (select 1 from unnest(shape) s where pg_get_functiondef(p3.oid) ~* s)) then
    raise exception 'PROOF: an exempt resolver function no longer matches the resolver shape';
  end if;
end
$mig$;
