-- PARITY DEFECT: the حي ambiguity guard shipped in 20260818012640 lives ONLY in the live
-- location_search_candidates_ar body. It was never folded into af_rpc_templates, so:
--
--   1. THE COUNT CHIPS STILL LEAK. af_eligible_count / apartment_guided_counts_ar /
--      property_age_option_counts_ar are all built from the unguarded template, so they still
--      inject the FOREIGN حي that the results RPC now correctly excludes. Measured live
--      2026-08-18 06:15 UTC, before this migration:
--        بيع + حائل + مزرعة + حي «حقروصين»  -> results 13, af_eligible_count 14
--        حي «ابو السلع» / صبيا               -> results  6, af_eligible_count  8
--      The user is shown a number they cannot reach — the exact harm mon_af_predicate_parity
--      describes as "counts shown to users may not match results".
--
--   2. THE FIX WAS ONE REBUILD FROM BEING SILENTLY REVERTED. rebuild_af_filter_rpcs() rebuilds
--      every AF surface from af_rpc_templates. It ran at 00:32 today; the needle-edit landed at
--      01:26. The next rebuild would have dropped the guard and restored the حي leak with no
--      migration and no alert. mon_af_predicate_parity has been raising af_parity_hand_edit
--      hourly since 01:43 for exactly this reason (live ee76ab978390 vs built 2b506289f5f2).
--
-- FIX. Apply the IDENTICAL guard text to all four templates and rebuild. Byte-identical on
-- purpose: the assertion below proves the rebuilt location_search_candidates_ar is unchanged from
-- the live one, which simultaneously proves (a) the guard survived and (b) no OTHER hand-edit was
-- sitting in that function unrecorded.
--
-- SCOPE. Narrowing only, and only to what the user asked for; the first UNION branch always keeps
-- the literal request, so no listing that genuinely belongs to the requested حي can be hidden.
-- This does not invent semantics: it extends an already-merged, owner-shipped guard (PR #738) to
-- the sibling surfaces so counts and results agree, which is the AF design contract already
-- enforced by mon_af_predicate_parity.

do $mig$
declare
  t record; n_patched int := 0; v_new text;
  needle text := 'district_tokens as (
    select norm_district_tok(d) as tok from unnest(coalesce(p_districts, ''{}'')) d
    union
    select norm_district_tok(b.district_ar)
    from unnest(coalesce(p_districts, ''{}'')) d
    join district_name_bridge b on norm_en_place(b.district_en) = norm_en_place(d)
  )';
  replacement text := 'district_tokens as (
    select norm_district_tok(d) as tok from unnest(coalesce(p_districts, ''{}'')) d
    union
    -- AMBIGUITY GUARD (2026-08-18, mirrors the city guard below): only bridge a name that
    -- resolves to exactly ONE canonical Arabic district. district_name_bridge is
    -- source-observed and noisy (''حقروصين'' -> both ''حقروصين'' and ''حي جعرانة''), so an
    -- unguarded join injects a FOREIGN حي as a search token and the user gets listings from a
    -- حي they did not select. Measured: 68 ambiguous names, 126 leaking pairs.
    select norm_district_tok(b.district_ar)
    from unnest(coalesce(p_districts, ''{}'')) d
    join district_name_bridge b on norm_en_place(b.district_en) = norm_en_place(d)
    where (select count(distinct norm_district_tok(b2.district_ar))
             from district_name_bridge b2
            where norm_en_place(b2.district_en) = norm_en_place(d)) = 1
  )';
begin
  for t in select fn_name, template from public.af_rpc_templates order by fn_name loop
    if position('AMBIGUITY GUARD (2026-08-18' in t.template) > 0 then
      continue;  -- idempotent: already folded in
    end if;
    if position(needle in t.template) = 0 then
      raise exception 'district_tokens needle not found in template % — refusing to edit blind', t.fn_name;
    end if;
    v_new := replace(t.template, needle, replacement);
    if v_new = t.template then raise exception 'replacement was a no-op for %', t.fn_name; end if;
    update public.af_rpc_templates set template = v_new where fn_name = t.fn_name;
    n_patched := n_patched + 1;
  end loop;
  raise notice 'patched % templates', n_patched;

  -- every template must now carry the guard, whether patched now or already present
  if exists (select 1 from public.af_rpc_templates
              where position('AMBIGUITY GUARD (2026-08-18' in template) = 0) then
    raise exception 'a template still lacks the district ambiguity guard';
  end if;
