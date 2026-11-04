-- Two price-fidelity detectors cried wolf on rows that are exactly what the source / the rule says.
--
-- 1. price_size_contamination:index_price_differs_from_raw:aqar (83 rows on alert 12584, 63 stable). Every one is an
--    aqar rent whose source prints NO period, judged from its price by enforce_rent_period_judgment() (owner
--    2026-09-28) and served ×12 with rent_period_judged = true. The barrier compared the index with
--    rent_price_annual_ar(), which leaves a period-less figure as published — the same false read
--    mon_detect_cheap_yearly_rent_served had (fixed in 20261103191243). It now expects, for a judged row with no source
--    period, what the judgment writes; every other row is checked exactly as before.
--
-- 2. price_eq_area_or_ppm (67 rows) and price_size_contamination:rate_stored_as_total (aqar 3). The class these hunt
--    is a parser that read an AREA or a PER-METRE figure into the price. 62 of the 67 carry the scraper's own
--    price_evidence saying the stored figure was read from the source's TOTAL-price field (abaad total_price, dealapp
--    offers.price, aqar RSC price, haraj REGA «سعر الوحدة», dwelleo price, alshawaf «البيع») with stored = price.
--    That is the source's number coinciding with its area / its own ppm (PRICE = SOURCE), not our leak.
--    price_read_from_source_total() lets both detectors tell the two apart; a row with no such evidence, a text
--    origin, a non-total kind, a stale stored figure, or an area/metre-named field still fires.
--
-- 3. abralosol 10301815: no price_evidence, but the stored capture's detail block prints «على السوم» «1,700 ريال» —
--    the source's own price. Recorded in ops_price_eq_area_verified with that evidence.

create or replace function public.price_read_from_source_total(p_table text, p_id bigint, p_price numeric)
returns boolean
language plpgsql
stable
cost 1000
set search_path to 'public'
as $function$
declare e jsonb;
begin
  if p_price is null or p_id is null
     or coalesce(p_table, '') !~ '^[a-z0-9_]+_(residential|commercial)_listings$' then
    return false;
  end if;
  begin
    execute format('select source_capture->''price_evidence'' from public.%I where id = $1', p_table)
      into e using p_id;
  exception when undefined_table or undefined_column then
    return false;
  end;
  return e is not null
     and jsonb_typeof(e) = 'object'
     and coalesce(e->>'found', '') = 'true'
     and coalesce(e->>'kind', '') = 'total'
     and coalesce(e->>'origin', '') in ('api', 'structured')
     and coalesce(e->>'stored', '') ~ '^[0-9]+(\.[0-9]+)?$'
     and (e->>'stored')::numeric = p_price
     and coalesce(e->>'field', '') !~* '(area|space|size|sqm|meter|metre|مساحة|متر)';
end
$function$;

comment on function public.price_read_from_source_total(text, bigint, numeric) is
  'true only when the row''s own price_evidence says the stored price was read from the source''s TOTAL-price field '
  '(origin api/structured, kind total, stored = price, field not area/metre-named). Used by price_eq_area_or_ppm and '
  'price_size_contamination to tell a source coincidence from an area/ppm-as-price parser leak.';

do $mig$
declare
  d text;
  a_old text;
  b_old text;
  c_old text;
  n int;
begin
  -- (1) + (2b) the barrier
  d := pg_get_functiondef('public.mon_price_size_fidelity_barrier'::regproc);
  a_old := 'and s.price_annual is distinct from public.rent_price_annual_ar(''aqar'', a.rent_period, a.price_annual, a.property_type)';
  b_old := E'    and not exists (select 1 from public.ops_price_eq_area_verified v\n                    where v.source_table = s.source_table and v.listing_id = s.listing_id)\n  group by s.platform having count(*) > 0';
  if (length(d) - length(replace(d, a_old, ''))) / length(a_old) <> 1
     or (length(d) - length(replace(d, b_old, ''))) / length(b_old) <> 1 then
    raise exception 'mon_price_size_fidelity_barrier: anchors not found exactly once';
  end if;
  d := replace(d, a_old,
    'and s.price_annual is distinct from (case when s.rent_period_judged and a.rent_period is null'
    || ' and public.judge_silent_rent_period_ar(coalesce(a.price_annual, a.price_total), s.type_ar) = ''شهري'''
    || ' then coalesce(a.price_annual, a.price_total) * 12'
    || ' else public.rent_price_annual_ar(''aqar'', a.rent_period, a.price_annual, a.property_type) end)');
  d := replace(d, b_old,
    E'    and not exists (select 1 from public.ops_price_eq_area_verified v\n                    where v.source_table = s.source_table and v.listing_id = s.listing_id)\n'
    || E'    and not public.price_read_from_source_total(s.source_table, s.listing_id, s.price_total)\n'
    || '  group by s.platform having count(*) > 0');
  execute d;

  -- (2a) price_eq_area_or_ppm
  d := pg_get_functiondef('public.mon_detect_price_eq_area_or_ppm'::regproc);
  c_old := E'where v.source_table = s.source_table and v.listing_id = s.listing_id);\n  v_open';
  n := (length(d) - length(replace(d, c_old, ''))) / length(c_old);
  if n <> 1 then
    raise exception 'mon_detect_price_eq_area_or_ppm: anchor found % times', n;
  end if;
  execute replace(d, c_old,
    E'where v.source_table = s.source_table and v.listing_id = s.listing_id)\n'
    || E'    and not public.price_read_from_source_total(s.source_table, s.listing_id, s.price_total);\n  v_open');
end
$mig$;

insert into public.ops_price_eq_area_verified (source_table, listing_id, evidence, verified_price_total, verified_area_m2)
select 'abralosol_residential_listings', 10301815,
       'Data fidelity 2026-11-03 (alerts price_eq_area_or_ppm + price_size_contamination:rate_stored_as_total:abralosol). '
       || 'SOURCE-REAL: the stored capture of https://abralosol.com/7214 prints the price block «🟡 على السوم» «1,700 ريال» '
       || '(index price_cell «على السوم 1,700») and the area block «🟨 المساحة 350 م». 1,700 is the figure the site '
       || 'publishes as the asking price; Ezhalah did not create it (PRICE = SOURCE, never reprice).',
       1700, 350
where exists (select 1 from public.abralosol_residential_listings
               where id = 10301815 and price_total = 1700 and area_m2 = 350)
on conflict (source_table, listing_id) do nothing;
