-- THE CLAUSE HAD SIX SURFACES AND THE REBUILD OWNED ONLY FOUR OF THEM.
--
-- ops_incident #59, and the class behind #31. af_eligibility_clause() is the single canonical
-- definition of "which rows are eligible". Four RPCs are RENDERED from it by
-- rebuild_af_filter_rpcs() out of af_rpc_templates, so a change to the clause reaches them by
-- construction and af_rebuild_would_revert() refuses a rebuild that would drop semantics.
--
-- top_cities_by_deal_ar and district_options_ar also inline that clause — and were maintained by
-- HAND, as needle-edits over pg_get_functiondef of the live function. Nothing forced the result to
-- still BE the canonical clause, and twice in twenty-four hours it was not:
--
--   20260904143656  #1661 rewired four surfaces to price_total_effective and left top_cities behind
--                   (جدة chip 10,835 against a click-through of 10,925)
--   20260905045146  top_cities' purity gate was RETYPED rather than substituted, binding the
--                   table-suffix case to every type — broad Commercial under-counted by ~92%
--                   (الرياض 269 against 3,361), repaired by 20260905112036
--
-- Detection worked both times: mon_detect_af_count_surfaces_carry_af fired within minutes. But
-- detection after the fact is not the same as the class being impossible, and the second incident
-- was live for six hours because a raised alert is not a read one.
--
-- THE FIX IS TO REMOVE THE HAND-MAINTAINED PATH, NOT TO WATCH IT HARDER. Both functions become
-- af_rpc_templates rows, so the rebuild owns them exactly as it owns the other four.
--
-- WHY THIS IS SAFE TO DO TO A LIVE 37- AND 38-PARAMETER FUNCTION. The template is DERIVED from the
-- live definition, never retyped: template := replace(pg_get_functiondef(fn), clause, PLACEHOLDER),
-- and the migration refuses unless replace(template, PLACEHOLDER, clause) is BYTE-IDENTICAL to the
-- definition production is running. So the signature, the defaults, the body and the cluster logic
-- in district_options_ar's tail are preserved by construction rather than by care. The migration
-- then RUNS the rebuild and asserts md5(pg_get_functiondef) is unchanged for all SIX functions —
-- the rebuild must be a no-op today, or this migration rolls back.
--
-- rebuild_af_filter_rpcs() DROPs every overload before recreating (the PGRST203 guard) and grants
-- execute to anon, authenticated and service_role. All three roles already hold EXECUTE on both
-- functions, so that grant is a no-op too; it is not a widening.
--
-- AND THE CLASS IS CLOSED BY DISCOVERY, NOT BY A LIST. ops_af_clause_surfaces() finds every public
-- function whose definition contains the clause VERBATIM and reports whether it is templated. A
-- surface added tomorrow is therefore RED the moment it exists, without anyone remembering to
-- register it — the same shape as the MATCH-FIRST stage barrier. An exemption is possible but must
-- be deliberate and must state a reason (ops_af_clause_surface_exempt), and the table starts empty.
do $mig$
declare
  PH constant text := '__AF_ELIGIBILITY_WHERE__';
  clause text := public.af_eligibility_clause();
  fn text; livedef text; tpl text; occ int;
  before_md5 jsonb; after_md5 jsonb; bad text := ''; r record; n_found int;
  res text[]; com text[]; ct text[]; cr text[]; v int; w int;
  ALL_SIX constant text[] := array['af_eligible_count','apartment_guided_counts_ar',
    'location_search_candidates_ar','property_age_option_counts_ar',
    'top_cities_by_deal_ar','district_options_ar'];
