-- OWNER DECISION #4 RE-APPLIED (2026-11-04): aqar «سعر المتر 1» is a placeholder, show NO price. The first repair
-- (migration owner_decisions_4_5_9_aqar_rate_one_farm_area_wasalt_types, 09:40 UTC) was partly undone because the aqar scraper ran the OLD parser until the fix merged
-- (~11:35 UTC) and wrote the rate 1 and the 1 × area price back on 36 rows (alert aqar_rate_one_served_as_price).
-- The parser on main no longer writes them, so this same repair, re-run unchanged, now stays.
do $mig$
declare n int; t text;
  re constant text := '(^|[^ط]\s)سعر\s*المتر(\s*المربع)?\s*:?\s*1([^0-9.,]|$)';
begin
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
