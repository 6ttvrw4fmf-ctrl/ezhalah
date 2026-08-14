-- Close the three FAIL-OPEN paths in the shared eligibility clause (pre-certification hardening,
-- 2026-08-15). None is reachable from today's Filter UI, but each is a live parameter on all four
-- public anon RPC surfaces, and "not reachable today" is exactly how the previous fail-open bugs
-- (PR#78 platform-widening, the district cross-city fuse) shipped. Cohort under certification:
-- إيجار → سنوي → شقة.
--
-- 1. BATHROOMS exact+min: p_bath_exact silently VOIDED p_bath_min — a user-supplied constraint with
--    no effect on results OR counts, and the only proven widening path in the clause
--    (p_bath_min=3 → 1,025; + p_bath_exact={1,2} → 1,544, LARGER). The bedrooms clause with the same
--    shape UNIONs. Make bathrooms symmetric with bedrooms so one shape has one meaning.
-- 2. SCOPE-B type leak: the p_tables2 branch admitted ANY type when p_types2 was NULL — the pairing
--    invariant lived only in a TypeScript ternary. Live proof: p_tables2=<31 commercial tables> with
--    p_types2 null returned 2 مزرعة (farm) rows inside a p_types=['شقة'] apartment search. Require
--    the pairing in SQL: no p_types2 → the scope-B branch contributes nothing.
-- 3. CARDINALITY CAP: an oversized array param is anon-callable DoS (20k-element p_districts → HTTP
--    500 after 21s of DB time; this project has already had one stress-induced outage). Cap the
--    location/type/platform arrays; over the cap the predicate fails CLOSED (honest zero), never open.
do $do$
declare
  c text := af_eligibility_clause();
  bath_old text := $x$      and ((coalesce(cardinality(p_bath_exact),0) = 0 and p_bath_min is null)
           or (coalesce(cardinality(p_bath_exact),0) > 0 and s.bathrooms = any(p_bath_exact))
           or (coalesce(cardinality(p_bath_exact),0) = 0 and p_bath_min is not null and s.bathrooms is not null and s.bathrooms >= p_bath_min))$x$;
  bath_new text := $x$      and ((coalesce(cardinality(p_bath_exact),0) = 0 and p_bath_min is null)
           or (coalesce(cardinality(p_bath_exact),0) > 0 and s.bathrooms = any(p_bath_exact))
           or (p_bath_min is not null and s.bathrooms is not null and s.bathrooms >= p_bath_min))$x$;
  scopeb_old text := $x$         or (p_tables2 is not null and s.source_table = any(p_tables2)
             and (p_types2 is null or s.type_ar = any(p_types2)))$x$;
  scopeb_new text := $x$         or (p_tables2 is not null and p_types2 is not null
             and s.source_table = any(p_tables2)
             and s.type_ar = any(p_types2))$x$;
  cap_anchor text := $x$      and (p_platforms is null or cardinality(p_platforms) = 0 or s.platform = any(p_platforms))$x$;
  cap_new text := $x$      and (p_platforms is null or cardinality(p_platforms) = 0 or s.platform = any(p_platforms))
      -- CARDINALITY CAP (2026-08-15): an oversized array is anon-callable DoS, and a request that
      -- large is never a real user. Fail CLOSED (no rows) rather than burning 20s of DB time.
      and coalesce(cardinality(p_cities), 0)    <= 200
      and coalesce(cardinality(p_districts), 0) <= 500
      and coalesce(cardinality(p_types), 0)     <= 200
      and coalesce(cardinality(p_platforms), 0) <= 100
      and coalesce(cardinality(p_tables), 0)    <= 200$x$;
  occ int;
begin
  foreach occ in array array[1] loop null; end loop; -- no-op, keeps the declare block tidy

  occ := (length(c) - length(replace(c, bath_old, ''))) / nullif(length(bath_old),0);
  if occ <> 1 then raise exception 'ABORT: bath block occurs % times, expected 1', occ; end if;
  c := replace(c, bath_old, bath_new);

  occ := (length(c) - length(replace(c, scopeb_old, ''))) / nullif(length(scopeb_old),0);
  if occ <> 1 then raise exception 'ABORT: scope-B block occurs % times, expected 1', occ; end if;
  c := replace(c, scopeb_old, scopeb_new);

  occ := (length(c) - length(replace(c, cap_anchor, ''))) / nullif(length(cap_anchor),0);
  if occ <> 1 then raise exception 'ABORT: platform anchor occurs % times, expected 1', occ; end if;
  c := replace(c, cap_anchor, cap_new);

  execute format('create or replace function public.af_eligibility_clause() returns text language sql immutable as $fn$ select %L::text $fn$', c);
  perform * from rebuild_af_filter_rpcs();

  -- ASSERTIONS ---------------------------------------------------------------------------------
  -- the certified cohort must be byte-identical
  if (select af_eligible_count(p_deal:='إيجار',p_rent_period:='سنوي',p_types:=array['شقة'],
        p_cities:=array['الرياض'],p_category:='Residential')) <> 8458 then
    raise exception 'ABORT: cohort count changed (expected 8458)';
  end if;
  -- bath min is no longer voided by exact
  if (select af_eligible_count(p_deal:='إيجار',p_rent_period:='سنوي',p_types:=array['شقة'],
        p_cities:=array['الرياض'],p_category:='Residential',p_bath_exact:=array[1],p_bath_min:=4))
     <= (select af_eligible_count(p_deal:='إيجار',p_rent_period:='سنوي',p_types:=array['شقة'],
        p_cities:=array['الرياض'],p_category:='Residential',p_bath_exact:=array[1])) then
    raise exception 'ABORT: bath exact+min did not union';
  end if;
  -- oversized array fails CLOSED
  if (select af_eligible_count(p_deal:='إيجار',p_rent_period:='سنوي',p_types:=array['شقة'],
        p_cities:=array['الرياض'],p_category:='Residential',
        p_districts:=(select array_agg('d'||g) from generate_series(1,600) g))) <> 0 then
    raise exception 'ABORT: oversized p_districts did not fail closed';
  end if;
  raise notice 'SUCCESS: bath union, scope-B pairing, cardinality caps live on all 4 surfaces.';
end $do$;