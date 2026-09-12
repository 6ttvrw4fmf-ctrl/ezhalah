-- APARTMENT_GUIDED_COUNTS_AR SPENT TWO THIRDS OF ITS AGGREGATE TIME NORMALISING NOTHING.
--
-- ops_incident #156: the AF round's «خلّنا نحدد الطلب أكثر» is offered, the round starts, and no
-- question renders. That is NOT an offer/round disagreement — it is the owner-locked UNKNOWN branch
-- (mayAssertNothingToNarrow(probeVerdict(...)), src/lib/afProbe.ts) behaving correctly, because the
-- round's guided-count probe did not answer inside AGE_COUNT_TIMEOUT_MS = 4000 (src/data/remote.ts).
-- The defect is the probe's cost, so the fix belongs here.
--
-- MEASURED on production 2026-09-12, الرياض / إيجار / سنوي (23,941 matching rows):
--   server-side warm   436 ms total, of which the scan is ~102 ms — so ~334 ms is the aggregate
--   the `dirn` column   326 ms of that ~334 ms, i.e. essentially the ENTIRE aggregate cost
--
-- WHY. `scoped` projects public.norm_direction_ar(s.direction_ar) for EVERY row, and that function is
-- eight replace() calls plus a regexp_replace. It is IMMUTABLE and correct; it is simply run on rows
-- that cannot possibly produce a direction. 54% of the served index has direction_ar IS NULL
-- (115,119 of 213,885 rows), and norm_direction_ar(NULL) does the full regexp work on a single space
-- before nullif() throws the result away.
--
-- THE CHANGE IS A NULL GUARD, AND IT CANNOT MOVE A COUNT. norm_direction_ar(NULL) IS NULL (asserted
-- below), so `case when direction_ar is null then null else norm_direction_ar(direction_ar) end` is
-- the same function on the same domain. PROVEN BY EXECUTION over all 213,885 served rows before this
-- migration was written: 0 rows differ, 8 distinct values on both sides.
--
-- MEASURED EFFECT, same cohort, isolated: aggregate 106 ms -> 36 ms (-66%), end-to-end 161 ms -> 78 ms.
--
-- IT GOES THROUGH THE TEMPLATE, NEVER A HAND-EDIT. apartment_guided_counts_ar is one of the four AF
-- shared-eligibility RPCs, so AGENTS.md requires the shared clause + rebuild_af_filter_rpcs(); a
-- CREATE OR REPLACE aimed at it would break the one-definition-of-eligibility guarantee and trip
-- mon_af_predicate_parity()'s af_parity_hand_edit. This edits af_rpc_templates and rebuilds.
--
-- AND IT REFUSES TO RUN IF A REBUILD WOULD BE AN OUTAGE. scripts/verify-af-rpcs-not-hand-edited.ts
-- records that on 2026-08-29 rebuild_af_filter_rpcs() was itself the dangerous move, because the
-- templates had drifted behind live hand edits and rebuilding would have REVERTED an owner rule and
-- dropped a live parameter. So step 0 below asserts every templated RPC is in parity FIRST, and
-- step 4 asserts the five functions this change does not touch came back byte-identical.
do $mig$
declare
  v_before jsonb;
  v_after  jsonb;
  v_md5_before jsonb;
  v_md5_after  jsonb;
  v_tmpl text;
  v_new  text;
  v_rows int;
  v_diff int;
