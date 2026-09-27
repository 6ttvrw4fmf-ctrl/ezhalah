-- THE GUARD ON THE REBUILD WAS COLUMN-GRANULAR, AND TWO OF THE THREE SHIPPED EDITS WERE INVISIBLE
-- TO IT (routine-5-af-trending, 2026-09-27).
--
-- af_rebuild_would_revert() is the fail-closed gate INSIDE rebuild_af_filter_rpcs(): it exists so
-- the sanctioned rebuild cannot silently delete behaviour the live functions carry. It compared
-- ONE thing — search_listings_ar column names present in the live definition but absent from the
-- rendered template. Measured against the three semantic edits that were live this morning:
--
--   district_norm_tok        (district_options_ar)    CAUGHT     — it is a column name
--   cohort as MATERIALIZED   (top_cities_by_deal_ar)  NOT CAUGHT — no column changes
--   coalesce(c,0)>=0 -> c is null or c>=0  (both)     NOT CAUGHT — same columns, different shape
--
-- So the gate that exists to stop a silent revert would have permitted one. Port only the column
-- it names, run the rebuild it then allows, and the MATERIALIZED hint (406ms -> 299ms) and the
-- stats-friendly predicate would both have been dropped — and af_rpc_build_state would have
-- recorded the reverted definition as correct, so mon_af_predicate_parity() would read GREEN on
-- the regression. A guard that is 1-for-3 on the very incident it was written for is a pointer
-- reading as coverage (BARRIER_ENGINEER.md PART 1.11).
--
-- THE WIDENING. The gate now also refuses on a WHOLE-DEFINITION divergence, which needs no list of
-- semantics anyone has to remember to extend. The predicate is deliberately two-limbed, because
-- "live differs from rendered" alone is wrong in both directions:
--
--   rendered <> live  AND  live md5 <> af_rpc_build_state  ->  REFUSE
--
-- The second limb is what distinguishes a hand-edit from an intended change, and what keeps the
-- rail usable:
--   * someone edited a live function outside the rebuild and did NOT port it  -> both true, REFUSE
--     (this is 2026-09-26, and it is the case the column check missed twice)
--   * the same edit AFTER it is ported into the templates -> rendered = live, ALLOWED, and the
--     rebuild re-stamps build_state. Without this, porting could never be completed — the guard
--     would deadlock the only mechanism that clears it.
--   * a deliberate af_eligibility_clause() change with no hand-edit -> live = built, ALLOWED. The
--     rebuild is SUPPOSED to change the functions; that is what it is for.
--
-- Whitespace-normalised and case-folded because pg_get_functiondef re-serialises the CREATE it was
-- handed. Measured on the four never-hand-edited RPCs at the time of writing: the ONLY delta
-- between rendered and live was a single trailing newline on af_eligible_count. Without the
-- normalisation this guard would be permanently, uselessly red — the state that teaches everyone
-- to scroll past the kind.
--
-- The column limb is KEPT, unchanged and unconditional. It names WHICH semantic would be lost,
-- which the whole-definition limb cannot, and weakening an existing guard is not on the table.

-- The predicate is its own function so the self-test below can EXECUTE it against injected inputs
-- rather than restate it. A barrier over a COPY of the rule is the failure mode this repo has been
-- burned by repeatedly: every one of the 2026-09-04 defects had a source-text tripwire over the
-- exact line, and every one of them passed for as long as the defect was live.
create or replace function public.af_rebuild_revert_predicate(
  p_live text, p_rendered text, p_live_md5 text, p_built_md5 text)
 returns boolean
 language sql
 immutable
as $function$
  select btrim(regexp_replace(lower(p_rendered), '\s+', ' ', 'g'))
      is distinct from
         btrim(regexp_replace(lower(p_live),     '\s+', ' ', 'g'))
     and (p_built_md5 is null or p_live_md5 is distinct from p_built_md5);
$function$;

create or replace function public.af_rebuild_would_revert()
 returns table(o_fn_name text, o_dropped text[])
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  with cols as (
    -- >= 6 chars: short attribute names ('id', 'city') appear inside unrelated identifiers and
    -- would make this noisy. Every semantic column this guard exists for is far longer.
    select a.attname::text as c
      from pg_attribute a
     where a.attrelid = 'public.search_listings_ar'::regclass
       and a.attnum > 0
       and not a.attisdropped
       and length(a.attname::text) >= 6
  ),
  fns as (
    select t.fn_name,
           pg_get_functiondef(p.oid)      as live,
           md5(pg_get_functiondef(p.oid)) as live_md5,
           bs.def_md5                     as built_md5,
           replace(t.template, '__AF_ELIGIBILITY_WHERE__', public.af_eligibility_clause()) as rendered
      from public.af_rpc_templates t
      join pg_proc p on p.proname = t.fn_name and p.prokind = 'f'
      join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'public'
      left join public.af_rpc_build_state bs on bs.fn_name = t.fn_name
  ),
  findings as (
    select f.fn_name, c.c as item
      from fns f
      join cols c on position(c.c in f.live) > 0 and position(c.c in f.rendered) = 0
    union all
    select f.fn_name,
           'WHOLE-DEFINITION DIVERGENCE — live was edited outside rebuild_af_filter_rpcs() (live md5 '
             || left(f.live_md5, 12) || ' <> built ' || left(coalesce(f.built_md5, '(never built)'), 12)
             || ') and af_eligibility_clause()/af_rpc_templates do not reproduce that edit, so a '
             || 'rebuild would revert it' as item
      from fns f
     where public.af_rebuild_revert_predicate(f.live, f.rendered, f.live_md5, f.built_md5)
  )
  select fn_name, array_agg(item order by item)
    from findings
   group by fn_name;
