-- Adopt the كلاهما (Both) rent-period branch into the CANONICAL clause + re-baseline templates.
--
-- WHAT HAPPENED: 20260815014102 (concurrent session, 01:41) re-applied the Both-period feature by
-- hand-rewriting the three RPC bodies (pg_get_functiondef+execute) AFTER this session's 01:32
-- rebuild clobbered their first attempt (20260815012506). Their rewrite preserved this session's
-- fail-open hardening (scope-B pairing is intact in live), but left: live bodies ≠ build_state md5s
-- (parity check B primed to alarm), canonical af_eligibility_clause() ≠ live semantics, and the
-- NEXT rebuild would clobber their feature a THIRD time.
--
-- FIX: fold their purely-ADDITIVE branch into af_eligibility_clause() (canonical = live semantics),
-- re-derive all 3 templates from the live bodies, rebuild through the sanctioned path, assert
-- byte-identical + parity 0 + certified-cohort invariance. Both sessions' work preserved; the
-- rebuild path is authoritative again. كلاهما activates ONLY when p_rent_period='كلاهما' — the
-- سنوي/بيع cohorts certified tonight are semantically untouched (asserted below).
do $do$
declare
  clause text := af_eligibility_clause();
  old_needle text := $x$or (p_rent_period not in ('شهري','سنوي') and s.rent_period_ar = p_rent_period))$x$;
  new_text text := $x$or (p_rent_period = 'كلاهما' and (s.payment_monthly = true or s.rent_period_ar = 'سنوي' or (s.rent_period_ar = 'شهري' and coalesce(s.rent_now_pay_later, false))))
           or (p_rent_period not in ('شهري','سنوي','كلاهما') and s.rent_period_ar = p_rent_period))$x$;
  fn text; live_before text; live_after text; occ int; parity int; before_n bigint; after_n bigint;
  fns text[] := array['location_search_candidates_ar','apartment_guided_counts_ar','property_age_option_counts_ar'];
  befores jsonb := '{}'::jsonb;
begin
  select cnt_total_base into before_n from apartment_guided_counts_ar(
    p_deal:='إيجار',p_rent_period:='سنوي',p_types:=array['شقة'],p_cities:=array['الرياض'],p_category:='Residential');

  -- 1. canonical clause gains the كلاهما branch
  occ := (length(clause) - length(replace(clause, old_needle, ''))) / length(old_needle);
  if occ <> 1 then raise exception 'ABORT: period needle occurs % in canonical clause', occ; end if;
  clause := replace(clause, old_needle, new_text);
  execute format('create or replace function public.af_eligibility_clause() returns text language sql immutable as $fn$ select %L::text $fn$', clause);

  -- 2. re-baseline each template from its LIVE body (which must now contain the clause verbatim)
  foreach fn in array fns loop
    select pg_get_functiondef(p.oid) into live_before from pg_proc p
     where p.proname = fn and p.pronamespace = 'public'::regnamespace;
    befores := befores || jsonb_build_object(fn, md5(live_before));
    occ := (length(live_before) - length(replace(live_before, clause, ''))) / nullif(length(clause),0);
    if occ <> 1 then
      raise exception 'ABORT: updated clause occurs % times in live %, expected 1 — live diverges beyond the Both branch', occ, fn;
    end if;
    update af_rpc_templates set template = replace(live_before, clause, '__AF_ELIGIBILITY_WHERE__')
     where fn_name = fn;
    if not found then raise exception 'ABORT: no template row for %', fn; end if;
  end loop;

  -- 3. sanctioned rebuild; must reproduce the live bodies byte-for-byte
  perform * from rebuild_af_filter_rpcs();
  foreach fn in array fns loop
    select pg_get_functiondef(p.oid) into live_after from pg_proc p
     where p.proname = fn and p.pronamespace = 'public'::regnamespace;
    if md5(live_after) <> (befores ->> fn) then
      raise exception 'ABORT: rebuild changed % (not a pure re-baseline)', fn;
    end if;
    if (select b.def_md5 from af_rpc_build_state b where b.fn_name = fn) <> md5(live_after) then
      raise exception 'ABORT: build_state mismatch for %', fn;
    end if;
  end loop;

  select public.mon_af_predicate_parity() into parity;
  if parity <> 0 then raise exception 'ABORT: parity=% after re-baseline', parity; end if;

  select cnt_total_base into after_n from apartment_guided_counts_ar(
    p_deal:='إيجار',p_rent_period:='سنوي',p_types:=array['شقة'],p_cities:=array['الرياض'],p_category:='Residential');
  if before_n is distinct from after_n then
    raise exception 'ABORT: certified cohort moved %->%', before_n, after_n;
  end if;
  raise notice 'SUCCESS: canonical clause adopted كلاهما; 3 templates re-baselined; byte-identical; build_state repaired; parity 0; cohort invariant %', after_n;
end $do$;