begin
  select jsonb_object_agg(p.proname, md5(pg_get_functiondef(p.oid))) into before_md5
    from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace
   where ns.nspname='public' and p.prokind='f' and p.proname = any(ALL_SIX);

  foreach fn in array array['top_cities_by_deal_ar','district_options_ar'] loop
    if exists (select 1 from public.af_rpc_templates t where t.fn_name = fn) then
      raise notice '% is already templated — skipping', fn;
      continue;
    end if;
    livedef := pg_get_functiondef(('public.'||fn)::regproc);
    occ := (length(livedef) - length(replace(livedef, clause, ''))) / length(clause);
    if occ <> 1 then
      raise exception '% inlines af_eligibility_clause() % time(s); exactly 1 is required to template it', fn, occ;
    end if;
    tpl := replace(livedef, clause, PH);
    if replace(tpl, PH, clause) <> livedef then
      raise exception '% does not round-trip byte-identically — refusing to template it', fn;
    end if;
    insert into public.af_rpc_templates(fn_name, template) values (fn, tpl);
  end loop;

  -- The fail-closed guard must be satisfied WITH the new rows present, not in spite of them.
  for r in select * from public.af_rebuild_would_revert() loop
    bad := bad || format('%s would lose [%s]; ', r.o_fn_name, array_to_string(r.o_dropped, ','));
  end loop;
  if bad <> '' then raise exception 'af_rebuild_would_revert refuses: %', bad; end if;

  -- THE PROOF THAT MATTERS: rendering from the templates must reproduce production exactly.
  perform public.rebuild_af_filter_rpcs();

  select jsonb_object_agg(p.proname, md5(pg_get_functiondef(p.oid))) into after_md5
    from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace
   where ns.nspname='public' and p.prokind='f' and p.proname = any(ALL_SIX);
  if before_md5 is distinct from after_md5 then
    raise exception 'the rebuild CHANGED a definition — it must be a no-op today. before=% after=%',
      before_md5::text, after_md5::text;
  end if;

  foreach fn in array ALL_SIX loop
    select count(*) into n_found from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace
     where ns.nspname='public' and p.proname=fn and p.prokind='f';
    if n_found <> 1 then raise exception '% has % overloads after the rebuild', fn, n_found; end if;
    if not has_function_privilege('anon', ('public.'||fn)::regproc, 'EXECUTE') then
      raise exception 'anon lost EXECUTE on %', fn;
    end if;
  end loop;

  -- Behaviour on the two surfaces this is about, against the results RPC under the same scope.
  res := array(select table_name::text from information_schema.tables where table_schema='public' and table_name like '%\_residential\_listings' order by 1);
  com := array(select table_name::text from information_schema.tables where table_schema='public' and table_name like '%\_commercial\_listings' order by 1);
  select array_agg(distinct type_ar) into ct from known_type_ar where macro='Commercial';
  cr := array(select u from unnest(ct) u where u <> 'عمارة');

  select total_count into w from public.location_search_candidates_ar(p_deal:='بيع', p_category:='Commercial',
    p_types:=cr, p_tables:=res, p_tables2:=com, p_types2:=ct, p_cities:=array['الهفوف'], p_limit:=1, p_offset:=0) limit 1;
  select total_in_city into v from public.district_options_ar(p_city_id:=12, p_deal:='بيع', p_category:='Commercial',
    p_types:=cr, p_tables:=res, p_tables2:=com, p_types2:=ct) limit 1;
  if v is distinct from w then bad := bad || format('الهفوف panel=%s click=%s; ', v, w); end if;
  select sum(t.listing_count) into v from public.top_cities_by_deal_ar(p_deal:='بيع', p_category:='Commercial',
    p_types:=cr, p_tables:=res, p_tables2:=com, p_types2:=ct) t
   where t.city_id in (select city_id from public.loc_city_cluster
                        where cluster_key = (select cluster_key from public.loc_city_cluster where city_id=12));
  if v is distinct from w then bad := bad || format('الهفوف chip-union=%s click=%s; ', v, w); end if;
  if bad <> '' then raise exception 'behaviour moved after the rebuild: %', bad; end if;

  raise notice 'top_cities_by_deal_ar and district_options_ar are now rendered by rebuild_af_filter_rpcs(); rebuild proven a no-op on all six';
end $mig$;

-- ── An exemption must be deliberate, and must say why. Starts empty on purpose. ──────────────────
create table if not exists public.ops_af_clause_surface_exempt (
  fn_name    text primary key,
  reason     text not null check (length(btrim(reason)) >= 20),
  added_at   timestamptz not null default now()
);
comment on table public.ops_af_clause_surface_exempt is
  'A function that inlines af_eligibility_clause() but is deliberately NOT rendered by '
  'rebuild_af_filter_rpcs(). Every row must carry a real reason; the detector and '
  'verify-clause-carrying-rpcs-are-templated.ts both read this table, so an exemption is visible '
  'rather than silent. Empty as of 2026-09-05.';

-- ── DISCOVERY, not a list: what carries the clause, and is the rebuild responsible for it? ───────
create or replace function public.ops_af_clause_surfaces()
returns table(fn_name text, templated boolean, exempt boolean, exempt_reason text)
language sql stable security definer set search_path to 'public' as $fn$
  with cl as (select public.af_eligibility_clause() as c)
  select p.proname::text,
         exists (select 1 from public.af_rpc_templates t where t.fn_name = p.proname),
         exists (select 1 from public.ops_af_clause_surface_exempt e where e.fn_name = p.proname),
         (select e.reason from public.ops_af_clause_surface_exempt e where e.fn_name = p.proname)
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
       , cl
   where n.nspname = 'public'
     and p.prokind = 'f'
     -- af_eligibility_clause() returns the clause as a literal, so it necessarily contains itself.
     and p.proname <> 'af_eligibility_clause'
     and position(cl.c in pg_get_functiondef(p.oid)) > 0
   order by 1;