end $mig$;

-- Rebuild all four surfaces from the patched templates, proving the results RPC is untouched.
do $mig$
declare v_before text; v_after text; r record; v_missing text;
begin
  select pg_get_functiondef(p.oid) into v_before from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'location_search_candidates_ar';

  perform public.rebuild_af_filter_rpcs();

  select pg_get_functiondef(p.oid) into v_after from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'location_search_candidates_ar';

  -- The rebuilt results RPC must be byte-identical to the live one it replaced. If this fires, the
  -- live function held an edit that no template knows about — investigate, never overwrite blind.
  if v_after is distinct from v_before then
    raise exception 'rebuild CHANGED location_search_candidates_ar — an unrecorded hand-edit exists; refusing';
  end if;

  -- guard present, and exactly one overload, on every AF surface (PGRST203 shape)
  for r in select fn_name from public.af_rpc_templates order by fn_name loop
    if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname='public' and p.proname = r.fn_name and p.prokind='f') <> 1 then
      raise exception '% does not have exactly 1 overload after rebuild', r.fn_name;
    end if;
    select pg_get_functiondef(p.oid) into v_after from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname='public' and p.proname = r.fn_name and p.prokind='f';
    if position('AMBIGUITY GUARD (2026-08-18' in v_after) = 0 then
      v_missing := coalesce(v_missing || ', ', '') || r.fn_name;
    end if;
  end loop;
  if v_missing is not null then
    raise exception 'district guard missing from live: %', v_missing;
  end if;
end $mig$;

-- BOTH DIRECTIONS, on the counts surface this migration exists to fix.
do $mig$
declare v_res bigint; v_cnt bigint; v_leak bigint;
begin
  -- (1) the two known leaking pairs: counts must now equal results
  select count(*) into v_res from public.location_search_candidates_ar(
     p_deal := 'بيع', p_cities := array['حائل'], p_districts := array['حقروصين'],
     p_types := array['مزرعة'], p_category := 'Residential', p_limit := 500);
  select public.af_eligible_count(
     p_deal := 'بيع', p_cities := array['حائل'], p_districts := array['حقروصين'],
     p_types := array['مزرعة'], p_category := 'Residential') into v_cnt;
  if v_res <> v_cnt then
    raise exception 'حقروصين still overstates: results % vs count %', v_res, v_cnt;
  end if;

  select count(*) into v_res from public.location_search_candidates_ar(
     p_cities := array['صبيا'], p_districts := array['ابو السلع'], p_limit := 800);
  select public.af_eligible_count(
     p_cities := array['صبيا'], p_districts := array['ابو السلع']) into v_cnt;
  if v_res <> v_cnt then
    raise exception 'ابو السلع still overstates: results % vs count %', v_res, v_cnt;
  end if;

  -- (2) no foreign حي leaks into results
  select count(*) into v_leak from public.location_search_candidates_ar(
     p_deal := 'بيع', p_cities := array['حائل'], p_districts := array['حقروصين'],
     p_types := array['مزرعة'], p_category := 'Residential', p_limit := 500) c
   where public.norm_district_tok(c.district_ar) <> public.norm_district_tok('حقروصين');
  if v_leak > 0 then raise exception 'still leaking % foreign-حي rows', v_leak; end if;

  -- (3) NOT over-narrowed: an unambiguous حي still returns its inventory on BOTH surfaces
  select count(*) into v_res from public.location_search_candidates_ar(
     p_cities := array['بريدة'], p_districts := array['الجامعيين'], p_limit := 800);
  select public.af_eligible_count(
     p_cities := array['بريدة'], p_districts := array['الجامعيين']) into v_cnt;
  if v_res = 0 or v_cnt = 0 then raise exception 'guard over-narrowed an unambiguous حي'; end if;
  if v_res <> v_cnt then
    raise exception 'unambiguous حي lost parity: results % vs count %', v_res, v_cnt;
  end if;
end $mig$;

-- The drift alert this migration answers must now be structurally clean.
do $mig$
declare v int;
begin
  select public.mon_af_predicate_parity() into v;
  if v <> 0 then raise exception 'mon_af_predicate_parity still reports % issue(s)', v; end if;
end $mig$;