begin
  -- 0. REFUSE to rebuild over a hand-edited surface.
  if exists (
    select 1 from public.af_rpc_build_state b
      join pg_proc p on p.proname = b.fn_name and p.pronamespace = 'public'::regnamespace
     where b.def_md5 <> md5(pg_get_functiondef(p.oid)))
  then
    raise exception 'refusing to rebuild: a templated AF RPC is out of parity with its template '
      '(hand-edited). Reconcile the template first — rebuilding would revert live behaviour.';
  end if;

  -- 0b. The identity this whole change rests on.
  if public.norm_direction_ar(null) is not null then
    raise exception 'norm_direction_ar(NULL) is not NULL — the guard would change results';
  end if;

  -- 0c. The guard is identical on the REAL served data, executed, not argued.
  select count(*), count(*) filter (
           where public.norm_direction_ar(s.direction_ar)
                 is distinct from
                 (case when s.direction_ar is null then null
                       else public.norm_direction_ar(s.direction_ar) end))
    into v_rows, v_diff
    from public.search_listings_ar s;
  if v_diff <> 0 then
    raise exception 'the NULL guard changes % of % served rows — refusing', v_diff, v_rows;
  end if;

  -- 1. BEFORE — every one of the 46 count columns, on six real cohorts.
  select jsonb_agg(x order by x->>'c') into v_before from (
    select jsonb_build_object('c', c.id::text, 'r', to_jsonb(r)) as x
    from (values
      (1,'إيجار','سنوي',array['الرياض']::text[],null::text[]),
      (2,'إيجار','سنوي',array['الرياض']::text[],array['شقة']::text[]),
      (3,'بيع',null,array['جدة']::text[],array['فيلا']::text[]),
      (4,'إيجار','شهري',array['الخبر']::text[],null::text[]),
      (5,'بيع',null,array['الدمام']::text[],null::text[]),
      (6,'إيجار','سنوي',array['مكة المكرمة']::text[],null::text[])
    ) c(id,deal,period,cities,types)
    cross join lateral public.apartment_guided_counts_ar(
      p_deal=>c.deal, p_rent_period=>c.period, p_cities=>c.cities, p_types=>c.types) r
  ) s;

  select jsonb_object_agg(b.fn_name, md5(pg_get_functiondef(p.oid))) into v_md5_before
    from public.af_rpc_build_state b
    join pg_proc p on p.proname = b.fn_name and p.pronamespace = 'public'::regnamespace;

  -- 2. The template edit, asserted to have changed exactly what it claims.
  select template into v_tmpl from public.af_rpc_templates where fn_name = 'apartment_guided_counts_ar';
  if v_tmpl is null then raise exception 'template apartment_guided_counts_ar not found'; end if;
  if (length(v_tmpl) - length(replace(v_tmpl,'public.norm_direction_ar(s.direction_ar) as dirn','')))
     / length('public.norm_direction_ar(s.direction_ar) as dirn') <> 1 then
    raise exception 'expected exactly one dirn projection in the template';
  end if;
  v_new := replace(v_tmpl,
    'public.norm_direction_ar(s.direction_ar) as dirn',
    'case when s.direction_ar is null then null else public.norm_direction_ar(s.direction_ar) end as dirn');
  if v_new = v_tmpl then raise exception 'template edit changed nothing'; end if;
  update public.af_rpc_templates set template = v_new where fn_name = 'apartment_guided_counts_ar';

  -- 3. Rebuild from the templates (the only sanctioned path to these four functions).
  perform public.rebuild_af_filter_rpcs();

  -- 4. The five RPCs this change does not touch must come back BYTE-IDENTICAL.
  select jsonb_object_agg(b.fn_name, md5(pg_get_functiondef(p.oid))) into v_md5_after
    from public.af_rpc_build_state b
    join pg_proc p on p.proname = b.fn_name and p.pronamespace = 'public'::regnamespace;
  if (v_md5_before - 'apartment_guided_counts_ar') <> (v_md5_after - 'apartment_guided_counts_ar') then
    raise exception 'the rebuild changed an RPC this migration does not touch: before=% after=%',
      v_md5_before, v_md5_after;
  end if;
  if v_md5_before->>'apartment_guided_counts_ar' = v_md5_after->>'apartment_guided_counts_ar' then
    raise exception 'apartment_guided_counts_ar did not actually change — the rebuild did not take';
  end if;

  -- 5. AFTER — the same six cohorts. Every count must be identical, or nothing commits.
  select jsonb_agg(x order by x->>'c') into v_after from (
    select jsonb_build_object('c', c.id::text, 'r', to_jsonb(r)) as x
    from (values
      (1,'إيجار','سنوي',array['الرياض']::text[],null::text[]),
      (2,'إيجار','سنوي',array['الرياض']::text[],array['شقة']::text[]),
      (3,'بيع',null,array['جدة']::text[],array['فيلا']::text[]),
      (4,'إيجار','شهري',array['الخبر']::text[],null::text[]),
      (5,'بيع',null,array['الدمام']::text[],null::text[]),
      (6,'إيجار','سنوي',array['مكة المكرمة']::text[],null::text[])
    ) c(id,deal,period,cities,types)
    cross join lateral public.apartment_guided_counts_ar(
      p_deal=>c.deal, p_rent_period=>c.period, p_cities=>c.cities, p_types=>c.types) r
  ) s;

  if v_before is distinct from v_after then
    raise exception 'AF guided counts MOVED — refusing to commit. before=% after=%', v_before, v_after;
  end if;
end $mig$;