-- A POOLED SHORT STAY IS NEVER A YEARLY RENT (🔧 2026-11-11; owner rules 2026-10-25/26 «إقامات قصيرة» and 2026-11-10 backlog 1744).
--
-- WHAT LEAKED. 20261111070829 (#11807) moved Haraj's seller-stated daily / weekly rents into the short-stays pool and, by
-- owner order, stores no price for them (price_annual NULL, payment_monthly = true, rent_period_ar 'شهري'). The eligibility
-- clause's price-on-request arm (20260928100046, scoped 20261026071543) still reads «price_annual IS NULL → admitted under
-- «سنوي» and «كلاهما»», so the same 712 Haraj chalets and 4 Aqar Monthly rows are ALSO served in yearly-rent searches with no
-- price — AGENTS.md's exact warning («a NULL price … is found under every rent period»). Measured 2026-11-11 14:05 UTC with
-- the app's own RPC: location_search_candidates_ar(إيجار, سنوي, جدة, haraj) = 1,373 rows, 142 of them daily; (إيجار, شهري,
-- جدة, haraj) = 142, all daily. Nationwide: haraj 712 + aqarmonthly 4 rows carry price_annual NULL with rent_period_ar 'شهري'.
--
-- THE RULE NOW (price_annual IS NULL):
--   «شهري»   : unchanged — gathern + aqarmonthly by name; a Haraj daily/weekly row reaches «إقامات قصيرة» through payment_monthly.
--   «سنوي»   : admitted only when the row is NOT in the short-stays pool (rent_period_ar is distinct from 'شهري').
--   «كلاهما» : the same for this arm; pooled rows still reach «كلاهما» through payment_monthly, exactly as Gathern does today.
--   A price-on-request rent with NO stated period (rent_period_ar NULL) is untouched: every period, as on 2026-09-28.
--
-- ONE DEFINITION. af_eligibility_clause() is patched by anchor replace with the count asserted, rebuild_af_filter_rpcs()
-- regenerates the seven surfaces, and the AF chip oracle's hand-kept copy (ops_af_cohort_predicate_sql, 20261102100749)
-- learns the same scope. sql/mirrors/af_eligibility_clause.sql is refreshed from pg_get_functiondef in the same change.
-- Guard: scripts/verify-pooled-short-stays-never-under-yearly.ts (reads the mirror; the old arm is its mutant).
create temp table _ssy_probe (per text, types text[], city text, cat text, priced_before bigint);
insert into _ssy_probe (per, types, city, cat)
select p.per, t.types, c.city, t.cat
  from (values ('شهري'), ('سنوي'), ('كلاهما')) p(per)
 cross join (values (array['شقة'], 'Residential'), (array['مكتب'], 'Commercial')) t(types, cat)
 cross join (values ('الرياض'), ('جدة')) c(city);
update _ssy_probe set priced_before = public.af_eligible_count(
  p_deal := 'إيجار', p_rent_period := per, p_types := types, p_cities := array[city], p_category := cat, p_price_min := 1);

do $patch$
declare
  c text := public.af_eligibility_clause();
  old_a constant text := $x$(s.price_annual is null and (p_rent_period in ('سنوي','كلاهما') or (p_rent_period = 'شهري' and s.platform in ('gathern','aqarmonthly'))))$x$;
  new_a constant text := $x$(s.price_annual is null and ((p_rent_period in ('سنوي','كلاهما') and s.rent_period_ar is distinct from 'شهري') or (p_rent_period = 'شهري' and s.platform in ('gathern','aqarmonthly'))))$x$;
  o constant text := $x$(s.price_annual is null and (%L::text = 'سنوي'
                                             or (%L::text = 'شهري' and s.platform in ('gathern','aqarmonthly'))))$x$;
  nw constant text := $x$(s.price_annual is null and ((%L::text = 'سنوي' and s.rent_period_ar is distinct from 'شهري')
                                             or (%L::text = 'شهري' and s.platform in ('gathern','aqarmonthly'))))$x$;
  k int; def text;
begin
  if position(new_a in c) > 0 then
    raise notice 'af_eligibility_clause already keeps pooled short stays out of the yearly arm';
  else
    k := (length(c) - length(replace(c, old_a, ''))) / length(old_a);
    if k <> 1 then raise exception 'ABORT: the price-on-request anchor occurs % times in af_eligibility_clause, expected 1', k; end if;
    c := replace(c, old_a, new_a);
    execute format('create or replace function public.af_eligibility_clause() returns text language sql immutable as $fn$ select %L::text $fn$', c);
  end if;
  -- the AF chip oracle's hand-kept copy (same positional %L arguments, so its argument list is unchanged)
  def := pg_get_functiondef('public.ops_af_cohort_predicate_sql'::regproc);
  if position(nw in def) = 0 then
    k := (length(def) - length(replace(def, o, ''))) / length(o);
    if k <> 1 then raise exception 'ABORT: ops_af_cohort_predicate_sql no longer has the expected shape (anchor × %)', k; end if;
    execute replace(def, o, nw);
  end if;
end $patch$;

-- Regenerate the seven surfaces from the patched builder (updates af_rpc_build_state).
select o_fn_name, left(o_def_md5, 12) as built from public.rebuild_af_filter_rpcs();

