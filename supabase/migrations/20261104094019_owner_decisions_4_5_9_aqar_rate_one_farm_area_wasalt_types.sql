-- Owner decisions 4, 5 and 9 (owner, 2026-11-04, «Yes, use your picks»).
--
-- (4) An aqar ad with no price and only «سعر المتر 1 ريال» shows NO price — never rate × area.
--     «سعر المتر 1» is aqar's placeholder. Measured before this migration (active rows):
--       • 109 sale ads with no total and a stored price_per_meter = 1 were served price_total_effective
--         = 1 × area (aqar_residential 97, aqar_commercial 12);
--       • 16 ads stored aqar's own 1 × area headline as their price (residential Buy 5 / Rent 9,
--         commercial Buy 1 / Rent 1), e.g. ad 6738236 «21,721 § ريال / سنوي» for 21,721 m².
--     The parser (scrapers/aqar/enrich_residential.py rate_placeholder_fields) now writes the placeholder
--     as an authoritative NULL and a 1 × area figure as no price (price_evidence.authoritative_absent).
--     Repair here, same rule, only where the row's OWN capture prints exactly «سعر المتر 1» (a real
--     1.5 / 1.86 rate is untouched): price_per_meter → NULL on 184 rows (154 active); the 1 × area price
--     → NULL on 19 rows (16 active), each recorded in ops_authoritative_null_price with its before value.
--     This supersedes the three ops_price_eq_area_verified adjudications on the same shape (8982174,
--     10222037, 12069092): their own evidence quotes «سعر المتر 1 §»; the rows stay as history.
--     mon_detect_aqar_rate_one_served_as_price keeps it at 0.
--
-- (5) Farms/land whose own site publishes an impossible area (e.g. 59,260,300 m²) stay hidden by the
--     plausibility gate. price_gate_withheld («Needs an owner decision») now raises only for withheld rows
--     the decision does NOT cover: anything that is not a farm/land, a row a PRICE clause gates, or an
--     area the row's own capture does not print (a parser-error suspect). Measured: the 3 withheld rows
--     are aqar farms 15150858 / 15150868 / 15204126, each capture printing «المساحة 59,2x0,300 م²».
--
-- (9) wasalt «Teller» (ATM site) and «Telecom tower» stay «غير معروف». The decision is recorded in
--     known_property_types (note says it is deliberately unmapped), which is what detect_novel_property_types
--     reads, so legacy_novel_type stops re-raising these two and only these two.

-- ── (4) detector ──────────────────────────────────────────────────────────────────────────────────
create or replace function public.mon_detect_aqar_rate_one_served_as_price()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  n int := 0; live text[] := '{}'; v_bad bigint; v_top jsonb;
  re constant text := '(^|[^ط]\s)سعر\s*المتر(\s*المربع)?\s*:?\s*1([^0-9.,]|$)';
begin
  -- Owner decision #4 (2026-11-04): «سعر المتر 1» is aqar's placeholder; it is never stored as a rate
  -- (the index would derive 1 × area) and a price equal to 1 × area is never served.
  with c as (
    select 'aqar_residential_listings' t, id, price_per_meter, price_total, price_annual, rent_period, area_m2, transaction_type, source_capture
      from public.aqar_residential_listings
     where active and (price_per_meter = 1 or (area_m2 > 0 and area_m2::bigint in (price_total, price_annual, price_annual / 12)))
    union all
    select 'aqar_commercial_listings', id, price_per_meter, price_total, price_annual, rent_period, area_m2, transaction_type, source_capture
      from public.aqar_commercial_listings
     where active and (price_per_meter = 1 or (area_m2 > 0 and area_m2::bigint in (price_total, price_annual, price_annual / 12)))
  ), bad as (
    select t, id, price_per_meter, price_total, price_annual, area_m2 from c
     where source_capture->>'source_text' ~ re
       and (price_per_meter = 1
         or (transaction_type <> 'Rent' and price_total = area_m2::bigint)
         or (transaction_type = 'Rent' and (price_annual = area_m2::bigint
                                          or (rent_period = 'monthly' and price_annual = area_m2::bigint * 12))))
  )
  select count(*), (select jsonb_agg(to_jsonb(b)) from (select * from bad order by id desc limit 10) b)
    into v_bad, v_top from bad;

  if v_bad > 0 then
    live := live || 'aqar_rate_one_served_as_price'::text;
    n := n + public.mon_raise('P2', 'aqar_rate_one_served_as_price', 'aqar', 'aqar_rate_one_served_as_price',
      jsonb_build_object('rows', v_bad, 'sample', v_top,
        'why', 'Owner decision #4 (2026-11-04): an aqar ad whose page shows only «سعر المتر 1» has NO price. These rows store the placeholder rate 1 (the index derives 1 × area for a sale) or a price equal to 1 × area.',
        'action', 'Check scrapers/aqar/enrich_residential.py rate_placeholder_fields and the writer that stored the row; clear as the decision-4 repair did (ops_authoritative_null_price + authoritative_absent).'));
  end if;
  perform public.mon_resolve_stale_keys('aqar_rate_one_served_as_price', live);
  return n;
