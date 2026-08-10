-- Second half of the aqar area retraction: the COMMERCIAL table (Filter audit, 2026-08-10).
--
-- `run_commercial.py` imports `enrich_residential` — "the page enricher is shared with residential".
-- So PR#432's spec-table anchor already fixes commercial ingestion; what it could not do is retract
-- the value already stored. The first retraction migration only covered aqar_residential_listings,
-- and the barrier only JOINed that table, so this row was invisible to both.
--
-- ad 6650784 (مكتب, listing_id 365913): the captured page reads
--     «محل للايجار حي الملك فيصل منطقة حيوية المساحة... الإيجار 40000»
-- — "…the area… the rent 40000". The area label is followed by an ELLIPSIS, no number at all, and
-- the parser walked on to the next figure, which is the RENT. Stored area 40,000 m² = stored rent
-- 40,000 SAR. No spec block, no currency-marked token: nothing on this page publishes an area.
--
-- The other four aqar_commercial rows whose area equals their price are KEPT — each publishes that
-- exact figure in its own «تفاصيل الإعلان» spec table (10,000 · 2,500 · 1,477,500 · 750,000). Equality
-- is a coincidence there, not a leak, and a weird source-published value stays.
do $$
declare v_before int; v_after int; v_kept int;
begin
  select count(*) into v_before
  from public.aqar_commercial_listings where id = 365913 and area_m2 = 40000;
  if v_before <> 1 then
    raise exception 'expected ad 6650784 to still carry area 40000, found % row(s)', v_before;
  end if;

  update public.aqar_commercial_listings
     set area_m2 = null, price_per_meter = null
   where id = 365913;

  select count(*) into v_after
  from public.aqar_commercial_listings where id = 365913 and area_m2 is not null;
  if v_after <> 0 then raise exception 'commercial retraction did not take'; end if;

  -- CONTROLS: the four source-published equalities must survive.
  select count(*) into v_kept
  from public.aqar_commercial_listings
  where id in (294762, 295041, 1032212, 1564519) and area_m2 is not null;
  if v_kept <> 4 then
    raise exception 'a source-published commercial area was destroyed (% of 4 left)', v_kept;
  end if;
end $$;

-- Barrier now spans BOTH aqar tables. The residential-only JOIN is exactly why 6650784 hid from the
-- first sweep: a per-table check silently scopes away half the platform.
create or replace function public.mon_price_size_fidelity_barrier()
returns table(check_name text, platform text, n bigint, detail text)
language sql
stable
as $function$
  select 'zero_in_inapplicable_price_column'::text, s.platform, count(*)::bigint,
         'a 0 standing in for "not applicable" — the honest value is NULL'::text
  from public.search_listings_ar s
  where (s.deal_ar='بيع' and s.price_annual = 0) or (s.deal_ar='إيجار' and s.price_total = 0)
  group by s.platform having count(*) > 0

  union all
  select 'rate_stored_as_total', s.platform, count(*)::bigint,
         'price_total/area_m2 < 100 SAR/m² — a rate wearing the total column'
  from public.search_listings_ar s
  where s.deal_ar='بيع' and s.price_total is not null and s.price_per_meter is not null
    and s.price_total = s.price_per_meter and s.area_m2 > 0
    and s.price_total::numeric / s.area_m2 < 100
  group by s.platform having count(*) > 0

  union all
  -- AREA LEAKED INTO PRICE — now over BOTH aqar tables via a UNION of their captures. Three signals
  -- must agree before a row is reported: area = price exactly, the spec table publishes no area, and
  -- no currency-marked figure exists in the capture. aqar 6594767 is deliberately NOT caught (it
  -- publishes «سعر المتر 1», so total = area legitimately and the figure is printed on the page).
  select 'area_leaked_into_price', s.platform, count(*)::bigint,
         'area = price exactly, no spec-table area, no priced token in the capture'
  from public.search_listings_ar s
  join (
    select id, 'aqar_residential_listings'::text tbl, source_capture from public.aqar_residential_listings
    union all
    select id, 'aqar_commercial_listings',           source_capture from public.aqar_commercial_listings
  ) a on a.id = s.listing_id and a.tbl = s.source_table
  where s.area_m2 is not null and s.area_m2 > 1000
    and s.area_m2 in (s.price_total, s.price_annual)
    and (regexp_match(split_part(coalesce(a.source_capture->>'source_text',''),'تفاصيل الإعلان',2),
                      'المساحة[\s:]{0,4}([0-9][0-9,٬]{0,12})'))[1] is null
    and (regexp_match(split_part(coalesce(a.source_capture->>'source_text',''),'تفاصيل الإعلان',1),
                      '([0-9][0-9,]{2,})\s*[§﷼]'))[1] is null
  group by s.platform having count(*) > 0

  union all
  select 'index_price_differs_from_raw', 'aqar', count(*)::bigint,
         'search_listings_ar price_annual differs from aqar_residential_listings'
  from public.search_listings_ar s
  join public.aqar_residential_listings a on a.id = s.listing_id
  where s.source_table = 'aqar_residential_listings'
    and s.price_annual is distinct from a.price_annual
  having count(*) > 0

  union all
  select 'area_differs_from_spec_block', 'aqar', count(*)::bigint,
         'stored area_m2 disagrees with «المساحة» inside the spec block'
  from (
    select a.area_m2,
           (regexp_match(split_part(a.source_capture->>'source_text','تفاصيل الإعلان',2),
                         'المساحة[\s:]{0,4}([0-9][0-9,٬]{0,12})(?:\.[0-9]+)?\s*م'))[1] r
    from public.aqar_residential_listings a
    where a.active and a.area_m2 is not null
      and coalesce(a.source_capture->>'source_text','') like '%تفاصيل الإعلان%'
  ) q
  where q.r is not null and q.area_m2 <> replace(replace(q.r,',',''),'٬','')::bigint
  having count(*) > 0
$function$;