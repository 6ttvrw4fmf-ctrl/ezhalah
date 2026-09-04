-- THE SINGLE DEFINITION CATCHES UP WITH WHAT PRODUCTION ACTUALLY RUNS.
--
-- On 2026-09-04 the four AF shared-eligibility RPCs were live with `price_total_effective` (the
-- per-m² × area derived total, owner rule 2026-09-03) while af_eligibility_clause() — the ONE
-- definition they are supposed to be generated from — still read `price_total`. The sanctioned
-- rebuild would therefore have REVERTED that feature and then stamped the reverted md5 into
-- af_rpc_build_state, turning mon_af_predicate_parity() green on the regression. Migration
-- 20260904120741 made the rebuild refuse. This is the actual repair it was holding the door for.
--
-- NOTHING HERE IS HAND-WRITTEN SQL. The new clause is DERIVED from the live one by a single
-- auditable rule, and that rule was proven — not assumed — to reproduce byte-for-byte the clause
-- production already has inlined:
--
--   replace(af_eligibility_clause(), 's.price_total ', 's.price_total_effective ')
--     == the clause inlined in apartment_guided_counts_ar
--     == the clause inlined in property_age_option_counts_ar   (md5 c951752de383bb59f2beff510723962a)
--
-- Both extractions are identical to each other and to the rule's output, so the rule is not a guess
-- about intent — it is a measurement of the deployed text.
--
-- It rewrites 8 of the 10 `s.price_total` occurrences. The 2 it leaves alone are exactly the two
-- #1661 said must keep judging the SOURCE value: `search_row_price_gated(s.deal_ar, s.price_total)`
-- (hiding a price the source published stays forbidden) and the `coalesce(s.price_total,0) >= 0`
-- sanity check. A blunter substitution would have silently broken both.
--
-- ONE template also changes, because its edit is OUTSIDE the clause: location_search_candidates_ar
-- builds `effective_price`, which ORDERS and DISPLAYS the row, from coalesce(price_total, price_annual).
-- A derived-total listing would sort and render as price-less. The anchor matches exactly once.
--
-- PROVEN BEFORE COMMITTING, by a full dry run in a transaction that was rolled back:
--   guard_rows_after_repair = 0   (the guard CLEARS ITSELF — the repair is exactly what it demanded)
--   all four RPCs IDENTICAL, i.e. the rebuild is a byte-level NO-OP.
-- This migration re-asserts every one of those conditions and RAISEs on any deviation, so a surprise
-- rolls the whole thing back rather than leaving the search path half-rebuilt. (A first attempt did
-- exactly that: a malformed privilege probe raised, and all five objects came back byte-identical to
-- the pre-change backup — the fail-closed path is not theoretical here, it was exercised.)

do $mig$
declare
  newc text;
  guard_rows int;
  n_over int;
  bad text := '';
  r record;
  v_total bigint;
  v_anon boolean;
begin
  if not exists (select 1 from public.ops_af_rebuild_backup_20260904) then
    raise exception 'no pre-change backup captured — refusing to rebuild blind';
  end if;

  newc := replace(public.af_eligibility_clause(), 's.price_total ', 's.price_total_effective ');

  -- the derivation must reproduce the text production already has inlined, or we are guessing
  if md5(newc) <> 'c951752de383bb59f2beff510723962a' then
    raise exception 'derived clause md5 % does not match the clause inlined in production — refusing', md5(newc);
  end if;

  execute format(
    'create or replace function public.af_eligibility_clause() returns text language sql immutable as $fn$ select %L $fn$', newc);
  if public.af_eligibility_clause() <> newc then
    raise exception 'af_eligibility_clause() does not return the derived text after replacement';
  end if;

  update public.af_rpc_templates
     set template = replace(template,
           'coalesce(s.price_total, s.price_annual) as effective_price',
           'coalesce(s.price_total_effective, s.price_annual) as effective_price')
   where fn_name = 'location_search_candidates_ar'
     and position('coalesce(s.price_total, s.price_annual) as effective_price' in template) > 0;
  if not found then
    raise exception 'the effective_price anchor was not present exactly where expected in the location_search_candidates_ar template';
  end if;

  -- the guard must now clear ON ITS OWN. If it does not, the repair is incomplete and the rebuild
  -- below would still drop something — let it refuse rather than forcing past it.
  select count(*) into guard_rows from public.af_rebuild_would_revert();
  if guard_rows <> 0 then
    raise exception 'guard still reports % function(s) that a rebuild would revert — repair incomplete', guard_rows;
  end if;

  perform * from public.rebuild_af_filter_rpcs();

  -- POST-CONDITIONS. Any deviation rolls this migration back entirely.
  for r in
    select b.fn_name, b.live_md5 as before_md5, md5(pg_get_functiondef(p.oid)) as after_md5
      from public.ops_af_rebuild_backup_20260904 b
      join pg_proc p on p.proname = b.fn_name and p.prokind = 'f'
      join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'public'
     where b.fn_name <> 'af_eligibility_clause'
  loop
    if r.before_md5 is distinct from r.after_md5 then
      bad := bad || format('%s changed (%s -> %s); ', r.fn_name, left(r.before_md5,8), left(r.after_md5,8));
    end if;
  end loop;
  if bad <> '' then
    raise exception 'rebuild did NOT reproduce production byte-for-byte: %', bad;
  end if;

  -- exactly one overload each (the PGRST203 outage shape), and anon can still call them
  for r in select fn_name from public.af_rpc_templates loop
    select count(*) into n_over from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname='public' and p.proname = r.fn_name and p.prokind='f';
    if n_over <> 1 then raise exception '% has % overloads after rebuild', r.fn_name, n_over; end if;

    select has_function_privilege('anon', p.oid, 'EXECUTE') into v_anon
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname='public' and p.proname = r.fn_name and p.prokind='f';
    if not coalesce(v_anon,false) then raise exception 'anon lost EXECUTE on %', r.fn_name; end if;
  end loop;

  -- a real search must still answer, and still carry the derived total
  select r2.total_count into v_total
    from public.location_search_candidates_ar(
           p_deal := 'إيجار', p_rent_period := 'سنوي', p_cities := array['الرياض'],
           p_types := array['شقة'], p_limit := 1, p_offset := 0) r2 limit 1;
  if coalesce(v_total,0) <= 0 then
    raise exception 'smoke search returned % — refusing to commit a rebuild that broke search', v_total;
  end if;
  if position('price_total_effective' in pg_get_functiondef('public.location_search_candidates_ar'::regproc)) = 0 then
    raise exception 'the rebuilt results RPC no longer carries price_total_effective';
  end if;

  raise notice 'AF rebuild committed: 4/4 byte-identical, guard clear, smoke total=%', v_total;
end
$mig$;
