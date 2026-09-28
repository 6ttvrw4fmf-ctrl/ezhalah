-- PRICE ON REQUEST SHOWS UNDER EVERY RENT PERIOD (owner rule 2026-09-28).
--
-- Owner: «For سعر عند الطلب, we put it both monthly and yearly.» A rental with no published rent
-- (price_annual IS NULL) carries no figure that a period could misstate — the 12x-understatement
-- shape the period buckets exist to prevent needs a number. So it is shown under شهري, سنوي and
-- كلاهما alike; a budget still excludes it (no price can be inside a budget), exactly as before.
-- Measured before this change: 3,583 production-ready price-on-request rentals — 1,940 reachable
-- only under سنوي, 18 only under شهري, 1,625 with no stated period reachable under NO period chip.
-- Stated-price rows are untouched: every priced count below is asserted identical.
--
-- One definition, per the AF rail: the canonical clause gains ONE line under an occurrence
-- assertion and rebuild_af_filter_rpcs() re-renders every count/results surface from it (so a count
-- chip and the results cannot disagree). The four hand-kept truth copies that re-derive the period
-- buckets on their own — ops_qa_search_differential, ops_af_cohort_predicate_sql (behind
-- mon_detect_af_chip_vs_db_truth), ops_nf_cert_cell and mon_filter_parity_barrier check (2) —
-- learn the same exception so they keep measuring the product rather than alarming on it.
-- sql/mirrors/af_eligibility_clause.sql is regenerated from pg_get_functiondef in the same change.
create temp table _por_probe (deal text, per text, types text[], city text, cat text, priced_before bigint);
insert into _por_probe (deal, per, types, city, cat)
select 'إيجار', p.per, t.types, c.city, t.cat
  from (values ('شهري'), ('سنوي'), ('كلاهما')) p(per)
 cross join (values (array['شقة'], 'Residential'), (array['فيلا'], 'Residential'),
                    (array['مكتب'], 'Commercial'), (array['محل'], 'Commercial')) t(types, cat)
 cross join (values ('الرياض'), ('جدة'), ('الدمام')) c(city);
update _por_probe set priced_before = public.af_eligible_count(
  p_deal := deal, p_rent_period := per, p_types := types, p_cities := array[city],
  p_category := cat, p_price_min := 1);

do $do$
declare
  c   text := public.af_eligibility_clause();
  a_old text := $x$           or s.deal_ar <> 'إيجار'
$x$;
  a_new text := $x$           or s.deal_ar <> 'إيجار'
           or (s.price_annual is null and p_rent_period in ('شهري','سنوي','كلاهما'))  -- price on request: no figure a period could misstate (owner 2026-09-28)
$x$;
  occ int; def text; o text; nw text; k int;