end
$function$;

-- ── (5) the gate's alarm tells a decided source-published area apart from a parser suspect ─────────
create or replace function public.gate_withheld_area_is_source_published(
  p_table text, p_id bigint, p_type_ar text, p_pt numeric, p_pa numeric, p_area integer)
 returns boolean
 language plpgsql
 stable
 security definer
 set search_path to 'public'
as $function$
declare v_txt text;
begin
  -- Owner decision #5 (2026-11-04): a farm/land whose OWN site publishes an impossible area stays hidden
  -- by the plausibility gate. True only for that case; anything unproven returns false and still alarms.
  if p_area is null or p_area <= 50000000 then return false; end if;           -- the area clause alone
  if public.price_size_impossible(p_pt, p_pa, null) then return false; end if;  -- a price clause fires too
  if p_type_ar is null or p_type_ar !~ '^(مزرعة|أرض)' then return false; end if;
  if p_table is null or p_table !~ '^[a-z0-9_]+_listings$' then return false; end if;
  begin
    execute format('select source_capture->>''source_text'' from public.%I where id = $1', p_table)
      into v_txt using p_id;
  exception when others then
    return false;
  end;
  return v_txt is not null
     and (position(to_char(p_area, 'FM999,999,999,999') in v_txt) > 0
          or v_txt ~ ('(^|[^0-9,.])' || p_area::text || '([^0-9.,]|$)'));
end
$function$;

do $mig$
declare d text; n int; t text;
  re constant text := '(^|[^ط]\s)سعر\s*المتر(\s*المربع)?\s*:?\s*1([^0-9.,]|$)';
