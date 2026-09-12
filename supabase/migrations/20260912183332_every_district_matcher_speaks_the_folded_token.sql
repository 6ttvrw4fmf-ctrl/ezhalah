-- THE LAST PRE-FOLD DISTRICT MATCHERS (owner 2026-09-12: «should be applying for everything»).
-- After 20260912172542 folded district identity into norm_district_tok, several live objects still
-- matched districts the OLD way — either joining the FOLDED stored token
-- (loc_catalog_district.district_norm) against an UNFOLDED normalize_ar expression, or carrying
-- their own inline «regexp_replace(normalize_ar(x.district_ar), '^حي\s+','')» copy. Every one
-- silently failed to match the ء/ئ/digit/tashkeel twins:
--   * resolve_aqar_locations()      — hourly cron that WRITES district resolutions, matching the raw
--     source field normalize_ar(a.neighborhood): an aqar listing whose neighborhood reads «الصفاء»
--     never matched catalog «حي الصفا» and stayed district-less. USER-VISIBLE.
--   * resolve_dealapp_districts()   — same class via the EN-bridge join (also a writer).
--   * location_search_candidates2() — inline pre-fold copy in a SEARCH path.
--   * district_resolution_health(), location_pipeline_monitor() — false under-reporting (crons).
--   * location_selftest()           — inline pre-fold copy (hourly cron; would report phantoms).
-- Two generic needle edits; every function is asserted to have actually changed.
do $$
declare r record; def text; n int := 0;
  JOIN_RE  constant text := 'district_norm(\s*)=(\s*)normalize_ar\(([^()]*)\)';
  JOIN_REP constant text := 'district_norm\1=\2public.norm_district_tok(\3)';
  INLN_RE  constant text := $re$regexp_replace\(normalize_ar\(([a-z0-9_]+\.[a-z0-9_]+)\), '\^حي\\s\+', ''\)$re$;
  INLN_REP constant text := $rep$public.norm_district_tok(\1)$rep$;
begin
  for r in
    select p.oid, p.proname, pg_get_functiondef(p.oid) src
      from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
     where ns.nspname = 'public'
       and p.proname <> 'loc_classify'
       and (pg_get_functiondef(p.oid) ~ 'district_norm\s*=\s*normalize_ar'
         or pg_get_functiondef(p.oid) ~ INLN_RE)
  loop
    def := regexp_replace(regexp_replace(r.src, JOIN_RE, JOIN_REP, 'g'), INLN_RE, INLN_REP, 'g');
    if def = r.src then raise exception 'needle edit was a no-op on %()', r.proname; end if;
    execute def;
    n := n + 1;
    raise notice 're-pointed %', r.proname;
  end loop;
  if n < 5 then raise exception 'expected at least 5 objects re-pointed, did %', n; end if;
end $$;

-- PROOF: nothing live still matches districts pre-fold, and the repaired writers/monitors run clean.
do $$
declare leftover text;
begin
  select string_agg(p.proname, ', ') into leftover
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public'
     and p.proname <> 'loc_classify'
     and (pg_get_functiondef(p.oid) ~ 'district_norm\s*=\s*normalize_ar'
       or pg_get_functiondef(p.oid) ~ $re$regexp_replace\(normalize_ar\([a-z0-9_]+\.[a-z0-9_]+\), '\^حي\\s\+', ''\)$re$);
  if leftover is not null then raise exception 'still pre-fold: %', leftover; end if;

  -- run every repaired object once: writers are idempotent, monitors must not throw
  perform public.resolve_dealapp_districts();
  perform public.resolve_aqar_locations();
  perform public.location_selftest();
  perform public.location_pipeline_monitor();
  perform public.district_resolution_health();
end $$;