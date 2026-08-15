-- RESTORE the read-side RNPL guard on the شهري bucket (owner SUPREME rule: RNPL → ANNUAL, NEVER Monthly).
-- The guard shipped 20260809131728 as a per-function patcher, but the 20260811125918 canonical
-- af_eligibility_clause() was written WITHOUT it, so every rebuild since has emitted شهري as bare
-- payment_monthly=true. No listing is mis-served TODAY (0 rows have payment_monthly AND rnpl — asserted
-- below), but a brand-new RNPL row defaults rent_now_pay_later=false at sync time and would surface
-- under Monthly until refresh_rnpl_flags() runs. The read-time guard closes that window permanently.
-- Fix goes through the ONLY sanctioned path: clause → templates(marker) → rebuild_af_filter_rpcs().
do $do$
declare
  clause text := af_eligibility_clause();
  old_needle text := $x$or (p_rent_period = 'شهري' and s.payment_monthly = true)$x$;
  new_text   text := $x$or (p_rent_period = 'شهري' and s.payment_monthly = true and not coalesce(s.rent_now_pay_later, false))$x$;
  fn text; live_before text; live_after text; occ int; parity int;
  exposure bigint; mon_before bigint; mon_after bigint; ann_before bigint; ann_after bigint;
  befores jsonb := '{}'::jsonb;
begin
  -- 0. current exposure must be zero: then the guard changes NOTHING served today, only the lag window
  select count(*) into exposure from public.search_listings_ar
   where payment_monthly = true and coalesce(rent_now_pay_later, false);
  if exposure <> 0 then raise exception 'ABORT: % rows live with payment_monthly AND rnpl — investigate before guarding', exposure; end if;

  select cnt_total_base into mon_before from apartment_guided_counts_ar(
    p_deal:='إيجار',p_rent_period:='شهري',p_types:=array['شقة'],p_cities:=array['الرياض'],p_category:='Residential');
  select cnt_total_base into ann_before from apartment_guided_counts_ar(
    p_deal:='إيجار',p_rent_period:='سنوي',p_types:=array['شقة'],p_cities:=array['الرياض'],p_category:='Residential');

  -- 1. canonical clause regains the guard (exactly one شهري arm; the كلاهما arm's payment_monthly
  --    disjunct is deliberately unguarded — an RNPL row legitimately belongs in Both via its annual arm)
  occ := (length(clause) - length(replace(clause, old_needle, ''))) / length(old_needle);
  if occ <> 1 then raise exception 'ABORT: شهري needle occurs % in canonical clause', occ; end if;
  clause := replace(clause, old_needle, new_text);
  execute format('create or replace function public.af_eligibility_clause() returns text language sql immutable as $fn$ select %L::text $fn$', clause);

  -- 2. sanctioned rebuild; each surface must transform EXACTLY by the needle replacement
  foreach fn in array (select array_agg(t.fn_name) from af_rpc_templates t) loop
    select pg_get_functiondef(p.oid) into live_before from pg_proc p
     where p.proname = fn and p.pronamespace = 'public'::regnamespace;
    occ := (length(live_before) - length(replace(live_before, old_needle, ''))) / length(old_needle);
    if occ <> 1 then raise exception 'ABORT: شهري arm occurs % times in live % — unexpected shape', occ, fn; end if;
    befores := befores || jsonb_build_object(fn, md5(replace(live_before, old_needle, new_text)));
  end loop;
  perform * from rebuild_af_filter_rpcs();
  foreach fn in array (select array_agg(t.fn_name) from af_rpc_templates t) loop
    select pg_get_functiondef(p.oid) into live_after from pg_proc p
     where p.proname = fn and p.pronamespace = 'public'::regnamespace;
    if md5(live_after) <> (befores ->> fn) then
      raise exception 'ABORT: % rebuilt to something other than before+guard', fn;
    end if;
    if (select b.def_md5 from af_rpc_build_state b where b.fn_name = fn) <> md5(live_after) then
      raise exception 'ABORT: build_state mismatch for %', fn;
    end if;
  end loop;

  -- 3. behavior: parity 0; شهري bucket count unchanged (exposure=0); certified annual cohort untouched
  select public.mon_af_predicate_parity() into parity;
  if parity <> 0 then raise exception 'ABORT: parity=% after guard', parity; end if;
  select cnt_total_base into mon_after from apartment_guided_counts_ar(
    p_deal:='إيجار',p_rent_period:='شهري',p_types:=array['شقة'],p_cities:=array['الرياض'],p_category:='Residential');
  if mon_before is distinct from mon_after then
    raise exception 'ABORT: شهري bucket moved %->% with zero exposure', mon_before, mon_after;
  end if;
  select cnt_total_base into ann_after from apartment_guided_counts_ar(
    p_deal:='إيجار',p_rent_period:='سنوي',p_types:=array['شقة'],p_cities:=array['الرياض'],p_category:='Residential');
  if ann_before is distinct from ann_after then
    raise exception 'ABORT: certified annual cohort moved %->%', ann_before, ann_after;
  end if;
  raise notice 'SUCCESS: شهري read-guard restored via clause+rebuild; parity 0; شهري % / سنوي % invariant', mon_after, ann_after;
end $do$;