$function$;

-- THE MUTATION PROOF, run at apply time and kept as a callable so it can be re-run (§G.9.4).
-- Scenario 2 is the exact shape the column-granular guard missed on 2026-09-26: a MATERIALIZED
-- hint present live and absent from the render, with no column difference whatsoever.
create or replace function public.mon_selftest_af_rebuild_revert_predicate()
 returns integer
 language plpgsql
 stable
as $function$
declare
  bad text[] := array[]::text[];
begin
  -- 1. CLEAN: generator and production agree, nothing hand-edited.
  if public.af_rebuild_revert_predicate('select 1', 'select 1', 'aaa', 'aaa') <> false then
    bad := bad || 'clean state must not refuse';
  end if;

  -- 2. THE 2026-09-26 DEFECT, and the one the column check could not see: a MATERIALIZED hint live,
  --    absent from the render, zero column difference, and a hand-edited md5.
  if public.af_rebuild_revert_predicate(
       'with cohort as materialized (select 1) select * from cohort',
       'with cohort as (select 1) select * from cohort',
       'live1', 'built1') <> true then
    bad := bad || 'an unported MATERIALIZED hint must refuse the rebuild';
  end if;

  -- 2b. Same shape for a predicate rewrite that changes no column name.
  if public.af_rebuild_revert_predicate(
       'where (s.area_m2 is null or s.area_m2 >= 0)',
       'where coalesce(s.area_m2, 0) >= 0',
       'live2', 'built2') <> true then
    bad := bad || 'an unported predicate rewrite must refuse the rebuild';
  end if;

  -- 3. PORTED: the same hand-edit after it reaches the templates. Must ALLOW, or porting could
  --    never be completed and the guard would deadlock the rail.
  if public.af_rebuild_revert_predicate(
       'with cohort as materialized (select 1) select * from cohort',
       'with cohort as materialized (select 1) select * from cohort',
       'live1', 'built1') <> false then
    bad := bad || 'a ported edit must be allowed so the rebuild can re-stamp build_state';
  end if;

  -- 4. INTENDED: a deliberate clause change, nothing hand-edited. The rebuild exists to apply it.
  if public.af_rebuild_revert_predicate('old body', 'new body', 'same', 'same') <> false then
    bad := bad || 'an intended clause change must not be refused';
  end if;

  -- 5. RE-SERIALISATION TOLERANCE: whitespace/case only, with a differing md5. Must ALLOW, else the
  --    guard is permanently red on pg_get_functiondef's own formatting.
  if public.af_rebuild_revert_predicate('SELECT   1' || chr(10), 'select 1', 'x', 'y') <> false then
    bad := bad || 'whitespace/case-only reformatting must not refuse';
  end if;

  -- 6. NEVER BUILT: no build_state row is not a licence to revert.
  if public.af_rebuild_revert_predicate('live body', 'other body', 'x', null) <> true then
    bad := bad || 'a function with no build_state row must refuse on divergence';
  end if;

  if cardinality(bad) > 0 then
    raise exception 'af_rebuild_revert_predicate self-test FAILED: %', array_to_string(bad, ' | ');
  end if;
  return 0;
end
$function$;

do $selftest$
declare n int; v_roster int;
begin
  -- The predicate behaves correctly on all seven injected scenarios.
  perform public.mon_selftest_af_rebuild_revert_predicate();

  -- And the widened guard is quiet on production RIGHT NOW (the repair migration
  -- 20260927111536 brought the generator level with the live functions).
  select count(*) into n from public.af_rebuild_would_revert();
  if n <> 0 then
    raise exception 'widened af_rebuild_would_revert() is non-empty on a repaired tree: % row(s)', n;
  end if;

  -- A detector nothing reaches is decoration: the roster must still call the wrapper.
  select count(*) into v_roster
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname = 'mon_run_all_detectors'
     and p.prosrc like '%mon_detect_af_rebuild_would_revert%';
  if v_roster < 1 then
    raise exception 'mon_detect_af_rebuild_would_revert is not reached by mon_run_all_detectors()';
  end if;
end
$selftest$;

comment on function public.af_rebuild_revert_predicate(text, text, text, text) is
  'Pure predicate behind af_rebuild_would_revert(): would a rebuild REVERT a live edit? True only '
  'when the render differs from live AND live has been edited outside the rebuild (md5 <> '
  'af_rpc_build_state). Exposed as its own function so mon_selftest_af_rebuild_revert_predicate() '
  'can execute it against injected inputs instead of restating it. routine-5, 2026-09-27.';

-- ---------------------------------------------------------------------------------------------
-- ONE CHARACTER OF THIS FILE DIFFERS FROM THE SQL PRODUCTION EXECUTED, DELIBERATELY.
-- The comment in the $selftest$ block above cites the repair migration as 20260927111536. The text
-- that actually ran cited ...1546. apply_migration mints the version server-side, and a concurrent
-- session's batch7_platform_registry took ...1546 in the same window, so the number written into
-- the comment seconds earlier was not the one the repair received.
-- It is corrected here rather than left verbatim because scripts/verify-migration-references-resolve.ts
-- requires every migration cited by another to exist in this repo, and ...1546 is another session's
-- migration — the barrier was RED on the verbatim text and was right to be. The divergence is a
-- cross-reference inside a comment; the executed SQL is otherwise byte-identical to production.
