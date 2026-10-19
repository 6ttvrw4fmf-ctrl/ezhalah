-- A DETECTOR'S CANDIDATE SET IS A BLIND SPOT NOBODY MEASURES (ops_incident #391, routine #10).
--
-- THE CLASS. A detector whose CANDIDATE SET is filtered before its predicate ever runs is blind to
-- a whole class by construction, and reads as a clean bill of health: the predicate is correct, the
-- WHERE that chooses what the predicate is applied to silently excludes a class, and nothing is ever
-- wrong because nothing in that class is ever looked at. A mutation planted INSIDE the candidate set
-- proves nothing about the class outside it, so this shape survives mutation proofs.
--
-- THE INSTANCE THIS GUARDS. mon_detect_unresolvable_detector() asks "which detectors can OPEN an
-- alert and never CLOSE one". Its candidate set is `p.prosrc ~* 'mon_raise'`. Measured 2026-09-22
-- and again 2026-09-23: 239 of 239 mon_detect_* functions are inside it, so it excludes ZERO today
-- and is NOT a live blind guard. It is ONE REFACTOR away from being one — the day a detector raises
-- through a wrapper whose name does not contain the literal text `mon_raise`, that detector leaves
-- the population SILENTLY and the check keeps reading clean. Nothing in the repo or the database
-- would have noticed.
--
-- WHAT THIS MIGRATION DOES, in three pieces:
--
--   1. mon_detector_raises(text)                      THE ONE definition of that candidate filter.
--                                                     IMMUTABLE, pure, inlines. Created so that the
--                                                     guard below cannot hold a COPY of the filter
--                                                     it is guarding — a copy drifts, and then the
--                                                     guard passes while production is blind, which
--                                                     is the same defect one layer up.
--
--   2. mon_detect_unresolvable_detector()             needle-edited off pg_get_functiondef of the
--                                                     LIVE body: the single predicate
--                                                     `p.prosrc ~* 'mon_raise'` becomes a call to
--                                                     (1). Semantically identical (prosrc is never
--                                                     NULL for the plpgsql/sql functions this name
--                                                     filter selects, and coalesce covers it
--                                                     anyway). NOTHING else in the body changed —
--                                                     same signature, so this is a replacement, not
--                                                     a new overload.
--
--   3. mon_detectors_outside_raise_candidate_set()    PURE, stable, anon-executable, and
--                                                     deliberately NOT named mon_detect_* — so it
--                                                     needs no roster entry, and adding it does not
--                                                     mean needle-editing mon_run_all_detectors(),
--                                                     the single function that runs all 239
--                                                     detectors. It returns the mon_detect_* names
--                                                     that fall OUTSIDE the candidate set, i.e. the
--                                                     detectors mon_detect_unresolvable_detector()
--                                                     will never look at. Today that is the empty
--                                                     array, and the repo barrier asserts exactly
--                                                     that plus both directions of the injection.
--
-- WHY INJECTION, AND WHY jsonb. This mirrors mon_orphaned_detectors(p_extra_candidates) exactly:
-- the guard must be executable against a candidate that does not exist in production, or it can only
-- ever confirm today's happy state. The membership test here is over a function's SOURCE, not its
-- name, so the injected candidate is a {name, src} pair and it goes through the SAME filter (1) as
-- the real rows. A missing `src` reads as NULL, which coalesces to '' and is therefore reported as
-- OUTSIDE — unknown is flagged, never silently called healthy (AGENTS.md: silent→NULL, never
-- unknown→NO).
--
-- WHERE IT IS WATCHED. scripts/verify-detector-candidate-set-is-not-blind-live.ts, homed in
-- .github/workflows/detector-candidate-set-check.yml per scripts/test-exclusions.txt. Its hermetic
-- twin scripts/verify-detector-candidate-set-is-not-blind.ts stays in the required `npm test` and
-- mutation-proves the judgement. The live half is NOT in `npm test` on purpose: its verdict is
-- decided by production's detector population, and PRODUCTION_DEPENDENT_CEILING is a shrink-only
-- ratchet this routine is forbidden to grow.

create or replace function public.mon_detector_raises(p_src text)
returns boolean
language sql
immutable
as $function$
  select coalesce(p_src, '') ~* 'mon_raise';
$function$;

comment on function public.mon_detector_raises(text) is
  'THE ONE definition of the raise candidate set used by mon_detect_unresolvable_detector(). Kept as '
  'a function so the guard mon_detectors_outside_raise_candidate_set() cannot hold a drifting COPY '
  'of the filter it exists to watch (ops_incident #391).';

-- Needle-edited off the LIVE body (pg_get_functiondef, 2026-09-23). ONE line changed.
create or replace function public.mon_detect_unresolvable_detector()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare n int := 0; bad text[];
begin
  select coalesce(array_agg(p.proname order by p.proname), '{}') into bad
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public'
     and p.proname like 'mon\_detect\_%'
     and public.mon_detector_raises(p.prosrc)          -- was: p.prosrc ~* 'mon_raise' (#391)
     and p.prosrc !~* '(mon_resolve|resolved_at\s*=\s*now\(\))';

  if cardinality(bad) > 0 then
    n := public.mon_raise('P2', 'unresolvable_detector', 'all', 'unresolvable_detector',
      jsonb_build_object('detectors', to_jsonb(bad), 'count', cardinality(bad),
        'why', 'These detectors can OPEN an alert and can never CLOSE one. Two consequences, and '
            || 'the second is the dangerous one: (1) a cleared condition reads as a standing P1 '
            || 'forever, corrupting the open_alerts signal section 11a relies on; (2) while the key sits '
            || 'open, mon_raise() returns 0 for a genuine RE-occurrence at the same severity, so '
            || 'the roster count stays 0 and nothing re-dispatches -- the bug class goes unpaged. '
            || 'FIX: call mon_resolve_stale_keys(kind, live_keys) on the detector''s EVALUATED path '
            || '(after any mon_claim_daily_slot early return), passing exactly the dedup keys this '
            || 'run re-raised. Never resolve on a path that did not evaluate the condition.'));
  else
    perform public.mon_resolve_key('unresolvable_detector', 'unresolvable_detector');
  end if;
  return n;
end $function$;

create or replace function public.mon_detectors_outside_raise_candidate_set(
  p_extra_sources jsonb default '[]'::jsonb
)
returns text[]
language sql
stable
security definer
set search_path to 'public'
as $function$
  select coalesce(array_agg(q.name order by q.name), '{}')
    from (
      select p.proname::text as name, p.prosrc as src
        from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
       where ns.nspname = 'public'
         and p.proname like 'mon\_detect\_%'
      union all
      select coalesce(e->>'name', '(injected source with no name)') as name,
             e->>'src' as src
        from jsonb_array_elements(coalesce(p_extra_sources, '[]'::jsonb)) e
    ) q
   where not public.mon_detector_raises(q.src);
$function$;

comment on function public.mon_detectors_outside_raise_candidate_set(jsonb) is
  'Returns the mon_detect_* names that fall OUTSIDE the candidate set of '
  'mon_detect_unresolvable_detector() — the detectors it will never look at. Empty is the healthy '
  'answer and the measured state (239 of 239 inside, 2026-09-23). p_extra_sources injects '
  '[{"name":..,"src":..}] through the SAME filter so the guard can be executed against a candidate '
  'production does not have. ops_incident #391, routine #10.';

grant execute on function public.mon_detectors_outside_raise_candidate_set(jsonb) to anon, authenticated;
grant execute on function public.mon_detector_raises(text) to anon, authenticated;