$fn$;
grant execute on function public.ops_af_clause_surfaces() to anon, authenticated, service_role;
comment on function public.ops_af_clause_surfaces() is
  'Every public function that inlines af_eligibility_clause() VERBATIM, and whether '
  'rebuild_af_filter_rpcs() owns it. Anon-callable so a committed barrier can execute the invariant '
  'from OUTSIDE the detector that enforces it — a detector can only be verified by reading its own '
  'body, which is how a dark detector reads as a clean bill of health.';

-- ── The detector. A surface that carries the clause and is neither templated nor exempt is P1. ───
create or replace function public.mon_detect_af_clause_surface_untemplated()
returns integer
language plpgsql security definer set search_path to 'public' as $fn$
declare bad jsonb := '[]'::jsonb; n int := 0; r record;
begin
  for r in select * from public.ops_af_clause_surfaces() s where not s.templated and not s.exempt loop
    bad := bad || jsonb_build_object('fn', r.fn_name);
  end loop;

  if jsonb_array_length(bad) > 0 then
    n := public.mon_raise('P1', 'af_clause_surface_untemplated', null, 'af_clause_surface_untemplated',
      jsonb_build_object('surfaces', bad,
        'why','This function inlines af_eligibility_clause() but rebuild_af_filter_rpcs() does not '
           || 'render it, so it is maintained by hand and can drift from the one canonical '
           || 'definition of eligibility. That drift produced two incidents in 24h on 2026-09-04/05 '
           || '(top_cities_by_deal_ar: a chip of 10,835 against a click of 10,925, then a 92% '
           || 'broad-Commercial under-count).',
        'fix','Add it to af_rpc_templates with the clause replaced by __AF_ELIGIBILITY_WHERE__, '
           || 'DERIVED from pg_get_functiondef and proven to round-trip byte-identically — never '
           || 'retyped. Then run rebuild_af_filter_rpcs() and assert the definition md5 did not '
           || 'move. If it genuinely must stay hand-maintained, add a row to '
           || 'ops_af_clause_surface_exempt with a reason.'));
  else
    perform public.mon_resolve_key('af_clause_surface_untemplated','af_clause_surface_untemplated');
  end if;
  return n;
end
$fn$;

-- ── Roster wiring, in the SAME migration: a detector nothing reaches is decoration. ──────────────
do $roster$
declare def text; occ int; anchor constant text := '''mon_detect_af_rebuild_would_revert'',';
begin
  def := pg_get_functiondef('public.mon_run_all_detectors'::regproc);
  if position('mon_detect_af_clause_surface_untemplated' in def) > 0 then
    raise notice 'detector already on the roster';
  else
    occ := (length(def) - length(replace(def, anchor, ''))) / length(anchor);
    if occ <> 1 then raise exception 'roster anchor found % time(s), expected 1', occ; end if;
    execute replace(def, anchor, anchor || E'\n    ''mon_detect_af_clause_surface_untemplated'',');
  end if;
  if position('mon_detect_af_clause_surface_untemplated' in
              pg_get_functiondef('public.mon_run_all_detectors'::regproc)) = 0 then
    raise exception 'roster edit did not take';
  end if;
end $roster$;

-- ── Prove the discovery actually discriminates, before trusting it. ──────────────────────────────
do $proof$
declare n_untemplated int; n_mutated int; v_tpl text;
begin
  select count(*) into n_untemplated from public.ops_af_clause_surfaces() s where not s.templated and not s.exempt;
  if n_untemplated <> 0 then
    raise exception 'expected every clause surface to be templated by now, found %', n_untemplated;
  end if;

  -- MUTATION: pull one template back out and confirm the discovery NOTICES. Restored immediately,
  -- inside this same transaction, so production is never left in the mutated state.
  select t.template into v_tpl from public.af_rpc_templates t where t.fn_name = 'top_cities_by_deal_ar';
  if v_tpl is null then raise exception 'cannot run the mutation proof — template missing'; end if;

  delete from public.af_rpc_templates where fn_name = 'top_cities_by_deal_ar';
  select count(*) into n_mutated from public.ops_af_clause_surfaces() s where not s.templated and not s.exempt;
  if n_mutated <> 1 then
    raise exception 'the discovery is BLIND: removing top_cities_by_deal_ar''s template left % untemplated surfaces, expected 1', n_mutated;
  end if;

  insert into public.af_rpc_templates(fn_name, template) values ('top_cities_by_deal_ar', v_tpl);
  select count(*) into n_untemplated from public.ops_af_clause_surfaces() s where not s.templated and not s.exempt;
  if n_untemplated <> 0 then raise exception 'restore failed — % surfaces still untemplated', n_untemplated; end if;

  perform public.mon_detect_af_clause_surface_untemplated();
  raise notice 'discovery discriminates in both directions, and the detector is clean';
end $proof$;