-- PROOF at apply: every generated surface carries the new arm and not the old one, the parity detectors see no split,
-- priced cohorts are unchanged, and the predicate executed through the app's own results RPC answers the rule:
-- a pooled Haraj daily row and a Gathern row are found under «شهري» and NOT under «سنوي»; a price-on-request rent with
-- no stated period is still found under all three.
do $proof$
declare
  fn text; d text; n int; r record; s record; m int; a int; b int; n_before bigint;
  new_a constant text := $x$(s.price_annual is null and ((p_rent_period in ('سنوي','كلاهما') and s.rent_period_ar is distinct from 'شهري') or (p_rent_period = 'شهري' and s.platform in ('gathern','aqarmonthly'))))$x$;
  old_a constant text := $x$(s.price_annual is null and (p_rent_period in ('سنوي','كلاهما') or (p_rent_period = 'شهري' and s.platform in ('gathern','aqarmonthly'))))$x$;
begin
  for fn in select t.fn_name from public.af_rpc_templates t loop
    select pg_get_functiondef(p.oid) into d from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = fn;
    if d is null then raise exception 'PROOF: % missing after rebuild', fn; end if;
    if position(new_a in d) = 0 then raise exception 'PROOF: % does not carry the pooled-short-stays arm', fn; end if;
    if position(old_a in d) > 0 then raise exception 'PROOF: % still carries the old yearly arm', fn; end if;
  end loop;
  if position(new_a in public.af_eligibility_clause()) = 0 then raise exception 'PROOF: af_eligibility_clause() does not emit the new arm'; end if;
  if public.ops_af_cohort_predicate_sql('إيجار', 'سنوي', 'شقة') not like '%s.rent_period_ar is distinct from ''شهري''%' then
    raise exception 'PROOF: the AF chip oracle did not take the pooled-short-stays scope';
  end if;
  n := public.mon_af_predicate_parity();
  if n <> 0 then raise exception 'PROOF: mon_af_predicate_parity() = % after the rebuild', n; end if;
  for r in select * from public.mon_filter_parity_barrier() x
            where x.check_name not in ('age_count_vs_results','guided_count_vs_results') loop
    raise exception 'PROOF: mon_filter_parity_barrier %: % (%)', r.check_name, r.detail, r.n;
  end loop;
  -- priced cohorts are untouched (the arm only ever admits price_annual NULL rows)
  for r in select * from _ssy_probe loop
    n_before := public.af_eligible_count(p_deal := 'إيجار', p_rent_period := r.per, p_types := r.types,
                  p_cities := array[r.city], p_category := r.cat, p_price_min := 1);
    if n_before <> r.priced_before then
      raise exception 'ABORT: priced count moved for % % % %: % -> %', r.per, r.types, r.city, r.cat, r.priced_before, n_before;
    end if;
  end loop;
  -- the rule, through the results RPC: (pooled haraj daily, pooled gathern) → شهري yes / سنوي no; (no period, no price) → all three
  for s in
    (select 'haraj daily' as who, l.source_table, l.listing_id, l.city_ar, l.district_ar, l.type_ar
       from public.search_listings_ar l join public.haraj_residential_listings h on h.id = l.listing_id
      where l.source_table = 'haraj_residential_listings' and l.production_ready and l.deal_ar = 'إيجار'
        and h.rent_period in ('daily','weekly') and l.price_annual is null and l.rent_period_ar = 'شهري' and l.district_ar is not null
      order by l.listing_id limit 1)
    union all
    (select 'gathern', l.source_table, l.listing_id, l.city_ar, l.district_ar, l.type_ar
       from public.search_listings_ar l
      where l.platform = 'gathern' and l.production_ready and l.deal_ar = 'إيجار' and l.rent_period_ar = 'شهري' and l.district_ar is not null
      order by l.listing_id limit 1)
    union all
    (select 'no period, no price', l.source_table, l.listing_id, l.city_ar, l.district_ar, l.type_ar
       from public.search_listings_ar l
      where l.platform = 'haraj' and l.production_ready and l.deal_ar = 'إيجار' and l.rent_period_ar is null and l.price_annual is null and l.district_ar is not null
      order by l.listing_id limit 1)
  loop
    select count(*) filter (where per = 'شهري'), count(*) filter (where per = 'سنوي'), count(*) filter (where per = 'كلاهما')
      into m, a, b
      from unnest(array['شهري','سنوي','كلاهما']) per
     cross join lateral public.location_search_candidates_ar(
            p_deal := 'إيجار', p_rent_period := per, p_cities := array[s.city_ar], p_districts := array[s.district_ar],
            p_types := array[s.type_ar], p_limit := 100000) c
     where c.source_table = s.source_table and c.listing_id = s.listing_id;
    if s.who in ('haraj daily', 'gathern') and not (m = 1 and a = 0 and b = 1) then
      raise exception 'PROOF: pooled % %:% found monthly=% yearly=% both=% (want 1/0/1)', s.who, s.source_table, s.listing_id, m, a, b;
    end if;
    if s.who = 'no period, no price' and not (m = 0 and a = 1 and b = 1) then
      raise exception 'PROOF: price-on-request %:% found monthly=% yearly=% both=% (want 0/1/1)', s.source_table, s.listing_id, m, a, b;
    end if;
  end loop;
  raise notice 'SUCCESS: pooled short stays leave the yearly arm; % priced cohorts unchanged', (select count(*) from _ssy_probe);
end $proof$;

drop table _ssy_probe;
