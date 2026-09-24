-- The shared eligibility clause caps p_tables at 200 elements; the app now sends 207.
--
-- 20260814215954 added cardinality caps to af_eligibility_clause() so an oversized array cannot be
-- used as anon-callable DoS: over the cap the predicate fails CLOSED — an honest zero. That cap was
-- sized for the fleet of the day. The 2026-09-24 batch (20260924170648) took the searchable scope to
-- 207 tables, and src/data/remote.ts SEARCHABLE_TABLES — the explicit scope every count surface and
-- the results RPC share (the 2026-09-03 الهفوف class: a surface called WITHOUT p_tables while the
-- results were called WITH it) — now carries 207. So every scoped surface answered zero: the built
-- app's smoke journey (web-runtime-smoke, run 36033420002) could not confirm a city, and the
-- Advanced Filter never opened. main still sends 137 and passes; this is a cap, not a data defect.
--
-- p_tables goes to 500: the DoS bound stays (p_districts already sits at 500; 600 elements still
-- fail closed below) with headroom for ~150 more platforms. Nothing else in the clause changes.
-- Same mechanism as 20260814215954: the canonical clause text is edited under an occurrence
-- assertion, re-created, and rebuild_af_filter_rpcs() re-renders every RPC that inlines it from
-- af_rpc_templates (it refuses, before any DDL, if a rebuild would revert behaviour). The function
-- mirror sql/mirrors/af_eligibility_clause.sql is regenerated from pg_get_functiondef in the same
-- change.
do $do$
declare
  c text := af_eligibility_clause();
  cap_old text := $x$      and coalesce(cardinality(p_tables), 0)    <= 200$x$;
  cap_new text := $x$      and coalesce(cardinality(p_tables), 0)    <= 500$x$;
  occ int; n_still int; n_scope int; n_rows int; n_dos int;
  real_scope text[];
begin
  occ := (length(c) - length(replace(c, cap_old, ''))) / nullif(length(cap_old), 0);
  if occ <> 1 then
    raise exception 'ABORT: the p_tables cap line occurs % times in af_eligibility_clause, expected 1', occ;
  end if;
  c := replace(c, cap_old, cap_new);
  execute format('create or replace function public.af_eligibility_clause() returns text language sql immutable as $fn$ select %L::text $fn$', c);
  perform * from public.rebuild_af_filter_rpcs();

  -- every public function that inlines the cap now carries 500; none still carries 200
  select count(*) into n_still
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prosrc like '%cardinality(p_tables), 0)    <= 200%';
  if n_still <> 0 then
    raise exception 'ABORT: % public function(s) still carry the 200 cap after the rebuild', n_still;
  end if;

  -- the app's REAL scope — every table search_listings_ar reads, padded past 200 — answers…
  select array_agg(distinct source_table) into real_scope from public.search_listings_ar;
  real_scope := real_scope || (select array_agg('pad_' || g || '_listings') from generate_series(1, 100) g);
  n_scope := cardinality(real_scope);
  if n_scope <= 200 then
    raise exception 'ABORT: the probe scope has only % tables; it must exceed the old cap to prove anything', n_scope;
  end if;
  select count(*) into n_rows
    from public.location_search_candidates_ar(p_deal := 'إيجار', p_cities := array['الرياض'],
                                              p_tables := real_scope, p_limit := 1);
  if n_rows = 0 then
    raise exception 'ABORT: location_search_candidates_ar still answers zero for a %-table scope', n_scope;
  end if;
  -- …and an absurd array still fails CLOSED
  select public.af_eligible_count(p_deal := 'إيجار', p_rent_period := 'سنوي', p_types := array['شقة'],
                                  p_cities := array['الرياض'], p_category := 'Residential',
                                  p_tables := (select array_agg('pad_' || g || '_listings') from generate_series(1, 600) g))
    into n_dos;
  if n_dos <> 0 then
    raise exception 'ABORT: a 600-element p_tables did not fail closed (got %)', n_dos;
  end if;
  raise notice 'SUCCESS: p_tables cap 500 on every clause surface; a %-table scope answers (% row), 600 fails closed', n_scope, n_rows;
end $do$;
