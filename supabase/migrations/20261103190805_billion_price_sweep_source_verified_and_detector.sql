-- Backlog 1261 (PRICE TRUTH, 2026-11-03): every served price over 1,000,000,000 SAR read against its own source page.
--
-- Of the 79 served >1B rows not yet in ops_price_source_verified, 70 were read LIVE today and carry EXACTLY the number the
-- site itself publishes (wasalt 44 via __NEXT_DATA__ propertyDetailsV3.propertyInfo; dealapp 17 via its JSON-LD offer;
-- aqar 3, ksaaqar 2, souq24 1, eaqartabuk 1 via the page; muhaysini 2 via its own API record). They are advertiser typos
-- the site publishes (mostly a per-m² figure entered as the total, which wasalt/dealapp then multiply by the area), so PRICE
-- = SOURCE: recorded, never repriced (owner rule 2026-08-03 «whatever is in those platforms keep it how it is»). The rest:
-- 6 wasalt + 1 dealapp ads the source now 404s / serves empty (left to liveness — no hide on one read), 1 sakani (blocked),
-- 1 aqarmonthly booking row (no visible price). The only OUR-side errors in this family were the two wasalt triggers
-- repaired at 17:09/17:10 (stale archive restored the typo; impossible "rate" parked the real total).
insert into public.ops_price_source_verified (source_table, listing_id, evidence)
select v.t, v.id, format('Billion-price sweep 2026-11-03 (backlog 1261): read live from the listing''s own page/record — %s = %s = the stored price%s. Source-published; kept (PRICE = SOURCE), never repriced.', v.field, v.val, case when v.ppsqm is null then '' else format('; the site''s own per-m² figure %s', v.ppsqm) end)
from (values
 ('wasalt_residential_listings',2408112,'wasalt salePrice',1181250000,1350000),('wasalt_residential_listings',4020806,'wasalt salePrice',1544745450,1965000),('wasalt_residential_listings',9163829,'wasalt salePrice',3447630000,508500),('wasalt_residential_listings',11817223,'wasalt salePrice',1253400000,1200000),('wasalt_residential_listings',11939696,'wasalt salePrice',2052000000,1200000),('wasalt_residential_listings',11939797,'wasalt salePrice',2160000000,1800000),('wasalt_residential_listings',11939911,'wasalt salePrice',1241124100,1700170),('wasalt_residential_listings',13746589,'wasalt salePrice',1601792501,1600896),('wasalt_residential_listings',13996553,'wasalt salePrice',1195853863,1146926),('wasalt_residential_listings',13996697,'wasalt salePrice',1171206000,1697400),('wasalt_residential_listings',13997995,'wasalt salePrice',1537200000,1750000),('wasalt_residential_listings',14616961,'wasalt salePrice',2042998560,1691000),('wasalt_residential_listings',14617141,'wasalt salePrice',1170000000,1300000),('wasalt_residential_listings',14617255,'wasalt salePrice',2761380000,1600800),('wasalt_residential_listings',14617257,'wasalt salePrice',3680205000,1900000),('wasalt_residential_listings',14617734,'wasalt salePrice',1429903687,1669824),('wasalt_residential_listings',14617738,'wasalt salePrice',1303403750,1375000),('wasalt_residential_listings',14618141,'wasalt salePrice',1253700000,1400000),('wasalt_residential_listings',14618564,'wasalt salePrice',1175632000,1600000),('wasalt_residential_listings',15179293,'wasalt salePrice',1350000000,1500000),('wasalt_residential_listings',15555793,'wasalt salePrice',1500000000,2000000),('wasalt_residential_listings',15795588,'wasalt salePrice',1530000000,1500000),('wasalt_residential_listings',15921629,'wasalt salePrice',1199059000,1150000),('wasalt_residential_listings',15921641,'wasalt salePrice',1469572201,1838482),('wasalt_residential_listings',15925685,'wasalt salePrice',1144800000,1600000),('wasalt_residential_listings',16527744,'wasalt salePrice',1215000000,1350000),('wasalt_residential_listings',16528239,'wasalt salePrice',1331000000,1210000),('wasalt_residential_listings',19145924,'wasalt salePrice',1300000000,1300000),('wasalt_residential_listings',19146767,'wasalt salePrice',2437500000,1950000),('wasalt_residential_listings',19146859,'wasalt salePrice',1606483000,1700000),('wasalt_residential_listings',22473342,'wasalt salePrice',1317600000,1500000),('wasalt_residential_listings',22473343,'wasalt salePrice',3750000000,1250000),('wasalt_residential_listings',22475053,'wasalt salePrice',1567328072,1119760),('wasalt_residential_listings',22475060,'wasalt salePrice',1800000000,2000000),('wasalt_residential_listings',22475461,'wasalt salePrice',1116630000,900000),('wasalt_residential_listings',22476186,'wasalt salePrice',1303742064,1250400),('wasalt_residential_listings',2409058,'wasalt salePrice',1125065500,650327),('wasalt_residential_listings',2408144,'wasalt salePrice',1125065500,650327),('wasalt_residential_listings',14617146,'wasalt salePrice',1093500000,1215000),('wasalt_residential_listings',15921644,'wasalt salePrice',1087500000,1450000),('wasalt_residential_listings',11939895,'wasalt salePrice',1080000000,1200000),('wasalt_residential_listings',19145922,'wasalt salePrice',1065600000,1480000),('wasalt_residential_listings',15921627,'wasalt salePrice',1062500000,1700000),('wasalt_residential_listings',16234089,'wasalt salePrice',1026000000,1250000),
 ('dealapp_residential_listings',1126550,'dealapp JSON-LD offers.price',1037016000,null),('dealapp_residential_listings',1388338,'dealapp JSON-LD offers.price',2694416000,null),('dealapp_residential_listings',2295954,'dealapp JSON-LD offers.price',3300000000,null),('dealapp_residential_listings',3045449,'dealapp JSON-LD offers.price',1033480000,null),('dealapp_residential_listings',5440139,'dealapp JSON-LD offers.price',1300000000,null),('dealapp_residential_listings',9614480,'dealapp JSON-LD offers.price',1440000000,null),('dealapp_residential_listings',16156421,'dealapp JSON-LD offers.price',2160000000,null),('dealapp_residential_listings',17640922,'dealapp JSON-LD offers.price',1080000000,null),('dealapp_residential_listings',17789952,'dealapp JSON-LD offers.price',1175632000,null),('dealapp_residential_listings',18988523,'dealapp JSON-LD offers.price',1150440000,null),('dealapp_residential_listings',19862006,'dealapp JSON-LD offers.price',2373751600,null),('dealapp_residential_listings',20296137,'dealapp JSON-LD offers.price',4171812000,null),('dealapp_residential_listings',21399620,'dealapp JSON-LD offers.price',179144000000,null),('dealapp_residential_listings',22045681,'dealapp JSON-LD offers.price',4249260500,null),('dealapp_residential_listings',22256602,'dealapp JSON-LD offers.price',1569600000,null),('dealapp_residential_listings',17022539,'dealapp JSON-LD offers.price',3385600000,null),('dealapp_residential_listings',23282125,'dealapp JSON-LD offers.price',2200000000,null),
 ('aqar_residential_listings',1878005,'aqar page «3,300,000,000 ريال»',3300000000,null),('aqar_residential_listings',6656583,'aqar page «1,558,560,000 ريال»',1558560000,null),('aqar_commercial_listings',14955154,'aqar page «4,000,000,016 ريال»',4000000016,null),
 ('ksaaqar_residential_listings',12225960,'ksaaqar page «10,000,150,000.00 ريال»',10000150000,null),('ksaaqar_residential_listings',12226323,'ksaaqar page «1,650,000,000.00 ريال»',1650000000,null),
 ('souq24_residential_listings',1458945,'24.com.sa page «4,000,000,000 ريال»',4000000000,null),('eaqartabuk_residential_listings',1039187,'eaqartabuk page 1,850,000,000',1850000000,null),
 ('muhaysini_residential_listings',13277171,'muhaysini API record',1276480000,null),('muhaysini_residential_listings',13280536,'muhaysini API record',2373751600,null)
) as v(t, id, field, val, ppsqm)
where exists (select 1 from information_schema.tables it where it.table_schema='public' and it.table_name=v.t)
on conflict (source_table, listing_id) do nothing;