begin
  occ := (length(c) - length(replace(c, a_old, ''))) / length(a_old);
  if occ <> 1 then
    raise exception 'ABORT: the rent-period anchor occurs % times in af_eligibility_clause, expected 1', occ;
  end if;
  c := replace(c, a_old, a_new);
  execute format('create or replace function public.af_eligibility_clause() returns text language sql immutable as $fn$ select %L::text $fn$', c);
  perform * from public.rebuild_af_filter_rpcs();

  -- the hand-kept truth copies: (function, anchor, replacement, expected occurrences)
  for def, o, nw, k in
    select pg_get_functiondef('public.ops_qa_search_differential'::regproc),
           $x$           and (p_period is null or s.deal_ar <> 'إيجار'
$x$,
           $x$           and (p_period is null or s.deal_ar <> 'إيجار'
                or (s.price_annual is null and p_period in ('شهري','سنوي','كلاهما'))
$x$, 1
    union all
    select pg_get_functiondef('public.ops_nf_cert_cell'::regproc),
           $x$$s$ and (s.deal_ar <> 'إيجار' or $x$,
           $x$$s$ and (s.deal_ar <> 'إيجار' or s.price_annual is null or $x$, 3
    union all
    select pg_get_functiondef('public.mon_filter_parity_barrier'::regproc),
           $x$  where reg.enabled and reg.deal_ar='إيجار' and reg.rent_period_ar='سنوي'
$x$,
           $x$  where reg.enabled and reg.deal_ar='إيجار' and reg.rent_period_ar='سنوي'
    and s.price_annual is not null  -- price on request is in every period by design (owner 2026-09-28)
$x$, 1
  loop
    occ := (length(def) - length(replace(def, o, ''))) / length(o);
    if occ <> k then
      raise exception 'ABORT: anchor % found % times, expected %', left(o, 60), occ, k;
    end if;
    execute replace(def, o, nw);
  end loop;

  -- ops_af_cohort_predicate_sql: one more positional %L, so its argument list grows by one p_period
  def := pg_get_functiondef('public.ops_af_cohort_predicate_sql'::regproc);
  o := $x$        and (%L::text is null or s.deal_ar <> 'إيجار'
$x$;
  if (length(def) - length(replace(def, o, ''))) / length(o) <> 1
     or position('p_deal, p_type, p_period, p_period, p_period);' in def) = 0 then
    raise exception 'ABORT: ops_af_cohort_predicate_sql no longer has the expected shape';
  end if;
  def := replace(def, o, o || $x$             or (s.price_annual is null and %L::text in ('شهري','سنوي'))
$x$);
  def := replace(def, 'p_deal, p_type, p_period, p_period, p_period);',
                      'p_deal, p_type, p_period, p_period, p_period, p_period);');
  execute def;
end $do$;

do $do$
declare r record; n_after bigint; n_new_line int; lsc_m int; lsc_a int; lsc_b int; sample record;
begin
  -- every generated surface carries the new line (the rebuild re-rendered them all)
  select count(*) into n_new_line
    from public.af_rpc_templates t
    join pg_proc p on p.proname = t.fn_name
    join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'public'
   where p.prosrc like '%s.price_annual is null and p_rent_period in (''شهري'',''سنوي'',''كلاهما'')%';
  if n_new_line <> (select count(*) from public.af_rpc_templates) then
    raise exception 'ABORT: only % of % generated surfaces carry the price-on-request line',
      n_new_line, (select count(*) from public.af_rpc_templates);
  end if;

  -- priced counts are unchanged, cohort by cohort
  for r in select * from _por_probe loop
    n_after := public.af_eligible_count(p_deal := r.deal, p_rent_period := r.per, p_types := r.types,
                 p_cities := array[r.city], p_category := r.cat, p_price_min := 1);
    if n_after <> r.priced_before then
      raise exception 'ABORT: priced count moved for % % % %: % -> %', r.per, r.types, r.city, r.cat,
        r.priced_before, n_after;
    end if;
  end loop;

  -- a price-on-request rental of each period shape is now found under monthly, yearly and both
  for sample in
    select distinct on (coalesce(s.rent_period_ar, '∅')) s.source_table, s.listing_id, s.city_ar,
           s.district_ar, s.type_ar, s.rent_period_ar
      from public.search_listings_ar s
      join public.known_type_ar k on k.type_ar = s.type_ar and k.macro in ('Residential','Commercial')
     where s.production_ready and s.deal_ar = 'إيجار' and s.price_annual is null
       and s.district_ar is not null
     order by coalesce(s.rent_period_ar, '∅'), s.listing_id
  loop
    select count(*) filter (where per = 'شهري'), count(*) filter (where per = 'سنوي'),
           count(*) filter (where per = 'كلاهما')
      into lsc_m, lsc_a, lsc_b
      from unnest(array['شهري','سنوي','كلاهما']) per
     cross join lateral public.location_search_candidates_ar(
            p_deal := 'إيجار', p_rent_period := per, p_cities := array[sample.city_ar],
            p_districts := array[sample.district_ar], p_types := array[sample.type_ar],
            p_limit := 100000) c
     where c.source_table = sample.source_table and c.listing_id = sample.listing_id;
    if lsc_m <> 1 or lsc_a <> 1 or lsc_b <> 1 then
      raise exception 'ABORT: price-on-request % (period %) found monthly=% yearly=% both=%',
        sample.source_table || ':' || sample.listing_id, coalesce(sample.rent_period_ar, '∅'), lsc_m, lsc_a, lsc_b;
    end if;
  end loop;

  -- the hand-kept truth copies agree with the product on a price-on-request cohort
  if public.ops_af_cohort_predicate_sql('إيجار', 'شهري', 'شقة') not like '%s.price_annual is null%'
     or pg_get_functiondef('public.ops_nf_cert_cell'::regproc) not like '%or s.price_annual is null or%'
     or pg_get_functiondef('public.ops_qa_search_differential'::regproc) not like '%s.price_annual is null and p_period in%'
     or pg_get_functiondef('public.mon_filter_parity_barrier'::regproc) not like '%and s.price_annual is not null  -- price on request%' then
    raise exception 'ABORT: a truth copy did not take the price-on-request exception';
  end if;
  raise notice 'SUCCESS: price on request is reachable under every period; % priced cohorts unchanged', (select count(*) from _por_probe);
end $do$;

drop table _por_probe;