begin
  -- (5) needle edits of the LIVE location_pipeline_monitor body.
  d := pg_get_functiondef('public.location_pipeline_monitor()'::regprocedure);
  if position($x$and public.price_size_impossible(s.price_total, s.price_annual, s.area_m2);$x$ in d) = 0 then
    raise exception 'location_pipeline_monitor: withheld count anchor not found — body changed, re-derive the edit';
  end if;
  if position($x$Needs an owner decision; the remainder are parser bugs.$x$ in d) = 0 then
    raise exception 'location_pipeline_monitor: why-text anchor not found — body changed, re-derive the edit';
  end if;
  d := replace(d, $x$and public.price_size_impossible(s.price_total, s.price_annual, s.area_m2);$x$,
    $x$and public.price_size_impossible(s.price_total, s.price_annual, s.area_m2)
      -- owner decision #5 (2026-11-04): a farm/land whose own capture prints the impossible area is
      -- kept hidden by decision; only what the decision does not cover is counted here.
      and not public.gate_withheld_area_is_source_published(s.source_table, s.listing_id, s.type_ar,
                                                           s.price_total, s.price_annual, s.area_m2);$x$);
  d := replace(d, $x$Needs an owner decision; the remainder are parser bugs.$x$,
    $x$Owner decision #5 (2026-11-04) keeps a farm/land whose own site publishes an impossible area hidden; those are excluded from this count. What remains is NOT covered by it: a non-land row, a price-clause row, or an area its own capture does not print (a parser-error suspect).$x$);
  execute d;

  -- (4) roster: the detector is reached by mon_run_all_detectors.
  d := pg_get_functiondef('public.mon_run_all_detectors()'::regprocedure);
  if position($x$'mon_detect_aqar_price_over_authoritative_absent',$x$ in d) = 0 then
    raise exception 'mon_run_all_detectors: roster anchor not found — body changed, re-derive the edit';
  end if;
  if position('mon_detect_aqar_rate_one_served_as_price' in d) = 0 then
    d := replace(d, $x$'mon_detect_aqar_price_over_authoritative_absent',$x$,
      $x$'mon_detect_aqar_price_over_authoritative_absent',
    'mon_detect_aqar_rate_one_served_as_price',$x$);
    execute d;
  end if;

  -- (4) repair.
  foreach t in array array['aqar_residential_listings', 'aqar_commercial_listings'] loop
    execute format($f$
      insert into public.ops_authoritative_null_price (source_table, listing_id, column_blanked, price_before, reason, evidence)
      select %1$L, id,
             case when transaction_type = 'Rent' then 'price_annual' else 'price_total' end,
             case when transaction_type = 'Rent' then price_annual else price_total end,
             'owner decision #4 (2026-11-04): aqar «سعر المتر 1» is a placeholder; the only price is 1 × area',
             'own capture prints «سعر المتر 1» and «المساحة ' || to_char(area_m2, 'FM999,999,999,999')
               || ' م²»; stored price ' || coalesce(price_total, price_annual) || ' = 1 × area'
        from public.%1$I
       where price_per_meter = 1 and area_m2 > 0 and source_capture ? 'price_evidence'
         and source_capture->>'source_text' ~ %2$L
         and ((transaction_type <> 'Rent' and price_total = area_m2::bigint)
           or (transaction_type = 'Rent' and (price_annual = area_m2::bigint
                                            or (rent_period = 'monthly' and price_annual = area_m2::bigint * 12))))
      on conflict do nothing$f$, t, re);
    get diagnostics n = row_count;
    if n > 20 then raise exception '% price repair would touch % rows, expected <= 19', t, n; end if;

    -- source_capture changes, so trg_aqar_parse re-parses; authoritative_absent stops it re-reading the price.
    execute format($f$
      update public.%1$I x
         set price_total  = case when x.transaction_type <> 'Rent' then null else x.price_total end,
             price_annual = case when x.transaction_type = 'Rent' then null else x.price_annual end,
             price_per_meter = null,
             source_capture = jsonb_set(jsonb_set(x.source_capture, '{price_evidence,authoritative_absent}', 'true'::jsonb),
                                        '{price_evidence,stored}', 'null'::jsonb)
        from public.ops_authoritative_null_price a
       where a.source_table = %1$L and a.listing_id = x.id
         and a.reason like 'owner decision #4 (2026-11-04)%%'
         and x.price_per_meter = 1$f$, t);
    get diagnostics n = row_count;
    if n > 20 then raise exception '% price repair touched % rows, expected <= 19', t, n; end if;

    -- the placeholder rate alone (source_capture untouched, so trg_aqar_parse returns early on fullparse_done rows).
    execute format($f$
      create temp table _ppm_before on commit drop as
      select id, price_total, price_annual from public.%1$I
       where price_per_meter = 1 and source_capture->>'source_text' ~ %2$L$f$, t, re);
    execute format($f$
      update public.%1$I x set price_per_meter = null
        from _ppm_before b where b.id = x.id and x.price_per_meter = 1$f$, t);
    get diagnostics n = row_count;
    if n > 220 then raise exception '% ppm repair touched % rows, expected <= 184 in all', t, n; end if;
    execute format($f$
      select count(*) from public.%1$I x join _ppm_before b on b.id = x.id
       where x.price_total is distinct from b.price_total or x.price_annual is distinct from b.price_annual$f$, t)
      into n;
    if n > 0 then raise exception '% ppm repair moved % prices — it must touch the rate only', t, n; end if;
    drop table _ppm_before;
  end loop;
end
$mig$;

-- ── (9) wasalt Teller / Telecom tower: deliberately unmapped, recorded ───────────────────────────────
insert into public.known_property_types (raw_type, note)
select v.raw_type, 'owner decision #9 (2026-11-04): wasalt «' || v.raw_type || '» is deliberately UNMAPPED and served as «غير معروف»; recorded so legacy_novel_type stops re-raising it. Not a type mapping.'
  from (values ('Teller'), ('Telecom tower')) v(raw_type)
 where not exists (select 1 from public.known_property_types k where k.raw_type = v.raw_type);

-- check block: executed, not grepped.
do $chk$
declare n int; d text;
begin
  -- (4) nothing left that the decision forbids.
  select count(*) into n from (
    select 1 from public.aqar_residential_listings
     where active and price_per_meter = 1 and source_capture->>'source_text' ~ '(^|[^ط]\s)سعر\s*المتر(\s*المربع)?\s*:?\s*1([^0-9.,]|$)'
    union all
    select 1 from public.aqar_commercial_listings
     where active and price_per_meter = 1 and source_capture->>'source_text' ~ '(^|[^ط]\s)سعر\s*المتر(\s*المربع)?\s*:?\s*1([^0-9.,]|$)') z;
  if n > 0 then raise exception 'decision 4: % active rows still store the placeholder rate 1', n; end if;
  if exists (select 1 from public.aqar_residential_listings where id = 20806498 and price_annual is not null) then
    raise exception 'decision 4: ad 6738236 (20806498) still carries 1 × area as its price';
  end if;
  if public.mon_detect_aqar_rate_one_served_as_price() <> 0 then
    raise exception 'decision 4: detector still raises after the repair';
  end if;
  -- the placeholder test is exact: 1.5 is a real rate.
  if 'المساحة 50,000 م² سعر المتر 1.5 § ريال' ~ '(^|[^ط]\s)سعر\s*المتر(\s*المربع)?\s*:?\s*1([^0-9.,]|$)' then
    raise exception 'decision 4: 1.5 read as the placeholder';
  end if;
  if not ('المساحة 450 م² سعر المتر 1 § ريال' ~ '(^|[^ط]\s)سعر\s*المتر(\s*المربع)?\s*:?\s*1([^0-9.,]|$)') then
    raise exception 'decision 4: «سعر المتر 1 §» not read as the placeholder';
  end if;

  -- (5) the three aqar farms are covered by the decision; an uncaptured area / a non-land / a price clause is not.
  if not public.gate_withheld_area_is_source_published('aqar_commercial_listings', 15150858, 'مزرعة', null, null, 59260300) then
    raise exception 'decision 5: 15150858 (59,260,300 m² printed by its own page) not recognised';
  end if;
  if public.gate_withheld_area_is_source_published('aqar_commercial_listings', 15150858, 'مزرعة', null, null, 59260301) then
    raise exception 'decision 5: an area the capture does not print was treated as source-published';
  end if;
  if public.gate_withheld_area_is_source_published('aqar_commercial_listings', 15150858, 'شقة', null, null, 59260300) then
    raise exception 'decision 5: a non-land row was covered';
  end if;
  if public.gate_withheld_area_is_source_published('aqar_commercial_listings', 15150858, 'مزرعة', 60000000000, null, 59260300) then
    raise exception 'decision 5: a price-clause row was covered';
  end if;
  d := pg_get_functiondef('public.location_pipeline_monitor()'::regprocedure);
  if position('gate_withheld_area_is_source_published' in d) = 0 then
    raise exception 'decision 5: location_pipeline_monitor does not consult the decision';
  end if;
  if position('mon_detect_aqar_rate_one_served_as_price' in pg_get_functiondef('public.mon_run_all_detectors()'::regprocedure)) = 0 then
    raise exception 'decision 4: detector not in the roster';
  end if;

  -- (9) recorded for exactly these two.
  select count(*) into n from public.known_property_types where raw_type in ('Teller', 'Telecom tower') and note like 'owner decision #9%';
  if n <> 2 then raise exception 'decision 9: % of 2 rows recorded', n; end if;
end
$chk$;
