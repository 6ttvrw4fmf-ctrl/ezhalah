-- BUY+RENT COMBINED — two permanent barriers (owner feature 2026-08-20, stage 4).
--
-- BARRIER 1: combined_count = buy_count + rent_count, EXACTLY, sampled across a real spread of
-- (city, category, type) cohorts drawn live from search_listings_ar (not a fixed hand-picked list —
-- so the sample tracks the real inventory shape as it changes). Catches any future regression to
-- af_eligibility_clause()'s price/deal predicate that breaks the union identity PR#817 established
-- and verified live (10,584+18,770=29,354 for الرياض/شقة on 2026-08-20).
--
-- BARRIER 2: top_cities_by_deal_ar(p_deal:=null) must return rows whenever BOTH single-deal calls
-- (p_deal:='بيع' and p_deal:='إيجار') do — catches a regression to the exact bug PR#817 fixed (a
-- hard `s.deal_ar = p_deal` equality silently returning ZERO combined-mode trending cities, since
-- NULL = anything is always false in SQL).
create or replace function public.mon_detect_buy_rent_combined_exactness()
returns int language plpgsql as $$
declare
  v_n int := 0;
  r record;
  v_combined int;
  v_buy int;
  v_rent int;
begin
  -- Sample: the 8 (city, category) pairs with the most production-ready inventory right now — a
  -- live, self-updating cohort list rather than a fixed set that could go stale as inventory shifts.
  for r in
    select s.city_ar, coalesce(
             case when exists (select 1 from public.known_type_ar k where k.type_ar = s.type_ar and k.macro = 'Commercial')
                  then 'Commercial' else 'Residential' end, 'Residential') as category,
           count(*) n
      from public.search_listings_ar s
     where s.production_ready and s.city_ar is not null
     group by 1, 2
     order by n desc
     limit 8
  loop
    select public.af_eligible_count(p_deal := null, p_rent_period := null, p_cities := array[r.city_ar], p_category := r.category) into v_combined;
    select public.af_eligible_count(p_deal := 'بيع', p_rent_period := null, p_cities := array[r.city_ar], p_category := r.category) into v_buy;
    select public.af_eligible_count(p_deal := 'إيجار', p_rent_period := null, p_cities := array[r.city_ar], p_category := r.category) into v_rent;
    if v_combined is distinct from (coalesce(v_buy, 0) + coalesce(v_rent, 0)) then
      v_n := v_n + public.mon_raise('P1', 'buy_rent_combined_exactness',
        r.city_ar,
        'buy_rent_combined_exactness:' || r.city_ar || ':' || r.category,
        jsonb_build_object(
          'city_ar', r.city_ar, 'category', r.category,
          'combined_count', v_combined, 'buy_count', v_buy, 'rent_count', v_rent,
          'expected', coalesce(v_buy, 0) + coalesce(v_rent, 0),
          'why', 'af_eligible_count(p_deal:=null) must equal buy_count + rent_count exactly — this is the Buy+Rent combined-mode eligible-set identity verified live in PR#817.',
          'fix', 'Check af_eligibility_clause()''s p_deal-null branches — a recent template rebuild or hand-edit likely broke the union.'));
    else
      perform public.mon_resolve_key('buy_rent_combined_exactness', 'buy_rent_combined_exactness:' || r.city_ar || ':' || r.category);
    end if;
  end loop;
  return v_n;
end $$;

create or replace function public.mon_detect_trending_combined_null_safety()
returns int language plpgsql as $$
declare
  v_combined int;
  v_buy int;
  v_rent int;
begin
  select count(*) into v_combined from public.top_cities_by_deal_ar(p_deal := null, p_rent_period := null);
  select count(*) into v_buy from public.top_cities_by_deal_ar(p_deal := 'بيع', p_rent_period := null);
  select count(*) into v_rent from public.top_cities_by_deal_ar(p_deal := 'إيجار', p_rent_period := null);
  if v_buy > 0 and v_rent > 0 and v_combined = 0 then
    return public.mon_raise('P1', 'trending_combined_null_safety', null,
      'trending_combined_null_safety',
      jsonb_build_object(
        'combined_rows', v_combined, 'buy_rows', v_buy, 'rent_rows', v_rent,
        'why', 'top_cities_by_deal_ar(p_deal:=null) returned ZERO trending cities while both single-deal calls returned real data — this is exactly the pre-PR#817 bug (a hard s.deal_ar = p_deal equality that NULL can never satisfy).',
        'fix', 'Check top_cities_by_deal_ar''s WHERE clause for a reintroduced hard deal_ar equality — it must read (p_deal IS NULL OR s.deal_ar = p_deal), mirroring district_options_ar.'));
  end if;
  perform public.mon_resolve_key('trending_combined_null_safety', 'trending_combined_null_safety');
  return 0;
end $$;

-- Roster entries, in the SAME migration (mon_detect_orphaned_detectors flags anything the roster
-- cannot reach). GUARDED needle-edit of the LIVE body — never a hand-pasted rebuild.
do $$
declare
  v_def text; v_before text; fn text;
  want text[] := array['mon_detect_buy_rent_combined_exactness', 'mon_detect_trending_combined_null_safety'];
  anchor constant text := '    ''mon_detect_orphaned_detectors''';
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'mon_run_all_detectors';
  if v_def is null then raise exception 'mon_run_all_detectors is missing'; end if;
  v_before := v_def;
  if position(anchor in v_def) = 0 then
    raise exception 'roster anchor missing — refusing to guess at the array shape';
  end if;
  foreach fn in array want loop
    if position('''' || fn || '''' in v_def) = 0 then
      v_def := replace(v_def, anchor, '    ''' || fn || ''',' || E'\n' || anchor);
    end if;
  end loop;
  if v_def = v_before then
    raise notice 'roster already carries both detectors — nothing to do';
    return;
  end if;
  execute v_def;
end $$;

-- Prove reachability in the same migration.
do $$
declare
  v_def text; fn text; missing text[] := '{}';
  want text[] := array[
    'mon_detect_buy_rent_combined_exactness', 'mon_detect_trending_combined_null_safety',
    'mon_detect_orphaned_detectors'
  ];
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'mon_run_all_detectors';
  foreach fn in array want loop
    if position('''' || fn || '''' in v_def) = 0 then missing := missing || fn; end if;
  end loop;
  if cardinality(missing) > 0 then
    raise exception 'roster edit lost or failed to add: %', missing;
  end if;
end $$;

-- Run both live once, right now, to prove they execute clean against real production data.
select 'combined_exactness' as detector, public.mon_detect_buy_rent_combined_exactness() as raised
union all
select 'trending_null_safety', public.mon_detect_trending_combined_null_safety();