-- The guard: a served >1B price nobody has proven. It REPAIRS BEFORE IT RAISES: a wasalt sale row whose own archived
-- payload (fetched in the last 30 days) publishes salePrice = the stored price AND whose own averageSalePricePerSqm × area
-- reproduces it within 2% is wasalt's published arithmetic — recorded automatically, with that evidence. Everything else
-- left over (a new site's typo, or OUR parse error) raises P1 with the listings to read, and resolves when none remain.
create or replace function public.mon_detect_served_billion_price_unproven()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare n int := 0; v_left int; v_sample jsonb; v_auto int;
begin
  insert into public.ops_price_source_verified (source_table, listing_id, evidence)
  select 'wasalt_residential_listings', w.id,
         format('auto (mon_detect_served_billion_price_unproven): the row''s own archived wasalt payload (fetched %s) publishes salePrice = %s = the stored price, and wasalt''s own averageSalePricePerSqm %s × area %s reproduces it within 2%% — wasalt''s number, kept (PRICE = SOURCE).',
                w.ar_fetched_at::date, w.price_total, w.ar_data->'propertyInfo'->>'averageSalePricePerSqm', w.area_m2)
    from public.wasalt_residential_listings w
   where w.active and w.transaction_type = 'Buy' and w.price_total > 1000000000
     and w.ar_fetched_at > now() - interval '30 days'
     and (w.ar_data->'propertyInfo'->>'salePrice') ~ '^\d+(\.\d+)?$'
     and (w.ar_data->'propertyInfo'->>'salePrice')::numeric = w.price_total
     and (w.ar_data->'propertyInfo'->>'averageSalePricePerSqm') ~ '^\d+(\.\d+)?$'
     and w.area_m2 > 0
     and abs((w.ar_data->'propertyInfo'->>'averageSalePricePerSqm')::numeric * w.area_m2 - w.price_total) <= 0.02 * w.price_total
  on conflict (source_table, listing_id) do nothing;
  get diagnostics v_auto = row_count;

  select count(*), jsonb_agg(jsonb_build_object('t', source_table, 'id', listing_id,
           'price', coalesce(price_total, price_annual, price_total_effective)) order by listing_id) filter (where rn <= 15)
    into v_left, v_sample
    from (select s.*, row_number() over () rn
            from public.search_listings_ar s
           where (coalesce(s.price_total,0) > 1000000000 or coalesce(s.price_annual,0) > 1000000000
                  or coalesce(s.price_total_effective,0) > 1000000000)
             and not exists (select 1 from public.ops_price_source_verified v
                              where v.source_table = s.source_table and v.listing_id = s.listing_id)) x;

  if v_left > 0 then
    n := public.mon_raise('P1', 'served_billion_price_unproven', 'fleet', 'served_billion_price_unproven',
      jsonb_build_object('rows', v_left, 'auto_recorded_this_run', v_auto, 'sample', v_sample,
        'why', 'a served price over 1,000,000,000 SAR that no page read has proven. Open each ad: if the site publishes the number, record it in ops_price_source_verified (PRICE = SOURCE, never reprice); if the page says something else, it is OUR parse error — fix the writer and repair the row (backlog 1261).'));
  else
    perform public.mon_resolve_key('served_billion_price_unproven', 'served_billion_price_unproven');
  end if;
  return n;
end
$function$;

-- Roster entry in the SAME migration (mon_detect_orphaned_detectors fires on a detector nothing reaches).
do $mig$
declare d text;
begin
  d := pg_get_functiondef('public.mon_run_all_detectors()'::regprocedure);
  if (select count(*) from regexp_matches(d, '''mon_detect_field_integrity'',', 'g')) <> 1 then
    raise exception 'mon_run_all_detectors: roster anchor not found exactly once — body changed, re-derive the edit';
  end if;
  d := replace(d, $x$'mon_detect_field_integrity',$x$,
    $x$'mon_detect_field_integrity', 'mon_detect_served_billion_price_unproven',$x$);
  execute d;
end
$mig$;